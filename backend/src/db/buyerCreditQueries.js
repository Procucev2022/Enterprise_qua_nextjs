const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');
const { BUYER_FREE_TRIAL_RFQ_CREDITS } = require('../config/constants');

function parseRaw(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (cause) {
      const error = creditError('The stored buyer account contains invalid JSON.', 503, 'INVALID_PERSISTED_RECORD');
      error.cause = cause;
      throw error;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  throw creditError('The stored buyer account record is missing or invalid.', 503, 'INVALID_PERSISTED_RECORD');
}

function creditError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function assertMatchingCreditReplay(row, { buyerId, amount, transaction }) {
  const matches = String(row.buyer_id ?? row.buyerId ?? '') === String(buyerId)
    && Number(row.credits_added ?? row.creditsAdded) === amount
    && (row.transaction_type ?? row.transactionType ?? null) === (transaction.transactionType ?? null)
    && (row.credit_source ?? row.creditSource ?? 'Category Manager Console')
      === (transaction.creditSource || 'Category Manager Console')
    && (row.payment_reference ?? row.paymentReference ?? null) === (transaction.paymentReference || null)
    && (row.description ?? null) === (transaction.description || null);
  if (!matches) {
    throw creditError(
      'This Idempotency-Key was already used for a different buyer credit adjustment.',
      409,
      'CREDIT_IDEMPOTENCY_CONFLICT'
    );
  }
}

function mapTransaction(transaction, row) {
  const previousBalance = Number(row.previous_balance ?? row.previousBalance ?? 0);
  const updatedBalance = Number(row.updated_balance ?? row.updatedBalance ?? 0);
  return {
    previousBalance,
    updatedBalance,
    transaction: { ...transaction, id: row.id || transaction.id, previousBalance, updatedBalance },
  };
}

function invalidateCreditCaches() {
  queryCache.invalidate('buyer_accounts');
  queryCache.invalidate('buyer_credits');
}

async function addBuyerCreditsInDB({ buyerId, amount, transaction }) {
  if (!pool.hasStorage()) return null;
  if (!buyerId || !Number.isInteger(amount) || amount <= 0 || !transaction?.idempotencyKey) {
    throw creditError(
      'Buyer credit addition requires an account, a positive integer amount, and an idempotency key.',
      400,
      'INVALID_CREDIT_ADJUSTMENT'
    );
  }

  const binding = d1Bridge.getD1Binding() || d1Bridge.getD1HttpClient();
  const startedAt = Date.now();
  if (binding) return addBuyerCreditsInD1(binding, { buyerId, amount, transaction, startedAt });
  return addBuyerCreditsInPostgres({ buyerId, amount, transaction, startedAt });
}

async function addBuyerCreditsInD1(binding, { buyerId, amount, transaction, startedAt }) {
  const idempotencyKey = transaction.idempotencyKey;
  const statements = [
    {
      text: `UPDATE buyer_accounts
             SET raw = json_set(
               raw,
               '$.remainingFreeRFQs',
               CAST(COALESCE(json_extract(raw, '$.remainingFreeRFQs'), ${BUYER_FREE_TRIAL_RFQ_CREDITS}) AS INTEGER) + $1
             ), updated_at = CURRENT_TIMESTAMP
             WHERE id = $3
               AND NOT EXISTS (
                 SELECT 1 FROM buyer_credit_transactions WHERE idempotency_key = $2
               )
             RETURNING raw`,
      params: [amount, idempotencyKey, buyerId],
    },
    {
      text: `INSERT INTO buyer_credit_transactions (
               id, buyer_id, rfq_id, transaction_type, credit_source,
               credits_added, credits_consumed, previous_balance, updated_balance,
               payment_reference, status, description, idempotency_key, created_at
             )
             SELECT $1, b.id, $3, $4, $5, $6, 0,
               CAST(COALESCE(json_extract(b.raw, '$.remainingFreeRFQs'), ${BUYER_FREE_TRIAL_RFQ_CREDITS}) AS INTEGER) - $14,
               CAST(COALESCE(json_extract(b.raw, '$.remainingFreeRFQs'), ${BUYER_FREE_TRIAL_RFQ_CREDITS}) AS INTEGER),
               $10, $11, $12, $13, COALESCE($15, CURRENT_TIMESTAMP)
             FROM buyer_accounts b
             WHERE b.id = $2
               AND changes() > 0
               AND NOT EXISTS (
                 SELECT 1 FROM buyer_credit_transactions WHERE idempotency_key = $13
               )
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING *`,
      params: [
        transaction.id,
        buyerId,
        transaction.rfqId || null,
        transaction.transactionType,
        transaction.creditSource || 'Category Manager Console',
        amount,
        0,
        null,
        null,
        transaction.paymentReference || null,
        transaction.status || 'COMPLETED',
        transaction.description || null,
        idempotencyKey,
        amount,
        transaction.createdAt || null,
      ],
    },
    {
      text: 'SELECT * FROM buyer_credit_transactions WHERE idempotency_key = $1 LIMIT 1',
      params: [idempotencyKey],
    },
    {
      text: 'SELECT raw FROM buyer_accounts WHERE id = $1 LIMIT 1',
      params: [buyerId],
    },
  ];

  let results;
  try {
    results = await d1Bridge.batchD1(binding, statements);
  } catch (error) {
    logger.error('Atomic D1 buyer credit addition failed', {
      error,
      buyerId,
      transactionId: transaction.id,
      statementCount: statements.length,
      durationMs: Date.now() - startedAt,
    }, 'BUYER_CREDIT');
    throw error;
  }

  const ledgerRow = results[2]?.rows?.[0];
  const accountRow = results[3]?.rows?.[0];
  if (!accountRow) {
    throw creditError('The buyer account was not found while adding credits.', 404, 'BUYER_ACCOUNT_NOT_FOUND');
  }
  if (!ledgerRow) {
    throw creditError('The buyer credit ledger rejected this idempotency key.', 409, 'CREDIT_IDEMPOTENCY_CONFLICT');
  }
  assertMatchingCreditReplay(ledgerRow, { buyerId, amount, transaction });

  const mapped = mapTransaction(transaction, ledgerRow);
  invalidateCreditCaches();
  logger.info('Atomic D1 buyer credit addition completed', {
    buyerId,
    transactionId: ledgerRow.id,
    alreadyProcessed: !results[0]?.rows?.length,
    statementCount: statements.length,
    durationMs: Date.now() - startedAt,
  }, 'BUYER_CREDIT');
  return {
    account: parseRaw(accountRow.raw),
    ...mapped,
    replayed: !results[0]?.rows?.length,
  };
}

async function addBuyerCreditsInPostgres({ buyerId, amount, transaction, startedAt }) {
  const result = await pool.withTransaction(async (client) => {
    const accountResult = await client.query(
      'SELECT raw FROM buyer_accounts WHERE id = $1 FOR UPDATE',
      [buyerId]
    );
    if (!accountResult.rows?.[0]) {
      throw creditError('The buyer account was not found while adding credits.', 404, 'BUYER_ACCOUNT_NOT_FOUND');
    }

    const existingResult = await client.query(
      'SELECT * FROM buyer_credit_transactions WHERE idempotency_key = $1 LIMIT 1',
      [transaction.idempotencyKey]
    );
    const existing = existingResult.rows?.[0];
    if (existing) {
      assertMatchingCreditReplay(existing, { buyerId, amount, transaction });
      return {
        account: parseRaw(accountResult.rows[0].raw),
        ...mapTransaction(transaction, existing),
        replayed: true,
      };
    }

    const currentAccount = parseRaw(accountResult.rows[0].raw);
    const previousBalance = Number(currentAccount.remainingFreeRFQs ?? BUYER_FREE_TRIAL_RFQ_CREDITS);
    const updatedBalance = previousBalance + amount;
    const account = {
      ...currentAccount,
      remainingFreeRFQs: updatedBalance,
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
    };
    const updateResult = await client.query(
      `UPDATE buyer_accounts SET raw = $1, updated_at = now()
       WHERE id = $2 RETURNING raw`,
      [JSON.stringify(account), buyerId]
    );
    if (!updateResult.rows?.[0]) {
      throw creditError('The buyer account could not be updated while adding credits.', 503, 'PERSISTENCE_UNAVAILABLE');
    }

    const tx = { ...transaction, previousBalance, updatedBalance };
    const ledgerResult = await client.query(
      `INSERT INTO buyer_credit_transactions (
         id, buyer_id, rfq_id, transaction_type, credit_source,
         credits_added, credits_consumed, previous_balance, updated_balance,
         payment_reference, status, description, idempotency_key, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, now()))
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        tx.id,
        buyerId,
        tx.rfqId || null,
        tx.transactionType,
        tx.creditSource || 'Category Manager Console',
        amount,
        previousBalance,
        updatedBalance,
        tx.paymentReference || null,
        tx.status || 'COMPLETED',
        tx.description || null,
        tx.idempotencyKey,
        tx.createdAt || null,
      ]
    );
    if (!ledgerResult.rows?.[0]) {
      throw creditError('The buyer credit ledger rejected this idempotency key.', 409, 'CREDIT_IDEMPOTENCY_CONFLICT');
    }
    return {
      account,
      ...mapTransaction(tx, ledgerResult.rows[0]),
      replayed: false,
    };
  });

  invalidateCreditCaches();
  logger.info('PostgreSQL buyer credit addition committed', {
    buyerId,
    transactionId: result.transaction.id,
    durationMs: Date.now() - startedAt,
  }, 'BUYER_CREDIT');
  return result;
}

module.exports = { addBuyerCreditsInDB };

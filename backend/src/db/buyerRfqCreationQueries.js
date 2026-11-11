const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');
const { hasUnlimitedRfqAccess } = require('../config/constants');

const PAID_BUYER_PLANS = new Set(['version_1', 'version_2', 'version_3', 'unlimited']);
const V0_MODES = new Set(['mode_0', 'v0', 'version_0']);

function parseRaw(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      const parseError = new Error('Persisted buyer or RFQ record contains invalid JSON.');
      parseError.code = 'INVALID_PERSISTED_RECORD';
      parseError.cause = error;
      throw parseError;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function creditState(account, sourcingMode) {
  const plan = String(account.subscriptionPlan || 'free_trial').toLowerCase();
  const mode = String(sourcingMode || '').trim().toLowerCase();
  const unlimited = hasUnlimitedRfqAccess(account);
  const shouldCharge = !V0_MODES.has(mode) && !PAID_BUYER_PLANS.has(plan) && !unlimited;
  const rawRemaining = Number(account.remainingFreeRFQs !== undefined ? account.remainingFreeRFQs : 5);
  const remaining = Number.isFinite(rawRemaining) ? Math.max(0, rawRemaining) : 0;
  return { shouldCharge, remaining, plan, unlimited };
}

function transactionKey(buyerId, rfqId) {
  return `rfq-create-credit:${buyerId}:${rfqId}`;
}

function conflictError(message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = 'BUYER_RFQ_CREDIT_CONFLICT';
  return error;
}

function missingAccountError() {
  const error = new Error('The buyer account no longer exists in persistent storage.');
  error.statusCode = 404;
  error.code = 'BUYER_ACCOUNT_NOT_FOUND';
  return error;
}

function assertRfqOwnership(rfq, account, buyerId, matchingTransaction = false) {
  const record = parseRaw(rfq);
  const ownerId = record.buyerAccountId || record.buyerId || record.buyer_account_id;
  if (ownerId) {
    if (String(ownerId) === String(buyerId)) return;
    throw conflictError('This RFQ ID is already associated with another buyer.');
  }
  const rfqEmail = String(record.buyerEmail || record.sourceEmail || '').trim().toLowerCase();
  const accountEmail = String(account.corporateEmail || account.email || '').trim().toLowerCase();
  if (rfqEmail && accountEmail && rfqEmail === accountEmail) return;
  if (matchingTransaction) return;
  throw conflictError('This RFQ ID is already associated with another buyer or has no verifiable owner.');
}

function exhaustedResult(account, sourcingMode) {
  return {
    success: false,
    creditsExhausted: true,
    remaining: creditState(account, sourcingMode).remaining,
    account,
  };
}

function rfqParams(rfq) {
  const budget = Number(rfq.budget);
  return [
    rfq.id,
    rfq.rfqNumber || null,
    rfq.category || null,
    rfq.status || null,
    rfq.sourcingMode || null,
    Number.isFinite(budget) ? budget : null,
    JSON.stringify(rfq),
  ];
}

function successResult({ rfq, account, transaction, replayed = false, shouldCharge = false }) {
  return {
    success: true,
    rfq,
    account,
    replayed,
    credit: {
      consumed: Boolean(transaction),
      remaining: Number(account.remainingFreeRFQs !== undefined ? account.remainingFreeRFQs : 5),
      transaction: transaction || null,
    },
    shouldCharge,
  };
}

async function createRFQWithCreditInPostgres({ rfq, buyerId, transactionId, idempotencyKey }) {
  return pool.withTransaction(async (client) => {
    const accountResult = await client.query('SELECT raw FROM buyer_accounts WHERE id = $1 FOR UPDATE', [buyerId]);
    if (!accountResult.rows?.[0]) throw missingAccountError();
    const account = parseRaw(accountResult.rows[0].raw);

    const existingRFQResult = await client.query('SELECT raw FROM rfqs WHERE id = $1 LIMIT 1', [rfq.id]);
    const existingTransactionResult = await client.query(
      'SELECT * FROM buyer_credit_transactions WHERE idempotency_key = $1 LIMIT 1',
      [idempotencyKey]
    );
    const existingTransaction = existingTransactionResult.rows?.[0] || null;
    if (existingTransaction && (existingTransaction.buyer_id !== buyerId || existingTransaction.rfq_id !== rfq.id)) {
      throw conflictError('The buyer RFQ credit idempotency key belongs to a different record.');
    }
    if (existingRFQResult.rows?.[0]) {
      assertRfqOwnership(existingRFQResult.rows[0].raw, account, buyerId, Boolean(existingTransaction));
      if (existingTransaction) {
        return successResult({
          rfq: parseRaw(existingRFQResult.rows[0].raw),
          account,
          transaction: existingTransaction,
          replayed: true,
          shouldCharge: true,
        });
      }
      return successResult({ rfq: parseRaw(existingRFQResult.rows[0].raw), account, replayed: true });
    }
    if (existingTransaction) {
      const repairedRFQResult = await client.query(
        `INSERT INTO rfqs (id, rfq_number, category, status, sourcing_mode, budget, raw, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (id) DO NOTHING
         RETURNING raw`,
        rfqParams(rfq)
      );
      if (!repairedRFQResult.rows?.[0]) {
        throw conflictError('The RFQ credit transaction exists, but the RFQ could not be restored safely.');
      }
      return successResult({
        rfq: parseRaw(repairedRFQResult.rows[0].raw),
        account,
        transaction: existingTransaction,
        replayed: true,
        shouldCharge: true,
      });
    }

    const state = creditState(account, rfq.sourcingMode);
    if (state.shouldCharge && state.remaining <= 0) return exhaustedResult(account, rfq.sourcingMode);

    let savedAccount = account;
    let ledger = null;
    if (state.shouldCharge) {
      const nextBalance = state.remaining - 1;
      const updatedAccountResult = await client.query(
        `UPDATE buyer_accounts
         SET raw = jsonb_set(
           jsonb_set(raw, '{remainingFreeRFQs}', to_jsonb($2::integer), true),
           '{syncTimestamp}', to_jsonb($3::text), true
         ), updated_at = now()
         WHERE id = $1
         RETURNING raw`,
        [buyerId, nextBalance, new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC']
      );
      if (!updatedAccountResult.rows?.[0]) throw new Error('Buyer RFQ credit update returned no row.');
      savedAccount = parseRaw(updatedAccountResult.rows[0].raw);

      const ledgerResult = await client.query(
        `INSERT INTO buyer_credit_transactions (
           id, buyer_id, rfq_id, transaction_type, credit_source, credits_consumed,
           previous_balance, updated_balance, status, description, idempotency_key, created_at
         ) VALUES ($1, $2, $3, 'RFQ_CREATE', 'FREE_TRIAL', 1, $4, $5, 'COMPLETED', $6, $7, now())
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [
          transactionId,
          buyerId,
          rfq.id,
          state.remaining,
          nextBalance,
          `Free trial credit consumed for RFQ ${rfq.rfqNumber || rfq.id}`,
          idempotencyKey,
        ]
      );
      if (!ledgerResult.rows?.[0]) throw conflictError('The buyer RFQ credit ledger did not accept this idempotency key.');
      ledger = ledgerResult.rows[0];
    }

    const savedRFQResult = await client.query(
      `INSERT INTO rfqs (id, rfq_number, category, status, sourcing_mode, budget, raw, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (id) DO NOTHING
       RETURNING raw`,
      rfqParams(rfq)
    );
    if (!savedRFQResult.rows?.[0]) throw conflictError('This RFQ ID was concurrently created by another request. Retry to load the saved RFQ.');

    return successResult({
      rfq: parseRaw(savedRFQResult.rows[0].raw),
      account: savedAccount,
      transaction: ledger,
      shouldCharge: state.shouldCharge,
    });
  });
}

function d1ChargeExpression(sourcingModeParameter, rawExpression = 'raw') {
  return `(CASE
    WHEN lower(COALESCE($${sourcingModeParameter}, '')) IN ('mode_0', 'v0', 'version_0') THEN 0
    WHEN lower(COALESCE(json_extract(${rawExpression}, '$.subscriptionPlan'), 'free_trial')) IN ('version_1', 'version_2', 'version_3', 'unlimited') THEN 0
    WHEN COALESCE(json_extract(${rawExpression}, '$.unlimitedRfqAccess'), 0) = 1
      OR COALESCE(json_extract(${rawExpression}, '$.unlimitedAccess'), 0) = 1
      OR COALESCE(json_extract(${rawExpression}, '$.isUnlimited'), 0) = 1 THEN 0
    ELSE 1 END)`;
}

function makeD1Statements({ rfq, buyerId, transactionId, idempotencyKey }) {
  const params = [
    buyerId,
    rfq.id,
    rfq.rfqNumber || null,
    rfq.category || null,
    rfq.status || null,
    rfq.sourcingMode || null,
    Number.isFinite(Number(rfq.budget)) ? Number(rfq.budget) : null,
    JSON.stringify(rfq),
    transactionId,
    idempotencyKey,
    new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
  ];
  const charge = d1ChargeExpression(6);
  const buyerCharge = d1ChargeExpression(6, '(SELECT raw FROM buyer_accounts WHERE id = $1)');
  const remaining = `MAX(0, COALESCE(CAST(json_extract(raw, '$.remainingFreeRFQs') AS INTEGER), 5))`;
  return [
    { text: 'SELECT raw FROM buyer_accounts WHERE id = $1 LIMIT 1', params },
    { text: 'SELECT raw FROM rfqs WHERE id = $2 LIMIT 1', params },
    { text: 'SELECT * FROM buyer_credit_transactions WHERE idempotency_key = $10 LIMIT 1', params },
    {
      text: `UPDATE buyer_accounts
        SET raw = CASE WHEN ${charge} = 1
          THEN json_set(raw, '$.remainingFreeRFQs', ${remaining} - 1, '$.syncTimestamp', $11)
          ELSE raw END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
          AND NOT EXISTS (SELECT 1 FROM rfqs WHERE id = $2)
          AND NOT EXISTS (SELECT 1 FROM buyer_credit_transactions WHERE id = $9)
          AND NOT EXISTS (SELECT 1 FROM buyer_credit_transactions WHERE idempotency_key = $10)
          AND (${charge} = 0 OR ${remaining} > 0)
        RETURNING raw`, params,
    },
    {
      text: `INSERT INTO buyer_credit_transactions (
          id, buyer_id, rfq_id, transaction_type, credit_source, credits_consumed,
          previous_balance, updated_balance, status, description, idempotency_key, created_at
        )
        SELECT $9, $1, $2, 'RFQ_CREATE', 'FREE_TRIAL', 1,
          MAX(0, COALESCE(CAST(json_extract(raw, '$.remainingFreeRFQs') AS INTEGER), 5)) + 1,
          CAST(json_extract(raw, '$.remainingFreeRFQs') AS INTEGER),
          'COMPLETED', 'Free trial credit consumed for RFQ ' || COALESCE($3, $2), $10, CURRENT_TIMESTAMP
        FROM buyer_accounts
        WHERE id = $1 AND changes() > 0 AND ${charge} = 1
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING *`, params,
    },
    {
      text: `INSERT INTO rfqs (id, rfq_number, category, status, sourcing_mode, budget, raw, updated_at)
        SELECT $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP
        WHERE EXISTS (SELECT 1 FROM buyer_accounts WHERE id = $1)
          AND NOT EXISTS (SELECT 1 FROM rfqs WHERE id = $2)
          AND (${buyerCharge} = 0 OR EXISTS (
            SELECT 1 FROM buyer_credit_transactions
            WHERE idempotency_key = $10 AND buyer_id = $1 AND rfq_id = $2
          ))
        ON CONFLICT (id) DO NOTHING
        RETURNING raw`, params,
    },
    { text: 'SELECT raw FROM buyer_accounts WHERE id = $1 LIMIT 1', params },
    { text: 'SELECT raw FROM rfqs WHERE id = $2 LIMIT 1', params },
    { text: 'SELECT * FROM buyer_credit_transactions WHERE idempotency_key = $10 LIMIT 1', params },
  ];
}

async function createRFQWithCreditInD1(options, binding) {
  const statements = makeD1Statements(options);
  const startedAt = Date.now();
  const results = await d1Bridge.batchD1(binding, statements);
  const durationMs = Date.now() - startedAt;
  pool.queryAuditor.auditQuery(statements.map(({ text }) => text).join('; '), [], durationMs, false);
  logger.info('Atomic D1 buyer RFQ create batch completed', {
    buyerId: options.buyerId,
    rfqId: options.rfq.id,
    statementCount: statements.length,
    durationMs,
  }, 'BUYER_RFQ_CREDIT');

  const accountRow = results[0]?.rows?.[0];
  if (!accountRow) throw missingAccountError();
  const existingRFQ = results[1]?.rows?.[0];
  const existingLedger = results[2]?.rows?.[0];
  if (existingLedger && (existingLedger.buyer_id !== options.buyerId || existingLedger.rfq_id !== options.rfq.id)) {
    throw conflictError('The buyer RFQ credit idempotency key belongs to a different record.');
  }
  if (existingRFQ) {
    assertRfqOwnership(existingRFQ.raw, parseRaw(accountRow.raw), options.buyerId, Boolean(existingLedger));
    return successResult({
      rfq: parseRaw(existingRFQ.raw),
      account: parseRaw(accountRow.raw),
      transaction: existingLedger,
      replayed: true,
      shouldCharge: Boolean(existingLedger),
    });
  }

  const account = parseRaw(results[6]?.rows?.[0]?.raw || accountRow.raw);
  const rfqRow = results[7]?.rows?.[0] || results[5]?.rows?.[0];
  const ledger = results[8]?.rows?.[0] || null;
  if (!rfqRow) {
    const state = creditState(account, options.rfq.sourcingMode);
    if (state.shouldCharge && state.remaining <= 0) return exhaustedResult(account, options.rfq.sourcingMode);
    throw new Error('RFQ and buyer credit changes did not produce a durable row.');
  }
  if (creditState(parseRaw(accountRow.raw), options.rfq.sourcingMode).shouldCharge && !ledger) {
    throw conflictError('The buyer RFQ credit ledger did not accept this idempotency key.');
  }
  return successResult({
    rfq: parseRaw(rfqRow.raw),
    account,
    transaction: ledger,
    shouldCharge: creditState(parseRaw(accountRow.raw), options.rfq.sourcingMode).shouldCharge,
  });
}

async function createRFQWithCreditInDB(options) {
  if (!pool.hasStorage()) return null;
  if (!options || !options.rfq?.id || !options.buyerId) {
    const error = new Error('A durable buyer RFQ create requires both RFQ and buyer IDs.');
    error.statusCode = 400;
    error.code = 'INVALID_BUYER_RFQ_CREATE';
    throw error;
  }
  const idempotencyKey = transactionKey(options.buyerId, options.rfq.id);
  const transactionId = options.transactionId || `credit-${require('crypto').randomUUID()}`;
  const normalized = { ...options, idempotencyKey, transactionId };
  const binding = d1Bridge.getD1Binding();
  if (binding) {
    try {
      const result = await createRFQWithCreditInD1(normalized, binding);
      queryCache.invalidate('buyer_accounts');
      queryCache.invalidate('buyer_credits');
      queryCache.invalidate('rfqs');
      return result;
    } catch (error) {
      logger.error('Atomic D1 buyer RFQ create failed', {
        error,
        buyerId: normalized.buyerId,
        rfqId: normalized.rfq.id,
      }, 'BUYER_RFQ_CREDIT');
      throw error;
    }
  }
  if (d1Bridge.getD1HttpClient()) {
    const error = new Error('Buyer RFQ credit consumption requires PostgreSQL transactions or a Workers D1 atomic batch.');
    error.statusCode = 503;
    error.code = 'ATOMIC_PERSISTENCE_REQUIRED';
    logger.error('Buyer RFQ create rejected by the non-atomic D1 HTTP adapter', {
      error,
      buyerId: normalized.buyerId,
      rfqId: normalized.rfq.id,
    }, 'BUYER_RFQ_CREDIT');
    throw error;
  }

  const startedAt = Date.now();
  try {
    const result = await createRFQWithCreditInPostgres(normalized);
    const durationMs = Date.now() - startedAt;
    pool.queryAuditor.auditQuery(
      'SELECT raw FROM buyer_accounts FOR UPDATE; UPDATE buyer_accounts; INSERT INTO buyer_credit_transactions; INSERT INTO rfqs',
      [],
      durationMs,
      false
    );
    logger.info('PostgreSQL buyer RFQ create transaction completed', {
      buyerId: normalized.buyerId,
      rfqId: normalized.rfq.id,
      durationMs,
    }, 'BUYER_RFQ_CREDIT');
    queryCache.invalidate('buyer_accounts');
    queryCache.invalidate('buyer_credits');
    queryCache.invalidate('rfqs');
    return result;
  } catch (error) {
    logger.error('Atomic PostgreSQL buyer RFQ create failed', {
      error,
      buyerId: normalized.buyerId,
      rfqId: normalized.rfq.id,
      durationMs: Date.now() - startedAt,
    }, 'BUYER_RFQ_CREDIT');
    throw error;
  }
}

module.exports = {
  createRFQWithCreditInDB,
  makeD1Statements,
  creditState,
  transactionKey,
  parseRaw,
  assertRfqOwnership,
  successResult,
};

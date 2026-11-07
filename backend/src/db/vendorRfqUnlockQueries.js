const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');
const { VENDOR_FREE_CREDITS_LIMIT, VENDOR_PLAN_RFQ_QUOTA, hasUnlimitedDownloadAccess } = require('../config/constants');

function parseVendorRaw(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      const parseError = new Error('Persisted vendor profile contains invalid JSON.');
      parseError.code = 'INVALID_VENDOR_RECORD';
      parseError.cause = error;
      throw parseError;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function vendorCreditState(vendor) {
  const unlimited = hasUnlimitedDownloadAccess(vendor);
  const plan = String(vendor.subscriptionPlan || '').toLowerCase();
  const subscribed = Boolean(
    plan === 'connect' ||
    plan === 'select' ||
    vendor.isSubscribed === true ||
    String(vendor.subscriptionStatus || '').toLowerCase() === 'active' ||
    unlimited
  );
  const currentCredits = Number(
    vendor.freeQuotationCredits !== undefined
      ? vendor.freeQuotationCredits
      : (vendor.freeRfqDownloadCredits !== undefined ? vendor.freeRfqDownloadCredits : VENDOR_FREE_CREDITS_LIMIT)
  );
  const safeCurrentCredits = Number.isFinite(currentCredits) ? Math.max(0, currentCredits) : 0;
  const allocated = Number(vendor.freeCreditsAllocated !== undefined ? vendor.freeCreditsAllocated : VENDOR_FREE_CREDITS_LIMIT);
  const downloadsUsed = Math.max(0, Number(vendor.rfqDownloadsUsed) || 0);
  const planQuota = unlimited ? undefined : VENDOR_PLAN_RFQ_QUOTA[plan];
  const remaining = unlimited
    ? 999999
    : (planQuota !== undefined ? Math.max(0, planQuota - downloadsUsed) : safeCurrentCredits);

  return {
    unlimited,
    subscribed,
    shouldCharge: !subscribed,
    source: unlimited ? 'unlimited_entitlement' : (subscribed ? 'subscription' : 'free_credit'),
    currentCredits: safeCurrentCredits,
    allocated: Number.isFinite(allocated) ? Math.max(0, allocated) : VENDOR_FREE_CREDITS_LIMIT,
    downloadsUsed,
    remaining,
  };
}

function includesRfq(vendor, rfqId, rfqNumber) {
  const ids = Array.isArray(vendor.unlockedRfqIds) ? vendor.unlockedRfqIds.map((id) => String(id).toLowerCase()) : [];
  return ids.includes(String(rfqId).toLowerCase()) || (rfqNumber && ids.includes(String(rfqNumber).toLowerCase()));
}

function buildUpdatedVendor(vendor, { rfqId, rfqNumber, creditCharged }) {
  const state = vendorCreditState(vendor);
  const unlockedRfqIds = Array.isArray(vendor.unlockedRfqIds) ? [...vendor.unlockedRfqIds] : [];
  if (!unlockedRfqIds.some((id) => String(id).toLowerCase() === String(rfqId).toLowerCase())) unlockedRfqIds.push(String(rfqId));
  if (rfqNumber && !unlockedRfqIds.some((id) => String(id).toLowerCase() === String(rfqNumber).toLowerCase())) unlockedRfqIds.push(String(rfqNumber));

  const downloadsUsed = state.downloadsUsed + 1;
  const updatedVendor = {
    ...vendor,
    unlockedRfqIds,
    rfqDownloadsUsed: downloadsUsed,
  };
  if (creditCharged) {
    const nextBalance = Math.max(0, state.currentCredits - 1);
    updatedVendor.freeQuotationCredits = nextBalance;
    updatedVendor.freeRfqDownloadCredits = nextBalance;
    updatedVendor.freeCreditsUsed = Math.max(0, Number(vendor.freeCreditsUsed) || (state.allocated - state.currentCredits)) + 1;
  }
  return { vendor: updatedVendor, state: vendorCreditState(updatedVendor) };
}

function makeResult({ vendor, unlock, transaction, alreadyUnlocked = false, creditCharged = 0 }) {
  const state = vendorCreditState(vendor);
  return {
    success: true,
    alreadyUnlocked,
    unlocked: true,
    vendor,
    unlock: unlock || null,
    transaction: transaction || null,
    creditCharged,
    freeCreditsRemaining: transaction ? Number(transaction.balance_after ?? transaction.balanceAfter) : state.remaining,
    source: unlock?.source || state.source,
  };
}

function exhaustedResult(vendor) {
  return {
    success: false,
    creditsExhausted: true,
    freeCreditsRemaining: vendorCreditState(vendor).remaining,
  };
}

async function unlockVendorRfqInPostgres(options) {
  const {
    vendorId, rfqId, rfqNumber, unlockId, transactionId, idempotencyKey,
  } = options;

  return pool.withTransaction(async (client) => {
    const vendorResult = await client.query('SELECT raw FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    if (!vendorResult.rows?.[0]) return null;
    const vendor = parseVendorRaw(vendorResult.rows[0].raw);

    const unlockResult = await client.query(
      'SELECT * FROM rfq_unlocks WHERE vendor_id = $1 AND rfq_id = $2 LIMIT 1',
      [vendorId, rfqId]
    );
    if (unlockResult.rows?.[0] || includesRfq(vendor, rfqId, rfqNumber)) {
      return makeResult({ vendor, unlock: unlockResult.rows?.[0], alreadyUnlocked: true });
    }

    const existingLedger = await client.query(
      'SELECT * FROM vendor_credit_transactions WHERE idempotency_key = $1 LIMIT 1',
      [idempotencyKey]
    );
    if (existingLedger.rows?.[0]) {
      const error = new Error('A vendor credit ledger entry exists without its RFQ unlock. Reconciliation is required.');
      error.statusCode = 409;
      error.code = 'VENDOR_CREDIT_STATE_INCONSISTENT';
      throw error;
    }

    const state = vendorCreditState(vendor);
    if (state.shouldCharge && state.currentCredits <= 0) return exhaustedResult(vendor);

    const creditCharged = state.shouldCharge ? 1 : 0;
    const { vendor: updatedVendor } = buildUpdatedVendor(vendor, { rfqId, rfqNumber, creditCharged });
    const savedVendorResult = await client.query(
      'UPDATE vendors SET raw = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING raw',
      [vendorId, JSON.stringify(updatedVendor)]
    );
    if (!savedVendorResult.rows?.[0]) {
      throw new Error('Vendor balance update returned no persisted row.');
    }
    const persistedVendor = parseVendorRaw(savedVendorResult.rows[0].raw);

    const savedUnlockResult = await client.query(
      `INSERT INTO rfq_unlocks (id, vendor_id, rfq_id, credit_charged, source, unlocked_at, created_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (vendor_id, rfq_id) DO NOTHING
       RETURNING *`,
      [unlockId, vendorId, rfqId, creditCharged, state.source]
    );
    if (!savedUnlockResult.rows?.[0]) {
      throw new Error('Vendor RFQ unlock was not recorded after the balance update.');
    }

    let transaction = null;
    if (creditCharged) {
      const ledgerResult = await client.query(
        `INSERT INTO vendor_credit_transactions (id, vendor_id, rfq_id, transaction_type, amount, balance_after, idempotency_key, created_at)
         VALUES ($1, $2, $3, 'RFQ_UNLOCK', -1, $4, $5, now())
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [transactionId, vendorId, rfqId, persistedVendor.freeQuotationCredits, idempotencyKey]
      );
      if (!ledgerResult.rows?.[0]) {
        throw new Error('Vendor credit ledger was not recorded after the balance update.');
      }
      transaction = ledgerResult.rows[0];
    }

    return makeResult({
      vendor: persistedVendor,
      unlock: savedUnlockResult.rows[0],
      transaction,
      creditCharged,
    });
  });
}

const D1_UNLIMITED = `(
  COALESCE(json_extract(raw, '$.unlimitedRfqDownloads'), 0) = 1 OR
  COALESCE(json_extract(raw, '$.unlimitedDownloads'), 0) = 1 OR
  COALESCE(json_extract(raw, '$.unlimitedAccess'), 0) = 1 OR
  COALESCE(json_extract(raw, '$.isUnlimited'), 0) = 1
)`;
const D1_SUBSCRIBED = `(
  lower(COALESCE(json_extract(raw, '$.subscriptionPlan'), '')) IN ('connect', 'select') OR
  COALESCE(json_extract(raw, '$.isSubscribed'), 0) = 1 OR
  lower(COALESCE(json_extract(raw, '$.subscriptionStatus'), '')) = 'active' OR
  ${D1_UNLIMITED}
)`;
const D1_BALANCE = `MAX(0, COALESCE(
  CAST(json_extract(raw, '$.freeQuotationCredits') AS INTEGER),
  CAST(json_extract(raw, '$.freeRfqDownloadCredits') AS INTEGER),
  ${VENDOR_FREE_CREDITS_LIMIT}
))`;
const D1_CHARGE = `(CASE WHEN ${D1_SUBSCRIBED} THEN 0 ELSE 1 END)`;
const D1_SOURCE = `(CASE WHEN ${D1_UNLIMITED} THEN 'unlimited_entitlement' WHEN ${D1_SUBSCRIBED} THEN 'subscription' ELSE 'free_credit' END)`;

function makeD1UnlockStatements(options) {
  const { vendorId, rfqId, rfqNumber, unlockId, transactionId, idempotencyKey } = options;
  const params = [vendorId, rfqId, rfqNumber || null, unlockId, transactionId, idempotencyKey];
  return {
    params,
    statements: [
      { text: 'SELECT raw FROM vendors WHERE id = $1 LIMIT 1', params },
      { text: 'SELECT * FROM rfq_unlocks WHERE vendor_id = $1 AND rfq_id = $2 LIMIT 1', params },
      { text: 'SELECT * FROM vendor_credit_transactions WHERE idempotency_key = $6 LIMIT 1', params },
      {
        text: `UPDATE vendors SET raw = json_set(
            raw,
            '$.freeQuotationCredits', CASE WHEN ${D1_CHARGE} = 1 THEN ${D1_BALANCE} - 1 ELSE ${D1_BALANCE} END,
            '$.freeRfqDownloadCredits', CASE WHEN ${D1_CHARGE} = 1 THEN ${D1_BALANCE} - 1 ELSE ${D1_BALANCE} END,
            '$.freeCreditsUsed', CASE WHEN ${D1_CHARGE} = 1 THEN
              COALESCE(CAST(json_extract(raw, '$.freeCreditsUsed') AS INTEGER), MAX(0, ${VENDOR_FREE_CREDITS_LIMIT} - ${D1_BALANCE})) + 1
              ELSE COALESCE(CAST(json_extract(raw, '$.freeCreditsUsed') AS INTEGER), 0) END,
            '$.rfqDownloadsUsed', COALESCE(CAST(json_extract(raw, '$.rfqDownloadsUsed') AS INTEGER), 0) + 1,
            '$.unlockedRfqIds', json(CASE
              WHEN json_type(raw, '$.unlockedRfqIds') = 'array' THEN (
                SELECT json_group_array(value) FROM (
                  SELECT value FROM json_each(json_extract(vendors.raw, '$.unlockedRfqIds'))
                  UNION SELECT $2
                  UNION SELECT $3 WHERE $3 IS NOT NULL
                )
              )
              WHEN $3 IS NULL THEN json_array($2)
              ELSE json_array($2, $3)
            END)
          ), updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
            AND NOT EXISTS (SELECT 1 FROM rfq_unlocks WHERE vendor_id = $1 AND rfq_id = $2)
            AND NOT EXISTS (SELECT 1 FROM vendor_credit_transactions WHERE idempotency_key = $6)
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(CASE
                WHEN json_type(raw, '$.unlockedRfqIds') = 'array' THEN json_extract(raw, '$.unlockedRfqIds')
                ELSE '[]'
              END) unlocked
              WHERE lower(CAST(unlocked.value AS TEXT)) = lower($2)
                 OR ($3 IS NOT NULL AND lower(CAST(unlocked.value AS TEXT)) = lower($3))
            )
            AND (${D1_CHARGE} = 0 OR ${D1_BALANCE} > 0)
          RETURNING raw`, params,
      },
      {
        text: `INSERT INTO rfq_unlocks (id, vendor_id, rfq_id, credit_charged, source, unlocked_at, created_at)
          SELECT $4, $1, $2, ${D1_CHARGE}, ${D1_SOURCE}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM vendors
          WHERE id = $1
            AND changes() > 0
          ON CONFLICT (vendor_id, rfq_id) DO NOTHING
          RETURNING *`, params,
      },
      {
        text: `INSERT INTO vendor_credit_transactions (id, vendor_id, rfq_id, transaction_type, amount, balance_after, idempotency_key, created_at)
          SELECT $5, $1, $2, 'RFQ_UNLOCK', -1, CAST(json_extract(raw, '$.freeQuotationCredits') AS INTEGER), $6, CURRENT_TIMESTAMP
          FROM vendors
          WHERE id = $1 AND changes() > 0 AND ${D1_SOURCE} = 'free_credit'
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING *`, params,
      },
      { text: 'SELECT raw FROM vendors WHERE id = $1 LIMIT 1', params },
      { text: 'SELECT * FROM rfq_unlocks WHERE vendor_id = $1 AND rfq_id = $2 LIMIT 1', params },
      { text: 'SELECT * FROM vendor_credit_transactions WHERE idempotency_key = $6 LIMIT 1', params },
    ],
  };
}

async function unlockVendorRfqInD1(options, binding) {
  const { statements } = makeD1UnlockStatements(options);
  const startedAt = Date.now();
  const results = await d1Bridge.batchD1(binding, statements);
  const durationMs = Date.now() - startedAt;
  pool.queryAuditor.auditQuery(statements.map(({ text }) => text).join('; '), [], durationMs, false);
  logger.info('Atomic D1 vendor RFQ unlock batch completed', {
    operation: 'unlockVendorRfq',
    vendorId: options.vendorId,
    rfqId: options.rfqId,
    statementCount: statements.length,
    durationMs,
  }, 'VENDOR_CREDIT_UNLOCK');

  const initialVendorRow = results[0]?.rows?.[0];
  if (!initialVendorRow) return null;
  const initialVendor = parseVendorRaw(initialVendorRow.raw);
  const existingUnlock = results[1]?.rows?.[0];
  if (existingUnlock || includesRfq(initialVendor, options.rfqId, options.rfqNumber)) {
    return makeResult({ vendor: initialVendor, unlock: existingUnlock, alreadyUnlocked: true });
  }
  if (results[2]?.rows?.[0]) {
    const error = new Error('A vendor credit ledger entry exists without its RFQ unlock. Reconciliation is required.');
    error.statusCode = 409;
    error.code = 'VENDOR_CREDIT_STATE_INCONSISTENT';
    throw error;
  }

  const updatedRow = results[3]?.rows?.[0];
  const unlock = results[4]?.rows?.[0];
  const finalVendorRow = results[6]?.rows?.[0];
  if (!updatedRow) {
    return exhaustedResult(finalVendorRow ? parseVendorRaw(finalVendorRow.raw) : initialVendor);
  }
  if (!unlock) throw new Error('D1 vendor RFQ unlock was not recorded after the balance update.');

  const vendor = parseVendorRaw(finalVendorRow?.raw || updatedRow.raw);
  const ledger = results[8]?.rows?.[0] || results[5]?.rows?.[0] || null;
  const creditCharged = Number(unlock.credit_charged) || 0;
  if (creditCharged && !ledger) throw new Error('D1 vendor credit ledger was not recorded after the balance update.');
  return makeResult({ vendor, unlock, transaction: ledger, creditCharged });
}

async function unlockVendorRfqInDB(options) {
  if (!pool.hasStorage()) return null;
  const required = ['vendorId', 'rfqId', 'unlockId', 'transactionId', 'idempotencyKey'];
  if (!options || required.some((key) => !options[key])) {
    const error = new Error('Vendor RFQ unlock requires vendor, RFQ, and idempotency identifiers.');
    error.statusCode = 400;
    error.code = 'INVALID_VENDOR_RFQ_UNLOCK';
    throw error;
  }

  const binding = d1Bridge.getD1Binding();
  if (binding) {
    try {
      const result = await unlockVendorRfqInD1(options, binding);
      queryCache.invalidate('vendor_credits');
      queryCache.invalidate('vendors');
      return result;
    } catch (error) {
      logger.error('Atomic D1 vendor RFQ unlock failed', {
        error,
        operation: 'unlockVendorRfq',
        vendorId: options.vendorId,
        rfqId: options.rfqId,
      }, 'VENDOR_CREDIT_UNLOCK');
      throw error;
    }
  }

  if (d1Bridge.getD1HttpClient()) {
    const error = new Error('Vendor RFQ unlocks require PostgreSQL transactions or a Workers D1 atomic batch.');
    error.statusCode = 503;
    error.code = 'ATOMIC_PERSISTENCE_REQUIRED';
    logger.error('Vendor RFQ unlock rejected by the non-atomic D1 HTTP adapter', {
      error,
      operation: 'unlockVendorRfq',
      vendorId: options.vendorId,
      rfqId: options.rfqId,
    }, 'VENDOR_CREDIT_UNLOCK');
    throw error;
  }

  try {
    const startedAt = Date.now();
    const result = await unlockVendorRfqInPostgres(options);
    const durationMs = Date.now() - startedAt;
    pool.queryAuditor.auditQuery(
      'SELECT raw FROM vendors FOR UPDATE; UPDATE vendors; INSERT INTO rfq_unlocks; INSERT INTO vendor_credit_transactions',
      [],
      durationMs,
      false
    );
    queryCache.invalidate('vendor_credits');
    queryCache.invalidate('vendors');
    logger.info('PostgreSQL vendor RFQ unlock transaction completed', {
      operation: 'unlockVendorRfq',
      vendorId: options.vendorId,
      rfqId: options.rfqId,
      durationMs,
    }, 'VENDOR_CREDIT_UNLOCK');
    return result;
  } catch (error) {
    logger.error('Atomic PostgreSQL vendor RFQ unlock failed', {
      error,
      operation: 'unlockVendorRfq',
      vendorId: options.vendorId,
      rfqId: options.rfqId,
    }, 'VENDOR_CREDIT_UNLOCK');
    throw error;
  }
}

module.exports = {
  unlockVendorRfqInDB,
  vendorCreditState,
  makeD1UnlockStatements,
  parseVendorRaw,
};

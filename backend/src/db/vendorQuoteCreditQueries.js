const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');
const { VENDOR_FREE_CREDITS_LIMIT, hasUnlimitedQuoteAccess } = require('../config/constants');

function parseVendorRaw(raw) {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      const parseError = new Error('Persisted vendor profile contains invalid JSON.');
      parseError.code = 'INVALID_VENDOR_RECORD';
      parseError.cause = error;
      throw parseError;
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function quoteCreditState(vendor, isBuyerMapped, isResubmission = false) {
  const current = Number(vendor.freeQuotationCredits ?? vendor.freeRfqDownloadCredits ?? VENDOR_FREE_CREDITS_LIMIT);
  const balance = Number.isFinite(current) ? Math.max(0, current) : 0;
  const subscribed = Boolean(
    vendor.subscriptionPlan === 'connect' ||
    vendor.subscriptionPlan === 'select' ||
    vendor.isSubscribed === true ||
    vendor.subscriptionStatus === 'active' ||
    hasUnlimitedQuoteAccess(vendor)
  );
  return { balance, shouldCharge: !subscribed && !isBuyerMapped && !isResubmission };
}

function includesId(values, id) {
  return Array.isArray(values) && values.some((value) => String(value) === String(id));
}

function buildQuotedVendor(vendor, { rfqId, rfqNumber, charged }) {
  const quotedRfqIds = Array.isArray(vendor.quotedRfqIds) ? [...vendor.quotedRfqIds] : [];
  if (!includesId(quotedRfqIds, rfqId)) quotedRfqIds.push(String(rfqId));
  const unlockedRfqIds = Array.isArray(vendor.unlockedRfqIds) ? [...vendor.unlockedRfqIds] : [];
  if (!includesId(unlockedRfqIds, rfqId)) unlockedRfqIds.push(String(rfqId));
  if (rfqNumber && !includesId(unlockedRfqIds, rfqNumber)) unlockedRfqIds.push(String(rfqNumber));
  const nextBalance = Math.max(0, quoteCreditState(vendor, false).balance - (charged ? 1 : 0));
  return {
    ...vendor,
    freeQuotationCredits: nextBalance,
    freeRfqDownloadCredits: nextBalance,
    quotedRfqIds,
    unlockedRfqIds,
  };
}

async function recordVendorQuoteCreditInPostgres(options) {
  const { vendorId, rfqId, rfqNumber, transactionId, idempotencyKey, isBuyerMapped } = options;
  return pool.withTransaction(async (client) => {
    const vendorResult = await client.query('SELECT raw FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    if (!vendorResult.rows?.[0]) return null;
    const vendor = parseVendorRaw(vendorResult.rows[0].raw);
    const existingLedger = await client.query(
      'SELECT * FROM vendor_credit_transactions WHERE idempotency_key = $1 LIMIT 1',
      [idempotencyKey]
    );
    if (existingLedger.rows?.[0] || includesId(vendor.quotedRfqIds, rfqId)) {
      return { vendor, alreadyQuoted: true, creditCharged: 0 };
    }

    const state = quoteCreditState(vendor, isBuyerMapped, options.isResubmission);
    if (state.shouldCharge && state.balance <= 0) {
      return { vendor, creditsExhausted: true, freeCreditsRemaining: state.balance };
    }
    const creditCharged = state.shouldCharge ? 1 : 0;
    const updatedVendor = buildQuotedVendor(vendor, { rfqId, rfqNumber, charged: creditCharged });
    const savedVendorResult = await client.query(
      'UPDATE vendors SET raw = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING raw',
      [vendorId, JSON.stringify(updatedVendor)]
    );
    if (!savedVendorResult.rows?.[0]) throw new Error('Vendor quote credit update returned no persisted row.');
    const savedVendor = parseVendorRaw(savedVendorResult.rows[0].raw);
    const ledgerResult = await client.query(
      `INSERT INTO vendor_credit_transactions
        (id, vendor_id, rfq_id, transaction_type, amount, balance_after, idempotency_key, created_at)
       VALUES ($1, $2, $3, 'RFQ_QUOTE', $4, $5, $6, now())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [transactionId, vendorId, rfqId, -creditCharged, savedVendor.freeQuotationCredits, idempotencyKey]
    );
    if (!ledgerResult.rows?.[0]) throw new Error('Vendor quote credit ledger was not recorded with the balance update.');
    return { vendor: savedVendor, transaction: ledgerResult.rows[0], alreadyQuoted: false, creditCharged };
  });
}

const D1_UNLIMITED_QUOTES = `(
  COALESCE(json_extract(raw, '$.unlimitedQuoteSubmissions'), 0) = 1 OR
  COALESCE(json_extract(raw, '$.unlimitedQuotes'), 0) = 1 OR
  COALESCE(json_extract(raw, '$.unlimitedAccess'), 0) = 1 OR
  COALESCE(json_extract(raw, '$.isUnlimited'), 0) = 1
)`;
const D1_SUBSCRIBED = `(
  lower(COALESCE(json_extract(raw, '$.subscriptionPlan'), '')) IN ('connect', 'select') OR
  COALESCE(json_extract(raw, '$.isSubscribed'), 0) = 1 OR
  lower(COALESCE(json_extract(raw, '$.subscriptionStatus'), '')) = 'active' OR
  ${D1_UNLIMITED_QUOTES}
)`;
const D1_BALANCE = `MAX(0, CAST(COALESCE(
  json_extract(raw, '$.freeQuotationCredits'),
  json_extract(raw, '$.freeRfqDownloadCredits'),
  ${VENDOR_FREE_CREDITS_LIMIT}
) AS INTEGER))`;
const D1_CHARGE = `(CASE WHEN $6 = 1 OR $7 = 1 OR ${D1_SUBSCRIBED} THEN 0 ELSE 1 END)`;

function makeD1VendorQuoteCreditStatements(options) {
  const { vendorId, rfqId, rfqNumber, transactionId, idempotencyKey, isBuyerMapped } = options;
  const params = [vendorId, rfqId, rfqNumber || null, transactionId, idempotencyKey, isBuyerMapped ? 1 : 0, options.isResubmission ? 1 : 0];
  return {
    params,
    statements: [
      { text: 'SELECT raw FROM vendors WHERE id = $1 LIMIT 1', params },
      { text: 'SELECT * FROM vendor_credit_transactions WHERE idempotency_key = $5 LIMIT 1', params },
      {
        text: `UPDATE vendors SET raw = json_set(
          raw,
          '$.freeQuotationCredits', CASE WHEN ${D1_CHARGE} = 1 THEN ${D1_BALANCE} - 1 ELSE ${D1_BALANCE} END,
          '$.freeRfqDownloadCredits', CASE WHEN ${D1_CHARGE} = 1 THEN ${D1_BALANCE} - 1 ELSE ${D1_BALANCE} END,
          '$.quotedRfqIds', json(CASE
            WHEN json_type(raw, '$.quotedRfqIds') = 'array' THEN (
              SELECT json_group_array(value) FROM (
                SELECT value FROM json_each(json_extract(vendors.raw, '$.quotedRfqIds'))
                UNION SELECT $2
              )
            )
            ELSE json_array($2)
          END),
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
          AND NOT EXISTS (SELECT 1 FROM vendor_credit_transactions WHERE idempotency_key = $5)
          AND NOT EXISTS (
            SELECT 1 FROM json_each(CASE
              WHEN json_type(raw, '$.quotedRfqIds') = 'array' THEN json_extract(raw, '$.quotedRfqIds')
              ELSE '[]'
            END) quoted
            WHERE CAST(quoted.value AS TEXT) = CAST($2 AS TEXT)
          )
          AND (${D1_CHARGE} = 0 OR ${D1_BALANCE} > 0)
        RETURNING raw`, params,
      },
      {
        text: `INSERT INTO vendor_credit_transactions
          (id, vendor_id, rfq_id, transaction_type, amount, balance_after, idempotency_key, created_at)
         SELECT $4, $1, $2, 'RFQ_QUOTE',
           CASE WHEN ${D1_CHARGE} = 1 THEN -1 ELSE 0 END,
           CAST(json_extract(raw, '$.freeQuotationCredits') AS INTEGER), $5, CURRENT_TIMESTAMP
         FROM vendors WHERE id = $1 AND changes() > 0
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`, params,
      },
      { text: 'SELECT raw FROM vendors WHERE id = $1 LIMIT 1', params },
      { text: 'SELECT * FROM vendor_credit_transactions WHERE idempotency_key = $5 LIMIT 1', params },
    ],
  };
}

async function recordVendorQuoteCreditInD1(options, binding) {
  const { statements } = makeD1VendorQuoteCreditStatements(options);
  const startedAt = Date.now();
  const results = await d1Bridge.batchD1(binding, statements);
  const durationMs = Date.now() - startedAt;
  pool.queryAuditor.auditQuery('SELECT vendor quote credit state; UPDATE vendors; INSERT vendor_credit_transactions', [], durationMs, false);

  const initialVendorRow = results[0]?.rows?.[0];
  if (!initialVendorRow) return null;
  const initialVendor = parseVendorRaw(initialVendorRow.raw);
  if (results[1]?.rows?.[0] || includesId(initialVendor.quotedRfqIds, options.rfqId)) {
    return { vendor: initialVendor, alreadyQuoted: true, creditCharged: 0 };
  }
  const savedRow = results[2]?.rows?.[0];
  const finalVendor = parseVendorRaw(results[4]?.rows?.[0]?.raw || savedRow?.raw || initialVendor);
  if (!savedRow) {
    const state = quoteCreditState(finalVendor, options.isBuyerMapped, options.isResubmission);
    if (state.shouldCharge && state.balance <= 0) {
      return { vendor: finalVendor, creditsExhausted: true, freeCreditsRemaining: state.balance };
    }
    if (results[5]?.rows?.[0] || includesId(finalVendor.quotedRfqIds, options.rfqId)) {
      return { vendor: finalVendor, alreadyQuoted: true, creditCharged: 0 };
    }
    throw new Error('D1 vendor quote credit update did not return a persisted row.');
  }
  const transaction = results[3]?.rows?.[0] || results[5]?.rows?.[0];
  if (!transaction) throw new Error('D1 vendor quote credit ledger was not recorded with the balance update.');
  return { vendor: finalVendor, transaction, alreadyQuoted: false, creditCharged: Number(transaction.amount) < 0 ? 1 : 0 };
}

async function recordVendorQuoteCreditInDB(options) {
  if (!pool.hasStorage()) return null;
  const required = ['vendorId', 'rfqId', 'transactionId', 'idempotencyKey'];
  if (!options || required.some((key) => !options[key])) {
    const error = new Error('Vendor quote credit requires vendor, RFQ, and idempotency identifiers.');
    error.statusCode = 400;
    error.code = 'INVALID_VENDOR_QUOTE_CREDIT';
    throw error;
  }
  const binding = d1Bridge.getD1Binding();
  if (binding) {
    try {
      const result = await recordVendorQuoteCreditInD1(options, binding);
      queryCache.invalidate('vendor_credits');
      queryCache.invalidate('vendors');
      return result;
    } catch (error) {
      logger.error('Atomic D1 vendor quotation credit update failed', { error, vendorId: options.vendorId, rfqId: options.rfqId }, 'VENDOR_QUOTE_CREDIT');
      throw error;
    }
  }
  if (d1Bridge.getD1HttpClient()) {
    const error = new Error('Vendor quotation credits require PostgreSQL transactions or a Workers D1 atomic batch.');
    error.statusCode = 503;
    error.code = 'ATOMIC_PERSISTENCE_REQUIRED';
    logger.error('Vendor quote credit update rejected by the non-atomic D1 HTTP adapter', { error, vendorId: options.vendorId, rfqId: options.rfqId }, 'VENDOR_QUOTE_CREDIT');
    throw error;
  }
  try {
    const startedAt = Date.now();
    const result = await recordVendorQuoteCreditInPostgres(options);
    const durationMs = Date.now() - startedAt;
    pool.queryAuditor.auditQuery('SELECT vendors FOR UPDATE; UPDATE vendors; INSERT vendor_credit_transactions', [], durationMs, false);
    queryCache.invalidate('vendor_credits');
    queryCache.invalidate('vendors');
    logger.info('PostgreSQL vendor quotation credit transaction completed', { vendorId: options.vendorId, rfqId: options.rfqId, durationMs }, 'VENDOR_QUOTE_CREDIT');
    return result;
  } catch (error) {
    logger.error('Atomic PostgreSQL vendor quotation credit update failed', { error, vendorId: options.vendorId, rfqId: options.rfqId }, 'VENDOR_QUOTE_CREDIT');
    throw error;
  }
}

module.exports = {
  recordVendorQuoteCreditInDB,
  makeD1VendorQuoteCreditStatements,
  quoteCreditState,
  parseVendorRaw,
  buildQuotedVendor,
};

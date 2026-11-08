const { isDeepStrictEqual } = require('node:util');
const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');
const {
  VENDOR_FREE_CREDITS_LIMIT,
  EVENT_OUTBOX_TYPES,
  EVENT_OUTBOX_DEFERRED_STATUS,
} = require('../config/constants');
const {
  quoteCreditState,
  parseVendorRaw,
  buildQuotedVendor,
} = require('./vendorQuoteCreditQueries');

function parseRaw(raw) {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      const parseError = new Error('Persisted RFQ contains invalid JSON.');
      parseError.code = 'INVALID_RFQ_RECORD';
      parseError.cause = error;
      throw parseError;
    }
  }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function serializeExpectedRaw(record) {
  return typeof record === 'string' ? record : JSON.stringify(record || {});
}

function isAlreadyQuoted(vendor, rfqId, existingLedger) {
  return Boolean(existingLedger) || (Array.isArray(vendor.quotedRfqIds) && vendor.quotedRfqIds.some((id) => String(id) === String(rfqId)));
}

function getCreditDecision(vendor, options, existingLedger) {
  const alreadyQuoted = isAlreadyQuoted(vendor, options.rfqId, existingLedger);
  const state = quoteCreditState(vendor, options.isBuyerMapped, options.isResubmission || alreadyQuoted);
  return {
    alreadyQuoted,
    state,
    creditCharged: state.shouldCharge && !alreadyQuoted ? 1 : 0,
  };
}

function makeD1VendorQuoteSubmissionStatements(options) {
  const expectedVendor = parseVendorRaw(options.expectedVendor);
  const { state, alreadyQuoted, creditCharged } = getCreditDecision(expectedVendor, options, null);
  const updatedVendor = buildQuotedVendor(expectedVendor, {
    rfqId: options.rfqId,
    rfqNumber: options.rfqNumber,
    charged: creditCharged,
  });
  const unlimited = `(
    COALESCE(json_extract(v.raw, '$.unlimitedQuoteSubmissions'), 0) = 1 OR
    COALESCE(json_extract(v.raw, '$.unlimitedQuotes'), 0) = 1 OR
    COALESCE(json_extract(v.raw, '$.unlimitedAccess'), 0) = 1 OR
    COALESCE(json_extract(v.raw, '$.isUnlimited'), 0) = 1
  )`;
  const subscribed = `(
    lower(COALESCE(json_extract(v.raw, '$.subscriptionPlan'), '')) IN ('connect', 'select') OR
    COALESCE(json_extract(v.raw, '$.isSubscribed'), 0) = 1 OR
    lower(COALESCE(json_extract(v.raw, '$.subscriptionStatus'), '')) = 'active' OR
    ${unlimited}
  )`;
  const balance = `MAX(0, CAST(COALESCE(
    json_extract(v.raw, '$.freeQuotationCredits'),
    json_extract(v.raw, '$.freeRfqDownloadCredits'),
    ${VENDOR_FREE_CREDITS_LIMIT}
  ) AS INTEGER))`;
  const vendorSubscribed = `(
    lower(COALESCE(json_extract(raw, '$.subscriptionPlan'), '')) IN ('connect', 'select') OR
    COALESCE(json_extract(raw, '$.isSubscribed'), 0) = 1 OR
    lower(COALESCE(json_extract(raw, '$.subscriptionStatus'), '')) = 'active' OR
    COALESCE(json_extract(raw, '$.unlimitedQuoteSubmissions'), 0) = 1 OR
    COALESCE(json_extract(raw, '$.unlimitedQuotes'), 0) = 1 OR
    COALESCE(json_extract(raw, '$.unlimitedAccess'), 0) = 1 OR
    COALESCE(json_extract(raw, '$.isUnlimited'), 0) = 1
  )`;
  const existingQuote = `EXISTS (
    SELECT 1 FROM json_each(CASE
      WHEN json_type(v.raw, '$.quotedRfqIds') = 'array' THEN json_extract(v.raw, '$.quotedRfqIds')
      ELSE '[]'
    END) quoted WHERE CAST(quoted.value AS TEXT) = CAST($1 AS TEXT)
  )`;
  const currentBalance = `MAX(0, CAST(COALESCE(
    json_extract(raw, '$.freeQuotationCredits'),
    json_extract(raw, '$.freeRfqDownloadCredits'),
    ${VENDOR_FREE_CREDITS_LIMIT}
  ) AS INTEGER))`;
  const vendorAlreadyQuoted = `EXISTS (
    SELECT 1 FROM json_each(CASE
      WHEN json_type(raw, '$.quotedRfqIds') = 'array' THEN json_extract(raw, '$.quotedRfqIds')
      ELSE '[]'
    END) quoted WHERE CAST(quoted.value AS TEXT) = CAST($3 AS TEXT)
  )`;
  const chargeOnVendorUpdate = `(CASE WHEN $6 = 1 OR $7 = 1 OR ${vendorSubscribed} OR ${vendorAlreadyQuoted} OR
    EXISTS (SELECT 1 FROM vendor_credit_transactions WHERE idempotency_key = $5)
    THEN 0 ELSE 1 END)`;
  const quotedIdsJson = `json(CASE
    WHEN json_type(raw, '$.quotedRfqIds') = 'array' THEN (
      SELECT json_group_array(value) FROM (
        SELECT value FROM json_each(json_extract(raw, '$.quotedRfqIds'))
        UNION SELECT $3
      )
    )
    ELSE json_array($3)
  END)`;
  const unlockedIdsJson = `json(CASE
    WHEN json_type(raw, '$.unlockedRfqIds') = 'array' THEN (
      SELECT json_group_array(value) FROM (
        SELECT value FROM json_each(json_extract(raw, '$.unlockedRfqIds'))
        UNION SELECT $3
        UNION SELECT $4 WHERE $4 IS NOT NULL
      )
    )
    WHEN $4 IS NULL THEN json_array($3)
    ELSE json_array($3, $4)
  END)`;

  if (options.quoteNotificationEventId && (
    typeof options.quoteId !== 'string' || !options.quoteId
    || typeof options.quoteNotificationRecipient !== 'string' || !options.quoteNotificationRecipient
  )) {
    const error = new Error('A quote notification outbox event requires a quote ID and persisted recipient.');
    error.code = 'INVALID_VENDOR_QUOTE_SUBMISSION';
    throw error;
  }
  const quoteNotificationStatus = options.quoteNotificationPendingOnboarding
    ? EVENT_OUTBOX_DEFERRED_STATUS.BUYER_ONBOARDING
    : 'pending';
  if (options.buyerProfileReminderEventId && (
    typeof options.quoteId !== 'string' || !options.quoteId
    || typeof options.buyerProfileReminderRecipient !== 'string' || !options.buyerProfileReminderRecipient
  )) {
    const error = new Error('A buyer profile reminder requires a quote ID and persisted recipient.');
    error.code = 'INVALID_VENDOR_QUOTE_SUBMISSION';
    throw error;
  }
  if (options.autoClosureEmailEventId && (
    typeof options.quoteId !== 'string' || !options.quoteId
    || typeof options.autoClosureRecipientEmail !== 'string' || !options.autoClosureRecipientEmail
  )) {
    const error = new Error('An RFQ auto-closure email event requires a quote ID and persisted recipient.');
    error.code = 'INVALID_VENDOR_QUOTE_SUBMISSION';
    throw error;
  }
  if (options.autoClosureComparisonJobId && (
    typeof options.quoteId !== 'string' || !options.quoteId
    || typeof options.autoClosureComparisonFireAt !== 'string' || !options.autoClosureComparisonFireAt
    || options.updatedRFQ.status !== 'Closed'
  )) {
    const error = new Error('An RFQ comparison job requires a committed closing quote and fire time.');
    error.code = 'INVALID_VENDOR_QUOTE_SUBMISSION';
    throw error;
  }

  return {
    expectedVendor,
    updatedVendor,
    alreadyQuoted,
    state,
    creditCharged,
    statements: [
      { text: 'SELECT raw FROM vendors WHERE id = $1 LIMIT 1', params: [options.vendorId] },
      { text: 'SELECT raw FROM rfqs WHERE id = $1 LIMIT 1', params: [options.rfqId] },
      { text: 'SELECT * FROM vendor_credit_transactions WHERE idempotency_key = $1 LIMIT 1', params: [options.idempotencyKey] },
      {
        text: `UPDATE rfqs SET
          rfq_number = $3,
          category = $4,
          status = $5,
          sourcing_mode = $6,
          budget = $7,
          raw = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND raw = $9
          AND EXISTS (
            SELECT 1 FROM vendors v
            WHERE v.id = $2 AND v.raw = $10
              AND (
                $12 = 1 OR $13 = 1 OR ${subscribed} OR ${existingQuote} OR
                EXISTS (SELECT 1 FROM vendor_credit_transactions WHERE idempotency_key = $11) OR ${balance} > 0
              )
          )
        RETURNING raw`,
        params: [
          options.rfqId,
          options.vendorId,
          options.updatedRFQ.rfqNumber || null,
          options.updatedRFQ.category || null,
          options.updatedRFQ.status || null,
          options.updatedRFQ.sourcingMode || null,
          Number.isFinite(Number(options.updatedRFQ.budget)) ? Number(options.updatedRFQ.budget) : null,
          JSON.stringify(options.updatedRFQ),
          serializeExpectedRaw(options.expectedRFQ),
          serializeExpectedRaw(options.expectedVendor),
          options.idempotencyKey,
          options.isBuyerMapped ? 1 : 0,
          options.isResubmission || alreadyQuoted ? 1 : 0,
        ],
      },
      {
        text: `UPDATE vendors SET raw = json_set(
          raw,
          '$.freeQuotationCredits', CASE WHEN ${chargeOnVendorUpdate} = 1 THEN ${currentBalance} - 1 ELSE ${currentBalance} END,
          '$.freeRfqDownloadCredits', CASE WHEN ${chargeOnVendorUpdate} = 1 THEN ${currentBalance} - 1 ELSE ${currentBalance} END,
          '$.quotedRfqIds', ${quotedIdsJson},
          '$.unlockedRfqIds', ${unlockedIdsJson}
        ), updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND raw = $2 AND changes() > 0
          RETURNING raw`,
        params: [
          options.vendorId,
          serializeExpectedRaw(options.expectedVendor),
          options.rfqId,
          options.rfqNumber || null,
          options.idempotencyKey,
          options.isBuyerMapped ? 1 : 0,
          options.isResubmission || alreadyQuoted ? 1 : 0,
        ],
      },
      {
        text: `INSERT INTO vendor_credit_transactions
          (id, vendor_id, rfq_id, transaction_type, amount, balance_after, idempotency_key, created_at)
         SELECT $1, $2, $3, 'RFQ_QUOTE',
           CASE WHEN EXISTS (SELECT 1 FROM vendor_credit_transactions WHERE idempotency_key = $4) THEN 0 ELSE -$5 END,
           CAST(json_extract(raw, '$.freeQuotationCredits') AS INTEGER), $4, CURRENT_TIMESTAMP
         FROM vendors WHERE id = $2 AND changes() > 0
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        params: [
          options.transactionId,
          options.vendorId,
          options.rfqId,
          options.idempotencyKey,
          creditCharged,
        ],
      },
    ].concat(options.quoteNotificationEventId ? [{
      text: `INSERT OR IGNORE INTO event_outbox
        (id, event_type, raw, status, available_at, created_at, updated_at)
        SELECT $1, $2, json_object('rfqId', $3, 'quoteId', $4, 'recipientEmail', $5, 'recipientName', $6), $7,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM rfqs r
        WHERE r.id = $3 AND EXISTS (
          SELECT 1 FROM json_each(CASE
            WHEN json_type(r.raw, '$.quotes') = 'array' THEN json_extract(r.raw, '$.quotes')
            ELSE '[]'
          END) AS submitted_quote
          WHERE CAST(json_extract(submitted_quote.value, '$.id') AS TEXT) = CAST($4 AS TEXT)
        )`,
      params: [
        options.quoteNotificationEventId,
        EVENT_OUTBOX_TYPES.RFQ_QUOTE_RECEIVED_EMAIL,
        options.rfqId,
        options.quoteId,
        options.quoteNotificationRecipient,
        options.quoteNotificationRecipientName || null,
        quoteNotificationStatus,
      ],
    }] : []).concat(options.autoClosureEmailEventId ? [{
      text: `INSERT OR IGNORE INTO event_outbox
        (id, event_type, raw, status, available_at, created_at, updated_at)
        SELECT $1, $2, json_object('rfqId', $3, 'quoteId', $4, 'recipientEmail', $5, 'recipientName', $6), 'pending',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM rfqs r
        WHERE r.id = $3 AND r.status = 'Closed' AND EXISTS (
          SELECT 1 FROM json_each(CASE
            WHEN json_type(r.raw, '$.quotes') = 'array' THEN json_extract(r.raw, '$.quotes')
            ELSE '[]'
          END) AS submitted_quote
          WHERE CAST(json_extract(submitted_quote.value, '$.id') AS TEXT) = CAST($4 AS TEXT)
        )`,
      params: [
        options.autoClosureEmailEventId,
        EVENT_OUTBOX_TYPES.RFQ_AUTO_CLOSURE_ACK_EMAIL,
        options.rfqId,
        options.quoteId,
        options.autoClosureRecipientEmail,
        options.autoClosureRecipientName || null,
      ],
    }] : []).concat(options.buyerProfileReminderEventId ? [{
      text: `INSERT OR IGNORE INTO event_outbox
        (id, event_type, raw, status, available_at, created_at, updated_at)
        SELECT $1, $2, json_object('rfqId', $3, 'quoteId', $4, 'recipientEmail', $5, 'recipientName', $6), 'pending',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM rfqs r
        WHERE r.id = $3 AND EXISTS (
          SELECT 1 FROM json_each(CASE
            WHEN json_type(r.raw, '$.quotes') = 'array' THEN json_extract(r.raw, '$.quotes')
            ELSE '[]'
          END) AS submitted_quote
          WHERE CAST(json_extract(submitted_quote.value, '$.id') AS TEXT) = CAST($4 AS TEXT)
        )`,
      params: [
        options.buyerProfileReminderEventId,
        EVENT_OUTBOX_TYPES.BUYER_PROFILE_COMPLETION_REMINDER_EMAIL,
        options.rfqId,
        options.quoteId,
        options.buyerProfileReminderRecipient,
        options.buyerProfileReminderRecipientName || null,
      ],
    }] : []).concat(options.autoClosureComparisonJobId ? [{
      text: `INSERT OR IGNORE INTO rfq_comparison_queue
        (id, rfq_id, rfq_number, status, fire_at)
        SELECT $1, $2, $3, 'pending', $4
        FROM rfqs r
        WHERE r.id = $2 AND r.status = 'Closed' AND EXISTS (
          SELECT 1 FROM json_each(CASE
            WHEN json_type(r.raw, '$.quotes') = 'array' THEN json_extract(r.raw, '$.quotes')
            ELSE '[]'
          END) AS submitted_quote
          WHERE CAST(json_extract(submitted_quote.value, '$.id') AS TEXT) = CAST($5 AS TEXT)
        )`,
      params: [
        options.autoClosureComparisonJobId,
        options.rfqId,
        options.rfqNumber,
        options.autoClosureComparisonFireAt,
        options.quoteId,
      ],
    }] : []),
  };
}

async function submitVendorQuoteOnPostgres(options) {
  return pool.withTransaction(async (client) => {
    const vendorResult = await client.query('SELECT raw FROM vendors WHERE id = $1 FOR UPDATE', [options.vendorId]);
    const rfqResult = await client.query('SELECT raw FROM rfqs WHERE id = $1 FOR UPDATE', [options.rfqId]);
    if (!vendorResult.rows?.[0] || !rfqResult.rows?.[0]) return { notFound: true };

    const vendor = parseVendorRaw(vendorResult.rows[0].raw);
    const rfq = parseRaw(rfqResult.rows[0].raw);
    if (!isDeepStrictEqual(vendor, parseVendorRaw(options.expectedVendor)) || !isDeepStrictEqual(rfq, parseRaw(options.expectedRFQ))) {
      return { conflict: true };
    }

    const ledgerResult = await client.query(
      'SELECT * FROM vendor_credit_transactions WHERE idempotency_key = $1 LIMIT 1',
      [options.idempotencyKey]
    );
    const ledger = ledgerResult.rows?.[0];
    const decision = getCreditDecision(vendor, options, ledger);
    if (decision.state.shouldCharge && decision.state.balance <= 0 && !decision.alreadyQuoted) {
      return { creditsExhausted: true, freeCreditsRemaining: decision.state.balance };
    }

    const updatedVendor = buildQuotedVendor(vendor, {
      rfqId: options.rfqId,
      rfqNumber: options.rfqNumber,
      charged: decision.creditCharged,
    });
    const savedVendorResult = await client.query(
      'UPDATE vendors SET raw = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING raw',
      [options.vendorId, JSON.stringify(updatedVendor)]
    );
    const savedRFQResult = await client.query(
      `UPDATE rfqs SET rfq_number = $2, category = $3, status = $4, sourcing_mode = $5,
         budget = $6, raw = $7::jsonb, updated_at = now()
       WHERE id = $1 RETURNING raw`,
      [
        options.rfqId,
        options.updatedRFQ.rfqNumber || null,
        options.updatedRFQ.category || null,
        options.updatedRFQ.status || null,
        options.updatedRFQ.sourcingMode || null,
        Number.isFinite(Number(options.updatedRFQ.budget)) ? Number(options.updatedRFQ.budget) : null,
        JSON.stringify(options.updatedRFQ),
      ]
    );
    if (!savedVendorResult.rows?.[0] || !savedRFQResult.rows?.[0]) {
      throw new Error('Vendor quote transaction updated no persisted vendor or RFQ row.');
    }
    const savedVendor = parseVendorRaw(savedVendorResult.rows[0].raw);
    const ledgerWrite = await client.query(
      `INSERT INTO vendor_credit_transactions
        (id, vendor_id, rfq_id, transaction_type, amount, balance_after, idempotency_key, created_at)
       VALUES ($1, $2, $3, 'RFQ_QUOTE', $4, $5, $6, now())
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
      [options.transactionId, options.vendorId, options.rfqId, -decision.creditCharged, savedVendor.freeQuotationCredits, options.idempotencyKey]
    );
    const savedLedger = ledgerWrite.rows?.[0] || ledger || (await client.query(
      'SELECT * FROM vendor_credit_transactions WHERE idempotency_key = $1 LIMIT 1',
      [options.idempotencyKey]
    )).rows?.[0];
    if (!savedLedger) throw new Error('Vendor quote transaction did not persist its idempotency ledger.');
    if (options.quoteNotificationEventId) {
      if (typeof options.quoteId !== 'string' || !options.quoteId
        || typeof options.quoteNotificationRecipient !== 'string' || !options.quoteNotificationRecipient) {
        const error = new Error('A quote notification outbox event requires a quote ID and persisted recipient.');
        error.code = 'INVALID_VENDOR_QUOTE_SUBMISSION';
        throw error;
      }
      const quoteNotificationStatus = options.quoteNotificationPendingOnboarding
        ? EVENT_OUTBOX_DEFERRED_STATUS.BUYER_ONBOARDING
        : 'pending';
      await client.query(
        `INSERT INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, now(), now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [
          options.quoteNotificationEventId,
          EVENT_OUTBOX_TYPES.RFQ_QUOTE_RECEIVED_EMAIL,
          JSON.stringify({
            rfqId: options.rfqId,
            quoteId: options.quoteId,
            recipientEmail: options.quoteNotificationRecipient,
            recipientName: options.quoteNotificationRecipientName || null,
          }),
          quoteNotificationStatus,
        ]
      );
    }
    if (options.buyerProfileReminderEventId) {
      if (typeof options.quoteId !== 'string' || !options.quoteId
        || typeof options.buyerProfileReminderRecipient !== 'string' || !options.buyerProfileReminderRecipient) {
        const error = new Error('A buyer profile reminder requires a quote ID and persisted recipient.');
        error.code = 'INVALID_VENDOR_QUOTE_SUBMISSION';
        throw error;
      }
      await client.query(
        `INSERT INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, 'pending', now(), now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [
          options.buyerProfileReminderEventId,
          EVENT_OUTBOX_TYPES.BUYER_PROFILE_COMPLETION_REMINDER_EMAIL,
          JSON.stringify({
            rfqId: options.rfqId,
            quoteId: options.quoteId,
            recipientEmail: options.buyerProfileReminderRecipient,
            recipientName: options.buyerProfileReminderRecipientName || null,
          }),
        ]
      );
    }
    if (options.autoClosureEmailEventId) {
      if (typeof options.quoteId !== 'string' || !options.quoteId
        || typeof options.autoClosureRecipientEmail !== 'string' || !options.autoClosureRecipientEmail) {
        const error = new Error('An RFQ auto-closure email event requires a quote ID and persisted recipient.');
        error.code = 'INVALID_VENDOR_QUOTE_SUBMISSION';
        throw error;
      }
      await client.query(
        `INSERT INTO event_outbox (id, event_type, raw, status, available_at, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, 'pending', now(), now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [
          options.autoClosureEmailEventId,
          EVENT_OUTBOX_TYPES.RFQ_AUTO_CLOSURE_ACK_EMAIL,
          JSON.stringify({
            rfqId: options.rfqId,
            quoteId: options.quoteId,
            recipientEmail: options.autoClosureRecipientEmail,
            recipientName: options.autoClosureRecipientName || null,
          }),
        ]
      );
    }
    if (options.autoClosureComparisonJobId) {
      if (typeof options.quoteId !== 'string' || !options.quoteId
        || typeof options.autoClosureComparisonFireAt !== 'string' || !options.autoClosureComparisonFireAt
        || options.updatedRFQ.status !== 'Closed') {
        const error = new Error('An RFQ comparison job requires a committed closing quote and fire time.');
        error.code = 'INVALID_VENDOR_QUOTE_SUBMISSION';
        throw error;
      }
      await client.query(
        `INSERT INTO rfq_comparison_queue (id, rfq_id, rfq_number, status, fire_at)
         VALUES ($1, $2, $3, 'pending', $4)
         ON CONFLICT (rfq_id) DO NOTHING`,
        [
          options.autoClosureComparisonJobId,
          options.rfqId,
          options.rfqNumber,
          options.autoClosureComparisonFireAt,
        ]
      );
    }
    return {
      vendor: savedVendor,
      rfq: parseRaw(savedRFQResult.rows[0].raw),
      transaction: savedLedger,
      alreadyQuoted: decision.alreadyQuoted,
      creditCharged: decision.creditCharged,
    };
  });
}

async function submitVendorQuoteOnD1(options, binding) {
  const builder = makeD1VendorQuoteSubmissionStatements(options);
  const startedAt = Date.now();
  const results = await d1Bridge.batchD1(binding, builder.statements);
  const durationMs = Date.now() - startedAt;
  pool.queryAuditor.auditQuery('Atomic D1 vendor quote and credit transaction', [], durationMs, false);

  const vendorRow = results[0]?.rows?.[0];
  const rfqRow = results[1]?.rows?.[0];
  if (!vendorRow || !rfqRow) return { notFound: true };
  const currentVendor = parseVendorRaw(vendorRow.raw);
  const currentRFQ = parseRaw(rfqRow.raw);
  if (
    !isDeepStrictEqual(currentVendor, builder.expectedVendor) ||
    !isDeepStrictEqual(currentRFQ, parseRaw(options.expectedRFQ))
  ) return { conflict: true };

  const existingLedger = results[2]?.rows?.[0];
  const decision = getCreditDecision(currentVendor, options, existingLedger);
  if (decision.state.shouldCharge && decision.state.balance <= 0 && !decision.alreadyQuoted) {
    return { creditsExhausted: true, freeCreditsRemaining: decision.state.balance };
  }

  const savedRFQRow = results[3]?.rows?.[0];
  if (!savedRFQRow) return { conflict: true };
  const savedVendorRow = results[4]?.rows?.[0];
  if (!savedVendorRow) throw new Error('D1 vendor quote RFQ write was not followed by its vendor credit write.');
  const transaction = results[5]?.rows?.[0] || existingLedger;
  if (!transaction) throw new Error('D1 vendor quote transaction did not persist its idempotency ledger.');
  return {
    vendor: parseVendorRaw(savedVendorRow.raw),
    rfq: parseRaw(savedRFQRow.raw),
    transaction,
    alreadyQuoted: decision.alreadyQuoted,
    creditCharged: decision.creditCharged,
  };
}

async function submitVendorQuoteInDB(options) {
  if (!pool.hasStorage()) return null;
  const required = ['vendorId', 'rfqId', 'transactionId', 'idempotencyKey', 'expectedVendor', 'expectedRFQ', 'updatedRFQ'];
  if (!options || required.some((key) => !options[key])) {
    const error = new Error('Vendor quote submission requires complete vendor, RFQ, and idempotency data.');
    error.statusCode = 400;
    error.code = 'INVALID_VENDOR_QUOTE_SUBMISSION';
    throw error;
  }

  const binding = d1Bridge.getD1Binding();
  try {
    const result = binding
      ? await submitVendorQuoteOnD1(options, binding)
      : d1Bridge.getD1HttpClient()
        ? (() => { throw Object.assign(new Error('Vendor quote submission requires PostgreSQL transactions or a Workers D1 atomic batch.'), { statusCode: 503, code: 'ATOMIC_PERSISTENCE_REQUIRED' }); })()
        : await submitVendorQuoteOnPostgres(options);
    if (result && !result.conflict && !result.creditsExhausted && !result.notFound) {
      queryCache.invalidate('vendors');
      queryCache.invalidate('vendor_credits');
      queryCache.invalidate('rfqs');
      logger.info('Vendor quote and credit transaction committed', {
        vendorId: options.vendorId,
        rfqId: options.rfqId,
        creditCharged: result.creditCharged,
        provider: binding ? 'cloudflare-d1' : 'postgres',
      }, 'VENDOR_QUOTE_SUBMISSION');
    }
    return result;
  } catch (error) {
    logger.error('Atomic vendor quote submission failed', {
      error,
      vendorId: options.vendorId,
      rfqId: options.rfqId,
      provider: binding ? 'cloudflare-d1' : (d1Bridge.getD1HttpClient() ? 'cloudflare-d1-http' : 'postgres'),
    }, 'VENDOR_QUOTE_SUBMISSION');
    throw error;
  }
}

module.exports = {
  submitVendorQuoteInDB,
  makeD1VendorQuoteSubmissionStatements,
  parseRaw,
  serializeExpectedRaw,
  isAlreadyQuoted,
  getCreditDecision,
};

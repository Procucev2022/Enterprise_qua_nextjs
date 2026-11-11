'use strict';

const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');

const UPDATE_RFQ_SQL = `UPDATE rfqs
  SET rfq_number = $2, category = $3, status = $4, sourcing_mode = $5,
      budget = $6, raw = $7, updated_at = now()
  WHERE id = $1 AND raw = $8::jsonb
  RETURNING raw`;

const UPDATE_RFQ_D1_SQL = `UPDATE rfqs
  SET rfq_number = $2, category = $3, status = $4, sourcing_mode = $5,
      budget = $6, raw = $7, updated_at = CURRENT_TIMESTAMP
  WHERE id = $1 AND raw = $8
  RETURNING raw`;

const INSERT_EVENT_SQL = `INSERT INTO event_outbox (id, event_type, raw)
  SELECT $1, $2, $3
  WHERE EXISTS (SELECT 1 FROM rfqs WHERE id = $4 AND raw = $5::jsonb)
  ON CONFLICT (id) DO UPDATE SET
    status = 'pending', attempts = 0, available_at = CURRENT_TIMESTAMP,
    lease_until = NULL, lease_token = NULL, last_error = NULL,
    updated_at = CURRENT_TIMESTAMP
  WHERE event_outbox.status = 'dead'
  RETURNING id, status`;

const INSERT_EVENT_D1_SQL = `INSERT INTO event_outbox (id, event_type, raw)
  SELECT $1, $2, $3
  WHERE EXISTS (SELECT 1 FROM rfqs WHERE id = $4 AND raw = $5)
  ON CONFLICT (id) DO UPDATE SET
    status = 'pending', attempts = 0, available_at = CURRENT_TIMESTAMP,
    lease_until = NULL, lease_token = NULL, last_error = NULL,
    updated_at = CURRENT_TIMESTAMP
  WHERE event_outbox.status = 'dead'
  RETURNING id, status`;

function parseRaw(value) {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : {};
  try {
    return JSON.parse(value);
  } catch (cause) {
    const error = new Error('Persisted RFQ inquiry contains invalid JSON.');
    error.code = 'INVALID_PERSISTED_RECORD';
    error.cause = cause;
    throw error;
  }
}

function buildRFQParams(rfq, snapshot) {
  const { id, rfqNumber, category, status, sourcingMode, budget } = rfq;
  const expectedRaw = typeof snapshot.raw === 'string' ? snapshot.raw : JSON.stringify(snapshot.raw);
  return [
    id,
    rfqNumber || null,
    category || null,
    status || null,
    sourcingMode || null,
    Number.isFinite(Number(budget)) ? Number(budget) : null,
    JSON.stringify(rfq),
    expectedRaw,
  ];
}

function buildEventParams(event, rfq) {
  return [event.id, event.eventType, JSON.stringify(event.payload), rfq.id, JSON.stringify(rfq)];
}

function validateInputs(snapshot, rfq, event) {
  return Boolean(
    snapshot && typeof snapshot === 'object'
    && rfq && typeof rfq.id === 'string' && rfq.id
    && event && typeof event.id === 'string' && event.id
    && typeof event.eventType === 'string' && event.eventType
    && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
  );
}

function invalidateRFQCache() {
  queryCache.invalidate('rfqs');
}

async function updateRFQAndEnqueueInquiryEmailOnD1(snapshot, rfq, event, binding) {
  const results = await d1Bridge.batchD1(binding, [
    { text: UPDATE_RFQ_D1_SQL, params: buildRFQParams(rfq, snapshot) },
    { text: INSERT_EVENT_D1_SQL, params: buildEventParams(event, rfq) },
    {
      text: 'SELECT id, status FROM event_outbox WHERE id = $1 LIMIT 1',
      params: [event.id],
    },
  ]);
  const savedRFQ = results[0]?.rows?.[0];
  if (!savedRFQ) return null;
  const outboxEvent = results[1]?.rows?.[0] || results[2]?.rows?.[0];
  if (!outboxEvent) throw new Error('RFQ inquiry update committed without its acknowledgement outbox row.');
  return { rfq: parseRaw(savedRFQ.raw), outboxEvent };
}

async function updateRFQAndEnqueueInquiryEmailOnPostgres(snapshot, rfq, event) {
  return pool.withTransaction(async (client) => {
    const updated = await client.query(UPDATE_RFQ_SQL, buildRFQParams(rfq, snapshot));
    const savedRFQ = updated.rows?.[0];
    if (!savedRFQ) return null;

    const inserted = await client.query(INSERT_EVENT_SQL, buildEventParams(event, rfq));
    let outboxEvent = inserted.rows?.[0];
    if (!outboxEvent) {
      const existing = await client.query(
        'SELECT id, status FROM event_outbox WHERE id = $1 LIMIT 1',
        [event.id]
      );
      outboxEvent = existing.rows?.[0];
    }
    if (!outboxEvent) throw new Error('RFQ inquiry transaction did not persist its acknowledgement outbox row.');
    return { rfq: parseRaw(savedRFQ.raw), outboxEvent };
  });
}

async function updateRFQAndEnqueueInquiryEmailInDB(snapshot, rfq, event) {
  if (!pool.hasStorage()) return null;
  if (!validateInputs(snapshot, rfq, event)) {
    const error = new Error('Atomic RFQ inquiry persistence requires a snapshot, RFQ, and outbox event.');
    error.code = 'INVALID_RFQ_INQUIRY_PERSISTENCE';
    throw error;
  }

  const binding = d1Bridge.getD1Binding();
  if (!binding && d1Bridge.getD1HttpClient()) {
    return { atomicUnsupported: true };
  }

  const provider = binding ? 'cloudflare-d1' : 'postgres';
  const startedAt = Date.now();
  try {
    const result = binding
      ? await updateRFQAndEnqueueInquiryEmailOnD1(snapshot, rfq, event, binding)
      : await updateRFQAndEnqueueInquiryEmailOnPostgres(snapshot, rfq, event);
    if (!result) return null;
    invalidateRFQCache();
    logger.info('RFQ inquiry and acknowledgement intent committed atomically', {
      rfqId: rfq.id,
      outboxId: result.outboxEvent.id,
      eventType: event.eventType,
      provider,
      durationMs: Date.now() - startedAt,
    }, 'RFQ_INQUIRY');
    return result;
  } catch (error) {
    logger.error('Atomic RFQ inquiry and acknowledgement persistence failed', {
      error,
      rfqId: rfq.id,
      outboxId: event.id,
      eventType: event.eventType,
      provider,
      durationMs: Date.now() - startedAt,
    }, 'RFQ_INQUIRY');
    throw error;
  }
}

module.exports = {
  parseRaw,
  buildRFQParams,
  buildEventParams,
  updateRFQAndEnqueueInquiryEmailInDB,
};

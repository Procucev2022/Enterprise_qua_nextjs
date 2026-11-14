'use strict';

const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { logger } = require('../services/loggerService');
const {
  EVENT_OUTBOX_TYPES,
  EVENT_OUTBOX_DEFERRED_STATUS,
  EVENT_OUTBOX_MAX_BATCH_SIZE,
  EVENT_OUTBOX_PURGE_BATCH_SIZE,
} = require('../config/constants');

function getProviderLabel() {
  if (d1Bridge.getD1Binding()) return 'cloudflare-d1';
  const httpClient = d1Bridge.getD1HttpClient();
  if (httpClient) return 'cloudflare-d1-http';
  return 'postgres';
}

function parseRaw(value) {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (cause) {
    const error = new Error('Persisted event-outbox payload contains invalid JSON.');
    error.code = 'INVALID_PERSISTED_RECORD';
    error.cause = cause;
    throw error;
  }
}

async function execute(operation, sql, params, options) {
  try {
    return await pool.query(sql, params, { d1: true, ...options });
  } catch (error) {
    logger.error('Event-outbox database operation failed', {
      error,
      operation,
      provider: getProviderLabel(),
    }, 'EVENT_OUTBOX');
    throw error;
  }
}

async function enqueueEventOutboxInDB({ id, eventType, payload }) {
  if (!pool.hasStorage()) return null;
  const result = await execute(
    'enqueue',
    `INSERT INTO event_outbox (id, event_type, raw)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET
       status = 'pending', attempts = 0, available_at = CURRENT_TIMESTAMP,
       lease_until = NULL, lease_token = NULL, last_error = NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE event_outbox.status = 'dead'
     RETURNING id, status`,
    [id, eventType, JSON.stringify(payload)],
    {
      d1Text: `INSERT INTO event_outbox (id, event_type, raw)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         status = 'pending', attempts = 0, available_at = CURRENT_TIMESTAMP,
         lease_until = NULL, lease_token = NULL, last_error = NULL,
         updated_at = CURRENT_TIMESTAMP
       WHERE event_outbox.status = 'dead'
       RETURNING id, status`,
    }
  );
  if (result.rows[0]) return result.rows[0];

  const existing = await execute(
    'read-existing',
    'SELECT id, status FROM event_outbox WHERE id = $1 LIMIT 1',
    [id],
    { d1Text: 'SELECT id, status FROM event_outbox WHERE id = $1 LIMIT 1', useCache: false }
  );
  return existing.rows[0] || null;
}

async function claimDueEventOutboxInDB({ now, staleBefore, leaseUntil, leaseToken, limit, ids }) {
  if (Array.isArray(ids) && ids.length === 0) return [];
  if (!pool.hasStorage()) return [];
  const eventIds = Array.isArray(ids) ? ids : null;
  const result = await execute(
    'claim-due',
    `WITH due AS (
       SELECT id FROM event_outbox
       WHERE ((status = 'pending' AND available_at <= $1)
          OR (status = 'processing' AND lease_until <= $2))
         AND ($6::varchar[] IS NULL OR id = ANY($6::varchar[]))
       ORDER BY available_at ASC, created_at ASC
       LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     UPDATE event_outbox AS event
     SET status = 'processing', attempts = event.attempts + 1,
         lease_token = $4, lease_until = $5, updated_at = CURRENT_TIMESTAMP
     FROM due WHERE event.id = due.id
     RETURNING event.id, event.event_type, event.raw, event.attempts, event.lease_token`,
    [now, staleBefore, limit, leaseToken, leaseUntil, eventIds],
    {
      d1Text: `UPDATE event_outbox
       SET status = 'processing', attempts = attempts + 1,
           lease_token = $4, lease_until = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (
         SELECT id FROM event_outbox
         WHERE ((status = 'pending' AND available_at <= $1)
            OR (status = 'processing' AND lease_until <= $2))
           AND ($6 IS NULL OR id IN (SELECT value FROM json_each($6)))
         ORDER BY available_at ASC, created_at ASC LIMIT $3
       )
       RETURNING id, event_type, raw, attempts, lease_token`,
      d1Params: [now, staleBefore, limit, leaseToken, leaseUntil, eventIds ? JSON.stringify(eventIds) : null],
    }
  );
  return result.rows.map((row) => {
    try {
      return { ...row, raw: parseRaw(row.raw) };
    } catch (parseError) {
      return { ...row, raw: null, parseError };
    }
  });
}

async function releasePendingBuyerQuoteNotificationsInDB(buyerEmail) {
  if (!pool.hasStorage() || !buyerEmail) return [];
  const result = await execute(
    'release-onboarding-quote-notifications',
    `UPDATE event_outbox
     SET status = 'pending', available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE status = $1 AND event_type = $2 AND lower(raw->>'recipientEmail') = lower($3)
     RETURNING id`,
    [
      EVENT_OUTBOX_DEFERRED_STATUS.BUYER_ONBOARDING,
      EVENT_OUTBOX_TYPES.RFQ_QUOTE_RECEIVED_EMAIL,
      buyerEmail,
    ],
    {
      d1Text: `UPDATE event_outbox
       SET status = 'pending', available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE status = $1 AND event_type = $2
         AND lower(json_extract(raw, '$.recipientEmail')) = lower($3)
       RETURNING id`,
    }
  );
  return result.rows;
}

async function releaseReadyOnboardingQuoteNotificationsInDB(limit = EVENT_OUTBOX_MAX_BATCH_SIZE) {
  if (!pool.hasStorage()) return [];
  const boundedLimit = Math.min(Math.max(Number(limit) || 1, 1), EVENT_OUTBOX_MAX_BATCH_SIZE);
  const d1 = Boolean(d1Bridge.getD1Binding() || d1Bridge.getD1HttpClient());
  const buildCompleteBuyerPredicate = (useD1) => {
    const rawValue = (field) => useD1
      ? `lower(COALESCE(CAST(json_extract(b.raw, '$.${field}') AS TEXT), ''))`
      : `lower(COALESCE(b.raw->>'${field}', ''))`;
    const phone = useD1
      ? `COALESCE(CAST(json_extract(b.raw, '$.phone') AS TEXT), CAST(json_extract(b.raw, '$.mobileNumber') AS TEXT), '')`
      : `COALESCE(b.raw->>'phone', b.raw->>'mobileNumber', '')`;
    const noPlaceholderPhone = useD1
      ? `instr(${phone}, '9999999999') = 0 AND instr(${phone}, '0000000000') = 0`
      : `position('9999999999' IN ${phone}) = 0 AND position('0000000000' IN ${phone}) = 0`;
    const isTrue = (field) => `${rawValue(field)} IN ('true', '1')`;
    const isFalse = (field) => `${rawValue(field)} IN ('false', '0')`;
    const pendingProfile = `(
      ${isTrue('onboardingRequired')}
      OR ${rawValue('status')} = 'pending_onboarding'
      OR ${rawValue('verificationStatus')} = 'pending_onboarding'
      OR (${isTrue('isAutoRegistered')} AND NOT ${isFalse('onboardingRequired')})
      OR ${isTrue('tempPasswordRequired')}
      OR ${isFalse('profileVerified')}
      OR ${isFalse('phoneVerified')}
    )`;
    const explicitlyComplete = `(
      ${isFalse('onboardingRequired')}
      OR ${isTrue('profileVerified')}
      OR ${rawValue('accountSource')} = 'web_registration'
      OR ${rawValue('verificationStatus')} = 'verified'
    )`;
    const establishedActive = `(
      ${rawValue('status')} IN ('active', 'active_verified')
      AND NOT ${isTrue('onboardingRequired')}
      AND NOT ${isFalse('profileVerified')}
      AND NOT ${isFalse('phoneVerified')}
    )`;
    return `(${noPlaceholderPhone} AND (${explicitlyComplete} OR NOT ${pendingProfile} OR ${establishedActive}))`;
  };
  const completeBuyer = buildCompleteBuyerPredicate(d1);
  const d1CompleteBuyer = buildCompleteBuyerPredicate(true);
  const result = await execute(
    'release-ready-onboarding-quote-notifications',
    `WITH ready AS (
       SELECT e.id FROM event_outbox e
       WHERE e.status = $1 AND e.event_type = $2
         AND EXISTS (
           SELECT 1 FROM buyer_accounts b
           WHERE lower(b.corporate_email) = lower(e.raw->>'recipientEmail')
             AND ${completeBuyer}
         )
       ORDER BY e.created_at ASC
       LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     UPDATE event_outbox e
     SET status = 'pending', available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     FROM ready WHERE e.id = ready.id
     RETURNING e.id`,
    [
      EVENT_OUTBOX_DEFERRED_STATUS.BUYER_ONBOARDING,
      EVENT_OUTBOX_TYPES.RFQ_QUOTE_RECEIVED_EMAIL,
      boundedLimit,
    ],
    {
      d1Text: `UPDATE event_outbox
       SET status = 'pending', available_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (
         SELECT e.id FROM event_outbox e
         WHERE e.status = $1 AND e.event_type = $2
           AND EXISTS (
             SELECT 1 FROM buyer_accounts b
             WHERE lower(b.corporate_email) = lower(json_extract(e.raw, '$.recipientEmail'))
               AND ${d1CompleteBuyer}
           )
         ORDER BY e.created_at ASC LIMIT $3
       )
       RETURNING id`,
    }
  );
  return result.rows;
}

async function markEventOutboxCompleteInDB(id, leaseToken) {
  if (!pool.hasStorage()) return false;
  const result = await execute(
    'mark-complete',
    `UPDATE event_outbox
     SET status = 'completed', raw = '{}'::jsonb, lease_token = NULL,
         lease_until = NULL, last_error = NULL, completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'processing' AND lease_token = $2
     RETURNING id`,
    [id, leaseToken],
    {
      d1Text: `UPDATE event_outbox
       SET status = 'completed', raw = '{}', lease_token = NULL,
           lease_until = NULL, last_error = NULL, completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'processing' AND lease_token = $2
       RETURNING id`,
    }
  );
  return result.rows.length > 0;
}

async function rescheduleEventOutboxInDB({ id, leaseToken, status, availableAt, lastError }) {
  if (!pool.hasStorage()) return false;
  const result = await execute(
    'reschedule',
    `UPDATE event_outbox
     SET status = $3, available_at = $4, lease_token = NULL, lease_until = NULL,
         last_error = $5, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'processing' AND lease_token = $2
     RETURNING id`,
    [id, leaseToken, status, availableAt, lastError],
    {
      d1Text: `UPDATE event_outbox
       SET status = $3, available_at = $4, lease_token = NULL, lease_until = NULL,
           last_error = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'processing' AND lease_token = $2
       RETURNING id`,
    }
  );
  return result.rows.length > 0;
}

async function purgeEventOutboxInDB(completedBefore, deadBefore) {
  if (!pool.hasStorage()) return 0;
  // One bounded batch per run: the expired rows are selected by a LIMIT subquery, so a large backlog is
  // drained over several runs rather than rewritten in one D1 window.
  const purgeSql = `DELETE FROM event_outbox
     WHERE id IN (
       SELECT id FROM event_outbox
       WHERE (status = 'completed' AND completed_at < $1)
          OR (status = 'dead' AND updated_at < $2)
          OR (status = $3 AND created_at < $2)
       LIMIT $4
     )`;
  const result = await execute(
    'purge-expired',
    purgeSql,
    [completedBefore, deadBefore, EVENT_OUTBOX_DEFERRED_STATUS.BUYER_ONBOARDING, EVENT_OUTBOX_PURGE_BATCH_SIZE],
    { d1Text: purgeSql }
  );
  return result.rowCount || 0;
}

module.exports = {
  parseRaw,
  enqueueEventOutboxInDB,
  claimDueEventOutboxInDB,
  releasePendingBuyerQuoteNotificationsInDB,
  releaseReadyOnboardingQuoteNotificationsInDB,
  markEventOutboxCompleteInDB,
  rescheduleEventOutboxInDB,
  purgeEventOutboxInDB,
};

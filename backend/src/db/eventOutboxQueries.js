'use strict';

const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { logger } = require('../services/loggerService');

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

async function execute(operation, sql, params, options = {}) {
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

async function claimDueEventOutboxInDB({ now, staleBefore, leaseUntil, leaseToken, limit }) {
  if (!pool.hasStorage()) return [];
  const result = await execute(
    'claim-due',
    `WITH due AS (
       SELECT id FROM event_outbox
       WHERE (status = 'pending' AND available_at <= $1)
          OR (status = 'processing' AND lease_until <= $2)
       ORDER BY available_at ASC, created_at ASC
       LIMIT $3 FOR UPDATE SKIP LOCKED
     )
     UPDATE event_outbox AS event
     SET status = 'processing', attempts = event.attempts + 1,
         lease_token = $4, lease_until = $5, updated_at = CURRENT_TIMESTAMP
     FROM due WHERE event.id = due.id
     RETURNING event.id, event.event_type, event.raw, event.attempts, event.lease_token`,
    [now, staleBefore, limit, leaseToken, leaseUntil],
    {
      d1Text: `UPDATE event_outbox
       SET status = 'processing', attempts = attempts + 1,
           lease_token = $4, lease_until = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id IN (
         SELECT id FROM event_outbox
         WHERE (status = 'pending' AND available_at <= $1)
            OR (status = 'processing' AND lease_until <= $2)
         ORDER BY available_at ASC, created_at ASC LIMIT $3
       )
       RETURNING id, event_type, raw, attempts, lease_token`,
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
  const result = await execute(
    'purge-expired',
    `DELETE FROM event_outbox
     WHERE (status = 'completed' AND completed_at < $1)
        OR (status = 'dead' AND updated_at < $2)`,
    [completedBefore, deadBefore],
    {
      d1Text: `DELETE FROM event_outbox
       WHERE (status = 'completed' AND completed_at < $1)
          OR (status = 'dead' AND updated_at < $2)`,
    }
  );
  return result.rowCount || 0;
}

module.exports = {
  parseRaw,
  enqueueEventOutboxInDB,
  claimDueEventOutboxInDB,
  markEventOutboxCompleteInDB,
  rescheduleEventOutboxInDB,
  purgeEventOutboxInDB,
};

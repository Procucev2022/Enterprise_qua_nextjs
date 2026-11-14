const crypto = require('crypto');
const pool = require('./pool');
const { ZOHO_WEBHOOK_RECEIPT_POLICY } = require('../config/constants');

const DB_OPTIONS = Object.freeze({ d1: true, tag: 'zoho_webhook_events' });

function normalizeIdentifier(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function hashPayload(event) {
  return crypto.createHash('sha256').update(JSON.stringify(event || {})).digest('hex');
}

async function claimWebhookEvent(accountId, eventId, event) {
  const normalizedEventId = normalizeIdentifier(eventId);
  if (!normalizedEventId) return { claimed: false, reason: 'MISSING_EVENT_ID' };

  const normalizedAccountId = normalizeIdentifier(accountId);
  const ownerToken = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + ZOHO_WEBHOOK_RECEIPT_POLICY.LEASE_MS).toISOString();
  const rows = await pool.rows(
    `INSERT INTO zoho_webhook_events
      (account_id, event_id, event_type, payload_hash, status, attempt_count, lease_owner,
       lease_expires_at, received_at, updated_at)
     VALUES ($1, $2, $3, $4, 'PROCESSING', 1, $5, $6, $7, $7)
     ON CONFLICT (account_id, event_id) DO UPDATE SET
       event_type = EXCLUDED.event_type,
       payload_hash = EXCLUDED.payload_hash,
       status = 'PROCESSING',
       attempt_count = zoho_webhook_events.attempt_count + 1,
       lease_owner = EXCLUDED.lease_owner,
       lease_expires_at = EXCLUDED.lease_expires_at,
       error_code = NULL,
       updated_at = EXCLUDED.updated_at
     WHERE zoho_webhook_events.status <> 'PROCESSED'
       AND (zoho_webhook_events.status = 'FAILED' OR zoho_webhook_events.lease_expires_at <= $8)
     RETURNING event_id`,
    [
      normalizedAccountId,
      normalizedEventId,
      normalizeIdentifier(event && event.event_type) || 'unknown',
      hashPayload(event),
      ownerToken,
      leaseExpiresAt,
      nowIso,
      nowIso,
    ],
    DB_OPTIONS
  );

  if (rows.length === 0) {
    const existingRows = await pool.rows(
      `SELECT status, lease_expires_at FROM zoho_webhook_events WHERE account_id = $1 AND event_id = $2 LIMIT 1`,
      [normalizedAccountId, normalizedEventId],
      DB_OPTIONS
    );
    const existing = existingRows[0];
    if (!existing) return { claimed: false, reason: 'MISSING_RECEIPT' };
    return {
      claimed: false,
      reason: existing.status === 'PROCESSED' ? 'PROCESSED' : 'IN_PROGRESS',
      leaseExpiresAt: existing.lease_expires_at || null,
    };
  }
  return { claimed: true, ownerToken };
}

async function completeWebhookEvent(accountId, eventId, ownerToken) {
  if (!ownerToken) return false;
  const rows = await pool.rows(
    `UPDATE zoho_webhook_events
     SET status = 'PROCESSED', lease_owner = NULL, processed_at = $4, updated_at = $4, error_code = NULL
     WHERE account_id = $1 AND event_id = $2 AND lease_owner = $3 AND status = 'PROCESSING'
     RETURNING event_id`,
    [normalizeIdentifier(accountId), normalizeIdentifier(eventId), ownerToken, new Date().toISOString()],
    DB_OPTIONS
  );
  return rows.length > 0;
}

async function failWebhookEvent(accountId, eventId, ownerToken, errorCode) {
  if (!ownerToken) return false;
  const nowIso = new Date().toISOString();
  const rows = await pool.rows(
    `UPDATE zoho_webhook_events
     SET status = 'FAILED', lease_owner = NULL, lease_expires_at = $4,
         error_code = $5, updated_at = $4
     WHERE account_id = $1 AND event_id = $2 AND lease_owner = $3 AND status = 'PROCESSING'
     RETURNING event_id`,
    [
      normalizeIdentifier(accountId),
      normalizeIdentifier(eventId),
      ownerToken,
      nowIso,
      normalizeIdentifier(errorCode).slice(0, 160) || 'PROCESSING_FAILED',
    ],
    DB_OPTIONS
  );
  return rows.length > 0;
}

async function purgeExpiredWebhookEvents(now = new Date()) {
  const retentionMs = ZOHO_WEBHOOK_RECEIPT_POLICY.RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  // One bounded batch per run. The primary key is (account_id, event_id), so the batch is selected by that pair.
  const result = await pool.query(
    `DELETE FROM zoho_webhook_events
     WHERE (account_id, event_id) IN (
       SELECT account_id, event_id FROM zoho_webhook_events
       WHERE (status = 'PROCESSED' AND processed_at < $1)
          OR (status = 'FAILED' AND updated_at < $1)
       LIMIT $2
     )`,
    [cutoff, ZOHO_WEBHOOK_RECEIPT_POLICY.PURGE_BATCH_SIZE],
    DB_OPTIONS
  );
  return Number(result.rowCount || 0);
}

module.exports = {
  normalizeIdentifier,
  hashPayload,
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  purgeExpiredWebhookEvents,
};

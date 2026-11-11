// ==============================================================================
// EMAIL INGESTION GATEWAY QUERIES (Neon PostgreSQL)
// ==============================================================================
// The ledger of inbound messages the autonomous gateway has already considered.
//
// Its job is idempotence. Marking a message \Seen over IMAP is not a sufficient
// guard: the flag write can fail after the RFQ was already created, another mail
// client can clear it, and a re-delivered message arrives unflagged. Any of those
// would raise the same requisition twice and circulate it to vendors again, so the
// authoritative check is this table, keyed on the message's own Message-ID.
// ==============================================================================

const crypto = require('crypto');
const pool = require('./pool');
const { logger } = require('../services/loggerService');
const { EMAIL_GATEWAY_CONFIG, EMAIL_GATEWAY_DELIVERY_KIND } = require('../config/constants');

const RETRYABLE_DELIVERY_KINDS = new Set(Object.values(EMAIL_GATEWAY_DELIVERY_KIND));
const memoryProcessedMessageIds = new Set();
const memoryPendingAcknowledgements = new Map();

/** Outcomes recorded against a considered message. */
const INGESTION_OUTCOME = {
  INGESTED: 'INGESTED',
  QUOTE_INGESTED: 'QUOTE_INGESTED',
  QUOTE_VALIDATION_FAILED: 'QUOTE_VALIDATION_FAILED',
  SENDER_NOT_ALLOWED: 'SENDER_NOT_ALLOWED',
  NO_LINE_ITEMS: 'NO_LINE_ITEMS',
  UNREADABLE: 'UNREADABLE',
  FAILED: 'FAILED',
  LINE_ITEMS_EXCEED_LIMIT: 'LINE_ITEMS_EXCEED_LIMIT',
  INVALID_RFQ: 'INVALID_RFQ',
  VENDOR_NOT_FOUND: 'VENDOR_NOT_FOUND',
  SELF_MAIL_IGNORED: 'SELF_MAIL_IGNORED',
  SKIPPED_OUTBOUND: 'SKIPPED_OUTBOUND',
  CREDITS_EXHAUSTED: 'CREDITS_EXHAUSTED',
  PORTAL_SUBMISSION_REQUIRED: 'PORTAL_SUBMISSION_REQUIRED',
  // A buyer's emailed RFQ refused because their free trial credits ran out —
  // kept apart from CREDITS_EXHAUSTED, which is the vendor quotation limit.
  RFQ_CREDITS_EXHAUSTED: 'RFQ_CREDITS_EXHAUSTED',
  // One RFQ raised from one delivery-location group of an email, keyed
  // `<Message-ID>#rfq-<n>`, so a retried email does not raise it a second time.
  RFQ_GROUP_CREATED: 'RFQ_GROUP_CREATED',
  // An RFQ acknowledgement the buyer has not been sent yet (every mail provider
  // failed), keyed `<RFQ key>#ack`. The poller retries it until it goes out
  // (ACK_SENT) or is too old to be useful (ACK_ABANDONED).
  ACK_PENDING: 'ACK_PENDING',
  ACK_SENT: 'ACK_SENT',
  ACK_ABANDONED: 'ACK_ABANDONED',
};


/**
 * Has this message already been considered?
 *
 * Fails closed: an unreadable ledger reports the message as already processed, so
 * an outage skips a requisition rather than risking a duplicate RFQ reaching
 * vendors. The message stays unflagged in the mailbox, so it is picked up on a
 * later poll once the database is reachable again.
 *
 * `strict: true` throws instead of guessing, for the inbox poller: it marks
 * "already processed" messages read, so a guessed `true` during an outage
 * would silently drop every message that arrived in it.
 */
async function hasProcessed(messageId, { strict = false } = {}) {
  if (!messageId) return false;
  const key = String(messageId);
  if (process.env.NODE_ENV !== 'test' && memoryProcessedMessageIds.has(key)) return true;
  try {
    const rows = await pool.rows(
      'select 1 from email_ingestion_log where message_id = $1 limit 1',
      [key],
      { d1: true }
    );
    if (rows.length > 0) {
      memoryProcessedMessageIds.add(key);
      return true;
    }
    return false;
  } catch (err) {
    logger.error('Email ingestion ledger could not be read', err, 'EMAIL_GATEWAY');
    if (strict) throw err;
    return true;
  }
}

/**
 * How many earlier messages from this sender ended in one of `statuses` since
 * `since` (optionally for one RFQ). Drives the auto-reply cooldown, so a sender
 * that keeps writing — or an auto-responder replying to our replies — gets one
 * notice per window instead of one per message.
 *
 * Throws on a ledger error; the caller decides which way to fail.
 */
async function countRecentOutcomes({ fromAddress, statuses = [], rfqNumber = null, since }) {
  if (!fromAddress || statuses.length === 0) return 0;
  const params = [String(fromAddress).trim().toLowerCase(), toLedgerTimestamp(since)];
  const statusPlaceholders = statuses.map((status) => {
    params.push(status);
    return `$${params.length}`;
  });
  let rfqClause = '';
  if (rfqNumber) {
    params.push(String(rfqNumber));
    rfqClause = ` and rfq_number = $${params.length}`;
  }
  const rows = await pool.rows(
    `select CAST(count(*) AS INTEGER) as total
       from email_ingestion_log
      where lower(from_address) = $1
        and processed_at >= $2
        and status in (${statusPlaceholders.join(', ')})${rfqClause}`,
    params,
    { d1: true }
  );
  return Number((rows[0] && rows[0].total) || 0);
}

/**
 * Failed attempts already recorded for a message (rows keyed
 * `<messageKey>#attempt-<n>`), so a transient failure is retried a bounded
 * number of times instead of being dropped after the first one.
 */
async function countFailedAttempts(messageKey) {
  if (!messageKey) return 0;
  try {
    const rows = await pool.rows(
      'select CAST(count(*) AS INTEGER) as total from email_ingestion_log where message_id like $1',
      [`${String(messageKey)}#attempt-%`],
      { d1: true }
    );
    return Number((rows[0] && rows[0].total) || 0);
  } catch (err) {
    logger.error('Email ingestion attempt count could not be read', err, 'EMAIL_GATEWAY');
    return 0;
  }
}

/**
 * The ledger row recorded under this key, or null when there is none.
 *
 * Throws when the ledger cannot be read: the caller uses it to avoid raising a
 * duplicate RFQ, and a guessed "not there" during an outage would do exactly that.
 */
async function findProcessed(messageId) {
  // No store at all (local run without a database): nothing can have been
  // recorded, so there is nothing to find. Same guard as domainQueries.
  if (!messageId || !pool.hasStorage()) return null;
  const rows = await pool.rows(
    'select message_id, rfq_id, rfq_number, status from email_ingestion_log where message_id = $1 limit 1',
    [String(messageId)],
    { d1: true }
  );
  return rows[0] || null;
}

/**
 * Oldest-first ledger rows in one status, for work the poller retries (pending
 * acknowledgements). Optional allowlisted kinds scope vendor retries so they do
 * not scan or starve behind unrelated buyer acknowledgement rows.
 */
async function listByStatus(status, limit = 5, { deliveryKinds = null, excludeDeliveryKinds = null } = {}) {
  if (!status) return [];
  const capped = Math.min(Math.max(Number(limit) || 5, 1), 50);
  const scopedDeliveryKinds = Array.isArray(deliveryKinds)
    ? [...new Set(deliveryKinds.filter((kind) => RETRYABLE_DELIVERY_KINDS.has(kind)))]
    : [];
  if (deliveryKinds !== null && deliveryKinds !== undefined && scopedDeliveryKinds.length === 0) return [];
  const scopedExcludedKinds = Array.isArray(excludeDeliveryKinds)
    ? [...new Set(excludeDeliveryKinds.filter((kind) => RETRYABLE_DELIVERY_KINDS.has(kind)))]
    : [];
  if (!pool.hasStorage()) {
    return [...memoryPendingAcknowledgements.values()]
      .filter((row) => row.status === String(status))
      .filter((row) => scopedDeliveryKinds.length === 0 || scopedDeliveryKinds.some((kind) =>
        row.message_id.includes(`#notice-${kind.toLowerCase()}#ack`)
      ))
      .filter((row) => scopedExcludedKinds.every((kind) =>
        !row.message_id.includes(`#notice-${kind.toLowerCase()}#ack`)
      ))
      .sort((left, right) => new Date(left.processed_at).getTime() - new Date(right.processed_at).getTime())
      .slice(0, capped);
  }
  const messageIdPatterns = [];
  const deliveryKindClauses = [];
  if (scopedDeliveryKinds.length > 0) {
    const includeFilters = scopedDeliveryKinds.map((kind) => {
      messageIdPatterns.push(`%#notice-${kind.toLowerCase().replace(/[\\%_]/g, '\\$&')}#ack`);
      return `message_id LIKE $${messageIdPatterns.length + 2} ESCAPE '\\'`;
    });
    deliveryKindClauses.push(`(${includeFilters.join(' or ')})`);
  }
  scopedExcludedKinds.forEach((kind) => {
    messageIdPatterns.push(`%#notice-${kind.toLowerCase().replace(/[\\%_]/g, '\\$&')}#ack`);
    deliveryKindClauses.push(`message_id NOT LIKE $${messageIdPatterns.length + 2} ESCAPE '\\'`);
  });
  const deliveryKindClause = deliveryKindClauses.length > 0 ? `and ${deliveryKindClauses.join(' and ')}` : '';
  try {
    return await pool.rows(
      `select message_id, rfq_id, rfq_number, from_address, subject, status, detail, processed_at
         from email_ingestion_log
        where status = $1
          ${deliveryKindClause}
        order by processed_at asc
        limit $2`,
      [String(status), capped, ...messageIdPatterns],
      { d1: true }
    );
  } catch (err) {
    logger.error('Email ingestion ledger could not be listed by status', err, 'EMAIL_GATEWAY');
    return [];
  }
}

/**
 * Atomically reserve pending acknowledgement rows for one poller. The token is
 * unique per claim batch; the insert/upsert conflict predicate is the
 * cross-isolate compare-and-swap that prevents two pollers from sending the
 * same retry concurrently. Expired claims are reclaimable after a crashed
 * worker or a provider call that never settled.
 */
async function claimPendingAcknowledgements(limit = 5, {
  deliveryKinds = null,
  excludeDeliveryKinds = null,
  now = Date.now(),
} = {}) {
  const capped = Math.min(Math.max(Number(limit) || 5, 1), 50);
  const scopedDeliveryKinds = Array.isArray(deliveryKinds)
    ? [...new Set(deliveryKinds.filter((kind) => RETRYABLE_DELIVERY_KINDS.has(kind)))]
    : [];
  const scopedExcludedKinds = Array.isArray(excludeDeliveryKinds)
    ? [...new Set(excludeDeliveryKinds.filter((kind) => RETRYABLE_DELIVERY_KINDS.has(kind)))]
    : [];
  if (deliveryKinds !== null && deliveryKinds !== undefined && scopedDeliveryKinds.length === 0) return [];

  const claimToken = crypto.randomUUID();
  const claimedAt = new Date(now).toISOString();
  const reclaimBefore = new Date(now - EMAIL_GATEWAY_CONFIG.ACK_RETRY_CLAIM_LEASE_MS).toISOString();
  if (!pool.hasStorage()) {
    return [...memoryPendingAcknowledgements.values()]
      .filter((row) => row.status === INGESTION_OUTCOME.ACK_PENDING)
      .filter((row) => scopedDeliveryKinds.length === 0 || scopedDeliveryKinds.some((kind) =>
        row.message_id.includes(`#notice-${kind.toLowerCase()}#ack`)
      ))
      .filter((row) => scopedExcludedKinds.every((kind) =>
        !row.message_id.includes(`#notice-${kind.toLowerCase()}#ack`)
      ))
      .filter((row) => {
        if (!row.retry_claimed_at) return true;
        const timestamp = Date.parse(row.retry_claimed_at);
        return !Number.isFinite(timestamp) || timestamp <= now - EMAIL_GATEWAY_CONFIG.ACK_RETRY_CLAIM_LEASE_MS;
      })
      .sort((left, right) => new Date(left.processed_at).getTime() - new Date(right.processed_at).getTime())
      .slice(0, capped)
      .map((row) => {
        row.retry_claim_token = claimToken;
        row.retry_claimed_at = new Date(now).toISOString();
        return { ...row };
      });
  }

  const patterns = [];
  const filters = [];
  if (scopedDeliveryKinds.length > 0) {
    const includeFilters = scopedDeliveryKinds.map((kind) => {
      patterns.push(`%#notice-${kind.toLowerCase().replace(/[\\%_]/g, '\\$&')}#ack`);
      return `messages.message_id LIKE $${patterns.length + 5} ESCAPE '\\'`;
    });
    filters.push(`(${includeFilters.join(' or ')})`);
  }
  scopedExcludedKinds.forEach((kind) => {
    patterns.push(`%#notice-${kind.toLowerCase().replace(/[\\%_]/g, '\\$&')}#ack`);
    filters.push(`messages.message_id NOT LIKE $${patterns.length + 5} ESCAPE '\\'`);
  });
  const filterClause = filters.length > 0 ? `and ${filters.join(' and ')}` : '';

  try {
    const claimedRows = await pool.rows(
      `insert into email_ingestion_retry_claims (message_id, claim_token, claimed_at)
       select messages.message_id, $1, $2
         from email_ingestion_log messages
         left join email_ingestion_retry_claims claims on claims.message_id = messages.message_id
        where messages.status = $3
          and (claims.message_id is null or claims.claimed_at <= $4)
          ${filterClause}
        order by messages.processed_at asc
        limit $5
       on conflict (message_id) do update set
         claim_token = excluded.claim_token,
         claimed_at = excluded.claimed_at
       where email_ingestion_retry_claims.claimed_at <= $4
       returning message_id`,
      [claimToken, claimedAt, INGESTION_OUTCOME.ACK_PENDING, reclaimBefore, capped, ...patterns],
      { d1: true }
    );
    if (claimedRows.length === 0) return [];
    return await pool.rows(
      `select messages.message_id, messages.rfq_id, messages.rfq_number, messages.from_address,
              messages.subject, messages.status, messages.detail, messages.processed_at,
              claims.claim_token as retry_claim_token
         from email_ingestion_log messages
         join email_ingestion_retry_claims claims on claims.message_id = messages.message_id
        where claims.claim_token = $1 and messages.status = $2
        order by messages.processed_at asc
        limit $3`,
      [claimToken, INGESTION_OUTCOME.ACK_PENDING, capped],
      { d1: true }
    );
  } catch (err) {
    logger.error('Email acknowledgement retries could not be atomically claimed', err, 'EMAIL_GATEWAY');
    return [];
  }
}

/** Reserve one newly queued acknowledgement for its original dispatch. */
async function claimPendingAcknowledgement(messageId, { now = Date.now() } = {}) {
  if (!messageId) return null;
  const key = String(messageId);
  const claimToken = crypto.randomUUID();
  const claimedAt = new Date(now).toISOString();
  const reclaimBefore = new Date(now - EMAIL_GATEWAY_CONFIG.ACK_RETRY_CLAIM_LEASE_MS).toISOString();
  if (!pool.hasStorage()) {
    const row = memoryPendingAcknowledgements.get(key);
    if (!row || row.status !== INGESTION_OUTCOME.ACK_PENDING) return null;
    if (row.retry_claimed_at) {
      const existingClaim = Date.parse(row.retry_claimed_at);
      if (Number.isFinite(existingClaim) && existingClaim > now - EMAIL_GATEWAY_CONFIG.ACK_RETRY_CLAIM_LEASE_MS) return null;
    }
    row.retry_claim_token = claimToken;
    row.retry_claimed_at = claimedAt;
    return claimToken;
  }
  try {
    const rows = await pool.rows(
      `insert into email_ingestion_retry_claims (message_id, claim_token, claimed_at)
       select message_id, $2, $3
         from email_ingestion_log
        where message_id = $1 and status = $4
       on conflict (message_id) do update set
         claim_token = excluded.claim_token,
         claimed_at = excluded.claimed_at
       where email_ingestion_retry_claims.claimed_at <= $5
       returning claim_token`,
      [key, claimToken, claimedAt, INGESTION_OUTCOME.ACK_PENDING, reclaimBefore],
      { d1: true }
    );
    return rows[0]?.claim_token || null;
  } catch (err) {
    logger.error('New email acknowledgement could not be claimed for initial dispatch', {
      error: err,
      messageId: key,
    }, 'EMAIL_GATEWAY');
    return null;
  }
}

/** Release a failed original dispatch so a retry poll can claim it immediately. */
async function releaseClaimedAcknowledgement(messageId, claimToken) {
  if (!messageId || !claimToken) return false;
  const key = String(messageId);
  if (!pool.hasStorage()) {
    const row = memoryPendingAcknowledgements.get(key);
    if (!row || row.status !== INGESTION_OUTCOME.ACK_PENDING || row.retry_claim_token !== claimToken) return false;
    row.retry_claim_token = null;
    row.retry_claimed_at = null;
    return true;
  }
  try {
    const rows = await pool.rows(
      `delete from email_ingestion_retry_claims
        where message_id = $1 and claim_token = $2
        returning message_id`,
      [key, String(claimToken)],
      { d1: true }
    );
    return rows.length > 0;
  } catch (err) {
    logger.error('Failed initial email acknowledgement claim could not be released', {
      error: err,
      messageId: key,
    }, 'EMAIL_GATEWAY');
    return false;
  }
}

/** Persist an acknowledgement payload repair only while its poller still owns the claim. */
async function updateClaimedAcknowledgement(messageId, claimToken, detail) {
  if (!messageId || !claimToken) return false;
  const key = String(messageId);
  if (!pool.hasStorage()) {
    const row = memoryPendingAcknowledgements.get(key);
    if (!row || row.status !== INGESTION_OUTCOME.ACK_PENDING || row.retry_claim_token !== claimToken) return false;
    row.detail = detail ? String(detail).slice(0, 2000) : null;
    return true;
  }
  try {
    const rows = await pool.rows(
      `update email_ingestion_log
          set detail = $3
        where message_id = $1
          and status = $4
          and exists (
            select 1 from email_ingestion_retry_claims
             where message_id = $1 and claim_token = $2
          )
        returning message_id`,
      [key, String(claimToken), detail ? String(detail).slice(0, 2000) : null, INGESTION_OUTCOME.ACK_PENDING],
      { d1: true }
    );
    return rows.length > 0;
  } catch (err) {
    logger.error('Claimed email acknowledgement detail could not be updated', err, 'EMAIL_GATEWAY');
    return false;
  }
}

/** Complete a retry only when the current poller still owns its claim. */
async function completeClaimedAcknowledgement(messageId, claimToken, status, detail) {
  if (!messageId || !claimToken || ![INGESTION_OUTCOME.ACK_SENT, INGESTION_OUTCOME.ACK_ABANDONED].includes(status)) {
    return false;
  }
  const key = String(messageId);
  if (!pool.hasStorage()) {
    const row = memoryPendingAcknowledgements.get(key);
    if (!row || row.status !== INGESTION_OUTCOME.ACK_PENDING || row.retry_claim_token !== claimToken) return false;
    memoryPendingAcknowledgements.delete(key);
    memoryProcessedMessageIds.add(key);
    return true;
  }
  try {
    const rows = await pool.rows(
      `update email_ingestion_log
          set status = $3,
              detail = $4,
              processed_at = CURRENT_TIMESTAMP
        where message_id = $1
          and status = $5
          and exists (
            select 1 from email_ingestion_retry_claims
             where message_id = $1 and claim_token = $2
          )
        returning message_id`,
      [key, String(claimToken), status, detail ? String(detail).slice(0, 2000) : null, INGESTION_OUTCOME.ACK_PENDING],
      { d1: true }
    );
    return rows.length > 0;
  } catch (err) {
    logger.error('Claimed email acknowledgement completion could not be recorded', err, 'EMAIL_GATEWAY');
    return false;
  }
}

/**
 * CURRENT_TIMESTAMP is stored as `YYYY-MM-DD HH:MM:SS` (UTC) in D1, so cutoffs
 * are compared in that same text form; Postgres casts it the same way.
 */
function toLedgerTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Record the outcome of considering a message.
 *
 * Upsert rather than insert: a message re-examined after a transient failure has
 * to end up with its final outcome, and a primary-key violation would otherwise
 * abort the poll partway through the batch.
 */
async function recordProcessed({
  messageId,
  status,
  detail = null,
  fromAddress = null,
  subject = null,
  rfqId = null,
  rfqNumber = null,
}) {
  if (!messageId) return false;
  const key = String(messageId);
  if (!pool.hasStorage()) {
    if (status === INGESTION_OUTCOME.ACK_PENDING) {
      const previous = memoryPendingAcknowledgements.get(key);
      const pendingLimit = Math.max(Number(EMAIL_GATEWAY_CONFIG.MAX_MEMORY_PENDING_ACKNOWLEDGEMENTS) || 1, 1);
      if (!memoryPendingAcknowledgements.has(key) && memoryPendingAcknowledgements.size >= pendingLimit) {
        logger.error('In-memory email acknowledgement retry queue reached its capacity', {
          messageId: key,
          pendingCount: memoryPendingAcknowledgements.size,
          pendingLimit,
        }, 'EMAIL_GATEWAY');
        return false;
      }
      memoryPendingAcknowledgements.set(key, {
        message_id: key,
        rfq_id: rfqId || null,
        rfq_number: rfqNumber || null,
        from_address: fromAddress ? String(fromAddress).slice(0, 320) : null,
        subject: subject ? String(subject).slice(0, 2000) : null,
        status: String(status),
        detail: detail ? String(detail).slice(0, 2000) : null,
        processed_at: new Date().toISOString(),
        retry_claim_token: previous?.status === INGESTION_OUTCOME.ACK_PENDING ? previous.retry_claim_token || null : null,
        retry_claimed_at: previous?.status === INGESTION_OUTCOME.ACK_PENDING ? previous.retry_claimed_at || null : null,
      });
    } else if (
      status === INGESTION_OUTCOME.ACK_SENT
      || status === INGESTION_OUTCOME.ACK_ABANDONED
    ) {
      memoryPendingAcknowledgements.delete(key);
    }
    memoryProcessedMessageIds.add(key);
    return true;
  }
  try {
    // email_ingestion_log has already been ported to D1 (see d1Bridge.js).
    // CURRENT_TIMESTAMP (not now()) and CAST(... AS INTEGER) (not ::int, below
    // in countsByStatus) are used throughout this file because both are
    // understood by Postgres and SQLite/D1 alike — one query, either backend.
    await pool.query(
      `insert into email_ingestion_log
         (message_id, rfq_id, rfq_number, from_address, subject, status, detail, processed_at)
       values ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       on conflict (message_id) do update set
         rfq_id = excluded.rfq_id,
         rfq_number = excluded.rfq_number,
         from_address = excluded.from_address,
         subject = excluded.subject,
         status = excluded.status,
         detail = excluded.detail,
         processed_at = CURRENT_TIMESTAMP`,
      [
        key,
        rfqId,
        rfqNumber,
        fromAddress ? String(fromAddress).slice(0, 320) : null,
        subject ? String(subject).slice(0, 2000) : null,
        status,
        detail ? String(detail).slice(0, 2000) : null,
      ],
      { d1: true }
    );
    memoryProcessedMessageIds.add(key);
    return true;
  } catch (err) {
    logger.error('Email ingestion outcome could not be recorded', err, 'EMAIL_GATEWAY');
    return false;
  }
}

function clearMemoryPendingAcknowledgements() {
  memoryPendingAcknowledgements.clear();
}

/**
 * Most recently considered messages, newest first, for the gateway panel.
 *
 * Returns an empty list rather than throwing: the panel is diagnostic, and an
 * unreadable ledger should not take the wizard down with it.
 */
async function listRecent(limit = 15) {
  const capped = Math.min(Math.max(Number(limit) || 15, 1), 100);
  try {
    const rows = await pool.rows(
      `select message_id, rfq_id, rfq_number, from_address, subject, status, detail, processed_at
         from email_ingestion_log
        order by processed_at desc
        limit $1`,
      [capped],
      { d1: true }
    );
    return rows.map((row) => {
      if (!row || typeof row.detail !== 'string') return row;
      try {
        const detail = JSON.parse(row.detail);
        if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return row;
        const hasCredentials = Object.prototype.hasOwnProperty.call(detail, 'tempPassword') ||
          Object.prototype.hasOwnProperty.call(detail, 'encryptedTempPassword');
        if (!hasCredentials) return row;
        delete detail.tempPassword;
        delete detail.encryptedTempPassword;
        detail.credentialFieldsRedacted = true;
        return { ...row, detail: JSON.stringify(detail) };
      } catch {
        return row;
      }
    });
  } catch (err) {
    logger.error('Email ingestion ledger could not be listed', err, 'EMAIL_GATEWAY');
    return [];
  }
}

/** Tally by outcome, so the panel can show how the gateway is performing. */
async function countsByStatus() {
  try {
    const rows = await pool.rows(
      'select status, CAST(count(*) AS INTEGER) as total from email_ingestion_log group by status',
      [],
      { d1: true }
    );
    return rows.reduce((acc, row) => ({ ...acc, [row.status]: row.total }), {});
  } catch (err) {
    logger.error('Email ingestion ledger counts could not be read', err, 'EMAIL_GATEWAY');
    return {};
  }
}

module.exports = {
  INGESTION_OUTCOME,
  hasProcessed,
  recordProcessed,
  countRecentOutcomes,
  countFailedAttempts,
  findProcessed,
  listByStatus,
  claimPendingAcknowledgements,
  claimPendingAcknowledgement,
  releaseClaimedAcknowledgement,
  updateClaimedAcknowledgement,
  completeClaimedAcknowledgement,
  clearMemoryPendingAcknowledgements,
  toLedgerTimestamp,
  listRecent,
  countsByStatus,
};

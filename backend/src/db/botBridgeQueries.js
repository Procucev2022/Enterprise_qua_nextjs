/**
 * Account queries for the WhatsApp agent-bot bridge (/api/bot).
 *
 * The bot identifies people by the WhatsApp number they message from, which the
 * web app never needs to do, so these lookups live here rather than in
 * identityQueries. Rows are shaped by identityQueries.mapRowToUser so every
 * caller sees the same account record the sign-in path does.
 */

const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { USER_SELECT, mapRowToUser, normalizePhone } = require('./identityQueries');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');
const { IDENTITY_PHONE_CONFIG, EVENT_OUTBOX_TYPES } = require('../config/constants');
const { BOT_BRIDGE_CONFIG } = require('../config/botBridgeConfig');

/** Columns the bot's user record needs on top of the sign-in shape. */
const BOT_USER_SELECT = `
  select u.uuid, u.username, u.email, u.password, u.full_name, u.first_name,
         u.phone, u.is_active, u.is_approved, u.self_client, u.reset_password, u.verification_status,
         u.org_uuid, u.unique_id, r.role_name, o.organization_name
    from "user" u
    left join role r on r.uuid = u.role_uuid
    left join organization o on o.uuid = u.org_uuid
`;

const D1_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const [PENDING_VERIFICATION, VERIFIED] = BOT_BRIDGE_CONFIG.VERIFICATION_STATES;

/**
 * Every stored spelling of one phone number.
 *
 * New rows are written in normalizePhone's form, but accounts migrated from QUA
 * kept whatever form they were registered with. QUA's own lookup
 * (SelfRegistrationServiceImpl.getUsersByPhoneNumber) matched the same three
 * spellings, so an account it found is found here too.
 */
function phoneVariants(raw) {
  const normalized = normalizePhone(raw);
  if (!normalized) return [];
  const { DEFAULT_COUNTRY_CODE } = IDENTITY_PHONE_CONFIG;
  const variants = new Set([normalized]);
  if (normalized.startsWith(DEFAULT_COUNTRY_CODE)) {
    const national = normalized.slice(DEFAULT_COUNTRY_CODE.length);
    variants.add(`${DEFAULT_COUNTRY_CODE.replace('+', '')}${national}`);
    variants.add(national);
  }
  return Array.from(variants);
}

/** All accounts registered against a WhatsApp number, newest first. */
async function findUsersByPhone(phone) {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return [];
  const placeholders = variants.map((_, index) => `$${index + 1}`).join(', ');
  const rows = await pool.rows(
    `${BOT_USER_SELECT} where u.phone in (${placeholders}) order by u.created_ts desc limit 50`,
    variants,
    { d1: true }
  );
  return rows.map((row) => ({ ...mapRowToUser(row), uniqueId: row.unique_id || null }));
}

/**
 * Id of the vendor record whose email is a vendor account's login email.
 *
 * vendors.email is stored lowercase and indexed, so this is a single index
 * probe. The general email lookup also matches raw.corporateEmail, which no
 * index covers: on a vendor account with no vendor record of its own (most
 * accounts migrated from QUA) it scanned the whole vendors table on every
 * bot message.
 */
async function findVendorIdByEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return null;
  const rows = await pool.rows('select id from vendors where email = $1 limit 1', [key], { d1: true });
  return rows[0] ? rows[0].id : null;
}

/** Accounts belonging to one organisation, active first. */
async function findUsersByOrgUuid(orgUuid, limit = 50) {
  if (!orgUuid) return [];
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await pool.rows(
    `${USER_SELECT} where u.org_uuid = $1 order by u.is_active desc, u.created_ts desc limit $2`,
    [String(orgUuid), capped],
    { d1: true }
  );
  return rows.map(mapRowToUser);
}

/** One account by primary key, in the sign-in shape. */
async function findUserByUuid(uuid, { fresh = false } = {}) {
  if (!uuid) return null;
  const rows = await pool.rows(`${USER_SELECT} where u.uuid = $1 limit 1`, [String(uuid)], {
    d1: true,
    ...(fresh ? { useCache: false } : {}),
  });
  return mapRowToUser(rows[0]);
}

/**
 * Record WhatsApp facts about an account.
 *
 * `registeredViaWhatsApp` stamps the account as created over WhatsApp (and, when
 * approval is required, unapproved); `verificationStatus` records where the bot's
 * own email-OTP step stands. Only the fields given are written.
 */
async function setWhatsAppStatus(uuid, { registeredViaWhatsApp = false, verificationStatus = null, requireApproval = false } = {}) {
  const assignments = [];
  const params = [];
  const bind = (sql, value) => {
    params.push(value);
    assignments.push(sql.replace('?', `$${params.length}`));
  };
  if (registeredViaWhatsApp) {
    assignments.push('is_whats_app = true');
    bind('source_type = ?', BOT_BRIDGE_CONFIG.ACCOUNT_SOURCE_TYPE);
    if (requireApproval) assignments.push('is_approved = false');
  }
  if (verificationStatus) bind('verification_status = ?', verificationStatus);
  if (assignments.length === 0) return false;

  bind('last_modified_by = ?', BOT_BRIDGE_CONFIG.ACTOR);
  params.push(String(uuid));
  const where = `where uuid = $${params.length}`;
  const set = assignments.join(', ');
  const result = await pool.query(`update "user" set ${set}, last_modified_ts = now() ${where}`, params, {
    d1: true,
    d1Text: `update "user" set ${set}, last_modified_ts = ${D1_NOW} ${where}`,
  });
  const updated = (result.rowCount || 0) > 0;
  if (updated) queryCache.invalidate('user');
  return updated;
}

/**
 * Complete first-time email verification, set the temporary password, and
 * persist its encrypted delivery intent as one PostgreSQL transaction or D1
 * atomic Worker batch. A D1 HTTP adapter cannot safely provide this contract.
 */
async function verifyWhatsAppEmailAndQueueCredentials(uuid, {
  password,
  eventId,
  payload,
  registeredViaWhatsApp = false,
  requireApproval = false,
} = {}) {
  if (!pool.hasStorage()) throw new Error(pool.NOT_CONFIGURED_MESSAGE);
  if (!uuid || !password || !eventId || !payload || typeof payload !== 'object') {
    throw new Error('A user, temporary password and durable credential event are required.');
  }

  const assignments = ['verification_status = $1', 'password = $2', 'reset_password = true'];
  const params = [VERIFIED, password];
  const bind = (sql, value) => {
    params.push(value);
    assignments.push(sql.replace('?', `$${params.length}`));
  };
  if (registeredViaWhatsApp) {
    assignments.push('is_whats_app = true');
    bind('source_type = ?', BOT_BRIDGE_CONFIG.ACCOUNT_SOURCE_TYPE);
  }
  if (requireApproval) assignments.push('is_approved = false');
  bind('last_modified_by = ?', BOT_BRIDGE_CONFIG.ACTOR);
  params.push(String(uuid));
  const userIndex = params.length;
  params.push(PENDING_VERIFICATION);
  const pendingIndex = params.length;
  params.push(String(eventId));
  const eventIndex = params.length;
  const updateSql = `UPDATE "user" SET ${assignments.join(', ')}, last_modified_ts = now()
    WHERE uuid = $${userIndex} AND verification_status = $${pendingIndex}
      AND NOT EXISTS (SELECT 1 FROM event_outbox WHERE id = $${eventIndex} AND status <> 'dead')
    RETURNING uuid`;
  const d1UpdateSql = `UPDATE "user" SET ${assignments.join(', ')}, last_modified_ts = ${D1_NOW}
    WHERE uuid = $${userIndex} AND verification_status = $${pendingIndex}
      AND NOT EXISTS (SELECT 1 FROM event_outbox WHERE id = $${eventIndex} AND status <> 'dead')
    RETURNING uuid`;
  const eventType = EVENT_OUTBOX_TYPES.WHATSAPP_CREDENTIALS_EMAIL;
  const eventRaw = JSON.stringify(payload);
  const startedAt = Date.now();
  const binding = d1Bridge.getD1Binding();
  const httpClient = d1Bridge.getD1HttpClient();

  try {
    let transitioned;
    if (binding || httpClient) {
      if (!binding) {
        const error = new Error('WhatsApp credential delivery requires an atomic D1 Worker batch.');
        error.code = 'ATOMIC_BATCH_REQUIRED';
        throw error;
      }
      const results = await d1Bridge.batchD1(binding, [
        { text: d1UpdateSql, params },
        {
          text: `INSERT INTO event_outbox (id, event_type, raw)
            SELECT $1, $2, $3 WHERE changes() = 1
            ON CONFLICT (id) DO UPDATE SET status = 'pending', raw = excluded.raw,
              attempts = 0, available_at = CURRENT_TIMESTAMP, lease_until = NULL,
              lease_token = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE event_outbox.status = 'dead' RETURNING id`,
          params: [eventId, eventType, eventRaw],
        },
      ]);
      transitioned = Boolean(results[0]?.rows?.length);
      if (transitioned && !results[1]?.rows?.length) {
        throw new Error('WhatsApp verification changed without a durable credential delivery event.');
      }
    } else {
      transitioned = await pool.withTransaction(async (client) => {
        const update = await client.query(updateSql, params);
        if (!update.rows.length) return false;
        const event = await client.query(
          `INSERT INTO event_outbox (id, event_type, raw) VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET status = 'pending', raw = EXCLUDED.raw,
              attempts = 0, available_at = CURRENT_TIMESTAMP, lease_until = NULL,
              lease_token = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE event_outbox.status = 'dead' RETURNING id`,
          [eventId, eventType, eventRaw]
        );
        if (!event.rows.length) throw new Error('WhatsApp verification changed without a durable credential delivery event.');
        return true;
      });
    }

    if (transitioned) queryCache.invalidate('user');
    logger.info('WhatsApp email verification and credential delivery intent persisted', {
      accountId: String(uuid),
      eventType,
      outboxId: eventId,
      transitioned,
      provider: binding ? 'cloudflare-d1' : (httpClient ? 'cloudflare-d1-http' : 'postgres'),
      durationMs: Date.now() - startedAt,
    }, 'BOT_BRIDGE');
    return transitioned;
  } catch (error) {
    logger.error('WhatsApp email verification and credential delivery persistence failed', {
      error,
      accountId: String(uuid),
      eventType,
      outboxId: eventId,
      provider: binding ? 'cloudflare-d1' : (httpClient ? 'cloudflare-d1-http' : 'postgres'),
      durationMs: Date.now() - startedAt,
    }, 'BOT_BRIDGE');
    throw error;
  }
}

/** Replace credentials only when prior delivery is dead-lettered or its retained event was purged. */
async function retryWhatsAppCredentialDelivery(uuid, { password, eventId, payload } = {}) {
  if (!pool.hasStorage()) throw new Error(pool.NOT_CONFIGURED_MESSAGE);
  if (!uuid || !password || !eventId || !payload || typeof payload !== 'object') {
    throw new Error('A user, temporary password and durable credential event are required.');
  }

  const eventType = EVENT_OUTBOX_TYPES.WHATSAPP_CREDENTIALS_EMAIL;
  const params = [password, BOT_BRIDGE_CONFIG.ACTOR, String(uuid), VERIFIED, String(eventId)];
  const updateSql = `UPDATE "user" SET password = $1, reset_password = true, last_modified_by = $2,
      last_modified_ts = now()
    WHERE uuid = $3 AND verification_status = $4 AND reset_password = true
      AND NOT EXISTS (SELECT 1 FROM event_outbox WHERE id = $5 AND status <> 'dead')
    RETURNING uuid`;
  const d1UpdateSql = `UPDATE "user" SET password = $1, reset_password = 1, last_modified_by = $2,
      last_modified_ts = ${D1_NOW}
    WHERE uuid = $3 AND verification_status = $4 AND reset_password = 1
      AND NOT EXISTS (SELECT 1 FROM event_outbox WHERE id = $5 AND status <> 'dead')
    RETURNING uuid`;
  const eventRaw = JSON.stringify(payload);
  const startedAt = Date.now();
  const binding = d1Bridge.getD1Binding();
  const httpClient = d1Bridge.getD1HttpClient();

  try {
    let transitioned;
    if (binding || httpClient) {
      if (!binding) {
        const error = new Error('WhatsApp credential delivery requires an atomic D1 Worker batch.');
        error.code = 'ATOMIC_BATCH_REQUIRED';
        throw error;
      }
      const results = await d1Bridge.batchD1(binding, [
        { text: d1UpdateSql, params },
        {
          text: `INSERT INTO event_outbox (id, event_type, raw)
            SELECT $1, $2, $3 WHERE changes() = 1
            ON CONFLICT (id) DO UPDATE SET status = 'pending', raw = excluded.raw,
              attempts = 0, available_at = CURRENT_TIMESTAMP, lease_until = NULL,
              lease_token = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE event_outbox.status = 'dead' RETURNING id`,
          params: [eventId, eventType, eventRaw],
        },
      ]);
      transitioned = Boolean(results[0]?.rows?.length);
      if (transitioned && !results[1]?.rows?.length) {
        throw new Error('WhatsApp credential retry was not durably queued.');
      }
    } else {
      transitioned = await pool.withTransaction(async (client) => {
        const update = await client.query(updateSql, params);
        if (!update.rows.length) return false;
        const event = await client.query(
          `INSERT INTO event_outbox (id, event_type, raw) VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET status = 'pending', raw = EXCLUDED.raw,
              attempts = 0, available_at = CURRENT_TIMESTAMP, lease_until = NULL,
              lease_token = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE event_outbox.status = 'dead' RETURNING id`,
          [eventId, eventType, eventRaw]
        );
        if (!event.rows.length) throw new Error('WhatsApp credential retry was not durably queued.');
        return true;
      });
    }

    if (transitioned) queryCache.invalidate('user');
    logger.info('WhatsApp credentials were replaced and durably requeued', {
      accountId: String(uuid),
      eventType,
      outboxId: eventId,
      transitioned,
      provider: binding ? 'cloudflare-d1' : (httpClient ? 'cloudflare-d1-http' : 'postgres'),
      durationMs: Date.now() - startedAt,
    }, 'BOT_BRIDGE');
    return transitioned;
  } catch (error) {
    logger.error('WhatsApp credentials could not be replaced and requeued', {
      error,
      accountId: String(uuid),
      eventType,
      outboxId: eventId,
      provider: binding ? 'cloudflare-d1' : (httpClient ? 'cloudflare-d1-http' : 'postgres'),
      durationMs: Date.now() - startedAt,
    }, 'BOT_BRIDGE');
    throw error;
  }
}

module.exports = {
  phoneVariants,
  verifyWhatsAppEmailAndQueueCredentials,
  retryWhatsAppCredentialDelivery,
  findUsersByPhone,
  findUsersByOrgUuid,
  findUserByUuid,
  findVendorIdByEmail,
  setWhatsAppStatus,
};

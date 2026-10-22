/**
 * Account queries for the WhatsApp agent-bot bridge (/api/bot).
 *
 * The bot identifies people by the WhatsApp number they message from, which the
 * web app never needs to do, so these lookups live here rather than in
 * identityQueries. Rows are shaped by identityQueries.mapRowToUser so every
 * caller sees the same account record the sign-in path does.
 */

const pool = require('./pool');
const { USER_SELECT, mapRowToUser, normalizePhone } = require('./identityQueries');
const { IDENTITY_PHONE_CONFIG } = require('../config/constants');
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
    `${BOT_USER_SELECT} where u.phone in (${placeholders}) order by u.created_ts desc`,
    variants,
    { d1: true }
  );
  return rows.map((row) => ({ ...mapRowToUser(row), uniqueId: row.unique_id || null }));
}

/** Accounts belonging to one organisation, active first. */
async function findUsersByOrgUuid(orgUuid) {
  if (!orgUuid) return [];
  const rows = await pool.rows(
    `${USER_SELECT} where u.org_uuid = $1 order by u.is_active desc, u.created_ts desc`,
    [String(orgUuid)],
    { d1: true }
  );
  return rows.map(mapRowToUser);
}

/** One account by primary key, in the sign-in shape. */
async function findUserByUuid(uuid) {
  if (!uuid) return null;
  const rows = await pool.rows(`${USER_SELECT} where u.uuid = $1 limit 1`, [String(uuid)], { d1: true });
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
  return (result.rowCount || 0) > 0;
}

/**
 * Give a WhatsApp-registered account a temporary password it must change.
 *
 * The bot registers accounts with a random password nobody is told; once the
 * email is verified the account gets a fresh one that is emailed to its owner,
 * as QUA did, flagged for change on first sign-in like EQUA's vendor onboarding.
 * Stored as identityQueries stores every password here.
 */
async function setTemporaryPassword(uuid, password) {
  const params = [password, BOT_BRIDGE_CONFIG.ACTOR, String(uuid)];
  const set = 'password = $1, reset_password = true, last_modified_by = $2';
  const result = await pool.query(`update "user" set ${set}, last_modified_ts = now() where uuid = $3`, params, {
    d1: true,
    d1Text: `update "user" set ${set}, last_modified_ts = ${D1_NOW} where uuid = $3`,
  });
  return (result.rowCount || 0) > 0;
}

module.exports = {
  phoneVariants,
  setTemporaryPassword,
  findUsersByPhone,
  findUsersByOrgUuid,
  findUserByUuid,
  setWhatsAppStatus,
};

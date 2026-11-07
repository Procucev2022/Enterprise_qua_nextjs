// ==============================================================================
// AUTH SESSION QUERIES (PostgreSQL / Cloudflare D1 / Dev Memory Fallback)
// ==============================================================================
// Issued OTP codes and revoked session tokens.
// ==============================================================================

const pool = require('./pool');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');
const d1Bridge = require('./d1Bridge');

const memoryOtpStore = new Map();
const memoryRevokedTokens = new Map();

function parseExpiryTimestamp(raw) {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  if (raw instanceof Date) return raw.getTime();
  const str = String(raw).trim();
  if (/^\d{11,14}$/.test(str)) {
    return Number(str);
  }
  // If the date string has no explicit timezone offset (e.g. SQLite "YYYY-MM-DD HH:MM:SS"),
  // treat it as UTC to avoid local timezone drift (e.g. IST +05:30 premature expiration).
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(str)) {
    const utcIso = str.replace(' ', 'T') + 'Z';
    const parsed = new Date(utcIso).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  const parsed = new Date(str).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function extractEmailFromOtpKey(otpKey) {
  if (!otpKey) return '';
  const parts = String(otpKey).split('_EMAIL_');
  return parts.length > 1 ? parts[1].trim() : '';
}

function throwPersistenceUnavailable(operation, cause) {
  const error = new Error(`Authentication session ${operation} failed because configured database persistence is unavailable.`);
  error.code = 'PERSISTENCE_UNAVAILABLE';
  error.cause = cause;
  logger.error('Authentication session persistence failed; refusing isolate-local fallback', {
    operation,
    error: cause,
  }, 'AUTH_SESSION');
  throw error;
}

function storeMemoryOtp(otpKey, code, expiresMs) {
  memoryOtpStore.set(otpKey, { otpKey, code, attempts: 0, expiresAt: expiresMs });
}

// ── OTP codes ────────────────────────────────────────────────────────────────

/**
 * Store (or replace) the OTP issued for an email + mobile pair.
 */
async function saveOtp(otpKey, code, expiresAt, emailHint) {
  const isoExpiry = new Date(expiresAt).toISOString();
  const expiresMs = new Date(expiresAt).getTime();
  const email = emailHint || extractEmailFromOtpKey(otpKey);
  const hasStorage = pool.hasStorage();

  if (!hasStorage) {
    storeMemoryOtp(otpKey, code, expiresMs);
    return;
  }

  const primaryQuery = `insert into auth_otp_codes (otp_key, code, attempts, expires_at, created_at)
       values ($1, $2, 0, $3, CURRENT_TIMESTAMP)
       on conflict (otp_key) do update set
         code = excluded.code,
         attempts = 0,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`;

  try {
    await pool.query(primaryQuery, [otpKey, code, isoExpiry], { d1: true });
    return;
  } catch (err) {
    const errMsg = String((err && err.message) || err);

    // If a legacy schema variant has a NOT NULL constraint on email:
    if (errMsg.includes('auth_otp_codes.email') || errMsg.includes('NOTNULL')) {
      try {
        await pool.query('delete from auth_otp_codes where otp_key = $1', [otpKey], { d1: true });
        await pool.query(
          `insert into auth_otp_codes (otp_key, email, code, attempts, expires_at, created_at)
           values ($1, $2, $3, 0, $4, CURRENT_TIMESTAMP)`,
          [otpKey, email, code, isoExpiry],
          { d1: true }
        );
        return;
      } catch (compatibilityErr) {
        // proceed to delete-insert fallback
        logger.warn('OTP compatibility insert failed; trying the standard upsert fallback', {
          operation: 'saveOtp',
          error: compatibilityErr,
        }, 'AUTH_SESSION');
      }
    }

    // Standard fallback: delete followed by insert (handles missing ON CONFLICT index)
    try {
      await pool.query('delete from auth_otp_codes where otp_key = $1', [otpKey], { d1: true });
      await pool.query(
        `insert into auth_otp_codes (otp_key, code, attempts, expires_at, created_at)
         values ($1, $2, 0, $3, CURRENT_TIMESTAMP)`,
        [otpKey, code, isoExpiry],
        { d1: true }
      );
    } catch (innerErr) {
      throwPersistenceUnavailable('OTP storage', innerErr);
    }
  }
}

/**
 * Read the OTP stored against a key, or null when there is none.
 */
async function findOtp(otpKey) {
  if (!pool.hasStorage()) {
    const entry = memoryOtpStore.get(otpKey);
    return entry ? { ...entry } : null;
  }

  try {
    const rows = await pool.rows(
      'select otp_key, code, attempts, expires_at from auth_otp_codes where otp_key = $1 limit 1',
      [otpKey],
      { d1: true }
    );
    if (rows && rows.length > 0) {
      const row = rows[0];
      return {
        otpKey: row.otp_key,
        code: row.code,
        attempts: Number(row.attempts || 0),
        expiresAt: parseExpiryTimestamp(row.expires_at),
      };
    }
    memoryOtpStore.delete(otpKey);
    return null;
  } catch (err) {
    throwPersistenceUnavailable('OTP lookup', err);
  }
}

/** Delete an OTP: on successful verification, or once found expired. */
async function deleteOtp(otpKey) {
  if (!pool.hasStorage()) return memoryOtpStore.delete(otpKey);

  try {
    const result = await pool.query(
      'delete from auth_otp_codes where otp_key = $1',
      [otpKey],
      { d1: true }
    );
    memoryOtpStore.delete(otpKey);
    return (result.rowCount || 0) > 0;
  } catch (err) {
    throwPersistenceUnavailable('OTP deletion', err);
  }
}

/**
 * Record a failed attempt against a stored code.
 */
async function incrementOtpAttempts(otpKey) {
  if (!pool.hasStorage()) {
    const entry = memoryOtpStore.get(otpKey);
    if (!entry) return 0;
    entry.attempts = (entry.attempts || 0) + 1;
    return entry.attempts;
  }

  try {
    const result = await pool.query(
      'update auth_otp_codes set attempts = attempts + 1 where otp_key = $1 returning attempts',
      [otpKey],
      { d1: true }
    );
    return result.rows[0] ? Number(result.rows[0].attempts) : 0;
  } catch (err) {
    throwPersistenceUnavailable('OTP attempt update', err);
  }
}

// ── Revoked session tokens ──────────────────────────────────────────────────

/**
 * Mark a token's signature as revoked until the token would have expired anyway.
 */
async function revokeToken(signature, expiresAt) {
  const isoExpiry = new Date(expiresAt).toISOString();
  queryCache.invalidate('auth_revoked_tokens');
  if (!pool.hasStorage()) {
    memoryRevokedTokens.set(signature, new Date(expiresAt).getTime());
    return;
  }

  try {
    await pool.query(
      `insert into auth_revoked_tokens (signature, expires_at, revoked_at)
       values ($1, $2, CURRENT_TIMESTAMP)
       on conflict (signature) do nothing`,
      [signature, isoExpiry],
      { d1: true }
    );
    return;
  } catch (err) {
    try {
      await pool.query('delete from auth_revoked_tokens where signature = $1', [signature], { d1: true });
      await pool.query(
        `insert into auth_revoked_tokens (signature, expires_at, revoked_at)
         values ($1, $2, CURRENT_TIMESTAMP)`,
        [signature, isoExpiry],
        { d1: true }
      );
    } catch (fallbackErr) {
      throwPersistenceUnavailable('token revocation', fallbackErr || err);
    }
  }
}

/** Whether this token signature has been revoked. */
async function isTokenRevoked(signature) {
  if (!pool.hasStorage()) {
    const expiry = memoryRevokedTokens.get(signature);
    if (!expiry) return false;
    if (expiry <= Date.now()) {
      memoryRevokedTokens.delete(signature);
      return false;
    }
    return true;
  }
  const expiry = memoryRevokedTokens.get(signature);
  if (expiry && expiry > Date.now()) return true;
  if (expiry) memoryRevokedTokens.delete(signature);
  if (d1Bridge.isD1Overloaded()) {
    const error = new Error('Session revocation storage is temporarily unavailable.');
    error.code = 'PERSISTENCE_UNAVAILABLE';
    throwPersistenceUnavailable('token revocation lookup', error);
  }
  try {
    const rows = await pool.rows(
      'select 1 from auth_revoked_tokens where signature = $1 limit 1',
      [signature],
      { d1: true, useCache: true, tag: 'auth_revoked_tokens', ttlMs: 30000 }
    );
    return rows.length > 0;
  } catch (err) {
    if (d1Bridge.isRetryableD1Error(err) || d1Bridge.isD1Overloaded()) {
      logger.warn('D1 unavailable during token revocation lookup; failing closed', {
        error: err,
        operation: 'token-revocation-lookup',
      }, 'AUTH_SESSION');
    }
    throwPersistenceUnavailable('token revocation lookup', err);
  }
}

/**
 * Drop expired OTPs and revoked-token records.
 */
async function purgeExpiredAuthState() {
  const isoNow = new Date().toISOString();
  if (!pool.hasStorage()) {
    const now = Date.now();
    let otpsPurged = 0;
    let revokedTokensPurged = 0;
    for (const [key, otp] of memoryOtpStore.entries()) {
      if (otp.expiresAt <= now) {
        memoryOtpStore.delete(key);
        otpsPurged += 1;
      }
    }
    for (const [signature, expiry] of memoryRevokedTokens.entries()) {
      if (expiry <= now) {
        memoryRevokedTokens.delete(signature);
        revokedTokensPurged += 1;
      }
    }
    return { otpsPurged, revokedTokensPurged };
  }

  try {
    const otps = await pool.query(
      'delete from auth_otp_codes where expires_at < now()',
      [],
      {
        d1: true,
        d1Text: 'delete from auth_otp_codes where expires_at < $1',
        d1Params: [isoNow],
      }
    );
    const tokens = await pool.query(
      'delete from auth_revoked_tokens where expires_at < now()',
      [],
      {
        d1: true,
        d1Text: 'delete from auth_revoked_tokens where expires_at < $1',
        d1Params: [isoNow],
      }
    );
    return {
      otpsPurged: otps.rowCount || 0,
      revokedTokensPurged: tokens.rowCount || 0,
    };
  } catch (err) {
    throwPersistenceUnavailable('auth-state cleanup', err);
  }
}

module.exports = {
  saveOtp,
  findOtp,
  deleteOtp,
  incrementOtpAttempts,
  revokeToken,
  isTokenRevoked,
  purgeExpiredAuthState,
};

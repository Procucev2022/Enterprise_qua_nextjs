// ==============================================================================
// AUTH SESSION QUERIES (PostgreSQL / Cloudflare D1 / Dev Memory Fallback)
// ==============================================================================
// Issued OTP codes and revoked session tokens.
// ==============================================================================

const pool = require('./pool');

const memoryOtpStore = new Map();
const memoryRevokedTokens = new Set();

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

// ── OTP codes ────────────────────────────────────────────────────────────────

/**
 * Store (or replace) the OTP issued for an email + mobile pair.
 */
async function saveOtp(otpKey, code, expiresAt, emailHint) {
  const isoExpiry = new Date(expiresAt).toISOString();
  const expiresMs = new Date(expiresAt).getTime();
  const email = emailHint || extractEmailFromOtpKey(otpKey);

  memoryOtpStore.set(otpKey, {
    otpKey,
    code,
    attempts: 0,
    expiresAt: expiresMs,
  });

  const primaryQuery = `insert into auth_otp_codes (otp_key, code, attempts, expires_at, created_at)
       values ($1, $2, 0, $3, CURRENT_TIMESTAMP)
       on conflict (otp_key) do update set
         code = excluded.code,
         attempts = 0,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP`;

  try {
    await pool.query(primaryQuery, [otpKey, code, isoExpiry], { d1: true });
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
      } catch {
        // proceed to delete-insert fallback
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
      if (typeof console !== 'undefined' && console.error) {
        console.error('[AUTH_SESSION] saveOtp DB write failed:', innerErr.message);
      }
    }
  }
}

/**
 * Read the OTP stored against a key, or null when there is none.
 */
async function findOtp(otpKey) {
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
    if (memoryOtpStore.has(otpKey)) {
      return { ...memoryOtpStore.get(otpKey) };
    }
    return null;
  } catch (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[AUTH_SESSION] findOtp DB read failed:', err.message);
    }
    const entry = memoryOtpStore.get(otpKey);
    return entry ? { ...entry } : null;
  }
}

/** Delete an OTP: on successful verification, or once found expired. */
async function deleteOtp(otpKey) {
  try {
    const result = await pool.query(
      'delete from auth_otp_codes where otp_key = $1',
      [otpKey],
      { d1: true }
    );
    memoryOtpStore.delete(otpKey);
    return (result.rowCount || 0) > 0;
  } catch (err) {
    return memoryOtpStore.delete(otpKey);
  }
}

/**
 * Record a failed attempt against a stored code.
 */
async function incrementOtpAttempts(otpKey) {
  try {
    const result = await pool.query(
      'update auth_otp_codes set attempts = attempts + 1 where otp_key = $1 returning attempts',
      [otpKey],
      { d1: true }
    );
    return result.rows[0] ? Number(result.rows[0].attempts) : 0;
  } catch (err) {
    const entry = memoryOtpStore.get(otpKey);
    if (!entry) return 0;
    entry.attempts = (entry.attempts || 0) + 1;
    return entry.attempts;
  }
}

// ── Revoked session tokens ──────────────────────────────────────────────────

/**
 * Mark a token's signature as revoked until the token would have expired anyway.
 */
async function revokeToken(signature, expiresAt) {
  const isoExpiry = new Date(expiresAt).toISOString();
  try {
    await pool.query(
      `insert into auth_revoked_tokens (signature, expires_at, revoked_at)
       values ($1, $2, CURRENT_TIMESTAMP)
       on conflict (signature) do nothing`,
      [signature, isoExpiry],
      { d1: true }
    );
  } catch (err) {
    try {
      await pool.query('delete from auth_revoked_tokens where signature = $1', [signature], { d1: true });
      await pool.query(
        `insert into auth_revoked_tokens (signature, expires_at, revoked_at)
         values ($1, $2, CURRENT_TIMESTAMP)`,
        [signature, isoExpiry],
        { d1: true }
      );
    } catch {
      memoryRevokedTokens.add(signature);
    }
  }
}

/** Whether this token signature has been revoked. */
async function isTokenRevoked(signature) {
  if (memoryRevokedTokens.has(signature)) return true;
  const rows = await pool.rows(
    'select 1 from auth_revoked_tokens where signature = $1 limit 1',
    [signature],
    { d1: true }
  );
  return rows.length > 0;
}

/**
 * Drop expired OTPs and revoked-token records.
 */
async function purgeExpiredAuthState() {
  const isoNow = new Date().toISOString();
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
    return {
      otpsPurged: 0,
      revokedTokensPurged: 0,
    };
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

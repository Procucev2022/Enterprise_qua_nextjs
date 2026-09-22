// ==============================================================================
// AUTH SESSION QUERIES (Neon PostgreSQL)
// ==============================================================================
// Issued OTP codes and revoked session tokens.
//
// Both used to be module-level in-memory collections — a `Map` keyed by
// `<phone>_EMAIL_<email>` and a `Set` of token signatures. That made them
// per-process, with two consequences that were not theoretical:
//   - a restart invalidated every OTP that had been issued but not yet entered,
//     so a visitor mid-sign-in was told their correct code was invalid;
//   - with more than one worker, a code issued by one process could not be
//     verified by another, and a token revoked on one worker stayed valid on the
//     rest, meaning logout did not reliably end the session.
//
// Storing them here fixes both, and lets an expired entry be swept rather than
// accumulating for the lifetime of the process.
// ==============================================================================

const pool = require('./pool');

// ── OTP codes ────────────────────────────────────────────────────────────────

/**
 * Store (or replace) the OTP issued for an email + mobile pair.
 *
 * Upsert rather than insert: requesting a second code supersedes the first, and
 * resets the attempt counter, which is what "resend" has to mean. Two rows for
 * one key would otherwise leave the older code still redeemable.
 */
async function saveOtp(otpKey, code, expiresAt) {
  // auth_otp_codes/auth_revoked_tokens have already been ported to D1 (see
  // d1Bridge.js). expiresAt goes in as an ISO string rather than a raw Date
  // object — D1's bind() only accepts TEXT/INTEGER/REAL/BLOB/NULL, and pg
  // accepts an ISO string for a timestamptz column exactly as well as a Date
  // — so one param value works for both backends. now() -> CURRENT_TIMESTAMP
  // for the same reason as emailGatewayQueries: SQLite has no now().
  await pool.query(
    `insert into auth_otp_codes (otp_key, code, attempts, expires_at, created_at)
     values ($1, $2, 0, $3, CURRENT_TIMESTAMP)
     on conflict (otp_key) do update set
       code = excluded.code,
       attempts = 0,
       expires_at = excluded.expires_at,
       created_at = CURRENT_TIMESTAMP`,
    [otpKey, code, new Date(expiresAt).toISOString()],
    { d1: true }
  );
}

/**
 * Read the OTP stored against a key, or null when there is none.
 *
 * `expiresAt` is returned as epoch milliseconds so the caller compares numbers
 * rather than having to reason about how the driver rendered the timestamp.
 */
async function findOtp(otpKey) {
  const rows = await pool.rows(
    'select otp_key, code, attempts, expires_at from auth_otp_codes where otp_key = $1',
    [otpKey],
    { d1: true }
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    otpKey: row.otp_key,
    code: row.code,
    attempts: Number(row.attempts || 0),
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

/** Delete an OTP: on successful verification, or once found expired. */
async function deleteOtp(otpKey) {
  const result = await pool.query(
    'delete from auth_otp_codes where otp_key = $1',
    [otpKey],
    { d1: true }
  );
  return (result.rowCount || 0) > 0;
}

/**
 * Record a failed attempt against a stored code.
 *
 * Incremented in SQL rather than read-modify-written, so two simultaneous wrong
 * guesses both count instead of one overwriting the other.
 */
async function incrementOtpAttempts(otpKey) {
  const result = await pool.query(
    'update auth_otp_codes set attempts = attempts + 1 where otp_key = $1 returning attempts',
    [otpKey],
    { d1: true }
  );
  return result.rows[0] ? Number(result.rows[0].attempts) : 0;
}

// ── Revoked session tokens ──────────────────────────────────────────────────

/**
 * Mark a token's signature as revoked until the token would have expired anyway.
 *
 * Idempotent: logging out twice is not an error, and the first revocation time is
 * the one worth keeping.
 */
async function revokeToken(signature, expiresAt) {
  await pool.query(
    `insert into auth_revoked_tokens (signature, expires_at, revoked_at)
     values ($1, $2, CURRENT_TIMESTAMP)
     on conflict (signature) do nothing`,
    [signature, new Date(expiresAt).toISOString()],
    { d1: true }
  );
}

/** Whether this token signature has been revoked. */
async function isTokenRevoked(signature) {
  const rows = await pool.rows(
    'select 1 from auth_revoked_tokens where signature = $1 limit 1',
    [signature],
    { d1: true }
  );
  return rows.length > 0;
}

/**
 * Drop expired OTPs and revoked-token records.
 *
 * A revoked entry is only needed until its own expiry: after that the token fails
 * the expiry check on its own and the row is dead weight.
 *
 * Deliberately NOT ported to D1 ({ d1: true } omitted) unlike the rest of this
 * file: expires_at is stored as an ISO string ("...T...Z") so it round-trips
 * through JS Date correctly, but SQLite's CURRENT_TIMESTAMP renders as
 * "YYYY-MM-DD HH:MM:SS" (space, no T, no Z) — comparing the two as strings
 * doesn't sort the way the dates actually do, since 'T' > ' ' lexicographically
 * regardless of the date. This is a background sweep, not something login
 * correctness depends on (findOtp/isTokenRevoked check existence and expiry in
 * JS, not via this comparison), so it stays on Postgres until it's worth a
 * proper cross-engine date-comparison fix rather than a silent no-op.
 */
async function purgeExpiredAuthState() {
  const otps = await pool.query('delete from auth_otp_codes where expires_at < now()');
  const tokens = await pool.query('delete from auth_revoked_tokens where expires_at < now()');
  return {
    otpsPurged: otps.rowCount || 0,
    revokedTokensPurged: tokens.rowCount || 0,
  };
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

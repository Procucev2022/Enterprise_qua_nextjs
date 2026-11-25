const pool = require('./pool');
const { logger } = require('../services/loggerService');

const PG_CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS user_preferences (
  user_key VARCHAR(320) NOT NULL,
  pref_key VARCHAR(128) NOT NULL,
  pref_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, pref_key)
)`;

const D1_CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS user_preferences (
  user_key TEXT NOT NULL,
  pref_key TEXT NOT NULL,
  pref_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_key, pref_key)
)`;

function isMissingTableError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return err?.code === '42P01' || msg.includes('no such table') || msg.includes('does not exist');
}

async function ensureTable() {
  await pool.query(PG_CREATE_TABLE_SQL, [], { d1: true, d1Text: D1_CREATE_TABLE_SQL });
}

function parsePreferenceValue(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function runWithTableRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    logger.info('Creating user_preferences table on first access', {}, 'USER_PREFERENCES_QUERIES');
    await ensureTable();
    return fn();
  }
}

async function getPreferencesForUser(userKey) {
  if (!pool.hasStorage() || !userKey) return {};
  const normalizedKey = String(userKey).trim().toLowerCase();
  const result = await runWithTableRetry(() =>
    pool.query(
      'SELECT pref_key, pref_value FROM user_preferences WHERE user_key = $1',
      [normalizedKey],
      { d1: true }
    )
  );
  const prefs = {};
  for (const row of result?.rows || []) {
    if (row && row.pref_key) {
      prefs[row.pref_key] = parsePreferenceValue(row.pref_value);
    }
  }
  return prefs;
}

async function upsertPreferenceForUser(userKey, prefKey, value) {
  if (!pool.hasStorage() || !userKey || !prefKey) return null;
  const normalizedUser = String(userKey).trim().toLowerCase();
  const normalizedPref = String(prefKey).trim();
  const serialized = JSON.stringify(value);
  await runWithTableRetry(() =>
    pool.query(
      `INSERT INTO user_preferences (user_key, pref_key, pref_value, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (user_key, pref_key)
       DO UPDATE SET pref_value = EXCLUDED.pref_value, updated_at = now()`,
      [normalizedUser, normalizedPref, serialized],
      {
        d1: true,
        d1Text: `INSERT INTO user_preferences (user_key, pref_key, pref_value, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (user_key, pref_key)
         DO UPDATE SET pref_value = excluded.pref_value, updated_at = CURRENT_TIMESTAMP`,
      }
    )
  );
  return { key: normalizedPref, value };
}

async function deletePreferenceForUser(userKey, prefKey) {
  if (!pool.hasStorage() || !userKey || !prefKey) return false;
  const normalizedUser = String(userKey).trim().toLowerCase();
  const normalizedPref = String(prefKey).trim();
  await runWithTableRetry(() =>
    pool.query(
      'DELETE FROM user_preferences WHERE user_key = $1 AND pref_key = $2',
      [normalizedUser, normalizedPref],
      { d1: true }
    )
  );
  return true;
}

module.exports = {
  getPreferencesForUser,
  upsertPreferenceForUser,
  deletePreferenceForUser,
};

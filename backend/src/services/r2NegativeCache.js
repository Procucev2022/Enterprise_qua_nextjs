/**
 * In-isolate bounded negative cache for Cloudflare R2 object keys.
 *
 * Repeated reads for a missing object key emit `r2_get ERROR: The specified key
 * does not exist.` telemetry spans on every Worker request. Caching missing keys
 * for a short TTL suppresses repeat R2 lookups and is invalidated on writes.
 */

const MISSING_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_MISSING_KEY_CACHE_ENTRIES = 1000;

const missingKeyCache = new Map();

function isMissingObjectError(err) {
  if (!err) return false;
  const status = err.$metadata && err.$metadata.httpStatusCode;
  const code = err.name || err.Code || err.code;
  return (
    code === 'NoSuchKey' ||
    status === 404 ||
    /specified key does not exist|nosuchkey/i.test(String(err.message || ''))
  );
}

function isKeyKnownMissing(key, now = Date.now()) {
  if (!key) return false;
  const expiresAt = missingKeyCache.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    missingKeyCache.delete(key);
    return false;
  }
  return true;
}

function markKeyMissing(key, now = Date.now()) {
  if (!key) return;
  if (missingKeyCache.size >= MAX_MISSING_KEY_CACHE_ENTRIES && !missingKeyCache.has(key)) {
    const oldestKey = missingKeyCache.keys().next().value;
    missingKeyCache.delete(oldestKey);
  }
  missingKeyCache.set(key, now + MISSING_KEY_CACHE_TTL_MS);
}

function clearMissingKey(key) {
  if (key) missingKeyCache.delete(key);
}

function resetMissingKeyCache() {
  missingKeyCache.clear();
}

async function getFromBinding(binding, key) {
  if (isKeyKnownMissing(key)) return null;
  try {
    const object = await binding.get(key);
    if (!object) {
      markKeyMissing(key);
      return null;
    }
    clearMissingKey(key);
    return object;
  } catch (err) {
    if (isMissingObjectError(err)) {
      markKeyMissing(key);
      return null;
    }
    throw err;
  }
}

async function putToBinding(binding, key, body, options) {
  clearMissingKey(key);
  return binding.put(key, body, options);
}

async function deleteFromBinding(binding, key) {
  const result = await binding.delete(key);
  markKeyMissing(key);
  return result;
}

module.exports = {
  MISSING_KEY_CACHE_TTL_MS,
  MAX_MISSING_KEY_CACHE_ENTRIES,
  isMissingObjectError,
  isKeyKnownMissing,
  markKeyMissing,
  clearMissingKey,
  resetMissingKeyCache,
  getFromBinding,
  putToBinding,
  deleteFromBinding,
};

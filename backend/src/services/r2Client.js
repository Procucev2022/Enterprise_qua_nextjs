const { S3Client } = require('@aws-sdk/client-s3');

let client;
let clientInitialized = false;

/**
 * Returns the native R2 bucket binding (env.R2_BUCKET) when running on
 * Workers with it configured, else null — same globalThis.__CF_ENV__ pattern
 * d1Bridge.js's getD1Binding() uses, since worker.mjs stashes the whole env
 * object there once. Callers prefer this over getClient() when available:
 * `new S3Client(...)` throws `emitWarningIfUnsupportedVersion$1 is not a
 * function` under Workers (esbuild resolves @aws-sdk/core/client's "browser"
 * export condition instead of "node" even with nodejs_compat on, and that
 * build's stub doesn't survive bundling intact) — confirmed live against the
 * deployed Worker. Cloudflare's own guidance is to use bindings over REST
 * APIs for its own services anyway, so this is the primary path on Workers,
 * not just a workaround.
 */
function getBinding() {
  try {
    const env = globalThis.__CF_ENV__;
    return (env && env.R2_BUCKET) || null;
  } catch {
    return null;
  }
}

/**
 * Lazily builds an S3 client pointed at Cloudflare R2's S3-compatible
 * endpoint, for Node/Render, where there's no Workers binding to use instead.
 * Returns undefined if any required env var is unset, so callers can fail
 * closed instead of throwing when R2 isn't configured.
 *
 * Deliberately not called at all on Workers (see getBinding() above) — the
 * S3Client constructor itself throws there.
 */
function getClient() {
  if (clientInitialized) return client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return undefined;

  client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  // Only cache once construction actually succeeds — marking this true
  // unconditionally on the first call meant a failed construction (as
  // happened on Workers before getBinding() existed) permanently short-
  // circuited every later call in the same isolate to "R2 isn't configured"
  // instead of surfacing the real error again.
  clientInitialized = true;
  return client;
}

function isConfigured() {
  return Boolean(getBinding()) || Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

function bucket() {
  return process.env.R2_BUCKET;
}

module.exports = {
  getBinding,
  getClient,
  isConfigured,
  bucket,
};

const { S3Client } = require('@aws-sdk/client-s3');

let client;
let clientInitialized = false;
let nativeBucket = null;

/**
 * Lazily builds an S3 client pointed at Cloudflare R2's S3-compatible endpoint.
 * Returns undefined if any required env var is unset, so callers can fail
 * closed instead of throwing when R2 isn't configured.
 */
function getClient() {
  if (clientInitialized) return client;
  clientInitialized = true;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return undefined;

  client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

function setNativeBucket(binding) {
  nativeBucket = binding;
}

function getNativeBucket() {
  return nativeBucket;
}

function isConfigured(env = process.env) {
  if (nativeBucket || (env && env.R2_BUCKET && typeof env.R2_BUCKET.put === 'function')) {
    return true;
  }
  return Boolean(env && env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

function bucket() {
  if (nativeBucket && nativeBucket.name) {
    return nativeBucket.name;
  }
  return process.env.R2_BUCKET;
}

module.exports = {
  getClient,
  isConfigured,
  bucket,
  setNativeBucket,
  getNativeBucket,
};

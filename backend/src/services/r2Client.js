const { S3Client } = require('@aws-sdk/client-s3');

let client;
let clientInitialized = false;

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

function isConfigured() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

function bucket() {
  return process.env.R2_BUCKET;
}

module.exports = {
  getClient,
  isConfigured,
  bucket,
};

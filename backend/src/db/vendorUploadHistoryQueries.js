const crypto = require('crypto');
const pool = require('./pool');
const { logger } = require('../services/loggerService');
const { VENDOR_UPLOAD_HISTORY_CONFIG } = require('../config/constants');

const PG_CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS vendor_upload_history (
  id VARCHAR(64) PRIMARY KEY,
  owner_key VARCHAR(320) NOT NULL,
  buyer_id VARCHAR(64),
  buyer_email VARCHAR(320),
  role VARCHAR(32) NOT NULL DEFAULT 'buyer',
  file_name VARCHAR(512) NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  onboarding_failed_count INTEGER NOT NULL DEFAULT 0,
  onboarding_skipped_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
  records_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

const D1_CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS vendor_upload_history (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  buyer_id TEXT,
  buyer_email TEXT,
  role TEXT NOT NULL DEFAULT 'buyer',
  file_name TEXT NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  onboarding_failed_count INTEGER NOT NULL DEFAULT 0,
  onboarding_skipped_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  records_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

function isMissingTableError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return err?.code === '42P01' || msg.includes('no such table') || msg.includes('does not exist');
}

async function runWithTableRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    logger.info('Creating vendor_upload_history table on first access', {}, 'VENDOR_UPLOAD_HISTORY_QUERIES');
    await pool.query(PG_CREATE_TABLE_SQL, [], { d1: true, d1Text: D1_CREATE_TABLE_SQL });
    return fn();
  }
}

function parseRecordsJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapRowToHistoryEntry(row) {
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || '');
  return {
    id: row.id,
    fileName: row.file_name,
    timestamp: createdAt,
    createdAt,
    total: Number(row.total_count) || 0,
    imported: Number(row.imported_count) || 0,
    duplicates: Number(row.duplicate_count) || 0,
    failed: Number(row.failed_count) || 0,
    onboardingFailed: Number(row.onboarding_failed_count) || 0,
    onboardingSkipped: Number(row.onboarding_skipped_count) || 0,
    status: row.status || 'COMPLETED',
    ...(row.buyer_id ? { buyerId: row.buyer_id } : {}),
    ...(row.buyer_email ? { buyerEmail: row.buyer_email } : {}),
    role: row.role || 'buyer',
    records: parseRecordsJson(row.records_json),
  };
}

function normalizeScopeList(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((v) => String(v || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

async function listUploadHistory({ ownerKeys = [], buyerIds = [], limit = VENDOR_UPLOAD_HISTORY_CONFIG.DEFAULT_LIMIT } = {}) {
  if (!pool.hasStorage()) return [];
  const normalizedOwners = normalizeScopeList(ownerKeys);
  const normalizedBuyers = normalizeScopeList(buyerIds);
  if (normalizedOwners.length === 0 && normalizedBuyers.length === 0) return [];

  const safeLimit = Math.min(
    Math.max(Number(limit) || VENDOR_UPLOAD_HISTORY_CONFIG.DEFAULT_LIMIT, 1),
    VENDOR_UPLOAD_HISTORY_CONFIG.MAX_LIMIT
  );

  const params = [];
  const predicates = [];
  if (normalizedOwners.length > 0) {
    const start = params.length + 1;
    params.push(...normalizedOwners);
    const placeholders = normalizedOwners.map((_, idx) => `$${start + idx}`).join(', ');
    predicates.push(`lower(owner_key) IN (${placeholders})`);
  }
  if (normalizedBuyers.length > 0) {
    const start = params.length + 1;
    params.push(...normalizedBuyers);
    const placeholders = normalizedBuyers.map((_, idx) => `$${start + idx}`).join(', ');
    predicates.push(`lower(buyer_id) IN (${placeholders})`);
  }
  const limitParam = `$${params.length + 1}`;
  params.push(safeLimit);

  const sql = `SELECT id, owner_key, buyer_id, buyer_email, role, file_name,
                      total_count, imported_count, duplicate_count, failed_count,
                      onboarding_failed_count, onboarding_skipped_count, status,
                      records_json, created_at, updated_at
                 FROM vendor_upload_history
                WHERE ${predicates.join(' OR ')}
                ORDER BY created_at DESC
                LIMIT ${limitParam}`;

  const result = await runWithTableRetry(() => pool.query(sql, params, { d1: true }));
  return (result?.rows || []).map(mapRowToHistoryEntry);
}

async function upsertUploadHistory(entry) {
  if (!pool.hasStorage() || !entry || !entry.ownerKey || !entry.fileName) return null;
  const id = String(entry.id || `up-${crypto.randomUUID()}`).slice(0, 64);
  const ownerKey = String(entry.ownerKey).trim().toLowerCase();
  const buyerId = entry.buyerId ? String(entry.buyerId).trim() : null;
  const buyerEmail = entry.buyerEmail ? String(entry.buyerEmail).trim().toLowerCase() : null;
  const role = String(entry.role || 'buyer').trim();
  const fileName = String(entry.fileName).trim().slice(0, VENDOR_UPLOAD_HISTORY_CONFIG.MAX_FILENAME_LENGTH);
  const totalCount = Math.max(0, Number(entry.total) || 0);
  const importedCount = Math.max(0, Number(entry.imported) || 0);
  const duplicateCount = Math.max(0, Number(entry.duplicates) || 0);
  const failedCount = Math.max(0, Number(entry.failed) || 0);
  const onboardingFailed = Math.max(0, Number(entry.onboardingFailed) || 0);
  const onboardingSkipped = Math.max(0, Number(entry.onboardingSkipped) || 0);
  const status = String(entry.status || 'COMPLETED').trim().slice(0, 32);
  const boundedRecords = Array.isArray(entry.records)
    ? entry.records.slice(0, VENDOR_UPLOAD_HISTORY_CONFIG.MAX_RECORDS_PER_BATCH)
    : [];
  const recordsJson = JSON.stringify(boundedRecords);

  const params = [
    id,
    ownerKey,
    buyerId,
    buyerEmail,
    role,
    fileName,
    totalCount,
    importedCount,
    duplicateCount,
    failedCount,
    onboardingFailed,
    onboardingSkipped,
    status,
    recordsJson,
  ];

  const result = await runWithTableRetry(() =>
    pool.query(
      `INSERT INTO vendor_upload_history
         (id, owner_key, buyer_id, buyer_email, role, file_name,
          total_count, imported_count, duplicate_count, failed_count,
          onboarding_failed_count, onboarding_skipped_count, status, records_json,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, now(), now())
       ON CONFLICT (id)
       DO UPDATE SET
         file_name = EXCLUDED.file_name,
         total_count = EXCLUDED.total_count,
         imported_count = EXCLUDED.imported_count,
         duplicate_count = EXCLUDED.duplicate_count,
         failed_count = EXCLUDED.failed_count,
         onboarding_failed_count = EXCLUDED.onboarding_failed_count,
         onboarding_skipped_count = EXCLUDED.onboarding_skipped_count,
         status = EXCLUDED.status,
         records_json = EXCLUDED.records_json,
         updated_at = now()
       RETURNING *`,
      params,
      {
        d1: true,
        d1Text: `INSERT INTO vendor_upload_history
         (id, owner_key, buyer_id, buyer_email, role, file_name,
          total_count, imported_count, duplicate_count, failed_count,
          onboarding_failed_count, onboarding_skipped_count, status, records_json,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (id)
       DO UPDATE SET
         file_name = excluded.file_name,
         total_count = excluded.total_count,
         imported_count = excluded.imported_count,
         duplicate_count = excluded.duplicate_count,
         failed_count = excluded.failed_count,
         onboarding_failed_count = excluded.onboarding_failed_count,
         onboarding_skipped_count = excluded.onboarding_skipped_count,
         status = excluded.status,
         records_json = excluded.records_json,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      }
    )
  );

  if (result?.rows?.[0]) {
    return mapRowToHistoryEntry(result.rows[0]);
  }
  return {
    id,
    fileName,
    timestamp: new Date().toISOString(),
    total: totalCount,
    imported: importedCount,
    duplicates: duplicateCount,
    failed: failedCount,
    onboardingFailed,
    onboardingSkipped,
    status,
    ...(buyerId ? { buyerId } : {}),
    ...(buyerEmail ? { buyerEmail } : {}),
    role,
    records: boundedRecords,
  };
}

async function deleteUploadHistory({ id, fileName, ownerKeys = [], buyerIds = [] } = {}) {
  if (!pool.hasStorage() || (!id && !fileName)) return 0;
  const normalizedOwners = normalizeScopeList(ownerKeys);
  const normalizedBuyers = normalizeScopeList(buyerIds);
  if (normalizedOwners.length === 0 && normalizedBuyers.length === 0) return 0;

  const params = [];
  const scopePredicates = [];
  if (normalizedOwners.length > 0) {
    const start = params.length + 1;
    params.push(...normalizedOwners);
    const placeholders = normalizedOwners.map((_, idx) => `$${start + idx}`).join(', ');
    scopePredicates.push(`lower(owner_key) IN (${placeholders})`);
  }
  if (normalizedBuyers.length > 0) {
    const start = params.length + 1;
    params.push(...normalizedBuyers);
    const placeholders = normalizedBuyers.map((_, idx) => `$${start + idx}`).join(', ');
    scopePredicates.push(`lower(buyer_id) IN (${placeholders})`);
  }

  const targetPredicates = [];
  if (id) {
    params.push(String(id).trim());
    targetPredicates.push(`id = $${params.length}`);
  }
  if (fileName) {
    params.push(String(fileName).trim());
    targetPredicates.push(`file_name = $${params.length}`);
  }

  const sql = `DELETE FROM vendor_upload_history
                WHERE (${scopePredicates.join(' OR ')})
                  AND (${targetPredicates.join(' OR ')})`;
  const result = await runWithTableRetry(() => pool.query(sql, params, { d1: true }));
  return result?.rowCount || 0;
}

module.exports = {
  listUploadHistory,
  upsertUploadHistory,
  deleteUploadHistory,
};

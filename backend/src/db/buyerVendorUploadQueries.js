const crypto = require('crypto');
const pool = require('./pool');
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { logger } = require('../services/loggerService');
const { BUYER_VENDOR_UPLOAD_CONFIG } = require('../config/constants');

const LOG_CATEGORY = 'DATABASE_QUERY';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function firstNonEmpty(...values) {
  for (const val of values) {
    const clean = normalizeText(val);
    if (clean) return clean;
  }
  return null;
}

function firstLowerNonEmpty(...values) {
  const val = firstNonEmpty(...values);
  return val ? val.toLowerCase() : null;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function toIsoTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const str = normalizeText(value);
  if (!str) return null;
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? str : parsed.toISOString();
}

function uniqueLowerValues(values) {
  const seen = new Set();
  for (const val of values) {
    const clean = normalizeLower(val);
    if (clean) seen.add(clean);
  }
  return Array.from(seen);
}

function makePlaceholders(values, startIndex) {
  return values.map((_, idx) => `$${startIndex + idx}`).join(', ');
}

function addInFilter(clauses, params, values, buildExpr) {
  if (values.length === 0) return;
  const start = params.length + 1;
  params.push(...values);
  clauses.push(buildExpr(makePlaceholders(values, start)));
}

function invalidateUploadCaches() {
  queryCache.invalidate(BUYER_VENDOR_UPLOAD_CONFIG.CACHE_TAG);
  queryCache.invalidate('vendors');
  queryCache.invalidate('buyer_accounts');
}

function normalizeUploadRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const buyerId = firstNonEmpty(record.buyerId, record.buyer_id);
  const vendorId = firstNonEmpty(record.vendorId, record.vendor_id);
  if (!buyerId || !vendorId) return null;

  const uploadedAt = toIsoTimestamp(record.uploadedAt || record.uploaded_at || record.uploadDate) || new Date().toISOString();
  return {
    id: firstNonEmpty(record.id) || `bvu-${crypto.randomUUID()}`,
    buyerId,
    vendorId,
    buyerName: firstNonEmpty(record.buyerName, record.buyer_name),
    buyerCompany: firstNonEmpty(record.buyerCompany, record.buyer_company),
    buyerEmail: firstLowerNonEmpty(record.buyerEmail, record.buyer_email),
    vendorName: firstNonEmpty(record.vendorName, record.vendor_name),
    vendorEmail: firstLowerNonEmpty(record.vendorEmail, record.vendor_email),
    uploadSource: firstNonEmpty(record.uploadSource, record.upload_source) || BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_SOURCE,
    status: normalizeText(record.status) || BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_STATUS,
    uploadedAt,
  };
}

function formatLocation(parts) {
  const unique = [];
  for (const part of parts) {
    const clean = normalizeText(part);
    if (clean && !unique.some((existing) => existing.toLowerCase() === clean.toLowerCase())) {
      unique.push(clean);
    }
  }
  return unique.length > 0 ? unique.join(', ') : null;
}

function pickEarliestOrLatestIso(existingIso, candidateIso) {
  if (!existingIso) return candidateIso || null;
  if (!candidateIso) return existingIso;
  const a = new Date(existingIso).getTime();
  const b = new Date(candidateIso).getTime();
  if (Number.isNaN(a)) return candidateIso;
  if (Number.isNaN(b)) return existingIso;
  return b >= a ? candidateIso : existingIso;
}

function mergeMissingFields(existing, incoming, fields) {
  const merged = { ...existing };
  for (const field of fields) {
    if (!merged[field] && incoming[field]) {
      merged[field] = incoming[field];
    }
  }
  return merged;
}

async function safeQuery(sql, params, options, operation) {
  try {
    const res = await pool.query(sql, params, options);
    return res && Array.isArray(res.rows) ? res.rows : [];
  } catch (error) {
    logger.warn('Optional buyer-vendor relationship query skipped after database error', {
      error: error && error.message ? error.message : String(error),
      operation,
    }, LOG_CATEGORY);
    return [];
  }
}

async function recordBuyerVendorUploadInDB(record) {
  if (!pool.hasStorage()) return null;
  const normalized = normalizeUploadRecord(record);
  if (!normalized) return null;

  try {
    const result = await pool.query(
      `INSERT INTO buyer_vendor_uploads
         (id, buyer_id, vendor_id, buyer_name, buyer_company, buyer_email, vendor_name, vendor_email, upload_source, status, uploaded_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, now(), now())
       ON CONFLICT (buyer_id, vendor_id) DO UPDATE SET
         buyer_name = COALESCE(NULLIF(EXCLUDED.buyer_name, ''), buyer_vendor_uploads.buyer_name),
         buyer_company = COALESCE(NULLIF(EXCLUDED.buyer_company, ''), buyer_vendor_uploads.buyer_company),
         buyer_email = COALESCE(NULLIF(EXCLUDED.buyer_email, ''), buyer_vendor_uploads.buyer_email),
         vendor_name = COALESCE(NULLIF(EXCLUDED.vendor_name, ''), buyer_vendor_uploads.vendor_name),
         vendor_email = COALESCE(NULLIF(EXCLUDED.vendor_email, ''), buyer_vendor_uploads.vendor_email),
         upload_source = COALESCE(NULLIF(EXCLUDED.upload_source, ''), buyer_vendor_uploads.upload_source),
         status = COALESCE(NULLIF(EXCLUDED.status, ''), buyer_vendor_uploads.status),
         updated_at = now()
       RETURNING *`,
      [
        normalized.id,
        normalized.buyerId,
        normalized.vendorId,
        normalized.buyerName,
        normalized.buyerCompany,
        normalized.buyerEmail,
        normalized.vendorName,
        normalized.vendorEmail,
        normalized.uploadSource,
        normalized.status,
        normalized.uploadedAt,
      ],
      {
        d1: true,
        d1Text: `INSERT INTO buyer_vendor_uploads
         (id, buyer_id, vendor_id, buyer_name, buyer_company, buyer_email, vendor_name, vendor_email, upload_source, status, uploaded_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (buyer_id, vendor_id) DO UPDATE SET
         buyer_name = COALESCE(NULLIF(excluded.buyer_name, ''), buyer_vendor_uploads.buyer_name),
         buyer_company = COALESCE(NULLIF(excluded.buyer_company, ''), buyer_vendor_uploads.buyer_company),
         buyer_email = COALESCE(NULLIF(excluded.buyer_email, ''), buyer_vendor_uploads.buyer_email),
         vendor_name = COALESCE(NULLIF(excluded.vendor_name, ''), buyer_vendor_uploads.vendor_name),
         vendor_email = COALESCE(NULLIF(excluded.vendor_email, ''), buyer_vendor_uploads.vendor_email),
         upload_source = COALESCE(NULLIF(excluded.upload_source, ''), buyer_vendor_uploads.upload_source),
         status = COALESCE(NULLIF(excluded.status, ''), buyer_vendor_uploads.status),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      }
    );
    invalidateUploadCaches();
    return (result && result.rows && result.rows[0]) || normalized;
  } catch (error) {
    logger.error('Failed to persist buyer-vendor upload relationship', {
      error,
      operation: 'record-buyer-vendor-upload',
      buyerId: normalized.buyerId,
      vendorId: normalized.vendorId,
    }, LOG_CATEGORY);
    return null;
  }
}

async function bulkRecordBuyerVendorUploadsInDB(records = []) {
  if (!pool.hasStorage() || !Array.isArray(records) || records.length === 0) return [];
  const dedupedMap = new Map();
  for (const record of records) {
    const normalized = normalizeUploadRecord(record);
    if (!normalized) continue;
    const key = `${normalizeLower(normalized.buyerId)}|${normalizeLower(normalized.vendorId)}`;
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, normalized);
    }
  }
  const uniqueRecords = Array.from(dedupedMap.values());
  if (uniqueRecords.length === 0) return [];

  try {
    const d1 = d1Bridge.getD1Binding() || d1Bridge.getD1HttpClient();
    if (d1) {
      const sql = `INSERT INTO buyer_vendor_uploads
         (id, buyer_id, vendor_id, buyer_name, buyer_company, buyer_email, vendor_name, vendor_email, upload_source, status, uploaded_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (buyer_id, vendor_id) DO UPDATE SET
         buyer_name = COALESCE(NULLIF(excluded.buyer_name, ''), buyer_vendor_uploads.buyer_name),
         buyer_company = COALESCE(NULLIF(excluded.buyer_company, ''), buyer_vendor_uploads.buyer_company),
         buyer_email = COALESCE(NULLIF(excluded.buyer_email, ''), buyer_vendor_uploads.buyer_email),
         vendor_name = COALESCE(NULLIF(excluded.vendor_name, ''), buyer_vendor_uploads.vendor_name),
         vendor_email = COALESCE(NULLIF(excluded.vendor_email, ''), buyer_vendor_uploads.vendor_email),
         upload_source = COALESCE(NULLIF(excluded.upload_source, ''), buyer_vendor_uploads.upload_source),
         status = COALESCE(NULLIF(excluded.status, ''), buyer_vendor_uploads.status),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`;
      const allRows = [];
      for (let i = 0; i < uniqueRecords.length; i += BUYER_VENDOR_UPLOAD_CONFIG.D1_BATCH_SIZE) {
        const chunk = uniqueRecords.slice(i, i + BUYER_VENDOR_UPLOAD_CONFIG.D1_BATCH_SIZE);
        const statements = chunk.map((rec) => ({
          text: sql,
          params: [
            rec.id,
            rec.buyerId,
            rec.vendorId,
            rec.buyerName,
            rec.buyerCompany,
            rec.buyerEmail,
            rec.vendorName,
            rec.vendorEmail,
            rec.uploadSource,
            rec.status,
            rec.uploadedAt,
          ],
        }));
        const results = await d1Bridge.batchD1(d1, statements);
        for (const r of results) {
          if (r && Array.isArray(r.rows)) allRows.push(...r.rows);
        }
      }
      invalidateUploadCaches();
      return allRows;
    }

    const values = [];
    const placeholders = [];
    uniqueRecords.forEach((rec, i) => {
      const base = i * 11;
      values.push(
        rec.id,
        rec.buyerId,
        rec.vendorId,
        rec.buyerName,
        rec.buyerCompany,
        rec.buyerEmail,
        rec.vendorName,
        rec.vendorEmail,
        rec.uploadSource,
        rec.status,
        rec.uploadedAt
      );
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}::timestamptz, now(), now())`
      );
    });

    const result = await pool.query(
      `INSERT INTO buyer_vendor_uploads
         (id, buyer_id, vendor_id, buyer_name, buyer_company, buyer_email, vendor_name, vendor_email, upload_source, status, uploaded_at, created_at, updated_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (buyer_id, vendor_id) DO UPDATE SET
         buyer_name = COALESCE(NULLIF(EXCLUDED.buyer_name, ''), buyer_vendor_uploads.buyer_name),
         buyer_company = COALESCE(NULLIF(EXCLUDED.buyer_company, ''), buyer_vendor_uploads.buyer_company),
         buyer_email = COALESCE(NULLIF(EXCLUDED.buyer_email, ''), buyer_vendor_uploads.buyer_email),
         vendor_name = COALESCE(NULLIF(EXCLUDED.vendor_name, ''), buyer_vendor_uploads.vendor_name),
         vendor_email = COALESCE(NULLIF(EXCLUDED.vendor_email, ''), buyer_vendor_uploads.vendor_email),
         upload_source = COALESCE(NULLIF(EXCLUDED.upload_source, ''), buyer_vendor_uploads.upload_source),
         status = COALESCE(NULLIF(EXCLUDED.status, ''), buyer_vendor_uploads.status),
         updated_at = now()
       RETURNING *`,
      values
    );
    invalidateUploadCaches();
    return (result && result.rows) || uniqueRecords;
  } catch (error) {
    logger.error('Failed to bulk-persist buyer-vendor upload relationships', {
      error,
      operation: 'bulk-record-buyer-vendor-uploads',
      count: uniqueRecords.length,
    }, LOG_CATEGORY);
    return [];
  }
}

async function resolveBuyerAliases(buyerId, knownBuyer = null) {
  const idList = [buyerId, knownBuyer?.id, knownBuyer?.organizationId, knownBuyer?.userId];
  const emailList = [knownBuyer?.corporateEmail, knownBuyer?.email];
  if (normalizeText(buyerId).includes('@')) {
    emailList.push(buyerId);
  }

  let organizationId = normalizeText(knownBuyer?.organizationId || knownBuyer?.id) || null;
  let companyName = normalizeText(knownBuyer?.organizationName) || null;

  if (pool.hasStorage()) {
    const initialIds = uniqueLowerValues(idList);
    const initialEmails = uniqueLowerValues(emailList);

    if (initialIds.length > 0 || initialEmails.length > 0) {
      const clauses = [];
      const params = [];
      addInFilter(clauses, params, initialIds, (ph) => `lower(id) IN (${ph})`);
      addInFilter(clauses, params, initialEmails, (ph) => `lower(corporate_email) IN (${ph})`);

      const buyerRows = await safeQuery(
        `SELECT id, corporate_email, raw FROM buyer_accounts WHERE ${clauses.join(' OR ')}`,
        params,
        { d1: true },
        'resolve-buyer-account-aliases'
      );
      for (const row of buyerRows) {
        const raw = parseJsonObject(row.raw);
        idList.push(row.id, raw.id, raw.organizationId, raw.userId);
        emailList.push(row.corporate_email, raw.corporateEmail, raw.email);
        if (!organizationId && raw.organizationId) organizationId = normalizeText(raw.organizationId);
        if (!companyName && raw.organizationName) companyName = normalizeText(raw.organizationName);
      }

      const idClauses = [];
      const orgParams = [];
      addInFilter(
        idClauses,
        orgParams,
        uniqueLowerValues(idList),
        (ph) => `lower(o.uuid) IN (${ph}) OR lower(u.uuid) IN (${ph})`
      );
      addInFilter(
        idClauses,
        orgParams,
        uniqueLowerValues(emailList),
        (ph) => `lower(u.username) IN (${ph}) OR lower(o.email) IN (${ph})`
      );
      const orgRows = await safeQuery(
        `SELECT o.uuid AS org_uuid, o.organization_name, o.email AS org_email, u.uuid AS user_uuid, u.username
           FROM organization o
           LEFT JOIN "user" u ON u.org_uuid = o.uuid
          WHERE ${idClauses.join(' OR ')}
          LIMIT 10`,
        orgParams,
        { d1: true },
        'resolve-organization-aliases'
      );
      for (const row of orgRows) {
        idList.push(row.org_uuid, row.user_uuid);
        emailList.push(row.org_email, row.username);
        if (!organizationId && row.org_uuid) organizationId = normalizeText(row.org_uuid);
        if (!companyName && row.organization_name) companyName = normalizeText(row.organization_name);
      }
    }
  }

  return {
    buyerIds: uniqueLowerValues(idList),
    emails: uniqueLowerValues(emailList),
    organizationId,
    companyName,
  };
}

function buildUploadedVendorItem(vendorRaw, vendorCreatedAt, uploadRow = null) {
  const v = vendorRaw && typeof vendorRaw === 'object' ? vendorRaw : {};
  const vendorId = firstNonEmpty(v.id, uploadRow?.vendor_id) || '';
  const email = firstNonEmpty(v.email, v.corporateEmail, uploadRow?.vendor_email);
  const vendorName = firstNonEmpty(v.name, uploadRow?.vendor_name);
  const companyName = firstNonEmpty(v.companyName, v.name, uploadRow?.vendor_name);
  const uploadDate = toIsoTimestamp(
    uploadRow?.uploaded_at || uploadRow?.created_at || v.uploadedAt || v.createdAt || v.created_at || vendorCreatedAt
  );

  return {
    id: firstNonEmpty(uploadRow?.id) || `bvu-${vendorId || email}`,
    vendorId,
    vendorName,
    companyName,
    contactPerson: firstNonEmpty(v.contactPerson),
    email,
    phone: firstNonEmpty(v.phone, v.mobile),
    location: formatLocation([v.location, v.city, v.state, v.country]),
    majorCategory: firstNonEmpty(v.majorCategory, v.category),
    uploadSource: firstNonEmpty(uploadRow?.upload_source, v.source) || BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_SOURCE,
    uploadDate,
    status: firstNonEmpty(v.verificationStatus, v.status, uploadRow?.status),
  };
}

async function getUploadedVendorsByBuyerFromDB(buyerId, { limit = BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_LIMIT, knownBuyer = null } = {}) {
  if (!pool.hasStorage()) return [];
  const safeLimit = Math.min(Math.max(1, Number(limit) || BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_LIMIT), BUYER_VENDOR_UPLOAD_CONFIG.MAX_LIMIT);
  const aliases = await resolveBuyerAliases(buyerId, knownBuyer);
  if (aliases.buyerIds.length === 0 && aliases.emails.length === 0) return [];

  const cacheKey = queryCache.generateKey('buyer_uploaded_vendors', [
    aliases.buyerIds.join(','),
    aliases.emails.join(','),
    safeLimit,
  ]);
  const cached = queryCache.get(cacheKey, []);
  if (cached) return cached;

  // 1. Explicit junction table records
  const bvuClauses = [];
  const bvuParams = [];
  addInFilter(bvuClauses, bvuParams, aliases.buyerIds, (ph) => `lower(bvu.buyer_id) IN (${ph})`);
  addInFilter(bvuClauses, bvuParams, aliases.emails, (ph) => `lower(bvu.buyer_email) IN (${ph})`);
  const bvuLimitIdx = bvuParams.length + 1;
  bvuParams.push(safeLimit);

  const junctionPromise = bvuClauses.length > 0
    ? safeQuery(
        `SELECT bvu.id, bvu.buyer_id, bvu.vendor_id, bvu.vendor_name, bvu.vendor_email,
                bvu.upload_source, bvu.status, bvu.uploaded_at, bvu.created_at,
                v.raw AS vendor_raw, v.created_at AS vendor_created_at
           FROM buyer_vendor_uploads bvu
           LEFT JOIN vendors v ON lower(v.id) = lower(bvu.vendor_id)
          WHERE ${bvuClauses.join(' OR ')}
          ORDER BY bvu.uploaded_at DESC
          LIMIT $${bvuLimitIdx}`,
        bvuParams,
        { d1: true },
        'fetch-buyer-vendor-uploads-by-buyer'
      )
    : Promise.resolve([]);

  // 2. Direct vendors table attribution (buyerId, buyerAccountId, buyerEmail, mappedBuyerIds, buyerIds)
  const vPgClauses = [];
  const vD1Clauses = [];
  const vParams = [];
  if (aliases.buyerIds.length > 0) {
    const start = vParams.length + 1;
    vParams.push(...aliases.buyerIds);
    const ph = makePlaceholders(aliases.buyerIds, start);
    vPgClauses.push(
      `lower(raw->>'buyerId') IN (${ph})`,
      `lower(raw->>'buyerAccountId') IN (${ph})`,
      `EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(raw->'mappedBuyerIds') = 'array' THEN raw->'mappedBuyerIds' ELSE '[]'::jsonb END) e WHERE lower(e) IN (${ph}))`,
      `EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(raw->'buyerIds') = 'array' THEN raw->'buyerIds' ELSE '[]'::jsonb END) e WHERE lower(e) IN (${ph}))`
    );
    vD1Clauses.push(
      `lower(json_extract(raw, '$.buyerId')) IN (${ph})`,
      `lower(json_extract(raw, '$.buyerAccountId')) IN (${ph})`,
      `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(raw, '$.mappedBuyerIds') = 'array' THEN json_extract(raw, '$.mappedBuyerIds') ELSE '[]' END) WHERE lower(value) IN (${ph}))`,
      `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_type(raw, '$.buyerIds') = 'array' THEN json_extract(raw, '$.buyerIds') ELSE '[]' END) WHERE lower(value) IN (${ph}))`
    );
  }
  if (aliases.emails.length > 0) {
    const start = vParams.length + 1;
    vParams.push(...aliases.emails);
    const ph = makePlaceholders(aliases.emails, start);
    vPgClauses.push(`lower(raw->>'buyerEmail') IN (${ph})`);
    vD1Clauses.push(`lower(json_extract(raw, '$.buyerEmail')) IN (${ph})`);
  }
  const vLimitIdx = vParams.length + 1;
  vParams.push(safeLimit);

  const vendorsPromise = vPgClauses.length > 0
    ? safeQuery(
        `SELECT id, created_at, raw FROM vendors WHERE ${vPgClauses.join(' OR ')} ORDER BY created_at DESC LIMIT $${vLimitIdx}`,
        vParams,
        {
          d1: true,
          d1Text: `SELECT id, created_at, raw FROM vendors WHERE ${vD1Clauses.join(' OR ')} ORDER BY created_at DESC LIMIT $${vLimitIdx}`,
        },
        'fetch-vendors-owned-by-buyer'
      )
    : Promise.resolve([]);

  // 3. Empanelled vendor_category_mappings linked to this buyer organization
  const vcmPromise = aliases.buyerIds.length > 0
    ? safeQuery(
        `SELECT vcm.id, vcm.organization_id, vcm.vendor_id, vcm.company_name, vcm.email,
                vcm.source, vcm.status, vcm.created_at, v.raw AS vendor_raw, v.created_at AS vendor_created_at
           FROM vendor_category_mappings vcm
           JOIN vendors v ON lower(v.id) = lower(vcm.vendor_id)
          WHERE vcm.vendor_id IS NOT NULL
            AND lower(vcm.organization_id) IN (${makePlaceholders(aliases.buyerIds, 1)})
          ORDER BY vcm.created_at DESC
          LIMIT $${aliases.buyerIds.length + 1}`,
        [...aliases.buyerIds, safeLimit],
        { d1: true },
        'fetch-empanelled-vendors-by-buyer'
      )
    : Promise.resolve([]);

  const [junctionRows, directVendorRows, mappingRows] = await Promise.all([
    junctionPromise,
    vendorsPromise,
    vcmPromise,
  ]);

  const deduped = new Map();
  const vendorMergeFields = [
    'vendorName',
    'companyName',
    'contactPerson',
    'email',
    'phone',
    'location',
    'majorCategory',
    'uploadSource',
    'status',
  ];
  const upsertEntry = (item) => {
    const key = normalizeLower(item.vendorId) || (item.email ? `email:${normalizeLower(item.email)}` : '');
    if (!key) return;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      return;
    }
    deduped.set(key, {
      ...mergeMissingFields(existing, item, vendorMergeFields),
      uploadDate: pickEarliestOrLatestIso(existing.uploadDate, item.uploadDate),
    });
  };

  for (const row of junctionRows) {
    const vRaw = parseJsonObject(row.vendor_raw);
    if (!vRaw.id && row.vendor_id) vRaw.id = row.vendor_id;
    upsertEntry(buildUploadedVendorItem(vRaw, row.vendor_created_at, row));
  }

  for (const row of directVendorRows) {
    const vRaw = parseJsonObject(row.raw);
    if (!vRaw.id && row.id) vRaw.id = row.id;
    upsertEntry(buildUploadedVendorItem(vRaw, row.created_at, null));
  }

  for (const row of mappingRows) {
    const vRaw = parseJsonObject(row.vendor_raw);
    if (!vRaw.id && row.vendor_id) vRaw.id = row.vendor_id;
    upsertEntry(buildUploadedVendorItem(vRaw, row.vendor_created_at, {
      id: row.id,
      vendor_id: row.vendor_id,
      vendor_name: row.company_name,
      vendor_email: row.email,
      upload_source: row.source || 'vendor_master_ingestion',
      status: row.status,
      uploaded_at: row.created_at,
    }));
  }

  const items = Array.from(deduped.values())
    .map((item) => {
      const resolvedVendorName = item.vendorName || item.email || item.vendorId;
      return {
        ...item,
        vendorName: resolvedVendorName,
        companyName: item.companyName || resolvedVendorName,
      };
    })
    .sort((a, b) => new Date(b.uploadDate || 0).getTime() - new Date(a.uploadDate || 0).getTime())
    .slice(0, safeLimit);

  queryCache.set(cacheKey, [], items, {
    ttlMs: BUYER_VENDOR_UPLOAD_CONFIG.CACHE_TTL_MS,
    tag: BUYER_VENDOR_UPLOAD_CONFIG.CACHE_TAG,
  });
  return items;
}

async function hydrateBuyerMetadataMap(buyerKeys) {
  const idList = uniqueLowerValues(buyerKeys.ids || []);
  const emailList = uniqueLowerValues(buyerKeys.emails || []);
  const companyList = uniqueLowerValues(buyerKeys.companies || []);

  const byId = new Map();
  const byEmail = new Map();
  const byCompany = new Map();

  if (!pool.hasStorage() || (idList.length === 0 && emailList.length === 0 && companyList.length === 0)) {
    return { byId, byEmail, byCompany };
  }

  const baClauses = [];
  const baD1Clauses = [];
  const baParams = [];
  if (idList.length > 0) {
    const ph = makePlaceholders(idList, 1);
    baParams.push(...idList);
    baClauses.push(`lower(id) IN (${ph}) OR lower(raw->>'organizationId') IN (${ph})`);
    baD1Clauses.push(`lower(id) IN (${ph}) OR lower(json_extract(raw, '$.organizationId')) IN (${ph})`);
  }
  addInFilter(baClauses, baParams, emailList, (ph) => `lower(corporate_email) IN (${ph})`);
  if (emailList.length > 0) {
    baD1Clauses.push(`lower(corporate_email) IN (${makePlaceholders(emailList, idList.length + 1)})`);
  }
  addInFilter(baClauses, baParams, companyList, (ph) => `lower(raw->>'organizationName') IN (${ph})`);
  if (companyList.length > 0) {
    baD1Clauses.push(`lower(json_extract(raw, '$.organizationName')) IN (${makePlaceholders(companyList, idList.length + emailList.length + 1)})`);
  }

  const baRows = await safeQuery(
    `SELECT id, corporate_email, status, created_at, raw FROM buyer_accounts WHERE ${baClauses.join(' OR ')}`,
    baParams,
    {
      d1: true,
      d1Text: `SELECT id, corporate_email, status, created_at, raw FROM buyer_accounts WHERE ${baD1Clauses.join(' OR ')}`,
    },
    'hydrate-buyer-accounts-metadata'
  );

  for (const row of baRows) {
    const raw = parseJsonObject(row.raw);
    const entry = {
      buyerId: firstNonEmpty(row.id, raw.id) || '',
      organizationId: firstNonEmpty(raw.organizationId, row.id),
      buyerName: firstNonEmpty(raw.contactPerson),
      companyName: firstNonEmpty(raw.organizationName),
      corporateEmail: firstNonEmpty(row.corporate_email, raw.corporateEmail),
      mobileNumber: firstNonEmpty(raw.mobileNumber),
      location: formatLocation([raw.primaryPlantLocation, raw.city, raw.state, raw.country]),
      gstin: firstNonEmpty(raw.gstin),
      sourcingMode: firstNonEmpty(raw.sourcingMode),
      status: firstNonEmpty(row.status, raw.status),
      createdAt: toIsoTimestamp(raw.createdDate || row.created_at),
    };
    if (entry.buyerId) byId.set(normalizeLower(entry.buyerId), entry);
    if (entry.organizationId) byId.set(normalizeLower(entry.organizationId), entry);
    if (entry.corporateEmail) byEmail.set(normalizeLower(entry.corporateEmail), entry);
    if (entry.companyName) byCompany.set(normalizeLower(entry.companyName), entry);
  }

  // Also hydrate from `organization` + `"user"` tables when buyers signed up via identity DB
  const orgClauses = [];
  const orgParams = [];
  addInFilter(orgClauses, orgParams, idList, (ph) => `lower(o.uuid) IN (${ph}) OR lower(u.uuid) IN (${ph})`);
  addInFilter(orgClauses, orgParams, emailList, (ph) => `lower(u.username) IN (${ph}) OR lower(o.email) IN (${ph})`);
  addInFilter(orgClauses, orgParams, companyList, (ph) => `lower(o.organization_name) IN (${ph})`);

  const orgRows = await safeQuery(
    `SELECT o.uuid AS org_uuid, o.organization_name, o.contact_person, o.email AS org_email,
            o.organization_phonenumber, o.city, o.state, o.country, o.gstin, o.created_ts,
            u.uuid AS user_uuid, u.username, u.full_name, u.phone
       FROM organization o
       LEFT JOIN "user" u ON u.org_uuid = o.uuid
      WHERE ${orgClauses.join(' OR ')}
      LIMIT 100`,
    orgParams,
    { d1: true },
    'hydrate-organization-metadata'
  );
  for (const row of orgRows) {
    const existing = byId.get(normalizeLower(row.org_uuid)) || byEmail.get(normalizeLower(row.username || row.org_email)) || {};
    const merged = {
      buyerId: existing.buyerId || normalizeText(row.org_uuid),
      organizationId: normalizeText(row.org_uuid) || existing.organizationId || null,
      buyerName: existing.buyerName || firstNonEmpty(row.contact_person, row.full_name),
      companyName: existing.companyName || firstNonEmpty(row.organization_name),
      corporateEmail: existing.corporateEmail || firstNonEmpty(row.username, row.org_email),
      mobileNumber: existing.mobileNumber || firstNonEmpty(row.organization_phonenumber, row.phone),
      location: existing.location || formatLocation([row.city, row.state, row.country]),
      gstin: existing.gstin || firstNonEmpty(row.gstin),
      sourcingMode: existing.sourcingMode || null,
      status: existing.status || 'ACTIVE_VERIFIED',
      createdAt: existing.createdAt || toIsoTimestamp(row.created_ts),
    };
    if (row.org_uuid) byId.set(normalizeLower(row.org_uuid), merged);
    if (row.user_uuid) byId.set(normalizeLower(row.user_uuid), merged);
    if (merged.buyerId) byId.set(normalizeLower(merged.buyerId), merged);
    if (merged.corporateEmail) byEmail.set(normalizeLower(merged.corporateEmail), merged);
    if (merged.companyName) byCompany.set(normalizeLower(merged.companyName), merged);
  }

  return { byId, byEmail, byCompany };
}

async function getBuyerUploadsByVendorFromDB(vendorIdOrEmail, { limit = BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_LIMIT, knownVendor = null } = {}) {
  if (!pool.hasStorage()) return null;
  const safeLimit = Math.min(Math.max(1, Number(limit) || BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_LIMIT), BUYER_VENDOR_UPLOAD_CONFIG.MAX_LIMIT);

  let vendor = knownVendor;
  let vendorCreatedAt = knownVendor?.created_at || knownVendor?.createdAt || null;
  if (!vendor && vendorIdOrEmail) {
    const key = normalizeText(vendorIdOrEmail);
    const vRows = await safeQuery(
      `SELECT id, created_at, raw FROM vendors WHERE lower(id) = lower($1) OR lower(email) = lower($1) LIMIT 1`,
      [key],
      { d1: true },
      'resolve-vendor-for-buyer-uploads'
    );
    if (vRows[0]) {
      vendor = parseJsonObject(vRows[0].raw);
      if (!vendor.id) vendor.id = vRows[0].id;
      vendorCreatedAt = vRows[0].created_at;
    }
  }

  if (!vendor || (!vendor.id && !vendor.email)) return null;

  const vendorId = normalizeText(vendor.id || vendorIdOrEmail);
  const vendorEmail = normalizeLower(vendor.email || vendor.corporateEmail);
  const cacheKey = queryCache.generateKey('vendor_buyer_uploads', [vendorId, vendorEmail, safeLimit]);
  const cached = queryCache.get(cacheKey, []);
  if (cached) return cached;

  const bvuParams = [vendorId];
  const bvuWhere = vendorEmail
    ? (bvuParams.push(vendorEmail), `lower(vendor_id) = lower($1) OR lower(vendor_email) = lower($2)`)
    : `lower(vendor_id) = lower($1)`;

  const [junctionRows, mappingRows] = await Promise.all([
    safeQuery(
      `SELECT id, buyer_id, vendor_id, buyer_name, buyer_company, buyer_email, upload_source, status, uploaded_at, created_at
         FROM buyer_vendor_uploads
        WHERE ${bvuWhere}
        ORDER BY uploaded_at DESC
        LIMIT $${bvuParams.length + 1}`,
      [...bvuParams, safeLimit],
      { d1: true },
      'fetch-buyer-uploads-junction-by-vendor'
    ),
    safeQuery(
      `SELECT id, organization_id, source, status, reviewed_by, created_at, reviewed_at
         FROM vendor_category_mappings
        WHERE lower(vendor_id) = lower($1) AND organization_id IS NOT NULL
        ORDER BY created_at DESC
        LIMIT $2`,
      [vendorId, safeLimit],
      { d1: true },
      'fetch-buyer-mappings-by-vendor'
    ),
  ]);

  const rawCandidates = [];

  for (const row of junctionRows) {
    rawCandidates.push({
      id: row.id,
      buyerId: row.buyer_id,
      buyerName: row.buyer_name,
      companyName: row.buyer_company,
      corporateEmail: row.buyer_email,
      uploadSource: row.upload_source,
      uploadDate: toIsoTimestamp(row.uploaded_at || row.created_at),
      status: row.status,
    });
  }

  for (const row of mappingRows) {
    rawCandidates.push({
      id: row.id,
      buyerId: row.organization_id,
      organizationId: row.organization_id,
      uploadSource: row.source || 'vendor_master_ingestion',
      uploadDate: toIsoTimestamp(row.reviewed_at || row.created_at),
      status: row.status,
    });
  }

  const vendorUploadDate = toIsoTimestamp(vendor.createdAt || vendor.created_at || vendorCreatedAt);
  const vendorStatus = normalizeText(vendor.verificationStatus || vendor.status) || null;
  const primaryBuyerId = normalizeText(vendor.buyerId || vendor.buyerAccountId) || null;
  const primaryBuyerEmail = normalizeText(vendor.buyerEmail) || null;
  const primaryBuyerCompany = normalizeText(vendor.addedByBuyerCompany) || null;

  if (primaryBuyerId || primaryBuyerEmail || primaryBuyerCompany) {
    rawCandidates.push({
      id: `v-owner-${vendorId}`,
      buyerId: primaryBuyerId,
      corporateEmail: primaryBuyerEmail,
      companyName: primaryBuyerCompany,
      uploadSource: normalizeText(vendor.source) || BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_SOURCE,
      uploadDate: vendorUploadDate,
      status: vendorStatus,
    });
  }

  const extraIds = [
    ...(Array.isArray(vendor.mappedBuyerIds) ? vendor.mappedBuyerIds : []),
    ...(Array.isArray(vendor.buyerIds) ? vendor.buyerIds : []),
  ];
  for (const mappedId of extraIds) {
    const cleanId = normalizeText(mappedId);
    if (!cleanId) continue;
    rawCandidates.push({
      id: `v-mapped-${vendorId}-${cleanId}`,
      buyerId: cleanId,
      uploadSource: normalizeText(vendor.source) || BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_SOURCE,
      uploadDate: vendorUploadDate,
      status: vendorStatus,
    });
  }

  const buyerMetadata = await hydrateBuyerMetadataMap({
    ids: rawCandidates.flatMap((c) => [c.buyerId, c.organizationId]),
    emails: rawCandidates.map((c) => c.corporateEmail),
    companies: rawCandidates.map((c) => c.companyName),
  });

  const deduped = new Map();
  const buyerMergeFields = [
    'buyerName',
    'companyName',
    'corporateEmail',
    'mobileNumber',
    'location',
    'gstin',
    'sourcingMode',
  ];
  for (const candidate of rawCandidates) {
    const hydrated =
      (candidate.buyerId && buyerMetadata.byId.get(normalizeLower(candidate.buyerId))) ||
      (candidate.organizationId && buyerMetadata.byId.get(normalizeLower(candidate.organizationId))) ||
      (candidate.corporateEmail && buyerMetadata.byEmail.get(normalizeLower(candidate.corporateEmail))) ||
      (candidate.companyName && buyerMetadata.byCompany.get(normalizeLower(candidate.companyName))) ||
      {};

    const resolvedBuyerId = hydrated.buyerId || firstNonEmpty(candidate.buyerId, candidate.organizationId) || '';
    const resolvedOrgId = hydrated.organizationId || firstNonEmpty(candidate.organizationId);
    const resolvedEmail = hydrated.corporateEmail || firstNonEmpty(candidate.corporateEmail);
    const resolvedCompany = hydrated.companyName || firstNonEmpty(candidate.companyName);
    const resolvedName = hydrated.buyerName || firstNonEmpty(candidate.buyerName, resolvedCompany, resolvedEmail);

    const dedupeKey =
      normalizeLower(resolvedOrgId || resolvedBuyerId) ||
      (resolvedEmail ? `email:${normalizeLower(resolvedEmail)}` : '') ||
      (resolvedCompany ? `company:${normalizeLower(resolvedCompany)}` : '');

    if (!dedupeKey) continue;

    const entry = {
      id: firstNonEmpty(candidate.id) || `bu-${dedupeKey}`,
      buyerId: resolvedBuyerId || dedupeKey,
      organizationId: resolvedOrgId,
      buyerName: resolvedName || resolvedCompany || resolvedEmail || resolvedBuyerId,
      companyName: resolvedCompany || resolvedName || resolvedBuyerId,
      corporateEmail: resolvedEmail,
      mobileNumber: hydrated.mobileNumber || null,
      location: hydrated.location || null,
      gstin: hydrated.gstin || null,
      sourcingMode: hydrated.sourcingMode || null,
      uploadSource: firstNonEmpty(candidate.uploadSource) || BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_SOURCE,
      uploadDate: candidate.uploadDate || hydrated.createdAt || null,
      status: hydrated.status || firstNonEmpty(candidate.status) || BUYER_VENDOR_UPLOAD_CONFIG.DEFAULT_STATUS,
    };

    const existing = deduped.get(dedupeKey);
    if (!existing) {
      deduped.set(dedupeKey, entry);
    } else {
      deduped.set(dedupeKey, {
        ...mergeMissingFields(existing, entry, buyerMergeFields),
        uploadDate: pickEarliestOrLatestIso(existing.uploadDate, entry.uploadDate),
        status: hydrated.status || existing.status || entry.status,
      });
    }
  }

  const buyerUploads = Array.from(deduped.values())
    .sort((a, b) => new Date(b.uploadDate || 0).getTime() - new Date(a.uploadDate || 0).getTime())
    .slice(0, safeLimit);

  const responsePayload = {
    vendorId,
    totalBuyers: buyerUploads.length,
    buyerUploads,
  };

  queryCache.set(cacheKey, [], responsePayload, {
    ttlMs: BUYER_VENDOR_UPLOAD_CONFIG.CACHE_TTL_MS,
    tag: BUYER_VENDOR_UPLOAD_CONFIG.CACHE_TAG,
  });
  return responsePayload;
}

module.exports = {
  recordBuyerVendorUploadInDB,
  bulkRecordBuyerVendorUploadsInDB,
  resolveBuyerAliases,
  getUploadedVendorsByBuyerFromDB,
  getBuyerUploadsByVendorFromDB,
};

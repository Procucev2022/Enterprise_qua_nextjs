// ==============================================================================
// DOMAIN QUERIES (Neon PostgreSQL)
// ==============================================================================
// Thin read/write helpers over the `raw JSONB` tables in schema.sql: vendors,
// RFQs, evaluations, vendor catalogue, buyer accounts, AI feed and audit logs.
//
// Every function no-ops (returns [] / null / false) when the pool isn't
// configured, so storeService.js can call these unconditionally without its own
// guards. Note that a no-op read is NOT a fallback to seed data — storeService
// treats the empty result as an empty collection and reports the database as
// unavailable; there is nothing else to serve.
// ==============================================================================

const pool = require('./pool');

// ── Vendors ──────────────────────────────────────────────────────────────────

async function getVendorsFromDB() {
  if (!pool.pool) return [];
  const result = await pool.query('SELECT raw FROM vendors ORDER BY created_at DESC');
  return result.rows.map((row) => row.raw);
}

async function upsertVendorInDB(vendor) {
  if (!pool.pool) return null;
  const { id, email, majorCategory, status, source } = vendor;
  const result = await pool.query(
    `INSERT INTO vendors (id, email, major_category, status, source, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       major_category = EXCLUDED.major_category,
       status = EXCLUDED.status,
       source = EXCLUDED.source,
       raw = EXCLUDED.raw,
       updated_at = now()
     RETURNING raw`,
    [id, email || null, majorCategory || null, status || null, source || null, JSON.stringify(vendor)]
  );
  return result.rows[0]?.raw || null;
}

async function deleteVendorInDB(id) {
  if (!pool.pool) return false;
  const result = await pool.query('DELETE FROM vendors WHERE id = $1', [id]);
  return result.rowCount > 0;
}

// One multi-row INSERT for a whole batch of newly bulk-uploaded vendors,
// rather than one round trip per row (what the reference p2pservices app
// does — confirmed not to scale). `ON CONFLICT (email) DO NOTHING` is a
// defensive backstop against a duplicate slipping in between the caller's
// own in-memory/pre-query dedup check and this insert (e.g. a concurrent
// upload); RETURNING email tells the caller exactly which rows really
// landed versus were silently skipped as a race-condition duplicate, so it
// never has to guess or trust a fire-and-forget write.
async function bulkInsertVendorsInDB(vendors) {
  if (!pool.pool || vendors.length === 0) return [];
  const values = [];
  const placeholders = vendors.map((vendor, i) => {
    const base = i * 6;
    values.push(
      vendor.id,
      vendor.email || null,
      vendor.majorCategory || null,
      vendor.status || null,
      vendor.source || null,
      JSON.stringify(vendor)
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, now())`;
  });
  const result = await pool.query(
    `INSERT INTO vendors (id, email, major_category, status, source, raw, updated_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (email) DO NOTHING
     RETURNING email`,
    values
  );
  return result.rows.map((row) => row.email);
}

// ── RFQs ─────────────────────────────────────────────────────────────────────

async function getRFQsFromDB() {
  if (!pool.pool) return [];
  const result = await pool.query('SELECT raw FROM rfqs ORDER BY created_at DESC');
  return result.rows.map((row) => row.raw);
}

async function upsertRFQInDB(rfq) {
  if (!pool.pool) return null;
  const { id, rfqNumber, category, status, sourcingMode, budget } = rfq;
  const result = await pool.query(
    `INSERT INTO rfqs (id, rfq_number, category, status, sourcing_mode, budget, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (id) DO UPDATE SET
       rfq_number = EXCLUDED.rfq_number,
       category = EXCLUDED.category,
       status = EXCLUDED.status,
       sourcing_mode = EXCLUDED.sourcing_mode,
       budget = EXCLUDED.budget,
       raw = EXCLUDED.raw,
       updated_at = now()
     RETURNING raw`,
    [
      id,
      rfqNumber || null,
      category || null,
      status || null,
      sourcingMode || null,
      Number.isFinite(Number(budget)) ? Number(budget) : null,
      JSON.stringify(rfq),
    ]
  );
  return result.rows[0]?.raw || null;
}

async function deleteRFQInDB(id) {
  if (!pool.pool) return false;
  const result = await pool.query('DELETE FROM rfqs WHERE id = $1', [id]);
  return result.rowCount > 0;
}

// ── Evaluations (append-only — no update/delete method exists) ────────────────

async function getEvaluationsFromDB() {
  if (!pool.pool) return [];
  const result = await pool.query('SELECT raw FROM evaluations ORDER BY created_at DESC');
  return result.rows.map((row) => row.raw);
}

async function upsertEvaluationInDB(evaluation) {
  if (!pool.pool) return null;
  const { id, vendorId, status } = evaluation;
  const result = await pool.query(
    `INSERT INTO evaluations (id, vendor_id, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = now()
     RETURNING raw`,
    [id, vendorId || null, status || null, JSON.stringify(evaluation)]
  );
  return result.rows[0]?.raw || null;
}

// ── Vendor catalogue ────────────────────────────────────────────────────────

async function getVendorCatalogueFromDB() {
  if (!pool.pool) return [];
  const result = await pool.query('SELECT raw FROM vendor_catalogue ORDER BY created_at DESC');
  return result.rows.map((row) => row.raw);
}

async function upsertCatalogueProductInDB(product) {
  if (!pool.pool) return null;
  const { id, vendorId, sku, category } = product;
  const result = await pool.query(
    `INSERT INTO vendor_catalogue (id, vendor_id, sku, category, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       sku = EXCLUDED.sku,
       category = EXCLUDED.category,
       raw = EXCLUDED.raw,
       updated_at = now()
     RETURNING raw`,
    [id, vendorId || null, sku || null, category || null, JSON.stringify(product)]
  );
  return result.rows[0]?.raw || null;
}

async function deleteCatalogueProductInDB(id) {
  if (!pool.pool) return false;
  const result = await pool.query('DELETE FROM vendor_catalogue WHERE id = $1', [id]);
  return result.rowCount > 0;
}

// ── Buyer accounts ──────────────────────────────────────────────────────────
// activeBuyerAccount is a pointer into this same collection, not a separate
// record, so it's modelled as an is_active flag rather than its own row —
// getBuyerAccountsFromDB returns both the accounts and which id (if any) is
// flagged active, so storeService can resolve the same object-reference
// invariant it already has in memory.

async function getBuyerAccountsFromDB() {
  if (!pool.pool) return { accounts: [], activeId: null };
  const result = await pool.query('SELECT id, is_active, raw FROM buyer_accounts ORDER BY created_at DESC');
  const accounts = result.rows.map((row) => row.raw);
  const activeRow = result.rows.find((row) => row.is_active);
  return { accounts, activeId: activeRow ? activeRow.id : null };
}

async function upsertBuyerAccountInDB(account) {
  if (!pool.pool) return null;
  const { id, corporateEmail, status } = account;
  // is_active is deliberately not touched here — this saves the account's own
  // data, not which account is active. setActiveBuyerAccountInDB owns that flag.
  const result = await pool.query(
    `INSERT INTO buyer_accounts (id, corporate_email, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       corporate_email = EXCLUDED.corporate_email,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = now()
     RETURNING raw`,
    [id, corporateEmail || null, status || null, JSON.stringify(account)]
  );
  return result.rows[0]?.raw || null;
}

async function deleteBuyerAccountInDB(id) {
  if (!pool.pool) return false;
  const result = await pool.query('DELETE FROM buyer_accounts WHERE id = $1', [id]);
  return result.rowCount > 0;
}

// Exactly one row (or none) carries is_active=true at a time. Passing an id
// that doesn't exist in the table just clears every row's flag, matching
// alignActiveBuyerAccount's in-memory "not found" behaviour of leaving the
// pointer unchanged from the caller's perspective (no row matches either way).
async function setActiveBuyerAccountInDB(id) {
  if (!pool.pool) return;
  await pool.query('UPDATE buyer_accounts SET is_active = (id = $1)', [id]);
}

// ── AI feed (100-item cap, trimmed here so triggerBatchChaser's bulk-insert
// path — which bypasses addAIFeedItem's in-memory pop() — gets the same
// trim without needing its own bookkeeping of which item to evict) ──────────

async function getAIFeedFromDB() {
  if (!pool.pool) return [];
  const result = await pool.query('SELECT raw FROM ai_feed ORDER BY sequence DESC');
  return result.rows.map((row) => row.raw);
}

async function upsertAIFeedItemInDB(item) {
  if (!pool.pool) return null;
  const { id } = item;
  const result = await pool.query(
    `INSERT INTO ai_feed (id, raw) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET raw = EXCLUDED.raw
     RETURNING raw`,
    [id, JSON.stringify(item)]
  );
  await pool.query(
    `DELETE FROM ai_feed WHERE id NOT IN (SELECT id FROM ai_feed ORDER BY sequence DESC LIMIT 100)`
  );
  return result.rows[0]?.raw || null;
}

// ── Audit logs (SHA-256 hash chain — sequence must reflect exact insertion
// order, see schema.sql's comment on audit_logs.sequence) ───────────────────

async function getAuditLogsFromDB() {
  if (!pool.pool) return [];
  const result = await pool.query('SELECT raw FROM audit_logs ORDER BY sequence DESC');
  return result.rows.map((row) => row.raw);
}

async function upsertAuditLogInDB(entry) {
  if (!pool.pool) return null;
  const { id } = entry;
  const result = await pool.query(
    `INSERT INTO audit_logs (id, raw) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET raw = EXCLUDED.raw
     RETURNING raw`,
    [id, JSON.stringify(entry)]
  );
  return result.rows[0]?.raw || null;
}

// ── Buyer Vendors (Scoped by buyer_org_id) ───────────────────────────────────

async function getBuyerVendorsFromDB(buyerOrgId = null) {
  if (!pool.pool) return [];
  let queryText = 'SELECT raw FROM buyer_vendor';
  const params = [];
  if (buyerOrgId) {
    queryText += ' WHERE buyer_org_id = $1';
    params.push(buyerOrgId);
  }
  queryText += ' ORDER BY created_at DESC';
  const result = await pool.query(queryText, params);
  return result.rows.map((row) => row.raw);
}

async function upsertBuyerVendorInDB(record) {
  if (!pool.pool) return null;
  const {
    id,
    buyerOrgId,
    vendorId,
    vendorCode,
    companyName,
    contactPerson,
    email,
    phone,
    address,
    gstin,
    rating,
    hasPoHistory,
    poCount,
    totalSpend,
    timeHorizon,
    primaryMajorCategory,
    minorCategories,
    productLines,
    aiConfidenceScore,
    aiReason,
    mappingStatus,
    emailDispatchStatus,
    dispatchedAt,
  } = record;

  const result = await pool.query(
    `INSERT INTO buyer_vendor (
      id, buyer_org_id, vendor_id, vendor_code, company_name, contact_person,
      email, phone, address, gstin, rating, has_po_history, po_count, total_spend,
      time_horizon, primary_major_category, minor_categories, product_lines,
      ai_confidence_score, ai_reason, mapping_status, email_dispatch_status,
      dispatched_at, raw, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22, $23, $24, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      buyer_org_id = EXCLUDED.buyer_org_id,
      vendor_id = EXCLUDED.vendor_id,
      vendor_code = EXCLUDED.vendor_code,
      company_name = EXCLUDED.company_name,
      contact_person = EXCLUDED.contact_person,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      address = EXCLUDED.address,
      gstin = EXCLUDED.gstin,
      rating = EXCLUDED.rating,
      has_po_history = EXCLUDED.has_po_history,
      po_count = EXCLUDED.po_count,
      total_spend = EXCLUDED.total_spend,
      time_horizon = EXCLUDED.time_horizon,
      primary_major_category = EXCLUDED.primary_major_category,
      minor_categories = EXCLUDED.minor_categories,
      product_lines = EXCLUDED.product_lines,
      ai_confidence_score = EXCLUDED.ai_confidence_score,
      ai_reason = EXCLUDED.ai_reason,
      mapping_status = EXCLUDED.mapping_status,
      email_dispatch_status = EXCLUDED.email_dispatch_status,
      dispatched_at = EXCLUDED.dispatched_at,
      raw = EXCLUDED.raw,
      updated_at = now()
    RETURNING raw`,
    [
      id,
      buyerOrgId || null,
      vendorId || null,
      vendorCode || null,
      companyName || record.name || 'Unknown Vendor',
      contactPerson || null,
      email || null,
      phone || null,
      address || null,
      gstin || null,
      Number.isFinite(Number(rating)) ? Number(rating) : null,
      Boolean(hasPoHistory),
      Number.isInteger(Number(poCount)) ? Number(poCount) : 0,
      Number.isFinite(Number(totalSpend)) ? Number(totalSpend) : 0,
      timeHorizon || null,
      primaryMajorCategory || null,
      JSON.stringify(minorCategories || []),
      JSON.stringify(productLines || []),
      Number.isInteger(Number(aiConfidenceScore)) ? Number(aiConfidenceScore) : 0,
      aiReason || null,
      mappingStatus || 'PENDING',
      emailDispatchStatus || 'PENDING',
      dispatchedAt || null,
      JSON.stringify(record),
    ]
  );
  return result.rows[0]?.raw || null;
}

async function deleteBuyerVendorInDB(id) {
  if (!pool.pool) return false;
  const result = await pool.query('DELETE FROM buyer_vendor WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = {
  getVendorsFromDB,
  upsertVendorInDB,
  deleteVendorInDB,
  bulkInsertVendorsInDB,
  getRFQsFromDB,
  upsertRFQInDB,
  deleteRFQInDB,
  getEvaluationsFromDB,
  upsertEvaluationInDB,
  getVendorCatalogueFromDB,
  upsertCatalogueProductInDB,
  deleteCatalogueProductInDB,
  getBuyerAccountsFromDB,
  upsertBuyerAccountInDB,
  deleteBuyerAccountInDB,
  setActiveBuyerAccountInDB,
  getAIFeedFromDB,
  upsertAIFeedItemInDB,
  getAuditLogsFromDB,
  upsertAuditLogInDB,
  getBuyerVendorsFromDB,
  upsertBuyerVendorInDB,
  deleteBuyerVendorInDB,
};


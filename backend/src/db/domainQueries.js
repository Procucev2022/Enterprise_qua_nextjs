// ==============================================================================
// DOMAIN QUERIES (vendors + RFQs, Neon PostgreSQL)
// ==============================================================================
// Thin read/write helpers over the `raw JSONB` schema in schema.sql. Every
// function no-ops (returns [] / null / false) when the pool isn't configured,
// so storeService.js can call these unconditionally without its own guards —
// matching the per-function-guard convention the deleted queries.js used.
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

module.exports = {
  getVendorsFromDB,
  upsertVendorInDB,
  deleteVendorInDB,
  getRFQsFromDB,
  upsertRFQInDB,
  deleteRFQInDB,
};

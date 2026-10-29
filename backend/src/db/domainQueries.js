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
const d1Bridge = require('./d1Bridge');
const { queryCache } = require('./queryCache');
const { parseSearchTokens } = require('../config/constants');

// ── Vendors ──────────────────────────────────────────────────────────────────

async function getVendorsFromDB(limit = null) {
  if (!pool.hasStorage()) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? 'SELECT id, created_at, updated_at, raw FROM vendors ORDER BY created_at DESC LIMIT $1'
    : 'SELECT id, created_at, updated_at, raw FROM vendors ORDER BY created_at DESC LIMIT 1000';
  const params = hasLimit ? [Math.min(Number(limit), 1000)] : [];
  const result = await pool.query(
    sql,
    params,
    {
      d1: true,
      d1Text: hasLimit
        ? 'SELECT id, created_at, updated_at, raw FROM vendors ORDER BY created_at DESC LIMIT $1'
        : 'SELECT id, created_at, updated_at, raw FROM vendors ORDER BY created_at DESC LIMIT 1000',
      useCache: true,
      tag: 'vendors',
      ttlMs: 60000,
    }
  );
  return (result && result.rows)
    ? result.rows.map((row) => {
        const v = parseRaw(row.raw);
        if (row.created_at && !v.created_at) v.created_at = row.created_at;
        if (row.created_at && !v.createdAt) v.createdAt = row.created_at;
        if (row.updated_at && !v.updated_at) v.updated_at = row.updated_at;
        return v;
      })
    : [];
}

/**
 * One page of vendors, filtered and counted entirely in Postgres.
 *
 * getVendorsFromDB() fetches every row's full `raw` JSONB — fine for a
 * one-time boot hydration, but a real request hit it on every single "Load
 * more" click once the vendor table reached 80k+ rows (a bulk Vendor Master
 * import): each click re-fetched and re-serialized the entire table just to
 * throw away all but 50 rows, slow/heavy enough to hang the browser mid-
 * pagination. This does the LIMIT/OFFSET/search filtering in SQL instead, so
 * a page request only ever touches the rows it actually returns.
 */
async function getVendorsPageFromDB({ limit, offset, search = '', email = '', category = '', state = '', city = '', publicOnly = false, scopedBuyerId = '', skipCount = false } = {}) {
  if (!pool.hasStorage()) return { rows: [], total: 0 };
  const cacheKey = (!search && !email && !category && !state && !city)
    ? `vendors_page_${limit}_${offset}_${publicOnly}_${scopedBuyerId}_${skipCount}`
    : null;
  if (cacheKey) {
    const cached = queryCache.get(cacheKey, []);
    if (cached) return cached;
  }
  const params = [];
  // Two parallel condition lists, not one translated after the fact: ILIKE
  // has no SQLite equivalent (LIKE + lower() instead), raw->>'x' is Postgres
  // JSONB syntax (SQLite's is json_extract(raw,'$.x'), which already returns
  // text for a scalar — no separate ::text cast needed), and (raw->'x')::text
  // likewise becomes json_extract. Both lists push the exact same params in
  // the exact same order, so one params array serves either query text.
  const conditions = [];
  const d1Conditions = [];
  if (search) {
    const tokens = parseSearchTokens(search);
    if (tokens.length > 0) {
      const tokenConditions = [];
      const d1TokenConditions = [];

      for (const token of tokens) {
        const trimmed = token.trim();
        if (!trimmed) continue;

        params.push(`%${trimmed}%`);
        const p = params.length;

        // For short search tokens (<= 3 characters, e.g. "IT", "HR"), fields
        // must match on discrete word boundaries or exact match, not substring '%it%', which erroneously
        // matches "switches" (sw-IT-ches), "commoditiess" (commod-IT-iess), "limited", "solitaire", etc.
        let catCondition = `major_category ILIKE $${p}`;
        let d1CatCondition = `lower(major_category) LIKE lower($${p})`;
        let nameCondition = `raw->>'name' ILIKE $${p}`;
        let d1NameCondition = `lower(json_extract(raw,'$.name')) LIKE lower($${p})`;
        let minorCatCondition = `(raw->'minorCategories')::text ILIKE $${p}`;
        let d1MinorCatCondition = `lower(json_extract(raw,'$.minorCategories')) LIKE lower($${p})`;
        let contactCondition = `raw->>'contactPerson' ILIKE $${p}`;
        let d1ContactCondition = `lower(json_extract(raw,'$.contactPerson')) LIKE lower($${p})`;

        if (trimmed.length <= 3) {
          params.push(trimmed.toLowerCase());
          const pExact = params.length;
          catCondition = `(
            lower(major_category) = $${pExact}
            OR lower(major_category) LIKE ($${pExact} || ' %')
            OR lower(major_category) LIKE ('% ' || $${pExact})
            OR lower(major_category) LIKE ('% ' || $${pExact} || ' %')
            OR lower(raw->>'majorCategory') = $${pExact}
          )`;
          d1CatCondition = `(
            lower(major_category) = $${pExact}
            OR lower(major_category) LIKE ($${pExact} || ' %')
            OR lower(major_category) LIKE ('% ' || $${pExact})
            OR lower(major_category) LIKE ('% ' || $${pExact} || ' %')
            OR lower(json_extract(raw,'$.majorCategory')) = $${pExact}
          )`;
          nameCondition = `(
            lower(raw->>'name') = $${pExact}
            OR lower(raw->>'name') LIKE ($${pExact} || ' %')
            OR lower(raw->>'name') LIKE ('% ' || $${pExact})
            OR lower(raw->>'name') LIKE ('% ' || $${pExact} || ' %')
          )`;
          d1NameCondition = `(
            lower(json_extract(raw,'$.name')) = $${pExact}
            OR lower(json_extract(raw,'$.name')) LIKE ($${pExact} || ' %')
            OR lower(json_extract(raw,'$.name')) LIKE ('% ' || $${pExact})
            OR lower(json_extract(raw,'$.name')) LIKE ('% ' || $${pExact} || ' %')
          )`;
          minorCatCondition = `(
            (raw->'minorCategories')::text ILIKE '%"' || $${pExact} || '"%'
            OR (raw->'minorCategories')::text ILIKE '% ' || $${pExact} || ' %'
            OR (raw->'minorCategories')::text ILIKE '%[' || $${pExact} || ']%'
          )`;
          d1MinorCatCondition = `(
            lower(json_extract(raw,'$.minorCategories')) LIKE ('%"' || $${pExact} || '"%')
            OR lower(json_extract(raw,'$.minorCategories')) LIKE ('% ' || $${pExact} || ' %')
            OR lower(json_extract(raw,'$.minorCategories')) LIKE ('%[' || $${pExact} || ']%')
          )`;
          contactCondition = `(
            lower(raw->>'contactPerson') = $${pExact}
            OR lower(raw->>'contactPerson') LIKE ($${pExact} || ' %')
            OR lower(raw->>'contactPerson') LIKE ('% ' || $${pExact})
            OR lower(raw->>'contactPerson') LIKE ('% ' || $${pExact} || ' %')
          )`;
          d1ContactCondition = `(
            lower(json_extract(raw,'$.contactPerson')) = $${pExact}
            OR lower(json_extract(raw,'$.contactPerson')) LIKE ($${pExact} || ' %')
            OR lower(json_extract(raw,'$.contactPerson')) LIKE ('% ' || $${pExact})
            OR lower(json_extract(raw,'$.contactPerson')) LIKE ('% ' || $${pExact} || ' %')
          )`;
        }

        tokenConditions.push(`(${catCondition}
          OR email ILIKE $${p}
          OR ${nameCondition}
          OR ${minorCatCondition}
          OR ${contactCondition}
          OR raw->>'contact' ILIKE $${p}
          OR raw->>'location' ILIKE $${p}
          OR raw->>'city' ILIKE $${p}
          OR raw->>'deliveryLocation' ILIKE $${p})`);

        d1TokenConditions.push(`(${d1CatCondition}
          OR lower(email) LIKE lower($${p})
          OR ${d1NameCondition}
          OR ${d1MinorCatCondition}
          OR ${d1ContactCondition}
          OR lower(json_extract(raw,'$.contact')) LIKE lower($${p})
          OR lower(json_extract(raw,'$.location')) LIKE lower($${p})
          OR lower(json_extract(raw,'$.city')) LIKE lower($${p})
          OR lower(json_extract(raw,'$.deliveryLocation')) LIKE lower($${p}))`);
      }

      if (tokenConditions.length > 0) {
        conditions.push(`(${tokenConditions.join(' OR ')})`);
        d1Conditions.push(`(${d1TokenConditions.join(' OR ')})`);
      }
    }
  }
  if (email) {
    params.push(`%${email.trim()}%`);
    conditions.push(`(email ILIKE $${params.length} OR raw->>'email' ILIKE $${params.length})`);
    d1Conditions.push(`(lower(email) LIKE lower($${params.length}) OR lower(json_extract(raw,'$.email')) LIKE lower($${params.length}))`);
  }
  if (category) {
    // Case-insensitive exact category filter matching both table column and raw JSON:
    params.push(category.trim());
    const p = params.length;
    conditions.push(`(major_category = $${p} OR lower(major_category) = lower($${p}) OR lower(raw->>'majorCategory') = lower($${p}))`);
    d1Conditions.push(`(lower(major_category) = lower($${p}) OR lower(json_extract(raw,'$.majorCategory')) = lower($${p}))`);
  }
  if (state) {
    params.push(`%${state.trim()}%`);
    const p = params.length;
    conditions.push(`(raw->>'state' ILIKE $${p} OR raw->>'location' ILIKE $${p})`);
    d1Conditions.push(`(lower(json_extract(raw,'$.state')) LIKE lower($${p}) OR lower(json_extract(raw,'$.location')) LIKE lower($${p}))`);
  }
  if (city) {
    const trimmedCity = city.trim();
    const aliasMatch = trimmedCity.match(/^([^(]+)\s*\(([^)]+)\)$/);
    if (aliasMatch) {
      const p1 = `%${aliasMatch[1].trim()}%`;
      const p2 = `%${aliasMatch[2].trim()}%`;
      params.push(p1, p2);
      const idx1 = params.length - 1;
      const idx2 = params.length;
      conditions.push(`(raw->>'city' ILIKE ${idx1} OR raw->>'location' ILIKE ${idx1} OR raw->>'city' ILIKE ${idx2} OR raw->>'location' ILIKE ${idx2})`);
      d1Conditions.push(`(lower(json_extract(raw,'$.city')) LIKE lower(${idx1}) OR lower(json_extract(raw,'$.location')) LIKE lower(${idx1}) OR lower(json_extract(raw,'$.city')) LIKE lower(${idx2}) OR lower(json_extract(raw,'$.location')) LIKE lower(${idx2}))`);
    } else {
      params.push(`%${trimmedCity}%`);
      const p = params.length;
      conditions.push(`(raw->>'city' ILIKE ${p} OR raw->>'location' ILIKE ${p})`);
      d1Conditions.push(`(lower(json_extract(raw,'$.city')) LIKE lower(${p}) OR lower(json_extract(raw,'$.location')) LIKE lower(${p}))`);
    }
  }
  if (publicOnly) {
    // Mirrors storeService.getVendors' unscoped filter: a vendor tagged to a
    // specific buyer (buyerId/buyerAccountId set inside `raw`) is only meant
    // to be visible to that buyer, never in an anonymous/public listing.
    conditions.push(`(raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL`);
    d1Conditions.push(`source NOT IN ('buyer_manual', 'buyer_uploaded', 'buyer_excel', 'historical_purchase_dump')`);
  }
  if (scopedBuyerId) {
    // A buyer's paginated listing must include every public vendor (no
    // buyerId/buyerAccountId at all) plus their own uploads — the same rule
    // storeService.getVendors applies in memory. Previously only the fully-
    // open ("all") listing got this SQL fast path; any buyer-scoped page
    // request fell through to storeService.getVendors(buyerId), which
    // re-fetches and re-serializes every one of 600k+ rows on every single
    // call regardless of scope, since almost all vendors are public and thus
    // visible to every buyer anyway. Backed by idx_vendors_buyer_id/
    // idx_vendors_buyer_account_id (schema.sql) so the OR still uses indexes
    // instead of a sequential scan.
    params.push(scopedBuyerId);
    const p = params.length;
    conditions.push(`(
      ((raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL)
      OR lower(raw->>'buyerId') = lower($${p})
      OR lower(raw->>'buyerAccountId') = lower($${p})
      OR lower(raw->>'buyerEmail') = lower($${p})
    )`);
    d1Conditions.push(`(
      (json_extract(raw,'$.buyerId') IS NULL AND json_extract(raw,'$.buyerAccountId') IS NULL)
      OR lower(json_extract(raw,'$.buyerId')) = lower($${p})
      OR lower(json_extract(raw,'$.buyerAccountId')) = lower($${p})
      OR lower(json_extract(raw,'$.buyerEmail')) = lower($${p})
    )`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const d1Where = d1Conditions.length ? `WHERE ${d1Conditions.join(' AND ')}` : '';

  // Separate param arrays for the count vs. data query — sharing and
  // mutating one array across both calls works with a driver that sends the
  // query immediately, but is a needless footgun (and confusing to inspect
  // in tests) for no benefit.
  const countResult = skipCount
    ? { rows: [{ total: 0 }] }
    : await pool.query(
        `SELECT COUNT(*)::int AS total FROM vendors ${where}`,
        [...params],
        { d1: true, d1Text: `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM vendors ${d1Where}` }
      );
  const total = countResult.rows[0]?.total || 0;

  const effectiveLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 1000) : (limit !== undefined ? limit : 50);
  const effectiveOffset = Number.isInteger(Number(offset)) && Number(offset) >= 0 ? Number(offset) : (offset !== undefined ? offset : 0);
  const dataParams = [...params, effectiveLimit, effectiveOffset];
  const dataResult = await pool.query(
    `SELECT id, created_at, updated_at, raw FROM vendors ${where} ORDER BY created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams,
    {
      d1: true,
      d1Text: `SELECT id, created_at, updated_at, raw FROM vendors ${d1Where} ORDER BY created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    }
  );
  const response = {
    rows: dataResult.rows.map((row) => {
      const v = parseRaw(row.raw);
      if (row.created_at && !v.created_at) v.created_at = row.created_at;
      if (row.created_at && !v.createdAt) v.createdAt = row.created_at;
      if (row.updated_at && !v.updated_at) v.updated_at = row.updated_at;
      return v;
    }),
    total,
  };
  if (cacheKey) {
    queryCache.set(cacheKey, [], response, { tag: 'vendors', ttlMs: 120000 });
  }
  return response;
}

/**
 * COUNT of distinct public (Procucev-network) vendors whose category covers ANY
 * of the given RFQ category signals — the DB-side equivalent of
 * storeService.candidateVendorsForRFQ(rfq).filter(isProcucevVendor).length,
 * but over the whole table instead of the capped in-memory bootstrap page.
 *
 * Why this exists: the RFQ success popup's Procucev vendor count was computed
 * against that in-memory subset and came back 0 for V2/V3 even when matching
 * vendors existed in the 80k+ row directory. getVendorsPageFromDB's `category`
 * filter only equals the `major_category` column, so it misses a signal that
 * is a *minor* category ("Steels", "Pipes & Pipe Fittings") or a vendor whose
 * relevant category sits in `minorCategories` — exactly the shape of the real
 * failing RFQ. This matches the same four category pools vendorCoversCategory
 * checks (major, minor, vendor-selected, client-mapped), case-insensitively,
 * and counts each vendor once.
 *
 * Matching is a case-insensitive substring test of the signal against the
 * JSONB category text, backed by the trigram GIN indexes
 * (idx_vendors_major_category_trgm / idx_vendors_minor_categories_trgm) so it
 * does not sequential-scan at scale. A substring test can over-match in
 * principle (a signal that is a substring of an unrelated category); in this
 * taxonomy the labels are distinct enough that the trade-off — robust against
 * casing/whitespace drift between the taxonomy master and vendor sheets, which
 * is the actual cause of the zero — is worth it.
 *
 * @param {string[]} signals Category strings the RFQ carries.
 * @returns {Promise<number>} Count of distinct matching public vendors.
 */
async function countPublicVendorsMatchingCategories(signals) {
  if (!pool.hasStorage()) return 0;
  const cleaned = Array.from(
    new Set((Array.isArray(signals) ? signals : []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
  );
  if (cleaned.length === 0) return 0;

  const params = [];
  const orGroups = [];
  const d1OrGroups = [];
  for (const sig of cleaned) {
    if (sig.length <= 3) {
      params.push(sig);
      const pExact = params.length;
      params.push(`%"${sig}"%`);
      const pJson = params.length;
      orGroups.push(`(
        lower(major_category) = $${pExact}
        OR lower((raw->'minorCategories')::text) LIKE $${pJson}
        OR lower((raw->'vendorSelectedCategories')::text) LIKE $${pJson}
        OR lower((raw->'clientMappedCategories')::text) LIKE $${pJson}
      )`);
      d1OrGroups.push(`(
        lower(major_category) = $${pExact}
        OR lower(json_extract(raw,'$.minorCategories')) LIKE $${pJson}
        OR lower(json_extract(raw,'$.vendorSelectedCategories')) LIKE $${pJson}
        OR lower(json_extract(raw,'$.clientMappedCategories')) LIKE $${pJson}
      )`);
    } else {
      params.push(`%${sig}%`);
      const p = params.length;
      orGroups.push(`(
        lower(major_category) LIKE $${p}
        OR lower((raw->'minorCategories')::text) LIKE $${p}
        OR lower((raw->'vendorSelectedCategories')::text) LIKE $${p}
        OR lower((raw->'clientMappedCategories')::text) LIKE $${p}
      )`);
      d1OrGroups.push(`(
        lower(major_category) LIKE $${p}
        OR lower(json_extract(raw,'$.minorCategories')) LIKE $${p}
        OR lower(json_extract(raw,'$.vendorSelectedCategories')) LIKE $${p}
        OR lower(json_extract(raw,'$.clientMappedCategories')) LIKE $${p}
      )`);
    }
  }

  // Public-only: a vendor tagged to a specific buyer is never in the network pool.
  const publicPg = `(raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL`;
  const publicD1 = `json_extract(raw,'$.buyerId') IS NULL AND json_extract(raw,'$.buyerAccountId') IS NULL`;

  const wherePg = `WHERE (${orGroups.join(' OR ')}) AND ${publicPg}`;
  const whereD1 = `WHERE (${d1OrGroups.join(' OR ')}) AND ${publicD1}`;

  const result = await pool.query(
    `SELECT COUNT(*)::int AS total FROM vendors ${wherePg}`,
    params,
    {
      d1: true,
      d1Text: `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM vendors ${whereD1}`,
      useCache: true,
      tag: 'vendors',
      ttlMs: 60000,
    }
  );
  return result.rows[0]?.total || 0;
}

/**
 * The actual public (Procucev-network) vendor ROWS whose category covers ANY of
 * the given RFQ signals — the row-returning companion to
 * countPublicVendorsMatchingCategories, so V0 RFQ dispatch can assign the real
 * matching vendors from the whole directory instead of the capped in-memory
 * bootstrap page (which was returning zero at scale).
 *
 * Same four-pool, case-insensitive substring match and public-only filter as
 * the count query. Ordered newest-first and capped by `limit`.
 *
 * @param {string[]} signals Category strings the RFQ carries.
 * @param {number} limit Max rows to return.
 * @returns {Promise<object[]>} Matching public vendor records.
 */
async function getPublicVendorsMatchingCategories(signals, limit = 100) {
  if (!pool.hasStorage()) return [];
  const cleaned = Array.from(
    new Set((Array.isArray(signals) ? signals : []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean))
  );
  if (cleaned.length === 0) return [];

  const params = [];
  const orGroups = [];
  const d1OrGroups = [];
  for (const sig of cleaned) {
    if (sig.length <= 3) {
      params.push(sig);
      const pExact = params.length;
      params.push(`%"${sig}"%`);
      const pJson = params.length;
      orGroups.push(`(
        lower(major_category) = $${pExact}
        OR lower((raw->'minorCategories')::text) LIKE $${pJson}
        OR lower((raw->'vendorSelectedCategories')::text) LIKE $${pJson}
        OR lower((raw->'clientMappedCategories')::text) LIKE $${pJson}
      )`);
      d1OrGroups.push(`(
        lower(major_category) = $${pExact}
        OR lower(json_extract(raw,'$.minorCategories')) LIKE $${pJson}
        OR lower(json_extract(raw,'$.vendorSelectedCategories')) LIKE $${pJson}
        OR lower(json_extract(raw,'$.clientMappedCategories')) LIKE $${pJson}
      )`);
    } else {
      params.push(`%${sig}%`);
      const p = params.length;
      orGroups.push(`(
        lower(major_category) LIKE $${p}
        OR lower((raw->'minorCategories')::text) LIKE $${p}
        OR lower((raw->'vendorSelectedCategories')::text) LIKE $${p}
        OR lower((raw->'clientMappedCategories')::text) LIKE $${p}
      )`);
      d1OrGroups.push(`(
        lower(major_category) LIKE $${p}
        OR lower(json_extract(raw,'$.minorCategories')) LIKE $${p}
        OR lower(json_extract(raw,'$.vendorSelectedCategories')) LIKE $${p}
        OR lower(json_extract(raw,'$.clientMappedCategories')) LIKE $${p}
      )`);
    }
  }

  const publicPg = `(raw->>'buyerId') IS NULL AND (raw->>'buyerAccountId') IS NULL`;
  const publicD1 = `json_extract(raw,'$.buyerId') IS NULL AND json_extract(raw,'$.buyerAccountId') IS NULL`;

  const wherePg = `WHERE (${orGroups.join(' OR ')}) AND ${publicPg}`;
  const whereD1 = `WHERE (${d1OrGroups.join(' OR ')}) AND ${publicD1}`;

  const limitParam = params.length + 1;
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const result = await pool.query(
    `SELECT raw FROM vendors ${wherePg} ORDER BY created_at DESC LIMIT $${limitParam}`,
    [...params, safeLimit],
    {
      d1: true,
      d1Text: `SELECT raw FROM vendors ${whereD1} ORDER BY created_at DESC LIMIT $${limitParam}`,
      useCache: true,
      tag: 'vendors',
      ttlMs: 60000,
    }
  );
  return (result && result.rows) ? result.rows.map((row) => parseRaw(row.raw)) : [];
}

/**
 * Retrieves public vendors for each specified category from the database,
 * capped at `maxPerCategory` per category, and deduplicated across categories.
 *
 * @param {string[]} categories Array of category names.
 * @param {number} maxPerCategory Max vendors per category.
 * @returns {Promise<object[]>}
 */
async function getPublicVendorsPerCategoryFromDB(categories, maxPerCategory = 5) {
  if (!pool.hasStorage()) return [];
  const cleaned = Array.from(
    new Set((Array.isArray(categories) ? categories : []).map((s) => String(s || '').trim()).filter(Boolean))
  );
  if (cleaned.length === 0) return [];

  const resultsMap = new Map();
  for (const cat of cleaned) {
    const matches = await getPublicVendorsMatchingCategories([cat], maxPerCategory);
    for (const v of matches) {
      const key = (v.id || v.email || v.name || '').toLowerCase().trim();
      if (key && !resultsMap.has(key)) {
        resultsMap.set(key, v);
      }
    }
  }
  return Array.from(resultsMap.values());
}

/** Single-row lookup by email — used to guarantee a specific vendor is
 * present in a capped/paginated listing without fetching the whole table. */
async function getVendorByEmailFromDB(email) {
  if (!pool.hasStorage() || !email) return null;
  // Matches the `email` column OR raw->>'corporateEmail' — a vendor's inbound
  // gateway email can be the corporate contact address rather than the
  // primary login email, and the in-memory lookup this replaces checked both.
  const result = await pool.query(
    `SELECT raw FROM vendors
     WHERE lower(email) = lower($1) OR lower(raw->>'corporateEmail') = lower($1)
     LIMIT 1`,
    [email],
    {
      d1: true,
      d1Text: `SELECT raw FROM vendors
     WHERE lower(email) = lower($1) OR lower(json_extract(raw,'$.corporateEmail')) = lower($1)
     LIMIT 1`,
      useCache: true,
      tag: 'vendors',
      ttlMs: 60000,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

/**
 * A buyer's own uploaded/added vendors only (never the public network) —
 * bounded, so it never reads more than `limit` rows regardless of table
 * size. Used by storeService.getBootstrapData's buyer-scoped branch, which
 * used to call storeService.getVendors() (a full unbounded re-sync of the
 * exhausted (6.7M rows read in 24h against a 20k-row table: confirmed live
 * via `wrangler d1 info`). A buyer's own vendor count is realistically
 * small, but this stays bounded rather than trusting that assumption.
 */
async function getVendorsByBuyerFromDB(buyerId, limit, sessionEmail) {
  if (!pool.hasStorage()) return [];

  const candidateSet = new Set();
  const addCandidate = (val) => {
    if (!val) return;
    const s = String(val).trim().toLowerCase();
    if (s && s !== 'null' && s !== 'undefined') {
      candidateSet.add(s);
    }
  };

  if (Array.isArray(buyerId)) {
    buyerId.forEach(addCandidate);
  } else {
    addCandidate(buyerId);
  }
  addCandidate(sessionEmail);

  for (const candidate of Array.from(candidateSet)) {
    if (candidate.includes('@')) {
      try {
        const acc = await getBuyerAccountByEmailFromDB(candidate);
        if (acc && acc.id) {
          addCandidate(acc.id);
        }
      } catch (_) {}
    }
  }

  const ids = Array.from(candidateSet);
  if (ids.length === 0) return [];

  const maxLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 500) : 500;
  const cacheKey = `buyer_vendors:${ids.sort().join(',')}:${maxLimit}`;
  const cached = queryCache.get(cacheKey);
  if (cached) return cached;

  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const limitPlaceholder = `$${ids.length + 1}`;

  const pgQuery = `SELECT raw FROM vendors
     WHERE (lower(raw->>'buyerId') IN (${placeholders})
        OR lower(raw->>'buyerAccountId') IN (${placeholders})
        OR lower(raw->>'buyerEmail') IN (${placeholders}))
     ORDER BY created_at DESC
     LIMIT ${limitPlaceholder}`;

  const d1Query = `SELECT raw FROM vendors
     WHERE (lower(json_extract(raw,'$.buyerId')) IN (${placeholders})
        OR lower(json_extract(raw,'$.buyerAccountId')) IN (${placeholders})
        OR lower(json_extract(raw,'$.buyerEmail')) IN (${placeholders}))
     ORDER BY created_at DESC
     LIMIT ${limitPlaceholder}`;

  const result = await pool.query(
    pgQuery,
    [...ids, maxLimit],
    {
      d1: true,
      d1Text: d1Query,
    }
  );
  const rows = result.rows.map((row) => parseRaw(row.raw));
  queryCache.set(cacheKey, [], rows, { tag: 'vendors', ttlMs: 120000 });
  return rows;
}

/** Single-row lookup by id — same reasoning as getVendorByEmailFromDB, keyed
 * on the primary key instead. storeService.getVendorById only searches the
 * in-memory this.vendors cache, which at 600k+ real vendors is a capped
 * subset (see getVendorsPageFromDB's own comment) — a vendor surfaced by a
 * live, D1-backed paginated search (e.g. the CM's "All Vendors" invite
 * picker) can be entirely absent from that cache, making an id it just
 * returned fail to resolve moments later. This is the D1 fallback for that. */
async function getVendorByIdFromDB(id) {
  if (!pool.hasStorage() || !id) return null;
  const result = await pool.query(
    'SELECT raw FROM vendors WHERE id = $1 LIMIT 1',
    [id],
    {
      d1: true,
      useCache: true,
      tag: 'vendors',
      ttlMs: 60000,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function upsertVendorInDB(vendor) {
  if (!pool.hasStorage()) return null;
  const { id, email, majorCategory, status, source } = vendor;
  // See upsertEvaluationInDB's comment for why the D1 path needs its own
  // ISO-formatted timestamp rather than plain CURRENT_TIMESTAMP/now() —
  // created_at is sorted on directly by getVendorsFromDB/getVendorsPageFromDB.
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
    [id, email || null, majorCategory || null, status || null, source || null, JSON.stringify(vendor)],
    {
      d1: true,
      d1Text: `INSERT INTO vendors (id, email, major_category, status, source, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       major_category = EXCLUDED.major_category,
       status = EXCLUDED.status,
       source = EXCLUDED.source,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    }
  );
  queryCache.invalidate('vendors');
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function deleteVendorInDB(id) {
  if (!pool.hasStorage()) return false;
  const result = await pool.query(
    'DELETE FROM vendors WHERE id = $1',
    [id],
    { d1: true }
  );
  queryCache.invalidate('vendors');
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
//
// D1 (Cloudflare's SQLite) enforces two separate limits a single big
// multi-row INSERT can hit: at most 100 bound parameters per statement (at 6
// params/row, ~16 rows), and a per-Worker-invocation cap on the number of
// subrequests it may make (as low as 50 on some plans) — each individual D1
// call is its own subrequest. Splitting one INSERT into many 16-row INSERTs
// fixes the first limit but immediately hits the second (confirmed live: a
// 1000-row chunk split into ~63 sequential 16-row INSERTs failed with "Too
// many API requests by single Worker invocation"). `batchD1` (see
// d1Bridge.js) solves both at once: every row becomes its own single-row
// INSERT (well under the parameter cap), and the whole set is sent to D1 as
// one `db.batch()` call — one subrequest total, regardless of row count.
// Postgres has no such caps, so it keeps the original single multi-row
// INSERT (its own 65535-parameter ceiling is far above anything a single
// request already caps out at via MAX_BULK_IMPORT_ROWS_PER_REQUEST).
async function bulkInsertVendorsInDB(vendors) {
  if (!pool.hasStorage() || vendors.length === 0) return [];

  const d1 = d1Bridge.getD1Binding() || d1Bridge.getD1HttpClient();
  if (d1) {
    const statements = vendors.map((vendor) => ({
      text: `INSERT INTO vendors (id, email, major_category, status, source, raw, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (email) DO NOTHING
       RETURNING email`,
      params: [
        vendor.id,
        vendor.email || null,
        vendor.majorCategory || null,
        vendor.status || null,
        vendor.source || null,
        JSON.stringify(vendor),
      ],
    }));
    const results = await d1Bridge.batchD1(d1, statements);
    queryCache.invalidate('vendors');
    return results.flatMap((result) => result.rows.map((row) => row.email));
  }

  const values = [];
  const placeholders = [];
  vendors.forEach((vendor, i) => {
    const base = i * 6;
    values.push(
      vendor.id,
      vendor.email || null,
      vendor.majorCategory || null,
      vendor.status || null,
      vendor.source || null,
      JSON.stringify(vendor)
    );
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, now())`);
  });
  const result = await pool.query(
    `INSERT INTO vendors (id, email, major_category, status, source, raw, updated_at)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (email) DO NOTHING
     RETURNING email`,
    values
  );
  queryCache.invalidate('vendors');
  return result.rows.map((row) => row.email);
}

// ── Bulk vendor import sessions ─────────────────────────────────────────────

async function createBulkImportSessionInDB(id, createdByEmail, totalRowsDeclared) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `INSERT INTO bulk_vendor_import_sessions (id, created_by_email, total_rows_declared)
     VALUES ($1, $2, $3)
     RETURNING id, status, total_rows_declared, processed_count, imported_count,
               missing_email_count, duplicate_count, invalid_count`,
    [id, createdByEmail, totalRowsDeclared || 0],
    { d1: true }
  );
  return result.rows[0] || null;
}

async function getBulkImportSessionFromDB(id) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `SELECT id, status, total_rows_declared, processed_count, imported_count,
            missing_email_count, duplicate_count, invalid_count
     FROM bulk_vendor_import_sessions WHERE id = $1`,
    [id],
    { d1: true }
  );
  return result.rows[0] || null;
}

async function incrementBulkImportSessionInDB(id, delta) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `UPDATE bulk_vendor_import_sessions SET
       processed_count = processed_count + $2,
       imported_count = imported_count + $3,
       missing_email_count = missing_email_count + $4,
       duplicate_count = duplicate_count + $5,
       invalid_count = invalid_count + $6,
       status = CASE WHEN processed_count + $2 >= total_rows_declared THEN 'COMPLETED' ELSE status END,
       updated_at = now()
     WHERE id = $1
     RETURNING id, status, total_rows_declared, processed_count, imported_count,
               missing_email_count, duplicate_count, invalid_count`,
    [id, delta.processed || 0, delta.imported || 0, delta.missingEmail || 0, delta.duplicate || 0, delta.invalid || 0],
    {
      d1: true,
      d1Text: `UPDATE bulk_vendor_import_sessions SET
       processed_count = processed_count + $2,
       imported_count = imported_count + $3,
       missing_email_count = missing_email_count + $4,
       duplicate_count = duplicate_count + $5,
       invalid_count = invalid_count + $6,
       status = CASE WHEN processed_count + $2 >= total_rows_declared THEN 'COMPLETED' ELSE status END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id, status, total_rows_declared, processed_count, imported_count,
               missing_email_count, duplicate_count, invalid_count`,
    }
  );
  return result.rows[0] || null;
}

// ── RFQs ─────────────────────────────────────────────────────────────────────

async function getRFQsFromDB(buyerAccountId = null, limit = null) {
  if (!pool.hasStorage()) return [];
  const conditions = [];
  const d1Conditions = [];
  const params = [];
  if (buyerAccountId) {
    params.push(String(buyerAccountId));
    const p = params.length;
    conditions.push(`raw->>'buyerAccountId' = $${p}`);
    d1Conditions.push(`json_extract(raw, '$.buyerAccountId') = $${p}`);
  }
  const wherePg = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const whereD1 = d1Conditions.length > 0 ? `WHERE ${d1Conditions.join(' AND ')}` : '';
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  let limitClause = 'LIMIT 1000';
  if (hasLimit) {
    params.push(Math.min(Number(limit), 1000));
    limitClause = `LIMIT $${params.length}`;
  }
  const sql = `SELECT raw FROM rfqs ${wherePg} ORDER BY created_at DESC ${limitClause}`.trim();
  const d1Sql = `SELECT raw FROM rfqs ${whereD1} ORDER BY created_at DESC ${limitClause}`.trim();
  const result = await pool.query(
    sql,
    params,
    { d1: true, d1Text: d1Sql, useCache: true, tag: 'rfqs', ttlMs: 60000 }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function getRFQsByBuyerFromDB(buyerAccountId, limit = 50) {
  return getRFQsFromDB(buyerAccountId, limit);
}

async function getRFQByNumberFromDB(rfqNumber) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    'SELECT raw FROM rfqs WHERE rfq_number = $1 LIMIT 1',
    [rfqNumber],
    { d1: true, useCache: true, tag: 'rfqs', ttlMs: 60000 }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function getRFQByIdFromDB(idOrNumber) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    'SELECT raw FROM rfqs WHERE id = $1 OR rfq_number = $1 LIMIT 1',
    [idOrNumber],
    {
      d1: true,
      d1Text: 'SELECT raw FROM rfqs WHERE id = $1 OR rfq_number = $1 LIMIT 1',
      useCache: true,
      tag: 'rfqs',
      ttlMs: 60000,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function upsertRFQInDB(rfq) {
  if (!pool.hasStorage()) return null;
  const { id, rfqNumber, category, status, sourcingMode, budget } = rfq;
  // See upsertEvaluationInDB's comment for why the D1 path needs its own
  // ISO-formatted timestamp rather than plain CURRENT_TIMESTAMP.
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
    ],
    {
      d1: true,
      d1Text: `INSERT INTO rfqs (id, rfq_number, category, status, sourcing_mode, budget, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       rfq_number = EXCLUDED.rfq_number,
       category = EXCLUDED.category,
       status = EXCLUDED.status,
       sourcing_mode = EXCLUDED.sourcing_mode,
       budget = EXCLUDED.budget,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    }
  );
  queryCache.invalidate('rfqs');
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function deleteRFQInDB(id) {
  if (!pool.hasStorage()) return false;
  const result = await pool.query(
    'DELETE FROM rfqs WHERE id = $1',
    [id],
    { d1: true }
  );
  queryCache.invalidate('rfqs');
  return result.rowCount > 0;
}

// ── Evaluations (append-only — no update/delete method exists) ────────────────

async function getEvaluationsFromDB(limit = null) {
  if (!pool.hasStorage()) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? 'SELECT raw FROM evaluations ORDER BY created_at DESC LIMIT $1'
    : 'SELECT raw FROM evaluations ORDER BY created_at DESC LIMIT 1000';
  const params = hasLimit ? [Math.min(Number(limit), 1000)] : [];
  const result = await pool.query(
    sql,
    params,
    {
      d1: true,
      d1Text: hasLimit ? 'SELECT raw FROM evaluations ORDER BY created_at DESC LIMIT $1' : 'SELECT raw FROM evaluations ORDER BY created_at DESC LIMIT 1000',
      useCache: true,
      tag: 'evaluations',
      ttlMs: 60000,
    }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function upsertEvaluationInDB(evaluation) {
  if (!pool.hasStorage()) return null;
  const { id, vendorId, status } = evaluation;
  // updated_at doesn't drive getEvaluationsFromDB's sort — created_at does,
  // separately defaulted at the schema level — but CURRENT_TIMESTAMP still
  // needs a D1-specific ISO form here: plain CURRENT_TIMESTAMP renders as
  // "YYYY-MM-DD HH:MM:SS" on SQLite, which would sort inconsistently against
  // any ISO-formatted ("...T...Z") timestamp already in the column from
  // migrated data — same trap as authSessionQueries' purge comparison.
  const result = await pool.query(
    `INSERT INTO evaluations (id, vendor_id, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    [id, vendorId || null, status || null, JSON.stringify(evaluation)],
    {
      d1: true,
      d1Text: `INSERT INTO evaluations (id, vendor_id, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    }
  );
  queryCache.invalidate('evaluations');
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

// ── Vendor catalogue ────────────────────────────────────────────────────────

async function getVendorCatalogueFromDB(limit = null) {
  if (!pool.hasStorage()) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? 'SELECT raw FROM vendor_catalogue ORDER BY created_at DESC LIMIT $1'
    : 'SELECT raw FROM vendor_catalogue ORDER BY created_at DESC LIMIT 1000';
  const params = hasLimit ? [Math.min(Number(limit), 1000)] : [];
  const result = await pool.query(
    sql,
    params,
    {
      d1: true,
      d1Text: hasLimit ? 'SELECT raw FROM vendor_catalogue ORDER BY created_at DESC LIMIT $1' : 'SELECT raw FROM vendor_catalogue ORDER BY created_at DESC LIMIT 1000',
      useCache: true,
      tag: 'catalogue',
      ttlMs: 60000,
    }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function upsertCatalogueProductInDB(product) {
  if (!pool.hasStorage()) return null;
  const { id, vendorId, sku, category } = product;
  // See upsertEvaluationInDB's comment: CURRENT_TIMESTAMP on D1 renders in a
  // format that doesn't sort correctly against the ISO created_at/updated_at
  // already in the column from migrated data, since this table's D1 default
  // needs the same ISO form.
  const result = await pool.query(
    `INSERT INTO vendor_catalogue (id, vendor_id, sku, category, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       sku = EXCLUDED.sku,
       category = EXCLUDED.category,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    [id, vendorId || null, sku || null, category || null, JSON.stringify(product)],
    {
      d1: true,
      d1Text: `INSERT INTO vendor_catalogue (id, vendor_id, sku, category, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       vendor_id = EXCLUDED.vendor_id,
       sku = EXCLUDED.sku,
       category = EXCLUDED.category,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    }
  );
  queryCache.invalidate('catalogue');
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function deleteCatalogueProductInDB(id) {
  if (!pool.hasStorage()) return false;
  const result = await pool.query(
    'DELETE FROM vendor_catalogue WHERE id = $1',
    [id],
    { d1: true }
  );
  queryCache.invalidate('catalogue');
  return result.rowCount > 0;
}

// ── Buyer accounts ──────────────────────────────────────────────────────────
// activeBuyerAccount is a pointer into this same collection, not a separate
// record, so it's modelled as an is_active flag rather than its own row —
// getBuyerAccountsFromDB returns both the accounts and which id (if any) is
// flagged active, so storeService can resolve the same object-reference
// invariant it already has in memory.

async function getBuyerAccountsFromDB(limit = null) {
  if (!pool.hasStorage()) return { accounts: [], activeId: null };
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? 'SELECT id, is_active, raw FROM buyer_accounts ORDER BY created_at DESC LIMIT $1'
    : 'SELECT id, is_active, raw FROM buyer_accounts ORDER BY created_at DESC LIMIT 1000';
  const params = hasLimit ? [Math.min(Number(limit), 1000)] : [];
  const result = await pool.query(
    sql,
    params,
    {
      d1: true,
      d1Text: hasLimit ? 'SELECT id, is_active, raw FROM buyer_accounts ORDER BY created_at DESC LIMIT $1' : 'SELECT id, is_active, raw FROM buyer_accounts ORDER BY created_at DESC LIMIT 1000',
      useCache: true,
      tag: 'buyer_accounts',
      ttlMs: 60000,
    }
  );
  const accounts = result.rows.map((row) => parseRaw(row.raw));
  const activeRow = result.rows.find((row) => row.is_active);
  return { accounts, activeId: activeRow ? activeRow.id : null };
}

// Reads straight from Postgres rather than an in-memory cache, so a plan/role
// change made by any other process (a script, another instance) is visible on
// the very next request instead of requiring this process to restart.
async function getBuyerAccountByEmailFromDB(email) {
  if (!pool.hasStorage() || !email) return null;
  const result = await pool.query(
    'SELECT raw FROM buyer_accounts WHERE lower(corporate_email) = lower($1) LIMIT 1',
    [email],
    { d1: true, useCache: true, tag: 'buyer_accounts', ttlMs: 60000 }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function upsertBuyerAccountInDB(account) {
  if (!pool.hasStorage()) return null;
  const { id, corporateEmail, status } = account;
  // is_active is deliberately not touched here — this saves the account's own
  // data, not which account is active. setActiveBuyerAccountInDB owns that flag.
  // See upsertEvaluationInDB's comment for why the D1 path needs its own
  // ISO-formatted timestamp rather than plain CURRENT_TIMESTAMP.
  const result = await pool.query(
    `INSERT INTO buyer_accounts (id, corporate_email, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       corporate_email = EXCLUDED.corporate_email,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = now()
     RETURNING raw`,
    [id, corporateEmail || null, status || null, JSON.stringify(account)],
    {
      d1: true,
      d1Text: `INSERT INTO buyer_accounts (id, corporate_email, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       corporate_email = EXCLUDED.corporate_email,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    }
  );
  queryCache.invalidate('buyer_accounts');
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function deleteBuyerAccountInDB(id) {
  if (!pool.hasStorage()) return false;
  const result = await pool.query(
    'DELETE FROM buyer_accounts WHERE id = $1',
    [id],
    { d1: true }
  );
  queryCache.invalidate('buyer_accounts');
  return result.rowCount > 0;
}

// Exactly one row (or none) carries is_active=true at a time. Passing an id
// that doesn't exist in the table just clears every row's flag, matching
// alignActiveBuyerAccount's in-memory "not found" behaviour of leaving the
// pointer unchanged from the caller's perspective (no row matches either way).
async function setActiveBuyerAccountInDB(id) {
  if (!pool.hasStorage()) return;
  // (id = $1) evaluates to a boolean in Postgres and to 0/1 in SQLite —
  // both assignable straight into is_active, no divergence needed here.
  await pool.query(
    'UPDATE buyer_accounts SET is_active = (id = $1)',
    [id],
    { d1: true }
  );
  queryCache.invalidate('buyer_accounts');
}

// ── AI feed (100-item cap, trimmed here so triggerBatchChaser's bulk-insert
// path — which bypasses addAIFeedItem's in-memory pop() — gets the same
// trim without needing its own bookkeeping of which item to evict) ──────────

async function getAIFeedFromDB(limit = null) {
  if (!pool.hasStorage()) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const params = hasLimit ? [Math.min(Number(limit), 1000)] : [];
  const limitClause = hasLimit ? 'LIMIT $1' : 'LIMIT 1000';
  const sql = `SELECT raw FROM ai_feed ORDER BY sequence DESC ${limitClause}`.trim();
  const d1Sql = `SELECT raw FROM ai_feed ORDER BY rowid DESC ${limitClause}`.trim();
  const result = await pool.query(
    sql,
    params,
    { d1: true, d1Text: d1Sql, useCache: true, tag: 'ai_feed', ttlMs: 30000 }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function upsertAIFeedItemInDB(item) {
  if (!pool.hasStorage()) return null;
  const { id } = item;
  const result = await pool.query(
    `INSERT INTO ai_feed (id, raw) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET raw = EXCLUDED.raw
     RETURNING raw`,
    [id, JSON.stringify(item)],
    { d1: true }
  );
  await pool.query(
    `DELETE FROM ai_feed WHERE id NOT IN (SELECT id FROM ai_feed ORDER BY sequence DESC LIMIT 100)`,
    [],
    {
      d1: true,
      d1Text: `DELETE FROM ai_feed WHERE id NOT IN (SELECT id FROM ai_feed ORDER BY rowid DESC LIMIT 100)`,
    }
  );
  queryCache.invalidate('ai_feed');
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

// ── Audit logs (SHA-256 hash chain — sequence must reflect exact insertion
// order, see schema.sql's comment on audit_logs.sequence) ───────────────────

async function getAuditLogsFromDB(limit = null) {
  if (!pool.hasStorage()) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const params = hasLimit ? [Math.min(Number(limit), 1000)] : [];
  const limitClause = hasLimit ? 'LIMIT $1' : 'LIMIT 1000';
  const sql = `SELECT raw FROM audit_logs ORDER BY sequence DESC ${limitClause}`.trim();
  const d1Sql = `SELECT raw FROM audit_logs ORDER BY rowid DESC ${limitClause}`.trim();
  const result = await pool.query(
    sql,
    params,
    { d1: true, d1Text: d1Sql, useCache: true, tag: 'audit_logs', ttlMs: 30000 }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function upsertAuditLogInDB(entry) {
  if (!pool.hasStorage()) return null;
  const { id } = entry;
  const result = await pool.query(
    `INSERT INTO audit_logs (id, raw) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET raw = EXCLUDED.raw
     RETURNING raw`,
    [id, JSON.stringify(entry)],
    { d1: true }
  );
  queryCache.invalidate('audit_logs');
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

// ── Notifications ────────────────────────────────────────────────────────────

async function getNotificationsFromDB(recipientId = null, limit = null) {
  if (!pool.hasStorage()) return [];
  const conditions = [];
  const params = [];
  if (recipientId) {
    params.push(String(recipientId));
    conditions.push(`recipient_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  let limitClause = 'LIMIT 1000';
  if (hasLimit) {
    params.push(Math.min(Number(limit), 1000));
    limitClause = `LIMIT $${params.length}`;
  }
  const sql = `SELECT raw FROM notifications ${where} ORDER BY sequence DESC ${limitClause}`.trim();
  const d1Sql = `SELECT raw FROM notifications ${where} ORDER BY rowid DESC ${limitClause}`.trim();
  const result = await pool.query(
    sql,
    params,
    { d1: true, d1Text: d1Sql, useCache: true, tag: 'notifications', ttlMs: 15000 }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function insertNotificationInDB(notification) {
  if (!pool.hasStorage()) return null;
  const { id, recipientType, recipientId, kind, rfqId, read } = notification;
  const result = await pool.query(
    `INSERT INTO notifications (id, recipient_type, recipient_id, kind, rfq_id, is_read, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       is_read = EXCLUDED.is_read,
       raw = EXCLUDED.raw
     RETURNING raw`,
    [id, recipientType, recipientId, kind, rfqId || null, !!read, JSON.stringify(notification)],
    { d1: true }
  );
  queryCache.invalidate('notifications');
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

// One multi-row INSERT for the whole fan-out of a single RFQ to every matched
// vendor, rather than a write per vendor.
async function bulkInsertNotificationsInDB(notifications) {
  if (!pool.hasStorage() || notifications.length === 0) return [];
  const values = [];
  const placeholders = notifications.map((n, i) => {
    const base = i * 7;
    values.push(
      n.id,
      n.recipientType,
      n.recipientId,
      n.kind,
      n.rfqId || null,
      !!n.read,
      JSON.stringify(n)
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
  });
  const result = await pool.query(
    `INSERT INTO notifications (id, recipient_type, recipient_id, kind, rfq_id, is_read, raw)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    values,
    { d1: true }
  );
  queryCache.invalidate('notifications');
  return result.rows.map((row) => row.id);
}

async function markNotificationReadInDB(id) {
  if (!pool.hasStorage()) return false;
  // jsonb_set has no shared Postgres/SQLite spelling (SQLite's equivalent is
  // json_set, and 'true'::jsonb is Postgres-only cast syntax), so this needs
  // a real second SQL string for the D1 path rather than a placeholder swap.
  const result = await pool.query(
    `UPDATE notifications
       SET is_read = true, raw = jsonb_set(raw, '{read}', 'true'::jsonb)
     WHERE id = $1`,
    [id],
    {
      d1: true,
      d1Text: `UPDATE notifications
       SET is_read = 1, raw = json_set(raw, '$.read', json('true'))
     WHERE id = $1`,
    }
  );
  queryCache.invalidate('notifications');
  return result.rowCount > 0;
}

async function markAllNotificationsReadInDB(recipientType, recipientId) {
  if (!pool.hasStorage()) return 0;
  const result = await pool.query(
    `UPDATE notifications
       SET is_read = true, raw = jsonb_set(raw, '{read}', 'true'::jsonb)
     WHERE recipient_type = $1 AND recipient_id = $2 AND is_read = false`,
    [recipientType, recipientId],
    {
      d1: true,
      d1Text: `UPDATE notifications
       SET is_read = 1, raw = json_set(raw, '$.read', json('true'))
     WHERE recipient_type = $1 AND recipient_id = $2 AND is_read = false`,
    }
  );
  queryCache.invalidate('notifications');
  return result.rowCount;
}

// ── Zoho OAuth token (single-row cache) ────────────────────────────────────────

async function getZohoOAuthTokenFromDB() {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    "SELECT access_token, expiry_time FROM zoho_oauth_token WHERE id = 'default'",
    [],
    { d1: true, useCache: true, tag: 'zoho_token', ttlMs: 60000 }
  );
  return result.rows[0] || null;
}

async function upsertZohoOAuthTokenInDB({ accessToken, expiryTime }) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `INSERT INTO zoho_oauth_token (id, access_token, expiry_time, last_updated)
     VALUES ('default', $1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       expiry_time = EXCLUDED.expiry_time,
       last_updated = CURRENT_TIMESTAMP
     RETURNING access_token, expiry_time`,
    [accessToken || null, expiryTime || null],
    { d1: true }
  );
  queryCache.invalidate('zoho_token');
  return result.rows[0] || null;
}

// ── Zoho payment links ──────────────────────────────────────────────────────────

/**
 * Postgres's jsonb columns are parsed into objects by the pg driver already;
 * D1 has no JSON column type, so `raw` is stored/read there as plain TEXT and
 * comes back as a string. Parsing only when it's a string keeps this one
 * function correct against either backend without the callers needing to
 * know which one actually served the row.
 */
function parseRaw(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function getPaymentLinksFromDB(limit = null) {
  if (!pool.hasStorage()) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? 'SELECT raw FROM payment_links ORDER BY created_at DESC LIMIT $1'
    : 'SELECT raw FROM payment_links ORDER BY created_at DESC LIMIT 1000';
  const params = hasLimit ? [Math.min(Number(limit), 1000)] : [];
  const result = await pool.query(
    sql,
    params,
    {
      d1: true,
      d1Text: hasLimit ? 'SELECT raw FROM payment_links ORDER BY created_at DESC LIMIT $1' : 'SELECT raw FROM payment_links ORDER BY created_at DESC LIMIT 1000',
      useCache: true,
      tag: 'payment_links',
      ttlMs: 60000,
    }
  );
  return result.rows.map((row) => parseRaw(row.raw));
}

async function getPaymentLinksByVendorFromDB(vendorId, limit = 50) {
  if (!pool.hasStorage() || !vendorId) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? 'SELECT raw FROM payment_links WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT $2'
    : 'SELECT raw FROM payment_links WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 1000';
  const params = hasLimit ? [vendorId, Math.min(Number(limit), 1000)] : [vendorId];
  const result = await pool.query(sql, params, {
    d1: true,
    d1Text: hasLimit
      ? 'SELECT raw FROM payment_links WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT $2'
      : 'SELECT raw FROM payment_links WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 1000',
    useCache: true,
    tag: 'payment_links',
    ttlMs: 60000,
  });
  return result.rows.map((row) => parseRaw(row.raw));
}

async function getPaymentLinksByBuyerFromDB(buyerAccountId, limit = 50) {
  if (!pool.hasStorage() || !buyerAccountId) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? 'SELECT raw FROM payment_links WHERE buyer_account_id = $1 ORDER BY created_at DESC LIMIT $2'
    : 'SELECT raw FROM payment_links WHERE buyer_account_id = $1 ORDER BY created_at DESC LIMIT 1000';
  const params = hasLimit ? [buyerAccountId, Math.min(Number(limit), 1000)] : [buyerAccountId];
  const result = await pool.query(sql, params, {
    d1: true,
    d1Text: hasLimit
      ? 'SELECT raw FROM payment_links WHERE buyer_account_id = $1 ORDER BY created_at DESC LIMIT $2'
      : 'SELECT raw FROM payment_links WHERE buyer_account_id = $1 ORDER BY created_at DESC LIMIT 1000',
    useCache: true,
    tag: 'payment_links',
    ttlMs: 60000,
  });
  return result.rows.map((row) => parseRaw(row.raw));
}

async function getPaymentLinkByIdFromDB(id) {
  if (!pool.hasStorage() || !id) return null;
  const result = await pool.query(
    'SELECT raw FROM payment_links WHERE id = $1 LIMIT 1',
    [id],
    {
      d1: true,
      d1Text: 'SELECT raw FROM payment_links WHERE id = $1 LIMIT 1',
      useCache: true,
      tag: 'payment_links',
      ttlMs: 60000,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function getPaymentLinkByZohoIdFromDB(zohoPaymentLinkId) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    'SELECT raw FROM payment_links WHERE zoho_payment_link_id = $1 LIMIT 1',
    [zohoPaymentLinkId],
    {
      d1: true,
      d1Text: 'SELECT raw FROM payment_links WHERE zoho_payment_link_id = $1 LIMIT 1',
      useCache: true,
      tag: 'payment_links',
      ttlMs: 60000,
    }
  );
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

async function upsertPaymentLinkInDB(link) {
  if (!pool.hasStorage()) return null;
  const { id, zohoPaymentLinkId, vendorId, buyerAccountId, payerType, status } = link;
  const result = await pool.query(
    `INSERT INTO payment_links (id, zoho_payment_link_id, vendor_id, buyer_account_id, payer_type, status, raw, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
     ON CONFLICT (id) DO UPDATE SET
       zoho_payment_link_id = EXCLUDED.zoho_payment_link_id,
       vendor_id = EXCLUDED.vendor_id,
       buyer_account_id = EXCLUDED.buyer_account_id,
       payer_type = EXCLUDED.payer_type,
       status = EXCLUDED.status,
       raw = EXCLUDED.raw,
       updated_at = CURRENT_TIMESTAMP
     RETURNING raw`,
    [id, zohoPaymentLinkId || null, vendorId || null, buyerAccountId || null, payerType || 'vendor', status || null, JSON.stringify(link)],
    { d1: true }
  );
  queryCache.invalidate('payment_links');
  return result.rows[0] ? parseRaw(result.rows[0].raw) : null;
}

// ── Chaser Queue ─────────────────────────────────────────────────────────────
// Persists pending chaser dispatches so they survive process restarts.

/**
 * Write a new pending chaser job.
 * @param {object} job  { id, rfqNumber, rfqId, vendorId, vendorName, vendorPhone, vendorEmail,
 *                        vendorContactPerson, rfqTitle, channel, fireAt (ISO string) }
 */
async function insertChaserJobInDB(job) {
  if (!pool.hasStorage()) return null;
  const {
    id, rfqNumber, rfqId, vendorId, vendorName,
    vendorPhone, vendorEmail, vendorContactPerson,
    rfqTitle, channel, fireAt,
  } = job;
  await pool.query(
    `INSERT INTO chaser_queue
       (id, rfq_number, rfq_id, vendor_id, vendor_name, vendor_phone, vendor_email,
        vendor_contact_person, rfq_title, channel, status, fire_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)
     ON CONFLICT (id) DO NOTHING`,
    [id, rfqNumber, rfqId, vendorId, vendorName,
     vendorPhone || null, vendorEmail || null, vendorContactPerson || null,
     rfqTitle || null, channel, fireAt],
    { d1: true }
  );
  return job;
}

/** Mark a chaser job as fired. */
async function markChaserJobFiredInDB(id) {
  if (!pool.hasStorage()) return;
  await pool.query(
    `UPDATE chaser_queue SET status='fired', fired_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [id],
    { d1: true }
  );
}

/** Mark a chaser job as failed with an error message. */
async function markChaserJobFailedInDB(id, errorMessage) {
  if (!pool.hasStorage()) return;
  await pool.query(
    `UPDATE chaser_queue SET status='failed', error=$2, fired_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [id, errorMessage || 'unknown'],
    { d1: true }
  );
}

/** Cancel all pending chaser jobs for an RFQ (called on RFQ delete/close). */
async function cancelChaserJobsForRFQInDB(rfqNumber) {
  if (!pool.hasStorage()) return;
  await pool.query(
    `UPDATE chaser_queue SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE rfq_number=$1 AND status='pending'`,
    [rfqNumber],
    { d1: true }
  );
}

/**
 * Fetch all pending chaser jobs — called on server boot to re-schedule.
 * Returns rows with all fields needed to reconstruct a vendor/rfq stub.
 */
async function getPendingChaserJobsFromDB(limit = 100) {
  if (!pool.hasStorage()) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? `SELECT id, rfq_number, rfq_id, vendor_id, vendor_name, vendor_phone,
            vendor_email, vendor_contact_person, rfq_title, channel, fire_at
     FROM chaser_queue WHERE status='pending' ORDER BY fire_at ASC LIMIT $1`
    : `SELECT id, rfq_number, rfq_id, vendor_id, vendor_name, vendor_phone,
            vendor_email, vendor_contact_person, rfq_title, channel, fire_at
     FROM chaser_queue WHERE status='pending' ORDER BY fire_at ASC LIMIT 1000`;
  const params = hasLimit ? [Math.min(Number(limit), 1000)] : [];
  const result = await pool.query(
    sql,
    params,
    {
      d1: true,
      d1Text: hasLimit
        ? `SELECT id, rfq_number, rfq_id, vendor_id, vendor_name, vendor_phone,
            vendor_email, vendor_contact_person, rfq_title, channel, fire_at
     FROM chaser_queue WHERE status='pending' ORDER BY fire_at ASC LIMIT $1`
        : `SELECT id, rfq_number, rfq_id, vendor_id, vendor_name, vendor_phone,
            vendor_email, vendor_contact_person, rfq_title, channel, fire_at
     FROM chaser_queue WHERE status='pending' ORDER BY fire_at ASC LIMIT 1000`,
    }
  );
  return result.rows || [];
}

/**
 * Atomically claim due chaser jobs for a scheduled dispatcher.
 * Processing claims older than 15 minutes are reclaimable after a Worker
 * invocation terminates before it can finish dispatching.
 */
async function claimDueChaserJobsFromDB(now, staleBefore, limit = 25) {
  if (!pool.hasStorage()) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const result = await pool.query(
    `UPDATE chaser_queue
     SET status='processing', updated_at=$1
     WHERE id IN (
       SELECT id FROM chaser_queue
       WHERE (status='pending' AND fire_at <= $1)
          OR (status='processing' AND updated_at <= $2)
       ORDER BY fire_at ASC
       LIMIT $3
     )
     RETURNING id, rfq_number, rfq_id, vendor_id, vendor_name, vendor_phone,
               vendor_email, vendor_contact_person, rfq_title, channel, fire_at`,
    [now, staleBefore, safeLimit],
    { d1: true }
  );
  return result.rows || [];
}

// ── RFQ Unlocks & Vendor Credit Transactions ─────────────────────────────────

async function unlockRFQInDB({ id, vendorId, rfqId, creditCharged = 1, source = 'free_credit' }) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `INSERT INTO rfq_unlocks (id, vendor_id, rfq_id, credit_charged, source, unlocked_at, created_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (vendor_id, rfq_id) DO NOTHING
     RETURNING *`,
    [id, vendorId, rfqId, creditCharged, source],
    {
      d1: true,
      // SQLite has no now(); without its own spelling every D1 unlock failed
      // ("no such function: now") once the table existed.
      d1Text: `INSERT INTO rfq_unlocks (id, vendor_id, rfq_id, credit_charged, source, unlocked_at, created_at)
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (vendor_id, rfq_id) DO NOTHING
     RETURNING *`,
    }
  );
  queryCache.invalidate('vendor_credits');
  return result && result.rows ? result.rows[0] : null;
}

async function getRFQUnlockFromDB(vendorId, rfqId) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `SELECT * FROM rfq_unlocks WHERE vendor_id = $1 AND rfq_id = $2 LIMIT 1`,
    [vendorId, rfqId],
    {
      d1: true,
      d1Text: 'SELECT * FROM rfq_unlocks WHERE vendor_id = $1 AND rfq_id = $2 LIMIT 1',
      useCache: true,
      tag: 'vendor_credits',
      ttlMs: 60000,
    }
  );
  return result && result.rows ? result.rows[0] : null;
}

async function getVendorUnlocksFromDB(vendorId, limit = 50) {
  if (!pool.hasStorage() || !vendorId) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? `SELECT * FROM rfq_unlocks WHERE vendor_id = $1 ORDER BY unlocked_at DESC LIMIT $2`
    : `SELECT * FROM rfq_unlocks WHERE vendor_id = $1 ORDER BY unlocked_at DESC LIMIT 1000`;
  const params = hasLimit ? [vendorId, Math.min(Number(limit), 1000)] : [vendorId];
  const result = await pool.query(sql, params, {
    d1: true,
    d1Text: hasLimit
      ? `SELECT * FROM rfq_unlocks WHERE vendor_id = $1 ORDER BY unlocked_at DESC LIMIT $2`
      : `SELECT * FROM rfq_unlocks WHERE vendor_id = $1 ORDER BY unlocked_at DESC LIMIT 1000`,
    useCache: true,
    tag: 'vendor_credits',
    ttlMs: 60000,
  });
  return result && result.rows ? result.rows : [];
}

async function recordCreditTransactionInDB({ id, vendorId, rfqId, transactionType, amount, balanceAfter, idempotencyKey }) {
  if (!pool.hasStorage()) return null;
  const result = await pool.query(
    `INSERT INTO vendor_credit_transactions (id, vendor_id, rfq_id, transaction_type, amount, balance_after, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [id, vendorId, rfqId || null, transactionType, amount, balanceAfter, idempotencyKey || null],
    {
      d1: true,
      d1Text: `INSERT INTO vendor_credit_transactions (id, vendor_id, rfq_id, transaction_type, amount, balance_after, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    }
  );
  queryCache.invalidate('vendor_credits');
  return result && result.rows ? result.rows[0] : null;
}

async function getVendorCreditTransactionsFromDB(vendorId, limit = 50) {
  if (!pool.hasStorage() || !vendorId) return [];
  const hasLimit = Number.isInteger(Number(limit)) && Number(limit) > 0;
  const sql = hasLimit
    ? `SELECT * FROM vendor_credit_transactions WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT $2`
    : `SELECT * FROM vendor_credit_transactions WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 1000`;
  const params = hasLimit ? [vendorId, Math.min(Number(limit), 1000)] : [vendorId];
  const result = await pool.query(sql, params, {
    d1: true,
    d1Text: hasLimit
      ? `SELECT * FROM vendor_credit_transactions WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT $2`
      : `SELECT * FROM vendor_credit_transactions WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 1000`,
    useCache: true,
    tag: 'vendor_credits',
    ttlMs: 60000,
  });
  return result && result.rows ? result.rows : [];
}

/**
 * Fast DB aggregate counting vendors registered between two timestamps without
 * hydrating 600k+ vendor profiles into application memory.
 */
async function countVendorsCreatedBetween(fromDate, toDate) {
  if (!pool.hasStorage()) return 0;
  const f = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const t = toDate instanceof Date ? toDate : new Date(toDate);
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return 0;

  try {
    const res = await pool.query(
      `SELECT COUNT(*)::int AS count FROM vendors WHERE created_at >= $1 AND created_at <= $2`,
      [f.toISOString(), t.toISOString()],
      {
        d1: true,
        d1Text: `SELECT CAST(COUNT(*) AS INTEGER) AS count FROM vendors WHERE created_at >= $1 AND created_at <= $2`,
        useCache: true,
        tag: 'vendors',
        ttlMs: 60000,
      }
    );
    return res && res.rows && res.rows[0] ? Number(res.rows[0].count) || 0 : 0;
  } catch {
    return 0;
  }
}

module.exports = {
  getVendorsFromDB,
  getVendorsPageFromDB,
  countVendorsCreatedBetween,
  countPublicVendorsMatchingCategories,
  getPublicVendorsMatchingCategories,
  getPublicVendorsPerCategoryFromDB,
  getVendorByEmailFromDB,
  getVendorsByBuyerFromDB,
  getVendorByIdFromDB,
  createBulkImportSessionInDB,
  getBulkImportSessionFromDB,
  incrementBulkImportSessionInDB,
  upsertVendorInDB,
  deleteVendorInDB,
  bulkInsertVendorsInDB,
  getRFQsFromDB,
  getRFQsByBuyerFromDB,
  getRFQByNumberFromDB,
  getRFQByIdFromDB,
  upsertRFQInDB,
  deleteRFQInDB,
  getEvaluationsFromDB,
  upsertEvaluationInDB,
  getVendorCatalogueFromDB,
  upsertCatalogueProductInDB,
  deleteCatalogueProductInDB,
  getBuyerAccountsFromDB,
  getBuyerAccountByEmailFromDB,
  upsertBuyerAccountInDB,
  deleteBuyerAccountInDB,
  setActiveBuyerAccountInDB,
  getAIFeedFromDB,
  upsertAIFeedItemInDB,
  getAuditLogsFromDB,
  upsertAuditLogInDB,
  getNotificationsFromDB,
  insertNotificationInDB,
  bulkInsertNotificationsInDB,
  markNotificationReadInDB,
  markAllNotificationsReadInDB,
  getZohoOAuthTokenFromDB,
  upsertZohoOAuthTokenInDB,
  getPaymentLinksFromDB,
  getPaymentLinksByVendorFromDB,
  getPaymentLinksByBuyerFromDB,
  getPaymentLinkByIdFromDB,
  getPaymentLinkByZohoIdFromDB,
  upsertPaymentLinkInDB,
  insertChaserJobInDB,
  markChaserJobFiredInDB,
  markChaserJobFailedInDB,
  cancelChaserJobsForRFQInDB,
  getPendingChaserJobsFromDB,
  claimDueChaserJobsFromDB,
  unlockRFQInDB,
  getRFQUnlockFromDB,
  getVendorUnlocksFromDB,
  recordCreditTransactionInDB,
  getVendorCreditTransactionsFromDB,
};


// ==============================================================================
// RFQ QUERIES (qua_enterprice_rfq)
// ==============================================================================
// Every read in this module is scoped to a buyer organisation. There is no
// "fetch all RFQs" function on purpose: the previous global list is exactly how
// one buyer's dashboard ended up showing another buyer's RFQs, and a helper that
// returns everything would let that regress the moment someone reached for it.
//
// Ownership is taken from the verified session claims by the caller, never from
// the request body, so a client cannot attribute an RFQ to somebody else.
//
// Line items, attachments and the AI summary are stored as JSON documents. They
// are always read and written whole with their parent RFQ and never filtered
// field-wise, so child tables would add joins without buying anything.
// ==============================================================================

const identityPoolModule = require('../db/identityPool');
const { RFQ_PERSISTENCE } = require('../config/constants');
const { logger } = require('../services/loggerService');

const { RFQ_TABLE } = RFQ_PERSISTENCE;

// Selected explicitly rather than SELECT *, so a future column cannot silently
// widen every payload the dashboard receives.
const RFQ_COLUMNS = `
  id, rfq_id, buyer_org_id, buyer_user_id, buyer_email, title, major_category,
  sourcing_mode, status, source, source_file_name, budget, target_delivery_date,
  delivery_location, delivery_pincode, items_json, attachments_json,
  ai_summary_json, created_at, updated_at`;

/**
 * Parse a JSON column without letting one corrupt row break a whole listing.
 * Returns the supplied fallback and logs, rather than throwing.
 */
function parseJsonColumn(value, fallback, context) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? fallback : parsed;
  } catch (err) {
    logger.warn(
      'Discarding unreadable JSON column on an RFQ row.',
      { column: context, errorMessage: err.message },
      'DATABASE'
    );
    return fallback;
  }
}

/**
 * Serialise a value for a JSON column, normalising empty to NULL so the column
 * distinguishes "nothing stored" from "an empty document".
 */
function toJsonColumn(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && value.length === 0) return null;
  return JSON.stringify(value);
}

/**
 * Map a database row to the RFQ shape the frontend consumes.
 *
 * `rfqNumber` and `rfqId` are the same value. The Java scheme id *is* the
 * human-facing number, so both names are exposed rather than making every
 * caller learn which one this table happens to use.
 *
 * buyer_org_id and buyer_user_id are deliberately not returned: they are
 * authorisation inputs, and the client has no use for them.
 */
function mapRowToRFQ(row) {
  return {
    id: String(row.id),
    rfqId: row.rfq_id,
    rfqNumber: row.rfq_id,
    title: row.title,
    category: row.major_category || '',
    sourcingMode: row.sourcing_mode || 'mode_1',
    status: row.status || 'Quotes Pending',
    source: row.source || undefined,
    sourceFileName: row.source_file_name || undefined,
    budget: Number(row.budget) || 0,
    targetDeliveryDate: row.target_delivery_date || '',
    deliveryLocation: row.delivery_location || '',
    deliveryPincode: row.delivery_pincode || '',
    extractedEntities: parseJsonColumn(row.items_json, [], 'items_json'),
    attachments: parseJsonColumn(row.attachments_json, [], 'attachments_json'),
    aiSummary: parseJsonColumn(row.ai_summary_json, null, 'ai_summary_json'),
    raisedByEmail: row.buyer_email,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    // Quotations are not modelled yet. Reported as empty rather than omitted so
    // the dashboard reads the same shape whether or not quotes exist.
    quotes: [],
    quotesCount: 0,
    chasingActive: false,
  };
}

function resolveQuery(options) {
  return options.query || identityPoolModule.identityQuery;
}

/**
 * Insert an RFQ and return it in API shape.
 *
 * @param {object} record  owner fields already resolved from session claims
 * @param {object} [options]
 */
async function insertRFQ(record, options = {}) {
  const query = resolveQuery(options);
  const now = options.now || new Date();

  await query(
    `INSERT INTO \`${RFQ_TABLE}\` (
      rfq_id, buyer_org_id, buyer_user_id, buyer_email, title, major_category,
      sourcing_mode, status, source, source_file_name, budget,
      target_delivery_date, delivery_location, delivery_pincode,
      items_json, attachments_json, ai_summary_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.rfqId,
      record.buyerOrgId,
      record.buyerUserId,
      record.buyerEmail,
      record.title,
      record.category || null,
      record.sourcingMode || null,
      record.status || null,
      record.source || null,
      record.sourceFileName || null,
      Number(record.budget) || 0,
      record.targetDeliveryDate || null,
      record.deliveryLocation || null,
      record.deliveryPincode || null,
      toJsonColumn(record.extractedEntities),
      toJsonColumn(record.attachments),
      toJsonColumn(record.aiSummary),
      now,
      now,
    ]
  );

  const inserted = await findRFQByRfqId(record.rfqId, record.buyerOrgId, options);
  if (!inserted) {
    throw new Error(`RFQ ${record.rfqId} was inserted but could not be read back.`);
  }
  return inserted;
}

/**
 * Every RFQ belonging to one buyer organisation, newest first.
 * Ordering matches idx_qua_rfq_org_created so this does not filesort.
 */
async function listRFQsByOrg(buyerOrgId, options = {}) {
  if (!buyerOrgId) return [];
  const query = resolveQuery(options);
  const rows = await query(
    `SELECT ${RFQ_COLUMNS} FROM \`${RFQ_TABLE}\`
      WHERE buyer_org_id = ?
      ORDER BY created_at DESC, id DESC`,
    [buyerOrgId]
  );
  return (rows || []).map(mapRowToRFQ);
}

/**
 * One RFQ, by its Java-scheme id, scoped to the owning organisation.
 *
 * The organisation is part of the WHERE clause rather than checked after the
 * fetch: a buyer guessing another organisation's rfq_id gets the same "not
 * found" as a buyer guessing an id that does not exist, which leaks nothing
 * about what other organisations have raised.
 */
async function findRFQByRfqId(rfqId, buyerOrgId, options = {}) {
  if (!rfqId || !buyerOrgId) return null;
  const query = resolveQuery(options);
  const rows = await query(
    `SELECT ${RFQ_COLUMNS} FROM \`${RFQ_TABLE}\`
      WHERE rfq_id = ? AND buyer_org_id = ?
      LIMIT 1`,
    [rfqId, buyerOrgId]
  );
  const row = (rows || [])[0];
  return row ? mapRowToRFQ(row) : null;
}

/**
 * Look up by either the surrogate row id or the RFQ number, still org-scoped.
 * The details route accepts whichever the caller holds.
 */
async function findRFQByAnyId(identifier, buyerOrgId, options = {}) {
  if (!identifier || !buyerOrgId) return null;
  const query = resolveQuery(options);
  const numericId = /^\d+$/.test(String(identifier)) ? Number(identifier) : null;
  const rows = await query(
    `SELECT ${RFQ_COLUMNS} FROM \`${RFQ_TABLE}\`
      WHERE buyer_org_id = ? AND (rfq_id = ? OR id = ?)
      LIMIT 1`,
    [buyerOrgId, String(identifier), numericId]
  );
  const row = (rows || [])[0];
  return row ? mapRowToRFQ(row) : null;
}

// Columns an edit is allowed to touch, mapped to the record field carrying the
// new value. Deliberately a whitelist rather than a loop over the request body:
// rfq_id, buyer_org_id, buyer_user_id, buyer_email and created_at establish who
// owns the record and must never be writable, or an edit could hand an RFQ to
// another organisation.
const UPDATABLE_COLUMNS = {
  title: 'title',
  major_category: 'category',
  sourcing_mode: 'sourcingMode',
  status: 'status',
  budget: 'budget',
  target_delivery_date: 'targetDeliveryDate',
  delivery_location: 'deliveryLocation',
  delivery_pincode: 'deliveryPincode',
  items_json: 'extractedEntities',
  attachments_json: 'attachments',
  ai_summary_json: 'aiSummary',
};

/** Columns holding a JSON document, so a value is serialised rather than bound raw. */
const JSON_COLUMNS = new Set(['items_json', 'attachments_json', 'ai_summary_json']);

/**
 * Apply an edit to one RFQ and return the stored result.
 *
 * Only the fields present in `changes` are written, so a partial edit cannot
 * blank a column the caller did not mention. The organisation is part of the
 * WHERE clause, so an attempt to edit another organisation's RFQ updates zero
 * rows and reports the same "not found" as an id that does not exist.
 *
 * Returns null when nothing matched, and the unchanged record when the edit
 * named no writable field.
 *
 * @param {string} rfqId       the Java-scheme RFQ id
 * @param {string} buyerOrgId  organisation from the verified session claims
 * @param {object} changes     partial record in API field names
 */
async function updateRFQ(rfqId, buyerOrgId, changes = {}, options = {}) {
  if (!rfqId || !buyerOrgId) return null;
  const query = resolveQuery(options);
  const now = options.now || new Date();

  const assignments = [];
  const values = [];
  for (const [column, field] of Object.entries(UPDATABLE_COLUMNS)) {
    if (!Object.prototype.hasOwnProperty.call(changes, field)) continue;
    const value = changes[field];
    assignments.push(`${column} = ?`);
    if (JSON_COLUMNS.has(column)) {
      values.push(toJsonColumn(value));
    } else if (column === 'budget') {
      values.push(Number(value) || 0);
    } else {
      // Empty string stores as NULL so "cleared" and "never set" read alike.
      values.push(value === '' || value === undefined ? null : value);
    }
  }

  if (assignments.length === 0) {
    // Nothing writable was named. Reported as the current record rather than as a
    // failure, so a no-op save is not shown to the buyer as an error.
    return findRFQByRfqId(rfqId, buyerOrgId, options);
  }

  assignments.push('updated_at = ?');
  values.push(now);

  const result = await query(
    `UPDATE \`${RFQ_TABLE}\` SET ${assignments.join(', ')}
      WHERE rfq_id = ? AND buyer_org_id = ?`,
    [...values, rfqId, buyerOrgId]
  );

  // affectedRows of 0 means no row matched the id *and* the organisation.
  if (Number(result?.affectedRows ?? 0) === 0) {
    logger.warn(
      'RFQ edit matched no row for this organisation.',
      { rfqId, buyerOrgId },
      'DATABASE'
    );
    return null;
  }

  return findRFQByRfqId(rfqId, buyerOrgId, options);
}

/**
 * Delete one RFQ, scoped to the owning organisation.
 *
 * A hard delete: the row carries no soft-delete column, and adding one would let
 * every existing read return withdrawn RFQs unless each was also changed. The
 * organisation is in the WHERE clause, so a cross-organisation attempt deletes
 * nothing and reports false.
 *
 * @returns {Promise<boolean>} whether a row was removed
 */
async function deleteRFQ(rfqId, buyerOrgId, options = {}) {
  if (!rfqId || !buyerOrgId) return false;
  const query = resolveQuery(options);

  const result = await query(
    `DELETE FROM \`${RFQ_TABLE}\` WHERE rfq_id = ? AND buyer_org_id = ?`,
    [rfqId, buyerOrgId]
  );

  const removed = Number(result?.affectedRows ?? 0) > 0;
  if (!removed) {
    logger.warn(
      'RFQ delete matched no row for this organisation.',
      { rfqId, buyerOrgId },
      'DATABASE'
    );
  }
  return removed;
}

/**
 * How many RFQs the organisation has raised, for quota and dashboard counters.
 */
async function countRFQsByOrg(buyerOrgId, options = {}) {
  if (!buyerOrgId) return 0;
  const query = resolveQuery(options);
  const rows = await query(
    `SELECT COUNT(*) AS total FROM \`${RFQ_TABLE}\` WHERE buyer_org_id = ?`,
    [buyerOrgId]
  );
  return Number(rows?.[0]?.total || 0);
}

module.exports = {
  RFQ_COLUMNS,
  UPDATABLE_COLUMNS,
  parseJsonColumn,
  toJsonColumn,
  mapRowToRFQ,
  insertRFQ,
  listRFQsByOrg,
  findRFQByRfqId,
  findRFQByAnyId,
  updateRFQ,
  deleteRFQ,
  countRFQsByOrg,
};

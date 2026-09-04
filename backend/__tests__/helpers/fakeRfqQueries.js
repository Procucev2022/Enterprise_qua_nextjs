// ==============================================================================
// IN-MEMORY DOUBLE FOR rfqQueries
// ==============================================================================
// The HTTP suites exercise routing, auth and org scoping, not SQL. CI has no
// MySQL credentials, so requiring a live connection would make the whole gate
// depend on database availability for reasons unrelated to the code under test.
//
// This double keeps the org-scoping semantics of the real module exactly, because
// that is the behaviour the tests are asserting:
//   - reads are filtered by buyer_org_id
//   - a cross-organisation lookup returns null, indistinguishable from a miss
//   - there is no "list everything" function
//
// The real SQL is covered separately in rfqQueries.test.js by injecting a query
// function, so both halves are tested without a server.
// ==============================================================================

let rows = [];
let autoId = 0;

/** Clear every stored RFQ. Call from beforeEach so suites do not leak into each other. */
function __reset() {
  rows = [];
  autoId = 0;
}

/** Seed rows directly, bypassing insert, for read-path tests. */
function __seed(records = []) {
  records.forEach((record) => {
    autoId += 1;
    rows.push({ ...record, id: String(autoId), createdAt: record.createdAt || new Date().toISOString() });
  });
}

function __all() {
  return rows;
}

function toApiShape(record) {
  return {
    id: record.id,
    rfqId: record.rfqId,
    rfqNumber: record.rfqId,
    title: record.title,
    category: record.category || '',
    sourcingMode: record.sourcingMode || 'mode_1',
    status: record.status || 'Quotes Pending',
    source: record.source || undefined,
    sourceFileName: record.sourceFileName || undefined,
    budget: Number(record.budget) || 0,
    targetDeliveryDate: record.targetDeliveryDate || '',
    deliveryLocation: record.deliveryLocation || '',
    deliveryPincode: record.deliveryPincode || '',
    extractedEntities: record.extractedEntities || [],
    attachments: record.attachments || [],
    aiSummary: record.aiSummary || null,
    raisedByEmail: record.buyerEmail,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || record.createdAt,
    quotes: [],
    quotesCount: 0,
    chasingActive: false,
  };
}

async function insertRFQ(record) {
  autoId += 1;
  const stored = {
    ...record,
    id: String(autoId),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  rows.unshift(stored);
  return toApiShape(stored);
}

async function listRFQsByOrg(buyerOrgId) {
  if (!buyerOrgId) return [];
  return rows.filter((row) => row.buyerOrgId === buyerOrgId).map(toApiShape);
}

async function findRFQByRfqId(rfqId, buyerOrgId) {
  if (!rfqId || !buyerOrgId) return null;
  const row = rows.find((r) => r.rfqId === rfqId && r.buyerOrgId === buyerOrgId);
  return row ? toApiShape(row) : null;
}

async function findRFQByAnyId(identifier, buyerOrgId) {
  if (!identifier || !buyerOrgId) return null;
  const key = String(identifier);
  const row = rows.find(
    (r) => r.buyerOrgId === buyerOrgId && (r.rfqId === key || String(r.id) === key)
  );
  return row ? toApiShape(row) : null;
}

async function countRFQsByOrg(buyerOrgId) {
  if (!buyerOrgId) return 0;
  return rows.filter((row) => row.buyerOrgId === buyerOrgId).length;
}

// Mirrors the real module's column whitelist. Ownership fields are absent on
// purpose: an edit that could write them would be able to move an RFQ to another
// organisation, and the HTTP suites assert that it cannot.
const WRITABLE_FIELDS = [
  'title',
  'category',
  'sourcingMode',
  'status',
  'budget',
  'targetDeliveryDate',
  'deliveryLocation',
  'deliveryPincode',
  'extractedEntities',
  'attachments',
  'aiSummary',
];

async function updateRFQ(rfqId, buyerOrgId, changes = {}) {
  if (!rfqId || !buyerOrgId) return null;
  const row = rows.find((r) => r.rfqId === rfqId && r.buyerOrgId === buyerOrgId);
  if (!row) return null;

  for (const field of WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      row[field] = field === 'budget' ? Number(changes[field]) || 0 : changes[field];
    }
  }
  row.updatedAt = new Date().toISOString();
  return toApiShape(row);
}

async function deleteRFQ(rfqId, buyerOrgId) {
  if (!rfqId || !buyerOrgId) return false;
  const before = rows.length;
  rows = rows.filter((r) => !(r.rfqId === rfqId && r.buyerOrgId === buyerOrgId));
  return rows.length < before;
}

module.exports = {
  __reset,
  __seed,
  __all,
  insertRFQ,
  listRFQsByOrg,
  findRFQByRfqId,
  findRFQByAnyId,
  updateRFQ,
  deleteRFQ,
  countRFQsByOrg,
};

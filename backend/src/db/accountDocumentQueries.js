// ==============================================================================
// ACCOUNT DOCUMENT QUERIES (PostgreSQL & Relational Pool)
// ==============================================================================
// Durable repository for Buyer & Seller Dossier associated documents:
// Registration, Company Profile, GST, PAN, RFQ attachments, and Quotations.
// Persisted documents live in account_documents. Workflow documents (RFQ
// attachments, evaluation documents, quotations) are read from the workflow
// records and are never copied into memory. Query failures and missing storage
// throw a PERSISTENCE_UNAVAILABLE error.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');
const { logger } = require('../services/loggerService');
const storeService = require('../services/storeService');

const ACCOUNT_DOCUMENT_ERRORS = Object.freeze({
  ACCOUNT_REQUIRED: 'Account type and account id are required for an account document.',
  ACTOR_REQUIRED: 'A signed-in user is required to change account documents.',
  WORKFLOW_NOT_DELETABLE: 'This document is generated from an RFQ, evaluation, or quotation record and cannot be removed from the dossier. Change the source record instead.',
});

const WORKFLOW_DOCUMENT_ID_PREFIXES = Object.freeze(['rfq_doc_', 'eval_doc_', 'quote_doc_']);

function escapeLikeWildcards(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/([%_\\])/g, '\\$1');
}

function stringOrNull(value) {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function lowerOrNull(value) {
  const text = stringOrNull(value);
  return text === null ? null : text.toLowerCase();
}

function boolOrNull(value) {
  return value === undefined || value === null ? null : Boolean(value);
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toTime(value) {
  if (!value) return 0;
  return new Date(value).getTime() || 0;
}

function mapRow(row) {
  if (!row) return null;
  const isDb = 'account_type' in row || 'document_name' in row;
  const createdAt = toIsoOrNull(isDb ? row.created_at : row.createdAt);
  return {
    id: row.id != null ? String(row.id) : null,
    accountType: lowerOrNull(isDb ? row.account_type : row.accountType),
    accountId: stringOrNull(isDb ? row.account_id : row.accountId),
    documentName: stringOrNull(isDb ? row.document_name : row.documentName),
    fileName: stringOrNull(isDb ? row.file_name : row.fileName),
    fileSize: toNumberOrNull(isDb ? row.file_size : row.fileSize),
    mimeType: stringOrNull(isDb ? row.mime_type : row.mimeType),
    category: stringOrNull(row.category),
    fileUrl: stringOrNull(isDb ? row.file_url : row.fileUrl),
    description: stringOrNull(row.description),
    uploadedBy: stringOrNull(isDb ? row.uploaded_by : row.uploadedBy),
    isActive: boolOrNull(isDb ? row.is_active : row.isActive),
    uploadDate: createdAt,
    createdAt,
    updatedAt: toIsoOrNull(isDb ? row.updated_at : row.updatedAt) || createdAt,
    sourceWorkflow: row.sourceWorkflow || (isDb ? 'Direct Upload' : null),
  };
}

function persistenceUnavailable(operation, cause) {
  const error = new Error(`Account document ${operation} failed because configured database persistence is unavailable.`);
  error.code = 'PERSISTENCE_UNAVAILABLE';
  error.cause = cause;
  logger.error('Account document persistence failed', { operation, error: cause }, 'ACCOUNT_DOCUMENT_QUERIES');
  return error;
}

function coded(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requireText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw coded(`Account document ${field} is required.`, 'VALIDATION_FAILED', 400);
  return text;
}

function resolveUploaderName(actor) {
  if (typeof actor === 'string') return actor.trim() || null;
  if (!actor || typeof actor !== 'object') return null;
  return actor.fullName || actor.name || actor.email || null;
}

/**
 * Normalizes document type classification for filtering (PDF, Image, Excel, Word, Other).
 */
function matchesDocumentType(doc, requestedType) {
  if (!requestedType || requestedType === 'all') return true;
  const t = requestedType.toLowerCase().trim();
  const mime = String(doc.mimeType || '').toLowerCase();
  const fn = String(doc.fileName || '').toLowerCase();

  if (t === 'pdf') {
    return mime.includes('pdf') || fn.endsWith('.pdf');
  }
  if (t === 'image') {
    return mime.includes('image') || /\.(jpg|jpeg|png|webp|svg)$/i.test(fn);
  }
  if (t === 'excel') {
    return mime.includes('sheet') || mime.includes('excel') || /\.(xls|xlsx|csv)$/i.test(fn);
  }
  if (t === 'word') {
    return mime.includes('word') || mime.includes('officedocument') || /\.(doc|docx)$/i.test(fn);
  }
  return true;
}

function isWorkflowDocumentId(id) {
  return WORKFLOW_DOCUMENT_ID_PREFIXES.some((prefix) => String(id).startsWith(prefix));
}

/**
 * Workflow documents for a buyer: RFQ attachments. Fields the source record does
 * not hold are null.
 */
function buildBuyerWorkflowDocuments(normId) {
  const documents = [];
  const allRfqs = storeService.rfqs || [];
  const buyerRfqs = allRfqs.filter((r) => r.buyerId === normId || r.buyer === normId).slice(0, 100);

  buyerRfqs.forEach((rfq) => {
    const attList = Array.isArray(rfq.attachments) ? rfq.attachments : [];
    attList.forEach((att, idx) => {
      const recordedAt = rfq.createdAt || null;
      documents.push({
        id: `rfq_doc_${rfq.id}_${att.id || idx}`,
        accountType: 'buyer',
        accountId: normId,
        documentName: `RFQ Specification - ${rfq.rfqNumber || rfq.id}`,
        fileName: att.fileName || att.name || null,
        fileSize: toNumberOrNull(att.fileSize ?? att.size),
        mimeType: att.mimeType || null,
        category: 'RFQ',
        fileUrl: att.fileUrl || att.url || null,
        description: `Technical requisition specifications for RFQ ${rfq.rfqNumber || rfq.id}`,
        uploadedBy: att.uploadedBy || null,
        isActive: true,
        uploadDate: recordedAt,
        createdAt: recordedAt,
        updatedAt: recordedAt,
        sourceWorkflow: 'RFQ Requisition',
      });
    });
  });

  return documents;
}

/**
 * Workflow documents for a seller: evaluation documents and quotations submitted by the vendor.
 */
function buildSellerWorkflowDocuments(normId) {
  const documents = [];
  const evaluations = storeService.evaluations || [];
  const vendorEval = evaluations.find((e) => e.vendorId === normId || e.id === normId);

  if (vendorEval && Array.isArray(vendorEval.documents)) {
    vendorEval.documents.forEach((doc, idx) => {
      const fileName = doc.name || null;
      const lowerName = (fileName || '').toLowerCase();
      // A document whose name carries no category keyword stays unclassified (null).
      let cat = null;
      if (lowerName.includes('gst')) cat = 'GST';
      else if (/(^|[^a-z])pan([^a-z]|$)/i.test(lowerName)) cat = 'PAN';
      else if (lowerName.includes('profile')) cat = 'Company Profile';

      const recordedAt = doc.uploadDate || null;
      documents.push({
        id: `eval_doc_${normId}_${doc.id || idx}`,
        accountType: 'seller',
        accountId: normId,
        documentName: doc.name || 'Compliance audit document',
        fileName,
        fileSize: null,
        mimeType: null,
        category: cat,
        fileUrl: null,
        description: doc.name ? `Statutory verification and onboarding document: ${doc.name}` : null,
        uploadedBy: null,
        isActive: true,
        uploadDate: recordedAt,
        createdAt: recordedAt,
        updatedAt: recordedAt,
        sourceWorkflow: 'Vendor Evaluation',
      });
    });
  }

  const allRfqs = storeService.rfqs || [];
  for (let i = 0; i < allRfqs.length && documents.length < 100; i++) {
    const rfq = allRfqs[i];
    const quotes = Array.isArray(rfq.quotes) ? rfq.quotes : [];
    for (const q of quotes) {
      if (q.vendorId === normId) {
        const recordedAt = q.submittedAt || rfq.createdAt || null;
        documents.push({
          id: `quote_doc_${rfq.id}_${normId}`,
          accountType: 'seller',
          accountId: normId,
          documentName: `Quotation Bid Submission - ${rfq.rfqNumber || rfq.id}`,
          fileName: `Quotation_Bid_${rfq.rfqNumber || rfq.id}.pdf`,
          fileSize: null,
          mimeType: null,
          category: 'Quotation',
          fileUrl: null,
          description: `Itemized commercial bid and technical SLA offer for RFQ ${rfq.rfqNumber || rfq.id}`,
          uploadedBy: q.vendorName || null,
          isActive: true,
          uploadDate: recordedAt,
          createdAt: recordedAt,
          updatedAt: recordedAt,
          sourceWorkflow: 'Quotation Submission',
        });
      }
    }
  }

  return documents;
}

/**
 * List all documents associated with a buyer or seller account.
 * Merges persisted account_documents with workflow documents (RFQs, Evaluations, Quotes).
 */
async function listAccountDocuments(filters = {}) {
  const {
    accountType,
    accountId,
    category,
    type,
    search,
    sortOrder = 'desc',
  } = filters;

  if (!accountType || !accountId) {
    throw coded(ACCOUNT_DOCUMENT_ERRORS.ACCOUNT_REQUIRED, 'VALIDATION_FAILED', 400);
  }
  if (!pool.hasStorage()) throw persistenceUnavailable('list', null);

  const normType = String(accountType).toLowerCase();
  const normId = String(accountId);
  const isAsc = String(sortOrder).toLowerCase() === 'asc';

  let persistedDocs;
  try {
    const orderClause = isAsc ? 'ASC' : 'DESC';
    const queryText = `
      SELECT id, account_type, account_id, document_name, file_name, file_size, mime_type, category, file_url, description, uploaded_by, is_active, created_at, updated_at
      FROM account_documents
      WHERE account_type = $1 AND account_id = $2 AND is_active = 1
      ORDER BY created_at ${orderClause}
    `;
    const result = await pool.query(queryText, [normType, normId]);
    persistedDocs = (result?.rows || []).map(mapRow);
  } catch (err) {
    throw persistenceUnavailable('list', err);
  }

  let workflowDocs = [];
  try {
    if (normType === 'buyer') {
      workflowDocs = buildBuyerWorkflowDocuments(normId);
    } else if (normType === 'seller') {
      workflowDocs = buildSellerWorkflowDocuments(normId);
    }
  } catch (error) {
    logger.error('Workflow documents could not be aggregated for the account dossier', {
      error,
      operation: 'aggregate-workflow-documents',
      accountType: normType,
      accountIdPresent: Boolean(normId),
    }, 'ACCOUNT_DOCUMENT_QUERIES');
  }

  // De-duplicate documents by file name and category, and by id
  const combined = [];
  const seenKeys = new Set();

  [...persistedDocs, ...workflowDocs].forEach((d) => {
    const key = `${String(d.fileName || '').toLowerCase()}_${String(d.category || '').toLowerCase()}`;
    if (!seenKeys.has(key) && !seenKeys.has(d.id)) {
      seenKeys.add(key);
      seenKeys.add(d.id);
      combined.push(d);
    }
  });

  // Filter by category
  let filtered = combined;
  if (category && category !== 'all') {
    const catLower = category.toLowerCase().trim();
    filtered = filtered.filter((d) => (d.category || '').toLowerCase() === catLower);
  }

  // Filter by document type (pdf, image, excel, word)
  if (type && type !== 'all') {
    filtered = filtered.filter((d) => matchesDocumentType(d, type));
  }

  // Search filter
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    filtered = filtered.filter((d) => {
      const name = (d.documentName || '').toLowerCase();
      const fn = (d.fileName || '').toLowerCase();
      const desc = (d.description || '').toLowerCase();
      const up = (d.uploadedBy || '').toLowerCase();
      return name.includes(term) || fn.includes(term) || desc.includes(term) || up.includes(term);
    });
  }

  // Sort by date
  filtered.sort((a, b) => {
    const timeA = toTime(a.uploadDate || a.createdAt);
    const timeB = toTime(b.uploadDate || b.createdAt);
    return isAsc ? timeA - timeB : timeB - timeA;
  });

  return filtered;
}

/**
 * Create/upload a new document for a buyer or seller.
 */
async function createAccountDocument(payload = {}, actor = {}) {
  const accountType = String(payload.accountType || '').toLowerCase();
  const accountId = String(payload.accountId || '');
  if (!accountType || !accountId) {
    throw coded(ACCOUNT_DOCUMENT_ERRORS.ACCOUNT_REQUIRED, 'VALIDATION_FAILED', 400);
  }
  const documentName = requireText(payload.documentName, 'name');
  const fileName = requireText(payload.fileName, 'file name');
  const category = requireText(payload.category, 'category');
  const uploadedBy = resolveUploaderName(actor);
  if (!uploadedBy) throw coded(ACCOUNT_DOCUMENT_ERRORS.ACTOR_REQUIRED, 'ACTOR_REQUIRED', 401);
  if (!pool.hasStorage()) throw persistenceUnavailable('create', null);

  const id = 'adoc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = new Date();
  // file_url is NOT NULL in the schema. An empty string records "no file location".
  const fileUrl = payload.fileUrl || '';
  const isActive = payload.isActive !== false;

  let result;
  try {
    result = await pool.query(
      `INSERT INTO account_documents (
         id, account_type, account_id, document_name, file_name, file_size, mime_type, category, file_url, description, uploaded_by, is_active, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, account_type, account_id, document_name, file_name, file_size, mime_type, category, file_url, description, uploaded_by, is_active, created_at, updated_at`,
      [
        id,
        accountType,
        accountId,
        documentName,
        fileName,
        toNumberOrNull(payload.fileSize),
        payload.mimeType || null,
        category,
        fileUrl,
        payload.description || '',
        uploadedBy,
        isActive ? 1 : 0,
        now,
        now,
      ]
    );
  } catch (err) {
    throw persistenceUnavailable('create', err);
  }

  if (!result?.rows?.[0]) throw persistenceUnavailable('create', new Error('Insert returned no row.'));
  return mapRow(result.rows[0]);
}

/**
 * Delete a persisted account document by ID (marks it inactive).
 * Workflow documents are generated from RFQ, evaluation, or quotation records, so
 * they cannot be removed here. The request is refused rather than acknowledged.
 */
async function deleteAccountDocument(id, accountType, accountId) {
  if (!id) return false;
  if (isWorkflowDocumentId(id)) {
    throw coded(ACCOUNT_DOCUMENT_ERRORS.WORKFLOW_NOT_DELETABLE, 'WORKFLOW_DOCUMENT_NOT_DELETABLE', 409);
  }
  if (!pool.hasStorage()) throw persistenceUnavailable('delete', null);

  const normType = String(accountType || '').toLowerCase();
  const normId = String(accountId || '');

  try {
    const result = await pool.query(
      `UPDATE account_documents
       SET is_active = 0, updated_at = now()
       WHERE id = $1 AND account_type = $2 AND account_id = $3
       RETURNING id`,
      [id, normType, normId]
    );
    return Boolean(result?.rows?.length);
  } catch (err) {
    throw persistenceUnavailable('delete', err);
  }
}

/**
 * Retrieve all account documents across buyers and sellers (for Document Vault integration).
 */
async function getAllAccountDocuments(filters = {}) {
  const { accountType, category, search, activeOnly } = filters;
  if (!pool.hasStorage()) throw persistenceUnavailable('vault list', null);

  const conditions = [];
  const values = [];

  if (activeOnly) {
    conditions.push('is_active = 1');
  }

  if (accountType && accountType !== 'all') {
    values.push(String(accountType).toLowerCase());
    conditions.push(`account_type = $${values.length}`);
  }

  if (category && category !== 'all') {
    values.push(category);
    conditions.push(`category = $${values.length}`);
  }

  if (search && search.trim()) {
    values.push(`%${escapeLikeWildcards(search.trim())}%`);
    const pIndex = values.length;
    conditions.push(`(document_name ILIKE $${pIndex} OR file_name ILIKE $${pIndex} OR description ILIKE $${pIndex})`);
  }

  let list;
  try {
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const queryText = `
      SELECT id, account_type, account_id, document_name, file_name, file_size, mime_type,
             category, file_url, description, uploaded_by, is_active, created_at, updated_at
        FROM account_documents
       ${whereClause}
       ORDER BY created_at DESC
    `;
    const result = await pool.query(queryText, values, { d1: true });
    list = result.rows.map(mapRow);
  } catch (err) {
    throw persistenceUnavailable('vault list', err);
  }

  return list;
}

module.exports = {
  listAccountDocuments,
  createAccountDocument,
  deleteAccountDocument,
  getAllAccountDocuments,
  mapRow,
  matchesDocumentType,
  escapeLikeWildcards,
};

// ==============================================================================
// ACCOUNT DOCUMENT QUERIES (PostgreSQL & Relational Pool with in-memory fallback)
// ==============================================================================
// Durable repository for Buyer & Seller Dossier associated documents:
// Registration, Company Profile, GST, PAN, RFQ attachments, and Quotations.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');
const { logger } = require('../services/loggerService');
const storeService = require('../services/storeService');

function escapeLikeWildcards(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/([%_\\])/g, '\\$1');
}

function mapRow(row) {
  if (!row) return null;
  const isDb = 'account_type' in row || 'document_name' in row;
  const dateVal = (isDb ? row.created_at : row.createdAt) || '2026-01-01T00:00:00.000Z';
  const iso = new Date(dateVal).toISOString();
  return {
    id: String(row.id),
    accountType: String(isDb ? row.account_type : row.accountType).toLowerCase(),
    accountId: String(isDb ? row.account_id : row.accountId),
    documentName: String(isDb ? row.document_name : row.documentName),
    fileName: String(isDb ? row.file_name : row.fileName),
    fileSize: Number((isDb ? row.file_size : row.fileSize) || 0),
    mimeType: String((isDb ? row.mime_type : row.mimeType) || 'application/pdf'),
    category: String(row.category || 'Other'),
    fileUrl: String((isDb ? row.file_url : row.fileUrl) || ''),
    description: String(row.description || ''),
    uploadedBy: String((isDb ? row.uploaded_by : row.uploadedBy) || 'Category Manager'),
    isActive: isDb ? Boolean(row.is_active) : (row.isActive !== false),
    uploadDate: iso,
    createdAt: iso,
    updatedAt: new Date(((isDb ? row.updated_at : row.updatedAt) || dateVal)).toISOString(),
    sourceWorkflow: String(row.sourceWorkflow || 'Direct Upload'),
  };
}

let inMemoryAccountDocuments = [];
const suppressedWorkflowDocIds = new Set();

function resetInMemoryStore() {
  inMemoryAccountDocuments = [];
  suppressedWorkflowDocIds.clear();
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
    return [];
  }

  const normType = String(accountType).toLowerCase();
  const normId = String(accountId);

  let persistedDocs = [];

  if (pool.hasStorage()) {
    try {
      const isAsc = String(sortOrder).toLowerCase() === 'asc';
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
      logger.error('accountDocumentQueries: PostgreSQL listAccountDocuments query failed, falling back to memory', { error: err.message });
      persistedDocs = inMemoryAccountDocuments
        .filter((d) => d.accountType === normType && d.accountId === normId && d.isActive)
        .map(mapRow);
    }
  } else {
    persistedDocs = inMemoryAccountDocuments
      .filter((d) => d.accountType === normType && d.accountId === normId && d.isActive)
      .map(mapRow);
  }

  // ---------------------------------------------------------------------------
  // Aggregate Workflow Documents (RFQ Attachments, Evaluations, Quotes)
  // ---------------------------------------------------------------------------
  const workflowDocs = [];

  if (normType === 'buyer') {
    try {
      const allRfqs = storeService.rfqs || [];
      const buyerRfqs = allRfqs.filter((r) => r.buyerId === normId || r.buyer === normId).slice(0, 100);

      buyerRfqs.forEach((rfq) => {
        const attList = Array.isArray(rfq.attachments) ? rfq.attachments : [];
        attList.forEach((att, idx) => {
          const docId = `rfq_doc_${rfq.id}_${att.id || idx}`;
          if (suppressedWorkflowDocIds.has(docId)) return;

          const fileName = att.fileName || att.name || 'RFQ_spec.pdf';
          workflowDocs.push({
            id: docId,
            accountType: 'buyer',
            accountId: normId,
            documentName: `RFQ Specification - ${rfq.rfqNumber || rfq.id}`,
            fileName,
            fileSize: att.fileSize || att.size || 145000,
            mimeType: att.mimeType || 'application/pdf',
            category: 'RFQ',
            fileUrl: att.fileUrl || att.url || `/documents/${fileName}`,
            description: `Technical requisition specifications for RFQ ${rfq.rfqNumber || rfq.id}`,
            uploadedBy: att.uploadedBy || 'Buyer Operations',
            isActive: true,
            uploadDate: rfq.createdAt || new Date().toISOString(),
            createdAt: rfq.createdAt || new Date().toISOString(),
            updatedAt: rfq.createdAt || new Date().toISOString(),
            sourceWorkflow: 'RFQ Requisition',
          });
        });
      });
    } catch {
      // Non-blocking workflow doc ingestion
    }
  } else if (normType === 'seller') {
    try {
      const evaluations = storeService.evaluations || [];
      const vendorEval = evaluations.find((e) => e.vendorId === normId || e.id === normId);
      if (vendorEval && Array.isArray(vendorEval.documents)) {
        vendorEval.documents.forEach((doc, idx) => {
          const docId = `eval_doc_${normId}_${doc.id || idx}`;
          if (suppressedWorkflowDocIds.has(docId)) return;

          const fileName = doc.name || `Vendor_${normId}_compliance.pdf`;
          let cat = 'Registration';
          const lowerName = fileName.toLowerCase();
          if (lowerName.includes('gst')) cat = 'GST';
          else if (/(^|[^a-z])pan([^a-z]|$)/i.test(fileName)) cat = 'PAN';
          else if (lowerName.includes('profile')) cat = 'Company Profile';

          workflowDocs.push({
            id: docId,
            accountType: 'seller',
            accountId: normId,
            documentName: doc.name || `Compliance Audit Document - ${cat}`,
            fileName,
            fileSize: 220000,
            mimeType: 'application/pdf',
            category: cat,
            fileUrl: `/documents/${fileName}`,
            description: `Statutory verification and onboarding document: ${doc.name}`,
            uploadedBy: 'Vendor Onboarding',
            isActive: true,
            uploadDate: doc.uploadDate || new Date().toISOString(),
            createdAt: doc.uploadDate || new Date().toISOString(),
            updatedAt: doc.uploadDate || new Date().toISOString(),
            sourceWorkflow: 'Vendor Evaluation',
          });
        });
      }

      // Find quotes submitted by vendor
      const allRfqs = storeService.rfqs || [];
      for (let i = 0; i < allRfqs.length && workflowDocs.length < 100; i++) {
        const rfq = allRfqs[i];
        const quotes = Array.isArray(rfq.quotes) ? rfq.quotes : [];
        for (const q of quotes) {
          if (q.vendorId === normId) {
            const docId = `quote_doc_${rfq.id}_${normId}`;
            if (suppressedWorkflowDocIds.has(docId)) continue;

            const fileName = `Quotation_Bid_${rfq.rfqNumber || rfq.id}.pdf`;
            workflowDocs.push({
              id: docId,
              accountType: 'seller',
              accountId: normId,
              documentName: `Quotation Bid Submission - ${rfq.rfqNumber || rfq.id}`,
              fileName,
              fileSize: 185000,
              mimeType: 'application/pdf',
              category: 'Quotation',
              fileUrl: `/documents/${fileName}`,
              description: `Itemized commercial bid and technical SLA offer for RFQ ${rfq.rfqNumber || rfq.id}`,
              uploadedBy: q.vendorName || 'Supplier Representative',
              isActive: true,
              uploadDate: q.submittedAt || rfq.createdAt || new Date().toISOString(),
              createdAt: q.submittedAt || rfq.createdAt || new Date().toISOString(),
              updatedAt: q.submittedAt || rfq.createdAt || new Date().toISOString(),
              sourceWorkflow: 'Quotation Submission',
            });
          }
        }
      }
    } catch {
      // Non-blocking workflow doc ingestion
    }
  }

  // De-duplicate documents by file_name and id
  const combined = [];
  const seenKeys = new Set();

  [...persistedDocs, ...workflowDocs].forEach((d) => {
    const key = `${d.fileName.toLowerCase()}_${d.category.toLowerCase()}`;
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
  const isAsc = String(sortOrder).toLowerCase() === 'asc';
  filtered.sort((a, b) => {
    const timeA = new Date(a.uploadDate || a.createdAt).getTime();
    const timeB = new Date(b.uploadDate || b.createdAt).getTime();
    return isAsc ? timeA - timeB : timeB - timeA;
  });

  return filtered;
}

/**
 * Create/upload a new document for a buyer or seller.
 */
async function createAccountDocument(payload = {}, actor = {}) {
  const id = 'adoc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = new Date();
  const accountType = String(payload.accountType || '').toLowerCase();
  const accountId = String(payload.accountId || '');
  const documentName = payload.documentName || 'Untitled Document';
  const fileName = payload.fileName || 'document.pdf';
  const fileSize = Number(payload.fileSize || 0);
  const mimeType = payload.mimeType || 'application/pdf';
  const category = payload.category || 'Other';
  const fileUrl = payload.fileUrl || `/documents/${encodeURIComponent(fileName)}`;
  const description = payload.description || '';
  
  let uploadedBy = 'Category Manager';
  if (typeof actor === 'string') {
    uploadedBy = actor;
  } else if (actor && typeof actor === 'object') {
    uploadedBy = actor.fullName || actor.name || actor.email || 'Category Manager';
  }
  const isActive = payload.isActive !== false;

  if (pool.hasStorage()) {
    try {
      const result = await pool.query(
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
          fileSize,
          mimeType,
          category,
          fileUrl,
          description,
          uploadedBy,
          isActive ? 1 : 0,
          now,
          now,
        ]
      );
      if (result?.rows?.[0]) {
        return mapRow(result.rows[0]);
      }
    } catch (err) {
      logger.error('accountDocumentQueries: PostgreSQL createAccountDocument insert failed, falling back to memory', { error: err.message });
    }
  }

  const newDoc = {
    id,
    accountType,
    accountId,
    documentName,
    fileName,
    fileSize,
    mimeType,
    category,
    fileUrl,
    description,
    uploadedBy,
    isActive,
    uploadDate: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    sourceWorkflow: 'Direct Upload',
  };

  inMemoryAccountDocuments.push(newDoc);
  return mapRow(newDoc);
}

/**
 * Delete a document by ID.
 * If it's a persisted account_document, marks inactive / removes.
 * If it's a workflow document ID, suppresses it from future listings.
 */
async function deleteAccountDocument(id, accountType, accountId, actor = {}) {
  if (!id) return false;

  const normType = String(accountType || '').toLowerCase();
  const normId = String(accountId || '');

  // If this is a workflow document, record in suppressed set
  if (id.startsWith('rfq_doc_') || id.startsWith('eval_doc_') || id.startsWith('quote_doc_')) {
    suppressedWorkflowDocIds.add(id);
    return true;
  }

  if (pool.hasStorage()) {
    try {
      const result = await pool.query(
        `UPDATE account_documents
         SET is_active = 0, updated_at = now()
         WHERE id = $1 AND account_type = $2 AND account_id = $3
         RETURNING id`,
        [id, normType, normId]
      );
      if (result?.rows?.length) {
        return true;
      }
    } catch (err) {
      logger.error('accountDocumentQueries: PostgreSQL deleteAccountDocument failed, falling back to memory', { error: err.message, id });
    }
  }

  const idx = inMemoryAccountDocuments.findIndex(
    (d) => d.id === id && d.accountType === normType && d.accountId === normId
  );
  if (idx !== -1) {
    inMemoryAccountDocuments[idx].isActive = false;
    inMemoryAccountDocuments.splice(idx, 1);
    return true;
  }

  return false;
}

/**
 * Retrieve all account documents across buyers and sellers (for Document Vault integration).
 */
async function getAllAccountDocuments(filters = {}) {
  const { accountType, category, search, activeOnly } = filters;
  let persistedDocs = [];

  if (pool.hasStorage()) {
    try {
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

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const queryText = `
        SELECT id, account_type, account_id, document_name, file_name, file_size, mime_type,
               category, file_url, description, uploaded_by, is_active, created_at, updated_at
          FROM account_documents
         ${whereClause}
         ORDER BY created_at DESC
      `;
      const result = await pool.query(queryText, values, { d1: true });
      persistedDocs = result.rows.map(mapRow);
    } catch (err) {
      logger.error('accountDocumentQueries: PostgreSQL getAllAccountDocuments failed, falling back to memory', { error: err.message });
      persistedDocs = inMemoryAccountDocuments.slice();
    }
  } else {
    persistedDocs = inMemoryAccountDocuments.slice();
  }

  let list = persistedDocs;
  if (activeOnly) {
    list = list.filter((d) => d.isActive !== false);
  }
  if (accountType && accountType !== 'all') {
    list = list.filter((d) => d.accountType === String(accountType).toLowerCase());
  }
  if (category && category !== 'all') {
    list = list.filter((d) => d.category === category);
  }
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    list = list.filter((d) => {
      const name = (d.documentName || '').toLowerCase();
      const file = (d.fileName || '').toLowerCase();
      const desc = (d.description || '').toLowerCase();
      return name.includes(term) || file.includes(term) || desc.includes(term);
    });
  }

  return list;
}

function getInMemoryDocuments() {
  return inMemoryAccountDocuments.map(mapRow);
}

module.exports = {
  listAccountDocuments,
  createAccountDocument,
  deleteAccountDocument,
  getAllAccountDocuments,
  getInMemoryDocuments,
  resetInMemoryStore,
  mapRow,
  matchesDocumentType,
  escapeLikeWildcards,
};

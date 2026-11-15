// ==============================================================================
// DOCUMENT VAULT QUERIES (PostgreSQL & Relational Pool)
// ==============================================================================
// Relational repository for enterprise collateral, sales pitch decks, rate cards,
// and commercial email attachments. Every read and write goes to the database.
// When storage is unavailable or a query fails, the call throws a
// PERSISTENCE_UNAVAILABLE error instead of answering from memory.
// ==============================================================================

const pool = require('./pool');
const accountDocumentQueries = require('./accountDocumentQueries');
const crypto = require('crypto');
const { logger } = require('../services/loggerService');

const DOCUMENT_VAULT_ERRORS = Object.freeze({
  ACTOR_REQUIRED: 'A signed-in user is required to upload a document to the vault.',
});

function escapeLikeWildcards(str) {
  if (typeof str !== 'string') return '';
  // `!` is the SQL LIKE escape character in both PostgreSQL and SQLite.
  return str.replace(/([!%_])/g, '!$1');
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

function mapRow(row) {
  if (!row) return null;
  const activeValue = row.is_active ?? row.isActive;
  return {
    id: row.id != null ? String(row.id) : null,
    documentName: row.document_name ?? row.documentName ?? null,
    fileName: row.file_name ?? row.fileName ?? null,
    fileSize: toNumberOrNull(row.file_size ?? row.fileSize),
    mimeType: row.mime_type ?? row.mimeType ?? null,
    category: row.category ?? null,
    fileUrl: row.file_url || row.fileUrl || null,
    description: row.description ?? null,
    uploadedBy: row.uploaded_by ?? row.uploadedBy ?? null,
    isActive: activeValue === undefined || activeValue === null ? null : Boolean(activeValue),
    createdAt: toIsoOrNull(row.created_at ?? row.createdAt),
    updatedAt: toIsoOrNull(row.updated_at ?? row.updatedAt),
    accountType: row.account_type || row.accountType || 'vault',
    accountId: row.account_id || row.accountId || null,
  };
}

function persistenceUnavailable(operation, cause) {
  const error = new Error(`Document vault ${operation} failed because configured database persistence is unavailable.`);
  error.code = 'PERSISTENCE_UNAVAILABLE';
  error.cause = cause;
  logger.error('Document vault persistence failed', {
    operation,
    error: cause,
  }, 'DOCUMENT_VAULT');
  return error;
}

function requireText(value, field) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    const error = new Error(`Document ${field} is required.`);
    error.code = 'VALIDATION_FAILED';
    throw error;
  }
  return text;
}

function resolveUploaderName(actor) {
  if (typeof actor === 'string') return actor.trim() || null;
  if (!actor || typeof actor !== 'object') return null;
  return actor.fullName || actor.name || actor.corporateEmail || actor.email || null;
}

async function listDocuments(filters = {}) {
  const { category, search, activeOnly, source, accountType } = filters;
  const targetSource = (source || accountType || 'all').toLowerCase();

  if (!pool.hasStorage()) throw persistenceUnavailable('list', null);

  const conditions = [];
  const values = [];

  if (category && category !== 'all') {
    values.push(category);
    conditions.push(`category = $${values.length}`);
  }

  if (activeOnly) {
    conditions.push('is_active = 1');
  }

  if (search && search.trim()) {
    values.push(`%${escapeLikeWildcards(search.trim())}%`);
    const pIndex = values.length;
    conditions.push(`(LOWER(document_name) LIKE LOWER($${pIndex}) ESCAPE '!' OR LOWER(file_name) LIKE LOWER($${pIndex}) ESCAPE '!' OR LOWER(description) LIKE LOWER($${pIndex}) ESCAPE '!')`);
  }

  let vaultDocs;
  try {
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const queryText = `SELECT id, document_name, file_name, file_size, mime_type, category, file_url, description, uploaded_by, is_active, created_at, updated_at FROM document_vault ${whereClause} ORDER BY created_at DESC`;

    const result = await pool.query(queryText, values, { d1: true });
    vaultDocs = result.rows.map(mapRow);
  } catch (err) {
    throw persistenceUnavailable('list', err);
  }

  // Buyer and seller dossier documents are part of the vault listing. A failed
  // lookup fails the whole listing so callers never receive a partial answer.
  let accountDocs;
  try {
    accountDocs = await accountDocumentQueries.getAllAccountDocuments({
      category,
      search,
      activeOnly,
      accountType: (targetSource === 'vault' || targetSource === 'platform') ? null : (targetSource !== 'all' ? targetSource : undefined),
    });
  } catch (err) {
    throw persistenceUnavailable('account document list', err);
  }

  let combined = [...vaultDocs, ...(accountDocs || [])];

  // Apply in-memory category filter if needed
  if (category && category !== 'all') {
    combined = combined.filter((d) => d.category === category);
  }

  // Apply in-memory activeOnly filter if needed
  if (activeOnly) {
    combined = combined.filter((d) => d.isActive === true);
  }

  // Apply in-memory search filter if needed
  if (search && search.trim()) {
    const term = search.trim().toLowerCase();
    combined = combined.filter((d) => {
      const name = (d.documentName || '').toLowerCase();
      const file = (d.fileName || '').toLowerCase();
      const desc = (d.description || '').toLowerCase();
      const uploader = (d.uploadedBy || '').toLowerCase();
      return name.includes(term) || file.includes(term) || desc.includes(term) || uploader.includes(term);
    });
  }

  // Filter by source / accountType
  if (targetSource === 'vault' || targetSource === 'platform') {
    combined = combined.filter((d) => !d.accountType || d.accountType === 'vault');
  } else if (targetSource === 'buyer') {
    combined = combined.filter((d) => d.accountType === 'buyer');
  } else if (targetSource === 'seller') {
    combined = combined.filter((d) => d.accountType === 'seller');
  }

  // Deduplicate by ID
  const seen = new Set();
  const deduplicated = [];
  for (const doc of combined) {
    if (!seen.has(doc.id)) {
      seen.add(doc.id);
      deduplicated.push(doc);
    }
  }

  // Sort by createdAt descending (documents without a date sort last)
  const timeOf = (doc) => (doc.createdAt ? new Date(doc.createdAt).getTime() : 0);
  deduplicated.sort((a, b) => timeOf(b) - timeOf(a));

  return deduplicated;
}

async function getDocumentById(id) {
  if (!id) return null;
  if (!pool.hasStorage()) throw persistenceUnavailable('lookup', null);

  try {
    const result = await pool.query(
      'SELECT id, document_name, file_name, file_size, mime_type, category, file_url, description, uploaded_by, is_active, created_at, updated_at FROM document_vault WHERE id = $1',
      [id],
      { d1: true }
    );
    if (result.rows && result.rows.length > 0) {
      return mapRow(result.rows[0]);
    }
    return null;
  } catch (err) {
    throw persistenceUnavailable('lookup', err);
  }
}

async function createDocument(payload = {}, actor) {
  const documentName = requireText(payload.documentName, 'name');
  const fileName = requireText(payload.fileName, 'file name');
  const category = requireText(payload.category, 'category');
  const uploadedBy = resolveUploaderName(actor);
  if (!uploadedBy) {
    const error = new Error(DOCUMENT_VAULT_ERRORS.ACTOR_REQUIRED);
    error.code = 'ACTOR_REQUIRED';
    error.statusCode = 401;
    throw error;
  }
  if (!pool.hasStorage()) throw persistenceUnavailable('creation', null);

  const id = 'doc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = new Date().toISOString();
  const fileSize = toNumberOrNull(payload.fileSize);
  const mimeType = payload.mimeType || null;
  // file_url is NOT NULL in the schema. An empty string records "no file location".
  const fileUrl = payload.fileUrl || '';
  const description = payload.description || '';
  const isActive = payload.isActive !== undefined ? Boolean(payload.isActive) : true;

  try {
    const result = await pool.query(
      `INSERT INTO document_vault (id, document_name, file_name, file_size, mime_type, category, file_url, description, uploaded_by, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, document_name, file_name, file_size, mime_type, category, file_url, description, uploaded_by, is_active, created_at, updated_at`,
      [
        id,
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
      ],
      { d1: true }
    );
    return mapRow(result.rows[0]);
  } catch (err) {
    throw persistenceUnavailable('creation', err);
  }
}

async function updateDocument(id, updates = {}) {
  if (!id) return null;
  if (!pool.hasStorage()) throw persistenceUnavailable('update', null);

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (updates.documentName !== undefined) {
      fields.push(`document_name = $${idx++}`);
      values.push(updates.documentName);
    }
    if (updates.fileName !== undefined) {
      fields.push(`file_name = $${idx++}`);
      values.push(updates.fileName);
    }
    if (updates.fileSize !== undefined) {
      fields.push(`file_size = $${idx++}`);
      values.push(toNumberOrNull(updates.fileSize));
    }
    if (updates.mimeType !== undefined) {
      fields.push(`mime_type = $${idx++}`);
      values.push(updates.mimeType);
    }
    if (updates.category !== undefined) {
      fields.push(`category = $${idx++}`);
      values.push(updates.category);
    }
    if (updates.fileUrl !== undefined) {
      fields.push(`file_url = $${idx++}`);
      values.push(updates.fileUrl);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(updates.description);
    }
    if (updates.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      values.push(updates.isActive ? 1 : 0);
    }

    fields.push(`updated_at = $${idx++}`);
    values.push(new Date());

    values.push(id);
    const queryText = `UPDATE document_vault SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, document_name, file_name, file_size, mime_type, category, file_url, description, uploaded_by, is_active, created_at, updated_at`;

    const result = await pool.query(queryText, values, { d1: true });
    if (result.rows && result.rows.length > 0) {
      return mapRow(result.rows[0]);
    }
    return null;
  } catch (err) {
    throw persistenceUnavailable('update', err);
  }
}

async function deleteDocument(id) {
  if (!id) return false;
  if (!pool.hasStorage()) throw persistenceUnavailable('deletion', null);

  try {
    const result = await pool.query('DELETE FROM document_vault WHERE id = $1', [id], { d1: true });
    return result.rowCount > 0;
  } catch (err) {
    throw persistenceUnavailable('deletion', err);
  }
}

async function getDocumentVaultSummary() {
  const docs = await listDocuments({ activeOnly: false });
  const totalDocuments = docs.length;
  const activeDocuments = docs.filter((d) => d.isActive).length;
  const totalSizeBytes = docs.reduce((sum, d) => sum + (d.fileSize || 0), 0);
  const categories = new Set(docs.map((d) => d.category));
  const buyerDocuments = docs.filter((d) => d.accountType === 'buyer').length;
  const sellerDocuments = docs.filter((d) => d.accountType === 'seller').length;
  const vaultDocuments = docs.filter((d) => !d.accountType || d.accountType === 'vault').length;

  return {
    totalDocuments,
    activeDocuments,
    totalSizeBytes,
    categoriesCount: categories.size,
    buyerDocuments,
    sellerDocuments,
    vaultDocuments,
  };
}

module.exports = {
  listDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentVaultSummary,
  mapRow,
};

// ==============================================================================
// DOCUMENT VAULT QUERIES (PostgreSQL & Relational Pool with in-memory fallback)
// ==============================================================================
// Relational repository for enterprise collateral, sales pitch decks, rate cards,
// and commercial email attachments.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');
const { logger } = require('../services/loggerService');

function escapeLikeWildcards(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/([%_\\])/g, '\\$1');
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    documentName: row.document_name || row.documentName || '',
    fileName: row.file_name || row.fileName || '',
    fileSize: Number(row.file_size !== undefined && row.file_size !== null ? row.file_size : (row.fileSize || 0)),
    mimeType: row.mime_type || row.mimeType || 'application/pdf',
    category: row.category || 'other',
    fileUrl: row.file_url || row.fileUrl || '',
    description: row.description || '',
    uploadedBy: row.uploaded_by || row.uploadedBy || 'System Admin',
    isActive: row.is_active !== undefined ? Boolean(row.is_active) : (row.isActive !== undefined ? Boolean(row.isActive) : true),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : (row.createdAt || new Date().toISOString()),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : (row.updatedAt || new Date().toISOString()),
  };
}

const DEFAULT_DOCUMENTS = [
  {
    id: 'doc_buyer_roi',
    documentName: 'Enterprise Buyer ROI & Cost Savings Benchmark 2026',
    fileName: 'Buyer_ROI_Benchmark_2026.pdf',
    fileSize: 1850000,
    mimeType: 'application/pdf',
    category: 'marketing_overview',
    fileUrl: '/documents/Buyer_ROI_Benchmark_2026.pdf',
    description: 'Comprehensive financial justification model and benchmark metrics for enterprise procurement teams.',
    uploadedBy: 'Enterprise Growth Team',
    isActive: true,
    createdAt: new Date('2026-01-15T09:00:00Z').toISOString(),
    updatedAt: new Date('2026-01-15T09:00:00Z').toISOString(),
  },
  {
    id: 'doc_pitch_deck',
    documentName: 'Procucev Platform Overview & Capability Deck',
    fileName: 'Procucev_Enterprise_Platform_Overview.pdf',
    fileSize: 3420000,
    mimeType: 'application/pdf',
    category: 'marketing_overview',
    fileUrl: '/documents/Procucev_Enterprise_Platform_Overview.pdf',
    description: 'Executive introductory deck highlighting reverse auctioning, vendor diligence, and ERP integrations.',
    uploadedBy: 'Corporate Sales',
    isActive: true,
    createdAt: new Date('2026-01-16T10:30:00Z').toISOString(),
    updatedAt: new Date('2026-01-16T10:30:00Z').toISOString(),
  },
  {
    id: 'doc_rate_card_standard',
    documentName: 'Standard Commercial Subscription & Transaction Fee Schedule',
    fileName: 'Procucev_Rate_Card_2026.pdf',
    fileSize: 620000,
    mimeType: 'application/pdf',
    category: 'rate_cards',
    fileUrl: '/documents/Procucev_Rate_Card_2026.pdf',
    description: 'Transparent tier schedules, annual platform licensing, and GMV tier rebate scales.',
    uploadedBy: 'Finance & Monetization',
    isActive: true,
    createdAt: new Date('2026-01-20T14:15:00Z').toISOString(),
    updatedAt: new Date('2026-01-20T14:15:00Z').toISOString(),
  },
  {
    id: 'doc_supplier_onboarding',
    documentName: 'Verified Supplier Onboarding & Compliance Packet',
    fileName: 'Supplier_Compliance_Onboarding_Packet.pdf',
    fileSize: 1250000,
    mimeType: 'application/pdf',
    category: 'templates',
    fileUrl: '/documents/Supplier_Compliance_Onboarding_Packet.pdf',
    description: 'Statutory compliance checklists, GSTIN validation steps, and banking authentication forms.',
    uploadedBy: 'Vendor Operations',
    isActive: true,
    createdAt: new Date('2026-01-22T11:00:00Z').toISOString(),
    updatedAt: new Date('2026-01-22T11:00:00Z').toISOString(),
  },
  {
    id: 'doc_sla_agreement',
    documentName: 'Enterprise SLA & Multi-Vendor Guarantee Contract',
    fileName: 'Enterprise_SLA_Master_Agreement.pdf',
    fileSize: 980000,
    mimeType: 'application/pdf',
    category: 'legal_compliance',
    fileUrl: '/documents/Enterprise_SLA_Master_Agreement.pdf',
    description: '99.9% uptime commitments, escrow settlement rules, and supplier penalty framework.',
    uploadedBy: 'Legal Counsel',
    isActive: true,
    createdAt: new Date('2026-01-25T16:45:00Z').toISOString(),
    updatedAt: new Date('2026-01-25T16:45:00Z').toISOString(),
  },
];

let inMemoryDocuments = JSON.parse(JSON.stringify(DEFAULT_DOCUMENTS));

function resetInMemoryStore() {
  inMemoryDocuments = JSON.parse(JSON.stringify(DEFAULT_DOCUMENTS));
}

async function listDocuments(filters = {}) {
  const { category, search, activeOnly } = filters;

  if (pool.hasStorage()) {
    try {
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
        conditions.push(`(document_name ILIKE $${pIndex} OR file_name ILIKE $${pIndex} OR description ILIKE $${pIndex})`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const queryText = `SELECT id, document_name, file_name, file_size, mime_type, category, file_url, description, uploaded_by, is_active, created_at, updated_at FROM document_vault ${whereClause} ORDER BY created_at DESC`;

      const result = await pool.query(queryText, values, { d1: true });
      return result.rows.map(mapRow);
    } catch (err) {
      logger.error('documentVaultQueries: PostgreSQL listDocuments query failed, falling back to memory', { error: err.message });
    }
  }

  let list = inMemoryDocuments.slice();

  if (category && category !== 'all') {
    list = list.filter((d) => d.category === category);
  }

  if (activeOnly) {
    list = list.filter((d) => d.isActive === true);
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

async function getDocumentById(id) {
  if (!id) return null;

  if (pool.hasStorage()) {
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
      logger.error('documentVaultQueries: PostgreSQL getDocumentById query failed, falling back to memory', { error: err.message, id });
    }
  }

  const found = inMemoryDocuments.find((d) => d.id === id);
  return found ? { ...found } : null;
}

async function createDocument(payload = {}, actor) {
  const id = 'doc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = new Date();
  const documentName = payload.documentName || 'Untitled Document';
  const fileName = payload.fileName || 'document.pdf';
  const fileSize = payload.fileSize !== undefined ? Number(payload.fileSize) : 0;
  const mimeType = payload.mimeType || 'application/pdf';
  const category = payload.category || 'other';
  const fileUrl = payload.fileUrl || `/documents/${fileName}`;
  const description = payload.description || '';
  const uploadedBy =
    (actor && (actor.name || actor.corporateEmail || actor.email)) ||
    (typeof actor === 'string' ? actor : 'System Admin');
  const isActive = payload.isActive !== undefined ? Boolean(payload.isActive) : true;

  if (pool.hasStorage()) {
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
          now.toISOString(),
          now.toISOString(),
        ],
        { d1: true }
      );
      return mapRow(result.rows[0]);
    } catch (err) {
      logger.error('documentVaultQueries: PostgreSQL createDocument insert failed, falling back to memory', { error: err.message });
    }
  }

  const newDoc = {
    id,
    documentName,
    fileName,
    fileSize,
    mimeType,
    category,
    fileUrl,
    description,
    uploadedBy,
    isActive,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  inMemoryDocuments.unshift(newDoc);
  return { ...newDoc };
}

async function updateDocument(id, updates = {}) {
  if (!id) return null;

  if (pool.hasStorage()) {
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
        values.push(Number(updates.fileSize));
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
      logger.error('documentVaultQueries: PostgreSQL updateDocument failed, falling back to memory', { error: err.message, id });
    }
  }

  const idx = inMemoryDocuments.findIndex((d) => d.id === id);
  if (idx === -1) return null;

  const current = inMemoryDocuments[idx];
  const updated = {
    ...current,
    documentName: updates.documentName !== undefined ? updates.documentName : current.documentName,
    fileName: updates.fileName !== undefined ? updates.fileName : current.fileName,
    fileSize: updates.fileSize !== undefined ? Number(updates.fileSize) : current.fileSize,
    mimeType: updates.mimeType !== undefined ? updates.mimeType : current.mimeType,
    category: updates.category !== undefined ? updates.category : current.category,
    fileUrl: updates.fileUrl !== undefined ? updates.fileUrl : current.fileUrl,
    description: updates.description !== undefined ? updates.description : current.description,
    isActive: updates.isActive !== undefined ? Boolean(updates.isActive) : current.isActive,
    updatedAt: new Date().toISOString(),
  };

  inMemoryDocuments[idx] = updated;
  return { ...updated };
}

async function deleteDocument(id) {
  if (!id) return false;

  if (pool.hasStorage()) {
    try {
      const result = await pool.query('DELETE FROM document_vault WHERE id = $1', [id], { d1: true });
      return result.rowCount > 0;
    } catch (err) {
      logger.error('documentVaultQueries: PostgreSQL deleteDocument query failed, falling back to memory', { error: err.message, id });
    }
  }

  const idx = inMemoryDocuments.findIndex((d) => d.id === id);
  if (idx !== -1) {
    inMemoryDocuments.splice(idx, 1);
    return true;
  }

  return false;
}

async function getDocumentVaultSummary() {
  const docs = await listDocuments();
  const totalDocuments = docs.length;
  const activeDocuments = docs.filter((d) => d.isActive).length;
  const totalSizeBytes = docs.reduce((sum, d) => sum + (d.fileSize || 0), 0);
  const categories = new Set(docs.map((d) => d.category));

  return {
    totalDocuments,
    activeDocuments,
    totalSizeBytes,
    categoriesCount: categories.size,
  };
}

module.exports = {
  resetInMemoryStore,
  listDocuments,
  getDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentVaultSummary,
  mapRow,
};

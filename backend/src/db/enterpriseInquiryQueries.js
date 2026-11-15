const crypto = require('crypto');
const pool = require('./pool');
const { logger } = require('../services/loggerService');

const RETURNING_COLUMNS = `
  id, company_name, email, mobile, buyer_account_id, notes, status,
  contacted_by, contacted_at, created_at, updated_at
`;

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  return value || null;
}

function mapInquiry(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyName: row.company_name,
    email: row.email,
    mobile: row.mobile,
    buyerAccountId: row.buyer_account_id || null,
    notes: row.notes || '',
    status: row.status,
    contactedBy: row.contacted_by || null,
    contactedAt: toIsoString(row.contacted_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function persistenceError(operation, cause) {
  const error = new Error(`Enterprise inquiry ${operation} failed because database persistence is unavailable.`);
  error.code = 'PERSISTENCE_UNAVAILABLE';
  error.cause = cause;
  logger.error('Enterprise inquiry database operation failed; refusing process-local fallback', {
    error: cause,
    operation,
  }, 'ENTERPRISE_INQUIRIES');
  return error;
}

function ensureStorage(operation) {
  if (!pool.hasStorage()) {
    throw persistenceError(operation, new Error(pool.NOT_CONFIGURED_MESSAGE));
  }
}

function rethrowPersistenceError(operation, error) {
  if (error && error.code === 'PERSISTENCE_UNAVAILABLE') throw error;
  throw persistenceError(operation, error);
}

async function createEnterpriseInquiry(input) {
  const operation = 'create';
  ensureStorage(operation);
  const now = new Date().toISOString();
  const idempotencyKey = input.idempotencyKey || crypto.randomUUID();
  const id = `ent-inq-${idempotencyKey}`;
  try {
    let result = await pool.query(
      `INSERT INTO enterprise_inquiries
        (id, company_name, email, mobile, buyer_account_id, notes, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'NEW', $7, $7)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${RETURNING_COLUMNS}`,
      [
        id,
        input.companyName.trim(),
        input.email.trim().toLowerCase(),
        input.mobile.trim(),
        input.buyerAccountId || null,
        input.notes || '',
        now,
      ],
      { d1: true }
    );
    let created = true;
    if (!result.rows?.[0]) {
      created = false;
      result = await pool.query(
        `SELECT ${RETURNING_COLUMNS} FROM enterprise_inquiries WHERE id = $1`,
        [id],
        { d1: true }
      );
    }
    const inquiry = mapInquiry(result.rows?.[0]);
    if (!inquiry) throw new Error('Database insert or idempotency lookup returned no enterprise inquiry row.');
    logger.info('Enterprise inquiry persistence completed', {
      operation,
      inquiryId: inquiry.id,
      created,
    }, 'ENTERPRISE_INQUIRIES');
    return { inquiry, created };
  } catch (error) {
    rethrowPersistenceError(operation, error);
  }
}

async function getEnterpriseInquiries(limit = 100) {
  const operation = 'list';
  ensureStorage(operation);
  const effectiveLimit = Number.isInteger(Number(limit)) && Number(limit) > 0
    ? Math.min(Number(limit), 500)
    : 100;
  try {
    const result = await pool.query(
      `SELECT ${RETURNING_COLUMNS}
       FROM enterprise_inquiries
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      [effectiveLimit],
      { d1: true, useCache: false }
    );
    const inquiries = (result.rows || []).map(mapInquiry).filter(Boolean);
    logger.info('Enterprise inquiries loaded from database', {
      operation,
      returnedRows: inquiries.length,
      limit: effectiveLimit,
    }, 'ENTERPRISE_INQUIRIES');
    return inquiries;
  } catch (error) {
    rethrowPersistenceError(operation, error);
  }
}

async function getEnterpriseInquiryById(id) {
  const operation = 'get-by-id';
  ensureStorage(operation);
  try {
    const result = await pool.query(
      `SELECT ${RETURNING_COLUMNS} FROM enterprise_inquiries WHERE id = $1 LIMIT 1`,
      [id],
      { d1: true, useCache: false }
    );
    const inquiry = mapInquiry(result.rows?.[0]);
    logger.info('Enterprise inquiry loaded for background delivery', {
      operation,
      inquiryId: id,
      found: Boolean(inquiry),
    }, 'ENTERPRISE_INQUIRIES');
    return inquiry;
  } catch (error) {
    rethrowPersistenceError(operation, error);
  }
}

async function updateEnterpriseInquiry(id, updates) {
  const operation = 'update';
  ensureStorage(operation);
  const values = [];
  const assignments = [];
  const fields = [
    ['status', 'status'],
    ['notes', 'notes'],
    ['contactedBy', 'contacted_by'],
    ['contactedAt', 'contacted_at'],
  ];
  for (const [inputField, column] of fields) {
    if (updates[inputField] !== undefined) {
      values.push(updates[inputField]);
      assignments.push(`${column} = $${values.length}`);
    }
  }
  if (assignments.length === 0) return null;
  assignments.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  try {
    const result = await pool.query(
      `UPDATE enterprise_inquiries
       SET ${assignments.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${RETURNING_COLUMNS}`,
      values,
      { d1: true }
    );
    const inquiry = mapInquiry(result.rows?.[0]);
    logger.info('Enterprise inquiry update completed', {
      operation,
      inquiryId: id,
      found: Boolean(inquiry),
      updatedFields: fields.filter(([inputField]) => updates[inputField] !== undefined).map(([, column]) => column),
    }, 'ENTERPRISE_INQUIRIES');
    return inquiry;
  } catch (error) {
    rethrowPersistenceError(operation, error);
  }
}

module.exports = {
  createEnterpriseInquiry,
  getEnterpriseInquiryById,
  getEnterpriseInquiries,
  mapInquiry,
  updateEnterpriseInquiry,
};

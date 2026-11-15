// ==============================================================================
// APPROVAL QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Aggregated procurement approvals for credit additions, account verifications,
// trial periods, discounts, purchase requests, payment reconciliations,
// unit bookings, cancellations, packages, and milestones.
// Every read and write goes to the database. Missing storage or a failed query
// throws a PERSISTENCE_UNAVAILABLE error. No approval is kept in memory.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');
const { getD1Binding, getD1HttpClient, batchD1 } = require('./d1Bridge');
const { logger } = require('../services/loggerService');
const { APPROVAL_MESSAGES, isApproverPasswordConfigured, verifyApproverPassword } = require('../config/constants');

const APPROVAL_QUERY_ERRORS = Object.freeze({
  STORAGE_UNAVAILABLE: 'Management approval storage is not configured. No approval data is available.',
  ACTOR_REQUIRED: 'A signed-in approver is required to decide an approval.',
  FIELD_REQUIRED: 'Approval {field} is required.',
});

function persistenceUnavailable(error, operation) {
  logger.error('Management approval persistence operation failed', {
    error,
    operation,
  }, 'APPROVAL_PERSISTENCE');
  const unavailable = new Error('Management approval persistence is temporarily unavailable.');
  unavailable.code = 'PERSISTENCE_UNAVAILABLE';
  unavailable.cause = error;
  return unavailable;
}

function storageUnavailable(operation) {
  logger.error('Management approval storage is not configured', { operation }, 'APPROVAL_PERSISTENCE');
  const unavailable = new Error(APPROVAL_QUERY_ERRORS.STORAGE_UNAVAILABLE);
  unavailable.code = 'PERSISTENCE_UNAVAILABLE';
  return unavailable;
}

function actorRequired() {
  const error = new Error(APPROVAL_QUERY_ERRORS.ACTOR_REQUIRED);
  error.code = 'ACTOR_REQUIRED';
  error.statusCode = 401;
  return error;
}

function requiredField(value, field) {
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === undefined || text === null || text === '') {
    const error = new Error(APPROVAL_QUERY_ERRORS.FIELD_REQUIRED.replace('{field}', field));
    error.code = 'APPROVAL_FIELD_REQUIRED';
    error.statusCode = 400;
    error.field = field;
    throw error;
  }
  return text;
}

function approvalConflict() {
  const conflict = new Error('This approval was already decided. Refresh the list before taking another action.');
  conflict.code = 'APPROVAL_ALREADY_DECIDED';
  return conflict;
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

function generateRequestNumber() {
  return `REQ-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function toSummary(rows) {
  const summary = { pending: 0, approved: 0, rejected: 0, total: 0 };
  rows.forEach(({ status, count }) => {
    const normalizedStatus = String(status || '').toLowerCase();
    if (Object.hasOwn(summary, normalizedStatus)) {
      summary[normalizedStatus] = Number(count) || 0;
    }
  });
  summary.total = summary.pending + summary.approved + summary.rejected;
  return summary;
}

async function queryApprovals(sql, params = [], options = {}) {
  return pool.query(sql, params, { d1: true, ...options });
}

async function findApprovalInDatabase(id) {
  const sql = 'SELECT * FROM management_approvals WHERE id = $1 OR request_number = $1 LIMIT 1';
  const result = await queryApprovals(sql, [id]);
  return result.rows[0] || null;
}

/** Summary metrics use one aggregate query when durable storage is configured. */
function approvalRecordsCte(d1 = false) {
  const genericAssignedApprover = d1
    ? "COALESCE(json_extract(raw, '$.assigned_approver'), approver_name)"
    : "COALESCE(raw->>'assigned_approver', approver_name)";
  const emptyRaw = d1 ? 'NULL' : 'NULL::jsonb';
  return `WITH approval_records AS (
    SELECT id, request_number, module, project, applicant_name, applicant_email,
      value_impact, maker_name, maker_role, status, details, approver_name,
      approver_remarks, approver_name AS assigned_approver, ${emptyRaw} AS raw,
      created_at, updated_at, 2 AS source_priority
    FROM management_approvals
    UNION ALL
    SELECT id, request_number, module, project, applicant_name, applicant_email,
      value_impact, maker_name, maker_role, status, details, approver_name,
      approver_remarks, ${genericAssignedApprover} AS assigned_approver, raw,
      created_at, updated_at, 1 AS source_priority
    FROM approvals
  ), ranked_approval_records AS (
    SELECT approval_records.*,
      ROW_NUMBER() OVER (PARTITION BY request_number ORDER BY updated_at DESC, source_priority ASC) AS record_rank
    FROM approval_records
  )`;
}

/** Summary metrics aggregate both durable approval workflows in one query. */
async function getApprovalSummary() {
  if (!pool.hasStorage()) throw storageUnavailable('get-approval-summary');

  const sql = `${approvalRecordsCte()}
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN lower(status) = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN lower(status) = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN lower(status) = 'rejected' THEN 1 ELSE 0 END) AS rejected
    FROM ranked_approval_records WHERE record_rank = 1`;
  const d1Text = `${approvalRecordsCte(true)}
    SELECT CAST(COUNT(*) AS INTEGER) AS total,
      SUM(CASE WHEN lower(status) = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN lower(status) = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN lower(status) = 'rejected' THEN 1 ELSE 0 END) AS rejected
    FROM ranked_approval_records WHERE record_rank = 1`;
  try {
    const result = await queryApprovals(sql, [], { d1Text, useCache: true, tag: 'approvals', ttlMs: 15000 });
    const rows = result?.rows || [];
    if (rows.length > 0 && rows.some((row) => row.count !== undefined)) return toSummary(rows);
    const row = rows[0] || {};
    return {
      total: Number(row.total || 0),
      pending: Number(row.pending || 0),
      approved: Number(row.approved || 0),
      rejected: Number(row.rejected || 0),
    };
  } catch (error) {
    throw persistenceUnavailable(error, 'get-approval-summary');
  }
}

/**
 * List approvals with module, status, project, assigned approver, and search filtering.
 */
async function getApprovals({
  module = 'all',
  status = 'all',
  project = 'all',
  search = '',
  assigned_approver = '',
  limit = 50,
  offset = 0,
  sortBy = 'created_at',
  sortOrder = 'desc',
} = {}) {
  if (!pool.hasStorage()) throw storageUnavailable('list-approvals');

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const safeSortFields = ['created_at', 'request_number', 'module', 'applicant_name', 'status', 'value_impact'];
  const sortColumn = safeSortFields.includes(sortBy) ? sortBy : 'created_at';
  const sortDirection = String(sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const filters = [];
  const params = [];
  const addFilter = (value, predicate) => {
    params.push(value);
    filters.push(predicate(params.length));
  };
  if (module && module !== 'all') addFilter(String(module).toLowerCase(), (index) => `lower(module) = $${index}`);
  if (status && status !== 'all') addFilter(String(status).toLowerCase(), (index) => `lower(status) = $${index}`);
  if (project && project !== 'all') addFilter(`%${String(project).trim().toLowerCase()}%`, (index) => `lower(coalesce(project, '')) LIKE $${index}`);
  if (assigned_approver && String(assigned_approver).trim()) {
    addFilter(`%${String(assigned_approver).trim().toLowerCase()}%`, (index) => `lower(coalesce(assigned_approver, '')) LIKE $${index}`);
  }
  if (search && String(search).trim()) {
    const searchValue = `%${String(search).trim().toLowerCase()}%`;
    addFilter(searchValue, (index) => `(
      lower(coalesce(request_number, '')) LIKE $${index} OR
      lower(coalesce(applicant_name, '')) LIKE $${index} OR
      lower(coalesce(applicant_email, '')) LIKE $${index} OR
      lower(coalesce(maker_name, '')) LIKE $${index} OR
      lower(coalesce(project, '')) LIKE $${index} OR
      lower(coalesce(value_impact, '')) LIKE $${index} OR
      lower(coalesce(assigned_approver, '')) LIKE $${index}
    )`);
  }
  const where = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  const records = approvalRecordsCte();
  const d1Records = approvalRecordsCte(true);
  const sql = `${records}
    SELECT *, COUNT(*) OVER() AS total
    FROM ranked_approval_records
    WHERE record_rank = 1 ${where}
    ORDER BY ${sortColumn} ${sortDirection}, request_number ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const d1Text = `${d1Records}
    SELECT *, COUNT(*) OVER() AS total
    FROM ranked_approval_records
    WHERE record_rank = 1 ${where}
    ORDER BY ${sortColumn} ${sortDirection}, request_number ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  try {
    const result = await queryApprovals(sql, [...params, safeLimit, safeOffset], {
      d1Text,
      useCache: true,
      tag: 'approvals',
      ttlMs: 10000,
    });
    const rows = (result?.rows || []).map((row) => {
      const approval = hydrateApprovalRow(row);
      if (approval) delete approval.total;
      return approval;
    }).filter(Boolean);
    if (rows.length > 0) return { rows, total: Number(result.rows[0].total) || 0 };

    const countSql = `${records}
      SELECT COUNT(*) AS total FROM ranked_approval_records
      WHERE record_rank = 1 ${where}`;
    const d1CountSql = `${d1Records}
      SELECT CAST(COUNT(*) AS INTEGER) AS total FROM ranked_approval_records
      WHERE record_rank = 1 ${where}`;
    const countResult = await queryApprovals(countSql, params, { d1Text: d1CountSql, useCache: true, tag: 'approvals', ttlMs: 10000 });
    return { rows: [], total: Number(countResult?.rows?.[0]?.total || 0) };
  } catch (error) {
    throw persistenceUnavailable(error, 'list-approvals');
  }
}

function parseRawObject(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

/**
 * Hydrates an approval row from the database. Fields the row does not hold are null.
 */
function hydrateApprovalRow(row) {
  if (!row) return null;
  const raw = parseRawObject(row.raw);
  return {
    id: row.id,
    request_number: row.request_number,
    module: row.module || raw.request_type || null,
    request_type: raw.request_type || row.module || null,
    project: row.project || null,
    applicant_name: row.applicant_name || null,
    applicant_email: row.applicant_email || null,
    value_impact: row.value_impact || null,
    amount: toNumberOrNull(raw.amount),
    quantity: toNumberOrNull(raw.quantity),
    available_balance: toNumberOrNull(raw.available_balance),
    maker_name: row.maker_name || null,
    maker_role: row.maker_role || null,
    assigned_approver: row.assigned_approver || raw.assigned_approver || null,
    status: row.status || null,
    details: row.details || null,
    approver_name: row.approver_name || null,
    approver_remarks: row.approver_remarks || null,
    internal_task_id: raw.internal_task_id || null,
    buyer_id: raw.buyer_id || null,
    seller_id: raw.seller_id || null,
    history: Array.isArray(raw.history) ? raw.history : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    created_at: toIsoOrNull(row.created_at),
    updated_at: toIsoOrNull(row.updated_at),
    raw,
  };
}

async function getApprovalById(id) {
  if (!id) return null;
  if (!pool.hasStorage()) throw storageUnavailable('get-approval-by-id');

  const sql = 'SELECT * FROM approvals WHERE id = $1 LIMIT 1';
  try {
    const result = await pool.query(sql, [id], { d1: true, d1Text: sql });
    return hydrateApprovalRow(result?.rows?.[0] || null);
  } catch (error) {
    throw persistenceUnavailable(error, 'get-approval-by-id');
  }
}

function prepareApprovalCreate(data = {}, actor = {}) {
  const now = new Date().toISOString();
  const id = data.id || `appr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const request_number = data.request_number || generateRequestNumber();
  const module = requiredField(data.module || data.request_type, 'module');
  const request_type = data.request_type || module;
  const project = data.project || null;
  const applicant_name = requiredField(data.applicant_name, 'applicant name');
  const applicant_email = requiredField(data.applicant_email, 'applicant email');
  const value_impact = data.value_impact || null;
  const maker_name = requiredField(data.maker_name || actor.fullName || actor.name, 'maker name');
  const maker_role = data.maker_role || actor.role || null;
  const assigned_approver = requiredField(data.assigned_approver, 'assigned approver');
  const status = data.status || 'Pending';
  const details = data.details || '';
  const amount = toNumberOrNull(data.amount);
  const quantity = toNumberOrNull(data.quantity);
  const available_balance = toNumberOrNull(data.available_balance);
  const internal_task_id = data.internal_task_id || null;
  const buyer_id = data.buyer_id || null;
  const seller_id = data.seller_id || null;
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const history = Array.isArray(data.history) && data.history.length > 0 ? data.history : [
    {
      action: 'SUBMITTED',
      actor_name: maker_name,
      actor_role: maker_role,
      timestamp: now,
      remarks: details || `Submitted for managerial approval (${assigned_approver}).`,
    },
  ];

  const raw = {
    request_type,
    amount,
    quantity,
    available_balance,
    assigned_approver,
    internal_task_id,
    buyer_id,
    seller_id,
    attachments,
    history,
    ...(data.raw || {}),
  };

  const item = {
    id,
    request_number,
    module,
    request_type,
    project,
    applicant_name,
    applicant_email,
    value_impact,
    amount,
    quantity,
    available_balance,
    maker_name,
    maker_role,
    assigned_approver,
    status,
    details,
    approver_name: null,
    approver_remarks: null,
    internal_task_id,
    buyer_id,
    seller_id,
    attachments,
    history,
    created_at: now,
    updated_at: now,
    raw,
  };

  const sql = `
    INSERT INTO approvals (
      id, request_number, module, project, applicant_name, applicant_email,
      value_impact, maker_name, maker_role, status, details, raw, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `;
  const params = [
    id,
    request_number,
    module,
    project,
    applicant_name,
    applicant_email,
    value_impact,
    maker_name,
    maker_role,
    status,
    details,
    JSON.stringify(raw),
    now,
    now,
  ];

  return { item, statement: { text: sql, params } };
}

/**
 * Create a new approval record in the database.
 */
async function createApproval(data, actor = {}) {
  if (!pool.hasStorage()) throw storageUnavailable('create-approval');
  const prepared = prepareApprovalCreate(data, actor);
  try {
    await pool.query(
      prepared.statement.text,
      prepared.statement.params,
      { d1: true, d1Text: prepared.statement.text }
    );
  } catch (error) {
    throw persistenceUnavailable(error, 'create-approval');
  }

  return prepared.item;
}

/**
 * Process approval or rejection action.
 * For Buyer Credit Additions, updates buyer credit balance and synchronizes corresponding internal task.
 */
async function processApprovalAction(id, { action, remarks = '', password = '', approverName = '' }, actor = {}) {
  const actorId = actor.uuid || actor.id || null;
  const actorName = actor.name || actor.fullName || actor.email || null;
  const actorEmail = actor.email || null;
  if (!actorId && !actorName) throw actorRequired();

  if (!pool.hasStorage()) throw storageUnavailable('process-approval-action');

  if (!isApproverPasswordConfigured(approverName)) {
    const configurationError = new Error(APPROVAL_MESSAGES.PASSWORD_CONFIGURATION_UNAVAILABLE);
    configurationError.code = 'APPROVER_PASSWORD_NOT_CONFIGURED';
    configurationError.statusCode = 503;
    throw configurationError;
  }
  if (!verifyApproverPassword(approverName, password)) {
    const passwordError = new Error(APPROVAL_MESSAGES.PASSWORD_INVALID);
    passwordError.code = 'APPROVER_PASSWORD_INVALID';
    passwordError.statusCode = 401;
    throw passwordError;
  }

  const normalizedAction = String(action || '').toUpperCase().includes('APPROV') ? 'Approved' : 'Rejected';
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const normalizedRemarks = String(remarks || '');

  try {
    const d1 = getD1Binding() || getD1HttpClient();
    let managementApproval = null;
    if (d1) {
      const statements = [
        {
          text: `UPDATE management_approvals
            SET status = $2, approver_id = $3, approver_name = $4,
                approver_email = $5, approver_remarks = $6,
                last_action_id = $7, updated_at = $8
            WHERE (id = $1 OR request_number = $1) AND status = 'Pending'
            RETURNING *`,
          params: [id, normalizedAction, actorId, actorName, actorEmail, normalizedRemarks, eventId, now],
        },
        {
          text: `INSERT INTO management_approval_events
            (id, approval_id, request_number, action, previous_status, new_status,
             actor_id, actor_name, actor_email, remarks, created_at)
            SELECT $1, id, request_number, $2, 'Pending', $2, $3, $4, $5, $6, $7
            FROM management_approvals WHERE last_action_id = $1
            RETURNING id`,
          params: [eventId, normalizedAction, actorId, actorName, actorEmail, normalizedRemarks, now],
        },
      ];
      const results = await batchD1(d1, statements);
      managementApproval = results[0]?.rows?.[0] || null;
      if (managementApproval && !results[1]?.rows?.[0]) {
        throw new Error('Approval state changed but its audit event was not written.');
      }
      if (!managementApproval) {
        const existing = await findApprovalInDatabase(id);
        if (existing) throw approvalConflict();
      }
    } else {
      managementApproval = await pool.withTransaction(async (client) => {
        const currentResult = await client.query(
          'SELECT * FROM management_approvals WHERE id = $1 OR request_number = $1 FOR UPDATE',
          [id]
        );
        const current = currentResult.rows[0];
        if (!current) return null;
        if (current.status !== 'Pending') throw approvalConflict();
        const updateResult = await client.query(
          `UPDATE management_approvals
            SET status = $1, approver_id = $2, approver_name = $3,
                approver_email = $4, approver_remarks = $5,
                last_action_id = $6, updated_at = $7
            WHERE id = $8 AND status = 'Pending'
            RETURNING *`,
          [normalizedAction, actorId, actorName, actorEmail, normalizedRemarks, eventId, now, current.id]
        );
        const saved = updateResult.rows[0];
        if (!saved) throw approvalConflict();
        await client.query(
          `INSERT INTO management_approval_events
            (id, approval_id, request_number, action, previous_status, new_status,
             actor_id, actor_name, actor_email, remarks, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [eventId, saved.id, saved.request_number, normalizedAction, current.status,
            normalizedAction, actorId, actorName, actorEmail, normalizedRemarks, now]
        );
        return saved;
      });
    }

    if (managementApproval) {
      pool.queryCache.invalidate('management_approvals');
      pool.queryCache.invalidate('management_approval_events');
      pool.queryCache.invalidate('approvals');
      logger.audit(`Management approval ${normalizedAction.toLowerCase()}`, actorEmail || actorId || actorName, {
        approvalId: managementApproval.id,
        requestNumber: managementApproval.request_number,
        actorId,
        remarks: normalizedRemarks,
        eventId,
      }, managementApproval.request_number);
      return managementApproval;
    }

    const genericResult = await queryApprovals(
      'SELECT * FROM approvals WHERE id = $1 OR request_number = $1 LIMIT 1',
      [id]
    );
    const genericApproval = genericResult.rows[0];
    if (!genericApproval) return null;
    if (genericApproval.status !== 'Pending') throw approvalConflict();

    const approval = hydrateApprovalRow(genericApproval);
    const history = Array.isArray(approval.history) ? [...approval.history] : [];
    history.push({
      action: normalizedAction.toUpperCase(),
      actor_name: actorName,
      actor_role: actor.role || null,
      timestamp: now,
      remarks: normalizedRemarks || `Request ${normalizedAction.toLowerCase()} by ${actorName}.`,
    });
    const raw = { ...(approval.raw || {}), history };
    const updateSql = `UPDATE approvals
      SET status = $1, approver_name = $2, approver_remarks = $3, updated_at = $4, raw = $5
      WHERE (id = $6 OR request_number = $6) AND status = 'Pending'
      RETURNING *`;
    const updatedResult = await pool.query(
      updateSql,
      [normalizedAction, actorName, normalizedRemarks, now, JSON.stringify(raw), id],
      { d1: true, d1Text: updateSql }
    );
    const saved = updatedResult.rows?.[0];
    if (!saved) {
      const latest = await queryApprovals(
        'SELECT * FROM approvals WHERE id = $1 OR request_number = $1 LIMIT 1',
        [id]
      );
      if (!latest.rows?.[0]) return null;
      throw approvalConflict();
    }

    const updatedApproval = hydrateApprovalRow(saved);
    pool.queryCache.invalidate('approvals');

    if (updatedApproval.internal_task_id) {
      try {
        const internalTaskQueries = require('./internalTaskQueries');
        if (normalizedAction === 'Approved' && internalTaskQueries.approveCreditTask) {
          await internalTaskQueries.approveCreditTask(updatedApproval.internal_task_id, actor, normalizedRemarks);
        } else if (normalizedAction === 'Rejected' && internalTaskQueries.rejectCreditTask) {
          await internalTaskQueries.rejectCreditTask(updatedApproval.internal_task_id, actor, normalizedRemarks);
        }
      } catch (error) {
        logger.error('Approval decision saved but internal credit task synchronization failed', {
          approvalId: updatedApproval.id,
          requestNumber: updatedApproval.request_number,
          internalTaskId: updatedApproval.internal_task_id,
          error,
        }, 'APPROVAL_QUERIES');
      }
    }

    // The requester is notified only when the record holds a requester address.
    if (!updatedApproval.applicant_email) {
      logger.warn('Approval decision saved but no requester email is recorded, so no notification was sent', {
        approvalId: updatedApproval.id,
        requestNumber: updatedApproval.request_number,
      }, 'APPROVAL_QUERIES');
    } else {
      try {
        const actionCenterNotificationService = require('../services/actionCenterNotificationService');
        if (actionCenterNotificationService?.dispatchActionCenterCommunication) {
          await actionCenterNotificationService.dispatchActionCenterCommunication({
            entityType: 'approval',
            entityId: updatedApproval.id,
            channel: 'EMAIL',
            recipientEmail: updatedApproval.applicant_email,
            recipientName: updatedApproval.maker_name || updatedApproval.applicant_name || updatedApproval.applicant_email,
            subject: `[Approval Update] Request ${updatedApproval.request_number} has been ${normalizedAction}`,
            message: `Your approval request ${updatedApproval.request_number} (${updatedApproval.value_impact}) has been ${normalizedAction.toLowerCase()} by ${actorName}. Remarks: ${normalizedRemarks || 'None'}.`,
          }, actor);
        }
      } catch (error) {
        logger.error('Approval decision saved but requester notification failed', {
          approvalId: updatedApproval.id,
          requestNumber: updatedApproval.request_number,
          error,
        }, 'APPROVAL_QUERIES');
      }
    }

    logger.audit(`Approval ${normalizedAction.toLowerCase()}`, actorEmail || actorId || actorName, {
      approvalId: updatedApproval.id,
      requestNumber: updatedApproval.request_number,
      actorId,
      remarks: normalizedRemarks,
      eventId,
    }, updatedApproval.request_number);
    return updatedApproval;
  } catch (error) {
    if (error?.code === 'APPROVAL_ALREADY_DECIDED') throw error;
    throw persistenceUnavailable(error, 'process-approval-action');
  }
}

module.exports = {
  getApprovalSummary,
  getApprovals,
  getApprovalById,
  createApproval,
  prepareApprovalCreate,
  processApprovalAction,
  hydrateApprovalRow,
};

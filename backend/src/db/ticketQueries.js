// ==============================================================================
// TICKET QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Relational queries for support, bug tracking, customer complaints, and SLA
// governance in the Action Center.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');

function parseJsonSafe(val, fallback = null) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

// Every read and write goes to the database. A missing store or a failed query
// throws an error, so no ticket is shown or saved from process memory.
const TICKET_QUERY_ERRORS = Object.freeze({
  STORAGE_UNAVAILABLE: 'Ticket storage is not configured. Ticket data cannot be read or saved.',
  FIELD_REQUIRED: 'Ticket {field} is required. Enter the value and retry.',
  ROW_SET_MISSING: 'The ticket query returned no row set. Retry the request.',
});

function storageUnavailable(operation) {
  const error = new Error(TICKET_QUERY_ERRORS.STORAGE_UNAVAILABLE);
  error.code = 'PERSISTENCE_UNAVAILABLE';
  error.statusCode = 503;
  error.operation = operation;
  return error;
}

function requireStorage(operation) {
  if (!pool.hasStorage()) throw storageUnavailable(operation);
}

function requiredField(value, field) {
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === undefined || text === null || text === '') {
    const error = new Error(TICKET_QUERY_ERRORS.FIELD_REQUIRED.replace('{field}', field));
    error.code = 'VALIDATION_FAILED';
    error.statusCode = 400;
    throw error;
  }
  return text;
}

function requireRowSet(result, operation, { requireOne = false } = {}) {
  const rows = result && Array.isArray(result.rows) ? result.rows : null;
  if (!rows || (requireOne && rows.length === 0)) {
    const error = new Error(TICKET_QUERY_ERRORS.ROW_SET_MISSING);
    error.code = 'PERSISTENCE_UNAVAILABLE';
    error.statusCode = 503;
    error.operation = operation;
    throw error;
  }
  return rows;
}

function generateTicketNumber() {
  return `TKT-${crypto.randomInt(10000, 100000)}`;
}

/**
 * Fetch filtered tickets with pagination and total count.
 */
async function getTickets({
  search = '',
  status = '',
  priority = '',
  category = '',
  project = '',
  assignedTo = '',
  dateFrom = '',
  dateTo = '',
  limit = 50,
  offset = 0,
} = {}) {
  requireStorage('ticket list');

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (status && status !== 'all') {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }

  if (priority && priority !== 'all') {
    conditions.push(`priority = $${paramIdx++}`);
    params.push(priority);
  }

  if (category && category !== 'all') {
    conditions.push(`category = $${paramIdx++}`);
    params.push(category);
  }

  if (project && project !== 'all') {
    conditions.push(`project = $${paramIdx++}`);
    params.push(project);
  }

  if (assignedTo && assignedTo !== 'all') {
    conditions.push(`(assigned_to_user_id = $${paramIdx} OR assigned_to_name ILIKE $${paramIdx + 1})`);
    params.push(assignedTo);
    params.push(`%${assignedTo}%`);
    paramIdx += 2;
  }

  if (dateFrom) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(dateFrom);
  }

  if (dateTo) {
    conditions.push(`created_at <= $${paramIdx++}`);
    params.push(dateTo);
  }

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    conditions.push(
      `(ticket_number ILIKE $${paramIdx} OR subject ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR customer_name ILIKE $${paramIdx} OR customer_email ILIKE $${paramIdx} OR project ILIKE $${paramIdx})`
    );
    params.push(q);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const d1WhereClause = whereClause.replace(/ILIKE/g, 'LIKE');

  const countSql = `SELECT count(*) as total FROM tickets ${whereClause}`;
  const d1CountSql = `SELECT count(*) as total FROM tickets ${d1WhereClause}`;
  const countResult = await pool.query(countSql, params, { d1: true, d1Text: d1CountSql });
  const total = Number(requireRowSet(countResult, 'ticket count', { requireOne: true })[0].total);

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const limitParamIdx = paramIdx;
  const offsetParamIdx = paramIdx + 1;
  const dataParams = [...params, safeLimit, safeOffset];

  const dataSql = `
    SELECT * FROM tickets
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
  `;
  const d1DataSql = `
    SELECT * FROM tickets
    ${d1WhereClause}
    ORDER BY created_at DESC
    LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
  `;

  const dataResult = await pool.query(dataSql, dataParams, { d1: true, d1Text: d1DataSql });
  const rows = requireRowSet(dataResult, 'ticket list').map((row) => ({
    ...row,
    attachments: parseJsonSafe(row.attachments, []),
    metadata: parseJsonSafe(row.metadata, {}),
    raw: parseJsonSafe(row.raw, {}),
  }));

  return { rows, total };
}

/**
 * Summary KPI statistics for Tickets.
 */
async function getTicketSummary() {
  requireStorage('ticket summary');

  const sql = `
    SELECT
      count(*) as total,
      sum(case when status = 'Pending' then 1 else 0 end) as pending,
      sum(case when status = 'In Progress' then 1 else 0 end) as in_progress,
      sum(case when status = 'Escalated' then 1 else 0 end) as escalated,
      sum(case when status = 'Completed' then 1 else 0 end) as completed,
      sum(case when (priority = 'Critical' OR priority = 'High') and status != 'Completed' then 1 else 0 end) as critical_count
    FROM tickets
  `;
  const result = await pool.query(sql, [], { d1: true, d1Text: sql });
  const row = requireRowSet(result, 'ticket summary', { requireOne: true })[0];
  return {
    total: Number(row.total || 0),
    pending: Number(row.pending || 0),
    inProgress: Number(row.in_progress || 0),
    escalated: Number(row.escalated || 0),
    completed: Number(row.completed || 0),
    criticalCount: Number(row.critical_count || 0),
  };
}

/**
 * Fetch a single ticket by ID with its activity history.
 */
async function getTicketById(id) {
  if (!id) return null;

  requireStorage('ticket lookup');

  const sql = 'SELECT * FROM tickets WHERE id = $1 OR ticket_number = $1';
  const result = await pool.query(sql, [id], { d1: true, d1Text: sql });
  if (!result || !result.rows || result.rows.length === 0) return null;

  const ticket = {
    ...result.rows[0],
    attachments: parseJsonSafe(result.rows[0].attachments, []),
    metadata: parseJsonSafe(result.rows[0].metadata, {}),
    raw: parseJsonSafe(result.rows[0].raw, {}),
  };

  const actSql = 'SELECT * FROM ticket_activities WHERE ticket_id = $1 ORDER BY created_at DESC';
  const actResult = await pool.query(actSql, [ticket.id], { d1: true, d1Text: actSql });
  ticket.activities = requireRowSet(actResult, 'ticket activity lookup').map((a) => ({
    ...a,
    metadata: parseJsonSafe(a.metadata, {}),
  }));

  return ticket;
}

/**
 * Create a new ticket.
 */
async function createTicket(data = {}, actor = {}) {
  // Subject and customer or assignee details come from the caller. Nothing is invented.
  const subject = requiredField(data.subject, 'subject');
  const customerName = requiredField(data.customerName || data.customer_name, 'customer name');
  const customerEmail = requiredField(data.customerEmail || data.customer_email, 'customer email');
  const customerPhone = requiredField(data.customerPhone || data.customer_phone, 'customer phone');
  const assignedToName = requiredField(data.assignedToName || data.assigned_to_name, 'assigned to name');
  requireStorage('ticket create');

  const id = `tkt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const ticketNumber = data.ticket_number || data.ticketNumber || generateTicketNumber();
  const now = new Date().toISOString();
  const actorName = actor.name || actor.email || null;

  const slaHours = Number(data.slaHours || data.sla_hours) || 24;
  let dueDate = data.dueDate || data.due_date;
  if (!dueDate) {
    const d = new Date(Date.now() + slaHours * 3600 * 1000);
    dueDate = d.toISOString();
  }

  const record = {
    id,
    ticket_number: ticketNumber,
    subject,
    description: data.description || '',
    status: data.status || 'Pending',
    priority: data.priority || 'Medium',
    category: data.category || null,
    project: data.project || null,
    customer_id: data.customerId || data.customer_id || null,
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: customerPhone,
    assigned_to_user_id: data.assignedToUserId || data.assigned_to_user_id || null,
    assigned_to_name: assignedToName,
    assigned_team: data.assignedTeam || data.assigned_team || null,
    created_by_user_id: actor.uuid || actor.id || null,
    created_by_name: actorName,
    last_edited_by_name: actorName,
    resolved_by_name: null,
    sla_hours: slaHours,
    due_date: dueDate,
    resolved_at: null,
    resolution_notes: null,
    escalation_level: 0,
    escalated_to: null,
    escalation_reason: null,
    attachments: data.attachments || [],
    metadata: data.metadata || {},
    raw: { ...data, id, ticket_number: ticketNumber },
    created_at: now,
    updated_at: now,
  };

  const sql = `
    INSERT INTO tickets (
      id, ticket_number, subject, description, status, priority, category, project,
      customer_id, customer_name, customer_email, customer_phone,
      assigned_to_user_id, assigned_to_name, assigned_team,
      created_by_user_id, created_by_name, last_edited_by_name,
      sla_hours, due_date, attachments, metadata, raw, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15,
      $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25
    )
    RETURNING *
  `;
  const d1Sql = `
    INSERT INTO tickets (
      id, ticket_number, subject, description, status, priority, category, project,
      customer_id, customer_name, customer_email, customer_phone,
      assigned_to_user_id, assigned_to_name, assigned_team,
      created_by_user_id, created_by_name, last_edited_by_name,
      sla_hours, due_date, attachments, metadata, raw, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12,
      $13, $14, $15,
      $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25
    )
  `;

  await pool.query(
    sql,
    [
      record.id,
      record.ticket_number,
      record.subject,
      record.description,
      record.status,
      record.priority,
      record.category,
      record.project,
      record.customer_id,
      record.customer_name,
      record.customer_email,
      record.customer_phone,
      record.assigned_to_user_id,
      record.assigned_to_name,
      record.assigned_team,
      record.created_by_user_id,
      record.created_by_name,
      record.last_edited_by_name,
      record.sla_hours,
      record.due_date,
      JSON.stringify(record.attachments),
      JSON.stringify(record.metadata),
      JSON.stringify(record.raw),
      record.created_at,
      record.updated_at,
    ],
    { d1: true, d1Text: d1Sql }
  );

  // Log activity
  const actId = `tact_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const actSql = `
    INSERT INTO ticket_activities (id, ticket_id, action_type, actor_id, actor_name, comment, created_at)
    VALUES ($1, $2, 'CREATED', $3, $4, $5, $6)
  `;
  await pool.query(actSql, [actId, id, actor.uuid || null, actorName, 'Ticket opened in Action Center.', now], {
    d1: true,
    d1Text: actSql,
  });

  return record;
}

/**
 * Update an existing ticket (status, priority, assignment, notes).
 */
async function updateTicket(id, updates = {}, actor = {}) {
  const existing = await getTicketById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const status = updates.status || existing.status;
  const priority = updates.priority || existing.priority;
  const category = updates.category !== undefined ? updates.category : existing.category;
  const project = updates.project !== undefined ? updates.project : existing.project;
  const subject = updates.subject !== undefined ? updates.subject : existing.subject;
  const description = updates.description !== undefined ? updates.description : existing.description;
  const assignedToName = updates.assignedToName || updates.assigned_to_name || existing.assigned_to_name;
  const assignedToUserId = updates.assignedToUserId || updates.assigned_to_user_id || existing.assigned_to_user_id;
  const assignedTeam = updates.assignedTeam || updates.assigned_team || existing.assigned_team;
  const resolutionNotes = updates.resolutionNotes !== undefined ? updates.resolutionNotes : existing.resolution_notes;
  const dueDate = updates.dueDate || updates.due_date || existing.due_date;

  const resolvedAt = status === 'Completed' ? (existing.resolved_at || now) : null;
  const resolvedByName = status === 'Completed' ? (existing.resolved_by_name || actor.name || actor.email || null) : null;
  requireStorage('ticket update');

  const sql = `
    UPDATE tickets
    SET
      subject = $1,
      description = $2,
      status = $3,
      priority = $4,
      category = $5,
      project = $6,
      assigned_to_name = $7,
      assigned_to_user_id = $8,
      assigned_team = $9,
      resolution_notes = $10,
      resolved_at = $11,
      resolved_by_name = $12,
      due_date = $13,
      last_edited_by_name = $14,
      updated_at = $15
    WHERE id = $16
    RETURNING *
  `;
  const d1Sql = `
    UPDATE tickets
    SET
      subject = $1,
      description = $2,
      status = $3,
      priority = $4,
      category = $5,
      project = $6,
      assigned_to_name = $7,
      assigned_to_user_id = $8,
      assigned_team = $9,
      resolution_notes = $10,
      resolved_at = $11,
      resolved_by_name = $12,
      due_date = $13,
      last_edited_by_name = $14,
      updated_at = $15
    WHERE id = $16
  `;

  await pool.query(
    sql,
    [
      subject,
      description,
      status,
      priority,
      category,
      project,
      assignedToName,
      assignedToUserId,
      assignedTeam,
      resolutionNotes,
      resolvedAt,
      resolvedByName,
      dueDate,
      actor.name || actor.email || existing.last_edited_by_name,
      now,
      existing.id,
    ],
    { d1: true, d1Text: d1Sql }
  );

  // Log activity if status or assignment or priority changed
  if (status !== existing.status) {
    const actId = `tact_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const actSql = `
      INSERT INTO ticket_activities (id, ticket_id, action_type, actor_id, actor_name, from_value, to_value, comment, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    await pool.query(
      actSql,
      [
        actId,
        existing.id,
        status === 'Completed' ? 'RESOLVED' : 'STATUS_CHANGE',
        actor.uuid || null,
        actor.name || actor.email || null,
        existing.status,
        status,
        updates.comment || `Status updated from ${existing.status} to ${status}.`,
        now,
      ],
      { d1: true, d1Text: actSql }
    );
  }

  return getTicketById(existing.id);
}

/**
 * Escalate ticket to an executive, manager, or specialized department.
 */
async function escalateTicket(id, { escalatedTo, reason } = {}, actor = {}) {
  const existing = await getTicketById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const newLevel = (existing.escalation_level || 0) + 1;
  requireStorage('ticket escalate');

  const sql = `
    UPDATE tickets
    SET
      status = 'Escalated',
      priority = 'Critical',
      escalation_level = $1,
      escalated_to = $2,
      escalation_reason = $3,
      updated_at = $4
    WHERE id = $5
  `;
  await pool.query(sql, [newLevel, escalatedTo, reason, now, existing.id], { d1: true, d1Text: sql });

  const actId = `tact_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const actSql = `
    INSERT INTO ticket_activities (id, ticket_id, action_type, actor_id, actor_name, from_value, to_value, comment, metadata, created_at)
    VALUES ($1, $2, 'ESCALATED', $3, $4, $5, 'Escalated', $6, $7, $8)
  `;
  await pool.query(
    actSql,
    [
      actId,
      existing.id,
      actor.uuid || null,
      actor.name || actor.email || null,
      existing.status,
      `Escalated (Level ${newLevel}) to ${escalatedTo}: ${reason}`,
      JSON.stringify({ escalatedTo, reason, level: newLevel }),
      now,
    ],
    { d1: true, d1Text: actSql }
  );

  return getTicketById(existing.id);
}

/**
 * Add a comment or resolution note to a ticket.
 */
async function addTicketComment(id, { comment, metadata = {} } = {}, actor = {}) {
  const existing = await getTicketById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const actId = `tact_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  requireStorage('ticket comment');

  const sql = `
    INSERT INTO ticket_activities (id, ticket_id, action_type, actor_id, actor_name, comment, metadata, created_at)
    VALUES ($1, $2, 'COMMENT', $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const result = await pool.query(
    sql,
    [actId, existing.id, actor.uuid || null, actor.name || actor.email || null, comment, JSON.stringify(metadata), now],
    { d1: true, d1Text: sql }
  );
  return requireRowSet(result, 'ticket comment', { requireOne: true })[0];
}

/**
 * Delete a ticket by ID.
 */
async function deleteTicket(id) {
  requireStorage('ticket delete');

  const sql = 'DELETE FROM tickets WHERE id = $1';
  await pool.query(sql, [id], { d1: true, d1Text: sql });
  return true;
}

module.exports = {
  getTickets,
  getTicketSummary,
  getTicketById,
  createTicket,
  updateTicket,
  escalateTicket,
  addTicketComment,
  deleteTicket,
  parseJsonSafe,
};


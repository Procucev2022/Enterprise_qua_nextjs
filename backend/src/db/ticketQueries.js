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

// In-memory fallback collection for tests and headless environments without database
const memoryTickets = [];
const memoryActivities = [];

function generateTicketNumber() {
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `TKT-${rand}`;
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
  if (!pool.hasStorage()) {
    let filtered = [...memoryTickets];
    if (status && status !== 'all') {
      filtered = filtered.filter((t) => (t.status || '').toLowerCase() === status.toLowerCase());
    }
    if (priority && priority !== 'all') {
      filtered = filtered.filter((t) => (t.priority || '').toLowerCase() === priority.toLowerCase());
    }
    if (category && category !== 'all') {
      filtered = filtered.filter((t) => (t.category || '').toLowerCase() === category.toLowerCase());
    }
    if (project && project !== 'all') {
      filtered = filtered.filter((t) => (t.project || '').toLowerCase() === project.toLowerCase());
    }
    if (assignedTo && assignedTo !== 'all') {
      const q = assignedTo.toLowerCase();
      filtered = filtered.filter(
        (t) => (t.assigned_to_name || '').toLowerCase().includes(q) || (t.assigned_to_user_id || '').toLowerCase() === q
      );
    }
    if (dateFrom) {
      filtered = filtered.filter((t) => new Date(t.created_at) >= new Date(dateFrom));
    }
    if (dateTo) {
      filtered = filtered.filter((t) => new Date(t.created_at) <= new Date(dateTo));
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (t) =>
          (t.ticket_number || '').toLowerCase().includes(q) ||
          (t.subject || '').toLowerCase().includes(q) ||
          (t.description || '').toLowerCase().includes(q) ||
          (t.customer_name || '').toLowerCase().includes(q) ||
          (t.customer_email || '').toLowerCase().includes(q)
      );
    }
    const total = filtered.length;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const rows = filtered.slice(safeOffset, safeOffset + safeLimit);
    return { rows, total };
  }

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
  const total = countResult && countResult.rows && countResult.rows[0] ? Number(countResult.rows[0].total) : 0;

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
  const rows = (dataResult && dataResult.rows ? dataResult.rows : []).map((row) => ({
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
  if (!pool.hasStorage()) {
    const total = memoryTickets.length;
    const pending = memoryTickets.filter((t) => t.status === 'Pending').length;
    const inProgress = memoryTickets.filter((t) => t.status === 'In Progress').length;
    const escalated = memoryTickets.filter((t) => t.status === 'Escalated').length;
    const completed = memoryTickets.filter((t) => t.status === 'Completed').length;
    const criticalCount = memoryTickets.filter(
      (t) => (t.priority === 'Critical' || t.priority === 'High') && t.status !== 'Completed'
    ).length;
    return { total, pending, inProgress, escalated, completed, criticalCount };
  }

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
  const row = result && result.rows && result.rows[0] ? result.rows[0] : {};
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

  if (!pool.hasStorage()) {
    const t = memoryTickets.find((x) => x.id === id || x.ticket_number === id);
    if (!t) return null;
    const activities = memoryActivities
      .filter((a) => a.ticket_id === t.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { ...t, activities };
  }

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
  ticket.activities = (actResult && actResult.rows ? actResult.rows : []).map((a) => ({
    ...a,
    metadata: parseJsonSafe(a.metadata, {}),
  }));

  return ticket;
}

/**
 * Create a new ticket.
 */
async function createTicket(data = {}, actor = {}) {
  const id = `tkt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const ticketNumber = data.ticket_number || data.ticketNumber || generateTicketNumber();
  const now = new Date().toISOString();

  const slaHours = Number(data.slaHours || data.sla_hours) || 24;
  let dueDate = data.dueDate || data.due_date;
  if (!dueDate) {
    const d = new Date(Date.now() + slaHours * 3600 * 1000);
    dueDate = d.toISOString();
  }

  const record = {
    id,
    ticket_number: ticketNumber,
    subject: data.subject || 'Support Ticket',
    description: data.description || '',
    status: data.status || 'Pending',
    priority: data.priority || 'Medium',
    category: data.category || 'General',
    project: data.project || 'Procurement Platform',
    customer_id: data.customerId || data.customer_id || null,
    customer_name: data.customerName || data.customer_name || 'Enterprise Buyer',
    customer_email: data.customerEmail || data.customer_email || 'client@procucev.com',
    customer_phone: data.customerPhone || data.customer_phone || '+919876543210',
    assigned_to_user_id: data.assignedToUserId || data.assigned_to_user_id || null,
    assigned_to_name: data.assignedToName || data.assigned_to_name || 'Category Ops Team',
    assigned_team: data.assignedTeam || data.assigned_team || 'Operations',
    created_by_user_id: actor.uuid || actor.id || null,
    created_by_name: actor.name || actor.email || 'System User',
    last_edited_by_name: actor.name || actor.email || 'System User',
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

  if (!pool.hasStorage()) {
    memoryTickets.unshift(record);
    const actId = `tact_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    memoryActivities.unshift({
      id: actId,
      ticket_id: id,
      action_type: 'CREATED',
      actor_id: actor.uuid || null,
      actor_name: actor.name || actor.email || 'System User',
      from_value: null,
      to_value: record.status,
      comment: 'Ticket opened in Action Center.',
      metadata: {},
      created_at: now,
    });
    return record;
  }

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
  await pool.query(actSql, [actId, id, actor.uuid || null, actor.name || actor.email || 'System User', 'Ticket opened in Action Center.', now], {
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
  const resolvedByName = status === 'Completed' ? (existing.resolved_by_name || actor.name || actor.email || 'Executive') : null;

  if (!pool.hasStorage()) {
    const idx = memoryTickets.findIndex((t) => t.id === existing.id);
    if (idx !== -1) {
      memoryTickets[idx] = {
        ...memoryTickets[idx],
        status,
        priority,
        category,
        project,
        subject,
        description,
        assigned_to_name: assignedToName,
        assigned_to_user_id: assignedToUserId,
        assigned_team: assignedTeam,
        resolution_notes: resolutionNotes,
        resolved_at: resolvedAt,
        resolved_by_name: resolvedByName,
        due_date: dueDate,
        last_edited_by_name: actor.name || actor.email || existing.last_edited_by_name,
        updated_at: now,
      };
    }
    if (status !== existing.status) {
      memoryActivities.unshift({
        id: `tact_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        ticket_id: existing.id,
        action_type: status === 'Completed' ? 'RESOLVED' : 'STATUS_CHANGE',
        actor_id: actor.uuid || null,
        actor_name: actor.name || actor.email || 'Executive',
        from_value: existing.status,
        to_value: status,
        comment: updates.comment || `Status updated from ${existing.status} to ${status}.`,
        metadata: {},
        created_at: now,
      });
    }
    return memoryTickets[idx];
  }

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
        actor.name || actor.email || 'Executive',
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

  if (!pool.hasStorage()) {
    const idx = memoryTickets.findIndex((t) => t.id === existing.id);
    if (idx !== -1) {
      memoryTickets[idx] = {
        ...memoryTickets[idx],
        status: 'Escalated',
        escalation_level: newLevel,
        escalated_to: escalatedTo,
        escalation_reason: reason,
        priority: 'Critical',
        updated_at: now,
      };
    }
    memoryActivities.unshift({
      id: `tact_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      ticket_id: existing.id,
      action_type: 'ESCALATED',
      actor_id: actor.uuid || null,
      actor_name: actor.name || actor.email || 'Executive',
      from_value: existing.status,
      to_value: 'Escalated',
      comment: `Escalated (Level ${newLevel}) to ${escalatedTo}: ${reason}`,
      metadata: { escalatedTo, reason, level: newLevel },
      created_at: now,
    });
    return memoryTickets[idx];
  }

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
      actor.name || actor.email || 'Executive',
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

  if (!pool.hasStorage()) {
    const act = {
      id: actId,
      ticket_id: existing.id,
      action_type: 'COMMENT',
      actor_id: actor.uuid || null,
      actor_name: actor.name || actor.email || 'Executive',
      comment,
      metadata,
      created_at: now,
    };
    memoryActivities.unshift(act);
    return act;
  }

  const sql = `
    INSERT INTO ticket_activities (id, ticket_id, action_type, actor_id, actor_name, comment, metadata, created_at)
    VALUES ($1, $2, 'COMMENT', $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const result = await pool.query(
    sql,
    [actId, existing.id, actor.uuid || null, actor.name || actor.email || 'Executive', comment, JSON.stringify(metadata), now],
    { d1: true, d1Text: sql }
  );
  return result && result.rows ? result.rows[0] : null;
}

/**
 * Delete a ticket by ID.
 */
async function deleteTicket(id) {
  if (!pool.hasStorage()) {
    const idx = memoryTickets.findIndex((t) => t.id === id || t.ticket_number === id);
    if (idx !== -1) {
      memoryTickets.splice(idx, 1);
      return true;
    }
    return false;
  }

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
  memoryTickets,
  memoryActivities,
};


// ==============================================================================
// INTERNAL TASK QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Relational queries for dynamic, reusable task management in the Action Center.
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

/**
 * Fetch all dynamic task types.
 */
async function getTaskTypes() {
  if (!pool.hasStorage()) return [];
  const sql = 'SELECT * FROM internal_task_types WHERE is_active = 1 OR is_active = true ORDER BY name ASC';
  const result = await pool.query(sql, [], {
    d1: true,
    d1Text: 'SELECT * FROM internal_task_types WHERE is_active = 1 ORDER BY name ASC',
    useCache: false,
  });
  return result && result.rows ? result.rows : [];
}

/**
 * Register a new dynamic task type.
 */
async function createTaskType({ name, code, defaultModule = 'GENERAL', description = '' }) {
  const id = `itt_${(code || name).toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 40)}_${Date.now().toString(36)}`;
  const cleanCode = (code || name).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!pool.hasStorage()) {
    return { id, name, code: cleanCode, default_module: defaultModule, description };
  }
  const sql = `
    INSERT INTO internal_task_types (id, name, code, default_module, description)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const d1Sql = `
    INSERT INTO internal_task_types (id, name, code, default_module, description)
    VALUES ($1, $2, $3, $4, $5)
  `;
  await pool.query(sql, [id, name, cleanCode, defaultModule, description], {
    d1: true,
    d1Text: d1Sql,
  });
  return { id, name, code: cleanCode, default_module: defaultModule, description };
}

/**
 * Fetch filtered internal tasks with total count.
 */
async function getInternalTasks({
  search = '',
  status = '',
  priority = '',
  taskTypeId = '',
  relatedEntityType = '',
  assignedTo = '',
  dueFrom = '',
  dueTo = '',
  limit = 50,
  offset = 0,
} = {}) {
  if (!pool.hasStorage()) return { rows: [], total: 0 };
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

  if (taskTypeId && taskTypeId !== 'all') {
    conditions.push(`task_type_id = $${paramIdx++}`);
    params.push(taskTypeId);
  }

  if (relatedEntityType && relatedEntityType !== 'all') {
    conditions.push(`related_entity_type = $${paramIdx++}`);
    params.push(relatedEntityType);
  }

  if (assignedTo && assignedTo !== 'all') {
    conditions.push(`(assigned_to_user_id = $${paramIdx} OR assigned_to_name ILIKE $${paramIdx + 1})`);
    params.push(assignedTo);
    params.push(`%${assignedTo}%`);
    paramIdx += 2;
  }

  if (dueFrom) {
    conditions.push(`due_date >= $${paramIdx++}`);
    params.push(dueFrom);
  }

  if (dueTo) {
    conditions.push(`due_date <= $${paramIdx++}`);
    params.push(dueTo);
  }

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    conditions.push(
      `(title ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR task_number ILIKE $${paramIdx} OR related_entity_label ILIKE $${paramIdx} OR notes ILIKE $${paramIdx})`
    );
    params.push(q);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const d1WhereClause = whereClause.replace(/ILIKE/g, 'LIKE');

  // Count query
  const countSql = `SELECT count(*) as total FROM internal_tasks ${whereClause}`;
  const d1CountSql = `SELECT count(*) as total FROM internal_tasks ${d1WhereClause}`;
  const countResult = await pool.query(countSql, params, {
    d1: true,
    d1Text: d1CountSql,
  });
  const total = countResult && countResult.rows && countResult.rows[0] ? Number(countResult.rows[0].total) : 0;

  // Data query
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const limitParamIdx = paramIdx;
  const offsetParamIdx = paramIdx + 1;
  const dataParams = [...params, safeLimit, safeOffset];

  const dataSql = `
    SELECT
      t.*,
      tt.name as task_type_name,
      tt.code as task_type_code
    FROM internal_tasks t
    LEFT JOIN internal_task_types tt ON t.task_type_id = tt.id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
  `;
  const d1DataSql = `
    SELECT
      t.*,
      tt.name as task_type_name,
      tt.code as task_type_code
    FROM internal_tasks t
    LEFT JOIN internal_task_types tt ON t.task_type_id = tt.id
    ${d1WhereClause}
    ORDER BY t.created_at DESC
    LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
  `;

  const dataResult = await pool.query(dataSql, dataParams, {
    d1: true,
    d1Text: d1DataSql,
  });

  const rows = (dataResult && dataResult.rows ? dataResult.rows : []).map((row) => ({
    ...row,
    attachments: parseJsonSafe(row.attachments, []),
    raw: parseJsonSafe(row.raw, {}),
  }));

  return { rows, total };
}

/**
 * Summary metrics of internal tasks.
 */
async function getInternalTaskSummary() {
  if (!pool.hasStorage()) {
    return {
      total: 0,
      pending: 0,
      inProgress: 0,
      blocked: 0,
      completed: 0,
      escalated: 0,
      criticalCount: 0,
    };
  }
  const sql = `
    SELECT
      count(*) as total,
      sum(case when status = 'Pending' then 1 else 0 end) as pending,
      sum(case when status = 'In Progress' then 1 else 0 end) as in_progress,
      sum(case when status = 'Blocked' then 1 else 0 end) as blocked,
      sum(case when status = 'Completed' then 1 else 0 end) as completed,
      sum(case when status = 'Escalated' then 1 else 0 end) as escalated,
      sum(case when priority = 'Critical' and status != 'Completed' then 1 else 0 end) as critical_count
    FROM internal_tasks
  `;
  const result = await pool.query(sql, [], { d1: true, d1Text: sql });
  const row = result && result.rows && result.rows[0] ? result.rows[0] : {};
  return {
    total: Number(row.total || 0),
    pending: Number(row.pending || 0),
    inProgress: Number(row.in_progress || 0),
    blocked: Number(row.blocked || 0),
    completed: Number(row.completed || 0),
    escalated: Number(row.escalated || 0),
    criticalCount: Number(row.critical_count || 0),
  };
}

/**
 * Get internal task by ID with its activity timeline.
 */
async function getInternalTaskById(id) {
  if (!pool.hasStorage()) return null;
  const taskSql = `
    SELECT
      t.*,
      tt.name as task_type_name,
      tt.code as task_type_code
    FROM internal_tasks t
    LEFT JOIN internal_task_types tt ON t.task_type_id = tt.id
    WHERE t.id = $1 OR t.task_number = $1
  `;
  const taskRes = await pool.query(taskSql, [id], { d1: true, d1Text: taskSql });
  if (!taskRes || !taskRes.rows || taskRes.rows.length === 0) return null;

  const task = taskRes.rows[0];
  task.attachments = parseJsonSafe(task.attachments, []);
  task.raw = parseJsonSafe(task.raw, {});

  // Fetch activities
  const actSql = 'SELECT * FROM internal_task_activities WHERE task_id = $1 ORDER BY created_at DESC';
  const actRes = await pool.query(actSql, [task.id], { d1: true, d1Text: actSql });
  task.activities = actRes && actRes.rows ? actRes.rows : [];

  return task;
}

/**
 * Create a new internal task.
 */
async function createInternalTask(data, actor = {}) {
  const id = `tsk_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const taskNumber = `TASK-${Date.now().toString().slice(-5)}`;
  const title = (data.title || '').trim();
  const description = (data.description || '').trim();
  const taskTypeId = data.taskTypeId || null;
  const priority = data.priority || 'Medium';
  const status = data.status || 'Pending';
  const assignedToUserId = data.assignedToUserId || null;
  const assignedToName = data.assignedToName || '';
  const assignedTeam = data.assignedTeam || '';
  const createdByUserId = actor.uuid || actor.id || null;
  const createdByName = actor.fullName || actor.name || actor.email || 'Admin';
  const dueDate = data.dueDate || null;
  const relatedEntityType = (data.relatedEntityType || 'GENERAL').toUpperCase();
  const relatedEntityId = data.relatedEntityId || null;
  const relatedEntityLabel = data.relatedEntityLabel || '';
  const notes = data.notes || '';
  const attachments = JSON.stringify(data.attachments || []);
  const raw = JSON.stringify(data);

  if (!pool.hasStorage()) {
    return {
      id,
      task_number: taskNumber,
      title,
      description,
      task_type_id: taskTypeId,
      priority,
      status,
      assigned_to_user_id: assignedToUserId,
      assigned_to_name: assignedToName,
      assigned_team: assignedTeam,
      created_by_user_id: createdByUserId,
      created_by_name: createdByName,
      due_date: dueDate,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
      related_entity_label: relatedEntityLabel,
      notes,
      attachments: data.attachments || [],
      raw: data,
    };
  }

  const insertSql = `
    INSERT INTO internal_tasks (
      id, task_number, title, description, task_type_id,
      priority, status, assigned_to_user_id, assigned_to_name,
      assigned_team, created_by_user_id, created_by_name,
      due_date, related_entity_type, related_entity_id,
      related_entity_label, notes, attachments, raw
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15,
      $16, $17, $18, $19
    )
  `;

  await pool.query(
    insertSql,
    [
      id,
      taskNumber,
      title,
      description,
      taskTypeId,
      priority,
      status,
      assignedToUserId,
      assignedToName,
      assignedTeam,
      createdByUserId,
      createdByName,
      dueDate,
      relatedEntityType,
      relatedEntityId,
      relatedEntityLabel,
      notes,
      attachments,
      raw,
    ],
    { d1: true, d1Text: insertSql }
  );

  // Log activity
  const actId = `act_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
  const actSql = `
    INSERT INTO internal_task_activities (
      id, task_id, action_type, actor_id, actor_name, comment
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `;
  await pool.query(actSql, [actId, id, 'CREATED', createdByUserId, createdByName, 'Task created.'], {
    d1: true,
    d1Text: actSql,
  });

  return getInternalTaskById(id);
}

/**
 * Update an existing internal task.
 */
async function updateInternalTask(id, updates, actor = {}) {
  if (!pool.hasStorage()) return null;
  const existing = await getInternalTaskById(id);
  if (!existing) return null;

  const title = updates.title !== undefined ? updates.title : existing.title;
  const description = updates.description !== undefined ? updates.description : existing.description;
  const taskTypeId = updates.taskTypeId !== undefined ? updates.taskTypeId : existing.task_type_id;
  const priority = updates.priority !== undefined ? updates.priority : existing.priority;
  const status = updates.status !== undefined ? updates.status : existing.status;
  const assignedToUserId = updates.assignedToUserId !== undefined ? updates.assignedToUserId : existing.assigned_to_user_id;
  const assignedToName = updates.assignedToName !== undefined ? updates.assignedToName : existing.assigned_to_name;
  const dueDate = updates.dueDate !== undefined ? updates.dueDate : existing.due_date;
  const notes = updates.notes !== undefined ? updates.notes : existing.notes;
  const relatedEntityType = updates.relatedEntityType !== undefined ? updates.relatedEntityType : existing.related_entity_type;
  const relatedEntityId = updates.relatedEntityId !== undefined ? updates.relatedEntityId : existing.related_entity_id;
  const relatedEntityLabel = updates.relatedEntityLabel !== undefined ? updates.relatedEntityLabel : existing.related_entity_label;
  const completedAt = status === 'Completed' && existing.status !== 'Completed' ? new Date().toISOString() : existing.completed_at;

  const updateSql = `
    UPDATE internal_tasks SET
      title = $1,
      description = $2,
      task_type_id = $3,
      priority = $4,
      status = $5,
      assigned_to_user_id = $6,
      assigned_to_name = $7,
      due_date = $8,
      notes = $9,
      related_entity_type = $10,
      related_entity_id = $11,
      related_entity_label = $12,
      completed_at = $13,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $14
  `;

  await pool.query(
    updateSql,
    [
      title,
      description,
      taskTypeId,
      priority,
      status,
      assignedToUserId,
      assignedToName,
      dueDate,
      notes,
      relatedEntityType,
      relatedEntityId,
      relatedEntityLabel,
      completedAt,
      existing.id,
    ],
    { d1: true, d1Text: updateSql }
  );

  // Log activity if status or priority changed
  const actorId = actor.uuid || actor.id || null;
  const actorName = actor.fullName || actor.name || actor.email || 'Admin';

  if (status !== existing.status) {
    const actId = `act_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
    const actSql = `
      INSERT INTO internal_task_activities (
        id, task_id, action_type, actor_id, actor_name, from_value, to_value, comment
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
    await pool.query(
      actSql,
      [
        actId,
        existing.id,
        status === 'Escalated' ? 'ESCALATED' : 'STATUS_CHANGE',
        actorId,
        actorName,
        existing.status,
        status,
        updates.activityComment || `Status changed from ${existing.status} to ${status}.`,
      ],
      { d1: true, d1Text: actSql }
    );
  }

  return getInternalTaskById(existing.id);
}

/**
 * Delete task by ID.
 */
async function deleteInternalTask(id) {
  if (!pool.hasStorage()) return true;
  const sql = 'DELETE FROM internal_tasks WHERE id = $1';
  await pool.query(sql, [id], { d1: true, d1Text: sql });
  return true;
}

/**
 * Search real related entities by entity type.
 */
async function searchRelatedEntities(entityType, query = '') {
  if (!pool.hasStorage()) return [];
  const type = (entityType || '').toUpperCase();
  const q = `%${(query || '').trim()}%`;

  if (type === 'RFQ') {
    const sql = `
      SELECT id, rfq_number, category, raw
      FROM rfqs
      WHERE rfq_number LIKE $1 OR category LIKE $1
      ORDER BY created_at DESC
      LIMIT 25
    `;
    const res = await pool.query(sql, [q], { d1: true, d1Text: sql });
    return (res.rows || []).map((r) => {
      const raw = parseJsonSafe(r.raw, {});
      return {
        id: r.id,
        label: `${r.rfq_number || r.id} — ${r.category || raw.title || 'RFQ'}`,
        secondary: raw.buyerOrganization || raw.buyerEmail || '',
        entityType: 'RFQ',
      };
    });
  }

  if (type === 'BUYER') {
    const sql = `
      SELECT uuid, organization_name, email, city, state
      FROM organization
      WHERE organization_name LIKE $1 OR email LIKE $1
      ORDER BY created_ts DESC
      LIMIT 25
    `;
    const res = await pool.query(sql, [q], { d1: true, d1Text: sql });
    return (res.rows || []).map((r) => ({
      id: r.uuid,
      label: r.organization_name || 'Buyer Org',
      secondary: [r.email, r.city, r.state].filter(Boolean).join(', '),
      entityType: 'BUYER',
    }));
  }

  if (type === 'VENDOR') {
    const sql = `
      SELECT id, email, major_category, raw
      FROM vendors
      WHERE email LIKE $1 OR major_category LIKE $1
      ORDER BY created_at DESC
      LIMIT 25
    `;
    const res = await pool.query(sql, [q], { d1: true, d1Text: sql });
    return (res.rows || []).map((r) => {
      const raw = parseJsonSafe(r.raw, {});
      return {
        id: r.id,
        label: raw.name || raw.companyName || r.email || r.id,
        secondary: [r.email, r.major_category].filter(Boolean).join(' • '),
        entityType: 'VENDOR',
      };
    });
  }

  if (type === 'CATEGORY') {
    const sql = `
      SELECT uuid, division, category
      FROM category_division
      WHERE division LIKE $1 OR category LIKE $1
      LIMIT 25
    `;
    const res = await pool.query(sql, [q], { d1: true, d1Text: sql });
    return (res.rows || []).map((r) => ({
      id: r.uuid,
      label: `${r.division} > ${r.category}`,
      secondary: 'Procurement Category',
      entityType: 'CATEGORY',
    }));
  }

  if (type === 'USER') {
    const sql = `
      SELECT uuid, full_name, username, email
      FROM "user"
      WHERE full_name LIKE $1 OR username LIKE $1 OR email LIKE $1
      LIMIT 25
    `;
    const res = await pool.query(sql, [q], { d1: true, d1Text: sql });
    return (res.rows || []).map((r) => ({
      id: r.uuid,
      label: r.full_name || r.username || 'User',
      secondary: r.username || r.email || '',
      entityType: 'USER',
    }));
  }

  if (type === 'CREDIT' || type === 'PAYMENT') {
    const sql = `
      SELECT id, vendor_id, amount, transaction_type, created_at
      FROM vendor_credit_transactions
      ORDER BY created_at DESC
      LIMIT 20
    `;
    const res = await pool.query(sql, [], { d1: true, d1Text: sql });
    return (res.rows || []).map((r) => ({
      id: r.id,
      label: `Transaction ${r.id} (${r.amount} Credits - ${r.transaction_type})`,
      secondary: `Vendor ID: ${r.vendor_id}`,
      entityType: type,
    }));
  }

  return [];
}

module.exports = {
  getTaskTypes,
  createTaskType,
  getInternalTasks,
  getInternalTaskSummary,
  getInternalTaskById,
  createInternalTask,
  updateInternalTask,
  deleteInternalTask,
  searchRelatedEntities,
};

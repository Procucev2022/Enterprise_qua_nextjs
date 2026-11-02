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
 * Escapes SQL LIKE / ILIKE special pattern characters (%, _, \) to prevent
 * wildcard injection and unconstrained table scans.
 */
function escapeLikeWildcards(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/([%_\\])/g, '\\$1');
}

const DEFAULT_TASK_TYPES = [
  // Communication Tasks
  {
    id: 'itt_comm_phone',
    name: 'Phone Call',
    code: 'comm_phone',
    default_module: 'COMMUNICATION',
    description: 'Direct phone call log, discussion notes, and follow-up',
    is_active: 1,
  },
  {
    id: 'itt_comm_sms',
    name: 'SMS',
    code: 'comm_sms',
    default_module: 'COMMUNICATION',
    description: 'Dispatch SMS notifications or transactional alerts',
    is_active: 1,
  },
  {
    id: 'itt_comm_whatsapp',
    name: 'WhatsApp',
    code: 'comm_whatsapp',
    default_module: 'COMMUNICATION',
    description: 'Send direct WhatsApp message or template communication',
    is_active: 1,
  },
  {
    id: 'itt_comm_email',
    name: 'Email',
    code: 'comm_email',
    default_module: 'COMMUNICATION',
    description: 'Official corporate email and message dispatch',
    is_active: 1,
  },
  {
    id: 'itt_comm_followup_new',
    name: 'New Follow-up',
    code: 'comm_followup_new',
    default_module: 'COMMUNICATION',
    description: 'First-time follow-up activity with buyer or supplier',
    is_active: 1,
  },
  {
    id: 'itt_comm_followup_existing',
    name: 'Existing Follow-up',
    code: 'comm_followup_existing',
    default_module: 'COMMUNICATION',
    description: 'Recurring or secondary follow-up discussion',
    is_active: 1,
  },
  // Demo Scheduling
  {
    id: 'itt_demo_scheduling',
    name: 'Schedule Demo',
    code: 'demo_scheduling',
    default_module: 'DEMO_SCHEDULING',
    description: 'Schedule product demonstration with client and assign executive',
    is_active: 1,
  },
  // Credit Management
  {
    id: 'itt_credit_add',
    name: 'Add Credits',
    code: 'credit_add',
    default_module: 'CREDIT_MANAGEMENT',
    description: 'Request allocation of procurement credits to buyer or seller',
    is_active: 1,
  },
  {
    id: 'itt_credit_deduct',
    name: 'Delete Credits',
    code: 'credit_deduct',
    default_module: 'CREDIT_MANAGEMENT',
    description: 'Request deduction or removal of credits with audit justification',
    is_active: 1,
  },
  // Business Development Tasks
  {
    id: 'itt_bd_proposal',
    name: 'Send Proposal',
    code: 'bd_proposal',
    default_module: 'BUSINESS_DEVELOPMENT',
    description: 'Prepare, dispatch, and track business commercial proposal',
    is_active: 1,
  },
  {
    id: 'itt_bd_corporate_email',
    name: 'Send Corporate Email',
    code: 'bd_corporate_email',
    default_module: 'BUSINESS_DEVELOPMENT',
    description: 'Dispatch high-priority corporate email and track response',
    is_active: 1,
  },
  // Internal Operations
  {
    id: 'itt_internal_ops',
    name: 'Operational Task',
    code: 'internal_ops',
    default_module: 'INTERNAL_OPERATIONS',
    description: 'General internal operations and custom workflow assignment',
    is_active: 1,
  },
  // Onboarding Process
  {
    id: 'itt_client_onboarding',
    name: 'Client Onboarding',
    code: 'client_onboarding',
    default_module: 'ONBOARDING',
    description: 'Track client onboarding milestones and document collection',
    is_active: 1,
  },
  // Legacy module compatibility
  {
    id: 'itt_quotation_review',
    name: 'Quotation Review',
    code: 'quotation_review',
    default_module: 'RFQ',
    description: 'Review and approve technical quotes and commercial bids',
    is_active: 1,
  },
  {
    id: 'itt_buyer_onboarding',
    name: 'Buyer Onboarding',
    code: 'buyer_onboarding',
    default_module: 'BUYER',
    description: 'Assist buyer organizations with onboarding and profile verification',
    is_active: 1,
  },
  {
    id: 'itt_vendor_followup',
    name: 'Vendor Follow-up',
    code: 'vendor_followup',
    default_module: 'VENDOR',
    description: 'Follow-up with sellers on active tenders, pricing, or compliance',
    is_active: 1,
  },
  {
    id: 'itt_credit_approval',
    name: 'Credit Approval',
    code: 'credit_approval',
    default_module: 'CREDIT',
    description: 'Review and grant credits for RFQ generation or download allowance',
    is_active: 1,
  },
];

/**
 * Fetch all dynamic task types.
 */
async function getTaskTypes() {
  if (!pool.hasStorage()) return DEFAULT_TASK_TYPES;
  try {
    const sql = 'SELECT * FROM internal_task_types WHERE is_active = 1 OR is_active = true ORDER BY name ASC';
    const result = await pool.query(sql, [], {
      d1: true,
      d1Text: 'SELECT * FROM internal_task_types WHERE is_active = 1 ORDER BY name ASC',
      useCache: true,
    });
    if (result && Array.isArray(result.rows) && result.rows.length > 0) {
      return result.rows;
    }
    return DEFAULT_TASK_TYPES;
  } catch {
    return DEFAULT_TASK_TYPES;
  }
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
 * Hydrates task row with JSON and default fields.
 */
function hydrateTaskRow(row) {
  if (!row) return null;
  const raw = parseJsonSafe(row.raw, {});
  return {
    ...row,
    task_category: row.task_category || raw.taskCategory || raw.task_category || 'INTERNAL_OPERATIONS',
    task_type: row.task_type || raw.taskType || raw.task_type || row.task_type_name || 'General',
    due_time: row.due_time || raw.dueTime || '',
    completed_by_user_id: row.completed_by_user_id || raw.completedByUserId || '',
    completed_by_name: row.completed_by_name || raw.completedByName || '',
    completion_remarks: row.completion_remarks || raw.completionRemarks || '',
    approval_status: row.approval_status !== undefined ? row.approval_status : (raw.approvalStatus || null),
    approver_id: row.approver_id || raw.approverId || '',
    approver_name: row.approver_name || raw.approverName || '',
    approved_at: row.approved_at || raw.approvedAt || null,
    approval_remarks: row.approval_remarks || raw.approvalRemarks || '',
    demo_date: row.demo_date || raw.demoDate || null,
    demo_time: row.demo_time || raw.demoTime || null,
    demo_status: row.demo_status || raw.demoStatus || null,
    credit_account_type: row.credit_account_type || raw.creditAccountType || null,
    credit_account_id: row.credit_account_id || raw.creditAccountId || null,
    credit_account_name: row.credit_account_name || raw.creditAccountName || null,
    credit_quantity: row.credit_quantity !== undefined && row.credit_quantity !== null
      ? Number(row.credit_quantity)
      : (raw.creditQuantity !== undefined ? Number(raw.creditQuantity) : 0),
    credit_reason: row.credit_reason || raw.creditReason || '',
    attachments: parseJsonSafe(row.attachments, []),
    current_account_credits: row.current_account_credits ?? raw.current_account_credits ?? null,
    onboarding_stage: raw.onboarding_stage ?? null,
    proposal_value: raw.proposal_value ?? null,
    proposal_url: raw.proposal_url ?? null,
    proposal_status: raw.proposal_status ?? null,
    call_outcome: raw.call_outcome ?? null,
    recipient_phone: raw.recipient_phone ?? '',
    recipient_email: raw.recipient_email ?? '',
    raw,
  };
}

/**
 * Fetch filtered internal tasks with total count.
 */
async function getInternalTasks({
  search = '',
  status = '',
  priority = '',
  taskCategory = '',
  taskType = '',
  taskTypeId = '',
  relatedEntityType = '',
  assignedTo = '',
  createdBy = '',
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

  if (taskCategory && taskCategory !== 'all') {
    conditions.push(`(task_category = $${paramIdx} OR raw->>'taskCategory' = $${paramIdx} OR raw->>'task_category' = $${paramIdx})`);
    params.push(taskCategory);
    paramIdx++;
  }

  if (taskType && taskType !== 'all') {
    conditions.push(`(task_type = $${paramIdx} OR raw->>'taskType' = $${paramIdx} OR raw->>'task_type' = $${paramIdx})`);
    params.push(taskType);
    paramIdx++;
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
    conditions.push(`(assigned_to_user_id = $${paramIdx} OR lower(assigned_to_name) LIKE $${paramIdx + 1})`);
    params.push(assignedTo);
    params.push(`%${escapeLikeWildcards(assignedTo.toLowerCase())}%`);
    paramIdx += 2;
  }

  if (createdBy && createdBy !== 'all') {
    conditions.push(`(created_by_user_id = $${paramIdx} OR lower(created_by_name) LIKE $${paramIdx + 1})`);
    params.push(createdBy);
    params.push(`%${escapeLikeWildcards(createdBy.toLowerCase())}%`);
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
    const q = `%${escapeLikeWildcards(search.trim().toLowerCase())}%`;
    conditions.push(
      `(lower(title) LIKE $${paramIdx} OR lower(description) LIKE $${paramIdx} OR lower(task_number) LIKE $${paramIdx} OR lower(related_entity_label) LIKE $${paramIdx} OR lower(notes) LIKE $${paramIdx} OR lower(credit_account_name) LIKE $${paramIdx})`
    );
    params.push(q);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count query
  const countSql = `SELECT count(*) as total FROM internal_tasks ${whereClause}`;
  const countResult = await pool.query(countSql, params, {
    d1: true,
    d1Text: countSql,
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
  const dataResult = await pool.query(dataSql, dataParams, {
    d1: true,
    d1Text: dataSql,
  });

  const rows = (dataResult && dataResult.rows ? dataResult.rows : []).map(hydrateTaskRow);
  return { rows, total };
}

/**
 * Summary metrics of internal tasks.
 */
async function getInternalTaskSummary({ assignedTo = '', taskCategory = '' } = {}) {
  if (!pool.hasStorage()) {
    return {
      total: 0,
      newTasks: 0,
      assigned: 0,
      inProgress: 0,
      pendingApproval: 0,
      completed: 0,
      rejected: 0,
      cancelled: 0,
      overdueCount: 0,
      criticalCount: 0,
      pending: 0,
      blocked: 0,
      escalated: 0,
    };
  }
  const conditions = [];
  const params = [];
  let pIdx = 1;

  if (assignedTo && assignedTo !== 'all') {
    conditions.push(`(assigned_to_user_id = $${pIdx} OR lower(assigned_to_name) LIKE $${pIdx + 1})`);
    params.push(assignedTo);
    params.push(`%${escapeLikeWildcards(assignedTo.toLowerCase())}%`);
    pIdx += 2;
  }

  if (taskCategory && taskCategory !== 'all') {
    conditions.push(`(task_category = $${pIdx} OR raw->>'taskCategory' = $${pIdx} OR raw->>'task_category' = $${pIdx})`);
    params.push(taskCategory);
    pIdx++;
  }

  const today = new Date().toISOString().split('T')[0];
  const overdueParamIdx = pIdx++;
  params.push(today);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      count(*) as total,
      sum(case when status = 'New' then 1 else 0 end) as new_tasks,
      sum(case when status = 'Assigned' then 1 else 0 end) as assigned_tasks,
      sum(case when status = 'In Progress' then 1 else 0 end) as in_progress,
      sum(case when status = 'Pending Approval' then 1 else 0 end) as pending_approval,
      sum(case when status = 'Completed' then 1 else 0 end) as completed,
      sum(case when status = 'Rejected' then 1 else 0 end) as rejected,
      sum(case when status = 'Cancelled' then 1 else 0 end) as cancelled,
      sum(case when status = 'Pending' then 1 else 0 end) as pending,
      sum(case when status = 'Blocked' then 1 else 0 end) as blocked,
      sum(case when status = 'Escalated' then 1 else 0 end) as escalated,
      sum(case when priority = 'Critical' and status NOT IN ('Completed', 'Rejected', 'Cancelled') then 1 else 0 end) as critical_count,
      sum(case when due_date < $${overdueParamIdx} and status NOT IN ('Completed', 'Rejected', 'Cancelled') then 1 else 0 end) as overdue_count
    FROM internal_tasks
    ${whereClause}
  `;
  const result = await pool.query(sql, params, { d1: true, d1Text: sql });
  const row = result && result.rows && result.rows[0] ? result.rows[0] : {};

  return {
    total: Number(row.total || 0),
    newTasks: Number(row.new_tasks || 0),
    assigned: Number(row.assigned_tasks || 0),
    inProgress: Number(row.in_progress || 0),
    pendingApproval: Number(row.pending_approval || 0),
    completed: Number(row.completed || 0),
    rejected: Number(row.rejected || 0),
    cancelled: Number(row.cancelled || 0),
    overdueCount: Number(row.overdue_count || 0),
    criticalCount: Number(row.critical_count || 0),
    // Backward compatibility metrics
    pending: Number(row.pending !== undefined ? row.pending : (row.new_tasks || 0)),
    blocked: Number(row.blocked || 0),
    escalated: Number(row.escalated || 0),
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

  const task = hydrateTaskRow(taskRes.rows[0]);

  // Fetch activities
  const actSql = 'SELECT * FROM internal_task_activities WHERE task_id = $1 ORDER BY created_at DESC';
  const actRes = await pool.query(actSql, [task.id], { d1: true, d1Text: actSql });
  task.activities = (actRes && actRes.rows ? actRes.rows : []).map((a) => ({
    ...a,
    metadata: parseJsonSafe(a.metadata, {}),
  }));

  // If credit task, enrich with live credit balance
  if (task.credit_account_id) {
    try {
      const acctType = (task.credit_account_type || '').toLowerCase();
      if (acctType === 'vendor' || acctType === 'seller') {
        const vRes = await pool.query('SELECT credits FROM vendors WHERE id = $1', [task.credit_account_id]);
        if (vRes && vRes.rows && vRes.rows[0]) {
          task.current_account_credits = Number(vRes.rows[0].credits || 0);
        }
      } else {
        const bRes = await pool.query('SELECT available_credits FROM buyer_accounts WHERE id = $1', [task.credit_account_id]);
        if (bRes && bRes.rows && bRes.rows[0]) {
          task.current_account_credits = Number(bRes.rows[0].available_credits || 0);
        }
      }
    } catch {
      // Non-blocking
    }
  }

  return task;
}

/**
 * Create a new internal task.
 */
async function createInternalTask(data = {}, actor = {}) {
  const id = `tsk_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const taskNumber = `TASK-${Date.now().toString().slice(-5)}`;
  const title = (data.title || '').trim();
  const description = (data.description || '').trim();
  const taskCategory = data.taskCategory || data.task_category || 'INTERNAL_OPERATIONS';
  const taskType = data.taskType || data.task_type || 'General';
  const taskTypeId = data.taskTypeId || null;
  const priority = data.priority || 'Medium';

  // For Credit Management tasks or explicit approval requests, default status to Pending Approval
  let status = data.status || 'Pending';
  let approvalStatus = data.approvalStatus || null;
  if (taskCategory === 'CREDIT_MANAGEMENT' || taskType === 'Add Credits' || taskType === 'Delete Credits') {
    status = 'Pending Approval';
    approvalStatus = 'PENDING';
  }

  const assignedToUserId = data.assignedToUserId || null;
  const assignedToName = data.assignedToName || '';
  const assignedTeam = data.assignedTeam || '';
  const createdByUserId = actor.uuid || actor.id || null;
  const createdByName = actor.fullName || actor.name || actor.email || 'Admin';
  const dueDate = data.dueDate || null;
  const dueTime = data.dueTime || data.due_time || null;
  const relatedEntityType = (data.relatedEntityType || 'GENERAL').toUpperCase();
  const relatedEntityId = data.relatedEntityId || null;
  const relatedEntityLabel = data.relatedEntityLabel || '';
  const notes = data.notes || '';
  const demoDate = data.demoDate || data.demo_date || null;
  const demoTime = data.demoTime || data.demo_time || null;
  const demoStatus = data.demoStatus || data.demo_status || (taskCategory === 'DEMO_SCHEDULING' ? 'Scheduled' : null);
  const creditAccountType = data.creditAccountType || data.credit_account_type || null;
  const creditAccountId = data.creditAccountId || data.credit_account_id || null;
  const creditAccountName = data.creditAccountName || data.credit_account_name || null;
  const rawCreditQty = Number(data.creditQuantity ?? data.credit_quantity);
  const creditQuantity = Number.isInteger(rawCreditQty) && rawCreditQty > 0 ? rawCreditQty : 0;
  const creditReason = data.creditReason || data.credit_reason || '';
  const attachments = JSON.stringify(data.attachments || []);
  const rawObj = {
    ...data,
    taskCategory,
    taskType,
    dueTime,
    approvalStatus,
    demoDate,
    demoTime,
    demoStatus,
    creditAccountType,
    creditAccountId,
    creditAccountName,
    creditQuantity,
    creditReason,
  };
  const raw = JSON.stringify(rawObj);

  if (!pool.hasStorage()) {
    return {
      id,
      task_number: taskNumber,
      task_category: taskCategory,
      task_type: taskType,
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
      due_time: dueTime,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
      related_entity_label: relatedEntityLabel,
      notes,
      attachments: data.attachments || [],
      approval_status: approvalStatus,
      demo_date: demoDate,
      demo_time: demoTime,
      demo_status: demoStatus,
      credit_account_type: creditAccountType,
      credit_account_id: creditAccountId,
      credit_account_name: creditAccountName,
      credit_quantity: creditQuantity,
      credit_reason: creditReason,
      raw: rawObj,
    };
  }

  const insertSql = `
    INSERT INTO internal_tasks (
      id, task_number, task_category, task_type, task_type_id,
      title, description, priority, status,
      assigned_to_user_id, assigned_to_name, assigned_team,
      created_by_user_id, created_by_name, due_date, due_time,
      related_entity_type, related_entity_id, related_entity_label,
      notes, attachments, approval_status, demo_date, demo_time, demo_status,
      credit_account_type, credit_account_id, credit_account_name, credit_quantity, credit_reason,
      raw
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15, $16,
      $17, $18, $19,
      $20, $21, $22, $23, $24, $25,
      $26, $27, $28, $29, $30,
      $31
    )
  `;

  await pool.query(
    insertSql,
    [
      id,
      taskNumber,
      taskCategory,
      taskType,
      taskTypeId,
      title,
      description,
      priority,
      status,
      assignedToUserId,
      assignedToName,
      assignedTeam,
      createdByUserId,
      createdByName,
      dueDate,
      dueTime,
      relatedEntityType,
      relatedEntityId,
      relatedEntityLabel,
      notes,
      attachments,
      approvalStatus,
      demoDate,
      demoTime,
      demoStatus,
      creditAccountType,
      creditAccountId,
      creditAccountName,
      creditQuantity,
      creditReason,
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
async function updateInternalTask(id, updates = {}, actor = {}) {
  if (!pool.hasStorage()) return null;
  const existing = await getInternalTaskById(id);
  if (!existing) return null;

  const title = updates.title ?? existing.title;
  const description = updates.description ?? existing.description;
  const taskCategory = updates.taskCategory ?? existing.task_category;
  const taskType = updates.taskType ?? existing.task_type;
  const taskTypeId = updates.taskTypeId ?? existing.task_type_id;
  const priority = updates.priority ?? existing.priority;
  const status = updates.status ?? existing.status;
  const assignedToUserId = updates.assignedToUserId ?? existing.assigned_to_user_id;
  const assignedToName = updates.assignedToName ?? existing.assigned_to_name;
  const dueDate = updates.dueDate ?? existing.due_date;
  const dueTime = updates.dueTime ?? existing.due_time;
  const notes = updates.notes ?? existing.notes;
  const relatedEntityType = updates.relatedEntityType ?? existing.related_entity_type;
  const relatedEntityId = updates.relatedEntityId ?? existing.related_entity_id;
  const relatedEntityLabel = updates.relatedEntityLabel ?? existing.related_entity_label;
  const demoDate = updates.demoDate ?? existing.demo_date;
  const demoTime = updates.demoTime ?? existing.demo_time;
  const demoStatus = updates.demoStatus ?? existing.demo_status;
  let finalAttachments = existing.attachments || [];
  if (updates.attachments !== undefined) {
    finalAttachments = updates.attachments;
  } else if (updates.newAttachment) {
    finalAttachments = [...finalAttachments, updates.newAttachment];
  }
  const attachments = JSON.stringify(finalAttachments);

  const raw = JSON.stringify({
    ...(existing.raw || {}),
    ...updates,
    attachments: finalAttachments,
  });

  const completedAt = status === 'Completed' && existing.status !== 'Completed' ? new Date().toISOString() : existing.completed_at;
  const completedByUserId = status === 'Completed' ? (actor.uuid || actor.id || existing.completed_by_user_id) : existing.completed_by_user_id;
  const completedByName = status === 'Completed' ? (actor.fullName || actor.name || actor.email || existing.completed_by_name) : existing.completed_by_name;
  const completionRemarks = updates.completionRemarks || updates.notes || existing.completion_remarks || '';

  const updateSql = `
    UPDATE internal_tasks SET
      title = $1,
      description = $2,
      task_category = $3,
      task_type = $4,
      task_type_id = $5,
      priority = $6,
      status = $7,
      assigned_to_user_id = $8,
      assigned_to_name = $9,
      due_date = $10,
      due_time = $11,
      notes = $12,
      related_entity_type = $13,
      related_entity_id = $14,
      related_entity_label = $15,
      demo_date = $16,
      demo_time = $17,
      demo_status = $18,
      attachments = $19,
      completed_at = $20,
      completed_by_user_id = $21,
      completed_by_name = $22,
      completion_remarks = $23,
      raw = $24,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $25
  `;

  await pool.query(
    updateSql,
    [
      title,
      description,
      taskCategory,
      taskType,
      taskTypeId,
      priority,
      status,
      assignedToUserId,
      assignedToName,
      dueDate,
      dueTime,
      notes,
      relatedEntityType,
      relatedEntityId,
      relatedEntityLabel,
      demoDate,
      demoTime,
      demoStatus,
      attachments,
      completedAt,
      completedByUserId,
      completedByName,
      completionRemarks,
      raw,
      existing.id,
    ],
    { d1: true, d1Text: updateSql }
  );

  // Log activity if status changed
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

  // Log Demo Status or Reschedule activity
  if (demoStatus && demoStatus !== existing.demo_status) {
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
        'DEMO_STATUS_UPDATED',
        actorId,
        actorName,
        existing.demo_status || 'Scheduled',
        demoStatus,
        updates.rescheduleReason || `Demo status updated to ${demoStatus} (${demoDate || ''} ${demoTime || ''})`,
      ],
      { d1: true, d1Text: actSql }
    );
  }

  // Log Call Outcome activity
  if (updates.callOutcome) {
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
        'CALL_OUTCOME_LOGGED',
        actorId,
        actorName,
        null,
        updates.callOutcome,
        updates.callRemarks || `Phone call logged: ${updates.callOutcome}`,
      ],
      { d1: true, d1Text: actSql }
    );
  }

  // Log Onboarding Stage update
  if (updates.onboardingStage && updates.onboardingStage !== existing.onboarding_stage) {
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
        'ONBOARDING_STAGE_UPDATED',
        actorId,
        actorName,
        String(existing.onboarding_stage || '1'),
        String(updates.onboardingStage),
        updates.stageNote || `Onboarding advanced to Stage ${updates.onboardingStage}`,
      ],
      { d1: true, d1Text: actSql }
    );
  }

  // Log Proposal Status update
  if (updates.proposalStatus && updates.proposalStatus !== existing.proposal_status) {
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
        'PROPOSAL_STATUS_UPDATED',
        actorId,
        actorName,
        existing.proposal_status || 'Draft',
        updates.proposalStatus,
        updates.proposalRemarks || `Proposal status updated to ${updates.proposalStatus}`,
      ],
      { d1: true, d1Text: actSql }
    );
  }

  // Log Attachment Added
  if (updates.newAttachment) {
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
        'ATTACHMENT_ADDED',
        actorId,
        actorName,
        null,
        updates.newAttachment.name || 'Document',
        `Document attached: ${updates.newAttachment.name || 'Document'} (${updates.newAttachment.url || 'Link'})`,
      ],
      { d1: true, d1Text: actSql }
    );
  }

  return getInternalTaskById(existing.id);
}

/**
 * Approve a Credit Add/Delete task and update database balance.
 * Executes database updates as the authoritative source of truth first,
 * synchronizing in-memory service caches only after all DB transactions commit.
 */
async function approveCreditTask(id, actor = {}, remarks = '') {
  if (!pool.hasStorage()) return null;
  const task = await getInternalTaskById(id);
  if (!task) return null;

  const actorId = actor.uuid || actor.id || 'admin';
  const actorName = actor.fullName || actor.name || actor.email || 'Admin Approver';
  const approvalRemarks = remarks ? String(remarks).trim() : 'Credit request approved.';

  const isDeduct =
    (task.task_type || '').toLowerCase().includes('deduct') ||
    (task.task_type || '').toLowerCase().includes('delete') ||
    (task.title || '').toLowerCase().includes('deduct') ||
    (task.title || '').toLowerCase().includes('delete');
  const rawQty = Number(task.credit_quantity);
  const creditQty = Number.isFinite(rawQty) && rawQty > 0 ? Math.floor(rawQty) : 0;
  const accountType = (task.credit_account_type || task.related_entity_type || 'BUYER').toUpperCase();
  const accountId = task.credit_account_id || task.related_entity_id;

  const storeService = require('../services/storeService');
  const domainQueries = require('./domainQueries');

  let updatedBuyerInfo = null;
  let updatedVendorInfo = null;

  // 1. Authoritative Database Transactions with Explicit Row-Level Locking (BEGIN / COMMIT / ROLLBACK)
  await pool.query('BEGIN');
  try {
    // Explicit row locking on internal_tasks to prevent concurrent duplicate approvals
    const lockRes = await pool.query(
      'SELECT id, status, approval_status FROM internal_tasks WHERE id = $1 FOR UPDATE',
      [task.id]
    );
    const lockedRow = lockRes && lockRes.rows && lockRes.rows[0];
    if (lockedRow && (lockedRow.approval_status === 'APPROVED' || lockedRow.status === 'Completed')) {
      await pool.query('ROLLBACK');
      return getInternalTaskById(task.id);
    }

    if (accountType === 'BUYER' || accountType === 'BUYER_ACCOUNT') {
      let prevBal = 0;
      let targetBuyerId = accountId;
      const dbBuyerRes = await pool.query(
        'SELECT id, raw FROM buyer_accounts WHERE id = $1 FOR UPDATE',
        [accountId]
      );
      if (dbBuyerRes && dbBuyerRes.rows && dbBuyerRes.rows[0]) {
        const bRow = dbBuyerRes.rows[0];
        targetBuyerId = bRow.id;
        const bRaw = typeof bRow.raw === 'string' ? JSON.parse(bRow.raw || '{}') : (bRow.raw || {});
        prevBal = Number(bRaw.creditBalance ?? bRow.available_credits ?? 0);
      } else {
        const buyers = (storeService.getBuyerAccounts && storeService.getBuyerAccounts()) || [];
        const buyer = buyers.find(
          (b) => b.id === accountId || b.corporateEmail === accountId || b.organizationName === task.credit_account_name
        );
        if (buyer) {
          targetBuyerId = buyer.id;
          prevBal = Number(buyer.creditBalance) || 0;
        }
      }
      const updatedBal = isDeduct ? Math.max(0, prevBal - creditQty) : prevBal + creditQty;
      const bSql = `UPDATE buyer_accounts SET raw = jsonb_set(raw, '{creditBalance}', to_jsonb($1::numeric)), updated_at = now() WHERE id = $2`;
      await pool.query(bSql, [updatedBal, targetBuyerId], { d1: true, d1Text: bSql });

      if (domainQueries.recordBuyerCreditTransactionInDB) {
        const txId = `ctx-${isDeduct ? 'ded' : 'add'}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
        await domainQueries.recordBuyerCreditTransactionInDB({
          id: txId,
          buyerId: targetBuyerId,
          rfqId: null,
          transactionType: isDeduct ? 'Admin Credit Deduction' : 'Admin Credit Addition',
          creditSource: 'Action Center Internal Tasks Approval',
          creditsAdded: isDeduct ? 0 : creditQty,
          creditsConsumed: isDeduct ? creditQty : 0,
          previousBalance: prevBal,
          updatedBalance: updatedBal,
          status: 'COMPLETED',
          description: `Internal Task ${task.task_number} approved: ${approvalRemarks}`,
          idempotencyKey: `task-approval-${task.id}`,
        });
      }
      updatedBuyerInfo = { buyerId: targetBuyerId, updatedBal };
    } else if (accountType === 'SELLER' || accountType === 'VENDOR') {
      let prevBal = 0;
      let targetVendorId = accountId;
      const dbVendorRes = await pool.query(
        'SELECT id, raw FROM vendors WHERE id = $1 FOR UPDATE',
        [accountId]
      );
      if (dbVendorRes && dbVendorRes.rows && dbVendorRes.rows[0]) {
        const vRow = dbVendorRes.rows[0];
        targetVendorId = vRow.id;
        const vRaw = typeof vRow.raw === 'string' ? JSON.parse(vRow.raw || '{}') : (vRow.raw || {});
        prevBal = Number(vRaw.freeQuotationCredits ?? vRaw.freeRfqDownloadCredits ?? vRow.credits ?? 0);
      } else {
        const vendor = (storeService.getVendorById && storeService.getVendorById(accountId)) || null;
        if (vendor) {
          targetVendorId = vendor.id;
          prevBal = Number(vendor.freeQuotationCredits ?? vendor.freeRfqDownloadCredits ?? 0);
        }
      }
      const updatedBal = isDeduct ? Math.max(0, prevBal - creditQty) : prevBal + creditQty;
      const vSql = `UPDATE vendors SET raw = jsonb_set(raw, '{freeQuotationCredits}', to_jsonb($1::numeric)), updated_at = now() WHERE id = $2`;
      await pool.query(vSql, [updatedBal, targetVendorId], { d1: true, d1Text: vSql });

      if (domainQueries.recordCreditTransactionInDB) {
        const txId = `vtx-${isDeduct ? 'ded' : 'add'}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
        await domainQueries.recordCreditTransactionInDB({
          id: txId,
          vendorId: targetVendorId,
          rfqId: null,
          transactionType: isDeduct ? 'CREDIT_DEDUCTION' : 'CREDIT_GRANT',
          amount: creditQty,
          balanceAfter: updatedBal,
          idempotencyKey: `task-approval-${task.id}`,
        });
      }
      updatedVendorInfo = { vendorId: targetVendorId, updatedBal };
    }

    // Update task status and approval details in database
    const updateSql = `
      UPDATE internal_tasks SET
        status = 'Completed',
        approval_status = 'APPROVED',
        approver_id = $1,
        approver_name = $2,
        approved_at = CURRENT_TIMESTAMP,
        approval_remarks = $3,
        completed_at = CURRENT_TIMESTAMP,
        completed_by_user_id = $1,
        completed_by_name = $2,
        completion_remarks = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `;
    await pool.query(updateSql, [actorId, actorName, approvalRemarks, task.id], { d1: true, d1Text: updateSql });

    // Log approval activity record in database
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
        task.id,
        'APPROVED',
        actorId,
        actorName,
        task.status,
        'Completed',
        `Credit request approved by ${actorName}. Remarks: ${approvalRemarks}`,
      ],
      { d1: true, d1Text: actSql }
    );

    // Commit database transaction - Authoritative persistence complete!
    await pool.query('COMMIT');
  } catch (error) {
    try {
      await pool.query('ROLLBACK');
    } catch {}
    throw error;
  }

  // Synchronize in-memory caches ONLY after database transaction has successfully committed
  if (updatedBuyerInfo && storeService.updateBuyerAccount) {
    storeService.updateBuyerAccount(updatedBuyerInfo.buyerId, { creditBalance: updatedBuyerInfo.updatedBal });
  } else if (updatedVendorInfo && storeService.updateVendor) {
    storeService.updateVendor(updatedVendorInfo.vendorId, {
      freeQuotationCredits: updatedVendorInfo.updatedBal,
      freeRfqDownloadCredits: updatedVendorInfo.updatedBal,
    });
  }

  return getInternalTaskById(task.id);
}

/**
 * Reject a Credit Add/Delete task. Does not modify credit balances.
 */
async function rejectCreditTask(id, actor = {}, remarks = '') {
  if (!pool.hasStorage()) return null;
  const task = await getInternalTaskById(id);
  if (!task) return null;

  const actorId = actor.uuid || actor.id || 'admin';
  const actorName = actor.fullName || actor.name || actor.email || 'Admin Approver';
  const rejectionRemarks = remarks ? String(remarks).trim() : 'Credit request rejected.';

  const updateSql = `
    UPDATE internal_tasks SET
      status = 'Rejected',
      approval_status = 'REJECTED',
      approver_id = $1,
      approver_name = $2,
      approved_at = CURRENT_TIMESTAMP,
      approval_remarks = $3,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
  `;
  await pool.query(updateSql, [actorId, actorName, rejectionRemarks, task.id], { d1: true, d1Text: updateSql });

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
      task.id,
      'REJECTED',
      actorId,
      actorName,
      task.status,
      'Rejected',
      `Credit request rejected by ${actorName}. Remarks: ${rejectionRemarks}`,
    ],
    { d1: true, d1Text: actSql }
  );

  return getInternalTaskById(task.id);
}

/**
 * Add a comment or progress remark to a task's activity log.
 */
async function addTaskActivity(taskId, { comment = '', actionType = 'COMMENT' } = {}, actor = {}) {
  if (!pool.hasStorage()) return null;
  const task = await getInternalTaskById(taskId);
  if (!task) return null;

  const actId = `act_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
  const actorId = actor.uuid || actor.id || null;
  const actorName = actor.fullName || actor.name || actor.email || 'Employee';
  const actSql = `
    INSERT INTO internal_task_activities (
      id, task_id, action_type, actor_id, actor_name, comment
    ) VALUES ($1, $2, $3, $4, $5, $6)
  `;
  await pool.query(
    actSql,
    [actId, task.id, actionType || 'COMMENT', actorId, actorName, comment],
    { d1: true, d1Text: actSql }
  );

  return {
    id: actId,
    task_id: task.id,
    action_type: actionType || 'COMMENT',
    actor_id: actorId,
    actor_name: actorName,
    comment,
    created_at: new Date().toISOString(),
  };
}

/**
 * Fetch overdue and upcoming deadline tasks.
 */
async function getOverdueAndUpcomingTasks() {
  if (!pool.hasStorage()) return [];
  const deadlineCutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sql = `
    SELECT * FROM internal_tasks
    WHERE status NOT IN ('Completed', 'Rejected', 'Cancelled')
      AND due_date IS NOT NULL
      AND due_date <= $1
    ORDER BY due_date ASC
    LIMIT 100
  `;
  const res = await pool.query(sql, [deadlineCutoff], { d1: true, d1Text: sql });
  return (res.rows || []).map(hydrateTaskRow);
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
  const q = `%${escapeLikeWildcards((query || '').trim())}%`;

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

  if (type === 'BUYER' || type === 'CLIENT') {
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

  if (type === 'VENDOR' || type === 'SELLER') {
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

/**
 * Fetch available internal team members and assignees.
 */
async function getInternalAssignees() {
  const { DEFAULT_INTERNAL_MEMBERS } = require('../config/constants');
  const assigneesMap = new Map();
  (DEFAULT_INTERNAL_MEMBERS || []).forEach((m) => {
    assigneesMap.set(m.name.toLowerCase(), { ...m });
  });

  if (pool.hasStorage()) {
    try {
      const taskRes = await pool.query(
        "SELECT DISTINCT assigned_to_user_id, assigned_to_name FROM internal_tasks WHERE assigned_to_name IS NOT NULL AND assigned_to_name != '' AND assigned_to_name != 'Unassigned'",
        [],
        {
          d1: true,
          d1Text: "SELECT DISTINCT assigned_to_user_id, assigned_to_name FROM internal_tasks WHERE assigned_to_name IS NOT NULL AND assigned_to_name != '' AND assigned_to_name != 'Unassigned'",
        }
      );
      if (taskRes && Array.isArray(taskRes.rows)) {
        taskRes.rows.forEach((r) => {
          if (r.assigned_to_name && !assigneesMap.has(r.assigned_to_name.toLowerCase())) {
            assigneesMap.set(r.assigned_to_name.toLowerCase(), {
              id: r.assigned_to_user_id || `user-${Date.now().toString(36)}`,
              name: r.assigned_to_name,
              role: 'Team Member',
              email: '',
            });
          }
        });
      }
    } catch {
      // Return defaults on error
    }
  }

  return Array.from(assigneesMap.values());
}

module.exports = {
  getInternalAssignees,
  DEFAULT_TASK_TYPES,
  getTaskTypes,
  createTaskType,
  getInternalTasks,
  getInternalTaskSummary,
  getInternalTaskById,
  createInternalTask,
  updateInternalTask,
  deleteInternalTask,
  searchRelatedEntities,
  approveCreditTask,
  rejectCreditTask,
  addTaskActivity,
  getOverdueAndUpcomingTasks,
  hydrateTaskRow,
  parseJsonSafe,
};

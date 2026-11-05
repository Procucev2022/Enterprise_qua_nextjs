// ==============================================================================
// APPROVAL QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Aggregated procurement approvals for credit additions, account verifications,
// trial periods, discounts, purchase requests, payment reconciliations,
// unit bookings, cancellations, packages, and milestones.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');

const memoryApprovals = [
  {
    id: 'appr-cred-101',
    request_number: 'REQ-CR-9041',
    module: 'Credit Notes',
    request_type: 'Buyer Credit Addition',
    project: 'Tata Steel Maintenance',
    applicant_name: 'Tata Steel Procurement Team',
    applicant_email: 'buyer@tatasteel.com',
    value_impact: '₹2,50,000 (100 RFQ Credits Allocation)',
    amount: 250000,
    quantity: 100,
    available_balance: 5,
    maker_name: 'Navin Chaudhary',
    maker_role: 'Category Executive',
    assigned_approver: 'Srinu Sir',
    internal_task_id: 'tsk-credit-101',
    status: 'Pending',
    details: 'Free trial expansion for mechanical spares RFQs.',
    history: [
      {
        action: 'SUBMITTED',
        actor_name: 'Govardhan',
        actor_role: 'Category Manager',
        timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        remarks: 'Credit addition initiated for high-volume RFQ requirement.',
      },
    ],
    attachments: [
      { name: 'Commercial_Terms_Justification.pdf', size: 1048576, url: '/documents/commercial-terms.pdf' },
    ],
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
  {
    id: 'appr-acct-102',
    request_number: 'REQ-ACC-8812',
    module: 'Account Approvals',
    request_type: 'Account Approvals',
    project: 'Enterprise Vendor Portal',
    applicant_name: 'Larsen & Toubro Ltd Heavy Eng',
    applicant_email: 'vendor.lt@lnt.com',
    value_impact: 'Tier 1 Preferred Supplier Access',
    amount: 0,
    quantity: 1,
    available_balance: 0,
    maker_name: 'Krishna',
    maker_role: 'Category Manager',
    assigned_approver: 'Sudheer Sir',
    status: 'Pending',
    details: 'Self-registered supplier onboarding verification and GSTIN validation clearance.',
    history: [
      {
        action: 'SUBMITTED',
        actor_name: 'Krishna',
        actor_role: 'Category Manager',
        timestamp: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
        remarks: 'GSTIN verified with MCA portal. KYC documents complete.',
      },
    ],
    attachments: [
      { name: 'GSTIN_Registration_Certificate.pdf', size: 524288, url: '/documents/gstin-cert.pdf' },
    ],
    created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
  },
  {
    id: 'appr-disc-103',
    request_number: 'REQ-DSC-7104',
    module: 'Discounts',
    request_type: 'Discounts',
    project: 'JSW Steel Energy Sourcing',
    applicant_name: 'JSW Energy Plant 4',
    applicant_email: 'sourcing@jsw.in',
    value_impact: '15% Subscription Discount (₹75,000)',
    amount: 75000,
    quantity: 1,
    available_balance: 15,
    maker_name: 'Chandhan',
    maker_role: 'Category Manager',
    assigned_approver: 'Sudheer Sir',
    status: 'Approved',
    details: 'Multi-year enterprise contract commercial incentive discount.',
    approver_name: 'Sudheer Sir',
    approver_remarks: 'Approved per enterprise contract renewal schedule.',
    history: [
      {
        action: 'SUBMITTED',
        actor_name: 'Chandhan',
        actor_role: 'Category Manager',
        timestamp: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        remarks: 'Contract discount for 24-month term commitment.',
      },
      {
        action: 'APPROVED',
        actor_name: 'Sudheer Sir',
        actor_role: 'Senior Director',
        timestamp: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
        remarks: 'Approved per enterprise contract renewal schedule.',
      },
    ],
    attachments: [],
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
  },
  {
    id: 'appr-trial-104',
    request_number: 'REQ-TRL-6320',
    module: 'Trial Periods',
    request_type: 'Trial Periods',
    project: 'BHEL Spares RFQ',
    applicant_name: 'Bharat Heavy Electricals',
    applicant_email: 'procurement@bhel.in',
    value_impact: '30-Day Enterprise Trial Extension',
    amount: 0,
    quantity: 30,
    available_balance: 0,
    maker_name: 'Govardhan',
    maker_role: 'Category Manager',
    assigned_approver: 'Srinu Sir',
    internal_task_id: 'tsk-credit-101',
    status: 'Pending',
    details: 'Requested 30-day trial extension for comprehensive high-voltage motor evaluations.',
    history: [
      {
        action: 'SUBMITTED',
        actor_name: 'Govardhan',
        actor_role: 'Category Manager',
        timestamp: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
        remarks: 'Motor pilot testing ongoing at Trichy unit.',
      },
    ],
    attachments: [],
    created_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
  },
  {
    id: 'appr-scred-105',
    request_number: 'REQ-SC-5501',
    module: 'Seller Credit Addition',
    request_type: 'Seller Credit Addition',
    project: 'JSW Steel Energy Sourcing',
    applicant_name: 'Jindal Steel & Power Ltd',
    applicant_email: 'sales@jindalsteel.com',
    value_impact: '5 Quotation Credits (₹12,500)',
    amount: 12500,
    quantity: 5,
    available_balance: 2,
    maker_name: 'Krishna',
    maker_role: 'Category Manager',
    assigned_approver: 'Srinu Sir',
    internal_task_id: 'tsk-credit-101',
    status: 'Pending',
    details: 'Complimentary quotation credits for transformer bid round participation.',
    history: [
      {
        action: 'SUBMITTED',
        actor_name: 'Krishna',
        actor_role: 'Category Manager',
        timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
        remarks: 'High-value electrical equipment tender participation requirement.',
      },
    ],
    attachments: [],
    created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  },
  {
    id: 'appr-po-106',
    request_number: 'REQ-PR-4412',
    module: 'Purchase Requests',
    request_type: 'Purchase Requests',
    project: 'Tata Steel Maintenance',
    applicant_name: 'Tata Steel Jamshedpur',
    applicant_email: 'purchasing@tatasteel.com',
    value_impact: '₹14,80,000 Conveyor Belt Line',
    amount: 1480000,
    quantity: 1,
    available_balance: 5000000,
    maker_name: 'Govardhan',
    maker_role: 'Category Manager',
    assigned_approver: 'Sudheer Sir',
    status: 'Approved',
    details: 'Urgent conveyor replacement line purchase order authorization.',
    approver_name: 'Sudheer Sir',
    approver_remarks: 'Verified against budget code CAPEX-2026-ENG-4.',
    history: [
      {
        action: 'SUBMITTED',
        actor_name: 'Govardhan',
        actor_role: 'Category Manager',
        timestamp: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
        remarks: 'Technical specification clearance received.',
      },
      {
        action: 'APPROVED',
        actor_name: 'Sudheer Sir',
        actor_role: 'Senior Director',
        timestamp: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
        remarks: 'Verified against budget code CAPEX-2026-ENG-4.',
      },
    ],
    attachments: [],
    created_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
  },
  {
    id: 'appr-pay-107',
    request_number: 'REQ-PAY-3309',
    module: 'Payment Approvals',
    request_type: 'Payment Approvals',
    project: 'Larsen & Toubro Heavy Eng',
    applicant_name: 'ABB India Power Grids',
    applicant_email: 'finance@abb.com',
    value_impact: '₹6,40,000 Milestone 2 Clearance',
    amount: 640000,
    quantity: 1,
    available_balance: 1200000,
    maker_name: 'Chandhan',
    maker_role: 'Category Manager',
    assigned_approver: 'Srinu Sir',
    status: 'Rejected',
    details: 'Advance milestone release before physical delivery verification.',
    approver_name: 'Srinu Sir',
    approver_remarks: 'Rejected: delivery inspection report required prior to payment clearance.',
    history: [
      {
        action: 'SUBMITTED',
        actor_name: 'Chandhan',
        actor_role: 'Category Manager',
        timestamp: new Date(Date.now() - 40 * 3600 * 1000).toISOString(),
        remarks: 'Supplier milestone invoice submitted.',
      },
      {
        action: 'REJECTED',
        actor_name: 'Srinu Sir',
        actor_role: 'VP Operations',
        timestamp: new Date(Date.now() - 38 * 3600 * 1000).toISOString(),
        remarks: 'Rejected: delivery inspection report required prior to payment clearance.',
      },
    ],
    attachments: [],
    created_at: new Date(Date.now() - 40 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 38 * 3600 * 1000).toISOString(),
  },
];

/**
 * Summary metrics of management approvals.
 */
async function getApprovalSummary() {
  if (pool.hasStorage()) {
    try {
      const sql = `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN lower(status) = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN lower(status) = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN lower(status) = 'rejected' THEN 1 ELSE 0 END) as rejected
        FROM approvals
      `;
      const res = await pool.query(sql, [], { d1: true, d1Text: sql, useCache: true, tag: 'approvals', ttlMs: 15000 });
      if (res?.rows) {
        if (res.rows.length === 0) {
          return { total: 0, pending: 0, approved: 0, rejected: 0 };
        }
        const row = res.rows[0];
        return {
          total: Number(row.total || 0),
          pending: Number(row.pending || 0),
          approved: Number(row.approved || 0),
          rejected: Number(row.rejected || 0),
        };
      }
    } catch {
      // fallback to memory
    }
  }
  const pending = memoryApprovals.filter((a) => String(a.status || '').toLowerCase() === 'pending').length;
  const approved = memoryApprovals.filter((a) => String(a.status || '').toLowerCase() === 'approved').length;
  const rejected = memoryApprovals.filter((a) => String(a.status || '').toLowerCase() === 'rejected').length;
  const total = memoryApprovals.length;
  return { pending, approved, rejected, total };
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
  if (pool.hasStorage()) {
    try {
      const conditions = [];
      const params = [];

      if (module && module !== 'all') {
        params.push(module.toLowerCase());
        conditions.push(`(lower(module) = $${params.length} OR lower(coalesce(raw->>'request_type', '')) = $${params.length})`);
      }

      if (status && status !== 'all') {
        params.push(status.toLowerCase());
        conditions.push(`lower(status) = $${params.length}`);
      }

      if (project && project !== 'all') {
        params.push(`%${project.toLowerCase()}%`);
        conditions.push(`lower(coalesce(project, '')) LIKE $${params.length}`);
      }

      if (assigned_approver && assigned_approver.trim()) {
        params.push(`%${assigned_approver.trim().toLowerCase()}%`);
        conditions.push(`(lower(coalesce(approver_name, '')) LIKE $${params.length} OR lower(coalesce(raw->>'assigned_approver', '')) LIKE $${params.length})`);
      }

      if (search && search.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        params.push(q);
        const idx = params.length;
        conditions.push(`(
          lower(coalesce(request_number, '')) LIKE $${idx} OR
          lower(coalesce(applicant_name, '')) LIKE $${idx} OR
          lower(coalesce(applicant_email, '')) LIKE $${idx} OR
          lower(coalesce(maker_name, '')) LIKE $${idx} OR
          lower(coalesce(project, '')) LIKE $${idx} OR
          lower(coalesce(value_impact, '')) LIKE $${idx} OR
          lower(coalesce(raw->>'assigned_approver', '')) LIKE $${idx}
        )`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const countSql = `SELECT count(*) as total FROM approvals ${whereClause}`;
      const countRes = await pool.query(countSql, params, { d1: true, d1Text: countSql, useCache: true, tag: 'approvals', ttlMs: 10000 });
      const total = Number(countRes?.rows?.[0]?.total || 0);

      if (total > 0) {
        const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
        const safeOffset = Math.max(Number(offset) || 0, 0);
        const validSortFields = ['created_at', 'request_number', 'module', 'applicant_name', 'status', 'value_impact'];
        const sortCol = validSortFields.includes(sortBy) ? sortBy : 'created_at';
        const sortDir = (sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        const dataSql = `SELECT * FROM approvals ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        const dataRes = await pool.query(dataSql, [...params, safeLimit, safeOffset], { d1: true, d1Text: dataSql });
        const rows = (dataRes?.rows || []).map(hydrateApprovalRow);
        return { rows, total };
      }
    } catch {
      // Fallback to memory
    }
  }

  let filtered = [...memoryApprovals];

  if (module && module !== 'all') {
    const modLower = module.toLowerCase();
    filtered = filtered.filter(
      (a) => String(a.module || '').toLowerCase() === modLower || String(a.request_type || '').toLowerCase() === modLower
    );
  }

  if (status && status !== 'all') {
    const statLower = status.toLowerCase();
    filtered = filtered.filter((a) => String(a.status || '').toLowerCase() === statLower);
  }

  if (project && project !== 'all') {
    const projLower = project.toLowerCase();
    filtered = filtered.filter((a) => String(a.project || '').toLowerCase().includes(projLower));
  }

  if (assigned_approver && assigned_approver.trim()) {
    const apprLower = assigned_approver.trim().toLowerCase();
    filtered = filtered.filter(
      (a) =>
        String(a.assigned_approver || '').toLowerCase().includes(apprLower) ||
        String(a.approver_name || '').toLowerCase().includes(apprLower)
    );
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (a) =>
        String(a.request_number || '').toLowerCase().includes(q) ||
        String(a.applicant_name || '').toLowerCase().includes(q) ||
        String(a.applicant_email || '').toLowerCase().includes(q) ||
        String(a.maker_name || '').toLowerCase().includes(q) ||
        String(a.project || '').toLowerCase().includes(q) ||
        String(a.value_impact || '').toLowerCase().includes(q) ||
        String(a.assigned_approver || '').toLowerCase().includes(q) ||
        String(a.details || '').toLowerCase().includes(q)
    );
  }

  // Sort
  filtered.sort((a, b) => {
    let valA = a[sortBy] ?? a.created_at ?? '';
    let valB = b[sortBy] ?? b.created_at ?? '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const total = filtered.length;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const rows = filtered.slice(safeOffset, safeOffset + safeLimit);

  return { rows, total };
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
 * Hydrates an approval row from the database.
 */
function hydrateApprovalRow(row) {
  if (!row) return null;
  const raw = parseRawObject(row.raw);
  const now = new Date().toISOString();
  return {
    id: row.id,
    request_number: row.request_number,
    module: row.module || raw.request_type || 'Buyer Credit Addition',
    request_type: raw.request_type || row.module || 'Buyer Credit Addition',
    project: row.project || 'General',
    applicant_name: row.applicant_name || '',
    applicant_email: row.applicant_email || '',
    value_impact: row.value_impact || '',
    amount: Number(raw.amount || 0),
    quantity: Number(raw.quantity || 1),
    available_balance: Number(raw.available_balance || 0),
    maker_name: row.maker_name || 'Category Manager',
    maker_role: row.maker_role || 'Category Manager',
    assigned_approver: raw.assigned_approver || 'Srinu Sir',
    status: row.status || 'Pending',
    details: row.details || '',
    approver_name: row.approver_name || null,
    approver_remarks: row.approver_remarks || null,
    internal_task_id: raw.internal_task_id || null,
    buyer_id: raw.buyer_id || null,
    history: Array.isArray(raw.history) ? raw.history : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    created_at: row.created_at ? new Date(row.created_at).toISOString() : now,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : now,
    raw,
  };
}

/**
 * Create a new approval record in the database and in-memory store.
 */
async function createApproval(data, actor = {}) {
  const now = new Date().toISOString();
  const id = data.id || `appr_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const request_number = data.request_number || `REQ-CR-${Math.floor(1000 + Math.random() * 9000)}`;
  const module = data.module || data.request_type || 'Buyer Credit Addition';
  const request_type = data.request_type || data.module || 'Buyer Credit Addition';
  const project = data.project || 'General';
  const applicant_name = data.applicant_name || 'Applicant';
  const applicant_email = data.applicant_email || 'applicant@procucev.com';
  const value_impact = data.value_impact || `${data.amount || data.quantity || 0} Credits`;
  const maker_name = data.maker_name || actor.fullName || actor.name || 'Category Manager';
  const maker_role = data.maker_role || actor.role || 'Category Manager';
  const assigned_approver = data.assigned_approver || 'Srinu Sir';
  const status = data.status || 'Pending';
  const details = data.details || '';
  const amount = Number(data.amount || 0);
  const quantity = Number(data.quantity || 1);
  const available_balance = Number(data.available_balance || 0);
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

  memoryApprovals.unshift(item);

  if (pool.hasStorage()) {
    try {
      const sql = `
        INSERT INTO approvals (
          id, request_number, module, project, applicant_name, applicant_email,
          value_impact, maker_name, maker_role, status, details, raw, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `;
      await pool.query(
        sql,
        [
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
        ],
        { d1: true, d1Text: sql }
      );
    } catch {
      // non-fatal if table not created
    }
  }

  return item;
}

/**
 * Process approval or rejection action.
 * For Buyer Credit Additions, updates buyer credit balance and synchronizes corresponding internal task.
 */
async function processApprovalAction(id, { action, remarks = '' }, actor = {}) {
  let item = memoryApprovals.find((a) => a.id === id || a.request_number === id);

  if (!item && pool.hasStorage()) {
    try {
      const dbRes = await pool.query(
        'SELECT * FROM approvals WHERE id = $1 OR request_number = $1 LIMIT 1',
        [id],
        { d1: true }
      );
      if (dbRes?.rows?.length) {
        item = hydrateApprovalRow(dbRes.rows[0]);
        memoryApprovals.push(item);
      }
    } catch {
      // non-fatal
    }
  }

  if (!item) return null;

  const now = new Date().toISOString();
  const normalizedAction = (action || '').toUpperCase().includes('APPROV') ? 'Approved' : 'Rejected';
  const approverName = actor.name || actor.fullName || actor.email || 'Management Authority';
  const cleanRemarks = remarks ? String(remarks).trim() : '';

  item.status = normalizedAction;
  item.approver_name = approverName;
  item.approver_remarks = cleanRemarks;
  item.updated_at = now;

  if (!Array.isArray(item.history)) item.history = [];
  item.history.push({
    action: normalizedAction.toUpperCase(),
    actor_name: approverName,
    actor_role: actor.role || 'Executive Approver',
    timestamp: now,
    remarks: cleanRemarks || `Request ${normalizedAction.toLowerCase()} by ${approverName}.`,
  });

  // Buyer Credit Addition Workflow Integration (Section 8)
  const isCreditAddition =
    String(item.module || '').toLowerCase().includes('credit') ||
    String(item.request_type || '').toLowerCase().includes('credit') ||
    Boolean(item.internal_task_id) ||
    Boolean(item.buyer_id);

  if (isCreditAddition && item.internal_task_id) {
    try {
      const internalTaskQueries = require('./internalTaskQueries');
      if (normalizedAction === 'Approved' && internalTaskQueries.approveCreditTask) {
        await internalTaskQueries.approveCreditTask(item.internal_task_id, actor, cleanRemarks);
      } else if (normalizedAction === 'Rejected' && internalTaskQueries.rejectCreditTask) {
        await internalTaskQueries.rejectCreditTask(item.internal_task_id, actor, cleanRemarks);
      }
    } catch {
      // non-fatal
    }
  }

  // Update in database if pool is active
  if (pool.hasStorage()) {
    try {
      const updateSql = `
        UPDATE approvals
        SET status = $1, approver_name = $2, approver_remarks = $3, updated_at = $4,
            raw = jsonb_set(coalesce(raw, '{}'::jsonb), '{history}', $5::jsonb)
        WHERE id = $6 OR request_number = $6
      `;
      await pool.query(
        updateSql,
        [normalizedAction, approverName, cleanRemarks, now, JSON.stringify(item.history), id],
        { d1: true, d1Text: updateSql }
      );
    } catch {
      // non-fatal if table not yet populated
    }
  }

  // Dispatch notification to requester if communication service is present
  try {
    const actionCenterNotificationService = require('../services/actionCenterNotificationService');
    if (actionCenterNotificationService && actionCenterNotificationService.dispatchActionCenterCommunication) {
      await actionCenterNotificationService.dispatchActionCenterCommunication(
        {
          entityType: 'approval',
          entityId: item.id,
          channel: 'EMAIL',
          recipientEmail: item.applicant_email || 'requester@procucev.com',
          recipientName: item.maker_name || 'Requester',
          subject: `[Approval Update] Request ${item.request_number} has been ${normalizedAction}`,
          message: `Your approval request ${item.request_number} (${item.value_impact}) has been ${normalizedAction.toLowerCase()} by ${approverName}. Remarks: ${cleanRemarks || 'None'}.`,
        },
        actor
      );
    }
  } catch {
    // Non-fatal notification error
  }

  // Audit log insertion
  if (pool.hasStorage()) {
    try {
      const logId = `audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const sql = `
        INSERT INTO audit_logs (id, actor_email, action, entity_type, entity_id, description, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      await pool.query(
        sql,
        [
          logId,
          actor.email || 'admin@procucev.com',
          `APPROVAL_${normalizedAction.toUpperCase()}`,
          item.module,
          item.request_number,
          `Management ${normalizedAction} request ${item.request_number} (${item.value_impact}). Remarks: ${cleanRemarks || 'None'}`,
          now,
        ],
        { d1: true, d1Text: sql }
      );
    } catch {
      // Non-fatal audit log insertion
    }
  }

  return item;
}

module.exports = {
  getApprovalSummary,
  getApprovals,
  createApproval,
  processApprovalAction,
  hydrateApprovalRow,
  memoryApprovals,
};

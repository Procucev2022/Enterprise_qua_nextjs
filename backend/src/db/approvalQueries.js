// ==============================================================================
// APPROVAL QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Aggregated procurement approvals for credit additions, account verifications,
// trial periods, discounts, purchase requests, payment reconciliations,
// unit bookings, cancellations, packages, and milestones.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');
const { getD1Binding, getD1HttpClient, batchD1 } = require('./d1Bridge');
const { logger } = require('../services/loggerService');

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

function approvalConflict() {
  const conflict = new Error('This approval was already decided. Refresh the list before taking another action.');
  conflict.code = 'APPROVAL_ALREADY_DECIDED';
  return conflict;
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
  if (pool.hasStorage()) {
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
  return toSummary(memoryApprovals.map(({ status }) => ({ status, count: 1 })));
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
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const safeSortFields = ['created_at', 'request_number', 'module', 'applicant_name', 'status', 'value_impact'];
  const sortColumn = safeSortFields.includes(sortBy) ? sortBy : 'created_at';
  const sortDirection = String(sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  if (pool.hasStorage()) {
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

  let filtered = [...memoryApprovals];
  if (module && module !== 'all') {
    const normalizedModule = String(module).toLowerCase();
    filtered = filtered.filter((approval) => String(approval.module || '').toLowerCase() === normalizedModule || String(approval.request_type || '').toLowerCase() === normalizedModule);
  }
  if (status && status !== 'all') {
    const normalizedStatus = String(status).toLowerCase();
    filtered = filtered.filter((approval) => String(approval.status || '').toLowerCase() === normalizedStatus);
  }
  if (project && project !== 'all') {
    const normalizedProject = String(project).toLowerCase();
    filtered = filtered.filter((approval) => String(approval.project || '').toLowerCase().includes(normalizedProject));
  }
  if (assigned_approver && String(assigned_approver).trim()) {
    const normalizedApprover = String(assigned_approver).trim().toLowerCase();
    filtered = filtered.filter((approval) => String(approval.assigned_approver || approval.approver_name || '').toLowerCase().includes(normalizedApprover));
  }
  if (search && String(search).trim()) {
    const normalizedSearch = String(search).trim().toLowerCase();
    filtered = filtered.filter((approval) => [
      approval.request_number, approval.applicant_name, approval.applicant_email,
      approval.maker_name, approval.project, approval.value_impact,
      approval.assigned_approver, approval.details,
    ].some((value) => String(value || '').toLowerCase().includes(normalizedSearch)));
  }
  filtered.sort((left, right) => {
    const leftValue = left[sortColumn] ?? left.created_at ?? '';
    const rightValue = right[sortColumn] ?? right.created_at ?? '';
    const normalizedLeft = typeof leftValue === 'string' ? leftValue.toLowerCase() : leftValue;
    const normalizedRight = typeof rightValue === 'string' ? rightValue.toLowerCase() : rightValue;
    if (normalizedLeft < normalizedRight) return sortDirection === 'ASC' ? -1 : 1;
    if (normalizedLeft > normalizedRight) return sortDirection === 'ASC' ? 1 : -1;
    return 0;
  });
  const total = filtered.length;
  return { rows: filtered.slice(safeOffset, safeOffset + safeLimit), total };
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

function prepareApprovalCreate(data = {}, actor = {}) {
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

function rememberApproval(item) {
  memoryApprovals.unshift(item);
  return item;
}

/**
 * Create a new approval record in the database and in-memory store.
 */
async function createApproval(data, actor = {}) {
  const prepared = prepareApprovalCreate(data, actor);
  if (pool.hasStorage()) {
    try {
      await pool.query(
        prepared.statement.text,
        prepared.statement.params,
        { d1: true, d1Text: prepared.statement.text }
      );
    } catch (error) {
      throw persistenceUnavailable(error, 'create-approval');
    }
  }

  return rememberApproval(prepared.item);
}

/**
 * Process approval or rejection action.
 * For Buyer Credit Additions, updates buyer credit balance and synchronizes corresponding internal task.
 */
async function processApprovalAction(id, { action, remarks = '' }, actor = {}) {
  const normalizedAction = String(action || '').toUpperCase().includes('APPROV') ? 'Approved' : 'Rejected';
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const actorId = actor.uuid || actor.id || null;
  const actorName = actor.name || actor.fullName || actor.email || 'Management Authority';
  const actorEmail = actor.email || null;
  const normalizedRemarks = String(remarks || '');

  if (pool.hasStorage()) {
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
        logger.audit(`Management approval ${normalizedAction.toLowerCase()}`, actorEmail || 'system@procucev.ai', {
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
        actor_role: actor.role || 'Executive Approver',
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
      const memoryIndex = memoryApprovals.findIndex((entry) => entry.id === updatedApproval.id || entry.request_number === updatedApproval.request_number);
      if (memoryIndex >= 0) memoryApprovals[memoryIndex] = updatedApproval;
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

      try {
        const actionCenterNotificationService = require('../services/actionCenterNotificationService');
        if (actionCenterNotificationService?.dispatchActionCenterCommunication) {
          await actionCenterNotificationService.dispatchActionCenterCommunication({
            entityType: 'approval',
            entityId: updatedApproval.id,
            channel: 'EMAIL',
            recipientEmail: updatedApproval.applicant_email || 'requester@procucev.com',
            recipientName: updatedApproval.maker_name || 'Requester',
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

      logger.audit(`Approval ${normalizedAction.toLowerCase()}`, actorEmail || 'system@procucev.ai', {
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

  const item = memoryApprovals.find((approval) => approval.id === id || approval.request_number === id);
  if (!item) return null;
  if (item.status !== 'Pending') throw approvalConflict();

  item.status = normalizedAction;
  item.approver_id = actorId;
  item.approver_name = actorName;
  item.approver_email = actorEmail;
  item.approver_remarks = normalizedRemarks;
  item.updated_at = now;
  if (!Array.isArray(item.history)) item.history = [];
  item.history.push({
    action: normalizedAction.toUpperCase(),
    actor_name: actorName,
    actor_role: actor.role || 'Executive Approver',
    timestamp: now,
    remarks: normalizedRemarks || `Request ${normalizedAction.toLowerCase()} by ${actorName}.`,
  });
  logger.audit(`Management approval ${normalizedAction.toLowerCase()}`, actorEmail || 'system@procucev.ai', {
    approvalId: item.id,
    requestNumber: item.request_number,
    actorId,
    remarks: normalizedRemarks,
    eventId,
  }, item.request_number);
  return item;
}
module.exports = {
  getApprovalSummary,
  getApprovals,
  createApproval,
  prepareApprovalCreate,
  rememberApproval,
  processApprovalAction,
  hydrateApprovalRow,
  memoryApprovals,
};

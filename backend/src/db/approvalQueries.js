// ==============================================================================
// APPROVAL QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Aggregated management approvals for credit notes, account verifications,
// trial periods, discounts, and payment reconciliations in the Action Center.
// ==============================================================================

const pool = require('./pool');
const crypto = require('crypto');

const memoryApprovals = [
  {
    id: 'appr-cred-101',
    request_number: 'REQ-CR-9041',
    module: 'Credit Notes',
    project: 'Tata Steel Maintenance',
    applicant_name: 'Tata Steel Procurement Team',
    applicant_email: 'buyer@tatasteel.com',
    value_impact: '₹2,50,000 (100 RFQ Credits Allocation)',
    maker_name: 'Navin Chaudhary',
    maker_role: 'Category Executive',
    status: 'Pending',
    details: 'Free trial expansion for mechanical spares RFQs.',
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
  {
    id: 'appr-acct-102',
    request_number: 'REQ-ACC-8812',
    module: 'Account Approvals',
    project: 'Enterprise Vendor Portal',
    applicant_name: 'Larsen & Toubro Ltd Heavy Eng',
    applicant_email: 'vendor.lt@lnt.com',
    value_impact: 'Tier 1 Preferred Supplier Access',
    maker_name: 'Prajwal K',
    maker_role: 'Vendor Ops Specialist',
    status: 'Pending',
    details: 'Self-registered supplier onboarding verification and GSTIN validation clearance.',
    created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
  },
  {
    id: 'appr-disc-103',
    request_number: 'REQ-DSC-7104',
    module: 'Discounts',
    project: 'JSW Steel Energy Sourcing',
    applicant_name: 'JSW Energy Plant 4',
    applicant_email: 'sourcing@jsw.in',
    value_impact: '15% Annual Subscription Discount (₹75,000)',
    maker_name: 'Sudheer Kangala',
    maker_role: 'Enterprise Director',
    status: 'Approved',
    details: 'Multi-year enterprise contract commercial incentive discount.',
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
  },
  {
    id: 'appr-trial-104',
    request_number: 'REQ-TRL-6320',
    module: 'Trial Periods',
    project: 'BHEL Spares RFQ',
    applicant_name: 'Bharat Heavy Electricals',
    applicant_email: 'procurement@bhel.in',
    value_impact: '30-Day Enterprise Trial Extension',
    maker_name: 'Navin Chaudhary',
    maker_role: 'Category Executive',
    status: 'Pending',
    details: 'Requested 30-day trial extension for comprehensive high-voltage motor evaluations.',
    created_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
  },
];

/**
 * Summary metrics of management approvals.
 */
async function getApprovalSummary() {
  const pending = memoryApprovals.filter((a) => a.status === 'Pending').length;
  const approved = memoryApprovals.filter((a) => a.status === 'Approved').length;
  const rejected = memoryApprovals.filter((a) => a.status === 'Rejected').length;
  const total = memoryApprovals.length;
  return { pending, approved, rejected, total };
}

/**
 * List approvals with module, status, project, and search filtering.
 */
async function getApprovals({ module = 'all', status = 'all', project = 'all', search = '', limit = 50, offset = 0 } = {}) {
  let filtered = [...memoryApprovals];

  if (module && module !== 'all') {
    filtered = filtered.filter((a) => (a.module || '').toLowerCase() === module.toLowerCase());
  }

  if (status && status !== 'all') {
    filtered = filtered.filter((a) => (a.status || '').toLowerCase() === status.toLowerCase());
  }

  if (project && project !== 'all') {
    filtered = filtered.filter((a) => (a.project || '').toLowerCase().includes(project.toLowerCase()));
  }

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (a) =>
        (a.request_number || '').toLowerCase().includes(q) ||
        (a.applicant_name || '').toLowerCase().includes(q) ||
        (a.applicant_email || '').toLowerCase().includes(q) ||
        (a.maker_name || '').toLowerCase().includes(q) ||
        (a.project || '').toLowerCase().includes(q) ||
        (a.value_impact || '').toLowerCase().includes(q)
    );
  }

  const total = filtered.length;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const rows = filtered.slice(safeOffset, safeOffset + safeLimit);

  return { rows, total };
}

/**
 * Process approval or rejection action.
 */
async function processApprovalAction(id, { action, remarks = '' }, actor = {}) {
  const item = memoryApprovals.find((a) => a.id === id || a.request_number === id);
  if (!item) return null;

  const now = new Date().toISOString();
  const normalizedAction = (action || '').toUpperCase().includes('APPROV') ? 'Approved' : 'Rejected';

  item.status = normalizedAction;
  item.approver_name = actor.name || actor.email || 'Management Authority';
  item.approver_remarks = remarks;
  item.updated_at = now;

  // Audit log integration if database pool is available
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
          `Management ${normalizedAction} request ${item.request_number} (${item.value_impact}). Remarks: ${remarks || 'None'}`,
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
  processApprovalAction,
  memoryApprovals,
};

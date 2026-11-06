// ==============================================================================
// APPROVAL QUERIES (Cloudflare D1 & PostgreSQL)
// ==============================================================================
// Aggregated management approvals for credit notes, account verifications,
// trial periods, discounts, and payment reconciliations in the Action Center.
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
async function getApprovalSummary() {
  if (pool.hasStorage()) {
    try {
      const result = await queryApprovals(
        'SELECT status, COUNT(*) AS count FROM management_approvals GROUP BY status'
      );
      return toSummary(result.rows);
    } catch (error) {
      throw persistenceUnavailable(error, 'get-approval-summary');
    }
  }

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
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);

  if (pool.hasStorage()) {
    try {
      const filters = [];
      const params = [];
      const addFilter = (value, predicate) => {
        params.push(value);
        filters.push(predicate(params.length));
      };

      if (module && module !== 'all') {
        addFilter(String(module).toLowerCase(), (index) => `LOWER(module) = $${index}`);
      }
      if (status && status !== 'all') {
        addFilter(String(status).toLowerCase(), (index) => `LOWER(status) = $${index}`);
      }
      if (project && project !== 'all') {
        addFilter(`%${String(project).toLowerCase()}%`, (index) => `LOWER(project) LIKE $${index}`);
      }
      if (search && String(search).trim()) {
        const searchValue = `%${String(search).trim().toLowerCase()}%`;
        addFilter(searchValue, (index) => `(
          LOWER(request_number) LIKE $${index}
          OR LOWER(applicant_name) LIKE $${index}
          OR LOWER(applicant_email) LIKE $${index}
          OR LOWER(maker_name) LIKE $${index}
          OR LOWER(project) LIKE $${index}
          OR LOWER(value_impact) LIKE $${index}
        )`);
      }

      const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
      const pageParams = [...params, safeLimit, safeOffset];
      const limitIndex = pageParams.length - 1;
      const offsetIndex = pageParams.length;
      const sql = `SELECT *, COUNT(*) OVER() AS total
        FROM management_approvals ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}`;
      const result = await queryApprovals(sql, pageParams);
      if (result.rows.length > 0) {
        const rows = result.rows.map((row) => {
          const approval = { ...row };
          delete approval.total;
          return approval;
        });
        return { rows, total: Number(result.rows[0].total) || 0 };
      }

      const countResult = await queryApprovals(
        `SELECT COUNT(*) AS total FROM management_approvals ${where}`,
        params
      );
      return { rows: [], total: Number(countResult.rows[0]?.total) || 0 };
    } catch (error) {
      throw persistenceUnavailable(error, 'list-approvals');
    }
  }

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
  const rows = filtered.slice(safeOffset, safeOffset + safeLimit);

  return { rows, total };
}

/**
 * Process approval or rejection action.
 */
async function processApprovalAction(id, { action, remarks = '' }, actor = {}) {
  const normalizedAction = String(action || '').toUpperCase().includes('APPROV') ? 'Approved' : 'Rejected';
  const now = new Date().toISOString();
  const eventId = crypto.randomUUID();
  const actorId = actor.uuid || actor.id || null;
  const actorName = actor.name || actor.email || 'Management Authority';
  const actorEmail = actor.email || null;
  const normalizedRemarks = String(remarks || '');

  if (pool.hasStorage()) {
    try {
      const d1 = getD1Binding() || getD1HttpClient();
      let updated;

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
        updated = results[0]?.rows?.[0] || null;
        if (updated && !results[1]?.rows?.[0]) {
          throw new Error('Approval state changed but its audit event was not written.');
        }
      } else {
        updated = await pool.withTransaction(async (client) => {
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

      if (!updated) {
        if (!d1) return null;
        const current = await findApprovalInDatabase(id);
        if (!current) return null;
        throw approvalConflict();
      }

      pool.queryCache.invalidate('management_approvals');
      pool.queryCache.invalidate('management_approval_events');
      logger.audit(`Management approval ${normalizedAction.toLowerCase()}`, actorEmail || 'system@procucev.ai', {
        approvalId: updated.id,
        requestNumber: updated.request_number,
        actorId,
        remarks: normalizedRemarks,
        eventId,
      }, updated.request_number);
      return updated;
    } catch (error) {
      if (error?.code === 'APPROVAL_ALREADY_DECIDED') throw error;
      throw persistenceUnavailable(error, 'process-approval-action');
    }
  }

  const item = memoryApprovals.find((a) => a.id === id || a.request_number === id);
  if (!item) return null;
  if (item.status !== 'Pending') throw approvalConflict();

  item.status = normalizedAction;
  item.approver_id = actorId;
  item.approver_name = actorName;
  item.approver_email = actorEmail;
  item.approver_remarks = normalizedRemarks;
  item.updated_at = now;
  logger.audit(`Management approval ${normalizedAction.toLowerCase()}`, actorEmail || 'system@procucev.ai', {
    approvalId: item.id,
    requestNumber: item.request_number,
    actorId,
    remarks: normalizedRemarks,
  }, item.request_number);

  return item;
}

module.exports = {
  getApprovalSummary,
  getApprovals,
  processApprovalAction,
  memoryApprovals,
};

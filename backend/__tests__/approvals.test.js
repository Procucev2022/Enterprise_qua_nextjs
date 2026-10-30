const request = require('supertest');
const app = require('../src/app');
const approvalQueries = require('../src/db/approvalQueries');
const pool = require('../src/db/pool');

describe('Approvals API & Controller', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('GET /api/approvals/summary returns approval summary metrics', async () => {
    const res = await request(app).get('/api/approvals/summary');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.total).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.pending).toBeDefined();
  });

  test('GET /api/approvals filters by module, status, project, and search', async () => {
    const res = await request(app).get('/api/approvals?module=Credit Notes&status=Pending&project=Tata&search=9041&limit=5&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /api/approvals/:id/action validates and processes approval or rejection', async () => {
    // Missing action
    const failRes = await request(app).post('/api/approvals/appr-cred-101/action').send({});
    expect(failRes.status).toBe(400);

    // 404 case
    const notFoundRes = await request(app).post('/api/approvals/appr-missing-999/action').send({ action: 'APPROVE' });
    expect(notFoundRes.status).toBe(404);

    // Success approval
    const okRes = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set('x-user-name', 'Sudheer Kangala')
      .send({ action: 'APPROVE', remarks: 'Granted 100 extra free credits for RFQs.' });
    expect(okRes.status).toBe(200);
    expect(okRes.body.success).toBe(true);
    expect(okRes.body.data.status).toBe('Approved');

    // Success rejection
    const rejectRes = await request(app)
      .post('/api/approvals/appr-acct-102/action')
      .set('x-user-name', 'Sudheer Kangala')
      .send({ action: 'REJECT', remarks: 'Invalid business documentation.' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.status).toBe('Rejected');
  });

  test('handles 500 error catch branches gracefully', async () => {
    jest.spyOn(approvalQueries, 'getApprovalSummary').mockRejectedValue(new Error('Summary error'));
    const sumErr = await request(app).get('/api/approvals/summary');
    expect(sumErr.status).toBe(500);

    jest.spyOn(approvalQueries, 'getApprovals').mockRejectedValue(new Error('List error'));
    const listErr = await request(app).get('/api/approvals');
    expect(listErr.status).toBe(500);

    jest.spyOn(approvalQueries, 'processApprovalAction').mockRejectedValue(new Error('Process error'));
    const actErr = await request(app).post('/api/approvals/appr-cred-101/action').send({ action: 'APPROVE' });
    expect(actErr.status).toBe(500);
  });

  test('processApprovalAction with pool.hasStorage() logs to audit_logs and handles error', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

    const updated = await approvalQueries.processApprovalAction(
      'appr-trial-104',
      { action: 'APPROVE', remarks: 'Extended 30 days' },
      { name: 'Admin', email: 'admin@procucev.com' }
    );
    expect(updated).toBeDefined();
    expect(querySpy).toHaveBeenCalled();

    // Rejection action
    const rejected = await approvalQueries.processApprovalAction(
      'appr-trial-104',
      { action: 'REJECT', remarks: 'Denied' },
      {}
    );
    expect(rejected.status).toBe('Rejected');

    // Audit log error catch branch
    jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('Audit fail'));
    const nonFatal = await approvalQueries.processApprovalAction(
      'appr-trial-104',
      { action: 'APPROVE' },
      { email: 'admin@x.com' }
    );
    expect(nonFatal).toBeDefined();
  });

  test('approvalController directly tests extractActor branches and query variations', async () => {
    const approvalController = require('../src/controllers/approvalController');

    // 1. req.user with uuid, fullName, email, role
    let jsonResult = null;
    const resMock = { json: (val) => { jsonResult = val; return resMock; }, status: () => resMock };
    await approvalController.processAction(
      {
        params: { id: 'appr-cred-101' },
        body: { action: 'APPROVE', remarks: 'Good' },
        user: { uuid: 'u-123', fullName: 'Director John', email: 'john@x.com', role: 'superadmin' },
      },
      resMock
    );
    expect(jsonResult.success).toBe(true);

    // 2. req.user with id, name, without email/role
    await approvalController.processAction(
      {
        params: { id: 'appr-cred-101' },
        body: { action: 'REJECT' },
        user: { id: 'u-456', name: 'Manager Mary' },
      },
      resMock
    );
    expect(jsonResult.success).toBe(true);

    // 3. req.user with only email
    await approvalController.processAction(
      {
        params: { id: 'appr-cred-101' },
        body: { action: 'APPROVE' },
        user: { email: 'ops@x.com' },
      },
      resMock
    );
    expect(jsonResult.success).toBe(true);

    // 4. req.user empty
    await approvalController.processAction(
      {
        params: { id: 'appr-cred-101' },
        body: { action: 'APPROVE' },
        user: {},
      },
      resMock
    );
    expect(jsonResult.success).toBe(true);

    // 5. getApprovals with no params
    await approvalController.getApprovals({ query: {} }, resMock);
    expect(jsonResult.success).toBe(true);

    // 6. getApprovals search branches in approvalQueries
    await approvalQueries.getApprovals();
    await approvalQueries.getApprovals({ module: 'all', status: 'all', project: 'all', search: '' });
    await approvalQueries.getApprovals({ project: 'JSW Steel Energy' });
    await approvalQueries.getApprovals({ search: 'REQ-CR-9041' });
    await approvalQueries.getApprovals({ limit: null, offset: null });
    const s1 = await approvalQueries.getApprovals({ search: 'Tata Steel Procurement' });
    expect(s1.rows.length).toBeGreaterThanOrEqual(1);
    const s2 = await approvalQueries.getApprovals({ search: 'buyer@tatasteel.com' });
    expect(s2.rows.length).toBeGreaterThanOrEqual(1);
    const s3 = await approvalQueries.getApprovals({ search: 'Navin Chaudhary' });
    expect(s3.rows.length).toBeGreaterThanOrEqual(1);
    const s4 = await approvalQueries.getApprovals({ search: 'Credits Allocation' });
    expect(s4.rows.length).toBeGreaterThanOrEqual(1);
    const s5 = await approvalQueries.getApprovals({ module: null, status: null, project: null });
    expect(s5.rows.length).toBeGreaterThanOrEqual(1);

    // Sparse item to cover null-coalescing branches
    approvalQueries.memoryApprovals.push({ id: 'appr-sparse-1' });
    await approvalQueries.getApprovals({ module: 'Credit Notes', status: 'Pending', project: 'Tata', search: 'sparse' });
    await approvalQueries.getApprovals({ search: 'unmatched-xyz' });
    approvalQueries.memoryApprovals.pop();

    // 7. processApprovalAction variations
    await approvalQueries.processApprovalAction('appr-cred-101', { action: '' });
    await approvalQueries.processApprovalAction('appr-cred-101', { action: 'APPROVE' }, { email: 'only@x.com' });
    await approvalQueries.processApprovalAction('appr-cred-101', { action: 'APPROVE' }, {});
  });
});


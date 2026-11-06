const request = require('supertest');
const app = require('../src/app');
const approvalQueries = require('../src/db/approvalQueries');
const pool = require('../src/db/pool');
const { authHeader } = require('./testHelpers');
const { resetD1HttpClientCache } = require('../src/db/d1Bridge');

const initialMemoryApprovals = JSON.parse(JSON.stringify(approvalQueries.memoryApprovals));

describe('Approvals API & Controller', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    approvalQueries.memoryApprovals.splice(
      0,
      approvalQueries.memoryApprovals.length,
      ...JSON.parse(JSON.stringify(initialMemoryApprovals))
    );
  });

  afterEach(() => {
    delete globalThis.__CF_ENV__;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_D1_DATABASE_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    resetD1HttpClientCache();
  });

  test('GET /api/approvals/summary returns approval summary metrics', async () => {
    const res = await request(app).get('/api/approvals/summary').set(authHeader('category_manager'));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.total).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.pending).toBeDefined();
  });

  test('GET /api/approvals filters by module, status, project, and search', async () => {
    const res = await request(app)
      .get('/api/approvals?module=Credit Notes&status=Pending&project=Tata&search=9041&limit=5&offset=0')
      .set(authHeader('admin'));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /api/approvals/:id/action validates and processes approval or rejection', async () => {
    // Missing action
    const failRes = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set(authHeader('admin'))
      .send({});
    expect(failRes.status).toBe(400);

    // 404 case
    const notFoundRes = await request(app)
      .post('/api/approvals/appr-missing-999/action')
      .set(authHeader('admin'))
      .send({ action: 'APPROVE' });
    expect(notFoundRes.status).toBe(404);

    // Success approval
    const okRes = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set(authHeader('admin'))
      .set('x-user-name', 'Sudheer Kangala')
      .send({ action: 'APPROVE', remarks: 'Granted 100 extra free credits for RFQs.' });
    expect(okRes.status).toBe(200);
    expect(okRes.body.success).toBe(true);
    expect(okRes.body.data.status).toBe('Approved');

    // Success rejection
    const rejectRes = await request(app)
      .post('/api/approvals/appr-acct-102/action')
      .set(authHeader('category_manager'))
      .set('x-user-name', 'Sudheer Kangala')
      .send({ action: 'REJECT', remarks: 'Invalid business documentation.' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.status).toBe('Rejected');
  });

  test('handles 500 error catch branches gracefully', async () => {
    jest.spyOn(approvalQueries, 'getApprovalSummary').mockRejectedValue(new Error('Summary error'));
    const sumErr = await request(app).get('/api/approvals/summary').set(authHeader('admin'));
    expect(sumErr.status).toBe(500);

    jest.spyOn(approvalQueries, 'getApprovals').mockRejectedValue(new Error('List error'));
    const listErr = await request(app).get('/api/approvals').set(authHeader('admin'));
    expect(listErr.status).toBe(500);

    jest.spyOn(approvalQueries, 'processApprovalAction').mockRejectedValue(new Error('Process error'));
    const actErr = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set(authHeader('admin'))
      .send({ action: 'APPROVE' });
    expect(actErr.status).toBe(500);
  });

  test('approval endpoints reject anonymous and non-approver roles', async () => {
    const anonymousSummary = await request(app).get('/api/approvals/summary');
    const buyerList = await request(app).get('/api/approvals').set(authHeader('buyer'));
    const anonymousAction = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .send({ action: 'APPROVE' });
    const vendorAction = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set(authHeader('vendor'))
      .send({ action: 'APPROVE' });

    expect(anonymousSummary.status).toBe(401);
    expect(buyerList.status).toBe(403);
    expect(anonymousAction.status).toBe(401);
    expect(vendorAction.status).toBe(403);
  });

  test('processApprovalAction keeps the no-database demo path deterministic and audits the decision', async () => {
    const auditSpy = jest.spyOn(require('../src/services/loggerService').logger, 'audit');
    const updated = await approvalQueries.processApprovalAction(
      'appr-trial-104',
      { action: 'APPROVE', remarks: 'Extended 30 days' },
      { uuid: 'operator-1', name: 'Admin', email: 'admin@procucev.com' }
    );
    expect(updated).toMatchObject({
      status: 'Approved',
      approver_id: 'operator-1',
      approver_name: 'Admin',
      approver_remarks: 'Extended 30 days',
    });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.stringContaining('approved'),
      'admin@procucev.com',
      expect.objectContaining({ approvalId: 'appr-trial-104' }),
      'REQ-TRL-6320'
    );
    await expect(approvalQueries.processApprovalAction(
      'appr-trial-104', { action: 'REJECT' }, {}
    )).rejects.toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED' });
  });

  test('database summary and filtered list use durable query results', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [
        { status: 'Pending', count: '2' }, { status: 'Approved', count: '1' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'db-approval-1', status: 'Pending', total: '4' }] });

    await expect(approvalQueries.getApprovalSummary()).resolves.toEqual({
      pending: 2, approved: 1, rejected: 0, total: 3,
    });
    const listed = await approvalQueries.getApprovals({
      module: 'Credit Notes', status: 'Pending', project: 'Tata', search: '9041', limit: 5, offset: 2,
    });
    expect(listed).toEqual({
      rows: [{ id: 'db-approval-1', status: 'Pending' }],
      total: 4,
    });
    expect(querySpy.mock.calls[1][0]).toContain('COUNT(*) OVER()');
    expect(querySpy.mock.calls[1][1]).toEqual(['credit notes', 'pending', '%tata%', '%9041%', 5, 2]);
  });

  test('database list runs a count query for an empty page and wraps read failures', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const querySpy = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '8' }] });
    await expect(approvalQueries.getApprovals({ offset: 100 })).resolves.toEqual({ rows: [], total: 8 });
    expect(querySpy).toHaveBeenCalledTimes(2);

    querySpy.mockRejectedValueOnce(new Error('database offline'));
    await expect(approvalQueries.getApprovalSummary()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  });

  test('PostgreSQL approval decisions and audit events commit in one transaction', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const saved = {
      id: 'db-approval-1', request_number: 'REQ-DB-1', module: 'Credit Notes',
      status: 'Approved', approver_name: 'Admin',
    };
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ ...saved, status: 'Pending' }] })
      .mockResolvedValueOnce({ rows: [saved] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-1' }] });
    const transactionSpy = jest.spyOn(pool, 'withTransaction')
      .mockImplementation((callback) => callback({ query: clientQuery }));

    await expect(approvalQueries.processApprovalAction(
      'REQ-DB-1', { action: 'APPROVE', remarks: 'Approved' },
      { uuid: 'admin-1', name: 'Admin', email: 'admin@example.com' }
    )).resolves.toEqual(saved);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(clientQuery.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(clientQuery.mock.calls[1][0]).toContain('RETURNING *');
    expect(clientQuery.mock.calls[2][0]).toContain('INSERT INTO management_approval_events');
  });

  test('PostgreSQL rejects missing or already decided records without writing an event', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback({
      query: jest.fn().mockResolvedValueOnce({ rows: [] }),
    }));
    await expect(approvalQueries.processApprovalAction('missing', { action: 'REJECT' })).resolves.toBeNull();

    const clientQuery = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'db-1', status: 'Approved' }] });
    pool.withTransaction.mockImplementation((callback) => callback({ query: clientQuery }));
    await expect(approvalQueries.processApprovalAction('db-1', { action: 'REJECT' }))
      .rejects.toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED' });
    expect(clientQuery).toHaveBeenCalledTimes(1);
  });

  test('D1 approval decision batches the update and event atomically', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const saved = { id: 'd1-approval-1', request_number: 'REQ-D1-1', status: 'Rejected' };
    const prepared = [];
    const db = {
      prepare: (sql) => ({
        bind: (...params) => {
          const statement = { sql, params };
          prepared.push(statement);
          return statement;
        },
      }),
      batch: jest.fn().mockResolvedValue([
        { results: [saved], meta: { changes: 1 } },
        { results: [{ id: 'event-d1-1' }], meta: { changes: 1 } },
      ]),
    };
    globalThis.__CF_ENV__ = { DB: db };

    await expect(approvalQueries.processApprovalAction(
      'REQ-D1-1', { action: 'REJECT', remarks: 'Declined' }, { name: 'Manager' }
    )).resolves.toEqual(saved);
    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(prepared).toHaveLength(2);
    expect(prepared[0].sql).toContain('UPDATE management_approvals');
    expect(prepared[1].sql).toContain('INSERT INTO management_approval_events');
    expect(prepared[0].params[5]).toBe(prepared[1].params[0]);
  });

  test('D1 approval distinguishes missing and already decided rows and fails closed on batch errors', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const db = {
      prepare: (sql) => ({ bind: (...params) => ({ sql, params }) }),
      batch: jest.fn().mockResolvedValue([{ results: [], meta: { changes: 0 } }, { results: [], meta: { changes: 0 } }]),
    };
    globalThis.__CF_ENV__ = { DB: db };
    const readSpy = jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [{ id: 'd1-1', status: 'Approved' }] });
    await expect(approvalQueries.processApprovalAction('d1-1', { action: 'REJECT' }))
      .rejects.toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED' });
    readSpy.mockResolvedValueOnce({ rows: [] });
    await expect(approvalQueries.processApprovalAction('missing', { action: 'REJECT' })).resolves.toBeNull();

    db.batch.mockRejectedValueOnce(new Error('D1 offline'));
    await expect(approvalQueries.processApprovalAction('d1-1', { action: 'REJECT' }))
      .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  });

  test('approval controller surfaces storage and decision conflicts as actionable statuses', async () => {
    jest.spyOn(approvalQueries, 'getApprovalSummary').mockRejectedValue({ code: 'PERSISTENCE_UNAVAILABLE' });
    const unavailable = await request(app).get('/api/approvals/summary').set(authHeader('admin'));
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.retryable).toBe(true);

    jest.spyOn(approvalQueries, 'processApprovalAction').mockRejectedValue({ code: 'APPROVAL_ALREADY_DECIDED' });
    const conflict = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set(authHeader('admin'))
      .send({ action: 'APPROVE' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.retryable).toBe(false);
  });

  test('approvalController directly tests extractActor branches and query variations', async () => {
    const approvalController = require('../src/controllers/approvalController');
    const resetCreditApproval = () => {
      const creditApproval = approvalQueries.memoryApprovals.find((item) => item.id === 'appr-cred-101');
      creditApproval.status = 'Pending';
    };

    // 1. req.user with uuid, fullName, email, role
    let jsonResult = null;
    const resMock = { json: (val) => { jsonResult = val; return resMock; }, status: () => resMock };
    resetCreditApproval();
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
    resetCreditApproval();
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
    resetCreditApproval();
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
    resetCreditApproval();
    await approvalController.processAction(
      {
        params: { id: 'appr-cred-101' },
        body: { action: 'APPROVE' },
        user: {},
      },
      resMock
    );
    expect(jsonResult.success).toBe(true);

    // Authenticated route handlers normally set req.user, while internal direct callers can supply headers.
    resetCreditApproval();
    await approvalController.processAction(
      {
        params: { id: 'appr-cred-101' },
        body: { action: 'APPROVE' },
        headers: { 'x-user-name': 'Manual Reviewer', 'x-user-email': 'manual@example.com' },
      },
      resMock
    );
    expect(jsonResult.success).toBe(true);

    resetCreditApproval();
    await approvalController.processAction(
      { params: { id: 'appr-cred-101' }, body: { action: 'APPROVE' }, headers: {} },
      resMock
    );
    expect(jsonResult.success).toBe(true);

    // 5. getApprovals with no params
    await approvalController.getApprovals({ query: {} }, resMock);
    expect(jsonResult.success).toBe(true);
    await approvalController.getApprovals({ query: { limit: '10', offset: '3' } }, resMock);
    expect(jsonResult.limit).toBe(10);
    expect(jsonResult.offset).toBe(3);

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
    resetCreditApproval();
    await approvalQueries.processApprovalAction('appr-cred-101', { action: '' });
    resetCreditApproval();
    await approvalQueries.processApprovalAction('appr-cred-101', { action: 'APPROVE' }, { email: 'only@x.com' });
    resetCreditApproval();
    await approvalQueries.processApprovalAction('appr-cred-101', { action: 'APPROVE' }, {});
  });
});


const request = require('supertest');
const app = require('../src/app');
const approvalQueries = require('../src/db/approvalQueries');
const pool = require('../src/db/pool');
const { authHeader } = require('./testHelpers');
const { resetD1HttpClientCache } = require('../src/db/d1Bridge');
const { logger } = require('../src/services/loggerService');

const initialMemoryApprovals = JSON.parse(JSON.stringify(approvalQueries.memoryApprovals));
const TEST_APPROVER_PASSWORD = 'test-only-approver-secret';
const originalApproverPassword = process.env.APPROVER_PASSWORD;
const withApprovalCredentials = (payload = {}) => ({
  password: TEST_APPROVER_PASSWORD,
  approverName: 'Srinu Sir',
  ...payload,
});

describe('Approvals API & Controller', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.APPROVER_PASSWORD = TEST_APPROVER_PASSWORD;
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
    if (originalApproverPassword === undefined) delete process.env.APPROVER_PASSWORD;
    else process.env.APPROVER_PASSWORD = originalApproverPassword;
    resetD1HttpClientCache();
  });

  test('approval builder supplies defaults when called without input or actor', () => {
    const prepared = approvalQueries.prepareApprovalCreate();

    expect(prepared.item).toMatchObject({
      module: 'Buyer Credit Addition',
      request_type: 'Buyer Credit Addition',
      maker_name: 'Category Manager',
      maker_role: 'Category Manager',
      status: 'Pending',
      internal_task_id: null,
    });
    expect(prepared.statement.text).toContain('INSERT INTO approvals');
    expect(prepared.statement.params[0]).toBe(prepared.item.id);
  });

  test('looks up an approval by id in memory or configured storage and reports lookup failures', async () => {
    expect(await approvalQueries.getApprovalById('')).toBeNull();

    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    expect(await approvalQueries.getApprovalById('appr-cred-101')).toMatchObject({ id: 'appr-cred-101' });
    expect(await approvalQueries.getApprovalById('missing-approval')).toBeNull();

    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{
        id: 'approval-db-lookup',
        request_number: 'REQ-LOOKUP-1',
        module: 'Seller Credit Addition',
        raw: JSON.stringify({ seller_id: 'seller-lookup', internal_task_id: 'task-lookup' }),
      }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('approval lookup offline'));
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

    try {
      await expect(approvalQueries.getApprovalById('approval-db-lookup')).resolves.toMatchObject({
        id: 'approval-db-lookup',
        seller_id: 'seller-lookup',
        internal_task_id: 'task-lookup',
      });
      await expect(approvalQueries.getApprovalById('missing-db-approval')).resolves.toBeNull();
      await expect(approvalQueries.getApprovalById('failed-db-approval')).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Management approval persistence operation failed'), expect.objectContaining({
        operation: 'get-approval-by-id',
      }), 'APPROVAL_PERSISTENCE');
    } finally {
      errorSpy.mockRestore();
    }
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
      .send(withApprovalCredentials({ action: 'APPROVE' }));
    expect(notFoundRes.status).toBe(404);

    // Success approval
    const okRes = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set(authHeader('admin'))
      .set('x-user-name', 'Sudheer Kangala')
      .send(withApprovalCredentials({ action: 'APPROVE', remarks: 'Granted 100 extra free credits for RFQs.', approverName: 'Srinu Sir' }));
    expect(okRes.status).toBe(200);
    expect(okRes.body.success).toBe(true);
    expect(okRes.body.data.status).toBe('Approved');

    // Success rejection
    const rejectRes = await request(app)
      .post('/api/approvals/appr-acct-102/action')
      .set(authHeader('category_manager'))
      .set('x-user-name', 'Sudheer Kangala')
      .send(withApprovalCredentials({ action: 'REJECT', remarks: 'Invalid business documentation.' }));
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
      .send(withApprovalCredentials({ action: 'APPROVE' }));
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
      withApprovalCredentials({ action: 'APPROVE', remarks: 'Extended 30 days' }),
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
      'appr-trial-104', withApprovalCredentials({ action: 'REJECT' }), {}
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
    expect(listed).toMatchObject({
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
      'REQ-DB-1', withApprovalCredentials({ action: 'APPROVE', remarks: 'Approved' }),
      { uuid: 'admin-1', name: 'Admin', email: 'admin@example.com' }
    )).resolves.toEqual(saved);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(clientQuery.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(clientQuery.mock.calls[1][0]).toContain('RETURNING *');
    expect(clientQuery.mock.calls[2][0]).toContain('INSERT INTO management_approval_events');
  });

  test('PostgreSQL rejects missing or already decided records without writing an event', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
    jest.spyOn(pool, 'withTransaction').mockImplementation((callback) => callback({
      query: jest.fn().mockResolvedValueOnce({ rows: [] }),
    }));
    await expect(approvalQueries.processApprovalAction('missing', withApprovalCredentials({ action: 'REJECT' }))).resolves.toBeNull();

    const clientQuery = jest.fn().mockResolvedValueOnce({ rows: [{ id: 'db-1', status: 'Approved' }] });
    pool.withTransaction.mockImplementation((callback) => callback({ query: clientQuery }));
    await expect(approvalQueries.processApprovalAction('db-1', withApprovalCredentials({ action: 'REJECT' })))
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
      'REQ-D1-1', withApprovalCredentials({ action: 'REJECT', remarks: 'Declined' }), { name: 'Manager' }
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
    const readSpy = jest.spyOn(pool, 'query')
      .mockResolvedValue({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'd1-1', status: 'Approved' }] });
    await expect(approvalQueries.processApprovalAction('d1-1', withApprovalCredentials({ action: 'REJECT' })))
      .rejects.toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED' });
    readSpy.mockResolvedValueOnce({ rows: [] });
    await expect(approvalQueries.processApprovalAction('missing', withApprovalCredentials({ action: 'REJECT' }))).resolves.toBeNull();

    db.batch.mockRejectedValueOnce(new Error('D1 offline'));
    await expect(approvalQueries.processApprovalAction('d1-1', withApprovalCredentials({ action: 'REJECT' })))
      .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  });

  test('approval controller surfaces storage and decision conflicts as actionable statuses', async () => {
    jest.spyOn(approvalQueries, 'getApprovalSummary').mockRejectedValue({ code: 'PERSISTENCE_UNAVAILABLE' });
    const unavailable = await request(app).get('/api/approvals/summary').set(authHeader('admin'));
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.retryable).toBe(true);

    const actionSpy = jest.spyOn(approvalQueries, 'processApprovalAction')
      .mockRejectedValue({ code: 'APPROVAL_ALREADY_DECIDED' });
    const conflict = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set(authHeader('admin'))
      .send(withApprovalCredentials({ action: 'APPROVE' }));
    expect(conflict.status).toBe(409);
    expect(conflict.body.retryable).toBe(false);
    actionSpy.mockRestore();
  });

  test('approval actions require a configured secret and reject invalid approver credentials', async () => {
    const constants = require('../src/config/constants');
    expect(constants.isApproverPasswordConfigured('Srinu Sir')).toBe(true);
    expect(constants.verifyApproverPassword('Srinu Sir', TEST_APPROVER_PASSWORD)).toBe(true);
    expect(constants.verifyApproverPassword('Srinu Sir', 'incorrect')).toBe(false);
    expect(constants.verifyApproverPassword('Unknown Approver', TEST_APPROVER_PASSWORD)).toBe(false);

    const badPassword = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set(authHeader('admin'))
      .send(withApprovalCredentials({ action: 'APPROVE', password: 'incorrect' }));
    expect(badPassword.status).toBe(401);

    delete process.env.APPROVER_PASSWORD;
    const unconfigured = await request(app)
      .post('/api/approvals/appr-cred-101/action')
      .set(authHeader('admin'))
      .send(withApprovalCredentials({ action: 'APPROVE' }));
    expect(unconfigured.status).toBe(503);
    process.env.APPROVER_PASSWORD = TEST_APPROVER_PASSWORD;
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
        body: withApprovalCredentials({ action: 'APPROVE', remarks: 'Good' }),
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
        body: withApprovalCredentials({ action: 'REJECT' }),
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
        body: withApprovalCredentials({ action: 'APPROVE' }),
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
        body: withApprovalCredentials({ action: 'APPROVE' }),
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
        body: withApprovalCredentials({ action: 'APPROVE' }),
        headers: { 'x-user-name': 'Manual Reviewer', 'x-user-email': 'manual@example.com' },
      },
      resMock
    );
    expect(jsonResult.success).toBe(true);

    resetCreditApproval();
    await approvalController.processAction(
      { params: { id: 'appr-cred-101' }, body: withApprovalCredentials({ action: 'APPROVE' }), headers: {} },
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
    await approvalQueries.processApprovalAction('appr-cred-101', withApprovalCredentials({ action: '' }));
    resetCreditApproval();
    await approvalQueries.processApprovalAction('appr-cred-101', withApprovalCredentials({ action: 'APPROVE' }), { email: 'only@x.com' });
    resetCreditApproval();
    await approvalQueries.processApprovalAction('appr-cred-101', withApprovalCredentials({ action: 'APPROVE' }), {});

    // 8. test limit and offset numeric branches in controller
    await approvalController.getApprovals({ query: { limit: '10', offset: '5' } }, resMock);
    expect(jsonResult.limit).toBe(10);
    expect(jsonResult.offset).toBe(5);
  });

  test('approvalQueries with pool.hasStorage() covers SQL query, hydration, createApproval, and internal task linkage', async () => {
    const internalTaskQueries = require('../src/db/internalTaskQueries');
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

    // 1. getApprovals with SQL storage
    const fakeRow = {
      id: 'appr-db-1',
      request_number: 'REQ-DB-001',
      module: 'Buyer Credit Addition',
      project: 'Project Alpha',
      applicant_name: 'Alpha Buyer',
      applicant_email: 'buyer@alpha.com',
      value_impact: '₹1,00,000 (50 Credits)',
      maker_name: 'Manager Bob',
      maker_role: 'Category Specialist',
      approver_name: 'Srinu Sir',
      status: 'Pending',
      details: 'Quarterly top up',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      raw: JSON.stringify({
        request_type: 'Buyer Credit Addition',
        amount: 100000,
        quantity: 50,
        available_balance: 10,
        assigned_approver: 'Srinu Sir',
        internal_task_id: 'tsk-credit-1',
        buyer_id: 'b-alpha-1',
        history: [{ action: 'SUBMITTED', timestamp: new Date().toISOString() }],
        attachments: [{ name: 'file.pdf', url: '/f.pdf' }],
      }),
    };

    const querySpy = jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ ...fakeRow, total: '1' }] });

    const sqlApprovals = await approvalQueries.getApprovals({
      module: 'Buyer Credit Addition',
      status: 'Pending',
      project: 'Project Alpha',
      assigned_approver: 'Srinu Sir',
      search: 'Alpha',
      sortBy: 'module',
      sortOrder: 'asc',
      limit: 10,
      offset: 0,
    });
    expect(sqlApprovals.total).toBe(1);
    expect(sqlApprovals.rows[0].request_number).toBe('REQ-DB-001');
    expect(sqlApprovals.rows[0].amount).toBe(100000);

    // Total == 0 branch
    querySpy
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });
    const emptySql = await approvalQueries.getApprovals({ module: 'Packages' });
    expect(emptySql.total).toBe(0);

    // Database read errors fail closed instead of returning stale memory data.
    querySpy.mockRejectedValueOnce(new Error('SQL failure in getApprovals'));
    await expect(approvalQueries.getApprovals()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });

    // 2. createApproval with storage
    querySpy.mockResolvedValueOnce({ rowCount: 1 });
    const createdItem = await approvalQueries.createApproval({
      request_type: 'Buyer Credit Addition',
      project: 'Tata Steel',
      applicant_name: 'Tata Steel',
      amount: 50000,
      quantity: 20,
      internal_task_id: 'task-link-99',
      buyer_id: 'buyer-99',
      attachments: [{ name: 'doc.pdf' }],
      history: [{ action: 'SUBMITTED' }],
    }, { name: 'Maker', role: 'Executive' });
    expect(createdItem.id).toBeDefined();

    // A configured database error must not return a phantom in-memory approval.
    const insertError = new Error('Insert table missing');
    const errorLogSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    querySpy.mockRejectedValueOnce(insertError);
    await expect(approvalQueries.createApproval({
      applicant_name: 'Safe',
    })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      cause: insertError,
    });
    expect(approvalQueries.memoryApprovals.some((approval) => approval.applicant_name === 'Safe')).toBe(false);
    expect(errorLogSpy).toHaveBeenCalledWith(
      'Management approval persistence operation failed',
      expect.objectContaining({ error: insertError, operation: 'create-approval' }),
      'APPROVAL_PERSISTENCE'
    );

    // 3. processApprovalAction with database record and internal task linkage
    jest.spyOn(internalTaskQueries, 'approveCreditTask').mockResolvedValue({ success: true });
    jest.spyOn(internalTaskQueries, 'rejectCreditTask').mockResolvedValue({ success: true });

    // Database record found inside the PostgreSQL transaction (APPROVE with internal task).
    const transactionSpy = jest.spyOn(pool, 'withTransaction');
    const approvedRow = { ...fakeRow, status: 'Approved' };
    const rejectedRow = { ...fakeRow, status: 'Rejected' };
    const transactionFor = () => (callback) => callback({
      query: jest.fn().mockResolvedValueOnce({ rows: [] }),
    });
    transactionSpy.mockImplementationOnce(transactionFor());
    querySpy
      .mockResolvedValueOnce({ rows: [fakeRow] })
      .mockResolvedValueOnce({ rows: [approvedRow] });
    const approvedDb = await approvalQueries.processApprovalAction('appr-db-1', {
      action: 'APPROVE',
      remarks: 'Approved in DB',
      password: TEST_APPROVER_PASSWORD,
      approverName: 'Srinu Sir',
    }, { name: 'Director' });
    expect(approvedDb.status).toBe('Approved');
    expect(internalTaskQueries.approveCreditTask).toHaveBeenCalledWith(
      'tsk-credit-1',
      expect.objectContaining({ name: 'Director' }),
      'Approved in DB'
    );

    // Database record found (REJECT with internal task)
    transactionSpy.mockImplementationOnce(transactionFor());
    querySpy
      .mockResolvedValueOnce({ rows: [fakeRow] })
      .mockResolvedValueOnce({ rows: [rejectedRow] });
    const rejectedDb = await approvalQueries.processApprovalAction('appr-db-1', {
      action: 'REJECT',
      remarks: 'Rejected in DB',
      password: TEST_APPROVER_PASSWORD,
      approverName: 'Srinu Sir',
    }, { name: 'Director' });
    expect(rejectedDb.status).toBe('Rejected');
    expect(internalTaskQueries.rejectCreditTask).toHaveBeenCalledWith(
      'tsk-credit-1',
      expect.objectContaining({ name: 'Director' }),
      'Rejected in DB'
    );

    // Database record with internal task error (non-fatal)
    jest.spyOn(internalTaskQueries, 'approveCreditTask').mockRejectedValueOnce(new Error('Internal task sync err'));
    transactionSpy.mockImplementationOnce(transactionFor());
    querySpy
      .mockResolvedValueOnce({ rows: [fakeRow] })
      .mockResolvedValueOnce({ rows: [approvedRow] });
    const safeSync = await approvalQueries.processApprovalAction('appr-db-1', {
      action: 'APPROVE',
      password: TEST_APPROVER_PASSWORD,
      approverName: 'Srinu Sir',
    }, { name: 'Director' });
    expect(safeSync.status).toBe('Approved');

    // A durable miss must not act on a stale in-memory approval.
    transactionSpy.mockImplementationOnce(transactionFor());
    querySpy.mockResolvedValueOnce({ rows: [] });
    await expect(approvalQueries.processApprovalAction('appr-cred-101', withApprovalCredentials({
      action: 'APPROVE',
    }))).resolves.toBeNull();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    await approvalQueries.processApprovalAction('appr-cred-101', withApprovalCredentials({ action: '' }));
    approvalQueries.memoryApprovals.find((item) => item.id === 'appr-cred-101').status = 'Pending';
    await approvalQueries.processApprovalAction('appr-cred-101', withApprovalCredentials({ action: 'APPROVE' }), { email: 'only@x.com' });
    approvalQueries.memoryApprovals.find((item) => item.id === 'appr-cred-101').status = 'Pending';
    await approvalQueries.processApprovalAction('appr-cred-101', withApprovalCredentials({ action: 'APPROVE' }), {});
  });

  test('approvalQueries exhaustive branch coverage for memory filtering, hydration, and actions', async () => {
    await approvalQueries.createApproval({
      request_number: 'REQ-FILTER-1',
      applicant_name: 'Filter Applicant One',
      applicant_email: 'filter1@test.com',
      maker_name: 'Maker Alpha',
      project: 'Filter Project',
      value_impact: '999 INR',
      details: 'Special search token unique_detail_token',
      assigned_approver: 'Specific Approver X',
      approver_name: 'Specific Approver X',
      status: 'Pending',
    });

    await approvalQueries.createApproval({
      request_number: 'REQ-FILTER-2',
      applicant_name: 'Filter Applicant Two',
      applicant_email: 'filter2@test.com',
      maker_name: 'Maker Beta',
      project: 'Filter Project',
      value_impact: '888 INR',
      details: 'Other detail',
      assigned_approver: 'Other Person',
      approver_name: 'Specific Approver X',
      status: 'Approved',
    });

    const approverRes = await approvalQueries.getApprovals({ assigned_approver: 'Specific Approver X' });
    expect(approverRes.rows.length).toBeGreaterThanOrEqual(1);

    const searchNumber = await approvalQueries.getApprovals({ search: 'REQ-FILTER-1' });
    expect(searchNumber.rows.length).toBeGreaterThanOrEqual(1);
    const searchEmail = await approvalQueries.getApprovals({ search: 'filter1@test.com' });
    expect(searchEmail.rows.length).toBeGreaterThanOrEqual(1);
    const searchMaker = await approvalQueries.getApprovals({ search: 'Maker Alpha' });
    expect(searchMaker.rows.length).toBeGreaterThanOrEqual(1);
    const searchProject = await approvalQueries.getApprovals({ search: 'Filter Project' });
    expect(searchProject.rows.length).toBeGreaterThanOrEqual(1);
    const searchImpact = await approvalQueries.getApprovals({ search: '999 INR' });
    expect(searchImpact.rows.length).toBeGreaterThanOrEqual(1);
    const searchApprover = await approvalQueries.getApprovals({ search: 'Specific Approver X' });
    expect(searchApprover.rows.length).toBeGreaterThanOrEqual(1);
    const searchDetail = await approvalQueries.getApprovals({ search: 'unique_detail_token' });
    expect(searchDetail.rows.length).toBeGreaterThanOrEqual(1);

    const sortEqualRes = await approvalQueries.getApprovals({
      project: 'Filter Project',
      sortBy: 'project',
      sortOrder: 'asc',
    });
    expect(sortEqualRes.rows.length).toBeGreaterThanOrEqual(2);

    const sortDescRes = await approvalQueries.getApprovals({
      sortBy: 'value_impact',
      sortOrder: 'desc',
    });
    expect(sortDescRes.rows.length).toBeGreaterThanOrEqual(1);

    const sortAscRes = await approvalQueries.getApprovals({
      sortBy: 'value_impact',
      sortOrder: 'asc',
    });
    expect(sortAscRes.rows.length).toBeGreaterThanOrEqual(1);

    const allFiltersRes = await approvalQueries.getApprovals({
      module: 'all',
      project: 'all',
      status: 'all',
    });
    expect(allFiltersRes.rows.length).toBeGreaterThanOrEqual(1);

    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const notFoundAction = await approvalQueries.processApprovalAction('totally-missing-id', withApprovalCredentials({ action: 'APPROVE' }));
    expect(notFoundAction).toBeNull();

    const nonCredit = await approvalQueries.createApproval({
      module: 'General Hardware',
      request_type: 'General Hardware',
      project: 'Hardware',
      internal_task_id: null,
      buyer_id: null,
    });
    const processedNonCredit = await approvalQueries.processApprovalAction(nonCredit.id, {
      action: 'APPROVE',
      remarks: 'Standard hardware signoff',
      password: TEST_APPROVER_PASSWORD,
      approverName: 'Srinu Sir',
    });
    expect(processedNonCredit.status).toBe('Approved');

    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'withTransaction').mockRejectedValueOnce(new Error('Update failed'));
    await expect(approvalQueries.processApprovalAction(nonCredit.id, {
      action: 'REJECT',
      remarks: 'Rejected hardware signoff',
      password: TEST_APPROVER_PASSWORD,
      approverName: 'Srinu Sir',
    })).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });

    // Database getSummary branch coverage
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockResolvedValueOnce({
      rows: [{ total: '10', pending: '4', approved: '5', rejected: '1' }],
    });
    const dbSummary = await approvalQueries.getApprovalSummary();
    expect(dbSummary.total).toBe(10);
    expect(dbSummary.pending).toBe(4);

    jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [] });
    const emptySummary = await approvalQueries.getApprovalSummary();
    expect(emptySummary.total).toBe(0);

    jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('Summary error'));
    await expect(approvalQueries.getApprovalSummary()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });

    // Database getApprovals with minimal row hydration
    const minimalRow = {
      id: 'appr-min-1',
      request_number: null,
      module: null,
      project: null,
      applicant_name: null,
      applicant_email: null,
      value_impact: null,
      maker_name: null,
      maker_role: null,
      status: null,
      details: null,
      approver_name: null,
      approver_remarks: null,
      created_at: null,
      updated_at: null,
      raw: '{}',
    };
    const minimalRowStringRaw = {
      id: 'appr-min-2',
      raw: '{"amount": 100}',
    };
    const minimalRowObjectRaw = {
      id: 'appr-min-3',
      raw: { amount: 200 },
    };

    jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: [
      { ...minimalRow, total: '3' },
      { ...minimalRowStringRaw, total: '3' },
      { ...minimalRowObjectRaw, total: '3' },
    ] });

    const dbMinimal = await approvalQueries.getApprovals({
      status: 'pending',
      project: 'General',
      assigned_approver: 'Approver',
      search: 'term',
      sortBy: 'request_number',
      sortOrder: 'desc',
    });
    expect(dbMinimal.rows.length).toBe(3);
    expect(dbMinimal.rows[0].module).toBe('Buyer Credit Addition');
    expect(dbMinimal.rows[0].status).toBe('Pending');

    // Credit addition without internal task id and with null history
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const creditNoTask = await approvalQueries.createApproval({
      module: 'Buyer Credit Addition',
      internal_task_id: null,
      history: null,
    });
    creditNoTask.history = null;
    const approvedNoTask = await approvalQueries.processApprovalAction(creditNoTask.id, {
      action: 'APPROVE',
      password: TEST_APPROVER_PASSWORD,
      approverName: 'Srinu Sir',
    });
    expect(approvedNoTask.status).toBe('Approved');
    expect(approvedNoTask.history.length).toBe(1);
    expect(approvalQueries.hydrateApprovalRow(null)).toBeNull();
    const h1 = approvalQueries.hydrateApprovalRow({ id: 'h1' });
    expect(h1.status).toBe('Pending');
    expect(h1.maker_name).toBe('Category Manager');
    const h2 = approvalQueries.hydrateApprovalRow({ id: 'h2', raw: '{"request_type": "Custom Type", "amount": 42}' });
    expect(h2.request_type).toBe('Custom Type');
    expect(h2.amount).toBe(42);
    const h3 = approvalQueries.hydrateApprovalRow({ id: 'h3', raw: 'invalid-json' });
    expect(h3.id).toBe('h3');


  });

});

describe('Approval Email OTP Verification', () => {
  const authSessionQueries = require('../src/db/authSessionQueries');
  const mailerService = require('../src/services/mailerService');
  const constants = require('../src/config/constants');
  const approvalController = require('../src/controllers/approvalController');

  afterEach(async () => {
    jest.restoreAllMocks();
    await authSessionQueries.deleteOtp('approval_otp:srinivas.mukku@procucev.com').catch(() => {});
    await authSessionQueries.deleteOtp('approval_otp:sudheer.kangala@procucev.com').catch(() => {});
  });

  test('constants resolve approvers, OTP key, and numeric OTP generation safely', () => {
    expect(constants.resolveApproverConfig('Srinu Sir').email).toBe('srinivas.mukku@procucev.com');
    expect(constants.resolveApproverConfig('sudheer').email).toBe('sudheer.kangala@procucev.com');
    expect(constants.resolveApproverConfig('Unknown Person')).toBeNull();
    expect(constants.isApproverPasswordConfigured('Unknown')).toBe(false);
    expect(constants.verifyApproverPassword('Unknown', 'secret')).toBe(false);

    const defaultOtp = constants.generateNumericOtp();
    expect(defaultOtp).toMatch(/^\d{6}$/);
    const customOtp = constants.generateNumericOtp(4);
    expect(customOtp).toMatch(/^\d{4}$/);

    expect(approvalQueries.buildApprovalOtpKey('Srinivas.Mukku@procucev.com')).toBe(
      'approval_otp:srinivas.mukku@procucev.com'
    );
    expect(approvalQueries.buildApprovalOtpKey('')).toBe('approval_otp:');
  });

  test('requestApprovalOtp dispatches 6-digit OTP emails to configured approver addresses without exposing code', async () => {
    const poolMod = require('../src/db/pool');
    jest.spyOn(poolMod, 'hasStorage').mockReturnValue(false);
    const mailSpy = jest
      .spyOn(mailerService, 'sendOtpEmail')
      .mockResolvedValue({ sent: true, messageId: 'msg-approval-1' });

    const srinuResult = await approvalQueries.requestApprovalOtp(
      'Srinu Sir',
      { email: 'cm@procucev.com', role: 'category_manager' },
      '127.0.0.1'
    );
    expect(srinuResult).toEqual({
      success: true,
      approverName: 'Srinu Sir',
      email: 'srinivas.mukku@procucev.com',
      expiresInSeconds: constants.APPROVAL_OTP_CONFIG.OTP_TTL_SECONDS,
      message: constants.APPROVAL_MESSAGES.OTP_SENT.replace('{email}', 'srinivas.mukku@procucev.com'),
    });
    expect(srinuResult.otp).toBeUndefined();
    expect(srinuResult.demoCode).toBeUndefined();
    expect(mailSpy).toHaveBeenCalledWith(
      'srinivas.mukku@procucev.com',
      expect.stringMatching(/^\d{6}$/),
      constants.APPROVAL_OTP_CONFIG.OTP_TTL_SECONDS,
      expect.objectContaining({ approverName: 'Srinu Sir' })
    );

    mailSpy.mockResolvedValueOnce({ sent: false, reason: 'test environment' });
    const sudheerResult = await approvalQueries.requestApprovalOtp('Sudheer Sir');
    expect(sudheerResult.success).toBe(true);
    expect(sudheerResult.email).toBe('sudheer.kangala@procucev.com');
  });

  test('requestApprovalOtp rejects unknown approver, storage outage, and SMTP failures', async () => {
    await expect(approvalQueries.requestApprovalOtp('Nobody')).rejects.toMatchObject({
      code: 'APPROVER_UNKNOWN',
    });

    const saveSpy = jest
      .spyOn(authSessionQueries, 'saveOtp')
      .mockRejectedValueOnce(new Error('DB write failure'));
    await expect(approvalQueries.requestApprovalOtp('Srinu Sir')).rejects.toMatchObject({
      code: 'APPROVAL_OTP_STORAGE_FAILED',
    });

    const unavailErr = new Error('Storage down');
    unavailErr.code = 'PERSISTENCE_UNAVAILABLE';
    saveSpy.mockRejectedValueOnce(unavailErr);
    await expect(approvalQueries.requestApprovalOtp('Srinu Sir')).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
    saveSpy.mockRestore();

    jest.spyOn(authSessionQueries, 'saveOtp').mockResolvedValue({ ok: true });
    const mailSpy = jest
      .spyOn(mailerService, 'sendOtpEmail')
      .mockResolvedValueOnce({ sent: false, reason: 'SMTP not configured' });
    await expect(approvalQueries.requestApprovalOtp('Sudheer Sir')).rejects.toMatchObject({
      code: 'APPROVAL_OTP_DELIVERY_FAILED',
    });

    mailSpy.mockRejectedValueOnce(new Error('SMTP socket timeout'));
    await expect(approvalQueries.requestApprovalOtp('Sudheer Sir')).rejects.toMatchObject({
      code: 'APPROVAL_OTP_DELIVERY_FAILED',
    });
  });

  test('processApprovalAction verifies Email OTP independently of APPROVER_PASSWORD configuration', async () => {
    const poolMod = require('../src/db/pool');
    jest.spyOn(poolMod, 'hasStorage').mockReturnValue(false);
    const savedEnv = {
      APPROVER_PASSWORD: process.env.APPROVER_PASSWORD,
      SRINU_APPROVER_PASSWORD: process.env.SRINU_APPROVER_PASSWORD,
      SUDHEER_APPROVER_PASSWORD: process.env.SUDHEER_APPROVER_PASSWORD,
    };
    delete process.env.APPROVER_PASSWORD;
    delete process.env.SRINU_APPROVER_PASSWORD;
    delete process.env.SUDHEER_APPROVER_PASSWORD;

    try {
      const approval = await approvalQueries.createApproval({
        request_type: 'Seller Credit Addition',
        module: 'Seller Credit Addition',
        assigned_approver: 'Sudheer Sir',
      });

      await expect(
        approvalQueries.processApprovalAction(approval.id, {
          action: 'APPROVE',
          approverName: 'Sudheer Sir',
        })
      ).rejects.toMatchObject({ code: 'APPROVAL_CREDENTIALS_REQUIRED' });

      await expect(
        approvalQueries.processApprovalAction(approval.id, {
          action: 'APPROVE',
          approverName: 'Sudheer Sir',
          otpCode: '12ab',
        })
      ).rejects.toMatchObject({ code: 'APPROVAL_OTP_INVALID' });

      await expect(
        approvalQueries.processApprovalAction(approval.id, {
          action: 'APPROVE',
          approverName: 'Unknown Person',
          otpCode: '123456',
        })
      ).rejects.toMatchObject({ code: 'APPROVER_UNKNOWN' });

      await expect(
        approvalQueries.processApprovalAction(approval.id, {
          action: 'APPROVE',
          approverName: 'Sudheer Sir',
          otpCode: '123456',
        })
      ).rejects.toMatchObject({ code: 'APPROVAL_OTP_INVALID' });

      const mailSpy = jest
        .spyOn(mailerService, 'sendOtpEmail')
        .mockResolvedValue({ sent: true, messageId: 'msg-2' });
      await approvalQueries.requestApprovalOtp('Sudheer Sir', { email: 'maker@procucev.com' });
      const sentOtp = mailSpy.mock.calls[0][1];

      // Wrong OTP increments attempts
      await expect(
        approvalQueries.processApprovalAction(approval.id, {
          action: 'APPROVE',
          approverName: 'Sudheer Sir',
          otpCode: sentOtp === '000000' ? '111111' : '000000',
        })
      ).rejects.toMatchObject({ code: 'APPROVAL_OTP_INVALID' });

      // Valid OTP succeeds without APPROVER_PASSWORD configured and invalidates OTP
      const approved = await approvalQueries.processApprovalAction(approval.id, {
        action: 'APPROVE',
        remarks: 'Verified via Sudheer email OTP',
        approverName: 'Sudheer Sir',
        otpCode: sentOtp,
      });
      expect(approved.status).toBe('Approved');

      // Reusing same OTP is rejected
      const secondApproval = await approvalQueries.createApproval({ assigned_approver: 'Sudheer Sir' });
      await expect(
        approvalQueries.processApprovalAction(secondApproval.id, {
          action: 'APPROVE',
          approverName: 'Sudheer Sir',
          otpCode: sentOtp,
        })
      ).rejects.toMatchObject({ code: 'APPROVAL_OTP_INVALID' });

      // Expired OTP and max-attempt OTP
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValueOnce({
        code: '654321',
        expiresAt: Date.now() - 10_000,
        attempts: 0,
      });
      await expect(
        approvalQueries.processApprovalAction(secondApproval.id, {
          action: 'REJECT',
          approverName: 'Sudheer Sir',
          otpCode: '654321',
        })
      ).rejects.toMatchObject({ code: 'APPROVAL_OTP_EXPIRED' });

      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValueOnce({
        code: '654321',
        expiresAt: Date.now() + 60_000,
        attempts: constants.APPROVAL_OTP_CONFIG.MAX_OTP_ATTEMPTS,
      });
      await expect(
        approvalQueries.processApprovalAction(secondApproval.id, {
          action: 'REJECT',
          approverName: 'Sudheer Sir',
          otpCode: '654321',
        })
      ).rejects.toMatchObject({ code: 'APPROVAL_OTP_MAX_ATTEMPTS' });

      // Unequal length otpCode
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValueOnce({
        code: '654',
        expiresAt: Date.now() + 60_000,
        attempts: 0,
      });
      await expect(
        approvalQueries.processApprovalAction(secondApproval.id, {
          action: 'REJECT',
          approverName: 'Sudheer Sir',
          otpCode: '654321',
        })
      ).rejects.toMatchObject({ code: 'APPROVAL_OTP_INVALID' });
    } finally {
      Object.entries(savedEnv).forEach(([k, v]) => {
        if (v !== undefined) process.env[k] = v;
        else delete process.env[k];
      });
    }
  });

  test('POST /api/approvals/request-otp and OTP errors on /:id/action return proper HTTP statuses', async () => {
    const headers = authHeader('category_manager');

    const invalidRes = await request(app)
      .post('/api/approvals/request-otp')
      .set(headers)
      .send({});
    expect(invalidRes.status).toBe(400);

    const storageErr = new Error('Storage down');
    storageErr.code = 'APPROVAL_OTP_STORAGE_FAILED';
    const otpSpy = jest
      .spyOn(approvalQueries, 'requestApprovalOtp')
      .mockRejectedValueOnce(storageErr);
    const storageRes = await request(app)
      .post('/api/approvals/request-otp')
      .set(headers)
      .send({ approverName: 'Srinu Sir' });
    expect(storageRes.status).toBe(503);
    expect(storageRes.body.retryable).toBe(true);

    const deliveryErr = new Error('SMTP down');
    deliveryErr.code = 'APPROVAL_OTP_DELIVERY_FAILED';
    otpSpy.mockRejectedValueOnce(deliveryErr);
    const deliveryRes = await request(app)
      .post('/api/approvals/request-otp')
      .set(headers)
      .send({ approverName: 'Srinu Sir' });
    expect(deliveryRes.status).toBe(503);

    otpSpy.mockRejectedValueOnce(new Error('Unexpected crash'));
    const crashRes = await request(app)
      .post('/api/approvals/request-otp')
      .set(headers)
      .send({ approverName: 'Srinu Sir' });
    expect(crashRes.status).toBe(500);

    otpSpy.mockResolvedValueOnce({
      success: true,
      approverName: 'Srinu Sir',
      email: 'srinivas.mukku@procucev.com',
      expiresInSeconds: 300,
      message: constants.APPROVAL_MESSAGES.OTP_SENT.replace('{email}', 'srinivas.mukku@procucev.com'),
    });
    const okRes = await request(app)
      .post('/api/approvals/request-otp')
      .set(headers)
      .send({ approverName: 'Srinu Sir' });
    expect(okRes.status).toBe(200);
    expect(okRes.body.email).toBe('srinivas.mukku@procucev.com');

    // Missing both password and otpCode on /:id/action
    const noCredRes = await request(app)
      .post('/api/approvals/appr-1/action')
      .set(headers)
      .send({ action: 'APPROVE', approverName: 'Srinu Sir' });
    expect(noCredRes.status).toBe(400);
    expect(noCredRes.body.error).toBe(constants.APPROVAL_MESSAGES.CREDENTIALS_REQUIRED);

    // Direct controller check without req.ip
    const resMock = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    otpSpy.mockResolvedValueOnce({
      success: true,
      approverName: 'Sudheer Sir',
      email: 'sudheer.kangala@procucev.com',
      expiresInSeconds: 300,
      message: constants.APPROVAL_MESSAGES.OTP_SENT.replace('{email}', 'sudheer.kangala@procucev.com'),
    });
    await approvalController.requestOtp(
      { body: { approverName: 'Sudheer Sir' }, user: { email: 'cm@procucev.com', role: 'category_manager' } },
      resMock
    );
    expect(resMock.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

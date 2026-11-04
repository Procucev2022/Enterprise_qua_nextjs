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

    // SQL branches coverage for getApprovalSummary
    querySpy.mockResolvedValueOnce({ rows: [{ total: '5', pending: '2', approved: '2', rejected: '1' }] });
    const dbSummary = await approvalQueries.getApprovalSummary();
    expect(dbSummary.total).toBe(5);

    querySpy.mockResolvedValueOnce({ rows: [] });
    const emptySummary = await approvalQueries.getApprovalSummary();
    expect(emptySummary.total).toEqual(0);

    querySpy.mockRejectedValueOnce(new Error('DB err'));
    const errSummary = await approvalQueries.getApprovalSummary();
    expect(errSummary.total).toBeGreaterThanOrEqual(1);

    // SQL branch for update failure in processApprovalAction
    querySpy.mockRejectedValueOnce(new Error('Update failed'));
    await approvalQueries.processApprovalAction(
      'appr-trial-104',
      { action: 'APPROVE' },
      { email: 'admin@x.com' }
    );
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

    const querySpy = jest.spyOn(pool, 'query');

    // Total > 0 with results
    querySpy
      .mockResolvedValueOnce({ rows: [{ total: '1' }] })
      .mockResolvedValueOnce({ rows: [fakeRow] });

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
    querySpy.mockResolvedValueOnce({ rows: [{ total: '0' }] });
    const emptySql = await approvalQueries.getApprovals({ module: 'Packages' });
    expect(emptySql.total).toBe(0);

    // Exception branch in getApprovals (falls back to memory)
    querySpy.mockRejectedValueOnce(new Error('SQL failure in getApprovals'));
    const fallbackSql = await approvalQueries.getApprovals();
    expect(fallbackSql.rows.length).toBeGreaterThanOrEqual(1);

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

    // createApproval with SQL error (non-fatal)
    querySpy.mockRejectedValueOnce(new Error('Insert table missing'));
    const safeCreated = await approvalQueries.createApproval({
      applicant_name: 'Safe',
    });
    expect(safeCreated.id).toBeDefined();

    // 3. processApprovalAction with database record and internal task linkage
    jest.spyOn(internalTaskQueries, 'approveCreditTask').mockResolvedValue({ success: true });
    jest.spyOn(internalTaskQueries, 'rejectCreditTask').mockResolvedValue({ success: true });

    // Database record found via pool.query (APPROVE with internal task)
    querySpy
      .mockResolvedValueOnce({ rows: [fakeRow] }) // SELECT
      .mockResolvedValueOnce({ rowCount: 1 });   // UPDATE
    const approvedDb = await approvalQueries.processApprovalAction('appr-db-1', {
      action: 'APPROVE',
      remarks: 'Approved in DB',
    }, { name: 'Director' });
    expect(approvedDb.status).toBe('Approved');
    expect(internalTaskQueries.approveCreditTask).toHaveBeenCalledWith(
      'tsk-credit-1',
      expect.objectContaining({ name: 'Director' }),
      'Approved in DB'
    );

    // Database record found (REJECT with internal task)
    querySpy
      .mockResolvedValueOnce({ rows: [fakeRow] }) // SELECT
      .mockResolvedValueOnce({ rowCount: 1 });   // UPDATE
    const rejectedDb = await approvalQueries.processApprovalAction('appr-db-1', {
      action: 'REJECT',
      remarks: 'Rejected in DB',
    }, { name: 'Director' });
    expect(rejectedDb.status).toBe('Rejected');
    expect(internalTaskQueries.rejectCreditTask).toHaveBeenCalledWith(
      'tsk-credit-1',
      expect.objectContaining({ name: 'Director' }),
      'Rejected in DB'
    );

    // Database record with internal task error (non-fatal)
    jest.spyOn(internalTaskQueries, 'approveCreditTask').mockRejectedValueOnce(new Error('Internal task sync err'));
    querySpy
      .mockResolvedValueOnce({ rows: [fakeRow] }) // SELECT
      .mockResolvedValueOnce({ rowCount: 1 });   // UPDATE
    const safeSync = await approvalQueries.processApprovalAction('appr-db-1', {
      action: 'APPROVE',
    }, { name: 'Director' });
    expect(safeSync.status).toBe('Approved');

    // Database record not found in DB (falls back to memory)
    querySpy.mockResolvedValueOnce({ rows: [] }); // SELECT empty
    const memItem = await approvalQueries.processApprovalAction('appr-cred-101', {
      action: 'APPROVE',
    });
    expect(memItem).toBeDefined();
    await approvalQueries.processApprovalAction('appr-cred-101', { action: '' });
    await approvalQueries.processApprovalAction('appr-cred-101', { action: 'APPROVE' }, { email: 'only@x.com' });
    await approvalQueries.processApprovalAction('appr-cred-101', { action: 'APPROVE' }, {});
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
    const notFoundAction = await approvalQueries.processApprovalAction('totally-missing-id', { action: 'APPROVE' });
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
    });
    expect(processedNonCredit.status).toBe('Approved');

    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('Update failed'));
    const safeErrorAction = await approvalQueries.processApprovalAction(nonCredit.id, {
      action: 'REJECT',
      remarks: 'Rejected hardware signoff',
    });
    expect(safeErrorAction.status).toBe('Rejected');

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
    const fallbackSummary = await approvalQueries.getApprovalSummary();
    expect(fallbackSummary.total).toBeGreaterThanOrEqual(1);

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

    jest.spyOn(pool, 'query')
      .mockResolvedValueOnce({ rows: [{ total: '3' }] })
      .mockResolvedValueOnce({ rows: [minimalRow, minimalRowStringRaw, minimalRowObjectRaw] });

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
    const creditNoTask = await approvalQueries.createApproval({
      module: 'Buyer Credit Addition',
      internal_task_id: null,
      history: null,
    });
    creditNoTask.history = null;
    jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    const approvedNoTask = await approvalQueries.processApprovalAction(creditNoTask.id, {
      action: 'APPROVE',
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

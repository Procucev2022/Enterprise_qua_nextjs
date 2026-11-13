const request = require('supertest');
const app = require('../src/app');
const approvalQueries = require('../src/db/approvalQueries');
const approvalController = require('../src/controllers/approvalController');
const pool = require('../src/db/pool');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
const { logger } = require('../src/services/loggerService');
const { APPROVAL_MESSAGES } = require('../src/config/constants');
const { authHeader } = require('./testHelpers');

const APPROVER_NAME = 'Sudheer Sir';
const APPROVER_PASSWORD = 'approver-test-password';

function withApprovalCredentials(body) {
  return { ...body, approverName: APPROVER_NAME, password: APPROVER_PASSWORD };
}

function approvalRow(overrides = {}) {
  return {
    id: 'appr-db-1',
    request_number: 'REQ-DB-1',
    module: 'Credit Notes',
    project: 'Tata',
    applicant_name: 'Ravi Kumar',
    applicant_email: 'ravi@example.com',
    value_impact: 'Rs 5000',
    maker_name: 'Maker One',
    maker_role: 'buyer',
    status: 'Pending',
    details: '',
    approver_name: null,
    approver_remarks: null,
    assigned_approver: 'Sudheer Sir',
    raw: JSON.stringify({ request_type: 'Credit Notes', assigned_approver: 'Sudheer Sir', amount: 5000, history: [] }),
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const UNAVAILABLE = { code: 'PERSISTENCE_UNAVAILABLE' };

describe('Approvals API & Controller', () => {
  let previousPassword;

  beforeAll(() => {
    previousPassword = process.env.SUDHEER_APPROVER_PASSWORD;
    process.env.SUDHEER_APPROVER_PASSWORD = APPROVER_PASSWORD;
  });

  afterAll(() => {
    if (previousPassword === undefined) delete process.env.SUDHEER_APPROVER_PASSWORD;
    else process.env.SUDHEER_APPROVER_PASSWORD = previousPassword;
  });

  let querySpy;
  let transactionSpy;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    // Any query or transaction a test does not script fails loudly.
    querySpy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('Unexpected pool.query call in this test.'));
    transactionSpy = jest.spyOn(pool, 'withTransaction').mockRejectedValue(new Error('Unexpected transaction in this test.'));
    jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  function runInTransaction(client) {
    transactionSpy.mockImplementation((callback) => callback({ query: client }));
  }

  describe('prepareApprovalCreate', () => {
    it.each([
      [{}, {}, 'Approval module is required.'],
      [{ module: 'Credit Notes' }, {}, 'Approval applicant name is required.'],
      [{ module: 'Credit Notes', applicant_name: 'Ravi' }, {}, 'Approval applicant email is required.'],
      [{ module: 'Credit Notes', applicant_name: 'Ravi', applicant_email: 'r@x.com' }, {}, 'Approval maker name is required.'],
      [
        { module: 'Credit Notes', applicant_name: 'Ravi', applicant_email: 'r@x.com' },
        { fullName: 'Asha' },
        'Approval assigned approver is required.',
      ],
    ])('rejects a missing required field with the matching message (case %#)', (data, actor, message) => {
      expect(() => approvalQueries.prepareApprovalCreate(data, actor)).toThrow(message);
    });

    it('builds the insert with the actor as maker and a submitted history entry, and no invented values', () => {
      const prepared = approvalQueries.prepareApprovalCreate({
        module: 'Credit Notes',
        applicant_name: 'Ravi Kumar',
        applicant_email: 'ravi@example.com',
        assigned_approver: 'Sudheer Sir',
        amount: '5000',
        raw: { source: 'test' },
      }, { fullName: 'Asha Rao', role: 'buyer' });

      expect(prepared.item).toMatchObject({
        module: 'Credit Notes',
        request_type: 'Credit Notes',
        project: null,
        value_impact: null,
        maker_name: 'Asha Rao',
        maker_role: 'buyer',
        status: 'Pending',
        details: '',
        amount: 5000,
        quantity: null,
        internal_task_id: null,
        buyer_id: null,
        seller_id: null,
      });
      expect(prepared.item.request_number).toMatch(/^REQ-[0-9A-F]{12}$/);
      expect(prepared.item.history).toEqual([expect.objectContaining({
        action: 'SUBMITTED',
        actor_name: 'Asha Rao',
        actor_role: 'buyer',
        remarks: 'Submitted for managerial approval (Sudheer Sir).',
      })]);
      expect(prepared.statement.text).toContain('INSERT INTO approvals');
      expect(prepared.statement.params).toHaveLength(14);
      expect(prepared.statement.params[0]).toBe(prepared.item.id);
      expect(JSON.parse(prepared.statement.params[11])).toMatchObject({ request_type: 'Credit Notes', source: 'test' });
    });

    it('keeps supplied identifiers, history, and attachments', () => {
      const history = [{ action: 'CUSTOM', timestamp: '2026-01-02T00:00:00.000Z' }];
      const prepared = approvalQueries.prepareApprovalCreate({
        id: 'appr-fixed',
        request_number: 'REQ-FIXED',
        request_type: 'Discounts',
        module: 'Discounts',
        applicant_name: 'Ravi',
        applicant_email: 'r@x.com',
        maker_name: 'Maker',
        assigned_approver: 'Sudheer Sir',
        history,
        attachments: [{ name: 'quote.pdf' }],
      }, {});

      expect(prepared.item).toMatchObject({ id: 'appr-fixed', request_number: 'REQ-FIXED', history, attachments: [{ name: 'quote.pdf' }] });
    });
  });

  describe('getApprovalById', () => {
    it('returns null for a missing id without querying storage', async () => {
      await expect(approvalQueries.getApprovalById('')).resolves.toBeNull();
      expect(querySpy).not.toHaveBeenCalled();
    });

    it('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(approvalQueries.getApprovalById('appr-db-1')).rejects.toMatchObject(UNAVAILABLE);
    });

    it('hydrates the stored approval, reading linkage fields from the raw payload', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [approvalRow({
          raw: JSON.stringify({
            request_type: 'Credit Notes',
            internal_task_id: 'task-lookup',
            buyer_id: 'buyer-1',
            seller_id: 'seller-1',
            history: [{ action: 'SUBMITTED' }],
          }),
        })],
      });

      const approval = await approvalQueries.getApprovalById('appr-db-1');

      expect(approval).toMatchObject({
        id: 'appr-db-1',
        module: 'Credit Notes',
        internal_task_id: 'task-lookup',
        buyer_id: 'buyer-1',
        seller_id: 'seller-1',
        assigned_approver: 'Sudheer Sir',
        history: [{ action: 'SUBMITTED' }],
      });
      expect(querySpy).toHaveBeenCalledWith('SELECT * FROM approvals WHERE id = $1 LIMIT 1', ['appr-db-1'], expect.any(Object));
    });

    it('returns null when no row matches', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] });

      await expect(approvalQueries.getApprovalById('missing-db-approval')).resolves.toBeNull();
    });

    it('fails closed with the cause when the lookup query fails', async () => {
      const cause = new Error('lookup failed');
      querySpy.mockRejectedValueOnce(cause);

      await expect(approvalQueries.getApprovalById('failed-db-approval')).rejects.toMatchObject({ ...UNAVAILABLE, cause });
    });
  });

  describe('getApprovalSummary', () => {
    it('fails closed when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(approvalQueries.getApprovalSummary()).rejects.toMatchObject(UNAVAILABLE);
    });

    it('reads the aggregate counts from the database row', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{ total: '4', pending: '2', approved: '1', rejected: '1' }] });

      await expect(approvalQueries.getApprovalSummary()).resolves.toEqual({
        total: 4, pending: 2, approved: 1, rejected: 1,
      });
    });

    it('counts legacy status rows when the result carries per-status counts', async () => {
      querySpy.mockResolvedValueOnce({
        rows: [{ status: 'Pending', count: '3' }, { status: 'approved', count: 2 }, { status: 'Other', count: 9 }],
      });

      await expect(approvalQueries.getApprovalSummary()).resolves.toEqual({
        pending: 3, approved: 2, rejected: 0, total: 5,
      });
    });

    it('fails closed with PERSISTENCE_UNAVAILABLE when the summary query fails', async () => {
      querySpy.mockRejectedValueOnce(new Error('database offline'));

      await expect(approvalQueries.getApprovalSummary()).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe('getApprovals', () => {
    it('fails closed when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(approvalQueries.getApprovals()).rejects.toMatchObject(UNAVAILABLE);
    });

    it('pushes the module, status, project, approver, and search filters into the query and clamps paging', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{ ...approvalRow(), total: '1' }] });

      const result = await approvalQueries.getApprovals({
        module: 'Credit Notes',
        status: 'Pending',
        project: 'Tata',
        search: '9041',
        assigned_approver: 'sudheer',
        limit: 500,
        offset: -3,
        sortBy: 'module',
        sortOrder: 'asc',
      });

      const [sql, params] = querySpy.mock.calls[0];
      expect(sql).toContain('lower(module) = $1');
      expect(sql).toContain('lower(status) = $2');
      expect(sql).toContain("lower(coalesce(project, '')) LIKE $3");
      expect(sql).toContain("lower(coalesce(assigned_approver, '')) LIKE $4");
      expect(sql).toContain('ORDER BY module ASC');
      expect(params.slice(0, 4)).toEqual(['credit notes', 'pending', '%tata%', '%sudheer%']);
      expect(params.slice(-2)).toEqual([200, 0]);
      expect(result.total).toBe(1);
      expect(result.rows[0]).toMatchObject({ id: 'appr-db-1', request_number: 'REQ-DB-1' });
      expect(result.rows[0]).not.toHaveProperty('total');
    });

    it('falls back to the created_at sort for an unknown sort field and treats "all" as no filter', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: '0' }] });

      await approvalQueries.getApprovals({ sortBy: 'drop_table', module: 'all', status: 'all', project: 'all' });

      expect(querySpy.mock.calls[0][0]).toContain('ORDER BY created_at DESC');
      expect(querySpy.mock.calls[0][1]).toEqual([50, 0]);
    });

    it('runs a count query when the page is empty and reports that total', async () => {
      querySpy
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: '8' }] });

      await expect(approvalQueries.getApprovals({ offset: 100 })).resolves.toEqual({ rows: [], total: 8 });
      expect(querySpy).toHaveBeenCalledTimes(2);
    });

    it('reports a total of zero when the count query returns no row', async () => {
      querySpy
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(approvalQueries.getApprovals()).resolves.toEqual({ rows: [], total: 0 });
    });

    it('fails closed with PERSISTENCE_UNAVAILABLE when the list query fails', async () => {
      querySpy.mockRejectedValueOnce(new Error('database offline'));

      await expect(approvalQueries.getApprovals()).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe('createApproval', () => {
    it('fails closed when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(approvalQueries.createApproval({ module: 'Credit Notes' }, {})).rejects.toMatchObject(UNAVAILABLE);
    });

    it('inserts the prepared approval and returns the stored item', async () => {
      querySpy.mockResolvedValueOnce({ rows: [] });

      const item = await approvalQueries.createApproval({
        module: 'Credit Notes',
        applicant_name: 'Ravi',
        applicant_email: 'ravi@example.com',
        assigned_approver: 'Sudheer Sir',
      }, { fullName: 'Asha' });

      expect(querySpy).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO approvals'), expect.any(Array), expect.any(Object));
      expect(item).toMatchObject({ module: 'Credit Notes', maker_name: 'Asha', status: 'Pending' });
    });

    it('fails closed with the cause when the insert fails', async () => {
      const cause = new Error('insert failed');
      querySpy.mockRejectedValueOnce(cause);

      await expect(approvalQueries.createApproval({
        module: 'Credit Notes',
        applicant_name: 'Ravi',
        applicant_email: 'ravi@example.com',
        assigned_approver: 'Sudheer Sir',
      }, { name: 'Asha' })).rejects.toMatchObject({ ...UNAVAILABLE, cause });
    });
  });

  describe('processApprovalAction', () => {
    const actor = { uuid: 'approver-1', name: 'Sudheer Sir', email: 'sudheer@example.com', role: 'admin' };
    const body = { action: 'APPROVE', remarks: 'Extended 30 days', password: APPROVER_PASSWORD, approverName: APPROVER_NAME };

    it('requires an identified actor before any storage work', async () => {
      await expect(approvalQueries.processApprovalAction('appr-1', body, {})).rejects.toMatchObject({
        code: 'ACTOR_REQUIRED',
      });
      expect(transactionSpy).not.toHaveBeenCalled();
    });

    it('fails closed when storage is not configured', async () => {
      pool.hasStorage.mockReturnValue(false);

      await expect(approvalQueries.processApprovalAction('appr-1', body, actor)).rejects.toMatchObject(UNAVAILABLE);
    });

    it('refuses an approver whose password is not configured', async () => {
      await expect(approvalQueries.processApprovalAction('appr-1', { ...body, approverName: 'Unknown Approver' }, actor))
        .rejects.toMatchObject({ code: 'APPROVER_PASSWORD_NOT_CONFIGURED', statusCode: 503 });
    });

    it('refuses a wrong approver password', async () => {
      await expect(approvalQueries.processApprovalAction('appr-1', { ...body, password: 'wrong' }, actor))
        .rejects.toMatchObject({ code: 'APPROVER_PASSWORD_INVALID', statusCode: 401 });
    });

    it('decides a PostgreSQL management approval inside one transaction and writes its audit event', async () => {
      const current = { id: 'appr-pg-1', request_number: 'REQ-PG-1', status: 'Pending' };
      const saved = { ...current, status: 'Approved', approver_name: 'Sudheer Sir' };
      const client = jest.fn()
        .mockResolvedValueOnce({ rows: [current] })
        .mockResolvedValueOnce({ rows: [saved] })
        .mockResolvedValueOnce({ rows: [] });
      runInTransaction(client);
      const auditSpy = jest.spyOn(logger, 'audit');

      const result = await approvalQueries.processApprovalAction('REQ-PG-1', body, actor);

      expect(result).toEqual(saved);
      expect(client).toHaveBeenCalledTimes(3);
      expect(client.mock.calls[1][1]).toEqual(expect.arrayContaining(['Approved', 'approver-1', 'Sudheer Sir']));
      expect(client.mock.calls[2][0]).toContain('INSERT INTO management_approval_events');
      expect(auditSpy).toHaveBeenCalledWith('Management approval approved', 'sudheer@example.com', expect.objectContaining({
        approvalId: 'appr-pg-1',
        requestNumber: 'REQ-PG-1',
      }), 'REQ-PG-1');
    });

    it('refuses a PostgreSQL management approval that was already decided', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [{ id: 'appr-pg-2', status: 'Approved' }] }));

      await expect(approvalQueries.processApprovalAction('appr-pg-2', { ...body, action: 'REJECT' }, actor))
        .rejects.toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED' });
    });

    it('falls through to the approvals table when no management approval matches, and returns null when neither has the id', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [] }));
      querySpy.mockResolvedValueOnce({ rows: [] });

      await expect(approvalQueries.processApprovalAction('missing', { ...body, action: 'REJECT' }, actor)).resolves.toBeNull();
    });

    it('fails closed with the cause when the PostgreSQL transaction fails', async () => {
      const cause = new Error('transaction failed');
      transactionSpy.mockRejectedValueOnce(cause);

      await expect(approvalQueries.processApprovalAction('appr-1', body, actor)).rejects.toMatchObject({ ...UNAVAILABLE, cause });
    });

    it('decides a Worker D1 management approval in one batch and returns the saved row', async () => {
      const saved = { id: 'd1-appr-1', request_number: 'REQ-D1-1', status: 'Rejected', approver_name: 'Sudheer Sir' };
      const batch = jest.fn().mockResolvedValue([
        { results: [saved], meta: { changes: 1 } },
        { results: [{ id: 'event-1' }], meta: { changes: 1 } },
      ]);
      const previousEnv = globalThis.__CF_ENV__;
      globalThis.__CF_ENV__ = {
        DB: {
          prepare: (sql) => ({ bind: (...params) => ({ sql, params }) }),
          batch,
        },
      };

      try {
        await expect(approvalQueries.processApprovalAction('REQ-D1-1', {
          ...body, action: 'REJECT', remarks: 'Declined',
        }, actor)).resolves.toEqual(saved);
        expect(batch).toHaveBeenCalledTimes(1);
      } finally {
        if (previousEnv === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = previousEnv;
      }
    });

    it('distinguishes a missing and an already decided Worker D1 approval, and fails closed on a batch error', async () => {
      const previousEnv = globalThis.__CF_ENV__;
      const batch = jest.fn()
        .mockResolvedValueOnce([{ results: [], meta: { changes: 0 } }, { results: [], meta: { changes: 0 } }])
        .mockResolvedValueOnce([{ results: [], meta: { changes: 0 } }, { results: [], meta: { changes: 0 } }])
        .mockRejectedValueOnce(new Error('D1 offline'));
      globalThis.__CF_ENV__ = {
        DB: { prepare: (sql) => ({ bind: (...params) => ({ sql, params }) }), batch },
      };

      try {
        // Missing: no management row matches, so the approvals table is consulted and has no row.
        querySpy
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] });
        await expect(approvalQueries.processApprovalAction('missing', body, actor)).resolves.toBeNull();

        // Already decided: the management row exists but is no longer pending.
        querySpy.mockResolvedValueOnce({ rows: [approvalRow({ status: 'Approved' })] });
        await expect(approvalQueries.processApprovalAction('d1-decided', body, actor))
          .rejects.toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED' });

        // Batch failure: the error is reported as unavailable, not as a decision.
        await expect(approvalQueries.processApprovalAction('d1-fail', body, actor)).rejects.toMatchObject(UNAVAILABLE);
      } finally {
        if (previousEnv === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = previousEnv;
      }
    });

    it('decides a generic approval, records history, and notifies the requester', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [] }));
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockResolvedValue({});
      const saved = approvalRow({ status: 'Rejected', approver_name: 'Sudheer Sir', approver_remarks: 'Declined' });
      querySpy
        .mockResolvedValueOnce({ rows: [approvalRow()] })
        .mockResolvedValueOnce({ rows: [saved] });

      const result = await approvalQueries.processApprovalAction('REQ-DB-1', {
        ...body, action: 'REJECT', remarks: 'Declined',
      }, actor);

      expect(result).toMatchObject({ id: 'appr-db-1', status: 'Rejected' });
      const updateParams = querySpy.mock.calls[1][1];
      expect(updateParams[0]).toBe('Rejected');
      expect(JSON.parse(updateParams[4]).history).toEqual([expect.objectContaining({ action: 'REJECTED', actor_name: 'Sudheer Sir' })]);
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
        entityType: 'approval',
        recipientEmail: 'ravi@example.com',
        channel: 'EMAIL',
      }), actor);
    });

    it('warns instead of notifying when the approval holds no requester email', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [] }));
      const dispatchSpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication');
      querySpy
        .mockResolvedValueOnce({ rows: [approvalRow({ applicant_email: null })] })
        .mockResolvedValueOnce({ rows: [approvalRow({ applicant_email: null, status: 'Approved' })] });

      await approvalQueries.processApprovalAction('REQ-DB-1', body, actor);

      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no requester email'), expect.any(Object), 'APPROVAL_QUERIES');
    });

    it('logs a requester notification failure without failing the decision', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [] }));
      jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication')
        .mockRejectedValue(new Error('mail offline'));
      querySpy
        .mockResolvedValueOnce({ rows: [approvalRow()] })
        .mockResolvedValueOnce({ rows: [approvalRow({ status: 'Approved' })] });

      await expect(approvalQueries.processApprovalAction('REQ-DB-1', body, actor)).resolves.toMatchObject({ status: 'Approved' });
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('requester notification failed'), expect.any(Object), 'APPROVAL_QUERIES');
    });

    it('synchronizes the linked credit task when a generic approval is approved', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [] }));
      const approveSpy = jest.spyOn(internalTaskQueries, 'approveCreditTask').mockResolvedValue({});
      const linked = approvalRow({
        raw: JSON.stringify({ request_type: 'Credit Notes', internal_task_id: 'task-link-1', history: [] }),
      });
      querySpy
        .mockResolvedValueOnce({ rows: [linked] })
        .mockResolvedValueOnce({ rows: [{ ...linked, status: 'Approved' }] });

      await approvalQueries.processApprovalAction('REQ-DB-1', body, actor);

      expect(approveSpy).toHaveBeenCalledWith('task-link-1', actor, 'Extended 30 days');
    });

    it('logs a credit task synchronization failure after the approval is saved', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [] }));
      jest.spyOn(internalTaskQueries, 'rejectCreditTask').mockRejectedValue(new Error('task offline'));
      const linked = approvalRow({
        raw: JSON.stringify({ request_type: 'Credit Notes', internal_task_id: 'task-link-2', history: [] }),
      });
      querySpy
        .mockResolvedValueOnce({ rows: [linked] })
        .mockResolvedValueOnce({ rows: [{ ...linked, status: 'Rejected' }] });

      await expect(approvalQueries.processApprovalAction('REQ-DB-1', { ...body, action: 'REJECT' }, actor))
        .resolves.toMatchObject({ status: 'Rejected' });
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('internal credit task synchronization failed'), expect.any(Object), 'APPROVAL_QUERIES');
    });

    it('reports a conflict when the generic approval changed before the update', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [] }));
      querySpy
        .mockResolvedValueOnce({ rows: [approvalRow()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [approvalRow({ status: 'Approved' })] });

      await expect(approvalQueries.processApprovalAction('REQ-DB-1', body, actor))
        .rejects.toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED' });
    });

    it('returns null when the generic approval disappears before the update', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [] }));
      querySpy
        .mockResolvedValueOnce({ rows: [approvalRow()] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(approvalQueries.processApprovalAction('REQ-DB-1', body, actor)).resolves.toBeNull();
    });

    it('refuses an already decided generic approval before writing', async () => {
      runInTransaction(jest.fn().mockResolvedValueOnce({ rows: [] }));
      querySpy.mockResolvedValueOnce({ rows: [approvalRow({ status: 'Approved' })] });

      await expect(approvalQueries.processApprovalAction('REQ-DB-1', body, actor))
        .rejects.toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED' });
      expect(querySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('approvalController', () => {
    it('extracts the actor from the authenticated session only', () => {
      expect(approvalController.extractActor({})).toBeNull();
      expect(approvalController.extractActor({ user: {} })).toBeNull();
      expect(approvalController.extractActor({ user: { uuid: 'u1', fullName: 'Asha', email: 'a@x.com', role: 'admin' } }))
        .toEqual({ uuid: 'u1', name: 'Asha', email: 'a@x.com', role: 'admin' });
      expect(approvalController.extractActor({ user: { id: 'i1' } }))
        .toEqual({ uuid: 'i1', name: null, email: null, role: null });
      expect(approvalController.extractActor({ user: { name: 'Only Name' } }))
        .toEqual({ uuid: null, name: 'Only Name', email: null, role: null });
      expect(approvalController.extractActor({ headers: { 'x-user-name': 'Spoofed' } })).toBeNull();
    });
  });

  describe('HTTP routes', () => {
    it('rejects anonymous and non-approver requests before the handlers run', async () => {
      const anonymousSummary = await request(app).get('/api/approvals/summary');
      const buyerList = await request(app).get('/api/approvals').set(authHeader('buyer'));
      const anonymousAction = await request(app).post('/api/approvals/appr-cred-101/action').send({ action: 'APPROVE' });
      const vendorAction = await request(app)
        .post('/api/approvals/appr-cred-101/action')
        .set(authHeader('vendor'))
        .send({ action: 'APPROVE' });

      expect(anonymousSummary.status).toBe(401);
      expect(buyerList.status).toBe(403);
      expect(anonymousAction.status).toBe(401);
      expect(vendorAction.status).toBe(403);
    });

    it('returns the summary metrics from the query layer', async () => {
      const summary = { total: 3, pending: 2, approved: 1, rejected: 0 };
      jest.spyOn(approvalQueries, 'getApprovalSummary').mockResolvedValueOnce(summary);

      const res = await request(app).get('/api/approvals/summary').set(authHeader('category_manager'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, summary });
    });

    it('answers 503 with a retryable message when the summary storage is unavailable', async () => {
      jest.spyOn(approvalQueries, 'getApprovalSummary').mockRejectedValueOnce(Object.assign(new Error('down'), UNAVAILABLE));

      const res = await request(app).get('/api/approvals/summary').set(authHeader('admin'));

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, error: APPROVAL_MESSAGES.DATABASE_UNAVAILABLE, retryable: true });
    });

    it('answers 500 for an unexpected summary failure', async () => {
      jest.spyOn(approvalQueries, 'getApprovalSummary').mockRejectedValueOnce(new Error('Summary error'));

      const res = await request(app).get('/api/approvals/summary').set(authHeader('admin'));

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to retrieve approval summary statistics.');
    });

    it('passes the list filters and paging from the query string to the query layer', async () => {
      const listSpy = jest.spyOn(approvalQueries, 'getApprovals').mockResolvedValueOnce({ rows: [approvalRow()], total: 1 });

      const res = await request(app)
        .get('/api/approvals?module=Credit%20Notes&status=Pending&project=Tata&search=9041&limit=5&offset=2')
        .set(authHeader('admin'));

      expect(res.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({
        module: 'Credit Notes',
        status: 'Pending',
        project: 'Tata',
        search: '9041',
        limit: 5,
        offset: 2,
      }));
      expect(res.body).toEqual(expect.objectContaining({ success: true, total: 1, limit: 5, offset: 2 }));
      expect(res.body.data).toHaveLength(1);
    });

    it('answers 500 when the list query fails', async () => {
      jest.spyOn(approvalQueries, 'getApprovals').mockRejectedValueOnce(new Error('List error'));

      const res = await request(app).get('/api/approvals').set(authHeader('admin'));

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to retrieve approval requests.');
    });

    it('rejects an action payload without an action with a field-level validation error', async () => {
      const res = await request(app)
        .post('/api/approvals/appr-cred-101/action')
        .set(authHeader('admin'))
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed on approval action payload.');
    });

    it('answers 404 when the approval does not exist', async () => {
      jest.spyOn(approvalQueries, 'processApprovalAction').mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/approvals/appr-missing-999/action')
        .set(authHeader('admin'))
        .send(withApprovalCredentials({ action: 'APPROVE' }));

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Approval request "appr-missing-999" not found.');
    });

    it('processes an approval for the authenticated approver and returns the decided row', async () => {
      const decided = approvalRow({ status: 'Approved' });
      const actionSpy = jest.spyOn(approvalQueries, 'processApprovalAction').mockResolvedValueOnce(decided);

      const res = await request(app)
        .post('/api/approvals/appr-db-1/action')
        .set(authHeader('admin'))
        .set('x-user-name', 'Spoofed Name')
        .send(withApprovalCredentials({ action: 'APPROVE', remarks: 'Approved' }));

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: decided });
      const [id, payload, actor] = actionSpy.mock.calls[0];
      expect(id).toBe('appr-db-1');
      expect(payload).toEqual(expect.objectContaining({ action: 'APPROVE', approverName: APPROVER_NAME, remarks: 'Approved' }));
      expect(actor.name).not.toBe('Spoofed Name');
    });

    it.each([
      ['ACTOR_REQUIRED', 401, undefined],
      ['APPROVAL_ALREADY_DECIDED', 409, APPROVAL_MESSAGES.ALREADY_DECIDED],
      ['APPROVER_PASSWORD_INVALID', 401, APPROVAL_MESSAGES.PASSWORD_INVALID],
      ['APPROVER_PASSWORD_NOT_CONFIGURED', 503, APPROVAL_MESSAGES.PASSWORD_CONFIGURATION_UNAVAILABLE],
      ['PERSISTENCE_UNAVAILABLE', 503, APPROVAL_MESSAGES.DATABASE_UNAVAILABLE],
    ])('maps the %s query error to HTTP %i', async (code, status, message) => {
      jest.spyOn(approvalQueries, 'processApprovalAction').mockRejectedValueOnce(Object.assign(new Error('x'), { code }));

      const res = await request(app)
        .post('/api/approvals/appr-db-1/action')
        .set(authHeader('admin'))
        .send(withApprovalCredentials({ action: 'APPROVE' }));

      expect(res.status).toBe(status);
      expect(res.body.success).toBe(false);
      if (message) expect(res.body.error).toBe(message);
    });

    it('answers 500 for an unexpected action failure', async () => {
      jest.spyOn(approvalQueries, 'processApprovalAction').mockRejectedValueOnce(new Error('Process error'));

      const res = await request(app)
        .post('/api/approvals/appr-db-1/action')
        .set(authHeader('admin'))
        .send(withApprovalCredentials({ action: 'APPROVE' }));

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to process approval action.');
    });
  });
});

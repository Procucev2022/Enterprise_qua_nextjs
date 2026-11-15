jest.mock('../src/db/d1Bridge', () => {
  const actual = jest.requireActual('../src/db/d1Bridge');
  return {
    ...actual,
    getD1Binding: jest.fn(),
    getD1HttpClient: jest.fn(),
    batchD1: jest.fn(),
  };
});

jest.mock('../src/services/actionCenterNotificationService', () => ({
  dispatchActionCenterCommunication: jest.fn(async () => ({ success: true })),
}));

const d1Bridge = require('../src/db/d1Bridge');
const pool = require('../src/db/pool');
const { logger } = require('../src/services/loggerService');
const approvalQueries = require('../src/db/approvalQueries');

const APPROVER_SECRET = 'unit-test-approver-secret';
const ACTOR = { uuid: 'approver-1', name: 'Srinu Sir', email: 'srinu@procure.test' };
const APPROVAL_INPUT = { action: 'Approve', password: APPROVER_SECRET, approverName: 'Srinu Sir' };
const originalApproverPassword = process.env.SRINU_APPROVER_PASSWORD;

beforeEach(() => {
  process.env.SRINU_APPROVER_PASSWORD = APPROVER_SECRET;
  d1Bridge.getD1Binding.mockReturnValue({ name: 'd1-binding' });
  d1Bridge.getD1HttpClient.mockReturnValue(null);
  d1Bridge.batchD1.mockReset();
  jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
  jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
  jest.spyOn(pool.queryCache, 'invalidate').mockImplementation(() => {});
  jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'audit').mockImplementation(() => {});
});

afterEach(() => {
  if (originalApproverPassword === undefined) {
    delete process.env.SRINU_APPROVER_PASSWORD;
  } else {
    process.env.SRINU_APPROVER_PASSWORD = originalApproverPassword;
  }
  jest.restoreAllMocks();
});

describe('hydrateApprovalRow raw payload handling', () => {
  test('returns null for a missing row', () => {
    expect(approvalQueries.hydrateApprovalRow(null)).toBeNull();
  });

  test('reads a JSON text payload, including its amount, history, and linked task', () => {
    const row = approvalQueries.hydrateApprovalRow({
      id: 'appr-1',
      request_number: 'APR-1',
      status: 'Pending',
      raw: JSON.stringify({
        amount: '125.5',
        history: [{ action: 'SUBMITTED' }],
        internal_task_id: 'task-9',
      }),
    });

    expect(row).toMatchObject({
      id: 'appr-1',
      request_number: 'APR-1',
      amount: 125.5,
      internal_task_id: 'task-9',
      history: [{ action: 'SUBMITTED' }],
    });
    expect(row.raw).toMatchObject({ internal_task_id: 'task-9' });
  });

  test('treats malformed text, null, and non-object payloads as an empty payload', () => {
    expect(approvalQueries.hydrateApprovalRow({ id: 'a1', raw: '{not json' }).raw).toEqual({});
    expect(approvalQueries.hydrateApprovalRow({ id: 'a2', raw: null }).raw).toEqual({});
    expect(approvalQueries.hydrateApprovalRow({ id: 'a3', raw: 42 }).raw).toEqual({});
  });

  test('uses an object payload as given', () => {
    const row = approvalQueries.hydrateApprovalRow({
      id: 'a4',
      raw: { request_type: 'Credit', seller_id: 's-1' },
    });

    expect(row).toMatchObject({ request_type: 'Credit', seller_id: 's-1' });
  });
});

describe('processApprovalAction on the D1 path', () => {
  test('rejects with persistence unavailable when the approval is written without its audit event', async () => {
    d1Bridge.batchD1.mockResolvedValueOnce([
      { rows: [{ id: 'ma-1', request_number: 'MA-1', status: 'Approved' }] },
      { rows: [] },
    ]);

    await expect(approvalQueries.processApprovalAction('MA-1', APPROVAL_INPUT, ACTOR)).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      cause: expect.objectContaining({
        message: 'Approval state changed but its audit event was not written.',
      }),
    });
  });

  test('reports an already decided approval when the guarded update matches no pending row', async () => {
    d1Bridge.batchD1.mockResolvedValueOnce([{ rows: [] }, { rows: [] }]);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'ma-1', status: 'Approved' }] });

    await expect(approvalQueries.processApprovalAction('MA-1', APPROVAL_INPUT, ACTOR)).rejects.toMatchObject({
      code: 'APPROVAL_ALREADY_DECIDED',
    });
  });

  test('records a management decision on the D1 path and clears the affected caches', async () => {
    d1Bridge.batchD1.mockResolvedValueOnce([
      { rows: [{ id: 'ma-1', request_number: 'MA-1', status: 'Approved' }] },
      { rows: [{ id: 'evt-1' }] },
    ]);

    await expect(approvalQueries.processApprovalAction('MA-1', APPROVAL_INPUT, ACTOR)).resolves.toMatchObject({
      id: 'ma-1',
      status: 'Approved',
    });
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('management_approvals');
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('management_approval_events');
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('approvals');
    expect(logger.audit).toHaveBeenCalledWith(
      'Management approval approved',
      'srinu@procure.test',
      expect.objectContaining({ approvalId: 'ma-1', requestNumber: 'MA-1' }),
      'MA-1'
    );
  });
});

describe('approval value normalisation, summary, and list branches', () => {
  test('hydrates non-numeric amounts, invalid dates, and non-list attachments as empty values', () => {
    const row = approvalQueries.hydrateApprovalRow({
      id: 'a5',
      created_at: 'not-a-date',
      raw: { amount: 'abc', attachments: [{ name: 'quote.pdf' }] },
    });

    expect(row).toMatchObject({ amount: null, created_at: null, attachments: [{ name: 'quote.pdf' }] });
    expect(approvalQueries.hydrateApprovalRow({ id: 'a6', raw: { attachments: 'quote.pdf' } }).attachments).toEqual([]);
  });

  test('summarises status counts from grouped rows and treats missing counts as zero', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { status: null, count: 4 },
        { status: 'PENDING', count: 3 },
        { status: 'Approved', count: null },
        { status: 'Rejected', count: 2 },
      ],
    });

    await expect(approvalQueries.getApprovalSummary()).resolves.toEqual({
      pending: 3,
      approved: 0,
      rejected: 2,
      total: 5,
    });
  });

  test('reports zero counts when the summary query returns no result', async () => {
    pool.query.mockResolvedValueOnce(undefined);

    await expect(approvalQueries.getApprovalSummary()).resolves.toEqual({ total: 0, pending: 0, approved: 0, rejected: 0 });
  });

  test('reads an aggregate summary row and defaults null columns to zero', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ total: 7, pending: null, approved: 4, rejected: undefined }] });

    await expect(approvalQueries.getApprovalSummary()).resolves.toEqual({ total: 7, pending: 0, approved: 4, rejected: 0 });
  });

  test('lists approvals with defaulted paging and skips rows that cannot be hydrated', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'appr-9', request_number: 'APR-9', status: 'Pending', raw: '{}' }, null],
    });

    const result = await approvalQueries.getApprovals({ limit: 0, sortOrder: '' });

    expect(result).toMatchObject({ total: 0, rows: [{ id: 'appr-9', request_number: 'APR-9' }] });
    expect(pool.query.mock.calls[0][1].slice(-2)).toEqual([50, 0]);
  });

  test('counts matching approvals when the page query has no result', async () => {
    pool.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ total: '3' }] });

    await expect(approvalQueries.getApprovals({ status: 'Pending' })).resolves.toEqual({ rows: [], total: 3 });
  });

  test('creates an approval request for the named maker when no actor is supplied', async () => {
    const item = await approvalQueries.createApproval({
      module: 'Credit',
      applicant_name: 'Vendor Co',
      applicant_email: 'vendor@procure.test',
      maker_name: 'Ana Rao',
      assigned_approver: 'Srinu Sir',
    });

    expect(item).toMatchObject({ status: 'Pending' });
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ d1: true }));
  });

  test('rejects an approval request that names no module before writing', () => {
    expect(() => approvalQueries.prepareApprovalCreate()).toThrow();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('processApprovalAction argument defaults and outcomes', () => {
  test('requires an actor identity before checking the approver password', async () => {
    await expect(approvalQueries.processApprovalAction('MA-1', { action: 'Approve' })).rejects.toThrow();
    expect(d1Bridge.batchD1).not.toHaveBeenCalled();
  });

  test('rejects a decision without a password for the named approver', async () => {
    await expect(
      approvalQueries.processApprovalAction('MA-1', { action: 'Approve', approverName: 'Srinu Sir' }, ACTOR)
    ).rejects.toMatchObject({ code: 'APPROVER_PASSWORD_INVALID', statusCode: 401 });
  });

  test('reports password verification as not configured when no approver is named', async () => {
    await expect(
      approvalQueries.processApprovalAction('MA-1', { action: 'Approve', password: APPROVER_SECRET }, ACTOR)
    ).rejects.toMatchObject({ code: 'APPROVER_PASSWORD_NOT_CONFIGURED', statusCode: 503 });
  });

  test('treats a missing action as a rejection', async () => {
    d1Bridge.batchD1.mockResolvedValueOnce([
      { rows: [{ id: 'ma-2', request_number: 'MA-2', status: 'Rejected' }] },
      { rows: [{ id: 'evt-2' }] },
    ]);

    await approvalQueries.processApprovalAction('MA-2', { approverName: 'Srinu Sir', password: APPROVER_SECRET }, ACTOR);

    expect(logger.audit).toHaveBeenCalledWith(
      'Management approval rejected',
      'srinu@procure.test',
      expect.objectContaining({ approvalId: 'ma-2' }),
      'MA-2'
    );
  });

  test.each([
    ['an actor id', { uuid: 'approver-7' }, 'approver-7'],
    ['an actor name', { name: 'Srinu Sir' }, 'Srinu Sir'],
  ])('audits a management decision by %s when no email is known', async (_label, actor, auditActor) => {
    d1Bridge.batchD1.mockResolvedValueOnce([
      { rows: [{ id: 'ma-3', request_number: 'MA-3', status: 'Approved' }] },
      { rows: [{ id: 'evt-3' }] },
    ]);

    await approvalQueries.processApprovalAction('MA-3', APPROVAL_INPUT, actor);

    expect(logger.audit).toHaveBeenCalledWith('Management approval approved', auditActor, expect.any(Object), 'MA-3');
  });

  test('reports an approval as already decided when the transactional update matches nothing', async () => {
    d1Bridge.getD1Binding.mockReturnValue(null);
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'ma-4', status: 'Pending' }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    jest.spyOn(pool, 'withTransaction').mockImplementation(async (work) => work(client));

    await expect(approvalQueries.processApprovalAction('MA-4', APPROVAL_INPUT, ACTOR)).rejects.toMatchObject({
      code: 'APPROVAL_ALREADY_DECIDED',
    });
  });
});

describe('processApprovalAction on the generic approvals table', () => {
  const genericRow = {
    id: 'appr-1',
    request_number: 'APR-1',
    module: 'Credit',
    status: 'Pending',
    applicant_name: 'Vendor Co',
    applicant_email: 'vendor@procure.test',
    maker_name: null,
    value_impact: 'INR 5000',
    raw: '{}',
    internal_task_id: null,
  };
  let notifier;

  beforeEach(() => {
    notifier = require('../src/services/actionCenterNotificationService');
    d1Bridge.batchD1.mockResolvedValue([{ rows: [] }, { rows: [] }]);
    pool.query.mockImplementation(async (sql, params) => {
      if (/UPDATE approvals/.test(sql)) return { rows: [{ ...genericRow, status: params[0] }] };
      if (/FROM approvals WHERE/.test(sql)) return { rows: [genericRow] };
      return { rows: [] };
    });
  });

  test('approves a generic request, records the history entry, and notifies the requester', async () => {
    const approval = await approvalQueries.processApprovalAction(
      'APR-1',
      APPROVAL_INPUT,
      { uuid: 'approver-1', name: 'Srinu Sir' }
    );

    expect(approval).toMatchObject({ id: 'appr-1', status: 'Approved' });
    const [, updateParams] = pool.query.mock.calls.find(([sql]) => /UPDATE approvals/.test(sql));
    expect(JSON.parse(updateParams[4]).history).toEqual([
      expect.objectContaining({
        action: 'APPROVED',
        actor_role: null,
        remarks: 'Request approved by Srinu Sir.',
      }),
    ]);
    expect(notifier.dispatchActionCenterCommunication).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'approval',
        recipientName: 'Vendor Co',
        recipientEmail: 'vendor@procure.test',
        message: expect.stringContaining('has been approved by Srinu Sir. Remarks: None.'),
      }),
      expect.objectContaining({ uuid: 'approver-1' })
    );
    expect(logger.audit).toHaveBeenCalledWith('Approval approved', 'approver-1', expect.any(Object), 'APR-1');
  });

  test('rejects a generic request with its remarks and audits by the actor name when no id or email is known', async () => {
    const actor = { name: 'Srinu Sir' };

    await approvalQueries.processApprovalAction(
      'APR-1',
      { action: 'Reject', password: APPROVER_SECRET, approverName: 'Srinu Sir', remarks: 'Over budget' },
      actor
    );

    expect(notifier.dispatchActionCenterCommunication).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('has been rejected by Srinu Sir. Remarks: Over budget.') }),
      actor
    );
    expect(logger.audit).toHaveBeenCalledWith('Approval rejected', 'Srinu Sir', expect.any(Object), 'APR-1');
  });

  test('completes the decision when the requester notifier is unavailable', async () => {
    const original = notifier.dispatchActionCenterCommunication;
    delete notifier.dispatchActionCenterCommunication;

    try {
      await expect(approvalQueries.processApprovalAction('APR-1', APPROVAL_INPUT, ACTOR)).resolves.toMatchObject({
        status: 'Approved',
      });
    } finally {
      notifier.dispatchActionCenterCommunication = original;
    }
  });

  test('addresses the requester by applicant email when neither the maker nor applicant name is recorded', async () => {
    pool.query.mockImplementation(async (sql, params) => {
      if (/UPDATE approvals/.test(sql)) return { rows: [{ ...genericRow, applicant_name: null, status: params[0] }] };
      if (/FROM approvals WHERE/.test(sql)) return { rows: [{ ...genericRow, applicant_name: null }] };
      return { rows: [] };
    });

    await approvalQueries.processApprovalAction('APR-1', APPROVAL_INPUT, ACTOR);

    expect(notifier.dispatchActionCenterCommunication).toHaveBeenCalledWith(
      expect.objectContaining({ recipientName: 'vendor@procure.test' }),
      ACTOR
    );
  });
});

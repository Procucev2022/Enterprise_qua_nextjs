jest.mock('../src/db/d1Bridge', () => {
  const actual = jest.requireActual('../src/db/d1Bridge');
  return {
    ...actual,
    getD1Binding: jest.fn(),
    getD1HttpClient: jest.fn(),
    batchD1: jest.fn(),
  };
});

const d1Bridge = require('../src/db/d1Bridge');
const pool = require('../src/db/pool');
const { logger } = require('../src/services/loggerService');
const storeService = require('../src/services/storeService');
const internalTaskQueries = require('../src/db/internalTaskQueries');

const ACTOR = { uuid: 'ops-1', name: 'Ops Lead', email: 'ops@procure.test' };

let taskRow;
let buyerCredits;
let vendorCredits;

function baseTaskRow(overrides = {}) {
  return {
    id: 'task-1',
    task_number: 'IT-1',
    title: 'Add credits',
    description: '',
    status: 'Pending',
    approval_status: 'PENDING',
    task_type: 'Credit Addition',
    task_category: 'CREDIT',
    priority: 'High',
    assigned_to_user_id: null,
    assigned_to_name: null,
    due_date: null,
    related_entity_type: 'BUYER',
    related_entity_id: 'buyer-1',
    credit_account_type: 'BUYER',
    credit_account_id: 'buyer-1',
    credit_quantity: 5,
    raw: '{}',
    attachments: '[]',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function routeQuery(sql, params = []) {
  const text = String(sql);
  if (text.includes('FROM internal_tasks t') && text.includes('LEFT JOIN internal_task_types')) {
    const match = taskRow && (params[0] === taskRow.id || params[0] === taskRow.task_number);
    return Promise.resolve({ rows: match ? [taskRow] : [] });
  }
  if (text.includes('FROM internal_task_activities WHERE task_id')) return Promise.resolve({ rows: [] });
  if (text.includes('SELECT credits FROM vendors')) {
    return Promise.resolve({ rows: vendorCredits === undefined ? [] : [{ credits: vendorCredits }] });
  }
  if (text.includes('SELECT available_credits FROM buyer_accounts')) {
    return Promise.resolve({ rows: buyerCredits === undefined ? [] : [{ available_credits: buyerCredits }] });
  }
  return Promise.resolve({ rows: [] });
}

/** Batch results for a committed credit approval: claim, account, ledger, activity, completion, restore. */
function committedBatch() {
  return [
    { rows: [{ id: 'task-1' }] },
    { rows: [{ id: 'account-1' }] },
    { rows: [{ id: 'ctx-1' }] },
    { rows: [{ id: 'act-1' }] },
    { rows: [{ id: 'task-1' }] },
    { rows: [] },
  ];
}

beforeEach(() => {
  taskRow = baseTaskRow();
  buyerCredits = 45;
  vendorCredits = 30;
  d1Bridge.getD1Binding.mockReturnValue({ name: 'd1-binding' });
  d1Bridge.getD1HttpClient.mockReturnValue(null);
  d1Bridge.batchD1.mockReset();
  jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
  jest.spyOn(pool, 'query').mockImplementation((sql, params) => routeQuery(sql, params));
  jest.spyOn(pool.queryCache, 'invalidate').mockImplementation(() => {});
  jest.spyOn(pool.queryAuditor, 'auditQuery').mockImplementation(() => {});
  jest.spyOn(pool.queryAuditor, 'detectTable').mockReturnValue('internal_tasks');
  jest.spyOn(logger, 'error').mockImplementation(() => {});
  jest.spyOn(logger, 'info').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(storeService, 'updateBuyerAccount').mockImplementation(() => {});
  jest.spyOn(storeService, 'updateVendor').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('updateInternalTask attachments', () => {
  test('replaces the attachment list when attachments are supplied explicitly', async () => {
    taskRow = baseTaskRow({ attachments: '[{"id":"old"}]' });

    await internalTaskQueries.updateInternalTask('task-1', { attachments: [{ id: 'new', name: 'po.pdf' }] }, ACTOR);

    const [, params] = pool.query.mock.calls.find(([sql]) => /UPDATE internal_tasks SET/.test(sql));
    expect(JSON.parse(params[18])).toEqual([{ id: 'new', name: 'po.pdf' }]);
  });

  test('appends a new attachment to the existing list when only newAttachment is supplied', async () => {
    taskRow = baseTaskRow({ attachments: '[{"id":"old"}]' });

    await internalTaskQueries.updateInternalTask('task-1', { newAttachment: { id: 'added' } }, ACTOR);

    const [, params] = pool.query.mock.calls.find(([sql]) => /UPDATE internal_tasks SET/.test(sql));
    expect(JSON.parse(params[18])).toEqual([{ id: 'old' }, { id: 'added' }]);
  });

  test('returns null without writing when the task does not exist', async () => {
    taskRow = null;

    await expect(internalTaskQueries.updateInternalTask('missing', { title: 'x' }, ACTOR)).resolves.toBeNull();
    expect(pool.query.mock.calls.some(([sql]) => /UPDATE internal_tasks SET/.test(sql))).toBe(false);
  });
});

describe('approveCreditTask on the D1 path', () => {
  test('applies a buyer credit addition in one batch and refreshes the buyer cache', async () => {
    d1Bridge.batchD1.mockResolvedValueOnce(committedBatch());

    const task = await internalTaskQueries.approveCreditTask('task-1', ACTOR, 'Approved by ops');

    const [, statements] = d1Bridge.batchD1.mock.calls[0];
    expect(statements).toHaveLength(6);
    expect(statements[1].params).toEqual([5, 'buyer-1', 'task-1', 'task-approval-task-1']);
    expect(statements[2].params[3]).toBe(5);
    expect(storeService.updateBuyerAccount).toHaveBeenCalledWith(
      'buyer-1',
      { creditBalance: 45, available_credits: 45 },
      { persist: false }
    );
    expect(task).toMatchObject({ id: 'task-1', current_account_credits: 45 });
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('internal_tasks');
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('buyer_credits');
  });

  test('applies a vendor credit grant and refreshes the vendor cache', async () => {
    taskRow = baseTaskRow({
      credit_account_type: 'VENDOR',
      credit_account_id: 'vendor-1',
      related_entity_type: 'VENDOR',
      related_entity_id: 'vendor-1',
    });
    d1Bridge.batchD1.mockResolvedValueOnce(committedBatch());

    await internalTaskQueries.approveCreditTask('task-1', ACTOR, '');

    const [, statements] = d1Bridge.batchD1.mock.calls[0];
    expect(statements[2].params.slice(1, 3)).toEqual(['CREDIT_GRANT', 5]);
    expect(pool.queryCache.invalidate).toHaveBeenCalledWith('vendor_credits');
    expect(storeService.updateVendor).toHaveBeenCalledWith(
      'vendor-1',
      { freeQuotationCredits: 30, freeRfqDownloadCredits: 30, credits: 30 },
      { persist: false }
    );
    expect(storeService.updateBuyerAccount).not.toHaveBeenCalled();
  });

  test('deducts credits when the task is a deduction request', async () => {
    taskRow = baseTaskRow({ task_type: 'Credit Deduction', title: 'Deduct credits', credit_quantity: '3' });
    d1Bridge.batchD1.mockResolvedValueOnce(committedBatch());

    await internalTaskQueries.approveCreditTask('task-1', ACTOR, 'Remove unused credits');

    const [, statements] = d1Bridge.batchD1.mock.calls[0];
    expect(statements[1].params[0]).toBe(-3);
    expect(statements[2].params[4]).toBe(3);
  });

  test('returns null when the task does not exist', async () => {
    taskRow = null;

    await expect(internalTaskQueries.approveCreditTask('missing', ACTOR)).resolves.toBeNull();
    expect(d1Bridge.batchD1).not.toHaveBeenCalled();
  });

  test('refuses an unsupported credit account type before any write', async () => {
    taskRow = baseTaskRow({ credit_account_type: 'OTHER' });

    await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).rejects.toThrow(
      'Unsupported credit account type for task IT-1.'
    );
    expect(d1Bridge.batchD1).not.toHaveBeenCalled();
  });

  test('refuses a credit task that names no account before any write', async () => {
    taskRow = baseTaskRow({ credit_account_id: null, related_entity_id: null });

    await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).rejects.toThrow(
      'Credit account is missing for task IT-1.'
    );
    expect(d1Bridge.batchD1).not.toHaveBeenCalled();
  });

  test('logs and rethrows when the D1 batch fails and leaves the account cache alone', async () => {
    d1Bridge.batchD1.mockRejectedValueOnce(new Error('d1 batch unavailable'));

    await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).rejects.toThrow('d1 batch unavailable');
    expect(logger.error).toHaveBeenCalledWith(
      'Atomic D1 credit approval batch failed',
      expect.objectContaining({ operation: 'approveCreditTask', taskId: 'task-1', queryCount: 6 }),
      'INTERNAL_TASK_CREDIT_APPROVAL'
    );
    expect(storeService.updateBuyerAccount).not.toHaveBeenCalled();
  });

  test('returns the already approved task when another request won the claim', async () => {
    d1Bridge.batchD1.mockImplementationOnce(async () => {
      taskRow = baseTaskRow({ status: 'Completed', approval_status: 'APPROVED' });
      return [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
    });

    const task = await internalTaskQueries.approveCreditTask('task-1', ACTOR);

    expect(task).toMatchObject({ approval_status: 'APPROVED', status: 'Completed' });
    expect(storeService.updateBuyerAccount).not.toHaveBeenCalled();
  });

  test('throws when the claim is lost and the task is still open', async () => {
    d1Bridge.batchD1.mockResolvedValueOnce([{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }]);

    await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).rejects.toThrow(
      'Credit task could not be claimed.'
    );
  });

  test('restores the claim and throws when no credit ledger row was written', async () => {
    const results = committedBatch();
    results[4] = { rows: [] };
    d1Bridge.batchD1.mockResolvedValueOnce(results);

    await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).rejects.toThrow(
      'Credit balance could not be updated, so the approval was rolled back.'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'D1 credit approval had no durable credit ledger row; approval claim was restored',
      expect.objectContaining({ taskId: 'task-1', accountExists: true, taskRestored: false }),
      'INTERNAL_TASK_CREDIT_APPROVAL'
    );
  });

  test('requires storage before reading the task', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
    expect(d1Bridge.batchD1).not.toHaveBeenCalled();
  });
});

describe('internal task reads with empty or partial results', () => {
  test('returns no rows and a zero total when the list and count queries have no row sets', async () => {
    pool.query.mockResolvedValueOnce({}).mockResolvedValueOnce({});

    await expect(internalTaskQueries.getInternalTasks({ limit: 0 })).resolves.toEqual({ rows: [], total: 0 });
  });

  test('summarises task counts and reads zero when the summary has no row', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(internalTaskQueries.getInternalTaskSummary()).resolves.toMatchObject({
      total: 0,
      newTasks: 0,
      pending: 0,
      overdueCount: 0,
    });

    pool.query.mockResolvedValueOnce({ rows: [{ new_tasks: 4, total: null }] });
    await expect(
      internalTaskQueries.getInternalTaskSummary({ assignedTo: 'Asha', taskCategory: 'OPS' })
    ).resolves.toMatchObject({ total: 0, pending: 4 });
  });

  test('enriches credit tasks from the account on record, with or without an account type', async () => {
    taskRow = baseTaskRow({ credit_account_type: null, credit_account_id: 'buyer-1' });
    await expect(internalTaskQueries.getInternalTaskById('task-1')).resolves.toMatchObject({
      current_account_credits: 45,
    });

    taskRow = baseTaskRow({ credit_account_type: 'VENDOR', credit_account_id: 'vendor-1' });
    vendorCredits = undefined;
    await expect(internalTaskQueries.getInternalTaskById('task-1')).resolves.toMatchObject({
      current_account_credits: null,
    });
  });

  test('requires a category before creating a task, including when no title is given', async () => {
    await expect(internalTaskQueries.createInternalTask()).rejects.toThrow();
    await expect(
      internalTaskQueries.createInternalTask({ taskType: 'Visit', priority: 'High' }, ACTOR)
    ).rejects.toThrow(/category/i);
  });

  test('keeps the previous completer when a task is completed by an actor known only by id', async () => {
    taskRow = baseTaskRow({ status: 'In Progress', completed_by_name: 'Earlier Closer' });

    await internalTaskQueries.updateInternalTask('task-1', { status: 'Completed' }, { uuid: 'ops-9' });

    const [, params] = pool.query.mock.calls.find(([sql]) => /UPDATE internal_tasks SET/.test(sql));
    expect(params[21]).toBe('Earlier Closer');
  });

  test('rejects a credit task with the default remark when none is given', async () => {
    await internalTaskQueries.rejectCreditTask('task-1', ACTOR);

    const [, activityParams] = pool.query.mock.calls
      .filter(([sql]) => /INSERT INTO internal_task_activities/.test(sql))
      .pop();
    expect(activityParams[7]).toBe('Credit request rejected by Ops Lead. Remarks: Credit request rejected.');
  });

  test('falls back to a comment action when the action type is blank', async () => {
    await expect(
      internalTaskQueries.addTaskActivity('task-1', { comment: 'Called the buyer', actionType: '' }, ACTOR)
    ).resolves.toMatchObject({ task_id: 'task-1', action_type: 'COMMENT', actor_name: 'Ops Lead' });
  });

  test('records an empty comment and the default action when only a task is given', async () => {
    await expect(internalTaskQueries.addTaskActivity('task-1', undefined, ACTOR)).resolves.toMatchObject({
      action_type: 'COMMENT',
      comment: '',
    });
  });

  test('returns empty lists when the database responds without a row set', async () => {
    pool.query.mockResolvedValue({});

    await expect(internalTaskQueries.getOverdueAndUpcomingTasks()).resolves.toEqual([]);
    await expect(internalTaskQueries.listAllInternalTasks()).resolves.toEqual([]);
    await expect(internalTaskQueries.getInternalAssignees()).resolves.toEqual([]);
    await expect(internalTaskQueries.searchRelatedEntities(undefined, 'x')).resolves.toEqual([]);
    for (const type of ['RFQ', 'BUYER', 'VENDOR', 'CATEGORY', 'USER', 'PAYMENT']) {
      await expect(internalTaskQueries.searchRelatedEntities(type, 'x')).resolves.toEqual([]);
    }
  });

  test('labels assignees from whichever name and contact fields are present', async () => {
    pool.query.mockImplementation(async (sql) => {
      if (/FROM "user"/.test(sql)) {
        return { rows: [{ id: 'u-1', name: 'Asha Rao', roleName: null, email: null }] };
      }
      if (/SELECT DISTINCT assigned_to_user_id/.test(sql)) {
        return { rows: [{ assigned_to_user_id: null, assigned_to_name: 'Bilal Khan' }] };
      }
      return { rows: [] };
    });

    await expect(internalTaskQueries.getInternalAssignees()).resolves.toEqual([
      { id: 'u-1', name: 'Asha Rao', role: null, email: null, project: null },
      { id: null, name: 'Bilal Khan', role: null, email: null, project: null },
    ]);
  });

  test('uses a generic label for users without a name and the best available contact as secondary text', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        { uuid: 'u-9', full_name: null, username: null, email: 'ops@procure.test' },
        { uuid: 'u-10', full_name: null, username: null, email: null },
      ],
    });

    await expect(internalTaskQueries.searchRelatedEntities('USER', 'ops')).resolves.toEqual([
      { id: 'u-9', label: 'User', secondary: 'ops@procure.test', entityType: 'USER' },
      { id: 'u-10', label: 'User', secondary: '', entityType: 'USER' },
    ]);
  });
});

describe('approveCreditTask fallbacks and deductions on the D1 path', () => {
  test('uses the task id in refusal messages when no task number is recorded', async () => {
    taskRow = baseTaskRow({ task_number: null, credit_account_type: 'OTHER' });
    await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).rejects.toThrow(
      'Unsupported credit account type for task task-1.'
    );

    taskRow = baseTaskRow({ task_number: null, credit_account_id: null, related_entity_id: null });
    await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).rejects.toThrow(
      'Credit account is missing for task task-1.'
    );
  });

  test('applies a vendor deduction and records the deduction type on the ledger', async () => {
    taskRow = baseTaskRow({
      task_type: 'Delete Credits',
      credit_account_type: 'VENDOR',
      credit_account_id: 'vendor-1',
      related_entity_type: 'VENDOR',
      related_entity_id: 'vendor-1',
    });
    d1Bridge.batchD1.mockResolvedValueOnce(committedBatch());

    await internalTaskQueries.approveCreditTask('task-1', ACTOR, 'Remove unused credits');

    const [, statements] = d1Bridge.batchD1.mock.calls[0];
    expect(statements[1].params[0]).toBe(-5);
    expect(statements[2].params.slice(1, 3)).toEqual(['CREDIT_DEDUCTION', 5]);
  });

  test('derives the vendor account from the related entity and treats missing task details as zero credits', async () => {
    taskRow = baseTaskRow({
      credit_account_type: null,
      related_entity_type: 'VENDOR',
      credit_account_id: 'vendor-1',
      related_entity_id: 'vendor-1',
      task_type: null,
      title: null,
      credit_quantity: null,
      approval_status: null,
    });
    d1Bridge.batchD1.mockResolvedValueOnce(committedBatch());

    await internalTaskQueries.approveCreditTask('task-1', ACTOR);

    const [, statements] = d1Bridge.batchD1.mock.calls[0];
    expect(statements[1].params[0]).toBe(0);
    expect(statements[2].params.slice(1, 3)).toEqual(['CREDIT_GRANT', 0]);
    expect(statements[5].params[0]).toBeNull();
    expect(storeService.updateVendor).toHaveBeenCalledWith('vendor-1', expect.any(Object), { persist: false });
  });

  test('applies a buyer credit to an account identified only by its id', async () => {
    taskRow = baseTaskRow({ credit_account_type: null, related_entity_type: null });
    d1Bridge.batchD1.mockResolvedValueOnce(committedBatch());

    await internalTaskQueries.approveCreditTask('task-1', ACTOR);

    const [, statements] = d1Bridge.batchD1.mock.calls[0];
    expect(statements[2].text).toContain('buyer_credit_transactions');
  });

  test('returns null from the refreshed read when the task is gone after the batch and leaves caches untouched', async () => {
    d1Bridge.batchD1.mockImplementationOnce(async () => {
      taskRow = null;
      return committedBatch();
    });

    await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).resolves.toBeNull();
    expect(storeService.updateBuyerAccount).not.toHaveBeenCalled();
  });

  test('leaves the vendor record unchanged when the vendor service method is unavailable', async () => {
    taskRow = baseTaskRow({
      credit_account_type: 'VENDOR',
      credit_account_id: 'vendor-1',
      related_entity_type: 'VENDOR',
    });
    const original = storeService.updateVendor;
    storeService.updateVendor = undefined;

    try {
      d1Bridge.batchD1.mockResolvedValueOnce(committedBatch());
      await expect(internalTaskQueries.approveCreditTask('task-1', ACTOR)).resolves.toMatchObject({ id: 'task-1' });
    } finally {
      storeService.updateVendor = original;
    }
  });
});

describe('storage outage errors carry a 503 status', () => {
  test('refuses a task read with a 503 when no database is configured and runs no query', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(internalTaskQueries.getTaskTypes()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      statusCode: 503,
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('keeps the 503 status and the original cause when a task query fails', async () => {
    const cause = new Error('D1 overloaded');
    pool.query.mockRejectedValueOnce(cause);

    await expect(internalTaskQueries.getTaskTypes()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      statusCode: 503,
      cause,
    });
  });
});

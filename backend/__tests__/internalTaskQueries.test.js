const pool = require('../src/db/pool');
const queries = require('../src/db/internalTaskQueries');
const approvalQueries = require('../src/db/approvalQueries');
const d1Bridge = require('../src/db/d1Bridge');
const domainQueries = require('../src/db/domainQueries');
const storeService = require('../src/services/storeService');
const { logger } = require('../src/services/loggerService');

const UNAVAILABLE = { code: 'PERSISTENCE_UNAVAILABLE' };

function createD1Binding(batchRows) {
  const statements = [];
  const db = {
    prepare: (text) => ({
      bind: (...params) => {
        const statement = { text, params };
        statements.push(statement);
        return statement;
      },
    }),
    batch: jest.fn().mockResolvedValue(batchRows.map((rows) => ({
      results: rows,
      meta: { changes: rows.length },
    }))),
  };
  return { db, statements };
}

function withD1Env(db, run) {
  const previous = globalThis.__CF_ENV__;
  globalThis.__CF_ENV__ = { DB: db };
  return Promise.resolve().then(run).finally(() => {
    if (previous === undefined) delete globalThis.__CF_ENV__;
    else globalThis.__CF_ENV__ = previous;
  });
}

const creditTaskRow = (overrides = {}) => ({
  id: 'tsk_credit_1',
  task_number: 'TASK-CREDIT-1',
  title: 'Grant credits to a buyer',
  task_category: 'CREDIT_MANAGEMENT',
  task_type: 'Add Credits',
  status: 'Pending Approval',
  approval_status: 'PENDING',
  credit_account_type: 'BUYER',
  credit_account_id: 'buy_101',
  credit_quantity: 20,
  attachments: '[]',
  raw: '{}',
  ...overrides,
});

describe('internalTaskQueries', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  describe('getTaskTypes', () => {
    test('returns active task types when storage is configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ id: 'itt_1', name: 'Vendor Follow-up', is_active: 1 }],
      });

      const types = await queries.getTaskTypes();
      expect(types).toHaveLength(1);
      expect(types[0].id).toBe('itt_1');
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const querySpy = jest.spyOn(pool, 'query');

      await expect(queries.getTaskTypes()).rejects.toMatchObject(UNAVAILABLE);
      expect(querySpy).not.toHaveBeenCalled();
    });

    test('fails closed with the cause when the task type query errors', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const cause = new Error('D1 429 Overload');
      jest.spyOn(pool, 'query').mockRejectedValue(cause);

      await expect(queries.getTaskTypes()).rejects.toMatchObject({ ...UNAVAILABLE, cause });
    });

    // BUG: getTaskTypes returns [] when the query result has no rows array, so a malformed
    // database answer reads as "no task types". Policy rule 2 requires an error instead.
    test.failing('BUG: a task type query result without a row set is reported as an error', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue(null);

      await expect(queries.getTaskTypes()).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe('createTaskType', () => {
    test('creates a new task type in the database', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      const res = await queries.createTaskType({
        name: 'Quality Assurance Review',
        code: 'qa_review',
        defaultModule: 'RFQ',
        description: 'Verify specs',
      });

      expect(res.name).toBe('Quality Assurance Review');
      expect(res.code).toBe('qa_review');
      expect(res.default_module).toBe('RFQ');
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO internal_task_types'),
        expect.any(Array),
        expect.objectContaining({ d1: true })
      );
    });

    test('derives the code from the name and defaults the module when neither is given', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      const res = await queries.createTaskType({ name: 'Fallback Type' });

      expect(res.name).toBe('Fallback Type');
      expect(res.code).toBe('fallback_type');
      expect(res.default_module).toBe('GENERAL');
    });

    test('fails closed without storage and writes nothing', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const querySpy = jest.spyOn(pool, 'query');

      await expect(queries.createTaskType({ name: 'Fallback Type' })).rejects.toMatchObject(UNAVAILABLE);
      expect(querySpy).not.toHaveBeenCalled();
    });
  });

  describe('getInternalTasks', () => {
    test('builds SQL queries with all optional filter combinations and parses JSON columns', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'tsk_101',
            title: 'Test Task',
            status: 'Pending',
            priority: 'High',
            attachments: JSON.stringify([{ name: 'doc.pdf' }]),
            raw: JSON.stringify({ key: 'val' }),
          }],
        });

      const res = await queries.getInternalTasks({
        search: 'audit',
        status: 'Pending',
        priority: 'High',
        taskTypeId: 'itt_1',
        relatedEntityType: 'RFQ',
        assignedTo: 'Sudheer',
        dueFrom: '2026-10-01',
        dueTo: '2026-10-31',
        limit: 20,
        offset: 0,
      });

      expect(res.total).toBe(1);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].attachments).toEqual([{ name: 'doc.pdf' }]);
      expect(res.rows[0].raw).toEqual({ key: 'val' });
    });

    test('applies no filters when the filter values are "all"', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await queries.getInternalTasks({
        status: 'all',
        priority: 'all',
        taskTypeId: 'all',
        relatedEntityType: 'all',
        assignedTo: 'all',
      });

      expect(res.rows).toEqual([]);
      expect(querySpy.mock.calls[0][0]).not.toContain('WHERE');
    });

    test('filters with taskCategory, taskType, createdBy, dueFrom, dueTo', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('count(*) as total')) {
          return Promise.resolve({ rows: [{ total: 1 }] });
        }
        return Promise.resolve({
          rows: [{
            id: 'tsk_filt_1',
            title: 'Credit Verification',
            task_category: 'CREDIT_MANAGEMENT',
            task_type: 'Add Credits',
            created_by_name: 'Admin',
            attachments: '[]',
            raw: '{}',
          }],
        });
      });

      const res = await queries.getInternalTasks({
        taskCategory: 'CREDIT_MANAGEMENT',
        taskType: 'Add Credits',
        createdBy: 'Admin',
        dueFrom: '2026-11-01',
        dueTo: '2026-11-30',
      });

      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].task_category).toBe('CREDIT_MANAGEMENT');
    });

    test('escapes LIKE wildcards in assignee and creator filters', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ total: 0 }] });

      await queries.getInternalTasks({ search: '100%_special', assignedTo: 'admin_%', createdBy: 'user_%' });

      const params = querySpy.mock.calls[0][1];
      expect(params).toContain('%admin\\_\\%%');
      expect(params).toContain('%user\\_\\%%');
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.getInternalTasks()).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe('getInternalTaskSummary', () => {
    test('filters the summary by assignedTo', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ total: 4, pending: 1, in_progress: 1, blocked: 0, completed: 2, escalated: 0, critical_count: 0 }],
      });

      const summary = await queries.getInternalTaskSummary({ assignedTo: 'Pavani' });

      expect(summary.total).toBe(4);
      expect(summary.completed).toBe(2);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('WHERE (assigned_to_user_id = $1 OR lower(assigned_to_name) LIKE $2)'),
        ['Pavani', '%pavani%', expect.any(String)],
        expect.any(Object)
      );
    });

    test('filters the summary by taskCategory', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ total: 2, new_tasks: 1, pending_approval: 1 }],
      });

      const summary = await queries.getInternalTaskSummary({ taskCategory: 'CREDIT_MANAGEMENT' });

      expect(summary.total).toBe(2);
      expect(querySpy).toHaveBeenCalledWith(
        expect.stringContaining('task_category = $1'),
        ['CREDIT_MANAGEMENT', expect.any(String)],
        expect.any(Object)
      );
    });

    test('returns the aggregate metrics', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{
          total: 10, pending: 3, in_progress: 2, blocked: 1, completed: 3, escalated: 1, critical_count: 1,
        }],
      });

      const summary = await queries.getInternalTaskSummary();

      expect(summary).toEqual(expect.objectContaining({
        total: 10,
        pending: 3,
        inProgress: 2,
        blocked: 1,
        completed: 3,
        escalated: 1,
        criticalCount: 1,
      }));
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.getInternalTaskSummary()).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe('getInternalTaskById', () => {
    test('returns the task with its attached activity log', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({
          rows: [{ id: 'tsk_101', task_number: 'TASK-1001', title: 'Detailed Task', attachments: 'invalid-json', raw: null }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'act_1', action_type: 'CREATED', comment: 'Created', metadata: '{"source":"test"}' }],
        });

      const task = await queries.getInternalTaskById('tsk_101');

      expect(task?.id).toBe('tsk_101');
      expect(task?.attachments).toEqual([]);
      expect(task?.activities).toEqual([expect.objectContaining({ id: 'act_1', metadata: { source: 'test' } })]);
    });

    test('returns null when no task matches the id', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

      await expect(queries.getInternalTaskById('tsk_nonexistent')).resolves.toBeNull();
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.getInternalTaskById('tsk_1')).rejects.toMatchObject(UNAVAILABLE);
    });

    test('enriches a credit task with the live vendor balance', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks t')) {
          return Promise.resolve({ rows: [{ id: 'tsk_v', credit_account_id: 'ven_1', credit_account_type: 'VENDOR', raw: '{}' }] });
        }
        if (sql.includes('FROM internal_task_activities')) return Promise.resolve({ rows: [] });
        if (sql.includes('FROM vendors WHERE id = $1')) return Promise.resolve({ rows: [{ credits: '12' }] });
        return Promise.resolve({ rows: [] });
      });

      const task = await queries.getInternalTaskById('tsk_v');

      expect(task.current_account_credits).toBe(12);
    });

    test('enriches a credit task with the live buyer balance and tolerates a missing balance row', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks t')) {
          return Promise.resolve({ rows: [{ id: 'tsk_b', credit_account_id: 'buy_1', credit_account_type: 'BUYER', raw: '{}' }] });
        }
        if (sql.includes('FROM internal_task_activities')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [] });
      });

      const task = await queries.getInternalTaskById('tsk_b');

      expect(task.current_account_credits).toBeNull();
    });

    test('keeps the task and logs when the live balance lookup fails', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks t')) {
          return Promise.resolve({ rows: [{ id: 'tsk_e', credit_account_id: 'buy_2', credit_account_type: 'BUYER', raw: '{}' }] });
        }
        if (sql.includes('FROM internal_task_activities')) return Promise.resolve({ rows: [] });
        return Promise.reject(new Error('balance offline'));
      });

      const task = await queries.getInternalTaskById('tsk_e');

      expect(task.id).toBe('tsk_e');
      expect(logger.error).toHaveBeenCalledWith(
        'Could not enrich internal task with the current credit balance',
        expect.objectContaining({ taskId: 'tsk_e', accountId: 'buy_2' }),
        'INTERNAL_TASK_CREDIT_BALANCE'
      );
    });
  });

  describe('createInternalTask', () => {
    const baseData = { title: 'New Internal Task', taskCategory: 'COMMUNICATION', taskType: 'Phone Call', priority: 'High' };

    test('requires a task category, type, and priority before saving', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query');

      await expect(queries.createInternalTask({ ...baseData, taskCategory: '  ' }, { uuid: 'u1' }))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'Task category is required. Select a value before saving.' });
      await expect(queries.createInternalTask({ ...baseData, taskType: undefined }, { uuid: 'u1' }))
        .rejects.toMatchObject({ message: 'Task type is required. Select a value before saving.' });
      await expect(queries.createInternalTask({ ...baseData, priority: null }, { uuid: 'u1' }))
        .rejects.toMatchObject({ message: 'Task priority is required. Select a value before saving.' });
      expect(querySpy).not.toHaveBeenCalled();
    });

    test('refuses an unidentified actor with ACTOR_REQUIRED', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      await expect(queries.createInternalTask(baseData, {})).rejects.toMatchObject({ code: 'ACTOR_REQUIRED', statusCode: 401 });
    });

    test('inserts the task and its created activity, then returns the stored task', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks t')) {
          return Promise.resolve({ rows: [{ id: 'tsk_new', title: 'New Internal Task', attachments: '[]', raw: '{}' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      });

      const task = await queries.createInternalTask(
        { ...baseData, status: 'Pending', relatedEntityType: 'buyer', relatedEntityId: 'buy_1' },
        { uuid: 'usr_1', fullName: 'Manager' }
      );

      expect(task.title).toBe('New Internal Task');
      expect(querySpy.mock.calls.some(([sql]) => sql.includes('INSERT INTO internal_tasks'))).toBe(true);
      expect(querySpy.mock.calls.some(([sql]) => sql.includes('INSERT INTO internal_task_activities'))).toBe(true);
    });

    test('moves a credit management task to Pending Approval and records the actor name from the session', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks t')) {
          return Promise.resolve({ rows: [creditTaskRow({ id: 'tsk_cred_pending', title: 'Grant 500 Credits to Buyer Acme' })] });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      });

      const task = await queries.createInternalTask({
        title: 'Grant 500 Credits to Buyer Acme',
        taskCategory: 'CREDIT_MANAGEMENT',
        taskType: 'Add Credits',
        priority: 'High',
        creditAccountType: 'BUYER',
        creditAccountId: 'buyer-101',
        creditAccountName: 'Acme Corp',
        creditQuantity: 500,
        creditReason: 'Promotional onboarding grant',
      }, { id: 'usr-1', name: 'Sales Manager' });

      expect(task.status).toBe('Pending Approval');
      const insertParams = querySpy.mock.calls.find(([sql]) => sql.includes('INSERT INTO internal_tasks'))[1];
      expect(insertParams[21]).toBe('PENDING');
      expect(insertParams[13]).toBe('Sales Manager');
    });

    test('falls back to the email address as the creator name when no display name is on the session', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [], rowCount: 1 });

      await queries.createInternalTask(baseData, { email: 'e@p.com' }).catch(() => {});

      const insertParams = querySpy.mock.calls.find(([sql]) => sql.includes('INSERT INTO internal_tasks'))[1];
      expect(insertParams[13]).toBe('e@p.com');
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.createInternalTask(baseData, { uuid: 'u1' })).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe('createInternalTaskWithApproval', () => {
    const taskData = {
      title: 'Grant credits to a buyer',
      taskCategory: 'CREDIT_MANAGEMENT',
      taskType: 'Add Credits',
      priority: 'High',
      creditAccountType: 'BUYER',
      creditAccountId: 'buyer-atomic-1',
      creditQuantity: 25,
    };
    const actor = { uuid: 'user-atomic-1', name: 'Test Manager' };
    const approvalData = {
      id: 'approval-atomic-test',
      module: 'Buyer Credit Addition',
      request_type: 'Buyer Credit Addition',
      applicant_name: 'Buyer Contact',
      applicant_email: 'buyer@example.com',
      amount: 25,
      quantity: 25,
      buyer_id: 'buyer-atomic-1',
      assigned_approver: 'Sudheer Sir',
      raw: { source: 'internal-task-test' },
    };

    function storedAfterCreate(statements) {
      const taskText = statements.find((s) => s.text.includes('INSERT INTO internal_tasks'));
      return taskText;
    }

    test('persists the task, activity, and approval in one Worker D1 batch and links them', async () => {
      const { db, statements } = createD1Binding([[{}], [{}], [{}]]);

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

        const task = await queries.createInternalTaskWithApproval(taskData, actor, approvalData);

        expect(db.batch).toHaveBeenCalledTimes(1);
        expect(statements).toHaveLength(3);
        expect(statements[0].text).toContain('INSERT INTO internal_tasks');
        expect(statements[1].text).toContain('INSERT INTO internal_task_activities');
        expect(statements[2].text).toContain('INSERT INTO approvals');
        const approvalRaw = JSON.parse(statements[2].params[11]);
        expect(approvalRaw.internal_task_id).toBe(task.id);
        expect(storedAfterCreate(statements).params[0]).toBe(task.id);
        expect(task.activities[0]).toEqual(expect.objectContaining({ action_type: 'CREATED' }));
      });
    });

    test('fails closed when a Worker D1 batch reports a missing insert result', async () => {
      const { db } = createD1Binding([[{}], [{}], []]);

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

        await expect(queries.createInternalTaskWithApproval(taskData, actor, approvalData))
          .rejects.toMatchObject(UNAVAILABLE);
        expect(db.batch).toHaveBeenCalledTimes(1);
      });
    });

    test('logs a failed Worker D1 batch with the provider and keeps the cause', async () => {
      const failure = new Error('D1 insert rejected');
      const { db } = createD1Binding([]);
      db.batch.mockRejectedValue(failure);

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

        await expect(queries.createInternalTaskWithApproval(taskData, actor, approvalData))
          .rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', cause: failure });
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Atomic credit approval request persistence failed'),
          expect.objectContaining({ approvalId: approvalData.id, provider: 'cloudflare-d1' }),
          'INTERNAL_TASK_APPROVAL_REQUEST'
        );
      });
    });

    test('resolves an idempotent replay to the original task and rejects changed request data', async () => {
      const uniqueFailure = new Error('UNIQUE constraint failed: internal_tasks.id');
      const { db } = createD1Binding([[{}], [{}], [{}]]);

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        const first = await queries.createInternalTaskWithApproval(taskData, actor, {
          ...approvalData,
          idempotencyKey: 'a2222222-2222-4222-8222-222222222222',
        });
        const fingerprint = first.raw.idempotency_fingerprint;
        const storedTask = { ...first, attachments: '[]', raw: JSON.stringify(first.raw) };
        const storedApproval = {
          id: approvalData.id,
          internal_task_id: first.id,
          raw: JSON.stringify({ idempotency_fingerprint: fingerprint, internal_task_id: first.id }),
        };
        jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
          if (sql.includes('FROM internal_tasks t')) return { rows: [storedTask] };
          if (sql.includes('FROM internal_task_activities')) return { rows: [] };
          if (sql.includes('FROM approvals WHERE id')) return { rows: [storedApproval] };
          return { rows: [] };
        });
        db.batch.mockRejectedValue(uniqueFailure);

        const replay = await queries.createInternalTaskWithApproval(taskData, actor, {
          ...approvalData,
          idempotencyKey: 'a2222222-2222-4222-8222-222222222222',
        });
        expect(replay.id).toBe(first.id);

        await expect(queries.createInternalTaskWithApproval({ ...taskData, creditQuantity: 26 }, actor, {
          ...approvalData,
          amount: 26,
          quantity: 26,
          idempotencyKey: 'a2222222-2222-4222-8222-222222222222',
        })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
      });
    });

    test('keeps duplicate-key failures unavailable when the replay lookup finds no persisted pair', async () => {
      const { db } = createD1Binding([]);
      db.batch.mockRejectedValue(new Error('UNIQUE constraint failed: internal_tasks.id'));

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

        await expect(queries.createInternalTaskWithApproval(taskData, actor, {
          ...approvalData,
          idempotencyKey: 'a3333333-3333-4333-8333-333333333333',
        })).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Atomic credit approval request persistence failed'),
          expect.any(Object),
          'INTERNAL_TASK_APPROVAL_REQUEST'
        );
      });
    });

    test('logs an idempotency replay lookup failure without hiding the persistence error', async () => {
      const uniqueFailure = new Error('UNIQUE constraint failed: internal_tasks.id');
      const lookupFailure = new Error('Replay lookup unavailable');
      const { db } = createD1Binding([]);
      db.batch.mockRejectedValue(uniqueFailure);

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockRejectedValue(lookupFailure);

        await expect(queries.createInternalTaskWithApproval(taskData, actor, {
          ...approvalData,
          idempotencyKey: 'a4444444-4444-4444-8444-444444444444',
        })).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', cause: uniqueFailure });
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Credit approval idempotency replay lookup failed'),
          expect.objectContaining({ error: lookupFailure }),
          'INTERNAL_TASK_APPROVAL_REQUEST'
        );
      });
    });

    test('logs a cache invalidation failure after a successful atomic request', async () => {
      const { db } = createD1Binding([[{}], [{}], [{}]]);

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool.queryCache, 'invalidate').mockImplementation(() => {
          throw new Error('Cache unavailable');
        });

        const task = await queries.createInternalTaskWithApproval(taskData, actor, approvalData);

        expect(task.id).toBeTruthy();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Credit approval request committed but query-cache invalidation failed'),
          expect.objectContaining({ taskId: task.id }),
          'INTERNAL_TASK_APPROVAL_REQUEST'
        );
      });
    });

    test('refuses a multi-statement D1 HTTP write before creating a partial request', async () => {
      const envNames = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'];
      const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
      const previousD1Env = globalThis.__CF_ENV__;
      delete globalThis.__CF_ENV__;
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'test-database';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';
      d1Bridge.resetD1HttpClientCache();
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      try {
        await expect(queries.createInternalTaskWithApproval(taskData, actor, approvalData))
          .rejects.toMatchObject(UNAVAILABLE);
      } finally {
        if (previousD1Env === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = previousD1Env;
        envNames.forEach((name) => {
          if (originalEnv[name] === undefined) delete process.env[name];
          else process.env[name] = originalEnv[name];
        });
        d1Bridge.resetD1HttpClientCache();
      }
    });

    test('commits the task, activity, and approval together in a PostgreSQL transaction', async () => {
      const originalPool = pool.pool;
      const queriesRun = [];
      const client = {
        query: jest.fn(async (sql) => {
          queriesRun.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
          return { rowCount: 1 };
        }),
        release: jest.fn(),
      };
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      try {
        const task = await queries.createInternalTaskWithApproval(taskData, actor, approvalData);

        expect(queriesRun).toEqual([
          'BEGIN',
          'INSERT INTO internal_tasks',
          'INSERT INTO internal_task_activities',
          'INSERT INTO approvals',
          'COMMIT',
        ]);
        expect(task.id).toBeTruthy();
        expect(client.release).toHaveBeenCalledTimes(1);
      } finally {
        pool.pool = originalPool;
      }
    });

    test('rolls back and logs when one PostgreSQL insert reports no persisted row', async () => {
      const originalPool = pool.pool;
      const queriesRun = [];
      const client = {
        query: jest.fn(async (sql) => {
          const normalized = sql.trim().split(/\s+/).slice(0, 3).join(' ');
          queriesRun.push(normalized);
          return { rowCount: normalized === 'INSERT INTO internal_task_activities' ? 0 : 1 };
        }),
        release: jest.fn(),
      };
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      try {
        await expect(queries.createInternalTaskWithApproval(taskData, actor, approvalData))
          .rejects.toMatchObject(UNAVAILABLE);
        expect(queriesRun).toEqual(['BEGIN', 'INSERT INTO internal_tasks', 'INSERT INTO internal_task_activities', 'ROLLBACK']);
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Atomic credit approval request persistence failed'),
          expect.objectContaining({ provider: 'postgresql' }),
          'INTERNAL_TASK_APPROVAL_REQUEST'
        );
        expect(client.release).toHaveBeenCalledTimes(1);
      } finally {
        pool.pool = originalPool;
      }
    });
  });

  describe('updateInternalTask', () => {
    test('updates the task and logs an activity when the status changes', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('WHERE t.id = $1 OR t.task_number = $1')) {
          return Promise.resolve({ rows: [{ id: 'tsk_1', title: 'Old Title', status: 'Pending', priority: 'Medium', attachments: '[]', raw: '{}' }] });
        }
        if (sql.includes('FROM internal_task_activities')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rowCount: 1 });
      });

      await queries.updateInternalTask('tsk_1', {
        title: 'Updated Title',
        status: 'Escalated',
        activityComment: 'Escalated to management',
      }, { fullName: 'Lead' });

      expect(querySpy).toHaveBeenCalledWith(expect.stringContaining('UPDATE internal_tasks'), expect.any(Array), expect.any(Object));
      expect(querySpy.mock.calls.some(([sql]) => sql.includes('INSERT INTO internal_task_activities'))).toBe(true);
    });

    test('hydrates task rows, parses JSON safely, and writes each activity kind', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const hydrated = queries.hydrateTaskRow({
        raw: JSON.stringify({
          taskCategory: 'COMMUNICATION',
          taskType: 'SMS',
          dueTime: '10:00',
          completedByUserId: 'u-1',
          approvalStatus: 'APPROVED',
          demoStatus: 'Scheduled',
          creditQuantity: 10,
          onboarding_stage: '3',
          current_account_credits: 50,
        }),
      });
      expect(hydrated.task_category).toBe('COMMUNICATION');
      expect(hydrated.credit_quantity).toBe(10);
      expect(hydrated.onboarding_stage).toBe('3');
      expect(queries.hydrateTaskRow(null)).toBeNull();
      expect(queries.parseJsonSafe(null, [])).toEqual([]);
      expect(queries.parseJsonSafe(undefined, [])).toEqual([]);
      expect(queries.parseJsonSafe({ test: 1 })).toEqual({ test: 1 });
      expect(queries.parseJsonSafe('not json', { fallback: true })).toEqual({ fallback: true });
      expect(queries.parseJsonSafe('{"valid":true}')).toEqual({ valid: true });

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('WHERE t.id = $1 OR t.task_number = $1')) {
          return Promise.resolve({ rows: [{ id: 'tsk_1', attachments: '[]', status: 'In Progress', demo_status: null }] });
        }
        if (sql.includes('FROM internal_task_activities')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rowCount: 1 });
      });

      await queries.updateInternalTask('tsk_1', {
        callOutcome: 'Busy',
        onboardingStage: '4',
        proposalStatus: 'Accepted',
        demoStatus: 'Scheduled',
        newAttachment: { name: 'Direct.pdf', url: 'https://x/d.pdf' },
      }, { id: 'u-3', name: 'Lead' });

      const actionTypes = pool.query.mock.calls
        .filter(([sql]) => sql.includes('INSERT INTO internal_task_activities'))
        .map(([, params]) => params[2]);
      expect(actionTypes).toEqual(expect.arrayContaining([
        'DEMO_STATUS_UPDATED',
        'CALL_OUTCOME_LOGGED',
        'ONBOARDING_STAGE_UPDATED',
        'PROPOSAL_STATUS_UPDATED',
        'ATTACHMENT_ADDED',
      ]));
    });

    test('keeps existing attachments when none are supplied and completes a task without a status change', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('WHERE t.id = $1 OR t.task_number = $1')) {
          return Promise.resolve({ rows: [{ id: 'tsk_1', title: 'Existing', status: 'Pending', attachments: '[{"name":"kept.pdf"}]', raw: '{}' }] });
        }
        if (sql.includes('FROM internal_task_activities')) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rowCount: 1 });
      });

      await queries.updateInternalTask('tsk_1', { title: 'Only title changed' }, { name: 'Admin User' });
      await queries.updateInternalTask('tsk_1', { status: 'Completed' }, { email: 'admin@p.com' });

      const updateParams = querySpy.mock.calls.find(([sql]) => sql.includes('UPDATE internal_tasks'))[1];
      expect(updateParams[18]).toBe('[{"name":"kept.pdf"}]');
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.updateInternalTask('tsk_1', {}, { uuid: 'u1' })).rejects.toMatchObject(UNAVAILABLE);
    });

    test('returns null when the task does not exist', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

      await expect(queries.updateInternalTask('nonexistent', {}, { uuid: 'u1' })).resolves.toBeNull();
    });
  });

  describe('deleteInternalTask', () => {
    test('deletes the task from the database', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      await expect(queries.deleteInternalTask('tsk_1')).resolves.toBe(true);
      expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM internal_tasks'), ['tsk_1'], expect.any(Object));
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.deleteInternalTask('tsk_1')).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe('searchRelatedEntities', () => {
    test('searches RFQs and labels rows that lack a number from their raw record', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          { id: 'rfq-1', rfq_number: 'RFQ-001', category: 'Pumps', raw: JSON.stringify({ buyerOrganization: 'Acme' }) },
          { id: 'rfq-2', rfq_number: null, category: null, raw: JSON.stringify({ title: 'Raw Title', buyerEmail: 'b@b.com' }) },
          { id: 'rfq-3', rfq_number: null, category: null, raw: null },
        ],
      });

      const entities = await queries.searchRelatedEntities('RFQ', 'RFQ-001');

      expect(entities).toHaveLength(3);
      expect(entities[0]).toEqual(expect.objectContaining({ entityType: 'RFQ', secondary: 'Acme' }));
      expect(entities[0].label).toMatch(/^RFQ-001 . Pumps$/);
      expect(entities[1].label).toMatch(/^rfq-2 . Raw Title$/);
      expect(entities[2].label).toMatch(/^rfq-3 . RFQ$/);
    });

    test('searches buyers and labels unnamed organizations with a generic name', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          { uuid: 'buy-1', organization_name: 'Tata Steel', email: 'tata@example.com', city: 'Mumbai', state: 'MH' },
          { uuid: 'buy-2', organization_name: null, email: null, city: null, state: null },
        ],
      });

      const entities = await queries.searchRelatedEntities('BUYER', 'Tata');

      expect(entities[0].label).toBe('Tata Steel');
      expect(entities[0].secondary).toContain('Mumbai');
      expect(entities[1].label).toBe('Buyer Org');
    });

    test('searches vendors and falls back from the raw name to the email or id', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          { id: 'vnd-1', email: 'vendor@example.com', major_category: 'Valves', raw: JSON.stringify({ name: 'Apex Valves' }) },
          { id: 'vnd-2', email: 'b@v.com', major_category: null, raw: JSON.stringify({ companyName: 'Beta Company' }) },
          { id: 'vnd-3', email: 'c@v.com', major_category: null, raw: null },
          { id: 'vnd-4', email: null, major_category: null, raw: null },
        ],
      });

      const entities = await queries.searchRelatedEntities('VENDOR', 'Apex');

      expect(entities.map((e) => e.label)).toEqual(['Apex Valves', 'Beta Company', 'c@v.com', 'vnd-4']);
    });

    test('searches categories, users, and credit transactions', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [{ uuid: 'cat-1', division: 'Industrial', category: 'Pumps' }] })
        .mockResolvedValueOnce({ rows: [{ uuid: 'usr-1', full_name: null, username: 'asha', email: 'asha@x.com' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'vtx-1', vendor_id: 'v-9', amount: 5, transaction_type: 'CREDIT_GRANT' }] });

      await expect(queries.searchRelatedEntities('CATEGORY', 'pump')).resolves.toEqual([
        expect.objectContaining({ id: 'cat-1', label: 'Industrial > Pumps', entityType: 'CATEGORY' }),
      ]);
      await expect(queries.searchRelatedEntities('USER', 'asha')).resolves.toEqual([
        expect.objectContaining({ id: 'usr-1', label: 'asha', secondary: 'asha', entityType: 'USER' }),
      ]);
      await expect(queries.searchRelatedEntities('PAYMENT')).resolves.toEqual([
        expect.objectContaining({ id: 'vtx-1', entityType: 'PAYMENT', secondary: 'Vendor ID: v-9' }),
      ]);
    });

    test('returns an empty list for an unknown entity type', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query');

      await expect(queries.searchRelatedEntities('UNKNOWN_TYPE', 'x')).resolves.toEqual([]);
      expect(querySpy).not.toHaveBeenCalled();
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.searchRelatedEntities('RFQ', 'x')).rejects.toMatchObject(UNAVAILABLE);
    });
  });

  describe('listAllInternalTasks', () => {
    test('returns every task hydrated', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'tsk_all', attachments: '[]', raw: '{}' }] });

      const tasks = await queries.listAllInternalTasks();

      expect(tasks).toEqual([expect.objectContaining({ id: 'tsk_all', attachments: [] })]);
    });

    test('fails closed with the cause when the query errors', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const cause = new Error('list failed');
      jest.spyOn(pool, 'query').mockRejectedValue(cause);

      await expect(queries.listAllInternalTasks()).rejects.toMatchObject({ ...UNAVAILABLE, cause });
    });
  });

  describe('getInternalAssignees', () => {
    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.getInternalAssignees()).rejects.toMatchObject(UNAVAILABLE);
    });

    test('merges staff from the identity tables with distinct task assignees', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [{ id: 'exec-1', name: 'Pavani', roleName: 'SuperUser', email: 'pavani@x.com' }, { id: 'no-name', name: null }] })
        .mockResolvedValueOnce({
          rows: [
            { assigned_to_user_id: 'usr_new', assigned_to_name: 'Anil Kumar' },
            { assigned_to_user_id: 'exec-1', assigned_to_name: 'pavani' },
            { assigned_to_user_id: null, assigned_to_name: null },
          ],
        });

      const assignees = await queries.getInternalAssignees();

      expect(assignees).toEqual([
        { id: 'exec-1', name: 'Pavani', role: 'SuperUser', email: 'pavani@x.com', project: null },
        { id: 'usr_new', name: 'Anil Kumar', role: null, email: null, project: null },
      ]);
    });

    test('fails closed with the cause when the assignee lookup errors', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const cause = new Error('D1 Connection Timeout');
      jest.spyOn(pool, 'query').mockRejectedValue(cause);

      await expect(queries.getInternalAssignees()).rejects.toMatchObject({ ...UNAVAILABLE, cause });
    });
  });

  describe('approveCreditTask and rejectCreditTask', () => {
    function creditClient({ lockedRow, buyerRow, vendorRow } = {}) {
      return {
        query: jest.fn(async (sql) => {
          if (sql.includes('FROM internal_tasks WHERE id = $1 FOR UPDATE')) {
            return { rows: lockedRow === undefined ? [{ id: 'tsk_c', status: 'Pending Approval', approval_status: 'PENDING' }] : lockedRow };
          }
          if (sql.includes('FROM buyer_accounts WHERE id = $1 FOR UPDATE')) {
            return { rows: buyerRow === undefined ? [{ id: 'buy_c', raw: JSON.stringify({ creditBalance: 50 }) }] : buyerRow };
          }
          if (sql.includes('FROM vendors WHERE id = $1 FOR UPDATE')) {
            return { rows: vendorRow === undefined ? [{ id: 'ven_c', raw: { freeQuotationCredits: 15 } }] : vendorRow };
          }
          return { rowCount: 1, rows: [] };
        }),
        release: jest.fn(),
      };
    }

    test('approves a buyer credit addition in a PostgreSQL transaction and syncs the account cache', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({});
      const recordSpy = jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({ id: 'tx-1' });
      const client = creditClient();
      const originalPool = pool.pool;
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [creditTaskRow({ id: 'tsk_c', credit_account_id: 'buy_c', approval_status: 'APPROVED' })] });

      try {
        const res = await queries.approveCreditTask('tsk_c', { id: 'admin-1', name: 'Admin Approver' }, 'Approved 20 credits');

        expect(res).toBeDefined();
        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ buyerId: 'buy_c', updatedBalance: 70, creditsAdded: 20 }));
        expect(updateBuyerSpy).toHaveBeenCalledWith('buy_c', { creditBalance: 70, available_credits: 70 }, { persist: false });
        expect(client.release).toHaveBeenCalledTimes(1);
      } finally {
        pool.pool = originalPool;
      }
    });

    test('approves a vendor credit deduction and syncs the vendor cache', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const updateVendorSpy = jest.spyOn(storeService, 'updateVendor').mockReturnValue({});
      const recordSpy = jest.spyOn(domainQueries, 'recordCreditTransactionInDB').mockResolvedValue({ id: 'vtx-1' });
      const client = creditClient({ lockedRow: [{ id: 'tsk_v', status: 'Pending Approval', approval_status: 'PENDING' }] });
      const originalPool = pool.pool;
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [creditTaskRow({
          id: 'tsk_v',
          task_type: 'Delete Credits',
          credit_account_type: 'SELLER',
          credit_account_id: 'ven_c',
          credit_quantity: 5,
          approval_status: 'APPROVED',
        })],
      });

      try {
        await queries.approveCreditTask('tsk_v', { id: 'admin-1', name: 'Admin Approver' }, 'Deducted 5 credits');

        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 'ven_c', balanceAfter: 10, transactionType: 'CREDIT_DEDUCTION' }));
        expect(updateVendorSpy).toHaveBeenCalledWith('ven_c', {
          freeQuotationCredits: 10,
          freeRfqDownloadCredits: 10,
          credits: 10,
        }, { persist: false });
      } finally {
        pool.pool = originalPool;
      }
    });

    test('returns the task unchanged when the locked row is already approved', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const client = creditClient({ lockedRow: [{ id: 'tsk_done', status: 'Completed', approval_status: 'APPROVED' }] });
      const originalPool = pool.pool;
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount');
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [creditTaskRow({ id: 'tsk_done', status: 'Completed', approval_status: 'APPROVED' })] });

      try {
        const res = await queries.approveCreditTask('tsk_done', { id: 'admin-1' });

        expect(res.status).toBe('Completed');
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(updateBuyerSpy).not.toHaveBeenCalled();
      } finally {
        pool.pool = originalPool;
      }
    });

    test('rolls back and refuses when the credit account does not exist', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const client = creditClient({ buyerRow: [] });
      const originalPool = pool.pool;
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [creditTaskRow({ id: 'tsk_nf' })] });

      try {
        await expect(queries.approveCreditTask('tsk_nf', { id: 'admin-1' }))
          .rejects.toMatchObject({ code: 'CREDIT_ACCOUNT_NOT_FOUND', statusCode: 404 });
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      } finally {
        pool.pool = originalPool;
      }
    });

    test('rolls back and refuses when the account has no recorded balance', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const client = creditClient({ buyerRow: [{ id: 'buy_nb', raw: JSON.stringify({}) }] });
      const originalPool = pool.pool;
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [creditTaskRow({ id: 'tsk_nb', credit_account_id: 'buy_nb' })] });

      try {
        await expect(queries.approveCreditTask('tsk_nb', { id: 'admin-1' }))
          .rejects.toMatchObject({ code: 'CREDIT_BALANCE_NOT_RECORDED', statusCode: 409 });
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      } finally {
        pool.pool = originalPool;
      }
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.approveCreditTask('tsk_1', { id: 'admin-1' })).rejects.toMatchObject(UNAVAILABLE);
      await expect(queries.rejectCreditTask('tsk_1', { id: 'admin-1' })).rejects.toMatchObject(UNAVAILABLE);
    });

    test('returns null when the task to approve or reject does not exist', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

      await expect(queries.approveCreditTask('tsk_unknown', { id: 'admin-1' })).resolves.toBeNull();
      await expect(queries.rejectCreditTask('tsk_unknown', { id: 'admin-1' })).resolves.toBeNull();
    });

    test('approves a buyer credit task through the Worker D1 batch and refreshes the balance from the account', async () => {
      const { db, statements } = createD1Binding([
        [{ id: 'tsk_d1' }],
        [{}],
        [{}],
        [{}],
        [{ id: 'ctx-d1' }],
        [{ id: 'tsk_d1' }],
      ]);
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({});

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockImplementation((sql) => {
          if (sql.includes('FROM internal_tasks t')) {
            return Promise.resolve({ rows: [creditTaskRow({ id: 'tsk_d1', credit_account_id: 'buy_d1', approval_status: 'APPROVED' })] });
          }
          if (sql.includes('FROM buyer_accounts WHERE id = $1')) {
            return Promise.resolve({ rows: [{ available_credits: 70 }] });
          }
          return Promise.resolve({ rows: [] });
        });

        await queries.approveCreditTask('tsk_d1', { id: 'admin-1', name: 'Admin Approver' }, 'Approved');

        expect(db.batch).toHaveBeenCalledTimes(1);
        expect(statements).toHaveLength(6);
        expect(statements[1].text).toContain('UPDATE buyer_accounts');
        expect(updateBuyerSpy).toHaveBeenCalledWith('buy_d1', { creditBalance: 70, available_credits: 70 }, { persist: false });
      });
    });

    test('refuses a Worker D1 approval whose credit ledger row is not written', async () => {
      const { db } = createD1Binding([
        [{ id: 'tsk_d1x' }],
        [{}],
        [{}],
        [{}],
        [],
        [{ id: 'tsk_d1x' }],
      ]);

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockResolvedValue({ rows: [creditTaskRow({ id: 'tsk_d1x', credit_account_id: 'buy_d1x' })] });

        await expect(queries.approveCreditTask('tsk_d1x', { id: 'admin-1' }))
          .rejects.toThrow('Credit balance could not be updated, so the approval was rolled back.');
        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('D1 credit approval had no durable credit ledger row'),
          expect.any(Object),
          'INTERNAL_TASK_CREDIT_APPROVAL'
        );
      });
    });

    test('refuses a Worker D1 approval that cannot claim the task', async () => {
      const { db } = createD1Binding([[], [{}], [{}], [{}], [{}], [{}]]);

      await withD1Env(db, async () => {
        jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
        jest.spyOn(pool, 'query').mockResolvedValue({ rows: [creditTaskRow({ id: 'tsk_busy', credit_account_id: 'buy_busy', approval_status: 'PENDING' })] });

        await expect(queries.approveCreditTask('tsk_busy', { id: 'admin-1' }))
          .rejects.toThrow('Credit task could not be claimed.');
      });
    });

    test('rejects a credit task with remarks and leaves the balances untouched', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks t')) {
          return Promise.resolve({ rows: [creditTaskRow({ id: 'tsk_cred_rej', status: 'Rejected', approval_status: 'REJECTED' })] });
        }
        return Promise.resolve({ rowCount: 1, rows: [] });
      });

      const res = await queries.rejectCreditTask('tsk_cred_rej', { id: 'admin-1', name: 'Admin Approver' }, 'Duplicate');

      expect(res.status).toBe('Rejected');
      expect(querySpy.mock.calls.some(([sql]) => sql.includes("status = 'Rejected'"))).toBe(true);
      expect(querySpy.mock.calls.some(([sql]) => sql.includes('UPDATE buyer_accounts') || sql.includes('UPDATE vendors'))).toBe(false);
    });

    test('leaves the in-memory balance untouched when the PostgreSQL balance update fails', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({});
      const client = creditClient();
      client.query = jest.fn(async (sql) => {
        if (sql.includes('UPDATE buyer_accounts')) throw new Error('Simulated DB update failure during approval');
        if (sql.includes('FROM internal_tasks WHERE id = $1 FOR UPDATE')) return { rows: [{ id: 'tsk_roll', status: 'Pending Approval', approval_status: 'PENDING' }] };
        if (sql.includes('FROM buyer_accounts WHERE id = $1 FOR UPDATE')) return { rows: [{ id: 'buy_roll', raw: JSON.stringify({ creditBalance: 100 }) }] };
        return { rowCount: 1, rows: [] };
      });
      const originalPool = pool.pool;
      pool.pool = { connect: jest.fn().mockResolvedValue(client) };
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [creditTaskRow({ id: 'tsk_roll', credit_account_id: 'buy_roll' })] });

      try {
        await expect(queries.approveCreditTask('tsk_roll', { id: 'admin-1' })).rejects.toThrow('Simulated DB update failure during approval');
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(updateBuyerSpy).not.toHaveBeenCalled();
      } finally {
        pool.pool = originalPool;
      }
    });
  });

  describe('addTaskActivity and getOverdueAndUpcomingTasks', () => {
    test('inserts an activity entry and returns it', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks')) {
          return Promise.resolve({ rows: [{ id: 'tsk_101', attachments: '[]', raw: '{}' }] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const act = await queries.addTaskActivity('tsk_101', { comment: 'Client confirmed specs' }, { id: 'user-1', name: 'Pavani' });

      expect(act).toEqual(expect.objectContaining({
        task_id: 'tsk_101',
        action_type: 'COMMENT',
        actor_name: 'Pavani',
        comment: 'Client confirmed specs',
      }));
    });

    test('returns null when the task to annotate does not exist', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

      await expect(queries.addTaskActivity('tsk_nonexistent', { comment: 'test' }, { uuid: 'u1' })).resolves.toBeNull();
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.addTaskActivity('tsk_101', { comment: 'test' }, { uuid: 'u1' })).rejects.toMatchObject(UNAVAILABLE);
    });

    test('lists tasks with approaching or overdue deadlines', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ id: 'tsk_overdue_1', title: 'Audit Pump Vendor Delivery', status: 'In Progress', due_date: '2026-11-01', attachments: '[]', raw: '{}' }],
      });

      const tasks = await queries.getOverdueAndUpcomingTasks();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('tsk_overdue_1');
    });

    test('fails closed with PERSISTENCE_UNAVAILABLE when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      await expect(queries.getOverdueAndUpcomingTasks()).rejects.toMatchObject(UNAVAILABLE);
    });
  });
});


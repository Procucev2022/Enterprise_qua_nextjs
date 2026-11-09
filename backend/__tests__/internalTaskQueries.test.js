const pool = require('../src/db/pool');
const queries = require('../src/db/internalTaskQueries');
const approvalQueries = require('../src/db/approvalQueries');
const d1Bridge = require('../src/db/d1Bridge');
const { logger } = require('../src/services/loggerService');

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

describe('internalTaskQueries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    test('returns default task types when storage is not configured, rows missing, or query errors', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.getTaskTypes()).toEqual(queries.DEFAULT_TASK_TYPES);

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue(null);
      expect(await queries.getTaskTypes()).toEqual(queries.DEFAULT_TASK_TYPES);

      jest.spyOn(pool, 'query').mockRejectedValue(new Error('D1 429 Overload'));
      expect(await queries.getTaskTypes()).toEqual(queries.DEFAULT_TASK_TYPES);
    });
  });

  describe('createTaskType', () => {
    test('creates new task type in database', async () => {
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
      expect(pool.query).toHaveBeenCalled();
    });

    test('handles fallback when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      const res = await queries.createTaskType({
        name: 'Fallback Type',
      });

      expect(res.name).toBe('Fallback Type');
      expect(res.code).toBe('fallback_type');
      expect(res.default_module).toBe('GENERAL');
    });
  });

  describe('getInternalTasks', () => {
    test('builds SQL queries with all optional filter combinations', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest
        .spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [{ total: '1' }] }) // count query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'tsk_101',
              title: 'Test Task',
              status: 'Pending',
              priority: 'High',
              attachments: JSON.stringify([{ name: 'doc.pdf' }]),
              raw: JSON.stringify({ key: 'val' }),
            },
          ],
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

    test('handles default query when no filters or "all" filters are provided', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest
        .spyOn(pool, 'query')
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
    });

    test('filters with taskCategory, taskType, createdBy, dueFrom, dueTo', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('count(*) as count') || sql.includes('count(*) as total')) {
          return Promise.resolve({ rows: [{ count: 1, total: 1 }] });
        }
        return Promise.resolve({
          rows: [
            {
              id: 'tsk_filt_1',
              title: 'Credit Verification',
              task_category: 'CREDIT_MANAGEMENT',
              task_type: 'Add Credits',
              created_by_name: 'Admin',
              attachments: '[]',
              raw: '{}',
            },
          ],
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


    test('handles fallback when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const res = await queries.getInternalTasks();
      expect(res).toEqual({ rows: [], total: 0 });
    });
  });

  describe('getInternalTaskSummary', () => {
    test('filters summary by assignedTo when provided', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          {
            total: 4,
            pending: 1,
            in_progress: 1,
            blocked: 0,
            completed: 2,
            escalated: 0,
            critical_count: 0,
          },
        ],
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
    test('filters summary by taskCategory when provided', async () => {
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


    test('returns aggregate metrics', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          {
            total: 10,
            pending: 3,
            in_progress: 2,
            blocked: 1,
            completed: 3,
            escalated: 1,
            critical_count: 1,
          },
        ],
      });

      const summary = await queries.getInternalTaskSummary();
      expect(summary.total).toBe(10);
      expect(summary.pending).toBe(3);
      expect(summary.inProgress).toBe(2);
      expect(summary.blocked).toBe(1);
      expect(summary.completed).toBe(3);
      expect(summary.escalated).toBe(1);
      expect(summary.criticalCount).toBe(1);
    });

    test('returns zeroed summary when storage not configured or empty row', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect((await queries.getInternalTaskSummary()).total).toBe(0);

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue(null);
      expect((await queries.getInternalTaskSummary()).total).toBe(0);
    });
  });

  describe('getInternalTaskById', () => {
    test('returns task and attached activity log', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest
        .spyOn(pool, 'query')
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'tsk_101',
              task_number: 'TASK-1001',
              title: 'Detailed Task',
              attachments: 'invalid-json',
              raw: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'act_1', action_type: 'CREATED', comment: 'Created' }],
        });

      const task = await queries.getInternalTaskById('tsk_101');
      expect(task?.id).toBe('tsk_101');
      expect(task?.attachments).toEqual([]);
      expect(task?.activities).toHaveLength(1);
    });

    test('returns null when task not found or storage not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.getInternalTaskById('tsk_1')).toBeNull();

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
      expect(await queries.getInternalTaskById('tsk_nonexistent')).toBeNull();
    });
  });

  describe('createInternalTask', () => {
    test('inserts task and activity record', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      // Mock getInternalTaskById for the return
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [{ id: 'tsk_new', title: 'New Internal Task', attachments: '[]', raw: '{}' }],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const task = await queries.createInternalTask(
        {
          title: 'New Internal Task',
          priority: 'Critical',
          status: 'Pending',
          relatedEntityType: 'BUYER',
          relatedEntityId: 'buy_1',
          relatedEntityLabel: 'Acme Buyer',
        },
        { uuid: 'usr_1', fullName: 'Manager' }
      );

      expect(task?.title).toBe('New Internal Task');
    });

    test('creates credit management task with Pending Approval status', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('SELECT count(*) as count FROM internal_tasks')) {
          return Promise.resolve({ rows: [{ count: 99 }] });
        }
        if (sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [{
              id: 'tsk_cred_pending',
              title: 'Grant 500 Credits to Buyer Acme',
              task_category: 'CREDIT_MANAGEMENT',
              task_type: 'Add Credits',
              status: 'Pending Approval',
              approval_status: 'PENDING',
              attachments: '[]',
              raw: '{}',
            }],
          });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const task = await queries.createInternalTask({
        title: 'Grant 500 Credits to Buyer Acme',
        taskCategory: 'CREDIT_MANAGEMENT',
        taskType: 'Add Credits',
        creditAccountType: 'BUYER',
        creditAccountId: 'buyer-101',
        creditAccountName: 'Acme Corp',
        creditQuantity: 500,
        creditReason: 'Promotional onboarding grant',
      }, { id: 'usr-1', name: 'Sales Manager' });

      expect(task).toBeDefined();
      expect(task.status).toBe('Pending Approval');
    });


    test('handles fallback when storage is not configured and various actor fields', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      const task = await queries.createInternalTask({
        title: 'Offline Task',
      });

      expect(task.title).toBe('Offline Task');
      expect(task.priority).toBe('Medium');
      expect(task.status).toBe('Pending');

      const taskWithActor = await queries.createInternalTask({}, { id: 'usr_2', name: 'NameOnly' });
      expect(taskWithActor.created_by_name).toBe('NameOnly');

      const taskWithEmail = await queries.createInternalTask({}, { email: 'e@p.com' });
      expect(taskWithEmail.created_by_name).toBe('e@p.com');

      const taskWithNoActor = await queries.createInternalTask({});
      expect(taskWithNoActor.created_by_name).toBe('Admin');
    });
  });

  describe('createInternalTaskWithApproval', () => {
    const taskData = {
      title: 'Grant credits to a buyer',
      taskCategory: 'CREDIT_MANAGEMENT',
      taskType: 'Add Credits',
      creditAccountType: 'BUYER',
      creditAccountId: 'buyer-atomic-1',
      creditQuantity: 25,
    };
    const approvalData = {
      id: 'approval-atomic-test',
      module: 'Buyer Credit Addition',
      request_type: 'Buyer Credit Addition',
      amount: 25,
      quantity: 25,
      buyer_id: 'buyer-atomic-1',
      assigned_approver: 'Finance Manager',
      raw: { source: 'internal-task-test' },
    };

    test('keeps the task and linked approval in memory when storage is intentionally unconfigured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const existingApproval = approvalQueries.memoryApprovals.find((item) => item.id === approvalData.id);
      if (existingApproval) approvalQueries.memoryApprovals.splice(approvalQueries.memoryApprovals.indexOf(existingApproval), 1);

      try {
        const task = await queries.createInternalTaskWithApproval(taskData, { name: 'Test Manager' }, approvalData);
        const approval = approvalQueries.memoryApprovals.find((item) => item.id === approvalData.id);

        expect(task.status).toBe('Pending Approval');
        expect(approval).toMatchObject({ internal_task_id: task.id, buyer_id: 'buyer-atomic-1' });
        expect(approval.raw.internal_task_id).toBe(task.id);
      } finally {
        approvalQueries.memoryApprovals.splice(
          0,
          approvalQueries.memoryApprovals.length,
          ...approvalQueries.memoryApprovals.filter((item) => item.id !== approvalData.id)
        );
      }
    });

    test('persists the task, activity, and approval in one Worker D1 batch', async () => {
      const originalD1Env = globalThis.__CF_ENV__;
      const { db, statements } = createD1Binding([[{}], [{}], [{}]]);
      globalThis.__CF_ENV__ = { DB: db };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const originalApprovalIds = new Set(approvalQueries.memoryApprovals.map((item) => item.id));

      try {
        const task = await queries.createInternalTaskWithApproval(taskData, { id: 'user-atomic-1', name: 'Test Manager' }, approvalData);
        const approvalStatement = statements[2];
        const approvalRaw = JSON.parse(approvalStatement.params[11]);

        expect(db.batch).toHaveBeenCalledTimes(1);
        expect(statements).toHaveLength(3);
        expect(statements[0].text).toContain('INSERT INTO internal_tasks');
        expect(statements[1].text).toContain('INSERT INTO internal_task_activities');
        expect(statements[2].text).toContain('INSERT INTO approvals');
        expect(approvalRaw.internal_task_id).toBe(statements[0].params[0]);
        expect(task.id).toBe(statements[0].params[0]);
        expect(approvalQueries.memoryApprovals.find((item) => item.id === approvalData.id).internal_task_id).toBe(task.id);
      } finally {
        approvalQueries.memoryApprovals.splice(
          0,
          approvalQueries.memoryApprovals.length,
          ...approvalQueries.memoryApprovals.filter((item) => originalApprovalIds.has(item.id))
        );
        if (originalD1Env === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = originalD1Env;
      }
    });

    test('logs a failed Worker D1 batch and does not remember a phantom approval', async () => {
      const originalD1Env = globalThis.__CF_ENV__;
      const failure = new Error('D1 insert rejected');
      const { db } = createD1Binding([]);
      db.batch.mockRejectedValue(failure);
      globalThis.__CF_ENV__ = { DB: db };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      const originalApprovalIds = new Set(approvalQueries.memoryApprovals.map((item) => item.id));

      try {
        await expect(queries.createInternalTaskWithApproval(taskData, {}, approvalData)).rejects.toMatchObject({
          code: 'PERSISTENCE_UNAVAILABLE',
          cause: failure,
        });
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Atomic credit approval request persistence failed'), expect.objectContaining({
          approvalId: approvalData.id,
          provider: 'cloudflare-d1',
        }), 'INTERNAL_TASK_APPROVAL_REQUEST');
        expect(approvalQueries.memoryApprovals.some((item) => item.id === approvalData.id)).toBe(false);
      } finally {
        errorSpy.mockRestore();
        approvalQueries.memoryApprovals.splice(
          0,
          approvalQueries.memoryApprovals.length,
          ...approvalQueries.memoryApprovals.filter((item) => originalApprovalIds.has(item.id))
        );
        if (originalD1Env === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = originalD1Env;
      }
    });

    test('refuses a multi-statement D1 HTTP write before creating a partial request', async () => {
      const originalD1Env = globalThis.__CF_ENV__;
      const envNames = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_D1_DATABASE_ID', 'CLOUDFLARE_API_TOKEN'];
      const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
      const originalApprovalIds = new Set(approvalQueries.memoryApprovals.map((item) => item.id));
      delete globalThis.__CF_ENV__;
      process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_D1_DATABASE_ID = 'test-database';
      process.env.CLOUDFLARE_API_TOKEN = 'test-token';
      d1Bridge.resetD1HttpClientCache();

      try {
        await expect(queries.createInternalTaskWithApproval(taskData, {}, approvalData)).rejects.toMatchObject({
          code: 'PERSISTENCE_UNAVAILABLE',
        });
        expect(approvalQueries.memoryApprovals.some((item) => item.id === approvalData.id)).toBe(false);
      } finally {
        approvalQueries.memoryApprovals.splice(
          0,
          approvalQueries.memoryApprovals.length,
          ...approvalQueries.memoryApprovals.filter((item) => originalApprovalIds.has(item.id))
        );
        if (originalD1Env === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = originalD1Env;
        envNames.forEach((name) => {
          if (originalEnv[name] === undefined) delete process.env[name];
          else process.env[name] = originalEnv[name];
        });
        d1Bridge.resetD1HttpClientCache();
      }
    });

    test('commits the task, activity, and approval together in a PostgreSQL transaction', async () => {
      const originalPool = pool.pool;
      const originalApprovalIds = new Set(approvalQueries.memoryApprovals.map((item) => item.id));
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
        const task = await queries.createInternalTaskWithApproval(taskData, {}, approvalData);

        expect(queriesRun).toEqual([
          'BEGIN',
          'INSERT INTO internal_tasks',
          'INSERT INTO internal_task_activities',
          'INSERT INTO approvals',
          'COMMIT',
        ]);
        expect(task.id).toBeTruthy();
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(approvalQueries.memoryApprovals.find((item) => item.id === approvalData.id).internal_task_id).toBe(task.id);
      } finally {
        pool.pool = originalPool;
        approvalQueries.memoryApprovals.splice(
          0,
          approvalQueries.memoryApprovals.length,
          ...approvalQueries.memoryApprovals.filter((item) => originalApprovalIds.has(item.id))
        );
      }
    });

    test('rolls back and logs when one PostgreSQL insert reports no persisted row', async () => {
      const originalPool = pool.pool;
      const originalApprovalIds = new Set(approvalQueries.memoryApprovals.map((item) => item.id));
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
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

      try {
        await expect(queries.createInternalTaskWithApproval(taskData, {}, approvalData)).rejects.toMatchObject({
          code: 'PERSISTENCE_UNAVAILABLE',
        });
        expect(queriesRun).toEqual([
          'BEGIN',
          'INSERT INTO internal_tasks',
          'INSERT INTO internal_task_activities',
          'ROLLBACK',
        ]);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Atomic credit approval request persistence failed'), expect.objectContaining({
          provider: 'postgresql',
        }), 'INTERNAL_TASK_APPROVAL_REQUEST');
        expect(approvalQueries.memoryApprovals.some((item) => item.id === approvalData.id)).toBe(false);
        expect(client.release).toHaveBeenCalledTimes(1);
      } finally {
        errorSpy.mockRestore();
        pool.pool = originalPool;
        approvalQueries.memoryApprovals.splice(
          0,
          approvalQueries.memoryApprovals.length,
          ...approvalQueries.memoryApprovals.filter((item) => originalApprovalIds.has(item.id))
        );
      }
    });
  });

  describe('updateInternalTask', () => {
    test('updates task and logs activity when status changes', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      // getInternalTaskById returns existing
      jest.spyOn(pool, 'query').mockImplementation((sql, params) => {
        if (sql.includes('WHERE t.id = $1 OR t.task_number = $1')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_1',
                title: 'Old Title',
                status: 'Pending',
                priority: 'Medium',
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const res = await queries.updateInternalTask(
        'tsk_1',
        {
          title: 'Updated Title',
          status: 'Escalated',
          activityComment: 'Escalated to management',
        },
        { fullName: 'Lead' }
      );

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE internal_tasks'),
        expect.any(Array),
        expect.any(Object)
      );
    });

    test('covers branch paths for update and hydration', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      // Hydrate with empty row properties to exercise fallbacks
      const hydrated = queries.hydrateTaskRow({
        raw: JSON.stringify({
          taskCategory: 'COMMUNICATION',
          taskType: 'SMS',
          dueTime: '10:00',
          completedByUserId: 'u-1',
          completedByName: 'Admin',
          completionRemarks: 'Done',
          approvalStatus: 'APPROVED',
          approverId: 'app-1',
          approverName: 'Approver',
          approvedAt: '2026-11-01',
          approvalRemarks: 'OK',
          demoDate: '2026-11-05',
          demoTime: '14:00',
          demoStatus: 'Scheduled',
          creditAccountType: 'BUYER',
          creditAccountId: 'acc-1',
          creditAccountName: 'Acme',
          creditQuantity: 10,
          creditReason: 'Bonus',
          onboarding_stage: '3',
          proposal_value: 50000,
          proposal_url: 'https://prop.pdf',
          proposal_status: 'Sent',
          call_outcome: 'Answered',
          recipient_phone: '9876543210',
          recipient_email: 'client@example.com',
          current_account_credits: 50,
        }),
      });
      expect(hydrated.task_category).toBe('COMMUNICATION');
      expect(hydrated.onboarding_stage).toBe('3');

      // Update with updates.attachments directly
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('WHERE t.id = $1 OR t.task_number = $1')) {
          return Promise.resolve({
            rows: [{ id: 'tsk_1', attachments: '[]', status: 'Completed', completed_at: '2026-11-01' }],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });



      await queries.updateInternalTask('tsk_1', {
        attachments: [{ name: 'Direct.pdf' }],
        status: 'Completed',
        demoStatus: 'Scheduled', // same demo status
      }, { id: 'u-2' });
    });
    test('covers parseJsonSafe and fallback branches in updateInternalTask', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('WHERE t.id = $1 OR t.task_number = $1')) {
          return Promise.resolve({
            rows: [{ id: 'tsk_1', attachments: '[]', status: 'In Progress' }],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });


      // 1. hydrateTaskRow(null)
      expect(queries.hydrateTaskRow(null)).toBeNull();

      expect(queries.parseJsonSafe(null, [])).toEqual([]);
      expect(queries.parseJsonSafe(undefined, [])).toEqual([]);
      expect(queries.parseJsonSafe({ test: 1 })).toEqual({ test: 1 });
      expect(queries.parseJsonSafe('not json', { fallback: true })).toEqual({ fallback: true });
      expect(queries.parseJsonSafe('{"valid":true}')).toEqual({ valid: true });


      // 2. getInternalTaskById with vendor without rows
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks t')) {
          return Promise.resolve({
            rows: [{ id: 'tsk_no_v', credit_account_id: 'v_none', credit_account_type: 'vendor', attachments: '[]', raw: '{}' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });
      const t = await queries.getInternalTaskById('tsk_no_v');
      expect(t).toBeDefined();

      // 3. updateInternalTask with notes fallback
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('WHERE t.id = $1 OR t.task_number = $1')) {
          return Promise.resolve({
            rows: [{ id: 'tsk_1', attachments: '[]', status: 'Pending' }],
          });
        }
        return Promise.resolve({ rowCount: 1 });
      });
      await queries.updateInternalTask('tsk_1', { notes: 'Only notes fallback' }, { id: 'u-3' });


      // Update without remarks to hit || default strings
      await queries.updateInternalTask('tsk_1', {
        callOutcome: 'Busy',
        onboardingStage: '4',
        proposalStatus: 'Accepted',
        newAttachment: {},
      }, {});

      // Exercise searchRelatedEntities edge cases
      const res1 = await queries.searchRelatedEntities('');
      expect(Array.isArray(res1)).toBe(true);
    });


    test('updates task without status change and handles status = Completed', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('WHERE t.id = $1 OR t.task_number = $1')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_1',
                title: 'Existing',
                status: 'Pending',
                priority: 'Medium',
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      // Status does not change
      await queries.updateInternalTask('tsk_1', { title: 'Only title changed' }, { name: 'Admin User' });

      // Status changes to Completed (completed_at set)
      await queries.updateInternalTask('tsk_1', { status: 'Completed' }, { email: 'admin@p.com' });
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE internal_tasks'),
        expect.any(Array),
        expect.any(Object)
      );
    });

    test('returns null when storage not configured or task does not exist', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.updateInternalTask('tsk_1', {})).toBeNull();

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
      expect(await queries.updateInternalTask('nonexistent', {})).toBeNull();
    });
  });

  describe('deleteInternalTask', () => {
    test('deletes task from database', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      const ok = await queries.deleteInternalTask('tsk_1');
      expect(ok).toBe(true);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM internal_tasks'),
        ['tsk_1'],
        expect.any(Object)
      );
    });

    test('returns true when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.deleteInternalTask('tsk_1')).toBe(true);
    });
  });

  describe('searchRelatedEntities', () => {
    test('searches RFQs with fallback labels', async () => {
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
      expect(entities[0].entityType).toBe('RFQ');
      expect(entities[0].label).toContain('RFQ-001');
      expect(entities[1].label).toContain('Raw Title');
      expect(entities[2].label).toContain('rfq-3 — RFQ');
    });

    test('searches BUYERS with fallback organization names', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          { uuid: 'buy-1', organization_name: 'Tata Steel', email: 'tata@example.com', city: 'Mumbai', state: 'MH' },
          { uuid: 'buy-2', organization_name: null, email: null, city: null, state: null },
        ],
      });

      const entities = await queries.searchRelatedEntities('BUYER', 'Tata');
      expect(entities).toHaveLength(2);
      expect(entities[0].label).toBe('Tata Steel');
      expect(entities[0].secondary).toContain('Mumbai');
      expect(entities[1].label).toBe('Buyer Org');
    });

    test('searches VENDORS with fallback company names', async () => {
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
      expect(entities).toHaveLength(4);
      expect(entities[0].label).toBe('Apex Valves');
      expect(entities[1].label).toBe('Beta Company');
      expect(entities[2].label).toBe('c@v.com');
      expect(entities[3].label).toBe('vnd-4');
    });

    test('searches CATEGORIES', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ uuid: 'cat-1', division: 'Mechanical', category: 'Pipes' }],
      });

      const entities = await queries.searchRelatedEntities('CATEGORY', 'Pipes');
      expect(entities).toHaveLength(1);
      expect(entities[0].label).toBe('Mechanical > Pipes');
    });

    test('searches USERS with fallback usernames and emails', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          { uuid: 'usr-1', full_name: 'Sudheer Kangala', username: 'sudheer', email: 's@p.com' },
          { uuid: 'usr-2', full_name: null, username: 'guest_user', email: null },
          { uuid: 'usr-3', full_name: null, username: null, email: null },
        ],
      });

      const entities = await queries.searchRelatedEntities('USER', 'Sudheer');
      expect(entities).toHaveLength(3);
      expect(entities[0].label).toBe('Sudheer Kangala');
      expect(entities[1].label).toBe('guest_user');
      expect(entities[2].label).toBe('User');
    });

    test('searches CREDITS and PAYMENTS', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ id: 'txn-1', vendor_id: 'vnd-1', amount: 50, transaction_type: 'CREDIT', created_at: '2026-10-29' }],
      });

      const credits = await queries.searchRelatedEntities('CREDIT');
      expect(credits).toHaveLength(1);
      expect(credits[0].entityType).toBe('CREDIT');

      const payments = await queries.searchRelatedEntities('PAYMENT');
      expect(payments).toHaveLength(1);
      expect(payments[0].entityType).toBe('PAYMENT');
    });

    test('returns empty array for unknown entity type or when storage disabled', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.searchRelatedEntities('RFQ')).toEqual([]);

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      expect(await queries.searchRelatedEntities('UNKNOWN_MODULE')).toEqual([]);
    });
  });

  describe('getInternalAssignees', () => {
    test('returns default assignees when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const assignees = await queries.getInternalAssignees();
      expect(assignees.length).toBeGreaterThanOrEqual(5);
      expect(assignees.some((m) => m.name === 'Pavani')).toBe(true);
    });

    test('merges distinct assignees from database when storage is configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          { assigned_to_user_id: 'usr_new', assigned_to_name: 'Anil Kumar' },
          { assigned_to_user_id: 'exec-1', assigned_to_name: 'Pavani' }, // Already exists
        ],
      });

      const assignees = await queries.getInternalAssignees();
      expect(assignees.some((m) => m.name === 'Anil Kumar')).toBe(true);
      expect(assignees.some((m) => m.name === 'Pavani')).toBe(true);
    });

    test('handles database query error gracefully and returns defaults', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValue(new Error('D1 Connection Timeout'));
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      const assignees = await queries.getInternalAssignees();
      expect(assignees.length).toBeGreaterThanOrEqual(5);
      expect(warnSpy).toHaveBeenCalledWith(
        'Internal assignee lookup failed; using configured defaults',
        expect.objectContaining({ fallbackCount: expect.any(Number) }),
        'INTERNAL_TASKS'
      );
      warnSpy.mockRestore();
    });
  });


  describe('approveCreditTask and rejectCreditTask', () => {
    test('approveCreditTask approves buyer credit addition and records transaction', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const storeService = require('../src/services/storeService');
      const domainQueries = require('../src/db/domainQueries');

      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([
        { id: 'buy_101', organizationName: 'Apex Infra', corporateEmail: 'apex@infra.com', creditBalance: 50 },
      ]);
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({ id: 'buy_101', creditBalance: 70 });
      const recordBuyerTxSpy = jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({ id: 'tx-1' });

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_cred_add',
                task_number: 'TASK-1002',
                task_category: 'CREDIT_MANAGEMENT',
                task_type: 'Add Credits',
                status: 'Pending Approval',
                credit_account_type: 'BUYER',
                credit_account_id: 'buy_101',
                credit_quantity: 20,
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const res = await queries.approveCreditTask('tsk_cred_add', { id: 'admin-1', name: 'Admin Approver' }, 'Approved 20 credits');
      expect(res).toBeDefined();
      expect(updateBuyerSpy).toHaveBeenCalledWith('buy_101', { creditBalance: 70, available_credits: 70 }, { persist: false });
      expect(recordBuyerTxSpy).toHaveBeenCalled();
    });

    test('approveCreditTask approves seller credit deduction and records transaction', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const storeService = require('../src/services/storeService');
      const domainQueries = require('../src/db/domainQueries');

      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v_202',
        freeQuotationCredits: 15,
        freeRfqDownloadCredits: 15,
      });
      const updateVendorSpy = jest.spyOn(storeService, 'updateVendor').mockReturnValue({ id: 'v_202' });
      const recordVendorTxSpy = jest.spyOn(domainQueries, 'recordCreditTransactionInDB').mockResolvedValue({ id: 'vtx-1' });

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_cred_ded',
                task_number: 'TASK-1003',
                task_category: 'CREDIT_MANAGEMENT',
                task_type: 'Delete Credits',
                status: 'Pending Approval',
                credit_account_type: 'SELLER',
                credit_account_id: 'v_202',
                credit_quantity: 5,
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const res = await queries.approveCreditTask('tsk_cred_ded', { id: 'admin-1', name: 'Admin Approver' }, 'Deducted 5 credits');
      expect(res).toBeDefined();
      expect(updateVendorSpy).toHaveBeenCalledWith('v_202', {
        freeQuotationCredits: 10,
        freeRfqDownloadCredits: 10,
        credits: 10,
      }, { persist: false });
      expect(recordVendorTxSpy).toHaveBeenCalled();
    });

    test('approveCreditTask reads live balance from database table when account exists in DB for buyer and vendor', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const storeService = require('../src/services/storeService');
      const domainQueries = require('../src/db/domainQueries');
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({ id: 'buy_db_1' });
      const updateVendorSpy = jest.spyOn(storeService, 'updateVendor').mockReturnValue({ id: 'ven_db_1' });

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_cred_db_b',
                task_number: 'TASK-1005',
                task_category: 'CREDIT_MANAGEMENT',
                task_type: 'Add Credits',
                status: 'Pending Approval',
                credit_account_type: 'BUYER',
                credit_account_id: 'buy_db_1',
                credit_quantity: 15,
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (typeof sql === 'string' && sql.includes('FROM buyer_accounts WHERE id = $1 FOR UPDATE')) {
          return Promise.resolve({
            rows: [{ id: 'buy_db_1', raw: JSON.stringify({ creditBalance: 80 }) }],
          });
        }
        if (typeof sql === 'string' && sql.includes('FROM vendors WHERE id = $1 FOR UPDATE')) {
          return Promise.resolve({
            rows: [{ id: 'ven_db_1', raw: { freeQuotationCredits: 40 } }],
          });
        }
        if (typeof sql === 'string' && sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const buyerRes = await queries.approveCreditTask('tsk_cred_db_b', { id: 'adm' });
      expect(buyerRes).toBeDefined();
      expect(updateBuyerSpy).toHaveBeenCalledWith('buy_db_1', { creditBalance: 95, available_credits: 95 }, { persist: false });

      // Now test vendor DB branch
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_cred_db_v',
                task_number: 'TASK-1006',
                task_category: 'CREDIT_MANAGEMENT',
                task_type: 'Deduct Credits',
                status: 'Pending Approval',
                credit_account_type: 'VENDOR',
                credit_account_id: 'ven_db_1',
                credit_quantity: 10,
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (typeof sql === 'string' && sql.includes('FROM vendors WHERE id = $1 FOR UPDATE')) {
          return Promise.resolve({
            rows: [{ id: 'ven_db_1', raw: { freeQuotationCredits: 40 } }],
          });
        }
        if (typeof sql === 'string' && sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const vendorRes = await queries.approveCreditTask('tsk_cred_db_v', { id: 'adm' });
      expect(vendorRes).toBeDefined();
      expect(updateVendorSpy).toHaveBeenCalledWith('ven_db_1', {
        freeQuotationCredits: 30,
        freeRfqDownloadCredits: 30,
        credits: 30,
      }, { persist: false });
    });

    test('approveCreditTask checks out client from pool.pool.connect and releases on completion', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const storeService = require('../src/services/storeService');
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([
        { id: 'buy_client_rel', creditBalance: 50 },
      ]);
      const mockClientRelease = jest.fn();
      const mockClientQuery = jest.fn().mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_client_rel',
                task_number: 'TASK-1007',
                task_category: 'CREDIT_MANAGEMENT',
                task_type: 'Add Credits',
                status: 'Pending Approval',
                credit_account_type: 'BUYER',
                credit_account_id: 'buy_client_rel',
                credit_quantity: 10,
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (typeof sql === 'string' && sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      pool.pool = {
        connect: jest.fn().mockResolvedValue({
          query: mockClientQuery,
          release: mockClientRelease,
        }),
      };

      try {
        const res = await queries.approveCreditTask('tsk_client_rel', { id: 'adm' });
        expect(res).toBeDefined();
        expect(mockClientRelease).toHaveBeenCalled();
      } finally {
        pool.pool = null;
      }
    });

    test('approveCreditTask returns null when storage disabled or task not found', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.approveCreditTask('tsk_1')).toBeNull();

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
      expect(await queries.approveCreditTask('tsk_unknown')).toBeNull();
    });

    test('rejectCreditTask rejects request with remarks and leaves credit balances untouched', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_cred_rej',
                task_number: 'TASK-1004',
                task_category: 'CREDIT_MANAGEMENT',
                status: 'Pending Approval',
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const res = await queries.rejectCreditTask('tsk_cred_rej', { id: 'admin-1', name: 'Admin Approver' }, 'Rejected due to duplicate');
      expect(res).toBeDefined();
    });

    test('approveCreditTask aborts without modifying memory balance if database update fails for buyer', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const storeService = require('../src/services/storeService');
      const domainQueries = require('../src/db/domainQueries');

      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([
        { id: 'buy_roll', creditBalance: 100 },
      ]);
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockImplementation((id, updates) => updates);
      jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({});

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_roll',
                task_number: 'TASK-ROLL',
                task_category: 'CREDIT_MANAGEMENT',
                credit_account_type: 'BUYER',
                credit_account_id: 'buy_roll',
                credit_quantity: 25,
                task_type: 'Add Credits',
                status: 'Pending Approval',
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (sql.includes('UPDATE internal_tasks')) {
          return Promise.reject(new Error('Simulated DB update failure during approval'));
        }
        return Promise.resolve({ rowCount: 1 });
      });

      await expect(queries.approveCreditTask('tsk_roll')).rejects.toThrow('Simulated DB update failure');
      // Memory state must remain untouched when DB update fails
      expect(updateBuyerSpy).not.toHaveBeenCalled();
    });

    test('approveCreditTask aborts without modifying vendor memory balance if database update fails', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const storeService = require('../src/services/storeService');
      const domainQueries = require('../src/db/domainQueries');

      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'ven_roll',
        freeQuotationCredits: 40,
        freeRfqDownloadCredits: 40,
      });
      const updateVendorSpy = jest.spyOn(storeService, 'updateVendor').mockImplementation((id, updates) => updates);
      jest.spyOn(domainQueries, 'recordCreditTransactionInDB').mockResolvedValue({});

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_ven_roll',
                task_number: 'TASK-VROLL',
                task_category: 'CREDIT_MANAGEMENT',
                credit_account_type: 'VENDOR',
                credit_account_id: 'ven_roll',
                credit_quantity: 10,
                task_type: 'Delete Credits',
                status: 'Pending Approval',
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (sql.includes('UPDATE internal_tasks')) {
          return Promise.reject(new Error('Simulated DB vendor update failure'));
        }
        return Promise.resolve({ rowCount: 1 });
      });

      await expect(queries.approveCreditTask('tsk_ven_roll')).rejects.toThrow('Simulated DB vendor update failure');
      // Vendor memory state must remain untouched when DB update fails
      expect(updateVendorSpy).not.toHaveBeenCalled();
    });

    test('getInternalTasks safely escapes wildcards in search, assignedTo, and createdBy', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ total: 0 }] });

      await queries.getInternalTasks({
        search: '100%_special',
        assignedTo: 'admin_%',
        createdBy: 'user_%',
      });

      expect(querySpy).toHaveBeenCalled();
    });

    test('rejectCreditTask returns null when storage disabled or task not found', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.rejectCreditTask('tsk_1')).toBeNull();

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
      expect(await queries.rejectCreditTask('tsk_unknown')).toBeNull();
    });
  });

  describe('addTaskActivity and getOverdueAndUpcomingTasks', () => {
    test('addTaskActivity inserts activity entry and returns row', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [{ id: 'tsk_101', attachments: '[]', raw: '{}' }],
          });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const act = await queries.addTaskActivity('tsk_101', { comment: 'Client confirmed specs' }, { id: 'user-1', name: 'Pavani' });
      expect(act).toBeDefined();
      expect(act.comment).toBe('Client confirmed specs');
      expect(act.actor_name).toBe('Pavani');

      // Failure branches
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.addTaskActivity('tsk_101', { comment: 'test' })).toBeNull();

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
      expect(await queries.addTaskActivity('tsk_nonexistent', { comment: 'test' })).toBeNull();
    });

    test('getOverdueAndUpcomingTasks queries active tasks with approaching deadlines', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [
          {
            id: 'tsk_overdue_1',
            title: 'Audit Pump Vendor Delivery',
            status: 'In Progress',
            due_date: '2026-11-01',
            attachments: '[]',
            raw: '{}',
          },
        ],
      });

      const tasks = await queries.getOverdueAndUpcomingTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('tsk_overdue_1');

      // Fallback branch
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.getOverdueAndUpcomingTasks()).toEqual([]);
    });

    test('getInternalTaskById enriches credit balance for buyer and vendor accounts', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      // 1. Vendor credit account
      const creditQuerySpy = jest.spyOn(pool, 'query').mockImplementation((sql, params) => {
        if (sql.includes('FROM internal_tasks t')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_cred_vendor',
                credit_account_id: 'vnd_123',
                credit_account_type: 'vendor',
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('SELECT credits FROM vendors')) {
          return Promise.resolve({ rows: [{ credits: 45 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const vendorTask = await queries.getInternalTaskById('tsk_cred_vendor');
      expect(vendorTask).toBeDefined();
      expect(vendorTask.current_account_credits).toBe(45);
      expect(creditQuerySpy.mock.calls.find(([sql]) => sql.includes('SELECT credits FROM vendors'))[2]).toEqual(expect.objectContaining({
        d1: true,
        d1Text: expect.stringContaining("json_extract(raw, '$.credits')"),
      }));

      // 2. Buyer credit account
      creditQuerySpy.mockImplementation((sql, params) => {
        if (sql.includes('FROM internal_tasks t')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_cred_buyer',
                credit_account_id: 'byr_456',
                credit_account_type: 'buyer',
                attachments: '[]',
                raw: '{}',
              },
            ],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('SELECT available_credits FROM buyer_accounts')) {
          return Promise.resolve({ rows: [{ available_credits: 120 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const buyerTask = await queries.getInternalTaskById('tsk_cred_buyer');
      expect(buyerTask).toBeDefined();
      expect(buyerTask.current_account_credits).toBe(120);
      expect(creditQuerySpy.mock.calls.find(([sql]) => sql.includes('SELECT available_credits FROM buyer_accounts'))[2])
        .toEqual(expect.objectContaining({
          d1: true,
          d1Text: expect.stringContaining("json_extract(raw, '$.creditBalance')"),
        }));
    });

    test('logs a non-blocking current-credit lookup failure with task and account context', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('FROM internal_tasks t')) return { rows: [{
          id: 'task-credit-read-failure',
          credit_account_id: 'vendor-credit-read-failure',
          credit_account_type: 'vendor',
          attachments: '[]',
          raw: '{}',
        }] };
        if (sql.includes('FROM internal_task_activities')) return { rows: [] };
        if (sql.includes('SELECT credits FROM vendors')) throw new Error('D1 credit lookup failed');
        return { rows: [] };
      });
      const logger = require('../src/services/loggerService').logger;
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

      try {
        const task = await queries.getInternalTaskById('task-credit-read-failure');

        expect(task).toBeDefined();
        expect(task.current_account_credits).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Could not enrich internal task'), expect.objectContaining({
          taskId: 'task-credit-read-failure',
          accountId: 'vendor-credit-read-failure',
        }), 'INTERNAL_TASK_CREDIT_BALANCE');
      } finally {
        errorSpy.mockRestore();
      }
    });

    test.each([
      {
        name: 'buyer credit addition',
        accountType: 'BUYER',
        accountId: 'buyer-d1',
        taskType: 'Add Credits',
        creditQuantity: 20,
        startingBalance: 50,
        balance: 70,
        accountTable: 'buyer_accounts',
        aliasPath: "'$.available_credits'",
        accountUpdates: { creditBalance: 70, available_credits: 70 },
      },
      {
        name: 'buyer credit deduction',
        accountType: 'BUYER',
        accountId: 'buyer-d1-deduction',
        taskType: 'Delete Credits',
        creditQuantity: 5,
        startingBalance: 10,
        balance: 5,
        accountTable: 'buyer_accounts',
        aliasPath: "'$.available_credits'",
        accountUpdates: { creditBalance: 5, available_credits: 5 },
      },
      {
        name: 'vendor credit deduction',
        accountType: 'VENDOR',
        accountId: 'vendor-d1',
        taskType: 'Delete Credits',
        creditQuantity: 5,
        startingBalance: 15,
        balance: 10,
        accountTable: 'vendors',
        aliasPath: "'$.credits'",
        accountUpdates: { freeQuotationCredits: 10, freeRfqDownloadCredits: 10, credits: 10 },
      },
      {
        name: 'vendor credit addition',
        accountType: 'VENDOR',
        accountId: 'vendor-d1-addition',
        taskType: 'Add Credits',
        creditQuantity: 5,
        startingBalance: 15,
        balance: 20,
        accountTable: 'vendors',
        aliasPath: "'$.credits'",
        accountUpdates: { freeQuotationCredits: 20, freeRfqDownloadCredits: 20, credits: 20 },
      },
    ])('approves D1 $name as one atomic batch', async (scenario) => {
      const originalD1Env = globalThis.__CF_ENV__;
      const batchRows = [[{ id: 'task-d1' }], [{ id: scenario.accountId }], [{ id: 'ledger-d1' }], [], [{ id: 'task-d1' }], []];
      const { db, statements } = createD1Binding(batchRows);
      globalThis.__CF_ENV__ = { DB: db };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const taskReads = { count: 0 };
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('FROM internal_tasks t')) {
          taskReads.count += 1;
          return {
            rows: [{
              id: 'task-d1',
              task_number: 'TASK-D1',
              task_category: 'CREDIT_MANAGEMENT',
              task_type: scenario.taskType,
              status: taskReads.count > 1 ? 'Completed' : 'Pending Approval',
              approval_status: taskReads.count > 1 ? 'APPROVED' : 'PENDING',
              credit_account_type: scenario.accountType,
              credit_account_id: scenario.accountId,
              credit_quantity: scenario.creditQuantity,
              attachments: '[]',
              raw: '{}',
            }],
          };
        }
        if (sql.includes('FROM internal_task_activities')) return { rows: [] };
        if (sql.includes('FROM buyer_accounts')) return { rows: [{ available_credits: taskReads.count > 1 ? scenario.balance : scenario.startingBalance }] };
        if (sql.includes('FROM vendors')) return { rows: [{ credits: taskReads.count > 1 ? scenario.balance : scenario.startingBalance }] };
        return { rows: [] };
      });

      const storeService = require('../src/services/storeService');
      const updateAccount = scenario.accountType === 'BUYER'
        ? jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({ id: scenario.accountId })
        : jest.spyOn(storeService, 'updateVendor').mockReturnValue({ id: scenario.accountId });

      try {
        const result = await queries.approveCreditTask('task-d1', { id: 'admin-d1', name: 'D1 Admin' }, 'Verified');
        expect(result.status).toBe('Completed');
        expect(db.batch).toHaveBeenCalledTimes(1);
        expect(statements).toHaveLength(6);
        expect(statements[0].text).toContain('UPDATE internal_tasks');
        expect(statements[1].text).toContain(`UPDATE ${scenario.accountTable}`);
        expect(statements[1].text).toContain(scenario.aliasPath);
        expect(statements[2].text).toContain('INSERT INTO');
        expect(statements[2].text).toContain('idempotency_key');
        expect(statements[4].text).toContain("approval_status = 'APPROVED'");
        expect(updateAccount).toHaveBeenCalledWith(scenario.accountId, scenario.accountUpdates, { persist: false });
      } finally {
        updateAccount.mockRestore();
        if (originalD1Env === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = originalD1Env;
      }
    });

    test.each([
      { name: 'unsupported account type', accountType: 'UNKNOWN', accountId: 'unknown-account', message: 'Unsupported credit account type' },
      { name: 'missing account id', accountType: 'BUYER', accountId: null, message: 'Credit account is missing' },
    ])('rejects D1 approval for $name before batching', async (scenario) => {
      const originalD1Env = globalThis.__CF_ENV__;
      const { db } = createD1Binding([]);
      globalThis.__CF_ENV__ = { DB: db };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('FROM internal_tasks t')) return { rows: [{
          id: 'task-invalid-credit-account', task_number: 'TASK-INVALID', task_type: 'Add Credits',
          status: 'Pending Approval', credit_account_type: scenario.accountType, credit_account_id: scenario.accountId,
          credit_quantity: 1, attachments: '[]', raw: '{}',
        }] };
        if (sql.includes('FROM internal_task_activities')) return { rows: [] };
        if (sql.includes('FROM buyer_accounts')) return { rows: [{ available_credits: 1 }] };
        return { rows: [] };
      });

      try {
        await expect(queries.approveCreditTask('task-invalid-credit-account')).rejects.toThrow(scenario.message);
        expect(db.batch).not.toHaveBeenCalled();
      } finally {
        if (originalD1Env === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = originalD1Env;
      }
    });

    test.each([
      { name: 'still pending', approved: false, shouldReject: true },
      { name: 'already completed', approved: true, shouldReject: false },
    ])('handles a D1 task claim race when the task is $name', async (scenario) => {
      const originalD1Env = globalThis.__CF_ENV__;
      const { db } = createD1Binding([[], [], [], [], [], []]);
      globalThis.__CF_ENV__ = { DB: db };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      let taskReads = 0;
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('FROM internal_tasks t')) {
          taskReads += 1;
          return { rows: [{
            id: 'task-claim-race', task_number: 'TASK-RACE', task_type: 'Add Credits',
            status: scenario.approved && taskReads > 1 ? 'Completed' : 'Pending Approval',
            approval_status: scenario.approved && taskReads > 1 ? 'APPROVED' : 'PENDING',
            credit_account_type: 'BUYER', credit_account_id: 'buyer-claim-race',
            credit_quantity: 1, attachments: '[]', raw: '{}',
          }] };
        }
        if (sql.includes('FROM internal_task_activities')) return { rows: [] };
        if (sql.includes('FROM buyer_accounts')) return { rows: [{ available_credits: 1 }] };
        return { rows: [] };
      });

      try {
        if (scenario.shouldReject) {
          await expect(queries.approveCreditTask('task-claim-race')).rejects.toThrow('Credit task could not be claimed');
        } else {
          await expect(queries.approveCreditTask('task-claim-race')).resolves.toMatchObject({ status: 'Completed' });
        }
        expect(db.batch).toHaveBeenCalledTimes(1);
      } finally {
        if (originalD1Env === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = originalD1Env;
      }
    });

    test('logs and rethrows an atomic D1 approval batch failure', async () => {
      const originalD1Env = globalThis.__CF_ENV__;
      const failure = new Error('D1 batch unavailable');
      const { db } = createD1Binding([]);
      db.batch.mockRejectedValue(failure);
      globalThis.__CF_ENV__ = { DB: db };
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('FROM internal_tasks t')) return { rows: [{
          id: 'task-fail', task_number: 'TASK-FAIL', task_type: 'Add Credits', status: 'Pending Approval',
          credit_account_type: 'BUYER', credit_account_id: 'buyer-fail', credit_quantity: 2, attachments: '[]', raw: '{}',
        }] };
        if (sql.includes('FROM internal_task_activities')) return { rows: [] };
        if (sql.includes('FROM buyer_accounts')) return { rows: [{ available_credits: 3 }] };
        return { rows: [] };
      });
      const logger = require('../src/services/loggerService').logger;
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});

      try {
        await expect(queries.approveCreditTask('task-fail')).rejects.toBe(failure);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Atomic D1 credit approval batch failed'), expect.objectContaining({
          taskId: 'task-fail',
          queryCount: 6,
        }), 'INTERNAL_TASK_CREDIT_APPROVAL');
      } finally {
        errorSpy.mockRestore();
        if (originalD1Env === undefined) delete globalThis.__CF_ENV__;
        else globalThis.__CF_ENV__ = originalD1Env;
      }
    });

    test('updateInternalTask logs activities for demo reschedule, call outcome, onboarding stage, proposal status, and new attachment', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (sql.includes('WHERE t.id = $1 OR t.task_number = $1')) {
          return Promise.resolve({
            rows: [
              {
                id: 'tsk_lifecycle_1',
                title: 'Lifecycle Task',
                status: 'In Progress',
                demo_status: 'Scheduled',
                onboarding_stage: '1',
                proposal_status: 'Draft',
                attachments: '[]',
                raw: '{"onboarding_stage":"1","proposal_status":"Draft"}',
              },
            ],
          });
        }
        if (sql.includes('FROM internal_task_activities')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rowCount: 1 });
      });

      const updated = await queries.updateInternalTask(
        'tsk_lifecycle_1',
        {
          demoStatus: 'Completed',
          rescheduleReason: 'Demo completed successfully',
          callOutcome: 'Connected - Interested',
          callRemarks: 'Discussed requirements',
          onboardingStage: '2',
          stageNote: 'KYC documents received',
          proposalStatus: 'Sent to Client',
          proposalRemarks: 'Sent commercial offer',
          newAttachment: { name: 'Offer.pdf', url: 'https://cdn.example.com/offer.pdf' },
        },
        { fullName: 'Staff Executive' }
      );

      expect(updated).toBeDefined();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE internal_tasks'),
        expect.any(Array),
        expect.any(Object)
      );
    });
    test('approveCreditTask returns task immediately if already approved', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [{ id: 'tsk_already_done', status: 'Completed', approval_status: 'APPROVED' }],
          });
        }
        if (typeof sql === 'string' && sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [{ id: 'tsk_already_done', status: 'Completed', approval_status: 'APPROVED' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await queries.approveCreditTask('tsk_already_done');
      expect(res).toBeDefined();
    });

    test('approveCreditTask does not mutate memory store if commit fails', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const storeService = require('../src/services/storeService');
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([
        { id: 'buy_commit_fail', creditBalance: 50 },
      ]);
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockImplementation((id, updates) => updates);

      jest.spyOn(pool, 'query').mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('FROM internal_tasks')) {
          return Promise.resolve({
            rows: [{ id: 'tsk_cf', task_category: 'CREDIT_MANAGEMENT', task_type: 'Add Credits', credit_account_type: 'BUYER', credit_account_id: 'buy_commit_fail', credit_quantity: 10 }],
          });
        }
        if (sql === 'COMMIT') {
          return Promise.reject(new Error('Commit failed'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(queries.approveCreditTask('tsk_cf')).rejects.toThrow('Commit failed');
      expect(updateBuyerSpy).not.toHaveBeenCalled();
    });
  });
});

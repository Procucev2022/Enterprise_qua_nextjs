const pool = require('../src/db/pool');
const queries = require('../src/db/internalTaskQueries');

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

    test('returns empty array when storage is not configured or rows missing', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await queries.getTaskTypes()).toEqual([]);

      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue(null);
      expect(await queries.getTaskTypes()).toEqual([]);
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

    test('handles fallback when storage is not configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const res = await queries.getInternalTasks();
      expect(res).toEqual({ rows: [], total: 0 });
    });
  });

  describe('getInternalTaskSummary', () => {
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
});

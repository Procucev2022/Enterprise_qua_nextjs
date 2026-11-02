import {
  DEFAULT_TASK_TYPES,
  fetchTaskTypes,
  createNewTaskType,
  fetchInternalTasks,
  fetchTaskSummary,
  fetchTaskById,
  createInternalTask,
  updateInternalTask,
  deleteInternalTask,
  searchRelatedEntities,
  getExportTasksUrl,
  fetchInternalAssignees,
  completeInternalTask,
  approveCreditTask,
  rejectCreditTask,
  addTaskActivity,
  checkTaskReminders,
  exportTasksToCsv,
} from '@/lib/internalTaskClient';
import { DEFAULT_INTERNAL_MEMBERS } from '@/lib/constants';
import { authClient } from '@/lib/authClient';

describe('internalTaskClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('mock-jwt-token');
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('fetchTaskTypes returns task types list on success and handles failures', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ taskTypes: [{ id: 'itt_1', name: 'Review RFQ', code: 'rfq_rev', default_module: 'RFQ' }] }),
    });

    const types = await fetchTaskTypes();
    expect(types).toHaveLength(1);
    expect(types[0].id).toBe('itt_1');

    // Failure case (res.ok = false)
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    expect(await fetchTaskTypes()).toEqual(DEFAULT_TASK_TYPES);

    // Exception case
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));
    expect(await fetchTaskTypes()).toEqual(DEFAULT_TASK_TYPES);
  });

  test('createNewTaskType creates a new task type and handles failures', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ taskType: { id: 'itt_2', name: 'Custom Audit' } }),
    });

    const res = await createNewTaskType({ name: 'Custom Audit', defaultModule: 'VENDOR' });
    expect(res?.id).toBe('itt_2');

    // Failure
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    expect(await createNewTaskType({ name: 'Fail' })).toBeNull();

    // Exception
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Boom'));
    expect(await createNewTaskType({ name: 'Err' })).toBeNull();
  });

  test('fetchInternalTasks handles query parameters and responses', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tasks: [{ id: 'tsk_1', title: 'Task 1', priority: 'High', status: 'Pending', related_entity_type: 'RFQ' }],
        total: 1,
      }),
    });

    const res = await fetchInternalTasks({
      search: 'audit',
      status: 'Pending',
      priority: 'High',
      taskTypeId: 'itt_1',
      relatedEntityType: 'RFQ',
      assignedTo: 'Sudheer',
      dueFrom: '2026-10-01',
      dueTo: '2026-10-31',
      limit: 10,
      offset: 0,
    });

    expect(res.tasks).toHaveLength(1);
    expect(res.total).toBe(1);

    // Failure
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    expect(await fetchInternalTasks()).toEqual({ tasks: [], total: 0 });

    // Exception
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Fetch failed'));
    expect(await fetchInternalTasks()).toEqual({ tasks: [], total: 0 });
  });

  test('fetchTaskSummary returns metrics and fallbacks on error', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ summary: { total: 10, pending: 2, inProgress: 3, blocked: 1, completed: 3, escalated: 1, criticalCount: 1 } }),
    });

    const summary = await fetchTaskSummary();
    expect(summary.total).toBe(10);

    // Failure
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    const fallback = await fetchTaskSummary();
    expect(fallback.total).toBe(0);

    // Exception
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Summary error'));
    expect((await fetchTaskSummary()).total).toBe(0);
  });

  test('fetchTaskById returns task detail or null', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: 'tsk_101', title: 'Audit Task' } }),
    });

    const task = await fetchTaskById('tsk_101');
    expect(task?.id).toBe('tsk_101');

    // Failure
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    expect(await fetchTaskById('bad_id')).toBeNull();

    // Exception
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Not found'));
    expect(await fetchTaskById('err_id')).toBeNull();
  });

  test('createInternalTask sends POST and returns task or null', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: 'tsk_created', title: 'New Task' } }),
    });

    const task = await createInternalTask({ title: 'New Task', priority: 'High', status: 'Pending' });
    expect(task?.id).toBe('tsk_created');

    // Failure
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    expect(await createInternalTask({ title: 'Fail' })).toBeNull();

    // Exception
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Err'));
    expect(await createInternalTask({ title: 'Err' })).toBeNull();
  });

  test('updateInternalTask sends PUT and returns updated task or null', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: 'tsk_1', status: 'Completed' } }),
    });

    const updated = await updateInternalTask('tsk_1', { status: 'Completed' });
    expect(updated?.status).toBe('Completed');

    // Failure
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    expect(await updateInternalTask('tsk_1', { status: 'Blocked' })).toBeNull();

    // Exception
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Err'));
    expect(await updateInternalTask('tsk_1', {})).toBeNull();
  });

  test('deleteInternalTask sends DELETE and returns boolean', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true });
    expect(await deleteInternalTask('tsk_1')).toBe(true);

    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    expect(await deleteInternalTask('tsk_1')).toBe(false);

    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Delete err'));
    expect(await deleteInternalTask('tsk_1')).toBe(false);
  });

  test('searchRelatedEntities queries dynamic entities', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entities: [{ id: 'rfq_1', label: 'RFQ-01', entityType: 'RFQ' }] }),
    });

    const entities = await searchRelatedEntities('RFQ', 'RFQ-01');
    expect(entities).toHaveLength(1);

    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    expect(await searchRelatedEntities('VENDOR')).toEqual([]);

    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Err'));
    expect(await searchRelatedEntities('BUYER')).toEqual([]);
  });

  test('getExportTasksUrl builds export URL with query parameters', () => {
    const url = getExportTasksUrl({
      search: 'audit',
      status: 'Pending',
      priority: 'Critical',
      taskTypeId: 'itt_1',
      relatedEntityType: 'BUYER',
      assignedTo: 'John',
      dueFrom: '2026-10-01',
      dueTo: '2026-10-31',
    });

    expect(url).toContain('/api/internal-tasks/export?');
    expect(url).toContain('search=audit');
    expect(url).toContain('status=Pending');
    expect(url).toContain('priority=Critical');
    expect(url).toContain('taskTypeId=itt_1');
    expect(url).toContain('relatedEntityType=BUYER');
    expect(url).toContain('assignedTo=John');
    expect(url).toContain('dueFrom=2026-10-01');
    expect(url).toContain('dueTo=2026-10-31');

    // Test with 'all' filters to ensure they are omitted
    const emptyUrl = getExportTasksUrl({
      status: 'all',
      priority: 'all',
      taskTypeId: 'all',
      relatedEntityType: 'all',
      assignedTo: 'all',
    });
    expect(emptyUrl).toBe('/api/internal-tasks/export?');
  });

  test('handles malformed or missing response payload fields gracefully', async () => {
    // taskTypes not an array
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ taskTypes: 'invalid' }),
    });
    expect(await fetchTaskTypes()).toEqual(DEFAULT_TASK_TYPES);

    // taskType missing in create
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    expect(await createNewTaskType({ name: 'Test' })).toBeNull();

    // tasks and total invalid
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tasks: null, total: null }),
    });
    expect(await fetchInternalTasks({ status: 'all', priority: 'all', taskTypeId: 'all', relatedEntityType: 'all', assignedTo: 'all' })).toEqual({
      tasks: [],
      total: 0,
    });

    // summary missing
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    expect((await fetchTaskSummary()).total).toBe(0);

    // taskById missing
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    expect(await fetchTaskById('tsk_1')).toBeNull();

    // createTask missing
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    expect(await createInternalTask({ title: 'New' })).toBeNull();

    // updateTask missing
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    expect(await updateInternalTask('tsk_1', {})).toBeNull();

    // searchRelatedEntities entities not an array
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entities: null }),
    });
    expect(await searchRelatedEntities('BUYER')).toEqual([]);
  });

  test('handles authHeaders when token is absent', async () => {
    jest.spyOn(authClient, 'getToken').mockReturnValue(null);
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ taskTypes: [] }),
    });

    await fetchTaskTypes();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/internal-tasks/task-types',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  test('fetchInternalAssignees returns assignees list and handles fallbacks', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        assignees: [
          { id: 'exec-1', name: 'Pavani', role: 'CRM Executive' },
          { id: 'exec-2', name: 'Navin Chaudhary', role: 'Category Specialist' },
        ],
      }),
    });

    const assignees = await fetchInternalAssignees();
    expect(assignees).toHaveLength(2);
    expect(assignees[0].name).toBe('Pavani');

    // res.ok = false fallback
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });
    expect(await fetchInternalAssignees()).toEqual(DEFAULT_INTERNAL_MEMBERS);

    // exception fallback
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network failure'));
    expect(await fetchInternalAssignees()).toEqual(DEFAULT_INTERNAL_MEMBERS);

    // empty array fallback
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ assignees: [] }),
    });
    expect(await fetchInternalAssignees()).toEqual(DEFAULT_INTERNAL_MEMBERS);
  });

  test('fetchTaskSummary supports assignedTo query parameter', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        summary: { total: 4, pending: 1, inProgress: 1, blocked: 0, completed: 2, escalated: 0, criticalCount: 0 },
      }),
    });

    const sum = await fetchTaskSummary({ assignedTo: 'Pavani' });
    expect(sum.total).toBe(4);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/internal-tasks/summary?assignedTo=Pavani',
      expect.any(Object)
    );
  });

  test('completeInternalTask calls updateInternalTask with Completed status and remarks', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: { id: 'tsk_1', status: 'Completed', notes: 'Verified and approved' },
      }),
    });

    const res = await completeInternalTask('tsk_1', 'Verified and approved');
    expect(res?.status).toBe('Completed');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/internal-tasks/tsk_1',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"status":"Completed"'),
      })
    );

    // Call without remarks
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: { id: 'tsk_2', status: 'Completed' },
      }),
    });
    const res2 = await completeInternalTask('tsk_2');
    expect(res2?.status).toBe('Completed');
  });


  test('exportTasksToCsv formats task array into valid CSV', () => {
    const csv = exportTasksToCsv([
      {
        id: 'tsk_1',
        task_number: 'TASK-1001',
        task_category: 'COMMUNICATION',
        task_type: 'SMS',
        title: 'Send "Critical" Alert',
        priority: 'High',
        status: 'Completed',
        assigned_to_name: 'Pavani',
        created_by_name: 'Admin',
        due_date: '2026-11-05',
        due_time: '14:00',
        completed_at: '2026-11-04',
        completed_by_name: 'Pavani',
        related_entity_type: 'BUYER',
        related_entity_label: 'Acme "Steel" Corp',
        created_at: '2026-11-01',
        updated_at: '2026-11-04',
      },
      {
        id: 'tsk_empty',
        task_number: '',
        title: '',
        priority: 'Medium',
        status: 'New',
        created_at: '2026-11-01',
        updated_at: '2026-11-01',
      },
    ]);

    expect(csv).toContain('Task Number,Category,Task Type,Title');
    expect(csv).toContain('TASK-1001,COMMUNICATION,SMS,"Send ""Critical"" Alert"');
    expect(csv).toContain('Acme ""Steel"" Corp');

    // Handles empty array
    expect(exportTasksToCsv([])).toContain('Task Number');
  });


  test('approveCreditTask and rejectCreditTask handle approve/reject workflows', async () => {
    // Approve success
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Approved successfully', task: { id: 'tsk_1', status: 'Completed' } }),
    });
    const appRes = await approveCreditTask('tsk_1', 'Verified ledger balance');
    expect(appRes.success).toBe(true);
    expect(appRes.message).toBe('Approved successfully');

    // Approve failure
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, error: 'Unauthorized approver' }),
    });
    const appFail = await approveCreditTask('tsk_1');
    expect(appFail.success).toBe(false);
    expect(appFail.error).toBe('Unauthorized approver');

    // Approve exception
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network drop'));
    expect((await approveCreditTask('tsk_1')).success).toBe(false);

    // Reject success
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Rejected request', task: { id: 'tsk_2', status: 'Rejected' } }),
    });
    const rejRes = await rejectCreditTask('tsk_2', 'Insufficient business justification');
    expect(rejRes.success).toBe(true);

    // Reject failure
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, error: 'Task not found' }),
    });
    const rejFail = await rejectCreditTask('tsk_2');
    expect(rejFail.success).toBe(false);

    // Reject exception
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Server error'));
    expect((await rejectCreditTask('tsk_2')).success).toBe(false);
  });

  test('addTaskActivity logs comment and handles errors', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        activity: { id: 'act_1', comment: 'Client confirmed specs', action_type: 'COMMENT' },
      }),
    });
    const res = await addTaskActivity('tsk_1', 'Client confirmed specs');
    expect(res.success).toBe(true);
    expect(res.activity?.comment).toBe('Client confirmed specs');

    // Failure branch
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Fail' }) });
    expect((await addTaskActivity('tsk_1', 'failed note')).success).toBe(false);

    // Exception branch
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network drop'));
    expect((await addTaskActivity('tsk_1', 'error note')).success).toBe(false);
  });

  test('checkTaskReminders checks deadlines and alerts', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, dispatched: 3 }),
    });
    const res = await checkTaskReminders();
    expect(res.success).toBe(true);
    expect(res.dispatched).toBe(3);

    // Failure
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Fail' }) });
    expect((await checkTaskReminders()).success).toBe(false);

    // Exception
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Err'));
    expect((await checkTaskReminders()).success).toBe(false);
  });


  test('getExportTasksUrl handles empty filters and all values', () => {
    // Empty / default
    const emptyUrl = getExportTasksUrl();
    expect(emptyUrl).toBe('/api/internal-tasks/export?');

    // "all" filters
    const allUrl = getExportTasksUrl({
      status: 'all',
      priority: 'all',
      taskCategory: 'all',
      taskType: 'all',
      taskTypeId: 'all',
      relatedEntityType: 'all',
      assignedTo: 'all',
      createdBy: 'all',
    });
    expect(allUrl).toBe('/api/internal-tasks/export?');
  });

  test('fetchInternalTasks handles "all" filter values', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tasks: [], total: 0 }),
    });

    const res = await fetchInternalTasks({
      status: 'all',
      priority: 'all',
      taskCategory: 'all',
      taskType: 'all',
      taskTypeId: 'all',
      relatedEntityType: 'all',
      assignedTo: 'all',
      createdBy: 'all',
    });
    expect(res.tasks).toEqual([]);
  });

  test('completeInternalTask handles omitted resolution remarks', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ task: { id: 'tsk_no_remarks', status: 'Completed' } }),
    });

    const res = await completeInternalTask('tsk_no_remarks');
    expect(res?.status).toBe('Completed');
  });

  test('approve and reject credit task handle missing data.error', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });
    const appRes = await approveCreditTask('tsk_err_1');
    expect(appRes.error).toBe('Failed to approve credit task.');

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });
    const rejRes = await rejectCreditTask('tsk_err_2');
    expect(rejRes.error).toBe('Failed to reject credit task.');
  });

});

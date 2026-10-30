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
  escalateTask,
  fetchApprovals,
  fetchApprovalSummary,
  updateApprovalStatus,
  DEFAULT_APPROVAL_ITEMS,
  DEFAULT_EXECUTIVES,
} from '@/lib/internalTaskClient';
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

  test('escalateTask updates task with Critical priority and Escalated status', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: {
          id: 'tsk_100',
          title: 'Escalated Task',
          priority: 'Critical',
          status: 'Escalated',
          assigned_to_name: 'Operations Manager',
        },
      }),
    });

    const result = await escalateTask('tsk_100', {
      escalateTo: 'Operations Manager',
      escalationReason: 'Client SLA breached',
      notes: 'Please review immediately.',
    });

    expect(result).not.toBeNull();
    expect(result?.priority).toBe('Critical');
    expect(result?.status).toBe('Escalated');

    // Without extra notes
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        task: { id: 'tsk_101', priority: 'Critical', status: 'Escalated' },
      }),
    });
    const result2 = await escalateTask('tsk_101', {
      escalateTo: 'Lead',
      escalationReason: 'Blocker',
    });
    expect(result2?.status).toBe('Escalated');
  });

  test('approvals functions and fallback filtering work correctly', async () => {
    expect(DEFAULT_APPROVAL_ITEMS.length).toBeGreaterThan(0);
    expect(DEFAULT_EXECUTIVES.length).toBeGreaterThan(0);

    // fetchApprovals API success
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        approvals: [
          {
            id: 'app_test_1',
            requestId: 'REQ-999',
            module: 'Credit Allocations',
            project: 'Solar EPC',
            applicant: 'SunPower Ltd',
            valueImpact: '+10 Credits',
            makerName: 'Priya',
            status: 'Pending',
            createdAt: '2026-10-29T10:00:00Z',
          },
        ],
      }),
    });

    const apiItems = await fetchApprovals({ module: 'Credit Allocations' });
    expect(apiItems).toHaveLength(1);
    expect(apiItems[0].requestId).toBe('REQ-999');

    // fetchApprovals API error -> fallback filtering
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network offline'));
    const fallbackAll = await fetchApprovals();
    expect(fallbackAll.length).toBeGreaterThanOrEqual(1);

    // Test filter conditions
    const filterByModule = await fetchApprovals({ module: 'Credit Allocations' });
    expect(filterByModule.every((i) => i.module === 'Credit Allocations')).toBe(true);

    const filterByStatus = await fetchApprovals({ status: 'Pending' });
    expect(filterByStatus.every((i) => i.status === 'Pending')).toBe(true);

    const filterByProject = await fetchApprovals({ project: 'Solar' });
    expect(filterByProject.every((i) => i.project.toLowerCase().includes('solar'))).toBe(true);

    const filterBySearch = await fetchApprovals({ search: 'REQ-999' });
    expect(filterBySearch.length).toBeGreaterThan(0);

    const filterNoMatch = await fetchApprovals({ search: 'NONEXISTENT_XYZ_QUERY' });
    expect(filterNoMatch).toHaveLength(0);

    // fetchApprovalSummary
    const summary = await fetchApprovalSummary();
    expect(summary.total).toBeGreaterThanOrEqual(1);
    expect(typeof summary.pending).toBe('number');
    expect(typeof summary.approved).toBe('number');
    expect(typeof summary.rejected).toBe('number');

    // updateApprovalStatus API success
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        approval: {
          id: 'app_test_1',
          requestId: 'REQ-999',
          status: 'Approved',
          reviewerName: 'Lead Reviewer',
        },
      }),
    });
    const updatedApi = await updateApprovalStatus('app_test_1', 'Approved', 'Lead Reviewer');
    expect(updatedApi?.status).toBe('Approved');

    // updateApprovalStatus fallback
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('API Down'));
    const updatedLocal = await updateApprovalStatus('app_test_1', 'Rejected', 'Local Manager', 'Rejected per policy');
    expect(updatedLocal?.status).toBe('Rejected');

    // updateApprovalStatus nonexistent id
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('API Down'));
    const notFound = await updateApprovalStatus('app_does_not_exist', 'Approved');
    expect(notFound).toBeNull();
  });
});

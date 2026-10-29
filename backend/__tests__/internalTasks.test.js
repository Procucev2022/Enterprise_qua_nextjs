const request = require('supertest');
const app = require('../src/app');
const internalTaskQueries = require('../src/db/internalTaskQueries');

describe('Internal Tasks API & Controller', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('GET /api/internal-tasks/task-types returns active task types', async () => {
    jest.spyOn(internalTaskQueries, 'getTaskTypes').mockResolvedValue([
      { id: 'itt_vendor_followup', name: 'Vendor Follow-up', default_module: 'VENDOR' },
      { id: 'itt_quotation_review', name: 'Quotation Review', default_module: 'RFQ' },
    ]);

    const res = await request(app).get('/api/internal-tasks/task-types');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.taskTypes)).toBe(true);
    expect(res.body.taskTypes.length).toBe(2);
  });

  test('POST /api/internal-tasks/task-types validates name and creates new dynamic task type', async () => {
    // Missing name validation
    const failRes = await request(app)
      .post('/api/internal-tasks/task-types')
      .send({ name: '   ' });
    expect(failRes.status).toBe(400);

    // Valid creation
    jest.spyOn(internalTaskQueries, 'createTaskType').mockResolvedValue({
      id: 'itt_custom_1',
      name: 'Autonomous Tender Verification',
      code: 'auto_tender_verification',
      default_module: 'RFQ',
      description: 'Verification of autonomous mode tenders',
    });

    const res = await request(app)
      .post('/api/internal-tasks/task-types')
      .send({
        name: 'Autonomous Tender Verification',
        code: 'auto_tender_verification',
        defaultModule: 'RFQ',
        description: 'Verification of autonomous mode tenders',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.taskType.name).toBe('Autonomous Tender Verification');
  });

  test('GET /api/internal-tasks/entities returns matching entity lists by type', async () => {
    jest.spyOn(internalTaskQueries, 'searchRelatedEntities').mockImplementation(async (type) => {
      if (type === 'RFQ') return [{ id: 'rfq-1', label: 'RFQ262910743626 — Mechanical', entityType: 'RFQ' }];
      if (type === 'BUYER') return [{ id: 'org-1', label: 'Tata Steel Ltd', entityType: 'BUYER' }];
      if (type === 'VENDOR') return [{ id: 'v-1', label: 'Unique Ceramic', entityType: 'VENDOR' }];
      if (type === 'CATEGORY') return [{ id: 'cat-1', label: 'Mechanical > Spares', entityType: 'CATEGORY' }];
      if (type === 'USER') return [{ id: 'u-1', label: 'Sudheer Kangala', entityType: 'USER' }];
      return [];
    });

    // RFQ lookup
    const rfqRes = await request(app).get('/api/internal-tasks/entities?type=RFQ');
    expect(rfqRes.status).toBe(200);
    expect(rfqRes.body.success).toBe(true);
    expect(rfqRes.body.entities.length).toBe(1);

    // BUYER lookup
    const buyerRes = await request(app).get('/api/internal-tasks/entities?type=BUYER');
    expect(buyerRes.status).toBe(200);
    expect(buyerRes.body.entities[0].label).toBe('Tata Steel Ltd');

    // Unknown type returns empty array
    const unknownRes = await request(app).get('/api/internal-tasks/entities?type=UNKNOWN_MODULE');
    expect(unknownRes.status).toBe(200);
    expect(unknownRes.body.entities).toEqual([]);
  });

  test('GET /api/internal-tasks/summary returns task summary counts', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalTaskSummary').mockResolvedValue({
      total: 5,
      pending: 2,
      inProgress: 1,
      blocked: 0,
      completed: 1,
      escalated: 1,
      criticalCount: 1,
    });

    const res = await request(app).get('/api/internal-tasks/summary');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary.total).toBe(5);
    expect(res.body.summary.pending).toBe(2);
  });

  test('POST /api/internal-tasks validates title and creates a task', async () => {
    // Missing title
    const failRes = await request(app)
      .post('/api/internal-tasks')
      .send({ description: 'No title' });
    expect(failRes.status).toBe(400);

    // Valid task
    jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({
      id: 'tsk_101',
      task_number: 'TASK-1001',
      title: 'Expedite L1 pricing approval for Solar Farm RFQ',
      description: 'Verify margin thresholds and line item deliveries',
      priority: 'High',
      status: 'Pending',
      related_entity_type: 'RFQ',
      related_entity_id: 'rfq-test-101',
      related_entity_label: 'RFQ-SOLAR-101 — Solar Farm Inverters',
    });

    const res = await request(app)
      .post('/api/internal-tasks')
      .send({
        title: 'Expedite L1 pricing approval for Solar Farm RFQ',
        description: 'Verify margin thresholds and line item deliveries',
        priority: 'High',
        status: 'Pending',
        relatedEntityType: 'RFQ',
        relatedEntityId: 'rfq-test-101',
        relatedEntityLabel: 'RFQ-SOLAR-101 — Solar Farm Inverters',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.task.title).toBe('Expedite L1 pricing approval for Solar Farm RFQ');
  });

  test('GET /api/internal-tasks filters tasks and returns paginated rows', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalTasks').mockResolvedValue({
      rows: [
        {
          id: 'tsk_101',
          task_number: 'TASK-1001',
          title: 'Expedite L1 pricing approval for Solar Farm RFQ',
          status: 'Pending',
          priority: 'High',
        },
      ],
      total: 1,
    });

    const res = await request(app)
      .get('/api/internal-tasks')
      .query({ search: 'Solar Farm', status: 'Pending', priority: 'High' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.total).toBe(1);
    expect(res.body.tasks[0].id).toBe('tsk_101');
  });

  test('GET /api/internal-tasks/:id returns task with activity history, or 404', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockImplementation(async (id) => {
      if (id === 'tsk_101') {
        return {
          id: 'tsk_101',
          title: 'Expedite L1 pricing approval',
          activities: [{ id: 'act_1', action_type: 'CREATED', comment: 'Task created.' }],
        };
      }
      return null;
    });

    const res = await request(app).get('/api/internal-tasks/tsk_101');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.task.id).toBe('tsk_101');

    const notFound = await request(app).get('/api/internal-tasks/non_existent_id');
    expect(notFound.status).toBe(404);
  });

  test('PUT /api/internal-tasks/:id updates status and priority, and logs activity', async () => {
    jest.spyOn(internalTaskQueries, 'updateInternalTask').mockImplementation(async (id, updates) => {
      if (id === 'tsk_101') {
        return {
          id: 'tsk_101',
          status: updates.status || 'In Progress',
          priority: updates.priority || 'Critical',
        };
      }
      return null;
    });

    const res = await request(app)
      .put('/api/internal-tasks/tsk_101')
      .send({ status: 'In Progress', priority: 'Critical' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.task.status).toBe('In Progress');

    const notFound = await request(app)
      .put('/api/internal-tasks/non_existent')
      .send({ status: 'Completed' });
    expect(notFound.status).toBe(404);
  });

  test('GET /api/internal-tasks/export returns CSV attachment', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalTasks').mockResolvedValue({
      rows: [
        {
          task_number: 'TASK-1001',
          title: 'Expedite L1 pricing approval for Solar Farm RFQ',
          description: 'Verify margin thresholds',
          task_type_name: 'Quotation Review',
          priority: 'High',
          status: 'Pending',
          assigned_to_name: 'Sudheer Kangala',
          related_entity_type: 'RFQ',
          related_entity_label: 'RFQ262910743626',
          due_date: '2026-11-15',
          created_at: '2026-10-29',
          notes: 'Important',
        },
      ],
      total: 1,
    });

    const res = await request(app)
      .get('/api/internal-tasks/export')
      .query({ status: 'Pending' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Task ID,Title,Description');
    expect(res.text).toContain('Expedite L1 pricing approval for Solar Farm RFQ');

    // Test with missing fields to exercise fallback branches
    jest.spyOn(internalTaskQueries, 'getInternalTasks').mockResolvedValue({
      rows: [
        {
          id: 'tsk_empty',
          task_number: '',
          title: '',
          description: '',
          task_type_name: '',
          task_type_id: 'itt_generic',
          priority: '',
          status: '',
          assigned_to_name: '',
          related_entity_type: '',
          related_entity_label: '',
          due_date: '',
          created_at: '',
          notes: '',
        },
      ],
      total: 1,
    });
    const fallbackRes = await request(app).get('/api/internal-tasks/export');
    expect(fallbackRes.status).toBe(200);
    expect(fallbackRes.text).toContain('tsk_empty');
  });

  test('DELETE /api/internal-tasks/:id deletes task', async () => {
    jest.spyOn(internalTaskQueries, 'deleteInternalTask').mockResolvedValue(true);

    const res = await request(app).delete('/api/internal-tasks/tsk_101');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('handles 500 error catch branches gracefully', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalTasks').mockRejectedValue(new Error('DB failure'));
    const res = await request(app).get('/api/internal-tasks');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);

    jest.spyOn(internalTaskQueries, 'getInternalTaskSummary').mockRejectedValue(new Error('DB failure'));
    const sumRes = await request(app).get('/api/internal-tasks/summary');
    expect(sumRes.status).toBe(500);

    jest.spyOn(internalTaskQueries, 'getTaskTypes').mockRejectedValue(new Error('DB failure'));
    const ttRes = await request(app).get('/api/internal-tasks/task-types');
    expect(ttRes.status).toBe(500);

    jest.spyOn(internalTaskQueries, 'createTaskType').mockRejectedValue(new Error('DB failure'));
    const ctRes = await request(app).post('/api/internal-tasks/task-types').send({ name: 'Test' });
    expect(ctRes.status).toBe(500);

    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockRejectedValue(new Error('DB failure'));
    const tByIdRes = await request(app).get('/api/internal-tasks/123');
    expect(tByIdRes.status).toBe(500);

    jest.spyOn(internalTaskQueries, 'createInternalTask').mockRejectedValue(new Error('DB failure'));
    const createRes = await request(app).post('/api/internal-tasks').send({ title: 'Task Test' });
    expect(createRes.status).toBe(500);

    jest.spyOn(internalTaskQueries, 'updateInternalTask').mockRejectedValue(new Error('DB failure'));
    const updateRes = await request(app).put('/api/internal-tasks/123').send({ status: 'Done' });
    expect(updateRes.status).toBe(500);

    jest.spyOn(internalTaskQueries, 'deleteInternalTask').mockRejectedValue(new Error('DB failure'));
    const delRes = await request(app).delete('/api/internal-tasks/123');
    expect(delRes.status).toBe(500);

    jest.spyOn(internalTaskQueries, 'searchRelatedEntities').mockRejectedValue(new Error('DB failure'));
    const searchRes = await request(app).get('/api/internal-tasks/entities');
    expect(searchRes.status).toBe(500);

    jest.spyOn(internalTaskQueries, 'getInternalTasks').mockRejectedValue(new Error('DB failure'));
    const expRes = await request(app).get('/api/internal-tasks/export');
    expect(expRes.status).toBe(500);
  });
});

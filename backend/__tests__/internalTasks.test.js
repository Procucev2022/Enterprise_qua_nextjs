const request = require('supertest');
const app = require('../src/app');
const internalTaskQueries = require('../src/db/internalTaskQueries');

describe('Internal Tasks API & Controller', () => {
  test('GET /api/internal-tasks/assignees returns team members and handles failure', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
      { id: 'exec-1', name: 'Pavani', role: 'CRM Executive' },
      { id: 'exec-2', name: 'Navin Chaudhary', role: 'Category Specialist' },
    ]);

    const res = await request(app).get('/api/internal-tasks/assignees');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.assignees.length).toBe(2);
    expect(res.body.assignees[0].name).toBe('Pavani');

    // Error branch
    jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockRejectedValue(new Error('Assignees DB error'));
    const errRes = await request(app).get('/api/internal-tasks/assignees');
    expect(errRes.status).toBe(500);
    expect(errRes.body.success).toBe(false);
  });

  test('GET /api/internal-tasks/summary with assignedTo passes user filter', async () => {
    const summarySpy = jest.spyOn(internalTaskQueries, 'getInternalTaskSummary').mockResolvedValue({
      total: 3,
      pending: 1,
      inProgress: 1,
      blocked: 0,
      completed: 1,
      escalated: 0,
      criticalCount: 0,
    });

    await request(app).get('/api/internal-tasks/summary?taskCategory=CREDIT_MANAGEMENT');
    const res = await request(app).get('/api/internal-tasks/summary?assignedTo=Pavani');
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(3);
    expect(summarySpy).toHaveBeenCalledWith({ assignedTo: 'Pavani' });
  });

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
    expect(ttRes.status).toBe(200);
    expect(ttRes.body.taskTypes).toEqual(internalTaskQueries.DEFAULT_TASK_TYPES);

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
    const updateRes = await request(app).put('/api/internal-tasks/123').send({ status: 'In Progress' });
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

  test('POST /api/internal-tasks/:id/approve approves credit request and updates balance', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue({
      id: 'tsk_cred_1',
      task_number: 'TASK-9901',
      task_category: 'CREDIT_MANAGEMENT',
      status: 'Pending Approval',
    });
    jest.spyOn(internalTaskQueries, 'approveCreditTask').mockResolvedValue({
      id: 'tsk_cred_1',
      task_number: 'TASK-9901',
      status: 'Completed',
    });

    const res = await request(app)
      .post('/api/internal-tasks/tsk_cred_1/approve')
      .send({ remarks: 'Approved by Financial Controller' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.task.status).toBe('Completed');

    // 404 branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue(null);
    const notFound = await request(app).post('/api/internal-tasks/unknown/approve').send({});
    expect(notFound.status).toBe(404);

    // 500 branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockRejectedValue(new Error('Approve error'));
    const errRes = await request(app).post('/api/internal-tasks/tsk_cred_1/approve').send({});
    expect(errRes.status).toBe(500);

    // Falsy updated branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue({ id: 'tsk_cred_falsy' });
    jest.spyOn(internalTaskQueries, 'approveCreditTask').mockResolvedValue(null);
    const falsyRes = await request(app).post('/api/internal-tasks/tsk_cred_falsy/approve').send({});
    expect(falsyRes.status).toBe(500);
  });

  test('POST /api/internal-tasks/:id/reject rejects credit request', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue({
      id: 'tsk_cred_2',
      task_number: 'TASK-9902',
      task_category: 'CREDIT_MANAGEMENT',
      status: 'Pending Approval',
    });
    jest.spyOn(internalTaskQueries, 'rejectCreditTask').mockResolvedValue({
      id: 'tsk_cred_2',
      task_number: 'TASK-9902',
      status: 'Rejected',
    });

    const res = await request(app)
      .post('/api/internal-tasks/tsk_cred_2/reject')
      .send({ remarks: 'Duplicate request' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.task.status).toBe('Rejected');

    // 404 branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue(null);
    const notFound = await request(app).post('/api/internal-tasks/unknown/reject').send({});
    expect(notFound.status).toBe(404);

    // 500 error branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockRejectedValue(new Error('Reject error'));
    const errRes = await request(app).post('/api/internal-tasks/tsk_cred_2/reject').send({});
    expect(errRes.status).toBe(500);

    // Falsy updated branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue({ id: 'tsk_cred_rej_falsy' });
    jest.spyOn(internalTaskQueries, 'rejectCreditTask').mockResolvedValue(null);
    const falsyRej = await request(app).post('/api/internal-tasks/tsk_cred_rej_falsy/reject').send({});
    expect(falsyRej.status).toBe(500);
  });

  test('POST /api/internal-tasks/:id/activities logs remarks and progress', async () => {
    // Validation failure: blank comment
    const blankRes = await request(app)
      .post('/api/internal-tasks/tsk_101/activities')
      .send({ comment: '   ' });
    expect(blankRes.status).toBe(400);

    jest.spyOn(internalTaskQueries, 'addTaskActivity').mockResolvedValue({
      id: 'act_101',
      task_id: 'tsk_101',
      comment: 'Vendor negotiation ongoing',
    });

    const res = await request(app)
      .post('/api/internal-tasks/tsk_101/activities')
      .send({ comment: 'Vendor negotiation ongoing' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.activity.comment).toBe('Vendor negotiation ongoing');

    // 404 branch
    jest.spyOn(internalTaskQueries, 'addTaskActivity').mockResolvedValue(null);
    const notFound = await request(app)
      .post('/api/internal-tasks/unknown/activities')
      .send({ comment: 'Valid comment' });
    expect(notFound.status).toBe(404);

    // 500 branch
    jest.spyOn(internalTaskQueries, 'addTaskActivity').mockRejectedValue(new Error('Activity error'));
    const errRes = await request(app)
      .post('/api/internal-tasks/tsk_101/activities')
      .send({ comment: 'Valid comment' });
    expect(errRes.status).toBe(500);
  });

  test('POST /api/internal-tasks/check-reminders dispatches approaching/overdue alerts', async () => {
    jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks').mockResolvedValue([
      {
        id: 'tsk_overdue_1',
        task_number: 'TASK-7701',
        title: 'Review Solar Inverter Quotes',
        due_date: '2026-11-01',
        assigned_to_name: 'Pavani',
        priority: 'High',
      },
      {
        id: 'tsk_overdue_2',
        task_number: 'TASK-7702',
        title: 'Unassigned task',
        assigned_to_name: 'Unassigned',
      },
      {
        id: 'tsk_overdue_3',
        task_number: 'TASK-7703',
        title: 'No name task',
        assigned_to_name: '',
      },
      {
        id: 'tsk_overdue_4',
        task_number: 'TASK-7704',
        title: 'Unknown member task',
        assigned_to_name: 'Ghost Employee',
      },
      {
        id: 'tsk_overdue_5',
        task_number: 'TASK-7705',
        title: 'No email member task',
        assigned_to_name: 'NoEmail Person',
      },
    ]);
    jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
      { id: 'exec-1', name: 'Pavani', email: 'pavani@procucev.com' },
      { id: 'exec-2', name: 'NoEmail Person', email: '' },
    ]);

    const res = await request(app).post('/api/internal-tasks/check-reminders').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(5);

    // Error branch
    jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks').mockRejectedValue(new Error('Reminders error'));
    const errRes = await request(app).post('/api/internal-tasks/check-reminders').send({});
    expect(errRes.status).toBe(500);
  });

  test('enforces explicit confirmation rule for communication tasks before completion', async () => {
    const unconfirmedRes = await request(app)
      .put('/api/internal-tasks/tsk_comm_1')
      .send({
        status: 'Completed',
        taskCategory: 'COMMUNICATION',
      });
    expect(unconfirmedRes.status).toBe(400);
    expect(unconfirmedRes.body.error).toContain('Communication tasks require explicit confirmation');

    jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
      id: 'tsk_comm_1',
      status: 'Completed',
    });

    const confirmedRes = await request(app)
      .put('/api/internal-tasks/tsk_comm_1')
      .send({
        status: 'Completed',
        taskCategory: 'COMMUNICATION',
        completionConfirmed: true,
        completionRemarks: 'Call completed successfully with client procurement head',
      });
    expect(confirmedRes.status).toBe(200);
    expect(confirmedRes.body.success).toBe(true);

    const outcomeRes = await request(app)
      .put('/api/internal-tasks/tsk_comm_1')
      .send({
        status: 'Completed',
        taskCategory: 'COMMUNICATION',
        actionOutcome: 'Call completed successfully with positive response',
      });
    expect(outcomeRes.status).toBe(200);

    const activityRes = await request(app)
      .put('/api/internal-tasks/tsk_comm_1')
      .send({
        status: 'Completed',
        taskCategory: 'COMMUNICATION',
        activityComment: 'Verified requirement with client over call',
      });
    expect(activityRes.status).toBe(200);
  });

  test('POST /api/internal-tasks returns 400 when schema validation fails', async () => {
    const res = await request(app)
      .post('/api/internal-tasks')
      .send({
        title: 'Valid Title',
        priority: 'INVALID_PRIORITY_XYZ',
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('POST /api/internal-tasks dispatches notifications for assigned employee and credit approver', async () => {
    const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
    const notifySpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockResolvedValue({ success: true });
    jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
      { id: 'exec-1', name: 'Pavani', email: 'pavani@procucev.com' },
    ]);
    jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({
      id: 'tsk_cred_101',
      task_number: 'TASK-101',
      title: 'Credit Increase for Acme',
      task_category: 'CREDIT_MANAGEMENT',
      status: 'Pending Approval',
      priority: 'High',
      assigned_to_user_id: 'exec-1',
      assigned_to_name: 'Pavani',
      credit_account_name: 'Acme Corp',
      credit_quantity: 100,
    });

    const res = await request(app)
      .post('/api/internal-tasks')
      .send({
        title: 'Credit Increase for Acme',
        taskCategory: 'CREDIT_MANAGEMENT',
        assignedToName: 'Pavani',
      });

    expect(res.status).toBe(201);
    expect(notifySpy).toHaveBeenCalledTimes(2);
  });

  test('PUT /api/internal-tasks/:id returns 400 when schema validation fails', async () => {
    const res = await request(app)
      .put('/api/internal-tasks/tsk_101')
      .send({
        priority: 'SUPER_URGENT_NOT_ALLOWED',
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('PUT /api/internal-tasks/:id dispatches status update notification to requester', async () => {
    const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
    const notifySpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockResolvedValue({ success: true });

    jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
      id: 'tsk_101',
      task_number: 'TASK-101',
      title: 'Update Vendor Documentation',
      status: 'In Progress',
      created_by_user_id: 'usr-requester-1',
      created_by_name: 'Operations Manager',
      raw: { created_by_email: 'ops@procucev.com' },
    });

    const res = await request(app)
      .put('/api/internal-tasks/tsk_101')
      .send({
        status: 'In Progress',
      });

    expect(res.status).toBe(200);
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: 'ops@procucev.com',
        subject: expect.stringContaining('Task Status Update'),
      }),
      expect.any(Object)
    );
  });

  test('GET /api/internal-tasks/export handles tasks with fallback attributes', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalTasks').mockResolvedValue({
      rows: [
        {
          id: 'tsk_fallback_row',
          task_number: null,
          title: 'Fallback Task',
          description: null,
          task_type_name: null,
          task_type: 'Quotation Review',
          priority: null,
          status: null,
          assigned_to_name: null,
          related_entity_type: null,
          related_entity_label: null,
          due_date: null,
          created_at: null,
          notes: null,
        },
        {
          id: 'tsk_fallback_row_2',
          task_number: 'TASK-FALLBACK-2',
          title: 'Fallback Task 2',
          task_type_name: null,
          task_type: null,
          task_type_id: 'itt_custom_code',
        },
      ],
      total: 2,
    });

    const res = await request(app).get('/api/internal-tasks/export');
    expect(res.status).toBe(200);
    expect(res.text).toContain('tsk_fallback_row');
    expect(res.text).toContain('itt_custom_code');
  });


  test('covers controller fallback branches for notifications and actor overrides', async () => {
    const internalTaskController = require('../src/controllers/internalTaskController');
    const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
    const notifySpy = jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockResolvedValue({ success: true });

    // 1. createTask assignee lookup by name without user_id
    jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
      { id: 'exec-1', name: 'Pavani', email: 'pavani@procucev.com' },
    ]);
    jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({
      id: 'tsk_boost_1',
      task_number: 'TASK-BOOST-1',
      title: 'Task Boost 1',
      status: 'Assigned',
      assigned_to_user_id: null,
      assigned_to_name: 'Pavani',
    });

    const res1 = await request(app)
      .post('/api/internal-tasks')
      .send({
        title: 'Task Boost 1',
        assignedToName: 'Pavani',
      });
    expect(res1.status).toBe(201);

    // 2. updateTask with no raw email or name fallbacks
    jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
      id: 'tsk_boost_2',
      task_number: 'TASK-BOOST-2',
      title: 'Task Boost 2',
      status: 'Assigned',
      created_by_user_id: 'usr-boost-2',
      created_by_name: null,
      raw: null,
    });

    const res2 = await request(app)
      .put('/api/internal-tasks/tsk_boost_2')
      .send({ status: 'Assigned' });
    expect(res2.status).toBe(200);

    // 3. Direct invocation with req.user defined
    const mockReq = {
      params: { id: 'tsk_boost_3' },
      user: { name: 'Direct User', role: 'manager' },
      body: { comment: 'Direct note' },
    };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    jest.spyOn(internalTaskQueries, 'addTaskActivity').mockResolvedValue({ id: 'act_boost_3' });
    await internalTaskController.addTaskActivity(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(201);
  });

});

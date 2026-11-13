const supertest = require('supertest');
const app = require('../src/app');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const authService = require('../src/services/authService');
const registrationQueries = require('../src/db/registrationQueries');
const { authHeader } = require('./testHelpers');
function request(target) {
  const testRequest = supertest(target);
  ['get', 'post', 'put', 'patch', 'delete', 'head'].forEach((method) => {
    const original = testRequest[method].bind(testRequest);
    testRequest[method] = (route) => original(route).set(authHeader('category_manager'));
  });
  return testRequest;
}

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

  test('registration endpoints require an authenticated management role', async () => {
    const anonymousList = await supertest(app).get('/api/internal-tasks/registrations');
    expect(anonymousList.status).toBe(401);

    const anonymousAction = await supertest(app)
      .post('/api/internal-tasks/registrations/reg-client-102/action')
      .send({ action: 'accept' });
    expect(anonymousAction.status).toBe(401);

    const buyerList = await supertest(app).get('/api/internal-tasks/registrations').set(authHeader('buyer'));
    expect(buyerList.status).toBe(403);

    const vendorAction = await supertest(app)
      .post('/api/internal-tasks/registrations/reg-client-102/action')
      .set(authHeader('vendor'))
      .send({ action: 'accept' });
    expect(vendorAction.status).toBe(403);
  });

  test('category managers can read registrations and submit an authenticated decision', async () => {
    jest.spyOn(registrationQueries, 'getRegisteredClients').mockResolvedValue({
      total: 0,
      clients: [],
      limit: 100,
      offset: 0,
    });
    const updateSpy = jest.spyOn(registrationQueries, 'updateClientRegistrationStatus').mockResolvedValue({
      id: 'reg-client-102',
      status: 'Accepted',
      isApproved: true,
    });

    const listResponse = await request(app)
      .get('/api/internal-tasks/registrations')
      .set(authHeader('category_manager'));
    expect(listResponse.status).toBe(200);

    const actionResponse = await request(app)
      .post('/api/internal-tasks/registrations/reg-client-102/action')
      .set(authHeader('category_manager'))
      .send({ action: 'accept', remarks: 'Verified' });
    expect(actionResponse.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      'reg-client-102',
      'accept',
      'Verified',
      expect.objectContaining({ sub: 'usr-catman-001', email: 'catmanager@procucev.com' })
    );
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

  describe('handles 500 error catch branches gracefully', () => {
    test('GET /api/internal-tasks returns 500 on DB failure', async () => {
      jest.spyOn(internalTaskQueries, 'getInternalTasks').mockRejectedValue(new Error('DB failure'));
      const res = await request(app).get('/api/internal-tasks');
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });

    test('GET /api/internal-tasks/summary returns 500 on DB failure', async () => {
      jest.spyOn(internalTaskQueries, 'getInternalTaskSummary').mockRejectedValue(new Error('DB failure'));
      const sumRes = await request(app).get('/api/internal-tasks/summary');
      expect(sumRes.status).toBe(500);
    });

    test('GET /api/internal-tasks/task-types returns an error, not a default list, when the lookup fails', async () => {
      jest.spyOn(internalTaskQueries, 'getTaskTypes').mockRejectedValue(new Error('DB failure'));
      const ttRes = await request(app).get('/api/internal-tasks/task-types');
      expect(ttRes.status).toBe(500);
      expect(ttRes.body.success).toBe(false);
      expect(ttRes.body.taskTypes).toBeUndefined();
    });

    test('GET /api/internal-tasks/task-types returns 503 when task storage is unavailable', async () => {
      jest.spyOn(internalTaskQueries, 'getTaskTypes').mockRejectedValue(Object.assign(new Error('down'), { code: 'PERSISTENCE_UNAVAILABLE' }));
      const ttRes = await request(app).get('/api/internal-tasks/task-types');
      expect(ttRes.status).toBe(503);
      expect(ttRes.body.retryable).toBe(true);
    });

    test('POST /api/internal-tasks/task-types returns 500 on DB failure', async () => {
      jest.spyOn(internalTaskQueries, 'createTaskType').mockRejectedValue(new Error('DB failure'));
      const ctRes = await request(app).post('/api/internal-tasks/task-types').send({ name: 'Test' });
      expect(ctRes.status).toBe(500);
    });

    test('GET /api/internal-tasks/:id returns 500 on DB failure', async () => {
      jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockRejectedValue(new Error('DB failure'));
      const tByIdRes = await request(app).get('/api/internal-tasks/123');
      expect(tByIdRes.status).toBe(500);
    });

    test('POST /api/internal-tasks returns 500 on DB failure', async () => {
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockRejectedValue(new Error('DB failure'));
      const createRes = await request(app).post('/api/internal-tasks').send({ title: 'Task Test' });
      expect(createRes.status).toBe(500);
    });

    test('PUT /api/internal-tasks/:id returns 500 on DB failure', async () => {
      jest.spyOn(internalTaskQueries, 'updateInternalTask').mockRejectedValue(new Error('DB failure'));
      const updateRes = await request(app).put('/api/internal-tasks/123').send({ status: 'In Progress' });
      expect(updateRes.status).toBe(500);
    });

    test('DELETE /api/internal-tasks/:id returns 500 on DB failure', async () => {
      jest.spyOn(internalTaskQueries, 'deleteInternalTask').mockRejectedValue(new Error('DB failure'));
      const delRes = await request(app).delete('/api/internal-tasks/123');
      expect(delRes.status).toBe(500);
    });

    test('GET /api/internal-tasks/entities returns 500 on DB failure', async () => {
      jest.spyOn(internalTaskQueries, 'searchRelatedEntities').mockRejectedValue(new Error('DB failure'));
      const searchRes = await request(app).get('/api/internal-tasks/entities');
      expect(searchRes.status).toBe(500);
    });

    test('GET /api/internal-tasks/export returns 500 on DB failure', async () => {
      jest.spyOn(internalTaskQueries, 'getInternalTasks').mockRejectedValue(new Error('DB failure'));
      const expRes = await request(app).get('/api/internal-tasks/export');
      expect(expRes.status).toBe(500);
    });
  });

  test('POST /api/internal-tasks/:id/approve rejects unauthenticated and unauthorized users', async () => {
    // Unauthenticated (no token → authenticate returns 401)
    const noAuthRes = await supertest(app)
      .post('/api/internal-tasks/tsk_cred_1/approve')
      .send({ remarks: 'Attempted approval' });
    expect(noAuthRes.status).toBe(401);
    expect(noAuthRes.body.success).toBe(false);

    // Authenticated with unauthorized role (buyer → requireRole returns 403)
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValueOnce({
      valid: true,
      user: { sub: 'buyer-1', role: 'buyer' },
    });
    const forbiddenRes = await request(app)
      .post('/api/internal-tasks/tsk_cred_1/approve')
      .set('Authorization', 'Bearer buyer-token')
      .send({ remarks: 'Attempted approval' });
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.success).toBe(false);

    // Direct controller invocation without user or with wrong role
    const internalTaskController = require('../src/controllers/internalTaskController');
    const mockReq = {
      params: { id: 'tsk_cred_role_check' },
      user: { sub: 'buyer-1', name: 'Regular Buyer', role: 'buyer' },
      body: { remarks: 'Trying to approve' },
    };
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.approveCreditTask(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('Insufficient permissions') })
    );

    // Direct controller invocation with undefined req.user
    const noUserReq = {
      params: { id: 'tsk_cred_no_user' },
      body: { remarks: 'Trying to approve' },
    };
    const noUserRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.approveCreditTask(noUserReq, noUserRes);
    expect(noUserRes.status).toHaveBeenCalledWith(403);
  });

  test('POST /api/internal-tasks/:id/approve approves credit request when user has admin role', async () => {
    const internalTaskController = require('../src/controllers/internalTaskController');

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

    // Success path with admin role
    const mockReq = {
      params: { id: 'tsk_cred_1' },
      user: { sub: 'admin-1', name: 'Admin Approver', role: 'admin' },
      body: { remarks: 'Approved by Financial Controller' },
    };
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.approveCreditTask(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, task: expect.objectContaining({ status: 'Completed' }) })
    );

    // 404 branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue(null);
    const notFoundReq = {
      params: { id: 'unknown' },
      user: { sub: 'admin-1', name: 'Admin', role: 'admin' },
      body: {},
    };
    const notFoundRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.approveCreditTask(notFoundReq, notFoundRes);
    expect(notFoundRes.status).toHaveBeenCalledWith(404);

    // 500 error branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockRejectedValue(new Error('Approve error'));
    const errReq = {
      params: { id: 'tsk_cred_1' },
      user: { sub: 'admin-1', name: 'Admin', role: 'category_manager' },
      body: {},
    };
    const errRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.approveCreditTask(errReq, errRes);
    expect(errRes.status).toHaveBeenCalledWith(500);

    // Falsy updated branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue({ id: 'tsk_cred_falsy' });
    jest.spyOn(internalTaskQueries, 'approveCreditTask').mockResolvedValue(null);
    const falsyReq = {
      params: { id: 'tsk_cred_falsy' },
      user: { sub: 'admin-1', name: 'Admin', role: 'admin' },
      body: {},
    };
    const falsyRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.approveCreditTask(falsyReq, falsyRes);
    expect(falsyRes.status).toHaveBeenCalledWith(500);
  });

  test('POST /api/internal-tasks/:id/reject rejects unauthenticated and unauthorized users', async () => {
    // Unauthenticated (no token → authenticate returns 401)
    const noAuthRes = await supertest(app)
      .post('/api/internal-tasks/tsk_cred_2/reject')
      .send({ remarks: 'Attempted rejection' });
    expect(noAuthRes.status).toBe(401);
    expect(noAuthRes.body.success).toBe(false);

    // Authenticated with unauthorized role (vendor → requireRole returns 403)
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValueOnce({
      valid: true,
      user: { sub: 'vendor-1', role: 'vendor' },
    });
    const forbiddenRes = await request(app)
      .post('/api/internal-tasks/tsk_cred_2/reject')
      .set('Authorization', 'Bearer vendor-token')
      .send({ remarks: 'Attempted rejection' });
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.success).toBe(false);

    // Direct controller invocation with wrong role
    const internalTaskController = require('../src/controllers/internalTaskController');
    const mockReq = {
      params: { id: 'tsk_cred_role_check' },
      user: { sub: 'vendor-1', name: 'Some Vendor', role: 'vendor' },
      body: { remarks: 'Trying to reject' },
    };
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.rejectCreditTask(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: expect.stringContaining('Insufficient permissions') })
    );

    // Direct controller invocation with undefined req.user
    const noUserReq = {
      params: { id: 'tsk_cred_no_user_rej' },
      body: { remarks: 'Trying to reject' },
    };
    const noUserRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.rejectCreditTask(noUserReq, noUserRes);
    expect(noUserRes.status).toHaveBeenCalledWith(403);
  });

  test('POST /api/internal-tasks/:id/reject rejects credit request when user has category_manager role', async () => {
    const internalTaskController = require('../src/controllers/internalTaskController');

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

    // Success path with category_manager role
    const mockReq = {
      params: { id: 'tsk_cred_2' },
      user: { sub: 'cm-1', name: 'Category Manager', role: 'category_manager' },
      body: { remarks: 'Duplicate request' },
    };
    const mockRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.rejectCreditTask(mockReq, mockRes);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, task: expect.objectContaining({ status: 'Rejected' }) })
    );

    // 404 branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue(null);
    const notFoundReq = {
      params: { id: 'unknown' },
      user: { sub: 'cm-1', name: 'CM', role: 'category_manager' },
      body: {},
    };
    const notFoundRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.rejectCreditTask(notFoundReq, notFoundRes);
    expect(notFoundRes.status).toHaveBeenCalledWith(404);

    // 500 error branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockRejectedValue(new Error('Reject error'));
    const errReq = {
      params: { id: 'tsk_cred_2' },
      user: { sub: 'admin-1', name: 'Admin', role: 'admin' },
      body: {},
    };
    const errRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.rejectCreditTask(errReq, errRes);
    expect(errRes.status).toHaveBeenCalledWith(500);

    // Falsy updated branch
    jest.spyOn(internalTaskQueries, 'getInternalTaskById').mockResolvedValue({ id: 'tsk_cred_rej_falsy' });
    jest.spyOn(internalTaskQueries, 'rejectCreditTask').mockResolvedValue(null);
    const falsyReq = {
      params: { id: 'tsk_cred_rej_falsy' },
      user: { sub: 'admin-1', name: 'Admin', role: 'admin' },
      body: {},
    };
    const falsyRes = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await internalTaskController.rejectCreditTask(falsyReq, falsyRes);
    expect(falsyRes.status).toHaveBeenCalledWith(500);
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
        assigned_to_user_id: 'exec-2',
      },
      {
        id: 'tsk_overdue_5',
        task_number: 'TASK-7705',
        title: 'No email member task',
        assigned_to_name: 'NoEmail Person',
      },
      {
        id: 'tsk_overdue_6',
        task_number: 'TASK-7706',
        title: 'Unknown member without ID',
        assigned_to_name: 'Another Ghost Employee',
      },
    ]);
    jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
      { id: 'exec-1', name: 'Pavani', email: 'pavani@procucev.com' },
      { id: 'exec-2', name: 'NoEmail Person', email: '' },
    ]);

    const res = await request(app).post('/api/internal-tasks/check-reminders').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(6);

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
    const previousApproverEmail = process.env.CREDIT_APPROVER_EMAIL;
    process.env.CREDIT_APPROVER_EMAIL = 'approver@test.local';
    try {
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
    expect(notifySpy.mock.calls[1][0].recipientEmail).toBe('approver@test.local');
    } finally {
      if (previousApproverEmail === undefined) delete process.env.CREDIT_APPROVER_EMAIL;
      else process.env.CREDIT_APPROVER_EMAIL = previousApproverEmail;
    }
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


  test('POST /api/internal-tasks and PUT /api/internal-tasks handle notification dispatch errors gracefully', async () => {
    const actionCenterNotificationService = require('../src/services/actionCenterNotificationService');
    jest.spyOn(actionCenterNotificationService, 'dispatchActionCenterCommunication').mockRejectedValue(new Error('Notification service down'));
    jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([
      { id: 'exec-1', name: 'Pavani', email: 'pavani@procucev.com' },
    ]);
    jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({
      id: 'tsk_cred_fail',
      task_number: 'TASK-102',
      title: 'Credit Increase Fail',
      task_category: 'CREDIT_MANAGEMENT',
      status: 'Pending Approval',
      assigned_to_user_id: 'exec-1',
      assigned_to_name: 'Pavani',
    });

    const createRes = await request(app)
      .post('/api/internal-tasks')
      .send({
        title: 'Credit Increase Fail',
        taskCategory: 'CREDIT_MANAGEMENT',
        assignedToName: 'Pavani',
      });
    expect(createRes.status).toBe(201);

    jest.spyOn(internalTaskQueries, 'updateInternalTask').mockResolvedValue({
      id: 'tsk_101',
      task_number: 'TASK-101',
      title: 'Update Vendor Documentation',
      status: 'In Progress',
      created_by_user_id: 'usr-requester-1',
      created_by_name: 'Operations Manager',
      created_by_email: 'ops@procucev.com',
    });

    const updateRes = await request(app)
      .put('/api/internal-tasks/tsk_101')
      .send({
        status: 'In Progress',
      });
    expect(updateRes.status).toBe(200);

    // Also test check-reminders when notification fails
    jest.spyOn(internalTaskQueries, 'getOverdueAndUpcomingTasks').mockResolvedValue([
      {
        id: 'tsk_rem_fail',
        task_number: 'TASK-7799',
        title: 'Reminder Fail Task',
        assigned_to_name: 'Pavani',
      },
    ]);
    const remRes = await request(app).post('/api/internal-tasks/check-reminders').send({});
    expect(remRes.status).toBe(200);
    expect(remRes.body.dispatched).toBe(0);
  });
});

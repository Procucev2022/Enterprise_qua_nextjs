const supertest = require('supertest');
const request = (app) => {
  const agent = supertest(app);
  return {
    get: (path) => agent.get(path).set('Authorization', 'Bearer ticket-test-token'),
    post: (path) => agent.post(path).set('Authorization', 'Bearer ticket-test-token'),
    put: (path) => agent.put(path).set('Authorization', 'Bearer ticket-test-token'),
    delete: (path) => agent.delete(path).set('Authorization', 'Bearer ticket-test-token'),
  };
};
const app = require('../src/app');
const ticketQueries = require('../src/db/ticketQueries');
const ticketController = require('../src/controllers/ticketController');
const pool = require('../src/db/pool');
const authService = require('../src/services/authService');
const { TICKET_MESSAGES } = require('../src/config/constants');

// Fixture rows stand in for database rows. Routes only see them through mocked query functions.
const SEEDED_TICKET = Object.freeze({
  id: 'tkt_db_1',
  ticket_number: 'TKT-10001',
  subject: 'Supplier delivery delay on Tata Steel order',
  description: 'Vendor has not dispatched the consignment within the agreed window.',
  status: 'Pending',
  priority: 'High',
  category: 'Vendor Performance',
  project: 'Tata Steel Plant Expansion',
  customer_name: 'Tata Steel Ltd',
  customer_email: 'buyer@example.test',
  customer_phone: '+15555550100',
  assigned_to_name: 'Test Assignee',
  assigned_team: 'Operations',
  due_date: '2026-11-15T18:30:00.000Z',
  attachments: [],
  metadata: {},
  activities: [],
});

const isMissingId = (id) => String(id).startsWith('non-existent');

// A ticket payload that satisfies VALIDATION_SCHEMAS.ticketCreate, including the four
// customer and assignee fields that are required.
const VALID_TICKET_BODY = Object.freeze({
  subject: 'Supplier delivery delay on Tata Steel order',
  description: 'Vendor has not dispatched the consignment within the agreed window.',
  category: 'Vendor Performance',
  priority: 'High',
  project: 'Tata Steel Plant Expansion',
  customerName: 'Tata Steel Ltd',
  customerEmail: 'buyer@example.test',
  customerPhone: '+15555550100',
  assignedToName: 'Test Assignee',
});
const VALID_ESCALATION_BODY = Object.freeze({
  escalatedTo: 'Lead',
  reason: 'Reason for escalation',
});

describe('Tickets API & Controller', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
      valid: true,
      user: {
        sub: 'ticket-staff-id',
        email: 'category.manager@example.test',
        fullName: 'Category Manager',
        role: 'category_manager',
      },
    });
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(ticketQueries, 'getTicketSummary').mockResolvedValue({
      total: 1,
      pending: 1,
      inProgress: 0,
      escalated: 0,
      completed: 0,
      criticalCount: 0,
    });
    jest.spyOn(ticketQueries, 'getTickets').mockResolvedValue({ rows: [SEEDED_TICKET], total: 1 });
    jest.spyOn(ticketQueries, 'getTicketById').mockImplementation(async (id) => (
      isMissingId(id) ? null : { ...SEEDED_TICKET, id }
    ));
    jest.spyOn(ticketQueries, 'createTicket').mockImplementation(async (data) => ({
      ...SEEDED_TICKET,
      id: 'tkt_created_1',
      subject: data.subject,
    }));
    jest.spyOn(ticketQueries, 'updateTicket').mockImplementation(async (id, updates) => (
      isMissingId(id) ? null : { ...SEEDED_TICKET, id, ...updates }
    ));
    jest.spyOn(ticketQueries, 'escalateTicket').mockImplementation(async (id) => (
      isMissingId(id) ? null : { ...SEEDED_TICKET, id, status: 'Escalated' }
    ));
    jest.spyOn(ticketQueries, 'addTicketComment').mockImplementation(async (id, { comment }) => (
      isMissingId(id) ? null : { id: 'tact_1', ticket_id: id, action_type: 'COMMENT', comment }
    ));
    jest.spyOn(ticketQueries, 'deleteTicket').mockImplementation(async (id) => !isMissingId(id));
  });

  test('GET /api/tickets rejects anonymous and non-staff callers', async () => {
    const anonymous = await supertest(app).get('/api/tickets');
    expect(anonymous.status).toBe(401);

    jest.spyOn(authService, 'assertSessionActive').mockResolvedValueOnce({
      valid: true,
      user: { sub: 'buyer-test-id', email: 'buyer@example.test', role: 'buyer' },
    });
    const buyer = await supertest(app)
      .get('/api/tickets')
      .set('Authorization', 'Bearer buyer-token');
    expect(buyer.status).toBe(403);
  });

  test('GET /api/tickets/summary returns ticket summary metrics', async () => {
    const res = await request(app).get('/api/tickets/summary');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toBeDefined();
    expect(typeof res.body.summary.total).toBe('number');
    expect(typeof res.body.summary.pending).toBe('number');
    expect(typeof res.body.summary.escalated).toBe('number');
    expect(typeof res.body.summary.completed).toBe('number');
  });

  test('GET /api/tickets returns the stored list with filters', async () => {
    const res = await request(app)
      .get('/api/tickets?status=Pending&priority=High&search=tata&project=Tata&limit=10&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].ticket_number).toBe(SEEDED_TICKET.ticket_number);
    expect(res.body.total).toBe(1);
  });

  test('GET /api/tickets/:id returns a stored ticket or 404', async () => {
    const notFound = await request(app).get('/api/tickets/non-existent-id-999');
    expect(notFound.status).toBe(404);
    expect(notFound.body.success).toBe(false);

    const found = await request(app).get(`/api/tickets/${SEEDED_TICKET.id}`);
    expect(found.status).toBe(200);
    expect(found.body.success).toBe(true);
    expect(found.body.data.id).toBe(SEEDED_TICKET.id);
  });

  test('POST /api/tickets validates and creates a new ticket', async () => {
    // Missing required subject
    const invalidRes = await request(app).post('/api/tickets').send({
      category: 'Billing',
      priority: 'High',
    });
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.success).toBe(false);

    // Valid payload
    const createRes = await request(app)
      .post('/api/tickets')
      .send({
        subject: 'Supplier delivery delay on Tata Steel order',
        description: 'Vendor has not dispatched consignment within agreed SLA window.',
        category: 'Vendor Performance',
        priority: 'High',
        project: 'Tata Steel Plant Expansion',
        customerName: 'Tata Steel Ltd',
        customerEmail: 'buyer@example.test',
        customerPhone: '+15555550100',
        assignedToName: 'Test Assignee',
        dueDate: '2026-11-15T18:30:00.000Z',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data.subject).toBe('Supplier delivery delay on Tata Steel order');

    const createdId = createRes.body.data.id;

    // PUT /api/tickets/:id update
    const updateRes = await request(app)
      .put(`/api/tickets/${createdId}`)
      .send({
        status: 'In Progress',
        priority: 'Critical',
        resolutionNotes: 'Contacted logistics chaser.',
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.data.status).toBe('In Progress');

    // POST /api/tickets/:id/escalate
    const escalateRes = await request(app)
      .post(`/api/tickets/${createdId}/escalate`)
      .send({
        escalatedTo: 'Category Head',
        reason: 'Vendor SLA breached by 48 hours.',
      });
    expect(escalateRes.status).toBe(200);
    expect(escalateRes.body.success).toBe(true);
    expect(escalateRes.body.data.status).toBe('Escalated');

    // POST /api/tickets/:id/comments
    const commentRes = await request(app)
      .post(`/api/tickets/${createdId}/comments`)
      .send({
        comment: 'Escalation communicated to vendor account manager.',
      });
    expect(commentRes.status).toBe(201);
    expect(commentRes.body.success).toBe(true);
    expect(commentRes.body.data.comment).toBe('Escalation communicated to vendor account manager.');

    // DELETE /api/tickets/:id
    const deleteRes = await request(app).delete(`/api/tickets/${createdId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
  });

  test('PUT /api/tickets/:id handles 400 validation and 404 not found', async () => {
    // 400 validation
    const badRes = await request(app).put('/api/tickets/some-id').send({
      priority: 'InvalidPriority123',
    });
    expect(badRes.status).toBe(400);

    // 404
    const notFound = await request(app).put('/api/tickets/non-existent-id-999').send({
      status: 'Completed',
    });
    expect(notFound.status).toBe(404);
  });

  test('POST /api/tickets/:id/escalate handles 400 and 404', async () => {
    // 400
    const badRes = await request(app).post('/api/tickets/some-id/escalate').send({});
    expect(badRes.status).toBe(400);

    // 404
    const notFound = await request(app).post('/api/tickets/non-existent-id-999/escalate').send({
      escalatedTo: 'Director',
      reason: 'Emergency delay',
    });
    expect(notFound.status).toBe(404);
  });

  test('POST /api/tickets/:id/comments handles 400 and 404', async () => {
    // 400
    const badRes = await request(app).post('/api/tickets/some-id/comments').send({});
    expect(badRes.status).toBe(400);

    // 404
    const notFound = await request(app).post('/api/tickets/non-existent-id-999/comments').send({
      comment: 'Follow-up note',
    });
    expect(notFound.status).toBe(404);
  });

  test('DELETE /api/tickets/:id handles 404', async () => {
    const notFound = await request(app).delete('/api/tickets/non-existent-id-999');
    expect(notFound.status).toBe(404);
  });

  test('GET /api/tickets/export returns text/csv', async () => {
    const res = await request(app).get('/api/tickets/export');
    expect(res.status).toBe(200);
    expect(res.header['content-type']).toContain('text/csv');
    expect(res.text).toContain('Ticket Number');
    expect(res.text).toContain(SEEDED_TICKET.ticket_number);
  });

  test('handles 500 database error branches', async () => {
    jest.spyOn(ticketQueries, 'getTicketSummary').mockRejectedValueOnce(new Error('DB failure'));
    const resSummary = await request(app).get('/api/tickets/summary');
    expect(resSummary.status).toBe(500);

    jest.spyOn(ticketQueries, 'getTickets').mockRejectedValueOnce(new Error('DB failure'));
    const resList = await request(app).get('/api/tickets');
    expect(resList.status).toBe(500);

    jest.spyOn(ticketQueries, 'getTicketById').mockRejectedValueOnce(new Error('DB failure'));
    const resGet = await request(app).get('/api/tickets/id-1');
    expect(resGet.status).toBe(500);

    jest.spyOn(ticketQueries, 'createTicket').mockRejectedValueOnce(new Error('DB failure'));
    const resCreate = await request(app).post('/api/tickets').send(VALID_TICKET_BODY);
    expect(resCreate.status).toBe(500);
    expect(resCreate.body).toEqual({ success: false, error: TICKET_MESSAGES.CREATE_FAILED });

    jest.spyOn(ticketQueries, 'updateTicket').mockRejectedValueOnce(new Error('DB failure'));
    const resUpdate = await request(app).put('/api/tickets/id-1').send({ status: 'Completed' });
    expect(resUpdate.status).toBe(500);

    jest.spyOn(ticketQueries, 'escalateTicket').mockRejectedValueOnce(new Error('DB failure'));
    const resEscalate = await request(app).post('/api/tickets/id-1/escalate').send({
      escalatedTo: 'Lead',
      reason: 'Reason for escalation',
    });
    expect(resEscalate.status).toBe(500);

    jest.spyOn(ticketQueries, 'addTicketComment').mockRejectedValueOnce(new Error('DB failure'));
    const resComment = await request(app).post('/api/tickets/id-1/comments').send({ comment: 'Note' });
    expect(resComment.status).toBe(500);

    jest.spyOn(ticketQueries, 'deleteTicket').mockRejectedValueOnce(new Error('DB failure'));
    const resDelete = await request(app).delete('/api/tickets/id-1');
    expect(resDelete.status).toBe(500);

    jest.spyOn(ticketQueries, 'getTickets').mockRejectedValueOnce(new Error('DB failure'));
    const resExport = await request(app).get('/api/tickets/export');
    expect(resExport.status).toBe(500);
  });

  describe('ticketController direct unit tests', () => {
    test('read handlers accept query options and return stored rows without a session', async () => {
      let jsonResult = null;
      const resMock = {
        json: (val) => { jsonResult = val; return resMock; },
        status: () => resMock,
      };

      // 6. getTickets with all query params
      await ticketController.getTickets(
        {
          query: {
            search: 'test',
            status: 'Pending',
            priority: 'High',
            category: 'Legal',
            project: 'Tata',
            assignedTo: 'Staff',
            dateFrom: '2026-01-01',
            dateTo: '2026-12-31',
            limit: '25',
            offset: '5',
          },
        },
        resMock
      );
      expect(jsonResult.success).toBe(true);

      // 7. getTickets without params
      await ticketController.getTickets({ query: {} }, resMock);
      expect(jsonResult.success).toBe(true);

      // 8. getTickets with invalid limit and offset
      await ticketController.getTickets({ query: { limit: 'invalid', offset: 'invalid' } }, resMock);
      expect(jsonResult.success).toBe(true);

      // 9. getTicketById found branch
      jest.spyOn(ticketQueries, 'getTicketById').mockResolvedValueOnce({ id: 'tkt_db_1', subject: 'Stored subject' });
      await ticketController.getTicketById({ params: { id: 'tkt_db_1' } }, resMock);
      expect(jsonResult.success).toBe(true);

      // 10. exportTickets with filters and rows
      jest.spyOn(ticketQueries, 'getTickets').mockResolvedValueOnce({
        rows: [
          {
            id: 'tkt_export_1',
            ticket_number: 'TKT-EXP-1',
            subject: 'Export "Test" Subject',
            description: 'Export Desc',
            status: 'Pending',
            priority: 'High',
            category: 'General',
            project: 'Tata "Expansion"',
            customer_name: 'Tata "Client"',
            assigned_to_name: 'Lead "Staff"',
            assigned_team: 'Ops',
            due_date: '2026-11-20',
            created_at: '2026-10-25',
            resolution_notes: 'Notes "here"',
          },
          {
            id: 'tkt_export_2',
            ticket_number: null,
            subject: null,
            status: null,
            priority: null,
            category: null,
            project: null,
            customer_name: null,
            assigned_to_name: null,
            assigned_team: null,
            due_date: null,
            created_at: null,
            resolution_notes: null,
          },
        ],
        total: 2,
      });

      await ticketController.exportTickets(
        { query: {} },
        { setHeader: () => {}, send: (v) => { jsonResult = v; } }
      );
      expect(typeof jsonResult).toBe('string');
      expect(jsonResult).toContain('TKT-EXP-1');
    });
  });

  describe('ticketController session and error contract', () => {
    const SESSION_USER = Object.freeze({
      sub: 'staff-direct-1',
      email: 'staff.one@example.test',
      fullName: 'Staff One',
      role: 'admin',
    });
    const SESSION_ACTOR = Object.freeze({
      uuid: 'staff-direct-1',
      name: 'Staff One',
      email: 'staff.one@example.test',
      role: 'admin',
    });
    const HEADER_IDENTITY = Object.freeze({
      'x-user-name': 'Header Staff',
      'x-user-email': 'header.staff@example.test',
    });

    function mockResponse() {
      const res = { statusCode: 200, body: undefined };
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (payload) => { res.body = payload; return res; };
      return res;
    }

    test('attributes writes to the session user and passes that actor to the query layer', async () => {
      const res = mockResponse();
      await ticketController.createTicket({ body: VALID_TICKET_BODY, user: SESSION_USER }, res);
      expect(res.statusCode).toBe(201);
      expect(ticketQueries.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({ subject: VALID_TICKET_BODY.subject }),
        SESSION_ACTOR
      );
    });

    test('accepts a session identified only by an id or an email address', async () => {
      const byId = mockResponse();
      await ticketController.createTicket({ body: VALID_TICKET_BODY, user: { id: 'u-2', name: 'Staff Two' } }, byId);
      expect(byId.statusCode).toBe(201);
      expect(ticketQueries.createTicket).toHaveBeenLastCalledWith(expect.anything(), {
        uuid: 'u-2', name: 'Staff Two', email: null, role: null,
      });

      const byEmail = mockResponse();
      await ticketController.createTicket({ body: VALID_TICKET_BODY, user: { email: 'ops@example.test' } }, byEmail);
      expect(byEmail.statusCode).toBe(201);
      expect(ticketQueries.createTicket).toHaveBeenLastCalledWith(expect.anything(), {
        uuid: null, name: 'ops@example.test', email: 'ops@example.test', role: null,
      });
    });

    test('rejects a session object that identifies no user', async () => {
      const res = mockResponse();
      await ticketController.createTicket({ body: VALID_TICKET_BODY, user: {} }, res);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ success: false, error: TICKET_MESSAGES.SESSION_REQUIRED });
      expect(ticketQueries.createTicket).not.toHaveBeenCalled();
    });

    test('rejects every write without a session and never reads identity from headers', async () => {
      const writes = [
        (res) => ticketController.createTicket({ body: VALID_TICKET_BODY, headers: HEADER_IDENTITY }, res),
        (res) => ticketController.updateTicket({ params: { id: 'tkt_db_1' }, body: { status: 'Pending' }, headers: HEADER_IDENTITY }, res),
        (res) => ticketController.escalateTicket({ params: { id: 'tkt_db_1' }, body: VALID_ESCALATION_BODY, headers: HEADER_IDENTITY }, res),
        (res) => ticketController.addComment({ params: { id: 'tkt_db_1' }, body: { comment: 'Note' }, headers: HEADER_IDENTITY }, res),
        (res) => ticketController.deleteTicket({ params: { id: 'tkt_db_1' }, headers: HEADER_IDENTITY }, res),
      ];
      for (const write of writes) {
        const res = mockResponse();
        await write(res);
        expect(res.statusCode).toBe(401);
        expect(res.body).toEqual({ success: false, error: TICKET_MESSAGES.SESSION_REQUIRED });
      }
      expect(ticketQueries.createTicket).not.toHaveBeenCalled();
      expect(ticketQueries.updateTicket).not.toHaveBeenCalled();
      expect(ticketQueries.escalateTicket).not.toHaveBeenCalled();
      expect(ticketQueries.addTicketComment).not.toHaveBeenCalled();
      expect(ticketQueries.deleteTicket).not.toHaveBeenCalled();
    });

    test('names every missing customer or assignee field in the 400 response', async () => {
      const res = mockResponse();
      await ticketController.createTicket({ body: { subject: 'Needs owners' }, user: SESSION_USER }, res);
      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.body.details).sort()).toEqual(['assignedToName', 'customerEmail', 'customerName', 'customerPhone']);
      expect(res.body.details.customerName).toMatch(/Customer name/);
      expect(res.body.details.customerEmail).toMatch(/Customer email/);
      expect(res.body.details.customerPhone).toMatch(/Customer phone/);
      expect(res.body.details.assignedToName).toMatch(/Assigned to name/);
      expect(res.body.error).toContain('Customer phone is required');
      expect(ticketQueries.createTicket).not.toHaveBeenCalled();
    });

    test('maps the snake_case keys the Action Center form sends onto the schema fields', async () => {
      const res = mockResponse();
      await ticketController.createTicket({
        body: {
          subject: 'Form submitted ticket',
          customer_name: 'Tata Steel Ltd',
          customer_email: 'buyer@example.test',
          customer_phone: '+15555550100',
          assigned_to_name: 'Test Assignee',
          sla_hours: 24,
        },
        user: SESSION_USER,
      }, res);
      expect(res.statusCode).toBe(201);
      expect(ticketQueries.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          customerName: 'Tata Steel Ltd',
          customerEmail: 'buyer@example.test',
          customerPhone: '+15555550100',
          assignedToName: 'Test Assignee',
        }),
        SESSION_ACTOR
      );
    });

    test('keeps a camelCase value in preference to its snake_case alias', async () => {
      const res = mockResponse();
      await ticketController.createTicket({
        body: { ...VALID_TICKET_BODY, customer_name: 'Alias Name' },
        user: SESSION_USER,
      }, res);
      expect(res.statusCode).toBe(201);
      expect(ticketQueries.createTicket).toHaveBeenCalledWith(
        expect.objectContaining({ customerName: VALID_TICKET_BODY.customerName }),
        SESSION_ACTOR
      );
    });

    test('keeps the status and message of a client error raised by the query layer', async () => {
      const clientError = Object.assign(new Error('Ticket customer name is required. Enter the value and retry.'), {
        code: 'VALIDATION_FAILED',
        statusCode: 400,
      });
      jest.spyOn(ticketQueries, 'createTicket').mockRejectedValueOnce(clientError);
      const res = mockResponse();
      await ticketController.createTicket({ body: VALID_TICKET_BODY, user: SESSION_USER }, res);
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Ticket customer name is required. Enter the value and retry.' });
    });

    test('returns 503 with the storage message from every write when the store is unavailable', async () => {
      const storageError = () => Object.assign(new Error(TICKET_MESSAGES.STORAGE_UNAVAILABLE), {
        code: 'PERSISTENCE_UNAVAILABLE',
        statusCode: 503,
      });
      jest.spyOn(ticketQueries, 'createTicket').mockRejectedValueOnce(storageError());
      jest.spyOn(ticketQueries, 'updateTicket').mockRejectedValueOnce(storageError());
      jest.spyOn(ticketQueries, 'escalateTicket').mockRejectedValueOnce(storageError());
      jest.spyOn(ticketQueries, 'addTicketComment').mockRejectedValueOnce(storageError());
      jest.spyOn(ticketQueries, 'deleteTicket').mockRejectedValueOnce(storageError());

      const responses = [
        await request(app).post('/api/tickets').send(VALID_TICKET_BODY),
        await request(app).put('/api/tickets/id-1').send({ status: 'Completed' }),
        await request(app).post('/api/tickets/id-1/escalate').send(VALID_ESCALATION_BODY),
        await request(app).post('/api/tickets/id-1/comments').send({ comment: 'Note' }),
        await request(app).delete('/api/tickets/id-1'),
      ];
      for (const res of responses) {
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ success: false, error: TICKET_MESSAGES.STORAGE_UNAVAILABLE, retryable: true });
      }
    });

    test('returns 503 from the read endpoints when the store is unavailable', async () => {
      jest.spyOn(ticketQueries, 'getTickets').mockRejectedValueOnce(Object.assign(new Error(TICKET_MESSAGES.STORAGE_UNAVAILABLE), {
        code: 'PERSISTENCE_UNAVAILABLE',
        statusCode: 503,
      }));
      const res = await request(app).get('/api/tickets');
      expect(res.status).toBe(503);
      expect(res.body.error).toBe(TICKET_MESSAGES.STORAGE_UNAVAILABLE);
    });

    test('hides raw error text behind the generic 500 message', async () => {
      jest.spyOn(ticketQueries, 'updateTicket').mockRejectedValueOnce(new Error('connection string leaked'));
      const res = await request(app).put('/api/tickets/id-1').send({ status: 'Completed' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: TICKET_MESSAGES.UPDATE_FAILED });
    });
  });

  describe('ticketQueries SQL engine (pool.hasStorage() = true)', () => {
    const mockTicketRow = {
      id: 'tkt_db_1',
      ticket_number: 'TKT-99001',
      subject: 'Stored SQL Ticket',
      description: 'Stored description',
      status: 'Pending',
      priority: 'High',
      category: 'Hardware',
      project: 'Data Center Expansion',
      customer_id: 'cust-1',
      customer_name: 'Stored Client',
      customer_email: 'client@example.test',
      customer_phone: '+15555550100',
      assigned_to_user_id: 'u-101',
      assigned_to_name: 'Stored Assignee',
      assigned_team: 'Operations',
      created_by_user_id: 'u-102',
      created_by_name: 'Stored Creator',
      last_edited_by_name: 'Stored Creator',
      resolved_by_name: null,
      sla_hours: 24,
      due_date: '2026-11-20T00:00:00.000Z',
      resolved_at: null,
      resolution_notes: null,
      escalation_level: 0,
      escalated_to: null,
      escalation_reason: null,
      attachments: '[]',
      metadata: '{}',
      raw: '{}',
      created_at: '2026-10-25T10:00:00.000Z',
      updated_at: '2026-10-25T10:00:00.000Z',
    };

    const mockActivityRow = {
      id: 'tact_db_1',
      ticket_id: 'tkt_db_1',
      action_type: 'CREATED',
      actor_id: 'u-102',
      actor_name: 'Stored Creator',
      comment: 'Ticket opened in Action Center.',
      metadata: '{}',
      created_at: '2026-10-25T10:00:00.000Z',
    };

    const validCustomerAndAssignee = {
      customerName: 'Stored Client',
      customerEmail: 'client@example.test',
      customerPhone: '+15555550100',
      assignedToName: 'Stored Assignee',
    };

    beforeEach(() => {
      jest.restoreAllMocks();
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    });

    test('getTicketSummary queries database and calculates statistics', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue({
        rows: [{ total: '5', pending: '2', in_progress: '1', escalated: '1', completed: '1', critical_count: '2' }],
      });
      const summary = await ticketQueries.getTicketSummary();
      expect(summary.total).toBe(5);
      expect(summary.pending).toBe(2);
      expect(summary.criticalCount).toBe(2);
    });

    test('getTickets executes SQL queries across all filter dimensions', async () => {
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('count(*)')) {
          return { rows: [{ total: '1' }] };
        }
        return { rows: [mockTicketRow] };
      });

      const res = await ticketQueries.getTickets({
        search: 'Stored',
        status: 'Pending',
        priority: 'High',
        category: 'Hardware',
        project: 'Data Center',
        assignedTo: 'Stored',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-31',
        limit: 10,
        offset: 0,
      });

      expect(res.total).toBe(1);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].ticket_number).toBe('TKT-99001');

      // Empty query parameters
      await ticketQueries.getTickets();
    });

    test('getTicketById retrieves ticket and activities or null', async () => {
      expect(await ticketQueries.getTicketById(null)).toBeNull();

      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('ticket_activities')) {
          return { rows: [mockActivityRow] };
        }
        return { rows: [mockTicketRow] };
      });

      const found = await ticketQueries.getTicketById('tkt_db_1');
      expect(found).toBeDefined();
      expect(found.id).toBe('tkt_db_1');
      expect(found.activities).toHaveLength(1);

      // Not found branch
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
      expect(await ticketQueries.getTicketById('missing-id')).toBeNull();
    });

    test('createTicket inserts ticket and logs activity in SQL', async () => {
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });
      const created = await ticketQueries.createTicket(
        {
          subject: 'Database Ticket',
          description: 'Stored in SQL',
          priority: 'Critical',
          slaHours: 12,
          ...validCustomerAndAssignee,
        },
        { uuid: 'u-1', name: 'Author', email: 'author@example.test' }
      );

      expect(created).toBeDefined();
      expect(created.subject).toBe('Database Ticket');
      expect(created.created_by_name).toBe('Author');
      expect(querySpy).toHaveBeenCalledTimes(2); // tickets and ticket_activities
    });

    test('createTicket names each missing customer or assignee field and never invents one', async () => {
      const querySpy = jest.spyOn(pool, 'query').mockResolvedValue({ rowCount: 1 });

      await expect(ticketQueries.createTicket({ subject: 'Needs a customer' }, {})).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        statusCode: 400,
        message: expect.stringContaining('customer name'),
      });
      await expect(ticketQueries.createTicket(
        { subject: 'Needs an email', customerName: 'Client' },
        {}
      )).rejects.toMatchObject({ message: expect.stringContaining('customer email') });
      await expect(ticketQueries.createTicket(
        { subject: 'Needs a phone', customerName: 'Client', customerEmail: 'client@example.test' },
        {}
      )).rejects.toMatchObject({ message: expect.stringContaining('customer phone') });
      await expect(ticketQueries.createTicket(
        {
          subject: 'Needs an assignee',
          customerName: 'Client',
          customerEmail: 'client@example.test',
          customerPhone: '+15555550100',
        },
        {}
      )).rejects.toMatchObject({ message: expect.stringContaining('assigned to name') });
      await expect(ticketQueries.createTicket({ ...validCustomerAndAssignee, subject: '   ' }, {})).rejects.toMatchObject({
        message: expect.stringContaining('subject'),
      });

      expect(querySpy).not.toHaveBeenCalled();
    });

    test('updateTicket modifies SQL ticket and appends status activity', async () => {
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('SELECT * FROM tickets')) {
          return { rows: [mockTicketRow] };
        }
        if (sql.includes('ticket_activities')) {
          return { rows: [mockActivityRow] };
        }
        return { rows: [{ ...mockTicketRow, status: 'Completed', resolution_notes: 'Resolved' }] };
      });

      const updated = await ticketQueries.updateTicket(
        'tkt_db_1',
        { status: 'Completed', resolutionNotes: 'Resolved' },
        { name: 'Admin', email: 'admin@example.test' }
      );
      expect(updated).toBeDefined();
    });

    test('escalateTicket escalates SQL ticket and appends activity', async () => {
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('SELECT * FROM tickets')) {
          return { rows: [mockTicketRow] };
        }
        if (sql.includes('ticket_activities')) {
          return { rows: [mockActivityRow] };
        }
        return { rows: [{ ...mockTicketRow, status: 'Escalated' }] };
      });

      const escalated = await ticketQueries.escalateTicket(
        'tkt_db_1',
        { escalatedTo: 'VP Ops', reason: 'High impact outage' },
        { name: 'Lead', email: 'lead@example.test' }
      );
      expect(escalated).toBeDefined();
    });

    test('addTicketComment and deleteTicket in SQL', async () => {
      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('SELECT * FROM tickets')) {
          return { rows: [mockTicketRow] };
        }
        if (sql.includes('ticket_activities')) {
          return { rows: [mockActivityRow] };
        }
        return { rowCount: 1, rows: [mockActivityRow] };
      });

      const comment = await ticketQueries.addTicketComment(
        'tkt_db_1',
        { comment: 'Investigating SQL root cause.' },
        { name: 'Dev', email: 'dev@example.test' }
      );
      expect(comment).toBeDefined();

      const ok = await ticketQueries.deleteTicket('tkt_db_1');
      expect(ok).toBe(true);
    });

    test('SQL queries reject null result sets instead of reporting zero results', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue(null);
      await expect(ticketQueries.getTicketSummary()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
      await expect(ticketQueries.getTickets()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
      await expect(ticketQueries.getTickets({ limit: 'bad', offset: 'bad' })).rejects.toMatchObject({
        code: 'PERSISTENCE_UNAVAILABLE',
      });
    });
  });

  describe('ticketQueries without database storage', () => {
    beforeEach(() => {
      jest.restoreAllMocks();
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
    });

    test('parseJsonSafe returns the fallback for empty or invalid JSON', () => {
      expect(ticketQueries.parseJsonSafe(null, [])).toEqual([]);
      expect(ticketQueries.parseJsonSafe({ a: 1 }, null)).toEqual({ a: 1 });
      expect(ticketQueries.parseJsonSafe('{"ok":true}', null)).toEqual({ ok: true });
      expect(ticketQueries.parseJsonSafe('{bad-json', { fallback: true })).toEqual({ fallback: true });
    });

    test('every read and write rejects with PERSISTENCE_UNAVAILABLE and HTTP 503', async () => {
      const operations = [
        () => ticketQueries.getTickets({ category: 'Legal' }),
        () => ticketQueries.getTicketSummary(),
        () => ticketQueries.getTicketById('tkt_db_1'),
        () => ticketQueries.createTicket({ subject: 'Subject', ...{
          customerName: 'Client',
          customerEmail: 'client@example.test',
          customerPhone: '+15555550100',
          assignedToName: 'Assignee',
        } }, {}),
        () => ticketQueries.updateTicket('tkt_db_1', { status: 'In Progress' }, {}),
        () => ticketQueries.escalateTicket('tkt_db_1', { escalatedTo: 'Lead', reason: 'High urgency' }, {}),
        () => ticketQueries.addTicketComment('tkt_db_1', { comment: 'Note' }, {}),
        () => ticketQueries.deleteTicket('tkt_db_1'),
      ];

      for (const operation of operations) {
        await expect(operation()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', statusCode: 503 });
      }
    });

    test('getTicketById(null) returns null without reading storage', async () => {
      expect(await ticketQueries.getTicketById(null)).toBeNull();
    });
  });
});

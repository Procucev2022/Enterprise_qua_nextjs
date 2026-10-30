const request = require('supertest');
const app = require('../src/app');
const ticketQueries = require('../src/db/ticketQueries');
const ticketController = require('../src/controllers/ticketController');
const pool = require('../src/db/pool');

describe('Tickets API & Controller', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
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

  test('GET /api/tickets returns list of tickets with filters', async () => {
    const res = await request(app)
      .get('/api/tickets?status=Pending&priority=High&search=tata&project=Tata&limit=10&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  test('GET /api/tickets/:id returns single ticket or 404', async () => {
    const notFound = await request(app).get('/api/tickets/non-existent-id-999');
    expect(notFound.status).toBe(404);
    expect(notFound.body.success).toBe(false);

    // Get all first to pick a valid id
    const listRes = await request(app).get('/api/tickets?limit=1');
    if (listRes.body.data && listRes.body.data.length > 0) {
      const ticketId = listRes.body.data[0].id;
      const found = await request(app).get(`/api/tickets/${ticketId}`);
      expect(found.status).toBe(200);
      expect(found.body.success).toBe(true);
      expect(found.body.data.id).toBe(ticketId);
    }
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
      .set('x-user-name', 'Navin Chaudhary')
      .set('x-user-email', 'navin@procucev.com')
      .send({
        subject: 'Supplier delivery delay on Tata Steel order',
        description: 'Vendor has not dispatched consignment within agreed SLA window.',
        category: 'Vendor Performance',
        priority: 'High',
        project: 'Tata Steel Plant Expansion',
        customerName: 'Tata Steel Ltd',
        customerEmail: 'procurement@tatasteel.com',
        customerPhone: '+919876543210',
        assignedTo: 'Navin Chaudhary',
        dueDate: '2026-11-15T18:30:00.000Z',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.data.subject).toBe('Supplier delivery delay on Tata Steel order');

    const createdId = createRes.body.data.id;

    // PUT /api/tickets/:id update
    const updateRes = await request(app)
      .put(`/api/tickets/${createdId}`)
      .set('x-user-name', 'Navin Chaudhary')
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
      .set('x-user-name', 'Navin Chaudhary')
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
      .set('x-user-name', 'Navin Chaudhary')
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
      comment: 'Sample note',
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
    const resCreate = await request(app).post('/api/tickets').send({ subject: 'Test' });
    expect(resCreate.status).toBe(500);

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
    test('extractActor branches with various req.user objects and query options', async () => {
      let jsonResult = null;
      let statusResult = 200;
      const resMock = {
        json: (val) => { jsonResult = val; return resMock; },
        status: (code) => { statusResult = code; return resMock; },
      };

      // 1. req.user with uuid, fullName, email, role
      await ticketController.createTicket(
        {
          body: { subject: 'Test User Auth 1' },
          user: { uuid: 'u-1', fullName: 'Navin C', email: 'navin@x.com', role: 'admin' },
        },
        resMock
      );
      expect(statusResult).toBe(201);

      // 2. req.user with id, name, null email, null role
      await ticketController.createTicket(
        {
          body: { subject: 'Test User Auth 2' },
          user: { id: 'u-2', name: 'John D' },
        },
        resMock
      );
      expect(statusResult).toBe(201);

      // 3. req.user with only email
      await ticketController.createTicket(
        {
          body: { subject: 'Test User Auth 3' },
          user: { email: 'ops@x.com' },
        },
        resMock
      );
      expect(statusResult).toBe(201);

      // 4. req.user empty
      await ticketController.createTicket(
        {
          body: { subject: 'Test User Auth 4' },
          user: {},
        },
        resMock
      );
      expect(statusResult).toBe(201);

      // 5. req.headers fallbacks
      await ticketController.updateTicket(
        {
          params: { id: 'tkt_mock_1' },
          body: { status: 'Pending' },
          headers: { 'x-user-name': 'Custom Header Exec', 'x-user-email': 'exec@procucev.com' },
        },
        resMock
      );

      // 6. getTickets with all query params
      await ticketController.getTickets(
        {
          query: {
            search: 'test',
            status: 'Pending',
            priority: 'High',
            category: 'Legal',
            project: 'Tata',
            assignedTo: 'Navin',
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
      jest.spyOn(ticketQueries, 'getTicketById').mockResolvedValueOnce({ id: 'tkt_mock_1', subject: 'Mock' });
      await ticketController.getTicketById({ params: { id: 'tkt_mock_1' } }, resMock);
      expect(jsonResult.success).toBe(true);

      // 7. exportTickets with filters and rows
      ticketQueries.memoryTickets.push({
        id: 'tkt_export_1',
        ticket_number: 'TKT-EXP-1',
        subject: 'Export "Test" Subject',
        description: 'Export Desc',
        status: 'Pending',
        priority: 'High',
        category: 'General',
        project: 'Tata "Expansion"',
        customer_name: 'Tata "Client"',
        assigned_to_name: 'Navin "Lead"',
        assigned_team: 'Ops',
        due_date: '2026-11-20',
        created_at: '2026-10-25',
        resolution_notes: 'Notes "here"',
      });
      ticketQueries.memoryTickets.push({
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
      });

      await ticketController.exportTickets(
        { query: {} },
        { setHeader: () => {}, send: (v) => { jsonResult = v; } }
      );
      expect(typeof jsonResult).toBe('string');
      expect(jsonResult).toContain('TKT-EXP-1');

      ticketQueries.memoryTickets.pop();
      ticketQueries.memoryTickets.pop();
    });
  });

  describe('ticketQueries SQL engine (pool.hasStorage() = true)', () => {
    const mockTicketRow = {
      id: 'tkt_mock_1',
      ticket_number: 'TKT-99001',
      subject: 'Mock SQL Ticket',
      description: 'Mock Description',
      status: 'Pending',
      priority: 'High',
      category: 'Hardware',
      project: 'Data Center Expansion',
      customer_id: 'cust-1',
      customer_name: 'Enterprise Client',
      customer_email: 'client@enterprise.com',
      customer_phone: '+919876543210',
      assigned_to_user_id: 'u-101',
      assigned_to_name: 'Navin Chaudhary',
      assigned_team: 'Operations',
      created_by_user_id: 'u-102',
      created_by_name: 'Procurement Specialist',
      last_edited_by_name: 'Procurement Specialist',
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
      id: 'tact_mock_1',
      ticket_id: 'tkt_mock_1',
      action_type: 'CREATED',
      actor_id: 'u-102',
      actor_name: 'Procurement Specialist',
      comment: 'Ticket opened in Action Center.',
      metadata: '{}',
      created_at: '2026-10-25T10:00:00.000Z',
    };

    beforeEach(() => {
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
        search: 'Mock',
        status: 'Pending',
        priority: 'High',
        category: 'Hardware',
        project: 'Data Center',
        assignedTo: 'Navin',
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

      const found = await ticketQueries.getTicketById('tkt_mock_1');
      expect(found).toBeDefined();
      expect(found.id).toBe('tkt_mock_1');
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
        },
        { uuid: 'u-1', name: 'Author', email: 'author@x.com' }
      );

      expect(created).toBeDefined();
      expect(created.subject).toBe('Database Ticket');
      expect(querySpy).toHaveBeenCalledTimes(2); // tickets and ticket_activities
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
        'tkt_mock_1',
        { status: 'Completed', resolutionNotes: 'Resolved' },
        { name: 'Admin', email: 'admin@x.com' }
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
        'tkt_mock_1',
        { escalatedTo: 'VP Ops', reason: 'High impact outage' },
        { name: 'Lead', email: 'lead@x.com' }
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
        'tkt_mock_1',
        { comment: 'Investigating SQL root cause.' },
        { name: 'Dev', email: 'dev@x.com' }
      );
      expect(comment).toBeDefined();

      const ok = await ticketQueries.deleteTicket('tkt_mock_1');
      expect(ok).toBe(true);
    });

    test('SQL queries handle empty/null query results safely', async () => {
      jest.spyOn(pool, 'query').mockResolvedValue(null);
      const sum = await ticketQueries.getTicketSummary();
      expect(sum.total).toBe(0);

      const list = await ticketQueries.getTickets();
      expect(list.total).toBe(0);
      expect(list.rows).toHaveLength(0);

      // getTickets with invalid limit and offset in SQL
      await ticketQueries.getTickets({ limit: 'bad', offset: 'bad' });
    });
  });

  describe('ticketQueries in-memory branch coverage', () => {
    test('in-memory getTickets filters by category, project, assignedTo, dates, search', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      // parseJsonSafe branches
      expect(ticketQueries.parseJsonSafe(null, [])).toEqual([]);
      expect(ticketQueries.parseJsonSafe({ a: 1 }, null)).toEqual({ a: 1 });
      expect(ticketQueries.parseJsonSafe('{"ok":true}', null)).toEqual({ ok: true });
      expect(ticketQueries.parseJsonSafe('{bad-json', { fallback: true })).toEqual({ fallback: true });

      ticketQueries.memoryTickets.push({
        id: 'tkt_mem_filter',
        ticket_number: 'TKT-MEM-1',
        subject: 'In-Memory Specific Subject',
        description: 'Testing in-memory descriptions',
        category: 'Legal',
        project: 'JSW Plant',
        assigned_to_name: 'Prajwal K',
        assigned_to_user_id: 'exec-3',
        customer_name: 'JSW Client',
        customer_email: 'legal@jsw.in',
        priority: 'Critical',
        status: 'Pending',
        created_at: '2026-10-15T12:00:00.000Z',
      });

      const byCat = await ticketQueries.getTickets({ category: 'Legal' });
      expect(byCat.rows.length).toBeGreaterThanOrEqual(1);

      const byProj = await ticketQueries.getTickets({ project: 'JSW Plant' });
      expect(byProj.rows.length).toBeGreaterThanOrEqual(1);

      const byAssigned = await ticketQueries.getTickets({ assignedTo: 'Prajwal' });
      expect(byAssigned.rows.length).toBeGreaterThanOrEqual(1);

      const byAssignedId = await ticketQueries.getTickets({ assignedTo: 'exec-3' });
      expect(byAssignedId.rows.length).toBeGreaterThanOrEqual(1);

      const byDateFrom = await ticketQueries.getTickets({ dateFrom: '2026-10-01' });
      expect(byDateFrom.rows.length).toBeGreaterThanOrEqual(1);

      const byDateTo = await ticketQueries.getTickets({ dateTo: '2026-10-31' });
      expect(byDateTo.rows.length).toBeGreaterThanOrEqual(1);

      const bySearch = await ticketQueries.getTickets({ search: 'TKT-MEM-1' });
      expect(bySearch.rows.length).toBeGreaterThanOrEqual(1);

      const bySearchDesc = await ticketQueries.getTickets({ search: 'Testing in-memory' });
      expect(bySearchDesc.rows.length).toBeGreaterThanOrEqual(1);

      const bySearchCust = await ticketQueries.getTickets({ search: 'JSW Client' });
      expect(bySearchCust.rows.length).toBeGreaterThanOrEqual(1);

      const bySearchEmail = await ticketQueries.getTickets({ search: 'legal@jsw.in' });
      expect(bySearchEmail.rows.length).toBeGreaterThanOrEqual(1);

      // Sparse in-memory item to cover all false/null coalescing branches
      ticketQueries.memoryTickets.push({ id: 'tkt_sparse_2' });
      await ticketQueries.getTickets({ status: 'Pending', priority: 'High', category: 'Legal', project: 'JSW Plant', assignedTo: 'Prajwal', search: 'unmatched-xyz' });
      ticketQueries.memoryTickets.pop();

      // In-memory summary with Critical/High items
      const sum = await ticketQueries.getTicketSummary();
      expect(sum.total).toBeGreaterThanOrEqual(1);
      expect(sum.criticalCount).toBeGreaterThanOrEqual(1);

      // In-memory update, escalate, comment
      const updated = await ticketQueries.updateTicket('tkt_mem_filter', { status: 'In Progress' });
      expect(updated.status).toBe('In Progress');

      const noStatusChange = await ticketQueries.updateTicket('tkt_mem_filter', { subject: 'Same status' });
      expect(noStatusChange.subject).toBe('Same status');

      const escalated = await ticketQueries.escalateTicket('tkt_mem_filter', { escalatedTo: 'Lead', reason: 'High urgency' });
      expect(escalated.status).toBe('Escalated');

      const comment = await ticketQueries.addTicketComment('tkt_mem_filter', { comment: 'Memory note' });
      expect(comment.comment).toBe('Memory note');

      // Not found branches
      expect(await ticketQueries.updateTicket('non-existent', { status: 'Completed' })).toBeNull();
      expect(await ticketQueries.escalateTicket('non-existent', { escalatedTo: 'Lead', reason: 'R' })).toBeNull();
      expect(await ticketQueries.addTicketComment('non-existent', { comment: 'C' })).toBeNull();
      expect(await ticketQueries.deleteTicket('non-existent')).toBe(false);

      // Create ticket with snake_case and defaults
      await ticketQueries.createTicket({
        customer_id: 'c-1',
        customer_name: 'C Name',
        customer_email: 'c@x.com',
        customer_phone: '123',
        assigned_to_user_id: 'u-1',
        assigned_to_name: 'A Name',
        assigned_team: 'Team A',
        sla_hours: 48,
        due_date: '2026-12-01',
      }, { id: 'u-99', email: 'author@x.com' });

      await ticketQueries.createTicket({}, {});

      // In-memory update with assigned fields
      await ticketQueries.updateTicket('tkt_mem_filter', {
        assignedToName: 'New Assigned',
        assignedToUserId: 'u-2',
        assignedTeam: 'New Team',
        resolutionNotes: 'Done',
        status: 'Completed',
      });

      // Clean up
      await ticketQueries.deleteTicket('tkt_mem_filter');
    });
  });
});

const pool = require('../src/db/pool');
const ticketQueries = require('../src/db/ticketQueries');

const {
  getTickets,
  getTicketSummary,
  getTicketById,
  createTicket,
  updateTicket,
  escalateTicket,
  addTicketComment,
  deleteTicket,
  parseJsonSafe,
} = ticketQueries;

const ONE_DAY_MS = 24 * 3600 * 1000;

function baseTicket(overrides = {}) {
  return {
    id: 'tkt_1',
    ticket_number: 'TKT-10001',
    subject: 'Login fails',
    description: 'Cannot sign in',
    status: 'Pending',
    priority: 'Medium',
    category: 'Access',
    project: 'Portal',
    customer_name: 'Customer One',
    customer_email: 'customer@procure.test',
    customer_phone: '+10 5550100',
    assigned_to_user_id: 'u-7',
    assigned_to_name: 'Support Lead',
    assigned_team: 'Support',
    escalation_level: 0,
    resolution_notes: null,
    resolved_at: null,
    resolved_by_name: null,
    due_date: '2026-06-01T00:00:00.000Z',
    last_edited_by_name: 'Editor',
    attachments: '[]',
    metadata: '{}',
    raw: '{}',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

let tickets;
let activities;
let countRows;
let summaryRow;
let commentRows;

function routeQuery(sql, params = []) {
  const text = String(sql);
  if (text.includes('count(*) as total FROM tickets')) return Promise.resolve({ rows: countRows });
  if (text.includes('sum(case when status')) return Promise.resolve({ rows: summaryRow ? [summaryRow] : [] });
  if (text.includes('WHERE id = $1 OR ticket_number = $1')) {
    return Promise.resolve({ rows: tickets.filter((t) => t.id === params[0] || t.ticket_number === params[0]) });
  }
  if (text.includes('FROM ticket_activities') && text.includes('WHERE ticket_id = $1')) {
    return Promise.resolve({ rows: activities });
  }
  if (text.includes('INSERT INTO ticket_activities') && text.includes('RETURNING *')) {
    return Promise.resolve({ rows: commentRows(params) });
  }
  if (text.trim().startsWith('SELECT * FROM tickets')) return Promise.resolve({ rows: tickets });
  return Promise.resolve({ rows: [] });
}

function queriesMatching(pattern) {
  return pool.query.mock.calls.filter(([sql]) => pattern.test(String(sql)));
}

beforeEach(() => {
  tickets = [];
  activities = [];
  countRows = [{ total: 2 }];
  summaryRow = null;
  commentRows = (params) => [{ id: params[0], comment: params[4] }];
  jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
  jest.spyOn(pool, 'query').mockImplementation((sql, params) => routeQuery(sql, params));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('parseJsonSafe', () => {
  test('uses null as the fallback when no fallback is supplied', () => {
    expect(parseJsonSafe('not json')).toBeNull();
    expect(parseJsonSafe(undefined)).toBeNull();
    expect(parseJsonSafe(null)).toBeNull();
  });

  test('parses JSON text, passes objects through, and uses a supplied fallback for bad text', () => {
    expect(parseJsonSafe('{"a":1}', {})).toEqual({ a: 1 });
    const payload = { b: 2 };
    expect(parseJsonSafe(payload, [])).toBe(payload);
    expect(parseJsonSafe('broken', [])).toEqual([]);
  });
});

describe('storage guard', () => {
  test('every read and write reports persistence unavailable when storage is not configured', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(getTickets()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', statusCode: 503 });
    await expect(getTicketSummary()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    await expect(getTicketById('tkt_1')).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    await expect(deleteTicket('tkt_1')).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('getTickets', () => {
  beforeEach(() => {
    tickets = [baseTicket({ attachments: '[{"name":"a.pdf"}]', metadata: 'not-json' })];
  });

  test('applies every supplied filter and clamps paging to safe values', async () => {
    const result = await getTickets({
      search: ' login ',
      status: 'Pending',
      priority: 'High',
      category: 'Access',
      project: 'Portal',
      assignedTo: 'Support',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      limit: 0,
      offset: -5,
    });

    expect(result.total).toBe(2);
    expect(result.rows[0]).toMatchObject({
      attachments: [{ name: 'a.pdf' }],
      metadata: {},
      raw: {},
    });

    const [countSql, countParams, countOptions] = queriesMatching(/count\(\*\) as total FROM tickets/)[0];
    expect(countParams).toEqual(['Pending', 'High', 'Access', 'Portal', 'Support', '%Support%', '2026-01-01', '2026-12-31', '%login%']);
    expect(countSql).toContain('ILIKE');
    expect(countOptions.d1Text).toContain(' LIKE ');
    expect(countOptions.d1Text).not.toContain('ILIKE');

    const dataParams = queriesMatching(/SELECT \* FROM tickets/)[0][1];
    expect(dataParams.slice(-2)).toEqual([50, 0]);
  });

  test('uses default paging and no filters when called without arguments', async () => {
    await getTickets();

    expect(queriesMatching(/count\(\*\) as total FROM tickets/)[0][1]).toEqual([]);
    expect(queriesMatching(/SELECT \* FROM tickets/)[0][1]).toEqual([50, 0]);
  });

  test('caps the page size at 200 and skips the all placeholders', async () => {
    await getTickets({ limit: 1000, status: 'all', priority: 'all', category: 'all', project: 'all', assignedTo: 'all' });

    expect(queriesMatching(/count\(\*\) as total FROM tickets/)[0][1]).toEqual([]);
    expect(queriesMatching(/SELECT \* FROM tickets/)[0][1]).toEqual([200, 0]);
  });

  test('filters on the date range alone', async () => {
    await getTickets({ dateFrom: '2026-02-01', dateTo: '2026-02-28' });

    expect(queriesMatching(/count\(\*\) as total FROM tickets/)[0][1]).toEqual(['2026-02-01', '2026-02-28']);
  });

  test('throws when the count query returns no row', async () => {
    countRows = [];

    await expect(getTickets()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', statusCode: 503 });
  });

  test('throws when the data query returns no row set', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({});

    await expect(getTickets()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', statusCode: 503 });
  });
});

describe('getTicketSummary', () => {
  test('maps every state count from the summary row', async () => {
    summaryRow = { total: 9, pending: 2, in_progress: 3, escalated: 1, completed: 2, critical_count: 4 };

    await expect(getTicketSummary()).resolves.toEqual({
      total: 9,
      pending: 2,
      inProgress: 3,
      escalated: 1,
      completed: 2,
      criticalCount: 4,
    });
  });

  test('reports zero for count columns that are null or missing', async () => {
    summaryRow = { total: null, pending: undefined, in_progress: null, escalated: null, completed: null, critical_count: null };

    await expect(getTicketSummary()).resolves.toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      escalated: 0,
      completed: 0,
      criticalCount: 0,
    });
  });

  test('throws when the summary query returns no row', async () => {
    summaryRow = null;

    await expect(getTicketSummary()).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', statusCode: 503 });
  });
});

describe('getTicketById', () => {
  test('returns null without an id or when no ticket matches', async () => {
    await expect(getTicketById('')).resolves.toBeNull();
    await expect(getTicketById('missing')).resolves.toBeNull();
  });

  test('returns the ticket with parsed fields and its activity history', async () => {
    tickets = [baseTicket({ metadata: '{"priority":"x"}' })];
    activities = [{ id: 'tact_1', comment: 'Opened', metadata: '{"source":"web"}' }, { id: 'tact_2', comment: 'Plain', metadata: null }];

    const ticket = await getTicketById('TKT-10001');

    expect(ticket).toMatchObject({ id: 'tkt_1', metadata: { priority: 'x' }, attachments: [], raw: {} });
    expect(ticket.activities).toEqual([
      expect.objectContaining({ id: 'tact_1', metadata: { source: 'web' } }),
      expect.objectContaining({ id: 'tact_2', metadata: {} }),
    ]);
  });

  test('throws when the activity query returns no row set', async () => {
    tickets = [baseTicket()];
    pool.query
      .mockResolvedValueOnce({ rows: tickets })
      .mockResolvedValueOnce({});

    await expect(getTicketById('tkt_1')).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE', statusCode: 503 });
  });
});

describe('createTicket', () => {
  const REQUIRED = {
    subject: 'Invoice mismatch',
    customerName: 'Buyer Co',
    customerEmail: 'buyer@procure.test',
    customerPhone: '+1 555 0100',
    assignedToName: 'Ops Lead',
  };

  test('requires data and rejects each missing required field by name', async () => {
    await expect(createTicket()).rejects.toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 400 });

    const cases = [
      ['subject', { ...REQUIRED, subject: undefined }],
      ['customer name', { ...REQUIRED, customerName: undefined }],
      ['customer email', { ...REQUIRED, customerEmail: '' }],
      ['customer phone', { ...REQUIRED, customerPhone: '   ' }],
      ['assigned to name', { ...REQUIRED, assignedToName: null }],
    ];
    for (const [field, payload] of cases) {
      await expect(createTicket(payload, { uuid: 'actor-1' })).rejects.toThrow(`Ticket ${field} is required`);
    }
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('creates a pending ticket with defaults and logs the creation activity', async () => {
    const before = Date.now();

    const ticket = await createTicket(REQUIRED, { uuid: 'actor-1', name: 'Ana Rao' });

    expect(ticket).toMatchObject({
      subject: 'Invoice mismatch',
      status: 'Pending',
      priority: 'Medium',
      description: '',
      category: null,
      project: null,
      customer_id: null,
      assigned_to_user_id: null,
      assigned_team: null,
      created_by_user_id: 'actor-1',
      created_by_name: 'Ana Rao',
      last_edited_by_name: 'Ana Rao',
      sla_hours: 24,
      resolved_at: null,
      escalation_level: 0,
      attachments: [],
      metadata: {},
    });
    expect(ticket.ticket_number).toMatch(/^TKT-\d{5}$/);
    expect(new Date(ticket.due_date).getTime()).toBeGreaterThanOrEqual(before + ONE_DAY_MS - 1000);

    const [activitySql, activityParams] = queriesMatching(/INSERT INTO ticket_activities/)[0];
    expect(activitySql).toContain("'CREATED'");
    expect(activityParams).toEqual([
      expect.stringMatching(/^tact_/),
      ticket.id,
      'actor-1',
      'Ana Rao',
      'Ticket opened in Action Center.',
      ticket.created_at,
    ]);
  });

  test('accepts snake_case aliases, a supplied due date, and an actor without a name', async () => {
    const ticket = await createTicket(
      {
        subject: 'Delivery delay',
        description: 'Late delivery',
        status: 'In Progress',
        priority: 'High',
        category: 'Logistics',
        project: 'Supply',
        customer_id: 'cust-9',
        customer_name: 'Buyer',
        customer_email: 'buyer@procure.test',
        customer_phone: '+2 555',
        assigned_to_user_id: 'u-2',
        assigned_to_name: 'Ops',
        assigned_team: 'Ops Team',
        ticket_number: 'TKT-CUSTOM-1',
        sla_hours: 12,
        due_date: '2026-07-01T00:00:00.000Z',
        attachments: [{ name: 'po.pdf' }],
        metadata: { source: 'email' },
      },
      { id: 'actor-id-only', email: 'ops@procure.test' }
    );

    expect(ticket).toMatchObject({
      ticket_number: 'TKT-CUSTOM-1',
      status: 'In Progress',
      priority: 'High',
      category: 'Logistics',
      project: 'Supply',
      customer_id: 'cust-9',
      assigned_to_user_id: 'u-2',
      assigned_team: 'Ops Team',
      sla_hours: 12,
      due_date: '2026-07-01T00:00:00.000Z',
      created_by_user_id: 'actor-id-only',
      created_by_name: 'ops@procure.test',
      attachments: [{ name: 'po.pdf' }],
      metadata: { source: 'email' },
    });
  });

  test('accepts camelCase aliases and records no actor when none is supplied', async () => {
    const ticket = await createTicket(
      {
        subject: 'Access request',
        customerName: 'Vendor A',
        customerEmail: 'vendor@procure.test',
        customerPhone: '+3 555',
        assignedToName: 'Desk',
        customerId: 'cust-camel',
        assignedToUserId: 'u-camel',
        assignedTeam: 'Desk Team',
        ticketNumber: 'TKT-CAMEL',
        slaHours: 6,
      },
      {}
    );

    expect(ticket).toMatchObject({
      ticket_number: 'TKT-CAMEL',
      sla_hours: 6,
      customer_id: 'cust-camel',
      assigned_to_user_id: 'u-camel',
      assigned_team: 'Desk Team',
      created_by_user_id: null,
      created_by_name: null,
    });
    expect(new Date(ticket.due_date).getTime()).toBeGreaterThan(Date.now());
  });

  test('uses the default SLA when the supplied SLA is zero or not a number', async () => {
    const ticket = await createTicket({ ...REQUIRED, slaHours: 'soon' }, { name: 'Ana' });

    expect(ticket.sla_hours).toBe(24);
  });

  test('requires storage before writing', async () => {
    pool.hasStorage.mockReturnValue(false);

    await expect(createTicket(REQUIRED, { name: 'Ana' })).rejects.toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('updateTicket', () => {
  test('returns null when the ticket does not exist', async () => {
    await expect(updateTicket('missing')).resolves.toBeNull();
    expect(queriesMatching(/UPDATE tickets/)).toHaveLength(0);
  });

  test('keeps existing values and records no activity when nothing changes', async () => {
    tickets = [baseTicket()];

    const updated = await updateTicket('tkt_1');

    const [, params] = queriesMatching(/UPDATE tickets/)[0];
    expect(params[0]).toBe('Login fails');
    expect(params[2]).toBe('Pending');
    expect(params[6]).toBe('Support Lead');
    expect(params[10]).toBeNull();
    expect(params[13]).toBe('Editor');
    expect(params[15]).toBe('tkt_1');
    expect(queriesMatching(/INSERT INTO ticket_activities/)).toHaveLength(0);
    expect(updated).toMatchObject({ id: 'tkt_1' });
  });

  test('uses the alternate snake_case assignment keys and explicit field values', async () => {
    tickets = [baseTicket()];

    await updateTicket(
      'tkt_1',
      {
        category: 'Billing',
        project: 'Finance',
        subject: 'New subject',
        description: 'New description',
        assigned_to_name: 'Alt Lead',
        assigned_to_user_id: 'u-alt',
        assigned_team: 'Alt Team',
        resolutionNotes: 'Pending review',
        due_date: '2026-08-01T00:00:00.000Z',
      },
      { email: 'editor@procure.test' }
    );

    const [, params] = queriesMatching(/UPDATE tickets/)[0];
    expect(params.slice(0, 10)).toEqual([
      'New subject',
      'New description',
      'Pending',
      'Medium',
      'Billing',
      'Finance',
      'Alt Lead',
      'u-alt',
      'Alt Team',
      'Pending review',
    ]);
    expect(params[12]).toBe('2026-08-01T00:00:00.000Z');
    expect(params[13]).toBe('editor@procure.test');
  });

  test('completes a ticket, records a resolution, and falls back to the actor identity', async () => {
    tickets = [baseTicket({ status: 'In Progress' })];

    await updateTicket('tkt_1', { status: 'Completed', resolutionNotes: 'Fixed', comment: 'Closed by support' }, { uuid: 'u-9', name: 'Resolver' });

    const [, params] = queriesMatching(/UPDATE tickets/)[0];
    expect(params[2]).toBe('Completed');
    expect(params[9]).toBe('Fixed');
    expect(params[10]).toEqual(expect.any(String));
    expect(params[11]).toBe('Resolver');

    const [activitySql, activityParams] = queriesMatching(/INSERT INTO ticket_activities/)[0];
    expect(activitySql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)');
    expect(activityParams).toEqual([
      expect.stringMatching(/^tact_/),
      'tkt_1',
      'RESOLVED',
      'u-9',
      'Resolver',
      'In Progress',
      'Completed',
      'Closed by support',
      expect.any(String),
    ]);
  });

  test('keeps the earlier resolution time and resolver on an already completed ticket', async () => {
    tickets = [
      baseTicket({
        status: 'Completed',
        resolved_at: '2026-05-02T00:00:00.000Z',
        resolved_by_name: 'First Resolver',
      }),
    ];

    await updateTicket('tkt_1', { status: 'Completed' }, { name: 'Second Resolver' });

    const [, params] = queriesMatching(/UPDATE tickets/)[0];
    expect(params[10]).toBe('2026-05-02T00:00:00.000Z');
    expect(params[11]).toBe('First Resolver');
    expect(queriesMatching(/INSERT INTO ticket_activities/)).toHaveLength(0);
  });

  test('logs a status change with a generated comment when no comment is given', async () => {
    tickets = [baseTicket()];

    await updateTicket('tkt_1', { status: 'Escalated' }, {});

    const [activitySql, activityParams] = queriesMatching(/INSERT INTO ticket_activities/)[0];
    expect(activitySql).toContain('ticket_activities');
    expect(activityParams[2]).toBe('STATUS_CHANGE');
    expect(activityParams[3]).toBeNull();
    expect(activityParams[4]).toBeNull();
    expect(activityParams[5]).toBe('Pending');
    expect(activityParams[6]).toBe('Escalated');
    expect(activityParams[7]).toBe('Status updated from Pending to Escalated.');
  });
});

describe('escalateTicket', () => {
  test('returns null for an unknown ticket', async () => {
    await expect(escalateTicket('missing', { escalatedTo: 'Director', reason: 'Late' })).resolves.toBeNull();
    expect(queriesMatching(/UPDATE tickets/)).toHaveLength(0);
  });

  test('raises the escalation level, sets critical priority, and records the escalation', async () => {
    tickets = [baseTicket({ escalation_level: 1, status: 'In Progress' })];

    await escalateTicket('tkt_1', { escalatedTo: 'Director', reason: 'SLA breach' }, { uuid: 'u-3', email: 'lead@procure.test' });

    const [, updateParams] = queriesMatching(/UPDATE tickets/)[0];
    expect(updateParams).toEqual([2, 'Director', 'SLA breach', expect.any(String), 'tkt_1']);

    const [, activityParams] = queriesMatching(/ESCALATED/)[0];
    expect(activityParams[2]).toBe('u-3');
    expect(activityParams[3]).toBe('lead@procure.test');
    expect(activityParams[4]).toBe('In Progress');
    expect(activityParams[5]).toBe('Escalated (Level 2) to Director: SLA breach');
    expect(JSON.parse(activityParams[6])).toEqual({ escalatedTo: 'Director', reason: 'SLA breach', level: 2 });
  });

  test('starts at level one when no earlier level exists and accepts a missing actor', async () => {
    tickets = [baseTicket({ escalation_level: null })];

    await escalateTicket('tkt_1');

    const [, updateParams] = queriesMatching(/UPDATE tickets/)[0];
    expect(updateParams[0]).toBe(1);
    const [, activityParams] = queriesMatching(/ESCALATED/)[0];
    expect(activityParams[2]).toBeNull();
    expect(activityParams[3]).toBeNull();
  });
});

describe('addTicketComment', () => {
  test('returns null for an unknown ticket', async () => {
    await expect(addTicketComment('missing', { comment: 'Hello' })).resolves.toBeNull();
    expect(queriesMatching(/INSERT INTO ticket_activities/)).toHaveLength(0);
  });

  test('stores the comment with default metadata and the email as the actor name fallback', async () => {
    tickets = [baseTicket()];

    const saved = await addTicketComment('tkt_1', { comment: 'Looked into it' }, { email: 'agent@procure.test' });

    const [, params] = queriesMatching(/INSERT INTO ticket_activities/)[0];
    expect(params[2]).toBeNull();
    expect(params[3]).toBe('agent@procure.test');
    expect(params[4]).toBe('Looked into it');
    expect(params[5]).toBe('{}');
    expect(saved).toMatchObject({ comment: 'Looked into it' });
  });

  test('stores caller metadata and the actor id and name when they are supplied', async () => {
    tickets = [baseTicket()];

    await addTicketComment('tkt_1', { comment: 'Internal note', metadata: { internal: true } }, { uuid: 'u-5', name: 'Agent' });

    const [, params] = queriesMatching(/INSERT INTO ticket_activities/)[0];
    expect(params[2]).toBe('u-5');
    expect(params[3]).toBe('Agent');
    expect(params[5]).toBe('{"internal":true}');
  });

  test('accepts a call without a payload or actor', async () => {
    tickets = [baseTicket()];

    await expect(addTicketComment('tkt_1')).resolves.toMatchObject({ id: expect.any(String) });
  });

  test('throws when the comment insert returns no row', async () => {
    tickets = [baseTicket()];
    commentRows = () => [];

    await expect(addTicketComment('tkt_1', { comment: 'x' }, { name: 'Agent' })).rejects.toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
      statusCode: 503,
    });
  });
});

describe('deleteTicket', () => {
  test('deletes the ticket by id and reports success', async () => {
    await expect(deleteTicket('tkt_1')).resolves.toBe(true);

    expect(pool.query).toHaveBeenCalledWith(
      'DELETE FROM tickets WHERE id = $1',
      ['tkt_1'],
      { d1: true, d1Text: 'DELETE FROM tickets WHERE id = $1' }
    );
  });
});

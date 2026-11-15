const internalTaskQueries = require('../src/db/internalTaskQueries');
const ticketQueries = require('../src/db/ticketQueries');
const scorecardQueries = require('../src/db/scorecardQueries');

const NOW = new Date().toISOString();
let taskCounter = 0;

function taskRecord(overrides = {}) {
  taskCounter += 1;
  return {
    id: `task-${taskCounter}`,
    title: 'Routine follow-up',
    description: '',
    status: 'In Progress',
    task_category: 'OPERATIONS',
    related_entity_type: null,
    assigned_to_user_id: null,
    assigned_to_name: null,
    created_at: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  taskCounter = 0;
  jest.spyOn(internalTaskQueries, 'listAllInternalTasks').mockResolvedValue([]);
  jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([]);
  jest.spyOn(ticketQueries, 'getTickets').mockResolvedValue({ rows: [], total: 0 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getScorecardData ranking', () => {
  test('ranks members with a measured score and leaves unscored members unranked', async () => {
    internalTaskQueries.getInternalAssignees.mockResolvedValue([
      { id: 'u-1', name: 'Asha Rao' },
      { id: 'u-2', name: 'Bilal Khan' },
      { id: 'u-3', name: 'Chitra Menon' },
    ]);
    internalTaskQueries.listAllInternalTasks.mockResolvedValue([
      taskRecord({ assigned_to_user_id: 'u-1', status: 'Completed' }),
      taskRecord({ assigned_to_user_id: 'u-1', status: 'In Progress' }),
      taskRecord({ assigned_to_user_id: 'u-2', status: 'Completed' }),
      taskRecord({ assigned_to_user_id: 'u-2', status: 'Completed' }),
    ]);

    const result = await scorecardQueries.getScorecardData({ period: 'this_month' });

    const byName = Object.fromEntries(result.teamScores.map((member) => [member.name, member]));
    expect(byName['Bilal Khan']).toMatchObject({ rank: 1, score: 100 });
    expect(byName['Asha Rao']).toMatchObject({ rank: 2, score: 50 });
    expect(byName['Chitra Menon']).toMatchObject({ rank: null, score: null });
  });

  test('keeps a single scored member at rank one', async () => {
    internalTaskQueries.getInternalAssignees.mockResolvedValue([{ id: 'u-1', name: 'Asha Rao' }]);
    internalTaskQueries.listAllInternalTasks.mockResolvedValue([
      taskRecord({ assigned_to_name: 'Asha Rao', status: 'Completed' }),
    ]);

    const result = await scorecardQueries.getScorecardData();

    expect(result.teamScores[0]).toMatchObject({ rank: 1, score: 100 });
  });
});

describe('getScorecardData sales metrics', () => {
  test('counts a completed sales task as a closed deal only when its title names a deal', async () => {
    internalTaskQueries.getInternalAssignees.mockResolvedValue([{ id: 'u-1', name: 'Asha Rao' }]);
    internalTaskQueries.listAllInternalTasks.mockResolvedValue([
      taskRecord({ assigned_to_user_id: 'u-1', status: 'Completed', task_category: 'SALES', title: null }),
      taskRecord({ assigned_to_user_id: 'u-1', status: 'Completed', task_category: 'SALES', title: 'Deal with Acme' }),
      taskRecord({ assigned_to_user_id: 'u-1', status: 'In Progress', task_category: 'SALES', title: 'Deal pipeline' }),
    ]);

    const result = await scorecardQueries.getScorecardData();

    expect(result.teamScores[0].sales).toMatchObject({ dealsClosed: 1, leadsContacted: 3 });
  });
});

describe('getScorecardData ticket, band, and executive handling', () => {
  test('counts only tickets with a usable date inside the period for each assignee', async () => {
    internalTaskQueries.getInternalAssignees.mockResolvedValue([
      { id: 'u-1', name: 'Asha Rao' },
      { id: 'u-2', name: 'Bilal Khan' },
    ]);
    ticketQueries.getTickets.mockResolvedValue({
      rows: [
        { id: 't-1', assigned_to_user_id: 'u-1', status: 'Completed', created_at: NOW },
        { id: 't-2', assigned_to_name: 'bilal khan', status: 'Pending', created_at: NOW },
        { id: 't-3', assigned_to_user_id: 'u-1', status: 'Pending', created_at: null },
        { id: 't-4', assigned_to_user_id: 'u-1', status: 'Pending', created_at: 'not-a-date' },
        { id: 't-5', assigned_to_user_id: 'u-1', status: 'Completed', created_at: '2000-01-01T00:00:00.000Z' },
      ],
    });

    const result = await scorecardQueries.getScorecardData();

    const byName = Object.fromEntries(result.teamScores.map((member) => [member.name, member]));
    expect(byName['Asha Rao'].operations).toMatchObject({
      ticketsAssigned: 1,
      ticketsResolved: 1,
      ticketResolutionRate: 100,
    });
    expect(byName['Bilal Khan'].operations).toMatchObject({
      ticketsAssigned: 1,
      ticketsResolved: 0,
      ticketResolutionRate: 0,
    });
  });

  test('treats a ticket result without rows as no tickets', async () => {
    internalTaskQueries.getInternalAssignees.mockResolvedValue([{ id: 'u-1', name: 'Asha Rao' }]);
    ticketQueries.getTickets.mockResolvedValue({});

    const result = await scorecardQueries.getScorecardData();

    expect(result.teamScores[0].operations).toMatchObject({ ticketsAssigned: 0, ticketResolutionRate: null });
  });

  test('labels performance by score band and reads tasks that have no category or title', async () => {
    internalTaskQueries.getInternalAssignees.mockResolvedValue([
      { id: 'u-1', name: 'Asha Rao' },
      { id: 'u-2', name: 'Bilal Khan' },
      { id: 'u-3', name: 'Chitra Menon' },
    ]);
    const completed = (count, assignee, extra = {}) =>
      Array.from({ length: count }, () => taskRecord({ assigned_to_user_id: assignee, status: 'Completed', ...extra }));
    internalTaskQueries.listAllInternalTasks.mockResolvedValue([
      ...completed(9, 'u-1'),
      taskRecord({ assigned_to_user_id: 'u-1', status: 'In Progress' }),
      ...completed(1, 'u-2', { task_category: null, title: null }),
      taskRecord({ assigned_to_user_id: 'u-2', status: 'Pending', task_category: null, title: null }),
      ...completed(1, 'u-3', { task_category: null, title: null }),
      ...Array.from({ length: 4 }, () =>
        taskRecord({ assigned_to_user_id: 'u-3', status: 'Pending', task_category: null, title: null })
      ),
    ]);

    const result = await scorecardQueries.getScorecardData();

    const byName = Object.fromEntries(result.teamScores.map((member) => [member.name, member]));
    expect(byName['Asha Rao']).toMatchObject({ score: 90, performanceStatus: 'On Track', rank: 1 });
    expect(byName['Bilal Khan']).toMatchObject({ score: 50, performanceStatus: 'Average', rank: 2 });
    expect(byName['Chitra Menon']).toMatchObject({ score: 20, performanceStatus: 'Needs Focus', rank: 3 });
  });

  test('finds a named executive whatever the case of the name', async () => {
    internalTaskQueries.getInternalAssignees.mockResolvedValue([
      { id: 'u-1', name: 'Asha Rao' },
      { id: 'u-2', name: 'Bilal Khan' },
    ]);
    internalTaskQueries.listAllInternalTasks.mockResolvedValue([
      taskRecord({ assigned_to_user_id: 'u-2', status: 'Completed' }),
    ]);

    const result = await scorecardQueries.getScorecardData({ executiveId: 'bilal khan' });

    expect(result.executiveId).toBe('bilal khan');
    expect(result.teamScores).toHaveLength(2);
  });
});

describe('resolveDateRange periods', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('defaults to the current month when no period is given', () => {
    const range = scorecardQueries.resolveDateRange();

    expect(new Date(range.startDate).getDate()).toBe(1);
    expect(new Date(range.endDate).getMonth()).toBe(new Date(range.startDate).getMonth());
    expect(range.label).toEqual(expect.any(String));
  });

  test('starts a week on Monday, including when today is a Sunday', () => {
    jest.useFakeTimers({ now: new Date(2026, 4, 3, 12, 0, 0) });

    const start = new Date(scorecardQueries.resolveDateRange('this_week').startDate);

    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(27);
  });

  test('uses the financial year that began in the previous April before April', () => {
    jest.useFakeTimers({ now: new Date(2026, 2, 15, 12, 0, 0) });

    const range = scorecardQueries.resolveDateRange('financial_year');

    expect(new Date(range.startDate).getFullYear()).toBe(2025);
    expect(new Date(range.endDate).getFullYear()).toBe(2026);
  });

  test('uses the financial year that began this April after April', () => {
    jest.useFakeTimers({ now: new Date(2026, 5, 15, 12, 0, 0) });

    const range = scorecardQueries.resolveDateRange('financial_year');

    expect(new Date(range.startDate).getFullYear()).toBe(2026);
  });

  test('falls back to the current month for a custom period without dates and honours supplied dates', () => {
    jest.useFakeTimers({ now: new Date(2026, 5, 15, 12, 0, 0) });

    const open = scorecardQueries.resolveDateRange('custom');
    expect(new Date(open.startDate).getMonth()).toBe(5);

    const bounded = scorecardQueries.resolveDateRange(
      'custom',
      '2026-01-05T00:00:00.000Z',
      '2026-01-20T00:00:00.000Z'
    );
    expect(bounded.startDate).toBe('2026-01-05T00:00:00.000Z');
    expect(bounded.endDate).toBe('2026-01-20T00:00:00.000Z');
  });
});

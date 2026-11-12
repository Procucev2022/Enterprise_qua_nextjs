const supertest = require('supertest');
const request = (app) => {
  const agent = supertest(app);
  return { get: (path) => agent.get(path).set('Authorization', 'Bearer scorecard-test-token') };
};
const app = require('../src/app');
const scorecardQueries = require('../src/db/scorecardQueries');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const ticketQueries = require('../src/db/ticketQueries');
const authService = require('../src/services/authService');

// Staff come from the database (internalTaskQueries.getInternalAssignees). These
// fixtures stand in for database rows in the test.
const STAFF = [
  { id: 'exec-1', name: 'Pavani Test', role: 'CategoryManager', email: 'pavani@test.local', project: null },
  { id: 'exec-2', name: 'Navin Test', role: 'SuperUser', email: 'navin@test.local', project: null },
];

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
const RECENT_RANGE = `period=custom&startDate=${encodeURIComponent(daysAgo(10))}&endDate=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`;

function taskRow(overrides) {
  return {
    id: 'task-x',
    task_category: 'INTERNAL_OPERATIONS',
    title: 'Operational follow-up',
    description: '',
    status: 'Pending',
    assigned_to_name: 'Pavani Test',
    assigned_to_user_id: 'exec-1',
    related_entity_type: 'GENERAL',
    created_at: daysAgo(1),
    ...overrides,
  };
}

describe('Scorecard API & Controller', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
      valid: true,
      user: { sub: 'scorecard-staff-id', email: 'staff@test.local', role: 'category_manager' },
    });
    jest.spyOn(internalTaskQueries, 'listAllInternalTasks').mockResolvedValue([]);
    jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue(STAFF);
    jest.spyOn(ticketQueries, 'getTickets').mockResolvedValue({ rows: [], total: 0 });
  });

  test('GET /api/scorecard rejects anonymous and non-staff callers', async () => {
    const anonymous = await supertest(app).get('/api/scorecard');
    expect(anonymous.status).toBe(401);

    jest.spyOn(authService, 'assertSessionActive').mockResolvedValueOnce({
      valid: true,
      user: { sub: 'buyer-test-id', email: 'buyer@test.local', role: 'buyer' },
    });
    const buyer = await supertest(app)
      .get('/api/scorecard')
      .set('Authorization', 'Bearer buyer-token');
    expect(buyer.status).toBe(403);
  });

  test('GET /api/scorecard returns the pillar structure for every period', async () => {
    const periods = ['today', 'this_week', 'this_month', 'last_month', 'this_quarter', 'financial_year', 'custom'];
    for (const p of periods) {
      const res = await request(app).get(`/api/scorecard?period=${p}&startDate=2026-10-01&endDate=2026-10-31`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pillarSummary.operations).toBeDefined();
      expect(res.body.data.pillarSummary.revenue).toBeDefined();
      expect(res.body.data.pillarSummary.sales).toBeDefined();
      expect(Array.isArray(res.body.data.teamScores)).toBe(true);
      expect(res.body.data.teamScores.map((m) => m.id)).toEqual(['exec-1', 'exec-2']);
    }
  });

  test('GET /api/scorecard filters by executive id and by name', async () => {
    const res = await request(app).get('/api/scorecard?period=this_month&executiveId=exec-1');
    expect(res.status).toBe(200);
    expect(res.body.data.executiveId).toBe('exec-1');
    expect(res.body.data.pillarSummary.operations.tasksAssigned).toBe(0);

    const resName = await request(app).get('/api/scorecard?period=this_month&executiveId=pavani%20test');
    expect(resName.status).toBe(200);

    const resUnknown = await request(app).get('/api/scorecard?period=this_month&executiveId=unknown-exec');
    expect(resUnknown.status).toBe(200);
    expect(resUnknown.body.data.pillarSummary.operations.tasksAssigned).toBeNull();
  });

  test('GET /api/scorecard returns 400 for a custom range with invalid dates', async () => {
    const res = await request(app).get('/api/scorecard?period=custom&startDate=not-a-date&endDate=2026-10-31');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('GET /api/scorecard returns 503 when task storage is unavailable', async () => {
    const storageError = Object.assign(new Error('storage down'), { code: 'PERSISTENCE_UNAVAILABLE' });
    jest.spyOn(internalTaskQueries, 'listAllInternalTasks').mockRejectedValue(storageError);
    const res = await request(app).get('/api/scorecard?period=this_month');
    expect(res.status).toBe(503);
    expect(res.body.retryable).toBe(true);
  });

  test('metrics are counted from recorded tasks inside the date range and null where not measurable', async () => {
    jest.spyOn(internalTaskQueries, 'listAllInternalTasks').mockResolvedValue([
      taskRow({ id: 't1', status: 'Completed' }),
      taskRow({ id: 't2', status: 'Completed' }),
      taskRow({ id: 't3', status: 'Pending' }),
      taskRow({ id: 't-old', status: 'Completed', created_at: daysAgo(400) }),
    ]);

    const data = await scorecardQueries.getScorecardData({ period: 'custom', startDate: daysAgo(10), endDate: new Date(Date.now() + 86400000).toISOString() });
    const pavani = data.teamScores.find((m) => m.id === 'exec-1');

    expect(pavani.operations.tasksAssigned).toBe(3);
    expect(pavani.operations.tasksCompleted).toBe(2);
    expect(pavani.operations.taskCompletionRate).toBe(67);
    expect(pavani.revenue.totalDues).toBeNull();
    expect(pavani.revenue.duesCollected).toBeNull();
    expect(pavani.revenue.loansTarget).toBeNull();
    expect(pavani.sales.visitToDealRate).toBeNull();
    expect(pavani.operations.registrationsTarget).toBeNull();
    expect(pavani.rank).toBe(1);
  });

  test('a member with no measurable activity has no score, no status, and no rank', async () => {
    const data = await scorecardQueries.getScorecardData({ period: 'custom', startDate: daysAgo(10), endDate: new Date(Date.now() + 86400000).toISOString() });
    const navin = data.teamScores.find((m) => m.id === 'exec-2');
    expect(navin.score).toBeNull();
    expect(navin.performanceStatus).toBeNull();
    expect(navin.rank).toBeNull();
  });

  test('pillar summary is all null when the team has no staff', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalAssignees').mockResolvedValue([]);
    const data = await scorecardQueries.getScorecardData({ period: 'this_month' });
    expect(data.teamScores).toEqual([]);
    expect(data.pillarSummary.operations.tasksAssigned).toBeNull();
    expect(data.pillarSummary.sales.dealsClosed).toBeNull();
  });

  test('resolveDateRange and safePercentage handle every period and missing denominators', () => {
    expect(scorecardQueries.safePercentage(1, 0)).toBeNull();
    expect(scorecardQueries.safePercentage(5, 2)).toBe(100);
    ['today', 'this_week', 'last_month', 'this_quarter', 'financial_year', 'unknown'].forEach((p) => {
      const range = scorecardQueries.resolveDateRange(p);
      expect(new Date(range.startDate).getTime()).toBeLessThanOrEqual(new Date(range.endDate).getTime());
    });
  });
});

const request = require('supertest');
const app = require('../src/app');
const scorecardQueries = require('../src/db/scorecardQueries');
const internalTaskQueries = require('../src/db/internalTaskQueries');
const ticketQueries = require('../src/db/ticketQueries');

describe('Scorecard API & Controller', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('GET /api/scorecard returns performance analytics for team and periods', async () => {
    const periods = ['today', 'this_week', 'this_month', 'last_month', 'this_quarter', 'financial_year', 'custom'];

    for (const p of periods) {
      const res = await request(app).get(`/api/scorecard?period=${p}&startDate=2026-10-01&endDate=2026-10-31`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pillarSummary).toBeDefined();
      expect(res.body.data.pillarSummary.operations).toBeDefined();
      expect(res.body.data.pillarSummary.revenue).toBeDefined();
      expect(res.body.data.pillarSummary.sales).toBeDefined();
      expect(Array.isArray(res.body.data.teamScores)).toBe(true);
    }
  });

  test('GET /api/scorecard with individual executive filter and name matches', async () => {
    const res = await request(app).get('/api/scorecard?period=this_month&executiveId=exec-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.executiveId).toBe('exec-1');

    // Filter by name
    const resName = await request(app).get('/api/scorecard?period=this_month&executiveId=pavani');
    expect(resName.status).toBe(200);

    // Filter with unknown ID
    const resUnknown = await request(app).get('/api/scorecard?period=this_month&executiveId=unknown-exec');
    expect(resUnknown.status).toBe(200);
  });

  test('scorecard metrics calculation with mock tasks and tickets matching assigned_to_user_id', async () => {
    jest.spyOn(internalTaskQueries, 'getInternalTasks').mockResolvedValue({
      rows: [
        { id: 't-1', status: 'Completed', assigned_to_user_id: 'exec-1', assigned_to_name: null },
        { id: 't-2', status: 'Pending', assigned_to_user_id: 'exec-1', assigned_to_name: 'Pavani' },
        { id: 't-3', status: 'Completed', assigned_to_name: 'Navin Chaudhary', assigned_to_user_id: null },
      ],
    });

    jest.spyOn(ticketQueries, 'getTickets').mockResolvedValue({
      rows: [
        { id: 'tkt-1', status: 'Completed', assigned_to_user_id: 'exec-1', assigned_to_name: null },
        { id: 'tkt-2', status: 'Pending', assigned_to_name: 'Pavani', assigned_to_user_id: null },
      ],
    });

    const data = await scorecardQueries.getScorecardData({ period: 'this_month' });
    expect(data.teamScores[0].operations.tasksCompleted).toBeGreaterThanOrEqual(1);
    expect(data.teamScores[0].operations.ticketsResolved).toBeGreaterThanOrEqual(1);
  });

  test('resolveDateRange helper covers custom dates and financial year branches', () => {
    // Custom with no customStart / customEnd
    const r1 = scorecardQueries.resolveDateRange('custom');
    expect(r1.startDate).toBeDefined();

    // Custom with only start
    const r2 = scorecardQueries.resolveDateRange('custom', '2026-01-01');
    expect(r2.startDate).toContain('2026-01-01');

    // Default period fallback
    const r3 = scorecardQueries.resolveDateRange();
    expect(r3.label).toBeDefined();
  });

  test('safePercentage helper safely handles zeroes and negatives', () => {
    expect(scorecardQueries.safePercentage(0, 0)).toBeNull();
    expect(scorecardQueries.safePercentage(5, 0)).toBeNull();
    expect(scorecardQueries.safePercentage(5, -10)).toBeNull();
    expect(scorecardQueries.safePercentage(5, 10)).toBe(50);
    expect(scorecardQueries.safePercentage(20, 10)).toBe(100);
  });

  test('handles 500 error catch branches gracefully', async () => {
    jest.spyOn(scorecardQueries, 'getScorecardData').mockRejectedValue(new Error('Calculation failed'));
    const res = await request(app).get('/api/scorecard');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

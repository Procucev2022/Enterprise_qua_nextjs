import { fetchScorecardData } from '@/lib/scorecardClient';
import { authClient } from '@/lib/authClient';

describe('scorecardClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('scorecard-jwt');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches scorecard data with full filter parameters', async () => {
    const mockData = {
      period: 'this_month',
      dateRange: { startDate: '2026-10-01', endDate: '2026-10-31', label: '01 Oct - 31 Oct' },
      pillarSummary: {
        operations: { tasksCompleted: 5, tasksAssigned: 10 },
        revenue: { duesCollected: 100000 },
        sales: { leadsContacted: 20 },
      },
      teamScores: [],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockData }),
    });

    const result = await fetchScorecardData({
      period: 'this_month',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      project: 'Project Titan',
      pillar: 'operations',
      executiveId: 'exec-101',
    });

    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/scorecard?period=this_month&startDate=2026-10-01&endDate=2026-10-31&project=Project+Titan&pillar=operations&executiveId=exec-101'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer scorecard-jwt',
        }),
      })
    );
  });

  it('omits all filter parameter when set to "all"', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { period: 'today' } }),
    });

    await fetchScorecardData({
      period: 'today',
      project: 'all',
      pillar: 'all',
      executiveId: 'all',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/scorecard?period=today',
      expect.any(Object)
    );
  });

  it('returns null on fetch failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const res = await fetchScorecardData();
    expect(res).toBeNull();
  });

  it('returns null on non-200 HTTP response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const res = await fetchScorecardData();
    expect(res).toBeNull();
  });

  it('works when token is null', async () => {
    jest.spyOn(authClient, 'getToken').mockReturnValue(null as any);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    await fetchScorecardData();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/scorecard?',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });
});


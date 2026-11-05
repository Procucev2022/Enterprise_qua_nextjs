import {
  fetchLoginLogs,
  fetchLoginLogsSummary,
  FALLBACK_LOGIN_LOGS,
  FALLBACK_SUMMARY,
} from '@/lib/loginLogsClient';
import { authClient } from '@/lib/authClient';

jest.mock('@/lib/authClient', () => ({
  authClient: {
    getToken: jest.fn(),
  },
}));

describe('loginLogsClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    (authClient.getToken as jest.Mock).mockReturnValue('mock-jwt-token');
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('fetchLoginLogs', () => {
    it('fetches logs successfully via API endpoint', async () => {
      const mockResponse = {
        logs: [
          {
            id: 'log_1',
            userName: 'Test User',
            email: 'test@example.com',
            phoneNumber: '+91 99999 88888',
            companyName: 'Test Corp',
            userType: 'buyer',
            loginAt: '2026-11-05T10:00:00.000Z',
            status: 'ACTIVE',
            createdAt: '2026-11-05T10:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await fetchLoginLogs({ userType: 'buyer', search: 'Test' });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/login-logs?userType=buyer&search=Test',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-token',
          }),
        })
      );
      expect(result.logs).toEqual(mockResponse.logs);
      expect(result.total).toBe(1);
    });

    it('passes all optional filters as query parameters', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ logs: [], total: 0 }),
      });

      await fetchLoginLogs({
        userType: 'vendor',
        status: 'LOGGED_OUT',
        search: 'Apex',
        startDate: '2026-11-01',
        endDate: '2026-11-05',
        dateRangePreset: 'last7',
        page: 2,
        limit: 5,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/login-logs?userType=vendor&status=LOGGED_OUT&search=Apex&startDate=2026-11-01&endDate=2026-11-05&dateRangePreset=last7&page=2&limit=5',
        expect.any(Object)
      );
    });

    it('falls back gracefully to filtered mock dataset on fetch rejection', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      // Filter by userType
      const resultBuyer = await fetchLoginLogs({ userType: 'buyer' });
      expect(resultBuyer.logs.every((l) => l.userType === 'buyer')).toBe(true);

      // Filter by status
      const resultActive = await fetchLoginLogs({ status: 'ACTIVE' });
      expect(resultActive.logs.every((l) => l.status === 'ACTIVE')).toBe(true);

      // Filter by search query (name / email / company / phone)
      const resultSearch = await fetchLoginLogs({ search: 'tatamotors' });
      expect(resultSearch.logs.length).toBeGreaterThan(0);
      expect(resultSearch.logs[0].email).toContain('tatamotors');

      // Test pagination
      const resultPaged = await fetchLoginLogs({ page: 1, limit: 2 });
      expect(resultPaged.logs.length).toBe(2);
      expect(resultPaged.totalPages).toBe(Math.ceil(FALLBACK_LOGIN_LOGS.length / 2));
    });

    it('falls back to mock dataset when HTTP response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await fetchLoginLogs();
      expect(result.logs.length).toBeGreaterThan(0);
      expect(result.total).toBe(FALLBACK_LOGIN_LOGS.length);
    });

    it('handles requests without token gracefully', async () => {
      (authClient.getToken as jest.Mock).mockReturnValue(null);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ logs: [] }),
      });

      await fetchLoginLogs();

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/login-logs',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });

  describe('fetchLoginLogsSummary', () => {
    it('returns summary from API when response is successful', async () => {
      const mockSummary = {
        totalToday: 200,
        activeNow: 40,
        buyerLogins: 110,
        sellerLogins: 90,
        avgDurationMinutes: 35,
        todayPeakHour: '11:00 AM',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ summary: mockSummary }),
      });

      const res = await fetchLoginLogsSummary();
      expect(res).toEqual(mockSummary);
    });

    it('falls back to FALLBACK_SUMMARY on network error or failed status', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('API error'));

      const res = await fetchLoginLogsSummary();
      expect(res).toEqual(FALLBACK_SUMMARY);

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
      const res503 = await fetchLoginLogsSummary();
      expect(res503).toEqual(FALLBACK_SUMMARY);
    });
  });
});

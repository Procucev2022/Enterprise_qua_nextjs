import {
  fetchLoginLogs,
  fetchLoginLogsSummary,
} from '@/lib/loginLogsClient';
import type { LoginLogEntry } from '@/lib/types';
import { authClient } from '@/lib/authClient';
import { UI_STRINGS } from '@/lib/uiStrings';

jest.mock('@/lib/authClient', () => ({
  authClient: {
    getToken: jest.fn(),
  },
}));

// Test-only rows. They use reserved example domains and placeholder identifiers, so they can
// never be mistaken for a real account. The client itself has no fixture data.
const TEST_LOGS: LoginLogEntry[] = [
  {
    id: 'log-test-1',
    userId: 'TEST-BUYER-1',
    userName: 'Test Buyer One',
    email: 'buyer1@example.test',
    phoneNumber: '+00 00000 00001',
    companyName: 'Test Buyer Co',
    userType: 'buyer',
    loginAt: '2026-01-01T10:00:00.000Z',
    logoutAt: null,
    durationSeconds: 60,
    status: 'ACTIVE',
    ipAddress: '192.0.2.1',
    deviceInfo: 'Test device',
    location: 'Test City',
    userAgent: 'test-agent',
    createdAt: '2026-01-01T10:00:00.000Z',
  },
  {
    id: 'log-test-2',
    userId: 'TEST-VENDOR-1',
    userName: 'Test Vendor One',
    email: 'vendor1@example.test',
    phoneNumber: '+00 00000 00002',
    companyName: 'Test Supplier Co',
    userType: 'vendor',
    loginAt: '2026-01-01T09:00:00.000Z',
    logoutAt: '2026-01-01T09:30:00.000Z',
    durationSeconds: 1800,
    status: 'LOGGED_OUT',
    ipAddress: '192.0.2.2',
    deviceInfo: 'Test device',
    location: 'Test Town',
    userAgent: 'test-agent',
    createdAt: '2026-01-01T09:00:00.000Z',
  },
];

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
    it('returns the logs and totals the API reports, with the auth header and query string', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ logs: TEST_LOGS, total: 2, page: 1, totalPages: 1 }),
      });

      const result = await fetchLoginLogs({ userType: 'buyer', status: 'ACTIVE', search: 'Test', page: 2, limit: 10 });

      expect(result).toEqual({ logs: TEST_LOGS, total: 2, page: 1, totalPages: 1 });
      expect(result.error).toBeUndefined();
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/login-logs?userType=buyer&status=ACTIVE&search=Test&page=2&limit=10',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer mock-jwt-token' }),
        })
      );
    });

    it('omits the auth header and "all" filters when no token or filter is set', async () => {
      (authClient.getToken as jest.Mock).mockReturnValue(null);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ logs: [], total: 0 }),
      });

      await fetchLoginLogs({ userType: 'all', status: 'all' });

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('/api/login-logs');
      expect((init as RequestInit).headers).not.toHaveProperty('Authorization');
    });

    it('derives total from the list length and defaults page metadata when the API omits them', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ logs: TEST_LOGS }),
      });

      const result = await fetchLoginLogs();

      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('returns no rows and an error when the API responds with a failure status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

      const result = await fetchLoginLogs({ page: 3 });

      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(3);
      expect(result.totalPages).toBe(0);
      expect(result.error).toBe(
        `Could not load login logs (HTTP 503). Try again in a moment.`
      );
    });

    it('returns no rows and an error when the network request fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

      const result = await fetchLoginLogs();

      expect(result.logs).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.error).toBe(
        'Could not reach the server to load login logs. Check your connection and try again.'
      );
    });

    it('returns an error instead of rows when the reply has no logs array', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ total: 5 }),
      });

      const result = await fetchLoginLogs();

      expect(result.logs).toEqual([]);
      expect(result.error).toBe(
        'The server returned an unexpected response while loading login logs. Try again.'
      );
    });
  });

  describe('fetchLoginLogsSummary', () => {
    it('returns the summary from the API when the response is successful', async () => {
      const mockSummary = {
        totalToday: 4,
        activeNow: 1,
        buyerLogins: 2,
        sellerLogins: 2,
        avgDurationMinutes: 12,
        todayPeakHour: '10:00',
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ summary: mockSummary }),
      });

      const res = await fetchLoginLogsSummary();

      expect(res).toEqual({ summary: mockSummary });
    });

    it('returns a null summary and an error on a failure status', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

      const res = await fetchLoginLogsSummary();

      expect(res.summary).toBeNull();
      expect(res.error).toBe(
        'Could not load login log summary (HTTP 503). Try again in a moment.'
      );
    });

    it('returns a null summary and an error on a network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('API error'));

      const res = await fetchLoginLogsSummary();

      expect(res.summary).toBeNull();
      expect(res.error).toBe(
        'Could not reach the server to load login log summary. Check your connection and try again.'
      );
    });

    it('returns a null summary and an error when the reply has no summary', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

      const res = await fetchLoginLogsSummary();

      expect(res.summary).toBeNull();
      expect(res.error).toBe(
        'The server returned an unexpected response while loading login log summary. Try again.'
      );
    });
  });

  it('uses the shared UI_STRINGS resource names in its error messages', () => {
    expect(UI_STRINGS.dataLoad.resources.loginLogs).toBe('login logs');
    expect(UI_STRINGS.dataLoad.resources.loginLogsSummary).toBe('login log summary');
  });
});

import {
  fetchDashboardMetrics,
  fetchDashboardRecords,
} from '@/lib/categoryManagerDashboardClient';
import { authClient } from '@/lib/authClient';

describe('categoryManagerDashboardClient Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchDashboardMetrics', () => {
    test('fetches metrics successfully with default options and bearer token', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue('mock-token-xyz');
      const mockData = {
        success: true,
        kpi: { totalRfqs: 10, openRfqs: 2 },
        charts: { months: ['Nov'] },
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockData),
      });

      const res = await fetchDashboardMetrics();
      expect(res.success).toBe(true);
      expect(res.kpi).toEqual(mockData.kpi);
      expect(res.charts).toEqual(mockData.charts);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/category-manager/dashboard/metrics',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token-xyz',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    test('builds query parameters for preset, startDate, and endDate, skipping custom and all', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue(null);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, kpi: {}, charts: {} }),
      });

      await fetchDashboardMetrics({
        preset: 'this_week',
        startDate: '2026-11-01',
        endDate: '2026-11-07',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('preset=this_week&startDate=2026-11-01&endDate=2026-11-07'),
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );

      // Preset 'custom' should not be added to query
      await fetchDashboardMetrics({ preset: 'custom' });
      expect(global.fetch).toHaveBeenCalledWith('/api/category-manager/dashboard/metrics', expect.anything());

      // Preset 'all' should not be added to query
      await fetchDashboardMetrics({ preset: 'all' });
      expect(global.fetch).toHaveBeenCalledWith('/api/category-manager/dashboard/metrics', expect.anything());
    });

    test('handles non-200 HTTP response with error body and statusText fallback', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: jest.fn().mockResolvedValue('Access denied for category manager'),
      });

      const res = await fetchDashboardMetrics();
      expect(res.success).toBe(false);
      expect(res.status).toBe(403);
      expect(res.error).toBe('HTTP 403: Access denied for category manager');

      // Fallback when text() rejects or returns empty
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: jest.fn().mockRejectedValue(new Error('Cannot read stream')),
      });

      const resFallback = await fetchDashboardMetrics();
      expect(resFallback.success).toBe(false);
      expect(resFallback.status).toBe(502);
      expect(resFallback.error).toBe('HTTP 502: Bad Gateway');
    });

    test('handles network exceptions (Error and non-Error objects)', async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Connection timed out'));
      const resError = await fetchDashboardMetrics();
      expect(resError.success).toBe(false);
      expect(resError.error).toBe('Network error: Connection timed out');

      // Non-Error exception
      global.fetch = jest.fn().mockRejectedValueOnce('Raw socket disconnection');
      const resNonError = await fetchDashboardMetrics();
      expect(resNonError.success).toBe(false);
      expect(resNonError.error).toBe('Network error: Raw socket disconnection');
    });
  });

  describe('fetchDashboardRecords', () => {
    test('fetches popup records successfully with search and filters', async () => {
      const mockRecords = [{ id: 'rfq-1', title: 'Steel Pipes' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({
          success: true,
          records: mockRecords,
          total: 1,
        }),
      });

      const res = await fetchDashboardRecords({
        type: 'total_rfqs',
        preset: 'today',
        startDate: '2026-11-20',
        endDate: '2026-11-20',
        search: 'Steel',
      });

      expect(res.success).toBe(true);
      expect(res.records).toEqual(mockRecords);
      expect(res.total).toBe(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('type=total_rfqs&preset=today&startDate=2026-11-20&endDate=2026-11-20&search=Steel'),
        expect.anything()
      );
    });

    test('omits custom and all presets from query in fetchDashboardRecords', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, records: [] }),
      });

      await fetchDashboardRecords({ type: 'open_rfqs', preset: 'custom' });
      expect(global.fetch).toHaveBeenCalledWith('/api/category-manager/dashboard/records?type=open_rfqs', expect.anything());

      await fetchDashboardRecords({ type: 'open_rfqs', preset: 'all' });
      expect(global.fetch).toHaveBeenCalledWith('/api/category-manager/dashboard/records?type=open_rfqs', expect.anything());
    });

    test('handles non-200 HTTP response and text error fallbacks for records', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('Invalid record type'),
      });

      const res = await fetchDashboardRecords({ type: 'total_rfqs' });
      expect(res.success).toBe(false);
      expect(res.status).toBe(400);
      expect(res.error).toBe('HTTP 400: Invalid record type');

      // Fallback when text() throws
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Error',
        text: jest.fn().mockRejectedValue(new Error('Stream broke')),
      });

      const resFallback = await fetchDashboardRecords({ type: 'total_rfqs' });
      expect(resFallback.success).toBe(false);
      expect(resFallback.status).toBe(500);
      expect(resFallback.error).toBe('HTTP 500: Internal Error');
    });

    test('handles network exceptions for records', async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('DNS resolution failed'));
      const res = await fetchDashboardRecords({ type: 'total_rfqs' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Network error: DNS resolution failed');

      global.fetch = jest.fn().mockRejectedValueOnce('String throw');
      const resStr = await fetchDashboardRecords({ type: 'total_rfqs' });
      expect(resStr.success).toBe(false);
      expect(resStr.error).toBe('Network error: String throw');
    });
  });
});

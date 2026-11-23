import { publishRFQBroadcast, fetchRFQBroadcasts } from '@/lib/rfqClient';
import { authClient } from '@/lib/authClient';

jest.mock('@/lib/authClient', () => ({
  authClient: {
    getToken: jest.fn(() => 'mock-jwt-token'),
  },
}));

describe('rfqClient broadcast functions', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('publishRFQBroadcast', () => {
    test('successfully publishes broadcast and returns body', async () => {
      const mockResult = {
        success: true,
        data: { id: 'bcast-1', message: 'Hello vendors' },
        rfq: { id: 'rfq-1', broadcasts: [{ id: 'bcast-1' }] },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResult),
      } as any);

      const result = await publishRFQBroadcast('rfq-1', {
        title: 'Title',
        message: 'Hello vendors',
        attachments: [],
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResult.data);
      expect(result.rfq).toEqual(mockResult.rfq);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/rfqs/rfq-1/broadcasts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    test('handles no auth token', async () => {
      (authClient.getToken as jest.Mock).mockReturnValueOnce(null);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: { id: 'bcast-2' } }),
      } as any);

      const result = await publishRFQBroadcast('rfq-2', { message: 'No token' });
      expect(result.success).toBe(true);
    });

    test('returns error when server responds with failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: jest.fn().mockResolvedValue({ success: false, error: 'Unauthorized role' }),
      } as any);

      const result = await publishRFQBroadcast('rfq-1', { message: 'Fail' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized role');
    });

    test('returns default error when server responds with failure without error text', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: jest.fn().mockResolvedValue({ success: false }),
      } as any);

      const result = await publishRFQBroadcast('rfq-1', { message: 'Fail' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to publish broadcast announcement.');
    });

    test('handles network exceptions', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection timed out'));

      const result = await publishRFQBroadcast('rfq-1', { message: 'Crash' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection timed out');
    });
  });

  describe('fetchRFQBroadcasts', () => {
    test('successfully fetches broadcasts list', async () => {
      const mockBroadcasts = [{ id: 'b-1', message: 'Update 1' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true, data: mockBroadcasts }),
      } as any);

      const result = await fetchRFQBroadcasts('rfq-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockBroadcasts);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/rfqs/rfq-1/broadcasts',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-jwt-token',
          }),
        })
      );
    });

    test('returns empty array when data is missing from success response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true }),
      } as any);

      const result = await fetchRFQBroadcasts('rfq-1');
      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    test('returns error when server responds with failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: jest.fn().mockResolvedValue({ success: false, error: 'RFQ not found' }),
      } as any);

      const result = await fetchRFQBroadcasts('rfq-missing');
      expect(result.success).toBe(false);
      expect(result.error).toBe('RFQ not found');
    });

    test('returns default error when server response has no error message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: jest.fn().mockResolvedValue({ success: false }),
      } as any);

      const result = await fetchRFQBroadcasts('rfq-missing');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to fetch broadcast announcements.');
    });

    test('handles network exceptions', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const result = await fetchRFQBroadcasts('rfq-err');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network offline');
    });
  });
});

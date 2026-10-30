import {
  fetchApprovals,
  fetchApprovalSummary,
  processApprovalAction,
} from '@/lib/approvalClient';
import { authClient } from '@/lib/authClient';

describe('approvalClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('test-auth-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('fetchApprovals', () => {
    it('fetches approval list with params', async () => {
      const mockData = {
        data: [{ id: 'appr-1', module: 'Credit Notes', status: 'Pending' }],
        total: 1,
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const result = await fetchApprovals({
        module: 'Credit Notes',
        status: 'Pending',
        project: 'Project Falcon',
        search: 'CN-101',
        limit: 20,
        offset: 0,
      });

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/approvals?module=Credit+Notes&status=Pending&project=Project+Falcon&search=CN-101&limit=20&offset=0'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-auth-token',
          }),
        })
      );
    });

    it('returns empty fallback on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network fail'));
      const result = await fetchApprovals();
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns empty fallback on non-200 HTTP response', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      const result = await fetchApprovals();
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('fetchApprovalSummary', () => {
    it('fetches approval summary metrics', async () => {
      const mockSummary = {
        total: 15,
        pending: 4,
        approved: 9,
        rejected: 2,
      };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ summary: mockSummary }),
      });

      const res = await fetchApprovalSummary();
      expect(res).toEqual(mockSummary);
    });

    it('returns zeroed fallback on failure or non-ok response', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Server down'));
      const res = await fetchApprovalSummary();
      expect(res).toEqual({ pending: 0, approved: 0, rejected: 0, total: 0 });

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      const res2 = await fetchApprovalSummary();
      expect(res2).toEqual({ pending: 0, approved: 0, rejected: 0, total: 0 });
    });
  });

  describe('processApprovalAction', () => {
    it('submits approve action successfully', async () => {
      const mockUpdated = { id: 'appr-1', status: 'Approved' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockUpdated }),
      });

      const res = await processApprovalAction('appr-1', 'APPROVE', 'Within budget threshold');

      expect(res).toEqual({ success: true, data: mockUpdated });
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/approvals/appr-1/action',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'APPROVE',
            remarks: 'Within budget threshold',
          }),
        })
      );
    });

    it('returns error result when server responds with non-ok status', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Insufficient permission' }),
      });

      const res = await processApprovalAction('appr-1', 'REJECT', 'Disallowed');
      expect(res).toEqual({ success: false, error: 'Insufficient permission' });
    });

    it('returns fallback error message when json lacks error string', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      const res = await processApprovalAction('appr-1', 'REJECT', 'Disallowed');
      expect(res).toEqual({ success: false, error: 'Failed to process approval.' });
    });

    it('returns network error on exception', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Fetch failed'));
      const res = await processApprovalAction('appr-1', 'APPROVE');
      expect(res).toEqual({ success: false, error: 'Fetch failed' });

      global.fetch = jest.fn().mockRejectedValue('non-error-string');
      const res2 = await processApprovalAction('appr-1', 'APPROVE');
      expect(res2).toEqual({ success: false, error: 'Network error' });
    });
  });

  describe('authHeaders without token', () => {
    it('sends Content-Type without Authorization header when token is null', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue(null as any);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await fetchApprovals();
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/approvals?',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });
});

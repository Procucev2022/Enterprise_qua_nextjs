import {
  fetchApprovals,
  fetchApprovalSummary,
  processApprovalAction,
} from '@/lib/approvalClient';
import { authClient } from '@/lib/authClient';
import { logger } from '@/lib/logger';
import { UI_STRINGS, formatString } from '@/lib/uiStrings';

describe('approvalClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('test-auth-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
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
        assigned_approver: 'Srinu Sir',
        limit: 20,
        offset: 0,
        sortBy: 'created_at',
        sortOrder: 'desc',
      });

      expect(result).toEqual(mockData);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/approvals?module=Credit+Notes&status=Pending&project=Project+Falcon&search=CN-101&assigned_approver=Srinu+Sir&limit=20&offset=0&sortBy=created_at&sortOrder=desc'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-auth-token',
          }),
        })
      );
    });

    it('returns empty fallback on network error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network fail'));
      const errorLog = jest.spyOn(logger, 'error');
      const result = await fetchApprovals();
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.error).toBe(formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.approvals }));
      expect(errorLog).toHaveBeenCalledWith(
        'Approval list request failed',
        expect.objectContaining({ errorName: 'Error', errorMessage: 'Network fail' }),
        'APPROVAL_CLIENT'
      );
    });

    it('returns empty fallback on non-200 HTTP response', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      const errorLog = jest.spyOn(logger, 'error');
      const result = await fetchApprovals();
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.error).toBe(formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource: UI_STRINGS.dataLoad.resources.approvals, status: 500 }));
      expect(errorLog).toHaveBeenCalledWith('Approval list request rejected', { status: 500 }, 'APPROVAL_CLIENT');
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
      expect(res).toEqual({ summary: mockSummary });
    });

    it('returns a null summary and an error on failure or non-ok response, never zero counts', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Server down'));
      const errorLog = jest.spyOn(logger, 'error');
      const res = await fetchApprovalSummary();
      expect(res).toEqual({ summary: null, error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.approvalSummary }) });
      expect(errorLog).toHaveBeenCalledWith(
        'Approval summary request failed',
        expect.objectContaining({ errorName: 'Error', errorMessage: 'Server down' }),
        'APPROVAL_CLIENT'
      );

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      const res2 = await fetchApprovalSummary();
      expect(res2).toEqual({ summary: null, error: formatString(UI_STRINGS.dataLoad.failedWithStatus, { resource: UI_STRINGS.dataLoad.resources.approvalSummary, status: 500 }) });
      expect(errorLog).toHaveBeenLastCalledWith('Approval summary request rejected', { status: 500 }, 'APPROVAL_CLIENT');
    });
  });

  describe('processApprovalAction', () => {
    it('submits approve action successfully', async () => {
      const mockUpdated = { id: 'appr-1', status: 'Approved' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockUpdated }),
      });

      const res = await processApprovalAction('appr-1', 'APPROVE', 'Within budget threshold', 'Procucev@2026', 'Srinu Sir');

      expect(res).toEqual({ success: true, data: mockUpdated });
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/approvals/appr-1/action',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'APPROVE',
            remarks: 'Within budget threshold',
            password: 'Procucev@2026',
            approverName: 'Srinu Sir',
          }),
        })
      );
    });

    it('returns error result when server responds with non-ok status', async () => {
      const warningLog = jest.spyOn(logger, 'warn');
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Insufficient permission' }),
      });

      const res = await processApprovalAction('appr-1', 'REJECT', 'Disallowed');
      expect(res).toEqual({ success: false, error: 'Insufficient permission' });
      expect(warningLog).toHaveBeenCalledWith(
        'Approval decision request rejected',
        { status: 403 },
        'APPROVAL_CLIENT'
      );
    });

    it('returns fallback error message when json lacks error string', async () => {
      const errorLog = jest.spyOn(logger, 'error');
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      const res = await processApprovalAction('appr-1', 'REJECT', 'Disallowed');
      expect(res).toEqual({ success: false, error: 'Failed to process approval.' });
      expect(errorLog).toHaveBeenCalledWith(
        'Approval decision request rejected',
        { status: 500 },
        'APPROVAL_CLIENT'
      );
    });

    it('returns network error on exception', async () => {
      const errorLog = jest.spyOn(logger, 'error');
      global.fetch = jest.fn().mockRejectedValue(new Error('Fetch failed'));
      const res = await processApprovalAction('appr-1', 'APPROVE');
      expect(res).toEqual({ success: false, error: 'Fetch failed' });

      global.fetch = jest.fn().mockRejectedValue('non-error-string');
      const res2 = await processApprovalAction('appr-1', 'APPROVE');
      expect(res2).toEqual({ success: false, error: 'Network error' });
      expect(errorLog).toHaveBeenNthCalledWith(
        1,
        'Approval decision request failed',
        expect.objectContaining({ errorName: 'Error', errorMessage: 'Fetch failed' }),
        'APPROVAL_CLIENT'
      );
      expect(errorLog).toHaveBeenNthCalledWith(
        2,
        'Approval decision request failed',
        expect.objectContaining({ errorName: 'UnknownError', errorMessage: 'Network error' }),
        'APPROVAL_CLIENT'
      );
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

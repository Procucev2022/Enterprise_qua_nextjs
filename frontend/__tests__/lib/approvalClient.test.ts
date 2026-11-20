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

  describe('fetchApprovalApprovers', () => {
    it('returns approvers from API when response is successful', async () => {
      const mockApprovers = [{ id: 'appr-1', name: 'Sudheer Sir', title: 'Management Authority' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ approvers: mockApprovers }),
      });

      const { fetchApprovalApprovers } = require('@/lib/approvalClient');
      const res = await fetchApprovalApprovers();
      expect(res.approvers).toEqual(mockApprovers);
    });

    it('falls back to APPROVER_CONFIG when response is not ok or empty or fails', async () => {
      const { fetchApprovalApprovers } = require('@/lib/approvalClient');
      
      // non-ok
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
      const res1 = await fetchApprovalApprovers();
      expect(res1.approvers.length).toBeGreaterThan(0);

      // empty array
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ approvers: [] }) });
      const res2 = await fetchApprovalApprovers();
      expect(res2.approvers.length).toBeGreaterThan(0);

      // catch error
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
      const res3 = await fetchApprovalApprovers();
      expect(res3.approvers.length).toBeGreaterThan(0);
    });
  });

  describe('fetchApprovalUsers', () => {
    it('returns users from API when response is successful', async () => {
      const mockUsers = [{ id: 'usr-1', name: 'Krishna', role: 'Category Manager' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ users: mockUsers }),
      });

      const { fetchApprovalUsers } = require('@/lib/approvalClient');
      const res = await fetchApprovalUsers();
      expect(res.users).toEqual(mockUsers);
    });

    it('falls back to internal tasks assignees or default static list on error', async () => {
      const { fetchApprovalUsers } = require('@/lib/approvalClient');

      // fallback fetch succeeds
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('/api/approvals/users')) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ assignees: [{ id: 'usr-2', name: 'Govardhan', role: 'Category Manager' }] }),
        });
      });
      const res1 = await fetchApprovalUsers();
      expect(res1.users).toEqual([{ id: 'usr-2', name: 'Govardhan', role: 'Category Manager' }]);

      // fallback fails with default static list
      global.fetch = jest.fn().mockImplementation((url: string) => {
        return Promise.resolve({ ok: false, status: 500 });
      });
      const res2 = await fetchApprovalUsers();
      expect(res2.users.length).toBe(4);

      // ok true but empty users array
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) });
      const res3 = await fetchApprovalUsers();
      expect(res3.users.length).toBe(4);

      // catch error returns default static list
      global.fetch = jest.fn().mockRejectedValue(new Error('Timeout'));
      const res4 = await fetchApprovalUsers();
      expect(res4.users.length).toBe(4);
    });
  });
});

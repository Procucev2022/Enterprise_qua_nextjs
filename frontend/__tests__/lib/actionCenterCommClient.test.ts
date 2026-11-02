import {
  dispatchActionCenterCommunication,
  fetchActionCenterCommunications,
} from '@/lib/actionCenterCommClient';
import { authClient } from '@/lib/authClient';

describe('actionCenterCommClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('dispatchActionCenterCommunication', () => {
    it('dispatches communication with auth headers and returns successful response', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce('test-token-123');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          message: 'Dispatched successfully',
          communication: { id: 'comm-100', channel: 'EMAIL' },
          emailResult: { success: true },
          smsResult: null,
          completedTask: { id: 'task-1' },
          followupTask: null,
        }),
      });

      const res = await dispatchActionCenterCommunication({
        entityType: 'ticket',
        entityId: 'tkt-1',
        channel: 'EMAIL',
        recipientEmail: 'user@example.com',
        recipientName: 'User One',
        subject: 'Ticket Update',
        message: 'Your ticket is in progress',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/action-center/communications',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token-123',
          },
          body: expect.stringContaining('Ticket Update'),
        })
      );
      expect(res.success).toBe(true);
      expect(res.message).toBe('Dispatched successfully');
      expect(res.communication?.id).toBe('comm-100');
      expect(res.completedTask?.id).toBe('task-1');
    });

    it('returns followupError when returned in API response', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          message: 'Communication dispatched, but scheduling follow-up task failed.',
          followupError: 'Assignee not found',
        }),
      });

      const res = await dispatchActionCenterCommunication({
        entityType: 'internal_task',
        entityId: 'tsk-fol',
        channel: 'EMAIL',
        recipientEmail: 'admin@example.com',
        message: 'Follow-up test',
      });

      expect(res.success).toBe(true);
      expect(res.followupError).toBe('Assignee not found');
    });

    it('handles dispatches without auth token correctly', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce(null);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
        }),
      });

      const res = await dispatchActionCenterCommunication({
        entityType: 'internal_task',
        entityId: 'tsk-2',
        channel: 'SMS',
        recipientPhone: '9876543210',
        message: 'Task reminder',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/action-center/communications',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
      expect(res.success).toBe(true);
    });

    it('returns error when API responds with non-ok status and custom error', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce(null);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: 'Recipient email is invalid',
        }),
      });

      const res = await dispatchActionCenterCommunication({
        entityType: 'ticket',
        entityId: 'tkt-2',
        channel: 'EMAIL',
        recipientEmail: 'invalid-email',
        message: 'Invalid email test',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Recipient email is invalid');
    });

    it('returns fallback error when API responds with non-ok status and no json error message', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce(null);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      });

      const res = await dispatchActionCenterCommunication({
        entityType: 'internal_task',
        entityId: 'tsk-3',
        channel: 'SMS',
        recipientPhone: '9876543210',
        message: 'Server error test',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('HTTP 503: Failed to dispatch communication');
    });

    it('handles network error exception with Error instance', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce(null);

      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Connection timed out'));

      const res = await dispatchActionCenterCommunication({
        entityType: 'internal_task',
        entityId: 'tsk-4',
        channel: 'EMAIL',
        recipientEmail: 'timeout@example.com',
        message: 'Timeout test',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Connection timed out');
    });

    it('handles non-Error rejection exception gracefully', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce(null);

      global.fetch = jest.fn().mockRejectedValueOnce('Unknown crash');

      const res = await dispatchActionCenterCommunication({
        entityType: 'approval',
        entityId: 'appr-1',
        channel: 'EMAIL',
        recipientEmail: 'appr@example.com',
        message: 'Crash test',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Network error');
    });
  });

  describe('fetchActionCenterCommunications', () => {
    it('fetches records with formatted query parameters and returns items', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce('token-456');

      const mockItems = [
        {
          id: 'comm-1',
          accountId: 'tkt-1',
          accountType: 'ticket',
          channel: 'EMAIL',
          recipient: 'vendor@example.com',
          subject: 'Issue Update',
          message: 'Investigating issue',
          notificationStatus: 'Notification Sent',
          deliveryStatus: 'Delivered',
          acknowledgementStatus: 'Acknowledgement Pending',
          createdAt: '2026-11-01T10:00:00.000Z',
        },
      ];

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: mockItems,
          pagination: { total: 1, page: 2, pageSize: 15, totalPages: 1 },
        }),
      });

      const res = await fetchActionCenterCommunications({
        entityType: 'ticket',
        entityId: 'tkt-1',
        channel: 'EMAIL',
        page: 2,
        pageSize: 15,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/action-center/communications?entityType=ticket&entityId=tkt-1&channel=EMAIL&page=2&pageSize=15',
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token-456',
          },
        })
      );
      expect(res.items).toEqual(mockItems);
      expect(res.pagination.total).toBe(1);
      expect(res.pagination.page).toBe(2);
      expect(res.pagination.pageSize).toBe(15);
    });

    it('handles call without params and with fallback pagination metadata', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce(null);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: 'comm-2' }],
          // pagination omitted
        }),
      });

      const res = await fetchActionCenterCommunications();

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/action-center/communications?',
        expect.anything()
      );
      expect(res.items).toHaveLength(1);
      expect(res.pagination.total).toBe(1);
      expect(res.pagination.page).toBe(1);
      expect(res.pagination.pageSize).toBe(20);
    });

    it('handles empty response gracefully when items are missing', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce(null);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const res = await fetchActionCenterCommunications();

      expect(res.items).toEqual([]);
      expect(res.pagination.total).toBe(0);
    });

    it('handles HTTP error status safely by returning empty list', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce(null);

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const res = await fetchActionCenterCommunications({ entityId: 'tkt-err' });

      expect(res.items).toEqual([]);
      expect(res.pagination.total).toBe(0);
      expect(res.pagination.page).toBe(1);
    });

    it('handles network throw exception gracefully with non-Error', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValueOnce(null);

      global.fetch = jest.fn().mockRejectedValueOnce('Network dropped');

      const res = await fetchActionCenterCommunications();

      expect(res.items).toEqual([]);
      expect(res.pagination.total).toBe(0);
    });
  });
});


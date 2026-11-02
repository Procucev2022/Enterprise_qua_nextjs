import {
  fetchSupplierCreditHistory,
  fetchSupplierCommunications,
  recordSupplierCommunication,
  fetchSupplierPaymentHistory,
  updateSupplierCategories,
} from '@/lib/supplierProfileClient';
import supplierProfileClient from '@/lib/supplierProfileClient';
import { authClient } from '@/lib/authClient';

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

describe('supplierProfileClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    authClient.setSession({ id: 'u1', email: 'admin@test.com', role: 'admin' } as any, 'test-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    authClient.setSession(null, null);
    jest.restoreAllMocks();
  });

  describe('fetchSupplierCreditHistory', () => {
    test('fetches credit history successfully', async () => {
      const mockData = {
        success: true,
        summary: {
          totalCreditsAllocated: 15,
          totalCreditsConsumed: 3,
          remainingFreeCredits: 12,
          purchasedCredits: 0,
          adjustedCredits: 0,
          currentCreditBalance: 12,
          isSubscribed: true,
          subscriptionPlan: 'connect',
        },
        transactions: [],
      };
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(mockData));

      const res = await fetchSupplierCreditHistory('v-123');
      expect(res.success).toBe(true);
      expect(res.summary?.totalCreditsAllocated).toBe(15);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/v-123/credit-history',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      );
    });

    test('handles fetch rejection with error message', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      const res = await fetchSupplierCreditHistory('v-123');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Network error');
    });

    test('handles non-Error rejection with fallback message', async () => {
      global.fetch = jest.fn().mockRejectedValue('String rejection');
      const res = await fetchSupplierCreditHistory('v-123');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Failed to fetch credit history');
    });
  });

  describe('fetchSupplierCommunications', () => {
    test('fetches communications without channel query', async () => {
      const mockComms = [{ id: 'comm-1', recipient: 'v@test.com', message: 'Hi' }];
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: mockComms }));

      const res = await fetchSupplierCommunications('v-123');
      expect(res.success).toBe(true);
      expect(res.data).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledWith('/api/vendors/v-123/communications', expect.any(Object));
    });

    test('fetches communications with channel query', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }));

      const res = await fetchSupplierCommunications('v-123', 'EMAIL');
      expect(res.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('/api/vendors/v-123/communications?channel=EMAIL', expect.any(Object));
    });

    test('handles fetch failure for communications', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Comms unreachable'));
      const res = await fetchSupplierCommunications('v-123');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Comms unreachable');
    });

    test('handles non-Error rejection fallback for communications', async () => {
      global.fetch = jest.fn().mockRejectedValue(null);
      const res = await fetchSupplierCommunications('v-123');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Failed to fetch communications');
    });
  });

  describe('recordSupplierCommunication', () => {
    test('posts communication payload successfully', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, data: { id: 'rec-1' } }));

      const payload = { channel: 'WHATSAPP', message: 'Hello Supplier', recipient: '+919999999999' };
      const res = await recordSupplierCommunication('v-123', payload);

      expect(res.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/v-123/communications',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        })
      );
    });

    test('handles failure when recording communication', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Post failed'));
      const res = await recordSupplierCommunication('v-123', { channel: 'SMS', message: 'Test' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Post failed');
    });

    test('handles non-Error rejection fallback for recording communication', async () => {
      global.fetch = jest.fn().mockRejectedValue(404);
      const res = await recordSupplierCommunication('v-123', { channel: 'SMS', message: 'Test' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Failed to record communication');
    });
  });

  describe('fetchSupplierPaymentHistory', () => {
    test('fetches payment history successfully', async () => {
      const mockPayments = {
        success: true,
        summary: { totalAmountPaid: 5999, totalSuccessfulPayments: 1, pendingPayments: 0, failedPayments: 0, totalRefundedAmount: 0 },
        payments: [{ id: 'p-1', amount: 5999, status: 'PAID' }],
      };
      global.fetch = jest.fn().mockResolvedValue(jsonResponse(mockPayments));

      const res = await fetchSupplierPaymentHistory('v-123');
      expect(res.success).toBe(true);
      expect(res.summary?.totalAmountPaid).toBe(5999);
      expect(global.fetch).toHaveBeenCalledWith('/api/vendors/v-123/payment-history', expect.any(Object));
    });

    test('handles failure when loading payment history', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Payments error'));
      const res = await fetchSupplierPaymentHistory('v-123');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Payments error');
    });

    test('handles non-Error rejection fallback for payment history', async () => {
      global.fetch = jest.fn().mockRejectedValue({});
      const res = await fetchSupplierPaymentHistory('v-123');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Failed to fetch payment history');
    });
  });

  describe('updateSupplierCategories', () => {
    test('updates categories successfully', async () => {
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true, message: 'Updated' }));

      const res = await updateSupplierCategories('v-123', ['Industrial Goods', 'Electronics']);
      expect(res.success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/v-123/categories',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ categories: ['Industrial Goods', 'Electronics'] }),
        })
      );
    });

    test('handles failure when updating categories', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Update failed'));
      const res = await updateSupplierCategories('v-123', ['IT']);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Update failed');
    });

    test('handles non-Error rejection fallback for updating categories', async () => {
      global.fetch = jest.fn().mockRejectedValue(undefined);
      const res = await updateSupplierCategories('v-123', ['IT']);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Failed to update categories');
    });
  });

  describe('supplierProfileClient default export', () => {
    test('contains all expected methods', () => {
      expect(typeof supplierProfileClient.fetchSupplierCreditHistory).toBe('function');
      expect(typeof supplierProfileClient.fetchSupplierCommunications).toBe('function');
      expect(typeof supplierProfileClient.recordSupplierCommunication).toBe('function');
      expect(typeof supplierProfileClient.fetchSupplierPaymentHistory).toBe('function');
      expect(typeof supplierProfileClient.updateSupplierCategories).toBe('function');
    });

    test('authHeaders handles unauthenticated state', async () => {
      authClient.setSession(null, null);
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ success: true }));
      await supplierProfileClient.fetchSupplierCreditHistory('v-unauth');
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/v-unauth/credit-history',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });
  });
});

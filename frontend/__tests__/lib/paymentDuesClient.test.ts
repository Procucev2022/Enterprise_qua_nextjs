import {
  fetchPaymentDuesSummary,
  fetchPaymentDues,
  sendPaymentDuesEmail,
  sendPaymentDuesMessage,
  sendPaymentDuesWhatsApp,
  updatePaymentDuesAcknowledgement,
  fetchPaymentDuesHistory,
  getPaymentDuesExportUrl,
} from '@/lib/paymentDuesClient';
import { authClient } from '@/lib/authClient';

describe('paymentDuesClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authClient, 'getToken').mockReturnValue('mock-jwt-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('fetchPaymentDuesSummary', () => {
    it('returns summary when API responds with success', async () => {
      const mockSummary = {
        totalLowCreditAccounts: 10,
        totalBuyers: 6,
        totalSellers: 4,
        zeroCredits: 3,
        oneToTwoCredits: 7,
        acknowledgementPending: 2,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, summary: mockSummary }),
      });

      const res = await fetchPaymentDuesSummary();
      expect(res).toEqual(mockSummary);
      expect(global.fetch).toHaveBeenCalledWith('/api/payment-dues/summary', expect.any(Object));
    });

    it('returns fallback summary when fetch throws an error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const res = await fetchPaymentDuesSummary();
      expect(res.totalLowCreditAccounts).toBe(0);
      expect(res.zeroCredits).toBe(0);
    });

    it('returns fallback summary when response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const res = await fetchPaymentDuesSummary();
      expect(res.totalLowCreditAccounts).toBe(0);
    });
  });

  describe('fetchPaymentDues', () => {
    it('sends all filter query params and returns accounts list', async () => {
      const mockData = {
        accounts: [
          {
            accountId: 'acc-1',
            accountType: 'buyer',
            companyName: 'Acme',
            availableCredits: 1,
            acknowledgementStatus: 'Not Notified',
          },
        ],
        total: 1,
        summary: { totalLowCreditAccounts: 1, totalBuyers: 1, totalSellers: 0, zeroCredits: 0, oneToTwoCredits: 1, acknowledgementPending: 0 },
        page: 1,
        limit: 25,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockData,
      });

      const res = await fetchPaymentDues({
        search: 'Acme',
        accountType: 'buyer',
        credits: '1-2',
        acknowledgementStatus: 'Not Notified',
        accountStatus: 'Active',
        assignedExecutive: 'Devin',
        notificationChannel: 'email',
        sortBy: 'companyName',
        sortOrder: 'asc',
        page: 1,
        limit: 10,
      });

      expect(res.accounts.length).toBe(1);
      expect(res.total).toBe(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('search=Acme'),
        expect.any(Object)
      );
    });

    it('handles network failure gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

      const res = await fetchPaymentDues();
      expect(res.accounts).toEqual([]);
      expect(res.total).toBe(0);
    });
  });

  describe('sendPaymentDuesEmail', () => {
    it('dispatches POST /api/payment-dues/email and returns success', async () => {
      const mockComm = { id: 'comm-1', channel: 'email', recipient: 'buyer@acme.com' };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, communication: mockComm }),
      });

      const res = await sendPaymentDuesEmail({
        accountId: 'acc-1',
        accountType: 'buyer',
        recipientEmail: 'buyer@acme.com',
        subject: 'Low credits',
        message: 'Replenish now',
      });

      expect(res.success).toBe(true);
      expect(res.communication).toEqual(mockComm);
    });

    it('returns error when API responds with error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ success: false, error: 'Invalid email' }),
      });

      const res = await sendPaymentDuesEmail({
        accountId: 'acc-1',
        accountType: 'buyer',
        recipientEmail: 'invalid',
        subject: 'Low credits',
        message: 'Replenish now',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid email');
    });

    it('handles exceptions in fetch', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection failed'));

      const res = await sendPaymentDuesEmail({
        accountId: 'acc-1',
        accountType: 'buyer',
        recipientEmail: 'buyer@acme.com',
        subject: 'Low credits',
        message: 'Replenish now',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Connection failed');
    });
  });

  describe('sendPaymentDuesMessage', () => {
    it('dispatches in-app message successfully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, communication: { id: 'msg-1' } }),
      });

      const res = await sendPaymentDuesMessage({
        accountId: 'acc-1',
        accountType: 'buyer',
        message: 'Test in-app',
      });

      expect(res.success).toBe(true);
    });

    it('handles error in sendPaymentDuesMessage', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ success: false, error: 'Server error' }),
      });

      const res = await sendPaymentDuesMessage({
        accountId: 'acc-1',
        accountType: 'buyer',
        message: 'Test',
      });

      expect(res.success).toBe(false);
    });
  });

  describe('sendPaymentDuesWhatsApp', () => {
    it('dispatches WhatsApp notification and returns wa.me direct link', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          directLink: 'https://wa.me/919876543210?text=Hello',
          communication: { id: 'wa-1' },
        }),
      });

      const res = await sendPaymentDuesWhatsApp({
        accountId: 'acc-1',
        accountType: 'seller',
        phone: '9876543210',
        message: 'Hello',
      });

      expect(res.success).toBe(true);
      expect(res.directLink).toContain('wa.me');
    });

    it('handles exception in WhatsApp dispatch', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Timeout'));

      const res = await sendPaymentDuesWhatsApp({
        accountId: 'acc-1',
        accountType: 'seller',
        phone: '9876543210',
        message: 'Hello',
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Timeout');
    });
  });

  describe('updatePaymentDuesAcknowledgement', () => {
    it('updates status and returns updated communication', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          communication: { id: 'ack-1', acknowledgementStatus: 'Acknowledged' },
        }),
      });

      const res = await updatePaymentDuesAcknowledgement({
        accountId: 'acc-1',
        accountType: 'buyer',
        acknowledgementStatus: 'Acknowledged',
        notes: 'Confirmed by buyer',
      });

      expect(res.success).toBe(true);
      expect(res.communication?.acknowledgementStatus).toBe('Acknowledged');
    });

    it('handles error updating acknowledgement', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ success: false, error: 'Invalid status' }),
      });

      const res = await updatePaymentDuesAcknowledgement({
        accountId: 'acc-1',
        accountType: 'buyer',
        acknowledgementStatus: 'Failed',
      });

      expect(res.success).toBe(false);
    });
  });

  describe('fetchPaymentDuesHistory', () => {
    it('returns history list for account', async () => {
      const mockHistory = [{ id: 'hist-1', channel: 'email' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, history: mockHistory }),
      });

      const history = await fetchPaymentDuesHistory('acc-1');
      expect(history).toEqual(mockHistory);
    });

    it('returns empty array on error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Failed'));
      const history = await fetchPaymentDuesHistory('acc-1');
      expect(history).toEqual([]);
    });
  });

  describe('getPaymentDuesExportUrl', () => {
    it('builds export URL with query parameters', () => {
      const url = getPaymentDuesExportUrl({
        search: 'Tech',
        accountType: 'buyer',
        credits: '0',
        acknowledgementStatus: 'Acknowledged',
        accountStatus: 'Active',
        assignedExecutive: 'Devin',
        notificationChannel: 'email',
        sortBy: 'companyName',
        sortOrder: 'desc',
      });

      expect(url).toContain('/api/payment-dues/export?');
      expect(url).toContain('search=Tech');
      expect(url).toContain('accountType=buyer');
      expect(url).toContain('credits=0');
      expect(url).toContain('sortBy=companyName');
    });

    it('builds export URL with default empty parameters and ignores "all"', () => {
      const url = getPaymentDuesExportUrl({
        accountType: 'all',
        credits: 'all',
        acknowledgementStatus: 'all',
      });
      expect(url).toBe('/api/payment-dues/export?');
    });

    it('authHeaders omits Authorization header when token is not present', async () => {
      jest.spyOn(authClient, 'getToken').mockReturnValue(null as any);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, summary: {} }),
      });
      await fetchPaymentDuesSummary();
      expect(global.fetch).toHaveBeenCalledWith('/api/payment-dues/summary', {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    it('handles non-Error thrown in sendPaymentDuesEmail and error fallback when json.error is missing', async () => {
      global.fetch = jest.fn().mockRejectedValue('String network error');
      const res = await sendPaymentDuesEmail({
        accountId: 'acc-1',
        accountType: 'buyer',
        recipientEmail: 'test@example.com',
        subject: 'Sub',
        message: 'Msg',
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Network error');

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ success: false }),
      });
      const res502 = await sendPaymentDuesEmail({
        accountId: 'acc-1',
        accountType: 'buyer',
        recipientEmail: 'test@example.com',
        subject: 'Sub',
        message: 'Msg',
      });
      expect(res502.success).toBe(false);
      expect(res502.error).toBe('HTTP 502');
    });

    it('handles non-Error thrown in sendPaymentDuesMessage and sendPaymentDuesWhatsApp', async () => {
      global.fetch = jest.fn().mockRejectedValue('String error');
      const resMsg = await sendPaymentDuesMessage({
        accountId: 'acc-1',
        accountType: 'buyer',
        message: 'Msg',
      });
      expect(resMsg.error).toBe('Network error');

      const resWA = await sendPaymentDuesWhatsApp({
        accountId: 'acc-1',
        accountType: 'seller',
        phone: '12345678',
        message: 'Msg',
      });
      expect(resWA.error).toBe('Network error');

      const resAck = await updatePaymentDuesAcknowledgement({
        accountId: 'acc-1',
        accountType: 'buyer',
        acknowledgementStatus: 'Acknowledged',
      });
      expect(resAck.error).toBe('Network error');
    });


    it('covers all fallback branches in fetchPaymentDues, fetchPaymentDuesSummary, and history', async () => {
      // 1. fetchPaymentDuesSummary when json.summary is null
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, summary: null }),
      });
      const s = await fetchPaymentDuesSummary();
      expect(s.totalLowCreditAccounts).toBe(0);

      // 2. fetchPaymentDues when response is !ok
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });
      const dError = await fetchPaymentDues();
      expect(dError.accounts).toEqual([]);

      // 3. fetchPaymentDues when json fields are missing
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      const dEmpty = await fetchPaymentDues();
      expect(dEmpty.accounts).toEqual([]);
      expect(dEmpty.page).toBe(1);
      expect(dEmpty.limit).toBe(25);

      // 4. fetchPaymentDuesHistory when res is !ok
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      const hError = await fetchPaymentDuesHistory('acc-not-found');
      expect(hError).toEqual([]);

      // 5. fetchPaymentDuesHistory when json.history is missing
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      const hEmpty = await fetchPaymentDuesHistory('acc-empty');
      expect(hEmpty).toEqual([]);

      // 6. getPaymentDuesExportUrl with default arguments
      const exportUrl = getPaymentDuesExportUrl();
      expect(exportUrl).toBe('/api/payment-dues/export?');

      // 7. sendPaymentDuesMessage and WhatsApp when res is !ok without error text
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ success: false }),
      });
      const msgRes = await sendPaymentDuesMessage({
        accountId: 'acc-1',
        accountType: 'buyer',
        message: 'Notice',
      });
      expect(msgRes.error).toBe('HTTP 503');

      const waRes = await sendPaymentDuesWhatsApp({
        accountId: 'acc-1',
        accountType: 'seller',
        phone: '12345678',
        message: 'Notice',
      });
      expect(waRes.error).toBe('HTTP 503');

      const ackRes = await updatePaymentDuesAcknowledgement({
        accountId: 'acc-1',
        accountType: 'buyer',
        acknowledgementStatus: 'Acknowledged',
      });
      expect(ackRes.error).toBe('HTTP 503');
    });

  });
});

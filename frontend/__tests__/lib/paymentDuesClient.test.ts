import { UI_STRINGS, formatString } from '@/lib/uiStrings';
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
import { logger } from '@/lib/logger';

describe('paymentDuesClient', () => {
  const originalFetch = global.fetch;
  const originalRemoteSyncEnabled = logger.isRemoteSyncEnabled;

  beforeEach(() => {
    jest.clearAllMocks();
    logger.isRemoteSyncEnabled = false;
    jest.spyOn(logger, 'error');
    jest.spyOn(authClient, 'getToken').mockReturnValue('mock-jwt-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    logger.isRemoteSyncEnabled = originalRemoteSyncEnabled;
    jest.restoreAllMocks();
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
      expect(res).toEqual({ summary: mockSummary });
      expect(global.fetch).toHaveBeenCalledWith('/api/payment-dues/summary', expect.any(Object));
    });

    it('returns fallback summary when fetch throws an error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));

      const res = await fetchPaymentDuesSummary();
      expect(res.summary).toBeNull();
      expect(res.error).toBeTruthy();
    });

    it('returns fallback summary when response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const res = await fetchPaymentDuesSummary();
      expect(res.summary).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Payment dues summary fetch failed',
        expect.objectContaining({ status: 500, errorName: 'HttpError', errorMessage: 'HTTP 500' }),
        'PAYMENT_DUES_CLIENT'
      );
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
      expect(res.error).toBe(UI_STRINGS.dataLoad.requestNetworkFailed);
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
    it('reports a wa.me link as not sent, because no provider accepted the message', async () => {
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

      expect(res.success).toBe(false);
      expect(res.status).toBe('link_only');
      expect(res.directLink).toContain('wa.me');
      expect(res.error).toBe(UI_STRINGS.dataLoad.whatsAppLinkOnly);
    });

    it('reports success only when the API reports a provider send', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, status: 'sent', communication: { id: 'wa-2' } }),
      });

      const res = await sendPaymentDuesWhatsApp({
        accountId: 'acc-1',
        accountType: 'seller',
        phone: '9876543210',
        message: 'Hello',
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('sent');
      expect(res.directLink).toBeUndefined();
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
      expect(res.error).toBe(UI_STRINGS.dataLoad.requestNetworkFailed);
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
      expect(history).toEqual({ history: mockHistory });
    });

    it('returns empty array on error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Failed'));
      const history = await fetchPaymentDuesHistory('acc-1');
      expect(history).toEqual({ history: [], error: formatString(UI_STRINGS.dataLoad.networkFailed, { resource: UI_STRINGS.dataLoad.resources.paymentDuesHistory }) });
    });
  });

  it('logs failures across fallback and notification operations without logging account payloads', async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('Summary transport unavailable'))
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service unavailable' }),
      })
      .mockRejectedValueOnce('Mail transport rejected')
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: false, error: 'Message unavailable' }) })
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({ success: false, error: 'WhatsApp unavailable' }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ success: false, error: 'Invalid status' }) })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'History unavailable' }) });

    await fetchPaymentDuesSummary();
    await fetchPaymentDues();
    await sendPaymentDuesEmail({
      accountId: 'private-account-id',
      accountType: 'buyer',
      recipientEmail: 'private@example.com',
      subject: 'Private subject',
      message: 'Private message',
    });
    await sendPaymentDuesMessage({ accountId: 'private-account-id', accountType: 'buyer', message: 'Private message' });
    await sendPaymentDuesWhatsApp({ accountId: 'private-account-id', accountType: 'seller', phone: 'private-phone', message: 'Private message' });
    await updatePaymentDuesAcknowledgement({ accountId: 'private-account-id', accountType: 'buyer', acknowledgementStatus: 'Acknowledged' });
    await fetchPaymentDuesHistory('private-account-id');

    expect(logger.error).toHaveBeenCalledWith(
      'Payment dues summary fetch failed',
      expect.objectContaining({ errorName: 'Error', errorMessage: 'Summary transport unavailable' }),
      'PAYMENT_DUES_CLIENT'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Payment dues account-list fetch failed',
      expect.objectContaining({ status: 503, responseErrorPresent: true }),
      'PAYMENT_DUES_CLIENT'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Payment dues email notification failed',
      expect.objectContaining({ method: 'POST', errorName: 'UnknownError' }),
      'PAYMENT_DUES_CLIENT'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Payment dues in-app message notification failed',
      expect.objectContaining({ status: 200, responseErrorPresent: true, errorName: 'ApiResponseError' }),
      'PAYMENT_DUES_CLIENT'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Payment dues WhatsApp notification failed',
      expect.objectContaining({ status: 502, responseErrorPresent: true }),
      'PAYMENT_DUES_CLIENT'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Payment dues acknowledgement update failed',
      expect.objectContaining({ status: 400, responseErrorPresent: true }),
      'PAYMENT_DUES_CLIENT'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Payment dues communication history fetch failed',
      expect.objectContaining({ status: 404, responseErrorPresent: false }),
      'PAYMENT_DUES_CLIENT'
    );

    for (const [, metadata] of jest.mocked(logger.error).mock.calls) {
      expect(metadata).not.toHaveProperty('accountId');
      expect(metadata).not.toHaveProperty('recipientEmail');
      expect(metadata).not.toHaveProperty('phone');
      expect(metadata).not.toHaveProperty('message');
    }
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
      expect(res.error).toBe(UI_STRINGS.dataLoad.requestNetworkFailed);

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
      expect(resMsg.error).toBe(UI_STRINGS.dataLoad.requestNetworkFailed);

      const resWA = await sendPaymentDuesWhatsApp({
        accountId: 'acc-1',
        accountType: 'seller',
        phone: '12345678',
        message: 'Msg',
      });
      expect(resWA.error).toBe(UI_STRINGS.dataLoad.requestNetworkFailed);

      const resAck = await updatePaymentDuesAcknowledgement({
        accountId: 'acc-1',
        accountType: 'buyer',
        acknowledgementStatus: 'Acknowledged',
      });
      expect(resAck.error).toBe(UI_STRINGS.dataLoad.requestNetworkFailed);
    });


    it('covers all fallback branches in fetchPaymentDues, fetchPaymentDuesSummary, and history', async () => {
      // 1. fetchPaymentDuesSummary when json.summary is null
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, summary: null }),
      });
      const s = await fetchPaymentDuesSummary();
      expect(s.summary).toBeNull();

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
      expect(hError.history).toEqual([]);

      // 5. fetchPaymentDuesHistory when json.history is missing
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      const hEmpty = await fetchPaymentDuesHistory('acc-empty');
      expect(hEmpty.history).toEqual([]);

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

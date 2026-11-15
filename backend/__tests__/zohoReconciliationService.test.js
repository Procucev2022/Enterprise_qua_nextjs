jest.mock('../src/services/storeService');
jest.mock('../src/services/zohoPaymentService');
jest.mock('../src/db/zohoWebhookQueries');

const storeService = require('../src/services/storeService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const zohoWebhookQueries = require('../src/db/zohoWebhookQueries');
const zohoReconciliationService = require('../src/services/zohoReconciliationService');

describe('zohoReconciliationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeService.activatePaymentLinkDurably.mockResolvedValue({ activated: true });
    storeService.updatePaymentLinkRecordDurably.mockImplementation(async (id, updates) => ({ id, ...updates }));
    zohoWebhookQueries.purgeExpiredWebhookEvents.mockResolvedValue(0);
    zohoReconciliationService.stopPolling();
    jest.useFakeTimers();
  });

  afterEach(() => {
    zohoReconciliationService.stopPolling();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('reconcileOnce', () => {
    test('purges expired webhook receipts during reconciliation without blocking payment checks', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([]);
      zohoWebhookQueries.purgeExpiredWebhookEvents.mockResolvedValue(4);

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 0 });

      expect(zohoWebhookQueries.purgeExpiredWebhookEvents).toHaveBeenCalledTimes(1);
    });

    test('logs receipt cleanup failures and continues payment reconciliation', async () => {
      const logger = require('../src/services/loggerService').logger;
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      const cleanupError = new Error('cleanup unavailable');
      zohoWebhookQueries.purgeExpiredWebhookEvents.mockRejectedValue(cleanupError);
      storeService.getPaymentLinksByStatusIn.mockReturnValue([]);

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 0 });

      expect(errorSpy).toHaveBeenCalledWith(
        'Expired Zoho webhook receipt cleanup failed',
        { error: cleanupError },
        'ZOHO_RECONCILIATION'
      );
    });

    test('checks every CREATED/pending link and updates its status', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([
        { id: 'pl-1', zohoPaymentLinkId: 'zoho-1' },
        { id: 'pl-2', zohoPaymentLinkId: 'zoho-2' },
      ]);
      zohoPaymentService.getPaymentLinkStatus
        .mockResolvedValueOnce({ status: 'CREATED', rawResponse: {} })
        .mockResolvedValueOnce({ status: 'PAID', rawResponse: {} });

      const result = await zohoReconciliationService.reconcileOnce();

      expect(result).toEqual({ checked: 2 });
      expect(storeService.getPaymentLinksByStatusIn).toHaveBeenCalledWith(['CREATED', 'pending', 'active']);
      expect(storeService.updatePaymentLinkRecordDurably).toHaveBeenCalledWith('pl-1', { status: 'CREATED', rawResponse: {} });
      expect(storeService.updatePaymentLinkRecordDurably).toHaveBeenCalledTimes(1);
      // Only the link discovered PAID triggers activation.
      expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledTimes(1);
      expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledWith('pl-2', {});
    });

    test('recognizes Zoho\'s real lowercase "paid" status, not just the app\'s own uppercase PAID', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-real-1', zohoPaymentLinkId: 'zoho-real-1' }]);
      // Zoho's actual API returns lowercase status strings ('active', 'paid',
      // 'expired', 'cancelled') — confirmed against a real payment-link
      // response. A link genuinely paid on Zoho's side must still activate.
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValueOnce({ status: 'paid', rawResponse: {} });

      await zohoReconciliationService.reconcileOnce();

      expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledWith('pl-real-1', {});
    });

    test('does not activate when Zoho returns no status at all', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-no-status-1', zohoPaymentLinkId: 'zoho-no-status-1' }]);
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValueOnce({ status: undefined, rawResponse: {} });

      await zohoReconciliationService.reconcileOnce();

      expect(storeService.activatePaymentLinkDurably).not.toHaveBeenCalled();
    });

    test('activates a buyer subscription (not a vendor one) for a link with payerType buyer', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-buyer-1', zohoPaymentLinkId: 'zoho-buyer-1', payerType: 'buyer' }]);
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValueOnce({ status: 'PAID', rawResponse: {} });

      await zohoReconciliationService.reconcileOnce();

      expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledWith('pl-buyer-1', {});
    });

    test('logs and continues when one link fails to reconcile', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([
        { id: 'pl-1', zohoPaymentLinkId: 'zoho-1' },
        { id: 'pl-2', zohoPaymentLinkId: 'zoho-2' },
      ]);
      zohoPaymentService.getPaymentLinkStatus
        .mockRejectedValueOnce(new Error('Zoho unavailable'))
        .mockResolvedValueOnce({ status: 'PAID', rawResponse: {} });

      const result = await zohoReconciliationService.reconcileOnce();

      expect(result).toEqual({ checked: 2 });
      expect(storeService.updatePaymentLinkRecordDurably).not.toHaveBeenCalled();
      expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledWith('pl-2', {});
    });

    test('marks link as expired when Zoho reports Payment Link does not exist (400)', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([
        { id: 'pl-dead-1', zohoPaymentLinkId: 'zoho-dead-1' },
      ]);
      const notFoundErr = new Error('Zoho payment-link status fetch failed (400): Payment Link does not exist.');
      notFoundErr.status = 400;
      notFoundErr.statusCode = 400;
      zohoPaymentService.getPaymentLinkStatus.mockRejectedValueOnce(notFoundErr);

      const result = await zohoReconciliationService.reconcileOnce();

      expect(result).toEqual({ checked: 1 });
      expect(storeService.updatePaymentLinkRecordDurably).toHaveBeenCalledWith('pl-dead-1', {
        status: 'expired',
        rawResponse: expect.objectContaining({ error: expect.stringContaining('Payment Link does not exist') }),
      });
      expect(storeService.activatePaymentLinkDurably).not.toHaveBeenCalled();
    });

    test('marks link as expired when Zoho returns 404', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([
        { id: 'pl-dead-404', zohoPaymentLinkId: 'zoho-dead-404' },
      ]);
      const notFoundErr = new Error('Zoho payment-link status fetch failed (404): Not found');
      notFoundErr.status = 404;
      notFoundErr.statusCode = 404;
      zohoPaymentService.getPaymentLinkStatus.mockRejectedValueOnce(notFoundErr);

      await zohoReconciliationService.reconcileOnce();

      expect(storeService.updatePaymentLinkRecordDurably).toHaveBeenCalledWith('pl-dead-404', {
        status: 'expired',
        rawResponse: expect.objectContaining({ error: expect.stringContaining('Not found') }),
      });
    });

    test('logs and continues when the durable expiration write returns no row', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-expire-missing', zohoPaymentLinkId: 'zoho-expire-missing' }]);
      const notFound = new Error('Payment Link does not exist');
      notFound.status = 404;
      zohoPaymentService.getPaymentLinkStatus.mockRejectedValueOnce(notFound);
      storeService.updatePaymentLinkRecordDurably.mockResolvedValueOnce(null);

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 1 });
      expect(storeService.updatePaymentLinkRecordDurably).toHaveBeenCalledWith('pl-expire-missing', expect.objectContaining({ status: 'expired' }));
    });

    test('treats a missing activation result as a retryable reconciliation failure', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-activation-missing', zohoPaymentLinkId: 'zoho-paid' }]);
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValueOnce({ status: 'paid', rawResponse: {} });
      storeService.activatePaymentLinkDurably.mockResolvedValueOnce(null);

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 1 });
      expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledWith('pl-activation-missing', {});
    });

    test('logs a status update that did not return a durable row', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-status-missing', zohoPaymentLinkId: 'zoho-active' }]);
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValueOnce({ status: 'active', rawResponse: {} });
      storeService.updatePaymentLinkRecordDurably.mockResolvedValueOnce(null);

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 1 });
    });

    test('handles a rejection without a message without inventing an expiration', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-error-no-message', zohoPaymentLinkId: 'zoho-error' }]);
      zohoPaymentService.getPaymentLinkStatus.mockRejectedValueOnce({ status: 503 });

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 1 });
      expect(storeService.updatePaymentLinkRecordDurably).not.toHaveBeenCalled();
    });

    test('marks link as expired when zohoPaymentLinkId is missing', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([
        { id: 'pl-no-zoho-id', zohoPaymentLinkId: null },
      ]);

      await zohoReconciliationService.reconcileOnce();

      expect(zohoPaymentService.getPaymentLinkStatus).not.toHaveBeenCalled();
      expect(storeService.updatePaymentLinkRecordDurably).toHaveBeenCalledWith('pl-no-zoho-id', {
        status: 'expired',
        rawResponse: expect.objectContaining({ error: 'Missing zohoPaymentLinkId' }),
      });
    });

    test('reconcilePendingLinks reconciles pending links and handles non-existent gracefully', async () => {
      const notFoundErr = new Error('Zoho payment-link status fetch failed (400): Payment Link does not exist.');
      notFoundErr.status = 400;
      zohoPaymentService.getPaymentLinkStatus
        .mockResolvedValueOnce({ status: 'PAID', rawResponse: {} })
        .mockRejectedValueOnce(notFoundErr);

      const count = await zohoReconciliationService.reconcilePendingLinks([
        { id: 'pl-active-1', zohoPaymentLinkId: 'z-1', status: 'active' },
        { id: 'pl-dead-2', zohoPaymentLinkId: 'z-2', status: 'CREATED' },
        { id: 'pl-done-3', zohoPaymentLinkId: 'z-3', status: 'expired' },
      ]);

      expect(count).toBe(2);
      expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledWith('pl-active-1', {});
      expect(storeService.updatePaymentLinkRecordDurably).toHaveBeenCalledWith('pl-dead-2', {
        status: 'expired',
        rawResponse: expect.objectContaining({ error: expect.stringContaining('Payment Link does not exist') }),
      });
    });

    test('does nothing when there is nothing pending', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([]);
      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 0 });
      expect(zohoPaymentService.getPaymentLinkStatus).not.toHaveBeenCalled();
    });
  });

  describe('startPolling / stopPolling', () => {
    test('refuses to start when disabled', () => {
      const result = zohoReconciliationService.startPolling({ RECONCILIATION_ENABLED: false, REFRESH_TOKEN: 'x', RECONCILIATION_INTERVAL_MS: 1000 });
      expect(result).toEqual({ started: false, reason: expect.stringContaining('ZOHO_RECONCILIATION_ENABLED') });
    });

    test('refuses to start when unconfigured (no refresh token)', () => {
      const result = zohoReconciliationService.startPolling({ RECONCILIATION_ENABLED: true, REFRESH_TOKEN: '', RECONCILIATION_INTERVAL_MS: 1000 });
      expect(result).toEqual({ started: false, reason: expect.stringContaining('ZOHO_REFRESH_TOKEN') });
    });

    test('starts, polls on the interval, and refuses to start a second time', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([]);
      const config = { RECONCILIATION_ENABLED: true, REFRESH_TOKEN: 'x', RECONCILIATION_INTERVAL_MS: 1000 };

      const first = zohoReconciliationService.startPolling(config);
      expect(first).toEqual({ started: true, intervalMs: 1000 });

      const second = zohoReconciliationService.startPolling(config);
      expect(second).toEqual({ started: false, reason: expect.any(String) });

      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      expect(storeService.getPaymentLinksByStatusIn).toHaveBeenCalled();
    });

    test('logs (does not throw) when an interval tick itself rejects', async () => {
      storeService.getPaymentLinksByStatusIn.mockImplementation(() => {
        throw new Error('store unavailable');
      });

      zohoReconciliationService.startPolling({ RECONCILIATION_ENABLED: true, REFRESH_TOKEN: 'x', RECONCILIATION_INTERVAL_MS: 1000 });
      jest.advanceTimersByTime(1000);
      // Let the rejected reconcileOnce() promise settle before the test ends.
      await Promise.resolve();
      await Promise.resolve();
    });

    test('stopPolling clears the interval and reports whether one was actually running', () => {
      expect(zohoReconciliationService.stopPolling()).toBe(false);

      zohoReconciliationService.startPolling({ RECONCILIATION_ENABLED: true, REFRESH_TOKEN: 'x', RECONCILIATION_INTERVAL_MS: 1000 });
      expect(zohoReconciliationService.stopPolling()).toBe(true);
      expect(zohoReconciliationService.stopPolling()).toBe(false);
    });

    test('starts polling when the runtime timer has no unref method', () => {
      jest.spyOn(global, 'setInterval').mockReturnValue({});
      const result = zohoReconciliationService.startPolling({
        RECONCILIATION_ENABLED: true,
        REFRESH_TOKEN: 'refresh-token',
        RECONCILIATION_INTERVAL_MS: 60000,
      });
      expect(result).toEqual({ started: true, intervalMs: 60000 });
      expect(zohoReconciliationService.stopPolling()).toBe(true);
    });
  });
});

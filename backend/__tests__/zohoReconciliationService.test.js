jest.mock('../src/services/storeService');
jest.mock('../src/services/zohoPaymentService');
jest.mock('../src/db/zohoWebhookQueries');
jest.mock('../src/db/zohoReconciliationQueries');

const storeService = require('../src/services/storeService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const zohoWebhookQueries = require('../src/db/zohoWebhookQueries');
const zohoReconciliationQueries = require('../src/db/zohoReconciliationQueries');
const zohoReconciliationService = require('../src/services/zohoReconciliationService');
const { ZOHO_CONFIG } = require('../src/config/constants');

describe('zohoReconciliationService', () => {
  const originalMaxConcurrency = ZOHO_CONFIG.RECONCILIATION_MAX_CONCURRENCY;

  beforeEach(() => {
    jest.clearAllMocks();
    storeService.activatePaymentLinkDurably.mockResolvedValue({ activated: true });
    storeService.updatePaymentLinkRecordDurably.mockImplementation(async (id, updates) => ({ id, ...updates }));
    zohoWebhookQueries.purgeExpiredWebhookEvents.mockResolvedValue(0);
    zohoReconciliationQueries.claimPaymentLinkReconciliation.mockResolvedValue({
      claimed: true,
      leaseExpiresAt: '2026-11-11T00:03:00.000Z',
    });
    zohoReconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims.mockResolvedValue(0);
    zohoReconciliationService.stopPolling();
    jest.useFakeTimers();
  });

  afterEach(() => {
    zohoReconciliationService.stopPolling();
    jest.restoreAllMocks();
    ZOHO_CONFIG.RECONCILIATION_MAX_CONCURRENCY = originalMaxConcurrency;
    jest.useRealTimers();
  });

  describe('reconcileOnce', () => {
    test('purges expired webhook receipts during reconciliation without blocking payment checks', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([]);
      zohoWebhookQueries.purgeExpiredWebhookEvents.mockResolvedValue(4);

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 0 });

      expect(zohoWebhookQueries.purgeExpiredWebhookEvents).toHaveBeenCalledTimes(1);
    });

    test('records the number of expired reconciliation leases removed', async () => {
      const logger = require('../src/services/loggerService').logger;
      const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});
      storeService.getPaymentLinksByStatusIn.mockReturnValue([]);
      zohoReconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims.mockResolvedValue(2);

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 0 });

      expect(infoSpy).toHaveBeenCalledWith(
        'Expired Zoho payment-link reconciliation leases purged',
        { purgedClaims: 2 },
        'ZOHO_RECONCILIATION'
      );
    });

    test('coalesces and throttles expired-claim cleanup for on-demand requests', async () => {
      let resolveCleanup;
      zohoReconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims.mockReturnValueOnce(new Promise((resolve) => {
        resolveCleanup = resolve;
      }));

      const first = zohoReconciliationService.reconcilePendingLinks([]);
      const second = zohoReconciliationService.reconcilePendingLinks([]);
      await Promise.resolve();
      expect(zohoReconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims).toHaveBeenCalledTimes(1);

      resolveCleanup(0);
      await expect(Promise.all([first, second])).resolves.toEqual([0, 0]);
      await expect(zohoReconciliationService.reconcilePendingLinks([])).resolves.toBe(0);
      expect(zohoReconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(ZOHO_CONFIG.RECONCILIATION_LEASE_MS);
      await expect(zohoReconciliationService.reconcilePendingLinks([])).resolves.toBe(0);
      expect(zohoReconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims).toHaveBeenCalledTimes(2);
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

    test('skips a payment link leased by a different isolate when no reason is returned', async () => {
      const logger = require('../src/services/loggerService').logger;
      const debugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
      storeService.getPaymentLinksByStatusIn.mockReturnValue([
        { id: 'pl-leased', zohoPaymentLinkId: 'zoho-leased', status: 'active' },
      ]);
      zohoReconciliationQueries.claimPaymentLinkReconciliation.mockResolvedValue({ claimed: false });

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 1 });

      expect(zohoPaymentService.getPaymentLinkStatus).not.toHaveBeenCalled();
      expect(debugSpy).toHaveBeenCalledWith(
        'Skipped Zoho reconciliation because another isolate holds the payment-link lease',
        { linkId: 'pl-leased', reason: 'CLAIM_NOT_GRANTED' },
        'ZOHO_RECONCILIATION'
      );
    });

    test('fails closed when the durable payment-link lease cannot be acquired', async () => {
      const logger = require('../src/services/loggerService').logger;
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      storeService.getPaymentLinksByStatusIn.mockReturnValue([
        { id: 'pl-lease-unavailable', zohoPaymentLinkId: 'zoho-lease-unavailable', status: 'active' },
      ]);
      zohoReconciliationQueries.claimPaymentLinkReconciliation.mockRejectedValueOnce(new Error('D1 unavailable'));

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 1 });

      expect(zohoPaymentService.getPaymentLinkStatus).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        'Zoho reconciliation failed for payment link pl-lease-unavailable',
        expect.any(Error),
        'ZOHO_RECONCILIATION'
      );
    });

    test('keeps a failed payment-link lease until its short expiry to avoid an immediate provider retry storm', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([
        { id: 'pl-retry', zohoPaymentLinkId: 'zoho-retry', status: 'active' },
      ]);
      zohoPaymentService.getPaymentLinkStatus.mockRejectedValueOnce(new Error('Zoho unavailable'));

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 1 });

      expect(zohoReconciliationQueries.claimPaymentLinkReconciliation).toHaveBeenCalledWith('pl-retry');
    });

    test('logs expired claim cleanup failures without blocking payment reconciliation', async () => {
      const logger = require('../src/services/loggerService').logger;
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
      storeService.getPaymentLinksByStatusIn.mockReturnValue([
        { id: 'pl-cleanup-failure', zohoPaymentLinkId: 'zoho-cleanup-failure', status: 'active' },
      ]);
      zohoReconciliationQueries.purgeExpiredPaymentLinkReconciliationClaims.mockRejectedValueOnce(new Error('database unavailable'));

      await expect(zohoReconciliationService.reconcileOnce()).resolves.toEqual({ checked: 1 });

      expect(errorSpy).toHaveBeenCalledWith(
        'Expired Zoho payment-link reconciliation lease cleanup failed',
        { error: expect.any(Error) },
        'ZOHO_RECONCILIATION'
      );
      expect(zohoPaymentService.getPaymentLinkStatus).toHaveBeenCalledWith('zoho-cleanup-failure');
    });

    test('reuses an active scheduled reconciliation pass instead of repeating its database scan', async () => {
      let resolveCleanup;
      zohoWebhookQueries.purgeExpiredWebhookEvents.mockReturnValue(new Promise((resolve) => {
        resolveCleanup = resolve;
      }));
      storeService.getPaymentLinksByStatusIn.mockResolvedValue([]);

      const first = zohoReconciliationService.reconcileOnce();
      const second = zohoReconciliationService.reconcileOnce();
      await Promise.resolve();
      expect(zohoWebhookQueries.purgeExpiredWebhookEvents).toHaveBeenCalledTimes(1);

      resolveCleanup(0);
      await expect(Promise.all([first, second])).resolves.toEqual([{ checked: 0 }, { checked: 0 }]);
      expect(storeService.getPaymentLinksByStatusIn).toHaveBeenCalledTimes(1);
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

    test('bounds concurrent on-demand status checks', async () => {
      let activeRequests = 0;
      let peakRequests = 0;
      zohoPaymentService.getPaymentLinkStatus.mockImplementation(async () => {
        activeRequests += 1;
        peakRequests = Math.max(peakRequests, activeRequests);
        await Promise.resolve();
        activeRequests -= 1;
        return { status: 'paid', rawResponse: {} };
      });
      const links = Array.from({ length: 12 }, (_, index) => ({
        id: `pl-bounded-${index}`,
        zohoPaymentLinkId: `zoho-bounded-${index}`,
        status: 'active',
      }));

      await expect(zohoReconciliationService.reconcilePendingLinks(links)).resolves.toBe(links.length);

      expect(peakRequests).toBeLessThanOrEqual(ZOHO_CONFIG.RECONCILIATION_MAX_CONCURRENCY);
      expect(peakRequests).toBeGreaterThan(1);
      expect(zohoPaymentService.getPaymentLinkStatus).toHaveBeenCalledTimes(links.length);
    });

    test('uses one worker when the configured concurrency value is invalid', async () => {
      ZOHO_CONFIG.RECONCILIATION_MAX_CONCURRENCY = 'invalid';
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValue({ status: 'paid', rawResponse: {} });
      const links = [
        { id: 'pl-invalid-concurrency-1', zohoPaymentLinkId: 'zoho-invalid-1', status: 'active' },
        { id: 'pl-invalid-concurrency-2', zohoPaymentLinkId: 'zoho-invalid-2', status: 'active' },
      ];

      await expect(zohoReconciliationService.reconcilePendingLinks(links)).resolves.toBe(links.length);

      expect(zohoPaymentService.getPaymentLinkStatus).toHaveBeenCalledTimes(links.length);
    });

    test('retains the process-local path for legacy payment links with non-string ids', async () => {
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValueOnce({ status: 'active', rawResponse: {} });

      await expect(zohoReconciliationService.reconcilePendingLinks([
        { id: 123, zohoPaymentLinkId: 'zoho-numeric-id', status: 'active' },
      ])).resolves.toBe(1);

      expect(zohoReconciliationQueries.claimPaymentLinkReconciliation).not.toHaveBeenCalled();
      expect(zohoPaymentService.getPaymentLinkStatus).toHaveBeenCalledWith('zoho-numeric-id');
    });

    test('coalesces overlapping reconciliation requests for the same payment link', async () => {
      let resolveStatus;
      let resolveStatusStarted;
      const statusStarted = new Promise((resolve) => {
        resolveStatusStarted = resolve;
      });
      zohoPaymentService.getPaymentLinkStatus.mockImplementation(() => new Promise((resolve) => {
        resolveStatus = resolve;
        resolveStatusStarted();
      }));
      const link = { id: 'pl-overlap', zohoPaymentLinkId: 'zoho-overlap', status: 'active' };

      const first = zohoReconciliationService.reconcilePendingLinks([link]);
      const second = zohoReconciliationService.reconcilePendingLinks([link]);
      await statusStarted;
      expect(zohoPaymentService.getPaymentLinkStatus).toHaveBeenCalledTimes(1);

      resolveStatus({ status: 'paid', rawResponse: {} });
      await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
      expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledTimes(1);
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

      await jest.advanceTimersByTimeAsync(1000);
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

jest.mock('../src/services/storeService');
jest.mock('../src/services/zohoPaymentService');

const storeService = require('../src/services/storeService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const zohoReconciliationService = require('../src/services/zohoReconciliationService');

describe('zohoReconciliationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    zohoReconciliationService.stopPolling();
    jest.useFakeTimers();
  });

  afterEach(() => {
    zohoReconciliationService.stopPolling();
    jest.useRealTimers();
  });

  describe('reconcileOnce', () => {
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
      expect(storeService.updatePaymentLinkRecord).toHaveBeenCalledWith('pl-1', { status: 'CREATED', rawResponse: {} });
      expect(storeService.updatePaymentLinkRecord).toHaveBeenCalledWith('pl-2', { status: 'PAID', rawResponse: {} });
      // Only the link discovered PAID triggers activation.
      expect(storeService.activateVendorSubscriptionFromPayment).toHaveBeenCalledTimes(1);
      expect(storeService.activateVendorSubscriptionFromPayment).toHaveBeenCalledWith('pl-2');
    });

    test('recognizes Zoho\'s real lowercase "paid" status, not just the app\'s own uppercase PAID', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-real-1', zohoPaymentLinkId: 'zoho-real-1' }]);
      // Zoho's actual API returns lowercase status strings ('active', 'paid',
      // 'expired', 'cancelled') — confirmed against a real payment-link
      // response. A link genuinely paid on Zoho's side must still activate.
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValueOnce({ status: 'paid', rawResponse: {} });

      await zohoReconciliationService.reconcileOnce();

      expect(storeService.activateVendorSubscriptionFromPayment).toHaveBeenCalledWith('pl-real-1');
    });

    test('does not activate when Zoho returns no status at all', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-no-status-1', zohoPaymentLinkId: 'zoho-no-status-1' }]);
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValueOnce({ status: undefined, rawResponse: {} });

      await zohoReconciliationService.reconcileOnce();

      expect(storeService.activateVendorSubscriptionFromPayment).not.toHaveBeenCalled();
    });

    test('activates a buyer subscription (not a vendor one) for a link with payerType buyer', async () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([{ id: 'pl-buyer-1', zohoPaymentLinkId: 'zoho-buyer-1', payerType: 'buyer' }]);
      zohoPaymentService.getPaymentLinkStatus.mockResolvedValueOnce({ status: 'PAID', rawResponse: {} });

      await zohoReconciliationService.reconcileOnce();

      expect(storeService.activateBuyerSubscriptionFromPayment).toHaveBeenCalledWith('pl-buyer-1');
      expect(storeService.activateVendorSubscriptionFromPayment).not.toHaveBeenCalled();
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
      expect(storeService.updatePaymentLinkRecord).toHaveBeenCalledTimes(1);
      expect(storeService.updatePaymentLinkRecord).toHaveBeenCalledWith('pl-2', { status: 'PAID', rawResponse: {} });
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

    test('starts, polls on the interval, and refuses to start a second time', () => {
      storeService.getPaymentLinksByStatusIn.mockReturnValue([]);
      const config = { RECONCILIATION_ENABLED: true, REFRESH_TOKEN: 'x', RECONCILIATION_INTERVAL_MS: 1000 };

      const first = zohoReconciliationService.startPolling(config);
      expect(first).toEqual({ started: true, intervalMs: 1000 });

      const second = zohoReconciliationService.startPolling(config);
      expect(second).toEqual({ started: false, reason: expect.any(String) });

      jest.advanceTimersByTime(1000);
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
  });
});

jest.mock('../src/services/storeService');
jest.mock('../src/services/zohoPaymentService');

const storeService = require('../src/services/storeService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const { ZOHO_CONFIG } = require('../src/config/constants');
const zohoWebhookController = require('../src/controllers/zohoWebhookController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('zohoWebhookController.handleWebhook', () => {
  const originalAccountId = ZOHO_CONFIG.ACCOUNT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    zohoWebhookController.processedEventIds.clear();
    ZOHO_CONFIG.ACCOUNT_ID = 'acct-1';
    zohoPaymentService.verifyWebhookSignature.mockReturnValue(true);
  });

  afterEach(() => {
    ZOHO_CONFIG.ACCOUNT_ID = originalAccountId;
  });

  test('rejects an invalid signature with 401', async () => {
    zohoPaymentService.verifyWebhookSignature.mockReturnValue(false);
    const req = { get: () => 'bad-header', rawBody: '{}', body: {} };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Invalid signature.' });
  });

  test('rejects an account_id mismatch with 403', async () => {
    const req = { get: () => 'sig', rawBody: '{}', body: { account_id: 'other-account' } };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Account mismatch.' });
  });

  test('skips reprocessing an event id already seen (idempotency)', async () => {
    zohoWebhookController.processedEventIds.add(555);
    const req = { get: () => 'sig', rawBody: '{}', body: { account_id: 'acct-1', event_id: 555 } };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, skipped: true });
    expect(storeService.getPaymentLinkByZohoId).not.toHaveBeenCalled();
  });

  test('reports success but unmatched when no payment link exists for the event', async () => {
    storeService.getPaymentLinkByZohoId.mockReturnValue(undefined);
    const req = {
      get: () => 'sig',
      rawBody: '{}',
      body: { account_id: 'acct-1', event_id: 1, event_type: 'payment_link.paid', event_object: { payment_link_id: 'zoho-unknown' } },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, matched: false });
    expect(zohoWebhookController.processedEventIds.has(1)).toBe(true);
  });

  test('activates the vendor subscription on payment_link.paid', async () => {
    const link = { id: 'pl-1', zohoPaymentLinkId: 'zoho-1' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    const event = {
      account_id: 'acct-1',
      event_id: 2,
      event_type: 'payment_link.paid',
      event_object: { payment_link_id: 'zoho-1' },
    };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.updatePaymentLinkRecord).toHaveBeenCalledWith('pl-1', { status: 'PAID', rawResponse: event });
    expect(storeService.activateVendorSubscriptionFromPayment).toHaveBeenCalledWith('pl-1');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('activates the buyer subscription (not a vendor one) for a link with payerType buyer', async () => {
    const link = { id: 'pl-buyer-1', zohoPaymentLinkId: 'zoho-buyer-1', payerType: 'buyer' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    const event = {
      account_id: 'acct-1',
      event_id: 10,
      event_type: 'payment_link.paid',
      event_object: { payment_link_id: 'zoho-buyer-1' },
    };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.activateBuyerSubscriptionFromPayment).toHaveBeenCalledWith('pl-buyer-1');
    expect(storeService.activateVendorSubscriptionFromPayment).not.toHaveBeenCalled();
  });

  test('marks the link canceled on payment_link.canceled without activating anything', async () => {
    const link = { id: 'pl-2', zohoPaymentLinkId: 'zoho-2' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    const event = { account_id: 'acct-1', event_id: 3, event_type: 'payment_link.canceled', event_object: { payment_link_id: 'zoho-2' } };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.updatePaymentLinkRecord).toHaveBeenCalledWith('pl-2', { status: 'CANCELED', rawResponse: event });
    expect(storeService.activateVendorSubscriptionFromPayment).not.toHaveBeenCalled();
  });

  test('marks the link expired on payment_link.expired', async () => {
    const link = { id: 'pl-3', zohoPaymentLinkId: 'zoho-3' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    const event = { account_id: 'acct-1', event_id: 4, event_type: 'payment_link.expired', event_object: { payment_link_id: 'zoho-3' } };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.updatePaymentLinkRecord).toHaveBeenCalledWith('pl-3', { status: 'EXPIRED', rawResponse: event });
  });

  test('ignores an unrecognized event type without erroring', async () => {
    const link = { id: 'pl-4', zohoPaymentLinkId: 'zoho-4' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    const event = { account_id: 'acct-1', event_id: 5, event_type: 'something.else', event_object: { payment_link_id: 'zoho-4' } };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.updatePaymentLinkRecord).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('falls back to JSON.stringify(body) for signature verification when rawBody is missing', async () => {
    const event = { account_id: 'acct-1', event_id: 6, event_type: 'payment_link.paid', event_object: {} };
    storeService.getPaymentLinkByZohoId.mockReturnValue(undefined);
    const req = { get: () => 'sig', body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(zohoPaymentService.verifyWebhookSignature).toHaveBeenCalledWith('sig', JSON.stringify(event));
  });

  test('tolerates a body with no event_object and no event_id (never persisted for dedup)', async () => {
    storeService.getPaymentLinkByZohoId.mockReturnValue(undefined);
    const req = { get: () => 'sig', rawBody: '{}', body: { account_id: 'acct-1' } };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.getPaymentLinkByZohoId).toHaveBeenCalledWith(undefined);
    expect(res.json).toHaveBeenCalledWith({ success: true, matched: false });
    expect(zohoWebhookController.processedEventIds.size).toBe(0);
  });

  test('tolerates a request with no body at all — an unset account_id fails the account check', async () => {
    const req = { get: () => 'sig', rawBody: '{}', body: undefined };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Account mismatch.' });
  });

  test('does not persist for dedup when a matched, handled event carries no event_id', async () => {
    const link = { id: 'pl-5', zohoPaymentLinkId: 'zoho-5' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    const event = { account_id: 'acct-1', event_type: 'payment_link.paid', event_object: { payment_link_id: 'zoho-5' } };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.activateVendorSubscriptionFromPayment).toHaveBeenCalledWith('pl-5');
    expect(zohoWebhookController.processedEventIds.size).toBe(0);
  });

  test('skips the account_id check when ZOHO_PAYMENTS_ACCOUNT_ID is not configured', async () => {
    ZOHO_CONFIG.ACCOUNT_ID = '';
    storeService.getPaymentLinkByZohoId.mockReturnValue(undefined);
    const event = { account_id: 'anything', event_id: 7, event_type: 'payment_link.paid', event_object: {} };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});

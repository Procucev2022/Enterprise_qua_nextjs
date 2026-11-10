jest.mock('../src/services/storeService');
jest.mock('../src/services/zohoPaymentService');
jest.mock('../src/db/zohoWebhookQueries');

const storeService = require('../src/services/storeService');
const zohoPaymentService = require('../src/services/zohoPaymentService');
const zohoWebhookQueries = require('../src/db/zohoWebhookQueries');
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
    ZOHO_CONFIG.ACCOUNT_ID = 'acct-1';
    zohoPaymentService.verifyWebhookSignature.mockReturnValue(true);
    zohoWebhookQueries.claimWebhookEvent.mockResolvedValue({ claimed: true, ownerToken: 'receipt-owner' });
    zohoWebhookQueries.completeWebhookEvent.mockResolvedValue(true);
    zohoWebhookQueries.failWebhookEvent.mockResolvedValue(true);
    storeService.updatePaymentLinkRecordDurably.mockImplementation(async (id, updates) => ({ id, ...updates }));
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

  test('skips an event already durably processed', async () => {
    zohoWebhookQueries.claimWebhookEvent.mockResolvedValue({ claimed: false, reason: 'PROCESSED' });
    const req = { get: () => 'sig', rawBody: '{}', body: { account_id: 'acct-1', event_id: 555 } };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.json).toHaveBeenCalledWith({ success: true, skipped: true });
    expect(storeService.getPaymentLinkByZohoId).not.toHaveBeenCalled();
    expect(zohoWebhookQueries.claimWebhookEvent).toHaveBeenCalledWith('acct-1', '555', req.body);
  });

  test('asks Zoho to retry an event while another request holds its processing lease', async () => {
    zohoWebhookQueries.claimWebhookEvent.mockResolvedValue({ claimed: false, reason: 'IN_PROGRESS' });
    const event = { account_id: 'acct-1', event_id: 'event-in-progress' };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: '{}', body: event }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));
    expect(storeService.getPaymentLinkByZohoId).not.toHaveBeenCalled();
  });

  test('returns retryable failure when the durable claim cannot be read or written', async () => {
    zohoWebhookQueries.claimWebhookEvent.mockRejectedValue(new Error('D1 unavailable'));
    const event = { account_id: 'acct-1', event_id: 'event-claim-fail' };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: '{}', body: event }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(storeService.getPaymentLinkByZohoId).not.toHaveBeenCalled();
  });

  test('retries an unmatched payment link so a delayed local write cannot lose the event', async () => {
    storeService.getPaymentLinkByZohoId.mockReturnValue(undefined);
    const req = {
      get: () => 'sig',
      rawBody: '{}',
      body: { account_id: 'acct-1', event_id: 1, event_type: 'payment_link.paid', event_object: { payment_link_id: 'zoho-unknown' } },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, retryable: true }));
    expect(zohoWebhookQueries.failWebhookEvent).toHaveBeenCalledWith('acct-1', '1', 'receipt-owner', 'PAYMENT_LINK_NOT_FOUND');
  });

  test('activates the vendor subscription on payment_link.paid', async () => {
    const link = { id: 'pl-1', zohoPaymentLinkId: 'zoho-1' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    storeService.activatePaymentLinkDurably.mockResolvedValue({ ...link, activated: true });
    const event = {
      account_id: 'acct-1',
      event_id: 2,
      event_type: 'payment_link.paid',
      event_object: { payment_link_id: 'zoho-1' },
    };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledWith('pl-1', event);
    expect(storeService.updatePaymentLinkRecord).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(zohoWebhookQueries.completeWebhookEvent).toHaveBeenCalledWith('acct-1', '2', 'receipt-owner');
  });

  test('activates the buyer subscription (not a vendor one) for a link with payerType buyer', async () => {
    const link = { id: 'pl-buyer-1', zohoPaymentLinkId: 'zoho-buyer-1', payerType: 'buyer' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    storeService.activatePaymentLinkDurably.mockResolvedValue({ ...link, activated: true });
    const event = {
      account_id: 'acct-1',
      event_id: 10,
      event_type: 'payment_link.paid',
      event_object: { payment_link_id: 'zoho-buyer-1' },
    };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledWith('pl-buyer-1', event);
  });

  test('returns retryable failure when a paid activation returns no durable owner', async () => {
    storeService.getPaymentLinkByZohoId.mockResolvedValue({ id: 'pl-owner-missing', zohoPaymentLinkId: 'zoho-owner-missing' });
    storeService.activatePaymentLinkDurably.mockResolvedValueOnce(null);
    const event = {
      account_id: 'acct-1',
      event_id: 'event-owner-missing',
      event_type: 'payment_link.paid',
      event_object: { payment_link_id: 'zoho-owner-missing' },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: JSON.stringify(event), body: event }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(zohoWebhookQueries.failWebhookEvent).toHaveBeenCalledWith('acct-1', event.event_id, 'receipt-owner', 'PAYMENT_ACTIVATION_UNAVAILABLE');
  });

  test('marks the link canceled on payment_link.canceled without activating anything', async () => {
    const link = { id: 'pl-2', zohoPaymentLinkId: 'zoho-2' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    const event = { account_id: 'acct-1', event_id: 3, event_type: 'payment_link.canceled', event_object: { payment_link_id: 'zoho-2' } };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.updatePaymentLinkRecordDurably).toHaveBeenCalledWith('pl-2', { status: 'CANCELED', rawResponse: event });
    expect(storeService.activateVendorSubscriptionFromPayment).not.toHaveBeenCalled();
    expect(zohoWebhookQueries.completeWebhookEvent).toHaveBeenCalledWith('acct-1', '3', 'receipt-owner');
  });

  test('marks the link expired on payment_link.expired', async () => {
    const link = { id: 'pl-3', zohoPaymentLinkId: 'zoho-3' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    const event = { account_id: 'acct-1', event_id: 4, event_type: 'payment_link.expired', event_object: { payment_link_id: 'zoho-3' } };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.updatePaymentLinkRecordDurably).toHaveBeenCalledWith('pl-3', { status: 'EXPIRED', rawResponse: event });
  });

  test('returns retryable failure when the cancellation update affects no durable row', async () => {
    storeService.getPaymentLinkByZohoId.mockResolvedValue({ id: 'pl-cancel-missing', zohoPaymentLinkId: 'zoho-cancel-missing' });
    storeService.updatePaymentLinkRecordDurably.mockResolvedValueOnce(null);
    const event = {
      account_id: 'acct-1', event_id: 'event-cancel-missing', event_type: 'payment_link.canceled',
      event_object: { payment_link_id: 'zoho-cancel-missing' },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: JSON.stringify(event), body: event }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(zohoWebhookQueries.failWebhookEvent).toHaveBeenCalledWith('acct-1', event.event_id, 'receipt-owner', 'PAYMENT_STATUS_UPDATE_FAILED');
  });

  test('returns retryable failure when the expiration update affects no durable row', async () => {
    storeService.getPaymentLinkByZohoId.mockResolvedValue({ id: 'pl-expire-missing', zohoPaymentLinkId: 'zoho-expire-missing' });
    storeService.updatePaymentLinkRecordDurably.mockResolvedValueOnce(null);
    const event = {
      account_id: 'acct-1', event_id: 'event-expire-missing', event_type: 'payment_link.expired',
      event_object: { payment_link_id: 'zoho-expire-missing' },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: JSON.stringify(event), body: event }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(zohoWebhookQueries.failWebhookEvent).toHaveBeenCalledWith('acct-1', event.event_id, 'receipt-owner', 'PAYMENT_STATUS_UPDATE_FAILED');
  });

  test('retries a status webhook when its durable update fails', async () => {
    storeService.getPaymentLinkByZohoId.mockResolvedValue({ id: 'pl-retry', zohoPaymentLinkId: 'zoho-retry' });
    storeService.updatePaymentLinkRecordDurably.mockRejectedValueOnce(new Error('D1 unavailable'));
    const event = {
      account_id: 'acct-1',
      event_id: 40,
      event_type: 'payment_link.canceled',
      event_object: { payment_link_id: 'zoho-retry' },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: JSON.stringify(event), body: event }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(zohoWebhookQueries.failWebhookEvent).toHaveBeenCalledWith('acct-1', '40', 'receipt-owner', 'Error');
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
    expect(zohoWebhookQueries.completeWebhookEvent).toHaveBeenCalledWith('acct-1', '5', 'receipt-owner');
  });

  test('falls back to JSON.stringify(body) for signature verification when rawBody is missing', async () => {
    const event = { account_id: 'acct-1', event_id: 6, event_type: 'payment_link.paid', event_object: {} };
    storeService.getPaymentLinkByZohoId.mockReturnValue(undefined);
    const req = { get: () => 'sig', body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(zohoPaymentService.verifyWebhookSignature).toHaveBeenCalledWith('sig', JSON.stringify(event));
  });

  test('retries a body with no event_object and no event_id without claiming a receipt', async () => {
    storeService.getPaymentLinkByZohoId.mockReturnValue(undefined);
    const req = { get: () => 'sig', rawBody: '{}', body: { account_id: 'acct-1' } };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.getPaymentLinkByZohoId).toHaveBeenCalledWith(undefined);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(zohoWebhookQueries.claimWebhookEvent).not.toHaveBeenCalled();
    expect(zohoWebhookQueries.completeWebhookEvent).not.toHaveBeenCalled();
  });

  test('tolerates a request with no body at all — an unset account_id fails the account check', async () => {
    const req = { get: () => 'sig', rawBody: '{}', body: undefined };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Account mismatch.' });
  });

  test('uses an empty object when both rawBody and body are absent', async () => {
    const res = mockRes();
    await zohoWebhookController.handleWebhook({ get: () => 'sig' }, res);
    expect(zohoPaymentService.verifyWebhookSignature).toHaveBeenCalledWith('sig', '{}');
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('does not persist for dedup when a matched, handled event carries no event_id', async () => {
    const link = { id: 'pl-5', zohoPaymentLinkId: 'zoho-5' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    const event = { account_id: 'acct-1', event_type: 'payment_link.paid', event_object: { payment_link_id: 'zoho-5' } };
    storeService.activatePaymentLinkDurably.mockResolvedValue({ ...link, activated: true });
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(storeService.activatePaymentLinkDurably).toHaveBeenCalledWith('pl-5', event);
    expect(zohoWebhookQueries.claimWebhookEvent).not.toHaveBeenCalled();
    expect(zohoWebhookQueries.completeWebhookEvent).not.toHaveBeenCalled();
  });

  test('returns retryable failure and does not mark a paid event processed when activation persistence fails', async () => {
    const link = { id: 'pl-retry', zohoPaymentLinkId: 'zoho-retry' };
    storeService.getPaymentLinkByZohoId.mockReturnValue(link);
    storeService.activatePaymentLinkDurably.mockRejectedValue(new Error('D1 unavailable'));
    const event = {
      account_id: 'acct-1',
      event_id: 'event-retry',
      event_type: 'payment_link.paid',
      event_object: { payment_link_id: 'zoho-retry' },
    };
    const req = { get: () => 'sig', rawBody: JSON.stringify(event), body: event };
    const res = mockRes();

    await zohoWebhookController.handleWebhook(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(zohoWebhookQueries.failWebhookEvent).toHaveBeenCalledWith('acct-1', 'event-retry', 'receipt-owner', 'Error');
  });

  test('returns retryable failure when completion receipt persistence fails after business processing', async () => {
    storeService.getPaymentLinkByZohoId.mockResolvedValue({ id: 'pl-receipt', zohoPaymentLinkId: 'zoho-receipt' });
    storeService.updatePaymentLinkRecordDurably.mockResolvedValue({ id: 'pl-receipt', status: 'CANCELED' });
    zohoWebhookQueries.completeWebhookEvent.mockResolvedValue(false);
    const event = {
      account_id: 'acct-1',
      event_id: 'event-receipt-fail',
      event_type: 'payment_link.canceled',
      event_object: { payment_link_id: 'zoho-receipt' },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: '{}', body: event }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(zohoWebhookQueries.failWebhookEvent).toHaveBeenCalledWith(
      'acct-1',
      'event-receipt-fail',
      'receipt-owner',
      'WEBHOOK_RECEIPT_WRITE_FAILED'
    );
  });

  test('logs when failure receipt persistence also fails and lets the lease expire', async () => {
    storeService.getPaymentLinkByZohoId.mockResolvedValue({ id: 'pl-receipt', zohoPaymentLinkId: 'zoho-receipt' });
    storeService.updatePaymentLinkRecordDurably.mockRejectedValue(new Error('database unavailable'));
    zohoWebhookQueries.failWebhookEvent.mockRejectedValue(new Error('receipt database unavailable'));
    const event = {
      account_id: 'acct-1',
      event_id: 'event-release-fail',
      event_type: 'payment_link.canceled',
      event_object: { payment_link_id: 'zoho-receipt' },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: '{}', body: event }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(zohoWebhookQueries.failWebhookEvent).toHaveBeenCalledTimes(1);
  });

  test('uses a safe failure code when a thrown object has no name or code', async () => {
    storeService.getPaymentLinkByZohoId.mockResolvedValue({ id: 'pl-error-code', zohoPaymentLinkId: 'zoho-error-code' });
    storeService.updatePaymentLinkRecordDurably.mockRejectedValue({ code: '', name: '' });
    const event = {
      account_id: 'acct-1',
      event_id: 'event-empty-error-code',
      event_type: 'payment_link.canceled',
      event_object: { payment_link_id: 'zoho-error-code' },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: '{}', body: event }, res);

    expect(zohoWebhookQueries.failWebhookEvent).toHaveBeenCalledWith(
      'acct-1',
      'event-empty-error-code',
      'receipt-owner',
      'PROCESSING_FAILED'
    );
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

  test('supports a signed event with null account_id when the configured account check is disabled', async () => {
    ZOHO_CONFIG.ACCOUNT_ID = '';
    storeService.getPaymentLinkByZohoId.mockResolvedValue({ id: 'pl-null-account', zohoPaymentLinkId: 'zoho-null-account' });
    const event = {
      account_id: null,
      event_id: 'event-null-account',
      event_type: 'payment_link.unknown',
      event_object: { payment_link_id: 'zoho-null-account' },
    };
    const res = mockRes();

    await zohoWebhookController.handleWebhook({ get: () => 'sig', rawBody: '{}', body: event }, res);

    expect(zohoWebhookQueries.claimWebhookEvent).toHaveBeenCalledWith('', 'event-null-account', event);
    expect(zohoWebhookQueries.completeWebhookEvent).toHaveBeenCalledWith('', 'event-null-account', 'receipt-owner');
  });
});

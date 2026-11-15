let pool;
let domainQueries;
let paymentActivationQueries;
let storeService;

function loadStoreWithMocks() {
  jest.resetModules();
  jest.doMock('../src/db/pool', () => ({ hasStorage: jest.fn() }));
  jest.doMock('../src/db/domainQueries', () => ({
    getPaymentLinkByIdFromDB: jest.fn(),
    upsertPaymentLinkInDB: jest.fn(),
    upsertBuyerAccountInDB: jest.fn(async (account) => account),
    upsertVendorInDB: jest.fn(async (vendor) => vendor),
  }));
  jest.doMock('../src/db/paymentActivationQueries', () => ({
    activatePaymentLinkSubscriptionInDB: jest.fn(),
    updatePaymentLinkStatusInDB: jest.fn(),
  }));
  pool = require('../src/db/pool');
  domainQueries = require('../src/db/domainQueries');
  paymentActivationQueries = require('../src/db/paymentActivationQueries');
  storeService = require('../src/services/storeService');
}

describe('storeService durable payment mutations', () => {
  beforeEach(() => {
    loadStoreWithMocks();
    storeService.reset();
    storeService.addAuditLog = jest.fn();
    pool.hasStorage.mockReturnValue(true);
  });

  test('updates a fresh persisted payment link before replacing the cache row', async () => {
    const stale = { id: 'link-1', status: 'CREATED', rawResponse: { stale: true } };
    const updated = { id: 'link-1', status: 'CANCELED', providerField: 'new' };
    storeService.paymentLinks.push(stale);
    paymentActivationQueries.updatePaymentLinkStatusInDB.mockResolvedValue(updated);

    const result = await storeService.updatePaymentLinkRecordDurably('link-1', { status: 'CANCELED' });

    expect(paymentActivationQueries.updatePaymentLinkStatusInDB).toHaveBeenCalledWith('link-1', { status: 'CANCELED' });
    expect(domainQueries.getPaymentLinkByIdFromDB).not.toHaveBeenCalled();
    expect(storeService.paymentLinks).toEqual([result]);
  });

  test('returns null when a durable payment link no longer exists', async () => {
    paymentActivationQueries.updatePaymentLinkStatusInDB.mockResolvedValue(null);
    domainQueries.getPaymentLinkByIdFromDB.mockResolvedValue(null);
    storeService.paymentLinks.push({ id: 'link-missing' });

    await expect(storeService.updatePaymentLinkRecordDurably('link-missing', { status: 'EXPIRED' })).resolves.toBeNull();

    expect(storeService.paymentLinks).toEqual([]);
    expect(paymentActivationQueries.updatePaymentLinkStatusInDB).toHaveBeenCalledTimes(1);
  });

  test('preserves an already activated link against stale cancellation updates', async () => {
    const activated = { id: 'link-paid', status: 'PAID', activated: true };
    paymentActivationQueries.updatePaymentLinkStatusInDB.mockResolvedValue(null);
    domainQueries.getPaymentLinkByIdFromDB.mockResolvedValue(activated);
    storeService.paymentLinks.push({ id: 'link-paid', status: 'CREATED' });

    await expect(storeService.updatePaymentLinkRecordDurably('link-paid', { status: 'CANCELED' })).resolves.toBe(activated);

    expect(domainQueries.getPaymentLinkByIdFromDB).toHaveBeenCalledWith('link-paid', { fresh: true });
    expect(storeService.paymentLinks).toEqual([activated]);
  });

  test('returns a retryable persistence error when an eligible row is not updated', async () => {
    paymentActivationQueries.updatePaymentLinkStatusInDB.mockResolvedValue(null);
    domainQueries.getPaymentLinkByIdFromDB.mockResolvedValue({ id: 'link-conflict', status: 'CREATED' });

    await expect(storeService.updatePaymentLinkRecordDurably('link-conflict', { status: 'EXPIRED' }))
      .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
  });

  test('does not change cached state when the durable update fails', async () => {
    const link = { id: 'link-fail', status: 'CREATED' };
    storeService.paymentLinks.push(link);
    paymentActivationQueries.updatePaymentLinkStatusInDB.mockRejectedValue(new Error('database unavailable'));

    await expect(storeService.updatePaymentLinkRecordDurably('link-fail', { status: 'EXPIRED' }))
      .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });

    expect(storeService.paymentLinks).toEqual([link]);
  });

  test('uses the local payment link when storage is not configured', async () => {
    pool.hasStorage.mockReturnValue(false);
    storeService.paymentLinks.push({ id: 'local-link', status: 'CREATED' });
    domainQueries.upsertPaymentLinkInDB.mockResolvedValue({ id: 'local-link', status: 'EXPIRED' });

    await expect(storeService.updatePaymentLinkRecordDurably('local-link', { status: 'EXPIRED' }))
      .resolves.toMatchObject({ status: 'EXPIRED' });
  });

  test('commits an atomic activation and refreshes both payer and payment link caches', async () => {
    const activation = {
      link: { id: 'paid-link', status: 'PAID', activated: true, payerType: 'buyer', buyerAccountId: 'buyer-1' },
      payer: { id: 'buyer-1', subscriptionPlan: 'standard' },
      payerType: 'buyer',
      activated: true,
    };
    storeService.paymentLinks.push({ id: 'paid-link', status: 'CREATED' });
    storeService.buyerAccounts.push({ id: 'buyer-1', subscriptionPlan: 'free' });
    paymentActivationQueries.activatePaymentLinkSubscriptionInDB.mockResolvedValue(activation);

    await expect(storeService.activatePaymentLinkDurably('paid-link', { event_id: 'evt-1' })).resolves.toBe(activation.link);

    expect(storeService.paymentLinks).toEqual([activation.link]);
    expect(storeService.buyerAccounts).toEqual([activation.payer]);
    expect(storeService.addAuditLog).toHaveBeenCalledTimes(1);
  });

  test('returns null when no payment link can be activated', async () => {
    paymentActivationQueries.activatePaymentLinkSubscriptionInDB.mockResolvedValue(null);

    await expect(storeService.activatePaymentLinkDurably('missing-link', {})).resolves.toBeNull();
  });

  test('rejects an activation that did not persist the subscription owner', async () => {
    paymentActivationQueries.activatePaymentLinkSubscriptionInDB.mockResolvedValue({
      link: { id: 'paid-link', activated: false },
    });

    await expect(storeService.activatePaymentLinkDurably('paid-link', {}))
      .rejects.toMatchObject({ statusCode: 409, code: 'PAYMENT_ACTIVATION_CONFLICT' });
  });

  test('rethrows and logs durable activation failures', async () => {
    const error = new Error('transaction failed');
    paymentActivationQueries.activatePaymentLinkSubscriptionInDB.mockRejectedValue(error);

    await expect(storeService.activatePaymentLinkDurably('paid-link', {})).rejects.toBe(error);
  });

  test('activates a local buyer subscription without a database', async () => {
    pool.hasStorage.mockReturnValue(false);
    domainQueries.upsertPaymentLinkInDB.mockImplementation(async (link) => link);
    storeService.paymentLinks.push({
      id: 'local-paid-link',
      payerType: 'buyer',
      buyerAccountId: 'buyer-local',
      planId: 'free_trial',
      status: 'CREATED',
    });
    storeService.buyerAccounts.push({ id: 'buyer-local', subscriptionPlan: 'free' });

    await expect(storeService.activatePaymentLinkDurably('local-paid-link', {})).resolves.toMatchObject({
      id: 'local-paid-link',
      activated: true,
    });
    expect(storeService.buyerAccounts[0]).toMatchObject({ subscriptionPlan: 'free_trial', remainingFreeRFQs: 5 });
  });
});

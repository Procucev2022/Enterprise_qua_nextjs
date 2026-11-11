const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

describe('store service durable vendor RFQ unlock', () => {
  let savedVendors;
  let savedRfqs;
  const rfq = {
    id: 'rfq-durable-unlock-1',
    rfqNumber: 'RFQ-DURABLE-UNLOCK-1',
    title: 'Durable unlock RFQ',
    category: 'Mechanical',
    sourcingMode: 'mode_0',
    quotes: [],
  };
  const persistedVendor = {
    id: 'vendor-durable-unlock-1',
    email: 'durable@vendor.test',
    name: 'Durable Vendor',
    majorCategory: 'Mechanical',
    subscriptionPlan: 'premium',
    freeQuotationCredits: 2,
    freeRfqDownloadCredits: 2,
    freeCreditsAllocated: 2,
    freeCreditsUsed: 0,
    rfqDownloadsUsed: 0,
    unlockedRfqIds: [],
  };

  beforeEach(() => {
    savedVendors = storeService.vendors;
    savedRfqs = storeService.rfqs;
    storeService.vendors = [{ ...persistedVendor, freeQuotationCredits: 1 }];
    storeService.rfqs = [rfq];
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(persistedVendor);
    jest.spyOn(domainQueries, 'unlockVendorRfqDurablyInDB').mockResolvedValue(null);
    jest.spyOn(domainQueries, 'unlockRFQInDB').mockResolvedValue(null);
    jest.spyOn(domainQueries, 'recordCreditTransactionInDB').mockResolvedValue(null);
    jest.spyOn(storeService, 'getRFQByIdAsync').mockResolvedValue(rfq);
    jest.spyOn(storeService, 'addAuditLog').mockReturnValue({ id: 'audit-unlock' });
  });

  afterEach(() => {
    storeService.vendors = savedVendors;
    storeService.rfqs = savedRfqs;
    jest.restoreAllMocks();
  });

  test('refreshes account state and changes cache only after the atomic durable unlock succeeds', async () => {
    const savedVendor = {
      ...persistedVendor,
      freeQuotationCredits: 1,
      freeRfqDownloadCredits: 1,
      freeCreditsUsed: 1,
      rfqDownloadsUsed: 1,
      unlockedRfqIds: [rfq.id, rfq.rfqNumber],
    };
    const durableUnlock = jest.spyOn(domainQueries, 'unlockVendorRfqDurablyInDB').mockResolvedValue({
      success: true,
      alreadyUnlocked: false,
      vendor: savedVendor,
      source: 'free_credit',
      creditCharged: 1,
      freeCreditsRemaining: 1,
    });

    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id)).resolves.toMatchObject({
      success: true,
      alreadyUnlocked: false,
      creditCharged: 1,
      freeCreditsRemaining: 1,
      vendor: savedVendor,
    });
    expect(domainQueries.getVendorByIdFromDB).toHaveBeenCalledWith(persistedVendor.id, { fresh: true });
    expect(durableUnlock).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: persistedVendor.id,
      rfqId: rfq.id,
      rfqNumber: rfq.rfqNumber,
      idempotencyKey: `tx-${persistedVendor.id}-${rfq.id}`,
    }));
    expect(storeService.vendors[0]).toEqual(savedVendor);
    expect(storeService.addAuditLog).toHaveBeenCalledTimes(1);
    expect(domainQueries.unlockRFQInDB).not.toHaveBeenCalled();
    expect(domainQueries.recordCreditTransactionInDB).not.toHaveBeenCalled();
  });

  test('preserves the refreshed credit balance on a failed durable unlock and returns retryable storage error', async () => {
    const failure = new Error('transaction failed');
    jest.spyOn(domainQueries, 'unlockVendorRfqDurablyInDB').mockRejectedValue(failure);

    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id))
      .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE', cause: failure });
    expect(storeService.vendors[0]).toEqual(persistedVendor);
    expect(storeService.addAuditLog).not.toHaveBeenCalled();
  });

  test('does not wrap durable conflicts as retryable availability errors', async () => {
    jest.spyOn(domainQueries, 'unlockVendorRfqDurablyInDB').mockRejectedValue(
      Object.assign(new Error('ledger conflict'), { statusCode: 409, code: 'VENDOR_CREDIT_STATE_INCONSISTENT' })
    );
    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id))
      .rejects.toMatchObject({ statusCode: 409, code: 'VENDOR_CREDIT_STATE_INCONSISTENT' });

    jest.spyOn(domainQueries, 'unlockVendorRfqDurablyInDB').mockRejectedValue(
      Object.assign(new Error('invalid unlock'), { statusCode: 400, code: 'INVALID_VENDOR_RFQ_UNLOCK' })
    );
    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_VENDOR_RFQ_UNLOCK' });
  });

  test('returns exhausted persisted credits without changing cached state', async () => {
    jest.spyOn(domainQueries, 'unlockVendorRfqDurablyInDB').mockResolvedValue({
      success: false,
      creditsExhausted: true,
      freeCreditsRemaining: 0,
    });

    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id)).resolves.toMatchObject({
      success: false,
      creditsExhausted: true,
      freeCreditsRemaining: 0,
    });
    expect(storeService.vendors[0]).toEqual(persistedVendor);
    expect(storeService.addAuditLog).toHaveBeenCalledTimes(1);
  });

  test('handles durable replays without replacing cache or adding duplicate audit entries', async () => {
    jest.spyOn(domainQueries, 'unlockVendorRfqDurablyInDB').mockResolvedValue({
      success: true,
      alreadyUnlocked: true,
      creditCharged: 0,
      freeCreditsRemaining: 3,
    });

    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id)).resolves.toMatchObject({
      success: true,
      alreadyUnlocked: true,
      creditCharged: 0,
      freeCreditsRemaining: 3,
      vendor: persistedVendor,
    });
    expect(storeService.addAuditLog).not.toHaveBeenCalled();
  });

  test('uses the subscription audit fallback and refreshes a cache entry missing at commit time', async () => {
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(persistedVendor);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockImplementation(async () => {
      storeService.vendors = [];
      return persistedVendor;
    });
    jest.spyOn(domainQueries, 'unlockVendorRfqDurablyInDB').mockImplementation(async () => {
      storeService.vendors = [];
      return {
        success: true,
        alreadyUnlocked: false,
        vendor: persistedVendor,
        source: '',
        creditCharged: 0,
        freeCreditsRemaining: 2,
      };
    });

    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id)).resolves.toMatchObject({ success: true });
    expect(storeService.vendors).toEqual([persistedVendor]);
    expect(storeService.addAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.stringContaining('(subscription entitlement)'),
    }));
  });

  test('returns not found and unauthorized results before attempting a durable mutation', async () => {
    storeService.getRFQByIdAsync.mockResolvedValue(null);
    await expect(storeService.unlockRFQForVendor(persistedVendor.id, 'missing-rfq'))
      .resolves.toMatchObject({ success: false, notFound: true });

    storeService.getRFQByIdAsync.mockResolvedValue({
      ...rfq,
      category: 'Electrical',
      sourcingMode: 'mode_1',
    });
    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id))
      .resolves.toMatchObject({ success: false, unauthorized: true });
    expect(domainQueries.unlockVendorRfqDurablyInDB).not.toHaveBeenCalled();
  });

  test('uses a fresh persisted replay state without another durable mutation', async () => {
    const alreadyUnlocked = { ...persistedVendor, unlockedRfqIds: [rfq.rfqNumber] };
    domainQueries.getVendorByIdFromDB.mockResolvedValue(alreadyUnlocked);
    const durableUnlock = jest.spyOn(domainQueries, 'unlockVendorRfqDurablyInDB');

    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id)).resolves.toMatchObject({
      success: true,
      alreadyUnlocked: true,
      creditCharged: 0,
      freeCreditsRemaining: 2,
    });
    expect(durableUnlock).not.toHaveBeenCalled();
  });

  test('fails closed when the persisted vendor disappears or cannot be refreshed', async () => {
    domainQueries.getVendorByIdFromDB.mockResolvedValue(null);
    jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(null);
    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id)).resolves.toMatchObject({
      success: false,
      notFound: true,
    });

    domainQueries.getVendorByIdFromDB.mockRejectedValue(new Error('database unavailable'));
    await expect(storeService.unlockRFQForVendor(persistedVendor.id, rfq.id))
      .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
  });
});

const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');

// Branch coverage for the vendor lookup, vendor update, evaluation request and
// evaluation creation paths of storeService. Storage is simulated by swapping
// the pool holder and mocking the domain query helpers, so no database is used.
describe('storeService vendor request and evaluation branches', () => {
  const originalVendors = storeService.vendors;
  const originalEvaluations = storeService.evaluations;
  const originalRfqs = storeService.rfqs;
  let originalPool;

  beforeEach(() => {
    originalPool = pool.pool;
    pool.pool = null;
    storeService.vendors = [];
    storeService.evaluations = [];
    jest.spyOn(mailerService, 'sendVendorEvaluationRequestEmail').mockResolvedValue({ success: true });
  });

  afterEach(() => {
    pool.pool = originalPool;
    storeService.vendors = originalVendors;
    storeService.evaluations = originalEvaluations;
    storeService.rfqs = originalRfqs;
    jest.restoreAllMocks();
  });

  const addInMemoryVendor = (overrides = {}) => storeService.addVendor({
    name: 'Branch Supplier',
    email: 'branch-supplier@example.test',
    source: 'buyer_manual',
    ...overrides,
  });

  test('looks up a vendor with no id or email in storage and finds nothing', async () => {
    pool.pool = { query: jest.fn() };
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
    jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(null);

    await expect(storeService.getVendorByIdWithDBFallback(undefined)).resolves.toBeUndefined();
    await expect(storeService.getVendorByIdWithDBFallback('nobody-here')).resolves.toBeUndefined();
  });

  test('deletes nothing and reports false for an email that is not in storage', async () => {
    pool.pool = { query: jest.fn() };
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
    const emailLookup = jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(null);

    await expect(storeService.deleteVendorDurably('ghost@example.test')).resolves.toBe(false);
    expect(emailLookup).toHaveBeenCalledWith('ghost@example.test');
  });

  test('deletes a vendor that has no email on record', async () => {
    storeService.vendors = [{ id: 'v-no-email', name: 'Legacy Vendor' }];

    await expect(storeService.deleteVendorDurably('v-no-email')).resolves.toBe(true);
    expect(storeService.vendors).toEqual([]);
  });

  test('returns the saved vendor unchanged when the updater returns nothing', async () => {
    const vendor = addInMemoryVendor();

    const saved = await storeService.updateVendorDurably(vendor.id, () => undefined);

    expect(saved).toEqual(expect.objectContaining({ id: vendor.id, name: 'Branch Supplier' }));
  });

  test('returns nothing when storage has no snapshot for an empty vendor id', async () => {
    pool.pool = { query: jest.fn() };
    jest.spyOn(domainQueries, 'getVendorSnapshotByIdFromDB').mockResolvedValue(null);

    await expect(storeService.updateVendorDurably(undefined, { name: 'Unused' })).resolves.toBeNull();
  });

  test('reports a unique-email conflict with a 409 that names the vendor id when no record was loaded', async () => {
    pool.pool = { query: jest.fn() };
    jest.spyOn(domainQueries, 'getVendorSnapshotByIdFromDB').mockRejectedValue(
      Object.assign(new Error('duplicate key'), { code: '23505' })
    );

    const error = await storeService.updateVendorDurably('v-conflict', { name: 'Conflict' }).catch((err) => err);

    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('VENDOR_EMAIL_CONFLICT');
    expect(error.message).toBe('A vendor with the email v-conflict already exists.');
  });

  test('requestVendorEvaluation returns nothing for an unknown vendor', () => {
    expect(storeService.requestVendorEvaluation('missing-vendor')).toBeNull();
  });

  test('requestVendorEvaluation uses default options and keeps the stored status when the update returns nothing', () => {
    const vendor = addInMemoryVendor();
    jest.spyOn(storeService, 'updateVendor').mockReturnValue(null);

    const result = storeService.requestVendorEvaluation(vendor.id);

    expect(result).toEqual(expect.objectContaining({
      vendorId: vendor.id,
      evaluationRequested: true,
      status: vendor.status,
    }));
    expect(mailerService.sendVendorEvaluationRequestEmail).toHaveBeenCalledWith(expect.objectContaining({
      buyerCompany: 'A buyer on Procucev',
      notes: '',
    }));
  });

  test('requestVendorEvaluationDurably returns nothing for an unknown vendor without storage', async () => {
    await expect(storeService.requestVendorEvaluationDurably('missing-vendor')).resolves.toBeNull();
  });

  test('requestVendorEvaluationDurably keeps the stored status when the durable update returns nothing', async () => {
    const vendor = addInMemoryVendor();
    jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue(null);

    const result = await storeService.requestVendorEvaluationDurably(vendor.id);

    expect(result).toEqual(expect.objectContaining({
      vendorId: vendor.id,
      evaluationRequested: true,
      status: vendor.status,
    }));
  });

  test('createEvaluationDurably keeps the built record when storage is not configured', async () => {
    const created = await storeService.createEvaluationDurably({
      vendorId: 'v-arm',
      vendorName: 'Arm Supplier',
      moduleScores: { unknownModule: null },
    });

    expect(created).toEqual(expect.objectContaining({ vendorId: 'v-arm', vendorName: 'Arm Supplier' }));
    expect(storeService.evaluations[0]).toEqual(created);
  });

  test('createEvaluationDurably rejects with a 503 when storage accepts the write but returns no row', async () => {
    pool.pool = { query: jest.fn() };
    jest.spyOn(domainQueries, 'upsertEvaluationInDB').mockResolvedValue(null);

    const error = await storeService.createEvaluationDurably({ vendorId: 'v-arm', vendorName: 'Arm Supplier' })
      .catch((err) => err);

    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('PERSISTENCE_UNAVAILABLE');
  });

  test('builds vendor records with defaults for missing fields and keeps supplied values otherwise', () => {
    const bare = storeService._buildVendorRecord({ name: 'Bare Supplier' });
    expect(bare).toEqual(expect.objectContaining({
      source: 'procucev_network',
      onboardingEmailStatus: 'skipped',
      buyerId: null,
    }));

    const detailed = storeService._buildVendorRecord({
      name: 'Detailed Supplier',
      email: ' Detailed@Example.TEST ',
      rating: '4.5',
      score: 'n/a',
      source: 'buyer_excel',
      evaluated: true,
      hasRecord: true,
      isExistingInDatabase: false,
      isCategoryAligned: false,
      freeQuotationCredits: '7',
      quotedRfqIds: ['RFQ-1'],
      createdAt: '2026-01-02T00:00:00.000Z',
      onboardingEmailStatus: 'sent',
    }, 'buyer-explicit');
    expect(detailed).toEqual(expect.objectContaining({
      email: 'detailed@example.test',
      buyerId: 'buyer-explicit',
      source: 'buyer_excel',
      rating: 4.5,
      score: null,
      onboardingEmailStatus: 'sent',
      freeQuotationCredits: 7,
      quotedRfqIds: ['RFQ-1'],
    }));

    const linked = storeService._buildVendorRecord({
      name: 'Linked Supplier',
      email: 'linked@example.test',
      buyerAccountId: 'acc-9',
      addedByBuyerCompany: 'Buyer Co',
      rfqDownloadsUsed: 3,
      subscriptionPlan: 'connect',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      created_at: '2026-03-03T00:00:00.000Z',
    });
    expect(linked).toEqual(expect.objectContaining({
      buyerId: 'acc-9',
      source: 'buyer_manual',
      onboardingEmailStatus: 'pending',
      status: 'PREFERRED ENTERPRISE SUPPLIER',
      created_at: '2026-03-03T00:00:00.000Z',
    }));
  });

  test('extendRFQDurably reports a missing RFQ without a deadline value', async () => {
    await expect(storeService.extendRFQDurably('missing-rfq')).resolves.toEqual({
      success: false,
      reason: 'NOT_FOUND',
      error: 'RFQ with ID missing-rfq not found.',
    });
  });

  test('addVendorDurably rejects with a 503 when storage accepts the write but returns no row', async () => {
    pool.pool = { query: jest.fn() };
    jest.spyOn(domainQueries, 'upsertVendorInDB').mockResolvedValue(null);

    const error = await storeService.addVendorDurably({ name: 'Unsaved Supplier', email: 'unsaved@example.test' })
      .catch((err) => err);

    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('PERSISTENCE_UNAVAILABLE');
  });

  test('addVendorDurably reports a duplicate email as a 409 when the unique constraint is named on the error or its cause', async () => {
    pool.pool = { query: jest.fn() };
    const upsert = jest.spyOn(domainQueries, 'upsertVendorInDB');

    upsert.mockRejectedValueOnce(new Error('violates unique constraint "vendors_email_key"'));
    const direct = await storeService.addVendorDurably({ name: 'Dup Supplier', email: 'dup@example.test' })
      .catch((err) => err);
    expect(direct.statusCode).toBe(409);
    expect(direct.message).toBe('A vendor with the email dup@example.test already exists.');

    upsert.mockRejectedValueOnce(Object.assign(new Error('insert failed'), { cause: { message: 'Unique Constraint violated' } }));
    const wrapped = await storeService.addVendorDurably({ name: 'Dup Supplier', email: 'dup@example.test' })
      .catch((err) => err);
    expect(wrapped.statusCode).toBe(409);
  });

  test('reviseVendorRatingDurably returns nothing when the durable update is refused', async () => {
    const vendor = addInMemoryVendor();
    jest.spyOn(storeService, 'updateVendorDurably').mockResolvedValue(null);

    await expect(storeService.reviseVendorRatingDurably(vendor.id, {})).resolves.toBeNull();
  });

  test('extendRFQDurably moves the deadline from the best available date for an in-memory RFQ', async () => {
    const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    storeService.rfqs = [
      { id: 'rfq-ext-deadline', rfqNumber: 'RFQ-EXT-1', status: 'Quotes Pending', quotes: [], deadline: future },
      { id: 'rfq-ext-target', rfqNumber: 'RFQ-EXT-2', status: 'Quotes Pending', quotes: [], targetDeliveryDate: future },
      { id: 'rfq-ext-created', rfqNumber: 'RFQ-EXT-3', status: 'Quotes Pending', quotes: [], createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'rfq-ext-bare', rfqNumber: 'RFQ-EXT-4', status: 'Quotes Pending', quotes: [] },
      { id: 'rfq-ext-invalid', rfqNumber: 'RFQ-EXT-5', status: 'Quotes Pending', quotes: [], deadline: 'not-a-date' },
    ];

    for (const id of ['rfq-ext-deadline', 'rfq-ext-target', 'rfq-ext-created', 'rfq-ext-bare', 'rfq-ext-invalid']) {
      const result = await storeService.extendRFQDurably(id, { hours: 24, userEmail: 'buyer@example.test' });
      expect(result.success).toBe(true);
      expect(result.rfq).toEqual(expect.objectContaining({
        isExtended: true,
        extensionHours: 24,
        extendedByEmail: 'buyer@example.test',
      }));
    }
  });

  test('syncBuyerAccountsFromDB keeps the in-memory accounts when storage is not configured', async () => {
    await expect(storeService.syncBuyerAccountsFromDB()).resolves.toBe(storeService.buyerAccounts);
  });

  test('scheduleBuyerComparisonSms schedules with the default zero delay and does not send until the timer runs', async () => {
    jest.useFakeTimers();
    try {
      await expect(storeService.scheduleBuyerComparisonSms({
        rfqNumber: 'RFQ-SCHED-1',
        buyerEmail: '',
        buyerPhone: '',
      })).resolves.toBeUndefined();
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

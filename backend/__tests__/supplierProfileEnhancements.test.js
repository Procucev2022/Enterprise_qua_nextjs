const vendorDossierExtensions = require('../src/controllers/vendorDossierExtensions');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const zohoReconciliationService = require('../src/services/zohoReconciliationService');

describe('supplierProfileEnhancements & vendorDossierExtensions', () => {
  const vendorUser = { email: 'supplier@test.com', role: 'vendor', sub: 'v-sub-1' };
  const adminUser = { email: 'admin@test.com', role: 'admin', sub: 'admin-sub-1' };
  const cmUser = { email: 'cm@test.com', role: 'category_manager', sub: 'cm-sub-1' };
  const buyerUser = { email: 'buyer@test.com', role: 'buyer', sub: 'buyer-sub-1' };

  let mockVendor;

  beforeEach(() => {
    mockVendor = {
      id: 'v-test-1',
      name: 'Alpha Supplier Ltd',
      contactPerson: 'Alpha Contact',
      email: 'supplier@test.com',
      phone: '+919876543210',
      majorCategory: 'Industrial Supplies',
      location: 'Bengaluru',
      subscriptionPlan: 'connect',
      freeQuotationCredits: 15,
      createdAt: '2026-03-01T10:00:00.000Z',
    };

    jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockVendor);
    jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(mockVendor);
    jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
      vendorId: 'v-test-1',
      freeCreditsAllocated: 15,
      freeCreditsUsed: 3,
      freeCreditsRemaining: 12,
      isSubscribed: true,
      subscriptionPlan: 'connect',
      unlockedRfqIds: ['rfq-1', 'rfq-2'],
    });
    jest.spyOn(storeService, 'getRFQs').mockReturnValue([
      {
        id: 'rfq-1',
        rfqNumber: 'RFQ-001',
        title: 'CNC Machined Parts',
        sourcingMode: 'mode_1',
        assignedVendors: [{ id: 'v-test-1', email: 'supplier@test.com' }],
        quotes: [{ vendorId: 'v-test-1', vendorName: 'Alpha Supplier Ltd', totalPrice: 45000 }],
        createdAt: '2026-03-02T10:00:00.000Z',
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('assertCategoryManagerOrVendor & authorization', () => {
    test('rejects unauthenticated requests with 401', async () => {
      const req = { params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('rejects vendor user if email does not match profile', async () => {
      const reqOtherVendor = {
        user: { email: 'other@vendor.com', role: 'vendor' },
        params: { id: 'v-test-1' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(reqOtherVendor, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('rejects buyer requests with 403', async () => {
      const req = { user: buyerUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('assertCategoryManagerOrVendor exercises ID and sub matching branches', () => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const { assertCategoryManagerOrVendor } = vendorDossierExtensions;

      expect(assertCategoryManagerOrVendor({ user: null }, res)).toBe(false);
      expect(assertCategoryManagerOrVendor({ user: { role: 'vendor' } }, res)).toBe(true);

      const vendorObj = { id: 'v-100', email: 'v100@test.com' };
      expect(assertCategoryManagerOrVendor({ user: { role: 'vendor', vendorId: 'v-100' } }, res, vendorObj)).toBe(true);
      expect(assertCategoryManagerOrVendor({ user: { role: 'vendor', id: 'v-100' } }, res, vendorObj)).toBe(true);
      expect(assertCategoryManagerOrVendor({ user: { role: 'vendor', sub: 'v-100' } }, res, vendorObj)).toBe(true);
      expect(assertCategoryManagerOrVendor({ user: { role: 'vendor', vendorId: 'v-100' } }, res, 'v-100')).toBe(true);
      expect(assertCategoryManagerOrVendor({ user: { role: 'vendor', email: 'diff@test.com' } }, res, vendorObj)).toBe(false);
    });

    test('allows category manager or admin', async () => {
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockResolvedValue([
        { id: 'vtx-1', transaction_type: 'INITIAL_ALLOCATION', amount: 15, balance_after: 15 },
      ]);
      const req = { user: cmUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('getCreditHistory', () => {
    test('returns 404 when vendor cannot be found', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);

      const req = { user: adminUser, params: { id: 'unknown-vendor' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('falls back to lookup by session email for vendor caller', async () => {
      jest.spyOn(storeService, 'getVendorById').mockImplementation((id) => (id === 'supplier@test.com' ? mockVendor : null));
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockImplementation((id) => (id === 'supplier@test.com' ? mockVendor : null));
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'recordCreditTransactionInDB').mockResolvedValue({ id: 'ok' });

      const req = { user: vendorUser, params: { id: 'mismatched-id' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('seeds initial transaction and deductions when DB has no records', async () => {
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'vtx-init-1', transaction_type: 'INITIAL_ALLOCATION', amount: 15, balance_after: 15 },
          { id: 'vtx-unlock-1', transaction_type: 'RFQ_UNLOCK', amount: -1, balance_after: 14 },
        ]);
      jest.spyOn(domainQueries, 'recordCreditTransactionInDB').mockResolvedValue({ id: 'vtx-ok' });

      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());

      expect(domainQueries.recordCreditTransactionInDB).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            totalCreditsAllocated: expect.any(Number),
          }),
          transactions: expect.any(Array),
        })
      );
    });

    test('calculates summary across upgrade, adjustment, and deduction transactions', async () => {
      const mixedTx = [
        { id: 't1', transaction_type: 'SUBSCRIPTION_UPGRADE', amount: 20, balance_after: 35 },
        { id: 't2', transaction_type: 'ADJUSTMENT_REFUND', amount: 5, balance_after: 40 },
        { id: 't3', transaction_type: 'RFQ_UNLOCK', amount: -5, balance_after: 35 },
      ];
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockResolvedValue(mixedTx);

      const req = { user: vendorUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            purchasedCredits: 20,
            adjustedCredits: 5,
            totalCreditsConsumed: 5,
          }),
        })
      );
    });

    test('handles exceptions and calls next(err)', async () => {
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Credit DB failure');
      });
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      await vendorDossierExtensions.getCreditHistory(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getVendorCommunications & recordVendorCommunication', () => {
    test('getVendorCommunications returns combined onboarding & rfq logs', async () => {
      const existingOnboarding = { id: 'c-onb', subject: 'Supplier Network Onboarding' };
      const existingRfq = { id: 'comm-vrfq-rfq-1-0' };
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([existingOnboarding, existingRfq]);
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorCommunications(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
        })
      );
    });

    test('getVendorCommunications generates default onboarding communication when none exists', async () => {
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([]);
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorCommunications(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.arrayContaining([
            expect.objectContaining({
              subject: expect.stringContaining('Supplier Network Onboarding'),
            }),
          ]),
        })
      );
    });

    test('getVendorCommunications returns 404 for missing vendor', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      const req = { user: adminUser, params: { id: 'unknown-vendor' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorCommunications(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('getVendorCommunications handles errors by calling next(err)', async () => {
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Comms error');
      });
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const next = jest.fn();
      await vendorDossierExtensions.getVendorCommunications(req, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('recordVendorCommunication records communication and returns 201', async () => {
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'rec-1', status: 'Delivered' });
      const req = {
        user: cmUser,
        params: { id: 'v-test-1' },
        body: { channel: 'WHATSAPP', message: 'Hello Supplier' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.objectContaining({ id: 'rec-1' }) }));
    });

    test('recordVendorCommunication returns 404 for unknown vendor', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      const req = { user: adminUser, params: { id: 'unknown-vendor' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('recordVendorCommunication handles errors by calling next(err)', async () => {
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(new Error('Record error'));
      const req = {
        user: cmUser,
        params: { id: 'v-test-1' },
        body: { channel: 'WHATSAPP', message: 'Hello Supplier' },
      };
      const next = jest.fn();
      await vendorDossierExtensions.recordVendorCommunication(req, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('getVendorCommunications and getVendorPaymentHistory fall back to user email lookup', async () => {
      jest.spyOn(storeService, 'getVendorById').mockImplementation((id) => (id === 'supplier@test.com' ? mockVendor : null));
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockImplementation((id) => (id === 'supplier@test.com' ? mockVendor : null));
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([]);
      jest.spyOn(storeService, 'getPaymentLinksForVendor').mockResolvedValue([]);

      const req = { user: vendorUser, params: { id: 'unknown-id' } };
      const resComm = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorCommunications(req, resComm, jest.fn());
      expect(resComm.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      const resPay = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorPaymentHistory(req, resPay, jest.fn());
      expect(resPay.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('getCreditHistory exercises totalConsumed fallback when transactions have no consumed entries', async () => {
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockResolvedValue([
        { id: 'tx-no-consume', transaction_type: 'INITIAL_ALLOCATION', amount: 15, balance_after: 15 },
      ]);
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({
            totalCreditsConsumed: 3,
          }),
        })
      );
    });

    test('recordVendorCommunication handles fallback fields, phone recipients, and empty user', async () => {
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'rec-2' });
      const phoneVendor = { id: 'v-phone', phone: '+919988776655' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(phoneVendor);

      const reqNoEmail = {
        user: { role: 'category_manager' },
        params: { id: 'v-phone' },
        body: {},
      };
      const resNoEmail = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(reqNoEmail, resNoEmail, jest.fn());
      expect(resNoEmail.status).toHaveBeenCalledWith(201);
    });

    test('getVendorCommunications matches RFQs by vendorName and quote details', async () => {
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([]);
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([
        {
          id: 'rfq-2',
          rfqNumber: 'RFQ-002',
          title: 'Sheet Metal Fabrication',
          quotes: [{ vendorName: 'Alpha Supplier Ltd', totalPrice: 80000 }],
        },
      ]);
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorCommunications(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.any(Array),
        })
      );
    });

    test('getVendorPaymentHistory handles bare links and completed status', async () => {
      const bareLinks = [
        { id: 'b-lnk-1', status: 'COMPLETED', amount: 3000 },
        { id: 'b-lnk-2', status: null },
      ];
      jest.spyOn(storeService, 'getPaymentLinksForVendor').mockResolvedValue(bareLinks);
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorPaymentHistory(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({
            totalSuccessfulPayments: 2,
            pendingPayments: 1,
          }),
        })
      );
    });
  });

  describe('getVendorPaymentHistory', () => {
    test('returns payment summary and list including initial plan and payment links across plans', async () => {
      for (const [plan, expectedBase] of [
        ['connect', 1999],
        ['premium', 5999],
        ['select', 9999],
        ['Preferred Partner', 5999],
      ]) {
        const v = { ...mockVendor, id: `v-${plan}`, subscriptionPlan: plan };
        jest.spyOn(storeService, 'getVendorById').mockReturnValue(v);
        const mockLinks = [
          { id: `lnk-${plan}-1`, amount: 5000, status: 'PAID' },
          { id: `lnk-${plan}-2`, amount: 2000, status: 'EXPIRED' },
          { id: `lnk-${plan}-3`, amount: 1000, status: 'REFUNDED' },
          { id: `lnk-${plan}-4`, amount: 3000, status: 'CREATED' },
        ];
        jest.spyOn(storeService, 'getPaymentLinksForVendor').mockResolvedValue(mockLinks);
        jest.spyOn(zohoReconciliationService, 'reconcilePendingLinks').mockResolvedValue(1);

        const req = { user: adminUser, params: { id: `v-${plan}` } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await vendorDossierExtensions.getVendorPaymentHistory(req, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: true,
            summary: expect.objectContaining({
              totalAmountPaid: expectedBase + 5000,
              failedPayments: 1,
              pendingPayments: 1,
              totalRefundedAmount: 1000,
            }),
            payments: expect.any(Array),
          })
        );
      }
    });

    test('returns 404 if vendor cannot be resolved', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      const req = { user: adminUser, params: { id: 'unknown-vendor' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorPaymentHistory(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('handles exceptions by delegating to next(err)', async () => {
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Payment error');
      });
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const next = jest.fn();
      await vendorDossierExtensions.getVendorPaymentHistory(req, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('branch edge-case coverage for vendorDossierExtensions', () => {
    test('assertCategoryManagerOrVendor handles vendorEmail as string', () => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const ok = vendorDossierExtensions.assertCategoryManagerOrVendor(
        { user: { role: 'vendor', email: 'v@test.com' } },
        res,
        'v@test.com'
      );
      expect(ok).toBe(true);

      const rejected = vendorDossierExtensions.assertCategoryManagerOrVendor(
        { user: { role: 'vendor', email: 'v@test.com' } },
        res,
        'different@test.com'
      );
      expect(rejected).toBe(false);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('resolveVendor falls back to DB query by user email', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockImplementation((idOrEmail) => {
        if (idOrEmail === 'fallback@vendor.com') {
          return Promise.resolve({ id: 'v-fallback', email: 'fallback@vendor.com' });
        }
        return Promise.resolve(null);
      });

      const vendor = await vendorDossierExtensions.resolveVendor('missing-id', {
        role: 'vendor',
        email: 'fallback@vendor.com',
      });
      expect(vendor).toEqual(expect.objectContaining({ id: 'v-fallback' }));
    });

    test('getCreditHistory handles zero allocation, empty unlocked IDs, and depleted running balance', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({ id: 'v-edge', name: 'Edge Vendor' });
      jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
        vendorId: 'v-edge',
        freeCreditsAllocated: 0,
        freeCreditsUsed: 0,
        unlockedRfqIds: ['rfq-1', 'rfq-2'],
      });
      let recordCallCount = 0;
      jest.spyOn(domainQueries, 'recordCreditTransactionInDB').mockImplementation(async () => {
        recordCallCount += 1;
      });
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'tx-untyped', amount: 0 },
          { id: 'tx-unlock-positive', transaction_type: 'RFQ_UNLOCK', amount: 1 },
          { id: 'tx-negative-no-unlock', transaction_type: 'FEE', amount: -2 },
        ]);

      const req = { user: adminUser, params: { id: 'v-edge' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            subscriptionPlan: 'Free Tier',
            totalCreditsConsumed: 3,
          }),
        })
      );
    });

    test('getVendorCommunications handles missing getRFQs method and non-onboarding existing comms', async () => {
      const origGetRFQs = storeService.getRFQs;
      storeService.getRFQs = undefined;
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([
        { id: 'c-1', subject: 'Invoice Payment Notice' },
      ]);
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-no-contact',
        name: '',
        contactPerson: '',
        email: '',
      });

      const req = { user: adminUser, params: { id: 'v-no-contact' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorCommunications(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      storeService.getRFQs = origGetRFQs;
    });

    test('recordVendorCommunication handles phone recipient fallback and empty body fields', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-phone-only',
        phone: '+919999999999',
      });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'rec-p' });
      const req = { user: adminUser, params: { id: 'v-phone-only' }, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(req, res, jest.fn());

      expect(recordSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          recipient: '+919999999999',
        })
      );
    });

    test('getVendorPaymentHistory handles zero reconciled links, missing plan, and various link statuses', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({
        id: 'v-no-plan',
      });
      jest.spyOn(zohoReconciliationService, 'reconcilePendingLinks').mockResolvedValue(0);
      jest.spyOn(storeService, 'getPaymentLinksForVendor').mockResolvedValue([
        { id: 'l-in-prog', status: 'IN_PROGRESS', amount: 500 },
        { id: 'l-expired', status: 'EXPIRED', amount: 300 },
      ]);

      const req = { user: adminUser, params: { id: 'v-no-plan' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorPaymentHistory(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            failedPayments: 1,
            pendingPayments: 1,
          }),
        })
      );
    });

    test('recordVendorCommunication handles nextFollowupDate and task creation failure branches', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-v-followup-1' });

      const vendor = {
        id: 'v-followup',
        companyName: 'Vendor Followup Inc',
        email: 'supplier@followup.com',
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendor);

      // 1. Success with nextFollowupDate and full fields
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask')
        .mockResolvedValueOnce({ id: 'vtask-completed-1', status: 'Completed' })
        .mockResolvedValueOnce({ id: 'vtask-followup-1', status: 'Pending' });

      const req = {
        user: { ...adminUser, uuid: 'u-2', fullName: 'Vendor CM' },
        params: { id: 'v-followup' },
        body: {
          channel: 'CALL',
          recipient: '9876543210',
          subject: 'Delivery Timeline',
          message: 'Discussed expedited delivery',
          callOutcome: 'Connected',
          duration: '15 mins',
          nextFollowupDate: '2026-11-12T10:00:00.000Z',
          followupPriority: 'High',
          followupAssigneeId: 'exec-2',
          followupAssigneeName: 'Navin Chaudhary',
          followupNotes: 'Check shipping manifest',
        },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        completedTask: expect.objectContaining({ id: 'vtask-completed-1' }),
        followupTask: expect.objectContaining({ id: 'vtask-followup-1' }),
      }));

      // 2. Exception in completed task creation and followup task creation handled gracefully
      taskSpy
        .mockRejectedValueOnce(new Error('Vendor task DB failure 1'))
        .mockRejectedValueOnce(new Error('Vendor task DB failure 2'));

      const resErr = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(req, resErr, jest.fn());
      expect(resErr.status).toHaveBeenCalledWith(201);
      expect(resErr.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        completedTask: null,
        followupTask: null,
      }));

      // 3. Cover WHATSAPP, SMS, and fallback actor/vendor labels
      const fallbackVendor = { id: 'v-fallback', name: 'Fallback Name Vendor' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(fallbackVendor);
      taskSpy
        .mockResolvedValueOnce({ id: 'vtask-wa-comp' })
        .mockResolvedValueOnce({ id: 'vtask-wa-fol' })
        .mockResolvedValueOnce({ id: 'vtask-sms-comp' })
        .mockResolvedValueOnce({ id: 'vtask-sms-fol' });

      const reqWA = {
        user: { role: 'admin', id: 'actor-id-only', email: 'cm.actor@procucev.com' },
        params: { id: 'v-fallback' },
        body: {
          channel: 'WHATSAPP',
          nextFollowupDate: '2026-11-20T10:00:00.000Z',
        },
      };
      const resWA = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(reqWA, resWA, jest.fn());
      expect(resWA.status).toHaveBeenCalledWith(201);

      const reqSMS = {
        user: { role: 'admin', id: 'actor-id-only', name: 'CM Person' },
        params: { id: 'v-fallback' },
        body: {
          channel: 'SMS',
          nextFollowupDate: '2026-11-20T10:00:00.000Z',
        },
      };
      const resSMS = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(reqSMS, resSMS, jest.fn());
      expect(resSMS.status).toHaveBeenCalledWith(201);
    });

    test('recordVendorCommunication dispatches external EMAIL and SMS with error handling', async () => {
      const mailerService = require('../src/services/mailerService');
      const smsService = require('../src/services/smsService');
      const testVendor = { id: 'v-comm-dispatch', name: 'Comm Vendor', email: 'vcomm@example.com', phone: '9157154504' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(testVendor);
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-db-1' });
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'task-comp-1' });

      // EMAIL success & catch
      const deliverSpy = jest.spyOn(mailerService, 'deliver').mockImplementation(() => Promise.reject(new Error('SMTP down')));
      const reqEmail = {
        user: { role: 'admin', id: 'admin-1', email: 'admin@procucev.com' },
        params: { id: 'v-comm-dispatch' },
        body: {
          channel: 'EMAIL',
          recipient: 'vcomm@example.com',
          subject: 'Test Subject',
          message: 'Test message body',
        },
      };
      const resEmail = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(reqEmail, resEmail, jest.fn());
      expect(deliverSpy).toHaveBeenCalled();
      expect(resEmail.status).toHaveBeenCalledWith(201);

      // SMS success & catch
      const smsSpy = jest.spyOn(smsService, 'sendActionCenterSms').mockImplementation(() => Promise.reject(new Error('SMS gateway down')));
      const reqSms = {
        user: { role: 'admin', id: 'admin-1', email: 'admin@procucev.com' },
        params: { id: 'v-comm-dispatch' },
        body: {
          channel: 'SMS',
          recipient: '9157154504',
          message: 'Action needed immediately',
        },
      };
      const resSms = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(reqSms, resSms, jest.fn());
      expect(smsSpy).toHaveBeenCalled();
      expect(resSms.status).toHaveBeenCalledWith(201);

      // EMAIL synchronous throw catch
      deliverSpy.mockImplementationOnce(() => { throw new Error('Synchronous mailer failure'); });
      await vendorDossierExtensions.recordVendorCommunication(reqEmail, resEmail, jest.fn());

      // SMS synchronous throw catch
      smsSpy.mockImplementationOnce(() => { throw new Error('Synchronous SMS failure'); });
      await vendorDossierExtensions.recordVendorCommunication(reqSms, resSms, jest.fn());

      deliverSpy.mockRestore();
      smsSpy.mockRestore();
    });
  });
});

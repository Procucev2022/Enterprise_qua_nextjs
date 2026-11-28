const vendorDossierExtensions = require('../src/controllers/vendorDossierExtensions');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const paymentDuesQueries = require('../src/db/paymentDuesQueries');
const pool = require('../src/db/pool');
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
    test('getVendorCommunications returns persisted communication records unchanged', async () => {
      const existingOnboarding = { id: 'c-onb', subject: 'Supplier Network Onboarding' };
      const existingRfq = { id: 'comm-vrfq-rfq-1-0' };
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([existingOnboarding, existingRfq]);
      const getRfqs = jest.spyOn(storeService, 'getRFQs');
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorCommunications(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [existingOnboarding, existingRfq] });
      expect(getRfqs).not.toHaveBeenCalled();
    });

    test('getVendorCommunications returns empty history when no persisted communication exists', async () => {
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([]);
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorCommunications(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
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

    test('recordVendorCommunication handles fallback fields and phone recipients for a named staff user', async () => {
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'rec-2' });
      const phoneVendor = { id: 'v-phone', phone: '+919988776655' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(phoneVendor);

      const reqNoEmail = {
        user: { role: 'category_manager', name: 'Category Manager' },
        params: { id: 'v-phone' },
        body: {},
      };
      const resNoEmail = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication(reqNoEmail, resNoEmail, jest.fn());
      expect(resNoEmail.status).toHaveBeenCalledWith(201);
    });

    test('recordVendorCommunication rejects a session that identifies no user with 401', async () => {
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'rec-none' });
      jest.spyOn(storeService, 'getVendorById').mockReturnValue({ id: 'v-phone', phone: '+919988776655' });

      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.recordVendorCommunication({
        user: { role: 'category_manager' },
        params: { id: 'v-phone' },
        body: {},
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(recordSpy).not.toHaveBeenCalled();
    });

    test('getVendorCommunications does not infer history from RFQ assignments or quotes', async () => {
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([]);
      const getRfqs = jest.spyOn(storeService, 'getRFQs').mockReturnValue([
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
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
      expect(getRfqs).not.toHaveBeenCalled();
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
            totalSuccessfulPayments: 1,
            pendingPayments: 1,
          }),
        })
      );
    });
  });

  describe('getVendorPaymentHistory', () => {
    test('returns payment summary from provider payment links only across plans', async () => {
      for (const plan of ['connect', 'premium', 'select', 'Preferred Partner']) {
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
              totalAmountPaid: 5000,
              totalSuccessfulPayments: 1,
              failedPayments: 1,
              pendingPayments: 1,
              totalRefundedAmount: 1000,
            }),
            payments: expect.arrayContaining([expect.objectContaining({ id: `lnk-${plan}-1`, status: 'PAID' })]),
          })
        );
        expect(res.json.mock.calls[0][0].payments).toHaveLength(4);
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
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({
        id: 'comm-db-1',
        notificationStatus: 'Delivery Pending',
        deliveryStatus: 'Pending',
        acknowledgementStatus: 'Delivery Pending',
      });
      const deliveryStatusSpy = jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus')
        .mockImplementation(async (status) => ({ id: 'comm-db-1', ...status }));
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
      expect(deliveryStatusSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        communicationId: 'comm-db-1',
        notificationStatus: 'Failed',
        deliveryStatus: 'Failed',
        acknowledgementStatus: 'Failed',
      }));
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

      deliverSpy.mockResolvedValueOnce({ sent: true, messageId: 'supplier-email-provider-1' });
      await vendorDossierExtensions.recordVendorCommunication(reqEmail, resEmail, jest.fn());
      expect(deliveryStatusSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        communicationId: 'comm-db-1',
        notificationStatus: 'Notification Sent',
        deliveryStatus: 'Delivered',
        acknowledgementStatus: 'Acknowledgement Pending',
      }));

      smsSpy.mockResolvedValueOnce({ success: true, messageId: 'supplier-sms-provider-1' });
      await vendorDossierExtensions.recordVendorCommunication(reqSms, resSms, jest.fn());
      expect(deliveryStatusSpy).toHaveBeenLastCalledWith(expect.objectContaining({
        communicationId: 'comm-db-1',
        notificationStatus: 'Notification Sent',
        deliveryStatus: 'Delivered',
        acknowledgementStatus: 'Acknowledgement Pending',
      }));

      const { logger } = require('../src/services/loggerService');
      jest.spyOn(logger, 'error').mockImplementation(() => {});
      deliveryStatusSpy.mockRejectedValueOnce(Object.assign(new Error('D1 unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' }));
      deliverSpy.mockResolvedValueOnce({ sent: true, messageId: 'supplier-email-provider-2' });
      await vendorDossierExtensions.recordVendorCommunication(reqEmail, resEmail, jest.fn());
      expect(resEmail.json).toHaveBeenLastCalledWith(expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'Pending', acknowledgementStatus: 'Delivery Pending' }),
      }));
      expect(logger.error).toHaveBeenCalledWith(
        'Supplier dossier delivery result could not be saved; communication remains pending',
        expect.objectContaining({ communicationId: 'comm-db-1', providerAccepted: true }),
        'VENDOR_CONTROLLER'
      );

      // EMAIL synchronous throw catch
      deliverSpy.mockImplementationOnce(() => { throw new Error('Synchronous mailer failure'); });
      await vendorDossierExtensions.recordVendorCommunication(reqEmail, resEmail, jest.fn());

      // SMS synchronous throw catch
      smsSpy.mockImplementationOnce(() => { throw new Error('Synchronous SMS failure'); });
      await vendorDossierExtensions.recordVendorCommunication(reqSms, resSms, jest.fn());

      deliverSpy.mockRestore();
      smsSpy.mockRestore();
    });

    test('recordVendorCommunication dispatches configured SMS only through durable recovery', async () => {
      const eventOutboxService = require('../src/services/eventOutboxService');
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({
        id: 'vendor-durable-sms-1', deliveryStatus: 'Pending',
      });
      jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
        id: 'vendor-durable-sms-1', deliveryStatus: 'Delivered',
      });
      const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ completed: 1 });
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'vendor-sms-task' });
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication');
      const smsService = require('../src/services/smsService');
      const directSendSpy = jest.spyOn(smsService, 'sendActionCenterSms');
      const req = {
        user: adminUser,
        params: { id: 'v-test-1' },
        body: { channel: 'SMS', recipient: 'invalid', subject: 'Profile update', message: 'Details' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.recordVendorCommunication(req, res, jest.fn());

      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
        recipient: mockVendor.phone,
        metadata: expect.objectContaining({
          deliveryRecipientName: mockVendor.companyName || mockVendor.name,
          deliveryEntityType: 'supplier_dossier',
        }),
      }));
      expect(dispatchSpy).toHaveBeenCalledWith(1);
      expect(directSendSpy).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'Delivered' }),
      }));
    });

    test('recordVendorCommunication retains default subject when durable email has no subject or actor email', async () => {
      const eventOutboxService = require('../src/services/eventOutboxService');
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({
        id: 'vendor-durable-email-defaults', deliveryStatus: 'Pending',
      });
      jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
        id: 'vendor-durable-email-defaults', deliveryStatus: 'Delivered',
      });
      jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ completed: 1 });
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'vendor-email-task' });
      const req = {
        user: { role: 'admin', id: 'admin-without-email', name: 'Platform Admin' },
        params: { id: 'v-test-1' },
        body: { channel: 'EMAIL', message: 'Details' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.recordVendorCommunication(req, res, jest.fn());

      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
        recipient: mockVendor.email,
        metadata: expect.objectContaining({
          deliveryEmailSubject: '[Procucev] Supplier Communication',
        }),
      }));
      expect(recordSpy.mock.calls[0][0].metadata).not.toHaveProperty('deliveryReplyTo');
    });

    test('getCreditHistory handles DB error and falls back to rfqDownloadsUsed when freeCreditsUsed is zero', async () => {
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockRejectedValueOnce(new Error('DB connection reset'));
      jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
        vendorId: 'v-test-1',
        freeCreditsAllocated: 15,
        freeCreditsUsed: 0,
        freeCreditsRemaining: 10,
        isSubscribed: true,
        subscriptionPlan: 'connect',
      });
      const vendorWithDownloads = { ...mockVendor, rfqDownloadsUsed: 5 };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendorWithDownloads);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendorWithDownloads);

      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        summary: expect.objectContaining({
          totalCreditsConsumed: 5,
        }),
      }));
    });

    test('getVendorCommunications handles DB error gracefully and returns empty array', async () => {
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockRejectedValue(new Error('Comms DB down'));
      const req = { user: adminUser, params: { id: 'v-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.getVendorCommunications(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    test('getCreditHistory exercises free tier vendor balance and contactEmail/mobile communication paths', async () => {
      const freeVendor = {
        id: 'v-free-1',
        name: 'Free Vendor',
        email: 'free@test.com',
        contactEmail: 'contact@test.com',
        phone: '+919876543210',
        mobile: '+919876543211',
        mobileNumber: '+919876543212',
        subscriptionPlan: 'free',
        freeQuotationCredits: 4,
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(freeVendor);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(freeVendor);
      jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
        vendorId: 'v-free-1',
        freeCreditsAllocated: 5,
        freeCreditsUsed: 1,
        freeCreditsRemaining: undefined,
        isSubscribed: false,
      });
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockResolvedValue([
        { id: 'tx-f1', transaction_type: 'RFQ_UNLOCK', amount: -1, balance_after: 3 },
      ]);
      const commHistorySpy = jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([]);

      const req = { user: adminUser, params: { id: 'v-free-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        summary: expect.objectContaining({
          isSubscribed: false,
          currentCreditBalance: 4,
        }),
      }));

      const resComm = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getVendorCommunications(req, resComm, jest.fn());
      expect(commHistorySpy).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          emails: expect.arrayContaining(['free@test.com', 'contact@test.com']),
          phones: expect.arrayContaining(['+919876543210', '+919876543211', '+919876543212']),
        })
      );
    });

    test('requestCreditApproval covers Discounts, Trial Periods, and Offline Payments requestType branches', async () => {
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      const createTaskSpy = jest.spyOn(internalTaskQueries, 'createInternalTaskWithApproval').mockResolvedValue({
        id: 'task-test',
        task_number: 'TASK-001',
      });

      // Discounts with discountPercentage
      const reqDiscount = {
        user: cmUser,
        params: { id: 'v-test-1' },
        body: { requestType: 'Discounts', discountPercentage: 15, approverName: 'Srinu Sir' },
      };
      const resDiscount = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.requestCreditApproval(reqDiscount, resDiscount, jest.fn());
      expect(resDiscount.status).toHaveBeenCalledWith(201);
      expect(createTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskType: 'Discounts' }),
        expect.anything(),
        expect.objectContaining({ value_impact: '15% Subscription Discount (Alpha Supplier Ltd)' })
      );

      // Discounts fallback to amount
      const reqDiscountAmt = {
        user: cmUser,
        params: { id: 'v-test-1' },
        body: { requestType: 'Discount', amount: 20, approverName: 'Srinu Sir' },
      };
      const resDiscountAmt = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.requestCreditApproval(reqDiscountAmt, resDiscountAmt, jest.fn());
      expect(createTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskType: 'Discounts' }),
        expect.anything(),
        expect.objectContaining({ value_impact: '20% Subscription Discount (Alpha Supplier Ltd)' })
      );

      // Trial Periods with durationDays
      const reqTrial = {
        user: cmUser,
        params: { id: 'v-test-1' },
        body: { requestType: 'Trial Periods', durationDays: 45, approverName: 'Srinu Sir' },
      };
      const resTrial = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.requestCreditApproval(reqTrial, resTrial, jest.fn());
      expect(createTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskType: 'Trial Periods' }),
        expect.anything(),
        expect.objectContaining({ value_impact: '45 Days Free Trial (Alpha Supplier Ltd)' })
      );

      // Offline Payments with paymentReference and Cash
      const reqOffline = {
        user: cmUser,
        params: { id: 'v-test-1' },
        body: { requestType: 'Offline Payments', paymentAmount: 5000, amount: 5000, paymentReference: 'REF123', approverName: 'Srinu Sir' },
      };
      const resOffline = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.requestCreditApproval(reqOffline, resOffline, jest.fn());
      expect(resOffline.status).toHaveBeenCalledWith(201);
      expect(createTaskSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskType: 'Offline Payments' }),
        expect.anything(),
        expect.anything()
      );

      // Offline Payments with Cash paymentType
      const reqCash = {
        user: cmUser,
        params: { id: 'v-test-1' },
        body: { requestType: 'Offline Payments', paymentAmount: 3000, amount: 3000, paymentType: 'Cash', approverName: 'Srinu Sir' },
      };
      const resCash = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.requestCreditApproval(reqCash, resCash, jest.fn());
      expect(resCash.status).toHaveBeenCalledWith(201);
    });

    test('getSellerBuyerUploads exercises matchesVendorBuyer across all linkage branches', async () => {
      const vendorLinked = {
        id: 'v-linked',
        name: 'Linked Supplier',
        buyerId: 'b-id-1',
        buyerAccountId: 'b-acc-2',
        buyerEmail: 'buyer3@test.com',
        addedByBuyerCompany: 'Org Four',
        subscriptionPlan: 'connect',
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendorLinked);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendorLinked);

      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([
        { id: 'b-id-1', organizationName: 'Org One', corporateEmail: 'buyer1@test.com' },
        { id: 'b-acc-2', organizationName: 'Org Two', corporateEmail: 'buyer2@test.com' },
        { id: 'b-other-3', organizationName: 'Org Three', corporateEmail: 'buyer3@test.com' },
        { id: 'b-other-4', organizationName: 'Org Four', corporateEmail: 'buyer4@test.com' },
        { id: 'b-unrelated', organizationName: 'Unrelated Org', corporateEmail: 'unrelated@test.com' },
        null,
      ]);

      const req = { user: adminUser, params: { id: 'v-linked' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.getSellerBuyerUploads(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.arrayContaining([
          expect.objectContaining({ id: 'b-id-1' }),
          expect.objectContaining({ id: 'b-acc-2' }),
          expect.objectContaining({ id: 'b-other-3' }),
          expect.objectContaining({ id: 'b-other-4' }),
        ]),
      }));
    });

    test('getSellerBuyerUploads falls back to synthesizing client when buyerMap is empty', async () => {
      const vendorSynth = {
        id: 'v-synth',
        name: 'Direct Supplier',
        addedByBuyerCompany: 'Direct Enterprise Corp',
        buyerEmail: 'corp@enterprise.com',
        city: 'Bengaluru',
        state: 'Karnataka',
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendorSynth);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendorSynth);
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([]);

      const req = { user: adminUser, params: { id: 'v-synth' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.getSellerBuyerUploads(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        count: 1,
        data: [expect.objectContaining({ companyName: 'Direct Enterprise Corp', location: 'Bengaluru, Karnataka' })],
      }));

      // Test without buyerEmail and without state
      const vendorCityOnly = {
        id: 'v-city-only',
        name: 'City Only Vendor',
        addedByBuyerCompany: 'City Enterprise',
        city: 'Mumbai',
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendorCityOnly);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendorCityOnly);

      const resCity = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.getSellerBuyerUploads(req, resCity, jest.fn());
      expect(resCity.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: [expect.objectContaining({ companyName: 'City Enterprise', contactPerson: 'Procurement Contact', location: 'Mumbai' })],
      }));
    });

    test('getSellerActiveRFQs filters closed/expired RFQs and matches active category RFQs', async () => {
      const vendorRfqs = {
        id: 'v-rfq-match',
        name: 'Industrial Vendor',
        majorCategory: 'Industrial Machinery',
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendorRfqs);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendorRfqs);
      jest.spyOn(storeService, 'vendorCoversCategory').mockImplementation((v, cat) => cat === 'Industrial Machinery');
      storeService._vendorCoversRFQCategories = jest.fn().mockImplementation((v, rfq) => rfq.id === 'rfq-helper-matched');

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const pastDate = new Date(Date.now() - 86400000).toISOString();

      storeService.rfqs = [
        null,
        { id: 'rfq-closed', status: 'Closed', category: 'Industrial Machinery' },
        { id: 'rfq-expired', status: 'Open', closingDate: pastDate, category: 'Industrial Machinery' },
        {
          id: 'rfq-matched-1',
          rfqNumber: 'RFQ-001',
          title: 'Lathe Machine',
          category: 'Industrial Machinery',
          status: 'Quotes Pending',
          closingDate: futureDate,
        },
        {
          id: 'rfq-matched-2',
          category: 'Other',
          status: 'Active',
          closingDate: null,
          extractedEntities: [{ majorCategory: 'Industrial Machinery' }],
        },
        {
          id: 'rfq-helper-matched',
          category: 'Helper Category',
          status: 'Active',
          closingDate: null,
        },
      ];

      const req = { user: adminUser, params: { id: 'v-rfq-match' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await vendorDossierExtensions.getSellerActiveRFQs(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        count: 3,
        data: expect.arrayContaining([
          expect.objectContaining({ id: 'rfq-matched-1' }),
          expect.objectContaining({ id: 'rfq-matched-2' }),
          expect.objectContaining({ id: 'rfq-helper-matched' }),
        ]),
      }));

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        count: 3,
        data: expect.arrayContaining([
          expect.objectContaining({ id: 'rfq-matched-1' }),
          expect.objectContaining({ id: 'rfq-matched-2' }),
        ]),
      }));
    });

    test('addQuoteCredits validates amount and handles balance fallbacks', async () => {
      const vendorNoBal = {
        id: 'v-no-bal',
        name: 'Vendor No Bal',
      };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(vendorNoBal);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(vendorNoBal);
      jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
        vendorId: 'v-no-bal',
        isSubscribed: false,
        freeCreditsRemaining: undefined,
      });
      jest.spyOn(storeService, 'updateVendor').mockReturnValue(true);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      // Validation failure for invalid amount
      const reqInvalid = {
        user: cmUser,
        params: { id: 'v-no-bal' },
        body: { amount: 10 }, // Schema limit is between 1 and 5
      };
      const resInvalid = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.addQuoteCredits(reqInvalid, resInvalid, jest.fn());
      expect(resInvalid.status).toHaveBeenCalledWith(400);

      // Successful addition with fallback balance
      const reqValid = {
        user: cmUser,
        params: { id: 'v-no-bal' },
        body: { amount: 3, reason: 'Special promo' },
      };
      const resValid = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await vendorDossierExtensions.addQuoteCredits(reqValid, resValid, jest.fn());
      expect(resValid.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        updatedBalance: 8, // 5 default + 3
      }));
    });
  });
});

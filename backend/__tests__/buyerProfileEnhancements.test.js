const buyerAccountController = require('../src/controllers/buyerAccountController');
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

describe('buyerProfileEnhancements & buyerAccountController 360 Dossier APIs', () => {
  const buyerUser = { email: 'buyer@test.com', role: 'buyer', sub: 'buyer-sub-1' };
  const adminUser = { email: 'admin@test.com', role: 'admin', sub: 'admin-sub-1' };
  const vendorUser = { email: 'vendor@test.com', role: 'vendor', sub: 'vendor-sub-1' };

  let mockBuyer;

  beforeEach(() => {
    mockBuyer = {
      id: 'buyer-test-1',
      organizationName: 'Test Buyer Corp',
      corporateEmail: 'buyer@test.com',
      sourcingMode: 'mode_1',
      subscriptionPlan: 'growth',
      remainingFreeRFQs: 4,
      supportedMajorCategories: ['General Procurement'],
      createdDate: '2026-03-01T10:00:00.000Z',
    };

    jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([mockBuyer]);
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(mockBuyer);
    jest.spyOn(storeService, 'updateBuyerAccount').mockImplementation((id, data) => ({
      ...mockBuyer,
      ...data,
    }));
    jest.spyOn(storeService, 'addAuditLog').mockImplementation(() => {});
    jest.spyOn(storeService, 'getRFQs').mockReturnValue([
      {
        id: 'rfq-1',
        rfqNumber: 'RFQ-001',
        title: 'Precision Machining',
        buyerAccountId: 'buyer-test-1',
        sourcingMode: 'mode_1',
        createdAt: '2026-03-02T10:00:00.000Z',
        assignedVendors: [{ id: 'v1' }],
        quotes: [{ totalPrice: 50000 }],
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('addCredit', () => {
    test('rejects buyer and non-admin/non-category-manager users', async () => {
      const reqVendor = { user: vendorUser, params: { id: 'buyer-test-1' }, body: { amount: 5 } };
      const resVendor = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.addCredit(reqVendor, resVendor, jest.fn());
      expect(resVendor.status).toHaveBeenCalledWith(403);

      const reqBuyer = { user: buyerUser, params: { id: 'buyer-test-1' }, body: { amount: 5 } };
      const resBuyer = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.addCredit(reqBuyer, resBuyer, jest.fn());
      expect(resBuyer.status).toHaveBeenCalledWith(403);
    });

    test('rejects unauthenticated users in addCredit', async () => {
      const reqNoUser = { params: { id: 'buyer-test-1' }, body: { amount: 5 } };
      const resNoUser = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.addCredit(reqNoUser, resNoUser, jest.fn());
      expect(resNoUser.status).toHaveBeenCalledWith(401);
    });

    test('rejects buyer accessing another buyer account (BOLA prevention)', async () => {
      const otherBuyer = { email: 'other@buyer.com', role: 'buyer', sub: 'other-sub' };
      const req = { user: otherBuyer, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.getCreditHistory(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('rejects invalid or zero/negative credit amount', async () => {
      const req = { user: adminUser, params: { id: 'buyer-test-1' }, body: { amount: -2 } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.addCredit(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    test('returns 404 when buyer account does not exist', async () => {
      const req = { user: adminUser, params: { id: 'buyer-non-existent' }, body: { amount: 5 } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.addCredit(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('successfully adds credits, records transaction, and updates balance', async () => {
      jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({ id: 'ctx-1' });

      const req = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { amount: 5, reason: 'Special allocation', source: 'Manual Topup' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.addCredit(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            previousBalance: 4,
            updatedBalance: 9,
          }),
        })
      );
    });

    test('handles exceptions by delegating to next(err)', async () => {
      jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockRejectedValue(new Error('DB failure'));

      const req = { user: adminUser, params: { id: 'buyer-test-1' }, body: { amount: 5 } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.addCredit(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('updateSupportedCategories', () => {
    test('rejects non-array categories', async () => {
      const req = { user: adminUser, params: { id: 'buyer-test-1' }, body: { categories: 'Invalid' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.updateSupportedCategories(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('returns 404 when buyer account not found', async () => {
      const req = { user: adminUser, params: { id: 'buyer-non-existent' }, body: { categories: ['Raw Materials'] } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.updateSupportedCategories(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('successfully updates categories, deduplicating entries', async () => {
      const req = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { categories: ['Raw Materials', 'Spares', 'Raw Materials', '  '] },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.updateSupportedCategories(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            supportedMajorCategories: ['Raw Materials', 'Spares'],
          }),
        })
      );
    });

    test('handles exceptions by delegating to next(err)', async () => {
      jest.spyOn(storeService, 'updateBuyerAccount').mockImplementation(() => {
        throw new Error('Store failure');
      });

      const req = { user: adminUser, params: { id: 'buyer-test-1' }, body: { categories: ['Spares'] } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.updateSupportedCategories(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getCreditHistory', () => {
    test('returns 404 if buyer account is missing', async () => {
      const req = { user: adminUser, params: { id: 'non-existent' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getCreditHistory(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('generates initial transactions and RFQ deductions when none recorded in DB', async () => {
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'ctx-init-1',
            credits_added: 5,
            credits_consumed: 0,
            transaction_type: 'Initial Free Credits Allocated',
            created_at: '2026-03-01T10:00:00.000Z',
          },
          {
            id: 'ctx-rfq-1',
            credits_added: 0,
            credits_consumed: 1,
            transaction_type: 'Credits Consumed',
            created_at: '2026-03-02T10:00:00.000Z',
          },
        ]);
      jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({ id: 'ok' });

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getCreditHistory(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            totalCreditsAllocated: expect.any(Number),
            remainingFreeCredits: 4,
          }),
          transactions: expect.any(Array),
        })
      );
    });

    test('parses existing DB transactions with purchased and adjusted types', async () => {
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB').mockResolvedValue([
        {
          id: 'ctx-purchased',
          creditsAdded: 10,
          creditsConsumed: 0,
          transactionType: 'Purchased Credits',
          createdAt: '2026-03-03T10:00:00.000Z',
        },
        {
          id: 'ctx-adj',
          creditsAdded: 2,
          creditsConsumed: 0,
          transactionType: 'Credit Adjustment',
          createdAt: '2026-03-04T10:00:00.000Z',
        },
      ]);

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getCreditHistory(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            purchasedCredits: 10,
            adjustedCredits: 2,
          }),
        })
      );
    });

    test('handles exceptions by delegating to next(err)', async () => {
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB').mockRejectedValue(new Error('DB read error'));

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getCreditHistory(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('getBuyerCommunications & recordBuyerCommunication', () => {
    test('getBuyerCommunications returns combined onboarding & rfq logs', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([
        { id: 'comm-db-1', channel: 'SMS', message: 'Hello' },
      ]);

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getBuyerCommunications(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.arrayContaining([
            expect.objectContaining({ id: 'comm-db-1' }),
            expect.objectContaining({ id: 'comm-reg-buyer-test-1' }),
          ]),
        })
      );
    });

    test('getBuyerCommunications returns 404 for unknown buyer', async () => {
      const req = { user: adminUser, params: { id: 'unknown-b' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getBuyerCommunications(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('recordBuyerCommunication saves message and returns 201', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({
        id: 'new-comm-1',
        channel: 'WHATSAPP',
      });

      const req = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { channel: 'WHATSAPP', recipient: '+919999999999', message: 'Test message' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.recordBuyerCommunication(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ id: 'new-comm-1' }),
        })
      );
    });

    test('recordBuyerCommunication returns 404 for missing buyer', async () => {
      const req = { user: adminUser, params: { id: 'unknown-b' }, body: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.recordBuyerCommunication(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('getBuyerPaymentHistory', () => {
    test('returns payment summary and list including initial plan and payment links', async () => {
      jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockResolvedValue([
        {
          id: 'plink-1',
          invoiceNumber: 'INV-PLINK-1',
          amount: 29999,
          status: 'paid',
          currency: 'INR',
          planId: 'version_2',
        },
        {
          id: 'plink-2',
          amount: 14999,
          status: 'pending',
          currency: 'INR',
        },
      ]);

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getBuyerPaymentHistory(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            totalAmountPaid: expect.any(Number),
            totalSuccessfulPayments: expect.any(Number),
            pendingPayments: expect.any(Number),
          }),
          payments: expect.any(Array),
        })
      );
    });

    test('falls back to lookup by email if buyer user calls without matching id', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([]);
      jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockResolvedValue([]);

      const req = { user: buyerUser, params: { id: 'non-matching-id' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getBuyerPaymentHistory(req, res, next);
      expect(storeService.getBuyerAccountByEmail).toHaveBeenCalledWith('buyer@test.com');
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('returns 404 when buyer cannot be resolved', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([]);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);

      const req = { user: adminUser, params: { id: 'unknown-id' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getBuyerPaymentHistory(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('domainQueries credit transaction helpers', () => {
    test('recordBuyerCreditTransactionInDB returns null if storage unavailable', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const result = await domainQueries.recordBuyerCreditTransactionInDB({ id: 'test' });
      expect(result).toBeNull();
    });

    test('recordBuyerCreditTransactionInDB executes query when storage available', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'tx-1' }] });

      const tx = {
        id: 'tx-1',
        buyerId: 'b-1',
        transactionType: 'Admin Credit Addition',
        creditsAdded: 5,
        updatedBalance: 10,
      };
      const result = await domainQueries.recordBuyerCreditTransactionInDB(tx);
      expect(result).toEqual({ id: 'tx-1' });
    });

    test('getBuyerCreditTransactionsFromDB returns empty array without storage or buyerId', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      expect(await domainQueries.getBuyerCreditTransactionsFromDB('b-1')).toEqual([]);
      expect(await domainQueries.getBuyerCreditTransactionsFromDB(null)).toEqual([]);
    });

    test('getBuyerCreditTransactionsFromDB queries with limit and without limit', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [{ id: 'tx-1' }, { id: 'tx-2' }] });

      const resWithLimit = await domainQueries.getBuyerCreditTransactionsFromDB('b-1', 20);
      expect(resWithLimit.length).toBe(2);

      const resNoLimit = await domainQueries.getBuyerCreditTransactionsFromDB('b-1', null);
      expect(resNoLimit.length).toBe(2);

      const resNegativeLimit = await domainQueries.getBuyerCreditTransactionsFromDB('b-1', -10);
      expect(resNegativeLimit.length).toBe(2);

      const resOverLimit = await domainQueries.getBuyerCreditTransactionsFromDB('b-1', 5000);
      expect(resOverLimit.length).toBe(2);

      const resInvalidLimit = await domainQueries.getBuyerCreditTransactionsFromDB('b-1', 'not-a-number');
      expect(resInvalidLimit.length).toBe(2);
    });
  });

  describe('additional buyerAccountController branches and functions', () => {
    test('assertCategoryManagerOrBuyer rejects when user is missing', () => {
      const req = {};
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      buyerAccountController.getCreditHistory(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('getCreditHistory falls back to email lookup when buyer not found by ID', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([]);
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(mockBuyer);
      const mixedTransactions = [
        { id: 'tx-1', transaction_type: 'Purchased Credits', credits_added: 10, credits_consumed: 0 },
        { id: 'tx-2', transaction_type: 'Credits Addition', credits_added: 5, credits_consumed: 0 },
        { id: 'tx-3', transaction_type: 'Adjustment Refund', credits_added: 2, credits_consumed: 0 },
        { id: 'tx-4', transaction_type: 'Credits Consumed', credits_added: 0, credits_consumed: 3 },
      ];
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB').mockResolvedValue(mixedTransactions);

      const req = { user: buyerUser, params: { id: 'other-id' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getCreditHistory(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            totalCreditsAllocated: 20,
            purchasedCredits: 10,
            adjustedCredits: 2,
            totalCreditsConsumed: 3,
            currentEntitlementMode: 'mode_1',
          }),
          transactions: expect.any(Array),
        })
      );
    });

    test('getCreditHistory handles missing createdDate, sourcingMode, and plan', async () => {
      const minimalBuyer = { id: 'b-min', corporateEmail: 'min@b.com' };
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([minimalBuyer]);
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({});
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([]);

      const req = { user: adminUser, params: { id: 'b-min' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getCreditHistory(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            remainingFreeCredits: 5,
            currentEntitlementMode: 'mode_0',
            currentSubscriptionPlan: 'free_trial',
          }),
        })
      );
    });

    test('getBuyerCommunications handles errors and calls next(err)', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockImplementation(() => {
        throw new Error('Store explosion');
      });

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getBuyerCommunications(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('recordBuyerCommunication handles errors and calls next(err)', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockRejectedValue(new Error('Record failed'));

      const req = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { channel: 'EMAIL', message: 'Hello' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.recordBuyerCommunication(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('getBuyerPaymentHistory calculates failed and refunded statuses properly', async () => {
      const mockLinks = [
        { id: 'lnk-1', amount: 1000, status: 'FAILED' },
        { id: 'lnk-2', amount: 2000, status: 'EXPIRED' },
        { id: 'lnk-3', amount: 3000, status: 'REFUNDED' },
        { id: 'lnk-4', amount: 4000, status: 'PENDING' },
      ];
      jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockResolvedValue(mockLinks);

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getBuyerPaymentHistory(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({
            failedPayments: 2,
            totalRefundedAmount: 3000,
            pendingPayments: 1,
          }),
        })
      );
    });

    test('getBuyerPaymentHistory calculates plan amounts for version_1, version_2, version_3, and free plans', async () => {
      for (const [plan, expectedAmt] of [
        ['version_1', 14999],
        ['version_2', 29999],
        ['version_3', 49999],
        ['custom_enterprise', 0],
      ]) {
        const customBuyer = {
          id: `b-${plan}`,
          corporateEmail: `${plan}@buyer.com`,
          subscriptionPlan: plan,
        };
        jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([customBuyer]);
        jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockResolvedValue([]);

        const req = { user: adminUser, params: { id: `b-${plan}` } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await buyerAccountController.getBuyerPaymentHistory(req, res, jest.fn());
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            summary: expect.objectContaining({
              totalAmountPaid: expectedAmt,
            }),
          })
        );
      }
    });

    test('getBuyerPaymentHistory handles errors and calls next(err)', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockImplementation(() => {
        throw new Error('Payment history failure');
      });

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getBuyerPaymentHistory(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('getPaymentLinks verifies role, reconciles, and returns links', async () => {
      const zohoReconciliationService = require('../src/services/zohoReconciliationService');
      const reqUnauthorized = { user: vendorUser, params: { id: 'buyer-test-1' } };
      const resUnauthorized = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.getPaymentLinks(reqUnauthorized, resUnauthorized, jest.fn());
      expect(resUnauthorized.status).toHaveBeenCalledWith(403);

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      const reqNoAccount = { user: buyerUser, params: { id: 'buyer-test-1' } };
      const resNoAccount = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.getPaymentLinks(reqNoAccount, resNoAccount, jest.fn());
      expect(resNoAccount.json).toHaveBeenCalledWith({ success: true, data: [] });

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(mockBuyer);
      jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockResolvedValue([{ id: 'pl-1', status: 'PENDING' }]);
      jest.spyOn(zohoReconciliationService, 'reconcilePendingLinks').mockResolvedValue(1);

      const reqOk = { user: buyerUser, params: { id: 'buyer-test-1' } };
      const resOk = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.getPaymentLinks(reqOk, resOk, jest.fn());
      expect(resOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockRejectedValue(new Error('Link error'));
      const nextErr = jest.fn();
      await buyerAccountController.getPaymentLinks(reqOk, resOk, nextErr);
      expect(nextErr).toHaveBeenCalledWith(expect.any(Error));
    });

    test('downloadInvoice handles authorization, missing links, and generates PDF', async () => {
      const invoiceService = require('../src/services/invoiceService');
      jest.spyOn(invoiceService, 'generateReceiptPdf').mockResolvedValue(Buffer.from('PDF_CONTENT'));

      const reqUnauthorized = { user: vendorUser, params: { id: 'buyer-test-1', linkId: 'l1' } };
      const resUnauthorized = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.downloadInvoice(reqUnauthorized, resUnauthorized, jest.fn());
      expect(resUnauthorized.status).toHaveBeenCalledWith(403);

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      const reqNoAccount = { user: buyerUser, params: { id: 'buyer-test-1', linkId: 'l1' } };
      const resNoAccount = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.downloadInvoice(reqNoAccount, resNoAccount, jest.fn());
      expect(resNoAccount.status).toHaveBeenCalledWith(404);

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(mockBuyer);
      jest.spyOn(storeService, 'getPaymentLinkById').mockResolvedValue(null);
      const reqNotFound = { user: buyerUser, params: { id: 'buyer-test-1', linkId: 'l1' } };
      const resNotFound = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.downloadInvoice(reqNotFound, resNotFound, jest.fn());
      expect(resNotFound.status).toHaveBeenCalledWith(404);

      jest.spyOn(storeService, 'getPaymentLinkById').mockResolvedValue({
        id: 'l1',
        payerType: 'buyer',
        buyerAccountId: 'buyer-test-1',
        planId: 'growth',
      });
      const reqOk = { user: buyerUser, params: { id: 'buyer-test-1', linkId: 'l1' } };
      const resOk = {
        setHeader: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await buyerAccountController.downloadInvoice(reqOk, resOk, jest.fn());
      expect(resOk.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(resOk.send).toHaveBeenCalledWith(expect.any(Buffer));

      jest.spyOn(storeService, 'getPaymentLinkById').mockRejectedValue(new Error('PDF generator failed'));
      const nextErr = jest.fn();
      await buyerAccountController.downloadInvoice(reqOk, resOk, nextErr);
      expect(nextErr).toHaveBeenCalledWith(expect.any(Error));
    });

    test('updateBuyerAccount validates subscriptionPlan update attempts', () => {
      const reqUnauthorized = { user: vendorUser, params: { id: 'buyer-test-1' }, body: {} };
      const resUnauthorized = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      buyerAccountController.updateBuyerAccount(reqUnauthorized, resUnauthorized, jest.fn());
      expect(resUnauthorized.status).toHaveBeenCalledWith(403);

      const reqInvalidPlan = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { subscriptionPlan: 'growth' },
      };
      const resInvalidPlan = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      buyerAccountController.updateBuyerAccount(reqInvalidPlan, resInvalidPlan, jest.fn());
      expect(resInvalidPlan.status).toHaveBeenCalledWith(400);

      const reqValidPlan = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { subscriptionPlan: 'free_trial' },
      };
      const resValidPlan = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      buyerAccountController.updateBuyerAccount(reqValidPlan, resValidPlan, jest.fn());
      expect(resValidPlan.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('getSubscriptionPricing returns config or handles errors', () => {
      const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
      buyerAccountController.getSubscriptionPricing({}, res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.any(Object) }));

      let threw = false;
      const badRes = {
        json: jest.fn().mockImplementation(() => {
          if (!threw) {
            threw = true;
            throw new Error('Response error');
          }
        }),
        status: jest.fn().mockReturnThis(),
      };
      buyerAccountController.getSubscriptionPricing({}, badRes);
      expect(badRes.status).toHaveBeenCalledWith(500);
    });

    test('getBuyerAccounts exercises query limit and store hydration branches', () => {
      const res = { json: jest.fn() };
      buyerAccountController.getBuyerAccounts({ query: { limit: '25' } }, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      buyerAccountController.getBuyerAccounts({ query: { limit: '9999' } }, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      buyerAccountController.getBuyerAccounts({ query: { limit: '-5' } }, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      const prevHydrated = storeService.isHydratedFromDB;
      storeService.isHydratedFromDB = true;
      buyerAccountController.getBuyerAccounts({ query: {} }, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ source: 'persisted' }));
      storeService.isHydratedFromDB = prevHydrated;
    });

    test('createSubscriptionPaymentLink exercises duration, missing phone fallback, and auto-creation', async () => {
      const zohoPaymentService = require('../src/services/zohoPaymentService');
      const identityQueries = require('../src/db/identityQueries');

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      jest.spyOn(storeService, 'addBuyerAccount').mockReturnValueOnce(null);

      const reqMissing = {
        user: { email: 'orphan@test.com', role: 'buyer', orgName: 'Orphan Corp' },
        params: { id: 'any-id' },
        body: { plan: 'version_1' },
      };
      const resMissing = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.createSubscriptionPaymentLink(reqMissing, resMissing, jest.fn());
      expect(resMissing.status).toHaveBeenCalledWith(404);

      // Auto-create on first use with fallback to identityQueries for phone
      const createdAccountNoPhone = { id: 'b-new', corporateEmail: 'new@buyer.com', mobileNumber: '' };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      jest.spyOn(storeService, 'addBuyerAccount').mockReturnValueOnce(createdAccountNoPhone);
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce(null);

      const reqNoPhone = {
        user: { email: 'new@buyer.com', role: 'buyer' },
        params: { id: 'b-new' },
        body: { plan: 'version_1' },
      };
      const resNoPhone = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.createSubscriptionPaymentLink(reqNoPhone, resNoPhone, jest.fn());
      expect(resNoPhone.status).toHaveBeenCalledWith(400);

      // Successfully resolve phone via identityQueries and duration via body.duration
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(createdAccountNoPhone);
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValueOnce({ mobile: '919876543210' });
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValue({
        zohoPaymentLinkId: 'zh-1',
        paymentUrl: 'https://pay.zoho.in/test',
        status: 'CREATED',
      });
      jest.spyOn(storeService, 'createPaymentLinkRecord').mockReturnValue({
        id: 'pl-test-1',
        paymentUrl: 'https://pay.zoho.in/test',
        status: 'CREATED',
        zohoPaymentLinkId: 'zh-1',
      });

      const reqDuration6 = {
        user: { email: 'new@buyer.com', role: 'buyer' },
        params: { id: 'b-new' },
        body: { plan: 'version_1', duration: '6_months' },
      };
      const resDuration6 = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.createSubscriptionPaymentLink(reqDuration6, resDuration6, jest.fn());
      expect(resDuration6.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ paymentLinkId: 'pl-test-1' }),
        })
      );
    });

    test('assertBuyerAccountRole handles missing user', () => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      buyerAccountController.createBuyerAccount({ body: {} }, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('aiCrossMatch runs vendor PO item category matching across categories', () => {
      const vendors = [
        { id: 'v-it', companyName: 'Cloud Microsoft Vendor', vendorCode: 'MSFT01' },
        { id: 'v-none', companyName: 'Unknown Corp', vendorCode: 'UNK01' },
      ];
      const poLineItems = [
        { vendorIdentifier: 'MSFT01', itemName: 'Azure Cloud License', totalSpend: 50000 },
        { vendorIdentifier: 'Other', itemName: 'Misc', totalSpend: 1000 },
      ];

      const req = {
        user: adminUser,
        body: { vendors, poLineItems },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      buyerAccountController.aiCrossMatch(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          totalMatched: 1,
          totalUnmatched: 1,
        })
      );
    });

    test('addCredit and updateSupportedCategories exercise fallback branches and undefined bodies', async () => {
      // addCredit with undefined body
      const reqEmptyBody = { user: adminUser, params: { id: 'buyer-test-1' } };
      const resEmptyBody = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.addCredit(reqEmptyBody, resEmptyBody, jest.fn());
      expect(resEmptyBody.status).toHaveBeenCalledWith(400);

      // addCredit with user without email and buyer without remainingFreeRFQs
      const buyerNoRemaining = { id: 'b-no-rem', organizationName: 'No Rem Corp', corporateEmail: 'n@b.com' };
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([buyerNoRemaining]);
      jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({ id: 'tx-new' });

      const reqNoEmail = {
        user: { role: 'category_manager' },
        params: { id: 'b-no-rem' },
        body: { amount: 3 },
      };
      const resNoEmail = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.addCredit(reqNoEmail, resNoEmail, jest.fn());
      expect(resNoEmail.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ previousBalance: 5, updatedBalance: 8 }),
        })
      );

      // updateSupportedCategories with user without email and empty body
      const reqCatEmpty = { user: { role: 'admin' }, params: { id: 'b-no-rem' } };
      const resCatEmpty = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.updateSupportedCategories(reqCatEmpty, resCatEmpty, jest.fn());
      expect(resCatEmpty.status).toHaveBeenCalledWith(400);

      const reqCatOk = {
        user: { role: 'admin' },
        params: { id: 'b-no-rem' },
        body: { categories: ['Spares', 'Spares', '   '] },
      };
      const resCatOk = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.updateSupportedCategories(reqCatOk, resCatOk, jest.fn());
      expect(resCatOk.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    test('getBuyerCommunications and recordBuyerCommunication exercise rich fallback branches', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      const existingOnboardingComm = {
        id: 'comm-1',
        subject: 'Enterprise Onboarding Initial Message',
      };
      const existingRfqComm = {
        id: 'comm-rfq-rfq-raw-0',
        subject: 'RFQ Dispatch',
      };
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([existingOnboardingComm, existingRfqComm]);

      const phoneBuyer = {
        id: 'b-phone',
        organizationName: 'Phone Buyer Org',
        phone: '+919876543210',
        createdDate: null,
      };
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([phoneBuyer]);
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([
        {
          id: 'rfq-raw',
          rfqNumber: null,
          title: null,
          sourcingMode: null,
          assignedVendors: null,
          createdAt: null,
          buyerAccountId: 'b-phone',
        },
      ]);

      const reqComms = { user: adminUser, params: { id: 'b-phone' } };
      const resComms = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.getBuyerCommunications(reqComms, resComms, jest.fn());
      expect(resComms.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // recordBuyerCommunication with empty body, fallback recipient from phone and caller without email
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-rec-1' });
      const reqRecEmpty = { user: { role: 'category_manager' }, params: { id: 'b-phone' } };
      const resRecEmpty = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.recordBuyerCommunication(reqRecEmpty, resRecEmpty, jest.fn());
      expect(resRecEmpty.status).toHaveBeenCalledWith(201);
    });

    test('getBuyerPaymentHistory exercises all link status mappings and minimal link fields', async () => {
      const bareBuyer = {
        id: 'b-bare',
        organizationName: 'Bare Org',
        subscriptionPlan: null,
        createdDate: null,
      };
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([bareBuyer]);
      const bareLinks = [
        { id: 'bl-1', status: 'IN_PROGRESS' },
        { id: 'bl-2', status: 'COMPLETED', amount: 5000 },
        { id: 'bl-3', status: null },
      ];
      jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockResolvedValue(bareLinks);

      const req = { user: adminUser, params: { id: 'b-bare' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.getBuyerPaymentHistory(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            totalSuccessfulPayments: 2,
            pendingPayments: 2,
          }),
        })
      );
    });

    test('getCreditHistory exercises v0 sourcing mode and email-matched RFQs', async () => {
      const emailBuyer = {
        id: 'b-email-match',
        corporateEmail: 'match@buyer.com',
        remainingFreeRFQs: 2,
      };
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([emailBuyer]);
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({});
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([
        {
          id: 'rfq-v0',
          rfqNumber: 'RFQ-V0-1',
          raisedByEmail: 'MATCH@BUYER.COM',
          sourcingMode: 'mode_0',
        },
        {
          id: 'rfq-v1',
          rfqNumber: 'RFQ-V1-1',
          raisedByEmail: 'MATCH@BUYER.COM',
          sourcingMode: 'mode_1',
        },
      ]);

      const req = { user: adminUser, params: { id: 'b-email-match' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.getCreditHistory(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            remainingFreeCredits: 2,
          }),
        })
      );
    });

    test('aiCrossMatch handles errors', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockImplementation(() => {
        throw new Error('Cross match error');
      });
      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();
      await buyerAccountController.aiCrossMatch(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('deleteBuyerAccount and setActiveAccount success paths', () => {
      jest.spyOn(storeService, 'deleteBuyerAccount').mockReturnValue(true);
      const reqDel = { user: adminUser, params: { id: 'buyer-test-1' } };
      const resDel = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      buyerAccountController.deleteBuyerAccount(reqDel, resDel, jest.fn());
      expect(resDel.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      jest.spyOn(storeService, 'alignActiveBuyerAccount').mockReturnValue(mockBuyer);
      const reqActive = { user: adminUser, params: { id: 'buyer-test-1' } };
      const resActive = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      buyerAccountController.setActiveAccount(reqActive, resActive, jest.fn());
      expect(resActive.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: mockBuyer }));
    });

    test('aiCrossMatch exercises all category branches (mechanical, electrical, civil, IT)', async () => {
      const vendors = [
        { companyName: 'Mech Vendor', vendorCode: 'V-MECH' },
        { companyName: 'Elec Vendor', vendorCode: 'V-ELEC' },
        { companyName: 'Civil Vendor', vendorCode: 'V-CIVIL' },
        { companyName: 'IT Data Vendor', vendorCode: 'V-DATA' },
        { companyName: 'Datacenter Server Vendor', vendorCode: 'V-DC' },
        { companyName: 'SaaS General Vendor', vendorCode: 'V-SAAS' },
        { companyName: 'Gen Vendor', vendorCode: 'V-GEN' },
        { companyName: 'Empty Vendor', vendorCode: '' },
      ];
      const poLineItems = [
        { vendorIdentifier: 'Mech Vendor', itemName: 'Centrifugal pump with valve and rubber hose and compressor and motor', totalSpend: 1500 },
        { vendorIdentifier: 'Elec Vendor', itemName: 'Electrical switchgear panel and mccb breaker cable', totalSpend: 2500 },
        { vendorIdentifier: 'Civil Vendor', itemName: 'Civil PEB structure and TMT steel rebar', totalSpend: 3500 },
        { vendorIdentifier: 'IT Data Vendor', itemName: 'Cloud bigquery data analytics platform with microsoft software', totalSpend: 4500 },
        { vendorIdentifier: 'Datacenter Server Vendor', itemName: 'datacenter server infrastructure', totalSpend: 5500 },
        { vendorIdentifier: 'SaaS General Vendor', itemName: 'generic saas tool', totalSpend: 800 },
        { vendorIdentifier: 'Gen Vendor', itemName: 'unclassified miscellaneous part', totalSpend: 6500 },
      ];

      const req = {
        user: adminUser,
        body: { vendors, poLineItems },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.aiCrossMatch(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          totalMatched: 7,
          totalUnmatched: 1,
        })
      );
    });
    test('assertCategoryManagerOrBuyer exercises all ownership branches', () => {
      const { assertCategoryManagerOrBuyer, assertCategoryManagerOrAdmin } = buyerAccountController;
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      // unauthenticated
      expect(assertCategoryManagerOrBuyer({ user: null }, res)).toBe(false);
      expect(assertCategoryManagerOrAdmin({ user: null }, res)).toBe(false);

      // other roles
      expect(assertCategoryManagerOrBuyer({ user: { role: 'vendor' } }, res)).toBe(false);
      expect(assertCategoryManagerOrAdmin({ user: { role: 'buyer' } }, res)).toBe(false);

      // admin / category_manager
      expect(assertCategoryManagerOrBuyer({ user: { role: 'admin' } }, res)).toBe(true);
      expect(assertCategoryManagerOrBuyer({ user: { role: 'category_manager' } }, res)).toBe(true);
      expect(assertCategoryManagerOrAdmin({ user: { role: 'admin' } }, res)).toBe(true);
      expect(assertCategoryManagerOrAdmin({ user: { role: 'category_manager' } }, res)).toBe(true);

      // buyer without targetBuyer
      expect(assertCategoryManagerOrBuyer({ user: { role: 'buyer' } }, res)).toBe(true);

      // buyer ownership branches
      const target = { id: 'b-1', corporateEmail: 'org@buyer.com', userId: 'u-1' };
      expect(assertCategoryManagerOrBuyer({ user: { role: 'buyer', email: 'ORG@BUYER.COM' } }, res, target)).toBe(true);
      expect(assertCategoryManagerOrBuyer({ user: { role: 'buyer', buyerAccountId: 'b-1' } }, res, target)).toBe(true);
      expect(assertCategoryManagerOrBuyer({ user: { role: 'buyer', orgId: 'b-1' } }, res, target)).toBe(true);
      expect(assertCategoryManagerOrBuyer({ user: { role: 'buyer', organizationId: 'b-1' } }, res, target)).toBe(true);
      expect(assertCategoryManagerOrBuyer({ user: { role: 'buyer', id: 'u-1' } }, res, target)).toBe(true);
      expect(assertCategoryManagerOrBuyer({ user: { role: 'buyer', id: 'b-1' } }, res, { id: 'b-1' })).toBe(true);
      expect(assertCategoryManagerOrBuyer({ user: { role: 'buyer', email: 'stranger@buyer.com' } }, res, target)).toBe(false);
    });
    test('getPaymentLinks with reconciled links and downloadInvoice fallback branches', async () => {
      const bAcc = { id: 'b-rec', corporateEmail: 'rec@buyer.com', organizationName: '' };
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(bAcc);
      jest.spyOn(storeService, 'getPaymentLinksForBuyer').mockResolvedValue([
        { id: 'pl-rec-1', status: 'PENDING' },
      ]);
      const zohoReconciliationService = require('../src/services/zohoReconciliationService');
      jest.spyOn(zohoReconciliationService, 'reconcilePendingLinks').mockResolvedValue(1);

      const reqLinks = { user: buyerUser, params: { id: 'b-rec' } };
      const resLinks = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.getPaymentLinks(reqLinks, resLinks, jest.fn());
      expect(resLinks.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      // downloadInvoice with unknown planId and empty org name
      const invoiceService = require('../src/services/invoiceService');
      jest.spyOn(storeService, 'getPaymentLinkById').mockResolvedValue({
        id: 'pl-rec-1',
        payerType: 'buyer',
        buyerAccountId: 'b-rec',
        planId: 'unknown_custom_plan',
      });
      jest.spyOn(invoiceService, 'generateReceiptPdf').mockResolvedValue(Buffer.from('PDF_CONTENT'));

      const reqInv = { user: buyerUser, params: { linkId: 'pl-rec-1' } };
      const resInv = {
        setHeader: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await buyerAccountController.downloadInvoice(reqInv, resInv, jest.fn());
      expect(resInv.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');

      // createSubscriptionPaymentLink with duration 6_months and unknown plan
      const zohoPaymentService = require('../src/services/zohoPaymentService');
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValue({
        payment_link_id: 'z-link-1',
        url: 'https://zoho.test/link',
      });
      jest.spyOn(storeService, 'createPaymentLinkRecord').mockReturnValue({ id: 'pl-rec-new' });

      bAcc.mobileNumber = '9876543210';
      const reqSub = {
        user: buyerUser,
        params: { id: 'b-rec' },
        body: { plan: 'unknown_tier', duration: '6_months' },
      };
      const resSub = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.createSubscriptionPaymentLink(reqSub, resSub, jest.fn());
      expect(resSub.status).toHaveBeenCalledWith(400); // unknown plan returns 400
    });
  });
});

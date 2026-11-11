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
    jest.spyOn(storeService, 'updateBuyerAccountDurably').mockImplementation(async (id, data) => ({
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

      const fractionalReq = { user: adminUser, params: { id: 'buyer-test-1' }, body: { amount: 1.5 } };
      const fractionalRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.addCredit(fractionalReq, fractionalRes, next);
      expect(fractionalRes.status).toHaveBeenCalledWith(400);

      const invalidKeyReq = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { amount: 5 },
        headers: { 'idempotency-key': 'bad-key' },
      };
      const invalidKeyRes = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.addCredit(invalidKeyReq, invalidKeyRes, next);
      expect(invalidKeyRes.status).toHaveBeenCalledWith(400);
    });

    test('returns 404 when buyer account does not exist', async () => {
      const req = { user: adminUser, params: { id: 'buyer-non-existent' }, body: { amount: 5 } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.addCredit(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('returns 404 when durable credit adjustment finds the account was concurrently removed', async () => {
      jest.spyOn(storeService, 'addBuyerCreditsDurably').mockResolvedValue(null);
      const req = { user: adminUser, params: { id: 'buyer-test-1' }, body: { amount: 5 } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await buyerAccountController.addCredit(req, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(404);
      expect(storeService.addBuyerCreditsDurably).toHaveBeenCalledWith(
        'buyer-test-1',
        5,
        expect.objectContaining({ transactionType: 'Admin Credit Addition' })
      );
    });

    test('successfully adds credits, records transaction, and updates balance', async () => {
      jest.spyOn(storeService, 'addBuyerCreditsDurably').mockImplementation(async (id, amount, transaction) => ({
        account: { ...mockBuyer, remainingFreeRFQs: 9 },
        previousBalance: 4,
        updatedBalance: 9,
        transaction: { ...transaction, id: 'ctx-1', previousBalance: 4, updatedBalance: 9 },
      }));

      const req = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { amount: 5, reason: 'Special allocation', source: 'Manual Topup' },
        headers: { 'idempotency-key': 'b714f6d8-83a1-4f34-9d89-72ebddb1186d' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.addCredit(req, res, next);
      expect(storeService.addBuyerCreditsDurably).toHaveBeenCalledWith(
        'buyer-test-1',
        5,
        expect.objectContaining({
          transactionType: 'Admin Credit Addition',
          idempotencyKey: 'b714f6d8-83a1-4f34-9d89-72ebddb1186d',
        })
      );
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
      jest.spyOn(storeService, 'addBuyerCreditsDurably').mockRejectedValue(new Error('DB failure'));

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
      jest.spyOn(storeService, 'updateBuyerAccountDurably').mockImplementation(() => {
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

    test('does not reconstruct or write credit history from a bounded RFQ cache', async () => {
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB')
        .mockResolvedValue([]);
      const recordSpy = jest.spyOn(domainQueries, 'recordBuyerCreditTransactionInDB').mockResolvedValue({ id: 'ok' });
      const rfqSpy = jest.spyOn(storeService, 'getRFQs');

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getCreditHistory(req, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          summary: expect.objectContaining({
            totalCreditsAllocated: 0,
            totalCreditsConsumed: 0,
            remainingFreeCredits: 4,
          }),
          transactions: [],
          historyAvailable: false,
        })
      );
      expect(recordSpy).not.toHaveBeenCalled();
      expect(rfqSpy).not.toHaveBeenCalled();
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
    test('getBuyerCommunications returns persisted communication history without inferred delivery records', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      const getRfqs = jest.spyOn(storeService, 'getRFQs');
      jest.spyOn(paymentDuesQueries, 'getCommunicationHistory').mockResolvedValue([
        { id: 'comm-db-1', channel: 'SMS', message: 'Hello' },
      ]);

      const req = { user: adminUser, params: { id: 'buyer-test-1' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      await buyerAccountController.getBuyerCommunications(req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ id: 'comm-db-1', channel: 'SMS', message: 'Hello' }],
      });
      expect(getRfqs).not.toHaveBeenCalled();
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

    test('recordBuyerCommunication persists provider-confirmed delivery state', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({
        id: 'buyer-email-delivery-1',
        deliveryStatus: 'Pending',
      });
      jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockImplementation(async (status) => ({
        id: 'buyer-email-delivery-1',
        ...status,
      }));
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'buyer-email-task' });
      const mailerService = require('../src/services/mailerService');
      jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true, messageId: 'buyer-email-provider-1' });

      const req = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: {
          channel: 'EMAIL',
          recipient: 'buyer@test.com',
          subject: 'Profile update',
          message: 'Your profile has been updated.',
        },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await buyerAccountController.recordBuyerCommunication(req, res, jest.fn());

      expect(paymentDuesQueries.updateCommunicationDeliveryStatus).toHaveBeenCalledWith({
        communicationId: 'buyer-email-delivery-1',
        notificationStatus: 'Notification Sent',
        deliveryStatus: 'Delivered',
        acknowledgementStatus: 'Acknowledgement Pending',
      });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ notificationStatus: 'Notification Sent', deliveryStatus: 'Delivered' }),
      }));
    });

    test('recordBuyerCommunication dispatches configured email only through durable recovery', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      const eventOutboxService = require('../src/services/eventOutboxService');
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({
        id: 'buyer-durable-email-1', deliveryStatus: 'Pending',
      });
      jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({
        id: 'buyer-durable-email-1', deliveryStatus: 'Delivered',
      });
      const dispatchSpy = jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockResolvedValue({ completed: 1 });
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'buyer-email-task' });
      const mailerService = require('../src/services/mailerService');
      const directSendSpy = jest.spyOn(mailerService, 'deliver');
      const recordSpy = jest.spyOn(paymentDuesQueries, 'recordCommunication');
      const req = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { channel: 'EMAIL', recipient: 'buyer@target.test', subject: 'Update', message: 'Details' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await buyerAccountController.recordBuyerCommunication(req, res, jest.fn());

      expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
        recipient: 'buyer@target.test',
        metadata: expect.objectContaining({
          deliveryEmailSubject: '[Procucev] Update',
          deliveryReplyTo: adminUser.email,
        }),
      }));
      expect(dispatchSpy).toHaveBeenCalledWith(1);
      expect(directSendSpy).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'Delivered' }),
      }));
    });

    test('recordBuyerCommunication retains pending state when delivery reconciliation fails', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      const { logger } = require('../src/services/loggerService');
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({
        id: 'buyer-email-pending-1',
        notificationStatus: 'Delivery Pending',
        deliveryStatus: 'Pending',
        acknowledgementStatus: 'Delivery Pending',
      });
      jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockRejectedValue(
        Object.assign(new Error('D1 unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );
      jest.spyOn(internalTaskQueries, 'createInternalTask').mockResolvedValue({ id: 'buyer-email-task' });
      jest.spyOn(logger, 'error').mockImplementation(() => {});
      const mailerService = require('../src/services/mailerService');
      jest.spyOn(mailerService, 'deliver').mockResolvedValue({ sent: true, messageId: 'buyer-email-provider-2' });

      const req = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { channel: 'EMAIL', recipient: 'buyer@test.com', subject: 'Profile update', message: 'Updated.' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await buyerAccountController.recordBuyerCommunication(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ deliveryStatus: 'Pending', acknowledgementStatus: 'Delivery Pending' }),
      }));
      expect(logger.error).toHaveBeenCalledWith(
        'Buyer dossier delivery result could not be saved; communication remains pending',
        expect.objectContaining({ communicationId: 'buyer-email-pending-1', providerAccepted: true }),
        'BUYER_ACCOUNT_CONTROLLER'
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
    test('returns payment summary from provider payment links only', async () => {
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
            totalAmountPaid: 29999,
            totalSuccessfulPayments: 1,
            pendingPayments: 1,
          }),
          payments: expect.arrayContaining([
            expect.objectContaining({ id: 'plink-1', status: 'PAID', amount: 29999 }),
            expect.objectContaining({ id: 'plink-2', status: 'PENDING', amount: 14999 }),
          ]),
        })
      );
      const response = res.json.mock.calls[0][0];
      expect(response.payments).toHaveLength(2);
      expect(response.payments.some((payment) => payment.id === `pay-init-${mockBuyer.id}`)).toBe(false);
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
            totalCreditsAllocated: 15,
            purchasedCredits: 10,
            adjustedCredits: 2,
            totalCreditsConsumed: 3,
            currentEntitlementMode: 'mode_1',
          }),
          transactions: expect.any(Array),
          historyAvailable: true,
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
        { id: 'lnk-5', amount: 5000, status: 'CANCELLED' },
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

    test('getBuyerPaymentHistory does not infer payments from paid or free plans', async () => {
      for (const plan of ['version_1', 'version_2', 'version_3', 'custom_enterprise']) {
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
              totalAmountPaid: 0,
              totalSuccessfulPayments: 0,
            }),
            payments: [],
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

    test('updateBuyerAccount validates subscriptionPlan update attempts', async () => {
      const reqUnauthorized = { user: vendorUser, params: { id: 'buyer-test-1' }, body: {} };
      const resUnauthorized = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.updateBuyerAccount(reqUnauthorized, resUnauthorized, jest.fn());
      expect(resUnauthorized.status).toHaveBeenCalledWith(403);

      const reqInvalidPlan = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { subscriptionPlan: 'growth' },
      };
      const resInvalidPlan = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.updateBuyerAccount(reqInvalidPlan, resInvalidPlan, jest.fn());
      expect(resInvalidPlan.status).toHaveBeenCalledWith(400);

      const reqValidPlan = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { subscriptionPlan: 'free_trial' },
      };
      const resValidPlan = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.updateBuyerAccount(reqValidPlan, resValidPlan, jest.fn());
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

    test('getBuyerAccounts exercises query limit and store hydration branches', async () => {
      const res = { json: jest.fn() };
      const req = { user: { role: 'admin' }, query: { limit: '25' } };
      await buyerAccountController.getBuyerAccounts(req, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      await buyerAccountController.getBuyerAccounts({ ...req, query: { limit: '9999' } }, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      await buyerAccountController.getBuyerAccounts({ ...req, query: { limit: '-5' } }, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

      const prevHydrated = storeService.isHydratedFromDB;
      storeService.isHydratedFromDB = true;
      await buyerAccountController.getBuyerAccounts({ user: { role: 'admin' }, query: {} }, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ source: 'persisted' }));
      storeService.isHydratedFromDB = prevHydrated;
    });

    test('getBuyerAccounts rejects invalid callers and selects durable buyer/admin records', async () => {
      const next = jest.fn();
      const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

      const unauthenticated = response();
      await buyerAccountController.getBuyerAccounts({ user: null }, unauthenticated, next);
      expect(unauthenticated.status).toHaveBeenCalledWith(401);

      const forbidden = response();
      await buyerAccountController.getBuyerAccounts({ user: vendorUser }, forbidden, next);
      expect(forbidden.status).toHaveBeenCalledWith(403);

      const hasStorage = jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const missingBuyer = response();
      storeService.getBuyerAccountByEmail.mockResolvedValueOnce(null);
      await buyerAccountController.getBuyerAccounts({ user: buyerUser, query: {} }, missingBuyer, next);
      expect(missingBuyer.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));

      hasStorage.mockReturnValue(true);
      jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValueOnce(mockBuyer);
      const persistedBuyer = response();
      await buyerAccountController.getBuyerAccounts({ user: buyerUser, query: {} }, persistedBuyer, next);
      expect(persistedBuyer.json).toHaveBeenCalledWith(expect.objectContaining({ data: [mockBuyer] }));

      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockResolvedValueOnce({ accounts: [mockBuyer] });
      const persistedAdmins = response();
      await buyerAccountController.getBuyerAccounts({ user: adminUser, query: {} }, persistedAdmins, next);
      expect(persistedAdmins.json).toHaveBeenCalledWith(expect.objectContaining({ data: [mockBuyer] }));

      const dbError = response();
      const error = new Error('buyer accounts unavailable');
      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockRejectedValueOnce(error);
      await buyerAccountController.getBuyerAccounts({ user: adminUser, query: {} }, dbError, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 503, retryable: true }));
    });

    test('createSubscriptionPaymentLink exercises duration, missing phone fallback, and auto-creation', async () => {
      const zohoPaymentService = require('../src/services/zohoPaymentService');
      const identityQueries = require('../src/db/identityQueries');

      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      jest.spyOn(storeService, 'addBuyerAccountDurably').mockResolvedValueOnce(null);

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
      jest.spyOn(storeService, 'addBuyerAccountDurably').mockResolvedValueOnce(createdAccountNoPhone);
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
      jest.spyOn(storeService, 'createPaymentLinkRecordDurably').mockResolvedValue({
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

    test('does not call Zoho when buyer mirror persistence fails during first payment-link creation', async () => {
      const zohoPaymentService = require('../src/services/zohoPaymentService');
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce(null);
      jest.spyOn(storeService, 'addBuyerAccountDurably').mockRejectedValueOnce(
        Object.assign(new Error('Buyer store unavailable'), { statusCode: 503 })
      );
      const createLink = jest.spyOn(zohoPaymentService, 'createPaymentLink');
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await buyerAccountController.createSubscriptionPaymentLink({
        user: { email: 'new-buyer@example.com', role: 'buyer', orgName: 'New Buyer' },
        params: { id: 'untrusted-id' },
        body: { plan: 'version_1' },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(503);
      expect(createLink).not.toHaveBeenCalled();
    });

    test('reports an untracked provider link when its durable payment record fails', async () => {
      const zohoPaymentService = require('../src/services/zohoPaymentService');
      const { PERSISTENCE_MESSAGES } = require('../src/config/constants');
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'buyer-payment-record-fail',
        corporateEmail: 'payment-record-fail@example.com',
        mobileNumber: '+919999999999',
      });
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockResolvedValueOnce({
        zohoPaymentLinkId: 'zoho-created-but-untracked',
        paymentUrl: 'https://pay.zoho.in/untracked',
        status: 'CREATED',
      });
      jest.spyOn(storeService, 'createPaymentLinkRecordDurably').mockRejectedValueOnce(
        Object.assign(new Error('database unavailable'), { statusCode: 503, code: 'PAYMENT_LINK_PERSISTENCE_UNAVAILABLE' })
      );
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await buyerAccountController.createSubscriptionPaymentLink({
        user: { email: 'payment-record-fail@example.com', role: 'buyer' },
        params: { id: 'buyer-payment-record-fail' },
        body: { plan: 'version_1' },
      }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: PERSISTENCE_MESSAGES.PAYMENT_LINK_TRACKING_FAILED });
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
      jest.spyOn(storeService, 'addBuyerCreditsDurably').mockResolvedValue({
        account: { ...buyerNoRemaining, remainingFreeRFQs: 8 },
        previousBalance: 5,
        updatedBalance: 8,
        transaction: { id: 'tx-new' },
      });

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
            totalSuccessfulPayments: 1,
            pendingPayments: 2,
          }),
        })
      );
    });

    test('getCreditHistory does not infer consumption from the isolate RFQ cache', async () => {
      const emailBuyer = {
        id: 'b-email-match',
        corporateEmail: 'match@buyer.com',
        remainingFreeRFQs: 2,
      };
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([emailBuyer]);
      jest.spyOn(domainQueries, 'getBuyerCreditTransactionsFromDB').mockResolvedValue([]);
      const rfqSpy = jest.spyOn(storeService, 'getRFQs').mockReturnValue([
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
          transactions: [],
          historyAvailable: false,
        })
      );
      expect(rfqSpy).not.toHaveBeenCalled();
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

    test('deleteBuyerAccount and setActiveAccount success paths', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(storeService, 'deleteBuyerAccountDurably').mockResolvedValue({ deleted: true, activeAccount: mockBuyer });
      const reqDel = { user: adminUser, params: { id: 'buyer-test-1' } };
      const resDel = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.deleteBuyerAccount(reqDel, resDel, jest.fn());
      expect(resDel.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: { activeAccount: mockBuyer },
      }));

      jest.spyOn(storeService, 'alignActiveBuyerAccountDurably').mockResolvedValue(mockBuyer);
      const reqActive = { user: adminUser, params: { id: 'buyer-test-1' } };
      const resActive = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.setActiveAccount(reqActive, resActive, jest.fn());
      expect(resActive.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: mockBuyer }));
    });

    test('deleteBuyerAccount and setActiveAccount return not found when persistence has no matching account', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(storeService, 'deleteBuyerAccountDurably').mockResolvedValue(false);
      jest.spyOn(storeService, 'alignActiveBuyerAccountDurably').mockResolvedValue(null);

      const req = { user: adminUser, params: { id: mockBuyer.id } };
      const deleteResponse = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.deleteBuyerAccount(req, deleteResponse, jest.fn());
      expect(deleteResponse.status).toHaveBeenCalledWith(404);

      const activateResponse = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.setActiveAccount(req, activateResponse, jest.fn());
      expect(activateResponse.status).toHaveBeenCalledWith(404);
    });

    test('updateBuyerAccount authorizes against the persisted buyer account when storage is configured', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const persistedAccountLookup = jest.spyOn(domainQueries, 'getBuyerAccountByIdFromDB').mockResolvedValue(mockBuyer);
      const req = {
        user: adminUser,
        params: { id: 'buyer-test-1' },
        body: { organizationName: 'Updated Buyer Corp' },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

      await buyerAccountController.updateBuyerAccount(req, res, jest.fn());

      expect(persistedAccountLookup).toHaveBeenCalledWith('buyer-test-1');
      expect(storeService.updateBuyerAccountDurably).toHaveBeenCalledWith('buyer-test-1', req.body);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
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
      jest.spyOn(storeService, 'createPaymentLinkRecordDurably').mockResolvedValue({ id: 'pl-rec-new' });

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

    test('recordBuyerCommunication handles nextFollowupDate and task creation failure branches', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      const internalTaskQueries = require('../src/db/internalTaskQueries');
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-followup-1' });

      const buyerAcc = {
        id: 'b-followup',
        organizationName: 'Followup Org',
        corporateEmail: 'followup@buyer.com',
      };
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([buyerAcc]);

      // 1. Success with nextFollowupDate and full fields
      const taskSpy = jest.spyOn(internalTaskQueries, 'createInternalTask')
        .mockResolvedValueOnce({ id: 'task-completed-1', status: 'Completed' })
        .mockResolvedValueOnce({ id: 'task-followup-1', status: 'Pending' });

      const req = {
        user: { ...adminUser, uuid: 'u-1', fullName: 'CM Lead' },
        params: { id: 'b-followup' },
        body: {
          channel: 'CALL',
          recipient: '9876543210',
          subject: 'Credit Renewal',
          message: 'Discussed subscription upgrade',
          callOutcome: 'Connected',
          duration: '12 mins',
          nextFollowupDate: '2026-11-10T10:00:00.000Z',
          followupPriority: 'High',
          followupAssigneeId: 'exec-2',
          followupAssigneeName: 'Navin Chaudhary',
          followupNotes: 'Finalize payment terms',
        },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.recordBuyerCommunication(req, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        completedTask: expect.objectContaining({ id: 'task-completed-1' }),
        followupTask: expect.objectContaining({ id: 'task-followup-1' }),
      }));

      // 2. Exception in completed task creation and followup task creation handled gracefully
      taskSpy
        .mockRejectedValueOnce(new Error('Task DB failure 1'))
        .mockRejectedValueOnce(new Error('Task DB failure 2'));

      const resErr = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.recordBuyerCommunication(req, resErr, jest.fn());
      expect(resErr.status).toHaveBeenCalledWith(201);
      expect(resErr.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        completedTask: null,
        followupTask: null,
      }));

      // 3. Cover WHATSAPP, SMS, and fallback actor/buyer labels
      const fallbackBuyer = { id: 'b-fallback', organizationName: 'Fallback Buyer Org' };
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([fallbackBuyer]);
      taskSpy
        .mockResolvedValueOnce({ id: 'btask-wa-comp' })
        .mockResolvedValueOnce({ id: 'btask-wa-fol' })
        .mockResolvedValueOnce({ id: 'btask-sms-comp' })
        .mockResolvedValueOnce({ id: 'btask-sms-fol' });

      const reqWA = {
        user: { role: 'admin', id: 'actor-id-only', email: 'cm.actor@procucev.com' },
        params: { id: 'b-fallback' },
        body: {
          channel: 'WHATSAPP',
          nextFollowupDate: '2026-11-20T10:00:00.000Z',
        },
      };
      const resWA = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.recordBuyerCommunication(reqWA, resWA, jest.fn());
      expect(resWA.status).toHaveBeenCalledWith(201);

      const reqSMS = {
        user: { role: 'admin', id: 'actor-id-only', name: 'CM Person' },
        params: { id: 'b-fallback' },
        body: {
          channel: 'SMS',
          nextFollowupDate: '2026-11-20T10:00:00.000Z',
        },
      };
      const resSMS = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.recordBuyerCommunication(reqSMS, resSMS, jest.fn());
      expect(resSMS.status).toHaveBeenCalledWith(201);

      // 4. Cover EMAIL channel and missing subject
      taskSpy
        .mockResolvedValueOnce({ id: 'btask-email-comp' })
        .mockResolvedValueOnce({ id: 'btask-email-fol' });

      const reqEmail = {
        user: { role: 'admin', id: 'actor-id-only' },
        params: { id: 'b-fallback' },
        body: {
          channel: 'EMAIL',
          nextFollowupDate: '2026-11-20T10:00:00.000Z',
        },
      };
      const resEmail = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.recordBuyerCommunication(reqEmail, resEmail, jest.fn());
      expect(resEmail.status).toHaveBeenCalledWith(201);
    });

    test('createSubscriptionPaymentLink covers missing corporateEmail and 502 error catch branches', async () => {
      const zohoPaymentService = require('../src/services/zohoPaymentService');

      // 1. Missing corporateEmail -> 400
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'b-no-email',
        corporateEmail: null,
      });
      const reqNoEmail = {
        user: { ...adminUser, email: 'noemail@buyer.com' },
        params: { id: 'b-no-email' },
        body: { plan: 'version_1' },
      };
      const resNoEmail = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.createSubscriptionPaymentLink(reqNoEmail, resNoEmail, jest.fn());
      expect(resNoEmail.status).toHaveBeenCalledWith(400);

      // 2. Error throwing -> 502
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValueOnce({
        id: 'b-valid',
        corporateEmail: 'valid@buyer.com',
        mobileNumber: '+919999999999',
      });
      jest.spyOn(zohoPaymentService, 'createPaymentLink').mockRejectedValueOnce(new Error('Zoho down'));
      const reqErr = {
        user: { ...adminUser, email: 'valid@buyer.com' },
        params: { id: 'b-valid' },
        body: { plan: 'version_1' },
      };
      const resErr = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await buyerAccountController.createSubscriptionPaymentLink(reqErr, resErr, jest.fn());
      expect(resErr.status).toHaveBeenCalledWith(502);
    });
  });
});

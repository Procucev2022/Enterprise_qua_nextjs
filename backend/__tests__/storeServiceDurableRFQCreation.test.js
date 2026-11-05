const isolatedSchedulers = new Set();

describe('Store service durable buyer RFQ creation', () => {
  afterEach(() => {
    for (const scheduler of isolatedSchedulers) {
      const handles = new Set([
        ...[...scheduler.pendingTimers.values()].flat(),
        ...scheduler.activeScheduledTimers.values(),
      ]);
      handles.forEach((handle) => clearTimeout(handle));
      scheduler.pendingTimers.clear();
      scheduler.activeScheduledTimers.clear();
    }
    isolatedSchedulers.clear();
    jest.restoreAllMocks();
  });

    function fullDomainQueriesMock(overrides = {}) {
      return {
        getVendorsFromDB: jest.fn().mockResolvedValue([]),
        getVendorByIdFromDB: jest.fn().mockResolvedValue(null),
        getVendorByEmailFromDB: jest.fn().mockResolvedValue(null),
        getVendorSnapshotByIdFromDB: jest.fn().mockResolvedValue(null),
        getVendorSnapshotByEmailFromDB: jest.fn().mockResolvedValue(null),
        updateVendorIfUnchangedInDB: jest.fn().mockResolvedValue(null),
        upsertVendorInDB: jest.fn().mockResolvedValue(null),
        deleteVendorInDB: jest.fn().mockResolvedValue(false),
        getRFQsFromDB: jest.fn().mockResolvedValue([]),
        getRFQByIdFromDB: jest.fn().mockResolvedValue(null),
        getRFQSnapshotByIdFromDB: jest.fn().mockResolvedValue(null),
        updateRFQIfUnchangedInDB: jest.fn().mockResolvedValue(null),
        upsertRFQInDB: jest.fn().mockResolvedValue(null),
        createRFQWithCreditInDB: jest.fn().mockResolvedValue(null),
        deleteRFQInDB: jest.fn().mockResolvedValue(false),
        getEvaluationsFromDB: jest.fn().mockResolvedValue([]),
        upsertEvaluationInDB: jest.fn().mockResolvedValue(null),
        getVendorCatalogueFromDB: jest.fn().mockResolvedValue([]),
        getVendorCatalogueByVendorFromDB: jest.fn().mockResolvedValue([]),
        getCatalogueProductByIdFromDB: jest.fn().mockResolvedValue(null),
        upsertCatalogueProductInDB: jest.fn().mockResolvedValue(null),
        deleteCatalogueProductInDB: jest.fn().mockResolvedValue(false),
        upsertPaymentLinkInDB: jest.fn().mockResolvedValue(null),
        getPaymentLinkByIdFromDB: jest.fn().mockResolvedValue(null),
        getBuyerAccountsFromDB: jest.fn().mockResolvedValue({ accounts: [], activeId: null }),
        getBuyerAccountSnapshotByIdFromDB: jest.fn().mockResolvedValue(null),
        getBuyerAccountSnapshotByEmailFromDB: jest.fn().mockResolvedValue(null),
        updateBuyerAccountIfUnchangedInDB: jest.fn().mockResolvedValue(null),
        upsertBuyerAccountInDB: jest.fn().mockResolvedValue(null),
        deleteBuyerAccountInDB: jest.fn().mockResolvedValue(false),
        setActiveBuyerAccountInDB: jest.fn().mockResolvedValue(undefined),
        deleteBuyerAccountAndPromoteActiveInDB: jest.fn().mockResolvedValue({ deleted: false, activeAccount: null }),
        setActiveBuyerAccountDurablyInDB: jest.fn().mockResolvedValue(null),
        addBuyerCreditsInDB: jest.fn().mockResolvedValue(null),
        getAIFeedFromDB: jest.fn().mockResolvedValue([]),
        upsertAIFeedItemInDB: jest.fn().mockResolvedValue(null),
        getAuditLogsFromDB: jest.fn().mockResolvedValue([]),
        appendAuditLogInDB: jest.fn(async (entry) => ({ ...entry })),
        upsertAuditLogInDB: jest.fn().mockResolvedValue(null),
        getNotificationsFromDB: jest.fn().mockResolvedValue([]),
        insertNotificationInDB: jest.fn().mockResolvedValue(null),
        bulkInsertNotificationsInDB: jest.fn().mockResolvedValue([]),
        markNotificationReadInDB: jest.fn().mockResolvedValue(false),
        markAllNotificationsReadInDB: jest.fn().mockResolvedValue(0),
        insertChaserJobInDB: jest.fn().mockResolvedValue(null),
        markChaserJobFiredInDB: jest.fn().mockResolvedValue(undefined),
        markChaserJobFailedInDB: jest.fn().mockResolvedValue(undefined),
        cancelChaserJobsForRFQInDB: jest.fn().mockResolvedValue(undefined),
        getPendingChaserJobsFromDB: jest.fn().mockResolvedValue([]),
        ...overrides,
      };
    }

    function freshStoreWithFailingWrite(overrides, hasStorage = false, mailerOverride = null, paymentActivationOverride = null) {
      let freshStore;
      let freshMailerService;
      let freshScheduler;
      let freshPaymentActivationQueries;
      const mockedDomainQueries = fullDomainQueriesMock(overrides);
      const mockedAuditLogQueries = {
        appendAuditLogInDB: mockedDomainQueries.appendAuditLogInDB,
        verifyAuditChainInDB: jest.fn().mockResolvedValue(null),
      };
      const errorSpy = jest.fn();
      const mailerServiceMock = mailerOverride ? {
        buildRatingRevisionEmail: jest.fn(() => ({})),
        buildVendorCategoryMappingEmail: jest.fn(() => ({})),
        buildVendorOnboardingEmail: jest.fn(() => ({})),
        buildVendorSelfMappingEmail: jest.fn(() => ({})),
        sendBuyerProfileCompletionReminderEmail: jest.fn().mockResolvedValue({ sent: true }),
        sendQuoteReceivedEmail: jest.fn().mockResolvedValue({ sent: true }),
        sendRfqAutoClosureAcknowledgementEmail: jest.fn().mockResolvedValue({ sent: true }),
        sendRfqFinalComparisonEmail: jest.fn().mockResolvedValue({ sent: true }),
        sendRfqInviteEmail: jest.fn().mockResolvedValue({ sent: true }),
        sendVendorIngestionEmail: jest.fn().mockResolvedValue({ sent: true }),
        ...mailerOverride,
      } : null;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ hasStorage: () => hasStorage }));
        jest.doMock('../src/db/domainQueries', () => mockedDomainQueries);
        jest.doMock('../src/db/auditLogQueries', () => mockedAuditLogQueries);
        if (paymentActivationOverride) jest.doMock('../src/db/paymentActivationQueries', () => paymentActivationOverride);
        jest.doMock('../src/services/loggerService', () => ({
          logger: { error: errorSpy, audit: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        }));
        if (mailerServiceMock) jest.doMock('../src/services/mailerService', () => mailerServiceMock);
        freshStore = require('../src/services/storeService');
        freshMailerService = require('../src/services/mailerService');
        freshScheduler = require('../src/services/rfqChaserScheduler');
        freshPaymentActivationQueries = require('../src/db/paymentActivationQueries');
      });
      isolatedSchedulers.add(freshScheduler);
      return {
        freshStore,
        errorSpy,
        domainQueries: mockedDomainQueries,
        auditLogQueries: mockedAuditLogQueries,
        mailerService: freshMailerService,
        paymentActivationQueries: freshPaymentActivationQueries,
      };
    }


    test('createRFQDurably waits for storage before dispatching RFQ side effects', async () => {
      const upsertRFQInDB = jest.fn().mockImplementation(async (rfq) => rfq);
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({ upsertRFQInDB }, true);
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      const created = await freshStore.createRFQDurably({
        id: 'rfq-durable-create',
        rfqNumber: 'RFQ-DURABLE-CREATE',
        title: 'Durable Create',
      });

      expect(domainQueries.upsertRFQInDB).toHaveBeenCalledTimes(1);
      expect(domainQueries.upsertRFQInDB).toHaveBeenCalledWith(created);
      expect(dispatchSpy).toHaveBeenCalledWith(created, null);
      expect(freshStore.getRFQById(created.id)).toEqual(created);
    });

    test('createRFQDurably reuses a persisted RFQ with the same idempotency key', async () => {
      const persisted = { id: 'rfq-email-stable', rfqNumber: 'RFQ-STABLE', title: 'Already saved' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getRFQByIdFromDB: jest.fn().mockResolvedValue(persisted),
      }, true);
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      const replay = await freshStore.createRFQDurably({
        id: persisted.id,
        rfqNumber: 'RFQ-DIFFERENT',
        title: 'Retry payload',
      });

      expect(replay).toEqual(persisted);
      expect(domainQueries.upsertRFQInDB).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(freshStore.rfqs).toEqual([persisted]);
    });

    test('createRFQDurably verifies persisted buyer RFQ replays through the ownership and credit query', async () => {
      const buyer = { id: 'buyer-rfq-replay', corporateEmail: 'buyer@replay.test' };
      const persisted = {
        id: 'rfq-buyer-replay',
        rfqNumber: 'RFQ-BUYER-REPLAY',
        buyerAccountId: buyer.id,
      };
      const refreshedBuyer = { ...buyer, remainingFreeRFQs: 4 };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getRFQByIdFromDB: jest.fn().mockResolvedValue(persisted),
        createRFQWithCreditInDB: jest.fn().mockResolvedValue({
          success: true,
          replayed: true,
          rfq: persisted,
          account: refreshedBuyer,
          credit: { consumed: true, remaining: 4 },
        }),
      }, true);
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      const replay = await freshStore.createRFQDurably({ id: persisted.id }, buyer);

      expect(replay).toEqual(persisted);
      expect(domainQueries.createRFQWithCreditInDB).toHaveBeenCalledWith({ rfq: persisted, buyerId: buyer.id });
      expect(freshStore.buyerAccounts).toEqual([refreshedBuyer]);
      expect(domainQueries.upsertRFQInDB).not.toHaveBeenCalled();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    test('createRFQDurably replaces an already cached replay and tolerates an omitted account result', async () => {
      const buyer = { id: 'buyer-rfq-cached-replay' };
      const persisted = { id: 'rfq-cached-replay', rfqNumber: 'RFQ-CACHED-REPLAY', buyerAccountId: buyer.id };
      const refreshed = { ...persisted, title: 'Latest persisted title' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getRFQByIdFromDB: jest.fn().mockResolvedValue(persisted),
        createRFQWithCreditInDB: jest.fn().mockResolvedValue({
          success: true,
          replayed: true,
          rfq: refreshed,
          account: null,
        }),
      }, true);
      freshStore.rfqs = [persisted];

      await expect(freshStore.createRFQDurably({ id: persisted.id }, buyer)).resolves.toEqual(refreshed);

      expect(freshStore.rfqs).toEqual([refreshed]);
      expect(domainQueries.upsertRFQInDB).not.toHaveBeenCalled();
    });

    test('createRFQDurably maps fast replay exhaustion and invalid results to safe errors', async () => {
      const buyer = { id: 'buyer-rfq-fast-error' };
      const persisted = { id: 'rfq-fast-error', buyerAccountId: buyer.id };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getRFQByIdFromDB: jest.fn().mockResolvedValue(persisted),
        createRFQWithCreditInDB: jest.fn()
          .mockResolvedValueOnce({ success: false, creditsExhausted: true, remaining: 0 })
          .mockResolvedValueOnce({ success: false, creditsExhausted: false })
          .mockRejectedValueOnce(Object.assign(new Error('ownership conflict'), { statusCode: 409, code: 'RFQ_CONFLICT' }))
          .mockRejectedValueOnce(Object.assign(new Error('database down'), { statusCode: 500, code: 'DATABASE_DOWN' })),
      }, true);

      await expect(freshStore.createRFQDurably({ id: persisted.id }, buyer))
        .rejects.toMatchObject({ statusCode: 403, code: 'FREE_RFQ_CREDITS_EXHAUSTED' });
      await expect(freshStore.createRFQDurably({ id: persisted.id }, buyer))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      await expect(freshStore.createRFQDurably({ id: persisted.id }, buyer))
        .rejects.toMatchObject({ statusCode: 409, code: 'RFQ_CONFLICT' });
      await expect(freshStore.createRFQDurably({ id: persisted.id }, buyer))
        .rejects.toMatchObject({ statusCode: 503, code: 'DATABASE_DOWN' });
      expect(domainQueries.createRFQWithCreditInDB).toHaveBeenCalledTimes(4);
    });

    test('createRFQDurably rolls back its cache row and skips side effects when storage fails', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertRFQInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      await expect(freshStore.createRFQDurably({
        id: 'rfq-durable-create-failure',
        rfqNumber: 'RFQ-DURABLE-CREATE-FAILURE',
      })).rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });

      expect(freshStore.getRFQById('rfq-durable-create-failure')).toBeUndefined();
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist RFQ mutation', expect.any(Error), 'STORE_SERVICE');
    });

    test('createRFQDurably keeps explicitly unconfigured memory mode available', async () => {
      const { freshStore } = freshStoreWithFailingWrite();
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      const created = await freshStore.createRFQDurably({ id: 'rfq-memory-create', rfqNumber: 'RFQ-MEMORY-CREATE' });

      expect(freshStore.getRFQById(created.id)).toEqual(created);
      expect(dispatchSpy).toHaveBeenCalledWith(created, null);
    });

    test('createRFQDurably logs post-create dispatch failures after storage succeeds', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertRFQInDB: jest.fn().mockImplementation(async (rfq) => rfq),
      }, true);
      jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {
        throw new Error('notification dispatcher unavailable');
      });

      const created = await freshStore.createRFQDurably({ id: 'rfq-dispatch-failure', rfqNumber: 'RFQ-DISPATCH-FAILURE' });

      expect(freshStore.getRFQById(created.id)).toEqual(created);
      expect(errorSpy).toHaveBeenCalledWith('RFQ persisted but post-create dispatch failed', expect.objectContaining({
        rfqNumber: created.rfqNumber,
        error: expect.any(Error),
      }), 'STORE_SERVICE');
    });

    test('createRFQDurably commits buyer credits with the RFQ and refreshes the buyer cache', async () => {
      const buyer = { id: 'buyer-atomic-rfq', subscriptionPlan: 'free_trial', remainingFreeRFQs: 2 };
      const savedBuyer = { ...buyer, remainingFreeRFQs: 1 };
      const persistedRFQ = { id: 'rfq-atomic-credit', rfqNumber: 'RFQ-ATOMIC-CREDIT' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        createRFQWithCreditInDB: jest.fn().mockResolvedValue({
          success: true,
          rfq: persistedRFQ,
          account: savedBuyer,
          replayed: false,
          credit: { consumed: true, remaining: 1 },
        }),
      }, true);
      freshStore.buyerAccounts = [buyer];
      freshStore.activeBuyerAccount = buyer;
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      const created = await freshStore.createRFQDurably({
        id: persistedRFQ.id,
        rfqNumber: persistedRFQ.rfqNumber,
        sourcingMode: 'mode_1',
      }, buyer);

      expect(created).toEqual(persistedRFQ);
      expect(domainQueries.createRFQWithCreditInDB).toHaveBeenCalledWith(expect.objectContaining({
        buyerId: buyer.id,
        rfq: expect.objectContaining({ id: persistedRFQ.id }),
      }));
      expect(domainQueries.upsertRFQInDB).not.toHaveBeenCalled();
      expect(freshStore.buyerAccounts[0]).toEqual(savedBuyer);
      expect(freshStore.activeBuyerAccount).toEqual(savedBuyer);
      expect(dispatchSpy).toHaveBeenCalledWith(persistedRFQ, buyer);
    });

    test('createRFQDurably rejects exhausted credits and does not publish or retain an RFQ', async () => {
      const buyer = { id: 'buyer-exhausted-rfq', subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 };
      const { freshStore } = freshStoreWithFailingWrite({
        createRFQWithCreditInDB: jest.fn().mockResolvedValue({
          success: false,
          creditsExhausted: true,
          remaining: 0,
          account: buyer,
        }),
      }, true);
      freshStore.buyerAccounts = [buyer];
      freshStore.activeBuyerAccount = buyer;
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      await expect(freshStore.createRFQDurably({ id: 'rfq-no-credit', sourcingMode: 'mode_2' }, buyer))
        .rejects.toMatchObject({ statusCode: 403, code: 'FREE_RFQ_CREDITS_EXHAUSTED', remaining: 0 });

      expect(freshStore.getRFQById('rfq-no-credit')).toBeUndefined();
      expect(freshStore.activeBuyerAccount).toEqual(buyer);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    test('createRFQDurably does not dispatch side effects for an atomic creation replay', async () => {
      const buyer = { id: 'buyer-rfq-new-replay', subscriptionPlan: 'free_trial', remainingFreeRFQs: 3 };
      const persistedRFQ = { id: 'rfq-new-replay', rfqNumber: 'RFQ-NEW-REPLAY' };
      const refreshedBuyer = { ...buyer, remainingFreeRFQs: 3 };
      const { freshStore } = freshStoreWithFailingWrite({
        createRFQWithCreditInDB: jest.fn().mockResolvedValue({
          success: true,
          replayed: true,
          rfq: persistedRFQ,
          account: refreshedBuyer,
        }),
      }, true);
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      await expect(freshStore.createRFQDurably({ id: persistedRFQ.id, sourcingMode: 'mode_1' }, buyer))
        .resolves.toEqual(persistedRFQ);

      expect(freshStore.buyerAccounts).toEqual([refreshedBuyer]);
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    test('createRFQDurably rejects a null atomic result without leaving a cache row', async () => {
      const buyer = { id: 'buyer-rfq-null-result' };
      const { freshStore } = freshStoreWithFailingWrite({
        createRFQWithCreditInDB: jest.fn().mockResolvedValue(null),
      }, true);
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      await expect(freshStore.createRFQDurably({ id: 'rfq-null-result' }, buyer))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      expect(freshStore.getRFQById('rfq-null-result')).toBeUndefined();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    test('createRFQDurably removes its cache row and surfaces retryable atomic persistence errors', async () => {
      const buyer = { id: 'buyer-atomic-failure', subscriptionPlan: 'free_trial', remainingFreeRFQs: 2 };
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        createRFQWithCreditInDB: jest.fn().mockRejectedValue(new Error('transaction lost')),
      }, true);
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      await expect(freshStore.createRFQDurably({ id: 'rfq-atomic-failure' }, buyer))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE', retryable: true });

      expect(freshStore.getRFQById('rfq-atomic-failure')).toBeUndefined();
      expect(dispatchSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith('Atomic RFQ and buyer-credit persistence failed', expect.any(Object), 'BUYER_RFQ_CREDIT');
    });

    test('createRFQDurably handles unconfigured free-credit exhaustion locally', async () => {
      const buyer = { id: 'buyer-local-exhausted', subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 };
      const { freshStore } = freshStoreWithFailingWrite();
      freshStore.buyerAccounts = [buyer];
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      await expect(freshStore.createRFQDurably({ id: 'rfq-local-no-credit', sourcingMode: 'mode_1' }, buyer))
        .rejects.toMatchObject({ statusCode: 403, code: 'FREE_RFQ_CREDITS_EXHAUSTED' });
      expect(freshStore.getRFQById('rfq-local-no-credit')).toBeUndefined();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    test('createRFQDurably refunds a locally consumed credit if RFQ persistence fails', async () => {
      const buyer = { id: 'buyer-local-refund', subscriptionPlan: 'free_trial', remainingFreeRFQs: 2 };
      const { freshStore } = freshStoreWithFailingWrite({
        upsertRFQInDB: jest.fn().mockRejectedValue(new Error('local persistence failed')),
      });
      jest.spyOn(freshStore, 'consumeRFQCreditIfApplicable').mockReturnValue({ consumed: true, remaining: 1 });
      const refundSpy = jest.spyOn(freshStore, 'refundFreeRFQ').mockImplementation(() => {});
      const dispatchSpy = jest.spyOn(freshStore, 'dispatchRFQCreationSideEffects').mockImplementation(() => {});

      await expect(freshStore.createRFQDurably({
        id: 'rfq-local-refund',
        sourcingMode: 'mode_1',
      }, buyer)).rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });

      expect(refundSpy).toHaveBeenCalledWith(buyer.id);
      expect(freshStore.getRFQById('rfq-local-refund')).toBeUndefined();
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

});

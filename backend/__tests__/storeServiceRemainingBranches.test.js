const storeService = require('../src/services/storeService');
const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');

function withoutVendorInvitationTargets(rfq) {
  const publicRFQ = { ...rfq };
  delete publicRFQ.vendorInvitationTargets;
  return publicRFQ;
}

describe('Store Service — remaining branch coverage', () => {
  // A fresh instance needs no arranging: every collection starts empty, so the
  // "nothing here yet" branches are the default rather than something a doctored
  // seed module had to produce.
  describe('a fresh instance holding no records', () => {
    let freshStore;

    beforeAll(() => {
      jest.isolateModules(() => {
        freshStore = require('../src/services/storeService');
      });
    });

    test('constructor leaves activeBuyerAccount null when there are no buyer accounts', () => {
      expect(freshStore.getActiveBuyerAccount()).toBeNull();
    });

    test('durable purchase-order wrapper supplies its optional defaults', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      await expect(freshStore.approvePurchaseOrderDurably('missing-rfq')).resolves.toBeNull();
      jest.restoreAllMocks();
    });

    test('addAuditLog falls back previousHash to an empty string when the audit log is empty', () => {
      const entry = freshStore.addAuditLog({ userEmail: 'first@entry.com', action: 'First ever entry' });
      expect(entry.shaSignature).toBeDefined();
    });

    test('deleteBuyerAccount falls the active account back to null once the last one is removed', () => {
      const acc = freshStore.addBuyerAccount({ organizationName: 'Solo Co', corporateEmail: 'solo@co.com' });
      freshStore.alignActiveBuyerAccount(acc.id);
      expect(freshStore.getActiveBuyerAccount().id).toBe(acc.id);

      freshStore.deleteBuyerAccount(acc.id);
      expect(freshStore.getActiveBuyerAccount()).toBeNull();
    });

    test('processHistoricalPurchaseData and approvePurchaseOrder fall back userEmail when there is no active buyer account', async () => {
      const res = await freshStore.processHistoricalPurchaseData('FY2026', [
        { companyName: 'No Active Buyer Co', email: 'nab@co.com' },
      ]);
      expect(res.success).toBe(true);

      const rfq = freshStore.createRFQ({ title: 'No active buyer PO fixture', category: 'Mechanical' });
      const po = freshStore.approvePurchaseOrder(rfq.id, 'v-001', 'Some Vendor', 1000, 'notes');
      expect(po.success).toBe(true);
    });

    test('addQuoteToRFQ falls back to an empty quotes array when the RFQ has none', () => {
      const rfq = freshStore.createRFQ({ title: 'No Quotes Yet RFQ' });
      const stored = freshStore.getRFQById(rfq.id);
      delete stored.quotes;

      const updated = freshStore.addQuoteToRFQ(rfq.id, { vendorName: 'First Quoter', unitPrice: 500 });
      expect(updated.quotes.length).toBe(1);
    });
  });

  describe('explicit-value and fallback branches on the shared store instance', () => {
    test('addBuyerAccount honors an explicit remainingFreeRFQs of 0', () => {
      const acc = storeService.addBuyerAccount({
        organizationName: 'Explicit RFQs Co',
        corporateEmail: 'explicit@rfqs.com',
        remainingFreeRFQs: 0,
      });
      expect(acc.remainingFreeRFQs).toBe(0);
    });

    test('addVendor honors explicit evaluated/hasRecord/isExistingInDatabase/isCategoryAligned flags', () => {
      const vendor = storeService.addVendor({
        name: 'Explicit Flags Vendor',
        majorCategory: 'Mechanical',
        evaluated: true,
        hasRecord: true,
        isExistingInDatabase: false,
        isCategoryAligned: false,
      });
      expect(vendor.evaluated).toBe(true);
      expect(vendor.hasRecord).toBe(true);
      expect(vendor.isExistingInDatabase).toBe(false);
      expect(vendor.isCategoryAligned).toBe(false);
    });

    test('reviseVendorRating falls back previousScore/previousRating when the vendor has none set', () => {
      const vendor = storeService.addVendor({ name: 'Scoreless Vendor', majorCategory: 'Mechanical', score: 0, rating: 0 });
      const { revisionRecord } = storeService.reviseVendorRating(vendor.id, { qualityScore: 80, costScore: 80, deliveryScore: 80 });
      expect(revisionRecord.previousScore).toBe(85);
      expect(revisionRecord.previousRating).toBe(4.5);
    });

    test('createRFQ falls back title when omitted, and honors an explicit chasingActive:false', () => {
      const rfq = storeService.createRFQ({ category: 'Mechanical', chasingActive: false });
      expect(rfq.title).toBe('Untitled RFQ');
      expect(rfq.chasingActive).toBe(false);
    });

    test('createEvaluation falls back vendorId when omitted', () => {
      const evalRes = storeService.createEvaluation({ vendorName: 'No Vendor Id Co' });
      expect(evalRes.vendorId).toMatch(/^v-/);
    });

    test('addAIFeedItem falls back title and message when omitted', () => {
      const item = storeService.addAIFeedItem({});
      expect(item.title).toBe('AI Bot Event');
      expect(item.message).toBe('');
    });

    // A record without both a company name and a contact email cannot identify a
    // supplier, so it is rejected and reported rather than back-filled. These rows
    // used to be imported with an invented name, address, phone, category, rating
    // and score, and marked `evaluated: true` — producing a vendor master full of
    // suppliers that could not be contacted but that RFQ routing would still pick.
    test('rejects unidentifiable rows instead of inventing their details', async () => {
      const emptyRes = await storeService.processHistoricalPurchaseData('FY2026-empty');
      expect(emptyRes.importedCount).toBe(0);
      expect(emptyRes.skippedCount).toBe(0);

      const res = await storeService.processHistoricalPurchaseData('FY2026-fallbacks', [
        { name: 'Only-Name Supplier Co' },
        {},
      ]);

      expect(res.importedCount).toBe(0);
      expect(res.skippedCount).toBe(2);
      expect(res.skipped).toEqual([
        { row: 1, reason: 'Missing contact email.' },
        { row: 2, reason: 'Missing both company name and contact email.' },
      ]);
    });

    test('imports a row carrying both a name and an email, without scoring it', async () => {
      const res = await storeService.processHistoricalPurchaseData('FY2026-identified', [
        { companyName: 'Identified Supplier Co', email: 'identified@supplier.test' },
      ]);

      expect(res.importedCount).toBe(1);
      expect(res.skippedCount).toBe(0);

      const imported = (await storeService.getVendors()).find((v) => v.email === 'identified@supplier.test');
      // Nothing has assessed this supplier yet, so it carries no rating or score
      // and is not marked as evaluated.
      expect(imported.rating).toBeNull();
      expect(imported.score).toBeNull();
      expect(imported.evaluated).toBe(false);
      expect(imported.status).toBe('PENDING EVALUATION');
    });

    test('handleSupportChat falls back an empty prompt safely', () => {
      const res = storeService.handleSupportChat();
      expect(res.isEscalated).toBe(false);
    });

    test('addProductToCatalogue falls back unitPrice to 0 when not a valid number', () => {
      const prod = storeService.addProductToCatalogue({ name: 'Zero Price Prod', sku: 'SKU-ZERO' });
      expect(prod.unitPrice).toBe(0);
    });

    test('approvePurchaseOrder returns null when the RFQ cannot be found', async () => {
      const po = storeService.approvePurchaseOrder(undefined, 'v-001', 'Vendor X', 500, 'notes');
      expect(po).toBeNull();
    });
  });

  describe('hydrateFromDB', () => {
    // All 8 getters are called unconditionally inside one Promise.all, so
    // every domainQueries mock needs all 8 present or an unmocked one being
    // called as `undefined()` throws synchronously before Promise.all ever
    // wraps the other (already-pending) promises, orphaning them as unhandled
    // rejections. This fills in safe "empty" defaults; each test only
    // overrides what it's actually testing.
    function emptyDomainQueriesMock(overrides = {}) {
      return {
        getVendorsFromDB: jest.fn().mockResolvedValue([]),
        getVendorByIdFromDB: jest.fn().mockResolvedValue(null),
        getVendorByEmailFromDB: jest.fn().mockResolvedValue(null),
        getVendorsPageFromDB: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
        getRFQsFromDB: jest.fn().mockResolvedValue([]),
        getEvaluationsFromDB: jest.fn().mockResolvedValue([]),
        getVendorCatalogueFromDB: jest.fn().mockResolvedValue([]),
        getBuyerAccountsFromDB: jest.fn().mockResolvedValue({ accounts: [], activeId: null }),
        getBuyerAccountByIdFromDB: jest.fn().mockResolvedValue(null),
        getBuyerAccountByEmailFromDB: jest.fn().mockResolvedValue(null),
        getAIFeedFromDB: jest.fn().mockResolvedValue([]),
        getAuditLogsFromDB: jest.fn().mockResolvedValue([]),
        getNotificationsFromDB: jest.fn().mockResolvedValue([]),
        getPaymentLinksFromDB: jest.fn().mockResolvedValue([]),
        insertChaserJobInDB: jest.fn().mockResolvedValue(null),
        markChaserJobFiredInDB: jest.fn().mockResolvedValue(undefined),
        markChaserJobFailedInDB: jest.fn().mockResolvedValue(undefined),
        cancelChaserJobsForRFQInDB: jest.fn().mockResolvedValue(undefined),
        getPendingChaserJobsFromDB: jest.fn().mockResolvedValue([]),
        ...overrides,
      };
    }

    test('reports not_configured and loads nothing when DATABASE_URL is unset', async () => {
      const beforeBuyers = storeService.getBuyerAccounts().length;
      const result = await storeService.hydrateFromDB();

      // There is no second datastore to fall back to, so the caller is told why
      // rather than being handed a silently-empty store.
      expect(result).toMatchObject({ hydrated: false, source: 'not_configured' });
      expect(result.error).toContain('DATABASE_URL');
      expect(storeService.isHydratedFromDB).toBe(false);
      expect(storeService.getBuyerAccounts().length).toBe(beforeBuyers);
    });

    test('replaces vendors/RFQs from the domain DB when configured and rows exist', async () => {
      const dbVendors = [{ id: 'v-db-1', name: 'DB Vendor' }];
      const dbRfqs = [{ id: 'rfq-db-1', title: 'DB RFQ' }];
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getVendorsPageFromDB: jest.fn().mockResolvedValue({ rows: dbVendors, total: dbVendors.length }),
            getRFQsFromDB: jest.fn().mockResolvedValue(dbRfqs),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      const result = await freshStore.hydrateFromDB();

      expect(result).toEqual({ hydrated: true, source: 'postgres' });
      expect(freshStore.isHydratedFromDB).toBe(true);
      expect(freshStore.vendors).toEqual(dbVendors);
      expect(freshStore.vendorsTotal).toBe(dbVendors.length);
      expect(freshStore.getRFQs()).toEqual(dbRfqs);
    });

    test('bounds the boot-time vendor read instead of reading the whole table', async () => {
      let freshStore;
      let pageSpy;
      let fullTableSpy;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        pageSpy = jest.fn().mockResolvedValue({ rows: [], total: 0 });
        fullTableSpy = jest.fn().mockResolvedValue([]);
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({ getVendorsPageFromDB: pageSpy, getVendorsFromDB: fullTableSpy })
        );
        freshStore = require('../src/services/storeService');
      });

      await freshStore.hydrateFromDB();

      expect(pageSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: expect.any(Number), offset: 0 }));
      expect(fullTableSpy).not.toHaveBeenCalled();
    });

    test('replaces evaluations, vendor catalogue, AI feed and audit logs when rows exist', async () => {
      const dbEvaluations = [{ id: 'eval-db-1', vendorName: 'DB Vendor' }];
      const dbCatalogue = [{ id: 'prod-db-1', name: 'DB Product' }];
      const dbAIFeed = [{ id: 'feed-db-1', title: 'DB Feed Item' }];
      const dbAuditLogs = [{ id: 'log-db-1', action: 'DB Audit Entry' }];
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getEvaluationsFromDB: jest.fn().mockResolvedValue(dbEvaluations),
            getVendorCatalogueFromDB: jest.fn().mockResolvedValue(dbCatalogue),
            getAIFeedFromDB: jest.fn().mockResolvedValue(dbAIFeed),
            getAuditLogsFromDB: jest.fn().mockResolvedValue(dbAuditLogs),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      const result = await freshStore.hydrateFromDB();

      expect(result).toEqual({ hydrated: true, source: 'postgres' });
      expect(freshStore.getEvaluations()).toEqual(dbEvaluations);
      expect(freshStore.getVendorCatalogue()).toEqual(dbCatalogue);
      expect(freshStore.getAIFeed()).toEqual(dbAIFeed);
      expect(freshStore.getAuditLogs()).toEqual(dbAuditLogs);
    });

    test('replaces buyer accounts and resolves activeBuyerAccount to the flagged row', async () => {
      const acc1 = { id: 'buyer-db-1', organizationName: 'DB Buyer One' };
      const acc2 = { id: 'buyer-db-2', organizationName: 'DB Buyer Two' };
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getBuyerAccountsFromDB: jest.fn().mockResolvedValue({ accounts: [acc1, acc2], activeId: 'buyer-db-2' }),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      await freshStore.hydrateFromDB();

      expect(freshStore.getBuyerAccounts()).toEqual([acc1, acc2]);
      expect(freshStore.getActiveBuyerAccount()).toEqual(acc2);
    });

    test('falls back activeBuyerAccount to the first row when no activeId matches', async () => {
      const acc1 = { id: 'buyer-db-1', organizationName: 'DB Buyer One' };
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getBuyerAccountsFromDB: jest.fn().mockResolvedValue({ accounts: [acc1], activeId: 'no-such-id' }),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      await freshStore.hydrateFromDB();

      expect(freshStore.getActiveBuyerAccount()).toEqual(acc1);
    });

    // An empty database is a successful load of nothing, NOT a fallback. The
    // previous version applied each collection only `if (rows.length > 0)`, so an
    // empty table left the seed in place and the API served invented records while
    // reporting itself healthy.
    test('treats empty tables as an empty store, still reporting a successful load', async () => {
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () => emptyDomainQueriesMock());
        freshStore = require('../src/services/storeService');
      });

      const result = await freshStore.hydrateFromDB();

      expect(result).toEqual({ hydrated: true, source: 'postgres' });
      expect(freshStore.isHydratedFromDB).toBe(true);
      expect(await freshStore.getVendors()).toEqual([]);
      expect(freshStore.getRFQs()).toEqual([]);
      expect(freshStore.getActiveBuyerAccount()).toBeNull();
    });

    test('reports the read as unavailable when a query throws, without inventing records', async () => {
      let freshStore;
      jest.isolateModules(() => {
        jest.doMock('../src/db/pool', () => ({ pool: {}, hasStorage: () => true }));
        jest.doMock('../src/db/domainQueries', () =>
          emptyDomainQueriesMock({
            getVendorsPageFromDB: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
          })
        );
        freshStore = require('../src/services/storeService');
      });

      const result = await freshStore.hydrateFromDB();

      expect(result).toMatchObject({ hydrated: false, source: 'unavailable' });
      expect(result.error).toBe('ECONNREFUSED');
      expect(freshStore.isHydratedFromDB).toBe(false);
      // Checked directly against the raw in-memory array rather than through
      // getVendors() — that method itself re-queries Neon on every call (see
      // the "no in-memory-only vendor storage" fix), and this mock always
      // rejects, so a second call here would just throw again.
      expect(freshStore.vendors).toEqual([]);
    });
  });

  describe('processHistoricalPurchaseData without a domain persistence layer', () => {
    test('imports vendors into the in-memory store and reports the count', async () => {
      const res = await storeService.processHistoricalPurchaseData('FY2026-nodb', [
        { companyName: 'In Memory Historical Co', email: 'inmemory@historical.com' },
      ]);

      expect(res.importedCount).toBe(1);
    });
  });

  // Every fire-and-forget _persistX/_removeX/_setActiveX helper attaches its
  // own .catch(err => logger.error(...)) — that callback only runs when the
  // underlying domainQueries write actually rejects. Nothing else in this
  // in-memory-store test suite configures a real DATABASE_URL, so these
  // callbacks are otherwise never exercised (a full-suite run can accidentally
  // cover a few of them if an earlier test file left a live DATABASE_URL
  // cached in process.env — not something to depend on). These tests reject
  // each write deliberately so every catch handler is covered deterministically.
  describe('persist-helper failure paths (_persistX/_removeX catch handlers)', () => {
    const isolatedSchedulers = new Set();

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

    const flush = () => new Promise((resolve) => setImmediate(resolve));

    test('getVendorByIdWithDBFallback refreshes email matches and replaces stale cache rows', async () => {
      const stale = { id: 'old-vendor', email: 'fresh@vendor.test', name: 'Old name' };
      const authoritative = { id: 'current-vendor', email: 'fresh@vendor.test', name: 'Current name' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getVendorByEmailFromDB: jest.fn()
          .mockResolvedValueOnce(authoritative)
          .mockResolvedValueOnce(null),
      }, true);
      freshStore.vendors.push(stale);

      await expect(freshStore.getVendorByIdWithDBFallback(stale.email, 'all', { fresh: true })).resolves.toBe(authoritative);
      expect(domainQueries.getVendorByIdFromDB).not.toHaveBeenCalled();
      expect(domainQueries.getVendorByEmailFromDB).toHaveBeenCalledWith(stale.email, { fresh: true });
      expect(freshStore.vendors).not.toContain(stale);
      expect(freshStore.vendors).toContain(authoritative);
      await expect(freshStore.getVendorByIdWithDBFallback(stale.email, 'all', { fresh: true })).resolves.toBeUndefined();
    });

    test('getVendorByIdWithDBFallback keeps memory-only records when no storage is configured', async () => {
      const freshStore = freshStoreWithFailingWrite({}, false).freshStore;
      const vendor = freshStore.addVendor(
        { name: 'Memory Vendor', email: 'memory@vendor.test' },
        null,
        null,
        { deferPersistence: true }
      );

      await expect(freshStore.getVendorByIdWithDBFallback(vendor.email, 'all', { fresh: true })).resolves.toBe(vendor);
    });

    test('a fresh database miss removes a stale cached vendor row', async () => {
      const stale = { id: 'deleted-vendor', email: 'deleted@vendor.test', name: 'Stale Vendor' };
      const { freshStore } = freshStoreWithFailingWrite({
        getVendorByIdFromDB: jest.fn().mockResolvedValue(null),
        getVendorByEmailFromDB: jest.fn().mockResolvedValue(null),
      }, true);
      freshStore.vendors.push(stale);

      await expect(freshStore.getVendorByIdWithDBFallback(stale.id, 'all', { fresh: true })).resolves.toBeUndefined();
      expect(freshStore.vendors).not.toContain(stale);
    });

    test('empanelIngestedVendor waits for the database before caching or auditing', async () => {
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        upsertVendorInDB: jest.fn(async (vendor) => {
          await writeGate;
          return vendor;
        }),
      }, true);
      const savePromise = freshStore.empanelIngestedVendor({
        name: 'New Ingested Vendor',
        email: 'new-ingested@vendor.test',
        majorCategory: 'Electrical',
      }, 'buyer@buyer.test');

      await flush();
      expect(freshStore.vendors).toHaveLength(0);
      expect(freshStore.getAuditLogs()).toHaveLength(0);
      expect(domainQueries.upsertVendorInDB).toHaveBeenCalledTimes(1);

      releaseWrite();
      const saved = await savePromise;
      expect(saved).toMatchObject({ name: 'New Ingested Vendor', source: 'vendor_master_ingestion' });
      expect(freshStore.vendors[0]).toBe(saved);
      expect(freshStore.getAuditLogs()).toHaveLength(1);
    });

    test.each([
      ['database unavailable', () => new Error('database unavailable'), 503, 'PERSISTENCE_UNAVAILABLE'],
      ['unique conflict code', () => Object.assign(new Error('duplicate email'), { code: '23505' }), 409, 'VENDOR_EMAIL_CONFLICT'],
      ['unique conflict message', () => new Error('unique constraint failed'), 409, 'VENDOR_EMAIL_CONFLICT'],
    ])('empanelIngestedVendor leaves cache unchanged on %s', async (_name, makeError, statusCode, code) => {
      const failure = makeError();
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertVendorInDB: jest.fn().mockRejectedValue(failure),
      }, true);

      await expect(freshStore.empanelIngestedVendor({
        name: 'Failed Ingested Vendor',
        email: 'failed-ingested@vendor.test',
      })).rejects.toMatchObject({ statusCode, code });
      expect(freshStore.vendors).toHaveLength(0);
      expect(freshStore.getAuditLogs()).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to persist vendor empanelled from vendor master ingestion',
        failure,
        'STORE_SERVICE'
      );
    });

    test('empanelIngestedVendor fails closed when a configured write returns no row', async () => {
      const { freshStore } = freshStoreWithFailingWrite({
        upsertVendorInDB: jest.fn().mockResolvedValue(null),
      }, true);

      await expect(freshStore.empanelIngestedVendor({
        name: 'Missing Ingested Vendor',
        email: 'missing-ingested@vendor.test',
      })).rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      expect(freshStore.vendors).toHaveLength(0);
    });

    test('_persistVendor logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertVendorInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.addVendor({ name: 'Test Co', email: 'test@co.com', majorCategory: 'Mechanical' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist vendor', expect.any(Error), 'STORE_SERVICE');
    });

    test('_removeVendor logs when the write-through delete rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteVendorInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const vendor = freshStore.addVendor({ name: 'Test Co', email: 'test@co.com', majorCategory: 'Mechanical' });
      freshStore.deleteVendor(vendor.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to delete persisted vendor', expect.any(Error), 'STORE_SERVICE');
    });

    test('updateVendorDurably waits for persistence before updating the cache', async () => {
      let vendor;
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn(async () => {
          const persisted = { ...vendor, concurrentlyUpdatedField: 'preserved' };
          return { id: persisted.id, vendor: persisted, raw: JSON.stringify(persisted) };
        }),
        updateVendorIfUnchangedInDB: jest.fn(async (_snapshot, persisted) => persisted),
      }, true);
      vendor = freshStore.addVendor(
        { name: 'Durable Vendor', email: 'durable@vendor.test' },
        null,
        null,
        { deferPersistence: true }
      );
      const updated = await freshStore.updateVendorDurably(vendor.id, { rating: 4.8 });

      expect(updated.rating).toBe(4.8);
      expect(updated.concurrentlyUpdatedField).toBe('preserved');
      expect(freshStore.getVendorById(vendor.id, 'all')).toBe(updated);
      expect(domainQueries.updateVendorIfUnchangedInDB).toHaveBeenCalledWith(
        expect.objectContaining({ id: vendor.id }),
        expect.objectContaining({ id: vendor.id, rating: 4.8 })
      );
    });

    test('updateVendorDurably keeps the cached record and reports a retryable error on persistence failure', async () => {
      let vendor;
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn(async () => ({ id: vendor.id, vendor, raw: JSON.stringify(vendor) })),
        updateVendorIfUnchangedInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      vendor = freshStore.addVendor(
        { name: 'Stable Vendor', email: 'stable@vendor.test', rating: 3.5 },
        null,
        null,
        { deferPersistence: true }
      );

      await expect(freshStore.updateVendorDurably(vendor.id, { rating: 4.8 })).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(freshStore.getVendorById(vendor.id, 'all')).toBe(vendor);
      expect(vendor.rating).toBe(3.5);
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist vendor update', expect.any(Error), 'STORE_SERVICE');
    });

    test('updateVendorDurably maps duplicate email conflicts to 409 and supports memory-only mode', async () => {
      const conflict = new Error('unique constraint failed');
      conflict.code = '23505';
      let vendor;
      const { freshStore } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn(async (id) => id === 'missing-vendor' ? null : ({ id: vendor.id, vendor, raw: JSON.stringify(vendor) })),
        updateVendorIfUnchangedInDB: jest.fn().mockRejectedValue(conflict),
      }, true);
      vendor = freshStore.addVendor(
        { name: 'Conflict Vendor', email: 'conflict@vendor.test' },
        null,
        null,
        { deferPersistence: true }
      );
      await expect(freshStore.updateVendorDurably(vendor.id, { email: 'taken@vendor.test' })).rejects.toMatchObject({
        statusCode: 409,
        code: 'VENDOR_EMAIL_CONFLICT',
      });
      await expect(freshStore.updateVendorDurably('missing-vendor', {})).resolves.toBeNull();

      const memoryOnly = freshStoreWithFailingWrite({}, false).freshStore;
      const localVendor = memoryOnly.addVendor(
        { name: 'Local Vendor', email: 'local@vendor.test' },
        null,
        null,
        { deferPersistence: true }
      );
      await expect(memoryOnly.updateVendorDurably(localVendor.id, { rating: 4 })).resolves.toMatchObject({ rating: 4 });
      await expect(memoryOnly.updateVendorDurably('missing-vendor', {})).resolves.toBeNull();
    });

    test('durable vendor and buyer updates load uncached rows by email before merging patches', async () => {
      const remoteVendor = { id: 'remote-vendor-1', email: 'remote@vendor.test', name: 'Remote Vendor', latestField: 'kept' };
      const remoteBuyer = { id: 'remote-buyer-1', corporateEmail: 'remote@buyer.test', organizationName: 'Remote Buyer', latestField: 'kept' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getVendorSnapshotByEmailFromDB: jest.fn().mockResolvedValue({ id: remoteVendor.id, vendor: remoteVendor, raw: JSON.stringify(remoteVendor) }),
        getBuyerAccountSnapshotByEmailFromDB: jest.fn().mockResolvedValue({ id: remoteBuyer.id, account: remoteBuyer, raw: JSON.stringify(remoteBuyer) }),
        updateVendorIfUnchangedInDB: jest.fn(async (_snapshot, record) => record),
        updateBuyerAccountIfUnchangedInDB: jest.fn(async (_snapshot, record) => record),
      }, true);

      const vendor = await freshStore.updateVendorDurably(remoteVendor.email, { name: 'Updated Vendor' });
      const buyer = await freshStore.updateBuyerAccountDurably(remoteBuyer.corporateEmail, { organizationName: 'Updated Buyer' });

      expect(domainQueries.getVendorSnapshotByEmailFromDB).toHaveBeenCalledWith(remoteVendor.email);
      expect(domainQueries.getBuyerAccountSnapshotByEmailFromDB).toHaveBeenCalledWith(remoteBuyer.corporateEmail);
      expect(vendor).toMatchObject({ id: remoteVendor.id, name: 'Updated Vendor', latestField: 'kept' });
      expect(buyer).toMatchObject({ id: remoteBuyer.id, organizationName: 'Updated Buyer', latestField: 'kept' });
      expect(freshStore.vendors).toContain(vendor);
      expect(freshStore.buyerAccounts).toContain(buyer);
    });

    test('durable vendor and buyer patches retry against the latest database snapshot after a CAS conflict', async () => {
      let vendorState = { id: 'cas-vendor', email: 'cas@vendor.test', name: 'Original Vendor' };
      let buyerState = { id: 'cas-buyer', corporateEmail: 'cas@buyer.test', organizationName: 'Original Buyer' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn(async (id) => ({ id, vendor: vendorState, raw: JSON.stringify(vendorState) })),
        getBuyerAccountSnapshotByIdFromDB: jest.fn(async (id) => ({ id, account: buyerState, raw: JSON.stringify(buyerState) })),
        updateVendorIfUnchangedInDB: jest.fn()
          .mockImplementationOnce(async () => {
            vendorState = { ...vendorState, concurrentVendorField: 'preserved' };
            return null;
          })
          .mockImplementationOnce(async (_snapshot, candidate) => {
            vendorState = candidate;
            return candidate;
          }),
        updateBuyerAccountIfUnchangedInDB: jest.fn()
          .mockImplementationOnce(async () => {
            buyerState = { ...buyerState, concurrentBuyerField: 'preserved' };
            return null;
          })
          .mockImplementationOnce(async (_snapshot, candidate) => {
            buyerState = candidate;
            return candidate;
          }),
      }, true);

      const [vendor, buyer] = await Promise.all([
        freshStore.updateVendorDurably('cas-vendor', { name: 'Updated Vendor' }),
        freshStore.updateBuyerAccountDurably('cas-buyer', { organizationName: 'Updated Buyer' }),
      ]);

      expect(vendor).toMatchObject({ name: 'Updated Vendor', concurrentVendorField: 'preserved' });
      expect(buyer).toMatchObject({ organizationName: 'Updated Buyer', concurrentBuyerField: 'preserved' });
      expect(domainQueries.updateVendorIfUnchangedInDB).toHaveBeenCalledTimes(2);
      expect(domainQueries.updateBuyerAccountIfUnchangedInDB).toHaveBeenCalledTimes(2);
      expect(domainQueries.updateVendorIfUnchangedInDB.mock.calls[1][1]).toMatchObject({ concurrentVendorField: 'preserved' });
      expect(domainQueries.updateBuyerAccountIfUnchangedInDB.mock.calls[1][1]).toMatchObject({ concurrentBuyerField: 'preserved' });
    });

    test('durable vendor and buyer updates stop when the row is deleted during a CAS retry', async () => {
      const vendor = { id: 'deleted-cas-vendor', email: 'deleted@vendor.test', name: 'Vendor' };
      const buyer = { id: 'deleted-cas-buyer', corporateEmail: 'deleted@buyer.test', organizationName: 'Buyer' };
      const { freshStore } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn()
          .mockResolvedValueOnce({ id: vendor.id, vendor, raw: JSON.stringify(vendor) })
          .mockResolvedValueOnce(null),
        getBuyerAccountSnapshotByIdFromDB: jest.fn()
          .mockResolvedValueOnce({ id: buyer.id, account: buyer, raw: JSON.stringify(buyer) })
          .mockResolvedValueOnce(null),
        updateVendorIfUnchangedInDB: jest.fn().mockResolvedValue(null),
        updateBuyerAccountIfUnchangedInDB: jest.fn().mockResolvedValue(null),
      }, true);
      freshStore.vendors.push(vendor);
      freshStore.buyerAccounts.push(buyer);

      await expect(freshStore.updateVendorDurably(vendor.id, { name: 'Updated' })).resolves.toBeNull();
      await expect(freshStore.updateBuyerAccountDurably(buyer.id, { organizationName: 'Updated' })).resolves.toBeNull();
      expect(freshStore.vendors[0]).toBe(vendor);
      expect(freshStore.buyerAccounts[0]).toBe(buyer);
    });

    test('durable vendor and buyer updates map wrapped unique constraint errors to conflicts', async () => {
      const vendor = { id: 'wrapped-cas-vendor', email: 'wrapped@vendor.test', name: 'Vendor' };
      const buyer = { id: 'wrapped-cas-buyer', corporateEmail: 'wrapped@buyer.test', organizationName: 'Buyer' };
      const vendorError = new Error('database write failed');
      vendorError.cause = new Error('unique constraint failed');
      const buyerError = new Error('database write failed');
      buyerError.cause = new Error('unique constraint failed');
      const { freshStore } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn().mockResolvedValue({ id: vendor.id, vendor, raw: JSON.stringify(vendor) }),
        getBuyerAccountSnapshotByIdFromDB: jest.fn().mockResolvedValue({ id: buyer.id, account: buyer, raw: JSON.stringify(buyer) }),
        updateVendorIfUnchangedInDB: jest.fn().mockRejectedValue(vendorError),
        updateBuyerAccountIfUnchangedInDB: jest.fn().mockRejectedValue(buyerError),
      }, true);

      await expect(freshStore.updateVendorDurably(vendor.id, { email: 'claimed@vendor.test' }))
        .rejects.toMatchObject({ statusCode: 409, code: 'VENDOR_EMAIL_CONFLICT' });
      await expect(freshStore.updateBuyerAccountDurably(buyer.id, { corporateEmail: 'claimed@buyer.test' }))
        .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_EMAIL_CONFLICT' });
    });

    test('durable buyer and vendor updates fail closed when an upsert returns no persisted row', async () => {
      const vendor = { id: 'null-write-vendor', email: 'null-write@vendor.test', name: 'Stable Vendor' };
      const buyer = { id: 'null-write-buyer', corporateEmail: 'null-write@buyer.test', organizationName: 'Stable Buyer' };
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn().mockResolvedValue({ id: vendor.id, vendor, raw: JSON.stringify(vendor) }),
        getBuyerAccountSnapshotByIdFromDB: jest.fn().mockResolvedValue({ id: buyer.id, account: buyer, raw: JSON.stringify(buyer) }),
        updateVendorIfUnchangedInDB: jest.fn().mockResolvedValue(null),
        updateBuyerAccountIfUnchangedInDB: jest.fn().mockResolvedValue(null),
      }, true);
      freshStore.vendors.push(vendor);
      freshStore.buyerAccounts.push(buyer);

      await expect(freshStore.updateVendorDurably(vendor.id, { name: 'Unsaved Vendor' })).rejects.toMatchObject({
        statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE',
      });
      await expect(freshStore.updateBuyerAccountDurably(buyer.id, { organizationName: 'Unsaved Buyer' })).rejects.toMatchObject({
        statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(freshStore.vendors[0]).toBe(vendor);
      expect(freshStore.buyerAccounts[0]).toBe(buyer);
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist vendor update', expect.any(Error), 'STORE_SERVICE');
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist buyer account update', expect.any(Error), 'STORE_SERVICE');
    });

    test('deleteVendorDurably waits for storage and audits only successful deletions', async () => {
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        deleteVendorInDB: jest.fn().mockResolvedValue(true),
      }, true);
      const vendor = freshStore.addVendor(
        { name: 'Delete Vendor', email: 'delete@vendor.test' },
        null,
        null,
        { deferPersistence: true }
      );

      await expect(freshStore.deleteVendorDurably(vendor.id, 'admin@vendor.test')).resolves.toBe(true);
      expect(domainQueries.deleteVendorInDB).toHaveBeenCalledWith(vendor.id);
      expect(freshStore.getVendorById(vendor.id, 'all')).toBeUndefined();
      expect(freshStore.getAuditLogs().some((entry) => entry.action.includes('Removed vendor Delete Vendor'))).toBe(true);
      await expect(freshStore.deleteVendorDurably(vendor.id)).resolves.toBe(false);
    });

    test('deleteVendorDurably preserves the cached vendor after a failed delete', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteVendorInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      const vendor = freshStore.addVendor(
        { name: 'Retained Vendor', email: 'retained@vendor.test' },
        null,
        null,
        { deferPersistence: true }
      );

      await expect(freshStore.deleteVendorDurably(vendor.id)).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(freshStore.getVendorById(vendor.id, 'all')).toBe(vendor);
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist vendor deletion', expect.any(Error), 'STORE_SERVICE');
    });

    test('updateVendorCategoriesDurably persists aligned category state before returning', async () => {
      let vendor;
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn(async (id) => id === vendor?.id ? { id, vendor, raw: JSON.stringify(vendor) } : null),
        updateVendorIfUnchangedInDB: jest.fn(async (_snapshot, updatedVendor) => updatedVendor),
      }, true);
      vendor = freshStore.addVendor(
        { name: 'Category Vendor', email: 'category@vendor.test' },
        null,
        null,
        { deferPersistence: true }
      );

      const updated = await freshStore.updateVendorCategoriesDurably(vendor.id, {
        clientMappedCategories: ['Electrical'],
        vendorSelectedCategories: ['Electrical'],
      });
      expect(updated.isCategoryAligned).toBe(true);
      expect(domainQueries.updateVendorIfUnchangedInDB).toHaveBeenCalledWith(
        expect.objectContaining({ id: vendor.id }),
        expect.objectContaining({ clientMappedCategories: ['Electrical'], vendorSelectedCategories: ['Electrical'] })
      );
      await expect(freshStore.updateVendorCategoriesDurably('missing-vendor', {})).resolves.toBeNull();
      await expect(freshStore.updateVendorCategoriesDurably(vendor.id, {
        clientMappedCategories: [],
        vendorSelectedCategories: [],
      })).resolves.toMatchObject({ isCategoryAligned: true });
      await expect(freshStore.updateVendorCategoriesDurably(vendor.id, {
        clientMappedCategories: ['Electrical'],
        vendorSelectedCategories: ['Mechanical'],
      })).resolves.toMatchObject({ isCategoryAligned: false });
    });

    test('updateVendorDurably can find a persisted vendor outside the bootstrap cache', async () => {
      const remoteVendor = { id: 'remote-vendor-2', email: 'remote-two@vendor.test', name: 'Remote Vendor' };
      const { freshStore } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn().mockResolvedValue({ id: remoteVendor.id, vendor: remoteVendor, raw: JSON.stringify(remoteVendor) }),
        updateVendorIfUnchangedInDB: jest.fn(async (_snapshot, record) => record),
      }, true);

      const updated = await freshStore.updateVendorDurably(remoteVendor.id, { rating: 4.9 });

      expect(updated).toMatchObject({ id: remoteVendor.id, rating: 4.9 });
      expect(freshStore.vendors).toContain(updated);
    });

    test('reviseVendorRatingDurably persists before audit and leaves email delivery to the durable outbox', async () => {
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      const mailerMock = {
        buildRatingRevisionEmail: jest.fn(() => ({ subject: 'Rating update' })),
        sendVendorIngestionEmail: jest.fn().mockResolvedValue({ sent: true }),
      };
      let vendor;
      const { freshStore, domainQueries, mailerService } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn(async (id) => id === vendor?.id ? { id, vendor, raw: JSON.stringify(vendor) } : null),
        updateVendorIfUnchangedInDB: jest.fn(async (_snapshot, candidate) => {
          await writeGate;
          return candidate;
        }),
      }, true, mailerMock);
      vendor = freshStore.addVendor(
        { name: 'Rating Vendor', email: 'rating@vendor.test' },
        null,
        null,
        { deferPersistence: true }
      );
      const ratingAuditCount = () => freshStore.getAuditLogs().filter((entry) => entry.action.includes('Revised vendor rating')).length;
      const initialRatingAuditCount = ratingAuditCount();
      const revisionPromise = freshStore.reviseVendorRatingDurably(vendor.id, {
        qualityScore: 90,
        costScore: 88,
        deliveryScore: 92,
        buyerEmail: 'buyer@buyer.test',
      });

      await flush();
      expect(domainQueries.updateVendorIfUnchangedInDB).toHaveBeenCalledTimes(1);
      expect(mailerService.buildRatingRevisionEmail).not.toHaveBeenCalled();
      expect(ratingAuditCount()).toBe(initialRatingAuditCount);
      releaseWrite();

      const result = await revisionPromise;
      await flush();
      expect(result.updatedVendor.ratingRevisionHistory).toHaveLength(1);
      expect(result.revisionRecord.emailDispatched).toBe(true);
      expect(result.revisionRecord.id).toMatch(/^rev-[0-9a-f-]{36}$/i);
      expect(result.revisionRecord.shaSignature).toMatch(/^sha256-[a-f0-9]{64}$/);
      expect(mailerService.buildRatingRevisionEmail).not.toHaveBeenCalled();
      expect(mailerService.sendVendorIngestionEmail).not.toHaveBeenCalled();
      expect(ratingAuditCount()).toBe(initialRatingAuditCount + 1);
      await expect(freshStore.reviseVendorRatingDurably('missing-vendor', {})).resolves.toBeNull();
    });

    test('recomputes a rating revision from the refreshed database snapshot after a CAS conflict', async () => {
      let databaseVendor;
      let writeAttempt = 0;
      const priorRevision = { id: 'revision-written-by-another-isolate', newRating: 4.4 };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn(async (id) => id === databaseVendor?.id
          ? { id, vendor: databaseVendor, raw: JSON.stringify(databaseVendor) }
          : null),
        updateVendorIfUnchangedInDB: jest.fn(async (_snapshot, candidate) => {
          writeAttempt += 1;
          if (writeAttempt === 1) {
            databaseVendor = {
              ...databaseVendor,
              rating: 4.4,
              score: 88,
              latestRatingRevision: priorRevision,
              ratingRevisionHistory: [priorRevision],
            };
            return null;
          }
          databaseVendor = candidate;
          return candidate;
        }),
      }, true);
      const cachedVendor = freshStore.addVendor(
        { name: 'Concurrent Rating Vendor', email: 'concurrent-rating@vendor.test', rating: 3.2, score: 64 },
        null,
        null,
        { deferPersistence: true }
      );
      databaseVendor = { ...cachedVendor, rating: 3.8, score: 76, ratingRevisionHistory: [] };

      const result = await freshStore.reviseVendorRatingDurably(cachedVendor.id, {
        qualityScore: 90,
        costScore: 88,
        deliveryScore: 92,
      });

      expect(domainQueries.updateVendorIfUnchangedInDB).toHaveBeenCalledTimes(2);
      expect(result.revisionRecord.previousRating).toBe(4.4);
      expect(result.revisionRecord.previousScore).toBe(88);
      expect(result.updatedVendor.ratingRevisionHistory).toHaveLength(2);
      expect(result.updatedVendor.ratingRevisionHistory[1]).toBe(priorRevision);
    });

    test('revises a persisted vendor that is outside the bootstrap cache', async () => {
      const remoteVendor = {
        id: 'remote-rating-vendor',
        email: 'remote-rating@vendor.test',
        name: 'Remote Rating Vendor',
        rating: 4.1,
        score: 82,
        ratingRevisionHistory: [],
      };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getVendorByIdFromDB: jest.fn().mockResolvedValue(remoteVendor),
        getVendorSnapshotByIdFromDB: jest.fn().mockResolvedValue({
          id: remoteVendor.id,
          vendor: remoteVendor,
          raw: JSON.stringify(remoteVendor),
        }),
        updateVendorIfUnchangedInDB: jest.fn(async (_snapshot, candidate) => candidate),
      }, true);

      const result = await freshStore.reviseVendorRatingDurably(remoteVendor.id, {
        qualityScore: 90,
        costScore: 88,
        deliveryScore: 92,
      });

      expect(domainQueries.getVendorByIdFromDB).toHaveBeenCalledWith(remoteVendor.id, { fresh: true });
      expect(result.updatedVendor.ratingRevisionHistory).toHaveLength(1);
      expect(freshStore.vendors).toContain(result.updatedVendor);
    });

    test('reviseVendorRatingDurably does not email or audit when persistence fails', async () => {
      const mailerMock = {
        buildRatingRevisionEmail: jest.fn(() => ({ subject: 'Rating update' })),
        sendVendorIngestionEmail: jest.fn().mockResolvedValue({ sent: true }),
      };
      let vendor;
      const { freshStore, mailerService } = freshStoreWithFailingWrite({
        getVendorSnapshotByIdFromDB: jest.fn(async (id) => id === vendor?.id ? { id, vendor, raw: JSON.stringify(vendor) } : null),
        updateVendorIfUnchangedInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true, mailerMock);
      vendor = freshStore.addVendor(
        { name: 'Unrecorded Rating Vendor', email: 'unrecorded@vendor.test', rating: 3.2 },
        null,
        null,
        { deferPersistence: true }
      );

      await expect(freshStore.reviseVendorRatingDurably(vendor.id, {
        qualityScore: 90,
        costScore: 88,
        deliveryScore: 92,
      })).rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      expect(freshStore.getVendorById(vendor.id, 'all')).toBe(vendor);
      expect(vendor.rating).toBe(3.2);
      expect(mailerService.buildRatingRevisionEmail).not.toHaveBeenCalled();
      expect(freshStore.getAuditLogs().some((entry) => entry.action.includes('Revised vendor rating'))).toBe(false);
    });

    test('createEvaluationDurably persists before caching and writing the audit event', async () => {
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        upsertEvaluationInDB: jest.fn(async (evaluation) => {
          await writeGate;
          return evaluation;
        }),
      }, true);
      const evaluationAuditCount = () => freshStore.getAuditLogs().filter((entry) => entry.action.includes('Executed 360° AI Supplier Audit')).length;
      const initialAuditCount = evaluationAuditCount();
      const creationPromise = freshStore.createEvaluationDurably({
        id: 'evaluation-durable-1',
        vendorId: 'vendor-durable-1',
        vendorName: 'Durable Evaluation Vendor',
        moduleScores: {},
      });

      expect(domainQueries.upsertEvaluationInDB).toHaveBeenCalledTimes(1);
      expect(freshStore.evaluations).toHaveLength(0);
      expect(evaluationAuditCount()).toBe(initialAuditCount);
      releaseWrite();

      const saved = await creationPromise;
      expect(freshStore.evaluations).toEqual([saved]);
      expect(saved.id).toBe('evaluation-durable-1');
      expect(evaluationAuditCount()).toBe(initialAuditCount + 1);
    });

    test('createEvaluationDurably fails closed without caching when configured persistence fails', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertEvaluationInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);

      await expect(freshStore.createEvaluationDurably({ vendorName: 'Unpersisted Vendor' })).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(freshStore.evaluations).toHaveLength(0);
      expect(freshStore.getAuditLogs()).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist vendor evaluation', expect.any(Error), 'STORE_SERVICE');
    });

    test('createEvaluationDurably preserves evaluation ownership conflicts as HTTP 409', async () => {
      const identityConflict = Object.assign(new Error('evaluation ID belongs to another vendor'), {
        code: 'EVALUATION_IDENTITY_CONFLICT',
      });
      const { freshStore } = freshStoreWithFailingWrite({
        upsertEvaluationInDB: jest.fn().mockRejectedValue(identityConflict),
      }, true);

      await expect(freshStore.createEvaluationDurably({
        id: 'evaluation-owned-by-another-vendor',
        vendorId: 'current-vendor',
      })).rejects.toMatchObject({
        statusCode: 409,
        code: 'EVALUATION_IDENTITY_CONFLICT',
      });
      expect(freshStore.evaluations).toHaveLength(0);
    });

    test('createEvaluationDurably supports explicitly unconfigured local mode', async () => {
      const { freshStore } = freshStoreWithFailingWrite({}, false);
      const saved = await freshStore.createEvaluationDurably({ vendorName: 'Memory Evaluation Vendor' });

      expect(freshStore.evaluations).toEqual([saved]);
      expect(saved.vendorName).toBe('Memory Evaluation Vendor');
    });

    test('addAIFeedItemDurably persists before caching the feed item', async () => {
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        upsertAIFeedItemInDB: jest.fn(async (item) => {
          await writeGate;
          return { ...item, title: 'Persisted feed title' };
        }),
      }, true);
      const creationPromise = freshStore.addAIFeedItemDurably({ title: 'Original title', message: 'Saved alert' });

      expect(domainQueries.upsertAIFeedItemInDB).toHaveBeenCalledTimes(1);
      expect(freshStore.getAIFeed()).toHaveLength(0);
      releaseWrite();

      const saved = await creationPromise;
      expect(saved.title).toBe('Persisted feed title');
      expect(freshStore.getAIFeed()).toEqual([saved]);
    });

    test('getAIFeedDurably refreshes its cache from the database', async () => {
      const persisted = [{ id: 'feed-db-1', title: 'Other isolate item', message: 'Persisted' }];
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getAIFeedFromDB: jest.fn().mockResolvedValue(persisted),
      }, true);
      freshStore.aiFeed = [{ id: 'feed-stale', title: 'Stale local item' }];

      await expect(freshStore.getAIFeedDurably(100)).resolves.toEqual(persisted);
      expect(domainQueries.getAIFeedFromDB).toHaveBeenCalledWith(100);
      expect(freshStore.aiFeed).toEqual(persisted);
    });

    test('getAIFeedDurably fails closed and preserves its prior cache on a database outage', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        getAIFeedFromDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      const stale = { id: 'feed-stale', title: 'Stale local item' };
      freshStore.aiFeed = [stale];

      await expect(freshStore.getAIFeedDurably()).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(freshStore.aiFeed).toEqual([stale]);
      expect(errorSpy).toHaveBeenCalledWith('Failed to refresh AI feed from persistence', expect.any(Error), 'STORE_SERVICE');
    });

    test('getAIFeedDurably reads the in-memory collection in explicitly unconfigured local mode', async () => {
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({}, false);
      const localItem = { id: 'feed-local', title: 'Local item' };
      freshStore.aiFeed = [localItem];

      await expect(freshStore.getAIFeedDurably()).resolves.toEqual([localItem]);
      expect(domainQueries.getAIFeedFromDB).not.toHaveBeenCalled();
    });

    test('getAIFeedDurably treats a malformed database result as an empty collection', async () => {
      const { freshStore } = freshStoreWithFailingWrite({
        getAIFeedFromDB: jest.fn().mockResolvedValue(null),
      }, true);
      freshStore.aiFeed = [{ id: 'feed-stale' }];

      await expect(freshStore.getAIFeedDurably()).resolves.toEqual([]);
      expect(freshStore.aiFeed).toEqual([]);
    });

    test('addAIFeedItemDurably fails closed when configured persistence rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertAIFeedItemInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);

      await expect(freshStore.addAIFeedItemDurably({ title: 'Unsaved feed', message: 'Retry me' })).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(freshStore.getAIFeed()).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist AI feed item', expect.any(Error), 'STORE_SERVICE');
    });

    test('addAIFeedItemDurably fails closed when configured upsert returns no row', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({}, true);

      await expect(freshStore.addAIFeedItemDurably({ title: 'Missing row', message: 'Do not cache' })).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(freshStore.getAIFeed()).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist AI feed item', expect.any(Error), 'STORE_SERVICE');
    });

    test('addAIFeedItemDurably supports explicitly unconfigured local mode', async () => {
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({}, false);
      const saved = await freshStore.addAIFeedItemDurably({ title: 'Local feed', message: 'Memory mode' });

      expect(saved.title).toBe('Local feed');
      expect(freshStore.getAIFeed()).toEqual([saved]);
      expect(domainQueries.upsertAIFeedItemInDB).toHaveBeenCalledTimes(1);
    });

    test('addVendorDurably persists before caching or writing the audit entry', async () => {
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        upsertVendorInDB: jest.fn(async (vendor) => {
          await writeGate;
          return vendor;
        }),
      }, true);
      const vendorAuditCount = () => freshStore.getAuditLogs().filter((entry) => entry.action.includes('Registered vendor Durable Vendor')).length;
      const initialAuditCount = vendorAuditCount();
      const creationPromise = freshStore.addVendorDurably(
        { name: 'Durable Vendor', email: '  DURABLE@VENDOR.TEST ', majorCategory: 'Mechanical' },
        'admin@vendor.test'
      );

      expect(domainQueries.upsertVendorInDB).toHaveBeenCalledWith(expect.objectContaining({ email: 'durable@vendor.test' }));
      expect(freshStore.vendors).toHaveLength(0);
      expect(vendorAuditCount()).toBe(initialAuditCount);
      releaseWrite();

      const saved = await creationPromise;
      expect(freshStore.vendors).toEqual([saved]);
      expect(saved.email).toBe('durable@vendor.test');
      expect(vendorAuditCount()).toBe(initialAuditCount + 1);
    });

    test('addVendorDurably rejects configured failures without phantom cache or audit rows', async () => {
      const conflict = new Error('duplicate key');
      conflict.code = '23505';
      const conflictStore = freshStoreWithFailingWrite({
        upsertVendorInDB: jest.fn().mockRejectedValue(conflict),
      }, true);
      await expect(conflictStore.freshStore.addVendorDurably({ name: 'Conflict Vendor', email: 'conflict@vendor.test' }))
        .rejects.toMatchObject({ statusCode: 409, code: 'VENDOR_EMAIL_CONFLICT' });
      expect(conflictStore.freshStore.vendors).toHaveLength(0);
      expect(conflictStore.freshStore.getAuditLogs().some((entry) => entry.action.includes('Conflict Vendor'))).toBe(false);

      const unavailableStore = freshStoreWithFailingWrite({
        upsertVendorInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      await expect(unavailableStore.freshStore.addVendorDurably({ name: 'Unavailable Vendor' }))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      expect(unavailableStore.freshStore.vendors).toHaveLength(0);

      const localStore = freshStoreWithFailingWrite({}, false).freshStore;
      const localVendor = await localStore.addVendorDurably({ name: 'Local Vendor', email: 'LOCAL@VENDOR.TEST' });
      expect(localStore.vendors).toEqual([localVendor]);
      expect(localVendor.email).toBe('local@vendor.test');
    });

    test('createPaymentLinkRecordDurably persists before caching and rejects failures', async () => {
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        upsertPaymentLinkInDB: jest.fn(async (link) => {
          await writeGate;
          return link;
        }),
      }, true);
      const createPromise = freshStore.createPaymentLinkRecordDurably({
        id: 'pl-durable-1',
        zohoPaymentLinkId: 'zoho-durable-1',
        buyerAccountId: 'buyer-durable-1',
        payerType: 'buyer',
        planId: 'version_1',
        amount: 100,
        paymentUrl: 'https://payments.example.test/durable',
        status: 'CREATED',
      });

      expect(domainQueries.upsertPaymentLinkInDB).toHaveBeenCalledWith(expect.objectContaining({ id: 'pl-durable-1' }));
      expect(freshStore.paymentLinks).toHaveLength(0);
      releaseWrite();
      const saved = await createPromise;
      expect(freshStore.paymentLinks).toEqual([saved]);

      const { freshStore: unavailableStore } = freshStoreWithFailingWrite({
        upsertPaymentLinkInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      await expect(unavailableStore.createPaymentLinkRecordDurably({ id: 'pl-failed-1', zohoPaymentLinkId: 'zoho-failed-1' }))
        .rejects.toMatchObject({ statusCode: 503, code: 'PAYMENT_LINK_PERSISTENCE_UNAVAILABLE' });
      expect(unavailableStore.paymentLinks).toHaveLength(0);

      const localStore = freshStoreWithFailingWrite({}, false).freshStore;
      const localLink = await localStore.createPaymentLinkRecordDurably({ id: 'pl-local-1', zohoPaymentLinkId: 'zoho-local-1' });
      expect(localStore.paymentLinks).toEqual([localLink]);
    });

    test('updatePaymentLinkRecordDurably merges the fresh row and protects paid activation state', async () => {
      const stale = { id: 'pl-status-durable', status: 'active', rawResponse: { old: true } };
      const expectedUpdated = { ...stale, providerField: 'newer-db-value', status: 'CANCELED', rawResponse: { canceled: true } };
      const paid = { ...stale, status: 'PAID', activated: true };
      const paymentActivationQueries = {
        updatePaymentLinkStatusInDB: jest.fn().mockResolvedValueOnce(expectedUpdated).mockResolvedValueOnce(null),
      };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getPaymentLinkByIdFromDB: jest.fn().mockResolvedValueOnce(paid),
      }, true, null, paymentActivationQueries);
      freshStore.paymentLinks.push(stale);

      const updated = await freshStore.updatePaymentLinkRecordDurably('pl-status-durable', { status: 'CANCELED', rawResponse: { canceled: true } });
      expect(paymentActivationQueries.updatePaymentLinkStatusInDB).toHaveBeenCalledWith('pl-status-durable', { status: 'CANCELED', rawResponse: { canceled: true } });
      expect(domainQueries.getPaymentLinkByIdFromDB).not.toHaveBeenCalled();
      expect(freshStore.paymentLinks).toEqual([expectedUpdated]);

      const refreshedPaid = await freshStore.updatePaymentLinkRecordDurably('pl-status-durable', { status: 'expired' });
      expect(refreshedPaid).toMatchObject({ status: 'PAID', activated: true });
      expect(domainQueries.getPaymentLinkByIdFromDB).toHaveBeenCalledWith('pl-status-durable', { fresh: true });
      expect(freshStore.paymentLinks).toEqual([paid]);
    });

    test('updatePaymentLinkRecordDurably keeps cache unchanged after configured persistence failure', async () => {
      const previous = { id: 'pl-status-fail', status: 'active' };
      const paymentActivationQueries = { updatePaymentLinkStatusInDB: jest.fn().mockRejectedValue(new Error('database unavailable')) };
      const { freshStore } = freshStoreWithFailingWrite({}, true, null, paymentActivationQueries);
      freshStore.paymentLinks.push(previous);

      await expect(freshStore.updatePaymentLinkRecordDurably('pl-status-fail', { status: 'expired' }))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      expect(freshStore.paymentLinks).toEqual([previous]);

      const readFailedPaymentQueries = { updatePaymentLinkStatusInDB: jest.fn().mockResolvedValue(null) };
      const readFailedStore = freshStoreWithFailingWrite({
        getPaymentLinkByIdFromDB: jest.fn().mockRejectedValue(new Error('read unavailable')),
      }, true, null, readFailedPaymentQueries).freshStore;
      await expect(readFailedStore.updatePaymentLinkRecordDurably('pl-read-fail', { status: 'expired' }))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });

      const localStore = freshStoreWithFailingWrite({}, false).freshStore;
      localStore.paymentLinks.push({ id: 'pl-local-update', status: 'active' });
      await expect(localStore.updatePaymentLinkRecordDurably('pl-local-update', { status: 'expired' }))
        .resolves.toMatchObject({ status: 'expired' });
    });

    test('addBuyerAccountDurably persists before caching and audit logging', async () => {
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        upsertBuyerAccountInDB: jest.fn(async (account) => {
          await writeGate;
          return account;
        }),
      }, true);
      const accountAuditCount = () => freshStore.getAuditLogs().filter((entry) => entry.action.includes('Created buyer account for Durable Buyer')).length;
      const initialAuditCount = accountAuditCount();
      const creationPromise = freshStore.addBuyerAccountDurably({
        id: 'buyer-durable-1',
        organizationName: 'Durable Buyer',
        corporateEmail: 'durable@buyer.test',
      });

      expect(domainQueries.upsertBuyerAccountInDB).toHaveBeenCalledTimes(1);
      expect(freshStore.buyerAccounts).toHaveLength(0);
      expect(accountAuditCount()).toBe(initialAuditCount);
      releaseWrite();

      const saved = await creationPromise;
      expect(freshStore.buyerAccounts).toEqual([saved]);
      expect(accountAuditCount()).toBe(initialAuditCount + 1);
    });

    test('addBuyerAccountDurably maps duplicate emails without caching the rejected record', async () => {
      const conflict = new Error('unique constraint failed');
      conflict.code = '23505';
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertBuyerAccountInDB: jest.fn().mockRejectedValue(conflict),
      }, true);

      await expect(freshStore.addBuyerAccountDurably({
        organizationName: 'Duplicate Buyer',
        corporateEmail: 'duplicate@buyer.test',
      })).rejects.toMatchObject({ statusCode: 409, code: 'BUYER_EMAIL_CONFLICT' });
      expect(freshStore.buyerAccounts).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist buyer account creation', expect.any(Error), 'STORE_SERVICE');

      const unavailable = freshStoreWithFailingWrite({
        upsertBuyerAccountInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      await expect(unavailable.freshStore.addBuyerAccountDurably({
        organizationName: 'Unavailable Buyer',
        corporateEmail: 'unavailable@buyer.test',
      })).rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      expect(unavailable.freshStore.buyerAccounts).toHaveLength(0);

      const noStorage = freshStoreWithFailingWrite({}, false).freshStore;
      const local = await noStorage.addBuyerAccountDurably({ organizationName: 'Local Buyer' });
      expect(noStorage.buyerAccounts).toEqual([local]);
    });

    test('updateBuyerAccountDurably updates active state only after a successful database write', async () => {
      const accounts = new Map();
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getBuyerAccountSnapshotByIdFromDB: jest.fn(async (id) => {
          const account = accounts.get(id);
          return account ? { id, account, raw: JSON.stringify(account) } : null;
        }),
        updateBuyerAccountIfUnchangedInDB: jest.fn(async (_snapshot, account) => {
          accounts.set(account.id, account);
          return account;
        }),
      }, true);
      const account = {
        id: 'buyer-update-1',
        organizationName: 'Old Buyer Name',
        corporateEmail: 'update@buyer.test',
        remainingFreeRFQs: 4,
      };
      accounts.set(account.id, { ...account, profileLastWrittenElsewhere: true });
      freshStore.buyerAccounts.push(account);
      freshStore.activeBuyerAccount = account;

      const updated = await freshStore.updateBuyerAccountDurably(account.id, { organizationName: 'New Buyer Name' });
      expect(domainQueries.updateBuyerAccountIfUnchangedInDB).toHaveBeenCalledWith(
        expect.objectContaining({ id: account.id }),
        expect.objectContaining({ organizationName: 'New Buyer Name' })
      );
      expect(freshStore.activeBuyerAccount).toBe(updated);
      expect(updated.organizationName).toBe('New Buyer Name');
      expect(updated.profileLastWrittenElsewhere).toBe(true);
      await expect(freshStore.updateBuyerAccountDurably('missing-buyer', {})).resolves.toBeNull();
      const inactive = { id: 'buyer-update-2', organizationName: 'Inactive Buyer', corporateEmail: 'inactive@buyer.test' };
      accounts.set(inactive.id, inactive);
      freshStore.buyerAccounts.push(inactive);
      await freshStore.updateBuyerAccountDurably(inactive.id, { organizationName: 'Still Inactive' });
      expect(freshStore.activeBuyerAccount).toBe(updated);

      const localStore = freshStoreWithFailingWrite({}, false).freshStore;
      localStore.buyerAccounts.push(account);
      await expect(localStore.updateBuyerAccountDurably(account.id, { organizationName: 'Local Update' }))
        .resolves.toMatchObject({ organizationName: 'Local Update' });
      await expect(localStore.updateBuyerAccountDurably('missing-buyer', {})).resolves.toBeNull();

      const failed = freshStoreWithFailingWrite({
        getBuyerAccountSnapshotByIdFromDB: jest.fn(async () => ({ id: account.id, account, raw: JSON.stringify(account) })),
        updateBuyerAccountIfUnchangedInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      failed.freshStore.buyerAccounts.push(account);
      failed.freshStore.activeBuyerAccount = account;
      await expect(failed.freshStore.updateBuyerAccountDurably(account.id, { organizationName: 'Unsaved Name' }))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      expect(failed.freshStore.buyerAccounts[0]).toBe(account);
      expect(failed.freshStore.activeBuyerAccount).toBe(account);
      expect(failed.errorSpy).toHaveBeenCalledWith('Failed to persist buyer account update', expect.any(Error), 'STORE_SERVICE');

      const conflict = new Error('unique constraint failed');
      conflict.code = '23505';
      const conflictStore = freshStoreWithFailingWrite({
        getBuyerAccountSnapshotByIdFromDB: jest.fn(async () => ({ id: account.id, account, raw: JSON.stringify(account) })),
        updateBuyerAccountIfUnchangedInDB: jest.fn().mockRejectedValue(conflict),
      }, true).freshStore;
      conflictStore.buyerAccounts.push(account);
      await expect(conflictStore.updateBuyerAccountDurably(account.id, { corporateEmail: 'claimed@buyer.test' }))
        .rejects.toMatchObject({ statusCode: 409, code: 'BUYER_EMAIL_CONFLICT' });
    });

    test('deleteBuyerAccountDurably commits deletion and active replacement before changing cached state', async () => {
      let releaseDelete;
      const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
      const activeAccount = { id: 'buyer-delete-next', organizationName: 'Next Buyer' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        deleteBuyerAccountAndPromoteActiveInDB: jest.fn(async () => {
          await deleteGate;
          return { deleted: true, activeAccount };
        }),
      }, true);
      const deleted = { id: 'buyer-delete-current', organizationName: 'Current Buyer', corporateEmail: 'current@buyer.test' };
      freshStore.buyerAccounts.push(deleted, activeAccount);
      freshStore.activeBuyerAccount = deleted;

      const deletionPromise = freshStore.deleteBuyerAccountDurably(deleted.id);
      expect(domainQueries.deleteBuyerAccountAndPromoteActiveInDB).toHaveBeenCalledWith(deleted.id);
      expect(freshStore.buyerAccounts).toEqual([deleted, activeAccount]);
      expect(freshStore.activeBuyerAccount).toBe(deleted);
      releaseDelete();

      await expect(deletionPromise).resolves.toEqual({ deleted: true, activeAccount });
      expect(freshStore.buyerAccounts).toEqual([activeAccount]);
      expect(freshStore.activeBuyerAccount).toBe(activeAccount);
      expect(freshStore.getAuditLogs().some((entry) => entry.action.includes('Deleted buyer account for Current Buyer'))).toBe(true);
    });

    test('deleteBuyerAccountDurably preserves cache on missing rows or persistence failures and supports memory mode', async () => {
      const missing = freshStoreWithFailingWrite({
        deleteBuyerAccountAndPromoteActiveInDB: jest.fn().mockResolvedValue({ deleted: false, activeAccount: null }),
      }, true).freshStore;
      const persistedAccount = { id: 'buyer-delete-missing', organizationName: 'Persisted Buyer' };
      missing.buyerAccounts.push(persistedAccount);
      await expect(missing.deleteBuyerAccountDurably(persistedAccount.id)).resolves.toBe(false);
      expect(missing.buyerAccounts).toEqual([persistedAccount]);

      const failed = freshStoreWithFailingWrite({
        deleteBuyerAccountAndPromoteActiveInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      failed.freshStore.buyerAccounts.push(persistedAccount);
      failed.freshStore.activeBuyerAccount = persistedAccount;
      await expect(failed.freshStore.deleteBuyerAccountDurably(persistedAccount.id))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE', retryable: true });
      expect(failed.freshStore.buyerAccounts).toEqual([persistedAccount]);
      expect(failed.freshStore.activeBuyerAccount).toBe(persistedAccount);
      expect(failed.errorSpy).toHaveBeenCalledWith(
        'Failed to durably delete buyer account and reconcile active account',
        expect.any(Error),
        'STORE_SERVICE'
      );

      const local = freshStoreWithFailingWrite({}, false).freshStore;
      const onlyAccount = { id: 'buyer-delete-local', organizationName: 'Local Buyer' };
      local.buyerAccounts.push(onlyAccount);
      local.activeBuyerAccount = onlyAccount;
      await expect(local.deleteBuyerAccountDurably(onlyAccount.id)).resolves.toEqual({
        deleted: true,
        activeAccount: null,
      });
      expect(local.buyerAccounts).toEqual([]);
      expect(local.activeBuyerAccount).toBeNull();
    });

    test('alignActiveBuyerAccountDurably changes the pointer only after persistence and handles fallback paths', async () => {
      let releaseUpdate;
      const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
      const savedAccount = { id: 'buyer-active-durable', organizationName: 'Saved Buyer' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        setActiveBuyerAccountDurablyInDB: jest.fn()
          .mockImplementationOnce(async () => {
            await updateGate;
            return savedAccount;
          })
          .mockResolvedValueOnce(null),
      }, true);
      const priorAccount = { id: 'buyer-active-prior', organizationName: 'Prior Buyer' };
      freshStore.buyerAccounts.push(priorAccount, savedAccount);
      freshStore.activeBuyerAccount = priorAccount;

      const activationPromise = freshStore.alignActiveBuyerAccountDurably(savedAccount.id);
      expect(domainQueries.setActiveBuyerAccountDurablyInDB).toHaveBeenCalledWith(savedAccount.id);
      expect(freshStore.activeBuyerAccount).toBe(priorAccount);
      releaseUpdate();
      await expect(activationPromise).resolves.toBe(savedAccount);
      expect(freshStore.activeBuyerAccount).toBe(savedAccount);
      await expect(freshStore.alignActiveBuyerAccountDurably('missing-account')).resolves.toBeNull();

      const local = freshStoreWithFailingWrite({}, false).freshStore;
      local.buyerAccounts.push(savedAccount);
      await expect(local.alignActiveBuyerAccountDurably(savedAccount.id)).resolves.toBe(savedAccount);

      const failed = freshStoreWithFailingWrite({
        setActiveBuyerAccountDurablyInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      failed.freshStore.buyerAccounts.push(priorAccount, savedAccount);
      failed.freshStore.activeBuyerAccount = priorAccount;
      await expect(failed.freshStore.alignActiveBuyerAccountDurably(savedAccount.id))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE', retryable: true });
      expect(failed.freshStore.activeBuyerAccount).toBe(priorAccount);
      expect(failed.errorSpy).toHaveBeenCalledWith('Failed to durably set active buyer account', expect.any(Error), 'STORE_SERVICE');
    });

    test('addBuyerCreditsDurably updates account cache only after its database transaction commits', async () => {
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      const savedAccount = { id: 'buyer-credit-durable', remainingFreeRFQs: 9 };
      const creditTransaction = { id: 'credit-tx-1', idempotencyKey: 'credit-key-1' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        addBuyerCreditsInDB: jest.fn(async () => {
          await writeGate;
          return { account: savedAccount, previousBalance: 4, updatedBalance: 9, transaction: creditTransaction };
        }),
      }, true);
      const priorAccount = { id: savedAccount.id, remainingFreeRFQs: 4 };
      freshStore.buyerAccounts.push(priorAccount);
      freshStore.activeBuyerAccount = priorAccount;

      const addPromise = freshStore.addBuyerCreditsDurably(savedAccount.id, 5, creditTransaction);
      expect(domainQueries.addBuyerCreditsInDB).toHaveBeenCalledWith({
        buyerId: savedAccount.id,
        amount: 5,
        transaction: creditTransaction,
      });
      expect(freshStore.buyerAccounts[0]).toBe(priorAccount);
      expect(freshStore.activeBuyerAccount).toBe(priorAccount);
      releaseWrite();

      await expect(addPromise).resolves.toMatchObject({ previousBalance: 4, updatedBalance: 9 });
      expect(freshStore.buyerAccounts[0]).toBe(savedAccount);
      expect(freshStore.activeBuyerAccount).toBe(savedAccount);
    });

    test('addBuyerCreditsDurably supports local mode and preserves state on storage failures', async () => {
      const local = freshStoreWithFailingWrite({}, false).freshStore;
      const account = { id: 'buyer-credit-local', remainingFreeRFQs: 2 };
      local.buyerAccounts.push(account);
      local.activeBuyerAccount = account;
      await expect(local.addBuyerCreditsDurably(account.id, 3, { id: 'local-tx' }))
        .resolves.toMatchObject({ previousBalance: 2, updatedBalance: 5 });
      expect(local.activeBuyerAccount.remainingFreeRFQs).toBe(5);
      await expect(local.addBuyerCreditsDurably('missing-buyer', 3, { id: 'missing-tx' })).resolves.toBeNull();

      const failed = freshStoreWithFailingWrite({
        addBuyerCreditsInDB: jest.fn().mockRejectedValue(Object.assign(new Error('database unavailable'), {
          statusCode: 503,
          code: 'PERSISTENCE_UNAVAILABLE',
        })),
      }, true);
      failed.freshStore.buyerAccounts.push(account);
      failed.freshStore.activeBuyerAccount = account;
      await expect(failed.freshStore.addBuyerCreditsDurably(account.id, 3, { id: 'failed-tx' }))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE', retryable: true });
      expect(failed.freshStore.buyerAccounts[0]).toBe(account);
      expect(failed.freshStore.activeBuyerAccount).toBe(account);
      expect(failed.errorSpy).toHaveBeenCalledWith('Failed to add buyer credits durably', expect.any(Error), 'STORE_SERVICE');
    });

    test('_persistRFQ logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertRFQInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.createRFQ({ rfqNumber: 'RFQ-PERSIST-TEST-1' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist RFQ', expect.any(Error), 'STORE_SERVICE');
    });

    test('_removeRFQ logs when the write-through delete rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteRFQInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const rfq = freshStore.createRFQ({ rfqNumber: 'RFQ-PERSIST-TEST-2' });
      freshStore.deleteRFQ(rfq.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to delete persisted RFQ', expect.any(Error), 'STORE_SERVICE');
    });

    test('deleteRFQ persists by row ID when called with the public RFQ number', async () => {
      const { freshStore, domainQueries } = freshStoreWithFailingWrite();
      const rfq = freshStore.createRFQ({ id: 'rfq-row-42', rfqNumber: 'RFQ-PUBLIC-42' });

      expect(freshStore.deleteRFQ(rfq.rfqNumber)).toBe(true);
      await flush();

      expect(domainQueries.deleteRFQInDB).toHaveBeenCalledWith('rfq-row-42');
      expect(freshStore.getRFQById(rfq.rfqNumber)).toBeUndefined();
    });

    test('deleteRFQDurably waits for configured storage before removing the cached RFQ', async () => {
      const deleteRFQInDB = jest.fn().mockResolvedValue(true);
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({ deleteRFQInDB }, true);
      const rfq = freshStore.createRFQ({ id: 'rfq-durable-43', rfqNumber: 'RFQ-DURABLE-43' });

      await expect(freshStore.deleteRFQDurably(rfq.rfqNumber)).resolves.toBe(true);

      expect(domainQueries.deleteRFQInDB).toHaveBeenCalledWith('rfq-durable-43');
      expect(freshStore.getRFQById(rfq.id)).toBeUndefined();
    });

    test('deleteRFQDurably retains the cached RFQ and returns a retryable error on storage failure', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteRFQInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      const rfq = freshStore.createRFQ({ id: 'rfq-durable-failure', rfqNumber: 'RFQ-DURABLE-FAILURE' });

      await expect(freshStore.deleteRFQDurably(rfq.id)).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });

      expect(freshStore.getRFQById(rfq.id)).toEqual(withoutVendorInvitationTargets(rfq));
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist RFQ deletion', expect.any(Error), 'STORE_SERVICE');
    });

    test('deleteRFQDurably returns false for a missing RFQ and permits explicitly unconfigured memory mode', async () => {
      const { freshStore } = freshStoreWithFailingWrite();
      expect(await freshStore.deleteRFQDurably('missing-rfq')).toBe(false);
      const rfq = freshStore.createRFQ({ id: 'rfq-memory-delete', rfqNumber: 'RFQ-MEMORY-DELETE' });

      await expect(freshStore.deleteRFQDurably(rfq.id)).resolves.toBe(true);

      expect(freshStore.getRFQById(rfq.id)).toBeUndefined();
    });

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
      expect(domainQueries.upsertRFQInDB).toHaveBeenCalledWith(expect.objectContaining({
        ...created,
        vendorInvitationTargets: [],
      }));
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
        ...created,
        vendorInvitationTargets: [],
      }), null);
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
      expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
        ...created,
        vendorInvitationTargets: [],
      }), null);
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

    test('updateRFQDurably persists before publishing the updated cache record', async () => {
      const getRFQSnapshotByIdFromDB = jest.fn();
      const updateRFQIfUnchangedInDB = jest.fn();
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getRFQSnapshotByIdFromDB,
        updateRFQIfUnchangedInDB,
      }, true);
      const rfq = freshStore.createRFQ({ id: 'rfq-durable-update', rfqNumber: 'RFQ-DURABLE-UPDATE', title: 'Before' });
      domainQueries.upsertRFQInDB.mockClear();
      const snapshot = { id: rfq.id, rfq, raw: JSON.stringify(rfq) };
      getRFQSnapshotByIdFromDB.mockResolvedValue(snapshot);
      updateRFQIfUnchangedInDB.mockImplementation(async (_current, updated) => updated);

      const updated = await freshStore.updateRFQDurably(rfq.id, { title: 'After' });

      expect(domainQueries.getRFQSnapshotByIdFromDB).toHaveBeenCalledWith(rfq.id);
      expect(domainQueries.updateRFQIfUnchangedInDB).toHaveBeenCalledWith(
        snapshot,
        expect.objectContaining({ id: rfq.id, title: 'After' })
      );
      expect(domainQueries.upsertRFQInDB).not.toHaveBeenCalled();
      expect(freshStore.getRFQById(rfq.id)).toEqual(updated);
      expect(updated.title).toBe('After');
    });

    test('updateRFQDurably preserves the last cached state when storage fails', async () => {
      const { freshStore, errorSpy, domainQueries } = freshStoreWithFailingWrite({}, true);
      const rfq = freshStore.createRFQ({ id: 'rfq-durable-update-failure', rfqNumber: 'RFQ-DURABLE-UPDATE-FAILURE', title: 'Before' });
      domainQueries.getRFQSnapshotByIdFromDB.mockResolvedValue({ id: rfq.id, rfq, raw: JSON.stringify(rfq) });
      domainQueries.updateRFQIfUnchangedInDB.mockRejectedValueOnce(new Error('database unavailable'));

      await expect(freshStore.updateRFQDurably(rfq.id, { title: 'After' })).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });

      expect(freshStore.getRFQById(rfq.id)).toEqual(withoutVendorInvitationTargets(rfq));
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist RFQ mutation', expect.objectContaining({
        error: expect.any(Error),
        rfqId: rfq.id,
        operation: 'update-rfq-compare-and-swap',
      }), 'STORE_SERVICE');
    });

    test('updateRFQDurably fails closed when storage returns no persisted row', async () => {
      const { freshStore, domainQueries, errorSpy } = freshStoreWithFailingWrite({}, true);
      const rfq = freshStore.createRFQ({ id: 'rfq-durable-empty-result', rfqNumber: 'RFQ-DURABLE-EMPTY-RESULT', title: 'Before' });
      domainQueries.getRFQSnapshotByIdFromDB.mockResolvedValue({ id: rfq.id, rfq, raw: JSON.stringify(rfq) });
      domainQueries.updateRFQIfUnchangedInDB.mockResolvedValue(null);

      await expect(freshStore.updateRFQDurably(rfq.id, { title: 'After' })).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });

      expect(freshStore.getRFQById(rfq.id)).toEqual(withoutVendorInvitationTargets(rfq));
      expect(errorSpy).toHaveBeenCalledWith('Failed to persist RFQ mutation', expect.objectContaining({
        error: expect.any(Error),
        rfqId: rfq.id,
        operation: 'update-rfq-compare-and-swap',
      }), 'STORE_SERVICE');
    });

    test('updateRFQDurably reloads and reapplies a patch after a concurrent writer wins', async () => {
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({}, true);
      const cached = freshStore.createRFQ({ id: 'rfq-cas-retry', rfqNumber: 'RFQ-CAS-RETRY', title: 'Cached', assignedVendors: [] });
      const initial = { ...cached, title: 'Database before' };
      const concurrent = { ...initial, description: 'Concurrent change' };
      const initialSnapshot = { id: cached.id, rfq: initial, raw: JSON.stringify(initial) };
      const concurrentSnapshot = { id: cached.id, rfq: concurrent, raw: JSON.stringify(concurrent) };
      domainQueries.getRFQSnapshotByIdFromDB
        .mockResolvedValueOnce(initialSnapshot)
        .mockResolvedValueOnce(concurrentSnapshot);
      domainQueries.updateRFQIfUnchangedInDB
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(async (_snapshot, merged) => merged);

      const updated = await freshStore.updateRFQDurably(cached.id, { title: 'Local change' });

      expect(domainQueries.updateRFQIfUnchangedInDB).toHaveBeenNthCalledWith(2, concurrentSnapshot, expect.objectContaining({
        title: 'Local change',
        description: 'Concurrent change',
      }));
      expect(updated).toMatchObject({ title: 'Local change', description: 'Concurrent change' });
      expect(freshStore.getRFQById(cached.id)).toEqual(updated);
    });

    test('updateRFQDurably returns null when the initial durable snapshot is missing', async () => {
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({}, true);
      const rfq = freshStore.createRFQ({ id: 'rfq-cas-missing-snapshot', title: 'Cached' });
      domainQueries.getRFQSnapshotByIdFromDB.mockResolvedValue(null);

      await expect(freshStore.updateRFQDurably(rfq.id, { title: 'Updated' })).resolves.toBeNull();

      expect(freshStore.getRFQById(rfq.id)).toEqual(withoutVendorInvitationTargets(rfq));
      expect(domainQueries.updateRFQIfUnchangedInDB).not.toHaveBeenCalled();
    });

    test('updateRFQDurably evaluates replacement quotes and updates their count', async () => {
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({}, true);
      const rfq = freshStore.createRFQ({ id: 'rfq-cas-quotes', title: 'Before', quotes: [] });
      const snapshot = { id: rfq.id, rfq, raw: JSON.stringify(rfq) };
      domainQueries.getRFQSnapshotByIdFromDB.mockResolvedValue(snapshot);
      domainQueries.updateRFQIfUnchangedInDB.mockImplementation(async (_current, updated) => updated);

      const updated = await freshStore.updateRFQDurably(rfq.id, { quotes: [] });

      expect(domainQueries.updateRFQIfUnchangedInDB).toHaveBeenCalledWith(snapshot, expect.objectContaining({
        quotes: [],
        quotesCount: 0,
      }));
      expect(updated.quotesCount).toBe(0);
    });

    test('memory-only durable updates normalize legacy quotes and create missing follow-up data', async () => {
      const { freshStore } = freshStoreWithFailingWrite();
      const legacyRFQ = { id: 'rfq-memory-legacy-shape', title: 'Before', assignedVendors: [] };
      freshStore.rfqs.push(legacyRFQ);

      const updated = await freshStore.updateRFQDurably(legacyRFQ.id, { title: 'After', quotes: [] });
      const assignmentResult = await freshStore._appendRFQAssignmentsDurably(
        legacyRFQ.id,
        [{ id: 'vendor-memory-append', name: 'Memory Vendor' }],
        { ensureFollowUpData: true }
      );

      expect(updated).toMatchObject({ title: 'After', quotes: [], quotesCount: 0 });
      expect(assignmentResult.updatedRFQ.followUpData).toMatchObject({
        totalInvited: 1,
        vendors: [{ id: 'vendor-memory-append' }],
      });
      expect(assignmentResult.committedAdditions).toHaveLength(1);
    });

    test('updateRFQDurably returns null if the row disappears after a compare-and-swap conflict', async () => {
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({}, true);
      const rfq = freshStore.createRFQ({ id: 'rfq-cas-deleted-after-conflict', title: 'Before' });
      const snapshot = { id: rfq.id, rfq, raw: JSON.stringify(rfq) };
      domainQueries.getRFQSnapshotByIdFromDB
        .mockResolvedValueOnce(snapshot)
        .mockResolvedValueOnce(null);
      domainQueries.updateRFQIfUnchangedInDB.mockResolvedValueOnce(null);

      await expect(freshStore.updateRFQDurably(rfq.id, { title: 'After' })).resolves.toBeNull();

      expect(domainQueries.getRFQSnapshotByIdFromDB).toHaveBeenCalledTimes(2);
      expect(freshStore.getRFQById(rfq.id)).toEqual(withoutVendorInvitationTargets(rfq));
    });

    test('updateRFQDurably returns null for a missing RFQ and supports unconfigured memory mode', async () => {
      const { freshStore } = freshStoreWithFailingWrite();
      expect(await freshStore.updateRFQDurably('missing-rfq', { title: 'No record' })).toBeNull();
      const rfq = freshStore.createRFQ({ id: 'rfq-memory-update', rfqNumber: 'RFQ-MEMORY-UPDATE', title: 'Before' });

      await expect(freshStore.updateRFQDurably(rfq.id, { title: 'After' })).resolves.toMatchObject({ title: 'After' });

      expect(freshStore.getRFQById(rfq.id).title).toBe('After');
    });

    test('_persistEvaluation logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertEvaluationInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.createEvaluation({ vendorName: 'Test Vendor' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist evaluation', expect.any(Error), 'STORE_SERVICE');
    });

    test('_persistCatalogueProduct logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertCatalogueProductInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.addProductToCatalogue({ name: 'Test SKU' }, 'vendor-persist-test', 'user@x.com');
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist catalogue product', expect.any(Error), 'STORE_SERVICE');
    });

    test('_removeCatalogueProduct logs when the write-through delete rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteCatalogueProductInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const product = freshStore.addProductToCatalogue({ name: 'Test SKU' }, 'vendor-persist-test', 'user@x.com');
      freshStore.deleteCatalogueProduct(product.id, 'user@x.com');
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to delete persisted catalogue product',
        expect.any(Error),
        'STORE_SERVICE'
      );
    });

    test('durable catalogue create, update, and delete mutate cache only after persistence succeeds', async () => {
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        upsertCatalogueProductInDB: jest.fn().mockImplementation(async (product) => ({ ...product })),
        deleteCatalogueProductInDB: jest.fn().mockResolvedValue(true),
      }, true);

      const created = await freshStore.addProductToCatalogueDurably(
        { id: 'catalogue-durable-1', name: 'Durable Product', sku: 'DURABLE-1', unitPrice: 12 },
        'vendor-durable-1',
        'vendor@example.com'
      );
      expect(created).toMatchObject({ id: 'catalogue-durable-1', vendorId: 'vendor-durable-1', unitPrice: 12 });
      expect(freshStore.getCatalogueProductById(created.id)).toEqual(created);

      const updated = await freshStore.updateCatalogueProductDurably(created.id, {
        id: 'client-controlled-id',
        vendorId: 'client-controlled-vendor',
        unitPrice: 18,
      }, 'vendor@example.com');
      expect(updated).toMatchObject({ id: created.id, vendorId: 'vendor-durable-1', unitPrice: 18 });
      expect(domainQueries.upsertCatalogueProductInDB).toHaveBeenCalledTimes(2);

      await expect(freshStore.deleteCatalogueProductDurably(created.id, 'vendor@example.com')).resolves.toBe(true);
      expect(freshStore.getCatalogueProductById(created.id)).toBeUndefined();
      await expect(freshStore.deleteCatalogueProductDurably(created.id, 'vendor@example.com')).resolves.toBe(false);
    });

    test('durable catalogue write failures preserve cached records and report retryable errors', async () => {
      const original = { id: 'catalogue-durable-failure', vendorId: 'vendor-durable-2', sku: 'KEEP', unitPrice: 12 };
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertCatalogueProductInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
        deleteCatalogueProductInDB: jest.fn().mockRejectedValue(new Error('database unavailable')),
      }, true);
      freshStore.vendorCatalogue = [original];

      await expect(freshStore.addProductToCatalogueDurably({ name: 'Failed create' }, original.vendorId))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      await expect(freshStore.updateCatalogueProductDurably(original.id, { unitPrice: 99 }))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      await expect(freshStore.deleteCatalogueProductDurably(original.id))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });

      expect(freshStore.vendorCatalogue).toEqual([original]);
      expect(errorSpy).toHaveBeenCalledTimes(3);
    });

    test('durable catalogue SKU conflicts return 409 and leave cached products unchanged', async () => {
      const existing = { id: 'catalogue-conflict-existing', vendorId: 'vendor-conflict', sku: 'SKU-EXISTS', name: 'Existing' };
      const conflict = new Error('A product with this SKU already exists in this vendor catalogue.');
      conflict.statusCode = 409;
      conflict.code = 'CATALOGUE_SKU_CONFLICT';
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertCatalogueProductInDB: jest.fn().mockRejectedValue(conflict),
      }, true);
      freshStore.vendorCatalogue = [existing];

      await expect(freshStore.addProductToCatalogueDurably({
        name: 'Duplicate Product',
        sku: 'sku-exists',
      }, existing.vendorId)).rejects.toMatchObject({ statusCode: 409, code: 'CATALOGUE_SKU_CONFLICT' });
      await expect(freshStore.updateCatalogueProductDurably(existing.id, {
        sku: 'sku-exists',
      })).rejects.toMatchObject({ statusCode: 409, code: 'CATALOGUE_SKU_CONFLICT' });

      expect(freshStore.vendorCatalogue).toEqual([existing]);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    test('durable catalogue methods retain explicitly unconfigured memory operation', async () => {
      const { freshStore } = freshStoreWithFailingWrite();
      const created = await freshStore.addProductToCatalogueDurably({ name: 'Memory Product', sku: 'MEM-1' }, 'vendor-memory');
      expect(freshStore.getCatalogueProductById(created.id)).toEqual(created);
      await expect(freshStore.updateCatalogueProductDurably(created.id, { unitPrice: 22 })).resolves.toMatchObject({ unitPrice: 22 });
      await expect(freshStore.deleteCatalogueProductDurably(created.id)).resolves.toBe(true);
    });

    test('durable catalogue reads refresh scoped cache and drop records removed by another process', async () => {
      const storedProduct = { id: 'catalogue-shared-1', vendorId: 'vendor-shared', sku: 'SHARED-1' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getVendorCatalogueByVendorFromDB: jest.fn().mockResolvedValue([storedProduct]),
        getCatalogueProductByIdFromDB: jest.fn().mockResolvedValueOnce(storedProduct).mockResolvedValueOnce(null),
      }, true);
      freshStore.vendorCatalogue = [
        { id: 'stale-shared', vendorId: 'vendor-shared', sku: 'STALE' },
        { id: 'other-vendor-product', vendorId: 'vendor-other', sku: 'OTHER' },
      ];

      await expect(freshStore.getVendorCatalogueDurably('vendor-shared', 101)).resolves.toEqual([storedProduct]);
      expect(freshStore.vendorCatalogue).toEqual([storedProduct, { id: 'other-vendor-product', vendorId: 'vendor-other', sku: 'OTHER' }]);
      await expect(freshStore.getCatalogueProductByIdDurably(storedProduct.id)).resolves.toEqual(storedProduct);
      await expect(freshStore.getCatalogueProductByIdDurably(storedProduct.id)).resolves.toBeNull();
      expect(freshStore.getCatalogueProductById(storedProduct.id)).toBeUndefined();
      expect(domainQueries.getVendorCatalogueByVendorFromDB).toHaveBeenCalledWith('vendor-shared', 101);
    });

    test('durable global catalogue listing bypasses the query cache and preserves other cached pages', async () => {
      const storedProduct = { id: 'catalogue-global-1', vendorId: 'vendor-global', sku: 'GLOBAL-1' };
      const { freshStore, domainQueries } = freshStoreWithFailingWrite({
        getVendorCatalogueFromDB: jest.fn().mockResolvedValue([storedProduct]),
      }, true);
      freshStore.vendorCatalogue = [
        storedProduct,
        { id: 'catalogue-outside-page', vendorId: 'vendor-other', sku: 'OTHER' },
      ];

      await expect(freshStore.getVendorCatalogueDurably(null, 25)).resolves.toEqual([storedProduct]);
      expect(domainQueries.getVendorCatalogueFromDB).toHaveBeenCalledWith(25, { fresh: true });
      expect(freshStore.vendorCatalogue).toEqual([
        storedProduct,
        { id: 'catalogue-outside-page', vendorId: 'vendor-other', sku: 'OTHER' },
      ]);
    });

    test('durable catalogue read failures return retryable errors and preserve their original cause in logs', async () => {
      const sourceError = new Error('database unavailable');
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        getVendorCatalogueByVendorFromDB: jest.fn().mockRejectedValue(sourceError),
        getCatalogueProductByIdFromDB: jest.fn().mockRejectedValue(sourceError),
      }, true);

      await expect(freshStore.getVendorCatalogueDurably('vendor-unavailable'))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      await expect(freshStore.getCatalogueProductByIdDurably('product-unavailable'))
        .rejects.toMatchObject({ statusCode: 503, code: 'PERSISTENCE_UNAVAILABLE' });
      expect(errorSpy).toHaveBeenCalledWith('Failed to refresh vendor catalogue from storage', sourceError, 'STORE_SERVICE');
      expect(errorSpy).toHaveBeenCalledWith('Failed to refresh catalogue product from storage', sourceError, 'STORE_SERVICE');
    });

    test('durable paid-link activation refreshes the payer and audits only the first commit', async () => {
      const link = { id: 'payment-link-durable', payerType: 'vendor', vendorId: 'vendor-payment', planId: 'connect', activated: true };
      const payer = { id: 'vendor-payment', name: 'Payment Vendor', subscriptionPlan: 'connect', rfqDownloadsUsed: 0 };
      const activation = { link, payer, payerType: 'vendor', activated: true, replayed: false };
      const paymentActivationQueries = {
        activatePaymentLinkSubscriptionInDB: jest.fn()
          .mockResolvedValueOnce(activation)
          .mockResolvedValueOnce({ ...activation, activated: false, replayed: true }),
      };
      const { freshStore } = freshStoreWithFailingWrite({}, true, null, paymentActivationQueries);
      freshStore.paymentLinks = [{ id: link.id, status: 'active' }];
      freshStore.vendors = [{ id: payer.id, name: payer.name, subscriptionPlan: 'premium', rfqDownloadsUsed: 3 }];

      await expect(freshStore.activatePaymentLinkDurably(link.id, { event: 'paid' })).resolves.toEqual(link);
      await expect(freshStore.activatePaymentLinkDurably(link.id, { event: 'duplicate' })).resolves.toEqual(link);

      expect(freshStore.paymentLinks[0]).toEqual(link);
      expect(freshStore.vendors[0]).toEqual(payer);
      expect(freshStore.auditLogs).toHaveLength(1);
      expect(paymentActivationQueries.activatePaymentLinkSubscriptionInDB).toHaveBeenCalledTimes(2);
    });

    test('memory-only payment activation handles replay and buyer/vendor entitlement variants', async () => {
      const { freshStore } = freshStoreWithFailingWrite({}, false);
      await expect(freshStore.activatePaymentLinkDurably('missing-link', {})).resolves.toBeNull();

      const replayedLink = { id: 'already-paid', activated: true, status: 'PAID' };
      freshStore.paymentLinks = [replayedLink];
      await expect(freshStore.activatePaymentLinkDurably(replayedLink.id, {})).resolves.toBe(replayedLink);

      const buyer = { id: 'memory-buyer', remainingFreeRFQs: 2 };
      freshStore.buyerAccounts = [buyer];
      freshStore.activeBuyerAccount = buyer;
      freshStore.paymentLinks.push({
        id: 'buyer-trial-link', payerType: 'buyer', buyerAccountId: buyer.id,
        planId: 'free_trial', billingDuration: 'monthly', activated: false,
      });
      const trialLink = await freshStore.activatePaymentLinkDurably('buyer-trial-link', { event: 'paid' });
      expect(trialLink).toMatchObject({ status: 'PAID', activated: true });
      expect(freshStore.activeBuyerAccount).toMatchObject({
        subscriptionPlan: 'free_trial', billingDuration: 'monthly', remainingFreeRFQs: 5,
      });

      freshStore.paymentLinks.push({
        id: 'buyer-paid-link', payerType: 'buyer', buyerAccountId: buyer.id,
        planId: 'version_2', activated: false,
      });
      await freshStore.activatePaymentLinkDurably('buyer-paid-link', { event: 'paid' });
      expect(freshStore.activeBuyerAccount).toMatchObject({ subscriptionPlan: 'version_2', remainingFreeRFQs: 5 });

      const vendor = { id: 'memory-vendor', email: 'vendor@memory.test', rfqDownloadsUsed: 7 };
      freshStore.vendors = [vendor];
      freshStore.paymentLinks.push({
        id: 'vendor-paid-link', payerType: 'vendor', vendorId: vendor.id,
        planId: 'growth', activated: false,
      });
      await freshStore.activatePaymentLinkDurably('vendor-paid-link', { event: 'paid' });
      expect(freshStore.vendors[0]).toMatchObject({ subscriptionPlan: 'growth', rfqDownloadsUsed: 0 });
    });

    test('durable payment activation handles missing rows, conflicts, cache misses, and payer-name fallbacks', async () => {
      const fallbackPayers = [
        null,
        { id: 'payer-id-only' },
        { id: 'payer-corporate-email', corporateEmail: 'corporate@payer.test' },
        { id: 'payer-email', email: 'email@payer.test' },
        { id: 'payer-name', name: 'Named Payer' },
        { id: 'payer-organization', organizationName: 'Organization Payer' },
      ];
      const fallbackActivations = fallbackPayers.slice(1).map((payer, index) => ({
        link: { id: `fallback-link-${index}`, activated: true, planId: 'connect' },
        payer, payerType: 'vendor', activated: true,
      }));
      let fallbackIndex = 0;
      const paymentActivationQueries = {
        activatePaymentLinkSubscriptionInDB: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ link: { id: 'not-activated', activated: false } })
          .mockResolvedValueOnce({
            link: { id: 'link-without-cached-payer', activated: true, planId: 'connect' },
            payer: fallbackPayers[0], payerType: 'vendor', activated: true,
          })
          .mockResolvedValueOnce({
            link: { id: 'existing-buyer-link', activated: true, planId: 'connect' },
            payer: { id: 'active-buyer', organizationName: 'Active Buyer', subscriptionPlan: 'connect' },
            payerType: 'buyer', activated: true,
          })
          .mockImplementation(async () => fallbackActivations[fallbackIndex++]),
      };
      const { freshStore } = freshStoreWithFailingWrite({}, true, null, paymentActivationQueries);

      await expect(freshStore.activatePaymentLinkDurably('missing-db-link', {})).resolves.toBeNull();
      await expect(freshStore.activatePaymentLinkDurably('not-activated', {})).rejects.toMatchObject({
        statusCode: 409, code: 'PAYMENT_ACTIVATION_CONFLICT',
      });
      await freshStore.activatePaymentLinkDurably('link-without-cached-payer', {});

      const oldBuyer = { id: 'active-buyer', organizationName: 'Old Buyer' };
      freshStore.paymentLinks.push({ id: 'existing-buyer-link', activated: false });
      freshStore.buyerAccounts.push(oldBuyer);
      freshStore.activeBuyerAccount = oldBuyer;
      await freshStore.activatePaymentLinkDurably('existing-buyer-link', {});
      expect(freshStore.paymentLinks.find((link) => link.id === 'existing-buyer-link').planId).toBe('connect');
      expect(freshStore.activeBuyerAccount.organizationName).toBe('Active Buyer');

      for (let index = 0; index < fallbackActivations.length; index += 1) {
        await freshStore.activatePaymentLinkDurably(`fallback-link-${index}`, {});
      }
      expect(freshStore.auditLogs).toHaveLength(7);
    });

    test('failed durable payment activation leaves the cache unchanged and logs the storage error', async () => {
      const sourceError = new Error('database unavailable');
      const paymentActivationQueries = {
        activatePaymentLinkSubscriptionInDB: jest.fn().mockRejectedValue(sourceError),
      };
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({}, true, null, paymentActivationQueries);
      const originalLink = { id: 'payment-link-failure', payerType: 'buyer', buyerAccountId: 'buyer-payment', status: 'active' };
      const originalBuyer = { id: 'buyer-payment', subscriptionPlan: 'free_trial', remainingFreeRFQs: 2 };
      freshStore.paymentLinks = [originalLink];
      freshStore.buyerAccounts = [originalBuyer];

      await expect(freshStore.activatePaymentLinkDurably(originalLink.id, { event: 'paid' })).rejects.toBe(sourceError);

      expect(freshStore.paymentLinks).toEqual([originalLink]);
      expect(freshStore.buyerAccounts).toEqual([originalBuyer]);
      expect(errorSpy).toHaveBeenCalledWith(
        'Atomic payment subscription activation failed',
        expect.objectContaining({ error: sourceError }),
        'STORE_SERVICE'
      );
    });

    test('_persistBuyerAccount logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertBuyerAccountInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore._persistBuyerAccount({ corporateEmail: 'buyer-persist-test@x.com', organizationName: 'Buyer Co' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist buyer account', expect.any(Error), 'STORE_SERVICE');
    });

    test('_removeBuyerAccount logs when the write-through delete rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        deleteBuyerAccountInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const acc = freshStore.addBuyerAccount({
        corporateEmail: 'buyer-persist-test2@x.com',
        organizationName: 'Buyer Co',
      });
      freshStore.deleteBuyerAccount(acc.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to delete persisted buyer account',
        expect.any(Error),
        'STORE_SERVICE'
      );
    });

    test('_setActiveBuyerAccount logs when the write-through update rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        setActiveBuyerAccountInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const acc = freshStore.addBuyerAccount({
        corporateEmail: 'buyer-persist-test3@x.com',
        organizationName: 'Buyer Co',
      });
      freshStore.alignActiveBuyerAccount(acc.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to persist active buyer account',
        expect.any(Error),
        'STORE_SERVICE'
      );
    });

    test('_persistAIFeedItem logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        upsertAIFeedItemInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.addAIFeedItem({ title: 'Test Feed Item' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Background event persistence failed; durable retry is unavailable',
        expect.objectContaining({ operation: 'persist-ai-feed-item', error: expect.any(Error) }),
        'EVENT_OUTBOX'
      );
    });

    test('_persistAuditLog logs when the write-through upsert rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        appendAuditLogInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      freshStore.addAuditLog({ userEmail: 'auditor@x.com', action: 'Test action' });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist audit log entry', expect.any(Error), 'STORE_SERVICE');
      expect(freshStore.getAuditLogs()).toHaveLength(0);
    });

    test('addAuditLogDurably waits for the append and returns the database-sealed hash', async () => {
      let releaseWrite;
      const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
      const { freshStore, auditLogQueries } = freshStoreWithFailingWrite({
        appendAuditLogInDB: jest.fn(async (entry) => {
          await writeGate;
          return { ...entry, previousHash: 'database-head', shaSignature: 'database-sealed-signature' };
        }),
      }, true);
      const appendPromise = freshStore.addAuditLogDurably({ action: 'Durable audit action' });

      await Promise.resolve();
      expect(auditLogQueries.appendAuditLogInDB).toHaveBeenCalledTimes(1);
      expect(freshStore.getAuditLogs()).toHaveLength(0);
      releaseWrite();

      const saved = await appendPromise;
      expect(saved.previousHash).toBe('database-head');
      expect(saved.shaSignature).toBe('database-sealed-signature');
      expect(freshStore.getAuditLogs()).toEqual([saved]);
    });

    test('addAuditLogDurably rejects configured failures without caching a phantom entry', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        appendAuditLogInDB: jest.fn().mockRejectedValue(new Error('audit store unavailable')),
      }, true);

      await expect(freshStore.addAuditLogDurably({ action: 'Unsaved audit action' })).rejects.toMatchObject({
        statusCode: 503,
        code: 'PERSISTENCE_UNAVAILABLE',
      });
      expect(freshStore.getAuditLogs()).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalledWith('Failed to durably append audit log entry', expect.any(Error), 'STORE_SERVICE');
    });

    test('_persistNotificationBatch logs when the RFQ→vendor fan-out write rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        bulkInsertNotificationsInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      // notifyVendorsOfNewRFQ (the batched fan-out) only fires at creation for
      // vendors with immediate access — an addedByBuyerCompany match, since
      // category match alone no longer grants vendorCoversRFQ.
      freshStore.addVendor({
        name: 'Fanout Co',
        email: 'fanout@x.com',
        majorCategory: 'Fanout-Cat',
        addedByBuyerCompany: 'Fanout Buyer',
      });
      freshStore.createRFQ(
        { rfqNumber: 'RFQ-NTF-1', category: 'Fanout-Cat', sourcingMode: 'mode_1' },
        { organizationName: 'Fanout Buyer' }
      );
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Background event persistence failed; durable retry is unavailable',
        expect.objectContaining({ operation: 'persist-notification-batch', error: expect.any(Error) }),
        'EVENT_OUTBOX'
      );
    });

    test('_persistNotification logs when the quote→buyer write rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        insertNotificationInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const buyer = freshStore.addBuyerAccount({ corporateEmail: 'ntf-buyer@x.com', organizationName: 'Ntf Buyer' });
      const rfq = freshStore.createRFQ({ rfqNumber: 'RFQ-NTF-2', category: 'X' }, buyer);
      freshStore.addQuoteToRFQ(rfq.id, { vendorId: 'v-1', vendorName: 'B', unitPrice: 1 });
      await flush();

      expect(errorSpy).toHaveBeenCalledWith(
        'Background event persistence failed; durable retry is unavailable',
        expect.objectContaining({ operation: 'persist-notification', error: expect.any(Error) }),
        'EVENT_OUTBOX'
      );
    });

    test('markNotificationRead logs when the read write-through rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        markNotificationReadInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const vendor = freshStore.addVendor({ name: 'Read Co', email: 'read@x.com', majorCategory: 'Read-Cat' });
      const rfq = freshStore.createRFQ({ rfqNumber: 'RFQ-NTF-3', category: 'Read-Cat' });
      await freshStore.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@x.com');
      const [n] = freshStore.getNotificationsFor('vendor', vendor.id);
      freshStore.markNotificationRead(n.id, 'vendor', vendor.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist notification read', expect.any(Error), 'STORE_SERVICE');
    });

    test('markAllNotificationsRead logs when the bulk read write-through rejects', async () => {
      const { freshStore, errorSpy } = freshStoreWithFailingWrite({
        markAllNotificationsReadInDB: jest.fn().mockRejectedValue(new Error('boom')),
      });

      const vendor = freshStore.addVendor({ name: 'BulkRead Co', email: 'bulkread@x.com', majorCategory: 'Bulk-Cat' });
      const rfq = freshStore.createRFQ({ rfqNumber: 'RFQ-NTF-4', category: 'Bulk-Cat' });
      await freshStore.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@x.com');
      freshStore.markAllNotificationsRead('vendor', vendor.id);
      await flush();

      expect(errorSpy).toHaveBeenCalledWith('Failed to persist bulk notification read', expect.any(Error), 'STORE_SERVICE');
    });
  });

  describe('vendor catalogue and purchase order branches not covered elsewhere', () => {
    test('getVendorCatalogue filters to only the given vendorId', () => {
      const product = storeService.addProductToCatalogue(
        { name: 'Filter Test Item' },
        'vendor-catalogue-filter-test',
        'user@x.com'
      );

      const filtered = storeService.getVendorCatalogue('vendor-catalogue-filter-test');

      expect(filtered).toEqual([product]);
      expect(filtered.every((p) => p.vendorId === 'vendor-catalogue-filter-test')).toBe(true);
    });

    test('approvePurchaseOrder maps rfq.extractedEntities into lineItems when present', () => {
      const rfq = storeService.createRFQ({ rfqNumber: 'RFQ-LINEITEM-TEST' });
      storeService.updateRFQ(rfq.id, {
        extractedEntities: [{ itemName: 'Bearing', quantity: 10, unit: 'pcs' }],
      });

      const po = storeService.approvePurchaseOrder(rfq.rfqNumber, 'v-001', 'Test Vendor', 5000, 'notes');

      expect(po.lineItems).toEqual([{ description: 'Bearing', quantity: 10, unit: 'pcs' }]);
    });

    test('getVendors returns all vendors when scopedBuyerId is all', async () => {
      expect(await storeService.getVendors('all')).toBe(storeService.vendors);
    });

    test('getVendorById returns undefined when vendor is scoped to a buyer but no scopedBuyerId is provided', () => {
      const vendor = storeService.addVendor({ name: 'Scoped Buyer Vendor', email: 'sbv@test.com' }, 'buyer@x.com', 'buyer-scoped-123');
      expect(storeService.getVendorById(vendor.id, null)).toBeUndefined();
    });

    test('_rfqCategorySignals extracts majorCategory and minorCategory from extractedEntities', () => {
      const signals = storeService._rfqCategorySignals({
        category: 'MainCat',
        extractedEntities: [
          { majorCategory: 'MajorA', minorCategory: 'MinorB', category: 'SubC' }
        ]
      });
      expect(signals).toContain('MajorA');
      expect(signals).toContain('MinorB');
      expect(signals).toContain('SubC');
      expect(signals).toContain('MainCat');
    });

    test('triggerBatchChaser returns error when assignedVendors is empty, and null when RFQ not found', () => {
      expect(storeService.triggerBatchChaser('non-existent-rfq')).toBeNull();

      const rfq = storeService.createRFQ({ rfqNumber: 'RFQ-NO-VENDORS-CHASE' });
      rfq.assignedVendors = [];
      const res = storeService.triggerBatchChaser(rfq.id);
      expect(res.success).toBe(false);
      expect(res.error).toContain('No vendors are assigned to this RFQ');
    });

    test('triggerBatchChaser caps aiFeed at 100 items when length exceeds 100', () => {
      const vendor = storeService.addVendor({ name: 'Assigned Vendor Co', email: 'avc@test.com' });
      const rfq = storeService.createRFQ({ rfqNumber: 'RFQ-CHASE-100' });
      rfq.assignedVendors = [vendor];
      storeService.aiFeed = Array.from({ length: 99 }, (_, i) => ({ id: `feed-${i}`, message: 'dummy' }));
      const res = storeService.triggerBatchChaser(rfq.id);
      expect(res.success).toBe(true);
      expect(storeService.aiFeed.length).toBeLessThanOrEqual(100);
    });

    test('_reconcileRFQFollowUpStats covers null RFQ, empty vendors, draft status, and age stages', () => {
      expect(storeService._reconcileRFQFollowUpStats(null)).toBeNull();

      const rfqEmpty = { id: 'rfq-e', assignedVendors: [] };
      expect(storeService._reconcileRFQFollowUpStats(rfqEmpty)).toBe(rfqEmpty);

      const rfqDraft = { id: 'rfq-d', status: 'Draft', assignedVendors: [{ id: 'v-1' }] };
      expect(storeService._reconcileRFQFollowUpStats(rfqDraft)).toBe(rfqDraft);

      const rfqParsing = { id: 'rfq-p', status: 'Parsing', assignedVendors: [{ id: 'v-1' }] };
      expect(storeService._reconcileRFQFollowUpStats(rfqParsing)).toBe(rfqParsing);

      // Fresh RFQ (< 5 min)
      const rfqFresh = {
        id: 'rfq-fresh',
        status: 'Quotes Pending',
        createdAt: new Date().toISOString(),
        assignedVendors: [{ id: 'v-1', name: 'Vendor 1' }, null]
      };
      const freshResult = storeService._reconcileRFQFollowUpStats(rfqFresh);
      expect(freshResult.followUpData.smsStats.delivered).toBe(0);
      expect(freshResult.followUpData.whatsappStats.delivered).toBe(0);
      expect(freshResult.followUpData.emailStats.delivered).toBe(0);

      // 5 min old RFQ (>= 300,000ms)
      const rfq5m = {
        id: 'rfq-5m',
        status: 'Quotes Pending',
        createdAt: new Date(Date.now() - 360000).toISOString(),
        assignedVendors: [{ id: 'v-1', name: 'Vendor 1' }],
        followUpData: { totalInvited: 1, vendors: [{ id: 'v-1' }] }
      };
      const res5m = storeService._reconcileRFQFollowUpStats(rfq5m);
      expect(res5m.followUpData.smsStats.delivered).toBe(1);
      expect(res5m.followUpData.whatsappStats.delivered).toBe(0);
      expect(res5m.followUpData.emailStats.delivered).toBe(0);

      // 12 hr old RFQ (>= 43,200,000ms)
      const rfq12h = {
        id: 'rfq-12h',
        status: 'Quotes Pending',
        createdAt: new Date(Date.now() - 44000000).toISOString(),
        assignedVendors: [{ id: 'v-1', name: 'Vendor 1' }]
      };
      const res12h = storeService._reconcileRFQFollowUpStats(rfq12h);
      expect(res12h.followUpData.smsStats.delivered).toBe(1);
      expect(res12h.followUpData.whatsappStats.delivered).toBe(1);
      expect(res12h.followUpData.emailStats.delivered).toBe(0);

      // 24 hr old RFQ (>= 86,400,000ms)
      const rfq24h = {
        id: 'rfq-24h',
        status: 'Quotes Pending',
        createdAt: new Date(Date.now() - 90000000).toISOString(),
        assignedVendors: [{ id: 'v-1', name: 'Vendor 1' }]
      };
      const res24h = storeService._reconcileRFQFollowUpStats(rfq24h);
      expect(res24h.followUpData.smsStats.delivered).toBe(1);
      expect(res24h.followUpData.whatsappStats.delivered).toBe(1);
      expect(res24h.followUpData.emailStats.delivered).toBe(1);
    });

    test('covers additional branch conditions in _reconcileRFQFollowUpStats, createRFQ, and consumeBuyerRFQCredit', async () => {
      // 1. _reconcileRFQFollowUpStats fallback vendor count branches
      const rfqInvited = {
        id: 'rfq-inv',
        status: 'Quotes Pending',
        followUpData: { totalInvited: 5, smsStats: { delivered: 0 }, whatsappStats: { delivered: 0 }, emailStats: { delivered: 0 } },
      };
      const resInv = storeService._reconcileRFQFollowUpStats(rfqInvited);
      expect(resInv.followUpData.totalInvited).toBe(5);

      const rfqSmsTotal = {
        id: 'rfq-sms-tot',
        status: 'Quotes Pending',
        followUpData: { smsStats: { total: 3, delivered: 0 }, whatsappStats: { delivered: 0 }, emailStats: { delivered: 0 } },
      };
      const resSms = storeService._reconcileRFQFollowUpStats(rfqSmsTotal);
      expect(resSms.followUpData.smsStats.total).toBe(3);

      const rfqProcucevCount = {
        id: 'rfq-proc-cnt',
        status: 'Quotes Pending',
        procucevVendorCount: 4,
      };
      const resProc = storeService._reconcileRFQFollowUpStats(rfqProcucevCount);
      expect(resProc.procucevVendorCount).toBe(4);

      const rfqDraftZero = {
        id: 'rfq-draft-zero',
        status: 'Draft',
        assignedVendors: [],
        followUpData: { totalInvited: 9 },
      };
      const resDraft = storeService._reconcileRFQFollowUpStats(rfqDraftZero);
      expect(resDraft.followUpData.totalInvited).toBe(0);

      // 2. createRFQ past delivery dates and source edge cases
      const pastRfq = storeService.createRFQ({
        title: 'Past Delivery RFQ',
        deadline: '2020-01-01T00:00:00Z',
        targetDeliveryDate: '2020-01-02T00:00:00Z',
      });
      expect(pastRfq.deadline).toBeDefined();

      const aiNoFileRfq = storeService.createRFQ({
        title: 'AI Ingest No File',
        source: 'ai_extraction',
      });
      expect(aiNoFileRfq.source).toBe('manual_entry');

      const emailGwNoBuyerRfq = storeService.createRFQ(
        {
          title: 'Email Gateway RFQ',
          source: 'email_gateway',
        },
        null
      );
      expect(emailGwNoBuyerRfq.sourcingMode).toBe('mode_0');

      const planBuyerRfq = storeService.createRFQ(
        {
          title: 'Plan Buyer RFQ',
        },
        {
          id: 'buyer-v2-test',
          corporateEmail: 'buyer-v2@example.com',
          subscriptionPlan: 'version_2',
        }
      );
      expect(planBuyerRfq.sourcingMode).toBe('mode_2');

      // 3. tryConsumeFreeRFQ & refundFreeRFQ edge branches
      const unregUnlimited = storeService.tryConsumeFreeRFQ({
        id: 'unreg-unl',
        corporateEmail: 'operations@procucev.com',
      });
      expect(unregUnlimited.ok).toBe(true);

      const unregRegular = storeService.tryConsumeFreeRFQ({
        id: 'unreg-reg',
        corporateEmail: 'fresh-buyer@corp.com',
      });
      expect(unregRegular.ok).toBe(true);

      const nonExistent = storeService.tryConsumeFreeRFQ('non-existent-buyer-id');
      expect(nonExistent.ok).toBe(false);

      const buyerWithEmail = storeService.addBuyerAccount({
        id: 'buyer-refund-branch',
        corporateEmail: 'refund-branch@corp.com',
        remainingFreeRFQs: 3,
      });
      storeService.activeBuyerAccount = buyerWithEmail;
      storeService.refundFreeRFQ({ id: 'buyer-refund-branch', email: 'refund-branch@corp.com' });
      expect(storeService.getBuyerAccounts().find((b) => b.id === 'buyer-refund-branch').remainingFreeRFQs).toBe(4);

      // 4. buyerAccounts fallback and updateBuyerAccount null id
      const savedAccounts = storeService.buyerAccounts;
      storeService.buyerAccounts = null;
      expect(storeService.getBuyerAccounts(5)).toEqual([]);
      expect(storeService.getBuyerAccounts()).toEqual([]);
      storeService.buyerAccounts = savedAccounts;

      expect(storeService.updateBuyerAccount(null, {})).toBeNull();

      // 5. claimMigratedVendorProfile null email
      expect(await storeService.claimMigratedVendorProfile(null)).toBeNull();

      // 6. confirmRfqPersisted storage active path
      jest.spyOn(pool, 'hasStorage').mockReturnValueOnce(true);
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockResolvedValueOnce({});
      const resConfirm = await storeService.confirmRfqPersisted({ id: 'rfq-confirm-branch-test' });
      expect(resConfirm.persisted).toBe(true);

      jest.spyOn(pool, 'hasStorage').mockReturnValueOnce(true);
      jest.spyOn(domainQueries, 'upsertRFQInDB').mockRejectedValueOnce(new Error('DB upsert failed'));
      await expect(storeService.confirmRfqPersisted({ id: 'rfq-confirm-branch-test' })).rejects.toThrow('DB upsert failed');
    });
  });
});

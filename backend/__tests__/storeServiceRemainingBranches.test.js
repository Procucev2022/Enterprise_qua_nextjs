const storeService = require('../src/services/storeService');

describe('Store Service — remaining branch coverage', () => {
  describe('a fresh instance seeded with no buyer accounts / no audit logs', () => {
    let freshStore;

    beforeAll(() => {
      jest.isolateModules(() => {
        jest.doMock('../src/db/seed', () => {
          const actual = jest.requireActual('../src/db/seed');
          return { ...actual, SEED_BUYER_ACCOUNTS: [], SEED_AUDIT_LOGS: [] };
        });
        freshStore = require('../src/services/storeService');
      });
    });

    test('constructor falls back activeBuyerAccount to null when there are no seed buyer accounts', () => {
      expect(freshStore.getActiveBuyerAccount()).toBeNull();
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

    test('processHistoricalPurchaseData and approvePurchaseOrder fall back userEmail when there is no active buyer account', () => {
      const res = freshStore.processHistoricalPurchaseData('FY2026', [
        { companyName: 'No Active Buyer Co', email: 'nab@co.com' },
      ]);
      expect(res.success).toBe(true);

      const po = freshStore.approvePurchaseOrder('rfq-001', 'v-001', 'Some Vendor', 1000, 'notes');
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

    test('processHistoricalPurchaseData falls back the name/email chains and honors the default vendorRecords parameter', () => {
      const emptyRes = storeService.processHistoricalPurchaseData('FY2026-empty');
      expect(emptyRes.importedCount).toBe(0);

      const res = storeService.processHistoricalPurchaseData('FY2026-fallbacks', [
        { name: 'Only-Name Supplier Co' },
        {},
      ]);
      expect(res.importedCount).toBe(2);
    });

    test('handleSupportChat falls back an empty prompt safely', () => {
      const res = storeService.handleSupportChat();
      expect(res.isEscalated).toBe(false);
    });

    test('addProductToCatalogue falls back unitPrice to 0 when not a valid number', () => {
      const prod = storeService.addProductToCatalogue({ name: 'Zero Price Prod', sku: 'SKU-ZERO' });
      expect(prod.unitPrice).toBe(0);
    });

    test('approvePurchaseOrder returns null when the RFQ cannot be found', () => {
      const po = storeService.approvePurchaseOrder(undefined, 'v-001', 'Vendor X', 500, 'notes');
      expect(po).toBeNull();
    });
  });

  describe('hydrateFromDB after the PostgreSQL removal', () => {
    test('resolves as a no-op and reports the in-memory seed as the source', async () => {
      // Domain records are served from the in-memory seed dataset; only user
      // accounts are persisted, and those live in the MySQL identity schema.
      const beforeBuyers = storeService.getBuyerAccounts().length;
      const result = await storeService.hydrateFromDB();

      expect(result).toEqual({ hydrated: false, source: 'in_memory_seed' });
      expect(storeService.isHydratedFromDB).toBe(false);
      expect(storeService.getBuyerAccounts().length).toBe(beforeBuyers);
    });
  });

  describe('processHistoricalPurchaseData without a domain persistence layer', () => {
    test('imports vendors into the in-memory store and reports the count', () => {
      const res = storeService.processHistoricalPurchaseData('FY2026-nodb', [
        { companyName: 'In Memory Historical Co', email: 'inmemory@historical.com' },
      ]);

      expect(res.importedCount).toBe(1);
    });
  });
});
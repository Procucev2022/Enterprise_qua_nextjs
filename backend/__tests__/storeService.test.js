const storeService = require('../src/services/storeService');

describe('Store Service & Business Operations', () => {
  test('initializes with seed data', () => {
    expect(storeService.getBuyerAccounts().length).toBeGreaterThan(0);
    expect(storeService.getVendors().length).toBeGreaterThan(0);
    expect(storeService.getRFQs().length).toBeGreaterThan(0);
    expect(storeService.getEvaluations().length).toBeGreaterThan(0);
    expect(storeService.getAuditLogs().length).toBeGreaterThan(0);
    expect(storeService.getAzureHealth().length).toBeGreaterThan(0);
    expect(storeService.getBootstrapData()).toHaveProperty('rfqs');
  });

  describe('Buyer Accounts Management', () => {
    let testAccId;

    test('addBuyerAccount & alignActiveBuyerAccount', () => {
      const acc = storeService.addBuyerAccount({
        organizationName: 'BHEL Power Equipment',
        corporateEmail: 'procure@bhel.in',
        contactPerson: 'S. K. Roy',
      });

      expect(acc.id).toBeDefined();
      testAccId = acc.id;
      expect(storeService.getBuyerAccounts()[0].organizationName).toBe('BHEL Power Equipment');

      const aligned = storeService.alignActiveBuyerAccount(acc.id);
      expect(aligned.id).toBe(acc.id);
      expect(storeService.getActiveBuyerAccount().id).toBe(acc.id);

      const invalidAlign = storeService.alignActiveBuyerAccount('nonexistent');
      expect(invalidAlign).toBeNull();
    });

    test('updateBuyerAccount updates existing or returns null on missing', () => {
      const updated = storeService.updateBuyerAccount(testAccId, { contactPerson: 'Arun Roy' });
      expect(updated.contactPerson).toBe('Arun Roy');

      const failUpdate = storeService.updateBuyerAccount('nonexistent', {});
      expect(failUpdate).toBeNull();
    });

    test('deleteBuyerAccount removes account and resets active if current', () => {
      const res = storeService.deleteBuyerAccount(testAccId);
      expect(res).toBe(true);

      const failDelete = storeService.deleteBuyerAccount('nonexistent');
      expect(failDelete).toBe(false);
    });
  });

  describe('Vendors Management', () => {
    let testVendorId;

    test('addVendor & getVendorById', () => {
      const v = storeService.addVendor({
        name: 'Schneider Electric Industrial',
        contactPerson: 'Deepak',
        email: 'deepak@schneider.com',
        majorCategory: 'Engineering Spares - Electrical',
      });

      expect(v.id).toBeDefined();
      testVendorId = v.id;
      expect(storeService.getVendorById(v.id).name).toBe('Schneider Electric Industrial');
    });

    test('updateVendor updates fields or returns null', () => {
      const updated = storeService.updateVendor(testVendorId, { phone: '+91 99999 88888' });
      expect(updated.phone).toBe('+91 99999 88888');

      const nullUpdate = storeService.updateVendor('nonexistent', {});
      expect(nullUpdate).toBeNull();
    });

    test('reviseVendorRating updates scores and history', () => {
      const res = storeService.reviseVendorRating(testVendorId, {
        qualityScore: 92,
        costScore: 90,
        deliveryScore: 94,
        remarks: 'Consistent high delivery quality',
      });

      expect(res).toBeDefined();
      expect(res.updatedVendor.latestRatingRevision).toBeDefined();

      const nullRevise = storeService.reviseVendorRating('nonexistent', { qualityScore: 90, costScore: 90, deliveryScore: 90 });
      expect(nullRevise).toBeNull();
    });

    test('deleteVendor removes vendor', () => {
      const res = storeService.deleteVendor(testVendorId);
      expect(res).toBe(true);

      const failDelete = storeService.deleteVendor('nonexistent');
      expect(failDelete).toBe(false);
    });
  });

  describe('RFQ Lifecycle', () => {
    let rfqId;

    test('createRFQ dispatches chaser logs', () => {
      const prevFeedCount = storeService.getAIFeed().length;
      const rfq = storeService.createRFQ({
        title: 'Structural Steel Beams',
        category: 'Raw Material',
        assignedVendors: [
          { name: 'Steel Corp', contactPerson: 'Arun', phone: '+91 99999 11111' },
        ],
      });

      expect(rfq.rfqNumber).toBeDefined();
      rfqId = rfq.id;
      expect(storeService.getAIFeed().length).toBeGreaterThan(prevFeedCount);
      expect(storeService.getRFQById(rfq.id)).toBeDefined();
      expect(storeService.getRFQById('invalid-id')).toBeUndefined();
    });

    test('createRFQ attributes the RFQ to the requesting buyer account, not the global active one', () => {
      const requestingBuyerAccount = storeService.addBuyerAccount({
        organizationName: 'Attribution Test Co',
        corporateEmail: 'attribution-test@example.com',
      });

      const rfq = storeService.createRFQ(
        { title: 'Attribution Test RFQ', category: 'Raw Material' },
        requestingBuyerAccount
      );

      expect(rfq.buyerAccountId).toBe(requestingBuyerAccount.id);
      expect(rfq.buyerAccountName).toBe('Attribution Test Co');
      expect(rfq.buyerAccountId).not.toBe(
        storeService.getActiveBuyerAccount() && storeService.getActiveBuyerAccount().id
      );
    });

    test('createRFQ falls back to the global active buyer account when no requesting account is given', () => {
      const rfq = storeService.createRFQ({ title: 'No Requester RFQ', category: 'Raw Material' });
      const active = storeService.getActiveBuyerAccount();
      expect(rfq.buyerAccountId).toBe(active ? active.id : null);
    });

    test('createRFQ preserves real extractedEntities instead of silently dropping them into the legacy lineItems shape', () => {
      const entities = [{ id: 'e1', itemName: 'Steel Beam', quantity: 5, unit: 'Units', confidence: 90 }];
      const rfq = storeService.createRFQ({
        title: 'Line Item Preservation RFQ',
        category: 'Raw Material',
        extractedEntities: entities,
      });
      expect(rfq.extractedEntities).toEqual(entities);
    });

    test('createRFQ defaults an unset status to a real, valid RFQ status', () => {
      const rfq = storeService.createRFQ({ title: 'Default Status RFQ', category: 'Raw Material' });
      expect(rfq.status).toBe('Quotes Pending');
    });

    test('getBuyerAccountByEmail resolves case-insensitively, and returns null when unmatched or unset', () => {
      const acc = storeService.addBuyerAccount({
        organizationName: 'Lookup Test Co',
        corporateEmail: 'Lookup-Test@Example.com',
      });
      expect(storeService.getBuyerAccountByEmail('lookup-test@example.com')).toEqual(acc);
      expect(storeService.getBuyerAccountByEmail('nobody@example.com')).toBeNull();
      expect(storeService.getBuyerAccountByEmail(undefined)).toBeNull();
    });

    test('processHistoricalPurchaseData attributes its audit log to the requesting buyer account, not the global active one', () => {
      const requestingBuyerAccount = storeService.addBuyerAccount({
        organizationName: 'Historical Ingest Test Co',
        corporateEmail: 'historical-ingest@example.com',
      });

      storeService.processHistoricalPurchaseData(
        '1_year',
        [{ companyName: 'Some Vendor', email: 'vendor@some.co' }],
        requestingBuyerAccount
      );

      const lastLog = storeService.getAuditLogs()[0];
      expect(lastLog.userEmail).toBe('historical-ingest@example.com');
    });

    test('updateRFQ & addQuoteToRFQ', () => {
      const updated = storeService.updateRFQ(rfqId, { targetSavings: '20%' });
      expect(updated.targetSavings).toBe('20%');

      const nullUpdate = storeService.updateRFQ('invalid-id', {});
      expect(nullUpdate).toBeNull();

      const quoteRes = storeService.addQuoteToRFQ(rfqId, {
        vendorName: 'Steel Corp',
        unitPrice: 2500,
        totalPrice: 25000,
      });
      expect(quoteRes.quotes.length).toBeGreaterThan(0);

      const failQuote = storeService.addQuoteToRFQ('invalid-id', {});
      expect(failQuote).toBeNull();
    });
  });

  describe('Evaluations & Config', () => {
    test('createEvaluation adds 360 audit record', () => {
      const ev = storeService.createEvaluation({
        vendorName: 'Tata Steel Tubes',
        moduleScores: { quality: { score: 95 } },
      });

      expect(ev.id).toBeDefined();
      expect(storeService.getEvaluations()[0].vendorName).toBe('Tata Steel Tubes');
    });

    test('updateSystemConfig updates and returns config', () => {
      const updated = storeService.updateSystemConfig({ escalationIntervalHours: 48 });
      expect(updated.escalationIntervalHours).toBe(48);
      expect(storeService.getSystemConfig().escalationIntervalHours).toBe(48);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Demo data gating
//
// The demo RFQs land in the same store a buyer's real RFQs do, and the portfolio
// summary derives every KPI from that store, so leaving them on reported
// fabricated spend and vendor engagement next to genuine work.
// ══════════════════════════════════════════════════════════════════════════════
describe('demo RFQ seeding', () => {
  const originalFlag = process.env.SEED_DEMO_RFQS;
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.SEED_DEMO_RFQS;
    else process.env.SEED_DEMO_RFQS = originalFlag;
    process.env.NODE_ENV = originalEnv;
    jest.resetModules();
  });

  describe('shouldSeedDemoRFQs', () => {
    test('seeds under test so the suite keeps its fixtures', () => {
      delete process.env.SEED_DEMO_RFQS;
      process.env.NODE_ENV = 'test';
      expect(storeService.shouldSeedDemoRFQs()).toBe(true);
    });

    test('does not seed a running app', () => {
      delete process.env.SEED_DEMO_RFQS;
      process.env.NODE_ENV = 'development';
      expect(storeService.shouldSeedDemoRFQs()).toBe(false);
    });

    test.each([
      ['true', true],
      ['false', false],
    ])('an explicit flag of %s wins over the environment', (flag, expected) => {
      process.env.SEED_DEMO_RFQS = flag;
      process.env.NODE_ENV = 'test';
      expect(storeService.shouldSeedDemoRFQs()).toBe(expected);
    });
  });

  test('a store built with seeding off starts with no RFQs, feed or audit trail', () => {
    process.env.SEED_DEMO_RFQS = 'false';
    jest.resetModules();

    // Re-required so the constructor re-reads the flag.
    const freshStore = require('../src/services/storeService');

    expect(freshStore.rfqs).toEqual([]);
    expect(freshStore.aiFeed).toEqual([]);
    expect(freshStore.auditLogs).toEqual([]);
    // Vendors and buyer accounts are load-bearing for sign-in and vendor
    // selection, so they are never gated.
    expect(freshStore.vendors.length).toBeGreaterThan(0);
    expect(freshStore.buyerAccounts.length).toBeGreaterThan(0);
    expect(freshStore.activeBuyerAccount).not.toBeNull();
  });

  test('the portfolio summary reports an empty portfolio rather than dividing by zero', () => {
    process.env.SEED_DEMO_RFQS = 'false';
    jest.resetModules();

    const freshStore = require('../src/services/storeService');
    const summary = freshStore.getRFQSummary();

    expect(summary.totalRFQs).toBe(0);
    expect(summary.totalBudget).toBe(0);
    expect(summary.averageQuotesPerRFQ).toBe(0);
  });
});

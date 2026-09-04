const storeService = require('../src/services/storeService');

describe('Store Service & Business Operations', () => {
  test('initializes with seed data', () => {
    expect(storeService.getVendors().length).toBeGreaterThan(0);
    expect(storeService.getEvaluations().length).toBeGreaterThan(0);
    expect(storeService.getAzureHealth().length).toBeGreaterThan(0);
    // Buyer accounts are not seeded: the signed-in buyer's account is resolved
    // from the identity schema, so no fabricated company is attributed to anyone.
    expect(storeService.getBuyerAccounts()).toEqual([]);
    expect(storeService.getActiveBuyerAccount()).toBeNull();
    // RFQs and the narrative around them are no longer seeded or held here:
    // they live in qua_enterprice_rfq, owned by a buyer organisation.
    expect(storeService.getRFQs()).toEqual([]);
    expect(storeService.getAuditLogs()).toEqual([]);
    expect(storeService.getBootstrapData()).not.toHaveProperty('rfqs');
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

  // The flag and the seed data are gone for good, not merely switched off. A
  // toggle would have left the fabricated RFQs one environment variable away
  // from reappearing in the same collection as a buyer's real work.
  test('the demo RFQ seed toggle no longer exists', () => {
    expect(storeService.shouldSeedDemoRFQs).toBeUndefined();
  });

  test.each(['SEED_RFQS', 'SEED_AUDIT_LOGS', 'SEED_AI_FEED'])(
    '%s is no longer exported by the seed module',
    (exportName) => {
      // eslint-disable-next-line global-require
      const seed = require('../src/db/seed');
      expect(seed[exportName]).toBeUndefined();
    }
  );

  test.each([['true'], ['false'], [undefined]])(
    'a store built with SEED_DEMO_RFQS=%s still starts with no RFQs, feed or audit trail',
    (flag) => {
      if (flag === undefined) delete process.env.SEED_DEMO_RFQS;
      else process.env.SEED_DEMO_RFQS = flag;
      jest.resetModules();

      // Re-required so the constructor runs again under this environment.
      const freshStore = require('../src/services/storeService');

      expect(freshStore.rfqs).toEqual([]);
      expect(freshStore.aiFeed).toEqual([]);
      expect(freshStore.auditLogs).toEqual([]);
      // Vendors and buyer accounts are load-bearing for sign-in and vendor
      // selection and have no database table yet, so they are still seeded.
      expect(freshStore.vendors.length).toBeGreaterThan(0);
      // Buyer accounts are no longer seeded either. The signed-in buyer's account
      // is resolved from the identity schema, so no fabricated company can be
      // attributed to a session.
      expect(freshStore.buyerAccounts).toEqual([]);
      expect(freshStore.activeBuyerAccount).toBeNull();
    }
  );

  // RFQs are no longer in the bootstrap payload at all. That endpoint is
  // anonymous, and shipping the global RFQ array from it is what put one
  // buyer's RFQs on another buyer's dashboard.
  test('the bootstrap payload carries no RFQs', () => {
    expect(storeService.getBootstrapData()).not.toHaveProperty('rfqs');
  });
});

const storeService = require('../src/services/storeService');

describe('Store Service & Business Operations', () => {
  test('initializes with no records at all', () => {
    // Nothing is seeded. Every collection is filled from PostgreSQL by
    // hydrateFromDB, and an empty one means there are no rows — it is not a cue
    // to substitute fabricated vendors, evaluations or catalogue products, which
    // is what the constructor used to do.
    expect(storeService.getVendors()).toEqual([]);
    expect(storeService.getEvaluations()).toEqual([]);
    expect(storeService.getVendorCatalogue()).toEqual([]);
    // Buyer accounts are not seeded either: the signed-in buyer's account is
    // resolved from their own account record, so no fabricated company is
    // attributed to anyone.
    expect(storeService.getBuyerAccounts()).toEqual([]);
    expect(storeService.getActiveBuyerAccount()).toBeNull();
    expect(storeService.getRFQs()).toEqual([]);
    expect(storeService.getAuditLogs()).toEqual([]);
    expect(storeService.getBootstrapData()).not.toHaveProperty('rfqs');
    // System config and the infrastructure list are static defaults, not records.
    expect(storeService.getAzureHealth().length).toBeGreaterThan(0);
    expect(storeService.getSystemConfig()).toBeTruthy();
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

    // ── Attachments and provenance ────────────────────────────────────────────
    // These four fields were absent from the object createRFQ builds, so they were
    // silently dropped on every save: the stored RFQ came back with a null
    // `source` and a null `sourceFileName`, which left the details screen unable
    // to say where a record came from, and made the ingestion wizard's documented
    // fallback for the uploaded document impossible.
    test('createRFQ persists the attachment metadata it is given', () => {
      const attachment = {
        id: 'att-1',
        fileName: 'boq-pumps.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 2048,
        uploadedAt: '2026-09-05T06:00:00.000Z',
      };

      const rfq = storeService.createRFQ({
        title: 'Attachment RFQ',
        category: 'Raw Material',
        attachments: [attachment],
      });

      expect(rfq.attachments).toEqual([attachment]);
    });

    test('createRFQ defaults attachments to an empty list when none are supplied', () => {
      const rfq = storeService.createRFQ({ title: 'No Attachment RFQ', category: 'Raw Material' });
      expect(rfq.attachments).toEqual([]);
    });

    test('createRFQ ignores a non-array attachments value rather than storing it', () => {
      const rfq = storeService.createRFQ({
        title: 'Bad Attachment RFQ',
        category: 'Raw Material',
        attachments: 'not-an-array',
      });
      expect(rfq.attachments).toEqual([]);
    });

    test('createRFQ retains the document provenance fields', () => {
      const rfq = storeService.createRFQ({
        title: 'Provenance RFQ',
        category: 'Raw Material',
        source: 'web_portal',
        sourceFileName: 'boq-pumps.xlsx',
        sourceEmail: 'project.procurement@example.com',
      });

      expect(rfq.source).toBe('web_portal');
      expect(rfq.sourceFileName).toBe('boq-pumps.xlsx');
      expect(rfq.sourceEmail).toBe('project.procurement@example.com');
    });

    test('createRFQ reports absent provenance as null rather than undefined', () => {
      // Persisted as JSONB, where an undefined key vanishes entirely and an
      // explicit null round-trips — so the details screen can distinguish
      // "not recorded" from "field does not exist on this record".
      const rfq = storeService.createRFQ({ title: 'Bare RFQ', category: 'Raw Material' });

      expect(rfq.source).toBeNull();
      expect(rfq.sourceFileName).toBeNull();
      expect(rfq.sourceEmail).toBeNull();
    });

    test('createRFQ stamps raisedByEmail from the requesting buyer account', () => {
      const account = { id: 'buyer-acc-raised', organizationName: 'Raised Co', corporateEmail: 'raiser@co.com' };
      const rfq = storeService.createRFQ({ title: 'Raised RFQ', category: 'Raw Material' }, account);

      expect(rfq.raisedByEmail).toBe('raiser@co.com');
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

  // The flag and the seed data are gone for good, not merely switched off. A
  // toggle would have left the fabricated RFQs one environment variable away
  // from reappearing in the same collection as a buyer's real work.
  test('the demo RFQ seed toggle no longer exists', () => {
    expect(storeService.shouldSeedDemoRFQs).toBeUndefined();
  });

  // The seed module is deleted outright, not emptied. While it existed, any of
  // its arrays could be repopulated and would land straight back in the same
  // collections a buyer's real records occupy.
  test('the seed module no longer exists', () => {
    expect(() => require('../src/db/seed')).toThrow(/Cannot find module/);
  });

  test.each([['true'], ['false'], [undefined]])(
    'a store built with SEED_DEMO_RFQS=%s starts completely empty',
    (flag) => {
      if (flag === undefined) delete process.env.SEED_DEMO_RFQS;
      else process.env.SEED_DEMO_RFQS = flag;
      jest.resetModules();

      // Re-required so the constructor runs again under this environment. The flag
      // is inert now — there is no seed data left for it to switch on.
      const freshStore = require('../src/services/storeService');

      expect(freshStore.rfqs).toEqual([]);
      expect(freshStore.aiFeed).toEqual([]);
      expect(freshStore.auditLogs).toEqual([]);
      expect(freshStore.vendors).toEqual([]);
      expect(freshStore.evaluations).toEqual([]);
      expect(freshStore.vendorCatalogue).toEqual([]);
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

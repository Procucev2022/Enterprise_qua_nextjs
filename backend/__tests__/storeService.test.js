const storeService = require('../src/services/storeService');
const domainPool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');

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

  describe('Bulk Vendor Import', () => {
    function row(overrides = {}) {
      return {
        rowNumber: 1,
        name: 'Hydrocare Fluid Power Systems',
        contactPerson: 'Hydrocare',
        email: 'hydrocare@example.com',
        phone: '9243047807',
        majorCategory: 'Hoses, Valves & Fittings',
        city: 'Bengaluru',
        state: 'Karnataka',
        gstin: '29AAAPL5929R1ZX',
        pincode: '560047',
        products: 'Hydraulic Pumps, Valves',
        ...overrides,
      };
    }

    test('imports valid, distinct rows and reflects them in getVendors', async () => {
      const before = storeService.getVendors().length;
      const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([
        row({ rowNumber: 1, email: 'bulk-a@example.com' }),
        row({ rowNumber: 2, email: 'bulk-b@example.com', name: '3S Industries' }),
      ]);

      expect(importedCount).toBe(2);
      expect(duplicateCount).toBe(0);
      expect(results.every((r) => r.status === 'imported')).toBe(true);
      expect(storeService.getVendors().length).toBe(before + 2);
      expect(storeService.getVendors().some((v) => v.email === 'bulk-a@example.com')).toBe(true);
    });

    test('flags a row whose email already exists in the store as a duplicate, without re-importing it', async () => {
      const existing = storeService.addVendor({ name: 'Existing Co', email: 'already-here@example.com', majorCategory: 'Mechanical' });

      const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([
        row({ rowNumber: 5, email: existing.email }),
      ]);

      expect(importedCount).toBe(0);
      expect(duplicateCount).toBe(1);
      expect(results[0]).toMatchObject({ rowNumber: 5, status: 'duplicate' });
      // Not a second vendor row for the same email.
      expect(storeService.getVendors().filter((v) => v.email === existing.email)).toHaveLength(1);
    });

    test('flags the second occurrence of the same email within one upload as a duplicate, keeping only the first', async () => {
      const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([
        row({ rowNumber: 1, email: 'repeat@example.com', name: 'First Occurrence' }),
        row({ rowNumber: 2, email: 'repeat@example.com', name: 'Second Occurrence' }),
      ]);

      expect(importedCount).toBe(1);
      expect(duplicateCount).toBe(1);
      expect(results.find((r) => r.rowNumber === 1).status).toBe('imported');
      expect(results.find((r) => r.rowNumber === 2)).toMatchObject({ status: 'duplicate', reason: expect.stringContaining('within the uploaded file') });
    });

    test('an empty batch imports nothing without touching the store', async () => {
      const before = storeService.getVendors().length;
      const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([]);
      expect(results).toEqual([]);
      expect(importedCount).toBe(0);
      expect(duplicateCount).toBe(0);
      expect(storeService.getVendors().length).toBe(before);
    });

    test('when a DB pool is configured, a row the bulk INSERT silently skipped (a race-condition duplicate) is reported as duplicate, not imported', async () => {
      const originalPool = domainPool.pool;
      const spy = jest.spyOn(domainQueries, 'bulkInsertVendorsInDB').mockResolvedValue([]);
      domainPool.pool = { query: jest.fn() }; // truthy sentinel: "a pool is configured"

      try {
        const { results, importedCount, duplicateCount } = await storeService.bulkAddVendors([
          row({ rowNumber: 9, email: 'raced-out@example.com' }),
        ]);

        expect(importedCount).toBe(0);
        expect(duplicateCount).toBe(1);
        expect(results[0]).toMatchObject({ rowNumber: 9, status: 'duplicate', email: 'raced-out@example.com' });
        expect(storeService.getVendors().some((v) => v.email === 'raced-out@example.com')).toBe(false);
      } finally {
        domainPool.pool = originalPool;
        spy.mockRestore();
      }
    });

    test('imported vendors carry the source-tracking and default fields a bulk-Excel import implies', async () => {
      await storeService.bulkAddVendors([row({ rowNumber: 1, email: 'tagged@example.com' })]);
      const created = storeService.getVendors().find((v) => v.email === 'tagged@example.com');
      expect(created).toMatchObject({
        source: 'excel',
        status: 'REGISTERED / NOT EVALUATED',
        evaluated: false,
        gstin: '29AAAPL5929R1ZX',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560047',
      });
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

  describe('Notifications', () => {
    test('createRFQ raises a category-matched notification for every covering vendor and nobody else', () => {
      const covering = storeService.addVendor({
        name: 'Pumps R Us',
        email: 'pumps@example.com',
        majorCategory: 'Pumps & Accessories',
        minorCategories: [],
      });
      const minorMatch = storeService.addVendor({
        name: 'Minor Match Co',
        email: 'minor@example.com',
        majorCategory: 'Something Else',
        minorCategories: ['pumps & accessories'], // casing deliberately different
      });
      const unrelated = storeService.addVendor({
        name: 'Cables Only Co',
        email: 'cables@example.com',
        majorCategory: 'Cables',
        minorCategories: [],
      });

      const rfq = storeService.createRFQ({ title: 'Centrifugal Pumps', category: 'Pumps & Accessories' });

      const forCovering = storeService.getNotificationsFor('vendor', covering.id);
      const forMinor = storeService.getNotificationsFor('vendor', minorMatch.id);
      const forUnrelated = storeService.getNotificationsFor('vendor', unrelated.id);

      expect(forCovering).toHaveLength(1);
      expect(forCovering[0]).toMatchObject({
        recipientType: 'vendor',
        kind: 'rfq_category_match',
        rfqNumber: rfq.rfqNumber,
        read: false,
      });
      expect(forMinor).toHaveLength(1);
      expect(forUnrelated).toHaveLength(0);
      expect(storeService.getUnreadNotificationCountFor('vendor', covering.id)).toBe(1);
    });

    test('createRFQ raises nothing when the RFQ has no category', () => {
      const vendor = storeService.addVendor({
        name: 'No Category Vendor',
        email: 'nocat@example.com',
        majorCategory: 'Raw Material',
        minorCategories: [],
      });
      storeService.createRFQ({ title: 'Uncategorised', category: null });
      expect(storeService.getNotificationsFor('vendor', vendor.id)).toHaveLength(0);
    });

    test('addQuoteToRFQ notifies the RFQ owning buyer, resolved from buyerAccountId', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Quote Notify Co',
        corporateEmail: 'quote-notify@example.com',
      });
      const rfq = storeService.createRFQ({ title: 'Steel', category: 'Raw Material' }, buyer);

      storeService.addQuoteToRFQ(rfq.id, { vendorId: 'v-x', vendorName: 'Bidder Co', unitPrice: 100, totalPrice: 1000 });

      const forBuyer = storeService
        .getNotificationsFor('buyer', buyer.id)
        .filter((n) => n.kind === 'quote_received');
      expect(forBuyer).toHaveLength(1);
      expect(forBuyer[0]).toMatchObject({
        rfqNumber: rfq.rfqNumber,
        meta: { vendorName: 'Bidder Co', totalPrice: 1000 },
      });
    });

    test('addQuoteToRFQ notifies nothing for an RFQ with no owning buyer', () => {
      const before = storeService.notifications.length;
      // createRFQ with no requesting account and no active account resolves
      // buyerAccountId to null.
      const rfq = storeService.createRFQ({ title: 'Ownerless', category: 'Raw Material' });
      if (rfq.buyerAccountId) return; // environment has an active account; skip
      storeService.addQuoteToRFQ(rfq.id, { vendorId: 'v-y', vendorName: 'X', unitPrice: 1 });
      const quoteNotifs = storeService.notifications
        .slice(0, storeService.notifications.length - before)
        .filter((n) => n.kind === 'quote_received');
      expect(quoteNotifs).toHaveLength(0);
    });

    test('markNotificationRead only flips the caller’s own notification', () => {
      const vendor = storeService.addVendor({
        name: 'Read Test Vendor',
        email: 'readtest@example.com',
        majorCategory: 'Valves',
        minorCategories: [],
      });
      storeService.createRFQ({ title: 'Valves RFQ', category: 'Valves' });
      const [notification] = storeService.getNotificationsFor('vendor', vendor.id);

      // Wrong recipient id → treated as not found, nothing changes.
      expect(storeService.markNotificationRead(notification.id, 'vendor', 'someone-else')).toBeNull();
      expect(storeService.getNotificationsFor('vendor', vendor.id)[0].read).toBe(false);

      const updated = storeService.markNotificationRead(notification.id, 'vendor', vendor.id);
      expect(updated.read).toBe(true);
      // Idempotent: a second call is a no-op that still returns the row.
      expect(storeService.markNotificationRead(notification.id, 'vendor', vendor.id).read).toBe(true);
    });

    test('markAllNotificationsRead clears every unread notification for one recipient', () => {
      const vendor = storeService.addVendor({
        name: 'Bulk Read Vendor',
        email: 'bulkread@example.com',
        majorCategory: 'Compressors & Accessories',
        minorCategories: [],
      });
      storeService.createRFQ({ title: 'Compressor A', category: 'Compressors & Accessories' });
      storeService.createRFQ({ title: 'Compressor B', category: 'Compressors & Accessories' });

      expect(storeService.getUnreadNotificationCountFor('vendor', vendor.id)).toBe(2);
      expect(storeService.markAllNotificationsRead('vendor', vendor.id)).toBe(2);
      expect(storeService.getUnreadNotificationCountFor('vendor', vendor.id)).toBe(0);
      // Nothing left to change on a second sweep.
      expect(storeService.markAllNotificationsRead('vendor', vendor.id)).toBe(0);
    });

    test('getNotificationsFor returns an empty list when no recipient id is given', () => {
      expect(storeService.getNotificationsFor('vendor', null)).toEqual([]);
    });

    test('vendorCoversCategory handles a null category, a whitespace category and a vendor with no category arrays', () => {
      const bareVendor = storeService.addVendor({ name: 'Bare Vendor', email: 'bare@example.com', majorCategory: 'Bearings' });
      expect(storeService.vendorCoversCategory(bareVendor, null)).toBe(false);
      expect(storeService.vendorCoversCategory(bareVendor, '   ')).toBe(false);
      expect(storeService.vendorCoversCategory(bareVendor, 'Bearings')).toBe(true);
      // A whitespace-only category on a real RFQ matches nobody.
      storeService.createRFQ({ title: 'Whitespace Category RFQ', category: '   ' });
      expect(storeService.getNotificationsFor('vendor', bareVendor.id)).toHaveLength(0);
    });

    test('addQuoteToRFQ still notifies the buyer for a quote with no vendorId', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'No VendorId Co',
        corporateEmail: 'no-vendorid@example.com',
      });
      const rfq = storeService.createRFQ({ title: 'No VendorId RFQ', category: 'Raw Material' }, buyer);
      storeService.addQuoteToRFQ(rfq.id, { unitPrice: 9, totalPrice: 9 });
      const forBuyer = storeService
        .getNotificationsFor('buyer', buyer.id)
        .filter((n) => n.kind === 'quote_received' && n.rfqNumber === rfq.rfqNumber);
      expect(forBuyer).toHaveLength(1);
    });
  });

  describe('Vendor RFQ visibility (vendorCoversRFQ / getRFQsForVendor)', () => {
    test('matches on the RFQ category or any line-item category, case-insensitively', () => {
      const v = storeService.addVendor({ name: 'Signal Vendor', email: 'signal@ex.com', majorCategory: 'Pumps & Accessories' });

      expect(storeService.vendorCoversRFQ(v, { category: 'pumps & accessories' })).toBe(true);
      expect(
        storeService.vendorCoversRFQ(v, {
          category: null,
          extractedEntities: [{ minorCategory: 'Pumps & Accessories' }],
        })
      ).toBe(true);
      expect(storeService.vendorCoversRFQ(v, { category: 'Cables' })).toBe(false);
    });

    test('a vendor the buyer added sees that buyer’s RFQ regardless of category', () => {
      const v = storeService.addVendor({
        name: 'Rostered Vendor',
        email: 'rostered@ex.com',
        majorCategory: 'Bearings',
        addedByBuyerCompany: 'Acme Buyer Co',
      });
      expect(storeService.vendorCoversRFQ(v, { category: 'Cables', buyerAccountName: 'Acme Buyer Co' })).toBe(true);
      expect(storeService.vendorCoversRFQ(v, { category: 'Cables', buyerAccountName: 'Other Co' })).toBe(false);
    });

    test('an explicitly invited vendor (assignedVendors) sees the RFQ regardless of category', () => {
      const v = storeService.addVendor({ name: 'Invited Vendor', email: 'invited@ex.com', majorCategory: 'Bearings' });
      expect(
        storeService.vendorCoversRFQ(v, { category: 'Cables', assignedVendors: [{ email: 'INVITED@ex.com' }] })
      ).toBe(true);
      expect(storeService.vendorCoversRFQ(v, { category: 'Cables', assignedVendors: [{ id: v.id }] })).toBe(true);
    });

    test('a vendor with no category profile at all matches nothing', () => {
      const v = storeService.addVendor({ name: 'No Cat Vendor', email: 'nocat2@ex.com' });
      v.majorCategory = '';
      expect(storeService.vendorCoversRFQ(v, { category: 'Anything' })).toBe(false);
    });

    test('getRFQsForVendor returns only the RFQs that vendor may see; an unknown vendor gets []', () => {
      const v = storeService.addVendor({ name: 'Scope Vendor', email: 'scope@ex.com', majorCategory: 'Valves-Scope-Test' });
      const mine = storeService.createRFQ({ title: 'Valves enquiry', category: 'Valves-Scope-Test' });
      storeService.createRFQ({ title: 'Cables enquiry', category: 'Cables-Scope-Test' });

      const visible = storeService.getRFQsForVendor('scope@ex.com');
      expect(visible.map((r) => r.rfqNumber)).toContain(mine.rfqNumber);
      expect(visible.every((r) => storeService.vendorCoversRFQ(v, r))).toBe(true);
      expect(visible.some((r) => r.title === 'Cables enquiry')).toBe(false);

      expect(storeService.getRFQsForVendor('ghost@nowhere.test')).toEqual([]);
    });

    test('notifyVendorsOfNewRFQ now uses the same rule — a rostered vendor is notified even off-category', () => {
      const rostered = storeService.addVendor({
        name: 'Notify Rostered',
        email: 'notifyrostered@ex.com',
        majorCategory: 'Bearings',
        addedByBuyerCompany: 'Notify Roster Buyer',
      });
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Notify Roster Buyer',
        corporateEmail: 'notify-roster@ex.com',
      });
      storeService.createRFQ({ title: 'Off-category but rostered', category: 'Totally-Different-Cat' }, buyer);
      expect(storeService.getNotificationsFor('vendor', rostered.id)).toHaveLength(1);
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

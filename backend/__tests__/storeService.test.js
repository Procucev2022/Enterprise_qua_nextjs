const storeService = require('../src/services/storeService');
const domainPool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const mailerService = require('../src/services/mailerService');

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
    test('createRFQ raises no notification for a category-only match — an invite is required first', () => {
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

      const rfq = storeService.createRFQ({ title: 'Centrifugal Pumps', category: 'Pumps & Accessories' });
      expect(storeService.getNotificationsFor('vendor', covering.id)).toHaveLength(0);
      expect(storeService.getNotificationsFor('vendor', minorMatch.id)).toHaveLength(0);

      // Both are real candidates, and inviting either fires exactly one
      // 'rfq_category_match' notification for that vendor.
      const candidates = storeService.candidateVendorsForRFQ(rfq).map((c) => c.id);
      expect(candidates).toEqual(expect.arrayContaining([covering.id, minorMatch.id]));

      storeService.inviteVendorsToRFQ(rfq.id, [covering.id], 'cm@ex.com');
      const forCovering = storeService.getNotificationsFor('vendor', covering.id);
      expect(forCovering).toHaveLength(1);
      expect(forCovering[0]).toMatchObject({ recipientType: 'vendor', kind: 'rfq_category_match', rfqNumber: rfq.rfqNumber, read: false });
      expect(storeService.getNotificationsFor('vendor', minorMatch.id)).toHaveLength(0);
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
      const rfq = storeService.createRFQ({ title: 'Valves RFQ', category: 'Valves' });
      storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');
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
      const rfqA = storeService.createRFQ({ id: 'rfq-bulk-read-a', title: 'Compressor A', category: 'Compressors & Accessories' });
      const rfqB = storeService.createRFQ({ id: 'rfq-bulk-read-b', title: 'Compressor B', category: 'Compressors & Accessories' });
      storeService.inviteVendorsToRFQ(rfqA.id, [vendor.id], 'cm@ex.com');
      storeService.inviteVendorsToRFQ(rfqB.id, [vendor.id], 'cm@ex.com');

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

  describe('Vendor RFQ visibility (vendorCoversRFQ / candidateVendorsForRFQ / getRFQsForVendor)', () => {
    test('category match alone no longer grants vendorCoversRFQ — only produces a candidate pool', () => {
      const v = storeService.addVendor({ name: 'Signal Vendor', email: 'signal@ex.com', majorCategory: 'Pumps & Accessories' });

      // Not invited, not added by the buyer — category alone is not enough.
      expect(storeService.vendorCoversRFQ(v, { category: 'pumps & accessories' })).toBe(false);
      expect(
        storeService.vendorCoversRFQ(v, {
          category: null,
          extractedEntities: [{ minorCategory: 'Pumps & Accessories' }],
        })
      ).toBe(false);
    });

    test('candidateVendorsForRFQ lists every category-matched vendor, flagging who is already invited', () => {
      const matched = storeService.addVendor({ name: 'Candidate Vendor', email: 'candidate@ex.com', majorCategory: 'Candidate-Cat' });
      storeService.addVendor({ name: 'Unmatched Vendor', email: 'unmatched@ex.com', majorCategory: 'Some-Other-Cat' });
      const rfq = storeService.createRFQ({ title: 'Candidate pool RFQ', category: 'Candidate-Cat' });

      const candidates = storeService.candidateVendorsForRFQ(rfq);
      expect(candidates.map((c) => c.id)).toContain(matched.id);
      expect(candidates.map((c) => c.id)).not.toContain('unmatched');
      expect(candidates.find((c) => c.id === matched.id).alreadyInvited).toBe(false);

      storeService.inviteVendorsToRFQ(rfq.id, [matched.id], 'cm@ex.com');
      const afterInvite = storeService.candidateVendorsForRFQ(storeService.getRFQById(rfq.id));
      expect(afterInvite.find((c) => c.id === matched.id).alreadyInvited).toBe(true);
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

    test('a vendor with no category profile at all matches nothing (not even as a candidate)', () => {
      const v = storeService.addVendor({ name: 'No Cat Vendor', email: 'nocat2@ex.com' });
      v.majorCategory = '';
      expect(storeService.vendorCoversRFQ(v, { category: 'Anything' })).toBe(false);
      expect(storeService.candidateVendorsForRFQ({ category: 'Anything' }).map((c) => c.id)).not.toContain(v.id);
    });

    test('getRFQsForVendor only returns invited/added RFQs — category match alone is not enough; an unknown vendor gets []', () => {
      const v = storeService.addVendor({ name: 'Scope Vendor', email: 'scope@ex.com', majorCategory: 'Valves-Scope-Test' });
      // Explicit distinct ids: createRFQ's default id is `rfq-${Date.now()}`,
      // so two calls in the same millisecond can otherwise collide.
      const notInvited = storeService.createRFQ({ id: 'rfq-scope-test-1', title: 'Valves enquiry, not invited', category: 'Valves-Scope-Test' });
      storeService.createRFQ({ id: 'rfq-scope-test-2', title: 'Cables enquiry', category: 'Cables-Scope-Test' });

      let visible = storeService.getRFQsForVendor('scope@ex.com');
      expect(visible.map((r) => r.rfqNumber)).not.toContain(notInvited.rfqNumber);

      storeService.inviteVendorsToRFQ(notInvited.id, [v.id], 'cm@ex.com');
      visible = storeService.getRFQsForVendor('scope@ex.com');
      expect(visible.map((r) => r.rfqNumber)).toContain(notInvited.rfqNumber);
      expect(visible.every((r) => storeService.vendorCoversRFQ(v, r))).toBe(true);
      expect(visible.some((r) => r.title === 'Cables enquiry')).toBe(false);

      expect(storeService.getRFQsForVendor('ghost@nowhere.test')).toEqual([]);
    });

    test('notifyVendorsOfNewRFQ still fires (unchanged) — a rostered vendor is notified even off-category', () => {
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

  describe('inviteVendorsToRFQ (category manager invite flow)', () => {
    let inviteEmailSpy;

    beforeEach(() => {
      inviteEmailSpy = jest
        .spyOn(mailerService, 'sendRfqInviteEmail')
        .mockResolvedValue({ sent: false, reason: 'test environment' });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('returns null for an unknown RFQ', () => {
      expect(storeService.inviteVendorsToRFQ('does-not-exist', ['v-1'], 'cm@ex.com')).toBeNull();
    });

    test('skips unknown vendor ids and returns invitedCount 0 when nothing new was added', () => {
      const rfq = storeService.createRFQ({ title: 'Invite Skip RFQ', category: 'Invite-Skip-Cat' });
      const result = storeService.inviteVendorsToRFQ(rfq.id, ['ghost-vendor-id'], 'cm@ex.com');
      expect(result).toEqual({ updatedRFQ: expect.objectContaining({ id: rfq.id }), invitedCount: 0 });
    });

    test('invites a vendor: grants access, fires the fake chaser feed, a real notification, a real email, and an audit entry', () => {
      const vendor = storeService.addVendor({ name: 'Invite Flow Vendor', email: 'inviteflow@ex.com', majorCategory: 'Invite-Flow-Cat' });
      const rfq = storeService.createRFQ({ title: 'Invite Flow RFQ', category: 'Invite-Flow-Cat' });
      const feedBefore = storeService.getAIFeed().length;
      const auditBefore = storeService.getAuditLogs().length;

      const result = storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');

      expect(result.invitedCount).toBe(1);
      expect(storeService.vendorCoversRFQ(vendor, result.updatedRFQ)).toBe(true);
      expect(storeService.getAIFeed().length).toBeGreaterThan(feedBefore); // fake chaser feed
      expect(storeService.getAuditLogs().length).toBeGreaterThan(auditBefore);
      expect(storeService.getAuditLogs()[0].action).toContain('Invited 1 vendor(s)');
      const notifs = storeService.getNotificationsFor('vendor', vendor.id);
      expect(notifs).toHaveLength(1);
      expect(inviteEmailSpy).toHaveBeenCalledWith('inviteflow@ex.com', expect.objectContaining({ rfq: expect.objectContaining({ id: rfq.id }) }));
    });

    test('re-inviting an already-invited vendor is a no-op (dedup, no duplicate side effects)', () => {
      const vendor = storeService.addVendor({ name: 'Dedup Vendor', email: 'dedup@ex.com', majorCategory: 'Dedup-Cat' });
      const rfq = storeService.createRFQ({ title: 'Dedup RFQ', category: 'Dedup-Cat' });

      storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');
      const notifsAfterFirst = storeService.getNotificationsFor('vendor', vendor.id).length;

      const second = storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');
      expect(second.invitedCount).toBe(0);
      expect(storeService.getNotificationsFor('vendor', vendor.id)).toHaveLength(notifsAfterFirst);
    });

    test('skips the email step for an invited vendor with no email address', () => {
      const vendor = storeService.addVendor({ name: 'No Email Vendor', email: '', majorCategory: 'No-Email-Cat' });
      const rfq = storeService.createRFQ({ title: 'No Email RFQ', category: 'No-Email-Cat' });

      const result = storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');

      expect(result.invitedCount).toBe(1);
      expect(inviteEmailSpy).not.toHaveBeenCalled();
    });

    test('vendorIds that is not an array is treated as empty — invitedCount 0', () => {
      const rfq = storeService.createRFQ({ title: 'Non-Array Invite RFQ', category: 'Non-Array-Cat' });
      const result = storeService.inviteVendorsToRFQ(rfq.id, null, 'cm@ex.com');
      expect(result).toEqual({ updatedRFQ: rfq, invitedCount: 0 });
    });

    test('defaults the audit actor when no actorEmail is given', () => {
      const vendor = storeService.addVendor({ name: 'No Actor Vendor', email: 'noactor@ex.com', majorCategory: 'No-Actor-Cat' });
      const rfq = storeService.createRFQ({ title: 'No Actor RFQ', category: 'No-Actor-Cat' });

      storeService.inviteVendorsToRFQ(rfq.id, [vendor.id]);

      expect(storeService.getAuditLogs()[0].action).toContain('Invited 1 vendor(s)');
    });

    test('tolerates an RFQ record with no assignedVendors array (legacy data predating the field)', () => {
      const vendor = storeService.addVendor({ name: 'Legacy Data Vendor', email: 'legacy@ex.com', majorCategory: 'Legacy-Cat' });
      const rfq = storeService.createRFQ({ title: 'Legacy RFQ', category: 'Legacy-Cat' });
      delete storeService.getRFQById(rfq.id).assignedVendors;

      const result = storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');

      expect(result.invitedCount).toBe(1);
    });

    test('the invite notification title falls back to a category signal, then to a generic label', () => {
      const vendorA = storeService.addVendor({ name: 'Signal Vendor', email: 'signal@ex.com', majorCategory: 'No-Header-Cat' });
      const rfqWithSignal = storeService.createRFQ({
        title: 'No Header RFQ',
        extractedEntities: [{ category: 'No-Header-Cat' }],
      });
      storeService.inviteVendorsToRFQ(rfqWithSignal.id, [vendorA.id], 'cm@ex.com');
      const [notifA] = storeService.getNotificationsFor('vendor', vendorA.id);
      expect(notifA.title).toBe('New RFQ in No-Header-Cat');

      const vendorB = storeService.addVendor({ name: 'No Signal Vendor', email: 'nosignal@ex.com', majorCategory: 'Anything' });
      const rfqNoSignal = storeService.createRFQ({ title: 'No Signal RFQ' });
      storeService.inviteVendorsToRFQ(rfqNoSignal.id, [vendorB.id], 'cm@ex.com');
      const [notifB] = storeService.getNotificationsFor('vendor', vendorB.id);
      expect(notifB.title).toBe('New RFQ in your categories');
    });

    test('logs (does not throw) when the invite email send rejects', async () => {
      inviteEmailSpy.mockRejectedValueOnce(new Error('smtp down'));
      const vendor = storeService.addVendor({ name: 'Invite Fail Vendor', email: 'invitefail@ex.com', majorCategory: 'Invite-Fail-Cat' });
      const rfq = storeService.createRFQ({ title: 'Invite Fail RFQ', category: 'Invite-Fail-Cat' });

      const result = storeService.inviteVendorsToRFQ(rfq.id, [vendor.id], 'cm@ex.com');

      expect(result.invitedCount).toBe(1);
      await new Promise((r) => setImmediate(r)); // let the rejected promise settle
    });
  });

  describe('Transactional email (RFQ fan-out + quote-received)', () => {
    let inviteSpy;
    let quoteSpy;

    beforeEach(() => {
      inviteSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: false, reason: 'test environment' });
      quoteSpy = jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue({ sent: false, reason: 'test environment' });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('_vendorTierRank orders the plans and treats anything unknown as lowest', () => {
      expect(storeService._vendorTierRank('select')).toBe(3);
      expect(storeService._vendorTierRank('connect')).toBe(2);
      expect(storeService._vendorTierRank('premium')).toBe(1);
      expect(storeService._vendorTierRank('premium_network')).toBe(1);
      expect(storeService._vendorTierRank(undefined)).toBe(0);
      expect(storeService._vendorTierRank('free_trial')).toBe(0);
    });

    test('selectVendorsForRFQEmail ranks by tier, then a pincode match, then rating, and caps at the limit', () => {
      const cat = 'Email-Rank-Cat';
      const mk = (over) =>
        storeService.addVendor({ minorCategories: [], majorCategory: cat, ...over });

      const lowTierPincode = mk({ name: 'Low tier, pincode match', email: 'a@ex.com', subscriptionPlan: 'premium', pincode: '400001', rating: 5 });
      const highTierNoPincode = mk({ name: 'High tier, no pincode', email: 'b@ex.com', subscriptionPlan: 'select', pincode: '999999', rating: 1 });
      const midTierPincode = mk({ name: 'Mid tier, pincode match', email: 'c@ex.com', subscriptionPlan: 'connect', pincode: '400001', rating: 2 });
      mk({ name: 'No email vendor', email: '', subscriptionPlan: 'select', pincode: '400001' });

      // selectVendorsForRFQEmail is downstream of vendorCoversRFQ, which now
      // requires an invite — assignedVendors here stands in for "already
      // invited", isolating this test to the ranking logic itself.
      const rfq = {
        category: cat,
        deliveryPincode: '400001',
        extractedEntities: [],
        assignedVendors: [lowTierPincode, highTierNoPincode, midTierPincode].map((v) => ({ id: v.id })),
      };
      const ranked = storeService.selectVendorsForRFQEmail(rfq, 2);

      expect(ranked).toHaveLength(2);
      expect(ranked[0].id).toBe(highTierNoPincode.id); // tier beats pincode
      expect(ranked[1].id).toBe(midTierPincode.id); // connect+pincode beats premium+pincode
      void lowTierPincode;
    });

    test('createRFQ emails the top matched vendors — an addedByBuyerCompany vendor, no invite needed', () => {
      const cat = 'Email-Create-Cat';
      // addedByBuyerCompany grants immediate coverage without a CM invite, so
      // this is the one case createRFQ's own auto-email call still reaches.
      storeService.addVendor({
        name: 'Emailed Vendor',
        email: 'emailed@ex.com',
        majorCategory: cat,
        minorCategories: [],
        addedByBuyerCompany: 'Email Create Buyer',
      });
      const buyer = storeService.addBuyerAccount({ organizationName: 'Email Create Buyer', corporateEmail: 'ecb@ex.com' });

      storeService.createRFQ({ title: 'Emailed RFQ', category: cat }, buyer);

      expect(inviteSpy).toHaveBeenCalledWith(
        'emailed@ex.com',
        expect.objectContaining({ rfq: expect.objectContaining({ title: 'Emailed RFQ' }) })
      );
    });

    test('emailRFQToMatchedVendors logs (does not throw) when a send rejects', async () => {
      inviteSpy.mockRejectedValueOnce(new Error('smtp down'));
      const cat = 'Email-Fail-Cat';
      const vendor = storeService.addVendor({ name: 'Failing Send Vendor', email: 'fail@ex.com', majorCategory: cat, minorCategories: [] });

      const count = storeService.emailRFQToMatchedVendors({
        category: cat,
        extractedEntities: [],
        rfqNumber: 'RFQ-X',
        title: 'T',
        assignedVendors: [{ id: vendor.id }],
      });
      expect(count).toBe(1);
      await new Promise((r) => setImmediate(r)); // let the rejected promise settle
    });

    test('addQuoteToRFQ emails the owning buyer with the quote', () => {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Quote Email Buyer', corporateEmail: 'qeb@ex.com' });
      const rfq = storeService.createRFQ({ title: 'Quote Email RFQ', category: 'Raw Material' }, buyer);

      storeService.addQuoteToRFQ(rfq.id, { vendorId: 'v-1', vendorName: 'Bidder', unitPrice: 10, totalPrice: 100 });

      expect(quoteSpy).toHaveBeenCalledWith(
        'qeb@ex.com',
        expect.objectContaining({ quote: expect.objectContaining({ vendorName: 'Bidder' }), recipientName: 'Quote Email Buyer' })
      );
    });

    test('emailQuoteToBuyer no-ops without an owning buyer, an unknown buyer, or a buyer with no email', () => {
      expect(storeService.emailQuoteToBuyer({ buyerAccountId: null }, {})).toBe(false);
      expect(storeService.emailQuoteToBuyer({ buyerAccountId: 'does-not-exist' }, {})).toBe(false);

      const emailless = storeService.addBuyerAccount({ organizationName: 'Emailless Buyer' });
      emailless.corporateEmail = '';
      expect(storeService.emailQuoteToBuyer({ buyerAccountId: emailless.id }, {})).toBe(false);
      expect(quoteSpy).not.toHaveBeenCalled();
    });

    test('emailQuoteToBuyer logs (does not throw) when the send rejects', async () => {
      quoteSpy.mockRejectedValueOnce(new Error('smtp down'));
      const buyer = storeService.addBuyerAccount({ organizationName: 'Reject Email Buyer', corporateEmail: 'reb@ex.com' });
      expect(storeService.emailQuoteToBuyer({ buyerAccountId: buyer.id, rfqNumber: 'RFQ-Y', title: 'T' }, { unitPrice: 1 })).toBe(true);
      await new Promise((r) => setImmediate(r));
    });
  });

  describe('Zoho payment links (createPaymentLinkRecord / activateVendorSubscriptionFromPayment)', () => {
    test('createPaymentLinkRecord persists a new CREATED-status link', () => {
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-test-1',
        zohoPaymentLinkId: 'zoho-test-1',
        vendorId: 'v-x',
        planId: 'connect',
        amount: 14160,
        paymentUrl: 'https://payments.zoho.in/x',
        status: 'CREATED',
        rawResponse: { some: 'thing' },
      });

      expect(link).toMatchObject({ id: 'pl-test-1', zohoPaymentLinkId: 'zoho-test-1', status: 'CREATED', activated: false });
      expect(storeService.getPaymentLinkByZohoId('zoho-test-1')).toMatchObject({ id: 'pl-test-1' });
    });

    test('getPaymentLinksByStatusIn filters by the given statuses', () => {
      storeService.createPaymentLinkRecord({ id: 'pl-status-a', zohoPaymentLinkId: 'zoho-status-a', vendorId: 'v-x', planId: 'connect', amount: 1, paymentUrl: '', status: 'CREATED' });
      storeService.createPaymentLinkRecord({ id: 'pl-status-b', zohoPaymentLinkId: 'zoho-status-b', vendorId: 'v-x', planId: 'connect', amount: 1, paymentUrl: '', status: 'PAID' });

      const pending = storeService.getPaymentLinksByStatusIn(['CREATED', 'pending']);
      expect(pending.some((l) => l.id === 'pl-status-a')).toBe(true);
      expect(pending.some((l) => l.id === 'pl-status-b')).toBe(false);
    });

    test('updatePaymentLinkRecord merges updates and returns null for an unknown id', () => {
      storeService.createPaymentLinkRecord({ id: 'pl-update-1', zohoPaymentLinkId: 'zoho-update-1', vendorId: 'v-x', planId: 'connect', amount: 1, paymentUrl: '', status: 'CREATED' });

      const updated = storeService.updatePaymentLinkRecord('pl-update-1', { status: 'PAID' });
      expect(updated.status).toBe('PAID');
      expect(storeService.updatePaymentLinkRecord('pl-does-not-exist', { status: 'PAID' })).toBeNull();
    });

    test('activateVendorSubscriptionFromPayment grants the plan, resets quota, marks the link activated, and audits it', () => {
      const vendor = storeService.addVendor({ name: 'Payment Flow Vendor', email: 'paymentflow@ex.com', majorCategory: 'Payment-Cat' });
      storeService.updateVendor(vendor.id, { rfqDownloadsUsed: 7 });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-activate-1',
        zohoPaymentLinkId: 'zoho-activate-1',
        vendorId: vendor.id,
        planId: 'select',
        amount: 33040,
        paymentUrl: '',
        status: 'PAID',
      });
      const auditBefore = storeService.getAuditLogs().length;

      const result = storeService.activateVendorSubscriptionFromPayment(link.id);

      expect(result.activated).toBe(true);
      expect(storeService.getVendorById(vendor.id)).toMatchObject({ subscriptionPlan: 'select', rfqDownloadsUsed: 0 });
      expect(storeService.getAuditLogs().length).toBeGreaterThan(auditBefore);
      expect(storeService.getAuditLogs()[0].action).toContain('select');
    });

    test('activateVendorSubscriptionFromPayment is idempotent — a second call is a no-op', () => {
      const vendor = storeService.addVendor({ name: 'Idempotent Vendor', email: 'idempotent@ex.com', majorCategory: 'Payment-Cat' });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-activate-2',
        zohoPaymentLinkId: 'zoho-activate-2',
        vendorId: vendor.id,
        planId: 'connect',
        amount: 14160,
        paymentUrl: '',
        status: 'PAID',
      });

      storeService.activateVendorSubscriptionFromPayment(link.id);
      const auditAfterFirst = storeService.getAuditLogs().length;

      expect(storeService.activateVendorSubscriptionFromPayment(link.id)).toBeNull();
      expect(storeService.getAuditLogs().length).toBe(auditAfterFirst);
    });

    test('activateVendorSubscriptionFromPayment returns null for an unknown payment link id', () => {
      expect(storeService.activateVendorSubscriptionFromPayment('pl-does-not-exist')).toBeNull();
    });

    test('activateVendorSubscriptionFromPayment returns null when the linked vendor no longer exists', () => {
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-activate-3',
        zohoPaymentLinkId: 'zoho-activate-3',
        vendorId: 'v-does-not-exist',
        planId: 'connect',
        amount: 14160,
        paymentUrl: '',
        status: 'PAID',
      });

      expect(storeService.activateVendorSubscriptionFromPayment(link.id)).toBeNull();
    });

    test('activateBuyerSubscriptionFromPayment grants a paid plan, marks the link activated, and audits it', () => {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Payment Flow Buyer Co', corporateEmail: 'paymentflowbuyer@ex.com' });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-buyer-activate-1',
        zohoPaymentLinkId: 'zoho-buyer-activate-1',
        buyerAccountId: buyer.id,
        payerType: 'buyer',
        planId: 'version_2',
        amount: 47200,
        paymentUrl: '',
        status: 'PAID',
      });
      const auditBefore = storeService.getAuditLogs().length;

      const result = storeService.activateBuyerSubscriptionFromPayment(link.id);

      expect(result.activated).toBe(true);
      expect(storeService.getBuyerAccountByEmail('paymentflowbuyer@ex.com')).toMatchObject({ subscriptionPlan: 'version_2' });
      expect(storeService.getAuditLogs().length).toBeGreaterThan(auditBefore);
      expect(storeService.getAuditLogs()[0].action).toContain('version_2');
    });

    test('activateBuyerSubscriptionFromPayment resets remainingFreeRFQs to 5 only when the plan is free_trial', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Trial Reset Buyer Co',
        corporateEmail: 'trialresetbuyer@ex.com',
        remainingFreeRFQs: 0,
      });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-buyer-activate-2',
        zohoPaymentLinkId: 'zoho-buyer-activate-2',
        buyerAccountId: buyer.id,
        payerType: 'buyer',
        planId: 'free_trial',
        amount: 0,
        paymentUrl: '',
        status: 'PAID',
      });

      storeService.activateBuyerSubscriptionFromPayment(link.id);

      expect(storeService.getBuyerAccountByEmail('trialresetbuyer@ex.com')).toMatchObject({
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 5,
      });
    });

    test('activateBuyerSubscriptionFromPayment is idempotent — a second call is a no-op', () => {
      const buyer = storeService.addBuyerAccount({ organizationName: 'Idempotent Buyer Co', corporateEmail: 'idempotentbuyer@ex.com' });
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-buyer-activate-3',
        zohoPaymentLinkId: 'zoho-buyer-activate-3',
        buyerAccountId: buyer.id,
        payerType: 'buyer',
        planId: 'version_1',
        amount: 18880,
        paymentUrl: '',
        status: 'PAID',
      });

      storeService.activateBuyerSubscriptionFromPayment(link.id);
      const auditAfterFirst = storeService.getAuditLogs().length;

      expect(storeService.activateBuyerSubscriptionFromPayment(link.id)).toBeNull();
      expect(storeService.getAuditLogs().length).toBe(auditAfterFirst);
    });

    test('activateBuyerSubscriptionFromPayment returns null for an unknown payment link id', () => {
      expect(storeService.activateBuyerSubscriptionFromPayment('pl-does-not-exist')).toBeNull();
    });

    test('activateBuyerSubscriptionFromPayment returns null when the linked buyer account no longer exists', () => {
      const link = storeService.createPaymentLinkRecord({
        id: 'pl-buyer-activate-4',
        zohoPaymentLinkId: 'zoho-buyer-activate-4',
        buyerAccountId: 'buyer-does-not-exist',
        payerType: 'buyer',
        planId: 'version_1',
        amount: 18880,
        paymentUrl: '',
        status: 'PAID',
      });

      expect(storeService.activateBuyerSubscriptionFromPayment(link.id)).toBeNull();
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

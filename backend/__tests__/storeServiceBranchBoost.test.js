const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const identityQueries = require('../src/db/identityQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const pool = require('../src/db/pool');
const mailerService = require('../src/services/mailerService');
const smsService = require('../src/services/smsService');
const whatsAppService = require('../src/services/whatsAppService');
const { INQUIRIES_PERSISTENCE_FILE } = require('../src/config/constants');
const fs = require('fs');

describe('storeService comprehensive branch boost tests', () => {
  beforeEach(() => {
    storeService.reset();
    storeService.vendors = [];
    storeService.rfqs = [];
    storeService.notifications = [];
    storeService.paymentLinks = [];
    storeService.evaluations = [];
    storeService.vendorCatalogue = [];
    storeService.auditLogs = [];
    storeService.aiFeed = [];
    storeService.enterpriseInquiries = [];
    storeService._syncRFQsPromise = null;
    storeService._lastRfqSyncMap = new Map();
    storeService._lastRfqSyncTime = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Enterprise Inquiries & Persistence helpers', () => {
    test('enterprise inquiry CRUD operations and limits', () => {
      storeService.enterpriseInquiries = null;
      const created = storeService.addEnterpriseInquiry({
        companyName: 'Acme Corp',
        email: 'acme@example.com',
        mobile: '9876543210',
        notes: 'Interested in annual license',
      });
      expect(created.id).toBeDefined();
      expect(created.companyName).toBe('Acme Corp');

      // get with limit
      const limited = storeService.getEnterpriseInquiries(1);
      expect(limited.length).toBe(1);

      // get without limit
      const all = storeService.getEnterpriseInquiries();
      expect(all.length).toBeGreaterThanOrEqual(1);

      // update non-existent returns null
      expect(storeService.updateEnterpriseInquiry('non-existent-id', { status: 'RESOLVED' })).toBeNull();

      // update existent
      const updated = storeService.updateEnterpriseInquiry(created.id, { status: 'IN_REVIEW' });
      expect(updated.status).toBe('IN_REVIEW');
    });

    test('loadPersistedInquiries and savePersistedInquiries fallback logic', () => {
      const readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify([{ id: 'inq-test-1' }]));
      const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      storeService.enterpriseInquiries = null;
      const inqs = storeService.getEnterpriseInquiries();
      expect(inqs.length).toBeGreaterThan(0);

      readSpy.mockImplementation(() => {
        throw new Error('read error');
      });
      storeService.enterpriseInquiries = null;
      const fallbackInqs = storeService.getEnterpriseInquiries();
      expect(fallbackInqs.length).toBeGreaterThan(0);

      existsSpy.mockRestore();
      readSpy.mockRestore();
    });
  });

  describe('createRFQ advanced branching', () => {
    test('excludes foreign private vendors and updates followUpData', () => {
      const foreignVendor = {
        id: 'v-foreign-1',
        name: 'Foreign Vendor',
        email: 'foreign@example.com',
        buyerId: 'buyer-999',
      };
      storeService.vendors = [foreignVendor];

      const rfqData = {
        rfqNumber: 'RFQ-FOREIGN-TEST',
        title: 'Foreign Vendor Isolation RFQ',
        buyerEmail: 'buyer1@myco.com',
        sourcingMode: 'mode_1',
        assignedVendors: [{ id: 'v-foreign-1' }],
        quotes: [],
      };

      const rfq = storeService.createRFQ(rfqData, { id: 'buyer-1', corporateEmail: 'buyer1@myco.com' });
      expect(rfq.assignedVendors.length).toBe(0);
      expect(rfq.followUpData.totalInvited).toBe(0);
    });

    test('mode_0 (V0) with no category signals routes to Category Manager and leaves assignedVendors empty', () => {
      const rfqData = {
        rfqNumber: 'RFQ-V0-NO-CAT',
        title: 'Uncategorized V0 RFQ',
        buyerEmail: 'v0buyer@example.com',
        sourcingMode: 'mode_0',
        category: null,
        quotes: [],
      };

      const rfq = storeService.createRFQ(rfqData, { id: 'buyer-v0', corporateEmail: 'v0buyer@example.com' });
      expect(rfq.needsCategoryManagerAssignment).toBe(true);
      expect(rfq.procucevVendorCount).toBe(0);
      expect(rfq.assignedVendors.length).toBe(0);
      expect(storeService.notifications.some((n) => n.kind === 'rfq_pending_assignment')).toBe(true);
    });

    test('mode_0 (V0) with category signals selects Procucev vendors and calculates candidate count when assigned is initially empty', () => {
      const pVendor = {
        id: 'v-procucev-1',
        name: 'Procucev Vendor 1',
        email: 'p1@example.com',
        source: 'procucev_network',
        majorCategory: 'Pumps & Motors',
      };
      storeService.vendors = [pVendor];

      const rfqData = {
        rfqNumber: 'RFQ-V0-CAT',
        title: 'Pumps V0 RFQ',
        buyerEmail: 'v0buyer@example.com',
        sourcingMode: 'mode_0',
        category: 'Pumps & Motors',
        deliveryPincode: '400001',
        quotes: [],
      };

      const rfq = storeService.createRFQ(rfqData, { id: 'buyer-v0', corporateEmail: 'v0buyer@example.com' });
      expect(rfq.procucevVendorCount).toBeGreaterThanOrEqual(1);
      expect(rfq.assignedVendors.length).toBeGreaterThanOrEqual(1);
    });

    test('mode_3 (V3) calculates mode3ProcucevCount and handles candidate fallback', () => {
      const pVendor = {
        id: 'v-v3-1',
        name: 'V3 Vendor',
        email: 'v3@example.com',
        source: 'procucev_network',
        majorCategory: 'Industrial Valves',
      };
      storeService.vendors = [pVendor];

      const rfqData = {
        rfqNumber: 'RFQ-V3-TEST',
        title: 'Valves V3 RFQ',
        buyerEmail: 'v3buyer@example.com',
        sourcingMode: 'mode_3',
        category: 'Industrial Valves',
        quotes: [],
      };

      const rfq = storeService.createRFQ(rfqData, { id: 'buyer-v3', corporateEmail: 'v3buyer@example.com' });
      expect(rfq.procucevVendorCount).toBeGreaterThanOrEqual(1);
    });

    test('updates status from Parsing to Quotes Pending when vendors are assigned', () => {
      const rfqData = {
        rfqNumber: 'RFQ-PARSING-TEST',
        title: 'Parsing RFQ',
        status: 'Parsing',
        buyerEmail: 'buyer@example.com',
        sourcingMode: 'mode_1',
        assignedVendors: [{ id: 'v-dummy-1', name: 'Vendor 1' }],
        quotes: [],
      };

      const rfq = storeService.createRFQ(rfqData);
      expect(rfq.status).toBe('Quotes Pending');
    });

    test('handles category signal mismatch by auditing exclusion and shortlisting matching vendors', () => {
      const vMatch = {
        id: 'v-cat-match',
        name: 'Matching Vendor',
        majorCategory: 'Transformers',
      };
      const vMismatch = {
        id: 'v-cat-mismatch',
        name: 'Mismatch Vendor',
        majorCategory: 'Office Supplies',
      };
      storeService.vendors = [vMatch, vMismatch];

      const rfqData = {
        rfqNumber: 'RFQ-MISMATCH-AUDIT',
        title: 'Transformers RFQ',
        category: 'Transformers',
        buyerEmail: 'buyer@example.com',
        sourcingMode: 'mode_1',
        assignedVendors: [{ id: 'v-cat-match' }, { id: 'v-cat-mismatch' }],
        quotes: [],
      };

      const rfq = storeService.createRFQ(rfqData);
      expect(rfq.assignedVendors.some((v) => v.id === 'v-cat-match')).toBe(true);
      expect(rfq.assignedVendors.some((v) => v.id === 'v-cat-mismatch')).toBe(false);
      expect(storeService.auditLogs.some((a) => a.action.includes('due to category mismatch'))).toBe(true);
    });
  });

  describe('augmentV0AssignmentsFromDB deep branching', () => {
    test('returns immediately for non-v0 rfq or null rfq', async () => {
      expect(await storeService.augmentV0AssignmentsFromDB(null)).toBeNull();
      const nonV0 = { sourcingMode: 'mode_1' };
      expect(await storeService.augmentV0AssignmentsFromDB(nonV0)).toBe(nonV0);
    });

    test('handles empty category signals on V0 by setting needsCategoryManagerAssignment', async () => {
      const rfq = { sourcingMode: 'mode_0', category: null };
      const res = await storeService.augmentV0AssignmentsFromDB(rfq);
      expect(res.needsCategoryManagerAssignment).toBe(true);
      expect(res.assignedVendors).toEqual([]);
    });

    test('queries DB for public vendors matching categories and handles DB errors gracefully', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const rfq = {
        id: 'rfq-v0-db-test',
        rfqNumber: 'RFQ-V0-DB-TEST',
        sourcingMode: 'mode_0',
        category: 'Electrical Switchgear',
        deliveryPincode: '400001',
      };

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockRejectedValue(new Error('DB failure'));
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockRejectedValue(new Error('Fallback DB failure'));

      const res = await storeService.augmentV0AssignmentsFromDB(rfq);
      expect(res).toBeDefined();

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [
          { id: 'v-db-page-1', name: 'DB Vendor 1', pincode: '400001', rating: 4.5, source: 'procucev_network' },
          { id: 'v-db-page-2', name: 'DB Vendor 2', pincode: '110001', rating: 4.8, source: 'procucev_network' },
        ],
        total: 2,
      });

      jest.spyOn(storeService, 'selectVendorsPerCategory').mockReturnValue([]);

      const augmented = await storeService.augmentV0AssignmentsFromDB(rfq);
      expect(augmented.assignedVendors.length).toBe(2);
      expect(augmented.assignedVendors[0].id).toBe('v-db-page-1');
    });
  });

  describe('unlockRFQForVendor branch coverage', () => {
    test('returns notFound when vendor does not exist', async () => {
      const res = await storeService.unlockRFQForVendor('non-existent-vendor', 'RFQ-1');
      expect(res.notFound).toBe(true);
    });

    test('returns notFound when rfq does not exist', async () => {
      storeService.vendors = [{ id: 'v-unlock-1', email: 'v1@ex.com' }];
      const res = await storeService.unlockRFQForVendor('v-unlock-1', 'NON-EXISTENT-RFQ');
      expect(res.notFound).toBe(true);
    });

    test('returns unauthorized when vendor does not cover RFQ and RFQ is mode_1', async () => {
      const vendor = {
        id: 'v-unauth-1',
        email: 'unauth@ex.com',
        majorCategory: 'Catering',
      };
      const rfq = {
        id: 'rfq-unauth-1',
        rfqNumber: 'RFQ-UNAUTH-1',
        sourcingMode: 'mode_1',
        category: 'Heavy Machinery',
        assignedVendors: [],
        quotes: [],
      };
      storeService.vendors = [vendor];
      storeService.rfqs = [rfq];

      const res = await storeService.unlockRFQForVendor(vendor.id, rfq.id);
      expect(res.unauthorized).toBe(true);
    });

    test('returns alreadyUnlocked when RFQ id is already in vendor unlockedRfqIds', async () => {
      const vendor = {
        id: 'v-already-1',
        email: 'already@ex.com',
        unlockedRfqIds: ['rfq-already-1'],
        freeQuotationCredits: 5,
      };
      const rfq = {
        id: 'rfq-already-1',
        rfqNumber: 'RFQ-ALREADY-1',
        sourcingMode: 'mode_0',
        category: 'All',
        quotes: [],
      };
      storeService.vendors = [vendor];
      storeService.rfqs = [rfq];

      const res = await storeService.unlockRFQForVendor(vendor.id, rfq.id);
      expect(res.alreadyUnlocked).toBe(true);
      expect(res.creditCharged).toBe(0);
    });

    test('unlocks without charging credits for direct-mapped, subscribed, or unlimited vendors', async () => {
      const vendor = {
        id: 'v-sub-1',
        email: 'sub@ex.com',
        subscriptionPlan: 'select',
        unlockedRfqIds: [],
      };
      const rfq = {
        id: 'rfq-sub-1',
        rfqNumber: 'RFQ-SUB-1',
        sourcingMode: 'mode_0',
        quotes: [],
      };
      storeService.vendors = [vendor];
      storeService.rfqs = [rfq];

      const dbUnlockSpy = jest.spyOn(domainQueries, 'unlockRFQInDB').mockResolvedValue(true);

      const res = await storeService.unlockRFQForVendor(vendor.id, rfq.id);
      expect(res.success).toBe(true);
      expect(res.creditCharged).toBe(0);
      expect(dbUnlockSpy).toHaveBeenCalled();
    });

    test('consumes a free credit when vendor is on free allowance', async () => {
      const vendor = {
        id: 'v-free-1',
        email: 'free@ex.com',
        freeQuotationCredits: 3,
        unlockedRfqIds: [],
      };
      const rfq = {
        id: 'rfq-free-1',
        rfqNumber: 'RFQ-FREE-1',
        sourcingMode: 'mode_0',
        quotes: [],
      };
      storeService.vendors = [vendor];
      storeService.rfqs = [rfq];

      jest.spyOn(domainQueries, 'unlockRFQInDB').mockResolvedValue(true);

      const res = await storeService.unlockRFQForVendor(vendor.id, rfq.id);
      expect(res.success).toBe(true);
      expect(res.creditCharged).toBe(1);
      expect(res.freeCreditsRemaining).toBe(2);
    });

    test('blocks download when free credits are exhausted and vendor is not subscribed', async () => {
      const vendor = {
        id: 'v-exhausted-1',
        email: 'exh@ex.com',
        freeQuotationCredits: 0,
        unlockedRfqIds: [],
      };
      const rfq = {
        id: 'rfq-exh-1',
        rfqNumber: 'RFQ-EXH-1',
        sourcingMode: 'mode_0',
        quotes: [],
      };
      storeService.vendors = [vendor];
      storeService.rfqs = [rfq];

      const res = await storeService.unlockRFQForVendor(vendor.id, rfq.id);
      expect(res.success).toBe(false);
      expect(res.creditsExhausted).toBe(true);
    });
  });

  describe('processHistoricalPurchaseData branch coverage', () => {
    test('skips rows missing companyName or email with exact reasons', async () => {
      const rows = [
        { companyName: '', email: '' },
        { companyName: '', email: 'has-email@ex.com' },
        { companyName: 'Has Company', email: '' },
      ];

      const res = await storeService.processHistoricalPurchaseData('2025_Q4', rows);
      expect(res.skipped.length).toBe(3);
      expect(res.skipped[0].reason).toContain('both company name and contact email');
      expect(res.skipped[1].reason).toContain('company name');
      expect(res.skipped[2].reason).toContain('contact email');
    });

    test('loads custom dispatch templates from buyer profile and applies overrides', async () => {
      const buyer = { id: 'buyer-hist-1', corporateEmail: 'hist@buyer.com', organizationName: 'Hist Enterprise' };
      jest.spyOn(identityQueries, 'findUserByEmail').mockImplementation(async (email) => {
        if (email === buyer.corporateEmail) return { id: 'u-b-1', orgId: 'org-b-1' };
        return null;
      });
      jest.spyOn(buyerProfileQueries, 'getDispatchTemplates').mockResolvedValue({
        category_mapped: { subject: 'Custom Subject A', message: 'Custom Msg A' },
        self_map_required: { subject: 'Custom Subject B', message: 'Custom Msg B' },
      });
      jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });

      const rows = [
        { companyName: 'Mapped Co', email: 'map@ex.com', majorCategory: 'Pumps', categoriesMappedByBuyer: true },
        { companyName: 'Unmapped Co', email: 'unmap@ex.com', majorCategory: 'Uncategorized', categoriesMappedByBuyer: false },
      ];

      const res = await storeService.processHistoricalPurchaseData('2025_Q4', rows, buyer);
      expect(res.importedCount).toBe(2);
      expect(res.mappedEmailsSent).toBe(1);
      expect(res.unmappedEmailsSent).toBe(1);
    });

    test('updates existing vendor in memory and handles duplicate sent emails', async () => {
      const existingVendor = {
        id: 'v-hist-existing',
        name: 'Old Vendor Name',
        email: 'exist@vendor.com',
        onboardingEmailStatus: 'sent',
      };
      storeService.vendors = [existingVendor];

      const rows = [
        {
          companyName: 'New Vendor Name',
          email: 'exist@vendor.com',
          contactPerson: 'Jane Doe',
          phone: '9876543210',
          location: 'Mumbai, MH',
          rating: 4.8,
          score: 92,
        },
      ];

      const res = await storeService.processHistoricalPurchaseData('2025_Q4', rows);
      expect(res.importedCount).toBe(1);
      expect(existingVendor.name).toBe('New Vendor Name');
      expect(existingVendor.contactPerson).toBe('Jane Doe');
      expect(existingVendor.location).toBe('Mumbai, MH');
    });

    test('records failed email when recipient address has invalid format or send throws', async () => {
      jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockRejectedValue(new Error('SMTP connection timed out'));

      const rows = [
        { companyName: 'Bad Email Co', email: 'not-an-email-address' },
        { companyName: 'Throw Email Co', email: 'throw@example.com' },
      ];

      const res = await storeService.processHistoricalPurchaseData('2025_Q4', rows);
      expect(res.failedEmails.length).toBe(2);
      expect(res.failedEmails[0].reason).toContain('Invalid email address format');
      expect(res.failedEmails[1].reason).toContain('SMTP connection timed out');
    });

    test('rolls back vendor when confirmVendorPersisted throws with 409 conflict', async () => {
      const error409 = new Error('Email conflict');
      error409.statusCode = 409;
      jest.spyOn(storeService, 'confirmVendorPersisted').mockRejectedValue(error409);

      const rows = [
        { companyName: 'Conflict Co', email: 'conflict@example.com', majorCategory: 'Pumps' },
      ];

      const res = await storeService.processHistoricalPurchaseData('2025_Q4', rows);
      expect(res.importedCount).toBe(0);
      expect(res.skipped.length).toBe(1);
      expect(res.skipped[0].reason).toContain('already exists');
    });
  });

  describe('approvePurchaseOrder & Inquiries', () => {
    test('approvePurchaseOrder returns null when RFQ does not exist', () => {
      expect(storeService.approvePurchaseOrder('NON-EXISTENT-RFQ', 'v-1', 'Vendor 1', 50000)).toBeNull();
    });

    test('approvePurchaseOrder returns alreadyFinalised when RFQ is already finalised', () => {
      const rfq = {
        id: 'rfq-po-fin',
        rfqNumber: 'RFQ-PO-FIN',
        status: 'PO Generated',
        poFinalised: true,
        poNumber: 'PO-2026-FIN',
        poIssueDate: '2026-03-01',
        extractedEntities: [{ itemName: 'Centrifugal Pump', quantity: 2, unit: 'units' }],
        quotes: [],
      };
      storeService.rfqs = [rfq];

      const res = storeService.approvePurchaseOrder('RFQ-PO-FIN', 'v-1', 'Vendor 1', 50000);
      expect(res.alreadyFinalised).toBe(true);
      expect(res.lineItems.length).toBe(1);
      expect(res.lineItems[0].description).toBe('Centrifugal Pump');
    });

    test('approvePurchaseOrder marks quote as Awarded, records audit, and notifies buyer and vendor', () => {
      const rfq = {
        id: 'rfq-po-new',
        rfqNumber: 'RFQ-PO-NEW',
        status: 'Quotes Received',
        quotes: [
          { vendorId: 'v-winner', vendorName: 'Winner Co', totalAmount: 75000, status: 'Submitted' },
          { vendorId: 'v-loser', vendorName: 'Loser Co', totalAmount: 95000, status: 'Submitted' },
        ],
        buyerAccountId: 'buyer-po-1',
      };
      storeService.rfqs = [rfq];

      const res = storeService.approvePurchaseOrder('RFQ-PO-NEW', 'v-winner', 'Winner Co', 75000, 'Best technical score', 'approver@buyer.com');
      expect(res).toBeDefined();
      expect(rfq.status).toBe('PO Generated');
      expect(rfq.quotes[0].awarded).toBe(true);
      expect(rfq.quotes[0].status).toBe('Awarded');
      expect(rfq.quotes[1].awarded).toBe(false);
      expect(storeService.notifications.some((n) => n.kind === 'po_approved')).toBe(true);
      expect(storeService.notifications.some((n) => n.recipientType === 'vendor' && n.recipientId === 'v-winner')).toBe(true);
    });

    test('addInquiryToRFQ creates new thread, audits, and notifies buyer', () => {
      const rfq = {
        id: 'rfq-inq-1',
        rfqNumber: 'RFQ-INQ-1',
        buyerAccountId: 'buyer-inq-1',
        inquiries: [],
        quotes: [],
      };
      storeService.rfqs = [rfq];

      const res = storeService.addInquiryToRFQ('rfq-inq-1', {
        vendorId: 'v-inq-1',
        vendorName: 'Inquiring Vendor',
        vendorEmail: 'inq@vendor.com',
        message: 'Can delivery be extended to 3 weeks?',
      });

      expect(res.inquiry).toBeDefined();
      expect(res.inquiry.status).toBe('open');
      expect(res.updatedRfq.inquiries.length).toBe(1);
      expect(storeService.notifications.some((n) => n.kind === 'vendor_inquiry')).toBe(true);

      const res2 = storeService.addInquiryToRFQ('rfq-inq-1', {
        vendorId: 'v-inq-1',
        vendorName: 'Inquiring Vendor',
        vendorEmail: 'inq@vendor.com',
        message: 'Also, does the pump require ATEX certification?',
      });
      expect(res2.updatedRfq.inquiries[0].messages.length).toBe(2);
    });

    test('replyToRFQInquiry answers thread, adds feed item and updates audit', () => {
      const rfq = {
        id: 'rfq-reply-1',
        rfqNumber: 'RFQ-REPLY-1',
        quotes: [],
        inquiries: [
          {
            id: 'inq-thread-1',
            vendorId: 'v-inq-2',
            vendorName: 'Vendor 2',
            vendorEmail: 'v2@vendor.com',
            message: 'What is the warranty period?',
            messages: [{ id: 'msg-1', message: 'What is the warranty period?' }],
          },
        ],
      };
      storeService.rfqs = [rfq];

      expect(storeService.replyToRFQInquiry('non-existent', 'inq-thread-1', {})).toBeNull();
      expect(storeService.replyToRFQInquiry('rfq-reply-1', 'non-existent-inq', {})).toBeNull();

      const res = storeService.replyToRFQInquiry('rfq-reply-1', 'inq-thread-1', {
        reply: 'Standard warranty is 18 months from commissioning.',
        repliedBy: 'Chief Engineer',
        repliedByEmail: 'engineer@buyer.com',
      });

      expect(res.inquiry.status).toBe('answered');
      expect(res.inquiry.reply).toContain('18 months');
      expect(res.inquiry.messages.length).toBe(2);
      expect(storeService.aiFeed.some((f) => f.title.includes('Clarification Answered'))).toBe(true);
    });
  });

  describe('inviteVendorsToRFQ and extendRFQ branches', () => {
    test('inviteVendorsToRFQ excludes private vendors of different buyer, handles category override and loads DB vendors', async () => {
      const rfq = {
        id: 'rfq-invite-test',
        rfqNumber: 'RFQ-INVITE-TEST',
        buyerAccountId: 'buyer-owner-1',
        category: 'Mechanical Valves',
        status: 'Parsing',
        assignedVendors: [],
        quotes: [],
      };
      storeService.rfqs = [rfq];

      const privateOtherBuyer = {
        id: 'v-priv-other',
        name: 'Private Other',
        buyerId: 'buyer-other-99',
      };
      const publicVendorMismatch = {
        id: 'v-override-pub',
        name: 'Public Mismatch Vendor',
        majorCategory: 'Packaging',
      };

      storeService.vendors = [privateOtherBuyer];

      jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(publicVendorMismatch);

      const res = await storeService.inviteVendorsToRFQ(rfq.id, ['v-priv-other', 'v-override-pub'], 'cm@procucev.ai');
      expect(res.invitedCount).toBe(1);
      expect(res.excludedCount).toBe(1);
      expect(res.updatedRFQ.status).toBe('Quotes Pending');
      expect(res.updatedRFQ.assignedVendors.some((v) => v.id === 'v-override-pub')).toBe(true);
    });

    test('extendRFQ validations and date computation branches', () => {
      expect(storeService.extendRFQ('non-existent')).toEqual(
        expect.objectContaining({ success: false, reason: 'NOT_FOUND' })
      );

      const closedRfq = { id: 'rfq-closed-ext', status: 'Closed', quotes: [] };
      storeService.rfqs = [closedRfq];
      expect(storeService.extendRFQ('rfq-closed-ext', { hours: 24 })).toEqual(
        expect.objectContaining({ success: false, reason: 'INVALID_STATUS' })
      );

      const alreadyExtendedRfq = { id: 'rfq-already-ext', status: 'Quotes Pending', isExtended: true, quotes: [] };
      storeService.rfqs = [alreadyExtendedRfq];
      expect(storeService.extendRFQ('rfq-already-ext', { hours: 24 })).toEqual(
        expect.objectContaining({ success: false, reason: 'ALREADY_EXTENDED' })
      );

      const validRfq = {
        id: 'rfq-valid-ext',
        status: 'Quotes Pending',
        deadline: new Date(Date.now() + 86400000).toISOString(),
        quotes: [],
      };
      storeService.rfqs = [validRfq];

      expect(storeService.extendRFQ('rfq-valid-ext', { hours: 12 })).toEqual(
        expect.objectContaining({ success: false, reason: 'VALIDATION' })
      );

      const res24 = storeService.extendRFQ('rfq-valid-ext', { hours: 24, userEmail: 'buyer@ext.com' });
      expect(res24.success).toBe(true);
      expect(res24.rfq.isExtended).toBe(true);
      expect(res24.rfq.extensionHours).toBe(24);
    });
  });

  describe('Delayed quote timers, closure notifications, and multi-channel outreach', () => {
    test('getRemaining48HourMs and scheduleDelayedBuyerQuoteEmail', () => {
      expect(storeService.getRemaining48HourMs(null)).toBe(48 * 3600 * 1000);
      expect(storeService.getRemaining48HourMs({ createdAt: 'invalid-date' })).toBe(48 * 3600 * 1000);

      const recentRfq = { id: 'rfq-timer-1', rfqNumber: 'RFQ-TIMER-1', createdAt: new Date().toISOString(), quotes: [] };
      expect(storeService.getRemaining48HourMs(recentRfq)).toBeGreaterThan(0);

      const pastRfq = { id: 'rfq-past-1', createdAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString(), quotes: [] };
      expect(storeService.getRemaining48HourMs(pastRfq)).toBe(0);

      const buyer = { corporateEmail: 'timer@buyer.com', organizationName: 'Timer Buyer' };
      const quote = { vendorName: 'Timer Vendor', totalAmount: 10000 };

      storeService.scheduleDelayedBuyerQuoteEmail(recentRfq, quote, buyer, 1000);
      expect(storeService._delayedQuoteTimers.has('rfq-timer-1')).toBe(true);

      // deleteRFQ clears delayed timers
      storeService.rfqs = [recentRfq];
      storeService.deleteRFQ('rfq-timer-1');
      expect(storeService._delayedQuoteTimers.has('rfq-timer-1')).toBe(false);

      // reset() clears all delayed timers via lines 130-133
      storeService.scheduleDelayedBuyerQuoteEmail(recentRfq, quote, buyer, 1000);
      storeService.reset();
      expect(storeService._delayedQuoteTimers.size).toBe(0);
    });

    test('notifyOfRFQClosure clears timers and dispatches comparison email/SMS', async () => {
      const rfq = {
        id: 'rfq-closure-1',
        rfqNumber: 'RFQ-CLOSURE-1',
        buyerAccountId: 'buyer-close-1',
        buyerEmail: 'close@buyer.com',
        buyerPhone: '9876543210',
        quotes: [{ totalAmount: 50000 }],
      };
      storeService.rfqs = [rfq];

      const sendEmailSpy = jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockRejectedValue(new Error('Email failed'));
      const sendSmsSpy = jest.spyOn(smsService, 'sendBuyerComparisonSms').mockRejectedValue(new Error('SMS failed'));

      storeService._delayedQuoteTimers = new Map([['rfq-closure-1', [setTimeout(() => {}, 5000)]]]);

      storeService.notifyOfRFQClosure(rfq);
      await new Promise((resolve) => setImmediate(resolve));

      expect(storeService._delayedQuoteTimers.has('rfq-closure-1')).toBe(false);
      expect(sendEmailSpy).toHaveBeenCalled();
      expect(sendSmsSpy).toHaveBeenCalled();
    });

    test('selectVendorsForRFQEmail handles more than 3 distinct category signals', () => {
      const rfq = {
        category: 'Pumps',
        extractedEntities: [
          { category: 'Valves' },
          { category: 'Electric Motors' },
          { category: 'Automation Controls' },
        ],
        deliveryPincode: '400001',
        assignedVendors: [
          { id: 'v-sig-1' },
          { id: 'v-sig-2' },
          { id: 'v-sig-3' },
          { id: 'v-sig-4' },
        ],
      };
      const v1 = { id: 'v-sig-1', email: 'v1@ex.com', majorCategory: 'Pumps', pincode: '400001', rating: 4.5, subscriptionPlan: 'select' };
      const v2 = { id: 'v-sig-2', email: 'v2@ex.com', majorCategory: 'Valves', rating: 4.0, subscriptionPlan: 'connect' };
      const v3 = { id: 'v-sig-3', email: 'v3@ex.com', majorCategory: 'Electric Motors', rating: 4.2 };
      const v4 = { id: 'v-sig-4', email: 'v4@ex.com', majorCategory: 'Automation Controls', rating: 4.8 };
      storeService.vendors = [v1, v2, v3, v4];

      const selected = storeService.selectVendorsForRFQEmail(rfq, 10);
      expect(selected.length).toBeGreaterThanOrEqual(1);
    });

    test('triggerBatchChaser executes whatsapp and sms outreach in background', async () => {
      const rfq = {
        id: 'rfq-outreach-1',
        rfqNumber: 'RFQ-OUTREACH-1',
        title: 'Chaser RFQ',
        assignedVendors: [
          {
            id: 'v-outreach-1',
            name: 'Outreach Vendor',
            email: 'outreach@vendor.com',
            phone: '9876543210',
          },
        ],
        quotes: [],
      };
      storeService.rfqs = [rfq];

      const waSpy = jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: true, messageId: 'wa-123' });
      const smsSpy = jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: true, messageId: 'sms-123' });

      const res = storeService.triggerBatchChaser('rfq-outreach-1', ['whatsapp', 'sms']);
      expect(res.success).toBe(true);
      expect(waSpy).toHaveBeenCalled();
      expect(smsSpy).toHaveBeenCalled();
    });
  });

  describe('getBootstrapData, syncRFQsFromDB, and vendor credits', () => {
    test('getBootstrapData with pool.hasStorage and scoped buyer vs public', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      jest.spyOn(domainQueries, 'getVendorsByBuyerFromDB').mockResolvedValue([
        { id: 'v-own-1', name: 'Own Vendor', buyerId: 'buyer-boot-1' },
      ]);
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-pub-1', name: 'Public Vendor' }],
        total: 1,
      });
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue({
        id: 'v-session-1',
        email: 'session@vendor.com',
      });

      const data = await storeService.getBootstrapData('buyer-boot-1', 'session@vendor.com');
      expect(data.vendors.length).toBeGreaterThanOrEqual(2);
      expect(data.vendorsTotal).toBeGreaterThanOrEqual(2);
    });

    test('getBootstrapData in-memory with array scopedBuyerId and session catalogue filter', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      const ownVendor = { id: 'v-cat-owner', email: 'owner@vendor.com', buyerId: 'buyer-arr-1' };
      storeService.vendors = [ownVendor];
      storeService.vendorCatalogue = [
        { id: 'prod-1', vendorId: 'v-cat-owner', name: 'Hydraulic Cylinder' },
        { id: 'prod-2', vendorId: 'other-vendor', name: 'Gasket' },
      ];

      const data = await storeService.getBootstrapData(['buyer-arr-1'], 'owner@vendor.com');
      expect(data.vendorCatalogue.length).toBe(1);
      expect(data.vendorCatalogue[0].name).toBe('Hydraulic Cylinder');
    });

    test('getVendorRfqCredits variations and calculations', () => {
      expect(storeService.getVendorRfqCredits('missing-vendor').isSubscribed).toBe(false);

      const vSelect = { id: 'v-select-1', subscriptionPlan: 'select' };
      const vConnect = { id: 'v-connect-1', subscriptionPlan: 'connect' };
      const vActive = { id: 'v-active-1', subscriptionStatus: 'active' };
      const vUnlimited = { id: 'v-unlim-1', email: 'admin@unlimited.com' };
      storeService.vendors = [vSelect, vConnect, vActive, vUnlimited];

      expect(storeService.getVendorRfqCredits('v-select-1').isSubscribed).toBe(true);
      expect(storeService.getVendorRfqCredits('v-connect-1').isSubscribed).toBe(true);
      expect(storeService.getVendorRfqCredits('v-active-1').isSubscribed).toBe(true);
    });

    test('syncRFQsFromDB returns existing promise when sync is in progress', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      storeService._syncRFQsPromise = Promise.resolve([{ id: 'rfq-sync-1' }]);
      const res = await storeService.syncRFQsFromDB(false);
      expect(res).toEqual([{ id: 'rfq-sync-1' }]);
      storeService._syncRFQsPromise = null;
    });

    test('syncRFQsFromDB normalizes PO Generated and ai_extraction source', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      storeService._syncRFQsPromise = null;
      storeService._lastRfqSyncTime = 0;
      storeService._lastRfqSyncMap = new Map();
      jest.spyOn(domainQueries, 'getRFQsFromDB').mockResolvedValue([
        { id: 'rfq-norm-1', status: 'Closed', poFinalised: true, createdAt: new Date().toISOString(), quotes: [] },
        { id: 'rfq-norm-2', source: 'ai_extraction', sourceFileName: null, createdAt: new Date().toISOString(), quotes: [] },
      ]);

      const rfqs = await storeService.syncRFQsFromDB(true);
      const r1 = rfqs.find((r) => r.id === 'rfq-norm-1');
      const r2 = rfqs.find((r) => r.id === 'rfq-norm-2');
      expect(r1.status).toBe('PO Generated');
      expect(r2.source).toBe('manual_entry');
    });

    test('provisionVendorOnboarding failure and skipEmail paths', async () => {
      const vendor = { id: 'v-onb-1', email: 'onb@vendor.com', name: 'Onb Co' };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: true });

      // skipEmail true
      const resSkip = await storeService.provisionVendorOnboarding(vendor, 'cm@procucev.ai', { skipEmail: true });
      expect(resSkip.status).toBe('skipped');

      // identity verification throws
      const throwVendor = { id: 'v-throw-1', email: 'throw@vendor.com', name: 'Throw Co' };
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValue(new Error('DB err'));
      const resFail = await storeService.provisionVendorOnboarding(throwVendor, 'cm@procucev.ai', { skipEmail: false });
      expect(resFail.status).toBe('failed');
    });

    test('getAIFeed and getEvaluations limit slicing', () => {
      storeService.aiFeed = [{ id: 'f-1' }, { id: 'f-2' }, { id: 'f-3' }];
      expect(storeService.getAIFeed(2).length).toBe(2);
      expect(storeService.getAIFeed().length).toBe(3);

      storeService.evaluations = [{ id: 'e-1' }, { id: 'e-2' }, { id: 'e-3' }];
      expect(storeService.getEvaluations(1).length).toBe(1);
      expect(storeService.getEvaluations().length).toBe(3);

      storeService.vendorCatalogue = [{ id: 'prod-1' }];
      expect(storeService.getCatalogueProductById('prod-1')).toBeDefined();
    });

    test('hydrateFromDB normalizes records and cleans currency symbol', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({ rows: [{ id: 'v-1' }], total: 1 });
      jest.spyOn(domainQueries, 'getRFQsFromDB').mockResolvedValue([
        { id: 'rfq-p-1', status: 'Closed', poNumber: 'PO-123', quotes: [] },
        { id: 'rfq-p-2', source: 'ai_extraction', sourceFileName: null, quotes: [] },
      ]);
      jest.spyOn(domainQueries, 'getEvaluationsFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getVendorCatalogueFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getAIFeedFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getAuditLogsFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getNotificationsFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getPaymentLinksFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockResolvedValue({
        accounts: [
          { id: 'b-curr-1', corporateEmail: 'curr@b.com', totalSpend: '$50,000' },
        ],
        activeAccountId: 'b-curr-1',
      });

      await storeService.hydrateFromDB();
      expect(storeService.rfqs[0].status).toBe('PO Generated');
      expect(storeService.rfqs[1].source).toBe('manual_entry');
      expect(storeService.buyerAccounts[0].totalSpend).toContain('₹');
    });

    test('getVendorById with array scopedBuyerId matches array elements', () => {
      const vendor = { id: 'v-arr-match', buyerId: 'buyer-two' };
      storeService.vendors = [vendor];

      expect(storeService.getVendorById('v-arr-match', ['buyer-one', 'buyer-two'])).toBe(vendor);
      expect(storeService.getVendorById('v-arr-match', ['buyer-three'])).toBeUndefined();
    });

    test('deleteVendor logs no email on record when target has no email', () => {
      storeService.vendors = [{ id: 'v-no-email', name: 'No Email Co' }];
      const res = storeService.deleteVendor('v-no-email');
      expect(res).toBe(true);
      expect(storeService.auditLogs.some((l) => l.action.includes('no email on record'))).toBe(true);
    });

    test('consumeVendorQuotationCredit fallback vendor ID and null RFQ ID', () => {
      const vendor = { id: 'v-anon-cred', freeQuotationCredits: 3, unlockedRfqIds: [] };
      storeService.vendors = [vendor];

      const updated = storeService.consumeVendorQuotationCredit('v-anon-cred', null);
      expect(updated.freeQuotationCredits).toBe(2);
    });

    test('getRFQs normalizes item poNumber Closed status and handles quotes evaluation', () => {
      storeService.rfqs = [
        { id: 'rfq-item-1', status: 'Closed', poNumber: 'PO-999', quotes: [] },
        { id: 'rfq-item-2', source: 'ai_extraction', sourceFileName: null, quotes: null },
      ];

      const list = storeService.getRFQs();
      expect(list[0].status).toBe('PO Generated');
      expect(list[1].source).toBe('manual_entry');
      expect(list[1].quotes).toBeNull();
    });

    test('_rfqDistinctCategories extracts minorCategory when no major category exists', () => {
      const rfq = {
        category: null,
        extractedEntities: [
          { minorCategory: 'Ball Valves' },
          { minorCategory: '   ' },
          { minorCategory: null },
        ],
      };
      const cats = storeService._rfqDistinctCategories(rfq);
      expect(cats).toEqual(['Ball Valves']);
    });

    test('emailQuoteToBuyer handles false guards and reminder dispatch paths', () => {
      expect(storeService.emailQuoteToBuyer(null, {})).toBe(false);
      expect(storeService.emailQuoteToBuyer({ id: 'rfq-no-buyer' }, {})).toBe(false);

      const rfq = {
        id: 'rfq-eq-1',
        rfqNumber: 'RFQ-EQ-1',
        buyerEmail: 'unreg@buyer.com',
        buyerAccountName: 'Unregistered Co',
      };
      const quote = { vendorName: 'Quote Vendor', totalAmount: 25000 };

      // Normal unsealed quote email dispatch
      const mailSpy = jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue({ sent: true });
      const reminderSpy = jest.spyOn(mailerService, 'sendBuyerProfileCompletionReminderEmail').mockResolvedValue({ sent: true });

      expect(storeService.emailQuoteToBuyer(rfq, quote)).toBe(true);
      expect(mailSpy).toHaveBeenCalled();

      // When buyer profile update is required
      jest.spyOn(storeService, 'isBuyerProfileUpdateRequired').mockReturnValue(true);
      expect(storeService.emailQuoteToBuyer(rfq, quote)).toBe(true);
      expect(reminderSpy).toHaveBeenCalled();
    });

    test('triggerBatchChaser handles failed result with and without error detail', async () => {
      const rfq = {
        id: 'rfq-fail-chase',
        rfqNumber: 'RFQ-FAIL-CHASE',
        title: 'Chaser Fail RFQ',
        assignedVendors: [
          { id: 'v-chase-fail', name: 'Fail Vendor', phone: '9876543210', email: 'fail@v.com' },
        ],
        quotes: [],
      };
      storeService.rfqs = [rfq];

      jest.spyOn(whatsAppService, 'sendRFQInvitationWhatsApp').mockResolvedValue({ success: false, error: 'Network timeout' });
      jest.spyOn(smsService, 'sendRFQChaserSms').mockResolvedValue({ success: false });

      const res = storeService.triggerBatchChaser('rfq-fail-chase', ['whatsapp', 'sms']);
      expect(res.success).toBe(true);
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  describe('Deep branch coverage expansion part 2', () => {
    test('loadPersistedInquiries and savePersistedInquiries file persistence and catch blocks', () => {
      const dir = require('path').dirname(INQUIRIES_PERSISTENCE_FILE);
      const existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((p) => {
        if (p === INQUIRIES_PERSISTENCE_FILE) return true;
        if (p === dir) return false;
        return true;
      });
      const readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify([{ id: 'inq-saved-file', companyName: 'File Co' }]));
      const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
      const writeSpy = jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

      storeService.enterpriseInquiries = null;
      const inqs = storeService.getEnterpriseInquiries();
      expect(inqs.some((i) => i.id === 'inq-saved-file')).toBe(true);

      // savePersistedInquiries triggers mkdirSync when dir does not exist
      storeService.addEnterpriseInquiry({ companyName: 'New Co', email: 'nc@ex.com' });
      expect(mkdirSpy).toHaveBeenCalledWith(dir, { recursive: true });
      expect(writeSpy).toHaveBeenCalled();

      // updateEnterpriseInquiry initializes via loadPersistedInquiries when enterpriseInquiries is null
      storeService.enterpriseInquiries = null;
      const updated = storeService.updateEnterpriseInquiry('inq-saved-file', { status: 'CLOSED' });
      expect(updated.status).toBe('CLOSED');

      // Catch block when fs.existsSync throws
      existsSpy.mockImplementation(() => {
        throw new Error('FS failure');
      });
      storeService.enterpriseInquiries = null;
      const fallback = storeService.getEnterpriseInquiries();
      expect(fallback.length).toBeGreaterThan(0);
      expect(() => storeService.addEnterpriseInquiry({ companyName: 'Throw Co' })).not.toThrow();

      existsSpy.mockRestore();
      readSpy.mockRestore();
      mkdirSpy.mockRestore();
      writeSpy.mockRestore();
    });

    test('getBuyerAccountByEmail with pool.hasStorage branches', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const freshAccount = { id: 'buyer-fresh-1', corporateEmail: 'fresh@corp.com', organizationName: 'Fresh Corp' };
      const getBuyerSpy = jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue(freshAccount);

      // 1. Account not in this.buyerAccounts (idx === -1)
      storeService.buyerAccounts = [];
      storeService.activeBuyerAccount = { id: 'other-active' };
      const res1 = await storeService.getBuyerAccountByEmail('fresh@corp.com');
      expect(res1.id).toBe('buyer-fresh-1');
      expect(storeService.buyerAccounts[0].id).toBe('buyer-fresh-1');

      // 2. Account already in this.buyerAccounts (idx !== -1) and matches activeBuyerAccount
      storeService.activeBuyerAccount = { id: 'buyer-fresh-1', corporateEmail: 'fresh@corp.com' };
      const updatedFresh = { ...freshAccount, organizationName: 'Fresh Corp Updated' };
      getBuyerSpy.mockResolvedValue(updatedFresh);

      const res2 = await storeService.getBuyerAccountByEmail('fresh@corp.com');
      expect(res2.organizationName).toBe('Fresh Corp Updated');
      expect(storeService.activeBuyerAccount.organizationName).toBe('Fresh Corp Updated');

      // 3. fresh is null -> falls back to memory search
      getBuyerSpy.mockResolvedValue(null);
      const res3 = await storeService.getBuyerAccountByEmail('fresh@corp.com');
      expect(res3).toBeDefined();

      // 4. DB throws error -> caught and falls back to memory search
      getBuyerSpy.mockRejectedValue(new Error('DB timeout'));
      const res4 = await storeService.getBuyerAccountByEmail('fresh@corp.com');
      expect(res4).toBeDefined();
    });

    test('tryConsumeFreeRFQ and consumeRFQCreditIfApplicable unlimited accounts branches', () => {
      // 1. tryConsumeFreeRFQ with unlimited buyer account
      const unlimitedBuyerWithRemaining = {
        id: 'buyer-unlim-1',
        corporateEmail: 'admin@unlimited.com',
        subscriptionPlan: 'unlimited',
        remainingFreeRFQs: 42,
      };
      const unlimitedBuyerWithoutRemaining = {
        id: 'buyer-unlim-2',
        corporateEmail: 'super@unlimited.com',
        subscriptionPlan: 'unlimited',
      };
      storeService.buyerAccounts = [unlimitedBuyerWithRemaining, unlimitedBuyerWithoutRemaining];

      const res1 = storeService.tryConsumeFreeRFQ('buyer-unlim-1');
      expect(res1).toEqual({ ok: true, remaining: 42 });

      const res2 = storeService.tryConsumeFreeRFQ('buyer-unlim-2');
      expect(res2).toEqual({ ok: true, remaining: 999999 });

      // 2. consumeRFQCreditIfApplicable with unlimited buyer account
      const creditRes1 = storeService.consumeRFQCreditIfApplicable(unlimitedBuyerWithRemaining, 'mode_1');
      expect(creditRes1).toEqual({ consumed: false, remaining: 42 });

      const creditRes2 = storeService.consumeRFQCreditIfApplicable(unlimitedBuyerWithoutRemaining, 'mode_1');
      expect(creditRes2).toEqual({ consumed: false, remaining: null });
    });

    test('provisionVendorOnboarding account_exists and mailer throw branches', async () => {
      const vendor = { id: 'v-prov-1', email: 'prov@vendor.com', name: 'Prov Vendor' };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);

      // identityQueries.insertVendorAccount returns { created: false }
      jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: false });
      const resExists = await storeService.provisionVendorOnboarding(vendor, 'cm@procucev.ai');
      expect(resExists.status).toBe('account_exists');

      // mailerService.sendVendorIngestionEmail throws error
      jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({ created: true });
      jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockRejectedValue(new Error('SMTP connection refused'));

      const resThrow = await storeService.provisionVendorOnboarding(vendor, 'cm@procucev.ai');
      expect(resThrow.status).toBe('failed');
      expect(resThrow.error).toContain('could not be delivered');
    });

    test('bulkAddVendors duplicate vendorCode and provisionVendorOnboarding throw', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const buyerAccount = { id: 'buyer-bulk-1', corporateEmail: 'buyer@corp.com' };
      storeService.buyerAccounts = [buyerAccount];
      storeService.vendors = [];

      jest.spyOn(domainQueries, 'bulkInsertVendorsInDB').mockResolvedValue(['throw@example.com']);
      jest.spyOn(identityQueries, 'findExistingUsernames').mockResolvedValue(new Set());

      const rows = [
        {
          rowNumber: 1,
          vendorCode: 'VC-DUP-01',
          companyName: 'Vendor Dup 1',
          email: 'dup1@example.com',
          contactPerson: 'John',
          phone: '9876543210',
          location: 'Delhi',
          majorCategory: 'Pumps',
        },
        {
          rowNumber: 2,
          vendorCode: 'VC-DUP-01',
          companyName: 'Vendor Dup 2',
          email: 'dup2@example.com',
          contactPerson: 'Jane',
          phone: '9876543211',
          location: 'Mumbai',
          majorCategory: 'Valves',
        },
        {
          rowNumber: 3,
          vendorCode: 'VC-THROW-01',
          companyName: 'Vendor Throw',
          email: 'throw@example.com',
          contactPerson: 'Bob',
          phone: '9876543212',
          location: 'Pune',
          majorCategory: 'Motors',
        },
      ];

      // Make provisionVendorOnboarding throw on row 3
      jest.spyOn(storeService, 'provisionVendorOnboarding').mockImplementation(async (v) => {
        if (v.email === 'throw@example.com') {
          throw new Error('Onboarding fatal error');
        }
        return { status: 'sent' };
      });

      const res = await storeService.bulkAddVendors(rows);
      expect(res.results.some((r) => r.status === 'duplicate' && r.reason.includes('Duplicate Vendor Code'))).toBe(true);
      const throwItem = res.results.find((r) => r.email === 'throw@example.com');
      expect(throwItem).toBeDefined();
      expect(throwItem.onboardingEmailStatus).toBe('failed');
    });

    test('isRfqUnlockedForVendor unlimited download access', () => {
      const vendorUnlimited = { id: 'v-unlim-dl', email: 'download@unlimited.com', unlimitedDownloads: true };
      storeService.vendors = [vendorUnlimited];
      expect(storeService.isRfqUnlockedForVendor('v-unlim-dl', 'RFQ-ANY-1')).toBe(true);
    });

    test('getPaymentLinkById inserts un-cached link from DB', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const linkFromDB = { id: 'pl-db-new', zohoPaymentLinkId: 'zoho-123', status: 'created' };
      jest.spyOn(domainQueries, 'getPaymentLinkByIdFromDB').mockResolvedValue(null);
      jest.spyOn(domainQueries, 'getPaymentLinksFromDB').mockResolvedValue([linkFromDB]);

      storeService.paymentLinks = [];
      const link = await storeService.getPaymentLinkById('pl-db-new');
      expect(link).toEqual(linkFromDB);
      expect(storeService.paymentLinks[0].id).toBe('pl-db-new');
    });

    test('reviseVendorRating mailer success and catch blocks', async () => {
      const vendor = {
        id: 'v-revise-1',
        email: 'revise@vendor.com',
        rating: 4.0,
      };
      storeService.vendors = [vendor];

      // Success
      const sendSpy = jest.spyOn(mailerService, 'sendVendorIngestionEmail').mockResolvedValue({ sent: true });
      storeService.reviseVendorRating('v-revise-1', 4.5, 'buyer@corp.com', 'Performance improved');
      await new Promise((resolve) => setImmediate(resolve));
      expect(sendSpy).toHaveBeenCalled();

      // Catch error
      sendSpy.mockRejectedValue(new Error('Async mailer failure'));
      storeService.reviseVendorRating('v-revise-1', 4.8, 'buyer@corp.com', 'High score');
      await new Promise((resolve) => setImmediate(resolve));
    });

    test('getRFQByIdAsync when dbRfq exists in memory vs not in memory, and DB error', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const dbRfq = { id: 'rfq-db-async', rfqNumber: 'RFQ-DB-ASYNC', title: 'DB RFQ', quotes: [] };
      const getRfqSpy = jest.spyOn(domainQueries, 'getRFQByIdFromDB').mockResolvedValue(dbRfq);

      // Not in memory -> unshifts
      storeService.rfqs = [];
      const res1 = await storeService.getRFQByIdAsync('rfq-db-async');
      expect(res1.id).toBe('rfq-db-async');
      expect(storeService.rfqs.length).toBe(1);

      // In memory -> merges
      getRfqSpy.mockResolvedValue({ ...dbRfq, title: 'DB RFQ Updated' });
      const res2 = await storeService.getRFQByIdAsync('rfq-db-async');
      expect(res2.title).toBe('DB RFQ Updated');

      // DB error -> logs warning and falls back to memory
      getRfqSpy.mockRejectedValue(new Error('Connection lost'));
      const res3 = await storeService.getRFQByIdAsync('rfq-db-async');
      expect(res3).toBeDefined();
    });

    test('getRFQById normalizes ai_extraction source without sourceFileName', () => {
      const rfq = {
        id: 'rfq-ai-norm',
        rfqNumber: 'RFQ-AI-NORM',
        source: 'ai_extraction',
        sourceFileName: null,
        quotes: [],
      };
      storeService.rfqs = [rfq];
      const res = storeService.getRFQById('rfq-ai-norm');
      expect(res.source).toBe('manual_entry');
    });

    test('createRFQ V0, V2, and V3 candidate count fallbacks when assigned is empty', () => {
      const pVendor = {
        id: 'v-proc-cand',
        name: 'Proc Cand',
        email: 'cand@proc.com',
        source: 'procucev_network',
        majorCategory: 'Hydraulics',
      };
      storeService.vendors = [pVendor];

      // V0 with category signals but assignedVendors is empty
      const rfqV0 = storeService.createRFQ({
        rfqNumber: 'RFQ-V0-EMPTY-ASSIGNED',
        title: 'Hydraulics V0',
        sourcingMode: 'mode_0',
        category: 'Hydraulics',
        assignedVendors: [],
        quotes: [],
      });
      expect(rfqV0.procucevVendorCount).toBeGreaterThanOrEqual(1);

      // V2 with assignedVendors containing items without id, and candidate fallback
      const rfqV2 = storeService.createRFQ({
        rfqNumber: 'RFQ-V2-NO-ID',
        title: 'Hydraulics V2',
        sourcingMode: 'mode_2',
        category: 'Hydraulics',
        assignedVendors: [{ name: 'Anonymous Vendor' }],
        quotes: [],
      });
      expect(rfqV2.procucevVendorCount).toBeGreaterThanOrEqual(1);

      // V3 with assignedVendors containing items without id, mode3ProcucevCount 0, and candidate fallback
      const rfqV3 = storeService.createRFQ({
        rfqNumber: 'RFQ-V3-NO-ID',
        title: 'Hydraulics V3',
        sourcingMode: 'mode_3',
        category: 'Hydraulics',
        assignedVendors: [{ name: 'Anonymous V3' }],
        quotes: [],
      });
      expect(rfqV3.procucevVendorCount).toBeGreaterThanOrEqual(1);
    });

    test('extendRFQ when current deadline is null but createdAt is valid', () => {
      const rfq = {
        id: 'rfq-ext-createdat',
        rfqNumber: 'RFQ-EXT-CREATEDAT',
        status: 'Quotes Pending',
        deadline: null,
        createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
        quotes: [],
      };
      storeService.rfqs = [rfq];

      const res = storeService.extendRFQ('rfq-ext-createdat', { hours: 24, userEmail: 'buyer@corp.com' });
      expect(res.success).toBe(true);
      expect(res.rfq.deadline).toBeDefined();
    });

    test('notifyBuyerOfAutoClosureAndScheduleComparison timer callback execution and catch block', () => {
      jest.useFakeTimers();

      const rfq = {
        id: 'rfq-5min-test',
        rfqNumber: 'RFQ-5MIN-TEST',
        buyerAccountId: 'buyer-5min',
        buyerCorporateEmail: '5min@buyer.com',
        buyerPhone: '9876543210',
        organizationName: '5Min Org',
        quotes: [{ totalAmount: 10000 }],
      };
      storeService.rfqs = [rfq];
      const buyer = { id: 'buyer-5min', corporateEmail: '5min@buyer.com', phone: '9876543210', organizationName: '5Min Org' };
      storeService.buyerAccounts = [buyer];

      const smsSpy = jest.spyOn(smsService, 'sendBuyerComparisonSms').mockResolvedValue({ success: true });

      // Execution
      storeService.notifyBuyerOfAutoClosureAndScheduleComparison(rfq, rfq.quotes);
      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(smsSpy).toHaveBeenCalled();

      // Error catch in timer callback
      smsSpy.mockImplementation(() => {
        throw new Error('Fatal SMS failure');
      });
      storeService.notifyBuyerOfAutoClosureAndScheduleComparison(rfq, rfq.quotes);
      expect(() => jest.advanceTimersByTime(5 * 60 * 1000)).not.toThrow();

      jest.useRealTimers();
    });

    test('getProcucevVendorCount and resolveProcucevVendorCountFromDB V0 empty signals and mode_1', async () => {
      const rfqV0NoSig = {
        sourcingMode: 'mode_0',
        category: null,
        assignedVendors: [{ id: 'v-1' }, { id: 'v-2' }],
      };
      expect(storeService.getProcucevVendorCount(rfqV0NoSig)).toBe(2);
      expect(await storeService.resolveProcucevVendorCountFromDB(rfqV0NoSig)).toBe(2);

      const rfqMode1 = {
        sourcingMode: 'mode_1',
        category: 'Pumps',
        assignedVendors: [{ id: 'v-1' }],
      };
      expect(storeService.getProcucevVendorCount(rfqMode1)).toBe(0);
    });

    test('vendorCoversRFQ buyer company matching and category coverage', () => {
      const vendor = {
        id: 'v-buyer-co',
        addedByBuyerCompany: 'Titan Industries',
        majorCategory: 'Bearings',
      };
      const rfqMatch = {
        buyerAccountName: 'Titan Industries',
        category: 'Bearings',
        assignedVendors: [],
      };
      const rfqMismatch = {
        buyerAccountName: 'Titan Industries',
        category: 'Electronics',
        assignedVendors: [],
      };

      expect(storeService.vendorCoversRFQ(vendor, rfqMatch)).toBe(true);
      expect(storeService.vendorCoversRFQ(vendor, rfqMismatch)).toBe(false);
    });

    test('notifyBuyerOfFinalComparison comparison email catch block', () => {
      const rfq = {
        id: 'rfq-closed-catch',
        rfqNumber: 'RFQ-CLOSED-CATCH',
        buyerAccountId: 'b-closed-1',
        buyerCorporateEmail: 'closed@buyer.com',
        quotes: [],
      };
      jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockRejectedValue(new Error('Async send error'));
      expect(() => storeService.notifyBuyerOfFinalComparison(rfq)).not.toThrow();
    });

    test('scheduleDelayedBuyerQuoteEmail timer execution and catch block', () => {
      jest.useFakeTimers();

      const rfq = {
        id: 'rfq-delayed-timer',
        rfqNumber: 'RFQ-DELAYED-TIMER',
        quotes: [],
      };
      storeService.rfqs = [rfq];
      const quote = { vendorName: 'Timer Vendor', totalAmount: 12000 };
      const buyer = { corporateEmail: 'timer@buyer.com', organizationName: 'Timer Org' };

      const mailSpy = jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockResolvedValue({ sent: true });

      // Clean execution
      storeService.scheduleDelayedBuyerQuoteEmail(rfq, quote, buyer, 100);
      jest.advanceTimersByTime(150);
      expect(mailSpy).toHaveBeenCalled();

      // Catch error
      jest.spyOn(storeService, 'getRFQById').mockImplementation(() => {
        throw new Error('RFQ retrieval crash');
      });
      storeService.scheduleDelayedBuyerQuoteEmail(rfq, quote, buyer, 100);
      expect(() => jest.advanceTimersByTime(150)).not.toThrow();

      jest.useRealTimers();
    });

    test('dispatchPendingQuoteNotifications mailer throw and createEvaluation primitive value', async () => {
      const buyer = {
        id: 'buyer-pending-quote',
        corporateEmail: 'pending@corp.com',
        organizationName: 'Pending Corp',
      };
      storeService.buyerAccounts = [buyer];

      const rfq = { id: 'rfq-pend-1', rfqNumber: 'RFQ-PEND-1', quotes: [] };
      const quote = { vendorName: 'Pend Vendor', totalAmount: 5000 };

      // Queue quote notification
      storeService.queuePendingQuoteNotification(buyer.corporateEmail, { rfq, quote });

      // mailer throws error
      jest.spyOn(mailerService, 'sendQuoteReceivedEmail').mockRejectedValue(new Error('Mailer fatal error'));
      const dispatched = await storeService.dispatchPendingQuoteNotifications(buyer.corporateEmail);
      expect(dispatched.length).toBe(0);

      // createEvaluation with primitive and extra moduleScores
      const evaluation = storeService.createEvaluation({
        vendorId: 'v-eval-prim',
        moduleScores: {
          pricing: 85,
          customModule: { score: 90 },
        },
      });
      expect(evaluation.moduleScores.pricing).toBe(85);
      expect(evaluation.moduleScores.customModule.score).toBe(90);
    });

    test('processHistoricalPurchaseData DB vendor lookup and DB upsert catch block', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      const dbVendor = {
        id: 'v-hist-db-lookup',
        email: 'histdb@vendor.com',
        name: 'Hist DB Vendor',
        buyerId: 'other-buyer',
      };
      jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(dbVendor);
      jest.spyOn(domainQueries, 'upsertVendorInDB').mockRejectedValue(new Error('DB Upsert lock error'));

      storeService.vendors = [];

      const rows = [
        {
          companyName: 'Hist DB Vendor',
          email: 'histdb@vendor.com',
          majorCategory: 'Pumps',
          rating: 4.2,
          score: 88,
        },
      ];

      const res = await storeService.processHistoricalPurchaseData('2025_Q4', rows, {
        id: 'buyer-hist-target',
        corporateEmail: 'target@buyer.com',
      });
      expect(res.importedCount).toBe(1);
      expect(storeService.vendors.some((v) => v.id === 'v-hist-db-lookup')).toBe(true);
    });
  });

  describe('Deep branch coverage expansion part 3', () => {
    test('syncRFQsFromDB catch block on domainQueries.getRFQsFromDB throw', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      storeService._syncRFQsPromise = null;
      storeService._lastRfqSyncTime = 0;
      storeService._lastRfqSyncMap = new Map();
      jest.spyOn(domainQueries, 'getRFQsFromDB').mockRejectedValue(new Error('Sync DB crash'));
      const res = await storeService.syncRFQsFromDB(true);
      expect(Array.isArray(res)).toBe(true);
    });

    test('createRFQ mode_1 with all assigned vendors mismatched hits line 2339', () => {
      const vMismatch = {
        id: 'v-mismatch-only',
        name: 'Mismatch Vendor',
        majorCategory: 'Office Supplies',
      };
      storeService.vendors = [vMismatch];

      const rfq = storeService.createRFQ({
        rfqNumber: 'RFQ-M1-ALL-MISMATCH',
        title: 'Transformers RFQ',
        sourcingMode: 'mode_1',
        category: 'Transformers',
        assignedVendors: [{ id: 'v-mismatch-only' }],
        quotes: [],
      });
      expect(rfq.assignedVendors.length).toBe(0);
    });

    test('createRFQ V0 with existing assignedVendors and existingKeys mapping', () => {
      const pVendor1 = {
        id: 'v-pv-1',
        email: 'pv1@ex.com',
        source: 'procucev_network',
        majorCategory: 'Bearings',
      };
      const pVendor2 = {
        id: 'v-pv-2',
        name: 'Vendor Two',
        source: 'procucev_network',
        majorCategory: 'Bearings',
      };
      const pVendor3 = {
        email: 'pv3@ex.com',
        name: 'Vendor Three',
        source: 'procucev_network',
        majorCategory: 'Bearings',
      };
      storeService.vendors = [pVendor1, pVendor2, pVendor3];

      const rfq = storeService.createRFQ({
        rfqNumber: 'RFQ-V0-EXISTING-ASSIGNED',
        title: 'Bearings V0',
        sourcingMode: 'mode_0',
        category: 'Bearings',
        assignedVendors: [
          { id: 'v-pv-1' },
          { email: 'pv3@ex.com' },
          { name: 'Vendor Two' },
        ],
        quotes: [],
      });
      expect(rfq.assignedVendors.length).toBeGreaterThanOrEqual(1);
    });

    test('createRFQ V0 with category and candidate fallback hits line 2542', () => {
      const pVendor = {
        id: 'v-proc-v0-cand',
        name: 'Proc Cand',
        source: 'procucev_network',
        majorCategory: 'Transformers',
      };
      storeService.vendors = [pVendor];
      jest.spyOn(storeService, 'selectVendorsPerCategory').mockReturnValue([]);

      const rfq = storeService.createRFQ({
        rfqNumber: 'RFQ-V0-CAND-FB',
        title: 'Transformers V0',
        sourcingMode: 'mode_0',
        category: 'Transformers',
        assignedVendors: [],
        quotes: [],
      });
      expect(rfq.procucevVendorCount).toBeGreaterThanOrEqual(1);
    });

    test('createRFQ V3 with candidate fallback hits line 2563', () => {
      const pVendor = {
        id: 'v-proc-v3-cand',
        name: 'Proc V3 Cand',
        source: 'procucev_network',
        majorCategory: 'Industrial Valves',
      };
      storeService.vendors = [pVendor];

      const rfq = storeService.createRFQ({
        rfqNumber: 'RFQ-V3-CAND-FB',
        title: 'Valves V3',
        sourcingMode: 'mode_3',
        category: null,
        extractedEntities: [{ minorCategory: 'Industrial Valves' }],
        assignedVendors: [],
        quotes: [],
      });
      expect(rfq.procucevVendorCount).toBeGreaterThanOrEqual(1);
    });

    test('getProcucevVendorCount and resolveProcucevVendorCountFromDB V0 with empty assigned and no signals', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const rfq = {
        sourcingMode: 'mode_0',
        category: null,
        assignedVendors: [],
      };
      expect(storeService.getProcucevVendorCount(rfq)).toBe(0);
      expect(await storeService.resolveProcucevVendorCountFromDB(rfq)).toBe(0);
    });

    test('augmentV0AssignmentsFromDB with candidatePool having matching targetPincode', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const rfq = {
        id: 'rfq-pin-match',
        rfqNumber: 'RFQ-PIN-MATCH',
        sourcingMode: 'mode_0',
        category: 'Valves',
        deliveryPincode: '400001',
        assignedVendors: [],
        quotes: [],
      };

      jest.spyOn(domainQueries, 'getPublicVendorsMatchingCategories').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [
          { id: 'v-pin-1', name: 'Vendor Pin 1', pincode: '400001', rating: 4.2, source: 'procucev_network' },
          { id: 'v-pin-2', name: 'Vendor Pin 2', pincode: '400001', rating: 4.8, source: 'procucev_network' },
        ],
        total: 2,
      });
      jest.spyOn(storeService, 'selectVendorsPerCategory').mockReturnValue([]);

      const res = await storeService.augmentV0AssignmentsFromDB(rfq);
      expect(res.assignedVendors.length).toBe(2);
      expect(res.assignedVendors[0].id).toBe('v-pin-2');
    });

    test('vendorCoversRFQ addedByBuyerCompany when isVendorMappedToRfqBuyer is false', () => {
      const vendorCovers = {
        id: 'v-co-covers',
        addedByBuyerCompany: 'Acme Buyers',
        majorCategory: 'Pumps',
      };
      const vendorMismatch = {
        id: 'v-co-mismatch',
        addedByBuyerCompany: 'Acme Buyers',
        majorCategory: 'Furniture',
      };
      const rfq = {
        buyerAccountName: 'Acme Buyers',
        category: 'Pumps',
        assignedVendors: [],
      };

      jest.spyOn(storeService, 'isVendorMappedToRfqBuyer').mockReturnValue(false);

      expect(storeService.vendorCoversRFQ(vendorCovers, rfq)).toBe(true);
      expect(storeService.vendorCoversRFQ(vendorMismatch, rfq)).toBe(false);
    });

    test('notifyBuyerOfFinalComparison catches async mailer rejection and logs', async () => {
      const rfq = {
        id: 'rfq-final-async-catch',
        rfqNumber: 'RFQ-FINAL-ASYNC-CATCH',
        buyerAccountId: 'b-async-1',
        buyerCorporateEmail: 'async@buyer.com',
        status: 'Closed',
        quotes: [],
      };
      jest.spyOn(mailerService, 'sendRfqFinalComparisonEmail').mockRejectedValue(new Error('Async connection drop'));

      storeService.notifyBuyerOfFinalComparison(rfq);
      await new Promise((resolve) => setImmediate(resolve));
    });

    test('scheduleBuyerComparisonSms production NODE_ENV branch', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      jest.useFakeTimers();

      const rfq = {
        rfqNumber: 'RFQ-PROD-SMS',
        buyerEmail: 'prod@buyer.com',
        buyerPhone: '9876543210',
      };
      const smsSpy = jest.spyOn(smsService, 'sendBuyerComparisonSms').mockResolvedValue({ success: true });

      try {
        await storeService.scheduleBuyerComparisonSms(rfq, 100);
        jest.advanceTimersByTime(200);
      } finally {
        process.env.NODE_ENV = originalEnv;
        jest.useRealTimers();
      }
    });

    test('resolveBuyerEmailForRFQ comprehensive fallback cascade', () => {
      expect(storeService.resolveBuyerEmailForRFQ(null)).toBeNull();

      const buyer = { id: 'b-email-owner', corporateEmail: 'owner@corp.com' };
      storeService.buyerAccounts = [buyer];
      expect(storeService.resolveBuyerEmailForRFQ({ buyerAccountId: 'b-email-owner' })).toBe('owner@corp.com');

      expect(storeService.resolveBuyerEmailForRFQ({ raisedByEmail: 'raised@corp.com' })).toBe('raised@corp.com');
      expect(storeService.resolveBuyerEmailForRFQ({ buyerEmail: 'buyer@corp.com' })).toBe('buyer@corp.com');
      expect(storeService.resolveBuyerEmailForRFQ({ sourceEmail: 'source@corp.com' })).toBe('source@corp.com');
      expect(storeService.resolveBuyerEmailForRFQ({ buyerCorporateEmail: 'bcorp@corp.com' })).toBe('bcorp@corp.com');
      expect(storeService.resolveBuyerEmailForRFQ({ corporateEmail: 'corp@corp.com' })).toBe('corp@corp.com');
      expect(storeService.resolveBuyerEmailForRFQ({ buyer: { corporateEmail: 'nested@corp.com' } })).toBe('nested@corp.com');
      expect(storeService.resolveBuyerEmailForRFQ({ buyer: { email: 'nested_email@corp.com' } })).toBe('nested_email@corp.com');
      expect(storeService.resolveBuyerEmailForRFQ({ buyerAccount: { corporateEmail: 'account@corp.com' } })).toBe('account@corp.com');
      expect(storeService.resolveBuyerEmailForRFQ({ buyerAccount: { email: 'account_email@corp.com' } })).toBe('account_email@corp.com');
      expect(storeService.resolveBuyerEmailForRFQ({})).toBeNull();
    });

    test('isWithin48HourWindow status and timing branches', () => {
      expect(storeService.isWithin48HourWindow(null)).toBe(false);
      expect(storeService.isWithin48HourWindow({ status: 'Closed' })).toBe(false);
      expect(storeService.isWithin48HourWindow({ status: 'PO Generated' })).toBe(false);
      expect(storeService.isWithin48HourWindow({ poFinalised: true })).toBe(false);
      expect(storeService.isWithin48HourWindow({ poNumber: 'PO-123' })).toBe(false);
      expect(storeService.isWithin48HourWindow({ status: 'Expired' })).toBe(false);
      expect(storeService.isWithin48HourWindow({ sourcingMode: 'mode_0' })).toBe(false);
      expect(storeService.isWithin48HourWindow({ sourcingMode: 'v0' })).toBe(false);
      expect(storeService.isWithin48HourWindow({ sourcingMode: 'version_0' })).toBe(false);
      expect(storeService.isWithin48HourWindow({ sourcingMode: 'mode_1', quotesHidden: true })).toBe(true);
      expect(storeService.isWithin48HourWindow({ sourcingMode: 'mode_1', createdAt: 'not-a-date' })).toBe(true);

      const pastRfq = { sourcingMode: 'mode_1', createdAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString() };
      expect(storeService.isWithin48HourWindow(pastRfq)).toBe(false);

      const recentRfq = { sourcingMode: 'mode_1', createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString() };
      expect(storeService.isWithin48HourWindow(recentRfq)).toBe(true);
    });

    test('isVendorMappedToRfqBuyer ID arrays and email fallback branches', () => {
      expect(storeService.isVendorMappedToRfqBuyer(null, null)).toBe(false);
      expect(storeService.isVendorMappedToRfqBuyer({}, null)).toBe(false);

      const rfqWithBuyerId = { buyerAccountId: 'b-test-id' };
      const vendorWithAccount = { buyerAccountId: 'b-test-id' };
      expect(storeService.isVendorMappedToRfqBuyer(vendorWithAccount, rfqWithBuyerId)).toBe(true);

      const rfqWithRaisedEmail = { raisedByEmail: 'raised@rfq.com' };
      const vendorWithEmail = { buyerEmail: 'raised@rfq.com' };
      expect(storeService.isVendorMappedToRfqBuyer(vendorWithEmail, rfqWithRaisedEmail)).toBe(true);

      const vendorWithMappedIds = { mappedBuyerIds: ['b-test-id'] };
      expect(storeService.isVendorMappedToRfqBuyer(vendorWithMappedIds, rfqWithBuyerId)).toBe(true);

      const vendorWithBuyerIds = { buyerIds: ['b-test-id'] };
      expect(storeService.isVendorMappedToRfqBuyer(vendorWithBuyerIds, rfqWithBuyerId)).toBe(true);

      expect(storeService.isVendorMappedToRfqBuyer({ buyerId: 'different' }, rfqWithBuyerId)).toBe(false);
    });

    test('checkVendorQuotationEligibility all subscription and credit tiers', () => {
      expect(storeService.checkVendorQuotationEligibility('non-existent-vendor').eligible).toBe(false);

      // Connect plan
      expect(storeService.checkVendorQuotationEligibility({ subscriptionPlan: 'connect' }).isSubscribed).toBe(true);

      // isSubscribed boolean
      expect(storeService.checkVendorQuotationEligibility({ isSubscribed: true }).isSubscribed).toBe(true);

      // freeRfqDownloadCredits
      const dlVendor = storeService.checkVendorQuotationEligibility({ freeRfqDownloadCredits: 5 });
      expect(dlVendor.freeCreditsRemaining).toBe(5);

      // Exhausted credits and unsubscribed
      const exhausted = storeService.checkVendorQuotationEligibility({ freeQuotationCredits: 0 });
      expect(exhausted.eligible).toBe(false);

      // Buyer mapped
      const rfq = { buyerAccountId: 'buyer-mapped-1' };
      const mappedVendor = { buyerId: 'buyer-mapped-1', freeQuotationCredits: 0 };
      const mappedRes = storeService.checkVendorQuotationEligibility(mappedVendor, rfq);
      expect(mappedRes.eligible).toBe(true);
      expect(mappedRes.isBuyerMapped).toBe(true);
    });

    test('cancelDelayedQuoteTimers guards and operations', () => {
      expect(() => storeService.cancelDelayedQuoteTimers(null)).not.toThrow();

      storeService._delayedQuoteTimers = null;
      expect(() => storeService.cancelDelayedQuoteTimers('rfq-1')).not.toThrow();

      const timer = setTimeout(() => {}, 5000);
      storeService._delayedQuoteTimers = new Map([
        ['rfq-active-timer', [timer]],
        ['rfq-not-array', 'not-array'],
      ]);

      storeService.cancelDelayedQuoteTimers('rfq-active-timer');
      expect(storeService._delayedQuoteTimers.has('rfq-active-timer')).toBe(false);

      storeService.cancelDelayedQuoteTimers('rfq-not-array');
      clearTimeout(timer);
    });

    test('getVendorRfqCredits freeCreditsAllocated and used branches', () => {
      const vendorWithAll = {
        id: 'v-credits-all',
        freeCreditsAllocated: 10,
        freeCreditsUsed: 3,
        freeQuotationCredits: 7,
      };
      storeService.vendors = [vendorWithAll];
      const res = storeService.getVendorRfqCredits('v-credits-all');
      expect(res.freeCreditsAllocated).toBe(10);
      expect(res.freeCreditsUsed).toBe(3);
      expect(res.freeCreditsRemaining).toBe(7);
    });
  });

  describe('Deep branch boost part 4 - final branch push', () => {
    test('_background invokes waitUntil when present', async () => {
      const waitFn = jest.fn();
      globalThis.__CF_WAIT_UNTIL__ = waitFn;
      try {
        const p = Promise.resolve('done');
        storeService._background(p, 'Test Error');
        expect(waitFn).toHaveBeenCalled();
      } finally {
        delete globalThis.__CF_WAIT_UNTIL__;
      }
    });

    test('confirmVendorPersisted handles unique conflict via err.cause', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const err = new Error('wrapper error');
      err.cause = { message: 'unique constraint error on email' };
      const spy = jest.spyOn(domainQueries, 'upsertVendorInDB').mockRejectedValue(err);
      const vendor = { id: 'v-conflict-1', email: 'test@conflict.com' };
      storeService.vendors = [vendor];
      await expect(storeService.confirmVendorPersisted(vendor)).rejects.toThrow('A vendor with the email test@conflict.com already exists.');
      expect(storeService.vendors.find((v) => v.id === 'v-conflict-1')).toBeUndefined();
      spy.mockRestore();
      pool.hasStorage.mockRestore();
    });

    test('getBuyerAccounts limits and fallbacks', () => {
      storeService.buyerAccounts = Array.from({ length: 10 }, (_, i) => ({ id: `acc-${i}` }));
      expect(storeService.getBuyerAccounts('3').length).toBe(3);
      expect(storeService.getBuyerAccounts(0).length).toBe(10);
      expect(storeService.getBuyerAccounts(null).length).toBe(10);
    });

    test('ensureBuyerAccountForUser enriches existing account or returns cached', async () => {
      const existing = {
        id: 'acc-sync-1',
        corporateEmail: 'user@sync.com',
        gstin: null,
      };
      storeService.buyerAccounts = [existing];
      jest.spyOn(buyerProfileQueries, 'findProfileByIdentifier').mockResolvedValue({
        found: true,
        profile: {
          companyName: 'New Profile Co',
          brandName: 'New Brand',
          organizationType: 'Private Ltd',
          contactName: 'Contact Person',
          contactDesignation: 'Purchasing Lead',
          contactPhone: '9876543210',
          contactEmail: 'user@sync.com',
          gstNumber: '27AAAAA0000A1Z5',
          panNumber: 'AAAAA0000A',
          city: 'Mumbai',
        },
      });

      const res = await storeService.ensureBuyerAccountForUser({
        role: 'buyer',
        email: 'user@sync.com',
        sub: 'acc-sync-1',
      });
      expect(res.organizationName).toBe('New Profile Co');
      expect(res.gstin).toBe('27AAAAA0000A1Z5');
      buyerProfileQueries.findProfileByIdentifier.mockRestore();

      // Cached path when existing by id
      const cached = { id: 'acc-cached-sub', corporateEmail: 'cached@sub.com' };
      storeService.buyerAccounts = [cached];
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      const res2 = await storeService.ensureBuyerAccountForUser({
        role: 'buyer',
        email: 'other@sub.com',
        sub: 'acc-cached-sub',
      });
      expect(res2.id).toBe('acc-cached-sub');
      storeService.getBuyerAccountByEmail.mockRestore();
    });

    test('addBuyerAccount formats totalSpend and handles missing fields', () => {
      const acc1 = storeService.addBuyerAccount({ totalSpend: '$2,500', totalRFQsCreated: null, createdDate: null, status: null });
      expect(acc1.totalSpend).toBe('₹2,500');
      expect(acc1.totalRFQsCreated).toBe(0);
      expect(acc1.status).toBe('ACTIVE_VERIFIED');

      const acc2 = storeService.addBuyerAccount({ totalSpend: null });
      expect(acc2.totalSpend).toBe('₹0');
    });

    test('updateBuyerAccount matches corporateEmail case-insensitively', () => {
      storeService.buyerAccounts = [{ id: 'acc-email-1', corporateEmail: 'Match@Corp.com', name: 'Before' }];
      const updated = storeService.updateBuyerAccount('match@corp.com', { name: 'After' });
      expect(updated.name).toBe('After');
    });

    test('deleteBuyerAccount activates first remaining account when deleting active account', () => {
      const a1 = { id: 'acc-active-del', corporateEmail: 'a1@del.com' };
      const a2 = { id: 'acc-remain-del', corporateEmail: 'a2@del.com' };
      storeService.buyerAccounts = [a1, a2];
      storeService.activeBuyerAccount = a1;
      const res = storeService.deleteBuyerAccount('acc-active-del');
      expect(res).toBe(true);
      expect(storeService.activeBuyerAccount.id).toBe('acc-remain-del');
    });

    test('tryConsumeFreeRFQ and refundFreeRFQ handle undefined remainingFreeRFQs and quota exhaustion', () => {
      // not found
      expect(storeService.tryConsumeFreeRFQ('non-existent')).toEqual({ ok: false, remaining: 0 });

      // unlimited
      const buyerUnlimited = { id: 'b-unlim-quota', unlimitedRfqAccess: true };
      storeService.buyerAccounts = [buyerUnlimited];
      expect(storeService.tryConsumeFreeRFQ('b-unlim-quota')).toEqual({ ok: true, remaining: 999999 });

      // undefined remainingFreeRFQs
      const buyerUndefined = { id: 'b-free-undef' };
      storeService.buyerAccounts = [buyerUndefined];
      expect(storeService.tryConsumeFreeRFQ('b-free-undef')).toEqual({ ok: true, remaining: 4 });

      // quota exhausted
      const buyerZero = { id: 'b-zero', remainingFreeRFQs: 0 };
      storeService.buyerAccounts = [buyerZero];
      expect(storeService.tryConsumeFreeRFQ('b-zero')).toEqual({ ok: false, remaining: 0 });

      // refundFreeRFQ guards
      storeService.refundFreeRFQ('non-existent');
      storeService.buyerAccounts = [buyerUnlimited];
      storeService.refundFreeRFQ('b-unlim-quota');

      const buyerUndefRefund = { id: 'b-undef-ref' };
      storeService.buyerAccounts = [buyerUndefRefund];
      storeService.refundFreeRFQ('b-undef-ref');
      expect(storeService.buyerAccounts[0].remainingFreeRFQs).toBe(1);
    });

    test('getVendorByIdWithDBFallback checks memory, then DB, then returns undefined', async () => {
      const inMem = { id: 'v-mem-1', name: 'In Memory' };
      storeService.vendors = [inMem];
      const res1 = await storeService.getVendorByIdWithDBFallback('v-mem-1');
      expect(res1).toBe(inMem);

      const dbVendor = { id: 'v-db-1', name: 'From DB' };
      const spy = jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(dbVendor);
      const res2 = await storeService.getVendorByIdWithDBFallback('v-db-1');
      expect(res2).toEqual(dbVendor);

      spy.mockResolvedValue(null);
      const spyEmail = jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(null);
      const res3 = await storeService.getVendorByIdWithDBFallback('v-db-none');
      expect(res3).toBeUndefined();
      spy.mockRestore();
      spyEmail.mockRestore();
    });

    test('addVendor and bulkAddVendors handle credit limits, dates, and buyer attribution', async () => {
      const v = storeService.addVendor({
        name: 'New Vendor Dates',
        freeQuotationCredits: 3,
        quotedRfqIds: null,
        created_at: '2026-02-01T00:00:00.000Z',
      });
      expect(v.freeQuotationCredits).toBe(3);
      expect(v.quotedRfqIds).toEqual([]);
      expect(v.createdAt).toBe('2026-02-01T00:00:00.000Z');

      // Unconfigured storage throws
      await expect(storeService.bulkAddVendors([])).rejects.toThrow('Database is not configured');

      // With storage configured
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const bulkInsertSpy = jest.spyOn(domainQueries, 'bulkInsertVendorsInDB').mockResolvedValue(['bulk@attr.com']);
      const findUsersSpy = jest.spyOn(identityQueries, 'findExistingUsernames').mockResolvedValue(new Set());

      const bulkRes = await storeService.bulkAddVendors([
        {
          name: 'Bulk Attributed',
          email: 'bulk@attr.com',
          buyerId: 'buyer-bulk-attr',
          addedByBuyerCompany: 'Attr Corp',
          source: null,
        },
      ]);
      expect(bulkRes.importedCount).toBe(1);
      const addedV = storeService.vendors.find((item) => item.email === 'bulk@attr.com');
      expect(addedV.buyerId).toBe('buyer-bulk-attr');
      expect(addedV.addedByBuyerCompany).toBe('Attr Corp');
      expect(addedV.source).toBe('excel');

      bulkInsertSpy.mockRestore();
      findUsersSpy.mockRestore();
      pool.hasStorage.mockRestore();
    });

    test('isVendorMappedToRfqBuyer additional branch coverage', () => {
      const buyerAcc = {
        id: 'buyer-acc-map',
        organizationName: 'Map Org',
        corporateEmail: 'corp@map.com',
      };
      storeService.buyerAccounts = [buyerAcc];

      // Match via orgName
      const rfqWithOrg = { buyerAccountId: 'buyer-acc-map' };
      const vWithAddedBy = { addedByBuyerCompany: 'Map Org' };
      expect(storeService.isVendorMappedToRfqBuyer(vWithAddedBy, rfqWithOrg)).toBe(true);

      // Match via corpEmail
      const vWithBuyerEmail = { buyerEmail: 'corp@map.com' };
      expect(storeService.isVendorMappedToRfqBuyer(vWithBuyerEmail, rfqWithOrg)).toBe(true);

      // Assigned vendors match on name, and handle null elements
      const rfqAssigned = {
        assignedVendors: [null, { name: 'Assigned Match Vendor' }],
      };
      expect(storeService.isVendorMappedToRfqBuyer({ name: 'Assigned Match Vendor' }, rfqAssigned)).toBe(true);

      // Follow up data match on fvEmail and fvName, and handle null elements
      const rfqFollowUpEmail = {
        followUpData: {
          vendors: [null, { email: 'follow@up.com' }],
        },
      };
      expect(storeService.isVendorMappedToRfqBuyer({ email: 'follow@up.com' }, rfqFollowUpEmail)).toBe(true);

      const rfqFollowUpName = {
        followUpData: {
          vendors: [{ name: 'Follow Up Name' }],
        },
      };
      expect(storeService.isVendorMappedToRfqBuyer({ name: 'Follow Up Name' }, rfqFollowUpName)).toBe(true);
    });

    test('isVendorPrivateToDifferentBuyer handles null arguments and array buyer IDs', () => {
      expect(storeService.isVendorPrivateToDifferentBuyer(null, {})).toBe(false);
      expect(storeService.isVendorPrivateToDifferentBuyer({}, null)).toBe(false);

      const rfqDiff = { buyerAccountId: 'buyer-diff' };
      const vMappedArr = { mappedBuyerIds: ['buyer-other'] };
      expect(storeService.isVendorPrivateToDifferentBuyer(vMappedArr, rfqDiff)).toBe(true);

      const vBuyerIdsArr = { buyerIds: ['buyer-other'] };
      expect(storeService.isVendorPrivateToDifferentBuyer(vBuyerIdsArr, rfqDiff)).toBe(true);
    });

    test('getVendorRfqCredits and isRfqUnlockedForVendor branch variations', () => {
      const vSelect = {
        id: 'v-select-sub',
        subscriptionPlan: 'select',
        subscriptionStatus: 'active',
        unlockedRfqIds: null,
      };
      storeService.vendors = [vSelect];
      const credits = storeService.getVendorRfqCredits('v-select-sub');
      expect(credits.isSubscribed).toBe(true);
      expect(credits.unlockedRfqIds).toEqual([]);

      // isRfqUnlockedForVendor guards
      expect(storeService.isRfqUnlockedForVendor(null, 'rfq-1')).toBe(false);
      expect(storeService.isRfqUnlockedForVendor('v-select-sub', null)).toBe(false);
      expect(storeService.isRfqUnlockedForVendor('unknown-vendor', 'rfq-1')).toBe(false);

      // rfq does not exist in store, match via normRfqNum in unlockedRfqIds
      const vUnlocked = {
        id: 'v-unlocked-num',
        unlockedRfqIds: ['rfq-num-999'],
      };
      storeService.vendors = [vUnlocked];
      expect(storeService.isRfqUnlockedForVendor('v-unlocked-num', 'RFQ-NUM-999')).toBe(true);
    });

    test('unlockRFQForVendor sources and empty rfqNumber / vendor fields fallback', async () => {
      const rfqNoNum = { id: 'rfq-no-num', sourcingMode: 'mode_0', buyerAccountId: 'b-other-buyer' };
      const vSub = { id: 'v-sub-unl', subscriptionPlan: 'connect', email: null, name: null };
      storeService.rfqs = [rfqNoNum];
      storeService.vendors = [vSub];

      const unlockSpy = jest.spyOn(domainQueries, 'unlockRFQInDB').mockResolvedValue(true);
      const res = await storeService.unlockRFQForVendor('v-sub-unl', 'rfq-no-num');
      expect(res.success).toBe(true);
      expect(res.unlocked).toBe(true);
      expect(unlockSpy).toHaveBeenCalledWith(expect.objectContaining({ source: 'subscription' }));

      // Unlimited downloads path
      const vUnlim = { id: 'v-unlim-unl', unlimitedDownloads: true, email: null, name: null };
      storeService.vendors = [vUnlim];
      const resUnlim = await storeService.unlockRFQForVendor('v-unlim-unl', 'rfq-no-num');
      expect(resUnlim.success).toBe(true);
      expect(unlockSpy).toHaveBeenCalledWith(expect.objectContaining({ source: 'unlimited_entitlement' }));
      unlockSpy.mockRestore();

      // Free allowance exhausted with null email and null name
      const rfqExhausted = { id: 'rfq-ex-1', rfqNumber: 'RFQ-EX-1', sourcingMode: 'mode_0' };
      const vExhausted = { id: 'v-ex-1', freeQuotationCredits: 0, email: null, name: null };
      storeService.rfqs = [rfqExhausted];
      storeService.vendors = [vExhausted];
      const resEx = await storeService.unlockRFQForVendor('v-ex-1', 'rfq-ex-1');
      expect(resEx.success).toBe(false);
      expect(resEx.error).toContain('You have no free RFQ download credits available');
    });

    test('createRFQ executes line 2563 candidate filter callback when isV3 and mode3ProcucevCount is 0', () => {
      const pVendor = {
        id: 'v-p-line2563',
        name: 'Procucev Vendor 2563',
        email: 'p2563@procucev.com',
        source: 'procucev_network',
        verified: true,
        majorCategory: 'Pumps & Valves',
      };
      storeService.vendors = [pVendor];
      jest.spyOn(storeService, 'selectVendorsPerCategory').mockReturnValue([]);

      const created = storeService.createRFQ({
        title: 'V3 Line 2563 Test',
        sourcingMode: 'mode_3',
        category: 'Pumps & Valves',
        deliveryPincode: '400001',
        assignedVendors: [],
      });

      expect(created.sourcingMode).toBe('mode_3');
      expect(created.procucevVendorCount).toBe(1);
      storeService.selectVendorsPerCategory.mockRestore();
    });
  });
});



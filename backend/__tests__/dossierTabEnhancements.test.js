// Unit tests for Buyer and Seller 360° Dossier tab enhancements:
// 1. Buyer Uploaded Vendors (controller + domain queries)
// 2. Seller Buyer Uploads (controller + domain queries)
// 3. Seller Active RFQs (controller + domain queries)
const buyerAccountController = require('../src/controllers/buyerAccountController');
const vendorDossierExtensions = require('../src/controllers/vendorDossierExtensions');
const domainQueries = require('../src/db/domainQueries');
const storeService = require('../src/services/storeService');
const pool = require('../src/db/pool');

function createMockReq(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    user: {
      id: 'cm-1',
      role: 'category_manager',
      email: 'category.manager@procucev.test',
      name: 'Category Manager',
    },
    ...overrides,
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
  };
  return res;
}

describe('Dossier Tab Enhancements', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Buyer Account Controller - getBuyerUploadedVendors', () => {
    it('returns 404 when buyer account does not exist', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([]);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);

      const req = createMockReq({ params: { id: 'missing-buyer' } });
      const res = createMockRes();
      const next = jest.fn();

      await buyerAccountController.getBuyerUploadedVendors(req, res, next);
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns uploaded vendors for an existing buyer', async () => {
      const mockBuyer = {
        id: 'buyer-1',
        organizationName: 'Manav Buyer Enterprise',
        corporateEmail: 'manav@buyer.com',
      };
      const mockVendors = [
        {
          id: 'v-1',
          name: 'GKS Enterprises',
          companyName: 'GKS Enterprises Pvt Ltd',
          contactPerson: 'Yuvraj',
          email: 'gks@test.com',
          phone: '9876543210',
          createdAt: new Date().toISOString(),
          status: 'ACTIVE',
        },
      ];

      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([mockBuyer]);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'getVendorsUploadedByBuyerFromDB').mockResolvedValue(mockVendors);

      const req = createMockReq({ params: { id: 'buyer-1' } });
      const res = createMockRes();
      const next = jest.fn();

      await buyerAccountController.getBuyerUploadedVendors(req, res, next);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].id).toBe('v-1');
      expect(res.body.data[0].name).toBe('GKS Enterprises');
    });

    it('passes error to next when query throws', async () => {
      jest.spyOn(storeService, 'getBuyerAccounts').mockImplementation(() => {
        throw new Error('Store failure');
      });
      const req = createMockReq({ params: { id: 'buyer-1' } });
      const res = createMockRes();
      const next = jest.fn();

      await buyerAccountController.getBuyerUploadedVendors(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Vendor Dossier Extensions - getSellerBuyerUploads', () => {
    it('returns 404 when seller does not exist', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);

      const req = createMockReq({ params: { id: 'missing-seller' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerBuyerUploads(req, res, next);
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns associated buyers for an existing seller', async () => {
      const mockSeller = {
        id: 'v-1',
        name: 'Sudheer Solutions',
        companyName: 'Sudheer Solutions pvt LTD',
      };
      const mockBuyers = [
        {
          id: 'b-1',
          name: 'Veera solutions pvt ltd',
          companyName: 'Veera solutions pvt ltd',
          contactPerson: 'Veera',
          email: 'veera@test.com',
          phone: '9381877013',
          uploadDate: new Date().toISOString(),
          status: 'ACTIVE_VERIFIED',
        },
      ];

      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'getAssociatedBuyersForVendorFromDB').mockResolvedValue(mockBuyers);

      const req = createMockReq({ params: { id: 'v-1' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerBuyerUploads(req, res, next);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.data).toEqual(mockBuyers);
    });

    it('passes error to next when query throws', async () => {
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Vendor lookup failed');
      });
      const req = createMockReq({ params: { id: 'v-1' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerBuyerUploads(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('returns 403 when user is not authorized for seller', async () => {
      const mockSeller = { id: 'v-1', email: 'seller@test.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      const req = createMockReq({
        params: { id: 'v-1' },
        user: { role: 'vendor', id: 'other-vendor', email: 'other@test.com' },
      });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerBuyerUploads(req, res, next);
      expect(res.statusCode).toBe(403);
    });

    it('matches in-memory buyer accounts when pool has no storage', async () => {
      const mockSeller = {
        id: 'v-1',
        buyerId: 'b-inmem-1',
        buyerEmail: 'buyer@inmem.test',
        addedByBuyerCompany: 'InMem Corp',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const inMemBuyers = [
        null,
        {
          id: 'b-inmem-1',
          organizationName: 'InMem Corp',
          corporateEmail: 'buyer@inmem.test',
          contactPerson: 'Buyer Contact',
          mobileNumber: '9999999999',
          status: 'ACTIVE_VERIFIED',
          sourcingMode: 'Mode 1',
          subscriptionPlan: 'Enterprise',
          location: 'Pune',
        },
      ];

      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue(inMemBuyers);

      const req = createMockReq({ params: { id: 'v-1' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerBuyerUploads(req, res, next);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].id).toBe('b-inmem-1');
    });

    it('constructs fallback buyer when buyerMap is empty and vendor has buyer metadata', async () => {
      const mockSeller = {
        id: 'v-fallback',
        buyerId: 'buyer-fallback-id',
        buyerEmail: 'fallback@client.test',
        addedByBuyerCompany: 'Fallback Client Inc',
        city: 'Mumbai',
        state: 'MH',
      };

      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue([]);

      const req = createMockReq({ params: { id: 'v-fallback' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerBuyerUploads(req, res, next);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].companyName).toBe('Fallback Client Inc');
      expect(res.body.data[0].location).toBe('Mumbai, MH');
    });

    it('matches buyer accounts on buyerAccountId, corporateEmail and addedByBuyerCompany', async () => {
      const mockSeller1 = { id: 'v-acc', buyerAccountId: 'acc-buyer-1' };
      const mockSeller2 = { id: 'v-em', buyerEmail: 'match@client.com' };
      const mockSeller3 = { id: 'v-org', addedByBuyerCompany: 'Org Buyer Ltd' };
      const mockSeller4 = { id: 'v-nomatch' };

      const buyerList = [
        null,
        { id: 'acc-buyer-1', organizationName: 'Acc Corp' },
        { id: 'em-buyer-1', corporateEmail: 'match@client.com' },
        { id: 'org-buyer-1', organizationName: 'Org Buyer Ltd' },
      ];

      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue(buyerList);

      for (const seller of [mockSeller1, mockSeller2, mockSeller3]) {
        jest.spyOn(storeService, 'getVendorById').mockReturnValue(seller);
        const req = createMockReq({ params: { id: seller.id } });
        const res = createMockRes();
        await vendorDossierExtensions.getSellerBuyerUploads(req, res, jest.fn());
        expect(res.statusCode).toBe(200);
        expect(res.body.count).toBe(1);
      }

      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller4);
      const req4 = createMockReq({ params: { id: 'v-nomatch' } });
      const res4 = createMockRes();
      await vendorDossierExtensions.getSellerBuyerUploads(req4, res4, jest.fn());
      expect(res4.statusCode).toBe(200);
      expect(res4.body.count).toBe(0);
    });
  });

  describe('Vendor Dossier Extensions - getSellerActiveRFQs', () => {
    it('returns 404 when seller does not exist', async () => {
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(null);
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);

      const req = createMockReq({ params: { id: 'missing-seller' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerActiveRFQs(req, res, next);
      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('returns 403 when user is not authorized for seller', async () => {
      const mockSeller = { id: 'v-1', email: 'seller@test.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      const req = createMockReq({
        params: { id: 'v-1' },
        user: { role: 'vendor', id: 'other-vendor', email: 'other@test.com' },
      });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerActiveRFQs(req, res, next);
      expect(res.statusCode).toBe(403);
    });

    it('matches in-memory RFQs with multiple category match strategies', async () => {
      const mockSeller = {
        id: 'v-1',
        name: 'GKS Enterprises',
        majorCategory: 'Mechanical & Fluid Equipment',
        categories: ['Mechanical & Fluid Equipment'],
      };
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      const inMemRFQs = [
        null,
        // Closed status -> filtered out
        { id: 'rfq-closed', status: 'Closed', category: 'Mechanical & Fluid Equipment' },
        // Expired date -> filtered out
        { id: 'rfq-expired', status: 'Quotes Pending', closingDate: pastDate, category: 'Mechanical & Fluid Equipment' },
        // Matched by vendorCoversCategory
        {
          id: 'rfq-cat',
          rfqNumber: 'RFQ-001',
          status: 'Quotes Pending',
          closingDate: futureDate,
          category: 'Mechanical & Fluid Equipment',
          buyerAccountName: 'Buyer A',
          budget: 50000,
        },
        // Matched by _vendorCoversRFQCategories
        {
          id: 'rfq-covers',
          rfqNumber: 'RFQ-002',
          status: 'Quotes Pending',
          closingDate: futureDate,
          category: 'Other Category',
          buyerCompanyName: 'Buyer B',
        },
        // Matched by extractedEntities
        {
          id: 'rfq-extracted',
          rfqNumber: 'RFQ-003',
          status: 'Open',
          closingDate: futureDate,
          category: 'Other Category',
          extractedEntities: [{ majorCategory: 'Mechanical & Fluid Equipment' }],
        },
      ];

      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      storeService.rfqs = inMemRFQs;
      jest.spyOn(storeService, 'vendorCoversCategory').mockImplementation((v, cat) => cat === 'Mechanical & Fluid Equipment');
      storeService._vendorCoversRFQCategories = (v, rfq) => rfq.id === 'rfq-covers';

      const req = createMockReq({ params: { id: 'v-1' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerActiveRFQs(req, res, next);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(3);
    });

    it('returns active category-matched RFQs for an existing seller', async () => {
      const mockSeller = {
        id: 'v-1',
        name: 'GKS Enterprises',
        majorCategory: 'Mechanical & Fluid Equipment',
        categories: ['Mechanical & Fluid Equipment'],
      };
      const mockRFQs = [
        {
          id: 'rfq-1',
          rfqNumber: 'RFQ-2026-101',
          title: 'Industrial Pumps',
          category: 'Mechanical & Fluid Equipment',
          procurementCategory: 'Mechanical & Fluid Equipment',
          buyerCompanyName: 'Veera solutions pvt ltd',
          location: 'Bengaluru, KA',
          publishedDate: new Date().toISOString(),
          status: 'PUBLISHED',
        },
      ];

      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      storeService.rfqs = [];
      jest.spyOn(domainQueries, 'getActiveCategoryMatchedRFQsForVendorFromDB').mockResolvedValue(mockRFQs);

      const req = createMockReq({ params: { id: 'v-1' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerActiveRFQs(req, res, next);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.data).toEqual(mockRFQs);
    });

    it('passes error to next when query throws', async () => {
      jest.spyOn(storeService, 'getVendorById').mockImplementation(() => {
        throw new Error('Vendor lookup error');
      });
      const req = createMockReq({ params: { id: 'v-1' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getSellerActiveRFQs(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it('returns empty when in-memory RFQ categories and extractedEntities do not match vendor category', async () => {
      const mockSeller = { id: 'v-1', majorCategory: 'Electronics' };
      const inMemRFQs = [
        {
          id: 'rfq-no-match',
          category: 'Plumbing',
          extractedEntities: [{ category: 'Hardware' }],
        },
        {
          id: 'rfq-no-entities',
          category: 'Chemicals',
          extractedEntities: null,
        },
      ];

      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      storeService.rfqs = inMemRFQs;
      jest.spyOn(storeService, 'vendorCoversCategory').mockReturnValue(false);

      const req = createMockReq({ params: { id: 'v-1' } });
      const res = createMockRes();
      await vendorDossierExtensions.getSellerActiveRFQs(req, res, jest.fn());
      expect(res.statusCode).toBe(200);
      expect(res.body.count).toBe(0);
    });

    it('returns 401 on requestCreditApproval when actor cannot be resolved', async () => {
      const mockSeller = { id: 'v-1', name: 'Seller' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      const req = {
        params: { id: 'v-1' },
        body: { amount: 10, approverName: 'Srinu Sir', reason: 'Top-up' },
        user: { role: 'category_manager' }, // No sub, id, name, or email
      };
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.requestCreditApproval(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('handles warning and recovers when initial unlock transaction insert fails in getCreditHistory', async () => {
      const mockSeller = { id: 'v-1', name: 'Seller' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
        freeCreditsAllocated: 5,
        unlockedRfqIds: ['rfq-1'],
      });
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockResolvedValue([]);
      jest.spyOn(domainQueries, 'recordCreditTransactionInDB')
        .mockResolvedValueOnce({ id: 'vtx-init' })
        .mockRejectedValueOnce(new Error('Duplicate unlock key'));

      const req = createMockReq({ params: { id: 'v-1' } });
      const res = createMockRes();
      const next = jest.fn();

      await vendorDossierExtensions.getCreditHistory(req, res, next);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('covers all transaction types and deduction formatting in getCreditHistory', async () => {
      const mockSeller = { id: 'v-1', name: 'Seller' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);
      jest.spyOn(storeService, 'getVendorRfqCredits').mockReturnValue({
        freeCreditsAllocated: 10,
        unlockedRfqIds: [],
        isSubscribed: true,
        subscriptionPlan: 'Enterprise Pro',
      });
      const txs = [
        { id: 'tx-1', amount: 5, balance_after: 15, transaction_type: 'INITIAL_ALLOCATION', created_at: '2026-01-01' },
        { id: 'tx-2', amount: 10, balance_after: 25, transaction_type: 'UPGRADE_BONUS' },
        { id: 'tx-3', amount: -2, balance_after: 23, transaction_type: 'RFQ_UNLOCK', rfq_id: 'rfq-99', idempotency_key: 'idem-1' },
        { id: 'tx-4', amount: 3, balance_after: 26, description: 'Manual credit added' },
      ];
      jest.spyOn(domainQueries, 'getVendorCreditTransactionsFromDB').mockResolvedValue(txs);

      const req = createMockReq({ params: { id: 'v-1' } });
      const res = createMockRes();
      await vendorDossierExtensions.getCreditHistory(req, res, jest.fn());
      expect(res.statusCode).toBe(200);
      expect(res.body.transactions.length).toBe(4);
      expect(res.body.transactions[0].creditSource).toBe('Free Tier Allocation');
      expect(res.body.transactions[1].creditSource).toBe('Subscription Upgrade');
      expect(res.body.transactions[2].creditsConsumed).toBe(2);
      expect(res.body.transactions[3].description).toBe('Manual credit added');
    });

    it('covers recordVendorCommunication delivery and error handling branches', async () => {
      const paymentDuesQueries = require('../src/db/paymentDuesQueries');
      const eventOutboxService = require('../src/services/eventOutboxService');
      const mailerService = require('../src/services/mailerService');

      const mockSeller = { id: 'v-comm', name: 'Comm Seller', email: 'comm@seller.com' };
      jest.spyOn(storeService, 'getVendorById').mockReturnValue(mockSeller);

      // 1. pool.hasStorage() = true, dispatchDueEventOutboxJobs throws
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(paymentDuesQueries, 'recordCommunication').mockResolvedValue({ id: 'comm-1' });
      jest.spyOn(eventOutboxService, 'dispatchDueEventOutboxJobs').mockRejectedValue(new Error('Outbox failure'));
      jest.spyOn(paymentDuesQueries, 'getCommunicationById').mockResolvedValue({ id: 'comm-1', status: 'Queued' });

      const req1 = createMockReq({
        params: { id: 'v-comm' },
        body: { channel: 'EMAIL', recipient: 'comm@seller.com', subject: 'Notice', message: 'Hello' },
      });
      const res1 = createMockRes();
      await vendorDossierExtensions.recordVendorCommunication(req1, res1, jest.fn());
      expect(res1.statusCode).toBe(201);

      // 2. getCommunicationById returns null, then throws
      jest.spyOn(paymentDuesQueries, 'getCommunicationById')
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('DB lookup fail'));

      const res2a = createMockRes();
      await vendorDossierExtensions.recordVendorCommunication(req1, res2a, jest.fn());
      expect(res2a.statusCode).toBe(201);

      const res2b = createMockRes();
      await vendorDossierExtensions.recordVendorCommunication(req1, res2b, jest.fn());
      expect(res2b.statusCode).toBe(201);

      // 3. pool.hasStorage() = false, mailerService.deliver is not a function
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const originalDeliver = mailerService.deliver;
      mailerService.deliver = null;
      jest.spyOn(paymentDuesQueries, 'updateCommunicationDeliveryStatus').mockResolvedValue(null);

      const res3 = createMockRes();
      await vendorDossierExtensions.recordVendorCommunication(req1, res3, jest.fn());
      expect(res3.statusCode).toBe(201);

      mailerService.deliver = originalDeliver;
    });
  });

  describe('Domain Queries direct execution', () => {
    it('getVendorsUploadedByBuyerFromDB returns empty when pool has no storage', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(false);
      const result = await domainQueries.getVendorsUploadedByBuyerFromDB('buyer-1');
      expect(result).toEqual([]);
    });

    it('getVendorsUploadedByBuyerFromDB queries DB and maps records', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB').mockResolvedValue(null);

      const mockDbRows = [
        {
          id: 'v-1',
          name: 'Vendor One',
          company_name: 'Vendor One Corp',
          contact_person: 'Contact A',
          email: 'a@v.com',
          phone: '9876543210',
          created_at: new Date('2026-11-01'),
          status: 'ACTIVE',
          major_category: 'Mechanical',
          city: 'Bangalore',
          state: 'KA',
          pincode: '560001',
          raw: {
            source: 'buyer_uploaded',
            gstin: '29ABCDE1234F1Z5',
            pan: 'ABCDE1234F',
          },
        },
      ];
      jest.spyOn(pool, 'query').mockImplementation(async () => ({ rows: JSON.parse(JSON.stringify(mockDbRows)) }));

      const { queryCache } = require('../src/db/queryCache');
      queryCache.invalidate('vendors');
      const result = await domainQueries.getVendorsUploadedByBuyerFromDB('buyer-unique-test-1', 'b@org.com', 'Buyer Org');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('v-1');
      expect(result[0].companyName).toBe('Vendor One Corp');
      expect(result[0].gstin).toBe('29ABCDE1234F1Z5');
      expect(result[0].pan).toBe('ABCDE1234F');
    });

    it('getAssociatedBuyersForVendorFromDB returns empty when vendor is missing', async () => {
      const result = await domainQueries.getAssociatedBuyersForVendorFromDB(null);
      expect(result).toEqual([]);
    });

    it('getAssociatedBuyersForVendorFromDB resolves buyer accounts from DB', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const mockVendor = {
        id: 'v-1',
        buyerId: 'b-1',
        buyerEmail: 'veera@buyer.com',
        raw: {
          addedByBuyerCompany: 'Veera solutions pvt ltd',
        },
      };

      const mockBuyerRows = [
        {
          id: 'b-1',
          organization_name: 'Veera solutions pvt ltd',
          contact_person: 'Veera',
          corporate_email: 'veera@buyer.com',
          mobile_number: '9381877013',
          created_at: new Date('2026-10-13'),
          status: 'ACTIVE_VERIFIED',
          sourcing_mode: 'Mode 1',
          subscription_plan: 'Version_3',
          raw: {
            location: 'Hyderabad',
          },
        },
      ];

      jest.spyOn(pool, 'query').mockImplementation(async () => ({ rows: mockBuyerRows }));

      const result = await domainQueries.getAssociatedBuyersForVendorFromDB(mockVendor);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('b-1');
      expect(result[0].companyName).toBe('Veera solutions pvt ltd');
      expect(result[0].sourcingMode).toBe('Mode 1');
    });

    it('getActiveCategoryMatchedRFQsForVendorFromDB returns empty when vendor is missing', async () => {
      const result = await domainQueries.getActiveCategoryMatchedRFQsForVendorFromDB(null);
      expect(result).toEqual([]);
    });

    it('getActiveCategoryMatchedRFQsForVendorFromDB queries active RFQs matching vendor category', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const mockVendor = {
        id: 'v-1',
        majorCategory: 'Mechanical & Fluid Equipment',
        categories: ['Mechanical & Fluid Equipment'],
      };

      const futureDate = new Date(Date.now() + 86400000 * 10).toISOString();
      const mockRfqRows = [
        {
          id: 'rfq-1',
          rfq_number: 'RFQ-2026-101',
          title: 'Centrifugal Pumps',
          category: 'Mechanical & Fluid Equipment',
          status: 'PUBLISHED',
          created_at: new Date('2026-11-15'),
          raw: {
            buyerAccountName: 'Veera solutions pvt ltd',
            deliveryLocation: 'Bengaluru, KA',
            deadline: futureDate,
            budget: 1200000,
            sourcingMode: 'Direct',
            extractedEntities: [],
          },
        },
      ];

      jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: mockRfqRows });

      const result = await domainQueries.getActiveCategoryMatchedRFQsForVendorFromDB(mockVendor);
      expect(result.length).toBe(1);
      expect(result[0].rfqNumber).toBe('RFQ-2026-101');
      expect(result[0].buyerCompanyName).toBe('Veera solutions pvt ltd');
      expect(result[0].budget).toBe(1200000);
    });

    it('covers all deep branch conditions in domainQueries for dossier enhancements', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);

      // 1. getVendorsUploadedByBuyerFromDB: buyerId array, account with orgName, lookup throws
      jest.spyOn(domainQueries, 'getBuyerAccountByEmailFromDB')
        .mockResolvedValueOnce({ id: 'acc-1', organizationName: 'Org By Email' })
        .mockRejectedValueOnce(new Error('Network error on email lookup'));

      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });

      const resArr = await domainQueries.getVendorsUploadedByBuyerFromDB(['b-arr-1', 'b-arr-2'], 'user@test.com', 'Org Corp');
      expect(Array.isArray(resArr)).toBe(true);

      // 2. getAssociatedBuyersForVendorFromDB: vendor with phone/email, related rows, vmrResult, company candidates, query error, fallback
      const richVendor = {
        id: 'v-rich',
        email: 'rich@vendor.com',
        phone: '9998887777',
        buyerId: 'b-rich-1',
        buyerEmail: 'client@buyer.com',
        addedByBuyerCompany: 'Rich Corp',
      };

      const relatedRow = {
        raw: {
          buyerId: 'b-rel-1',
          buyerAccountId: 'acc-rel-1',
          buyerEmail: 'rel@buyer.com',
          addedByBuyerCompany: 'Rel Corp',
        },
      };

      // Mock sequence of queries in getAssociatedBuyersForVendorFromDB:
      // 1: relatedResult
      // 2: vmrResult
      // 3: buyersResult
      jest.spyOn(pool, 'query')
        .mockResolvedValueOnce({ rows: [relatedRow] })
        .mockResolvedValueOnce({ rows: [{ organization_id: 'org-vmr-1' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'b-rich-1',
            organization_name: 'Rich Corp',
            corporate_email: 'client@buyer.com',
            raw: { companyName: 'Rich Corp' },
          }],
        });

      const buyersRich = await domainQueries.getAssociatedBuyersForVendorFromDB(richVendor);
      expect(buyersRich.length).toBeGreaterThanOrEqual(1);

      // 3. getAssociatedBuyersForVendorFromDB: error branches
      jest.spyOn(pool, 'query')
        .mockRejectedValueOnce(new Error('Related rows query failed'))
        .mockRejectedValueOnce(new Error('VMR query failed'))
        .mockRejectedValueOnce(new Error('Buyers query failed'));

      const fallbackVendor = {
        id: 'v-fallback-only',
        email: 'fallback@vendor.com',
        phone: '9991112222',
        addedByBuyerCompany: 'Fallback Buyer Only',
        city: 'Delhi',
      };
      const fallbackBuyers = await domainQueries.getAssociatedBuyersForVendorFromDB(fallbackVendor);
      expect(fallbackBuyers.length).toBe(1);
      expect(fallbackBuyers[0].name).toBe('Fallback Buyer Only');

      // 4. getActiveCategoryMatchedRFQsForVendorFromDB: pool.query throws
      jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('RFQs table locked'));
      const emptyRfqs = await domainQueries.getActiveCategoryMatchedRFQsForVendorFromDB({ id: 'v-1' });
      expect(emptyRfqs).toEqual([]);

      // 5. getActiveCategoryMatchedRFQsForVendorFromDB: expired RFQ and extractedEntities category match
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const rfqRows = [
        // Expired closingDate -> skipped
        {
          id: 'rfq-expired',
          status: 'Quotes Pending',
          raw: { closingDate: pastDate, category: 'Hardware' },
        },
        // Extracted entities match
        {
          id: 'rfq-entities',
          status: 'Quotes Pending',
          raw: {
            closingDate: futureDate,
            category: 'Unmatched Category',
            extractedEntities: [{ majorCategory: 'Hardware' }],
          },
        },
      ];

      jest.spyOn(pool, 'query').mockResolvedValueOnce({ rows: rfqRows });
      const storeService = require('../src/services/storeService');
      jest.spyOn(storeService, 'vendorCoversCategory').mockImplementation((v, cat) => cat === 'Hardware');

      const matchedRfqs = await domainQueries.getActiveCategoryMatchedRFQsForVendorFromDB({ id: 'v-1', majorCategory: 'Hardware' });
      expect(matchedRfqs.length).toBe(1);
      expect(matchedRfqs[0].id).toBe('rfq-entities');

      // 6. executePincodeTieredPublicVendorQuery: single arm stage (digits.length <= 3)
      const mockVendorRow = { id: 'v-pin-1', raw: { id: 'v-pin-1', pincode: '560001', majorCategory: 'Hardware' } };
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [mockVendorRow] });

      const pinStage1 = await domainQueries.getPublicVendorsMatchingCategories(['Hardware'], { pincode: '56' });
      expect(Array.isArray(pinStage1)).toBe(true);

      // 7. getVendorByEmailFromDB: negative cache branches
      jest.spyOn(pool, 'query').mockResolvedValue({ rows: [] });
      const nonExistent = await domainQueries.getVendorByEmailFromDB('nonexistent@vendor.test');
      expect(nonExistent).toBeNull();

      // Hit cached negative
      const cachedNonExistent = await domainQueries.getVendorByEmailFromDB('nonexistent@vendor.test', { fresh: false });
      expect(cachedNonExistent).toBeNull();
    });
  });
});

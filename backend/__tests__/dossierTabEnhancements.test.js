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
      jest.spyOn(pool, 'query').mockImplementation(async () => ({ rows: mockDbRows }));

      const result = await domainQueries.getVendorsUploadedByBuyerFromDB('buyer-1', 'b@org.com', 'Buyer Org');
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
  });
});

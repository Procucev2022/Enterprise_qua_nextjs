const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const {
  parseDateRange,
  formatMode,
  formatDateISO,
  formatDateTimeISO,
  str,
  getBuyerLocation,
  getBuyerLastLogin,
  getVendorLocation,
  getVendorLastLogin,
  findBuyer,
  findVendor,
  getSellerReports,
  getBuyerReports,
  getRfqReports,
  getDailyActivityReport,
} = require('../src/controllers/reportsController');
const { RFQ_MODES, RFQ_MODE_LABELS } = require('../src/config/constants');
const { authHeader } = require('./testHelpers');

describe('Reports Controller & Endpoints Suite', () => {
  beforeEach(() => {
    storeService.reset();
  });

  describe('Helper Functions', () => {
    test('parseDateRange with valid dates', () => {
      const { fromDate, toDate } = parseDateRange('2026-01-01', '2026-01-10');
      expect(fromDate.getFullYear()).toBe(2026);
      expect(fromDate.getMonth()).toBe(0);
      expect(fromDate.getDate()).toBe(1);
      expect(fromDate.getHours()).toBe(0);
      expect(toDate.getDate()).toBe(10);
      expect(toDate.getHours()).toBe(23);
    });

    test('parseDateRange with invalid date strings falls back to defaults', () => {
      const { fromDate, toDate } = parseDateRange('invalid-date', 'another-invalid');
      expect(fromDate).toBeInstanceOf(Date);
      expect(toDate).toBeInstanceOf(Date);
      expect(fromDate.getTime()).toBeLessThan(toDate.getTime());

      const res1 = parseDateRange('2026-01-01', 'invalid-end');
      expect(res1.fromDate.getFullYear()).toBe(2026);
      expect(res1.toDate).toBeInstanceOf(Date);

      const res2 = parseDateRange('invalid-start', '2026-01-10');
      expect(res2.fromDate).toBeInstanceOf(Date);
      expect(res2.toDate.getDate()).toBe(10);
    });

    test('parseDateRange with undefined params', () => {
      const { fromDate, toDate } = parseDateRange(undefined, undefined);
      expect(fromDate).toBeInstanceOf(Date);
      expect(toDate).toBeInstanceOf(Date);
    });

    test('parseDateRange with unbounded and end-only parameters', () => {
      const unbounded = parseDateRange('', '');
      expect(unbounded.fromDate.getTime()).toBe(0);

      const unboundedAll = parseDateRange('all', 'all');
      expect(unboundedAll.fromDate.getTime()).toBe(0);

      const endOnly = parseDateRange(null, '2026-05-15');
      expect(endOnly.fromDate.getTime()).toBe(0);
      expect(endOnly.toDate.getDate()).toBe(15);
    });

    test('formatMode handles valid, missing, and fallback modes', () => {
      expect(formatMode(null)).toBe('Mode 0');
      expect(formatMode('')).toBe('Mode 0');
      expect(formatMode(RFQ_MODES.MODE_1)).toBe(RFQ_MODE_LABELS[RFQ_MODES.MODE_1]);
      expect(formatMode(RFQ_MODES.MODE_2)).toBe(RFQ_MODE_LABELS[RFQ_MODES.MODE_2]);
      expect(formatMode(RFQ_MODES.MODE_3)).toBe(RFQ_MODE_LABELS[RFQ_MODES.MODE_3]);
      expect(formatMode('custom_mode')).toBe('custom_mode');
    });

    test('formatDateISO and formatDateTimeISO handle valid, empty and invalid values', () => {
      expect(formatDateISO('')).toBe('');
      expect(formatDateISO(null)).toBe('');
      expect(formatDateISO('invalid-date')).toBe('');
      expect(formatDateISO('2026-05-15T12:00:00Z')).toBe('2026-05-15');

      expect(formatDateTimeISO('')).toBe('');
      expect(formatDateTimeISO(null)).toBe('');
      expect(formatDateTimeISO('invalid-date')).toBe('');
      expect(formatDateTimeISO('2026-05-15T12:30:45Z')).toBe('2026-05-15 12:30:45');
    });

    test('str handles truthy and fallback values', () => {
      expect(str('hello', 'default')).toBe('hello');
      expect(str('', 'fallback')).toBe('fallback');
      expect(str(null, 'fallback')).toBe('fallback');
      expect(str(undefined, 'fallback')).toBe('fallback');
      expect(str(123)).toBe('123');
    });

    test('findBuyer matches by ID, organizationName, corporateEmail, or returns null', () => {
      const buyers = [
        { id: 'b1', organizationName: 'Acme Corp', corporateEmail: 'procure@acme.com' },
        { id: 'b2', organizationName: 'Beta Ltd', corporateEmail: 'buy@beta.com' },
      ];
      expect(findBuyer(buyers, { buyerAccountId: 'b1' })?.id).toBe('b1');
      expect(findBuyer(buyers, { buyerAccountName: 'Beta Ltd' })?.id).toBe('b2');
      expect(findBuyer(buyers, { raisedByEmail: 'procure@acme.com' })?.id).toBe('b1');
      expect(findBuyer(buyers, { buyerAccountId: 'none' })).toBeNull();
    });

    test('findVendor matches by id, email, or name across arrays, Maps, and fallbacks', () => {
      const vendors = [
        { id: 'v1', name: 'Vendor 1', email: 'v1@test.com' },
        { id: 'v2', name: 'Vendor 2', email: 'v2@test.com' },
      ];
      expect(findVendor(vendors, 'v1', null)?.name).toBe('Vendor 1');
      expect(findVendor(vendors, null, 'Vendor 2')?.id).toBe('v2');
      expect(findVendor(vendors, null, null, 'v1@test.com')?.id).toBe('v1');
      expect(findVendor(vendors, 'unknown', 'unknown')).toBeNull();
      expect(findVendor(null, 'v1')).toBeNull();
      expect(findVendor({}, 'v1')).toBeNull();

      const map = new Map();
      map.set('v1', vendors[0]);
      map.set('v1@test.com', vendors[0]);
      map.set('vendor 1', vendors[0]);
      expect(findVendor(map, 'v1')).toBe(vendors[0]);
      expect(findVendor(map, null, null, 'v1@test.com')).toBe(vendors[0]);
      expect(findVendor(map, null, 'Vendor 1')).toBe(vendors[0]);
      expect(findVendor(map, 'none', 'none', 'none')).toBeNull();
    });

    test('getBuyerLocation covers city, state, primaryPlantLocation, location, address, country, and rfq fallbacks', () => {
      expect(getBuyerLocation({ city: 'Pune', state: 'MH' })).toBe('Pune, MH');
      expect(getBuyerLocation({ city: 'Pune' })).toBe('Pune');
      expect(getBuyerLocation({ primaryPlantLocation: 'Noida' })).toBe('Noida');
      expect(getBuyerLocation({ location: 'Gurgaon' })).toBe('Gurgaon');
      expect(getBuyerLocation({ address: 'Delhi' })).toBe('Delhi');
      expect(getBuyerLocation({ country: 'India' })).toBe('India');
      expect(getBuyerLocation(null, { deliveryLocation: 'Kolkata' })).toBe('Kolkata');
      expect(getBuyerLocation(null, null)).toBe('All India');
    });

    test('getBuyerLastLogin covers authentic lastLogin and returns empty string when missing', () => {
      expect(getBuyerLastLogin({ lastLogin: '2026-03-01T12:00:00Z' })).toBe('2026-03-01 12:00:00');
      expect(getBuyerLastLogin({ lastLoginDate: '2026-03-02T12:00:00Z' })).toBe('2026-03-02 12:00:00');
      expect(getBuyerLastLogin({ last_login_at: '2026-03-03T12:00:00Z' })).toBe('2026-03-03 12:00:00');
      expect(getBuyerLastLogin(null, { createdAt: '2026-03-04T12:00:00Z' })).toBe('');
      expect(getBuyerLastLogin(null, null)).toBe('');
    });

    test('getVendorLocation covers location, city, state, country, and fallback', () => {
      expect(getVendorLocation({ location: 'Chennai' })).toBe('Chennai');
      expect(getVendorLocation({ city: 'Pune', state: 'MH' })).toBe('Pune, MH');
      expect(getVendorLocation({ city: 'Pune' })).toBe('Pune');
      expect(getVendorLocation({ country: 'Germany' })).toBe('Germany');
      expect(getVendorLocation(null, 'Custom Fallback')).toBe('Custom Fallback');
    });

    test('getVendorLastLogin covers authentic lastLogin and returns empty string when missing', () => {
      expect(getVendorLastLogin({ lastLogin: '2026-03-01T12:00:00Z' })).toBe('2026-03-01 12:00:00');
      expect(getVendorLastLogin({ lastLoginDate: '2026-03-02T12:00:00Z' })).toBe('2026-03-02 12:00:00');
      expect(getVendorLastLogin({ last_login_at: '2026-03-03T12:00:00Z' })).toBe('2026-03-03 12:00:00');
      expect(getVendorLastLogin(null, '2026-03-03T12:00:00Z')).toBe('');
      expect(getVendorLastLogin(null, null)).toBe('');
    });
  });

  describe('Seller Reports', () => {
    test('GET /api/reports/seller-report defaults to sellerReport and returns RFQ vendor interactions', async () => {
      storeService.vendors = [
        {
          id: 'v-1',
          name: 'Apex Industrial',
          email: 'sales@apex.com',
          phone: '+919876543210',
          location: 'Pune',
          source: 'procucev_network',
          lastLogin: '2026-03-01T10:00:00Z',
          updated_at: '2026-03-01T10:00:00Z',
        },
        {
          id: 'v-2',
          name: 'Precision Castings',
          email: 'info@precision.com',
          phone: '+919876543211',
          city: 'Kolhapur',
          created_at: '2026-02-01T10:00:00Z',
        },
      ];

      storeService.rfqs = [
        {
          id: 'rfq-1',
          rfqNumber: 'RFQ-2026-001',
          createdAt: new Date().toISOString(),
          sourcingMode: RFQ_MODES.MODE_1,
          deliveryLocation: 'Mumbai Plant',
          status: 'Quotes Submitted',
          title: 'Precision Bearings',
          assignedVendors: [
            { id: 'v-1', name: 'Apex Industrial', email: 'sales@apex.com', phone: '+919876543210', city: 'Pune' },
            { id: 'v-assigned-only', name: 'Assigned Without Quote', email: 'none@vendor.com', phone: '123' },
          ],
          quotes: [
            {
              vendorId: 'v-1',
              vendorName: 'Apex Industrial',
              submittedAt: new Date().toISOString(),
              remarks: 'Offered best tier pricing',
            },
            {
              vendorId: 'v-unassigned-quote',
              vendorName: 'Unassigned Quoter',
              submittedAt: new Date().toISOString(),
            },
          ],
        },
        {
          id: 'rfq-2',
          rfqNumber: 'RFQ-2026-002',
          createdAt: new Date().toISOString(),
          sourcingMode: RFQ_MODES.MODE_0,
          deliveryLocation: 'Delhi',
          status: 'Quotes Pending',
          title: 'Copper Rods',
          assignedVendors: [],
          quotes: [],
        },
        {
          id: 'rfq-old',
          rfqNumber: 'RFQ-2025-OLD',
          createdAt: '2025-01-01T00:00:00Z', // Past date out of range
          assignedVendors: [],
          quotes: [],
        },
        {
          id: 'rfq-future',
          rfqNumber: 'RFQ-2099-FUTURE',
          createdAt: '2099-01-01T00:00:00Z', // Future date out of range
          assignedVendors: [],
          quotes: [],
        },
        {
          id: 'rfq-nodate',
          rfqNumber: 'RFQ-NODATE',
          createdAt: null, // Null createdAt
          assignedVendors: [],
          quotes: [],
        },
      ];

      const res = await request(app).get('/api/reports/seller-report?requestType=sellerReport').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.reportType).toBe('sellerReport');
      expect(res.body.totalRecords).toBe(5); // 3 vendors on rfq-1 + 1 empty rfq-2 + 1 nodate rfq
      expect(res.body.data[0].SellerCompanyName).toBe('Apex Industrial');
      expect(res.body.data[0].SourcingMode).toBe('Mode 1');
      expect(res.body.data[0].CompanyLocation).toBe('Pune');
      expect(res.body.data[0].LastLogin).toBeTruthy();
    });

    test('GET /api/reports/seller-report?requestType=sellerSummary returns vendor registration and plan data', async () => {
      storeService.vendors = [
        {
          id: 'v-1',
          name: 'Steel Dynamics',
          contactPerson: 'Rajesh Sharma',
          phone: '+919876500000',
          email: 'rajesh@steeldynamics.in',
          location: 'Ahmedabad',
          majorCategory: 'Metals & Alloys',
          subscriptionPlan: 'enterprise',
          rfqDownloadsUsed: 12,
          status: 'ACTIVE',
          created_at: new Date().toISOString(),
        },
        {
          id: 'v-fallback',
          name: 'Fallback Vendor Ltd',
          city: 'Vadodara',
          created_at: new Date().toISOString(),
        },
        {
          id: 'v-old',
          name: 'Ancient Supplier',
          created_at: '2020-01-01T00:00:00Z',
        },
        {
          id: 'v-nocreated',
          name: 'No Date Supplier',
          created_at: null,
        },
      ];

      const res = await request(app).get('/api/reports/seller-report?requestType=sellerSummary').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalRecords).toBe(2);
      expect(res.body.data[0].CompanyName).toBe('Steel Dynamics');
      expect(res.body.data[0].SubscriptionPlan).toBe('enterprise');
      expect(res.body.data[1].CompanyLocation).toBe('Vadodara');
    });

    test('GET /api/reports/seller-report?requestType=sellerCategoryReport returns category mappings', async () => {
      storeService.vendors = [
        {
          id: 'v-cat1',
          name: 'Polymer Tech',
          email: 'poly@tech.in',
          phone: '+919871111111',
          contactPerson: 'Sunil Rao',
          majorCategory: 'Plastics & Polymers',
          minorCategories: ['Engineering Plastics', 'Nylon Rods'],
          lastLogin: '2026-03-01T10:00:00Z',
          created_at: new Date().toISOString(),
        },
        {
          id: 'v-cat2',
          name: 'General Supplies',
          minorCategories: ['Fasteners', 'Bolts', 'Nuts'],
          created_at: new Date().toISOString(),
        },
        {
          id: 'v-nocats',
          name: 'Uncategorized Vendor',
          created_at: new Date().toISOString(),
        },
      ];

      const res = await request(app).get('/api/reports/seller-report?requestType=sellerCategoryReport').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalRecords).toBe(3);
      expect(res.body.data[0].Category1).toBe('Plastics & Polymers');
      expect(res.body.data[0].Category2).toBe('Engineering Plastics');
      expect(res.body.data[0].CompanyLocation).toBeTruthy();
      expect(res.body.data[0].LastLogin).toBeTruthy();
      expect(res.body.data[1].Category1).toBe('Fasteners');
      expect(res.body.data[1].Category2).toBe('Bolts');
      expect(res.body.data[2].Category1).toBe('');
    });

    test('GET /api/reports/seller-report?requestType=sellerSubscriptionReport returns credits and usage metrics', async () => {
      storeService.vendors = [
        {
          id: 'v-sub',
          name: 'Alpha Gear Systems',
          contactPerson: 'Arun K',
          email: 'arun@alphagear.com',
          phone: '+919872222222',
          subscriptionPlan: 'premium',
          rfqDownloadsUsed: 5,
          freeQuotationCredits: 15,
          quotedRfqIds: ['rfq-1', 'rfq-2'],
          status: 'ACTIVE',
        },
        {
          id: 'v-sub-defaults',
          name: 'Default Sub Corp',
        },
      ];

      const res = await request(app).get('/api/reports/seller-report?requestType=sellerSubscriptionReport').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].FreeQuotationCredits).toBe(15);
      expect(res.body.data[0].QuotedRFQsCount).toBe(2);
      expect(res.body.data[0].CompanyLocation).toBeTruthy();
      expect(res.body.data[0].LastLogin).toBeDefined();
      expect(res.body.data[1].FreeQuotationCredits).toBe(10);
      expect(res.body.data[1].QuotedRFQsCount).toBe(0);
    });

    test('GET /api/reports/seller-report with invalid requestType returns 400', async () => {
      const res = await request(app).get('/api/reports/seller-report?requestType=unknownType').set(authHeader('category_manager')).expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid requestType');
    });
  });

  describe('Buyer Reports', () => {
    test('GET /api/reports/buyer-report?requestType=buyerReport returns RFQs created by buyers', async () => {
      storeService.buyerAccounts = [
        {
          id: 'b-1',
          organizationName: 'Tata Motors Corp',
          contactPerson: 'Suresh Patel',
          corporateEmail: 'suresh@tatamotors.com',
          mobileNumber: '+919123456789',
          city: 'Pune',
          sourcingMode: RFQ_MODES.MODE_2,
          lastLogin: '2026-03-01T10:00:00Z',
        },
      ];

      storeService.rfqs = [
        {
          id: 'rfq-b1',
          rfqNumber: 'RFQ-TM-01',
          createdAt: new Date().toISOString(),
          buyerAccountId: 'b-1',
          sourcingMode: RFQ_MODES.MODE_2,
          deliveryLocation: 'Pune Assembly',
          title: 'Alloy Wheels 17 inch',
          category: 'Automotive Parts',
          status: 'Quotes Received',
          inquiries: [{}],
        },
        {
          id: 'rfq-b2',
          rfqNumber: 'RFQ-ENTITY-FALLBACK',
          createdAt: new Date().toISOString(),
          sourcingMode: RFQ_MODES.MODE_1,
          extractedEntities: [{ itemName: 'Specialty Gasket', majorCategory: 'Rubber Parts' }],
        },
        {
          id: 'rfq-future-b',
          createdAt: '2099-01-01T00:00:00Z',
        },
        {
          id: 'rfq-old-b',
          createdAt: '2020-01-01T00:00:00Z',
        },
        {
          id: 'rfq-nodate-b',
          createdAt: null,
        },
      ];

      const res = await request(app).get('/api/reports/buyer-report?requestType=buyerReport').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalRecords).toBe(3);
      expect(res.body.data[0].BuyerName).toBe('Suresh Patel');
      expect(res.body.data[0].CompanyName).toBe('Tata Motors Corp');
      expect(res.body.data[0].SourcingMode).toBe('Mode 2');
      expect(res.body.data[0].CompanyLocation).toBe('Pune');
      expect(res.body.data[0].LastLogin).toBeTruthy();
      expect(res.body.data[1].ItemDescription).toBe('Specialty Gasket');
      expect(res.body.data[1].ItemCategory).toBe('Rubber Parts');
    });

    test('GET /api/reports/buyer-report?requestType=buyerSummary returns buyer summary metrics', async () => {
      storeService.buyerAccounts = [
        {
          id: 'b-2',
          organizationName: 'L&T Heavy Engineering',
          contactPerson: 'Manish Verma',
          corporateEmail: 'manish@lnt.com',
          mobileNumber: '+919988776655',
          city: 'Hazira',
          sourcingMode: RFQ_MODES.MODE_3,
          subscriptionPlan: 'enterprise_custom',
          totalRFQsCreated: 24,
          totalSpend: '₹1,50,00,000',
          status: 'ACTIVE_VERIFIED',
          createdDate: new Date().toISOString(),
        },
        {
          id: 'b-fallback',
          organizationName: 'Plant Plant Corp',
          corporateEmail: 'plant@corp.com',
          primaryPlantLocation: 'Dahej',
          createdDate: new Date().toISOString(),
        },
        {
          id: 'b-old',
          organizationName: 'Old Buyer',
          createdDate: '2020-01-01T00:00:00Z',
        },
        {
          id: 'b-nodate',
          organizationName: 'No Date Buyer',
          createdDate: null,
        },
      ];

      const res = await request(app).get('/api/reports/buyer-report?requestType=buyerSummary').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalRecords).toBe(2);
      expect(res.body.data[0].TotalRFQsCreated).toBe(24);
      expect(res.body.data[0].SourcingMode).toBe('Mode 3');
      expect(res.body.data[1].CompanyLocation).toBe('Dahej');
    });

    test('GET /api/reports/buyer-report?requestType=buyerCategoryReport returns category mappings', async () => {
      storeService.buyerAccounts = [
        {
          id: 'b-3',
          organizationName: 'Mahindra & Mahindra',
          contactPerson: 'Karan Mehra',
          corporateEmail: 'karan@mahindra.com',
          supportedMajorCategories: ['Forgings', 'Castings', 'Machined Components'],
        },
        {
          id: 'b-nocats',
          organizationName: 'General Buyer',
          corporateEmail: 'gen@buyer.com',
        },
      ];

      const res = await request(app).get('/api/reports/buyer-report?requestType=buyerCategoryReport').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].Category1).toBe('Forgings');
      expect(res.body.data[0].Category2).toBe('Castings');
      expect(res.body.data[1].Category1).toBe('');
    });

    test('GET /api/reports/buyer-report?requestType=buyerCreditsReport returns credits utilization', async () => {
      storeService.buyerAccounts = [
        {
          id: 'b-4',
          organizationName: 'Bajaj Auto',
          contactPerson: 'Vikram Joshi',
          corporateEmail: 'vikram@bajaj.com',
          remainingFreeRFQs: 2,
          totalRFQsCreated: 8,
          totalSpend: '₹35,00,000',
        },
        {
          id: 'b-default-credits',
          organizationName: 'New Buyer Ltd',
          corporateEmail: 'new@buyer.com',
        },
      ];

      const res = await request(app).get('/api/reports/buyer-report?requestType=buyerCreditsReport').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].RemainingFreeRFQs).toBe(2);
      expect(res.body.data[0].CreditsConsumed).toBe(3);
      expect(res.body.data[1].RemainingFreeRFQs).toBe(5);
      expect(res.body.data[1].CreditsConsumed).toBe(0);
    });

    test('GET /api/reports/buyer-report with invalid requestType returns 400', async () => {
      const res = await request(app).get('/api/reports/buyer-report?requestType=badType').set(authHeader('category_manager')).expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid requestType');
    });
  });

  describe('RFQ Reports', () => {
    test('GET /api/reports/rfq-report?requestType=rfqReport returns performance and turnaround metrics', async () => {
      storeService.buyerAccounts = [
        {
          id: 'b-10',
          organizationName: 'Godrej Industries',
          corporateEmail: 'rfq@godrej.com',
          lastLogin: '2026-03-01T10:00:00Z',
        },
      ];

      storeService.rfqs = [
        {
          id: 'rfq-g1',
          rfqNumber: 'RFQ-GD-100',
          createdAt: new Date().toISOString(),
          buyerAccountId: 'b-10',
          title: 'Sheet Metal Enclosures',
          category: 'Fabrication',
          sourcingMode: RFQ_MODES.MODE_1,
          assignedVendors: [{}, {}],
          quotes: [
            {
              submittedAt: new Date().toISOString(),
            },
          ],
          awardedAmount: 450000,
          status: 'Awarded',
        },
        {
          id: 'rfq-g2',
          rfqNumber: 'RFQ-GD-200',
          createdAt: new Date().toISOString(),
          quotes: [],
        },
        {
          id: 'rfq-future-r',
          createdAt: '2099-01-01T00:00:00Z',
        },
        {
          id: 'rfq-old-r',
          createdAt: '2020-01-01T00:00:00Z',
        },
        {
          id: 'rfq-nodate-r',
          createdAt: null,
        },
      ];

      const res = await request(app).get('/api/reports/rfq-report?requestType=rfqReport').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalRecords).toBe(3);
      expect(res.body.data[0].TotalVendors).toBe(2);
      expect(res.body.data[0].NumberOfQuotesReceived).toBe(1);
      expect(res.body.data[0].AwardedAmount).toContain('4,50,000');
      expect(res.body.data[0].CompanyLocation).toBeTruthy();
      expect(res.body.data[0].LastLogin).toBeTruthy();
      expect(res.body.data[1].NumberOfQuotesReceived).toBe(0);
      expect(res.body.data[1].FirstQuoteDate).toBe('');
    });

    test('GET /api/reports/rfq-report?requestType=rfqSummaryReport with and without quotes', async () => {
      storeService.vendors = [
        {
          id: 'v-quote1',
          name: 'Precision Tools Pvt Ltd',
          phone: '+919999888877',
          email: 'quotes@precisiontools.com',
          city: 'Bangalore',
          majorCategory: 'Cutting Tools',
          lastLogin: '2026-03-01T10:00:00Z',
        },
      ];

      storeService.buyerAccounts = [
        {
          id: 'b-sq1',
          organizationName: 'Enterprise Buyer Ltd',
          lastLogin: '2026-03-01T10:00:00Z',
        },
      ];

      storeService.rfqs = [
        {
          id: 'rfq-sq1',
          rfqNumber: 'RFQ-SQ-01',
          buyerAccountId: 'b-sq1',
          createdAt: new Date().toISOString(),
          sourcingMode: RFQ_MODES.MODE_2,
          quotes: [
            {
              vendorId: 'v-quote1',
              vendorName: 'Precision Tools Pvt Ltd',
              submittedAt: new Date().toISOString(),
              totalPrice: 125000,
              remarks: 'Standard lead time 10 days',
            },
          ],
        },
        {
          id: 'rfq-noquote',
          rfqNumber: 'RFQ-NOQUOTE-02',
          createdAt: new Date().toISOString(),
          sourcingMode: RFQ_MODES.MODE_0,
          quotes: [],
        },
        {
          id: 'rfq-future-sq',
          createdAt: '2099-01-01T00:00:00Z',
        },
        {
          id: 'rfq-old-sq',
          createdAt: '2020-01-01T00:00:00Z',
        },
        {
          id: 'rfq-nodate-sq',
          createdAt: null,
        },
      ];

      const res = await request(app).get('/api/reports/rfq-report?requestType=rfqSummaryReport').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalRecords).toBe(3);
      expect(res.body.data[0].SellerCompanyName).toBe('Precision Tools Pvt Ltd');
      expect(res.body.data[0].QuotedPrice).toContain('1,25,000');
      expect(res.body.data[0].SellerLocation).toBe('Bangalore');
      expect(res.body.data[0].CompanyLocation).toBeTruthy();
      expect(res.body.data[0].LastLogin).toBeTruthy();
      expect(res.body.data[1].SellerCompanyName).toBe('None Yet');
      expect(res.body.data[1].CompanyLocation).toBeTruthy();
      expect(res.body.data[1].LastLogin).toBe('');
    });

    test('GET /api/reports/rfq-report?requestType=dailyRfqDispatchReport returns dispatch stats', async () => {
      storeService.rfqs = [
        {
          id: 'rfq-d1',
          rfqNumber: 'RFQ-D-01',
          createdAt: new Date().toISOString(),
          title: 'CNC Machined Pins',
          sourcingMode: RFQ_MODES.MODE_3,
          budget: 80000,
          chasingActive: true,
          assignedVendors: [{}],
          quotes: [],
        },
        {
          id: 'rfq-d2',
          rfqNumber: 'RFQ-D-02',
          createdAt: new Date().toISOString(),
          title: 'Molded Flanges',
          chasingActive: false,
        },
        {
          id: 'rfq-future-d',
          createdAt: '2099-01-01T00:00:00Z',
        },
        {
          id: 'rfq-old-d',
          createdAt: '2020-01-01T00:00:00Z',
        },
        {
          id: 'rfq-nodate-d',
          createdAt: null,
        },
      ];

      const res = await request(app).get('/api/reports/rfq-report?requestType=dailyRfqDispatchReport').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.totalRecords).toBe(3);
      expect(res.body.data[0].ChaserActive).toBe('YES');
      expect(res.body.data[0].Budget).toContain('80,000');
      expect(res.body.data[0].CompanyLocation).toBeTruthy();
      expect(res.body.data[0].LastLogin).toBe('');
      expect(res.body.data[1].ChaserActive).toBe('NO');
      expect(res.body.data[1].Budget).toBe('');
      expect(res.body.data[1].CompanyLocation).toBeTruthy();
      expect(res.body.data[1].LastLogin).toBe('');
    });

    test('GET /api/reports/rfq-report with invalid requestType returns 400', async () => {
      const res = await request(app).get('/api/reports/rfq-report?requestType=invalid').set(authHeader('category_manager')).expect(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid requestType');
    });
  });

  describe('Daily Activity Report', () => {
    test('GET /api/reports/daily-activity returns aggregated system activity', async () => {
      storeService.rfqs = [
        {
          id: 'rfq-act1',
          createdAt: new Date().toISOString(),
          quotes: [{}, {}],
        },
        {
          id: 'rfq-act-noquotes',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'rfq-act-old',
          createdAt: '2020-01-01T00:00:00Z',
        },
        {
          id: 'rfq-act-future',
          createdAt: '2099-01-01T00:00:00Z',
        },
        {
          id: 'rfq-act-nodate',
          createdAt: null,
        },
      ];
      storeService.buyerAccounts = [
        {
          id: 'b-act1',
          createdDate: new Date().toISOString(),
        },
        {
          id: 'b-act-old',
          createdDate: '2020-01-01T00:00:00Z',
        },
        {
          id: 'b-act-future',
          createdDate: '2099-01-01T00:00:00Z',
        },
        {
          id: 'b-act-nodate',
          createdDate: null,
        },
      ];
      storeService.vendors = [
        {
          id: 'v-act1',
          created_at: new Date().toISOString(),
        },
        {
          id: 'v-act-old',
          created_at: '2020-01-01T00:00:00Z',
        },
        {
          id: 'v-act-future',
          created_at: '2099-01-01T00:00:00Z',
        },
        {
          id: 'v-act-nodate',
          created_at: null,
        },
      ];
      storeService.auditLogs = [
        { id: 'audit-1', timestamp: new Date().toISOString() },
        { id: 'audit-2', timestamp: new Date().toISOString() },
        { id: 'audit-old', timestamp: '2020-01-01T00:00:00Z' },
      ];

      const res = await request(app).get('/api/reports/daily-activity').set(authHeader('category_manager')).expect(200);
      expect(res.body.success).toBe(true);
      expect(res.body.summary.rfqsCreated).toBe(2);
      expect(res.body.summary.quotesReceived).toBe(2);
      expect(res.body.summary.newBuyersRegistered).toBe(1);
      expect(res.body.summary.newVendorsRegistered).toBe(1);
      expect(res.body.summary.totalAuditEvents).toBe(2);
    });
    test('counts quote submissions in range on older RFQ and excludes out-of-range quotes', async () => {
      storeService.rfqs = [
        {
          id: 'rfq-older',
          createdAt: '2026-01-01T00:00:00Z',
          quotes: [
            { id: 'q-1', submittedAt: '2026-03-05T12:00:00Z' },
            { id: 'q-2', submittedAt: '2026-03-08T15:00:00Z' },
            { id: 'q-3', submittedAt: '2026-01-02T10:00:00Z' },
          ],
        },
        {
          id: 'rfq-in-range',
          createdAt: '2026-03-02T00:00:00Z',
          quotes: [
            { id: 'q-4', submittedAt: '2026-04-10T00:00:00Z' },
          ],
        },
      ];

      const res = await request(app)
        .get('/api/reports/daily-activity?startDate=2026-03-01&endDate=2026-03-10')
        .set(authHeader('category_manager'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.summary.rfqsCreated).toBe(1);
      expect(res.body.summary.quotesReceived).toBe(2);
    });
  });

  describe('Controller Direct Error Forwarding Coverage', () => {
    test('getSellerReports calls next(err) on unhandled error', async () => {
      const badReq = {
        get query() {
          throw new Error('Explosion');
        },
      };
      const next = jest.fn();
      await getSellerReports(badReq, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('getBuyerReports calls next(err) on unhandled error', async () => {
      const badReq = {
        get query() {
          throw new Error('Explosion');
        },
      };
      const next = jest.fn();
      await getBuyerReports(badReq, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('getRfqReports calls next(err) on unhandled error', async () => {
      const badReq = {
        get query() {
          throw new Error('Explosion');
        },
      };
      const next = jest.fn();
      await getRfqReports(badReq, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    test('getDailyActivityReport calls next(err) on unhandled error', async () => {
      const badReq = {
        get query() {
          throw new Error('Explosion');
        },
      };
      const next = jest.fn();
      await getDailyActivityReport(badReq, {}, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Storage & Vendor Enrichment Branches', () => {
    const pool = require('../src/db/pool');

    test('getSellerReports enriches vendors from storage and populates Location & LastLogin', async () => {
      storeService.reset();
      const hasStorageSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (typeof sql === 'string' && sql.includes('SELECT id, email, created_at, updated_at, raw FROM vendors')) {
          return {
            rows: [
              {
                id: 'v-storage-1',
                email: 'storage@example.com',
                created_at: '2026-03-01T10:00:00Z',
                updated_at: '2026-03-02T10:00:00Z',
                raw: JSON.stringify({
                  name: 'Storage Vendor',
                  city: 'Bengaluru',
                  state: 'Karnataka',
                  lastLogin: '2026-03-05T12:00:00Z',
                }),
              },
            ],
          };
        }
        return { rows: [] };
      });

      const syncSpy = jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue([]);

      const mockStorageRfqs = [
        {
          id: 'rfq-storage-1',
          rfqNumber: 'RFQ-STORE-1',
          title: 'Storage Bearing Inquiry',
          sourcingMode: RFQ_MODES.MODE_1,
          status: 'Quotes Submitted',
          deliveryLocation: 'Bengaluru',
          createdAt: new Date().toISOString(),
          assignedVendors: [{ id: 'v-storage-1', name: 'Storage Vendor' }],
          quotes: [{ vendorId: 'v-storage-1', vendorName: 'Storage Vendor', totalPrice: 1000, submittedAt: new Date().toISOString() }],
        },
      ];
      const getRfqsSpy = jest.spyOn(storeService, 'getRFQs').mockReturnValue(mockStorageRfqs);

      const res = await request(app).get('/api/reports/seller-report?requestType=sellerReport').set(authHeader('category_manager'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].CompanyLocation).toBe('Bengaluru, Karnataka');
      expect(res.body.data[0].LastLogin).toContain('2026');

      hasStorageSpy.mockRestore();
      querySpy.mockRestore();
      syncSpy.mockRestore();
      getRfqsSpy.mockRestore();
    });

    test('enrichVendors handles storage query errors gracefully', async () => {
      const hasStorageSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const querySpy = jest.spyOn(pool, 'query').mockRejectedValue(new Error('DB Timeout'));
      const syncSpy = jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue(true);

      storeService.rfqs = [
        {
          id: 'rfq-err-1',
          createdAt: '2026-03-01T10:00:00Z',
          assignedVendors: [{ id: 'v-err-1' }],
        },
      ];

      const res = await request(app).get('/api/reports/seller-report?requestType=sellerReport').set(authHeader('category_manager'))
        .expect(200);

      expect(res.body.success).toBe(true);

      hasStorageSpy.mockRestore();
      querySpy.mockRestore();
      syncSpy.mockRestore();
    });

    test('getDailyActivityReport with pool.hasStorage and auditLogs with timestamp in range', async () => {
      const hasStorageSpy = jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const syncSpy = jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue(true);
      const buyersSpy = jest.spyOn(storeService, 'getBuyerAccounts').mockResolvedValue([]);
      const domainQueries = require('../src/db/domainQueries');
      const countSpy = jest.spyOn(domainQueries, 'countVendorsCreatedBetween').mockResolvedValue(5);

      storeService.auditLogs = [
        { action: 'LOGIN', timestamp: '2026-03-02T10:00:00Z' },
        { action: 'NO_DATE' },
      ];

      const res = await request(app).get('/api/reports/daily-activity?startDate=2026-03-01&endDate=2026-03-10').set(authHeader('category_manager'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.summary.newVendorsRegistered).toBe(5);

      hasStorageSpy.mockRestore();
      syncSpy.mockRestore();
      buyersSpy.mockRestore();
      countSpy.mockRestore();
    });
  });
});

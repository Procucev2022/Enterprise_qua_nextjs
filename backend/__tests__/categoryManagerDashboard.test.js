const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');
const categoryManagerRoutes = require('../src/routes/categoryManager');
const controller = require('../src/controllers/categoryManagerDashboardController');
const storeService = require('../src/services/storeService');
const pool = require('../src/db/pool');
const d1Bridge = require('../src/db/d1Bridge');
const directoryKPIQueries = require('../src/db/directoryKPIQueries');
const domainQueries = require('../src/db/domainQueries');
const loginLogsQueries = require('../src/db/loginLogsQueries');
const authService = require('../src/services/authService');
const { D1_OVERLOAD_CONFIG, STORE_HYDRATION_CONFIG } = require('../src/config/constants');

const cmToken = authService.generateSessionToken({
  id: 'cm-tester-1',
  uuid: 'cm-tester-1',
  email: 'cm@procucev.com',
  role: 'category_manager',
});

const vendorToken = authService.generateSessionToken({
  id: 'vendor-tester-1',
  uuid: 'vendor-tester-1',
  email: 'vendor@test.local',
  role: 'vendor',
});

const app = express();
app.use(express.json());
app.use('/api/category-manager', categoryManagerRoutes);

describe('Category Manager Dashboard Backend Suite', () => {
  beforeEach(() => {
    storeService.rfqs = [];
    storeService.buyerAccounts = [];
    storeService.vendors = [];
    loginLogsQueries.inMemoryLogs.clear();
    jest.restoreAllMocks();
  });

  describe('Helper Functions & Coverage Edge Cases', () => {
    test('resolveDateBounds handles presets and custom date boundaries', () => {
      const today = controller.resolveDateBounds('today');
      expect(today.fromDate).toBeInstanceOf(Date);
      expect(today.toDate).toBeInstanceOf(Date);

      const thisWeek = controller.resolveDateBounds('this_week');
      expect(thisWeek.fromDate).toBeInstanceOf(Date);
      expect(thisWeek.toDate).toBeInstanceOf(Date);

      const thisMonth = controller.resolveDateBounds('this_month');
      expect(thisMonth.fromDate).toBeInstanceOf(Date);
      expect(thisMonth.toDate).toBeInstanceOf(Date);

      const empty = controller.resolveDateBounds('', '', '');
      expect(empty.fromDate).toBeNull();
      expect(empty.toDate).toBeNull();

      const explicitAll = controller.resolveDateBounds('', 'all', 'all');
      expect(explicitAll.fromDate).toBeNull();
      expect(explicitAll.toDate).toBeNull();

      const customBoth = controller.resolveDateBounds('', '2026-06-01', '2026-06-30');
      expect(customBoth.fromDate).toBeInstanceOf(Date);
      expect(customBoth.toDate).toBeInstanceOf(Date);

      const customStartOnly = controller.resolveDateBounds('', '2026-06-01', '');
      expect(customStartOnly.fromDate).toBeInstanceOf(Date);
      expect(customStartOnly.toDate).toBeNull();

      const customEndOnly = controller.resolveDateBounds('', '', '2026-06-30');
      expect(customEndOnly.fromDate).toBeNull();
      expect(customEndOnly.toDate).toBeInstanceOf(Date);

      const invalidDates = controller.resolveDateBounds('', 'invalid-date', 'not-a-date');
      expect(invalidDates.fromDate).toBeNull();
      expect(invalidDates.toDate).toBeNull();
    });

    test('resolveDateBounds handles this_week when current day is Sunday', () => {
      const realDate = Date;
      const sundayMock = new Date('2026-11-22T12:00:00Z'); // Sunday
      global.Date = class extends realDate {
        constructor(...args) {
          if (args.length > 0) {
            super(...args);
          } else {
            super(sundayMock.getTime());
          }
        }
      };
      global.Date.now = () => sundayMock.getTime();

      const bounds = controller.resolveDateBounds('this_week');
      expect(bounds.fromDate).toBeInstanceOf(Date);
      expect(bounds.toDate).toBeInstanceOf(Date);

      global.Date = realDate;
    });

    test('isWithinBounds validates timestamps against boundaries correctly', () => {
      expect(controller.isWithinBounds(null, null, null)).toBe(false);
      expect(controller.isWithinBounds('invalid', null, null)).toBe(false);
      expect(controller.isWithinBounds('2026-06-15', null, null)).toBe(true);

      const from = new Date('2026-06-01');
      const to = new Date('2026-06-30');
      expect(controller.isWithinBounds('2026-05-31', from, to)).toBe(false);
      expect(controller.isWithinBounds('2026-07-01', from, to)).toBe(false);
      expect(controller.isWithinBounds('2026-06-15', from, to)).toBe(true);
      expect(controller.isWithinBounds('2026-06-15', from, null)).toBe(true);
      expect(controller.isWithinBounds('2026-06-15', null, to)).toBe(true);
      expect(controller.isWithinBounds('2026-05-15', from, null)).toBe(false);
      expect(controller.isWithinBounds('2026-07-15', null, to)).toBe(false);
    });

    test('isRfqOpen, getQuoteCount, isBuyerSubscribed, and isVendorSubscribed', () => {
      expect(controller.isRfqOpen(null)).toBe(false);
      expect(controller.isRfqOpen({ status: 'OPEN' })).toBe(true);
      expect(controller.isRfqOpen({ status: 'CLOSED' })).toBe(false);
      expect(controller.isRfqOpen({ status: 'EXPIRED' })).toBe(false);

      expect(controller.getQuoteCount(null)).toBe(0);
      expect(controller.getQuoteCount({ quotes: [1, 2] })).toBe(2);
      expect(controller.getQuoteCount({ quotesReceivedCount: 5 })).toBe(5);
      expect(controller.getQuoteCount({})).toBe(0);

      expect(controller.isBuyerSubscribed(null)).toBe(false);
      expect(controller.isBuyerSubscribed({ subscriptionPlan: 'version_3' })).toBe(true);
      expect(controller.isBuyerSubscribed({ subscriptionPlan: 'free_trial' })).toBe(false);
      expect(controller.isBuyerSubscribed({ trialActive: true })).toBe(false);
      expect(controller.isBuyerSubscribed({ isSubscribed: true })).toBe(true);
      expect(controller.isBuyerSubscribed({ raw: '{"subscriptionPlan":"version_1"}' })).toBe(true);
      expect(controller.isBuyerSubscribed({ raw: { trialActive: true } })).toBe(false);
      expect(controller.isBuyerSubscribed({})).toBe(false);

      expect(controller.isVendorSubscribed(null)).toBe(false);
      expect(controller.isVendorSubscribed({ subscriptionPlan: 'connect' })).toBe(true);
      expect(controller.isVendorSubscribed({ subscriptionPlan: 'premium' })).toBe(false);
      expect(controller.isVendorSubscribed({ subscriptionPlan: 'free_tier' })).toBe(false);
      expect(controller.isVendorSubscribed({ subscribedPlan: 'select' })).toBe(true);
      expect(controller.isVendorSubscribed({ isSubscribed: true })).toBe(true);
      expect(controller.isVendorSubscribed({ raw: '{"subscribedPlan":"unlimited"}' })).toBe(true);
      expect(controller.isVendorSubscribed({ raw: { subscriptionPlan: 'connect' } })).toBe(true);
      expect(controller.isVendorSubscribed({})).toBe(false);
    });

    test('getItemDate resolves timestamps across heterogeneous entity shapes and fallbacks', () => {
      expect(controller.getItemDate(null)).toBeNull();
      expect(controller.getItemDate({})).toBeNull();
      expect(controller.getItemDate({ createdAt: 'invalid-date' })).toBeNull();

      expect(controller.getItemDate({ createdAt: '2026-11-01T10:00:00Z' })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ created_at: '2026-11-02T10:00:00Z' })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ creationDate: '2026-11-03T10:00:00Z' })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ creation_date: '2026-11-04T10:00:00Z' })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ timestamp: '2026-11-05T10:00:00Z' })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ loginAt: '2026-11-06T10:00:00Z' })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ login_at: '2026-11-07T10:00:00Z' })).toBeInstanceOf(Date);

      // Raw object and raw JSON string parsing (including malformed JSON handling)
      expect(controller.getItemDate({ raw: '{"createdAt":"2026-11-08T10:00:00Z"}' })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ raw: 'not-valid-json' })).toBeNull();
      expect(controller.getItemDate({ raw: { createdAt: '2026-11-09T10:00:00Z' } })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ raw: { created_at: '2026-11-10T10:00:00Z' } })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ raw: { creationDate: '2026-11-11T10:00:00Z' } })).toBeInstanceOf(Date);
      expect(controller.getItemDate({ raw: { timestamp: '2026-11-12T10:00:00Z' } })).toBeInstanceOf(Date);
    });

    test('loadCollections handles DB storage paths and fallbacks gracefully', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue(true);
      jest.spyOn(storeService, 'syncBuyerAccountsFromDB').mockResolvedValue(true);
      jest.spyOn(storeService, 'getRFQs').mockReturnValue([]);
      jest.spyOn(domainQueries, 'getRFQsFromDB').mockResolvedValue([
        { id: 'rfq-db-1', title: 'DB RFQ', status: 'OPEN', createdAt: '2026-11-01' },
      ]);
      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockResolvedValue({
        accounts: [{ id: 'b-db-1', corporate_email: 'buyer@test.local', company_name: 'DB Buyer' }],
      });
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue([
        { id: 'v-db-1', email: 'vendor@test.local', name: 'DB Vendor' },
      ]);

      const collections = await controller.loadCollections();
      expect(collections.rfqs.length).toBe(1);
      expect(collections.buyers.length).toBe(1);
      expect(collections.vendors.length).toBe(1);
      expect(collections.totalVendorsCount).toBe(1);

      // Branch where DB returns buyer array directly and vendor object with rows & total
      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockResolvedValue([
        { id: 'b-array-1', corporate_email: 'buyer-arr@test.local' },
      ]);
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-row-1', email: 'vrow@test.local' }],
        total: 50,
      });

      const collections2 = await controller.loadCollections();
      expect(collections2.buyers.length).toBe(1);
      expect(collections2.vendors.length).toBe(1);
      expect(collections2.totalVendorsCount).toBe(50);

      // Branch where vendor object has rows without total property
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-row-2', email: 'vrow2@test.local' }],
      });
      const collections3 = await controller.loadCollections();
      expect(collections3.totalVendorsCount).toBe(1);

      // Branch where DB throws
      jest.spyOn(storeService, 'syncRFQsFromDB').mockRejectedValue(new Error('Sync failed'));
      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockRejectedValue(new Error('Buyer DB error'));
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockRejectedValue(new Error('Vendor DB error'));
      storeService.buyerAccounts = [{ id: 'b-mem-1', corporate_email: 'mem@test.local' }];
      storeService.vendors = [{ id: 'v-mem-1', email: 'vmem@test.local' }];

      const fallbackCollections = await controller.loadCollections();
      expect(fallbackCollections.buyers.length).toBe(1);
      expect(fallbackCollections.vendors.length).toBe(1);
    });
  });

  describe('GET /api/category-manager/dashboard/metrics', () => {
    test('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/category-manager/dashboard/metrics');
      expect(res.status).toBe(401);
    });

    test('rejects non-category-manager roles with 403', async () => {
      const res = await request(app)
        .get('/api/category-manager/dashboard/metrics')
        .set('Authorization', `Bearer ${vendorToken}`);
      expect(res.status).toBe(403);
    });

    test('validates bad input query parameters with 400', async () => {
      const res = await request(app)
        .get('/api/category-manager/dashboard/metrics?startDate=' + 'a'.repeat(100))
        .set('Authorization', `Bearer ${cmToken}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns accurate KPI and 6-month chart telemetry with live data', async () => {
      const now = new Date();
      storeService.rfqs = [
        { id: 'rfq-1', rfq_number: 'RFQ1001', status: 'OPEN', createdAt: now.toISOString(), quotes: [] },
        { id: 'rfq-2', rfq_number: 'RFQ1002', status: 'OPEN', createdAt: now.toISOString(), quotes: [{ id: 'q1' }] },
        { id: 'rfq-3', rfq_number: 'RFQ1003', status: 'CLOSED', createdAt: now.toISOString(), quotes: [] },
      ];
      storeService.buyerAccounts = [
        { id: 'b-1', corporate_email: 'buyer1@test.local', subscriptionPlan: 'Enterprise', createdAt: now.toISOString() },
        { id: 'b-2', corporate_email: 'buyer2@test.local', createdAt: now.toISOString() },
      ];
      storeService.vendors = [
        { id: 'v-1', email: 'v1@test.local', subscribedPlan: 'Vendor Pro', createdAt: now.toISOString() },
        { id: 'v-2', email: 'v2@test.local', createdAt: now.toISOString() },
      ];

      loginLogsQueries.inMemoryLogs.set('log_cm_1', {
        id: 'log_cm_1',
        userName: 'Category Staff',
        email: 'staff@procucev.com',
        userType: 'category_manager',
        loginAt: now.toISOString(),
      });
      loginLogsQueries.inMemoryLogs.set('log_buyer_1', {
        id: 'log_buyer_1',
        userName: 'Buyer User',
        email: 'buyer@test.local',
        userType: 'buyer',
        loginAt: now.toISOString(),
      });

      const res = await request(app)
        .get('/api/category-manager/dashboard/metrics?preset=this_month')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.kpi.totalRfqs).toBe(3);
      expect(res.body.kpi.openRfqs).toBe(2);
      expect(res.body.kpi.rfqsWithoutQuotes).toBe(1);
      expect(res.body.kpi.buyerSubscriptions).toBe(1);
      expect(res.body.kpi.vendorSubscriptions).toBe(1);
      expect(res.body.kpi.totalBuyers).toBe(2);
      expect(res.body.kpi.totalVendors).toBe(2);
      expect(res.body.kpi.buyerRegistration).toBe(2);
      expect(res.body.kpi.vendorRegistration).toBe(2);
      // Strictly includes ONLY Category Manager login
      expect(res.body.kpi.totalLogins).toBe(1);

      expect(res.body.charts.months).toHaveLength(6);
      expect(res.body.charts.totalRfqsAndSubs).toHaveLength(6);
      expect(res.body.charts.newRegistrations).toHaveLength(6);
      expect(res.body.charts.activityRfqsVsQuotes).toHaveLength(6);

      const resCustom = await request(app)
        .get('/api/category-manager/dashboard/metrics?startDate=2026-06-01&endDate=2026-06-30')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(resCustom.status).toBe(200);
      expect(resCustom.body.success).toBe(true);
    });

    test('handles errors during metrics calculation and returns 500', async () => {
      const req = {
        get query() {
          throw new Error('Fatal query error');
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.getMetrics(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    test('handles loginLogsQueries failure gracefully during metrics calculation', async () => {
      jest.spyOn(loginLogsQueries, 'listLoginLogs').mockRejectedValueOnce(new Error('Login logs query error'));

      const res = await request(app)
        .get('/api/category-manager/dashboard/metrics')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.kpi.totalLogins).toBe(0);
    });
  });

  describe('GET /api/category-manager/dashboard/records', () => {
    test('validates missing type parameter with 400', async () => {
      const res = await request(app)
        .get('/api/category-manager/dashboard/records')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('validates unrecognized type parameter with 400', async () => {
      const res = await request(app)
        .get('/api/category-manager/dashboard/records?type=unknown_metric_type')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid record type');
    });

    test('returns filtered records for all 10 metric types and supports search', async () => {
      const now = new Date();
      storeService.rfqs = [
        {
          id: 'rfq-alpha',
          rfq_number: 'RFQ-ALPHA-101',
          title: 'Steel Pipes Supply',
          category: 'Metals',
          status: 'OPEN',
          target_budget: 50000,
          quotes: [],
          createdAt: now.toISOString(),
        },
        {
          id: 'rfq-beta',
          rfq_number: 'RFQ-BETA-202',
          title: 'Office Chairs',
          category: 'Furniture',
          status: 'CLOSED',
          quotes: [{ id: 'q1' }],
          createdAt: now.toISOString(),
        },
      ];
      storeService.buyerAccounts = [
        {
          id: 'buyer-alpha',
          corporate_email: 'buyer.alpha@enterprise.com',
          company_name: 'Alpha Corp',
          subscriptionPlan: 'Enterprise Premium',
          raw: JSON.stringify({ contactPerson: 'Alice Buyer', city: 'Mumbai', state: 'MH' }),
          createdAt: now.toISOString(),
        },
        {
          id: 'buyer-beta',
          corporate_email: 'buyer.beta@enterprise.com',
          company_name: 'Beta Corp',
          raw: { contactPerson: 'Bob Buyer' }, // object raw without city
          createdAt: now.toISOString(),
        },
      ];
      storeService.rfqs.push({
        id: 'rfq-gamma',
        rfq_number: 'RFQ-GAMMA-303',
        title: 'Electrical Transformers',
        category: 'Electrical',
        status: 'OPEN',
        quotesReceivedCount: 4,
        created_at: now.toISOString(), // uses created_at to cover branch
      });
      storeService.buyerAccounts.push({
        id: 'buyer-gamma',
        corporate_email: 'gamma@test.local',
        company_name: 'Gamma Corp',
        created_at: now.toISOString(), // uses created_at to cover branch
      });
      storeService.vendors = [
        {
          id: 'vendor-alpha',
          email: 'vendor.alpha@steelworks.com',
          name: 'Alpha Steelworks',
          major_category: 'Metals',
          subscribedPlan: 'Supplier Annual',
          location: 'Pune, Maharashtra',
          createdAt: now.toISOString(),
        },
        {
          id: 'vendor-gamma',
          email: 'gamma@vendor.local',
          name: 'Gamma Vendor',
          created_at: now.toISOString(), // uses created_at to cover branch
        },
      ];
      loginLogsQueries.inMemoryLogs.set('log_cm_99', {
        id: 'log_cm_99',
        userName: 'Priya Sharma',
        email: 'priya.s@procucev.com',
        userType: 'category_manager',
        loginAt: now.toISOString(),
        logoutAt: null,
        durationSeconds: 1200,
        status: 'ACTIVE',
      });

      // 1. total_rfqs
      const r1 = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_rfqs')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r1.status).toBe(200);
      expect(r1.body.total).toBe(3);

      // 2. open_rfqs
      const r2 = await request(app)
        .get('/api/category-manager/dashboard/records?type=open_rfqs')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r2.status).toBe(200);
      expect(r2.body.total).toBe(2);
      expect(r2.body.records[0].rfqNumber).toBe('RFQ-ALPHA-101');

      // 3. rfqs_without_quotes
      const r3 = await request(app)
        .get('/api/category-manager/dashboard/records?type=rfqs_without_quotes')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r3.status).toBe(200);
      expect(r3.body.total).toBe(1);

      // 4. buyer_subscriptions
      const r4 = await request(app)
        .get('/api/category-manager/dashboard/records?type=buyer_subscriptions')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r4.status).toBe(200);
      expect(r4.body.total).toBe(1);
      expect(r4.body.records[0].subscriptionPlan).toBe('Enterprise Premium');

      // 5. total_buyers
      const r5 = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_buyers')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r5.status).toBe(200);
      expect(r5.body.total).toBe(3);

      // 6. buyer_registration
      const r6 = await request(app)
        .get('/api/category-manager/dashboard/records?type=buyer_registration&preset=today')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r6.status).toBe(200);
      expect(r6.body.total).toBe(3);

      // 7. vendor_subscriptions
      const r7 = await request(app)
        .get('/api/category-manager/dashboard/records?type=vendor_subscriptions')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r7.status).toBe(200);
      expect(r7.body.total).toBe(1);

      // 8. total_vendors
      const r8 = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_vendors')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r8.status).toBe(200);
      expect(r8.body.total).toBe(2);

      // 9. vendor_registration
      const r9 = await request(app)
        .get('/api/category-manager/dashboard/records?type=vendor_registration&preset=today')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r9.status).toBe(200);
      expect(r9.body.total).toBe(2);

      // 10. total_logins (CM portal staff logins ONLY)
      const r10 = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_logins')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(r10.status).toBe(200);
      expect(r10.body.total).toBe(1);
      expect(r10.body.records[0].email).toBe('priya.s@procucev.com');

      // Date-bounded records retrieval
      const rDateBounded = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_rfqs&preset=this_month')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(rDateBounded.status).toBe(200);

      const rOpenBounded = await request(app)
        .get('/api/category-manager/dashboard/records?type=open_rfqs&preset=this_month')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(rOpenBounded.status).toBe(200);

      const rWithoutQuotesBounded = await request(app)
        .get('/api/category-manager/dashboard/records?type=rfqs_without_quotes&preset=this_month')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(rWithoutQuotesBounded.status).toBe(200);

      // Quick Search
      const rSearch = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_rfqs&search=Steel')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(rSearch.status).toBe(200);
      expect(rSearch.body.total).toBe(1);
      expect(rSearch.body.records[0].title).toBe('Steel Pipes Supply');

      const rSearchNone = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_rfqs&search=NonExistentMatch')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(rSearchNone.body.total).toBe(0);
    });

    test('handles errors during records retrieval and returns 500', async () => {
      const req = {
        get query() {
          throw new Error('Fatal query error');
        },
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      await controller.getRecords(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    test('handles loginLogsQueries rejection gracefully during total_logins records retrieval', async () => {
      jest.spyOn(loginLogsQueries, 'listLoginLogs').mockRejectedValueOnce(new Error('Login logs query error'));

      const res = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_logins')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.total).toBe(0);
    });
  });

  describe('SQL-First DB Paths (pool.hasStorage() === true)', () => {
    test('loadDashboardMetricsFromDB queries aggregate metrics and monthly charts without truncation', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const now = new Date();
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('AS open_rfqs')) {
          return { rows: [{ total_rfqs: 240, open_rfqs: 10, rfqs_without_quotes: 6 }] };
        }
        if (sql.includes('AS buyer_subscriptions')) {
          return { rows: [{ total_buyers: 1925, buyer_subscriptions: 5 }] };
        }
        if (sql.includes('FROM rfqs GROUP BY ym')) {
          return { rows: [{ ym, rfqs: 160, quotes: 22 }] };
        }
        if (sql.includes('FROM buyer_accounts GROUP BY ym')) {
          return { rows: [{ ym, cnt: 43, subs: 4 }] };
        }
        if (sql.includes('AS m5') && sql.includes('FROM vendors')) {
          return { rows: [{ total_vendors: 633851, m0: 0, m1: 0, m2: 0, m3: 0, m4: 610325, m5: 23526 }] };
        }
        if (sql.includes('SELECT id, created_at, raw FROM vendors')) {
          return {
            rows: [
              {
                id: 'v-paid-1',
                created_at: now.toISOString(),
                raw: JSON.stringify({ subscriptionPlan: 'select' }),
              },
            ],
          };
        }
        if (sql.includes('AS total_vendors FROM vendors')) {
          return { rows: [{ total_vendors: 23526 }] };
        }
        return { rows: [] };
      });

      // All-Time default request
      const resAll = await request(app)
        .get('/api/category-manager/dashboard/metrics')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(resAll.status).toBe(200);
      expect(resAll.body.kpi.totalRfqs).toBe(240);
      expect(resAll.body.kpi.totalBuyers).toBe(1925);
      expect(resAll.body.kpi.buyerSubscriptions).toBe(5);
      expect(resAll.body.kpi.totalVendors).toBe(633851);
      expect(resAll.body.kpi.vendorSubscriptions).toBe(1);
      expect(resAll.body.charts.months).toHaveLength(6);

      // Date-filtered request triggers bounded vendor count branch
      const resMonth = await request(app)
        .get('/api/category-manager/dashboard/metrics?preset=this_month')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(resMonth.status).toBe(200);
      expect(resMonth.body.kpi.totalVendors).toBe(23526);
    });

    test('loadDashboardRecordsFromDB serves SQL-backed drilldown records across all 10 types', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      const now = new Date();

      jest.spyOn(pool, 'query').mockImplementation(async (sql) => {
        if (sql.includes('FROM rfqs')) {
          return {
            rows: [{
              id: 'r1',
              rfq_number: 'RFQ-DB-1',
              status: 'OPEN',
              category: 'Metals',
              created_at: now.toISOString(),
              raw: JSON.stringify({ title: 'DB Steel RFQ', quotes: [] }),
            }],
          };
        }
        if (sql.includes('FROM buyer_accounts')) {
          return {
            rows: [{
              id: 'b1',
              corporate_email: 'paidbuyer@test.local',
              status: 'ACTIVE_VERIFIED',
              created_at: now.toISOString(),
              raw: JSON.stringify({ companyName: 'Paid Corp', subscriptionPlan: 'version_3' }),
            }],
          };
        }
        if (sql.includes('SELECT COUNT(*)::int AS total FROM vendors')) {
          return { rows: [{ total: 633851 }] };
        }
        if (sql.includes('FROM vendors')) {
          return {
            rows: [{
              id: 'v1',
              email: 'paidvendor@test.local',
              major_category: 'Metals',
              status: 'ACTIVE',
              created_at: now.toISOString(),
              raw: JSON.stringify({ name: 'Paid Vendor Co', subscriptionPlan: 'select' }),
            }],
          };
        }
        return { rows: [] };
      });

      const types = [
        'total_rfqs',
        'open_rfqs',
        'rfqs_without_quotes',
        'buyer_subscriptions',
        'total_buyers',
        'buyer_registration',
        'vendor_subscriptions',
        'total_vendors',
        'vendor_registration',
        'total_logins',
      ];

      for (const type of types) {
        const res = await request(app)
          .get(`/api/category-manager/dashboard/records?type=${type}`)
          .set('Authorization', `Bearer ${cmToken}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }

      // Vendor SQL search pushdown branch
      const vSearch = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_vendors&search=Paid&preset=this_month')
        .set('Authorization', `Bearer ${cmToken}`);
      expect(vSearch.status).toBe(200);
      expect(vSearch.body.total).toBe(633851);
      expect(vSearch.body.records[0].email).toBe('paidvendor@test.local');

      // Date-bounded branches across RFQ/Buyer/Vendor SQL record queries
      for (const boundedType of ['open_rfqs', 'buyer_subscriptions', 'vendor_subscriptions']) {
        const resB = await request(app)
          .get(`/api/category-manager/dashboard/records?type=${boundedType}&startDate=2026-10-01&endDate=2026-11-30`)
          .set('Authorization', `Bearer ${cmToken}`);
        expect(resB.status).toBe(200);
      }
    });

    test('handles empty or null DB query responses and listLoginLogs null gracefully', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockResolvedValue(null);
      jest.spyOn(loginLogsQueries, 'listLoginLogs').mockResolvedValueOnce(null);

      const resEmpty = await request(app)
        .get('/api/category-manager/dashboard/metrics?preset=today')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(resEmpty.status).toBe(200);
      expect(resEmpty.body.kpi.totalRfqs).toBe(0);
      expect(resEmpty.body.kpi.totalVendors).toBe(0);
      expect(resEmpty.body.kpi.totalLogins).toBe(0);

      for (const emptyType of ['total_rfqs', 'total_buyers', 'vendor_subscriptions', 'total_vendors']) {
        const resR = await request(app)
          .get(`/api/category-manager/dashboard/records?type=${emptyType}`)
          .set('Authorization', `Bearer ${cmToken}`);
        expect(resR.status).toBe(200);
        expect(resR.body.total).toBe(0);
      }
    });

    test('executes D1 dashboard queries sequentially and passes D1-safe SQL guards and coarse date params', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(d1Bridge, 'getD1Binding').mockReturnValue({ prepare: jest.fn() });
      jest.spyOn(loginLogsQueries, 'listLoginLogs').mockResolvedValue({ logs: [] });

      let inFlight = 0;
      let maxConcurrent = 0;
      const recordedCalls = [];
      jest.spyOn(pool, 'query').mockImplementation(async (text, params, options) => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        recordedCalls.push({ text, params, options });
        await Promise.resolve();
        inFlight -= 1;
        if (text.includes('AS m5')) {
          return { rows: [{ total_vendors: 10, m0: 1, m1: 1, m2: 2, m3: 2, m4: 2, m5: 2 }] };
        }
        if (text.includes('AS total_vendors FROM vendors')) {
          return { rows: [{ total_vendors: 4 }] };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .get('/api/category-manager/dashboard/metrics?preset=this_month')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(res.status).toBe(200);
      expect(maxConcurrent).toBe(1);
      const rfqCall = recordedCalls.find((c) => c.text.includes('AS open_rfqs'));
      expect(rfqCall.options.d1Text).toContain("json_valid(raw) AND json_type(raw, '$.quotes') = 'array'");
      expect(rfqCall.text).toContain("jsonb_typeof(raw->'quotes') = 'array'");
      const boundedVendorCall = recordedCalls.find((c) => c.text.includes('AS total_vendors FROM vendors'));
      expect(boundedVendorCall.options.d1Text).toContain('created_at >= $1 AND datetime(created_at) >= datetime($2)');
      expect(boundedVendorCall.options.d1Params).toHaveLength(4);
    });

    test('surfaces D1 overload errors as retryable 503 with Retry-After on metrics and records endpoints', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(pool, 'query').mockRejectedValue(new Error('D1_ERROR: D1 DB is overloaded'));

      const resMetrics = await request(app)
        .get('/api/category-manager/dashboard/metrics')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(resMetrics.status).toBe(503);
      expect(resMetrics.headers['retry-after']).toBe(String(D1_OVERLOAD_CONFIG.RETRY_AFTER_SECONDS));
      expect(resMetrics.body).toEqual({
        success: false,
        retryable: true,
        error: D1_OVERLOAD_CONFIG.MESSAGE,
      });

      const resRecords = await request(app)
        .get('/api/category-manager/dashboard/records?type=total_rfqs')
        .set('Authorization', `Bearer ${cmToken}`);

      expect(resRecords.status).toBe(503);
      expect(resRecords.headers['retry-after']).toBe(String(D1_OVERLOAD_CONFIG.RETRY_AFTER_SECONDS));
      expect(resRecords.body).toEqual({
        success: false,
        retryable: true,
        error: D1_OVERLOAD_CONFIG.MESSAGE,
      });

      // Fallback when res.setHeader is absent
      const reqNoHeader = { query: {} };
      const resNoHeader = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      await controller.getMetrics(reqNoHeader, resNoHeader);
      expect(resNoHeader.status).toHaveBeenCalledWith(503);
    });

    test('skips store hydration for dashboard routes and keeps migration 0044 partial index aligned', () => {
      expect(STORE_HYDRATION_CONFIG.SKIP_PATHS).toContain('/api/category-manager/dashboard');

      const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
      const normalize = (s) => s.replace(/\s+/g, ' ').trim();
      const d1Sql = normalize(fs.readFileSync(path.join(migrationsDir, '0044_vendors_paid_subscription_index.d1.sql'), 'utf8'));
      const pgSql = normalize(fs.readFileSync(path.join(migrationsDir, '0044_vendors_paid_subscription_index.pg.sql'), 'utf8'));

      expect(d1Sql).toContain(normalize(directoryKPIQueries.PAID_VENDOR_SQL_D1));
      expect(pgSql).toContain(normalize(directoryKPIQueries.PAID_VENDOR_SQL_PG));
    });
  });
});

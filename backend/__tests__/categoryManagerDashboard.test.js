const request = require('supertest');
const express = require('express');
const categoryManagerRoutes = require('../src/routes/categoryManager');
const controller = require('../src/controllers/categoryManagerDashboardController');
const storeService = require('../src/services/storeService');
const pool = require('../src/db/pool');
const domainQueries = require('../src/db/domainQueries');
const loginLogsQueries = require('../src/db/loginLogsQueries');
const authService = require('../src/services/authService');

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
      expect(controller.isBuyerSubscribed({ subscriptionPlan: 'Enterprise Pro' })).toBe(true);
      expect(controller.isBuyerSubscribed({ trialActive: true })).toBe(true);
      expect(controller.isBuyerSubscribed({ isSubscribed: true })).toBe(true);
      expect(controller.isBuyerSubscribed({ raw: '{"subscriptionPlan":"Basic"}' })).toBe(true);
      expect(controller.isBuyerSubscribed({ raw: { trialActive: true } })).toBe(true);
      expect(controller.isBuyerSubscribed({})).toBe(false);

      expect(controller.isVendorSubscribed(null)).toBe(false);
      expect(controller.isVendorSubscribed({ subscriptionPlan: 'Vendor Gold' })).toBe(true);
      expect(controller.isVendorSubscribed({ subscribedPlan: 'Vendor Pro' })).toBe(true);
      expect(controller.isVendorSubscribed({ isSubscribed: true })).toBe(true);
      expect(controller.isVendorSubscribed({ raw: '{"subscribedPlan":"Enterprise"}' })).toBe(true);
      expect(controller.isVendorSubscribed({ raw: { subscriptionPlan: 'Standard' } })).toBe(true);
      expect(controller.isVendorSubscribed({})).toBe(false);
    });

    test('loadCollections handles DB storage paths and fallbacks gracefully', async () => {
      jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
      jest.spyOn(storeService, 'syncRFQsFromDB').mockResolvedValue(true);
      jest.spyOn(domainQueries, 'getBuyerAccountsFromDB').mockResolvedValue([
        { id: 'b-db-1', corporate_email: 'buyer@test.local', company_name: 'DB Buyer' },
      ]);
      jest.spyOn(domainQueries, 'getVendorsPageFromDB').mockResolvedValue({
        rows: [{ id: 'v-db-1', email: 'vendor@test.local', name: 'DB Vendor' }],
      });

      const collections = await controller.loadCollections();
      expect(collections.buyers.length).toBe(1);
      expect(collections.vendors.length).toBe(1);

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
});

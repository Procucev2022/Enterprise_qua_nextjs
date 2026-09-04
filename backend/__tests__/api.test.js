const request = require('supertest');
// RFQ persistence is doubled so these HTTP tests exercise routing, auth and org
// scoping without needing a MySQL connection, which CI does not have. The real
// SQL is covered in rfqQueries.test.js and the id scheme in rfqIdService.test.js.
jest.mock('../src/db/rfqQueries', () => require('./helpers/fakeRfqQueries'));
jest.mock('../src/services/rfqIdService', () => {
  let counter = 0;
  return {
    generateRfqId: jest.fn(async () => {
      counter += 1;
      return `RFQ260409${String(counter).padStart(6, '0')}`;
    }),
  };
});

const app = require('../src/app');
const { authHeader, TEST_USERS } = require('./testHelpers');
const fakeRfqQueries = require('./helpers/fakeRfqQueries');

describe('API Route Endpoints', () => {
  beforeAll(() => {
    fakeRfqQueries.__reset();
  });
  // 1. Bootstrap
  describe('GET /api/bootstrap', () => {
    test('returns unified platform dataset', async () => {
      const res = await request(app).get('/api/bootstrap');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('buyerAccounts');
      expect(res.body.data).toHaveProperty('vendors');
      // RFQs are deliberately absent. This route is anonymous, so shipping the
      // global RFQ array from it is what leaked RFQs across buyer dashboards.
      // They come from the authenticated, org-scoped GET /api/rfqs instead.
      expect(res.body.data).not.toHaveProperty('rfqs');
      expect(res.body.data).toHaveProperty('evaluations');
      expect(res.body.data).toHaveProperty('auditLogs');
      expect(res.body.data).toHaveProperty('aiFeed');
      expect(res.body.data).toHaveProperty('systemConfig');
    });
  });

  // 2. Buyer Accounts
  describe('Buyer Accounts API (/api/buyer-accounts)', () => {
    let testAccountId;

    // Starts empty. The four fabricated companies that used to be here are gone;
    // the signed-in buyer's own account comes from the identity schema via
    // GET /api/buyer-accounts/active, and this list only holds accounts created
    // at runtime.
    test('GET /api/buyer-accounts returns an array', async () => {
      const res = await request(app).get('/api/buyer-accounts');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('POST /api/buyer-accounts creates new buyer account', async () => {
      const newAcc = {
        organizationName: 'Adani Heavy Engineering Ltd.',
        corporateEmail: 'procurement@adani.com',
        contactPerson: 'Karan Adani',
        mobileNumber: '+91 98000 12345',
        industrySector: 'Infrastructure & Port Logistics',
        sourcingMode: 'mode_2',
      };
      const res = await request(app).post('/api/buyer-accounts').set(authHeader('buyer')).send(newAcc);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organizationName).toBe(newAcc.organizationName);
      testAccountId = res.body.data.id;
    });

    test('POST /api/buyer-accounts requires authentication', async () => {
      const res = await request(app).post('/api/buyer-accounts').send({ organizationName: 'Unauthenticated Co' });
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/buyer-accounts returns 400 when missing required fields', async () => {
      const res = await request(app).post('/api/buyer-accounts').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('PUT /api/buyer-accounts/:id updates existing account', async () => {
      const res = await request(app)
        .put(`/api/buyer-accounts/${testAccountId}`)
        .set(authHeader('buyer'))
        .send({ totalSpend: '$500,000' });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalSpend).toBe('$500,000');
    });

    test('PUT /api/buyer-accounts/:id returns 404 for nonexistent account', async () => {
      const res = await request(app).put('/api/buyer-accounts/nonexistent-id').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/buyer-accounts/:id/activate switches active account', async () => {
      const res = await request(app).post(`/api/buyer-accounts/${testAccountId}/activate`).set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('DELETE /api/buyer-accounts/:id deletes account', async () => {
      const res = await request(app).delete(`/api/buyer-accounts/${testAccountId}`).set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('DELETE /api/buyer-accounts/:id returns 404 for nonexistent id', async () => {
      const res = await request(app).delete('/api/buyer-accounts/nonexistent-id').set(authHeader('buyer'));
      expect(res.statusCode).toBe(404);
    });
  });

  // 3. Vendors
  describe('Vendors API (/api/vendors)', () => {
    let testVendorId;

    test('GET /api/vendors returns list of vendors', async () => {
      const res = await request(app).get('/api/vendors');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('POST /api/vendors creates new vendor', async () => {
      const newVendor = {
        name: 'Siemens Energy Spares Pvt Ltd',
        contactPerson: 'Rohan Sharma',
        email: 'rohan.sharma@siemens.com',
        phone: '+91 98333 44555',
        majorCategory: 'Engineering Spares - Electrical',
        minorCategories: ['Turbines', 'Transformers'],
      };
      const res = await request(app).post('/api/vendors').set(authHeader('buyer')).send(newVendor);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe(newVendor.name);
      testVendorId = res.body.data.id;
    });

    test('POST /api/vendors requires authentication', async () => {
      const res = await request(app).post('/api/vendors').send({ name: 'Unauthenticated Vendor', majorCategory: 'X' });
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/vendors returns 400 when missing name or majorCategory', async () => {
      const res = await request(app).post('/api/vendors').set(authHeader('buyer')).send({ email: 'test@vendor.com' });
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/vendors/:id returns vendor details', async () => {
      const res = await request(app).get(`/api/vendors/${testVendorId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(testVendorId);
    });

    test('GET /api/vendors/:id returns 404 when not found', async () => {
      const res = await request(app).get('/api/vendors/invalid-vendor');
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/vendors/:id/rating-revision revises score & rating', async () => {
      const res = await request(app).post(`/api/vendors/${testVendorId}/rating-revision`).set(authHeader('buyer')).send({
        qualityScore: 95,
        costScore: 90,
        deliveryScore: 92,
        remarks: 'Excellent delivery compliance',
      });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.revisionRecord).toHaveProperty('newCompositeScore');
    });

    test('POST /api/vendors/:id/rating-revision returns 400 if scores missing', async () => {
      const res = await request(app).post(`/api/vendors/${testVendorId}/rating-revision`).set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/vendors/:id/onboarding-email returns email preview payload', async () => {
      const res = await request(app).get(`/api/vendors/${testVendorId}/onboarding-email`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
      expect(res.body.data).toHaveProperty('to');
    });

    test('DELETE /api/vendors/:id removes vendor', async () => {
      const res = await request(app).delete(`/api/vendors/${testVendorId}`).set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
    });
  });

  // 4. RFQs
  describe('RFQs API (/api/rfqs)', () => {
    let testRfqId;

    test('GET /api/rfqs returns this buyer organisation\'s RFQs', async () => {
      const res = await request(app).get('/api/rfqs').set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('GET /api/rfqs requires a session', async () => {
      const res = await request(app).get('/api/rfqs');
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/rfqs creates new RFQ and returns 201', async () => {
      const rfq = {
        title: 'Procurement of High Temperature Valves',
        category: 'Engineering Spares - Mechanical',
        budget: 145000,
        targetDeliveryDate: '2026-09-30',
        deadline: '2026-09-30',
        sourcingMode: 'mode_2',
        deliveryLocation: 'Navi Mumbai Plant, Gate 3',
        deliveryPincode: '400701',
      };
      const res = await request(app).post('/api/rfqs').set(authHeader('buyer')).send(rfq);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.title).toBe(rfq.title);
      expect(res.body.data.rfqNumber).toBeDefined();
      testRfqId = res.body.data.id;
    });

    // Vendors price freight against these, so they have to round-trip rather than
    // being dropped the way budget silently was.
    test('POST /api/rfqs persists the delivery location and pincode', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          budget: 90000,
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.deliveryLocation).toBe('Navi Mumbai Plant, Gate 3');
      expect(res.body.data.deliveryPincode).toBe('400701');
      expect(res.body.data.budget).toBe(90000);
    });

    // The budget stays optional even though the destination is now mandatory: a
    // document that prices nothing yields no figure, and requiring one only made
    // buyers invent a ceiling vendors would quote against.
    test('POST /api/rfqs accepts an RFQ with no budget', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Unpriced Spares',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
          deliveryLocation: 'Pune Facility, Dock 2',
          deliveryPincode: '411057',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.budget).toBe(0);
      expect(res.body.data.deliveryLocation).toBe('Pune Facility, Dock 2');
    });

    // Freight is rated on the destination, so an RFQ without one produces quotes
    // that cannot be compared against quotes that have one.
    test('POST /api/rfqs rejects a missing delivery location', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
          deliveryPincode: '400701',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryLocation).toMatch(/delivery location is required/i);
    });

    test('POST /api/rfqs rejects a delivery location shorter than three characters', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
          deliveryLocation: 'X',
          deliveryPincode: '400701',
        });

      // The schema `message` only covers the required case; the shared validator
      // generates its own text for a minLength breach, as it does for `title`.
      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryLocation).toMatch(/at least 3 characters/i);
    });

    test('POST /api/rfqs rejects a missing pincode', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryPincode).toMatch(/pincode is required/i);
    });

    test('POST /api/rfqs rejects a malformed pincode', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Bearing Housings',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '!!',
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryPincode).toMatch(/pincode/i);
    });

    test('POST /api/rfqs accepts an international zipcode', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Export Order for Valves',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
          deliveryLocation: 'Tilbury Docks, Berth 4',
          deliveryPincode: 'SW1A 1AA',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.deliveryPincode).toBe('SW1A 1AA');
    });

    test('POST /api/rfqs requires authentication', async () => {
      const res = await request(app).post('/api/rfqs').send({ title: 'Unauthenticated RFQ' });
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/rfqs returns 400 when title missing', async () => {
      const res = await request(app).post('/api/rfqs').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/rfqs/:id returns RFQ', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}`).set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(testRfqId);
    });

    test('GET /api/rfqs/:id requires a session', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}`);
      expect(res.statusCode).toBe(401);
    });

    // The organisation is part of the query, so another buyer asking for this
    // exact id gets the same 404 as an id that does not exist. That is what
    // stops the endpoint being used to probe other organisations' RFQs.
    test('GET /api/rfqs/:id hides an RFQ belonging to another organisation', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}`).set(authHeader('category_manager'));
      expect(res.statusCode).toBe(404);
    });

    // Quotations are not modelled in qua_enterprice_rfq yet, so this flow still
    // runs against the in-memory store. The RFQ is therefore created through
    // storeService directly rather than over HTTP, which now persists instead.
    // Migrating quotes is the next step; until then the two do not share storage.
    test('POST /api/rfqs/:id/quotes adds quote and recalculates matrix', async () => {
      const storeService = require('../src/services/storeService');
      const inMemoryRfq = storeService.createRFQ({
        title: 'In-memory RFQ for the quote flow',
        category: 'Engineering Spares - Mechanical',
      });

      const quote = {
        vendorName: 'Apex Industrial Dynamics Pvt Ltd',
        unitPrice: 5200,
        totalPrice: 52000,
        leadTimeDays: 10,
        remarks: 'Compliant OEM specification',
      };
      const res = await request(app)
        .post(`/api/rfqs/${inMemoryRfq.id}/quotes`)
        .set(authHeader('vendor'))
        .send(quote);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.quotes.length).toBeGreaterThan(0);
    });

    test('GET /api/rfqs/:id/email-preview generates standard RFQ email', async () => {
      const res = await request(app)
        .get(`/api/rfqs/${testRfqId}/email-preview`)
        .set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
    });

    // The preview embeds quantities, pricing and delivery detail.
    test('GET /api/rfqs/:id/email-preview requires a session', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}/email-preview`);
      expect(res.statusCode).toBe(401);
    });
  });

  // 5. Evaluations & Audit
  describe('Evaluations & Audit API', () => {
    test('GET /api/evaluations and POST /api/evaluations', async () => {
      const getRes = await request(app).get('/api/evaluations');
      expect(getRes.statusCode).toBe(200);

      const postRes = await request(app).post('/api/evaluations').set(authHeader('category_manager')).send({
        vendorName: 'Godrej Precision Tooling',
        moduleScores: { commercial: { score: 95 } },
      });
      expect(postRes.statusCode).toBe(201);
      expect(postRes.body.data.vendorName).toBe('Godrej Precision Tooling');
    });

    test('POST /api/evaluations requires authentication', async () => {
      const res = await request(app).post('/api/evaluations').send({ vendorName: 'Unauthenticated Corp' });
      expect(res.statusCode).toBe(401);
    });

    test('GET /api/audit and verify integrity require authentication', async () => {
      const unauth = await request(app).get('/api/audit');
      expect(unauth.statusCode).toBe(401);

      const getRes = await request(app).get('/api/audit').set(authHeader('admin'));
      expect(getRes.statusCode).toBe(200);

      const verifyRes = await request(app).get('/api/audit/verify').set(authHeader('admin'));
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.body.report.valid).toBe(true);
    });

    test('POST /api/audit creates new log entry', async () => {
      const res = await request(app).post('/api/audit').set(authHeader('buyer')).send({
        userEmail: 'auditor@enterprise.com',
        action: 'Manual compliance check performed',
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data).toHaveProperty('shaSignature');
    });
  });

  // 6. System Config & DB Status
  describe('System Config & DB API', () => {
    test('GET & POST /api/system-config are admin-only', async () => {
      const unauthGet = await request(app).get('/api/system-config');
      expect(unauthGet.statusCode).toBe(401);

      const nonAdminGet = await request(app).get('/api/system-config').set(authHeader('buyer'));
      expect(nonAdminGet.statusCode).toBe(403);

      const getRes = await request(app).get('/api/system-config').set(authHeader('admin'));
      expect(getRes.statusCode).toBe(200);

      const postRes = await request(app).post('/api/system-config').set(authHeader('admin')).send({
        ocrExtractionThreshold: 90,
      });
      expect(postRes.statusCode).toBe(200);
      expect(postRes.body.data.ocrExtractionThreshold).toBe(90);
    });

    test('GET /api/db/status returns health status', async () => {
      const res = await request(app).get('/api/db/status');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('provider');
    });

    test('GET & POST /api/ai-feed', async () => {
      const getRes = await request(app).get('/api/ai-feed');
      expect(getRes.statusCode).toBe(200);

      const postRes = await request(app).post('/api/ai-feed').set(authHeader('buyer')).send({
        title: 'SMS Alert Sent',
        message: 'Notification pushed to supplier.',
      });
      expect(postRes.statusCode).toBe(201);

      const failRes = await request(app).post('/api/ai-feed').set(authHeader('buyer')).send({});
      expect(failRes.statusCode).toBe(400);
    });

    test('GET /api/db/metrics is admin-only', async () => {
      const unauth = await request(app).get('/api/db/metrics');
      expect(unauth.statusCode).toBe(401);

      const nonAdmin = await request(app).get('/api/db/metrics').set(authHeader('buyer'));
      expect(nonAdmin.statusCode).toBe(403);
    });

    test('GET /api/db/metrics returns the cache and audit efficiency report', async () => {
      const res = await request(app).get('/api/db/metrics').set(authHeader('admin'));
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('cache');
      expect(res.body).toHaveProperty('auditing');
    });

    test('GET /api/db/status reports the identity connection and the domain store mode', async () => {
      const res = await request(app).get('/api/db/status');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('poolStatus');
      expect(res.body.domainStore).toEqual(
        expect.objectContaining({
          mode: expect.any(String),
          buyerAccounts: expect.any(Number),
        })
      );
    });

    // Resolved from the shared identity schema for the caller's own session. It
    // has no seeded fallback on purpose: returning a fabricated account is how the
    // dashboard used to attribute one buyer's work to another company. Under test
    // no identity database is configured, so it reports that rather than inventing
    // an account.
    test('GET /api/buyer-accounts/active requires a session', async () => {
      const res = await request(app).get('/api/buyer-accounts/active');
      expect(res.statusCode).toBe(401);
    });

    // The pool is stubbed explicitly rather than relying on whether this machine
    // happens to have MySQL credentials, so the result is the same in CI as it is
    // locally.
    test('GET /api/buyer-accounts/active reports an unavailable directory rather than inventing an account', async () => {
      const identityPool = require('../src/db/identityPool');
      const originalPool = identityPool.pool;
      identityPool.pool = null;
      try {
        const res = await request(app).get('/api/buyer-accounts/active').set(authHeader('buyer'));
        expect(res.statusCode).toBe(503);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/unavailable/i);
        // Crucially, no account is invented to fill the gap.
        expect(res.body.data).toBeUndefined();
      } finally {
        identityPool.pool = originalPool;
      }
    });

    test('GET /api/buyer-accounts/active returns the caller\'s own organisation', async () => {
      const identityPool = require('../src/db/identityPool');
      const buyerProfileQueries = require('../src/db/buyerProfileQueries');
      const originalPool = identityPool.pool;
      identityPool.pool = { stub: true };
      const spy = jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
        profile: {
          organizationId: 'org-real-01',
          userId: 'usr-buyer-001',
          companyName: 'Real Buyer Pvt Ltd',
          contactEmail: 'buyer@procucev.com',
          contactName: 'A Buyer',
          contactPhone: '+919876543210',
          gstNumber: '27AAACT2727Q1ZW',
          panNumber: 'AAACT2727Q',
          city: 'Navi Mumbai',
          state: 'Maharashtra',
          categories: [],
        },
      });

      try {
        const res = await request(app).get('/api/buyer-accounts/active').set(authHeader('buyer'));
        expect(res.statusCode).toBe(200);
        expect(res.body.source).toBe('identity_database');
        expect(res.body.data.organizationName).toBe('Real Buyer Pvt Ltd');
        expect(res.body.data.id).toBe('org-real-01');
        // Spend and RFQ counts are counted, never invented the way the seed did.
        expect(res.body.data.totalSpend).toBe(0);
        expect(res.body.data.totalRFQsCreated).toBe(0);
      } finally {
        spy.mockRestore();
        identityPool.pool = originalPool;
      }
    });

    test('POST /api/buyer-accounts/invalid-id/activate returns 404', async () => {
      const res = await request(app).post('/api/buyer-accounts/invalid-id/activate').set(authHeader('buyer'));
      expect(res.statusCode).toBe(404);
    });

    test('PUT /api/rfqs/:id returns 404 for an id that does not exist', async () => {
      const res = await request(app).put('/api/rfqs/nonexistent-rfq').set(authHeader('buyer')).send({ status: 'Closed' });
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/rfqs/:id/quotes error handling for missing fields and invalid id', async () => {
      const failRes = await request(app).post('/api/rfqs/rfq-001/quotes').set(authHeader('vendor')).send({});
      expect(failRes.statusCode).toBe(400);

      const notFoundRes = await request(app).post('/api/rfqs/nonexistent-rfq/quotes').set(authHeader('vendor')).send({
        vendorName: 'Apex',
        unitPrice: 100,
      });
      expect(notFoundRes.statusCode).toBe(404);
    });

    test('GET /api/rfqs/:id/email-preview returns 404 for invalid id', async () => {
      const res = await request(app)
        .get('/api/rfqs/nonexistent-rfq/email-preview')
        .set(authHeader('buyer'));
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/evaluations returns 400 when missing vendorName', async () => {
      const res = await request(app).post('/api/evaluations').set(authHeader('category_manager')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/audit returns 400 when missing action', async () => {
      const res = await request(app).post('/api/audit').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/vendors/:id/onboarding-email and rating revision 404 on invalid vendor', async () => {
      const emailRes = await request(app).get('/api/vendors/invalid-id/onboarding-email');
      expect(emailRes.statusCode).toBe(404);

      const ratingRes = await request(app).post('/api/vendors/invalid-id/rating-revision').set(authHeader('buyer')).send({
        qualityScore: 90,
        costScore: 90,
        deliveryScore: 90,
      });
      expect(ratingRes.statusCode).toBe(404);

      const delRes = await request(app).delete('/api/vendors/invalid-id').set(authHeader('buyer'));
      expect(delRes.statusCode).toBe(404);
    });
  });
});

// ==============================================================================
// RFQ EDIT AND DELETE
// ==============================================================================
// Both mutations are organisation-scoped in the same way as the reads. The cases
// that matter are the cross-organisation ones: an edit or delete aimed at another
// buyer's RFQ must report the same 404 as an id that does not exist, and must
// leave that RFQ untouched. Anything weaker would let one buyer rewrite or destroy
// another buyer's procurement record.
// ==============================================================================
describe('RFQ edit and delete (/api/rfqs/:id)', () => {
  const BUYER_ORG = TEST_USERS.buyer.orgId;
  const OTHER_ORG = 'org-someone-else';

  /** One stored RFQ, owned by whichever organisation is named. */
  function storedRFQ(overrides = {}) {
    return {
      rfqId: 'RFQ260409000512',
      buyerOrgId: BUYER_ORG,
      buyerUserId: TEST_USERS.buyer.id,
      buyerEmail: TEST_USERS.buyer.email,
      title: 'Mechanical Spares Procurement',
      category: 'Engineering Spares - Mechanical',
      sourcingMode: 'mode_2',
      status: 'Quotes Pending',
      source: 'manual_entry',
      budget: 348000,
      targetDeliveryDate: '2026-09-30',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
      extractedEntities: [{ id: 'e1', itemName: 'Pump', quantity: 4 }],
      attachments: [],
      createdAt: '2026-09-04T10:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    fakeRfqQueries.__reset();
  });

  describe('PUT /api/rfqs/:id', () => {
    test('applies the edit and returns the stored record', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app)
        .put('/api/rfqs/RFQ260409000512')
        .set(authHeader('buyer'))
        .send({ title: 'Revised Mechanical Spares', status: 'In Evaluation' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.source).toBe('persisted');
      expect(res.body.data.title).toBe('Revised Mechanical Spares');
      expect(res.body.data.status).toBe('In Evaluation');
      // Untouched fields survive a partial edit.
      expect(res.body.data.deliveryPincode).toBe('400701');
    });

    test('accepts the row id as well as the RFQ number', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);
      const [row] = fakeRfqQueries.__all();

      const res = await request(app)
        .put(`/api/rfqs/${row.id}`)
        .set(authHeader('buyer'))
        .send({ title: 'Addressed by row id' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.title).toBe('Addressed by row id');
    });

    test('requires a session', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app).put('/api/rfqs/RFQ260409000512').send({ title: 'Revised' });

      expect(res.statusCode).toBe(401);
    });

    // The organisation is in the WHERE clause, so this is a miss rather than a
    // refusal — the response cannot be used to discover what other orgs hold.
    test('reports 404 for another organisation\'s RFQ and leaves it unchanged', async () => {
      fakeRfqQueries.__seed([storedRFQ({ buyerOrgId: OTHER_ORG })]);

      const res = await request(app)
        .put('/api/rfqs/RFQ260409000512')
        .set(authHeader('buyer'))
        .send({ title: 'Rewritten by another buyer' });

      expect(res.statusCode).toBe(404);
      expect(fakeRfqQueries.__all()[0].title).toBe('Mechanical Spares Procurement');
    });

    test('rejects a malformed pincode with a field error', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app)
        .put('/api/rfqs/RFQ260409000512')
        .set(authHeader('buyer'))
        .send({ deliveryPincode: '!!' });

      expect(res.statusCode).toBe(400);
      expect(res.body.fieldErrors.deliveryPincode).toBeTruthy();
      expect(fakeRfqQueries.__all()[0].deliveryPincode).toBe('400701');
    });

    test('rejects a negative budget', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app)
        .put('/api/rfqs/RFQ260409000512')
        .set(authHeader('buyer'))
        .send({ budget: -1 });

      expect(res.statusCode).toBe(400);
    });

    test('rejects a title shorter than the creation rule allows', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app)
        .put('/api/rfqs/RFQ260409000512')
        .set(authHeader('buyer'))
        .send({ title: 'ab' });

      expect(res.statusCode).toBe(400);
    });

    // Ownership is established at creation and must stay that way.
    test('ignores an attempt to reassign the RFQ to another organisation', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app)
        .put('/api/rfqs/RFQ260409000512')
        .set(authHeader('buyer'))
        .send({ buyerOrgId: OTHER_ORG, buyerEmail: 'attacker@example.com', rfqId: 'RFQ-HIJACKED' });

      expect(res.statusCode).toBe(200);
      const [row] = fakeRfqQueries.__all();
      expect(row.buyerOrgId).toBe(BUYER_ORG);
      expect(row.buyerEmail).toBe(TEST_USERS.buyer.email);
      expect(row.rfqId).toBe('RFQ260409000512');
    });

    test('replaces the line items when the edit supplies them', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app)
        .put('/api/rfqs/RFQ260409000512')
        .set(authHeader('buyer'))
        .send({ extractedEntities: [{ id: 'e9', itemName: 'Gate valve', quantity: 9 }] });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.extractedEntities).toHaveLength(1);
      expect(res.body.data.extractedEntities[0].itemName).toBe('Gate valve');
    });

    test('accepts an edit that changes nothing', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app).put('/api/rfqs/RFQ260409000512').set(authHeader('buyer')).send({});

      expect(res.statusCode).toBe(200);
      expect(res.body.data.title).toBe('Mechanical Spares Procurement');
    });
  });

  describe('DELETE /api/rfqs/:id', () => {
    test('deletes the RFQ and echoes the number removed', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app).delete('/api/rfqs/RFQ260409000512').set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rfqNumber).toBe('RFQ260409000512');
      expect(fakeRfqQueries.__all()).toHaveLength(0);
    });

    test('accepts the row id as well as the RFQ number', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);
      const [row] = fakeRfqQueries.__all();

      const res = await request(app).delete(`/api/rfqs/${row.id}`).set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(fakeRfqQueries.__all()).toHaveLength(0);
    });

    test('requires a session', async () => {
      fakeRfqQueries.__seed([storedRFQ()]);

      const res = await request(app).delete('/api/rfqs/RFQ260409000512');

      expect(res.statusCode).toBe(401);
      expect(fakeRfqQueries.__all()).toHaveLength(1);
    });

    test('reports 404 for an id that does not exist', async () => {
      const res = await request(app).delete('/api/rfqs/nonexistent-rfq').set(authHeader('buyer'));

      expect(res.statusCode).toBe(404);
    });

    // The case that matters: one buyer must not be able to destroy another's record.
    test('reports 404 for another organisation\'s RFQ and leaves it in place', async () => {
      fakeRfqQueries.__seed([storedRFQ({ buyerOrgId: OTHER_ORG })]);

      const res = await request(app).delete('/api/rfqs/RFQ260409000512').set(authHeader('buyer'));

      expect(res.statusCode).toBe(404);
      expect(fakeRfqQueries.__all()).toHaveLength(1);
    });

    test('deletes only the RFQ named, leaving the buyer\'s others alone', async () => {
      fakeRfqQueries.__seed([
        storedRFQ(),
        storedRFQ({ rfqId: 'RFQ260409000513', title: 'Second RFQ' }),
      ]);

      const res = await request(app).delete('/api/rfqs/RFQ260409000512').set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      const remaining = fakeRfqQueries.__all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].rfqId).toBe('RFQ260409000513');
    });
  });
});

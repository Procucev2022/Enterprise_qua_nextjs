const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const { authHeader } = require('./testHelpers');

function customAuthHeader(user) {
  return { Authorization: `Bearer ${authService.generateSessionToken(user)}` };
}

describe('API Route Endpoints', () => {
  // 1. Bootstrap
  describe('GET /api/bootstrap', () => {
    test('returns unified platform dataset', async () => {
      const res = await request(app).get('/api/bootstrap');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('buyerAccounts');
      expect(res.body.data).toHaveProperty('vendors');
      expect(res.body.data).toHaveProperty('rfqs');
      expect(res.body.data).toHaveProperty('evaluations');
      expect(res.body.data).toHaveProperty('auditLogs');
      expect(res.body.data).toHaveProperty('aiFeed');
      expect(res.body.data).toHaveProperty('systemConfig');
    });
  });

  // 2. Buyer Accounts
  describe('Buyer Accounts API (/api/buyer-accounts)', () => {
    let testAccountId;

    test('GET /api/buyer-accounts returns array of accounts', async () => {
      const res = await request(app).get('/api/buyer-accounts');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
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

    // Buyer accounts are buyer-side org records. Every mutating endpoint used
    // to accept any authenticated role, so a vendor or category manager could
    // create, edit, delete or re-point the globally active buyer account, and
    // run the buyer-only historical-purchase vendor ingestion.
    describe.each(['vendor', 'category_manager'])('returns 403 for the %s role', (role) => {
      test('POST /api/buyer-accounts', async () => {
        const res = await request(app)
          .post('/api/buyer-accounts')
          .set(authHeader(role))
          .send({ organizationName: 'Rogue Org', corporateEmail: 'rogue@org.com' });
        expect(res.statusCode).toBe(403);
        expect(res.body.success).toBe(false);
      });

      test('PUT /api/buyer-accounts/:id', async () => {
        const res = await request(app).put('/api/buyer-accounts/buyer-acc-001').set(authHeader(role)).send({ totalSpend: '₹0' });
        expect(res.statusCode).toBe(403);
      });

      test('DELETE /api/buyer-accounts/:id', async () => {
        const res = await request(app).delete('/api/buyer-accounts/buyer-acc-001').set(authHeader(role));
        expect(res.statusCode).toBe(403);
      });

      test('POST /api/buyer-accounts/:id/activate', async () => {
        const res = await request(app).post('/api/buyer-accounts/buyer-acc-001/activate').set(authHeader(role));
        expect(res.statusCode).toBe(403);
      });

      test('POST /api/buyer-accounts/historical-data', async () => {
        const res = await request(app)
          .post('/api/buyer-accounts/historical-data')
          .set(authHeader(role))
          .send({ period: '2_years', vendorRecords: [] });
        expect(res.statusCode).toBe(403);
      });
    });

    test('POST /api/buyer-accounts/historical-data is allowed for an admin', async () => {
      const res = await request(app)
        .post('/api/buyer-accounts/historical-data')
        .set(authHeader('admin'))
        .send({ period: '2_years', vendorRecords: [] });
      expect(res.statusCode).toBe(200);
    });

    // The two read-only endpoints stay open to any role: the identical
    // buyerAccounts payload is already served by the unauthenticated
    // GET /api/bootstrap, which is what the frontend actually reads.
    test('GET /api/buyer-accounts stays readable by a non-buyer role', async () => {
      const res = await request(app).get('/api/buyer-accounts').set(authHeader('vendor'));
      expect(res.statusCode).toBe(200);
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
      // Only the vendor themselves (self-registration) or an admin may create
      // a vendor profile now — a buyer creating a vendor was never a real
      // product flow, see vendorController.createVendor.
      const newVendor = {
        name: 'Siemens Energy Spares Pvt Ltd',
        contactPerson: 'Rohan Sharma',
        phone: '+91 98333 44555',
        majorCategory: 'Engineering Spares - Electrical',
        minorCategories: ['Turbines', 'Transformers'],
      };
      const res = await request(app).post('/api/vendors').set(authHeader('vendor')).send(newVendor);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe(newVendor.name);
      testVendorId = res.body.data.id;
    });

    test('POST /api/vendors requires authentication', async () => {
      const res = await request(app).post('/api/vendors').send({ name: 'Unauthenticated Vendor', majorCategory: 'X' });
      expect(res.statusCode).toBe(401);
    });

    test('POST /api/vendors returns 403 for a role that cannot create a vendor profile', async () => {
      const res = await request(app).post('/api/vendors').set(authHeader('buyer')).send({ name: 'X', majorCategory: 'Y' });
      expect(res.statusCode).toBe(403);
    });

    test('POST /api/vendors returns 400 when missing name or majorCategory', async () => {
      const res = await request(app).post('/api/vendors').set(authHeader('vendor')).send({ email: 'test@vendor.com' });
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
      // Carries the vendor's real tempPassword, so it's now restricted to the
      // buyer-side roles that actually onboard vendors (or an admin).
      const res = await request(app).get(`/api/vendors/${testVendorId}/onboarding-email`).set(authHeader('buyer'));
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
      expect(res.body.data).toHaveProperty('to');
    });

    test('PUT /api/vendors/:id updates the profile as the owning vendor, ignoring smuggled fields', async () => {
      const created = await request(app).post('/api/vendors').set(authHeader('vendor')).send({
        name: 'Whitelist Test Vendor',
        majorCategory: 'Engineering Spares - Electrical',
      });
      const id = created.body.data.id;

      const res = await request(app)
        .put(`/api/vendors/${id}`)
        .set(authHeader('vendor'))
        .send({ contactPerson: 'Updated Contact', rating: 999, status: 'HACKED' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.contactPerson).toBe('Updated Contact');
      // rating/status aren't in VENDOR_SELF_EDIT_FIELDS, so a vendor's own PUT
      // can't smuggle them through.
      expect(res.body.data.rating).not.toBe(999);
      expect(res.body.data.status).not.toBe('HACKED');
    });

    test('PUT /api/vendors/:id returns 403 for a caller who is neither the owning vendor nor an admin', async () => {
      const res = await request(app).put(`/api/vendors/${testVendorId}`).set(authHeader('buyer')).send({ name: 'X' });
      expect(res.statusCode).toBe(403);
    });

    test('DELETE /api/vendors/:id removes vendor', async () => {
      // Only the owning vendor (or an admin) may delete the profile; it was
      // created above under the 'vendor' test user's own session email.
      const res = await request(app).delete(`/api/vendors/${testVendorId}`).set(authHeader('vendor'));
      expect(res.statusCode).toBe(200);
    });
  });

  // 4. RFQs
  describe('RFQs API (/api/rfqs)', () => {
    let testRfqId;

    test('GET /api/rfqs returns list of RFQs', async () => {
      const res = await request(app).get('/api/rfqs');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('POST /api/rfqs creates new RFQ and returns 201', async () => {
      const rfq = {
        title: 'Procurement of High Temperature Valves',
        category: 'Engineering Spares - Mechanical',
        budget: 145000,
        targetDeliveryDate: '2026-09-30',
        deadline: '2026-09-30',
        sourcingMode: 'mode_2',
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

    // The budget is optional: a document that prices nothing yields no figure, and
    // requiring one only made buyers invent a ceiling vendors would quote against.
    test('POST /api/rfqs accepts an RFQ with no budget', async () => {
      const res = await request(app)
        .post('/api/rfqs')
        .set(authHeader('buyer'))
        .send({
          title: 'Procurement of Unpriced Spares',
          category: 'Engineering Spares - Mechanical',
          targetDeliveryDate: '2026-10-05',
          sourcingMode: 'mode_1',
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.budget).toBe(0);
      expect(res.body.data.deliveryLocation).toBe('');
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
      const res = await request(app).get(`/api/rfqs/${testRfqId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(testRfqId);
    });

    test('PUT /api/rfqs/:id updates RFQ successfully', async () => {
      const res = await request(app).put(`/api/rfqs/${testRfqId}`).set(authHeader('buyer')).send({ status: 'In Evaluation' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.status).toBe('In Evaluation');
    });

    test('POST /api/rfqs/:id/quotes returns 403 for a non-vendor role', async () => {
      const res = await request(app).post(`/api/rfqs/${testRfqId}/quotes`).set(authHeader('buyer')).send({ unitPrice: 100 });
      expect(res.statusCode).toBe(403);
    });

    test('POST /api/rfqs/:id/quotes returns 400 when the vendor has no profile yet', async () => {
      const res = await request(app)
        .post(`/api/rfqs/${testRfqId}/quotes`)
        .set(customAuthHeader({ id: 'usr-no-profile', email: 'no-profile-vendor@test.com', name: 'No Profile', role: 'vendor' }))
        .send({ unitPrice: 100 });
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/rfqs/:id/quotes adds quote and recalculates matrix', async () => {
      // A quote's vendor identity is resolved server-side from the caller's
      // own vendor record now, so one must exist before a vendor can bid.
      await request(app).post('/api/vendors').set(authHeader('vendor')).send({
        name: 'Apex Industrial Dynamics Pvt Ltd',
        majorCategory: 'Engineering Spares - Mechanical',
      });
      const quote = {
        unitPrice: 5200,
        totalPrice: 52000,
        leadTimeDays: 10,
        remarks: 'Compliant OEM specification',
      };
      const res = await request(app).post(`/api/rfqs/${testRfqId}/quotes`).set(authHeader('vendor')).send(quote);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.quotes.length).toBeGreaterThan(0);
    });

    test('GET /api/rfqs/:id/email-preview generates standard RFQ email', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}/email-preview`).set(authHeader('vendor'));
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
    });
  });

  // 5. Evaluations & Audit
  describe('Evaluations & Audit API', () => {
    test('GET /api/evaluations and POST /api/evaluations', async () => {
      const getRes = await request(app).get('/api/evaluations').set(authHeader('category_manager'));
      expect(getRes.statusCode).toBe(200);

      // A qualification evaluation is a vendor's own self-assessment — identity
      // is resolved server-side from the caller's session, not the body.
      const postRes = await request(app).post('/api/evaluations').set(authHeader('vendor')).send({
        moduleScores: { commercial: { score: 95 } },
        documents: [{ name: 'evidence.pdf' }],
      });
      expect(postRes.statusCode).toBe(201);
      expect(postRes.body.data.email).toBe('vendor@apexsupplies.com');
    });

    test('POST /api/evaluations returns 403 for a non-vendor role', async () => {
      const res = await request(app).post('/api/evaluations').set(authHeader('buyer')).send({
        vendorName: 'X',
        documents: [{ name: 'evidence.pdf' }],
      });
      expect(res.statusCode).toBe(403);
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

    test('GET /api/buyer-accounts/active returns active account', async () => {
      const res = await request(app).get('/api/buyer-accounts/active');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    test('POST /api/buyer-accounts/invalid-id/activate returns 404', async () => {
      const res = await request(app).post('/api/buyer-accounts/invalid-id/activate').set(authHeader('buyer'));
      expect(res.statusCode).toBe(404);
    });

    test('PUT /api/rfqs/:id updates RFQ or returns 404 for invalid id', async () => {
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
      const res = await request(app).get('/api/rfqs/nonexistent-rfq/email-preview').set(authHeader('vendor'));
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/evaluations returns 400 when evidence is missing', async () => {
      const res = await request(app).post('/api/evaluations').set(authHeader('vendor')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/audit returns 400 when missing action', async () => {
      const res = await request(app).post('/api/audit').set(authHeader('buyer')).send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/vendors/:id/onboarding-email and rating revision 404 on invalid vendor', async () => {
      const emailRes = await request(app).get('/api/vendors/invalid-id/onboarding-email').set(authHeader('buyer'));
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

const request = require('supertest');
const app = require('../src/app');

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
      const res = await request(app).post('/api/buyer-accounts').send(newAcc);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.organizationName).toBe(newAcc.organizationName);
      testAccountId = res.body.data.id;
    });

    test('POST /api/buyer-accounts returns 400 when missing required fields', async () => {
      const res = await request(app).post('/api/buyer-accounts').send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('PUT /api/buyer-accounts/:id updates existing account', async () => {
      const res = await request(app)
        .put(`/api/buyer-accounts/${testAccountId}`)
        .send({ totalSpend: '$500,000' });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalSpend).toBe('$500,000');
    });

    test('PUT /api/buyer-accounts/:id returns 404 for nonexistent account', async () => {
      const res = await request(app).put('/api/buyer-accounts/nonexistent-id').send({});
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/buyer-accounts/:id/activate switches active account', async () => {
      const res = await request(app).post(`/api/buyer-accounts/${testAccountId}/activate`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('DELETE /api/buyer-accounts/:id deletes account', async () => {
      const res = await request(app).delete(`/api/buyer-accounts/${testAccountId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('DELETE /api/buyer-accounts/:id returns 404 for nonexistent id', async () => {
      const res = await request(app).delete('/api/buyer-accounts/nonexistent-id');
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
      const res = await request(app).post('/api/vendors').send(newVendor);
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe(newVendor.name);
      testVendorId = res.body.data.id;
    });

    test('POST /api/vendors returns 400 when missing name or majorCategory', async () => {
      const res = await request(app).post('/api/vendors').send({ email: 'test@vendor.com' });
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
      const res = await request(app).post(`/api/vendors/${testVendorId}/rating-revision`).send({
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
      const res = await request(app).post(`/api/vendors/${testVendorId}/rating-revision`).send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/vendors/:id/onboarding-email returns email preview payload', async () => {
      const res = await request(app).get(`/api/vendors/${testVendorId}/onboarding-email`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
      expect(res.body.data).toHaveProperty('to');
    });

    test('DELETE /api/vendors/:id removes vendor', async () => {
      const res = await request(app).delete(`/api/vendors/${testVendorId}`);
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
        deadline: '2026-09-30',
        sourcingMode: 'mode_2',
      };
      const res = await request(app).post('/api/rfqs').send(rfq);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.title).toBe(rfq.title);
      expect(res.body.data.rfqNumber).toBeDefined();
      testRfqId = res.body.data.id;
    });

    test('POST /api/rfqs returns 400 when title missing', async () => {
      const res = await request(app).post('/api/rfqs').send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/rfqs/:id returns RFQ', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(testRfqId);
    });

    test('POST /api/rfqs/:id/quotes adds quote and recalculates matrix', async () => {
      const quote = {
        vendorName: 'Apex Industrial Dynamics Pvt Ltd',
        unitPrice: 5200,
        totalPrice: 52000,
        leadTimeDays: 10,
        remarks: 'Compliant OEM specification',
      };
      const res = await request(app).post(`/api/rfqs/${testRfqId}/quotes`).send(quote);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.quotes.length).toBeGreaterThan(0);
    });

    test('GET /api/rfqs/:id/email-preview generates standard RFQ email', async () => {
      const res = await request(app).get(`/api/rfqs/${testRfqId}/email-preview`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty('htmlBody');
    });
  });

  // 5. Evaluations & Audit
  describe('Evaluations & Audit API', () => {
    test('GET /api/evaluations and POST /api/evaluations', async () => {
      const getRes = await request(app).get('/api/evaluations');
      expect(getRes.statusCode).toBe(200);

      const postRes = await request(app).post('/api/evaluations').send({
        vendorName: 'Godrej Precision Tooling',
        moduleScores: { commercial: { score: 95 } },
      });
      expect(postRes.statusCode).toBe(201);
      expect(postRes.body.data.vendorName).toBe('Godrej Precision Tooling');
    });

    test('GET /api/audit and verify integrity', async () => {
      const getRes = await request(app).get('/api/audit');
      expect(getRes.statusCode).toBe(200);

      const verifyRes = await request(app).get('/api/audit/verify');
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.body.report.valid).toBe(true);
    });

    test('POST /api/audit creates new log entry', async () => {
      const res = await request(app).post('/api/audit').send({
        userEmail: 'auditor@enterprise.com',
        action: 'Manual compliance check performed',
      });
      expect(res.statusCode).toBe(201);
      expect(res.body.data).toHaveProperty('shaSignature');
    });
  });

  // 6. System Config & DB Status
  describe('System Config & DB API', () => {
    test('GET & POST /api/system-config', async () => {
      const getRes = await request(app).get('/api/system-config');
      expect(getRes.statusCode).toBe(200);

      const postRes = await request(app).post('/api/system-config').send({
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

      const postRes = await request(app).post('/api/ai-feed').send({
        title: 'SMS Alert Sent',
        message: 'Notification pushed to supplier.',
      });
      expect(postRes.statusCode).toBe(201);

      const failRes = await request(app).post('/api/ai-feed').send({});
      expect(failRes.statusCode).toBe(400);
    });

    test('POST /api/db/init handles schema initialization without connection gracefully', async () => {
      // Force the disconnected state explicitly rather than relying on DATABASE_URL being
      // unset in the ambient environment — this dev environment has a real Postgres configured.
      const poolModule = require('../src/db/pool');
      const originalPool = poolModule.pool;
      poolModule.pool = null;
      try {
        const res = await request(app).post('/api/db/init');
        expect(res.statusCode).toBe(500);
        expect(res.body.success).toBe(false);
      } finally {
        poolModule.pool = originalPool;
      }
    });

    test('POST /api/db/sync handles data synchronization without connection gracefully', async () => {
      const poolModule = require('../src/db/pool');
      const originalPool = poolModule.pool;
      poolModule.pool = null;
      try {
        const res = await request(app).post('/api/db/sync');
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('DATABASE_URL');
      } finally {
        poolModule.pool = originalPool;
      }
    });

    test('GET /api/buyer-accounts/active returns active account', async () => {
      const res = await request(app).get('/api/buyer-accounts/active');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    test('POST /api/buyer-accounts/invalid-id/activate returns 404', async () => {
      const res = await request(app).post('/api/buyer-accounts/invalid-id/activate');
      expect(res.statusCode).toBe(404);
    });

    test('PUT /api/rfqs/:id updates RFQ or returns 404 for invalid id', async () => {
      const res = await request(app).put('/api/rfqs/nonexistent-rfq').send({ status: 'Closed' });
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/rfqs/:id/quotes error handling for missing fields and invalid id', async () => {
      const failRes = await request(app).post('/api/rfqs/rfq-001/quotes').send({});
      expect(failRes.statusCode).toBe(400);

      const notFoundRes = await request(app).post('/api/rfqs/nonexistent-rfq/quotes').send({
        vendorName: 'Apex',
        unitPrice: 100,
      });
      expect(notFoundRes.statusCode).toBe(404);
    });

    test('GET /api/rfqs/:id/email-preview returns 404 for invalid id', async () => {
      const res = await request(app).get('/api/rfqs/nonexistent-rfq/email-preview');
      expect(res.statusCode).toBe(404);
    });

    test('POST /api/evaluations returns 400 when missing vendorName', async () => {
      const res = await request(app).post('/api/evaluations').send({});
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/audit returns 400 when missing action', async () => {
      const res = await request(app).post('/api/audit').send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/vendors/:id/onboarding-email and rating revision 404 on invalid vendor', async () => {
      const emailRes = await request(app).get('/api/vendors/invalid-id/onboarding-email');
      expect(emailRes.statusCode).toBe(404);

      const ratingRes = await request(app).post('/api/vendors/invalid-id/rating-revision').send({
        qualityScore: 90,
        costScore: 90,
        deliveryScore: 90,
      });
      expect(ratingRes.statusCode).toBe(404);

      const delRes = await request(app).delete('/api/vendors/invalid-id');
      expect(delRes.statusCode).toBe(404);
    });
  });
});

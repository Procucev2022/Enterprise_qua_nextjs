const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const { authHeader } = require('./testHelpers');

describe('Batch Chaser & Purchase Order API', () => {
  // The RFQs these flows act on are created explicitly rather than relying on
  // a fixed, seeded id/number — storeService starts with no RFQs at all.
  let chaserRfqId;
  let poRfqNumber;

  beforeAll(() => {
    // The vendors are created here too. storeService starts completely empty, so
    // `getVendors().slice(0, 2)` used to return the seeded roster and now returns
    // nothing — and triggerBatchChaser refuses an RFQ with nobody assigned rather
    // than falling back to the first few vendors in the directory, which is what
    // used to make it chase suppliers that were never invited.
    const outreachVendors = [
      storeService.addVendor({
        name: 'Chaser Target One',
        email: 'one@chaser-target.test',
        majorCategory: 'Engineering Spares - Mechanical',
      }),
      storeService.addVendor({
        name: 'Chaser Target Two',
        email: 'two@chaser-target.test',
        majorCategory: 'Engineering Spares - Mechanical',
      }),
    ];

    chaserRfqId = storeService.createRFQ({
      title: 'RFQ under multi-channel outreach',
      category: 'Engineering Spares - Mechanical',
      assignedVendors: outreachVendors,
    }).id;
    poRfqNumber = storeService.createRFQ({
      title: 'RFQ pending purchase order approval',
      category: 'Engineering Spares - Mechanical',
    }).rfqNumber;
  });

  test('POST /api/rfqs/:id/batch-chaser triggers multi-channel chasers', async () => {
    const res = await request(app)
      .post(`/api/rfqs/${chaserRfqId}/batch-chaser`)
      .set(authHeader('buyer'))
      .send({ channels: ['call', 'whatsapp', 'sms'] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  test('POST /api/rfqs/:id/batch-chaser returns 404 for invalid RFQ', async () => {
    const res = await request(app)
      .post('/api/rfqs/invalid-rfq-id/batch-chaser')
      .set(authHeader('buyer'))
      .send({});
    expect(res.statusCode).toBe(404);
  });

  test('POST /api/rfqs/:id/batch-chaser requires authentication', async () => {
    const res = await request(app).post(`/api/rfqs/${chaserRfqId}/batch-chaser`).send({});
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/rfqs/:id/approve-po approves and seals PO with SHA-256', async () => {
    const res = await request(app)
      .post(`/api/rfqs/${poRfqNumber}/approve-po`)
      .set(authHeader('buyer'))
      .send({
        vendorName: 'Apex Industrial Dynamics Pvt Ltd',
        totalAmount: 52000,
        approverNotes: 'Compliant OEM specification and optimal lead time.',
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.poNumber).toBeDefined();
    expect(res.body.shaSignature).toBeDefined();
  });

  test('POST /api/rfqs/:id/approve-po returns 400 for missing fields', async () => {
    const res = await request(app)
      .post(`/api/rfqs/${poRfqNumber}/approve-po`)
      .set(authHeader('buyer'))
      .send({});
    expect(res.statusCode).toBe(400);
  });

  test('POST /api/rfqs/:id/approve-po requires authentication', async () => {
    const res = await request(app).post(`/api/rfqs/${poRfqNumber}/approve-po`).send({});
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/rfqs/:id/approve-po returns 403 for a vendor (only buyer-side roles award a PO)', async () => {
    const res = await request(app)
      .post('/api/rfqs/RFQ-2026-0891/approve-po')
      .set(authHeader('vendor'))
      .send({ vendorName: 'Apex', totalAmount: 1000 });
    expect(res.statusCode).toBe(403);
  });

  test('POST /api/rfqs/:id/approve-po returns 404 for an invalid RFQ id', async () => {
    const res = await request(app)
      .post('/api/rfqs/nonexistent-rfq/approve-po')
      .set(authHeader('buyer'))
      .send({ vendorName: 'Apex', totalAmount: 1000 });
    expect(res.statusCode).toBe(404);
  });
});

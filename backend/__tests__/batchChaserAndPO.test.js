const request = require('supertest');
const app = require('../src/app');

describe('Batch Chaser & Purchase Order API', () => {
  test('POST /api/rfqs/:id/batch-chaser triggers multi-channel chasers', async () => {
    const res = await request(app)
      .post('/api/rfqs/rfq-001/batch-chaser')
      .send({ channels: ['call', 'whatsapp', 'sms'] });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  test('POST /api/rfqs/:id/batch-chaser returns 404 for invalid RFQ', async () => {
    const res = await request(app)
      .post('/api/rfqs/invalid-rfq-id/batch-chaser')
      .send({});
    expect(res.statusCode).toBe(404);
  });

  test('POST /api/rfqs/:id/approve-po approves and seals PO with SHA-256', async () => {
    const res = await request(app)
      .post('/api/rfqs/RFQ-2026-0891/approve-po')
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
      .post('/api/rfqs/RFQ-2026-0891/approve-po')
      .send({});
    expect(res.statusCode).toBe(400);
  });
});

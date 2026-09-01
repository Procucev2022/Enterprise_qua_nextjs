const request = require('supertest');
const app = require('../src/app');
const { authHeader } = require('./testHelpers');

describe('Vendor Item SKU Catalogue API', () => {
  let createdProdId;

  test('GET /api/catalogue returns list of products', async () => {
    const res = await request(app).get('/api/catalogue');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test('POST /api/catalogue creates new SKU product', async () => {
    const prod = {
      name: 'Cast Iron Gate Valve DN200',
      sku: 'SKU-VALVE-200',
      category: 'Valves & Actuators',
      unitPrice: 8500,
      leadTimeDays: 14,
      moq: 2,
      specs: 'Class 150 flanged, resilient seated',
    };

    const res = await request(app).post('/api/catalogue').set(authHeader('vendor')).send(prod);
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.sku).toBe('SKU-VALVE-200');
    createdProdId = res.body.data.id;
  });

  test('POST /api/catalogue requires authentication', async () => {
    const res = await request(app).post('/api/catalogue').send({ name: 'X', sku: 'SKU-X' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/catalogue returns 400 for missing name or sku', async () => {
    const res = await request(app).post('/api/catalogue').set(authHeader('vendor')).send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('PUT /api/catalogue/:id updates product', async () => {
    const res = await request(app)
      .put(`/api/catalogue/${createdProdId}`)
      .set(authHeader('vendor'))
      .send({ unitPrice: 8200 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.unitPrice).toBe(8200);
  });

  test('PUT /api/catalogue/:id returns 404 for invalid product', async () => {
    const res = await request(app).put('/api/catalogue/invalid-prod-id').set(authHeader('vendor')).send({});
    expect(res.statusCode).toBe(404);
  });

  test('DELETE /api/catalogue/:id removes product', async () => {
    const res = await request(app).delete(`/api/catalogue/${createdProdId}`).set(authHeader('vendor'));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const failRes = await request(app).delete('/api/catalogue/invalid-prod-id').set(authHeader('vendor'));
    expect(failRes.statusCode).toBe(404);
  });
});

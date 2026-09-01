const request = require('supertest');
const app = require('../src/app');
const { authHeader } = require('./testHelpers');

describe('Vendor Category Dual-Stream Reconciliation API', () => {
  test('PUT /api/vendors/:id/categories reconciles categories', async () => {
    const res = await request(app)
      .put('/api/vendors/v-001/categories')
      .set(authHeader('vendor'))
      .send({
        clientMappedCategories: ['Pumps & Accessories'],
        vendorSelectedCategories: ['Pumps & Accessories', 'Compressors & Accessories'],
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isCategoryAligned).toBe(true);
    expect(res.body.data.vendorSelectedCategories).toContain('Pumps & Accessories');
  });

  test('PUT /api/vendors/:id/categories returns 404 for invalid vendor', async () => {
    const res = await request(app)
      .put('/api/vendors/invalid-vendor-id/categories')
      .set(authHeader('vendor'))
      .send({
        clientMappedCategories: [],
        vendorSelectedCategories: [],
      });

    expect(res.statusCode).toBe(404);
  });

  test('PUT /api/vendors/:id/categories requires authentication', async () => {
    const res = await request(app).put('/api/vendors/v-001/categories').send({});
    expect(res.statusCode).toBe(401);
  });
});

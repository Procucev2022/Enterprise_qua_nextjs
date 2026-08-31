const request = require('supertest');
const app = require('../src/app');

describe('Vendor Category Dual-Stream Reconciliation API', () => {
  test('PUT /api/vendors/:id/categories reconciles categories', async () => {
    const res = await request(app)
      .put('/api/vendors/v-001/categories')
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
      .send({
        clientMappedCategories: [],
        vendorSelectedCategories: [],
      });

    expect(res.statusCode).toBe(404);
  });
});

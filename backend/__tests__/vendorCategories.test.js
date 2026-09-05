const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const { authHeader } = require('./testHelpers');

// Category updates are now ownership-scoped to the vendor matching the
// record's own email (see vendorController.assertVendorOwnership), so v-001
// must be edited as its actual owner (rajesh@apexindustrial.in), not the
// generic 'vendor' test user.
function v001AuthHeader() {
  const token = authService.generateSessionToken({
    id: 'usr-vendor-v001',
    email: 'rajesh@apexindustrial.in',
    name: 'Rajesh Nair',
    role: 'vendor',
    orgId: 'org-vendor-v001',
    orgName: 'Apex Industrial Dynamics Pvt Ltd',
  });
  return { Authorization: `Bearer ${token}` };
}

describe('Vendor Category Dual-Stream Reconciliation API', () => {
  // The vendor is created by the test. It used to reference the seeded 'v-001'
  // record by its fixed id; nothing is seeded now, so the id is whatever the
  // server allocates.
  let ownedVendorId;

  beforeAll(async () => {
    const created = await request(app).post('/api/vendors').set(v001AuthHeader()).send({
      name: 'Apex Industrial Dynamics Pvt Ltd',
      email: 'rajesh@apexindustrial.in',
      majorCategory: 'Engineering Spares - Mechanical',
    });
    ownedVendorId = created.body.data.id;
  });

  test('PUT /api/vendors/:id/categories reconciles categories', async () => {
    const res = await request(app)
      .put(`/api/vendors/${ownedVendorId}/categories`)
      .set(v001AuthHeader())
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

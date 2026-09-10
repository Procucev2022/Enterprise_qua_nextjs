const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const authService = require('../src/services/authService');

describe('Buyer-wise Vendor Isolation at Backend Level', () => {
  let buyerAToken;
  let buyerBToken;
  let buyerAAccount;
  let buyerBAccount;

  beforeAll(async () => {
    // Setup Buyer A
    buyerAAccount = storeService.addBuyerAccount({
      organizationName: 'Buyer Organization A',
      corporateEmail: 'buyer_a@enterprise.com',
      contactPerson: 'Alice Buyer',
    });

    // Setup Buyer B
    buyerBAccount = storeService.addBuyerAccount({
      organizationName: 'Buyer Organization B',
      corporateEmail: 'buyer_b@enterprise.com',
      contactPerson: 'Bob Buyer',
    });

    // Generate valid tokens
    buyerAToken = authService.generateSessionToken({
      id: buyerAAccount.id,
      email: 'buyer_a@enterprise.com',
      name: 'Alice Buyer',
      role: 'buyer',
      orgId: buyerAAccount.id,
      orgName: 'Buyer Organization A',
    });

    buyerBToken = authService.generateSessionToken({
      id: buyerBAccount.id,
      email: 'buyer_b@enterprise.com',
      name: 'Bob Buyer',
      role: 'buyer',
      orgId: buyerBAccount.id,
      orgName: 'Buyer Organization B',
    });
  });

  test('Buyer A uploads vendors via historical data API and gets tagged with buyerId', async () => {
    const res = await request(app)
      .post('/api/buyer-accounts/historical-data')
      .set('Authorization', `Bearer ${buyerAToken}`)
      .send({
        period: '2_years',
        vendorRecords: [
          {
            companyName: 'Private Vendor Alpha (Buyer A Only)',
            email: 'vendor_alpha@isolated.test',
            majorCategory: 'Information Technology (IT) & Software',
            minorCategories: ['Cloud Infrastructure & Storage'],
            location: 'Mumbai, MH',
            rating: 4.8,
            score: 95,
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.importedCount).toBe(1);

    // Verify vendor in store has Buyer A's buyerId
    const stored = storeService.vendors.find((v) => v.email === 'vendor_alpha@isolated.test');
    expect(stored).toBeDefined();
    expect(stored.buyerId).toBe(buyerAAccount.id);
  });

  test('Buyer A can see their uploaded vendor in GET /api/vendors and GET /api/bootstrap', async () => {
    // 1. GET /api/vendors
    const resVendors = await request(app)
      .get('/api/vendors')
      .set('Authorization', `Bearer ${buyerAToken}`);

    expect(resVendors.status).toBe(200);
    expect(resVendors.body.success).toBe(true);
    const hasAlpha = resVendors.body.data.some((v) => v.email === 'vendor_alpha@isolated.test');
    expect(hasAlpha).toBe(true);

    // 2. GET /api/bootstrap
    const resBootstrap = await request(app)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${buyerAToken}`);

    expect(resBootstrap.status).toBe(200);
    expect(resBootstrap.body.success).toBe(true);
    const hasAlphaInBootstrap = resBootstrap.body.data.vendors.some((v) => v.email === 'vendor_alpha@isolated.test');
    expect(hasAlphaInBootstrap).toBe(true);
  });

  test('Buyer B CANNOT see Buyer A uploaded vendor anywhere (GET /api/vendors, GET /api/bootstrap, GET /api/vendors/:id)', async () => {
    // 1. GET /api/vendors
    const resVendors = await request(app)
      .get('/api/vendors')
      .set('Authorization', `Bearer ${buyerBToken}`);

    expect(resVendors.status).toBe(200);
    const hasAlpha = resVendors.body.data.some((v) => v.email === 'vendor_alpha@isolated.test');
    expect(hasAlpha).toBe(false);

    // 2. GET /api/bootstrap
    const resBootstrap = await request(app)
      .get('/api/bootstrap')
      .set('Authorization', `Bearer ${buyerBToken}`);

    expect(resBootstrap.status).toBe(200);
    const hasAlphaInBootstrap = resBootstrap.body.data.vendors.some((v) => v.email === 'vendor_alpha@isolated.test');
    expect(hasAlphaInBootstrap).toBe(false);

    // 3. GET /api/vendors/:id directly by ID
    const stored = storeService.vendors.find((v) => v.email === 'vendor_alpha@isolated.test');
    expect(stored).toBeDefined();

    const resDirect = await request(app)
      .get(`/api/vendors/${stored.id}`)
      .set('Authorization', `Bearer ${buyerBToken}`);

    expect(resDirect.status).toBe(404);
  });

  test('Unauthenticated public requests cannot see buyer-uploaded private vendors', async () => {
    const resVendors = await request(app).get('/api/vendors');
    expect(resVendors.status).toBe(200);
    const hasAlpha = resVendors.body.data.some((v) => v.email === 'vendor_alpha@isolated.test');
    expect(hasAlpha).toBe(false);

    const resBootstrap = await request(app).get('/api/bootstrap');
    expect(resBootstrap.status).toBe(200);
    const hasAlphaInBootstrap = resBootstrap.body.data.vendors.some((v) => v.email === 'vendor_alpha@isolated.test');
    expect(hasAlphaInBootstrap).toBe(false);
  });
});

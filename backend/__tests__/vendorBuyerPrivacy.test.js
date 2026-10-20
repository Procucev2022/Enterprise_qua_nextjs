const request = require('supertest');
const app = require('../src/app');
const storeService = require('../src/services/storeService');
const authService = require('../src/services/authService');

describe('Vendor Dashboard — Hide Buyer Details for 48 Hours', () => {
  const vendorUser = {
    id: 'user-vendor-privacy-1',
    email: 'privacy.vendor@test.com',
    role: 'vendor',
    name: 'Privacy Test Vendor',
  };
  const vendorToken = authService.generateSessionToken(vendorUser);

  const vendorRecord = {
    id: 'v-privacy-1',
    name: 'Privacy Test Vendor Co',
    email: 'privacy.vendor@test.com',
    phone: '+91 99999 88888',
    majorCategory: 'Industrial Machinery',
    minorCategories: ['Centrifugal Pumps'],
    source: 'procucev_network',
  };

  const sampleRfq = {
    id: 'rfq-privacy-test-100',
    rfqNumber: 'RFQ-PRIVACY-100',
    title: 'Precision Centrifugal Pumps Requirement',
    category: 'Industrial Machinery',
    buyerAccountId: 'buyer-acc-confidential',
    buyerAccountName: 'Confidential Global Corp',
    buyerName: 'Vikram Mehta (VP Procurement)',
    buyerCompany: 'Confidential Global Corp',
    buyerEmail: 'vikram.mehta@confidential.com',
    buyerContact: '+91 98111 22233',
    buyerPhone: '+91 98111 22233',
    status: 'Quotes Pending',
    sourcingMode: 'mode_2',
    budget: 500000,
    extractedEntities: [
      { itemName: 'Centrifugal Pump 150 m3/hr', quantity: 2, unit: 'Nos', minorCategory: 'Centrifugal Pumps' },
    ],
    quotes: [],
    assignedVendors: [
      { id: vendorRecord.id, name: vendorRecord.name, email: vendorRecord.email },
    ],
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    storeService.rfqs = [JSON.parse(JSON.stringify(sampleRfq))];
    storeService.vendors = [JSON.parse(JSON.stringify(vendorRecord))];
  });

  test('vendor who has NOT submitted a bid sees normal RFQ requirement info', async () => {
    const res = await request(app)
      .get(`/api/rfqs/${sampleRfq.id}`)
      .set('Authorization', `Bearer ${vendorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rfqNumber).toBe(sampleRfq.rfqNumber);
    // No bid submitted yet -> buyerDetailsHidden is false
    expect(res.body.data.buyerDetailsHidden).toBe(false);
  });

  test('vendor who submits a bid has buyer details hidden for the first 48 hours', async () => {
    // Add quote submitted 2 hours ago (within 48 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    storeService.rfqs[0].quotes = [
      {
        vendorId: vendorRecord.id,
        vendorName: vendorRecord.name,
        vendorEmail: vendorRecord.email,
        unitPrice: 240000,
        totalPrice: 480000,
        submittedAt: twoHoursAgo,
      },
    ];

    // 1. GET /api/rfqs (list)
    const listRes = await request(app)
      .get('/api/rfqs')
      .set('Authorization', `Bearer ${vendorToken}`);

    expect(listRes.status).toBe(200);
    const rfqInList = listRes.body.data.find((r) => r.id === sampleRfq.id);
    expect(rfqInList).toBeDefined();
    expect(rfqInList.buyerDetailsHidden).toBe(true);
    expect(rfqInList.buyerName).toBe('');
    expect(rfqInList.buyerCompany).toBe('');
    expect(rfqInList.buyerEmail).toBe('');
    expect(rfqInList.buyerPhone).toBe('');
    expect(rfqInList.buyerDetailsHiddenUntil).toBeDefined();

    // 2. GET /api/rfqs/:id (single RFQ)
    const singleRes = await request(app)
      .get(`/api/rfqs/${sampleRfq.id}`)
      .set('Authorization', `Bearer ${vendorToken}`);

    expect(singleRes.status).toBe(200);
    expect(singleRes.body.data.buyerDetailsHidden).toBe(true);
    expect(singleRes.body.data.buyerName).toBe('');
    expect(singleRes.body.data.buyerCompany).toBe('');
    expect(singleRes.body.data.buyerEmail).toBe('');
    expect(singleRes.body.data.buyerPhone).toBe('');
  });

  test('after 48 hours from bid submission, buyer details become visible to the vendor', async () => {
    // Add quote submitted 49 hours ago (> 48 hours)
    const fortyNineHoursAgo = new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString();
    storeService.rfqs[0].quotes = [
      {
        vendorId: vendorRecord.id,
        vendorName: vendorRecord.name,
        vendorEmail: vendorRecord.email,
        unitPrice: 240000,
        totalPrice: 480000,
        submittedAt: fortyNineHoursAgo,
      },
    ];

    const singleRes = await request(app)
      .get(`/api/rfqs/${sampleRfq.id}`)
      .set('Authorization', `Bearer ${vendorToken}`);

    expect(singleRes.status).toBe(200);
    expect(singleRes.body.data.buyerDetailsHidden).toBe(false);
    expect(singleRes.body.data.buyerName).toBe(sampleRfq.buyerName);
    expect(singleRes.body.data.buyerCompany).toBe(sampleRfq.buyerCompany);
    expect(singleRes.body.data.buyerEmail).toBe(sampleRfq.buyerEmail);
    expect(singleRes.body.data.buyerPhone).toBe(sampleRfq.buyerPhone);
  });
});

const request = require('supertest');
const app = require('../src/app');
const {
  getSubscriptionGstPercent,
  getSubscriptionGstRate,
  getBuyerSubscriptionPricing,
  getSellerSubscriptionPricing,
  getSubscriptionPricingConfig,
  computeZohoBuyerPlanAmount,
  computeZohoPlanAmount,
} = require('../src/config/constants');

describe('Dynamic Buyer & Seller Subscription Pricing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset pricing env vars to clean state before each test
    delete process.env.SUBSCRIPTION_GST_PERCENT;
    delete process.env.BUYER_V1_6M_PRICE;
    delete process.env.BUYER_V1_12M_PRICE;
    delete process.env.BUYER_V2_6M_PRICE;
    delete process.env.BUYER_V2_12M_PRICE;
    delete process.env.BUYER_V3_6M_PRICE;
    delete process.env.BUYER_V3_12M_PRICE;

    delete process.env.SELLER_V1_6M_PRICE;
    delete process.env.SELLER_V1_12M_PRICE;
    delete process.env.SELLER_V2_6M_PRICE;
    delete process.env.SELLER_V2_12M_PRICE;
    delete process.env.SELLER_V3_6M_PRICE;
    delete process.env.SELLER_V3_12M_PRICE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Default Pricing & GST Rates', () => {
    test('uses standard 18% GST rate by default', () => {
      expect(getSubscriptionGstPercent()).toBe(18);
      expect(getSubscriptionGstRate()).toBe(0.18);
    });

    test('allows dynamic override of GST percent through SUBSCRIPTION_GST_PERCENT', () => {
      process.env.SUBSCRIPTION_GST_PERCENT = '12';
      expect(getSubscriptionGstPercent()).toBe(12);
      expect(getSubscriptionGstRate()).toBe(0.12);

      process.env.SUBSCRIPTION_GST_PERCENT = '0';
      expect(getSubscriptionGstPercent()).toBe(0);
      expect(getSubscriptionGstRate()).toBe(0);
    });

    test('loads default baseline buyer and seller plan amounts when env vars are unset', () => {
      const buyerPricing = getBuyerSubscriptionPricing();
      expect(buyerPricing.version_1['12_months']).toBe(4999);
      expect(buyerPricing.version_1['6_months']).toBe(5499);
      expect(buyerPricing.version_2['12_months']).toBe(7499);
      expect(buyerPricing.version_3['12_months']).toBe(9999);

      const sellerPricing = getSellerSubscriptionPricing();
      expect(sellerPricing.connect['12_months']).toBe(6355.08);
      expect(sellerPricing.select['12_months']).toBe(12711.02);
      expect(computeZohoPlanAmount('connect', '12_months')).toBe(7498.99);
      expect(computeZohoPlanAmount('select', '12_months')).toBe(14999);
    });
  });

  describe('Environment Variable Pricing Overrides', () => {
    test('overrides buyer plan prices dynamically from environment variables', () => {
      process.env.BUYER_V1_6M_PRICE = '6000';
      process.env.BUYER_V1_12M_PRICE = '5000';
      process.env.BUYER_V2_6M_PRICE = '8500';
      process.env.BUYER_V2_12M_PRICE = '7500';
      process.env.BUYER_V3_6M_PRICE = '11000';
      process.env.BUYER_V3_12M_PRICE = '10000';
      process.env.SUBSCRIPTION_GST_PERCENT = '18';

      const pricing = getBuyerSubscriptionPricing();
      expect(pricing.version_1['6_months']).toBe(6000);
      expect(pricing.version_1['12_months']).toBe(5000);
      expect(pricing.version_2['6_months']).toBe(8500);
      expect(pricing.version_2['12_months']).toBe(7500);
      expect(pricing.version_3['6_months']).toBe(11000);
      expect(pricing.version_3['12_months']).toBe(10000);

      // Verify authoritative backend calculation
      // version_1 6m: 6000 * 6 = 36000; 36000 * 1.18 = 42480
      const v1_6m_amount = computeZohoBuyerPlanAmount('version_1', '6_months');
      expect(v1_6m_amount).toBe(42480);

      // version_1 12m: 5000 * 12 = 60000; 60000 * 1.18 = 70800
      const v1_12m_amount = computeZohoBuyerPlanAmount('version_1', '12_months');
      expect(v1_12m_amount).toBe(70800);
    });

    test('overrides seller plan prices dynamically from environment variables', () => {
      process.env.SELLER_V1_12M_PRICE = '8000';
      process.env.SELLER_V2_12M_PRICE = '16000';
      process.env.SUBSCRIPTION_GST_PERCENT = '18';

      // connect 12m configured inclusive price: 8000
      const connectAmount = computeZohoPlanAmount('connect', '12_months');
      expect(connectAmount).toBe(8000);

      // select 12m configured inclusive price: 16000
      const selectAmount = computeZohoPlanAmount('select', '12_months');
      expect(selectAmount).toBe(16000);
    });
  });

  describe('Authoritative Pricing API Endpoints', () => {
    test('GET /api/subscriptions/pricing returns comprehensive dynamic configuration', async () => {
      process.env.BUYER_V1_12M_PRICE = '5500';
      process.env.SUBSCRIPTION_GST_PERCENT = '18';

      const res = await request(app).get('/api/subscriptions/pricing');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data).toHaveProperty('gstPercent', 18);
      expect(data).toHaveProperty('gstRate', 0.18);
      expect(data.buyer.version_1['12_months'].price).toBe(5500);
      expect(data.buyer.version_1['12_months'].baseDurationPrice).toBe(66000); // 5500 * 12
      expect(data.buyer.version_1['12_months'].gstAmount).toBe(11880); // 66000 * 0.18
      expect(data.buyer.version_1['12_months'].totalWithGst).toBe(77880); // 66000 + 11880
      expect(data.seller).toHaveProperty('connect');
      expect(data.seller).toHaveProperty('select');
    });

    test('GET /api/buyer-accounts/subscription-pricing is accessible for clients', async () => {
      const res = await request(app).get('/api/buyer-accounts/subscription-pricing');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('buyer');
      expect(res.body.data).toHaveProperty('gstPercent');
    });

    test('GET /api/vendors/subscription-pricing is accessible for clients', async () => {
      const res = await request(app).get('/api/vendors/subscription-pricing');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('seller');
      expect(res.body.data).toHaveProperty('gstPercent');
    });

    test('BUYER_SUBSCRIPTION_PLANS and VENDOR_SUBSCRIPTION_PLANS dynamic price getters work with env', () => {
      const { BUYER_SUBSCRIPTION_PLANS, VENDOR_SUBSCRIPTION_PLANS } = require('../src/config/constants');
      process.env.BUYER_V1_12M_PRICE = '5499';
      process.env.BUYER_V2_12M_PRICE = '7499';
      process.env.BUYER_V3_12M_PRICE = '9999';
      process.env.SELLER_V1_12M_PRICE = '7499';
      process.env.SELLER_V2_12M_PRICE = '14999';

      const v1 = BUYER_SUBSCRIPTION_PLANS.find((p) => p.id === 'version_1');
      const v2 = BUYER_SUBSCRIPTION_PLANS.find((p) => p.id === 'version_2');
      const v3 = BUYER_SUBSCRIPTION_PLANS.find((p) => p.id === 'version_3');
      expect(v1.price).toBe('₹5,499');
      expect(v2.price).toBe('₹7,499');
      expect(v3.price).toBe('₹9,999');

      const connect = VENDOR_SUBSCRIPTION_PLANS.find((p) => p.id === 'connect');
      const select = VENDOR_SUBSCRIPTION_PLANS.find((p) => p.id === 'select');
      expect(connect.price).toBe('₹7,499');
      expect(select.price).toBe('₹14,999');
    });
  });
});


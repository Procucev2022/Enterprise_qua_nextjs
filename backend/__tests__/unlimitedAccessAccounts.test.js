const request = require('supertest');
const storeService = require('../src/services/storeService');
const authService = require('../src/services/authService');
const app = require('../src/app');
const {
  hasUnlimitedRfqAccess,
  hasUnlimitedQuoteAccess,
  hasUnlimitedDownloadAccess,
  resolveBuyerSourcingMode,
  SUBSCRIPTION_MODE_ENTITLEMENTS,
} = require('../src/config/constants');
const emailGatewayService = require('../src/services/emailGatewayService');

describe('Unlimited Access Buyer & Vendor Accounts', () => {
  describe('Constant & Helper Functions', () => {
    test('hasUnlimitedRfqAccess recognizes various flag placements', () => {
      expect(hasUnlimitedRfqAccess(null)).toBe(false);
      expect(hasUnlimitedRfqAccess({})).toBe(false);
      expect(hasUnlimitedRfqAccess({ subscriptionPlan: 'free_trial' })).toBe(false);
      expect(hasUnlimitedRfqAccess({ unlimitedRfqAccess: true })).toBe(true);
      expect(hasUnlimitedRfqAccess({ unlimitedAccess: true })).toBe(true);
      expect(hasUnlimitedRfqAccess({ subscriptionPlan: 'unlimited' })).toBe(true);
      expect(hasUnlimitedRfqAccess({ raw: JSON.stringify({ unlimitedRfqAccess: true }) })).toBe(true);
      expect(hasUnlimitedRfqAccess({ raw: JSON.stringify({ unlimitedAccess: true }) })).toBe(true);
      expect(hasUnlimitedRfqAccess({ raw: JSON.stringify({ subscriptionPlan: 'unlimited' }) })).toBe(true);
    });

    test('hasUnlimitedQuoteAccess recognizes vendor flags', () => {
      expect(hasUnlimitedQuoteAccess(null)).toBe(false);
      expect(hasUnlimitedQuoteAccess({})).toBe(false);
      expect(hasUnlimitedQuoteAccess({ unlimitedQuoteSubmissions: true })).toBe(true);
      expect(hasUnlimitedQuoteAccess({ unlimitedAccess: true })).toBe(true);
      expect(hasUnlimitedQuoteAccess({ raw: JSON.stringify({ unlimitedQuoteSubmissions: true }) })).toBe(true);
      expect(hasUnlimitedQuoteAccess({ raw: JSON.stringify({ unlimitedAccess: true }) })).toBe(true);
    });

    test('hasUnlimitedDownloadAccess recognizes vendor flags', () => {
      expect(hasUnlimitedDownloadAccess(null)).toBe(false);
      expect(hasUnlimitedDownloadAccess({})).toBe(false);
      expect(hasUnlimitedDownloadAccess({ unlimitedRfqDownloads: true })).toBe(true);
      expect(hasUnlimitedDownloadAccess({ unlimitedAccess: true })).toBe(true);
      expect(hasUnlimitedDownloadAccess({ raw: JSON.stringify({ unlimitedRfqDownloads: true }) })).toBe(true);
      expect(hasUnlimitedDownloadAccess({ raw: JSON.stringify({ unlimitedAccess: true }) })).toBe(true);
    });

    test('resolveBuyerSourcingMode honors unlimited access without downgrading', () => {
      // Normal free trial buyer with 0 credits gets downgraded to mode_0
      const standardBuyer = { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0 };
      expect(resolveBuyerSourcingMode(standardBuyer)).toBe('mode_0');

      // Unlimited buyer gets requested mode even with 0 remainingFreeRFQs
      const unlimitedBuyer = { subscriptionPlan: 'free_trial', remainingFreeRFQs: 0, unlimitedRfqAccess: true };
      expect(resolveBuyerSourcingMode(unlimitedBuyer, 'mode_3')).toBe('mode_3');
      expect(resolveBuyerSourcingMode(unlimitedBuyer, 'mode_2')).toBe('mode_2');
      expect(resolveBuyerSourcingMode(unlimitedBuyer, 'mode_1')).toBe('mode_1');
      expect(resolveBuyerSourcingMode(unlimitedBuyer, 'mode_0')).toBe('mode_0');
    });

    test('SUBSCRIPTION_MODE_ENTITLEMENTS includes unlimited plan with all modes', () => {
      expect(SUBSCRIPTION_MODE_ENTITLEMENTS.unlimited).toEqual(['mode_0', 'mode_1', 'mode_2', 'mode_3']);
    });
  });

  describe('Buyer Account - Unlimited RFQ Creation (V0 - V3) & Zero Credit Deduction', () => {
    let unlimitedBuyer;
    let standardBuyer;
    let buyerAuthHeader;

    beforeEach(() => {
      unlimitedBuyer = storeService.addBuyerAccount({
        organizationName: 'Sudheer Enterprise',
        corporateEmail: 'sudheer.unlimited@test.com',
        contactPerson: 'Sudheer Kangala',
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 5,
        unlimitedRfqAccess: true,
      });

      standardBuyer = storeService.addBuyerAccount({
        organizationName: 'Standard Buyer Co',
        corporateEmail: 'standard.buyer@test.com',
        contactPerson: 'Normal Buyer',
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 5,
      });

      const token = authService.generateSessionToken({
        id: unlimitedBuyer.id,
        email: unlimitedBuyer.corporateEmail,
        name: unlimitedBuyer.contactPerson,
        role: 'buyer',
        orgId: unlimitedBuyer.id,
        orgName: unlimitedBuyer.organizationName,
      });
      buyerAuthHeader = { Authorization: `Bearer ${token}` };
    });

    test('storeService.tryConsumeFreeRFQ does not deduct credits for unlimited buyer', () => {
      const res = storeService.tryConsumeFreeRFQ(unlimitedBuyer.id);
      expect(res.ok).toBe(true);
      // Credit should remain untouched
      const current = storeService.buyerAccounts.find((a) => a.id === unlimitedBuyer.id);
      expect(current.remainingFreeRFQs).toBe(5);
    });

    test('storeService.tryConsumeFreeRFQ deducts credits for standard buyer', () => {
      const res = storeService.tryConsumeFreeRFQ(standardBuyer.id);
      expect(res.ok).toBe(true);
      const current = storeService.buyerAccounts.find((a) => a.id === standardBuyer.id);
      expect(current.remainingFreeRFQs).toBe(4);
    });

    test('storeService.consumeRFQCreditIfApplicable bypasses deductions for unlimited buyer', () => {
      const resV1 = storeService.consumeRFQCreditIfApplicable(unlimitedBuyer, 'mode_1');
      expect(resV1.consumed).toBe(false);
      expect(resV1.remaining).toBe(5);

      const resV3 = storeService.consumeRFQCreditIfApplicable(unlimitedBuyer, 'mode_3');
      expect(resV3.consumed).toBe(false);
      expect(resV3.remaining).toBe(5);
    });

    test('emailGatewayService.checkRfqCredits allows unlimited buyer even when remaining credits are 0', () => {
      const exhaustedUnlimitedBuyer = {
        id: 'unlimited-1',
        corporateEmail: 'sudheer@test.com',
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 0,
        unlimitedRfqAccess: true,
      };

      const result = emailGatewayService.checkRfqCredits(exhaustedUnlimitedBuyer, 'mode_3', 3);
      expect(result.ok).toBe(true);
      expect(result.applies).toBe(false);

      const exhaustedStandardBuyer = {
        id: 'standard-1',
        corporateEmail: 'standard@test.com',
        subscriptionPlan: 'free_trial',
        remainingFreeRFQs: 0,
      };

      const stdResult = emailGatewayService.checkRfqCredits(exhaustedStandardBuyer, 'mode_3', 3);
      expect(stdResult.ok).toBe(false);
      expect(stdResult.remaining).toBe(0);
    });

    test('RFQ creation controller allows unlimited buyer to create V0, V1, V2, V3 without credit exhaustion', async () => {
      storeService.alignActiveBuyerAccount(unlimitedBuyer.id);

      const modes = ['mode_0', 'mode_1', 'mode_2', 'mode_3'];
      for (const mode of modes) {
        const response = await request(app)
          .post('/api/rfqs')
          .set(buyerAuthHeader)
          .send({
            title: `Unlimited RFQ Test ${mode}`,
            category: 'Pumps & Motors',
            description: 'Testing unlimited RFQ creation',
            sourcingMode: mode,
            budget: 100000,
            deliveryLocation: 'Mumbai Plant, Maharashtra',
            deliveryPincode: '400001',
            targetDeliveryDate: '2026-12-31',
            lineItems: [{ itemName: 'Pump A', quantity: 10, unit: 'Nos', targetDate: '2026-12-31' }],
          });

        expect([200, 201]).toContain(response.status);
        expect(response.body.success).toBe(true);
      }

      // Verify credits are still 5
      const current = storeService.buyerAccounts.find((a) => a.id === unlimitedBuyer.id);
      expect(current.remainingFreeRFQs).toBe(5);
    });
  });

  describe('Vendor Account - Unlimited Quote Submissions & RFQ Downloads', () => {
    let unlimitedVendor;
    let standardVendor;
    let testRfq;
    let vendorAuthHeader;

    beforeEach(() => {
      unlimitedVendor = storeService.addVendor({
        name: 'Procucev Unlimited Vendor',
        email: 'procucev.vendor@test.com',
        majorCategory: 'Pumps & Motors',
        unlimitedQuoteSubmissions: true,
        unlimitedRfqDownloads: true,
        freeQuotationCredits: 0, // Even with 0 free credits
        rfqDownloadsUsed: 100, // Even with many downloads used
      });

      standardVendor = storeService.addVendor({
        name: 'Standard Vendor',
        email: 'standard.vendor@test.com',
        majorCategory: 'Pumps & Motors',
        freeQuotationCredits: 0, // Exhausted
        rfqDownloadsUsed: 5, // Exhausted
        subscriptionPlan: 'free',
      });

      testRfq = storeService.createRFQ({
        title: 'Industrial Pumps RFQ',
        category: 'Pumps & Motors',
        sourcingMode: 'mode_0',
        status: 'Open',
        budget: 50000,
        deliveryLocation: 'Mumbai Plant',
        deliveryPincode: '400001',
        targetDeliveryDate: '2026-12-31',
        assignedVendors: [{ id: unlimitedVendor.id }, { id: standardVendor.id }],
        lineItems: [{ id: 'item-1', itemName: 'Pump A', quantity: 1, unit: 'Nos', targetDate: '2026-12-31' }],
      });

      const token = authService.generateSessionToken({
        id: unlimitedVendor.id,
        email: unlimitedVendor.email,
        name: unlimitedVendor.name,
        role: 'vendor',
        orgId: 'org-vendor-1',
        orgName: unlimitedVendor.name,
      });
      vendorAuthHeader = { Authorization: `Bearer ${token}` };
    });

    test('checkVendorQuotationEligibility grants eligibility to unlimited vendor regardless of credits', () => {
      const eligibility = storeService.checkVendorQuotationEligibility(unlimitedVendor.id);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.isSubscribed).toBe(true);
      expect(eligibility.freeCreditsRemaining).toBeGreaterThan(900000);

      // Standard vendor with 0 credits and free tier is ineligible
      const stdEligibility = storeService.checkVendorQuotationEligibility(standardVendor.id);
      expect(stdEligibility.eligible).toBe(false);
    });

    test('getVendorRfqCredits grants full download access to unlimited vendor', () => {
      const credits = storeService.getVendorRfqCredits(unlimitedVendor.id);
      expect(credits.freeCreditsRemaining).toBeGreaterThan(900000);
      expect(credits.isSubscribed).toBe(true);
    });

    test('isRfqUnlockedForVendor returns true for unlimited vendor', () => {
      expect(storeService.isRfqUnlockedForVendor(unlimitedVendor.id, testRfq.id)).toBe(true);
    });

    test('unlockRFQForVendor charges 0 credits and succeeds for unlimited vendor', async () => {
      const result = await storeService.unlockRFQForVendor(unlimitedVendor.id, testRfq.id);
      expect(result.success).toBe(true);
      expect(result.creditCharged).toBe(0);
    });

    test('Quotation submission bypasses limits for unlimited vendor', async () => {
      const response = await request(app)
        .post(`/api/rfqs/${testRfq.id}/quotes`)
        .set(vendorAuthHeader)
        .send({
          rfqId: testRfq.id,
          vendorId: unlimitedVendor.id,
          unitPrice: 5000,
          totalPrice: 50000,
          leadTimeDays: 7,
          notes: 'Unlimited quote submission test',
        });

      expect([200, 201]).toContain(response.status);
      expect(response.body.success).toBe(true);
    });

    test('RFQ download bypasses limits for unlimited vendor', async () => {
      const response = await request(app)
        .post(`/api/rfqs/${testRfq.id}/download`)
        .set(vendorAuthHeader)
        .send({ vendorId: unlimitedVendor.id });

      expect([200, 201]).toContain(response.status);
      expect(response.body.success).toBe(true);
    });
  });
});

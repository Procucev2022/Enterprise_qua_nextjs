const storeService = require('../src/services/storeService');
const mailerService = require('../src/services/mailerService');
const domainQueries = require('../src/db/domainQueries');

describe('V0 RFQ Complete Workflow — Procucev Network Vendors', () => {
  let inviteEmailSpy;
  let mismatchEmailSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    inviteEmailSpy = jest.spyOn(mailerService, 'sendRfqInviteEmail').mockResolvedValue({ sent: true });
    mismatchEmailSpy = jest.spyOn(mailerService, 'sendVendorCategoryMismatchEmail').mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Buyer RFQ Creation & Automatic Matching (Mode 0)', () => {
    test('auto-matches network vendors with matching category and location and dispatches invite email', () => {
      const vendorA = storeService.addVendor({
        name: 'Alpha Pipes Ltd',
        email: 'alpha@pipes.com',
        majorCategory: 'Pipes & Fittings',
        location: 'Mumbai',
        pincode: '400001',
      });
      const vendorB = storeService.addVendor({
        name: 'Beta Motors Ltd',
        email: 'beta@motors.com',
        majorCategory: 'Heavy Machinery',
        location: 'Mumbai',
      });

      const rfq = storeService.createRFQ({
        title: 'Industrial PVC Pipes Procurement',
        category: 'Pipes & Fittings',
        sourcingMode: 'mode_0',
        deliveryLocation: 'Mumbai',
      });

      const assignedIds = (rfq.assignedVendors || []).map((v) => v.id);
      expect(assignedIds).toContain(vendorA.id);
      expect(assignedIds).not.toContain(vendorB.id);

      // Verify invite sent to matched vendor
      expect(inviteEmailSpy).toHaveBeenCalledWith(
        'alpha@pipes.com',
        expect.objectContaining({
          recipientName: expect.any(String),
          rfq: expect.objectContaining({ title: 'Industrial PVC Pipes Procurement' }),
        })
      );

      // Verify category mismatch email is NOT sent
      expect(mismatchEmailSpy).not.toHaveBeenCalled();

      // Verify audit log for exclusion
      const exclusionAudit = storeService.auditLogs.find(
        (log) => log.action && log.action.includes('excluded from automatic RFQ matching due to category mismatch')
      );
      expect(exclusionAudit).toBeDefined();
    });

    test('excludes private buyer-uploaded vendors from automatic V0 matching', () => {
      const privateVendor = storeService.addVendor({
        name: 'Private Seller',
        email: 'private@seller.com',
        majorCategory: 'Steel Works',
        buyerId: 'buyer-org-123', // Direct buyer private roster
      });

      const rfq = storeService.createRFQ({
        title: 'Steel Rebar Procurement',
        category: 'Steel Works',
        sourcingMode: 'mode_0',
      });

      const assignedIds = (rfq.assignedVendors || []).map((v) => v.id);
      expect(assignedIds).not.toContain(privateVendor.id);
    });
  });

  describe('2. Category Manager Manual Assignment and Override', () => {
    test('allows Category Manager manual override for mismatched vendor, sends invite and logs manual override', async () => {
      const specialVendor = storeService.addVendor({
        name: 'Specialist Works',
        email: 'specialist@works.com',
        majorCategory: 'Electronics',
      });

      const rfq = storeService.createRFQ({
        title: 'Plumbing Works',
        category: 'Plumbing & Sanitation',
        sourcingMode: 'mode_0',
      });

      const result = await storeService.inviteVendorsToRFQ(rfq.id, [specialVendor.id], 'cm@procucev.com');
      expect(result.invitedCount).toBe(1);
      expect(result.overrideCount).toBe(1);

      // Mismatch email MUST NOT be sent
      expect(mismatchEmailSpy).not.toHaveBeenCalled();

      // Normal invite email MUST be sent
      expect(inviteEmailSpy).toHaveBeenCalledWith('specialist@works.com', expect.any(Object));

      // Audit log must record Category Manager manual override
      const overrideLog = storeService.auditLogs.find(
        (log) => log.action && log.action.includes('Category Manager manual override')
      );
      expect(overrideLog).toBeDefined();
    });
  });

  describe('3. Vendor 5 Free RFQ Download Credits & Exhaustion', () => {
    test('initializes with 5 free credits and tracks atomic deductions', async () => {
      const vendor = storeService.addVendor({
        name: 'Credit Test Vendor',
        email: 'credits@test.com',
        majorCategory: 'General Supplies',
      });

      // 1. Check initial credits
      const initialCredits = storeService.getVendorRfqCredits(vendor.id);
      expect(initialCredits.freeCreditsRemaining).toBe(5);
      expect(initialCredits.freeCreditsAllocated).toBe(5);
      expect(initialCredits.freeCreditsUsed).toBe(0);

      // Create 5 test RFQs
      const rfq1 = storeService.createRFQ({ title: 'RFQ 1', category: 'General Supplies', sourcingMode: 'mode_0' });
      const rfq2 = storeService.createRFQ({ title: 'RFQ 2', category: 'General Supplies', sourcingMode: 'mode_0' });
      const rfq3 = storeService.createRFQ({ title: 'RFQ 3', category: 'General Supplies', sourcingMode: 'mode_0' });
      const rfq4 = storeService.createRFQ({ title: 'RFQ 4', category: 'General Supplies', sourcingMode: 'mode_0' });
      const rfq5 = storeService.createRFQ({ title: 'RFQ 5', category: 'General Supplies', sourcingMode: 'mode_0' });
      const rfq6 = storeService.createRFQ({ title: 'RFQ 6', category: 'General Supplies', sourcingMode: 'mode_0' });

      // Unlock RFQ 1: balance goes 5 -> 4
      const res1 = await storeService.unlockRFQForVendor(vendor.id, rfq1.id);
      expect(res1.success).toBe(true);
      expect(res1.freeCreditsRemaining).toBe(4);
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq1.id)).toBe(true);

      // Idempotency: downloading RFQ 1 again does NOT consume another credit
      const res1Repeat = await storeService.unlockRFQForVendor(vendor.id, rfq1.id);
      expect(res1Repeat.success).toBe(true);
      expect(res1Repeat.alreadyUnlocked).toBe(true);
      expect(res1Repeat.freeCreditsRemaining).toBe(4);

      // Unlock remaining 4 RFQs
      await storeService.unlockRFQForVendor(vendor.id, rfq2.id);
      await storeService.unlockRFQForVendor(vendor.id, rfq3.id);
      await storeService.unlockRFQForVendor(vendor.id, rfq4.id);
      const res5 = await storeService.unlockRFQForVendor(vendor.id, rfq5.id);
      expect(res5.success).toBe(true);
      expect(res5.freeCreditsRemaining).toBe(0);

      // 6th RFQ download attempt MUST be rejected
      const res6 = await storeService.unlockRFQForVendor(vendor.id, rfq6.id);
      expect(res6.success).toBe(false);
      expect(res6.creditsExhausted).toBe(true);
      expect(res6.error).toContain('You have used all 5 free RFQ download credits');

      // Previously unlocked RFQs remain unlocked
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq1.id)).toBe(true);
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq5.id)).toBe(true);
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq6.id)).toBe(false);
    });
  });

  describe('4. Mandatory RFQ Download Before Bid Submission', () => {
    test('enforces download before allowing bid submission', async () => {
      const vendor = storeService.addVendor({
        name: 'Bidder Vendor',
        email: 'bidder@vendor.com',
        majorCategory: 'Pumps & Valves',
      });

      const rfq = storeService.createRFQ({
        title: 'Centrifugal Pumps Enquiry',
        category: 'Pumps & Valves',
        sourcingMode: 'mode_0',
      });

      // Before unlocking, check returns false
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq.id)).toBe(false);

      // Unlock the RFQ
      const unlockRes = await storeService.unlockRFQForVendor(vendor.id, rfq.id);
      expect(unlockRes.success).toBe(true);
      expect(storeService.isRfqUnlockedForVendor(vendor.id, rfq.id)).toBe(true);

      // Add quote
      const quote = {
        vendorId: vendor.id,
        vendorName: vendor.name,
        unitPrice: 25000,
        totalPrice: 50000,
      };
      const updatedRfq = storeService.addQuoteToRFQ(rfq.id, quote);
      expect(updatedRfq).toBeDefined();
      expect(updatedRfq.quotes).toHaveLength(1);
      expect(updatedRfq.quotes[0].vendorId).toBe(vendor.id);
    });
  });
});

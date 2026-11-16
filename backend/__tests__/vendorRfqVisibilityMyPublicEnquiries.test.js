const request = require('supertest');
const storeService = require('../src/services/storeService');
const rfqController = require('../src/controllers/rfqController');
const { canVendorViewRfq } = rfqController;

describe('Vendor RFQ Visibility: My Enquiries & Public Enquiries', () => {
  beforeEach(() => {
    storeService.reset();
  });

  describe('My Enquiries visibility and category mismatch handling', () => {
    test('buyer-selected vendors with different registered categories are assigned and can view RFQ in My Enquiries', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Acme Mega Corp',
        corporateEmail: 'procurement@acme.com',
      });

      // Vendor 1: Registered in Civil Works
      const vendor1 = storeService.addVendor({
        name: 'Civil Works Specialist',
        email: 'civil@specialist.com',
        majorCategory: 'Civil Works',
        buyerId: buyer.id,
        buyerAccountId: buyer.id,
        addedByBuyerCompany: buyer.organizationName,
        source: 'buyer_uploaded',
      });

      // Vendor 2: Registered in Packing Material
      const vendor2 = storeService.addVendor({
        name: 'Packaging Pro Ltd',
        email: 'packaging@pro.com',
        majorCategory: 'Packing Material',
        buyerId: buyer.id,
        buyerAccountId: buyer.id,
        addedByBuyerCompany: buyer.organizationName,
        source: 'buyer_uploaded',
      });

      // Vendor 3: Registered in Electricals, belonging to the same buyer but NOT invited
      const vendor3 = storeService.addVendor({
        name: 'Uninvited Electricals',
        email: 'uninvited@electricals.com',
        majorCategory: 'Electrical & Electronics',
        buyerId: buyer.id,
        buyerAccountId: buyer.id,
        addedByBuyerCompany: buyer.organizationName,
        source: 'buyer_uploaded',
      });

      // Buyer creates a Mode 1 RFQ under "Engineering Spares - Mechanical"
      // Buyer explicitly selects Vendor 1 and Vendor 2 (both have mismatched categories: Civil Works and Packing Material)
      const rfq = storeService.createRFQ(
        {
          title: 'Heavy CNC Milling Machine Sourcing',
          category: 'Engineering Spares - Mechanical',
          sourcingMode: 'mode_1',
          budget: 500000,
          assignedVendors: [
            { id: vendor1.id, name: vendor1.name, email: vendor1.email },
            { id: vendor2.id, name: vendor2.name, email: vendor2.email },
          ],
          extractedEntities: [
            { itemName: '5-Axis CNC Milling Center', majorCategory: 'Engineering Spares - Mechanical', quantity: 1 },
          ],
        },
        buyer
      );

      // Verify both vendors are retained in assignedVendors despite category mismatch
      expect(rfq.assignedVendors).toHaveLength(2);
      const assignedIds = rfq.assignedVendors.map((v) => v.id);
      expect(assignedIds).toContain(vendor1.id);
      expect(assignedIds).toContain(vendor2.id);
      expect(assignedIds).not.toContain(vendor3.id);

      // Check vendor visibility
      expect(storeService.vendorCoversRFQ(vendor1, rfq)).toBe(true);
      expect(storeService.vendorCoversRFQ(vendor2, rfq)).toBe(true);

      // Verify uninvited vendor from the same buyer CANNOT view this RFQ
      expect(storeService.vendorCoversRFQ(vendor3, rfq)).toBe(false);
    });

    test('_isInvitedVendor correctly matches vendor by id, vendorId, email, or name', () => {
      const rfq = {
        id: 'rfq-test-invite-001',
        sourcingMode: 'mode_1',
        assignedVendors: [
          { id: 'v-101', name: 'Alpha Supplies', email: 'alpha@supplies.com' },
          { vendorId: 'v-102', name: 'Beta Tools', email: 'beta@tools.com' },
        ],
      };

      // Match by id
      expect(storeService._isInvitedVendor({ id: 'v-101', email: 'diff@diff.com' }, rfq)).toBe(true);
      // Match by vendorId
      expect(storeService._isInvitedVendor({ id: 'v-102' }, rfq)).toBe(true);
      // Match by email
      expect(storeService._isInvitedVendor({ id: 'v-999', email: 'BETA@TOOLS.COM' }, rfq)).toBe(true);
      // Match by name
      expect(storeService._isInvitedVendor({ id: 'v-888', name: 'Alpha Supplies' }, rfq)).toBe(true);

      // Non-matching vendor
      expect(storeService._isInvitedVendor({ id: 'v-999', email: 'other@other.com', name: 'Other Co' }, rfq)).toBe(false);
    });
  });

  describe('Public Enquiries (Mode 0) visibility for all vendors', () => {
    test('any buyer creating a Mode 0 RFQ is visible to all vendors regardless of their registered category', () => {
      const buyer = storeService.addBuyerAccount({
        organizationName: 'Global Sourcing Inc',
        corporateEmail: 'buyer@globalsourcing.com',
      });

      // Vendor A: Registered in Raw Material
      const vendorA = storeService.addVendor({
        name: 'Steel Raw Supplies',
        email: 'sales@rawmaterial.com',
        majorCategory: 'Raw Material',
      });

      // Vendor B: Registered in Civil Works
      const vendorB = storeService.addVendor({
        name: 'BuildWell Infrastructure',
        email: 'info@buildwell.com',
        majorCategory: 'Civil Works',
      });

      // Vendor C: No category registered
      const vendorC = storeService.addVendor({
        name: 'General Traders',
        email: 'general@traders.com',
      });

      // Buyer creates a Mode 0 (Public) RFQ
      const rfqGeneral = storeService.createRFQ(
        {
          title: 'General Open Public Supplies',
          sourcingMode: 'mode_0',
          budget: 500000,
        },
        buyer
      );

      // All vendors can view open Mode 0 RFQ in Public Enquiries regardless of registered category
      expect(canVendorViewRfq(vendorA, rfqGeneral)).toBe(true);
      expect(canVendorViewRfq(vendorB, rfqGeneral)).toBe(true);
      expect(canVendorViewRfq(vendorC, rfqGeneral)).toBe(true);

      // Buyer creates a Mode 0 (Public) RFQ under "Raw Material"
      const rfqRaw = storeService.createRFQ(
        {
          title: 'Raw Material Supplies',
          category: 'Raw Material',
          sourcingMode: 'mode_0',
          budget: 1200000,
        },
        buyer
      );

      expect(canVendorViewRfq(vendorA, rfqRaw)).toBe(true);
      expect(canVendorViewRfq(vendorB, rfqRaw)).toBe(true);
      expect(canVendorViewRfq(vendorC, rfqRaw)).toBe(true);
    });
  });
});

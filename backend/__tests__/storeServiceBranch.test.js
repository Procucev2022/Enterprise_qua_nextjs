const storeService = require('../src/services/storeService');

describe('Store Service Deep Branch & Fallback Tests', () => {
  test('All store getter and setter edge cases', () => {
    // 1. Buyer Accounts. Not seeded any more; the signed-in buyer's account comes
    // from the identity schema, so this holds only runtime-created accounts.
    expect(storeService.getBuyerAccounts()).toEqual([]);
    expect(storeService.getActiveBuyerAccount()).toBeNull();

    storeService.alignActiveBuyerAccount('non-existent-id');
    expect(storeService.getActiveBuyerAccount()).toBeDefined();

    const createdBuyer = storeService.addBuyerAccount({
      organizationName: 'Custom Corp',
      corporateEmail: 'custom@corp.com',
    });
    expect(createdBuyer.id).toBeDefined();

    const updated = storeService.updateBuyerAccount(createdBuyer.id, {
      organizationName: 'Custom Corp 2',
      sourcingMode: 'mode_2',
      remainingFreeRFQs: 4,
    });
    expect(updated.organizationName).toBe('Custom Corp 2');

    const notUpdated = storeService.updateBuyerAccount('invalid-id', {});
    expect(notUpdated).toBeNull();

    const deletedBuyer = storeService.deleteBuyerAccount(createdBuyer.id);
    expect(deletedBuyer).toBe(true);
    expect(storeService.deleteBuyerAccount('invalid-id')).toBe(false);

    // 2. Vendors
    expect(storeService.getVendors().length).toBeGreaterThan(0);
    const vendor = storeService.getVendors()[0];
    expect(storeService.getVendorById(vendor.id)).toBeDefined();
    expect(storeService.getVendorById('invalid-vendor')).toBeUndefined();

    const createdVendor = storeService.addVendor({
      name: 'Test Vendor Store',
      email: 'store@vendor.com',
      majorCategory: 'Mechanical',
    });
    expect(createdVendor.id).toBeDefined();

    const updatedVendor = storeService.updateVendor(createdVendor.id, { name: 'Test Vendor Store Updated' });
    expect(updatedVendor.name).toBe('Test Vendor Store Updated');
    expect(storeService.updateVendor('invalid-vendor', {})).toBeNull();

    const ratedVendor = storeService.reviseVendorRating(createdVendor.id, {
      qualityScore: 90,
      costScore: 90,
      deliveryScore: 90,
      notes: 'Good performance',
    });
    expect(ratedVendor).toBeDefined();
    expect(storeService.reviseVendorRating('invalid-vendor', {})).toBeNull();

    const catUpdate = storeService.updateVendorCategories(createdVendor.id, {
      clientMappedCategories: ['Pumps & Accessories'],
      vendorSelectedCategories: ['Pumps & Accessories'],
    });
    expect(catUpdate.isCategoryAligned).toBe(true);
    expect(storeService.updateVendorCategories('invalid-vendor', {})).toBeNull();

    const deletedVendor = storeService.deleteVendor(createdVendor.id);
    expect(deletedVendor).toBe(true);
    expect(storeService.deleteVendor('invalid-vendor')).toBe(false);

    // 3. RFQs. No longer seeded here: they live in qua_enterprice_rfq, scoped to
    // a buyer organisation. This array only backs the quote and chaser flows that
    // have not been migrated yet, so it starts empty.
    expect(storeService.getRFQs()).toEqual([]);
    const rfq = storeService.getRFQById('invalid-rfq');
    expect(rfq).toBeUndefined();

    const createdRFQ = storeService.createRFQ({
      title: 'Testing Store RFQ',
      category: 'Mechanical',
    });
    expect(createdRFQ.rfqNumber).toBeDefined();

    const addedQuote = storeService.addQuoteToRFQ(createdRFQ.id, {
      vendorName: 'Apex',
      unitPrice: 45000,
    });
    expect(addedQuote).toBeDefined();
    expect(storeService.addQuoteToRFQ('invalid-rfq', {})).toBeNull();

    const updatedRFQ = storeService.updateRFQ(createdRFQ.id, { title: 'Updated RFQ Title' });
    expect(updatedRFQ.title).toBe('Updated RFQ Title');
    expect(storeService.updateRFQ('invalid-rfq', {})).toBeNull();

    const deletedRFQ = storeService.deleteRFQ(createdRFQ.id);
    expect(deletedRFQ).toBe(true);
    expect(storeService.deleteRFQ('invalid-rfq')).toBe(false);

    // 4. Evaluations
    expect(storeService.getEvaluations().length).toBeGreaterThan(0);
    const createdEval = storeService.createEvaluation({ vendorName: 'Eval Partner' });
    expect(createdEval.overallScore).toBeDefined();

    // 5. Audit Logs
    expect(storeService.getAuditLogs().length).toBeGreaterThan(0);
    const auditEntry = storeService.addAuditLog({ userEmail: 'test@admin.com', action: 'MANUAL_AUDIT' });
    expect(auditEntry.shaSignature).toBeDefined();
    expect(storeService.verifyAuditIntegrity().valid).toBe(true);

    // 6. AI Feed. Starts empty now that the seeded narrative is gone; it fills
    // only from real activity.
    const feedBefore = storeService.getAIFeed().length;
    const feedItem = storeService.addAIFeedItem({ title: 'AI Item', message: 'Test Msg' });
    expect(feedItem.id).toBeDefined();
    expect(storeService.getAIFeed().length).toBe(feedBefore + 1);

    // 7. System Config & Azure Health
    expect(storeService.getSystemConfig()).toBeDefined();
    const cfg = storeService.updateSystemConfig({ activeMode: 'mode_1' });
    expect(cfg.activeMode).toBe('mode_1');
    expect(storeService.getAzureHealth()).toBeDefined();

    // 8. Historical Data
    const histRes = storeService.processHistoricalPurchaseData('1_year', [{ companyName: 'Vendor Hist', email: 'hist@v.com' }]);
    expect(histRes.importedCount).toBe(1);

    // 9. Support Chat
    expect(storeService.handleSupportChat('I am unsatisfied and want to connect with agent').isEscalated).toBe(true);
    expect(storeService.handleSupportChat('tell me about subscription plans').reply).toContain('Procucev offers');
    expect(storeService.handleSupportChat('how does mode 1 work?').reply).toContain('Mode 1');
    expect(storeService.handleSupportChat('how to download rfq?').reply).toContain('Vendors can view');
    expect(storeService.handleSupportChat('generic question').reply).toBeDefined();

    // 10. Vendor Catalogue
    expect(storeService.getVendorCatalogue().length).toBeGreaterThan(0);
    const cat = storeService.addProductToCatalogue({
      name: 'Prod',
      sku: 'SKU-STORE',
      unitPrice: 100,
    });
    expect(cat.sku).toBe('SKU-STORE');
    expect(storeService.updateCatalogueProduct(cat.id, { unitPrice: 120 }).unitPrice).toBe(120);
    expect(storeService.updateCatalogueProduct('invalid-prod', {})).toBeNull();
    expect(storeService.deleteCatalogueProduct(cat.id)).toBe(true);
    expect(storeService.deleteCatalogueProduct('invalid-prod')).toBe(false);

    // 11. Batch Chaser & PO Approval
    const allRFQs = storeService.getRFQs();
    if (allRFQs.length > 0) {
      const chaserRes = storeService.triggerBatchChaser(allRFQs[0].id, ['call', 'whatsapp']);
      expect(chaserRes.success).toBe(true);

      const poRes = storeService.approvePurchaseOrder(allRFQs[0].rfqNumber, 'v-001', 'Apex', 45000, 'Notes');
      expect(poRes.poNumber).toBeDefined();
      expect(poRes.success).toBe(true);
    }
    expect(storeService.triggerBatchChaser('invalid-rfq')).toBeNull();

    // 12. Bootstrap Data
    const bootstrap = storeService.getBootstrapData();
    expect(bootstrap.buyerAccounts).toBeDefined();
    expect(bootstrap.vendors).toBeDefined();
    // RFQs are not in this anonymous payload any more; they come from the
    // authenticated, org-scoped GET /api/rfqs.
    expect(bootstrap.rfqs).toBeUndefined();
  });
});

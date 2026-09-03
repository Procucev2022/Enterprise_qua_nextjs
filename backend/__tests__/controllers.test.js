const aiFeedController = require('../src/controllers/aiFeedController');
const auditController = require('../src/controllers/auditController');
const bootstrapController = require('../src/controllers/bootstrapController');
const buyerAccountController = require('../src/controllers/buyerAccountController');
const catalogueController = require('../src/controllers/catalogueController');
const configController = require('../src/controllers/configController');
const dbController = require('../src/controllers/dbController');
const evaluationController = require('../src/controllers/evaluationController');
const rfqController = require('../src/controllers/rfqController');
const supportChatController = require('../src/controllers/supportChatController');
const vendorController = require('../src/controllers/vendorController');
const storeService = require('../src/services/storeService');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Controllers Error & Edge-Case Coverage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('aiFeedController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await aiFeedController.getAIFeed({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await aiFeedController.createFeedItem({ body: { title: 'Test Feed', message: 'Test Message' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await aiFeedController.createFeedItem({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    jest.spyOn(storeService, 'getAIFeed').mockImplementationOnce(() => {
      throw new Error('AI Feed Error');
    });
    await aiFeedController.getAIFeed({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('auditController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await auditController.getAuditLogs({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await auditController.createAuditLog({ body: { action: 'TEST_ACTION', userEmail: 'test@user.com' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await auditController.createAuditLog({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await auditController.verifyIntegrity({}, res, next);
    expect(res.json).toHaveBeenCalled();

    jest.spyOn(storeService, 'getAuditLogs').mockImplementationOnce(() => {
      throw new Error('Audit Error');
    });
    await auditController.getAuditLogs({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('bootstrapController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await bootstrapController.getBootstrap({}, res, next);
    expect(res.json).toHaveBeenCalled();

    jest.spyOn(storeService, 'getBootstrapData').mockImplementationOnce(() => {
      throw new Error('Bootstrap Error');
    });
    await bootstrapController.getBootstrap({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('buyerAccountController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await buyerAccountController.getBuyerAccounts({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.getActiveAccount({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.setActiveAccount({ body: { id: 'buyer-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.createBuyerAccount({ body: { organizationName: 'New Org', corporateEmail: 'test@org.com' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await buyerAccountController.createBuyerAccount({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await buyerAccountController.updateBuyerAccount({ params: { id: 'buyer-1' }, body: { organizationName: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await buyerAccountController.updateBuyerAccount({ params: { id: 'non-existent' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    jest.spyOn(storeService, 'getBuyerAccounts').mockImplementationOnce(() => {
      throw new Error('Buyer Accounts Error');
    });
    await buyerAccountController.getBuyerAccounts({}, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('catalogueController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    const adminUser = { role: 'admin', email: 'admin@procucev.com' };

    await catalogueController.getProducts({ query: {} }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.addProduct(
      { body: { name: 'Item', sku: 'SKU-1', unitPrice: 100, vendorId: 'v-001' }, user: adminUser },
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(201);

    await catalogueController.addProduct({ body: {}, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // 'prod-1' is a real seeded catalogue item with no owning vendorId; an
    // admin bypasses the ownership check that would otherwise 403 it.
    await catalogueController.updateProduct({ params: { id: 'prod-1' }, body: { name: 'Updated' }, user: adminUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.updateProduct({ params: { id: 'invalid-prod' }, body: {}, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await catalogueController.deleteProduct({ params: { id: 'prod-1' }, user: adminUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.deleteProduct({ params: { id: 'invalid-prod' }, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('configController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await configController.getSystemConfig({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await configController.updateSystemConfig({ body: { activeMode: 'mode_3' } }, res, next);
    expect(res.json).toHaveBeenCalled();
  });

  test('dbController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    // initDBSchema / syncDBData were removed with PostgreSQL. The controller now
    // reports identity-database health and the query efficiency report.
    await dbController.getDBStatus({}, res, next);
    expect(res.json).toHaveBeenCalled();
    await dbController.getDBMetrics({}, res, next);
    expect(res.json).toHaveBeenCalled();
  });
  test('dbController reports the domain store as persisted once it is hydrated', async () => {
    const next = jest.fn();
    const res = mockRes();
    const original = storeService.isHydratedFromDB;
    storeService.isHydratedFromDB = true;
    try {
      await dbController.getDBStatus({}, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          domainStore: expect.objectContaining({ mode: 'persisted' }),
        })
      );
    } finally {
      storeService.isHydratedFromDB = original;
    }
  });

  test('evaluationController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    const vendorUser = { role: 'vendor', email: 'rajesh@apexindustrial.in', name: 'Rajesh Nair' };
    const documents = [{ name: 'evidence.pdf' }];

    await evaluationController.getEvaluations({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await evaluationController.createEvaluation({ body: { vendorName: 'Apex', documents }, user: vendorUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    // A non-vendor role is rejected before ever reaching the evidence check.
    await evaluationController.createEvaluation({ body: {}, user: { role: 'buyer', email: 'buyer@x.com' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);

    // A vendor with incomplete evidence is rejected.
    await evaluationController.createEvaluation({ body: { documents: [{ name: '' }] }, user: vendorUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // A body-less request must fall back to {} rather than throwing on property access.
    await evaluationController.createEvaluation({ user: vendorUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // A vendor with no profile record yet falls back to their session identity.
    const noProfileRes = mockRes();
    await evaluationController.createEvaluation(
      { body: { documents }, user: { role: 'vendor', email: 'no-profile-vendor@test.com', name: 'No Profile', orgName: 'No Profile Org' } },
      noProfileRes,
      next
    );
    expect(noProfileRes.status).toHaveBeenCalledWith(201);
    expect(noProfileRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ vendorName: 'No Profile Org', email: 'no-profile-vendor@test.com' }) })
    );
  });

  test('rfqController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    const buyerUser = { role: 'buyer', email: 'buyer@procucev.com' };
    const vendorUser = { role: 'vendor', email: 'rajesh@apexindustrial.in' };

    await rfqController.getRFQs({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.getRFQById({ params: { id: 'rfq-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.getRFQById({ params: { id: 'non-existent' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await rfqController.createRFQ(
      {
        body: {
          title: 'New RFQ',
          category: 'Mechanical',
          budget: 50000,
          targetDeliveryDate: '2026-10-01',
        },
      },
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(201);

    await rfqController.createRFQ({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // A payload that clears the title check but violates another rule must still
    // be rejected, which the old bare `if (!body.title)` gate let through.
    await rfqController.createRFQ({ body: { title: 'Only a title' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // 'rfq-001' is a real seeded RFQ; 'rfq-1' never matches anything and was
    // silently always hitting the not-found path.
    await rfqController.updateRFQ({ params: { id: 'rfq-001' }, body: { title: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.addQuote({ params: { id: 'rfq-001' }, body: { unitPrice: 100 }, user: vendorUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.addQuote({ params: { id: 'rfq-001' }, body: {}, user: vendorUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await rfqController.generateEmailPreview({ params: { id: 'rfq-001' }, query: {} }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.triggerBatchChaser({ params: { id: 'rfq-001' }, body: { channels: ['call'] } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.approvePO({ params: { id: 'rfq-001' }, body: { vendorName: 'Apex', totalAmount: 50000 }, user: buyerUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.approvePO({ params: { id: 'rfq-001' }, body: {}, user: buyerUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // addQuote: role-block and missing-profile branches.
    const quoteForbiddenRes = mockRes();
    await rfqController.addQuote({ params: { id: 'rfq-001' }, body: { unitPrice: 100 }, user: buyerUser }, quoteForbiddenRes, next);
    expect(quoteForbiddenRes.status).toHaveBeenCalledWith(403);

    const quoteNoProfileRes = mockRes();
    await rfqController.addQuote(
      { params: { id: 'rfq-001' }, body: { unitPrice: 100 }, user: { role: 'vendor', email: 'no-profile-vendor@test.com' } },
      quoteNoProfileRes,
      next
    );
    expect(quoteNoProfileRes.status).toHaveBeenCalledWith(400);

    // approvePO: role-block and RFQ-not-found branches.
    const poForbiddenRes = mockRes();
    await rfqController.approvePO(
      { params: { id: 'rfq-001' }, body: { vendorName: 'Apex', totalAmount: 1000 }, user: vendorUser },
      poForbiddenRes,
      next
    );
    expect(poForbiddenRes.status).toHaveBeenCalledWith(403);

    const poNotFoundRes = mockRes();
    await rfqController.approvePO(
      { params: { id: 'non-existent' }, body: { vendorName: 'Apex', totalAmount: 1000 }, user: buyerUser },
      poNotFoundRes,
      next
    );
    expect(poNotFoundRes.status).toHaveBeenCalledWith(404);
  });

  test('supportChatController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    await supportChatController.sendMessage({ body: { prompt: 'How does Mode 1 work?' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await supportChatController.sendMessage({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('vendorController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();
    const adminUser = { role: 'admin', email: 'admin@procucev.com' };
    const buyerUser = { role: 'buyer', email: 'buyer@procucev.com' };

    await vendorController.getVendors({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.getVendorById({ params: { id: 'vendor-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.getVendorById({ params: { id: 'non-existent' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await vendorController.createVendor({ body: { name: 'New Vendor', majorCategory: 'Mechanical' }, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await vendorController.createVendor({ body: {}, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await vendorController.updateVendor({ params: { id: 'vendor-1' }, body: { name: 'Updated' }, user: adminUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    // Rating a vendor is buyer-side; a non-vendor role is required to reach
    // field validation / the store call at all.
    await vendorController.reviseRating(
      { params: { id: 'vendor-1' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 }, user: buyerUser },
      res,
      next
    );
    expect(res.json).toHaveBeenCalled();

    await vendorController.reviseRating({ params: { id: 'vendor-1' }, body: {}, user: buyerUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await vendorController.generateOnboardingEmailPreview({ params: { id: 'vendor-1' }, user: buyerUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.updateCategories(
      { params: { id: 'vendor-1' }, body: { vendorSelectedCategories: ['Pumps'] }, user: adminUser },
      res,
      next
    );
    expect(res.json).toHaveBeenCalled();

    await vendorController.deleteVendor({ params: { id: 'vendor-1' }, user: adminUser }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.deleteVendor({ params: { id: 'non-existent' }, user: adminUser }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    // assertVendorOwnership branches, exercised against 'v-001' (a real seeded
    // vendor) — only reachable via a direct controller call, since the real
    // routes always attach req.user via the authenticate middleware first.
    const unauthedRes = mockRes();
    await vendorController.updateVendor({ params: { id: 'v-001' }, body: {} }, unauthedRes, next);
    expect(unauthedRes.status).toHaveBeenCalledWith(401);

    const forbiddenRes = mockRes();
    await vendorController.updateVendor({ params: { id: 'v-001' }, body: {}, user: buyerUser }, forbiddenRes, next);
    expect(forbiddenRes.status).toHaveBeenCalledWith(403);

    // reviseRating: a vendor may not rate any vendor, including itself.
    const vendorOwnUser = { role: 'vendor', email: 'rajesh@apexindustrial.in' };
    const ratingBlockedRes = mockRes();
    await vendorController.reviseRating(
      { params: { id: 'v-001' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 }, user: vendorOwnUser },
      ratingBlockedRes,
      next
    );
    expect(ratingBlockedRes.status).toHaveBeenCalledWith(403);

    // reviseRating: an out-of-range score is rejected, not silently clamped.
    const badScoreRes = mockRes();
    await vendorController.reviseRating(
      { params: { id: 'v-001' }, body: { qualityScore: 150, costScore: 90, deliveryScore: 90 }, user: buyerUser },
      badScoreRes,
      next
    );
    expect(badScoreRes.status).toHaveBeenCalledWith(400);

    // generateOnboardingEmailPreview: a vendor may not view onboarding credentials.
    const emailBlockedRes = mockRes();
    await vendorController.generateOnboardingEmailPreview({ params: { id: 'v-001' }, user: vendorOwnUser }, emailBlockedRes, next);
    expect(emailBlockedRes.status).toHaveBeenCalledWith(403);
  });
});

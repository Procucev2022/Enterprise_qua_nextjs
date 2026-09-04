const aiFeedController = require('../src/controllers/aiFeedController');
// RFQ persistence and id allocation are doubled so these controller tests do not
// need a MySQL connection. See helpers/fakeRfqQueries.js.
jest.mock('../src/db/rfqQueries', () => require('./helpers/fakeRfqQueries'));
jest.mock('../src/services/rfqIdService', () => {
  let counter = 0;
  return {
    generateRfqId: jest.fn(async () => {
      counter += 1;
      return `RFQ260409${String(counter).padStart(6, '0')}`;
    }),
  };
});

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
const fakeRfqQueries = require('./helpers/fakeRfqQueries');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// The RFQ handlers read ownership from verified session claims, so a bare request
// object is now rejected before it reaches any store. `sub` rather than `id` is
// deliberate: that is the claim generateSessionToken actually writes.
const TEST_ORG_ID = 'org-buyer-01';
function buyerReq(overrides = {}) {
  return {
    user: { sub: 'usr-buyer-001', orgId: TEST_ORG_ID, email: 'buyer@procucev.com', role: 'buyer' },
    params: {},
    query: {},
    body: {},
    ...overrides,
  };
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

    await catalogueController.getProducts({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.addProduct({ body: { name: 'Item', sku: 'SKU-1', unitPrice: 100 } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await catalogueController.addProduct({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await catalogueController.updateProduct({ params: { id: 'prod-1' }, body: { name: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.updateProduct({ params: { id: 'invalid-prod' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await catalogueController.deleteProduct({ params: { id: 'prod-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await catalogueController.deleteProduct({ params: { id: 'invalid-prod' } }, res, next);
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

    await evaluationController.getEvaluations({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await evaluationController.createEvaluation({ body: { vendorName: 'Apex' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await evaluationController.createEvaluation({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('rfqController methods & error handling', async () => {
    const next = jest.fn();
    const res = mockRes();

    fakeRfqQueries.__reset();
    fakeRfqQueries.__seed([
      { rfqId: 'RFQ260409000900', buyerOrgId: TEST_ORG_ID, buyerEmail: 'buyer@procucev.com', title: 'Seeded RFQ' },
    ]);

    await rfqController.getRFQs(buyerReq(), res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.getRFQById(buyerReq({ params: { id: 'RFQ260409000900' } }), res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.getRFQById(buyerReq({ params: { id: 'non-existent' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    // No session at all: rejected before any store is touched.
    await rfqController.getRFQs({}, res, next);
    expect(res.status).toHaveBeenCalledWith(401);

    // A verified session whose account is not linked to a buyer organisation.
    // There is no owner to scope by, and listing everything instead would be the
    // leak this scoping exists to prevent.
    await rfqController.getRFQs({ user: { sub: 'usr-1', email: 'x@y.com' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);

    await rfqController.createRFQ(
      buyerReq({
        body: {
          title: 'New RFQ',
          category: 'Mechanical',
          budget: 50000,
          targetDeliveryDate: '2026-10-01',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
        },
      }),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(201);

    await rfqController.createRFQ(buyerReq({ body: {} }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // A payload that clears the title check but violates another rule must still
    // be rejected, which the old bare `if (!body.title)` gate let through.
    await rfqController.createRFQ(buyerReq({ body: { title: 'Only a title' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    // Line items arrive as `extractedEntities` from the wizard, but the API also
    // accepts `lineItems`, and an RFQ with neither must still save.
    const validBody = {
      title: 'Line item shapes',
      category: 'Mechanical',
      budget: 1,
      targetDeliveryDate: '2026-10-01',
      deliveryLocation: 'Navi Mumbai Plant, Gate 3',
      deliveryPincode: '400701',
    };

    const withLineItems = mockRes();
    await rfqController.createRFQ(
      buyerReq({ body: { ...validBody, lineItems: [{ itemName: 'Pump', quantity: 1 }] } }),
      withLineItems,
      next
    );
    expect(withLineItems.status).toHaveBeenCalledWith(201);
    expect(withLineItems.json.mock.calls[0][0].data.extractedEntities).toHaveLength(1);

    const withNoItems = mockRes();
    await rfqController.createRFQ(buyerReq({ body: validBody }), withNoItems, next);
    expect(withNoItems.status).toHaveBeenCalledWith(201);
    expect(withNoItems.json.mock.calls[0][0].data.extractedEntities).toEqual([]);

    // An explicit status wins over the default, and a session with no orgName
    // still produces a summary.
    const withStatus = mockRes();
    await rfqController.createRFQ(
      {
        user: { sub: 'usr-buyer-001', orgId: TEST_ORG_ID, email: 'buyer@procucev.com' },
        body: { ...validBody, status: 'In Evaluation' },
      },
      withStatus,
      next
    );
    expect(withStatus.status).toHaveBeenCalledWith(201);
    expect(withStatus.json.mock.calls[0][0].data.status).toBe('In Evaluation');

    await rfqController.updateRFQ({ params: { id: 'rfq-1' }, body: { title: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.addQuote({ params: { id: 'rfq-1' }, body: { vendorName: 'Apex', unitPrice: 100 } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.addQuote({ params: { id: 'rfq-1' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await rfqController.generateEmailPreview(
      buyerReq({ params: { id: 'RFQ260409000900' }, query: {} }),
      res,
      next
    );
    expect(res.json).toHaveBeenCalled();

    await rfqController.triggerBatchChaser({ params: { id: 'rfq-1' }, body: { channels: ['call'] } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.approvePO({ params: { id: 'rfq-1' }, body: { vendorName: 'Apex', totalAmount: 50000 } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await rfqController.approvePO({ params: { id: 'rfq-1' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
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

    await vendorController.getVendors({}, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.getVendorById({ params: { id: 'vendor-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.getVendorById({ params: { id: 'non-existent' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);

    await vendorController.createVendor({ body: { name: 'New Vendor', majorCategory: 'Mechanical' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(201);

    await vendorController.createVendor({ body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await vendorController.updateVendor({ params: { id: 'vendor-1' }, body: { name: 'Updated' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.reviseRating({ params: { id: 'vendor-1' }, body: { qualityScore: 90, costScore: 90, deliveryScore: 90 } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.reviseRating({ params: { id: 'vendor-1' }, body: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);

    await vendorController.generateOnboardingEmailPreview({ params: { id: 'vendor-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.updateCategories({ params: { id: 'vendor-1' }, body: { vendorSelectedCategories: ['Pumps'] } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.deleteVendor({ params: { id: 'vendor-1' } }, res, next);
    expect(res.json).toHaveBeenCalled();

    await vendorController.deleteVendor({ params: { id: 'non-existent' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RFQ controller: remaining scope and fallback branches
// ══════════════════════════════════════════════════════════════════════════════
describe('rfqController scope and fallback branches', () => {
  const TEST_ORG = 'org-buyer-01';

  function scopedReq(overrides = {}) {
    return {
      user: { sub: 'usr-buyer-001', orgId: TEST_ORG, email: 'buyer@procucev.com', role: 'buyer' },
      params: {},
      query: {},
      body: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    fakeRfqQueries.__reset();
    fakeRfqQueries.__seed([
      {
        rfqId: 'RFQ260409000901',
        buyerOrgId: TEST_ORG,
        buyerEmail: 'buyer@procucev.com',
        title: 'Branch coverage RFQ',
      },
    ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Every RFQ read must refuse before it touches the database.
  test.each([
    ['getRFQs', {}],
    ['getRFQSummary', {}],
    ['getRFQById', { params: { id: 'RFQ260409000901' } }],
    ['generateEmailPreview', { params: { id: 'RFQ260409000901' }, query: {} }],
  ])('%s answers 401 without a session', async (handler, req) => {
    const res = mockRes();
    const next = jest.fn();
    await rfqController[handler](req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ['getRFQs', {}],
    ['getRFQSummary', {}],
  ])('%s answers 403 when the account has no organisation', async (handler, extra) => {
    const res = mockRes();
    const next = jest.fn();
    await rfqController[handler]({ user: { sub: 'usr-1' }, ...extra }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('getRFQSummary rolls up only this organisation\'s RFQs', async () => {
    const res = mockRes();
    await rfqController.getRFQSummary(scopedReq(), res, jest.fn());

    const summary = res.json.mock.calls[0][0].data;
    expect(summary.totalRFQs).toBe(1);
    // Another organisation's RFQ must not appear in these totals.
    fakeRfqQueries.__seed([{ rfqId: 'RFQ260409000902', buyerOrgId: 'other-org', budget: 999 }]);

    const res2 = mockRes();
    await rfqController.getRFQSummary(scopedReq(), res2, jest.fn());
    expect(res2.json.mock.calls[0][0].data.totalRFQs).toBe(1);
  });

  // The wizard sends extractedEntities; this pins that branch of the ternary.
  test('createRFQ stores extractedEntities when the wizard supplies them', async () => {
    const res = mockRes();
    await rfqController.createRFQ(
      scopedReq({
        body: {
          title: 'Extracted entities path',
          category: 'Mechanical',
          budget: 10,
          targetDeliveryDate: '2026-10-01',
          deliveryLocation: 'Navi Mumbai Plant, Gate 3',
          deliveryPincode: '400701',
          extractedEntities: [
            { itemName: 'Pump', quantity: 2, unit: 'Nos', minorCategory: 'Pumps' },
            { itemName: 'Valve', quantity: 1, unit: 'Nos', minorCategory: 'Valves' },
          ],
        },
      }),
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const created = res.json.mock.calls[0][0].data;
    expect(created.extractedEntities).toHaveLength(2);
    // A summary is always attached, derived when Gemini is unavailable.
    expect(created.aiSummary.itemCount).toBe(2);
    expect(created.aiSummary.generatedBy).toBe('derived');
  });

  // Both handlers tolerate a request that arrived with no body at all.
  test.each([['createRFQ'], ['ingestRFQ']])('%s tolerates a missing body', async (handler) => {
    const res = mockRes();
    await rfqController[handler](scopedReq({ body: undefined }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('generateEmailPreview resolves a named vendor', async () => {
    const res = mockRes();
    const storeSvc = require('../src/services/storeService');
    const vendor = storeSvc.getVendors()[0];

    await rfqController.generateEmailPreview(
      scopedReq({ params: { id: 'RFQ260409000901' }, query: { vendorId: vendor.id } }),
      res,
      jest.fn()
    );

    expect(res.json).toHaveBeenCalled();
  });

  // An attachment rejection this controller has no specific message for still has
  // to say something useful rather than returning an empty error.
  test('uploadRFQAttachment falls back to a generic storage message', async () => {
    const attachmentService = require('../src/services/rfqAttachmentService');
    jest.spyOn(attachmentService, 'saveAttachment').mockReturnValue({ status: 'SOME_NEW_STATUS' });

    const res = mockRes();
    await rfqController.uploadRFQAttachment(
      scopedReq({
        body: { fileName: 'annexure.pdf', mimeType: 'application/pdf', contentBase64: 'AAAA' },
      }),
      res,
      jest.fn()
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error.length).toBeGreaterThan(0);
  });
});

const bootstrapController = require('../src/controllers/bootstrapController');
const storeService = require('../src/services/storeService');
const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');

function mockRes() {
  const res = {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

describe('bootstrapController 100% Branch Coverage', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('buyer role with full buyerAccount and user properties', async () => {
    const buyerAccount = {
      id: 'acc-full-1',
      corporateEmail: 'buyer@full.com',
      organizationId: 'org-full-1',
    };
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(buyerAccount);
    const evaluation = { id: 'eval-buyer-view', email: 'vendor@company.test', buyerAccountId: 'acc-full-1' };
    const foreignEval = { id: 'eval-unassociated', email: 'other@company.test', vendorName: 'Other Vendor' };
    const getBootSpy = jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ rfqs: [], evaluations: [evaluation, foreignEval] });

    const req = {
      user: {
        role: 'buyer',
        sub: 'sub-1',
        id: 'user-id-1',
        email: 'buyer@full.com',
        orgId: 'org-full-1',
      },
    };
    const res = mockRes();
    const next = jest.fn();

    await bootstrapController.getBootstrap(req, res, next);

    expect(res.statusCode).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.evaluations).toEqual([evaluation]);
    expect(getBootSpy).toHaveBeenCalledWith(
      ['acc-full-1', 'buyer@full.com', 'org-full-1', 'sub-1', 'user-id-1', 'buyer@full.com', 'org-full-1'],
      'buyer@full.com'
    );

    // Partial buyerAccount (only corporateEmail)
    storeService.ensureBuyerAccountForUser.mockResolvedValue({ corporateEmail: 'only@email.com' });
    await bootstrapController.getBootstrap({ user: { role: 'buyer' } }, mockRes(), next);
  });

  test('buyer role with null buyerAccount falling back to sub and email', async () => {
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(null);
    const getBootSpy = jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ rfqs: [] });

    // With sub
    const reqSub = {
      user: {
        role: 'buyer',
        sub: 'sub-only',
      },
    };
    const resSub = mockRes();
    await bootstrapController.getBootstrap(reqSub, resSub, jest.fn());
    expect(resSub.statusCode).toBe(200);
    expect(getBootSpy).toHaveBeenCalledWith(['sub-only'], undefined);

    // Without sub, with email
    const reqEmail = {
      user: {
        role: 'buyer',
        email: 'fallback@buyer.com',
      },
    };
    const resEmail = mockRes();
    await bootstrapController.getBootstrap(reqEmail, resEmail, jest.fn());
    expect(resEmail.statusCode).toBe(200);
    expect(getBootSpy).toHaveBeenCalledWith(['fallback@buyer.com'], 'fallback@buyer.com');
  });

  test('non-buyer user with query buyerId and refresh = true with persisted source', async () => {
    const hydrateSpy = jest.spyOn(storeService, 'hydrateFromDB').mockResolvedValue(undefined);
    const ownEvaluation = { id: 'eval-own', email: 'v@corp.com' };
    const otherEvaluation = { id: 'eval-other', email: 'other@corp.com' };
    const getBootSpy = jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({
      rfqs: [],
      evaluations: [ownEvaluation, otherEvaluation, { id: 'eval-no-email' }],
    });
    storeService.isHydratedFromDB = true;

    const req = {
      user: { role: 'vendor', email: 'v@corp.com' },
      query: { buyerId: 'query-buyer-1', refresh: 'true' },
    };
    const res = mockRes();
    await bootstrapController.getBootstrap(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(hydrateSpy).toHaveBeenCalled();
    expect(res.data.source).toBe('persisted');
    expect(res.data.data.evaluations).toEqual([ownEvaluation]);
    expect(getBootSpy).toHaveBeenCalledWith(['query-buyer-1'], 'v@corp.com');

    storeService.isHydratedFromDB = false;
  });

  test('admin bootstrap includes all evaluations while a vendor without email gets none', async () => {
    const evaluations = [
      { id: 'eval-1', email: 'vendor-one@corp.test' },
      { id: 'eval-2', email: 'vendor-two@corp.test' },
    ];
    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ evaluations });

    const adminRes = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'admin' } }, adminRes, jest.fn());
    expect(adminRes.data.data.evaluations).toEqual(evaluations);

    const vendorRes = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'vendor' } }, vendorRes, jest.fn());
    expect(vendorRes.data.data.evaluations).toEqual([]);
  });

test('non-buyer user with query refresh = true handles hydration failure gracefully without crashing', async () => {
    jest.spyOn(storeService, 'hydrateFromDB').mockRejectedValue(new Error('D1_ERROR: D1 DB is overloaded'));
    const getBootSpy = jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ rfqs: [] });
    storeService.isHydratedFromDB = true;

    const req = {
      user: { role: 'vendor', email: 'v@corp.com' },
      query: { refresh: 'true' },
    };
    const res = mockRes();
    await bootstrapController.getBootstrap(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.data.source).toBe('persisted');
    expect(getBootSpy).toHaveBeenCalled();

    storeService.isHydratedFromDB = false;
  });

  test('anonymous user without query params with in_memory source', async () => {
    const getBootSpy = jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ rfqs: [] });
    storeService.isHydratedFromDB = false;

    const req = {};
    const res = mockRes();
    await bootstrapController.getBootstrap(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.data.source).toBe('in_memory');
    expect(res.data.data.evaluations).toEqual([]);
    expect(getBootSpy).toHaveBeenCalledWith(null, undefined);
  });

  test('catch block forwards error to next middleware', async () => {
    jest.spyOn(storeService, 'getBootstrapData').mockRejectedValue(new Error('bootstrap failure'));
    const next = jest.fn();

    await bootstrapController.getBootstrap({}, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('gracefully handles D1 overload error during getBootstrapData by serving degraded payload', async () => {
    jest.spyOn(storeService, 'getBootstrapData').mockRejectedValue(new Error('D1 DB is overloaded. Too many resources consumed within a 10 second window'));
    const next = jest.fn();
    const res = mockRes();

    await bootstrapController.getBootstrap({}, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.data.success).toBe(true);
    expect(res.data.data.vendors).toBeDefined();
    expect(res.data.data.buyerAccounts).toBeDefined();
  });

  test('gracefully handles failure in ensureBuyerAccountForUser without crashing', async () => {
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockRejectedValue(new Error('DB failure in buyer account'));
    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ rfqs: [] });
    const next = jest.fn();
    const res = mockRes();

    await bootstrapController.getBootstrap({ user: { role: 'buyer', email: 'test@buyer.com' } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  test('gracefully handles D1 overload error when storeService has null collection fields', async () => {
    jest.spyOn(storeService, 'getBootstrapData').mockRejectedValue(new Error('D1 DB is overloaded'));
    const origAccounts = storeService.buyerAccounts;
    const origVendors = storeService.vendors;
    const origEvals = storeService.evaluations;
    const origLogs = storeService.auditLogs;
    storeService.buyerAccounts = null;
    storeService.vendors = null;
    storeService.evaluations = null;
    storeService.auditLogs = null;

    try {
      const res = mockRes();
      await bootstrapController.getBootstrap({}, res, jest.fn());
      expect(res.statusCode).toBe(200);
      expect(res.data.data.buyerAccounts).toEqual([]);
      expect(res.data.data.vendors).toEqual([]);
      expect(res.data.data.evaluations).toEqual([]);
      expect(res.data.data.auditLogs).toEqual([]);
    } finally {
      storeService.buyerAccounts = origAccounts;
      storeService.vendors = origVendors;
      storeService.evaluations = origEvals;
      storeService.auditLogs = origLogs;
    }
  });

  test('covers user.orgId branch for buyer', async () => {
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(null);
    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({});
    const res = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'buyer', orgId: 'org-123' } }, res, jest.fn());
    expect(res.statusCode).toBe(200);
  });

  test('buyer evaluation and vendor scoping filters unassociated vendors and evaluations', async () => {
    const buyerAccount = {
      id: 'buyer-acc-123',
      corporateEmail: 'buyer@enterprise.com',
    };
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue(buyerAccount);

    const ownedVendor1 = {
      id: 'v-owned-1',
      buyerAccountId: 'buyer-acc-123',
      email: 'vendor1@owned.com',
      name: 'Owned Vendor 1',
    };
    const ownedVendor2 = {
      id: 'v-owned-2',
      buyerEmail: 'buyer@enterprise.com',
      email: 'vendor2@owned.com',
      name: 'Owned Vendor 2',
    };
    const foreignVendor = {
      id: 'v-foreign-99',
      buyerAccountId: 'buyer-acc-other',
      email: 'foreign@other.com',
      name: 'Foreign Vendor',
    };

    const evalOwnedByBuyerId = {
      id: 'eval-1',
      buyerAccountId: 'buyer-acc-123',
      vendorId: 'v-unknown',
      vendorName: 'Direct Buyer Eval',
    };
    const evalOwnedByVendorId = {
      id: 'eval-2',
      vendorId: 'v-owned-1',
      vendorName: 'Owned Vendor 1 Eval',
    };
    const evalOwnedByVendorEmail = {
      id: 'eval-3',
      vendorId: 'v-diff',
      email: 'vendor2@owned.com',
      vendorName: 'Owned Vendor 2 Eval',
    };
    const evalForeign = {
      id: 'eval-foreign',
      vendorId: 'v-foreign-99',
      email: 'foreign@other.com',
      vendorName: 'Veera Solutions Pvt LTD',
    };
    const evalOtherBuyerSameEmail = {
      id: 'eval-other-buyer',
      buyerAccountId: 'buyer-acc-other',
      vendorId: 'v-diff-2',
      email: 'vendor1@owned.com',
      vendorName: 'Owned Vendor 1',
    };

    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({
      vendors: [ownedVendor1, ownedVendor2, foreignVendor],
      evaluations: [evalOwnedByBuyerId, evalOwnedByVendorId, evalOwnedByVendorEmail, evalForeign, evalOtherBuyerSameEmail],
    });

    const req = {
      user: {
        role: 'buyer',
        email: 'buyer@enterprise.com',
        id: 'user-buyer-1',
      },
    };
    const res = mockRes();
    await bootstrapController.getBootstrap(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    // Foreign evaluation must be filtered out for the buyer!
    expect(res.data.data.evaluations).toHaveLength(3);
    expect(res.data.data.evaluations.map((e) => e.id)).toEqual(['eval-1', 'eval-2', 'eval-3']);
    expect(res.data.data.evaluations.find((e) => e.vendorName === 'Veera Solutions Pvt LTD')).toBeUndefined();
    expect(res.data.data.evaluations.find((e) => e.id === 'eval-other-buyer')).toBeUndefined();

    // Foreign vendor must be sanitized
    const returnedForeignVendor = res.data.data.vendors.find((v) => v.id === 'v-foreign-99');
    expect(returnedForeignVendor).toBeDefined();
    expect(returnedForeignVendor.contactEmail).toBeUndefined();

    // Buyer with zero owned vendors must not inherit unassociated DB evaluations
    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({
      vendors: [foreignVendor],
      evaluations: [evalForeign, evalOwnedByBuyerId],
    });
    const emptyOwnedRes = mockRes();
    await bootstrapController.getBootstrap(req, emptyOwnedRes, jest.fn());
    expect(emptyOwnedRes.data.data.evaluations.map((e) => e.id)).toEqual(['eval-1']);
  });

  test('vendor role scopes vendors and recognizes isOwnVendor', async () => {
    const ownVendor = {
      id: 'v-vendor-own',
      email: 'supplier@own.com',
      name: 'My Own Vendor Profile',
    };
    const otherVendor = {
      id: 'v-other',
      email: 'other@vendor.com',
      name: 'Other Vendor',
    };

    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({
      vendors: [ownVendor, otherVendor],
      evaluations: [],
    });

    const req = {
      user: {
        role: 'vendor',
        email: 'supplier@own.com',
      },
    };
    const res = mockRes();
    await bootstrapController.getBootstrap(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    const returnedOwn = res.data.data.vendors.find((v) => v.id === 'v-vendor-own');
    expect(returnedOwn.email).toBe('supplier@own.com');
  });

  test('merges buyer vendor_master_records fallback when uploaded suppliers are not yet in vendors table', async () => {
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({
      id: 'ba-org-1',
      corporateEmail: 'veera@procucev.com',
      organizationName: 'Veera solutions pvt ltd',
    });
    jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
      found: true,
      profile: { organizationId: 'org-master-1' },
    });
    jest.spyOn(vendorIngestionQueries, 'findLatestSession').mockResolvedValue({ id: 'sess-master-1' });
    jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecords').mockResolvedValue([
      { id: 'rec-existing-email', vendorCode: 'V-EX1', companyName: 'Existing Email Co', email: 'existing@co.test' },
      { id: 'rec-existing-code', vendorCode: 'VC-DUP', companyName: 'Existing Code Co', email: 'newemail@co.test' },
      { id: 'rec-empty', vendorCode: '', companyName: '', email: '' },
      { id: 'rec-new-1', vendorCode: 'VC-10', companyName: 'Testing CSV Co', email: 'csv@co.test', contactPerson: 'Veera', phone: '9999999999', address: 'Hyderabad', gstin: '36ABCDE1234F1Z5', rating: 4.6 },
      { id: 'rec-new-pin', vendorCode: 'VC-11', companyName: 'Veera Solutions Pvt LTD', email: 'veerababu@procucev.com', contactPerson: 'Veera', phone: '9381877013', address: '302, Sharada, AECS Layout, Kundalahalli, Bengaluru - 560037', gstin: '27AAACK3921P1Z9', rating: null },
      { id: 'rec-new-2', vendorCode: '', companyName: '', email: 'emailonly@co.test', rating: null },
    ]);
    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({
      vendors: [
        { id: 'v-ex-1', email: 'existing@co.test', vendorCode: 'VC-EX', buyerId: 'ba-org-1', name: 'Existing Email Co' },
        { id: 'v-ex-2', email: 'other@co.test', vendorCode: 'VC-DUP', buyerId: 'ba-org-1', name: 'Existing Code Co' },
      ],
      vendorsTotal: 2,
      evaluations: [{ id: 'ev-1', email: 'csv@co.test' }, { id: 'ev-foreign', email: 'stranger@x.test' }],
    });

    const req = { user: { role: 'buyer', sub: 'u-veera-1', email: 'veera@procucev.com' } };
    const res = mockRes();
    await bootstrapController.getBootstrap(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(res.data.data.vendorsTotal).toBe(5);
    const csvVendor = res.data.data.vendors.find((v) => v.id === 'v-master-rec-new-1');
    const pinVendor = res.data.data.vendors.find((v) => v.id === 'v-master-rec-new-pin');
    const emailOnlyVendor = res.data.data.vendors.find((v) => v.id === 'v-master-rec-new-2');
    expect(csvVendor).toMatchObject({
      name: 'Testing CSV Co',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: null,
      rating: 4.6,
      source: 'vendor_master_ingestion',
      addedByBuyerCompany: 'Veera solutions pvt ltd',
    });
    expect(pinVendor).toMatchObject({
      name: 'Veera Solutions Pvt LTD',
      location: '302, Sharada, AECS Layout, Kundalahalli, Bengaluru - 560037',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560037',
    });
    expect(emailOnlyVendor).toMatchObject({ name: 'emailonly@co.test', rating: null });
    expect(res.data.data.evaluations.map((e) => e.id)).toEqual(['ev-1']);
  });

  test('handles missing orgId, missing session, empty records, and query errors gracefully in master fallback', async () => {
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({
      id: 'ba-no-org',
      corporateEmail: 'noorg@test.com',
    });
    const profileSpy = jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({ found: false });
    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ vendors: [], evaluations: [] });

    // Case 1: no orgId resolved
    const resNoOrg = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'buyer', sub: 'u-no-org', email: 'noorg@test.com' } }, resNoOrg, jest.fn());
    expect(resNoOrg.data.data.vendors).toEqual([]);

    // Case 2: orgId from user.orgId, findLatestSession returns null
    const sessSpy = jest.spyOn(vendorIngestionQueries, 'findLatestSession').mockResolvedValue(null);
    const resNoSess = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'buyer', orgId: 'org-2', email: 'noorg@test.com' } }, resNoSess, jest.fn());
    expect(resNoSess.data.data.vendors).toEqual([]);

    // Case 3: findLatestSession throws error (caught and warns)
    profileSpy.mockRestore();
    sessSpy.mockRejectedValueOnce(new Error('D1 table missing'));
    const resErr = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'buyer', orgId: 'org-3', email: 'noorg@test.com' } }, resErr, jest.fn());
    expect(resErr.statusCode).toBe(200);
    expect(resErr.data.data.vendors).toEqual([]);
  });

  test('enriches master fallback vendors with approved category mappings and never emits Vendor Master placeholder', async () => {
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({
      id: 'ba-cat-1',
      corporateEmail: 'catbuyer@procucev.com',
      organizationName: 'Cat Buyer Ltd',
    });
    jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
      found: true,
      profile: { organizationId: 'org-cat-1' },
    });
    jest.spyOn(vendorIngestionQueries, 'findLatestSession').mockResolvedValue({ id: 'sess-cat-1' });
    jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecords').mockResolvedValue([
      { id: 'rec-mapped', vendorCode: 'VC-M1', companyName: 'Mapped Vendor', email: 'mapped@co.test' },
      { id: 'rec-placeholder', vendorCode: 'VC-M2', companyName: 'Placeholder Map Vendor', email: 'ph@co.test' },
      { id: 'rec-rejected', vendorCode: 'VC-M3', companyName: 'Rejected Map Vendor', email: 'rej@co.test' },
    ]);
    jest.spyOn(vendorIngestionQueries, 'findCategoryMappings').mockResolvedValue([
      {
        vendorRecordId: 'rec-mapped',
        buyerMajorCategory: 'Mechanical',
        buyerMinorCategories: ['Industrial Valves', 'Gate Valves'],
        aiSuggestion: { majorCategory: 'Mechanical', minorCategories: ['Ball Valves'] },
        reviewAction: 'APPROVED',
      },
      {
        vendorRecordId: 'rec-placeholder',
        aiSuggestion: { majorCategory: 'Vendor Master', minorCategories: ['Uncategorized'] },
        status: 'PENDING',
      },
      {
        vendorRecordId: 'rec-rejected',
        aiSuggestion: { majorCategory: 'IT Infrastructure', minorCategories: ['Laptops'] },
        reviewAction: 'REJECTED',
      },
    ]);
    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ vendors: [], evaluations: [] });

    const res = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'buyer', sub: 'u-cat-1', email: 'catbuyer@procucev.com' } }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    const mapped = res.data.data.vendors.find((v) => v.id === 'v-master-rec-mapped');
    const placeholder = res.data.data.vendors.find((v) => v.id === 'v-master-rec-placeholder');
    const rejected = res.data.data.vendors.find((v) => v.id === 'v-master-rec-rejected');

    expect(mapped).toMatchObject({
      majorCategory: 'Mechanical',
      minorCategories: ['Industrial Valves', 'Gate Valves'],
    });
    expect(placeholder.majorCategory).toBe('');
    expect(placeholder.minorCategories).toEqual([]);
    expect(rejected.majorCategory).toBe('');
    expect(rejected.minorCategories).toEqual([]);
  });

  test('derives minor categories from relevantProducts and itemsSupplied in master fallback and ignores empty candidates', async () => {
    jest.spyOn(storeService, 'ensureBuyerAccountForUser').mockResolvedValue({
      id: 'ba-derive-1',
      corporateEmail: 'derive@procucev.com',
      organizationId: 'org-derive-1',
    });
    jest.spyOn(vendorIngestionQueries, 'findLatestSession').mockResolvedValue({ id: 'sess-derive-1' });
    jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecords').mockResolvedValue([
      {
        id: 'rec-derive-products',
        vendorCode: 'VC-D1',
        companyName: 'Civil Supply Co',
        email: 'civil@co.test',
        majorCategory: 'Civil Works',
        minorCategories: [],
        itemsSupplied: ['', 'Plumbing Kit', 'Paints'],
      },
      {
        id: 'rec-derive-items-only',
        vendorCode: 'VC-D2',
        companyName: 'Roofing Supply Co',
        email: 'roof@co.test',
        majorCategory: 'Civil Works',
        minorCategories: [],
        itemsSupplied: ['Brick', 'Bricks', ''],
      },
      {
        id: 'rec-unknown-major',
        vendorCode: 'VC-D3',
        companyName: 'Custom Co',
        email: 'custom@co.test',
        majorCategory: 'NonExistent Division',
        minorCategories: [],
        itemsSupplied: ['Widgets'],
      },
    ]);
    jest.spyOn(vendorIngestionQueries, 'findCategoryMappings').mockRejectedValue(new Error('mappings table offline'));
    jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ vendors: [], evaluations: [] });

    const res = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'buyer', orgId: 'org-derive-1', email: 'derive@procucev.com' } }, res, jest.fn());

    expect(res.statusCode).toBe(200);
    const civil = res.data.data.vendors.find((v) => v.id === 'v-master-rec-derive-products');
    const roof = res.data.data.vendors.find((v) => v.id === 'v-master-rec-derive-items-only');
    const custom = res.data.data.vendors.find((v) => v.id === 'v-master-rec-unknown-major');
    expect(civil.minorCategories).toEqual(['Plumbing', 'Paints']);
    expect(roof.minorCategories).toEqual(['Bricks']);
    expect(custom.minorCategories).toEqual([]);

    // Also cover relevantProducts path when category mappings resolve and empty masterRecords branch
    vendorIngestionQueries.findCategoryMappings.mockResolvedValueOnce([
      {
        vendorRecordId: 'rec-derive-products',
        aiSuggestion: { majorCategory: 'Civil Works', minorCategories: [], relevantProducts: ['TMT BARS', 'tmt bars', ''] },
      },
    ]);
    const resMapped = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'buyer', orgId: 'org-derive-1', email: 'derive@procucev.com' } }, resMapped, jest.fn());
    const civilMapped = resMapped.data.data.vendors.find((v) => v.id === 'v-master-rec-derive-products');
    expect(civilMapped.minorCategories).toEqual(expect.arrayContaining(['TMT BARS', 'Plumbing', 'Paints']));

    vendorIngestionQueries.findVendorMasterRecords.mockResolvedValueOnce([]);
    const resEmpty = mockRes();
    await bootstrapController.getBootstrap({ user: { role: 'buyer', orgId: 'org-derive-1', email: 'derive@procucev.com' } }, resEmpty, jest.fn());
    expect(resEmpty.data.data.vendors).toEqual([]);
  });
});

/**
 * A buyer may request an evaluation from any supplier on that buyer's roster. The roster is built from the stored
 * vendor rows and the buyer's identifiers, so the request must resolve the same rows, not only the in-memory subset.
 */
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
const vendorIngestionQueries = require('../src/db/vendorIngestionQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const pool = require('../src/db/pool');
const vendorController = require('../src/controllers/vendorController');

const VENDOR_ID = 'v-hist-1791613849048-0';
const BUYER_ACCOUNT = {
  id: 'buyer-acc-1',
  organizationName: 'Acme Ltd',
  contactPerson: 'Priya',
  corporateEmail: 'procurement@acme.test',
};
const BUYER = { id: 'user-1', email: 'buyer@acme.test', role: 'buyer', name: 'Priya', orgName: 'Acme Ltd' };

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

function storedVendor(overrides = {}) {
  return {
    id: VENDOR_ID,
    name: 'Govardhan Solutions pvt LTD',
    email: 'govardhan.kilari@procucev.com',
    contactPerson: 'Govardhan',
    status: 'PENDING EVALUATION',
    source: 'buyer_uploaded',
    buyerId: BUYER_ACCOUNT.id,
    ...overrides,
  };
}

describe('vendor evaluation request: suppliers on the buyer roster', () => {
  let dispatch;
  let next;

  beforeEach(() => {
    next = jest.fn();
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(BUYER_ACCOUNT);
    jest.spyOn(storeService, 'getVendorEvaluationsDurably').mockResolvedValue([]);
    dispatch = jest.spyOn(storeService, 'requestVendorEvaluationDurably').mockResolvedValue({
      vendorId: VENDOR_ID,
      evaluationRequested: true,
      status: 'PENDING EVALUATION',
    });
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockResolvedValue(null);
  });

  afterEach(() => {
    // The lookup caches a stored vendor in memory. Remove it so the next test starts from a clean list.
    storeService.vendors = storeService.vendors.filter(
      (vendor) => vendor.id !== VENDOR_ID && vendor.id !== 'other-v-1'
    );
    jest.restoreAllMocks();
  });

  test('sends the request for a roster supplier that is stored but not in the in-memory list', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(storedVendor());
    const res = mockRes();

    await vendorController.requestEvaluation({ params: { id: VENDOR_ID }, body: {}, user: BUYER }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(dispatch).toHaveBeenCalledWith(
      VENDOR_ID,
      expect.objectContaining({ buyerCompany: 'Acme Ltd', buyerEmail: BUYER.email }),
      expect.arrayContaining([BUYER_ACCOUNT.id, BUYER.email])
    );
  });

  test('finds a supplier whose buyer identifier is the buyer corporate email', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(storedVendor({ buyerId: BUYER_ACCOUNT.corporateEmail }));
    const res = mockRes();

    await vendorController.requestEvaluation({ params: { id: VENDOR_ID }, body: {}, user: BUYER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(dispatch).toHaveBeenCalledWith(VENDOR_ID, expect.any(Object), expect.arrayContaining([BUYER_ACCOUNT.corporateEmail]));
  });

  test('still finds a supplier from the sign-in identifiers when no buyer account row exists', async () => {
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(storedVendor({ buyerId: BUYER.email }));
    const res = mockRes();

    await vendorController.requestEvaluation({ params: { id: VENDOR_ID }, body: {}, user: BUYER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    // With no account row, the company name falls back to the sign-in organisation name.
    expect(dispatch).toHaveBeenCalledWith(VENDOR_ID, expect.objectContaining({ buyerCompany: 'Acme Ltd' }), expect.arrayContaining([BUYER.email]));
  });

  test('returns 404 and sends nothing for a supplier that belongs to another buyer', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(storedVendor({ buyerId: 'other-buyer-9' }));
    const res = mockRes();

    await vendorController.requestEvaluation({ params: { id: VENDOR_ID }, body: {}, user: BUYER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('does not limit an admin request to one buyer roster', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(storedVendor({ buyerId: 'other-buyer-9' }));
    const res = mockRes();
    const admin = { id: 'admin-1', email: 'admin@procucev.com', role: 'admin', name: 'Admin' };

    await vendorController.requestEvaluation({ params: { id: VENDOR_ID }, body: {}, user: admin }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(dispatch).toHaveBeenCalledWith(VENDOR_ID, expect.any(Object), 'all');
  });

  test('resolves a v-master-* supplier via buyer profile org and promotes it for evaluation request', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
    jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
      found: true,
      profile: { organizationId: 'org-profile-77' },
    });
    jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValue({
      id: 'rec-master-1',
      sessionId: 'sess-master-1',
      companyName: 'Govardhan Solutions pvt LTD',
      email: 'govardhan.kilari@procucev.com',
      contactPerson: 'Govardhan',
      phone: '9876543210',
      address: 'Bengaluru, Karnataka - 560001',
    });
    jest.spyOn(vendorIngestionQueries, 'findCategoryMappingByVendorRecord').mockResolvedValue({
      vendorRecordId: 'rec-master-1',
      buyerMajorCategory: 'Mechanical & Fluid Equipment',
      buyerMinorCategories: ['Valves', 'Pumps'],
      status: 'BUYER_APPROVED',
    });
    const promoted = storedVendor({ id: 'v-ingest-promoted-1', email: 'govardhan.kilari@procucev.com', buyerId: BUYER_ACCOUNT.id });
    const empanelSpy = jest.spyOn(storeService, 'empanelIngestedVendor').mockResolvedValue(promoted);
    const res = mockRes();

    await vendorController.requestEvaluation(
      { params: { id: 'v-master-rec-master-1' }, body: { vendorEmail: 'govardhan.kilari@procucev.com' }, user: BUYER },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(empanelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Govardhan Solutions pvt LTD',
        email: 'govardhan.kilari@procucev.com',
        majorCategory: 'Mechanical & Fluid Equipment',
        minorCategories: ['Valves', 'Pumps'],
        source: 'vendor_master_ingestion',
      }),
      BUYER.email
    );
    expect(dispatch).toHaveBeenCalledWith(
      'v-ingest-promoted-1',
      expect.objectContaining({ buyerCompany: 'Acme Ltd' }),
      expect.arrayContaining([BUYER_ACCOUNT.id, 'org-profile-77'])
    );
  });

  test('returns 400 when a v-master-* supplier has no category assigned before evaluation request', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
    jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
      found: true,
      profile: { organizationId: 'org-profile-77' },
    });
    jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValue({
      id: 'rec-no-cat',
      companyName: 'No Category Master Supplier',
      email: 'nocat@vendor.test',
    });
    const empanelSpy = jest.spyOn(storeService, 'empanelIngestedVendor');
    const res = mockRes();

    await vendorController.requestEvaluation(
      { params: { id: 'v-master-rec-no-cat' }, body: { majorCategory: 'Vendor Master' }, user: BUYER },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'VENDOR_CATEGORY_REQUIRED' }));
    expect(empanelSpy).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('returns 400 when a v-master-* supplier has no email address', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
    jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
      found: true,
      profile: { organizationId: 'org-profile-77' },
    });
    jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValue({
      id: 'rec-no-email',
      companyName: 'No Email Master Supplier',
      email: '',
    });
    const res = mockRes();

    await vendorController.requestEvaluation({ params: { id: 'v-master-rec-no-email' }, body: {}, user: BUYER }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dispatch).not.toHaveBeenCalled();
  });

  test('resolves a v-hist-local-* uploaded supplier via body email hint and protects cross-buyer records', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
    const promoted = storedVendor({ id: 'v-ingest-local-1', email: 'local-history@vendor.test' });
    const empanelSpy = jest.spyOn(storeService, 'empanelIngestedVendor').mockResolvedValue(promoted);
    const res = mockRes();

    await vendorController.requestEvaluation(
      {
        params: { id: 'v-hist-local-batch-0' },
        body: {
          vendorEmail: 'local-history@vendor.test',
          vendorName: 'Local History Supplier',
          contactPerson: 'Ravi',
          majorCategory: 'Electrical & Power Equipment',
          minorCategories: ['Switchgear'],
        },
        user: BUYER,
      },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(empanelSpy).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith('v-ingest-local-1', expect.any(Object), expect.any(Array));

    // Missing email on v-hist-local-* returns 400
    const resNoEmail = mockRes();
    await vendorController.requestEvaluation(
      { params: { id: 'v-hist-local-no-email' }, body: {}, user: BUYER },
      resNoEmail,
      jest.fn()
    );
    expect(resNoEmail.status).toHaveBeenCalledWith(400);

    // Existing vendor owned by another buyer returns 404 without claiming it
    jest.spyOn(domainQueries, 'getVendorByEmailFromDB').mockImplementation(async (lookupEmail) =>
      lookupEmail === 'other-buyer-vendor@test.com'
        ? storedVendor({ id: 'other-v-1', email: 'other-buyer-vendor@test.com', buyerId: 'other-buyer-org' })
        : null
    );
    const resForeign = mockRes();
    await vendorController.requestEvaluation(
      {
        params: { id: 'v-hist-local-foreign' },
        body: { vendorEmail: 'other-buyer-vendor@test.com', majorCategory: 'Mechanical' },
        user: BUYER,
      },
      resForeign,
      jest.fn()
    );
    expect(resForeign.status).toHaveBeenCalledWith(404);
  });

  test('supports editing and updating categories for buyer-owned and synthetic fallback vendors', async () => {
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(null);
    jest.spyOn(buyerProfileQueries, 'findProfileByUserId').mockResolvedValue({
      found: true,
      profile: { organizationId: 'org-profile-77' },
    });
    jest.spyOn(vendorIngestionQueries, 'findVendorMasterRecord').mockResolvedValue({
      id: 'rec-master-edit',
      companyName: 'Govardhan Solutions pvt LTD',
      email: 'govardhan-edit@procucev.com',
      contactPerson: 'Govardhan',
    });
    const promoted = storedVendor({
      id: 'v-ingest-edited-1',
      email: 'govardhan-edit@procucev.com',
      majorCategory: 'Mechanical',
      minorCategories: ['Valves'],
      buyerId: 'org-profile-77',
    });
    const empanelSpy = jest.spyOn(storeService, 'empanelIngestedVendor').mockResolvedValue(promoted);

    // Rejects placeholder category updates on synthetic fallback vendors
    const resBadSynth = mockRes();
    await vendorController.updateVendor(
      { params: { id: 'v-master-rec-master-edit' }, body: { majorCategory: 'Vendor Master', minorCategories: [] }, user: BUYER },
      resBadSynth,
      jest.fn()
    );
    expect(resBadSynth.status).toHaveBeenCalledWith(400);

    // Promotes synthetic vendor cleanly when valid categories are saved via PUT /api/vendors/:id
    const resPromoteEdit = mockRes();
    await vendorController.updateVendor(
      {
        params: { id: 'v-master-rec-master-edit' },
        body: { name: 'Govardhan Solutions pvt LTD', majorCategory: 'Mechanical', minorCategories: ['Valves'] },
        user: BUYER,
      },
      resPromoteEdit,
      jest.fn()
    );
    expect(resPromoteEdit.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.objectContaining({ id: 'v-ingest-edited-1' }) }));
    expect(empanelSpy).toHaveBeenCalled();

    // Buyer owning vendor via orgId passes checkVendorOwnership on PUT /api/vendors/:id/categories
    jest.spyOn(domainQueries, 'getVendorByIdFromDB').mockResolvedValue(promoted);
    const updateCatsSpy = jest.spyOn(storeService, 'updateVendorCategoriesDurably').mockResolvedValue({
      ...promoted,
      majorCategory: 'Electrical',
      minorCategories: ['Switchgear'],
      clientMappedCategories: ['Switchgear'],
    });
    const resUpdateCats = mockRes();
    await vendorController.updateCategories(
      {
        params: { id: 'v-ingest-edited-1' },
        body: { majorCategory: 'Electrical', minorCategories: ['Switchgear'] },
        user: BUYER,
      },
      resUpdateCats,
      jest.fn()
    );
    expect(resUpdateCats.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(updateCatsSpy).toHaveBeenCalledWith(
      'v-ingest-edited-1',
      expect.objectContaining({ majorCategory: 'Electrical', minorCategories: ['Switchgear'], clientMappedCategories: ['Switchgear'] })
    );
  });
});

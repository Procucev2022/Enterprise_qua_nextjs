/**
 * A buyer may request an evaluation from any supplier on that buyer's roster. The roster is built from the stored
 * vendor rows and the buyer's identifiers, so the request must resolve the same rows, not only the in-memory subset.
 */
const storeService = require('../src/services/storeService');
const domainQueries = require('../src/db/domainQueries');
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
    storeService.vendors = storeService.vendors.filter((vendor) => vendor.id !== VENDOR_ID);
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
});

const buyerProfileController = require('../src/controllers/buyerProfileController');
const buyerProfileService = require('../src/services/buyerProfileService');
const storeService = require('../src/services/storeService');
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

describe('buyerProfileController 100% Branch Coverage', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('getClientIp handles ip, x-forwarded-for, and fallback', () => {
    expect(buyerProfileController.getClientIp({ ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(buyerProfileController.getClientIp({ headers: { 'x-forwarded-for': '192.168.1.1' } })).toBe('192.168.1.1');
    expect(buyerProfileController.getClientIp({})).toBe('127.0.0.1');
  });

  test('respondWithError formats BuyerProfileError with and without details, and handles generic error', () => {
    const resWithDetails = mockRes();
    const next1 = jest.fn();
    const bpErrWithDetails = new Error('Validation failed');
    bpErrWithDetails.name = 'BuyerProfileError';
    bpErrWithDetails.status = 400;
    bpErrWithDetails.details = { field: 'bad' };

    buyerProfileController.respondWithError(bpErrWithDetails, resWithDetails, next1, 'Fallback');
    expect(resWithDetails.statusCode).toBe(400);
    expect(resWithDetails.data.fieldErrors).toEqual({ field: 'bad' });

    const resNoDetails = mockRes();
    const bpErrNoDetails = new Error('Not found');
    bpErrNoDetails.name = 'BuyerProfileError';
    bpErrNoDetails.status = 404;

    buyerProfileController.respondWithError(bpErrNoDetails, resNoDetails, next1, 'Fallback');
    expect(resNoDetails.statusCode).toBe(404);
    expect(resNoDetails.data.fieldErrors).toBeUndefined();

    const nextGeneric = jest.fn();
    const genericErr = new Error('Generic failure');
    buyerProfileController.respondWithError(genericErr, mockRes(), nextGeneric, 'Fallback');
    expect(nextGeneric).toHaveBeenCalledWith(genericErr);
  });

  test('getMyProfile and updateMyProfile success and error responses', async () => {
    const next = jest.fn();

    // getMyProfile success
    jest.spyOn(buyerProfileService, 'getProfile').mockResolvedValue({ companyName: 'Acme' });
    const resGet = mockRes();
    await buyerProfileController.getMyProfile({ user: { email: 'b@corp.com' } }, resGet, next);
    expect(resGet.statusCode).toBe(200);
    expect(resGet.data.data.companyName).toBe('Acme');

    // getMyProfile error
    buyerProfileService.getProfile.mockRejectedValue(new Error('get crash'));
    await buyerProfileController.getMyProfile({ user: { email: 'b@corp.com' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));

    // updateMyProfile success
    jest.spyOn(buyerProfileService, 'saveProfile').mockResolvedValue({
      profile: { companyName: 'Acme Updated' },
      categoryCount: 3,
      fieldsUpdated: ['companyName'],
    });
    const resUpdate = mockRes();
    await buyerProfileController.updateMyProfile(
      { user: { email: 'b@corp.com' }, body: { companyName: 'Acme Updated' }, ip: '1.2.3.4' },
      resUpdate,
      next
    );
    expect(resUpdate.statusCode).toBe(200);
    expect(resUpdate.data.data.companyName).toBe('Acme Updated');

    // updateMyProfile error
    buyerProfileService.saveProfile.mockRejectedValue(new Error('save crash'));
    await buyerProfileController.updateMyProfile({ user: { email: 'b@corp.com' }, body: {} }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('getCategoryTaxonomy, getDispatchTemplates, and updateDispatchTemplate success and error responses', async () => {
    const next = jest.fn();

    // getCategoryTaxonomy success & error
    jest.spyOn(buyerProfileService, 'getCategoryTaxonomy').mockResolvedValue(['Pumps']);
    const resTax = mockRes();
    await buyerProfileController.getCategoryTaxonomy({}, resTax, next);
    expect(resTax.statusCode).toBe(200);

    buyerProfileService.getCategoryTaxonomy.mockRejectedValue(new Error('tax crash'));
    await buyerProfileController.getCategoryTaxonomy({}, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));

    // getDispatchTemplates success & error
    jest.spyOn(buyerProfileService, 'getDispatchTemplates').mockResolvedValue({ templateA: 'text' });
    const resTpl = mockRes();
    await buyerProfileController.getDispatchTemplates({ user: { email: 'b@corp.com' } }, resTpl, next);
    expect(resTpl.statusCode).toBe(200);

    buyerProfileService.getDispatchTemplates.mockRejectedValue(new Error('tpl crash'));
    await buyerProfileController.getDispatchTemplates({ user: { email: 'b@corp.com' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));

    // updateDispatchTemplate success & error
    jest.spyOn(buyerProfileService, 'saveDispatchTemplate').mockResolvedValue({ subject: 'Subj' });
    const resUpTpl = mockRes();
    await buyerProfileController.updateDispatchTemplate(
      { user: { email: 'b@corp.com' }, params: { templateType: 'category_mapped' }, body: { subject: 'Subj' } },
      resUpTpl,
      next
    );
    expect(resUpTpl.statusCode).toBe(200);

    buyerProfileService.saveDispatchTemplate.mockRejectedValue(new Error('up tpl crash'));
    await buyerProfileController.updateDispatchTemplate(
      { user: { email: 'b@corp.com' }, params: { templateType: 'category_mapped' } },
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('getBuyerProfileDetails resolves by name, accountId, email, handles DB lookup and fallbacks', async () => {
    const next = jest.fn();

    // 1. Resolve by name in storeService.getBuyerAccounts() (hitting line 157)
    const existingAccounts = [
      {
        id: 'acc-by-name',
        organizationName: 'Alpha Org',
        corporateEmail: 'alpha@org.com',
        totalSpend: '$1500',
      },
    ];
    jest.spyOn(storeService, 'getBuyerAccounts').mockReturnValue(existingAccounts);
    jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
    jest.spyOn(buyerProfileQueries, 'findProfileByIdentifier').mockResolvedValue({
      found: true,
      profile: {
        companyName: 'Alpha Org DB',
        brandName: 'AlphaBrand',
        organizationType: 'Private Limited',
        contactName: 'Alpha Contact',
        contactDesignation: 'VP Sourcing',
        contactEmail: 'alpha@org.com',
        contactPhone: '9876543210',
        gstNumber: '27AAAAA0000A1Z5',
        panNumber: 'AAAAA0000A',
        cinNumber: 'U12345MH2020PTC123456',
        website: 'https://alpha.org',
        annualTurnover: '50Cr',
        street: '123 Main St',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        country: 'India',
        categories: ['Pumps'],
      },
    });

    const resByName = mockRes();
    await buyerProfileController.getBuyerProfileDetails(
      { query: { name: 'Alpha Org' } },
      resByName,
      next
    );
    expect(resByName.statusCode).toBe(200);
    expect(resByName.data.data.organizationName).toBe('Alpha Org DB');
    expect(resByName.data.data.totalSpend).toBe('₹1500');

    // 2. Resolve by accountId with DB lookup failure caught
    buyerProfileQueries.findProfileByIdentifier.mockRejectedValue(new Error('DB connection drop'));
    const resByAccountId = mockRes();
    await buyerProfileController.getBuyerProfileDetails(
      { query: { accountId: 'acc-by-name' } },
      resByAccountId,
      next
    );
    expect(resByAccountId.statusCode).toBe(200);
    expect(resByAccountId.data.data.organizationName).toBe('Alpha Org');

    // 3. Fallbacks when account and DB profile are null
    storeService.getBuyerAccounts.mockReturnValue([]);
    buyerProfileQueries.findProfileByIdentifier.mockResolvedValue({ found: false });
    const resEmpty = mockRes();
    await buyerProfileController.getBuyerProfileDetails(
      { query: {} },
      resEmpty,
      next
    );
    expect(resEmpty.statusCode).toBe(200);
    expect(resEmpty.data.data.organizationName).toBe('Buyer Organization');
    expect(resEmpty.data.data.totalSpend).toBe('₹0');

    // 4. Outer catch block (hitting line 204)
    storeService.getBuyerAccounts.mockImplementation(() => { throw new Error('store crash'); });
    await buyerProfileController.getBuyerProfileDetails(
      { query: { name: 'Crash' } },
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

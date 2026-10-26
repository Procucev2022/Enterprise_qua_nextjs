const bootstrapController = require('../src/controllers/bootstrapController');
const storeService = require('../src/services/storeService');

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
    const getBootSpy = jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ rfqs: [] });

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
    const getBootSpy = jest.spyOn(storeService, 'getBootstrapData').mockResolvedValue({ rfqs: [] });
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
    expect(getBootSpy).toHaveBeenCalledWith(['query-buyer-1'], 'v@corp.com');

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
    expect(getBootSpy).toHaveBeenCalledWith(null, undefined);
  });

  test('catch block forwards error to next middleware', async () => {
    jest.spyOn(storeService, 'getBootstrapData').mockRejectedValue(new Error('bootstrap failure'));
    const next = jest.fn();

    await bootstrapController.getBootstrap({}, mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

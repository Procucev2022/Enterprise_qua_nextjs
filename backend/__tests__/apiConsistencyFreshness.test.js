const request = require('supertest');
const app = require('../src/app');
const authController = require('../src/controllers/authController');
const evaluationController = require('../src/controllers/evaluationController');
const authService = require('../src/services/authService');
const identityQueries = require('../src/db/identityQueries');
const domainQueries = require('../src/db/domainQueries');
const pool = require('../src/db/pool');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('Backend anti-stale headers & fresh DB session/evaluation reads', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('API and GraphQL responses always emit strict no-store Cache-Control headers', async () => {
    const res = await request(app).get('/api/vendors/subscription-pricing');
    expect(res.headers['cache-control']).toBe('private, no-cache, no-store, must-revalidate');
    expect(res.headers.pragma).toBe('no-cache');
    expect(res.headers.expires).toBe('0');
    expect(res.headers.etag).toBeUndefined();
  });

  test('authController.getSession merges fresh DB user fields when storage is configured and handles DB error gracefully', async () => {
    jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
      valid: true,
      user: {
        sub: 'usr-99',
        email: 'old@acme.com',
        name: 'Old Name',
        role: 'buyer',
        orgId: 'org-1',
        orgName: 'Old Org',
        mobile: '+919876543210',
      },
    });
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    jest.spyOn(identityQueries, 'findUserByUuid').mockResolvedValueOnce({
      id: 'usr-99',
      email: 'fresh@acme.com',
      name: 'Fresh Name',
      role: 'buyer',
      orgId: 'org-2',
      orgName: 'Fresh Org',
      mobile: '+919999988888',
      resetPasswordRequired: false,
      vendorMasterUploaded: true,
    });

    const res1 = createMockRes();
    await authController.getSession({ headers: { authorization: 'Bearer tok-1' } }, res1, jest.fn());
    expect(res1.statusCode).toBe(200);
    expect(res1.body.user).toMatchObject({
      id: 'usr-99',
      email: 'fresh@acme.com',
      name: 'Fresh Name',
      orgId: 'org-2',
      orgName: 'Fresh Org',
      vendorMasterUploaded: true,
    });

    // When DB returns a sparse record, falls back to verified token claims for missing fields
    jest.spyOn(identityQueries, 'findUserByUuid').mockResolvedValueOnce({});
    const resSparse = createMockRes();
    await authController.getSession({ headers: { authorization: 'Bearer tok-1' } }, resSparse, jest.fn());
    expect(resSparse.statusCode).toBe(200);
    expect(resSparse.body.user).toMatchObject({
      id: 'usr-99',
      email: 'old@acme.com',
      name: 'Old Name',
      role: 'buyer',
      orgId: 'org-1',
      orgName: 'Old Org',
      mobile: '+919876543210',
      vendorMasterUploaded: false,
    });

    // When DB returns null (user not found in DB), returns verified token claims cleanly
    jest.spyOn(identityQueries, 'findUserByUuid').mockResolvedValueOnce(null);
    const resNull = createMockRes();
    await authController.getSession({ headers: { authorization: 'Bearer tok-1' } }, resNull, jest.fn());
    expect(resNull.statusCode).toBe(200);
    expect(resNull.body.user.name).toBe('Old Name');

    // When DB lookup fails, still returns verified token claims gracefully
    jest.spyOn(identityQueries, 'findUserByUuid').mockRejectedValueOnce(new Error('D1 busy'));
    const res2 = createMockRes();
    await authController.getSession({ headers: { authorization: 'Bearer tok-1' } }, res2, jest.fn());
    expect(res2.statusCode).toBe(200);
    expect(res2.body.user.name).toBe('Old Name');
  });

  test('evaluationController.getEvaluations reads fresh evaluations from DB when storage is configured', async () => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
    const dbEval = { id: 'ev-db-1', vendorId: 'v-1', overallScore: 91 };
    const spy = jest.spyOn(domainQueries, 'getEvaluationsFromDB').mockResolvedValueOnce([dbEval]);

    const res = createMockRes();
    await evaluationController.getEvaluations({ query: { limit: '25' } }, res, jest.fn());
    expect(spy).toHaveBeenCalledWith(25);
    expect(res.body.data).toEqual([dbEval]);
  });
});

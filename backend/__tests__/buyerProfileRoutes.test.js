const request = require('supertest');
const app = require('../src/app');
const { authHeader, TEST_USERS } = require('./testHelpers');
const buyerProfileService = require('../src/services/buyerProfileService');
const buyerProfileController = require('../src/controllers/buyerProfileController');
const { BUYER_PROFILE_MESSAGES } = require('../src/config/constants');

const STORED_PROFILE = {
  organizationId: 'org-buyer-01',
  userId: TEST_USERS.buyer.id,
  companyName: 'Larsen & Toubro Limited',
  brandName: 'L&T Heavy Engineering',
  organizationType: 'Public Limited',
  panNumber: 'AAACL1234F',
  gstNumber: '27AAACL1234F1Z5',
  cinNumber: 'L28920MH1946PLC004768',
  website: 'https://www.larsentoubro.com',
  annualTurnover: 'INR 1,80,000 Cr+',
  street: 'L&T House',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
  contactName: 'Rajesh Sharma',
  contactDesignation: 'Chief Procurement Officer (CPO)',
  contactEmail: TEST_USERS.buyer.email,
  contactPhone: '+919820144820',
  categories: [{ major: 'IT', minor: 'Laptop' }],
};

describe('Buyer Profile API (/api/buyer-profile)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Authentication and authorisation ──────────────────────────────────────
  // The Java endpoints took the organisation id from the request body with no
  // ownership check, so any authenticated caller could read or overwrite any
  // organisation. These are the tests that pin the replacement shut.
  describe('access control', () => {
    test('GET /me rejects an unauthenticated caller', async () => {
      const res = await request(app).get('/api/buyer-profile/me');
      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('PUT /me rejects an unauthenticated caller', async () => {
      const res = await request(app).put('/api/buyer-profile/me').send({ companyName: 'ACME' });
      expect(res.statusCode).toBe(401);
    });

    test('GET /categories rejects an unauthenticated caller', async () => {
      const res = await request(app).get('/api/buyer-profile/categories');
      expect(res.statusCode).toBe(401);
    });

    test('GET /me rejects a malformed bearer token', async () => {
      const res = await request(app)
        .get('/api/buyer-profile/me')
        .set({ Authorization: 'Bearer not.a.token' });
      expect(res.statusCode).toBe(401);
    });

    test.each(['vendor', 'category_manager', 'admin'])(
      'GET /me rejects a %s session with 403',
      async (role) => {
        const res = await request(app).get('/api/buyer-profile/me').set(authHeader(role));
        expect(res.statusCode).toBe(403);
        expect(res.body.success).toBe(false);
      }
    );

    test('PUT /me rejects a vendor session with 403', async () => {
      const spy = jest.spyOn(buyerProfileService, 'saveProfile');
      const res = await request(app)
        .put('/api/buyer-profile/me')
        .set(authHeader('vendor'))
        .send({ companyName: 'ACME' });
      expect(res.statusCode).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    test('GET /categories is readable by any signed-in role', async () => {
      jest.spyOn(buyerProfileService, 'getCategoryTaxonomy').mockResolvedValue([]);
      const res = await request(app).get('/api/buyer-profile/categories').set(authHeader('vendor'));
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Read ──────────────────────────────────────────────────────────────────
  describe('GET /api/buyer-profile/me', () => {
    test('returns the signed-in buyer profile', async () => {
      const spy = jest.spyOn(buyerProfileService, 'getProfile').mockResolvedValue(STORED_PROFILE);

      const res = await request(app).get('/api/buyer-profile/me').set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, data: STORED_PROFILE });
      // The service is handed the verified claims, so the organisation cannot be
      // chosen by the caller.
      expect(spy.mock.calls[0][0]).toMatchObject({ sub: TEST_USERS.buyer.id, role: 'buyer' });
    });

    test('surfaces the status and message of a service failure', async () => {
      jest
        .spyOn(buyerProfileService, 'getProfile')
        .mockRejectedValue(
          new buyerProfileService.BuyerProfileError(BUYER_PROFILE_MESSAGES.ORGANIZATION_NOT_LINKED, 409)
        );

      const res = await request(app).get('/api/buyer-profile/me').set(authHeader('buyer'));

      expect(res.statusCode).toBe(409);
      expect(res.body).toEqual({
        success: false,
        error: BUYER_PROFILE_MESSAGES.ORGANIZATION_NOT_LINKED,
      });
    });

    test('answers 500 through the shared error handler for an unexpected fault', async () => {
      jest.spyOn(buyerProfileService, 'getProfile').mockRejectedValue(new Error('kaboom'));
      const res = await request(app).get('/api/buyer-profile/me').set(authHeader('buyer'));
      expect(res.statusCode).toBe(500);
    });
  });

  // ── Write ─────────────────────────────────────────────────────────────────
  describe('PUT /api/buyer-profile/me', () => {
    test('saves the profile and returns the stored record', async () => {
      const spy = jest.spyOn(buyerProfileService, 'saveProfile').mockResolvedValue({
        profile: STORED_PROFILE,
        categoryCount: 1,
        fieldsUpdated: 4,
      });

      const res = await request(app)
        .put('/api/buyer-profile/me')
        .set(authHeader('buyer'))
        .send({ companyName: 'ACME Ltd', categories: [{ major: 'IT', minor: 'Laptop' }] });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe(BUYER_PROFILE_MESSAGES.PROFILE_SAVED);
      expect(res.body.data).toEqual(STORED_PROFILE);
      expect(res.body.categoryCount).toBe(1);
      expect(spy.mock.calls[0][1]).toMatchObject({ companyName: 'ACME Ltd' });
    });

    test('returns per-field messages for a validation failure', async () => {
      jest.spyOn(buyerProfileService, 'saveProfile').mockRejectedValue(
        new buyerProfileService.BuyerProfileError('PAN is invalid.', 400, { panNumber: 'PAN is invalid.' })
      );

      const res = await request(app)
        .put('/api/buyer-profile/me')
        .set(authHeader('buyer'))
        .send({ companyName: 'ACME Ltd', panNumber: 'NOPE' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('PAN is invalid.');
      expect(res.body.fieldErrors).toEqual({ panNumber: 'PAN is invalid.' });
    });

    test('tolerates a request with no body', async () => {
      const spy = jest
        .spyOn(buyerProfileService, 'saveProfile')
        .mockResolvedValue({ profile: null, categoryCount: null, fieldsUpdated: 0 });

      const res = await request(app).put('/api/buyer-profile/me').set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(spy.mock.calls[0][1]).toEqual({});
    });

    test('reports a database outage as 503, not 500', async () => {
      jest
        .spyOn(buyerProfileService, 'saveProfile')
        .mockRejectedValue(
          new buyerProfileService.BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_SAVE_FAILED, 503)
        );

      const res = await request(app)
        .put('/api/buyer-profile/me')
        .set(authHeader('buyer'))
        .send({ companyName: 'ACME Ltd' });

      expect(res.statusCode).toBe(503);
      expect(res.body.error).toBe(BUYER_PROFILE_MESSAGES.PROFILE_SAVE_FAILED);
    });

    test('answers 500 through the shared error handler for an unexpected fault', async () => {
      jest.spyOn(buyerProfileService, 'saveProfile').mockRejectedValue(new Error('kaboom'));
      const res = await request(app)
        .put('/api/buyer-profile/me')
        .set(authHeader('buyer'))
        .send({ companyName: 'ACME Ltd' });
      expect(res.statusCode).toBe(500);
    });
  });

  // ── Taxonomy ──────────────────────────────────────────────────────────────
  describe('GET /api/buyer-profile/categories', () => {
    test('returns the master taxonomy with a count', async () => {
      const taxonomy = [
        { majorCategory: 'Civil Works', minorCategories: ['Piling'] },
        { majorCategory: 'IT', minorCategories: ['Laptop', 'Servers'] },
      ];
      jest.spyOn(buyerProfileService, 'getCategoryTaxonomy').mockResolvedValue(taxonomy);

      const res = await request(app).get('/api/buyer-profile/categories').set(authHeader('buyer'));

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ success: true, count: 2, data: taxonomy });
    });

    test('reports a master read failure as 503', async () => {
      jest
        .spyOn(buyerProfileService, 'getCategoryTaxonomy')
        .mockRejectedValue(
          new buyerProfileService.BuyerProfileError(BUYER_PROFILE_MESSAGES.TAXONOMY_LOAD_FAILED, 503)
        );

      const res = await request(app).get('/api/buyer-profile/categories').set(authHeader('buyer'));
      expect(res.statusCode).toBe(503);
    });

    test('answers 500 through the shared error handler for an unexpected fault', async () => {
      jest.spyOn(buyerProfileService, 'getCategoryTaxonomy').mockRejectedValue(new Error('kaboom'));
      const res = await request(app).get('/api/buyer-profile/categories').set(authHeader('buyer'));
      expect(res.statusCode).toBe(500);
    });
  });

  // ── Controller helpers ────────────────────────────────────────────────────
  describe('controller helpers', () => {
    test('getClientIp prefers req.ip then the forwarded header', () => {
      expect(buyerProfileController.getClientIp({ ip: '1.2.3.4', headers: {} })).toBe('1.2.3.4');
      expect(
        buyerProfileController.getClientIp({ headers: { 'x-forwarded-for': '5.6.7.8' } })
      ).toBe('5.6.7.8');
      expect(buyerProfileController.getClientIp({ headers: {} })).toBe('127.0.0.1');
    });

    test('respondWithError delegates a non-profile error to next()', () => {
      const next = jest.fn();
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const err = new Error('unexpected');

      buyerProfileController.respondWithError(err, res, next, 'context');

      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
    });

    test('respondWithError handles a null error by delegating to next()', () => {
      const next = jest.fn();
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      buyerProfileController.respondWithError(null, res, next, 'context');
      expect(next).toHaveBeenCalled();
    });
  });
});

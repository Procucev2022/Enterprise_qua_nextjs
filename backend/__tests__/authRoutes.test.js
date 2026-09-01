const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const authController = require('../src/controllers/authController');
const identityPool = require('../src/db/identityPool');
const identityQueries = require('../src/db/identityQueries');
const mailerService = require('../src/services/mailerService');
const { AUTH_MESSAGES } = require('../src/config/constants');
const { authHeader } = require('./testHelpers');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

/** An active, approved buyer row as returned by identityQueries.findUserByEmail. */
function buyerRecord(overrides = {}) {
  return {
    id: '1b7083fa-78b1-4372-bf11-6eca62db9b7e',
    email: 'navinchaudhary.dev@gmail.com',
    name: 'Navin Chaudhary',
    role: 'buyer',
    rawRoleName: 'ClientInitiator',
    orgId: 'f84c8587-5c39-49f4-add2-c6ee62352008',
    orgName: 'Navin Chaudhary Enterprises',
    password: 'Pass@123',
    mobile: '+919157154504',
    status: 'ACTIVE',
    isActive: true,
    isApproved: true,
    isSelfClient: false,
    verificationStatus: 'EMAIL_VERIFIED',
    ...overrides,
  };
}

const EMAIL = 'navinchaudhary.dev@gmail.com';
const PASSWORD = 'Pass@123';

describe('Authentication against the shared identity database (/api/auth)', () => {
  let originalPool;

  beforeEach(() => {
    // The identity pool is only constructed when MYSQL_* is configured, which it
    // is not under test. A truthy stub puts the service in its "configured" path
    // while every read is driven by the identityQueries mocks below.
    originalPool = identityPool.pool;
    identityPool.pool = { query: jest.fn() };
    jest.spyOn(mailerService, 'sendOtpEmail').mockResolvedValue(undefined);
  });

  afterEach(() => {
    identityPool.pool = originalPool;
    jest.restoreAllMocks();
  });

  // ── Password hashing helpers (retained for legacy callers) ─────────────────
  describe('password helpers', () => {
    test('hashPassword generates a hash+salt pair, reusing a supplied salt', () => {
      const auto = authService.hashPassword('testpass');
      expect(auto.hash).toBeDefined();
      expect(auto.salt).toBeDefined();

      const withSalt = authService.hashPassword('testpass', 'custom-salt');
      expect(withSalt.salt).toBe('custom-salt');
      expect(authService.hashPassword('testpass', 'custom-salt').hash).toBe(withSalt.hash);
    });

    test('verifyPassword handles empty inputs safely and matches a valid pair', () => {
      const { hash, salt } = authService.hashPassword('password123');
      expect(authService.verifyPassword('', hash, salt)).toBe(false);
      expect(authService.verifyPassword('password123', '', salt)).toBe(false);
      expect(authService.verifyPassword('password123', hash, '')).toBe(false);
      expect(authService.verifyPassword(null, null, null)).toBe(false);
      expect(authService.verifyPassword('password123', hash, salt)).toBe(true);
    });
  });

  // ── Session tokens ────────────────────────────────────────────────────────
  describe('session tokens', () => {
    test('a generated token verifies and carries the account claims', () => {
      const token = authService.generateSessionToken(buyerRecord());
      const result = authService.verifySessionToken(token);

      expect(result.valid).toBe(true);
      expect(result.user.email).toBe(EMAIL);
      expect(result.user.role).toBe('buyer');
    });

    test.each([
      [null, AUTH_MESSAGES.SESSION_TOKEN_MISSING],
      ['', AUTH_MESSAGES.SESSION_TOKEN_MISSING],
      ['not-a-jwt', AUTH_MESSAGES.MALFORMED_TOKEN],
    ])('rejects malformed token %p', (token, expectedError) => {
      const result = authService.verifySessionToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toBe(expectedError);
    });

    test('rejects a token whose signature does not match', () => {
      const [header, payload] = authService.generateSessionToken(buyerRecord()).split('.');
      const result = authService.verifySessionToken(`${header}.${payload}.tampered`);

      expect(result.valid).toBe(false);
      expect(result.error).toBe(AUTH_MESSAGES.INVALID_TOKEN_SIGNATURE);
    });

    test('rejects an undecodable payload', () => {
      const token = authService.generateSessionToken(buyerRecord());
      const [header, , signature] = token.split('.');
      // Re-sign a deliberately invalid payload so the signature check passes first.
      const crypto = require('crypto');
      const badPayload = '!!!not-base64-json!!!';
      const sig = crypto
        .createHmac('sha256', 'procucev-enterprise-auth-secret-key-2026')
        .update(`${header}.${badPayload}`)
        .digest('base64url');
      const result = authService.verifySessionToken(`${header}.${badPayload}.${sig}`);

      expect(result.valid).toBe(false);
      expect(result.error).toBe(AUTH_MESSAGES.TOKEN_DECODE_FAILED);
      expect(signature).toBeDefined();
    });

    test('an expired token is reported as expired', () => {
      const crypto = require('crypto');
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: 'usr-1', email: EMAIL, role: 'buyer', exp: 1 })
      ).toString('base64url');
      const sig = crypto
        .createHmac('sha256', 'procucev-enterprise-auth-secret-key-2026')
        .update(`${header}.${payload}`)
        .digest('base64url');

      const result = authService.verifySessionToken(`${header}.${payload}.${sig}`);
      expect(result.valid).toBe(false);
      expect(result.error).toBe(AUTH_MESSAGES.SESSION_EXPIRED);
    });

    test('a revoked token stops verifying, and revoking junk is a no-op', () => {
      const token = authService.generateSessionToken(buyerRecord({ id: 'usr-revoke-1' }));
      expect(authService.verifySessionToken(token).valid).toBe(true);

      expect(authService.revokeSessionToken(token)).toBe(true);
      const after = authService.verifySessionToken(token);
      expect(after.valid).toBe(false);
      expect(after.error).toBe(AUTH_MESSAGES.SESSION_LOGGED_OUT);

      expect(authService.revokeSessionToken(null)).toBe(false);
      expect(authService.revokeSessionToken('a.b')).toBe(false);
    });

    test('revoking a token with an undecodable payload still succeeds', () => {
      const crypto = require('crypto');
      const header = 'h';
      const payload = '!!!bad!!!';
      const sig = crypto
        .createHmac('sha256', 'procucev-enterprise-auth-secret-key-2026')
        .update(`${header}.${payload}`)
        .digest('base64url');

      expect(authService.revokeSessionToken(`${header}.${payload}.${sig}`)).toBe(true);
    });
  });

  // ── Identity lookups & sign-in gates ──────────────────────────────────────
  describe('loadIdentityUser', () => {
    test('returns the row the identity database provides', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      await expect(authService.loadIdentityUser(EMAIL)).resolves.toMatchObject({ email: EMAIL });
    });

    test('fails closed when the identity database is not configured', async () => {
      identityPool.pool = null;
      await expect(authService.loadIdentityUser(EMAIL)).rejects.toThrow(
        AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED
      );
    });

    test('fails closed when the lookup query throws', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockRejectedValue(new Error('ETIMEDOUT'));
      await expect(authService.loadIdentityUser(EMAIL)).rejects.toThrow(
        AUTH_MESSAGES.IDENTITY_DB_UNAVAILABLE
      );
    });
  });

  describe('assertUserCanSignIn', () => {
    test('passes for an active, approved, mapped account', () => {
      expect(() => authService.assertUserCanSignIn(buyerRecord(), EMAIL, '::1')).not.toThrow();
    });

    test('blocks an inactive account', () => {
      expect(() =>
        authService.assertUserCanSignIn(buyerRecord({ isActive: false }), EMAIL, '::1')
      ).toThrow(AUTH_MESSAGES.ACCOUNT_INACTIVE);
    });

    test('blocks a self-registered account still awaiting approval', () => {
      expect(() =>
        authService.assertUserCanSignIn(
          buyerRecord({ isSelfClient: true, isApproved: false }),
          EMAIL,
          '::1'
        )
      ).toThrow(AUTH_MESSAGES.ACCOUNT_PENDING_APPROVAL);
    });

    test('blocks a role this workspace has no screens for', () => {
      expect(() =>
        authService.assertUserCanSignIn(buyerRecord({ role: null, rawRoleName: 'Registration' }), EMAIL, '::1')
      ).toThrow(AUTH_MESSAGES.INVALID_CREDENTIALS);
    });
  });

  // ── Password authentication ───────────────────────────────────────────────
  describe('authenticateWithPassword', () => {
    test('issues a session for correct credentials', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());

      const result = await authService.authenticateWithPassword(EMAIL, PASSWORD, '::1');

      expect(result.success).toBe(true);
      expect(result.user).toEqual({
        id: buyerRecord().id,
        email: EMAIL,
        name: 'Navin Chaudhary',
        role: 'buyer',
        orgId: buyerRecord().orgId,
        orgName: 'Navin Chaudhary Enterprises',
      });
      expect(authService.verifySessionToken(result.token).valid).toBe(true);
    });

    test('rejects a wrong password', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      await expect(
        authService.authenticateWithPassword(EMAIL, 'WrongPass@1', '::1')
      ).rejects.toThrow(AUTH_MESSAGES.INVALID_CREDENTIALS);
    });

    test('rejects an unknown email with the same generic error', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      await expect(
        authService.authenticateWithPassword('ghost@nowhere.test', 'x', '::1')
      ).rejects.toThrow(AUTH_MESSAGES.INVALID_CREDENTIALS);
    });

    test('requires both an email and a password', async () => {
      await expect(authService.authenticateWithPassword('', PASSWORD)).rejects.toThrow(
        AUTH_MESSAGES.EMAIL_PASSWORD_REQUIRED
      );
      await expect(authService.authenticateWithPassword(EMAIL, '')).rejects.toThrow(
        AUTH_MESSAGES.EMAIL_PASSWORD_REQUIRED
      );
    });

    test('normalises the email before looking it up', async () => {
      const findSpy = jest
        .spyOn(identityQueries, 'findUserByEmail')
        .mockResolvedValue(buyerRecord());

      await authService.authenticateWithPassword(`  ${EMAIL.toUpperCase()} `, PASSWORD, '::1');

      expect(findSpy).toHaveBeenCalledWith(EMAIL);
    });
  });

  // ── OTP flow ──────────────────────────────────────────────────────────────
  describe('OTP request and verification', () => {
    test('dispatches a code for a known account and verifies it', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());

      const requested = await authService.requestOtp(EMAIL, 'buyer', '::1');
      expect(requested.success).toBe(true);
      expect(requested.expiresInSeconds).toBe(600);
      expect(requested.demoCode).toMatch(/^\d{4}$/);

      const verified = await authService.verifyOtp(EMAIL, requested.demoCode, '::1');
      expect(verified.success).toBe(true);
      expect(verified.user.email).toBe(EMAIL);
    });

    test('an OTP cannot be replayed once consumed', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      const { demoCode } = await authService.requestOtp(EMAIL, 'buyer', '::1');
      await authService.verifyOtp(EMAIL, demoCode, '::1');

      await expect(authService.verifyOtp(EMAIL, demoCode, '::1')).rejects.toThrow(
        AUTH_MESSAGES.INVALID_OTP
      );
    });

    test('rejects an OTP request for an unregistered email', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      await expect(authService.requestOtp('ghost@nowhere.test', 'buyer', '::1')).rejects.toThrow(
        AUTH_MESSAGES.ACCOUNT_NOT_FOUND
      );
    });

    test('rejects an OTP request for an account that cannot sign in', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord({ isActive: false }));
      await expect(authService.requestOtp(EMAIL, 'buyer', '::1')).rejects.toThrow(
        AUTH_MESSAGES.ACCOUNT_INACTIVE
      );
    });

    test('requires an email to request a code', async () => {
      await expect(authService.requestOtp('', 'buyer')).rejects.toThrow(
        AUTH_MESSAGES.OTP_EMAIL_REQUIRED
      );
    });

    test('requires both an email and a code to verify', async () => {
      await expect(authService.verifyOtp('', '1234')).rejects.toThrow(
        AUTH_MESSAGES.OTP_CODE_REQUIRED
      );
      await expect(authService.verifyOtp(EMAIL, '')).rejects.toThrow(
        AUTH_MESSAGES.OTP_CODE_REQUIRED
      );
    });

    test('rejects an incorrect code', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      await authService.requestOtp(EMAIL, 'buyer', '::1');

      await expect(authService.verifyOtp(EMAIL, '0000', '::1')).rejects.toThrow(
        AUTH_MESSAGES.INVALID_OTP
      );
    });

    test('rejects a code when none was ever issued', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      await expect(authService.verifyOtp('never.issued@example.com', '1234', '::1')).rejects.toThrow(
        AUTH_MESSAGES.INVALID_OTP
      );
    });

    test('omits demoCode once SMTP is configured', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      jest.spyOn(mailerService, 'isConfigured').mockReturnValue(true);
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const res = await authService.requestOtp(EMAIL, 'buyer', '::1');
        expect(res.demoCode).toBeUndefined();
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    test('an email dispatch failure does not fail the request', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      jest.spyOn(mailerService, 'sendOtpEmail').mockRejectedValue(new Error('SMTP down'));

      const res = await authService.requestOtp(EMAIL, 'buyer', '::1');
      expect(res.success).toBe(true);
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  // ── Registration ──────────────────────────────────────────────────────────
  describe('registerUser', () => {
    const payload = {
      name: 'Navin Chaudhary',
      email: EMAIL,
      password: PASSWORD,
      mobile: '9157154504',
      orgName: 'Navin Chaudhary Enterprises',
    };

    test('creates the account in the identity database and returns a session', async () => {
      const insertSpy = jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
        created: true,
        user: {
          id: 'new-uuid',
          email: EMAIL,
          name: 'Navin Chaudhary',
          role: 'buyer',
          orgId: 'new-org',
          orgName: 'Navin Chaudhary Enterprises',
        },
      });

      const result = await authService.registerUser(payload, '::1');

      expect(insertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ email: EMAIL, password: PASSWORD, phone: '9157154504' })
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe(AUTH_MESSAGES.REGISTRATION_SUCCESS);
      expect(authService.verifySessionToken(result.token).valid).toBe(true);
    });

    test('reports a duplicate account rather than signing the caller in', async () => {
      jest
        .spyOn(identityQueries, 'insertBuyerAccount')
        .mockResolvedValue({ created: false, reason: 'ALREADY_EXISTS', user: buyerRecord() });

      await expect(authService.registerUser(payload, '::1')).rejects.toThrow(
        AUTH_MESSAGES.ACCOUNT_ALREADY_EXISTS
      );
    });

    test('validates the mandatory fields', async () => {
      await expect(authService.registerUser({ ...payload, email: '' })).rejects.toThrow(
        AUTH_MESSAGES.REGISTRATION_EMAIL_REQUIRED
      );
      await expect(authService.registerUser({ ...payload, password: '' })).rejects.toThrow(
        AUTH_MESSAGES.EMAIL_PASSWORD_REQUIRED
      );
      await expect(authService.registerUser({ ...payload, mobile: '' })).rejects.toThrow(
        AUTH_MESSAGES.OTP_EMAIL_REQUIRED
      );
    });

    test('fails closed when the identity database is not configured', async () => {
      identityPool.pool = null;
      await expect(authService.registerUser(payload)).rejects.toThrow(
        AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED
      );
    });
  });

  // ── Admin user listing ────────────────────────────────────────────────────
  describe('getAllUsers', () => {
    test('maps the directory rows onto the public shape', async () => {
      jest.spyOn(identityQueries, 'listUsers').mockResolvedValue([buyerRecord()]);

      const users = await authService.getAllUsers();

      expect(users).toEqual([
        {
          id: buyerRecord().id,
          email: EMAIL,
          name: 'Navin Chaudhary',
          role: 'buyer',
          orgId: buyerRecord().orgId,
          orgName: 'Navin Chaudhary Enterprises',
          mobile: '+919157154504',
          status: 'ACTIVE',
        },
      ]);
    });

    test('fails closed when the identity database is not configured', async () => {
      identityPool.pool = null;
      await expect(authService.getAllUsers()).rejects.toThrow(
        AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED
      );
    });
  });

  // ── Boot-time health report ───────────────────────────────────────────────
  describe('hydrateFromDB', () => {
    test('returns the identity health report when reachable', async () => {
      jest
        .spyOn(identityPool, 'checkIdentityHealth')
        .mockResolvedValue({ isConnected: true, userCount: 5 });

      await expect(authService.hydrateFromDB()).resolves.toMatchObject({ isConnected: true });
    });

    test('logs loudly but resolves when the identity database is unreachable', async () => {
      jest
        .spyOn(identityPool, 'checkIdentityHealth')
        .mockResolvedValue({ isConnected: false, errorMessage: 'offline' });

      await expect(authService.hydrateFromDB()).resolves.toMatchObject({ isConnected: false });
    });
  });

  // ── HTTP surface ──────────────────────────────────────────────────────────
  describe('HTTP routes', () => {
    test('POST /api/auth/login signs in with a password', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());

      const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.role).toBe('buyer');
      expect(res.body.token).toBeDefined();
    });

    test('POST /api/auth/login returns 401 for a wrong password', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());

      const res = await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'nope' });

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(AUTH_MESSAGES.INVALID_CREDENTIALS);
    });

    test('POST /api/auth/login accepts an OTP code branch', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      const { demoCode } = await authService.requestOtp(EMAIL, 'buyer', '::1');

      const res = await request(app).post('/api/auth/login').send({ email: EMAIL, code: demoCode });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/login rejects a payload with neither password nor code', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: EMAIL });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(AUTH_MESSAGES.PASSWORD_OR_CODE_REQUIRED);
    });

    test('POST /api/auth/login validates the payload', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/auth/request-otp dispatches a code', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());

      const res = await request(app).post('/api/auth/request-otp').send({ email: EMAIL, roleHint: 'buyer' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/request-otp returns 400 for an unknown account', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);

      const res = await request(app).post('/api/auth/request-otp').send({ email: 'ghost@nowhere.test' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(AUTH_MESSAGES.ACCOUNT_NOT_FOUND);
    });

    test('POST /api/auth/request-otp validates the payload', async () => {
      const res = await request(app).post('/api/auth/request-otp').send({});
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/auth/verify-otp verifies and rejects codes', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(buyerRecord());
      const { demoCode } = await authService.requestOtp(EMAIL, 'buyer', '::1');

      const bad = await request(app).post('/api/auth/verify-otp').send({ email: EMAIL, code: '0000' });
      expect(bad.statusCode).toBe(400);

      const good = await request(app).post('/api/auth/verify-otp').send({ email: EMAIL, code: demoCode });
      expect(good.statusCode).toBe(200);
      expect(good.body.success).toBe(true);
    });

    test('POST /api/auth/verify-otp validates the payload', async () => {
      const res = await request(app).post('/api/auth/verify-otp').send({ email: EMAIL });
      expect(res.statusCode).toBe(400);
    });

    test('POST /api/auth/register creates an account', async () => {
      jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
        created: true,
        user: {
          id: 'new-uuid',
          email: 'brand.new@example.com',
          name: 'Brand New',
          role: 'buyer',
          orgId: 'new-org',
          orgName: 'Brand New Ltd',
        },
      });

      const res = await request(app).post('/api/auth/register').send({
        name: 'Brand New',
        email: 'brand.new@example.com',
        password: 'Secret@123',
        mobile: '9876543210',
        role: 'buyer',
        orgName: 'Brand New Ltd',
      });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/register reports a duplicate with 400', async () => {
      jest
        .spyOn(identityQueries, 'insertBuyerAccount')
        .mockResolvedValue({ created: false, user: buyerRecord() });

      const res = await request(app).post('/api/auth/register').send({
        name: 'Navin Chaudhary',
        email: EMAIL,
        password: PASSWORD,
        mobile: '9157154504',
        role: 'buyer',
        orgName: 'Navin Chaudhary Enterprises',
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe(AUTH_MESSAGES.ACCOUNT_ALREADY_EXISTS);
    });

    test('POST /api/auth/register validates the payload', async () => {
      const res = await request(app).post('/api/auth/register').send({});
      expect(res.statusCode).toBe(400);
    });

    test('GET /api/auth/session round-trips a bearer token', async () => {
      const noToken = await request(app).get('/api/auth/session');
      expect(noToken.statusCode).toBe(401);
      expect(noToken.body.error).toBe(AUTH_MESSAGES.NO_SESSION_TOKEN);

      const bad = await request(app).get('/api/auth/session').set('Authorization', 'Bearer nonsense');
      expect(bad.statusCode).toBe(401);

      const ok = await request(app).get('/api/auth/session').set(authHeader('buyer'));
      expect(ok.statusCode).toBe(200);
      expect(ok.body.user.role).toBe('buyer');
    });

    test('POST /api/auth/logout succeeds with and without a token', async () => {
      const withToken = await request(app)
        .post('/api/auth/logout')
        .set(authHeader('vendor'))
        .send({ email: 'vendor@apexsupplies.com' });
      expect(withToken.statusCode).toBe(200);
      expect(withToken.body.message).toBe(AUTH_MESSAGES.LOGOUT_SUCCESS);

      const withoutToken = await request(app).post('/api/auth/logout').send({});
      expect(withoutToken.statusCode).toBe(200);
    });

    test('GET /api/auth/users is admin-only and lists the directory', async () => {
      jest.spyOn(identityQueries, 'listUsers').mockResolvedValue([buyerRecord()]);

      const unauth = await request(app).get('/api/auth/users');
      expect(unauth.statusCode).toBe(401);

      const nonAdmin = await request(app).get('/api/auth/users').set(authHeader('buyer'));
      expect(nonAdmin.statusCode).toBe(403);

      const admin = await request(app).get('/api/auth/users').set(authHeader('admin'));
      expect(admin.statusCode).toBe(200);
      expect(admin.body.count).toBe(1);
    });
  });

  // ── Controller error branches ─────────────────────────────────────────────
  describe('controller error branches', () => {
    test('getClientIp falls back through req.ip, x-forwarded-for, then a default', () => {
      expect(authController.getClientIp({ ip: '10.0.0.1' })).toBe('10.0.0.1');
      expect(authController.getClientIp({ headers: { 'x-forwarded-for': '8.8.8.8' } })).toBe('8.8.8.8');
      expect(authController.getClientIp({})).toBe('127.0.0.1');
    });

    test('getSession forwards unexpected failures to next()', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'verifySessionToken').mockImplementation(() => {
        throw new Error('boom');
      });

      await authController.getSession(
        { headers: { authorization: 'Bearer x.y.z' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('logout forwards unexpected failures to next()', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'revokeSessionToken').mockImplementation(() => {
        throw new Error('boom');
      });

      await authController.logout(
        { body: { email: EMAIL }, headers: { authorization: 'Bearer x.y.z' } },
        res,
        next
      );
      expect(next).toHaveBeenCalled();
    });

    test('listUsers forwards identity database failures to next()', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'getAllUsers').mockRejectedValue(new Error('db down'));

      await authController.listUsers({}, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('login surfaces an unavailable identity database as 401', async () => {
      jest
        .spyOn(identityQueries, 'findUserByEmail')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: EMAIL, password: PASSWORD });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe(AUTH_MESSAGES.IDENTITY_DB_UNAVAILABLE);
    });
  });

  // ── Fallback branches when a body or an error message is absent ────────────
  describe('controller fallback branches', () => {
    const VALID = { email: EMAIL, password: PASSWORD };

    test('every handler tolerates a request with no body at all', async () => {
      for (const handler of ['login', 'requestOtp', 'verifyOtp', 'register']) {
        const res = mockRes();
        await authController[handler]({}, res, jest.fn());
        expect(res.status).toHaveBeenCalledWith(400);
      }
    });

    test('login falls back to a generic error when the failure carries no message', async () => {
      jest.spyOn(authService, 'authenticateWithPassword').mockRejectedValue(new Error(''));
      const res = mockRes();

      await authController.login({ body: VALID }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.AUTH_FAILED_FALLBACK,
      });
    });

    test('requestOtp falls back to a generic error when the failure carries no message', async () => {
      jest.spyOn(authService, 'requestOtp').mockRejectedValue(new Error(''));
      const res = mockRes();

      await authController.requestOtp({ body: { email: EMAIL } }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.OTP_REQUEST_EMAIL_REQUIRED,
      });
    });

    test('verifyOtp falls back to a generic error when the failure carries no message', async () => {
      jest.spyOn(authService, 'verifyOtp').mockRejectedValue(new Error(''));
      const res = mockRes();

      await authController.verifyOtp({ body: { email: EMAIL, code: '1234' } }, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.INVALID_OTP_FALLBACK,
      });
    });

    test('register falls back to a generic error when the failure carries no message', async () => {
      jest.spyOn(authService, 'registerUser').mockRejectedValue(new Error(''));
      const res = mockRes();

      await authController.register(
        {
          body: {
            name: 'Someone',
            email: 'someone@example.com',
            password: 'Secret@123',
            mobile: '9876543210',
          },
        },
        res,
        jest.fn()
      );

      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.AUTH_FAILED_FALLBACK,
      });
    });

    test('login reaches the OTP branch through the code field', async () => {
      jest.spyOn(authService, 'verifyOtp').mockResolvedValue({ success: true, token: 't', user: {} });
      const res = mockRes();

      await authController.login({ body: { email: EMAIL, code: '1234' } }, res, jest.fn());

      expect(authService.verifyOtp).toHaveBeenCalledWith(EMAIL, '1234', '127.0.0.1');
    });

    test('getSession falls back to a generic message when verification gives no reason', async () => {
      jest.spyOn(authService, 'verifySessionToken').mockReturnValue({ valid: false });
      const res = mockRes();

      await authController.getSession({ headers: { authorization: 'Bearer a.b.c' } }, res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: AUTH_MESSAGES.INVALID_SESSION_FALLBACK,
      });
    });

    test('logout falls back to a placeholder identity when no email is supplied', async () => {
      const res = mockRes();
      await authController.logout({ body: {}, headers: {} }, res, jest.fn());
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: AUTH_MESSAGES.LOGOUT_SUCCESS,
      });
    });

    test('logout tolerates a request with no body', async () => {
      const res = mockRes();
      await authController.logout({ headers: {} }, res, jest.fn());
      expect(res.json).toHaveBeenCalled();
    });
  });
});

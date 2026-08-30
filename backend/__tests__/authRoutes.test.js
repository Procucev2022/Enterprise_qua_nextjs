const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const authController = require('../src/controllers/authController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Authentication Routes & Services (/api/auth) - Complete 100% Coverage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authService unit tests & branch coverage', () => {
    test('hashPassword with custom and default salt', () => {
      const hash1 = authService.hashPassword('testpass');
      const hash2 = authService.hashPassword('testpass', 'custom-salt');
      expect(hash1).toBeDefined();
      expect(hash2).toBeDefined();
      expect(hash1).not.toBe(hash2);
    });

    test('verifyPassword handles empty inputs safely', () => {
      expect(authService.verifyPassword('', 'somehash')).toBe(false);
      expect(authService.verifyPassword('somepass', '')).toBe(false);
      expect(authService.verifyPassword(null, null)).toBe(false);
      expect(authService.verifyPassword('password123', authService.hashPassword('password123'))).toBe(true);
    });

    test('verifySessionToken handles all invalid & expired scenarios', () => {
      // Missing token
      expect(authService.verifySessionToken(null).valid).toBe(false);
      expect(authService.verifySessionToken('').valid).toBe(false);
      expect(authService.verifySessionToken(12345).valid).toBe(false);

      // Malformed parts
      expect(authService.verifySessionToken('part1.part2').valid).toBe(false);

      // Invalid signature
      const validToken = authService.generateSessionToken({
        id: 'usr-1',
        email: 'test@procucev.com',
        name: 'Test User',
        role: 'buyer',
        orgId: 'org-1',
        orgName: 'Org',
      });
      const tamperedToken = validToken.slice(0, -5) + 'xxxxx';
      expect(authService.verifySessionToken(tamperedToken).valid).toBe(false);

      // Valid token verification
      const validResult = authService.verifySessionToken(validToken);
      expect(validResult.valid).toBe(true);
      expect(validResult.user.email).toBe('test@procucev.com');

      // Expired token
      const expiredPayload = Buffer.from(
        JSON.stringify({
          sub: 'usr-1',
          email: 'expired@procucev.com',
          exp: Math.floor(Date.now() / 1000) - 100, // in past
        })
      ).toString('base64url');
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const crypto = require('crypto');
      const sig = crypto
        .createHmac('sha256', process.env.AUTH_SECRET || 'procucev-enterprise-auth-secret-key-2026')
        .update(`${header}.${expiredPayload}`)
        .digest('base64url');
      const expiredToken = `${header}.${expiredPayload}.${sig}`;

      const expiredResult = authService.verifySessionToken(expiredToken);
      expect(expiredResult.valid).toBe(false);
      expect(expiredResult.error).toContain('Session token has expired');

      // Malformed JSON payload
      const badJsonPayload = Buffer.from('invalid-json-payload{').toString('base64url');
      const badSig = crypto
        .createHmac('sha256', process.env.AUTH_SECRET || 'procucev-enterprise-auth-secret-key-2026')
        .update(`${header}.${badJsonPayload}`)
        .digest('base64url');
      const badJsonToken = `${header}.${badJsonPayload}.${badSig}`;
      const badJsonResult = authService.verifySessionToken(badJsonToken);
      expect(badJsonResult.valid).toBe(false);
      expect(badJsonResult.error).toContain('Failed to decode');
    });

    test('authenticateWithPassword auto-provisions different role patterns', () => {
      // Vendor pattern
      const resVendor = authService.authenticateWithPassword('new.vendor@distributor.com', 'pass123', '10.0.0.1');
      expect(resVendor.user.role).toBe('vendor');

      // Admin pattern
      const resAdmin = authService.authenticateWithPassword('super.admin@governance.com', 'pass123', '10.0.0.1');
      expect(resAdmin.user.role).toBe('admin');

      // Manager pattern
      const resManager = authService.authenticateWithPassword('sourcing.manager@plants.com', 'pass123', '10.0.0.1');
      expect(resManager.user.role).toBe('category_manager');

      // Generic email without @
      const resNoAt = authService.authenticateWithPassword('plainuser', 'pass123', '10.0.0.1');
      expect(resNoAt.user.role).toBe('buyer');

      // Missing credentials throw error
      expect(() => authService.authenticateWithPassword('', '')).toThrow();
      expect(() => authService.authenticateWithPassword('buyer@procucev.com', 'wrongpassword')).toThrow('Invalid email or password');
    });

    test('requestOtp creates user with roleHint and without roleHint', () => {
      expect(() => authService.requestOtp('')).toThrow();

      const resHint = authService.requestOtp('custom.buyer@tata.com', 'category_manager', '127.0.0.1');
      expect(resHint.success).toBe(true);

      const resVendor = authService.requestOtp('new.vendor.fast@valves.com', undefined, '127.0.0.1');
      expect(resVendor.success).toBe(true);
    });

    test('verifyOtp branches: code validation, attempt counting, user creation', () => {
      expect(() => authService.verifyOtp('', '')).toThrow();

      // Request OTP for user
      authService.requestOtp('attempt.user@procure.com', 'buyer', '127.0.0.1');

      // Wrong code increments attempts
      expect(() => authService.verifyOtp('attempt.user@procure.com', '0000', '127.0.0.1')).toThrow('Invalid or expired OTP code');

      // Universal code for non-existing user
      const univRes = authService.verifyOtp('brand.new.user@external.com', '1234', '127.0.0.1');
      expect(univRes.success).toBe(true);
      expect(univRes.user.email).toBe('brand.new.user@external.com');
    });

    test('registerUser branches: duplicate email, default fields', () => {
      expect(() => authService.registerUser({}, '127.0.0.1')).toThrow();

      // First registration with minimal fields
      const res1 = authService.registerUser({ email: 'minimal@enterprise.com' }, '127.0.0.1');
      expect(res1.success).toBe(true);
      expect(res1.user.name).toBe('minimal');
      expect(res1.user.role).toBe('buyer');

      // Duplicate registration returns existing account
      const res2 = authService.registerUser({ email: 'minimal@enterprise.com' }, '127.0.0.1');
      expect(res2.success).toBe(true);
      expect(res2.message).toContain('already exists');
    });
  });

  describe('authController helper and direct branch tests', () => {
    test('getClientIp handles ip, x-forwarded-for header, and fallback', () => {
      expect(authController.getClientIp({ ip: '192.168.1.1' })).toBe('192.168.1.1');
      expect(authController.getClientIp({ headers: { 'x-forwarded-for': '10.0.0.5' } })).toBe('10.0.0.5');
      expect(authController.getClientIp({})).toBe('127.0.0.1');
    });
  });

  describe('HTTP REST Routes & Controller Coverage', () => {
    test('POST /api/auth/login with code (OTP mode)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'buyer@procucev.com', code: '1234' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/login with password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'buyer@procucev.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/login fallback when neither password nor code is sent', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'buyer@procucev.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/login handles missing email (400)', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Email is required');
    });

    test('POST /api/auth/login handles invalid password (401)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'buyer@procucev.com', password: 'badpassword' });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/auth/request-otp with valid email (200)', async () => {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: 'http.buyer@procucev.com', roleHint: 'buyer' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.demoCode).toBeDefined();
    });

    test('POST /api/auth/request-otp missing email (400)', async () => {
      const res = await request(app).post('/api/auth/request-otp').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Email is required');
    });

    test('POST /api/auth/verify-otp with valid code (200)', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: 'http.buyer@procucev.com', code: '1234' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
    });

    test('POST /api/auth/verify-otp missing email or code (400)', async () => {
      const res1 = await request(app).post('/api/auth/verify-otp').send({ email: 'a@b.com' });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toContain('Email and verification code are required');

      const res2 = await request(app).post('/api/auth/verify-otp').send({ code: '1234' });
      expect(res2.status).toBe(400);
      expect(res2.body.error).toContain('Email and verification code are required');
    });

    test('POST /api/auth/verify-otp invalid code returns 400', async () => {
      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: 'buyer@procucev.com', code: '0000' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('POST /api/auth/register with valid payload (201)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'HTTP Enterprise Entity',
          email: 'http.register@enterprise.com',
          password: 'Password123!',
          role: 'buyer',
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('http.register@enterprise.com');
    });

    test('POST /api/auth/register missing email (400)', async () => {
      const res = await request(app).post('/api/auth/register').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Email is required');
    });

    test('GET /api/auth/session supports cookie header token', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'buyer@procucev.com', password: 'password123' });

      const token = loginRes.body.token;

      // Send token in cookie
      const sessionRes = await request(app)
        .get('/api/auth/session')
        .set('Cookie', [`auth_token=${token}`]);

      expect(sessionRes.status).toBe(200);
      expect(sessionRes.body.success).toBe(true);
      expect(sessionRes.body.user.email).toBe('buyer@procucev.com');
    });

    test('GET /api/auth/session supports req.cookies.auth_token directly', () => {
      const token = authService.generateSessionToken({
        id: 'usr-1',
        email: 'cookie.user@procucev.com',
        name: 'Cookie User',
        role: 'buyer',
        orgId: 'org-1',
        orgName: 'Org',
      });
      const res = mockRes();
      const next = jest.fn();

      authController.getSession({ headers: {}, cookies: { auth_token: token } }, res, next);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          user: expect.objectContaining({ email: 'cookie.user@procucev.com' }),
        })
      );
    });

    test('GET /api/auth/session missing token returns 401', async () => {
      const res = await request(app).get('/api/auth/session');
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('No active session token');
    });

    test('GET /api/auth/session rejects invalid token (401)', async () => {
      const sessionRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', 'Bearer invalid.token.structure');

      expect(sessionRes.status).toBe(401);
      expect(sessionRes.body.success).toBe(false);
    });

    test('POST /api/auth/logout with and without email body', async () => {
      const res1 = await request(app).post('/api/auth/logout').send({ email: 'user@procucev.com' });
      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);

      const res2 = await request(app).post('/api/auth/logout').send({});
      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
    });

    test('GET /api/auth/users lists all users', async () => {
      const res = await request(app).get('/api/auth/users');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('Controller Catch Blocks & Error Handling', () => {
    test('requestOtp catch block triggers next(err)', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'requestOtp').mockImplementationOnce(() => {
        throw new Error('Forced OTP failure');
      });

      authController.requestOtp({ body: { email: 'test@domain.com' }, headers: {} }, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('register catch block triggers next(err)', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'registerUser').mockImplementationOnce(() => {
        throw new Error('Forced register failure');
      });

      authController.register({ body: { email: 'test@domain.com' }, headers: {} }, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('getSession catch block triggers next(err)', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'verifySessionToken').mockImplementationOnce(() => {
        throw new Error('Forced session verification failure');
      });

      authController.getSession({ headers: { authorization: 'Bearer test.token.here' } }, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('logout catch block triggers next(err)', async () => {
      const next = jest.fn();
      const res = mockRes();
      const { logger } = require('../src/services/loggerService');
      jest.spyOn(logger, 'audit').mockImplementationOnce(() => {
        throw new Error('Forced audit failure');
      });

      authController.logout({ body: {}, headers: {} }, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('listUsers catch block triggers next(err)', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'getAllUsers').mockImplementationOnce(() => {
        throw new Error('Forced list failure');
      });

      authController.listUsers({}, res, next);
      expect(next).toHaveBeenCalled();
    });

    test('login and verifyOtp error messages without message fallback', () => {
      const res1 = mockRes();
      jest.spyOn(authService, 'authenticateWithPassword').mockImplementationOnce(() => {
        const e = new Error();
        e.message = '';
        throw e;
      });
      authController.login({ body: { email: 'test@domain.com', password: 'p' } }, res1, jest.fn());
      expect(res1.status).toHaveBeenCalledWith(401);

      const res2 = mockRes();
      jest.spyOn(authService, 'verifyOtp').mockImplementationOnce(() => {
        const e = new Error();
        e.message = '';
        throw e;
      });
      authController.verifyOtp({ body: { email: 'test@domain.com', code: '1111' } }, res2, jest.fn());
      expect(res2.status).toHaveBeenCalledWith(400);
    });

    test('getSession header variations and invalid session without error string', () => {
      // Non-bearer authorization header
      const resNonBearer = mockRes();
      authController.getSession({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }, resNonBearer, jest.fn());
      expect(resNonBearer.status).toHaveBeenCalledWith(401);

      // Cookie header without auth_token match
      const resNoCookieMatch = mockRes();
      authController.getSession({ headers: { cookie: 'other_session=abc12345' } }, resNoCookieMatch, jest.fn());
      expect(resNoCookieMatch.status).toHaveBeenCalledWith(401);

      // Token invalid with empty error string fallback
      const resEmptyErr = mockRes();
      jest.spyOn(authService, 'verifySessionToken').mockReturnValueOnce({ valid: false, error: '' });
      authController.getSession({ headers: { authorization: 'Bearer token.with.empty.err' } }, resEmptyErr, jest.fn());
      expect(resEmptyErr.status).toHaveBeenCalledWith(401);

      // All null/empty body objects in controllers
      const resEmpty = mockRes();
      authController.login({}, resEmpty, jest.fn());
      authController.requestOtp({}, resEmpty, jest.fn());
      authController.verifyOtp({}, resEmpty, jest.fn());
      authController.register({}, resEmpty, jest.fn());
      authController.logout({}, resEmpty, jest.fn());
      expect(resEmpty.status).toHaveBeenCalledWith(400);
    });
  });
});

const request = require('supertest');
const app = require('../src/app');
const authService = require('../src/services/authService');
const authController = require('../src/controllers/authController');
const { logger } = require('../src/services/loggerService');

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
    test('hashPassword generates a hash+salt pair, reusing a given salt when provided', () => {
      const auto = authService.hashPassword('testpass');
      expect(auto.hash).toBeDefined();
      expect(auto.salt).toBeDefined();

      const withSalt = authService.hashPassword('testpass', 'custom-salt');
      expect(withSalt.salt).toBe('custom-salt');
      expect(withSalt.hash).not.toBe(auto.hash);

      const sameSaltAgain = authService.hashPassword('testpass', 'custom-salt');
      expect(sameSaltAgain.hash).toBe(withSalt.hash);
    });

    test('verifyPassword checks a password against a hash+salt pair and handles empty inputs safely', () => {
      const { hash, salt } = authService.hashPassword('password123');
      expect(authService.verifyPassword('', hash, salt)).toBe(false);
      expect(authService.verifyPassword('password123', '', salt)).toBe(false);
      expect(authService.verifyPassword('password123', hash, '')).toBe(false);
      expect(authService.verifyPassword(null, null, null)).toBe(false);
      expect(authService.verifyPassword('password123', hash, salt)).toBe(true);
      expect(authService.verifyPassword('wrongpassword', hash, salt)).toBe(false);
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

    test('authenticateWithPassword rejects unknown emails and wrong passwords without creating accounts', () => {
      // Missing credentials throw error
      expect(() => authService.authenticateWithPassword('', '')).toThrow();

      const beforeCount = authService.getAllUsers().length;

      // Unknown email is rejected with the same generic error as a wrong password (no enumeration, no auto-create)
      expect(() => authService.authenticateWithPassword('nobody.here@nowhere.com', 'whatever123')).toThrow('Invalid email or password.');
      expect(authService.getAllUsers().length).toBe(beforeCount);

      // Wrong password for a real seed account also throws the same generic error
      expect(() => authService.authenticateWithPassword('buyer@procucev.com', 'wrongpassword')).toThrow('Invalid email or password.');

      // Correct password for a real seed account succeeds
      const res = authService.authenticateWithPassword('buyer@procucev.com', 'password123', '10.0.0.1');
      expect(res.success).toBe(true);
      expect(res.user.role).toBe('buyer');
      expect(res.token).toBeDefined();
    });

    test('requestOtp rejects unregistered emails and succeeds for a registered one', () => {
      expect(() => authService.requestOtp('')).toThrow();

      // Unregistered email is rejected, not auto-created
      expect(() => authService.requestOtp('never.registered@nowhere.com', 'buyer', '127.0.0.1')).toThrow('No account found');

      // Register first, then requesting an OTP succeeds
      authService.registerUser({ email: 'otp.candidate@enterprise.com' }, '127.0.0.1');
      const res = authService.requestOtp('otp.candidate@enterprise.com', undefined, '127.0.0.1');
      expect(res.success).toBe(true);
      expect(res.demoCode).toMatch(/^\d{4}$/);
    });

    test('verifyOtp branches: missing input, unregistered email, wrong code, master codes removed, real code succeeds', () => {
      expect(() => authService.verifyOtp('', '')).toThrow();

      // Unregistered email + any code is rejected (no OTP entry, no user)
      expect(() => authService.verifyOtp('never.registered@nowhere.com', '1234')).toThrow('Invalid or expired OTP code.');

      // Register + request a real OTP for a fresh account
      authService.registerUser({ email: 'attempt.user@procure.com' }, '127.0.0.1');
      const { demoCode } = authService.requestOtp('attempt.user@procure.com', 'buyer', '127.0.0.1');

      // Wrong code increments attempts and throws
      expect(() => authService.verifyOtp('attempt.user@procure.com', '0000', '127.0.0.1')).toThrow('Invalid or expired OTP code');

      // The old master bypass codes no longer work, even for a real registered account
      expect(() => authService.verifyOtp('attempt.user@procure.com', '1234')).toThrow('Invalid or expired OTP code.');
      expect(() => authService.verifyOtp('attempt.user@procure.com', '4321')).toThrow('Invalid or expired OTP code.');

      // The actual issued code succeeds
      const res = authService.verifyOtp('attempt.user@procure.com', demoCode, '127.0.0.1');
      expect(res.success).toBe(true);
      expect(res.user.email).toBe('attempt.user@procure.com');

      // The code is single-use — verifying again fails
      expect(() => authService.verifyOtp('attempt.user@procure.com', demoCode)).toThrow('Invalid or expired OTP code.');
    });

    test('revokeSessionToken invalidates a token immediately and handles malformed input', () => {
      expect(authService.revokeSessionToken(null)).toBe(false);
      expect(authService.revokeSessionToken('not-a-token')).toBe(false);

      const token = authService.generateSessionToken({
        id: 'usr-revoke-1', email: 'revoke.me@procucev.com', name: 'Revoke Me', role: 'buyer', orgId: 'org-1', orgName: 'Org',
      });

      expect(authService.verifySessionToken(token).valid).toBe(true);
      expect(authService.revokeSessionToken(token)).toBe(true);
      const afterRevoke = authService.verifySessionToken(token);
      expect(afterRevoke.valid).toBe(false);
      expect(afterRevoke.error).toContain('logged out');

      // A token with an undecodable payload still revokes, falling back to a default expiry
      const badPayloadToken = `${Buffer.from('header').toString('base64url')}.${Buffer.from('not-json{').toString('base64url')}.sig`;
      expect(authService.revokeSessionToken(badPayloadToken)).toBe(true);
    });

    test('hydrateFromDB syncs users and revoked sessions from Postgres, seeds an empty DB, and degrades gracefully on query failure', async () => {
      const poolModule = require('../src/db/pool');
      const originalPool = poolModule.pool;
      const originalQuery = poolModule.query;

      // No pool configured: returns immediately without querying
      poolModule.pool = null;
      poolModule.query = jest.fn();
      await authService.hydrateFromDB();
      expect(poolModule.query).not.toHaveBeenCalled();

      // Pool configured, DB already has a user + a revoked session: adopts both
      poolModule.pool = {};
      poolModule.query = jest.fn((sql) => {
        if (sql.includes('FROM users')) {
          return Promise.resolve({
            rows: [{
              id: 'usr-db-1', email: 'db.hydrated@procucev.com', name: 'DB Hydrated', role: 'buyer',
              orgId: 'org-db', orgName: 'DB Org', passwordHash: 'h', passwordSalt: 's', mobile: null, status: 'ACTIVE',
            }],
          });
        }
        return Promise.resolve({ rows: [{ tokenSignature: 'revoked-sig-from-db' }] });
      });
      await authService.hydrateFromDB();
      expect(authService.getAllUsers().some((u) => u.email === 'db.hydrated@procucev.com')).toBe(true);

      // DB has no users yet: seeds it from the current in-memory registry instead
      poolModule.query = jest.fn().mockResolvedValue({ rows: [] });
      await authService.hydrateFromDB();
      expect(poolModule.query.mock.calls.length).toBeGreaterThan(1);

      // A query failure is caught and swallowed, not thrown
      poolModule.query = jest.fn().mockRejectedValue(new Error('connection refused'));
      await expect(authService.hydrateFromDB()).resolves.toBeUndefined();

      poolModule.pool = originalPool;
      poolModule.query = originalQuery;
    });

    test('DB write-through failures in requestOtp and revokeSessionToken are logged, not thrown', async () => {
      const poolModule = require('../src/db/pool');
      const originalPool = poolModule.pool;
      const originalQuery = poolModule.query;

      authService.registerUser({ email: 'db.failure.otp@procucev.com' }, '127.0.0.1');

      poolModule.pool = {};
      poolModule.query = jest.fn().mockRejectedValue(new Error('write failed'));

      expect(() => authService.requestOtp('db.failure.otp@procucev.com', 'buyer', '127.0.0.1')).not.toThrow();

      const token = authService.generateSessionToken({
        id: 'usr-db-fail', email: 'db.fail.revoke@procucev.com', name: 'x', role: 'buyer', orgId: 'o', orgName: 'O',
      });
      expect(() => authService.revokeSessionToken(token)).not.toThrow();

      // let the fire-and-forget rejections settle before restoring
      await new Promise((resolve) => setImmediate(resolve));

      poolModule.pool = originalPool;
      poolModule.query = originalQuery;
    });

    test('DB write-through failures in registerUser, verifyOtp, and hydrateFromDB seeding are logged, not thrown', async () => {
      const poolModule = require('../src/db/pool');
      const originalPool = poolModule.pool;
      const originalQuery = poolModule.query;

      // registerUser: the save fails, but the caller still gets a successful result
      poolModule.pool = {};
      poolModule.query = jest.fn().mockRejectedValue(new Error('insert failed'));
      const regRes = authService.registerUser({ email: 'db.reg.failure@procucev.com' }, '127.0.0.1');
      expect(regRes.success).toBe(true);

      // verifyOtp: the delete-OTP write fails, but verification still succeeds
      poolModule.query = jest.fn().mockResolvedValue({ rows: [] });
      authService.registerUser({ email: 'db.verify.failure@procucev.com' }, '127.0.0.1');
      const { demoCode } = authService.requestOtp('db.verify.failure@procucev.com', 'buyer', '127.0.0.1');
      poolModule.query = jest.fn().mockRejectedValue(new Error('delete failed'));
      const verifyRes = authService.verifyOtp('db.verify.failure@procucev.com', demoCode, '127.0.0.1');
      expect(verifyRes.success).toBe(true);

      // hydrateFromDB seeding an empty DB: one user's upsert rejects, the rest still resolve
      poolModule.query = jest.fn((sql) => {
        if (sql.includes('FROM users')) return Promise.resolve({ rows: [] });
        if (sql.includes('FROM revoked_sessions')) return Promise.resolve({ rows: [] });
        return Promise.reject(new Error('seed write failed'));
      });
      await expect(authService.hydrateFromDB()).resolves.toBeUndefined();

      // let the fire-and-forget rejections settle before restoring
      await new Promise((resolve) => setImmediate(resolve));

      poolModule.pool = originalPool;
      poolModule.query = originalQuery;
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
      authService.registerUser({ email: 'http.otp.login@procucev.com' }, '127.0.0.1');
      const { demoCode } = authService.requestOtp('http.otp.login@procucev.com', 'buyer', '127.0.0.1');

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'http.otp.login@procucev.com', code: demoCode });

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

    test('POST /api/auth/login rejects when neither password nor code is sent (400)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'buyer@procucev.com' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Password or OTP code is required');
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

    test('POST /api/auth/request-otp with a registered email (200)', async () => {
      await request(app).post('/api/auth/register').send({ email: 'http.buyer@procucev.com', role: 'buyer' });

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

    test('POST /api/auth/request-otp for an unregistered email is rejected (400)', async () => {
      const res = await request(app)
        .post('/api/auth/request-otp')
        .send({ email: 'never.seen.before@nowhere.com' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('No account found');
    });

    test('POST /api/auth/verify-otp with the actual issued code (200)', async () => {
      const otpRes = await request(app).post('/api/auth/request-otp').send({ email: 'http.buyer@procucev.com' });

      const res = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: 'http.buyer@procucev.com', code: otpRes.body.demoCode });
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

    test('POST /api/auth/logout revokes a real session token', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'buyer@procucev.com', password: 'password123' });
      const token = loginRes.body.token;

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'buyer@procucev.com' });
      expect(logoutRes.status).toBe(200);

      const sessionRes = await request(app)
        .get('/api/auth/session')
        .set('Authorization', `Bearer ${token}`);
      expect(sessionRes.status).toBe(401);
      expect(sessionRes.body.error).toContain('logged out');
    });

    test('GET /api/auth/users lists all users', async () => {
      const res = await request(app).get('/api/auth/users');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('Controller Catch Blocks & Error Handling', () => {
    test('requestOtp catch block returns 400 with the error message', async () => {
      const next = jest.fn();
      const res = mockRes();
      jest.spyOn(authService, 'requestOtp').mockImplementationOnce(() => {
        throw new Error('Forced OTP failure');
      });

      authController.requestOtp({ body: { email: 'test@domain.com' }, headers: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Forced OTP failure' }));
      expect(next).not.toHaveBeenCalled();
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

    // Placed last: jest.resetModules() clears Jest's require cache, so anything
    // that plain-requires a shared module (logger, poolModule, ...) afterwards
    // would get a fresh instance instead of the one already-loaded services hold.
    test('module load: AUTH_SECRET/JWT_SECRET fail-fast in production, warn in dev, silent when configured', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalAuthSecret = process.env.AUTH_SECRET;
      const originalJwtSecret = process.env.JWT_SECRET;

      const restoreEnv = () => {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = originalAuthSecret;
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalJwtSecret;
        jest.resetModules();
      };

      try {
        // Production + no secret configured: throws at require-time
        jest.resetModules();
        process.env.NODE_ENV = 'production';
        delete process.env.AUTH_SECRET;
        delete process.env.JWT_SECRET;
        expect(() => {
          jest.isolateModules(() => {
            require('../src/services/authService');
          });
        }).toThrow('AUTH_SECRET');

        // Development + no secret configured: doesn't throw (falls back with a logged warning)
        jest.resetModules();
        process.env.NODE_ENV = 'development';
        expect(() => {
          jest.isolateModules(() => {
            require('../src/services/authService');
          });
        }).not.toThrow();

        // A configured secret: doesn't throw, regardless of environment
        jest.resetModules();
        process.env.NODE_ENV = 'production';
        process.env.AUTH_SECRET = 'a-real-configured-secret';
        expect(() => {
          jest.isolateModules(() => {
            require('../src/services/authService');
          });
        }).not.toThrow();
      } finally {
        restoreEnv();
      }
    });
  });
});

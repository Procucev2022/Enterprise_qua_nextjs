const {
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireVendorDirectorySession,
  extractToken,
} = require('../src/middleware/auth');
const vendorDirectorySessionQueries = require('../src/db/vendorDirectorySessionQueries');
const authService = require('../src/services/authService');
const { AUTH_MESSAGES } = require('../src/config/constants');
const { logger } = require('../src/services/loggerService');
const { getTestToken } = require('./testHelpers');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('auth middleware', () => {
  describe('extractToken', () => {
    test('reads a Bearer token, a cookie header, or req.cookies.auth_token, in that order', () => {
      expect(extractToken({ headers: { authorization: 'Bearer abc.def.ghi' } })).toBe('abc.def.ghi');
      expect(extractToken({ headers: { cookie: 'auth_token=xyz123; other=1' } })).toBe('xyz123');
      expect(extractToken({ headers: {}, cookies: { auth_token: 'cookie-token' } })).toBe('cookie-token');
      expect(extractToken({ headers: {} })).toBeNull();
      expect(extractToken({ headers: { authorization: 'Basic xyz' } })).toBeNull();
    });
  });

  describe('authenticate', () => {
    test('rejects a request with no token', async () => {
      const res = mockRes();
      const next = jest.fn();
      await authenticate({ headers: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects a request with an invalid token', async () => {
      const res = mockRes();
      const next = jest.fn();
      await authenticate({ headers: { authorization: 'Bearer not-a-real-token' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('returns a retryable service error when session revocation storage is unavailable', async () => {
      const sessionCheck = jest.spyOn(authService, 'assertSessionActive').mockResolvedValue({
        valid: false,
        error: AUTH_MESSAGES.SESSION_CHECK_UNAVAILABLE,
      });
      const res = mockRes();
      const next = jest.fn();

      await authenticate({ headers: { authorization: 'Bearer a.b.c' } }, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        retryable: true,
        error: AUTH_MESSAGES.SESSION_CHECK_UNAVAILABLE,
      }));
      expect(next).not.toHaveBeenCalled();
      sessionCheck.mockRestore();
    });

    test('attaches req.user and calls next() for a valid token', async () => {
      const token = getTestToken('vendor');
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe('vendor');
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuthenticate', () => {
    test('passes without user if no token provided', async () => {
      const req = { headers: {} };
      const res = mockRes();
      const next = jest.fn();
      await optionalAuthenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    test('attaches user when valid token provided', async () => {
      const token = getTestToken('buyer');
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      const next = jest.fn();
      await optionalAuthenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe('buyer');
    });

    test('ignores invalid token and continues without user', async () => {
      const req = { headers: { authorization: 'Bearer bad.token.here' } };
      const res = mockRes();
      const next = jest.fn();
      await optionalAuthenticate(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });

    test('logs revocation lookup errors while continuing anonymously', async () => {
      const failure = new Error('revocation database unavailable');
      const checkSession = jest.spyOn(authService, 'assertSessionActive').mockRejectedValue(failure);
      const logWarning = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const req = { id: 'request-otp-1', headers: { authorization: 'Bearer a.b.c' } };
      const res = mockRes();
      const next = jest.fn();

      await optionalAuthenticate(req, res, next);

      expect(logWarning).toHaveBeenCalledWith(expect.stringContaining('could not validate'), expect.objectContaining({
        error: failure,
        requestId: 'request-otp-1',
      }), 'AUTH_MIDDLEWARE');
      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalled();
      checkSession.mockRestore();
      logWarning.mockRestore();
    });
  });

  describe('requireRole', () => {
    test('rejects when authenticate has not run (no req.user)', () => {
      const res = mockRes();
      const next = jest.fn();
      requireRole('admin')({}, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects a role that is not in the allowed list', () => {
      const res = mockRes();
      const next = jest.fn();
      requireRole('admin')({ user: { role: 'buyer' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('calls next() when the role is in the allowed list', () => {
      const res = mockRes();
      const next = jest.fn();
      requireRole('admin', 'category_manager')({ user: { role: 'category_manager' } }, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('requireVendorDirectorySession', () => {
    const validSession = {
      id: 'session-cm-1',
      userUuid: 'user-cm-1',
      email: 'lead@procucev.com',
      role: 'category_manager',
      status: 'ACTIVE',
      loginAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('rejects when req.user is missing (401)', async () => {
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession({}, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when token scope is not vendor_directory (403)', async () => {
      const req = { user: { id: 'u1', role: 'category_manager', scope: 'main_app' } };
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when sessionId is missing from token (401)', async () => {
      const req = { user: { id: 'u1', role: 'category_manager', scope: 'vendor_directory' } };
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects when directory session not found or closed (401)', async () => {
      jest.spyOn(vendorDirectorySessionQueries, 'findSessionById').mockResolvedValue(null);
      const req = { user: { id: 'u1', role: 'category_manager', scope: 'vendor_directory', sessionId: 's1' } };
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ sessionExpired: true })
      );
    });

    test('handles findSessionById throw gracefully (401)', async () => {
      jest.spyOn(vendorDirectorySessionQueries, 'findSessionById').mockRejectedValue(new Error('DB err'));
      const req = { user: { id: 'u1', role: 'category_manager', scope: 'vendor_directory', sessionId: 's1' } };
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('returns a retryable service error when configured session storage is unavailable', async () => {
      const storageError = Object.assign(new Error('D1 unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' });
      jest.spyOn(vendorDirectorySessionQueries, 'findSessionById').mockRejectedValue(storageError);
      const req = { user: { id: 'u1', role: 'category_manager', scope: 'vendor_directory', sessionId: 's1' } };
      const res = mockRes();
      const next = jest.fn();

      await requireVendorDirectorySession(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));
      expect(next).not.toHaveBeenCalled();
    });


    test('rejects when user UUID does not match session user (403)', async () => {
      jest.spyOn(vendorDirectorySessionQueries, 'findSessionById').mockResolvedValue(validSession);
      const req = {
        user: { id: 'different-user-id', role: 'category_manager', scope: 'vendor_directory', sessionId: 'session-cm-1' },
      };
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects and closes session on inactivity timeout > 300s (401)', async () => {
      const expiredSession = {
        ...validSession,
        lastActivityAt: new Date(Date.now() - 350000).toISOString(),
      };
      jest.spyOn(vendorDirectorySessionQueries, 'findSessionById').mockResolvedValue(expiredSession);
      const closeSpy = jest.spyOn(vendorDirectorySessionQueries, 'closeSession').mockResolvedValue({});
      const revokeSpy = jest.spyOn(authService, 'revokeSessionToken').mockResolvedValue(true);

      const req = {
        headers: { authorization: 'Bearer dummy.token.here' },
        user: { id: 'user-cm-1', role: 'category_manager', scope: 'vendor_directory', sessionId: 'session-cm-1' },
      };
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ sessionExpired: true, inactivityTimeout: true })
      );
      expect(closeSpy).toHaveBeenCalledWith('session-cm-1', { logoutReason: 'INACTIVITY' });
      expect(revokeSpy).toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    test('handles closeSession throw during inactivity timeout gracefully', async () => {
      const expiredSession = {
        ...validSession,
        lastActivityAt: new Date(Date.now() - 350000).toISOString(),
      };
      jest.spyOn(vendorDirectorySessionQueries, 'findSessionById').mockResolvedValue(expiredSession);
      jest.spyOn(vendorDirectorySessionQueries, 'closeSession').mockRejectedValue(new Error('fail'));

      const req = {
        user: { id: 'user-cm-1', role: 'category_manager', scope: 'vendor_directory', sessionId: 'session-cm-1' },
      };
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('allows active session, updates activity, attaches directorySession and calls next()', async () => {
      jest.spyOn(vendorDirectorySessionQueries, 'findSessionById').mockResolvedValue(validSession);
      const updateSpy = jest.spyOn(vendorDirectorySessionQueries, 'updateSessionActivity').mockResolvedValue({});

      const req = {
        user: { id: 'user-cm-1', role: 'category_manager', scope: 'vendor_directory', sessionId: 'session-cm-1' },
      };
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession(req, res, next);

      expect(updateSpy).toHaveBeenCalledWith('session-cm-1');
      expect(req.directorySession).toEqual(validSession);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('handles updateSessionActivity throw gracefully and still proceeds', async () => {
      jest.spyOn(vendorDirectorySessionQueries, 'findSessionById').mockResolvedValue(validSession);
      jest.spyOn(vendorDirectorySessionQueries, 'updateSessionActivity').mockRejectedValue(new Error('update fail'));

      const req = {
        user: { id: 'user-cm-1', role: 'category_manager', scope: 'vendor_directory', sessionId: 'session-cm-1' },
      };
      const res = mockRes();
      const next = jest.fn();
      await requireVendorDirectorySession(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.directorySession).toEqual(validSession);
    });

    test('returns a retryable service error when activity persistence fails', async () => {
      jest.spyOn(vendorDirectorySessionQueries, 'findSessionById').mockResolvedValue(validSession);
      jest.spyOn(vendorDirectorySessionQueries, 'updateSessionActivity').mockRejectedValue(
        Object.assign(new Error('D1 unavailable'), { code: 'PERSISTENCE_UNAVAILABLE' })
      );
      const req = {
        user: { id: 'user-cm-1', role: 'category_manager', scope: 'vendor_directory', sessionId: 'session-cm-1' },
      };
      const res = mockRes();
      const next = jest.fn();

      await requireVendorDirectorySession(req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ retryable: true }));
      expect(next).not.toHaveBeenCalled();
    });
  });
});

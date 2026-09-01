const { authenticate, requireRole, extractToken } = require('../src/middleware/auth');
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
    test('rejects a request with no token', () => {
      const res = mockRes();
      const next = jest.fn();
      authenticate({ headers: {} }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('rejects a request with an invalid token', () => {
      const res = mockRes();
      const next = jest.fn();
      authenticate({ headers: { authorization: 'Bearer not-a-real-token' } }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    test('attaches req.user and calls next() for a valid token', () => {
      const token = getTestToken('vendor');
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = mockRes();
      const next = jest.fn();

      authenticate(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user.role).toBe('vendor');
      expect(res.status).not.toHaveBeenCalled();
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
});

const authService = require('../services/authService');
const { AUTH_MESSAGES } = require('../config/constants');

function extractToken(req) {
  // GraphQL resolvers call this with `context && context.req`, and a resolver
  // invoked without a context passes undefined. Reporting "no token" is the
  // correct answer there; dereferencing it crashed the worker instead.
  if (!req) return null;
  const authHeader = req.headers && req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  if (req.headers && req.headers.cookie) {
    const match = req.headers.cookie.match(/auth_token=([^;]+)/);
    if (match) return match[1];
  }
  if (req.cookies && req.cookies.auth_token) {
    return req.cookies.auth_token;
  }
  return null;
}

/**
 * Requires a valid, non-revoked session token. Attaches the decoded claims
 * (sub, email, role, orgId, orgName) to req.user for downstream handlers.
 */
function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
  }

  const verification = authService.verifySessionToken(token);
  if (!verification.valid) {
    return res.status(401).json({ success: false, error: verification.error || AUTH_MESSAGES.INVALID_SESSION_FALLBACK });
  }

  req.user = verification.user;
  next();
}

/**
 * Must run after authenticate(). Rejects any req.user whose role isn't in
 * the allowed list.
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

module.exports = {
  extractToken,
  authenticate,
  requireRole,
};

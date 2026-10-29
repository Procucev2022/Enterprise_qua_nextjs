const authService = require('../services/authService');
const {
  AUTH_MESSAGES,
  VENDOR_DIRECTORY_SESSION_STATUS,
  VENDOR_DIRECTORY_LOGOUT_REASONS,
  VENDOR_DIRECTORY_AUTH_CONFIG,
} = require('../config/constants');
const { logger } = require('../services/loggerService');
const vendorDirectorySessionQueries = require('../db/vendorDirectorySessionQueries');

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
 *
 * Async because revocation is now read from PostgreSQL rather than a per-process
 * Set — a token revoked on one worker has to be rejected on all of them, and a
 * process restart must not resurrect logged-out sessions.
 */
async function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
  }

  const verification = await authService.assertSessionActive(token);
  if (!verification.valid) {
    return res.status(401).json({ success: false, error: verification.error || AUTH_MESSAGES.INVALID_SESSION_FALLBACK });
  }

  req.user = verification.user;

  const reqPath = (req.originalUrl || req.url || '').split('?')[0];
  const isAllowedAuthEndpoint =
    reqPath.endsWith('/api/auth/change-password') ||
    reqPath.endsWith('/change-password') ||
    reqPath.endsWith('/api/auth/complete-buyer-onboarding') ||
    reqPath.endsWith('/complete-buyer-onboarding') ||
    reqPath.endsWith('/api/auth/request-otp') ||
    reqPath.endsWith('/request-otp') ||
    reqPath.endsWith('/api/auth/verify-otp') ||
    reqPath.endsWith('/verify-otp') ||
    reqPath.endsWith('/api/auth/session') ||
    reqPath.endsWith('/session') ||
    reqPath.endsWith('/api/auth/logout') ||
    reqPath.endsWith('/logout');

  if (
    verification.user.role === 'vendor' &&
    verification.user.passwordChangeRequired === true &&
    !isAllowedAuthEndpoint
  ) {
    return res.status(403).json({
      success: false,
      passwordChangeRequired: true,
      error: 'Change your temporary password before continuing.',
    });
  }

  if (
    verification.user.role === 'buyer' &&
    (verification.user.onboardingRequired === true || verification.user.passwordChangeRequired === true) &&
    !isAllowedAuthEndpoint
  ) {
    return res.status(403).json({
      success: false,
      onboardingRequired: true,
      passwordChangeRequired: verification.user.passwordChangeRequired === true,
      error: 'Complete your profile verification and password change before continuing.',
    });
  }
  return next();
}

/**
 * Optional authentication: resolves and attaches req.user if a valid token is
 * supplied, but does not block requests that lack a token.
 */
async function optionalAuthenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return next();
  }
  try {
    const verification = await authService.assertSessionActive(token);
    if (verification.valid) {
      req.user = verification.user;
    }
  } catch {
    // Non-blocking fallback for optional endpoints
  }
  return next();
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

/**
 * Vendor Directory session middleware.
 * Must run after authenticate() and requireRole('category_manager').
 * Verifies:
 *  - req.user.scope is 'vendor_directory'
 *  - req.user.sessionId exists
 *  - vendor directory session in DB is status === 'ACTIVE'
 *  - token user matches session user
 *  - 5-minute inactivity limit (300s) has not been exceeded
 */
async function requireVendorDirectorySession(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
  }

  if (req.user.scope !== 'vendor_directory') {
    return res.status(403).json({
      success: false,
      error: 'Access to Vendor Directory requires a dedicated Vendor Directory session.',
    });
  }

  if (!req.user.sessionId) {
    return res.status(401).json({
      success: false,
      error: 'Missing vendor directory session identifier.',
    });
  }

  let session = null;
  try {
    session = await vendorDirectorySessionQueries.findSessionById(req.user.sessionId);
  } catch (err) {
    logger.warn('Failed to load vendor directory session', { error: err.message, sessionId: req.user.sessionId }, 'AUTH_MIDDLEWARE');
    session = null;
  }

  if (!session || session.status !== VENDOR_DIRECTORY_SESSION_STATUS.ACTIVE) {
    return res.status(401).json({
      success: false,
      sessionExpired: true,
      error: 'Vendor directory session has expired or is closed. Please log in again.',
    });
  }

  const userId = req.user.id || req.user.sub;
  if (session.userUuid && userId && session.userUuid !== userId) {
    return res.status(403).json({
      success: false,
      error: 'Vendor directory session does not match the authenticated user identity.',
    });
  }

  const lastActiveMs = new Date(session.lastActivityAt || session.loginAt).getTime();
  const elapsedSeconds = Math.floor((Date.now() - lastActiveMs) / 1000);
  if (elapsedSeconds > VENDOR_DIRECTORY_AUTH_CONFIG.INACTIVITY_TIMEOUT_SECONDS) {
    try {
      await vendorDirectorySessionQueries.closeSession(session.id, {
        logoutReason: VENDOR_DIRECTORY_LOGOUT_REASONS.INACTIVITY,
      });
      const token = extractToken(req);
      if (token) {
        await authService.revokeSessionToken(token);
      }
    } catch (closeErr) {
      logger.warn('Failed to close inactive directory session', { error: closeErr.message }, 'AUTH_MIDDLEWARE');
    }

    return res.status(401).json({
      success: false,
      sessionExpired: true,
      inactivityTimeout: true,
      error: 'Your vendor directory session has expired due to 5 minutes of inactivity. Please log in again.',
    });
  }

  try {
    await vendorDirectorySessionQueries.updateSessionActivity(session.id);
  } catch (actErr) {
    logger.warn('Failed to update directory session activity', { error: actErr.message }, 'AUTH_MIDDLEWARE');
  }

  req.directorySession = session;
  return next();
}

module.exports = {
  extractToken,
  authenticate,
  optionalAuthenticate,
  requireRole,
  requireVendorDirectorySession,
};

const authService = require('../services/authService');
const { logger } = require('../services/loggerService');
const { VALIDATION_SCHEMAS, validatePayload, AUTH_MESSAGES } = require('../config/constants');

function getClientIp(req) {
  return req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1';
}

function extractToken(req) {
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

function login(req, res, next) {
  try {
    const { email, password, code } = req.body || {};
    const ipAddress = getClientIp(req);

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.login, { email, password, code });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }

    if (code) {
      const result = authService.verifyOtp(email, code, ipAddress);
      return res.json(result);
    }

    if (password) {
      const result = authService.authenticateWithPassword(email, password, ipAddress);
      return res.json(result);
    }

    return res.status(400).json({ success: false, error: AUTH_MESSAGES.PASSWORD_OR_CODE_REQUIRED });
  } catch (err) {
    logger.warn('Login failure in authController', { error: err.message, body: req.body }, 'AUTH_CONTROLLER');
    return res.status(401).json({ success: false, error: err.message || AUTH_MESSAGES.AUTH_FAILED_FALLBACK });
  }
}

function requestOtp(req, res, next) {
  try {
    const { email, roleHint } = req.body || {};
    const ipAddress = getClientIp(req);

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.requestOtp, { email, roleHint });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }

    const result = authService.requestOtp(email, roleHint, ipAddress);
    res.json(result);
  } catch (err) {
    logger.warn('OTP request failed in authController', { error: err.message, email: req.body?.email }, 'AUTH_CONTROLLER');
    return res.status(400).json({ success: false, error: err.message || AUTH_MESSAGES.OTP_REQUEST_EMAIL_REQUIRED });
  }
}

function verifyOtp(req, res, next) {
  try {
    const { email, code } = req.body || {};
    const ipAddress = getClientIp(req);

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.verifyOtp, { email, code });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }

    const result = authService.verifyOtp(email, code, ipAddress);
    res.json(result);
  } catch (err) {
    logger.warn('OTP verification failed in authController', { error: err.message, email: req.body?.email }, 'AUTH_CONTROLLER');
    return res.status(400).json({ success: false, error: err.message || AUTH_MESSAGES.INVALID_OTP_FALLBACK });
  }
}

function register(req, res, next) {
  try {
    const { name, email, password, mobile, role, orgName } = req.body || {};
    const ipAddress = getClientIp(req);

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.register, { name, email, password, mobile, role, orgName });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }

    const result = authService.registerUser({ name, email, password, mobile, role, orgName }, ipAddress);
    res.status(201).json(result);
  } catch (err) {
    logger.error('Registration failed in authController', err, 'AUTH_CONTROLLER');
    next(err);
  }
}

function getSession(req, res, next) {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({ success: false, error: AUTH_MESSAGES.NO_SESSION_TOKEN });
    }

    const verification = authService.verifySessionToken(token);
    if (!verification.valid) {
      return res.status(401).json({ success: false, error: verification.error || AUTH_MESSAGES.INVALID_SESSION_FALLBACK });
    }

    res.json({
      success: true,
      user: verification.user,
    });
  } catch (err) {
    logger.error('Error fetching session', err, 'AUTH_CONTROLLER');
    next(err);
  }
}

function logout(req, res, next) {
  try {
    const userEmail = (req.body && req.body.email) || 'authenticated-user';
    const ipAddress = getClientIp(req);
    const token = extractToken(req);
    if (token) {
      authService.revokeSessionToken(token);
    }
    logger.audit(`User logged out: ${userEmail}`, userEmail, { ipAddress });
    res.json({ success: true, message: AUTH_MESSAGES.LOGOUT_SUCCESS });
  } catch (err) {
    logger.error('Error logging out', err, 'AUTH_CONTROLLER');
    next(err);
  }
}

function listUsers(req, res, next) {
  try {
    const users = authService.getAllUsers();
    res.json({ success: true, count: users.length, data: users });
  } catch (err) {
    logger.error('Error listing users', err, 'AUTH_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getClientIp,
  extractToken,
  login,
  requestOtp,
  verifyOtp,
  register,
  getSession,
  logout,
  listUsers,
};

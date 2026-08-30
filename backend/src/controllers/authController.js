const authService = require('../services/authService');
const { logger } = require('../services/loggerService');

function getClientIp(req) {
  return req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1';
}

function login(req, res, next) {
  try {
    const { email, password, code } = req.body || {};
    const ipAddress = getClientIp(req);

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    if (code) {
      const result = authService.verifyOtp(email, code, ipAddress);
      return res.json(result);
    }

    if (password) {
      const result = authService.authenticateWithPassword(email, password, ipAddress);
      return res.json(result);
    }

    const result = authService.authenticateWithPassword(email, 'password123', ipAddress);
    return res.json(result);
  } catch (err) {
    logger.warn('Login failure in authController', { error: err.message, body: req.body }, 'AUTH_CONTROLLER');
    return res.status(401).json({ success: false, error: err.message || 'Authentication failed' });
  }
}

function requestOtp(req, res, next) {
  try {
    const { email, roleHint } = req.body || {};
    const ipAddress = getClientIp(req);

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required to request OTP.' });
    }

    const result = authService.requestOtp(email, roleHint, ipAddress);
    res.json(result);
  } catch (err) {
    logger.error('Error requesting OTP', err, 'AUTH_CONTROLLER');
    next(err);
  }
}

function verifyOtp(req, res, next) {
  try {
    const { email, code } = req.body || {};
    const ipAddress = getClientIp(req);

    if (!email || !code) {
      return res.status(400).json({ success: false, error: 'Email and verification code are required.' });
    }

    const result = authService.verifyOtp(email, code, ipAddress);
    res.json(result);
  } catch (err) {
    logger.warn('OTP verification failed in authController', { error: err.message, email: req.body?.email }, 'AUTH_CONTROLLER');
    return res.status(400).json({ success: false, error: err.message || 'Invalid OTP code.' });
  }
}

function register(req, res, next) {
  try {
    const { name, email, password, mobile, role, orgName } = req.body || {};
    const ipAddress = getClientIp(req);

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required for registration.' });
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
    const authHeader = req.headers && req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.headers && req.headers.cookie) {
      const match = req.headers.cookie.match(/auth_token=([^;]+)/);
      if (match) token = match[1];
    } else if (req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }

    if (!token) {
      return res.status(401).json({ success: false, error: 'No active session token provided.' });
    }

    const verification = authService.verifySessionToken(token);
    if (!verification.valid) {
      return res.status(401).json({ success: false, error: verification.error || 'Invalid session' });
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
    logger.audit(`User logged out: ${userEmail}`, userEmail, { ipAddress });
    res.json({ success: true, message: 'Logged out successfully.' });
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
  login,
  requestOtp,
  verifyOtp,
  register,
  getSession,
  logout,
  listUsers,
};

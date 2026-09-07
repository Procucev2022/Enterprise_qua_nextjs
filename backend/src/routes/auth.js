const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate, requireRole } = require('../middleware/auth');

// Authentication routes
router.post('/login', authController.login);
router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register', authController.register);
router.get('/session', authController.getSession);
router.post('/logout', authController.logout);
// Account holder changing their own password. The account is taken from the
// session, so this can only ever act on the caller's own credential.
router.post('/change-password', authenticate, authController.changePassword);
// Enumerates every account (id/email/name/role/org/mobile) — Admin-only
router.get('/users', authenticate, requireRole('admin'), authController.listUsers);

module.exports = router;

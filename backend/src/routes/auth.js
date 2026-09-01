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
// Enumerates every account (id/email/name/role/org/mobile) — Admin-only
router.get('/users', authenticate, requireRole('admin'), authController.listUsers);

module.exports = router;

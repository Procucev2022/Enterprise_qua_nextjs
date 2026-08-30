const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Authentication routes
router.post('/login', authController.login);
router.post('/request-otp', authController.requestOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register', authController.register);
router.get('/session', authController.getSession);
router.post('/logout', authController.logout);
router.get('/users', authController.listUsers);

module.exports = router;

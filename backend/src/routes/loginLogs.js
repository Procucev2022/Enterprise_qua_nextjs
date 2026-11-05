const express = require('express');
const router = express.Router();
const loginLogsController = require('../controllers/loginLogsController');
const { authenticate, requireRole, optionalAuthenticate } = require('../middleware/auth');

// GET /api/login-logs/summary - Real-time metrics summary (Staff only)
router.get(
  '/summary',
  authenticate,
  requireRole('admin', 'category_manager'),
  loginLogsController.getSummary
);

// GET /api/login-logs - List session logs with filters (Staff only)
router.get(
  '/',
  authenticate,
  requireRole('admin', 'category_manager'),
  loginLogsController.listLogs
);

// POST /api/login-logs/event - Record new session event (Authorized staff or internal)
router.post('/event', optionalAuthenticate, loginLogsController.recordEvent);

module.exports = router;

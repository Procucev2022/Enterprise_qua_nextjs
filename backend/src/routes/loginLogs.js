const express = require('express');
const router = express.Router();
const loginLogsController = require('../controllers/loginLogsController');
const { optionalAuthenticate, authenticate, requireRole } = require('../middleware/auth');

// GET /api/login-logs/summary - Real-time metrics summary
router.get('/summary', optionalAuthenticate, loginLogsController.getSummary);

// GET /api/login-logs - List session logs with filters
router.get('/', optionalAuthenticate, loginLogsController.listLogs);

// POST /api/login-logs/event - Record new session event (Authorized staff or internal)
router.post('/event', optionalAuthenticate, loginLogsController.recordEvent);

module.exports = router;

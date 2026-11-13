const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { authenticate, requireRole } = require('../middleware/auth');

// The system-wide audit trail contains activity across all accounts. Only admins
// may read or verify it. Browsers do not write audit events over HTTP. The browser
// logs its own actions through the frontend logger, and the server records the
// events it handles itself.
router.get('/', authenticate, requireRole('admin'), auditController.getAuditLogs);
router.get('/verify', authenticate, requireRole('admin'), auditController.verifyIntegrity);

module.exports = router;

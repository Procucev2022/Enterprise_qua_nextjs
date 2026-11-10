const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { authenticate, requireRole } = require('../middleware/auth');

// The system-wide audit trail contains activity across all accounts. Only admins
// may read or verify it; any signed-in role may append its own attributed event.
router.get('/', authenticate, requireRole('admin'), auditController.getAuditLogs);
router.post('/', authenticate, auditController.createAuditLog);
router.get('/verify', authenticate, requireRole('admin'), auditController.verifyIntegrity);

module.exports = router;

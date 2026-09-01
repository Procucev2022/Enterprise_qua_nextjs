const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { authenticate } = require('../middleware/auth');

// Every role gets read access to the audit trail (per the documented RBAC matrix);
// admin-only export/purge would go here if those actions existed.
router.get('/', authenticate, auditController.getAuditLogs);
router.post('/', authenticate, auditController.createAuditLog);
router.get('/verify', authenticate, auditController.verifyIntegrity);

module.exports = router;

const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');

router.get('/', auditController.getAuditLogs);
router.post('/', auditController.createAuditLog);
router.get('/verify', auditController.verifyIntegrity);

module.exports = router;

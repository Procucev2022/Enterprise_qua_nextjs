const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');
const { authenticate, requireRole } = require('../middleware/auth');

// "Configure AI Models & Infrastructure" is Admin-only per the documented RBAC matrix
router.get('/', authenticate, requireRole('admin'), configController.getSystemConfig);
router.post('/', authenticate, requireRole('admin'), configController.updateSystemConfig);

module.exports = router;

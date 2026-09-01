const express = require('express');
const router = express.Router();
const dbController = require('../controllers/dbController');
const { authenticate, requireRole } = require('../middleware/auth');

// Identity-database reachability and domain-store mode.
router.get('/status', dbController.getDBStatus);

// Query cache / audit efficiency report (admin only).
router.get('/metrics', authenticate, requireRole('admin'), dbController.getDBMetrics);

module.exports = router;

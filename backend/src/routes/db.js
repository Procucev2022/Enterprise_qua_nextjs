const express = require('express');
const router = express.Router();
const dbController = require('../controllers/dbController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/status', dbController.getDBStatus);
router.post('/init', authenticate, requireRole('admin'), dbController.initDBSchema);
router.post('/sync', authenticate, requireRole('admin'), dbController.syncDBData);

module.exports = router;

const express = require('express');
const router = express.Router();
const dbController = require('../controllers/dbController');

router.get('/status', dbController.getDBStatus);
router.post('/init', dbController.initDBSchema);
router.post('/sync', dbController.syncDBData);

module.exports = router;

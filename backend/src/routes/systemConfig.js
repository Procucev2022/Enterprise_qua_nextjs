const express = require('express');
const router = express.Router();
const configController = require('../controllers/configController');

router.get('/', configController.getSystemConfig);
router.post('/', configController.updateSystemConfig);

module.exports = router;

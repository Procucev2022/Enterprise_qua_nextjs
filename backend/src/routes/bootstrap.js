const express = require('express');
const router = express.Router();
const bootstrapController = require('../controllers/bootstrapController');

router.get('/', bootstrapController.getBootstrap);

module.exports = router;

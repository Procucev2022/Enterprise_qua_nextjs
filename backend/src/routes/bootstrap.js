const express = require('express');
const router = express.Router();
const bootstrapController = require('../controllers/bootstrapController');
const { optionalAuthenticate } = require('../middleware/auth');

router.get('/', optionalAuthenticate, bootstrapController.getBootstrap);

module.exports = router;

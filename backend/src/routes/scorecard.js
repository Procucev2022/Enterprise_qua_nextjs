const express = require('express');
const router = express.Router();
const scorecardController = require('../controllers/scorecardController');
const { optionalAuthenticate } = require('../middleware/auth');

// Fetch scorecard performance analytics
router.get('/', optionalAuthenticate, scorecardController.getScorecard);

module.exports = router;


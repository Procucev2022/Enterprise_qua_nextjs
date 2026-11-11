const express = require('express');
const router = express.Router();
const scorecardController = require('../controllers/scorecardController');
const { authenticate, requireRole } = require('../middleware/auth');

// Scorecards expose cross-team performance and executive metrics.
router.get('/', authenticate, requireRole('admin', 'category_manager'), scorecardController.getScorecard);

module.exports = router;


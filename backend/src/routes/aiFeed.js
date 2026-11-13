const express = require('express');
const router = express.Router();
const aiFeedController = require('../controllers/aiFeedController');
const { authenticate, requireRole } = require('../middleware/auth');

// Feed entries are written by the server. Browsers do not write them over HTTP.
router.get('/', authenticate, requireRole('admin', 'category_manager', 'buyer'), aiFeedController.getAIFeed);

module.exports = router;

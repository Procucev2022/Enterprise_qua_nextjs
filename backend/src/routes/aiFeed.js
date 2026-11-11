const express = require('express');
const router = express.Router();
const aiFeedController = require('../controllers/aiFeedController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, requireRole('admin', 'category_manager', 'buyer'), aiFeedController.getAIFeed);
router.post('/', authenticate, requireRole('admin', 'category_manager', 'buyer'), aiFeedController.createFeedItem);

module.exports = router;

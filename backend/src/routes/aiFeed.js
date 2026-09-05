const express = require('express');
const router = express.Router();
const aiFeedController = require('../controllers/aiFeedController');
const { authenticate } = require('../middleware/auth');

router.get('/', aiFeedController.getAIFeed);
router.post('/', authenticate, aiFeedController.createFeedItem);

module.exports = router;

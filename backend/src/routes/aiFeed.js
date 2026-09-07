const express = require('express');
const router = express.Router();
const aiFeedController = require('../controllers/aiFeedController');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');

router.get('/', optionalAuthenticate, aiFeedController.getAIFeed);
router.post('/', authenticate, aiFeedController.createFeedItem);

module.exports = router;

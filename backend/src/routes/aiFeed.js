const express = require('express');
const router = express.Router();
const aiFeedController = require('../controllers/aiFeedController');

router.get('/', aiFeedController.getAIFeed);
router.post('/', aiFeedController.createFeedItem);

module.exports = router;

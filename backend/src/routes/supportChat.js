const express = require('express');
const router = express.Router();
const supportChatController = require('../controllers/supportChatController');
const { authenticate } = require('../middleware/auth');

router.post('/', authenticate, supportChatController.sendMessage);

module.exports = router;

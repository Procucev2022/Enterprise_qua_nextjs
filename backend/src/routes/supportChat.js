const express = require('express');
const router = express.Router();
const supportChatController = require('../controllers/supportChatController');

router.post('/', supportChatController.sendMessage);

module.exports = router;

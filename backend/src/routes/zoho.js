const express = require('express');
const router = express.Router();
const zohoWebhookController = require('../controllers/zohoWebhookController');

router.post('/webhook', zohoWebhookController.handleWebhook);

module.exports = router;

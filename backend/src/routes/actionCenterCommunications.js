const express = require('express');
const router = express.Router();
const actionCenterCommController = require('../controllers/actionCenterCommController');
const { optionalAuthenticate } = require('../middleware/auth');

// POST /api/action-center/communications - Dispatch SMS/Email communication
router.post('/', optionalAuthenticate, actionCenterCommController.dispatchCommunication);

// GET /api/action-center/communications - Query communication records
router.get('/', optionalAuthenticate, actionCenterCommController.getCommunications);

// POST /api/action-center/communications/webhook - Delivery status updates
router.post('/webhook', actionCenterCommController.handleDeliveryWebhook);

module.exports = router;


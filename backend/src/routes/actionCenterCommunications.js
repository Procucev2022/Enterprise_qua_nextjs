const express = require('express');
const router = express.Router();
const actionCenterCommController = require('../controllers/actionCenterCommController');
const { authenticate, requireRole } = require('../middleware/auth');

// POST /api/action-center/communications - Dispatch SMS/Email communication (Authorized Staff only)
router.post('/', authenticate, requireRole('admin', 'category_manager'), actionCenterCommController.dispatchCommunication);

// GET /api/action-center/communications - Query communication records (Authorized Staff only)
router.get('/', authenticate, requireRole('admin', 'category_manager'), actionCenterCommController.getCommunications);

// POST /api/action-center/communications/webhook - Signed/Authenticated delivery status updates
router.post(
  '/webhook',
  actionCenterCommController.verifyWebhookSignature,
  actionCenterCommController.handleDeliveryWebhook
);

module.exports = router;

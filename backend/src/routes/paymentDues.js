// ==============================================================================
// PAYMENT DUES ROUTES
// ==============================================================================
// Express route endpoints for payment dues low-credit monitoring & communications.
// ==============================================================================

const express = require('express');
const router = express.Router();
const paymentDuesController = require('../controllers/paymentDuesController');
const { authenticate, requireRole } = require('../middleware/auth');

// Payment-dues data includes account balances and communication history. Keep
// every endpoint within the same staff-only authorization boundary.
router.use(authenticate, requireRole('admin', 'category_manager'));

// Summary KPI counts
router.get('/summary', paymentDuesController.getSummary);

// Export filtered accounts to CSV
router.get('/export', paymentDuesController.exportCsv);

// Communication channels
router.post('/email', paymentDuesController.sendEmailNotification);
router.post('/message', paymentDuesController.sendMessageNotification);
router.post('/whatsapp', paymentDuesController.sendWhatsAppNotification);

// Acknowledgement management
router.post('/acknowledge', paymentDuesController.updateAcknowledgement);

// History for a specific account
router.get('/history/:accountId', paymentDuesController.getHistory);

// List low-credit accounts
router.get('/', paymentDuesController.listPaymentDues);

module.exports = router;

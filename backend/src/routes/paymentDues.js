// ==============================================================================
// PAYMENT DUES ROUTES
// ==============================================================================
// Express route endpoints for payment dues low-credit monitoring & communications.
// ==============================================================================

const express = require('express');
const router = express.Router();
const paymentDuesController = require('../controllers/paymentDuesController');
const { optionalAuthenticate } = require('../middleware/auth');

// Summary KPI counts
router.get('/summary', optionalAuthenticate, paymentDuesController.getSummary);

// Export filtered accounts to CSV
router.get('/export', optionalAuthenticate, paymentDuesController.exportCsv);

// Communication channels
router.post('/email', optionalAuthenticate, paymentDuesController.sendEmailNotification);
router.post('/message', optionalAuthenticate, paymentDuesController.sendMessageNotification);
router.post('/whatsapp', optionalAuthenticate, paymentDuesController.sendWhatsAppNotification);

// Acknowledgement management
router.post('/acknowledge', optionalAuthenticate, paymentDuesController.updateAcknowledgement);

// History for a specific account
router.get('/history/:accountId', optionalAuthenticate, paymentDuesController.getHistory);

// List low-credit accounts
router.get('/', optionalAuthenticate, paymentDuesController.listPaymentDues);

module.exports = router;

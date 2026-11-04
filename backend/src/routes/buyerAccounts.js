const express = require('express');
const router = express.Router();
const buyerAccountController = require('../controllers/buyerAccountController');
const accountDocumentController = require('../controllers/accountDocumentController');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');

router.get('/', optionalAuthenticate, buyerAccountController.getBuyerAccounts);
router.get('/subscription-pricing', buyerAccountController.getSubscriptionPricing);
router.post('/', authenticate, buyerAccountController.createBuyerAccount);
// Authenticated: this resolves the caller's own organisation from the identity
// schema, so it needs a session to know whose account to return.
router.get('/active', authenticate, buyerAccountController.getActiveAccount);
router.post('/historical-data', authenticate, buyerAccountController.ingestHistoricalData);
router.post('/ai-cross-match', authenticate, buyerAccountController.aiCrossMatch);
router.put('/:id', authenticate, buyerAccountController.updateBuyerAccount);
router.delete('/:id', authenticate, buyerAccountController.deleteBuyerAccount);
router.post('/:id/activate', authenticate, buyerAccountController.setActiveAccount);
router.post('/:id/subscription-payment', authenticate, buyerAccountController.createSubscriptionPaymentLink);
router.get('/:id/payment-links', authenticate, buyerAccountController.getPaymentLinks);
router.get('/:id/payment-links/:linkId/invoice', authenticate, buyerAccountController.downloadInvoice);
router.get('/:id/credit-history', authenticate, buyerAccountController.getCreditHistory);
router.post('/:id/add-credit', authenticate, buyerAccountController.addCredit);
router.post('/:id/request-credit-approval', authenticate, buyerAccountController.requestCreditApproval);
router.put('/:id/categories', authenticate, buyerAccountController.updateSupportedCategories);
router.get('/:id/communications', authenticate, buyerAccountController.getBuyerCommunications);
router.post('/:id/communications', authenticate, buyerAccountController.recordBuyerCommunication);
router.get('/:id/payment-history', authenticate, buyerAccountController.getBuyerPaymentHistory);

// Buyer Dossier Documents
router.get('/:id/documents', authenticate, accountDocumentController.getBuyerDocuments);
router.post('/:id/documents', authenticate, accountDocumentController.uploadBuyerDocument);
router.delete('/:id/documents/:docId', authenticate, accountDocumentController.deleteBuyerDocument);

module.exports = router;

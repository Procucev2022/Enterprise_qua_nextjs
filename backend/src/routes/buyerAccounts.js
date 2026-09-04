const express = require('express');
const router = express.Router();
const buyerAccountController = require('../controllers/buyerAccountController');
const { authenticate } = require('../middleware/auth');

router.get('/', buyerAccountController.getBuyerAccounts);
router.post('/', authenticate, buyerAccountController.createBuyerAccount);
// Authenticated: this resolves the caller's own organisation from the identity
// schema, so it needs a session to know whose account to return.
router.get('/active', authenticate, buyerAccountController.getActiveAccount);
router.post('/historical-data', authenticate, buyerAccountController.ingestHistoricalData);
router.put('/:id', authenticate, buyerAccountController.updateBuyerAccount);
router.delete('/:id', authenticate, buyerAccountController.deleteBuyerAccount);
router.post('/:id/activate', authenticate, buyerAccountController.setActiveAccount);

module.exports = router;

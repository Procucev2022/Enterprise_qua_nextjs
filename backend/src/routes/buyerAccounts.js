const express = require('express');
const router = express.Router();
const buyerAccountController = require('../controllers/buyerAccountController');
const { authenticate } = require('../middleware/auth');

router.get('/', buyerAccountController.getBuyerAccounts);
router.post('/', authenticate, buyerAccountController.createBuyerAccount);
router.get('/active', buyerAccountController.getActiveAccount);
router.post('/historical-data', authenticate, buyerAccountController.ingestHistoricalData);
router.put('/:id', authenticate, buyerAccountController.updateBuyerAccount);
router.delete('/:id', authenticate, buyerAccountController.deleteBuyerAccount);
router.post('/:id/activate', authenticate, buyerAccountController.setActiveAccount);

module.exports = router;

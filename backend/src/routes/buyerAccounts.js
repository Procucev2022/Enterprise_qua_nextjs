const express = require('express');
const router = express.Router();
const buyerAccountController = require('../controllers/buyerAccountController');

router.get('/', buyerAccountController.getBuyerAccounts);
router.post('/', buyerAccountController.createBuyerAccount);
router.get('/active', buyerAccountController.getActiveAccount);
router.post('/historical-data', buyerAccountController.ingestHistoricalData);
router.put('/:id', buyerAccountController.updateBuyerAccount);
router.delete('/:id', buyerAccountController.deleteBuyerAccount);
router.post('/:id/activate', buyerAccountController.setActiveAccount);

module.exports = router;

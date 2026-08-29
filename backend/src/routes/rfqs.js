const express = require('express');
const router = express.Router();
const rfqController = require('../controllers/rfqController');

router.get('/', rfqController.getRFQs);
router.post('/', rfqController.createRFQ);
router.get('/:id', rfqController.getRFQById);
router.put('/:id', rfqController.updateRFQ);
router.post('/:id/quotes', rfqController.addQuote);
router.post('/:id/batch-chaser', rfqController.triggerBatchChaser);
router.post('/:id/approve-po', rfqController.approvePO);
router.get('/:id/email-preview', rfqController.generateEmailPreview);

module.exports = router;

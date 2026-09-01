const express = require('express');
const router = express.Router();
const rfqController = require('../controllers/rfqController');
const { authenticate } = require('../middleware/auth');

router.get('/', rfqController.getRFQs);
router.post('/', authenticate, rfqController.createRFQ);
router.get('/:id', rfqController.getRFQById);
router.put('/:id', authenticate, rfqController.updateRFQ);
router.post('/:id/quotes', authenticate, rfqController.addQuote);
router.post('/:id/batch-chaser', authenticate, rfqController.triggerBatchChaser);
router.post('/:id/approve-po', authenticate, rfqController.approvePO);
router.get('/:id/email-preview', rfqController.generateEmailPreview);

module.exports = router;

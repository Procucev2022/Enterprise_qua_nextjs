const express = require('express');
const router = express.Router();
const rfqController = require('../controllers/rfqController');
const { authenticate } = require('../middleware/auth');

router.get('/', rfqController.getRFQs);
// Registered before '/:id' so 'summary' is not swallowed as an RFQ identifier.
router.get('/summary', rfqController.getRFQSummary);
router.post('/', authenticate, rfqController.createRFQ);
router.post('/ingest', authenticate, rfqController.ingestRFQ);
router.post('/extract', authenticate, rfqController.extractRFQFromDocument);
router.get('/:id', rfqController.getRFQById);
router.put('/:id', authenticate, rfqController.updateRFQ);
router.post('/:id/quotes', authenticate, rfqController.addQuote);
router.post('/:id/batch-chaser', authenticate, rfqController.triggerBatchChaser);
router.post('/:id/approve-po', authenticate, rfqController.approvePO);
router.get('/:id/email-preview', rfqController.generateEmailPreview);

module.exports = router;

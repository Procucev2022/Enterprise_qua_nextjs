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
// Registered before '/:id' so 'attachments' is not read as an RFQ identifier.
// Both require a session: an attachment is commercial-in-confidence, so the
// download must never be anonymous.
router.post('/attachments', authenticate, rfqController.uploadRFQAttachment);
router.get('/attachments/:attachmentId', authenticate, rfqController.downloadRFQAttachment);
router.get('/:id', rfqController.getRFQById);
router.put('/:id', authenticate, rfqController.updateRFQ);
router.post('/:id/quotes', authenticate, rfqController.addQuote);
router.post('/:id/batch-chaser', authenticate, rfqController.triggerBatchChaser);
router.post('/:id/approve-po', authenticate, rfqController.approvePO);
router.get('/:id/email-preview', authenticate, rfqController.generateEmailPreview);

module.exports = router;

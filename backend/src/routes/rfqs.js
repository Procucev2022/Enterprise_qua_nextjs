const express = require('express');
const router = express.Router();
const rfqController = require('../controllers/rfqController');
const { authenticate } = require('../middleware/auth');

// Every RFQ read is authenticated and scoped to the caller's buyer organisation.
// These three used to be anonymous and returned the entire global RFQ list,
// which is how one buyer's RFQs reached another buyer's dashboard.
router.get('/', authenticate, rfqController.getRFQs);
// Registered before '/:id' so 'summary' is not swallowed as an RFQ identifier.
router.get('/summary', authenticate, rfqController.getRFQSummary);
router.post('/', authenticate, rfqController.createRFQ);
router.post('/ingest', authenticate, rfqController.ingestRFQ);
router.post('/extract', authenticate, rfqController.extractRFQFromDocument);
// An emailed requisition (.eml). Parsed server-side, then run through the same
// extraction and classification as /extract.
// Autonomous mailbox gateway. Registered before '/:id' so neither path segment is
// read as an RFQ identifier. Status is diagnostic; the manual check exists so a
// buyer can pull the mailbox now instead of waiting for the next interval.
router.get('/email-gateway/status', authenticate, rfqController.getEmailGatewayStatus);
router.post('/email-gateway/poll', authenticate, rfqController.pollEmailGateway);
// Registered before '/:id' so 'attachments' is not read as an RFQ identifier.
// Both require a session: an attachment is commercial-in-confidence, so the
// download must never be anonymous.
router.post('/attachments', authenticate, rfqController.uploadRFQAttachment);
router.get('/attachments/:attachmentId', authenticate, rfqController.downloadRFQAttachment);
router.get('/:id', authenticate, rfqController.getRFQById);
router.put('/:id', authenticate, rfqController.updateRFQ);
router.delete('/:id', authenticate, rfqController.deleteRFQ);
router.post('/:id/quotes', authenticate, rfqController.addQuote);
router.post('/:id/batch-chaser', authenticate, rfqController.triggerBatchChaser);
router.post('/:id/approve-po', authenticate, rfqController.approvePO);
// The preview embeds the RFQ's commercial detail, so it cannot be anonymous.
router.get('/:id/email-preview', authenticate, rfqController.generateEmailPreview);

module.exports = router;

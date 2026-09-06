const express = require('express');
const router = express.Router();
const rfqController = require('../controllers/rfqController');
const { authenticate, requireRole } = require('../middleware/auth');

// Every RFQ read is authenticated and scoped to the caller's buyer organisation.
// These three used to be anonymous and returned the entire global RFQ list,
// which is how one buyer's RFQs reached another buyer's dashboard.
router.get('/', authenticate, rfqController.getRFQs);
// Registered before '/:id' so 'summary' is not swallowed as an RFQ identifier.
router.get('/summary', authenticate, rfqController.getRFQSummary);
// Category-manager "All RFQs" console: the full cross-buyer list. Gated to the
// oversight roles — a buyer or vendor hitting this gets 403, not a scoped list.
router.get('/all', authenticate, requireRole('category_manager', 'admin'), rfqController.getAllRFQs);
router.post('/', authenticate, rfqController.createRFQ);
router.post('/ingest', authenticate, rfqController.ingestRFQ);
router.post('/extract', authenticate, rfqController.extractRFQFromDocument);
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

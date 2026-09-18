const express = require('express');
const router = express.Router();
const vendorIngestionController = require('../controllers/vendorIngestionController');
const { authenticate, requireRole } = require('../middleware/auth');

// Every route in this module reads or writes one organisation's vendor master,
// purchase history and supplier categories, so every route requires a signed-in
// buyer. There is no anonymous read here (unlike GET /api/vendors, which serves
// the public network directory) — a vendor master is commercially sensitive.
//
// Authorisation is intentionally two-layered: `requireRole('buyer')` gates the
// role, and the service then re-resolves the caller's organisation from their
// `user` row and scopes every query to it. The role check alone would let any
// buyer read any other buyer's session by id.
router.use(authenticate, requireRole('buyer'));

// --- Static paths first, so they are not captured by /:sessionId below. -------
router.post('/session', vendorIngestionController.createSession);
router.get('/session', vendorIngestionController.getSession);
router.get('/categories', vendorIngestionController.getCategories);
router.get('/audit', vendorIngestionController.getAudit);
router.get('/approved-mappings', vendorIngestionController.getApprovedMappings);

router.get('/session/:sessionId', vendorIngestionController.getSession);
router.put('/session/:sessionId/time-horizon', vendorIngestionController.updateTimeHorizon);

// --- Session-scoped steps. ---------------------------------------------------
router.post('/:sessionId/stream-upload', vendorIngestionController.streamUploadFile);
router.post('/:sessionId/start-job', vendorIngestionController.startIngestionJob);
router.get('/:sessionId/jobs/active', vendorIngestionController.getActiveJobStatus);
router.get('/:sessionId/jobs/:jobId', vendorIngestionController.getJobById);

router.post('/:sessionId/vendor-master/upload', vendorIngestionController.uploadVendorMaster);
router.get('/:sessionId/vendor-master/preview', vendorIngestionController.getVendorMasterPreview);
router.post('/:sessionId/po-dump/upload', vendorIngestionController.uploadPoDump);
router.post('/:sessionId/join', vendorIngestionController.runJoin);
router.post('/:sessionId/ai-categorize', vendorIngestionController.categorizeBatch);

router.get('/:sessionId/vendors', vendorIngestionController.listVendors);
router.get('/:sessionId/segmentation', vendorIngestionController.getSegmentation);
// More specific vendor sub-paths are declared before the generic category PUT so
// `re-run-ai` is never read as a category action.
router.post('/:sessionId/vendors/:vendorRecordId/re-run-ai', vendorIngestionController.reRunAi);
router.put('/:sessionId/vendors/:vendorRecordId/category', vendorIngestionController.reviewVendorCategory);

router.post('/:sessionId/dispatch/preview', vendorIngestionController.previewDispatch);
router.post('/:sessionId/dispatch/send', vendorIngestionController.sendDispatch);
router.post('/:sessionId/dispatch/retry', vendorIngestionController.retryDispatch);
router.get('/:sessionId/dispatch/status', vendorIngestionController.getDispatchStatus);

router.get('/:sessionId/ai-logs', vendorIngestionController.getAiLogs);

module.exports = router;

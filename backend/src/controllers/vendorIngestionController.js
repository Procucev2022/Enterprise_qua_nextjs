// ==============================================================================
// VENDOR MASTER & PO DATA INGESTION CONTROLLER
// ==============================================================================
// Thin HTTP boundary over vendorIngestionService: log the request, call the
// service, shape the envelope. All authorisation, organisation scoping, step
// ordering and validation live in the service, so every route behaves the same
// regardless of which client called it.
//
// Note what these handlers never do: read an organizationId, a buyer id or a
// recipient email address from the request. Those are resolved server-side from
// the session. `req.params` supplies ids, and each one is checked against the
// caller's organisation inside the service before it is used.
// ==============================================================================

const vendorIngestionService = require('../services/vendorIngestionService');
const { logger } = require('../services/loggerService');

const LOG_CATEGORY = 'VENDOR_INGESTION_CONTROLLER';

/**
 * Map a service error onto a response.
 *
 * A VendorIngestionError is an expected outcome — a bad horizon, a step run out
 * of order, a session that is not the caller's — so it is logged at WARN and
 * answered with its own status and detail. Anything else is a real fault and goes
 * to the global error handler.
 */
function respondWithError(err, res, next, fallbackMessage) {
  if (err && err.name === 'VendorIngestionError') {
    logger.warn(
      `Vendor ingestion request rejected: ${err.message}`,
      { status: err.status, details: err.details },
      LOG_CATEGORY
    );
    return res.status(err.status).json({
      success: false,
      error: err.message,
      ...(err.details ? { fieldErrors: err.details } : {}),
    });
  }
  logger.error(fallbackMessage, err, LOG_CATEGORY);
  return next(err);
}

// ------------------------------------------------------------------------------
// SESSIONS
// ------------------------------------------------------------------------------

async function createSession(req, res, next) {
  try {
    logger.info('Vendor ingestion session requested', { user: req.user.email, body: Object.keys(req.body) }, LOG_CATEGORY);
    const session = await vendorIngestionService.createSession(req.user, req.body);
    return res.status(201).json({ success: true, data: session });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error creating vendor ingestion session');
  }
}

/**
 * The session to resume, or `{ session: null }` on a first visit.
 *
 * One handler serves both `GET /session` (latest) and `GET /session/:sessionId`
 * (a specific one), because the only difference is which session is loaded.
 */
async function getSession(req, res, next) {
  try {
    const state = await vendorIngestionService.getResumeState(req.user, req.params.sessionId);
    return res.json({ success: true, data: state });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error loading vendor ingestion session');
  }
}

async function updateTimeHorizon(req, res, next) {
  try {
    const result = await vendorIngestionService.updateSessionHorizon(req.user, req.params.sessionId, req.body);
    return res.json({
      success: true,
      data: result.session,
      poDataCleared: result.poDataCleared,
    });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error updating the ingestion time horizon');
  }
}

// ------------------------------------------------------------------------------
// UPLOADS
// ------------------------------------------------------------------------------

async function uploadVendorMaster(req, res, next) {
  try {
    logger.info(
      'Vendor master chunk received',
      { user: req.user.email, sessionId: req.params.sessionId, rows: Array.isArray(req.body.rows) ? req.body.rows.length : 0 },
      LOG_CATEGORY
    );
    const result = await vendorIngestionService.confirmVendorMaster(req.user, req.params.sessionId, {
      rows: req.body.rows,
      fileName: req.body.fileName,
      replaceExisting: req.body.replaceExisting === true,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error storing the vendor master');
  }
}

async function getVendorMasterPreview(req, res, next) {
  try {
    const result = await vendorIngestionService.getVendorMasterPreview(req.user, req.params.sessionId);
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error loading the vendor master preview');
  }
}

async function uploadPoDump(req, res, next) {
  try {
    logger.info(
      'PO dump chunk received',
      { user: req.user.email, sessionId: req.params.sessionId, rows: Array.isArray(req.body.rows) ? req.body.rows.length : 0 },
      LOG_CATEGORY
    );
    const result = await vendorIngestionService.confirmPoDump(req.user, req.params.sessionId, {
      rows: req.body.rows,
      fileName: req.body.fileName,
      replaceExisting: req.body.replaceExisting === true,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error storing the PO dump');
  }
}

// ------------------------------------------------------------------------------
// JOIN & AI
// ------------------------------------------------------------------------------

async function runJoin(req, res, next) {
  try {
    const result = await vendorIngestionService.runVendorPoJoin(req.user, req.params.sessionId);
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error matching PO data to the vendor master');
  }
}

/**
 * Classify one batch.
 *
 * The client polls this until `done` is true. Batching rather than one long
 * request is what keeps the browser from waiting indefinitely on a large AI job
 * and lets progress survive a page close.
 */
async function categorizeBatch(req, res, next) {
  try {
    const result = await vendorIngestionService.processCategorizationBatch(req.user, req.params.sessionId, {
      batchSize: req.body ? req.body.batchSize : undefined,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error running AI categorisation');
  }
}

async function reRunAi(req, res, next) {
  try {
    const result = await vendorIngestionService.reRunCategorization(
      req.user,
      req.params.sessionId,
      req.params.vendorRecordId
    );
    return res.json({ success: true, data: result.mapping });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error re-running AI categorisation');
  }
}

// ------------------------------------------------------------------------------
// REVIEW
// ------------------------------------------------------------------------------

async function listVendors(req, res, next) {
  try {
    const result = await vendorIngestionService.listMappings(req.user, req.params.sessionId, {
      status: req.query.status,
      confidence: req.query.confidence,
      hasPoHistory: req.query.hasPoHistory,
      search: req.query.search,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error listing ingestion vendors');
  }
}

async function reviewVendorCategory(req, res, next) {
  try {
    const result = await vendorIngestionService.reviewMapping(
      req.user,
      req.params.sessionId,
      req.params.vendorRecordId,
      req.body
    );
    return res.json({ success: true, data: result.mapping });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error saving the category review');
  }
}

async function getSegmentation(req, res, next) {
  try {
    const result = await vendorIngestionService.getCategorySegmentation(req.user, req.params.sessionId);
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error grouping vendors by category');
  }
}

async function getCategories(req, res, next) {
  try {
    const result = await vendorIngestionService.getCategoryMaster(req.user);
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error loading the category master');
  }
}

// ------------------------------------------------------------------------------
// DISPATCH
// ------------------------------------------------------------------------------

async function previewDispatch(req, res, next) {
  try {
    const result = await vendorIngestionService.previewDispatch(req.user, req.params.sessionId, req.body);
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error previewing the email dispatch');
  }
}

async function sendDispatch(req, res, next) {
  try {
    logger.info(
      'Vendor ingestion dispatch requested',
      { user: req.user.email, sessionId: req.params.sessionId, template: req.body ? req.body.template : null },
      LOG_CATEGORY
    );
    const result = await vendorIngestionService.sendDispatch(req.user, req.params.sessionId, req.body);
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error dispatching ingestion emails');
  }
}

async function retryDispatch(req, res, next) {
  try {
    const result = await vendorIngestionService.retryFailedDispatches(req.user, req.params.sessionId);
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error retrying failed ingestion emails');
  }
}

async function getDispatchStatus(req, res, next) {
  try {
    const result = await vendorIngestionService.getDispatchStatus(req.user, req.params.sessionId, {
      status: req.query.status,
      limit: req.query.limit,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error loading dispatch status');
  }
}

// ------------------------------------------------------------------------------
// AUDIT & CROSS-SESSION READS
// ------------------------------------------------------------------------------

async function getAudit(req, res, next) {
  try {
    const result = await vendorIngestionService.getAuditTrail(req.user, {
      sessionId: req.query.sessionId,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error loading the ingestion audit trail');
  }
}

async function getAiLogs(req, res, next) {
  try {
    const result = await vendorIngestionService.getAiClassificationLogs(req.user, req.params.sessionId, {
      limit: req.query.limit,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error loading AI classification logs');
  }
}

/** Approved mappings across every session — consumed by the Vendor Summary screen. */
async function getApprovedMappings(req, res, next) {
  try {
    const result = await vendorIngestionService.getApprovedMappings(req.user);
    return res.json({ success: true, data: result });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error loading approved category mappings');
  }
}

module.exports = {
  respondWithError,
  createSession,
  getSession,
  updateTimeHorizon,
  uploadVendorMaster,
  getVendorMasterPreview,
  uploadPoDump,
  runJoin,
  categorizeBatch,
  reRunAi,
  listVendors,
  reviewVendorCategory,
  getSegmentation,
  getCategories,
  previewDispatch,
  sendDispatch,
  retryDispatch,
  getDispatchStatus,
  getAudit,
  getAiLogs,
  getApprovedMappings,
};

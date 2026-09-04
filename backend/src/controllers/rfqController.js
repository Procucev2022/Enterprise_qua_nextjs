const storeService = require('../services/storeService');
const { generateStandardRFQEmail } = require('../services/emailService');
// Called through the module namespace (like storeService below) so the ingestion
// pipeline stays substitutable in tests rather than being bound at import time.
const rfqIngestionService = require('../services/rfqIngestionService');
const geminiService = require('../services/geminiService');
const rfqAttachmentService = require('../services/rfqAttachmentService');
const rfqIdService = require('../services/rfqIdService');
const rfqSummaryService = require('../services/rfqSummaryService');
const rfqQueries = require('../db/rfqQueries');
const { requireBuyerScope } = require('../services/buyerScopeService');
const { logger } = require('../services/loggerService');
const {
  VALIDATION_SCHEMAS,
  validatePayload,
  EXTRACTION_REASON_MESSAGES,
  RFQ_ATTACHMENT_CONFIG,
} = require('../config/constants');

// A newly created RFQ is awaiting vendor quotations.
const RFQ_DEFAULT_STATUS = 'Quotes Pending';

/**
 * Reasons an RFQ mutation cannot proceed.
 *
 * NOT_FOUND deliberately covers both "no RFQ has that id" and "that RFQ belongs
 * to another organisation". Distinguishing them would let a caller enumerate
 * which ids exist elsewhere.
 */
const RFQ_ERRORS = {
  NOT_FOUND: 'That RFQ was not found under your organisation.',
};

/** Buyer-facing reason for each attachment rejection. */
const ATTACHMENT_ERRORS = {
  NO_CONTENT: 'That file appears to be empty. Choose a file with content and try again.',
  TOO_LARGE: `That file is larger than the ${Math.floor(
    RFQ_ATTACHMENT_CONFIG.MAX_BYTES / (1024 * 1024)
  )}MB limit. Attach a smaller file.`,
  UNSUPPORTED_TYPE:
    'That file type cannot be attached. Use a PDF, spreadsheet, Word document, text file or image.',
  WRITE_FAILED: 'The document could not be stored. Try again, and if it persists the storage volume may be full.',
};

/**
 * List the signed-in buyer organisation's RFQs.
 *
 * This used to be `storeService.getRFQs()` — the entire global array, on an
 * unauthenticated route. That is what put one buyer's RFQs on another buyer's
 * dashboard. There is deliberately no way to ask this endpoint for anything
 * wider than the caller's own organisation.
 */
async function getRFQs(req, res, next) {
  try {
    const scope = requireBuyerScope(req, res);
    if (!scope) return undefined;

    logger.info('Listing RFQs for buyer organisation', { orgId: scope.orgId }, 'RFQ_CONTROLLER');
    const rfqs = await rfqQueries.listRFQsByOrg(scope.orgId);
    return res.json({ success: true, source: 'persisted', data: rfqs });
  } catch (err) {
    logger.error('Error listing RFQs', err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

/**
 * One RFQ, by RFQ number or row id, scoped to the caller's organisation.
 *
 * A hit on another organisation's RFQ returns the same 404 as an id that does
 * not exist, so the response cannot be used to probe what other organisations
 * have raised.
 */
async function getRFQById(req, res, next) {
  try {
    const scope = requireBuyerScope(req, res);
    if (!scope) return undefined;

    const { id } = req.params;
    logger.info(`Fetching RFQ ${id}`, { id, orgId: scope.orgId }, 'RFQ_CONTROLLER');
    const rfq = await rfqQueries.findRFQByAnyId(id, scope.orgId);
    if (!rfq) {
      logger.warn(`RFQ not found in this organisation: ${id}`, { id, orgId: scope.orgId }, 'RFQ_CONTROLLER');
      return res.status(404).json({
        success: false,
        error: `RFQ ${id} was not found under your organisation.`,
      });
    }
    return res.json({ success: true, data: rfq });
  } catch (err) {
    logger.error(`Error fetching RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

/**
 * Create an RFQ owned by the signed-in buyer organisation.
 *
 * The RFQ number is allocated here, not by the client. The wizard used to mint
 * one with Math.random(), which could collide and bore no relation to the id
 * scheme the Java p2pservices app allocates from the same space.
 */
async function createRFQ(req, res, next) {
  try {
    const scope = requireBuyerScope(req, res);
    if (!scope) return undefined;

    const body = req.body || {};

    // Validated against the centralized schema at the entry boundary so a
    // malformed RFQ never reaches the store. Previously only `title` was checked.
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.createRFQ, body);
    if (!isValid) {
      logger.warn('Failed to create RFQ: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const rfqId = await rfqIdService.generateRfqId();
    const lineItems = Array.isArray(body.extractedEntities)
      ? body.extractedEntities
      : body.lineItems || [];

    // Generated from the line items the buyer confirmed, so the summary always
    // describes what was actually dispatched.
    const aiSummary = await rfqSummaryService.buildRFQSummary(
      { ...body, rfqId, extractedEntities: lineItems },
      { orgName: (req.user && req.user.orgName) || '' }
    );

    logger.info(
      `Creating RFQ ${rfqId}`,
      { rfqId, title: body.title, orgId: scope.orgId, itemCount: lineItems.length },
      'RFQ_CONTROLLER'
    );

    const created = await rfqQueries.insertRFQ({
      rfqId,
      buyerOrgId: scope.orgId,
      buyerUserId: scope.userId,
      buyerEmail: scope.email,
      title: body.title,
      category: body.category,
      sourcingMode: body.sourcingMode,
      status: body.status || RFQ_DEFAULT_STATUS,
      source: body.source,
      sourceFileName: body.sourceFileName,
      budget: body.budget,
      targetDeliveryDate: body.targetDeliveryDate,
      deliveryLocation: body.deliveryLocation,
      deliveryPincode: body.deliveryPincode,
      extractedEntities: lineItems,
      attachments: body.attachments,
      aiSummary,
    });

    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating RFQ', err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

/**
 * Classify raw extracted BOQ/email rows into review-ready RFQ line items.
 *
 * This is the server half of AI ingestion: the client extracts rows from the
 * document, this endpoint normalises and categorises them, and the wizard renders
 * the returned draft for the buyer to confirm before dispatch.
 */
function ingestRFQ(req, res, next) {
  try {
    const body = req.body || {};

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.ingestRFQ, body);
    if (!isValid) {
      logger.warn('Failed to ingest RFQ: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const { draft, classification } = rfqIngestionService.buildRFQDraft(body);

    // An upload that yielded nothing usable is a failed ingestion, not an empty
    // success: returning 422 lets the wizard keep the buyer on the upload step.
    if (classification.accepted === 0) {
      logger.warn('RFQ ingestion produced no usable line items', classification, 'RFQ_CONTROLLER');
      return res.status(422).json({
        success: false,
        error: 'No usable line items could be extracted. Check that the document has a description column.',
        classification,
      });
    }

    logger.info(`RFQ ingestion complete: ${classification.accepted} line items`, classification, 'RFQ_CONTROLLER');
    res.json({ success: true, data: draft, classification });
  } catch (err) {
    logger.error('Error ingesting RFQ line items', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Extract RFQ line items from an uploaded document using Gemini, then classify
 * them through the same ingestion pipeline the manual path uses.
 *
 * A failed or empty extraction is not a server error — it is an expected outcome
 * that the wizard handles by inviting the buyer to key the line items instead.
 * The response therefore always carries a machine-readable `reason` so the UI can
 * explain precisely what happened (no API key, unreadable file, nothing found).
 */
async function extractRFQFromDocument(req, res, next) {
  try {
    const body = req.body || {};

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.extractRFQ, body);
    if (!isValid) {
      logger.warn('Document extraction rejected: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const extraction = await geminiService.extractLineItems({
      documentText: body.documentText,
      inlineData: body.inlineData,
      mimeType: body.mimeType,
      fileName: body.fileName,
    });

    if (extraction.status !== geminiService.EXTRACTION_STATUS.SUCCESS) {
      logger.warn(
        `Document extraction produced no line items (${extraction.status})`,
        { fileName: body.fileName, status: extraction.status },
        'RFQ_CONTROLLER'
      );
      return res.status(422).json({
        success: false,
        reason: extraction.status,
        error: EXTRACTION_REASON_MESSAGES[extraction.status] || EXTRACTION_REASON_MESSAGES.AI_FAILED,
      });
    }

    // Reuse the shared normalisation + taxonomy classification so an AI-extracted
    // RFQ is shaped identically to one keyed by hand.
    const { draft, classification } = rfqIngestionService.buildRFQDraft({
      lineItems: extraction.lineItems,
      title: extraction.documentTitle,
      category: extraction.category,
      estimatedBudget: extraction.estimatedBudget,
      source: 'web_portal',
      sourceFileName: body.fileName,
    });

    if (classification.accepted === 0) {
      return res.status(422).json({
        success: false,
        reason: geminiService.EXTRACTION_STATUS.NO_ITEMS_FOUND,
        error: EXTRACTION_REASON_MESSAGES.NO_ITEMS_FOUND,
      });
    }

    logger.info(
      `Document extraction complete: ${classification.accepted} line items via ${extraction.model}`,
      { ...classification, model: extraction.model },
      'RFQ_CONTROLLER'
    );

    res.json({
      success: true,
      data: draft,
      classification,
      extraction: { model: extraction.model, deliveryDate: extraction.deliveryDate },
    });
  } catch (err) {
    logger.error('Error extracting RFQ line items from document', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Portfolio roll-up backing the buyer RFQ Summary screen.
 *
 * Derived from this organisation's RFQs only. The previous version reduced over
 * the global array, so every buyer saw the same portfolio totals — including
 * spend figures belonging to other companies.
 */
async function getRFQSummary(req, res, next) {
  try {
    const scope = requireBuyerScope(req, res);
    if (!scope) return undefined;

    logger.info('Building RFQ portfolio summary', { orgId: scope.orgId }, 'RFQ_CONTROLLER');
    const rfqs = await rfqQueries.listRFQsByOrg(scope.orgId);
    return res.json({ success: true, data: rfqSummaryService.buildPortfolioSummary(rfqs) });
  } catch (err) {
    logger.error('Error building RFQ summary', err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

/**
 * Store a supporting document for an RFQ and return its metadata.
 *
 * Deliberately does not invoke Gemini. This is the manual path: the buyer is
 * keying the line items themselves and the document is evidence to attach, not
 * something to be read. Only the returned metadata goes onto the RFQ; the bytes
 * stay on disk and are fetched by id.
 */
function uploadRFQAttachment(req, res, next) {
  try {
    const body = req.body || {};

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.uploadRFQAttachment, body);
    if (!isValid) {
      logger.warn('Attachment upload rejected: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const result = rfqAttachmentService.saveAttachment({
      fileName: body.fileName,
      mimeType: body.mimeType,
      content: body.content,
    });

    if (result.status !== rfqAttachmentService.ATTACHMENT_STATUS.SAVED) {
      logger.warn(
        `Attachment upload refused (${result.status})`,
        { fileName: body.fileName, mimeType: body.mimeType, status: result.status },
        'RFQ_CONTROLLER'
      );
      // A refused upload is an expected outcome the buyer can act on, not a fault.
      const status = result.status === rfqAttachmentService.ATTACHMENT_STATUS.WRITE_FAILED ? 500 : 422;
      return res.status(status).json({
        success: false,
        reason: result.status,
        error: ATTACHMENT_ERRORS[result.status] || ATTACHMENT_ERRORS.WRITE_FAILED,
      });
    }

    res.status(201).json({ success: true, data: result.attachment });
  } catch (err) {
    logger.error('Error storing RFQ attachment', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Stream one stored attachment back to the buyer.
 *
 * The name and content type come from the stored sidecar rather than the request,
 * so a caller cannot influence how the file is served. Content-Disposition is
 * `inline` so the browser previews a PDF or image instead of forcing a download.
 */
function downloadRFQAttachment(req, res, next) {
  try {
    const { attachmentId } = req.params;
    const stored = rfqAttachmentService.loadAttachment(attachmentId);

    if (!stored) {
      logger.warn('Attachment not found', { attachmentId }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: 'That document is no longer available.' });
    }

    res.setHeader('Content-Type', stored.meta.mimeType);
    res.setHeader('Content-Length', stored.content.length);
    // The stored name is already reduced to a leaf and quoted, so it cannot inject
    // extra header directives.
    res.setHeader('Content-Disposition', `inline; filename="${stored.meta.fileName.replace(/"/g, '')}"`);
    res.send(stored.content);
  } catch (err) {
    logger.error('Error reading RFQ attachment', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Apply a buyer's edit to one of their own RFQs.
 *
 * Rewired onto the persisted table. It previously called the in-memory
 * storeService, which no longer holds anything the dashboard reads, so every edit
 * of a real RFQ 404'd. It also ran unscoped and unvalidated: any authenticated
 * user could address any id, and the raw request body was spread over the record.
 *
 * The organisation comes from the verified session claims and goes into the WHERE
 * clause, so editing another organisation's RFQ reports the same 404 as an id
 * that does not exist.
 */
async function updateRFQ(req, res, next) {
  const { id } = req.params;
  try {
    const scope = requireBuyerScope(req, res);
    if (!scope) return undefined;

    const body = req.body || {};
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.updateRFQ, body);
    if (!isValid) {
      logger.warn('RFQ edit rejected: payload validation failed', { id, errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    // Resolved first so the caller may address the RFQ by either its number or its
    // row id, exactly as GET /api/rfqs/:id allows.
    const existing = await rfqQueries.findRFQByAnyId(id, scope.orgId);
    if (!existing) {
      logger.warn('RFQ edit rejected: not found for this organisation', { id, orgId: scope.orgId }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: RFQ_ERRORS.NOT_FOUND });
    }

    logger.info('Updating RFQ', { rfqId: existing.rfqId, orgId: scope.orgId, fields: Object.keys(body) }, 'RFQ_CONTROLLER');
    const updated = await rfqQueries.updateRFQ(existing.rfqId, scope.orgId, body);
    if (!updated) {
      return res.status(404).json({ success: false, error: RFQ_ERRORS.NOT_FOUND });
    }

    return res.json({ success: true, source: 'persisted', data: updated });
  } catch (err) {
    logger.error(`Error updating RFQ ${id}`, err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

/**
 * Withdraw one of the buyer's own RFQs.
 *
 * A hard delete, scoped to the organisation the same way. Reports 404 rather than
 * 403 for another organisation's RFQ, so the response cannot be used to discover
 * which ids exist elsewhere.
 */
async function deleteRFQ(req, res, next) {
  const { id } = req.params;
  try {
    const scope = requireBuyerScope(req, res);
    if (!scope) return undefined;

    const existing = await rfqQueries.findRFQByAnyId(id, scope.orgId);
    if (!existing) {
      logger.warn('RFQ delete rejected: not found for this organisation', { id, orgId: scope.orgId }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: RFQ_ERRORS.NOT_FOUND });
    }

    const removed = await rfqQueries.deleteRFQ(existing.rfqId, scope.orgId);
    if (!removed) {
      return res.status(404).json({ success: false, error: RFQ_ERRORS.NOT_FOUND });
    }

    logger.info('Deleted RFQ', { rfqId: existing.rfqId, orgId: scope.orgId }, 'RFQ_CONTROLLER');
    // The deleted number is echoed so the client can drop that row without
    // guessing which of the two identifiers it had sent.
    return res.json({ success: true, data: { rfqNumber: existing.rfqNumber, rfqId: existing.rfqId } });
  } catch (err) {
    logger.error(`Error deleting RFQ ${id}`, err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

function addQuote(req, res, next) {
  try {
    const { id } = req.params;
    const quote = req.body;
    if (!quote.vendorName || !quote.unitPrice) {
      logger.warn(`Failed to add quote to RFQ ${id}: Missing vendorName or unitPrice`, { id, quote }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: 'vendorName and unitPrice are required.' });
    }
    logger.info(`Adding quote from ${quote.vendorName} to RFQ ${id}`, { id, vendorName: quote.vendorName, price: quote.unitPrice }, 'RFQ_CONTROLLER');
    const updatedRFQ = storeService.addQuoteToRFQ(id, quote);
    if (!updatedRFQ) {
      logger.warn(`RFQ not found for quote submission: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, data: updatedRFQ });
  } catch (err) {
    logger.error(`Error adding quote to RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

async function generateEmailPreview(req, res, next) {
  try {
    const scope = requireBuyerScope(req, res);
    if (!scope) return undefined;

    const { id } = req.params;
    const { vendorId } = req.query;
    logger.info(`Generating email preview for RFQ ${id}`, { id, vendorId }, 'RFQ_CONTROLLER');
    // Org-scoped: the preview embeds pricing, quantities and delivery detail, so
    // it must not be renderable for another organisation's RFQ.
    const rfq = await rfqQueries.findRFQByAnyId(id, scope.orgId);
    if (!rfq) {
      logger.warn(`RFQ not found for email preview: ${id}`, { id, orgId: scope.orgId }, 'RFQ_CONTROLLER');
      return res.status(404).json({
        success: false,
        error: `RFQ ${id} was not found under your organisation.`,
      });
    }
    const vendor = vendorId ? storeService.getVendorById(vendorId) : null;
    const emailPayload = generateStandardRFQEmail(rfq, vendor);
    return res.json({ success: true, data: emailPayload });
  } catch (err) {
    logger.error(`Error generating email preview for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    return next(err);
  }
}

function triggerBatchChaser(req, res, next) {
  try {
    const { id } = req.params;
    const { channels } = req.body;
    logger.info(`Triggering batch chasers for RFQ ${id}`, { id, channels }, 'RFQ_CONTROLLER');
    const result = storeService.triggerBatchChaser(id, channels || ['call', 'whatsapp', 'sms']);
    if (!result) {
      logger.warn(`RFQ not found for batch chasers: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error(`Error triggering batch chasers for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

function approvePO(req, res, next) {
  try {
    const { id } = req.params;
    const { vendorName, totalAmount, approverNotes } = req.body;
    if (!vendorName || !totalAmount) {
      logger.warn(`Failed to approve PO for RFQ ${id}: Missing vendorName or totalAmount`, { id, body: req.body }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: 'vendorName and totalAmount are required.' });
    }
    logger.info(`Approving Purchase Order for RFQ ${id}`, { id, vendorName, totalAmount, approverNotes }, 'RFQ_CONTROLLER');
    const result = storeService.approvePurchaseOrder(id, vendorName, totalAmount, approverNotes);
    res.json(result);
  } catch (err) {
    logger.error(`Error approving PO for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getRFQs,
  getRFQById,
  getRFQSummary,
  createRFQ,
  ingestRFQ,
  extractRFQFromDocument,
  uploadRFQAttachment,
  downloadRFQAttachment,
  updateRFQ,
  deleteRFQ,
  addQuote,
  generateEmailPreview,
  triggerBatchChaser,
  approvePO,
};

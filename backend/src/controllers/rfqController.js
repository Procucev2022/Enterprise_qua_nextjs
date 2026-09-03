const storeService = require('../services/storeService');
const { generateStandardRFQEmail } = require('../services/emailService');
// Called through the module namespace (like storeService below) so the ingestion
// pipeline stays substitutable in tests rather than being bound at import time.
const rfqIngestionService = require('../services/rfqIngestionService');
const geminiService = require('../services/geminiService');
const { logger } = require('../services/loggerService');
const { VALIDATION_SCHEMAS, validatePayload, EXTRACTION_REASON_MESSAGES } = require('../config/constants');

function getRFQs(req, res, next) {
  try {
    logger.info('Fetching all RFQs list', { query: req.query }, 'RFQ_CONTROLLER');
    const rfqs = storeService.getRFQs();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory', data: rfqs });
  } catch (err) {
    logger.error('Error fetching RFQs list', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

function getRFQById(req, res, next) {
  try {
    const { id } = req.params;
    logger.info(`Fetching RFQ by ID: ${id}`, { id }, 'RFQ_CONTROLLER');
    const rfq = storeService.getRFQById(id);
    if (!rfq) {
      logger.warn(`RFQ not found for ID: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, data: rfq });
  } catch (err) {
    logger.error(`Error fetching RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

function createRFQ(req, res, next) {
  try {
    const body = req.body || {};

    // Validated against the centralized schema at the entry boundary so a
    // malformed RFQ never reaches the store. Previously only `title` was checked.
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.createRFQ, body);
    if (!isValid) {
      logger.warn('Failed to create RFQ: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    logger.info(`Creating new RFQ: ${body.title}`, { title: body.title, category: body.category, budget: body.budget }, 'RFQ_CONTROLLER');
    const created = storeService.createRFQ(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating RFQ', err, 'RFQ_CONTROLLER');
    next(err);
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

/** Portfolio roll-up backing the buyer RFQ Summary screen. */
function getRFQSummary(req, res, next) {
  try {
    logger.info('Fetching buyer RFQ portfolio summary', {}, 'RFQ_CONTROLLER');
    const summary = storeService.getRFQSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    logger.error('Error building RFQ summary', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

function updateRFQ(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    logger.info(`Updating RFQ ${id}`, { id, updates }, 'RFQ_CONTROLLER');
    const updated = storeService.updateRFQ(id, updates);
    if (!updated) {
      logger.warn(`RFQ not found for update: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

function addQuote(req, res, next) {
  try {
    const { id } = req.params;
    // A quote's vendor identity must come from the authenticated session, not
    // whatever vendorName/vendorId the client body claims — otherwise any
    // authenticated user could submit a bid posing as any vendor by name.
    if (req.user.role !== 'vendor') {
      return res.status(403).json({ success: false, error: 'Only a vendor can submit a quote.' });
    }
    const vendorRecord = storeService.getVendorById(req.user.email);
    if (!vendorRecord) {
      return res.status(400).json({ success: false, error: 'Create your vendor profile before submitting a quote.' });
    }
    const { unitPrice, totalPrice, leadTimeDays, warrantyYears, paymentTerms, remarks, vendorCategory, complianceStatus } = req.body;
    if (!unitPrice) {
      logger.warn(`Failed to add quote to RFQ ${id}: Missing unitPrice`, { id }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: 'unitPrice is required.' });
    }
    const quote = {
      vendorId: vendorRecord.id,
      vendorName: vendorRecord.name,
      vendorCategory: vendorCategory || 'Client List',
      unitPrice,
      totalPrice: totalPrice || unitPrice,
      leadTimeDays: leadTimeDays || 0,
      aiMatchScore: 0,
      warrantyYears: warrantyYears || 0,
      complianceStatus: complianceStatus || 'Pending Review',
      paymentTerms: paymentTerms || '',
      remarks: remarks || '',
      submittedAt: new Date().toISOString(),
    };
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

function generateEmailPreview(req, res, next) {
  try {
    const { id } = req.params;
    const { vendorId } = req.query;
    logger.info(`Generating email preview for RFQ ${id}`, { id, vendorId }, 'RFQ_CONTROLLER');
    const rfq = storeService.getRFQById(id);
    if (!rfq) {
      logger.warn(`RFQ not found for email preview: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    const vendor = vendorId ? storeService.getVendorById(vendorId) : null;
    const emailPayload = generateStandardRFQEmail(rfq, vendor);
    res.json({ success: true, data: emailPayload });
  } catch (err) {
    logger.error(`Error generating email preview for RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
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
    // Awarding a PO is a buyer-side decision — a vendor has no business
    // approving their own (or anyone else's) award.
    if (!['buyer', 'category_manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to approve a purchase order.' });
    }
    const { vendorId, vendorName, totalAmount, approverNotes } = req.body;
    if (!vendorName || !totalAmount) {
      logger.warn(`Failed to approve PO for RFQ ${id}: Missing vendorName or totalAmount`, { id, body: req.body }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: 'vendorName and totalAmount are required.' });
    }
    logger.info(`Approving Purchase Order for RFQ ${id}`, { id, vendorId, vendorName, totalAmount, approverNotes }, 'RFQ_CONTROLLER');
    const result = storeService.approvePurchaseOrder(id, vendorId, vendorName, totalAmount, approverNotes, req.user.email);
    if (!result) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
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
  updateRFQ,
  addQuote,
  generateEmailPreview,
  triggerBatchChaser,
  approvePO,
};

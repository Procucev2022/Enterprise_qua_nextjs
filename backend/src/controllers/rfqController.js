const storeService = require('../services/storeService');
const { generateStandardRFQEmail } = require('../services/emailService');
// Called through the module namespace (like storeService below) so the ingestion
// pipeline stays substitutable in tests rather than being bound at import time.
const rfqIngestionService = require('../services/rfqIngestionService');
const geminiService = require('../services/geminiService');
const rfqAttachmentService = require('../services/rfqAttachmentService');
const rfqSummaryService = require('../services/rfqSummaryService');
const { logger } = require('../services/loggerService');
const {
  VALIDATION_SCHEMAS,
  validatePayload,
  EXTRACTION_REASON_MESSAGES,
  RFQ_ATTACHMENT_CONFIG,
} = require('../config/constants');

// A newly created RFQ is awaiting vendor quotations.
const RFQ_DEFAULT_STATUS = 'Quotes Pending';

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
 * Which RFQs a caller may see.
 *
 * Buyers are scoped to their own buyerAccountId, resolved server-side from
 * the authenticated session — never trusted from the client, the same
 * pattern createRFQ already uses. Category managers and admins see the full
 * cross-buyer list (quote-matrix.tsx's own CM route already depends on
 * this). Vendors also see the full list at the listing level: the
 * marketplace opportunity feed is deliberately cross-buyer, and visibility
 * is gated downstream instead, by isOwnBuyerRfq and the subscription quota
 * in generateEmailPreview — locking the listing itself to one buyer would
 * break the vendor opportunity feed outright.
 */
function resolveRfqReadScope(req) {
  if (req.user && req.user.role === 'buyer') {
    const account = storeService.getBuyerAccountByEmail(req.user.email);
    return { restricted: true, buyerAccountId: account ? account.id : null };
  }
  return { restricted: false, buyerAccountId: null };
}

/**
 * Whether a buyer caller may read or write this specific RFQ.
 *
 * Non-buyer roles are never restricted here (see resolveRfqReadScope). A
 * buyer requesting an RFQ outside their own account gets the same 404 as an
 * id that doesn't exist — "not found" covers both, so a caller can't
 * enumerate other buyers' RFQ ids.
 */
function canAccessRfq(req, rfq) {
  const scope = resolveRfqReadScope(req);
  if (!scope.restricted) return true;
  return !!scope.buyerAccountId && rfq.buyerAccountId === scope.buyerAccountId;
}

// Fields a buyer's own edit may touch. Deliberately a whitelist: id,
// rfqNumber, buyerAccountId, buyerAccountName, quotes and createdAt
// establish ownership/identity and must never be writable through a plain
// edit, or a malicious body could hand an RFQ to another buyer or fabricate
// quotes — storeService.updateRFQ merges whatever object it's given, with
// no column whitelist of its own.
const RFQ_UPDATABLE_FIELDS = [
  'title',
  'category',
  'sourcingMode',
  'status',
  'budget',
  'targetDeliveryDate',
  'deliveryLocation',
  'deliveryPincode',
  'extractedEntities',
  'attachments',
];

function pickUpdatableRfqFields(body) {
  const updates = {};
  for (const field of RFQ_UPDATABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field];
    }
  }
  return updates;
}

/**
 * List RFQs visible to the caller.
 *
 * This used to be `storeService.getRFQs()` — the entire global array, on an
 * unauthenticated route. That is what put one buyer's RFQs on another
 * buyer's dashboard.
 */
function getRFQs(req, res, next) {
  try {
    const scope = resolveRfqReadScope(req);
    const all = storeService.getRFQs();
    const rfqs = scope.restricted ? all.filter((rfq) => rfq.buyerAccountId === scope.buyerAccountId) : all;
    logger.info('Fetching RFQs list', { restricted: scope.restricted, count: rfqs.length }, 'RFQ_CONTROLLER');
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory', data: rfqs });
  } catch (err) {
    logger.error('Error fetching RFQs list', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Every RFQ in the system, for the category manager's "All RFQs" console.
 *
 * Deliberately a separate endpoint from getRFQs rather than a query flag on
 * it: getRFQs' scoping rules are about who owns which RFQ and are expected to
 * keep evolving, whereas this view has one fixed contract — the whole
 * cross-buyer list, newest first, for a role that oversees all sourcing. The
 * route is gated to category_manager/admin, so the "no scope" here can never
 * be reached by a buyer or vendor.
 */
function getAllRFQs(req, res, next) {
  try {
    const rfqs = storeService
      .getRFQs()
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    logger.info('Fetching all RFQs for CM console', { count: rfqs.length }, 'RFQ_CONTROLLER');
    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory',
      data: rfqs,
    });
  } catch (err) {
    logger.error('Error fetching all RFQs', err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * One RFQ, by RFQ number or row id.
 *
 * A hit on another buyer's RFQ returns the same 404 as an id that does not
 * exist, so the response cannot be used to probe what other buyers have
 * raised.
 */
function getRFQById(req, res, next) {
  try {
    const { id } = req.params;
    logger.info(`Fetching RFQ by ID: ${id}`, { id }, 'RFQ_CONTROLLER');
    const rfq = storeService.getRFQById(id);
    if (!rfq || !canAccessRfq(req, rfq)) {
      logger.warn(`RFQ not found for ID: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, data: rfq });
  } catch (err) {
    logger.error(`Error fetching RFQ ${req.params.id}`, err, 'RFQ_CONTROLLER');
    next(err);
  }
}

/**
 * Create an RFQ owned by the signed-in buyer's account.
 */
async function createRFQ(req, res, next) {
  try {
    const body = req.body || {};

    // Validated against the centralized schema at the entry boundary so a
    // malformed RFQ never reaches the store. deliveryLocation/deliveryPincode
    // are required here: vendors price freight against the destination, and a
    // quote raised without it can't be compared against one that has it.
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.createRFQ, body);
    if (!isValid) {
      logger.warn('Failed to create RFQ: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const lineItems = Array.isArray(body.extractedEntities) ? body.extractedEntities : body.lineItems || [];

    // Generated from the line items the buyer confirmed, so the summary
    // always describes what was actually dispatched. A model or network
    // failure here must not block RFQ creation — buildRFQSummary already
    // falls back to a deterministic summary rather than throwing.
    const aiSummary = await rfqSummaryService.buildRFQSummary(
      { ...body, extractedEntities: lineItems },
      { orgName: (req.user && req.user.orgName) || '' }
    );

    logger.info(`Creating new RFQ: ${body.title}`, { title: body.title, category: body.category, budget: body.budget }, 'RFQ_CONTROLLER');
    // Resolved server-side from the authenticated session, never trusted from
    // the request body, so the RFQ is attributed to whoever is actually
    // logged in rather than a client-supplied or globally-shared value.
    const requestingBuyerAccount = req.user ? storeService.getBuyerAccountByEmail(req.user.email) : null;
    const created = storeService.createRFQ({ ...body, extractedEntities: lineItems, aiSummary }, requestingBuyerAccount);
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
async function ingestRFQ(req, res, next) {
  try {
    const body = req.body || {};

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.ingestRFQ, body);
    if (!isValid) {
      logger.warn('Failed to ingest RFQ: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const { draft, classification } = await rfqIngestionService.buildRFQDraft(body);

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
    const { draft, classification } = await rfqIngestionService.buildRFQDraft({
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
 * Derived from only the RFQs visible to the caller (see
 * resolveRfqReadScope) — previously reduced over the global array, so every
 * buyer saw the same portfolio totals, including spend figures belonging to
 * other companies.
 */
function getRFQSummary(req, res, next) {
  try {
    const scope = resolveRfqReadScope(req);
    const all = storeService.getRFQs();
    const rfqs = scope.restricted ? all.filter((rfq) => rfq.buyerAccountId === scope.buyerAccountId) : all;
    logger.info('Building RFQ portfolio summary', { restricted: scope.restricted, count: rfqs.length }, 'RFQ_CONTROLLER');
    res.json({ success: true, data: rfqSummaryService.buildPortfolioSummary(rfqs) });
  } catch (err) {
    logger.error('Error building RFQ summary', err, 'RFQ_CONTROLLER');
    next(err);
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
async function uploadRFQAttachment(req, res, next) {
  try {
    const body = req.body || {};

    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.uploadRFQAttachment, body);
    if (!isValid) {
      logger.warn('Attachment upload rejected: payload validation failed', { errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const result = await rfqAttachmentService.saveAttachment({
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
async function downloadRFQAttachment(req, res, next) {
  try {
    const { attachmentId } = req.params;
    const stored = await rfqAttachmentService.loadAttachment(attachmentId);

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
 * A hit on another buyer's RFQ, or on an id that doesn't exist, reports the
 * same 404 either way (see canAccessRfq). Only RFQ_UPDATABLE_FIELDS are ever
 * written — ownership/identity fields are not part of a plain edit.
 */
function updateRFQ(req, res, next) {
  const { id } = req.params;
  try {
    const existing = storeService.getRFQById(id);
    if (!existing || !canAccessRfq(req, existing)) {
      logger.warn(`RFQ not found for update: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    const body = req.body || {};
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.updateRFQ, body);
    if (!isValid) {
      logger.warn('RFQ edit rejected: payload validation failed', { id, errors }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: Object.values(errors)[0], fieldErrors: errors });
    }

    const updates = pickUpdatableRfqFields(body);
    logger.info(`Updating RFQ ${id}`, { id, fields: Object.keys(updates) }, 'RFQ_CONTROLLER');
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

/**
 * Withdraw one of the buyer's own RFQs.
 *
 * A hard delete. Reports the same 404 for another buyer's RFQ as for an id
 * that doesn't exist, so the response cannot be used to discover which ids
 * exist elsewhere.
 */
function deleteRFQ(req, res, next) {
  const { id } = req.params;
  try {
    const existing = storeService.getRFQById(id);
    if (!existing || !canAccessRfq(req, existing)) {
      logger.warn(`RFQ not found for deletion: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    const removed = storeService.deleteRFQ(id);
    if (!removed) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    logger.info('Deleted RFQ', { id, rfqNumber: existing.rfqNumber }, 'RFQ_CONTROLLER');
    // The deleted number is echoed so the client can drop that row without
    // guessing which of the two identifiers it had sent.
    return res.json({ success: true, data: { rfqNumber: existing.rfqNumber, rfqId: existing.id } });
  } catch (err) {
    logger.error(`Error deleting RFQ ${id}`, err, 'RFQ_CONTROLLER');
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
    if (!rfq || !canAccessRfq(req, rfq)) {
      logger.warn(`RFQ not found for email preview: ${id}`, { id }, 'RFQ_CONTROLLER');
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }

    // This is the real "download RFQ" action both opportunity-feed.tsx and
    // quotation-form.tsx call. A vendor downloading a marketplace RFQ (one
    // not raised by the buyer who added them) is subject to their
    // subscription's download quota — previously enforced only client-side,
    // so any vendor could bypass their plan's limit by calling this endpoint
    // directly. Buyers/category managers/admins downloading their own RFQ's
    // spec are never subject to this.
    if (req.user && req.user.role === 'vendor') {
      const requestingVendor = storeService.getVendorById(req.user.email);
      if (requestingVendor) {
        const isDirect =
          !!requestingVendor.addedByBuyerCompany && requestingVendor.addedByBuyerCompany === rfq.buyerAccountName;
        if (!isDirect) {
          const plan = requestingVendor.subscriptionPlan || 'premium';
          const used = requestingVendor.rfqDownloadsUsed || 0;
          const quota = plan === 'connect' ? 50 : plan === 'select' ? 100 : 0;
          if (quota === 0) {
            logger.warn(
              `Rejected marketplace RFQ download: vendor ${requestingVendor.email} has no marketplace access (plan: ${plan})`,
              { id, vendorEmail: requestingVendor.email },
              'RFQ_CONTROLLER'
            );
            return res.status(403).json({
              success: false,
              error: 'Marketplace RFQs outside your client roster require a Connect or Select subscription.',
            });
          }
          if (used >= quota) {
            logger.warn(
              `Rejected marketplace RFQ download: vendor ${requestingVendor.email} reached their ${plan} quota (${used}/${quota})`,
              { id, vendorEmail: requestingVendor.email },
              'RFQ_CONTROLLER'
            );
            return res.status(403).json({
              success: false,
              error: `You have reached your ${quota}-RFQ download quota for this period.`,
            });
          }
          storeService.updateVendor(requestingVendor.id, { rfqDownloadsUsed: used + 1 });
        }
      }
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
  getAllRFQs,
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

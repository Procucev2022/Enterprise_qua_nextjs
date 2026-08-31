const storeService = require('../services/storeService');
const { generateStandardRFQEmail } = require('../services/emailService');
const { logger } = require('../services/loggerService');

function getRFQs(req, res, next) {
  try {
    logger.info('Fetching all RFQs list', { query: req.query }, 'RFQ_CONTROLLER');
    const rfqs = storeService.getRFQs();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'postgresql' : 'in_memory', data: rfqs });
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
    const body = req.body;
    if (!body.title) {
      logger.warn('Failed to create RFQ: Missing title', { body }, 'RFQ_CONTROLLER');
      return res.status(400).json({ success: false, error: 'RFQ title is required.' });
    }
    logger.info(`Creating new RFQ: ${body.title}`, { title: body.title, category: body.category, budget: body.budget }, 'RFQ_CONTROLLER');
    const created = storeService.createRFQ(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating RFQ', err, 'RFQ_CONTROLLER');
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
  createRFQ,
  updateRFQ,
  addQuote,
  generateEmailPreview,
  triggerBatchChaser,
  approvePO,
};

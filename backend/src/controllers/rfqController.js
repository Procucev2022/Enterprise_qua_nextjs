const storeService = require('../services/storeService');
const { generateStandardRFQEmail } = require('../services/emailService');

function getRFQs(req, res, next) {
  try {
    const rfqs = storeService.getRFQs();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'postgresql' : 'in_memory', data: rfqs });
  } catch (err) {
    next(err);
  }
}

function getRFQById(req, res, next) {
  try {
    const { id } = req.params;
    const rfq = storeService.getRFQById(id);
    if (!rfq) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, data: rfq });
  } catch (err) {
    next(err);
  }
}

function createRFQ(req, res, next) {
  try {
    const body = req.body;
    if (!body.title) {
      return res.status(400).json({ success: false, error: 'RFQ title is required.' });
    }
    const created = storeService.createRFQ(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

function updateRFQ(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updated = storeService.updateRFQ(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

function addQuote(req, res, next) {
  try {
    const { id } = req.params;
    const quote = req.body;
    if (!quote.vendorName || !quote.unitPrice) {
      return res.status(400).json({ success: false, error: 'vendorName and unitPrice are required.' });
    }
    const updatedRFQ = storeService.addQuoteToRFQ(id, quote);
    if (!updatedRFQ) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, data: updatedRFQ });
  } catch (err) {
    next(err);
  }
}

function generateEmailPreview(req, res, next) {
  try {
    const { id } = req.params;
    const { vendorId } = req.query;
    const rfq = storeService.getRFQById(id);
    if (!rfq) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    const vendor = vendorId ? storeService.getVendorById(vendorId) : null;
    const emailPayload = generateStandardRFQEmail(rfq, vendor);
    res.json({ success: true, data: emailPayload });
  } catch (err) {
    next(err);
  }
}

function triggerBatchChaser(req, res, next) {
  try {
    const { id } = req.params;
    const { channels } = req.body;
    const result = storeService.triggerBatchChaser(id, channels || ['call', 'whatsapp', 'sms']);
    if (!result) {
      return res.status(404).json({ success: false, error: `RFQ with ID ${id} not found.` });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

function approvePO(req, res, next) {
  try {
    const { id } = req.params;
    const { vendorName, totalAmount, approverNotes } = req.body;
    if (!vendorName || !totalAmount) {
      return res.status(400).json({ success: false, error: 'vendorName and totalAmount are required.' });
    }
    const result = storeService.approvePurchaseOrder(id, vendorName, totalAmount, approverNotes);
    res.json(result);
  } catch (err) {
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

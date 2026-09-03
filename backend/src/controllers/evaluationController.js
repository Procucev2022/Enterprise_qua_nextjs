const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

function getEvaluations(req, res, next) {
  try {
    logger.info('Fetching vendor evaluations list', { query: req.query }, 'EVALUATION_CONTROLLER');
    const evals = storeService.getEvaluations();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory', data: evals });
  } catch (err) {
    logger.error('Error fetching vendor evaluations', err, 'EVALUATION_CONTROLLER');
    next(err);
  }
}

function createEvaluation(req, res, next) {
  try {
    // A qualification evaluation is a vendor's own self-assessment. Only a
    // vendor may submit one — previously any authenticated role, with any
    // client-supplied vendorId/vendorName, could POST a fabricated
    // "PREFERRED ENTERPRISE SUPPLIER" evaluation attributed to any vendor.
    if (req.user.role !== 'vendor') {
      logger.warn('Rejected evaluation submission from a non-vendor role', { role: req.user.role }, 'EVALUATION_CONTROLLER');
      return res.status(403).json({ success: false, error: 'Only a vendor can submit a qualification evaluation.' });
    }

    const body = req.body || {};

    // Mirrors qualification-form.tsx's own pre-submit gate (every question
    // must carry attached evidence) — checked here too so it can't be
    // bypassed by calling the API directly instead of through the form.
    const documents = Array.isArray(body.documents) ? body.documents : [];
    if (documents.length === 0 || documents.some((doc) => !doc || !doc.name)) {
      logger.warn('Failed to create evaluation: missing evidence on one or more questions', { email: req.user.email }, 'EVALUATION_CONTROLLER');
      return res.status(400).json({ success: false, error: 'Every qualification question requires attached evidence.' });
    }

    // Identity is resolved from the caller's own vendor record (or the
    // session, if they have no profile yet — mirrors the frontend's own
    // fallback chain) rather than trusted from the body, so a vendor can
    // never submit an evaluation attributed to a different vendor.
    const vendorRecord = storeService.getVendorById(req.user.email);
    const identity = {
      vendorId: vendorRecord ? vendorRecord.id : undefined,
      vendorName: vendorRecord ? vendorRecord.name : (req.user.orgName || req.user.name || 'Vendor'),
      contactPerson: vendorRecord ? vendorRecord.contactPerson : (req.user.name || ''),
      email: req.user.email,
      phone: vendorRecord ? vendorRecord.phone : '',
      category: vendorRecord ? vendorRecord.majorCategory : (body.category || 'Uncategorized'),
    };

    logger.info(`Creating vendor evaluation for: ${identity.vendorName}`, { vendorName: identity.vendorName }, 'EVALUATION_CONTROLLER');
    const created = storeService.createEvaluation({ ...body, ...identity });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating vendor evaluation', err, 'EVALUATION_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getEvaluations,
  createEvaluation,
};

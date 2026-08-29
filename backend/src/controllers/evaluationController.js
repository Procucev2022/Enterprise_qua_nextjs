const storeService = require('../services/storeService');

function getEvaluations(req, res, next) {
  try {
    const evals = storeService.getEvaluations();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'postgresql' : 'in_memory', data: evals });
  } catch (err) {
    next(err);
  }
}

function createEvaluation(req, res, next) {
  try {
    const body = req.body;
    if (!body.vendorName) {
      return res.status(400).json({ success: false, error: 'vendorName is required.' });
    }
    const created = storeService.createEvaluation(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getEvaluations,
  createEvaluation,
};

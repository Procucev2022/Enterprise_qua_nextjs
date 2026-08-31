const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

function getEvaluations(req, res, next) {
  try {
    logger.info('Fetching vendor evaluations list', { query: req.query }, 'EVALUATION_CONTROLLER');
    const evals = storeService.getEvaluations();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'postgresql' : 'in_memory', data: evals });
  } catch (err) {
    logger.error('Error fetching vendor evaluations', err, 'EVALUATION_CONTROLLER');
    next(err);
  }
}

function createEvaluation(req, res, next) {
  try {
    const body = req.body;
    if (!body.vendorName) {
      logger.warn('Failed to create evaluation: Missing vendorName', { body }, 'EVALUATION_CONTROLLER');
      return res.status(400).json({ success: false, error: 'vendorName is required.' });
    }
    logger.info(`Creating vendor evaluation for: ${body.vendorName}`, { vendorName: body.vendorName, scores: body }, 'EVALUATION_CONTROLLER');
    const created = storeService.createEvaluation(body);
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

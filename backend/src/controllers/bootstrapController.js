const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

async function getBootstrap(req, res, next) {
  try {
    logger.info('Fetching application bootstrap data payload', {}, 'BOOTSTRAP_CONTROLLER');
    const data = storeService.getBootstrapData();
    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'postgresql' : 'in_memory',
      data,
    });
  } catch (err) {
    logger.error('Error fetching bootstrap data', err, 'BOOTSTRAP_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getBootstrap,
};

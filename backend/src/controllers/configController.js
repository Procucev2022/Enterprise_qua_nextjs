const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

function getSystemConfig(req, res, next) {
  try {
    logger.info('Fetching system infrastructure configuration & health', {}, 'CONFIG_CONTROLLER');
    const config = storeService.getSystemConfig();
    const azureHealth = storeService.getAzureHealth();
    res.json({ success: true, data: { systemConfig: config, azureHealth } });
  } catch (err) {
    logger.error('Error fetching system config', err, 'CONFIG_CONTROLLER');
    next(err);
  }
}

function updateSystemConfig(req, res, next) {
  try {
    const updates = req.body;
    logger.info('Updating system infrastructure configuration', { updates }, 'CONFIG_CONTROLLER');
    const updated = storeService.updateSystemConfig(updates);
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('Error updating system config', err, 'CONFIG_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getSystemConfig,
  updateSystemConfig,
};

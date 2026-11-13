const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { SYSTEM_CONFIG_MESSAGES } = require('../config/constants');

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

// No setting is stored or read by the backend, so an update cannot be saved. The
// request is refused with 501 instead of being acknowledged, so the caller never
// believes a change took effect.
function updateSystemConfig(req, res, next) {
  try {
    const submittedKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
    logger.warn('Refused a system configuration update: no setting is persisted', { submittedKeys }, 'CONFIG_CONTROLLER');
    res.status(501).json({ success: false, error: SYSTEM_CONFIG_MESSAGES.READ_ONLY });
  } catch (err) {
    logger.error('Error handling system config update', err, 'CONFIG_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getSystemConfig,
  updateSystemConfig,
};

const storeService = require('../services/storeService');

function getSystemConfig(req, res, next) {
  try {
    const config = storeService.getSystemConfig();
    const azureHealth = storeService.getAzureHealth();
    res.json({ success: true, data: { systemConfig: config, azureHealth } });
  } catch (err) {
    next(err);
  }
}

function updateSystemConfig(req, res, next) {
  try {
    const updates = req.body;
    const updated = storeService.updateSystemConfig(updates);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSystemConfig,
  updateSystemConfig,
};

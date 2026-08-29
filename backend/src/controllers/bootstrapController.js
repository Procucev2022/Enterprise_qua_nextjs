const storeService = require('../services/storeService');

async function getBootstrap(req, res, next) {
  try {
    const data = storeService.getBootstrapData();
    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'postgresql' : 'in_memory',
      data,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getBootstrap,
};

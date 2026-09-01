// ==============================================================================
// DATABASE STATUS CONTROLLER
// ==============================================================================
// Reports on the shared MySQL identity database that backs authentication.
// This backend has no PostgreSQL connection: domain records are served from the
// in-memory enterprise store, and user accounts live in the identity schema
// owned by the Procucev p2pservices application.
// ==============================================================================

const identityPoolModule = require('../db/identityPool');
// Referenced through the module object rather than destructured so the helper
// stays observable to tests.
const optimizationMetrics = require('../db/optimizationMetrics');
const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

/**
 * GET /api/db/status - identity database reachability + domain store mode.
 */
async function getDBStatus(req, res, next) {
  try {
    logger.info('Checking identity database connection status', {}, 'DB_CONTROLLER');
    const health = await identityPoolModule.checkIdentityHealth();
    res.json({
      success: true,
      ...health,
      domainStore: {
        mode: storeService.isHydratedFromDB ? 'persisted' : 'in_memory_seed',
        buyerAccounts: storeService.getBuyerAccounts().length,
        vendors: storeService.getVendors().length,
        rfqs: storeService.getRFQs().length,
      },
    });
  } catch (err) {
    logger.error('Error checking identity database status', err, 'DB_CONTROLLER');
    next(err);
  }
}

/**
 * GET /api/db/metrics - query cache and audit efficiency report.
 */
async function getDBMetrics(req, res, next) {
  try {
    res.json({ success: true, ...optimizationMetrics.getOptimizationMetrics() });
  } catch (err) {
    logger.error('Error building optimization metrics', err, 'DB_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getDBStatus,
  getDBMetrics,
};

// ==============================================================================
// DATABASE STATUS CONTROLLER
// ==============================================================================
// Reports on the shared MySQL identity database that backs authentication, plus
// the Neon PostgreSQL connection that persists vendors + RFQs (when
// DATABASE_URL is configured — otherwise those fall back to the in-memory
// seed too). Every other domain record (evaluations, audit logs, buyer
// accounts, catalogue) is served from the in-memory enterprise store.
// ==============================================================================

const identityPoolModule = require('../db/identityPool');
// Referenced through the module object rather than destructured so the helper
// stays observable to tests.
const optimizationMetrics = require('../db/optimizationMetrics');
const domainPool = require('../db/pool');
const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

/**
 * GET /api/db/status - identity database reachability + domain store mode.
 */
async function getDBStatus(req, res, next) {
  try {
    logger.info('Checking identity database connection status', {}, 'DB_CONTROLLER');
    const [health, domainDatabase] = await Promise.all([
      identityPoolModule.checkIdentityHealth(),
      domainPool.checkDomainDBHealth(),
    ]);
    res.json({
      success: true,
      ...health,
      domainDatabase,
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

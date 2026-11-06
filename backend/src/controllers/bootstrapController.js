const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { isRetryableD1Error } = require('../db/d1Bridge');

async function getBootstrap(req, res, next) {
  try {
    logger.info('Fetching application bootstrap data payload', {}, 'BOOTSTRAP_CONTROLLER');
    const user = req.user;
    let buyerId = null;
    const candidateBuyerIds = [];
    if (user && user.role === 'buyer') {
      let buyerAccount = null;
      try {
        buyerAccount = await storeService.ensureBuyerAccountForUser(user);
      } catch (err) {
        logger.warn('Failed to ensure buyer account during bootstrap (degraded fallback)', { error: err.message }, 'BOOTSTRAP_CONTROLLER');
      }
      if (buyerAccount) {
        if (buyerAccount.id) candidateBuyerIds.push(buyerAccount.id);
        if (buyerAccount.corporateEmail) candidateBuyerIds.push(buyerAccount.corporateEmail);
        if (buyerAccount.organizationId) candidateBuyerIds.push(buyerAccount.organizationId);
      }
      if (user.sub) candidateBuyerIds.push(user.sub);
      if (user.id) candidateBuyerIds.push(user.id);
      if (user.email) candidateBuyerIds.push(user.email);
      if (user.orgId) candidateBuyerIds.push(user.orgId);
      buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    } else if (req.query && req.query.buyerId) {
      buyerId = req.query.buyerId;
      candidateBuyerIds.push(buyerId);
    }
    if (req.query && req.query.refresh === 'true') {
      await storeService.hydrateFromDB().catch((err) => {
        logger.warn('Bootstrap forced refresh hydration failed; continuing with current store', { error: err.message }, 'BOOTSTRAP_CONTROLLER');
      });
    }
    const scopedBuyerArg = candidateBuyerIds.length > 0 ? candidateBuyerIds : buyerId;
    let data;
    try {
      data = await storeService.getBootstrapData(scopedBuyerArg, user && user.email);
    } catch (err) {
      if (isRetryableD1Error(err)) {
        logger.warn('D1 overloaded during bootstrap; serving in-memory degraded bootstrap payload', { error: err.message }, 'BOOTSTRAP_CONTROLLER');
        data = {
          buyerAccounts: (storeService.buyerAccounts || []).slice(0, 500),
          activeBuyerAccount: storeService.activeBuyerAccount,
          vendors: (storeService.vendors || []).slice(0, 500),
          vendorsTotal: (storeService.vendors || []).length,
          evaluations: (storeService.evaluations || []).slice(0, 50),
          auditLogs: (storeService.auditLogs || []).slice(0, 50),
          aiFeed: [],
          systemConfig: storeService.systemConfig,
          azureHealth: storeService.azureHealth,
          vendorCatalogue: [],
        };
      } else {
        throw err;
      }
    }
    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory',
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

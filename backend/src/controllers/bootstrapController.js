const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

async function getBootstrap(req, res, next) {
  try {
    logger.info('Fetching application bootstrap data payload', {}, 'BOOTSTRAP_CONTROLLER');
    const user = req.user;
    let buyerId = null;
    const candidateBuyerIds = [];
    if (user && user.role === 'buyer') {
      const buyerAccount = await storeService.ensureBuyerAccountForUser(user);
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
      await storeService.hydrateFromDB();
    }
    const scopedBuyerArg = candidateBuyerIds.length > 0 ? candidateBuyerIds : buyerId;
    const data = await storeService.getBootstrapData(scopedBuyerArg, user && user.email);
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

const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { sanitizePublicVendor } = require('./vendorController');

async function getBootstrap(req, res, next) {
  try {
    logger.info('Fetching application bootstrap data payload', {}, 'BOOTSTRAP_CONTROLLER');
    const user = req.user;
    let buyerId = null;
    let resolvedBuyerAccount = null;
    const candidateBuyerIds = [];
    if (user && user.role === 'buyer') {
      resolvedBuyerAccount = await storeService.ensureBuyerAccountForUser(user);
      if (resolvedBuyerAccount) {
        if (resolvedBuyerAccount.id) candidateBuyerIds.push(resolvedBuyerAccount.id);
        if (resolvedBuyerAccount.corporateEmail) candidateBuyerIds.push(resolvedBuyerAccount.corporateEmail);
        if (resolvedBuyerAccount.organizationId) candidateBuyerIds.push(resolvedBuyerAccount.organizationId);
      }
      if (user.sub) candidateBuyerIds.push(user.sub);
      if (user.id) candidateBuyerIds.push(user.id);
      if (user.email) candidateBuyerIds.push(user.email);
      if (user.orgId) candidateBuyerIds.push(user.orgId);
      buyerId = resolvedBuyerAccount ? resolvedBuyerAccount.id : user.sub || user.email;
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
    const data = await storeService.getBootstrapData(scopedBuyerArg, user && user.email);
    const isManagementUser = Boolean(user && (user.role === 'admin' || user.role === 'category_manager'));
    const isBuyer = Boolean(user && user.role === 'buyer');
    const sessionEmail = user && String(user.email || '').toLowerCase();
    const evaluations = Array.isArray(data.evaluations) ? data.evaluations : [];
    const vendorEvaluations = user && user.role === 'vendor' && sessionEmail
      ? evaluations.filter((evaluation) => String(evaluation.email || '').toLowerCase() === sessionEmail)
      : [];
    const buyerIdentityValues = [buyerId, ...candidateBuyerIds]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    const vendors = (data.vendors || []).map((vendor) => {
      const isOwnVendor = sessionEmail && String(vendor.email || '').toLowerCase() === sessionEmail;
      const vendorOwnerValues = [vendor.buyerId, vendor.buyerAccountId, vendor.buyerEmail]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      const isBuyerOwnedVendor = isBuyer && vendorOwnerValues.some((value) => buyerIdentityValues.includes(value));
      return isManagementUser || isOwnVendor || isBuyerOwnedVendor ? vendor : sanitizePublicVendor(vendor);
    }).filter(Boolean);
    const scopedData = {
      ...data,
      buyerAccounts: isManagementUser ? data.buyerAccounts : (isBuyer && resolvedBuyerAccount ? [resolvedBuyerAccount] : []),
      activeBuyerAccount: isManagementUser ? data.activeBuyerAccount : (isBuyer ? resolvedBuyerAccount : null),
      vendors,
      evaluations: isManagementUser || isBuyer ? evaluations : vendorEvaluations,
      auditLogs: isManagementUser ? data.auditLogs : [],
      systemConfig: isManagementUser ? data.systemConfig : null,
      azureHealth: isManagementUser ? data.azureHealth : [],
    };
    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory',
      data: scopedData,
    });
  } catch (err) {
    logger.error('Error fetching bootstrap data', err, 'BOOTSTRAP_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getBootstrap,
};

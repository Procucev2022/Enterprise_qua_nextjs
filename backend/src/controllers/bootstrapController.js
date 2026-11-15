const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { sanitizePublicVendor } = require('./vendorController');
const { isRetryableD1Error } = require('../db/d1Bridge');
const { buyerScopeIdsFor } = require('../services/buyerVendorScope');

async function getBootstrap(req, res, next) {
  try {
    logger.info('Fetching application bootstrap data payload', {}, 'BOOTSTRAP_CONTROLLER');
    const user = req.user;
    let buyerId = null;
    let resolvedBuyerAccount = null;
    const candidateBuyerIds = [];

    if (user && user.role === 'buyer') {
      try {
        resolvedBuyerAccount = await storeService.ensureBuyerAccountForUser(user);
      } catch (error) {
        logger.warn('Buyer account resolution failed during bootstrap; continuing with available identity claims', {
          error,
          userId: user.sub || user.id || null,
        }, 'BOOTSTRAP_CONTROLLER');
      }
      candidateBuyerIds.push(...buyerScopeIdsFor(user, resolvedBuyerAccount));
      buyerId = resolvedBuyerAccount ? resolvedBuyerAccount.id : user.sub || user.email;
    } else if (req.query && req.query.buyerId) {
      buyerId = req.query.buyerId;
      candidateBuyerIds.push(buyerId);
    }

    if (req.query && req.query.refresh === 'true') {
      await storeService.hydrateFromDB().catch((error) => {
        logger.warn('Bootstrap forced refresh hydration failed; continuing with current store', { error }, 'BOOTSTRAP_CONTROLLER');
      });
    }

    const scopedBuyerArg = candidateBuyerIds.length > 0 ? candidateBuyerIds : buyerId;
    let data;
    try {
      data = await storeService.getBootstrapData(scopedBuyerArg, user && user.email);
    } catch (error) {
      if (!isRetryableD1Error(error)) throw error;
      logger.warn('D1 unavailable during bootstrap; serving a capped in-memory fallback payload', {
        error,
        buyerId,
      }, 'BOOTSTRAP_CONTROLLER');
      data = {
        buyerAccounts: (storeService.buyerAccounts || []).slice(0, 500),
        activeBuyerAccount: storeService.activeBuyerAccount,
        vendors: (storeService.vendors || []).slice(0, 500),
        vendorsTotal: (storeService.vendors || []).length,
        evaluations: (storeService.evaluations || []).slice(0, 50),
        auditLogs: (storeService.auditLogs || []).slice(0, 50),
        aiFeed: [],
        systemConfig: storeService.getSystemConfig(),
        azureHealth: storeService.getAzureHealth(),
        vendorCatalogue: [],
      };
    }

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
    const buyerOwnedVendors = (data.vendors || []).filter((vendor) => {
      const vendorOwnerValues = [vendor.buyerId, vendor.buyerAccountId, vendor.buyerEmail]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      return vendorOwnerValues.some((value) => buyerIdentityValues.includes(value));
    });
    const buyerOwnedVendorIdSet = new Set(buyerOwnedVendors.map((v) => v.id).filter(Boolean));
    const buyerOwnedVendorEmailSet = new Set(
      buyerOwnedVendors.map((v) => String(v.email || '').toLowerCase()).filter(Boolean)
    );

    const buyerEvaluations = isBuyer
      ? evaluations.filter((evaluation) => {
          const evalBuyerValues = [evaluation.buyerId, evaluation.buyerAccountId]
            .filter(Boolean)
            .map((val) => String(val).toLowerCase());
          if (evalBuyerValues.some((val) => buyerIdentityValues.includes(val))) return true;

          if (buyerOwnedVendors.length > 0) {
            return (
              buyerOwnedVendorIdSet.has(evaluation.vendorId) ||
              (evaluation.email && buyerOwnedVendorEmailSet.has(String(evaluation.email).toLowerCase()))
            );
          }
          return true;
        })
      : [];

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
      evaluations: isManagementUser ? evaluations : (isBuyer ? buyerEvaluations : vendorEvaluations),
      auditLogs: isManagementUser ? data.auditLogs : [],
      systemConfig: isManagementUser ? data.systemConfig : null,
      azureHealth: isManagementUser ? data.azureHealth : [],
    };

    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory',
      data: scopedData,
    });
  } catch (error) {
    logger.error('Error fetching bootstrap data', error, 'BOOTSTRAP_CONTROLLER');
    next(error);
  }
}

module.exports = {
  getBootstrap,
};

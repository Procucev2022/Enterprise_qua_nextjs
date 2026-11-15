const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { sanitizePublicVendor } = require('./vendorController');
const { isRetryableD1Error } = require('../db/d1Bridge');
const { buyerScopeIdsFor } = require('../services/buyerVendorScope');
const vendorIngestionQueries = require('../db/vendorIngestionQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');

/**
 * Load vendor_master_records from the buyer's latest ingestion session when those uploaded
 * suppliers have not yet been promoted into the main `vendors` table (e.g. buyer completed
 * Step 2 vendor upload before running PO categorization / Step 4).
 */
async function loadBuyerMasterFallbackVendors({ user, resolvedBuyerAccount, buyerId, existingVendors }) {
  try {
    let orgId = resolvedBuyerAccount?.organizationId || user.orgId || user.organizationId || null;
    if (!orgId && (user.sub || user.id)) {
      const profileLookup = await buyerProfileQueries.findProfileByUserId(user.sub || user.id);
      if (profileLookup?.found && profileLookup.profile?.organizationId) {
        orgId = profileLookup.profile.organizationId;
      }
    }
    if (!orgId) return [];

    const session = await vendorIngestionQueries.findLatestSession(orgId);
    if (!session || !session.id) return [];

    const masterRecords = await vendorIngestionQueries.findVendorMasterRecords(session.id, orgId, 500);
    if (!Array.isArray(masterRecords) || masterRecords.length === 0) return [];

    const seenEmails = new Set(
      existingVendors.map((v) => String(v.email || '').trim().toLowerCase()).filter(Boolean)
    );
    const seenCodes = new Set(
      existingVendors.map((v) => String(v.vendorCode || '').trim().toLowerCase()).filter(Boolean)
    );

    const fallbackVendors = [];
    for (const rec of masterRecords) {
      const normalizedEmail = String(rec.email || '').trim().toLowerCase();
      const normalizedCode = String(rec.vendorCode || '').trim().toLowerCase();
      if (!rec.companyName && !normalizedEmail) continue;
      if ((normalizedEmail && seenEmails.has(normalizedEmail)) || (normalizedCode && seenCodes.has(normalizedCode))) {
        continue;
      }
      if (normalizedEmail) seenEmails.add(normalizedEmail);
      if (normalizedCode) seenCodes.add(normalizedCode);

      const parsedRating = Number(rec.rating);
      fallbackVendors.push({
        id: `v-master-${rec.id}`,
        vendorCode: rec.vendorCode || null,
        name: rec.companyName || normalizedEmail,
        email: rec.email || null,
        contactPerson: rec.contactPerson || null,
        phone: rec.phone || null,
        location: rec.address || null,
        gstin: rec.gstin || null,
        majorCategory: 'Vendor Master',
        minorCategories: [],
        clientMappedCategories: [],
        vendorSelectedCategories: [],
        rating:
          rec.rating !== null && rec.rating !== undefined && rec.rating !== '' && Number.isFinite(parsedRating)
            ? parsedRating
            : null,
        score: null,
        evaluated: false,
        hasRecord: true,
        isExistingInDatabase: true,
        status: 'PENDING EVALUATION',
        source: 'vendor_master_ingestion',
        buyerId: buyerId || orgId,
        buyerAccountId: buyerId || orgId,
        buyerEmail: user.email || null,
        addedByBuyerCompany: resolvedBuyerAccount?.organizationName || user.orgName || null,
      });
    }
    return fallbackVendors;
  } catch (error) {
    logger.warn('Failed to load vendor_master_records fallback during bootstrap', {
      error,
      userId: user?.sub || user?.id || null,
    }, 'BOOTSTRAP_CONTROLLER');
    return [];
  }
}

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
    const existingVendors = Array.isArray(data.vendors) ? data.vendors : [];
    const fallbackMasterVendors = isBuyer
      ? await loadBuyerMasterFallbackVendors({
          user,
          resolvedBuyerAccount,
          buyerId,
          existingVendors,
        })
      : [];
    const rawVendors = fallbackMasterVendors.length > 0
      ? [...existingVendors, ...fallbackMasterVendors]
      : existingVendors;
    const evaluations = Array.isArray(data.evaluations) ? data.evaluations : [];
    const vendorEvaluations = user && user.role === 'vendor' && sessionEmail
      ? evaluations.filter((evaluation) => String(evaluation.email || '').toLowerCase() === sessionEmail)
      : [];
    const buyerIdentityValues = [buyerId, ...candidateBuyerIds]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    const buyerOwnedVendors = rawVendors.filter((vendor) => {
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

    const vendors = rawVendors.map((vendor) => {
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
      ...(fallbackMasterVendors.length > 0
        ? { vendorsTotal: (data.vendorsTotal || existingVendors.length) + fallbackMasterVendors.length }
        : {}),
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

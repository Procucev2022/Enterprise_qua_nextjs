const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');
const { sanitizePublicVendor } = require('./vendorController');
const { isRetryableD1Error } = require('../db/d1Bridge');
const { buyerScopeIdsFor } = require('../services/buyerVendorScope');
const vendorIngestionQueries = require('../db/vendorIngestionQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const {
  resolveVendorLocationFields,
  isPlaceholderVendorCategory,
  normalizeVendorCategoryList,
} = require('../config/constants');
const categoryTaxonomyMaster = require('../config/categoryTaxonomyMaster.json');

const categoryTaxonomyMap = new Map();
for (const entry of categoryTaxonomyMaster) {
  const mKey = String(entry.majorCategory || '').trim().toLowerCase();
  const minors = new Map();
  for (const m of entry.minorCategories || []) {
    minors.set(String(m).trim().toLowerCase(), m);
  }
  categoryTaxonomyMap.set(mKey, { major: entry.majorCategory, minors });
}

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
    if (session && (session.status === 'DRAFT' || session.status === 'VENDOR_MASTER_STORED')) {
      return [];
    }
    const orgRecords =
      typeof vendorIngestionQueries.findOrganizationVendorMasterRecords === 'function'
        ? await vendorIngestionQueries.findOrganizationVendorMasterRecords(orgId, 500)
        : [];
    let masterRecords = Array.isArray(orgRecords) && orgRecords.length > 0 ? orgRecords : [];
    if (masterRecords.length === 0) {
      if (!session || !session.id) return [];
      masterRecords = await vendorIngestionQueries.findVendorMasterRecords(session.id, orgId, 500);
    }
    if (!Array.isArray(masterRecords) || masterRecords.length === 0) return [];

    const activeSessionId = (session && session.id) || masterRecords[0]?.sessionId || null;
    const categoryMappings =
      activeSessionId && typeof vendorIngestionQueries.findCategoryMappings === 'function'
        ? await vendorIngestionQueries.findCategoryMappings(activeSessionId, orgId).catch(() => [])
        : [];
    const mappingByRecordId = new Map(
      (Array.isArray(categoryMappings) ? categoryMappings : [])
        .filter((m) => m && m.vendorRecordId)
        .map((m) => [m.vendorRecordId, m])
    );

    const existingByMasterId = new Map();
    const existingByEmail = new Map();
    const existingByCode = new Map();
    for (const v of existingVendors) {
      const eMid = String(v.masterRecordId || '').trim().toLowerCase();
      const eMail = String(v.email || '').trim().toLowerCase();
      const eCode = String(v.vendorCode || '').trim().toLowerCase();
      if (eMid) existingByMasterId.set(eMid, v);
      if (eMail) existingByEmail.set(eMail, v);
      if (eCode) existingByCode.set(eCode, v);
    }

    const fallbackVendors = [];
    for (const rec of masterRecords) {
      const normalizedMasterId = String(rec.id || '').trim().toLowerCase();
      const normalizedEmail = String(rec.email || '').trim().toLowerCase();
      const normalizedCode = String(rec.vendorCode || '').trim().toLowerCase();
      if (!rec.companyName && !normalizedEmail) continue;

      const recGstin = String(rec.gstin || rec.gstNumber || rec.gst || '').trim().toUpperCase() || null;

      const matchedExisting =
        (normalizedMasterId && existingByMasterId.get(normalizedMasterId)) ||
        (normalizedEmail && existingByEmail.get(normalizedEmail)) ||
        (normalizedCode && existingByCode.get(normalizedCode));

      if (matchedExisting) {
        if (recGstin && (!matchedExisting.gstin || !matchedExisting.gst)) {
          matchedExisting.gstin = matchedExisting.gstin || recGstin;
          matchedExisting.gst = matchedExisting.gst || recGstin;
        }
        if (rec.vendorCode && !matchedExisting.vendorCode) {
          matchedExisting.vendorCode = rec.vendorCode;
        }
        continue;
      }

      const mapping = mappingByRecordId.get(rec.id);
      const isRejectedMapping =
        mapping?.status === 'SELF_MAP_REQUIRED' || mapping?.reviewAction === 'REJECTED';
      const rawMajorCandidates = [
        mapping?.buyerMajorCategory,
        !isRejectedMapping ? mapping?.aiSuggestion?.majorCategory : null,
        rec.majorCategory,
      ];
      const resolvedMajor =
        rawMajorCandidates.find((candidate) => typeof candidate === 'string' && !isPlaceholderVendorCategory(candidate)) || '';
      const rawMinors =
        Array.isArray(mapping?.buyerMinorCategories) && mapping.buyerMinorCategories.length > 0
          ? mapping.buyerMinorCategories
          : !isRejectedMapping && Array.isArray(mapping?.aiSuggestion?.minorCategories) && mapping.aiSuggestion.minorCategories.length > 0
            ? mapping.aiSuggestion.minorCategories
            : rec.minorCategories;
      let resolvedMinors = normalizeVendorCategoryList(rawMinors);
      if (resolvedMinors.length === 0 && resolvedMajor) {
        const majorEntry = categoryTaxonomyMap.get(resolvedMajor.trim().toLowerCase());
        if (majorEntry) {
          const candidates = [
            ...(Array.isArray(mapping?.aiSuggestion?.relevantProducts) ? mapping.aiSuggestion.relevantProducts : []),
            ...(Array.isArray(rec.itemsSupplied) ? rec.itemsSupplied : []),
          ];
          for (const cand of candidates) {
            const candKey = String(cand || '').trim().toLowerCase();
            if (!candKey) continue;
            for (const [mKey, actualName] of majorEntry.minors.entries()) {
              if (candKey.includes(mKey) || mKey.includes(candKey)) {
                if (!resolvedMinors.includes(actualName)) resolvedMinors.push(actualName);
              }
            }
          }
        }
      }

      const parsedRating = Number(rec.rating);
      const loc = resolveVendorLocationFields({
        address: rec.address,
        city: rec.city,
        state: rec.state,
        pincode: rec.pincode,
      });
      fallbackVendors.push({
        id: `v-master-${rec.id}`,
        vendorCode: rec.vendorCode || null,
        name: rec.companyName || normalizedEmail,
        email: rec.email || null,
        contactPerson: rec.contactPerson || null,
        phone: rec.phone || null,
        location: loc.location || null,
        city: loc.city || null,
        state: loc.state || null,
        pincode: loc.pincode || null,
        gstin: recGstin || null,
        gst: recGstin || null,
        majorCategory: resolvedMajor.trim(),
        minorCategories: resolvedMinors,
        clientMappedCategories: [...resolvedMinors],
        vendorSelectedCategories: [],
        rating:
          rec.rating !== null && rec.rating !== undefined && rec.rating !== '' && Number.isFinite(parsedRating)
            ? parsedRating
            : null,
        score: null,
        evaluated: false,
        hasRecord: true,
        isExistingInDatabase: true,
        status: rec.isActive === false
          ? 'INACTIVE'
          : (rec.evaluationRequested
              ? (rec.status || 'PENDING EVALUATION')
              : (rec.status && rec.status !== 'PENDING EVALUATION' ? rec.status : 'REGISTERED / NOT EVALUATED')),
        ...(rec.isActive === false
          ? {
              isActive: false,
              disabled: true,
              ...(rec.previousStatus ? { previousStatus: rec.previousStatus } : {}),
              ...(rec.disabledAt ? { disabledAt: rec.disabledAt } : {}),
              ...(rec.disabledBy ? { disabledBy: rec.disabledBy } : {}),
            }
          : rec.isActive === true
            ? { isActive: true, disabled: false }
            : {}),
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
    const buyerIdentityValues = [
      buyerId,
      ...candidateBuyerIds,
      resolvedBuyerAccount?.organizationId,
      resolvedBuyerAccount?.organizationName,
      user?.orgId,
      user?.organizationId,
      user?.orgName,
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());
    const buyerOwnedVendors = rawVendors.filter((vendor) => {
      const vendorOwnerValues = [
        vendor.buyerId,
        vendor.buyerAccountId,
        vendor.buyerEmail,
        vendor.addedByBuyerCompany,
        vendor.organizationId,
        vendor.orgId,
      ]
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
          if (evalBuyerValues.length > 0) return false;

          if (buyerOwnedVendors.length > 0) {
            return (
              buyerOwnedVendorIdSet.has(evaluation.vendorId) ||
              (evaluation.email && buyerOwnedVendorEmailSet.has(String(evaluation.email).toLowerCase()))
            );
          }
          return false;
        })
      : [];

    const vendors = rawVendors.map((vendor) => {
      const isOwnVendor = sessionEmail && String(vendor.email || '').toLowerCase() === sessionEmail;
      const vendorOwnerValues = [
        vendor.buyerId,
        vendor.buyerAccountId,
        vendor.buyerEmail,
        vendor.addedByBuyerCompany,
        vendor.organizationId,
        vendor.orgId,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      const isBuyerOwnedVendor =
        isBuyer &&
        (vendorOwnerValues.some((value) => buyerIdentityValues.includes(value)) ||
          (vendor.source && ['buyer_uploaded', 'vendor_master_ingestion', 'buyer_manual'].includes(vendor.source)) ||
          vendor.isBuyerEmpanelled === true);
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

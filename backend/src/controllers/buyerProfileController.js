const buyerProfileService = require('../services/buyerProfileService');
const { logger } = require('../services/loggerService');
const { BUYER_PROFILE_MESSAGES, DEFAULT_CATEGORY_TAXONOMY } = require('../config/constants');

const LOG_CATEGORY = 'BUYER_PROFILE_CONTROLLER';

function getClientIp(req) {
  return req.ip || (req.headers && req.headers['x-forwarded-for']) || null;
}

/** A stored count or amount as a number, or null when nothing is on record. */
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Translate a service failure into a response.
 *
 * A BuyerProfileError already knows the status and carries copy written for the
 * buyer, so it is returned as-is together with any per-field detail the form can
 * attach to the offending input. Anything else is an unexpected fault and goes to
 * the shared error handler, which logs it and answers 500 without leaking
 * internals.
 */
function respondWithError(err, res, next, fallbackMessage) {
  if (err && err.name === 'BuyerProfileError') {
    logger.warn(
      `Buyer profile request rejected: ${err.message}`,
      { status: err.status, details: err.details },
      LOG_CATEGORY
    );
    return res.status(err.status).json({
      success: false,
      error: err.message,
      ...(err.details ? { fieldErrors: err.details } : {}),
    });
  }
  logger.error(fallbackMessage, err, LOG_CATEGORY);
  return next(err);
}

/**
 * GET /api/buyer-profile/me
 * The signed-in buyer's own organisation profile, including its procurement
 * category selection.
 */
async function getMyProfile(req, res, next) {
  try {
    // `req.user` is guaranteed: authenticate() rejects the request before this
    // handler runs if the session token is absent or invalid.
    logger.info('Buyer profile requested', { user: req.user.email }, LOG_CATEGORY);
    const profile = await buyerProfileService.getProfile(req.user);
    return res.json({ success: true, data: profile });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error reading buyer profile');
  }
}

/**
 * PUT /api/buyer-profile/me
 * Patch the signed-in buyer's own organisation profile. Omitted fields keep
 * their stored value; the response carries the re-read record so the client
 * renders exactly what was persisted.
 */
async function updateMyProfile(req, res, next) {
  try {
    // `req.body` is guaranteed to be an object: express.json() substitutes `{}`
    // for a request that carries no body at all.
    logger.info(
      'Buyer profile update requested',
      { user: req.user.email, fields: Object.keys(req.body) },
      LOG_CATEGORY
    );
    const result = await buyerProfileService.saveProfile(req.user, req.body, getClientIp(req));
    return res.json({
      success: true,
      message: BUYER_PROFILE_MESSAGES.PROFILE_SAVED,
      data: result.profile,
      categoryCount: result.categoryCount,
      fieldsUpdated: result.fieldsUpdated,
    });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error saving buyer profile');
  }
}

/**
 * GET /api/buyer-profile/categories
 * The shared major/minor procurement taxonomy the profile screen selects from.
 * Supports optional ?q= query param to search matching minor categories across 305+ categories.
 */
async function getCategoryTaxonomy(req, res, next) {
  try {
    let taxonomy = await buyerProfileService.getCategoryTaxonomy();
    if ((!taxonomy || taxonomy.length === 0) && Array.isArray(DEFAULT_CATEGORY_TAXONOMY) && DEFAULT_CATEGORY_TAXONOMY.length > 0) {
      taxonomy = DEFAULT_CATEGORY_TAXONOMY;
    }
    const q = req.query && typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : null;

    if (q !== null) {
      const allMinors = Array.from(
        new Set(
          (taxonomy || []).flatMap((t) => t.minorCategories || [])
        )
      ).filter(Boolean).sort((a, b) => a.localeCompare(b));

      const filteredMinors = q.length >= 3
        ? allMinors.filter((m) => m.toLowerCase().includes(q))
        : [];

      return res.json({
        success: true,
        count: taxonomy.length,
        totalMinors: allMinors.length,
        data: taxonomy,
        minorCategories: filteredMinors,
      });
    }

    if (req.query && (req.query.includeMinors === 'true' || req.query.format === 'flat')) {
      const allMinors = Array.from(
        new Set(
          (taxonomy || []).flatMap((t) => t.minorCategories || [])
        )
      ).filter(Boolean).sort((a, b) => a.localeCompare(b));

      return res.json({
        success: true,
        count: taxonomy.length,
        totalMinors: allMinors.length,
        data: taxonomy,
        minorCategories: allMinors,
      });
    }

    return res.json({ success: true, count: taxonomy.length, data: taxonomy });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error reading category taxonomy');
  }
}

/**
 * GET /api/buyer-profile/dispatch-templates
 * The signed-in buyer's custom vendor-onboarding email templates (Template A
 * / Template B). A missing type in the response means the default hardcoded
 * wording is in effect.
 */
async function getDispatchTemplates(req, res, next) {
  try {
    const templates = await buyerProfileService.getDispatchTemplates(req.user);
    return res.json({ success: true, data: templates });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error reading vendor dispatch templates');
  }
}

/**
 * PUT /api/buyer-profile/dispatch-templates/:templateType
 * Save (or, with both fields blank, clear) the custom subject/message for one
 * template type ('category_mapped' | 'self_map_required').
 */
async function updateDispatchTemplate(req, res, next) {
  try {
    const { templateType } = req.params;
    const { subject, message } = req.body || {};
    logger.info(
      'Vendor dispatch template update requested',
      { user: req.user.email, templateType },
      LOG_CATEGORY
    );
    const saved = await buyerProfileService.saveDispatchTemplate(req.user, templateType, { subject, message });
    return res.json({ success: true, data: saved });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error saving vendor dispatch template');
  }
}

/**
 * GET /api/buyer-profile/details
 * Retrieve complete buyer profile details by email, buyer name, or account ID.
 * Returns legal entity, contact, statutory/tax (GSTIN/PAN/CIN), and registered address info.
 */
async function getBuyerProfileDetails(req, res, next) {
  try {
    const storeService = require('../services/storeService');
    const buyerProfileQueries = require('../db/buyerProfileQueries');

    const query = req.validatedBuyerProfileDetailsQuery || req.query || {};
    const email = query.email ? String(query.email).trim() : null;
    const name = query.name ? String(query.name).trim() : null;
    const accountId = query.accountId ? String(query.accountId).trim() : null;

    logger.info('Buyer profile details requested', { email, name, accountId }, LOG_CATEGORY);

    if (!email && !name && !accountId) {
      return res.status(400).json({
        success: false,
        error: BUYER_PROFILE_MESSAGES.DETAILS_IDENTIFIER_REQUIRED,
      });
    }

    // 1. Check in-memory storeService first
    let account = null;
    if (email) {
      account = await storeService.getBuyerAccountByEmail(email);
    }
    if (!account && accountId) {
      account = storeService.getBuyerAccounts().find((a) => a.id === accountId);
    }
    if (!account && name) {
      account = storeService.getBuyerAccounts().find(
        (a) => (a.organizationName || '').trim().toLowerCase() === name.trim().toLowerCase()
      );
    }

    // 2. Query Postgres identity tables
    let dbProfile = null;
    let lookupFailure = null;
    try {
      const lookup = await buyerProfileQueries.findProfileByIdentifier({
        email: email || account?.corporateEmail,
        organizationName: name || account?.organizationName,
        organizationId: account?.organizationId,
        userId: accountId,
      });
      if (lookup && lookup.found) {
        dbProfile = lookup.profile;
      } else if (lookup && lookup.reason === 'DB_ERROR') {
        lookupFailure = lookup.error || BUYER_PROFILE_MESSAGES.DETAILS_LOAD_FAILED;
      }
    } catch (dbErr) {
      lookupFailure = dbErr.message || BUYER_PROFILE_MESSAGES.DETAILS_LOAD_FAILED;
    }

    if (lookupFailure) {
      logger.warn(
        'Buyer profile identity lookup failed',
        { error: lookupFailure, hasLocalAccount: Boolean(account) },
        LOG_CATEGORY
      );
      if (!account) {
        return res.status(503).json({
          success: false,
          error: BUYER_PROFILE_MESSAGES.DETAILS_LOAD_FAILED,
          retryable: true,
        });
      }
    }

    if (!dbProfile && !account) {
      logger.info('Buyer profile identity lookup found no matching record', { email, name, accountId }, LOG_CATEGORY);
      return res.status(404).json({
        success: false,
        error: BUYER_PROFILE_MESSAGES.DETAILS_NOT_FOUND,
      });
    }

    // Only stored values are returned. A field with nothing on record is an empty
    // string or null, never a placeholder company, person, plan, or amount.
    const merged = {
      organizationName: dbProfile?.companyName || account?.organizationName || name || '',
      brandName: dbProfile?.brandName || account?.brandName || '',
      organizationType: dbProfile?.organizationType || account?.organizationType || '',
      contactPerson: dbProfile?.contactName || account?.contactPerson || '',
      contactDesignation: dbProfile?.contactDesignation || account?.contactDesignation || '',
      corporateEmail: dbProfile?.contactEmail || account?.corporateEmail || email || '',
      mobileNumber: dbProfile?.contactPhone || account?.mobileNumber || account?.phone || '',
      gstin: dbProfile?.gstNumber || account?.gstin || '',
      panNumber: dbProfile?.panNumber || account?.panNumber || account?.pan || '',
      cinNumber: dbProfile?.cinNumber || account?.cinNumber || '',
      website: dbProfile?.website || account?.website || '',
      annualTurnover: dbProfile?.annualTurnover || account?.annualTurnover || '',
      street: dbProfile?.street || account?.street || account?.address1 || '',
      city: dbProfile?.city || account?.city || '',
      state: dbProfile?.state || account?.state || '',
      pincode: dbProfile?.pincode || account?.pincode || account?.zip_code || '',
      country: dbProfile?.country || account?.country || '',
      categories: dbProfile?.categories || account?.categories || [],
      sourcingMode: account?.sourcingMode || null,
      subscriptionPlan: account?.subscriptionPlan || null,
      totalRFQsCreated: numberOrNull(account?.totalRFQsCreated),
      totalSpend: account?.totalSpend !== undefined && account?.totalSpend !== null && account?.totalSpend !== ''
        ? String(account.totalSpend).replace('$', '₹')
        : null,
    };

    return res.json({
      success: true,
      data: merged,
      meta: {
        source: dbProfile ? 'identity_database' : 'local_account_cache',
        degraded: !dbProfile,
      },
    });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error fetching buyer profile details');
  }
}

module.exports = {
  getClientIp,
  respondWithError,
  getMyProfile,
  updateMyProfile,
  getCategoryTaxonomy,
  getDispatchTemplates,
  updateDispatchTemplate,
  getBuyerProfileDetails,
};

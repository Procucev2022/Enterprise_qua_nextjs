const buyerProfileService = require('../services/buyerProfileService');
const { logger } = require('../services/loggerService');
const { BUYER_PROFILE_MESSAGES } = require('../config/constants');

const LOG_CATEGORY = 'BUYER_PROFILE_CONTROLLER';

function getClientIp(req) {
  return req.ip || (req.headers && req.headers['x-forwarded-for']) || '127.0.0.1';
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
 */
async function getCategoryTaxonomy(req, res, next) {
  try {
    const taxonomy = await buyerProfileService.getCategoryTaxonomy();
    return res.json({ success: true, count: taxonomy.length, data: taxonomy });
  } catch (err) {
    return respondWithError(err, res, next, 'Unexpected error reading category taxonomy');
  }
}

module.exports = {
  getClientIp,
  respondWithError,
  getMyProfile,
  updateMyProfile,
  getCategoryTaxonomy,
};

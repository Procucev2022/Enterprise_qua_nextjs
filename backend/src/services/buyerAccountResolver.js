// ==============================================================================
// ACTIVE BUYER ACCOUNT RESOLUTION
// ==============================================================================
// The signed-in buyer's account, read from the `user` + `organization` tables.
//
// This replaces SEED_BUYER_ACCOUNTS. That seed shipped four fabricated companies
// — Tata Motors, L&T, JSW, Mahindra — with invented spend figures, and
// `activeBuyerAccount` was simply `buyerAccounts[0]`. Whoever signed in, the
// dashboard attributed their work to Tata Motors and showed $4,280,000 of spend
// that did not exist. The frontend tried to correct for it by matching the session
// email against `corporateEmail`, but there is no unique index on the login email,
// so that match was never reliable either.
//
// The organisation is read from the database rather than trusted from the token's
// `orgId` claim, matching buyerProfileService: a re-parented account must not keep
// resolving to its previous organisation for the lifetime of an issued token.
// ==============================================================================

const buyerProfileQueries = require('../db/buyerProfileQueries');
const pool = require('../db/pool');
const { logger } = require('./loggerService');
const { BUYER_ACCOUNT_RESOLUTION } = require('../config/constants');

const LOG_CATEGORY = 'BUYER_ACCOUNT';

/**
 * Map a real organisation profile onto the BuyerAccount shape the dashboard reads.
 *
 * Fields the identity schema genuinely does not hold are reported as null or zero
 * rather than invented. `totalSpend` and `totalRFQsCreated` in particular were
 * fabricated strings in the seed; they are now derived from real RFQ rows by the
 * caller, or left at zero when nothing has been raised.
 */
function mapProfileToBuyerAccount(profile, extras = {}) {
  return {
    id: profile.organizationId,
    organizationId: profile.organizationId,
    userId: profile.userId,
    organizationName: profile.companyName,
    corporateEmail: profile.contactEmail,
    contactPerson: profile.contactName,
    mobileNumber: profile.contactPhone,
    // The identity schema has no industry sector column. Reported as empty rather
    // than guessed from the organisation name, which is what the seed effectively
    // did by hardcoding 'Automotive & Heavy Commercial Vehicles'.
    industrySector: '',
    gstin: profile.gstNumber,
    panNumber: profile.panNumber,
    primaryPlantLocation: [profile.city, profile.state].filter(Boolean).join(', '),
    // `profile.categories` is a flat list of `{ major, minor }` pairs — one per
    // selected minor category — which is the shape org_division_category stores
    // and the shape loadCategories returns. This previously read `.majorCategory`
    // and `.minorCategories`, the field names used by the *taxonomy* endpoint's
    // grouped shape, so both arrays came out empty on every account and the
    // dashboard showed a buyer as having no procurement scope at all.
    supportedMajorCategories: (profile.categories || [])
      .map((c) => c.major)
      .filter((v, i, arr) => v && arr.indexOf(v) === i),
    supportedMinorCategories: (profile.categories || [])
      .map((c) => c.minor)
      .filter((v, i, arr) => v && arr.indexOf(v) === i),
    accountSource: BUYER_ACCOUNT_RESOLUTION.SOURCE_IDENTITY_DB,
    status: BUYER_ACCOUNT_RESOLUTION.STATUS_ACTIVE,
    // Counted from real RFQ rows by the caller. Zero until something is raised.
    totalRFQsCreated: extras.totalRFQsCreated || 0,
    totalSpend: extras.totalSpend || 0,
  };
}

/**
 * Resolve the active buyer account for a session.
 *
 * @returns {Promise<{ok: true, account: object}|{ok: false, status: number, error: string}>}
 */
async function resolveActiveBuyerAccount(sessionUser) {
  if (!sessionUser || !sessionUser.sub) {
    return {
      ok: false,
      status: 401,
      error: BUYER_ACCOUNT_RESOLUTION.MESSAGES.NO_SESSION,
    };
  }

  if (!pool.pool) {
    // Fails closed. Returning a fabricated account here is exactly what made the
    // dashboard show another company's data.
    return {
      ok: false,
      status: 503,
      error: BUYER_ACCOUNT_RESOLUTION.MESSAGES.IDENTITY_UNAVAILABLE,
    };
  }

  let result;
  try {
    result = await buyerProfileQueries.findProfileByUserId(sessionUser.sub);
  } catch (err) {
    logger.error('Buyer account lookup failed', err, LOG_CATEGORY);
    return {
      ok: false,
      status: 503,
      error: BUYER_ACCOUNT_RESOLUTION.MESSAGES.LOOKUP_FAILED,
    };
  }

  if (!result || !result.profile) {
    const reason = (result && result.reason) || 'USER_NOT_FOUND';
    logger.warn('No buyer account for this session', { reason }, LOG_CATEGORY);
    return {
      ok: false,
      status: reason === 'ORG_NOT_LINKED' ? 409 : 404,
      error:
        reason === 'ORG_NOT_LINKED'
          ? BUYER_ACCOUNT_RESOLUTION.MESSAGES.ORG_NOT_LINKED
          : BUYER_ACCOUNT_RESOLUTION.MESSAGES.USER_NOT_FOUND,
    };
  }

  return { ok: true, account: mapProfileToBuyerAccount(result.profile) };
}

module.exports = {
  mapProfileToBuyerAccount,
  resolveActiveBuyerAccount,
};

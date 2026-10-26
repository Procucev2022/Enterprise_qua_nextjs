// ==============================================================================
// BUYER PROFILE SERVICE
// ==============================================================================
// Business logic for the buyer organisation profile, backed entirely by
// PostgreSQL (`user`, `organization`, `org_division_category`, `category_division`).
//
// The organisation being read or written is resolved from the caller's verified
// session claims, never from the request body. The endpoint this replaced took
// `id` / `userId` from the payload with no ownership check, so any authenticated
// user could read or overwrite any organisation by passing its UUID. Here the
// buyer can only ever reach their own profile, and a body that names a different
// organisation is ignored rather than honoured.
// ==============================================================================

const buyerProfileQueries = require('../db/buyerProfileQueries');
const pool = require('../db/pool');
const storeService = require('./storeService');
const { logger } = require('./loggerService');
const {
  AUTH_MESSAGES,
  BUYER_PROFILE_CONFIG,
  BUYER_PROFILE_MESSAGES,
  VALIDATION_SCHEMAS,
  validatePayload,
  formatMessage,
} = require('../config/constants');

const LOG_CATEGORY = 'BUYER_PROFILE_SERVICE';

/**
 * A failure that carries the HTTP status the controller should return, so
 * "not linked to an organisation" (404) and "database unreachable" (503) are not
 * both flattened into a 500 with the same unhelpful message.
 */
class BuyerProfileError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = 'BuyerProfileError';
    this.status = status;
    this.details = details;
  }
}

/** Reject before issuing a query when no database is configured. */
function assertIdentityConfigured() {
  if (!pool.hasStorage()) {
    throw new BuyerProfileError(AUTH_MESSAGES.IDENTITY_DB_NOT_CONFIGURED, 503);
  }
}

/**
 * Resolve the buyer whose profile this request may touch, from session claims.
 *
 * `sub` is the `user.uuid` the session was issued for. The organisation is read
 * back from the database rather than trusted from the token's `orgId` claim, so a
 * re-parented account cannot keep writing to its previous organisation for the
 * lifetime of an already-issued token.
 */
function resolveBuyerIdentity(sessionUser) {
  if (!sessionUser || !sessionUser.sub) {
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.SESSION_MISSING_USER, 401);
  }
  return { userId: sessionUser.sub, email: sessionUser.email || '' };
}

/** Map a lookup miss onto the status and remediation advice it deserves. */
function raiseLookupFailure(reason) {
  if (reason === 'USER_NOT_FOUND') {
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.USER_NOT_FOUND, 404);
  }
  if (reason === 'ORG_NOT_LINKED') {
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.ORGANIZATION_NOT_LINKED, 409);
  }
  throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.SESSION_MISSING_USER, 401);
}

/**
 * Read the signed-in buyer's organisation profile.
 */
async function getProfile(sessionUser) {
  assertIdentityConfigured();
  const { userId, email } = resolveBuyerIdentity(sessionUser);

  logger.info('Loading buyer organization profile', { userId, email }, LOG_CATEGORY);

  let result;
  try {
    result = await buyerProfileQueries.findProfileByUserId(userId);
  } catch (err) {
    logger.error('Buyer organization profile read failed', err, LOG_CATEGORY);
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED, 503);
  }

  if (!result.found) {
    logger.warn(
      `Buyer organization profile unavailable: ${result.reason}`,
      { userId, email, reason: result.reason },
      LOG_CATEGORY
    );
    raiseLookupFailure(result.reason);
  }

  const profile = result.profile;

  // Hydrate missing address / statutory tax details from storeService buyer account if present
  try {
    const buyerAcc = await storeService.getBuyerAccountByEmail(email);
    if (buyerAcc) {
      let needsDbUpdate = false;
      const patch = {};

      if (!profile.street) {
        const fallbackStreet = buyerAcc.street || buyerAcc.address1 || buyerAcc.address || (buyerAcc.city && buyerAcc.state ? `${buyerAcc.city}, ${buyerAcc.state}` : buyerAcc.city || '');
        if (fallbackStreet) {
          profile.street = fallbackStreet;
          patch.street = profile.street;
          needsDbUpdate = true;
        }
      }
      if (!profile.city && buyerAcc.city) {
        profile.city = buyerAcc.city;
        patch.city = profile.city;
        needsDbUpdate = true;
      }
      if (!profile.state && buyerAcc.state) {
        profile.state = buyerAcc.state;
        patch.state = profile.state;
        needsDbUpdate = true;
      }
      if (!profile.pincode && (buyerAcc.pincode || buyerAcc.zip_code || buyerAcc.zipCode)) {
        profile.pincode = buyerAcc.pincode || buyerAcc.zip_code || buyerAcc.zipCode;
        patch.pincode = profile.pincode;
        needsDbUpdate = true;
      }
      if (!profile.gstNumber && (buyerAcc.gstin || buyerAcc.gstNumber || buyerAcc.gst)) {
        profile.gstNumber = (buyerAcc.gstin || buyerAcc.gstNumber || buyerAcc.gst).toUpperCase();
        patch.gstNumber = profile.gstNumber;
        needsDbUpdate = true;
      }
      if (!profile.panNumber && (buyerAcc.pan || buyerAcc.panNumber || (profile.gstNumber && profile.gstNumber.length === 15))) {
        profile.panNumber = (buyerAcc.pan || buyerAcc.panNumber || (profile.gstNumber && profile.gstNumber.length === 15 ? profile.gstNumber.slice(2, 12) : '')).toUpperCase();
        if (profile.panNumber) {
          patch.panNumber = profile.panNumber;
          needsDbUpdate = true;
        }
      }
      if (!profile.country || profile.country === '') {
        profile.country = buyerAcc.country || 'India';
      }

      if (needsDbUpdate && profile.organizationId) {
        try {
          await buyerProfileQueries.updateProfile({
            organizationId: profile.organizationId,
            userId,
            patch,
            categories: profile.categories,
            actor: email,
          });
        } catch (err) {
          logger.warn('Failed to auto-heal buyer profile address in DB', { error: err.message }, LOG_CATEGORY);
        }
      }
    } else if (!profile.panNumber && profile.gstNumber && profile.gstNumber.length === 15) {
      profile.panNumber = profile.gstNumber.slice(2, 12).toUpperCase();
      if (profile.organizationId) {
        try {
          await buyerProfileQueries.updateProfile({
            organizationId: profile.organizationId,
            userId,
            patch: { panNumber: profile.panNumber },
            categories: profile.categories,
            actor: email,
          });
        } catch (err) {
          logger.warn('Failed to auto-heal buyer profile PAN in DB', { error: err.message }, LOG_CATEGORY);
        }
      }
    }
  } catch (syncErr) {
    logger.warn('Could not check buyer account fallback in getProfile', { error: syncErr.message }, LOG_CATEGORY);
  }

  return profile;
}

const DISPATCH_TEMPLATE_TYPES = ['category_mapped', 'self_map_required'];

/**
 * Resolve the signed-in buyer's organisationId, the same way getProfile()
 * does — reused by the vendor-dispatch-template settings below so they're
 * scoped to the caller's own organisation the same way the profile itself is.
 */
async function resolveOrganizationId(sessionUser) {
  assertIdentityConfigured();
  const { userId, email } = resolveBuyerIdentity(sessionUser);

  let result;
  try {
    result = await buyerProfileQueries.findProfileByUserId(userId);
  } catch (err) {
    logger.error('Buyer organization lookup failed', err, LOG_CATEGORY);
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED, 503);
  }
  if (!result.found) {
    logger.warn(
      `Buyer organization unavailable: ${result.reason}`,
      { userId, email, reason: result.reason },
      LOG_CATEGORY
    );
    raiseLookupFailure(result.reason);
  }
  return result.profile.organizationId;
}

/**
 * The signed-in buyer's custom vendor-onboarding email templates (Template A
 * / Template B, see mailerService.buildVendorCategoryMappingEmail /
 * buildVendorSelfMappingEmail). A missing type means the hardcoded default
 * wording is in effect.
 */
async function getDispatchTemplates(sessionUser) {
  const organizationId = await resolveOrganizationId(sessionUser);
  try {
    return await buyerProfileQueries.getDispatchTemplates(organizationId);
  } catch (err) {
    logger.error('Vendor dispatch template read failed', err, LOG_CATEGORY);
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED, 503);
  }
}

/**
 * Save (or clear, with both fields blank) the signed-in buyer's custom
 * subject/message for one template type.
 */
async function saveDispatchTemplate(sessionUser, templateType, { subject, message }) {
  const organizationId = await resolveOrganizationId(sessionUser);
  if (!DISPATCH_TEMPLATE_TYPES.includes(templateType)) {
    throw new BuyerProfileError('Unknown vendor dispatch template type.', 400);
  }
  try {
    return await buyerProfileQueries.upsertDispatchTemplate(
      organizationId,
      templateType,
      { subject, message },
      sessionUser.email || null
    );
  } catch (err) {
    logger.error('Vendor dispatch template save failed', err, LOG_CATEGORY);
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_SAVE_FAILED, 503);
  }
}

/**
 * Normalise and check the submitted category selection.
 *
 * The wire format is flat `{ major, minor }` pairs, one per selected minor
 * category, which is the shape `org_division_category` stores and the shape the
 * old client sent as `divisionCategories`.
 *
 * Duplicates are collapsed rather than rejected: two clicks on the same checkbox
 * are a client-side glitch, not something to make the buyer resolve, and the caps
 * must be applied to the de-duplicated set or a repeated pair could exhaust the
 * allowance on its own.
 */
function normalizeCategories(rawCategories) {
  if (rawCategories === undefined || rawCategories === null) return undefined;
  if (!Array.isArray(rawCategories)) {
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.CATEGORIES_INVALID, 400);
  }

  const seen = new Set();
  const normalized = [];

  rawCategories.forEach((entry) => {
    const major = buyerProfileQueries.text(entry && entry.major);
    const minor = buyerProfileQueries.text(entry && entry.minor);
    if (major === '' || minor === '') {
      throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.CATEGORIES_INVALID, 400, {
        categories: BUYER_PROFILE_MESSAGES.CATEGORIES_INVALID,
      });
    }
    const key = `${major.toLowerCase()}::${minor.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({ major, minor });
  });

  const majors = new Set(normalized.map((entry) => entry.major.toLowerCase()));
  const { MAX_MAJOR_CATEGORIES, MAX_MINOR_CATEGORIES } = BUYER_PROFILE_CONFIG;

  if (majors.size > MAX_MAJOR_CATEGORIES) {
    throw new BuyerProfileError(
      formatMessage(BUYER_PROFILE_MESSAGES.TOO_MANY_MAJOR_CATEGORIES, { max: MAX_MAJOR_CATEGORIES }),
      400,
      { categories: formatMessage(BUYER_PROFILE_MESSAGES.TOO_MANY_MAJOR_CATEGORIES, { max: MAX_MAJOR_CATEGORIES }) }
    );
  }

  if (normalized.length > MAX_MINOR_CATEGORIES) {
    throw new BuyerProfileError(
      formatMessage(BUYER_PROFILE_MESSAGES.TOO_MANY_MINOR_CATEGORIES, { max: MAX_MINOR_CATEGORIES }),
      400,
      { categories: formatMessage(BUYER_PROFILE_MESSAGES.TOO_MANY_MINOR_CATEGORIES, { max: MAX_MINOR_CATEGORIES }) }
    );
  }

  return normalized;
}

// Fields a save may patch. Anything else in the body is ignored rather than
// written, so the vendor, subscription and status columns that share the
// `organization` row cannot be reached through this endpoint.
const PATCHABLE_FIELDS = buyerProfileQueries.PROFILE_COLUMN_MAP.map((entry) => entry.field);

/**
 * Keep only the profile fields the caller actually supplied.
 *
 * Preserves the null-skip contract end to end: an omitted key never reaches the
 * SQL builder, so it cannot overwrite a stored value with a blank.
 */
function pickPatchableFields(body) {
  const patch = {};
  PATCHABLE_FIELDS.forEach((field) => {
    if (body[field] !== undefined && body[field] !== null) {
      patch[field] = body[field];
    }
  });
  return patch;
}

/**
 * Save the signed-in buyer's organisation profile.
 *
 * Validation runs against VALIDATION_SCHEMAS.buyerProfile before anything is
 * written, and returns every offending field at once so the buyer can fix a form
 * in one pass instead of discovering one error per submit.
 */
async function saveProfile(sessionUser, body = {}, ipAddress) {
  assertIdentityConfigured();
  const { userId, email } = resolveBuyerIdentity(sessionUser);

  const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.buyerProfile, body);
  if (!isValid) {
    logger.warn('Buyer organization profile rejected by validation', { userId, errors }, LOG_CATEGORY);
    throw new BuyerProfileError(Object.values(errors)[0], 400, errors);
  }

  const categories = normalizeCategories(body.categories);

  // Resolve the organisation from the session's user record, not the body.
  let lookup;
  try {
    lookup = await buyerProfileQueries.findProfileByUserId(userId);
  } catch (err) {
    logger.error('Buyer organization profile lookup failed before save', err, LOG_CATEGORY);
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_SAVE_FAILED, 503);
  }

  if (!lookup.found) {
    logger.warn(
      `Buyer organization profile save blocked: ${lookup.reason}`,
      { userId, reason: lookup.reason },
      LOG_CATEGORY
    );
    raiseLookupFailure(lookup.reason);
  }

  const organizationId = lookup.profile.organizationId;
  const patch = pickPatchableFields(body);

  logger.info(
    'Saving buyer organization profile',
    { userId, organizationId, fields: Object.keys(patch), categoryCount: categories ? categories.length : null },
    LOG_CATEGORY
  );

  let result;
  try {
    result = await buyerProfileQueries.updateProfile({
      organizationId,
      userId,
      patch,
      categories,
      actor: email || userId,
    });
  } catch (err) {
    logger.error('Buyer organization profile write failed', err, LOG_CATEGORY);
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_SAVE_FAILED, 503);
  }

  if (!result.updated) {
    logger.warn('Buyer organization profile write found no organization', { userId, organizationId }, LOG_CATEGORY);
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.ORGANIZATION_NOT_FOUND, 404);
  }

  // Re-read so the client renders exactly what was stored, including the
  // ₹ -> "INR " rewrite and the uppercased tax identifiers.
  let saved;
  try {
    saved = await buyerProfileQueries.findProfileByUserId(userId);
  } catch (err) {
    logger.error('Buyer organization profile re-read failed after save', err, LOG_CATEGORY);
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED, 503);
  }

  logger.audit(`Buyer organization profile updated: ${patch.companyName || organizationId}`, email, {
    organizationId,
    userId,
    ipAddress,
    categoryCount: result.categoryCount,
  });
  storeService.addAuditLog({
    userEmail: email,
    action: `Updated buyer organization profile and procurement categories for ${
      patch.companyName || organizationId
    }`,
    ipAddress,
  });

  if (email) {
    try {
      const isRealPhone = Boolean(
        patch.contactPhone &&
        !String(patch.contactPhone).includes('9999999999') &&
        !String(patch.contactPhone).includes('0000000000')
      );
      storeService.updateBuyerAccount(email, {
        organizationName: patch.companyName,
        contactPerson: patch.contactName,
        ...(patch.contactPhone ? { phone: patch.contactPhone, mobileNumber: patch.contactPhone } : {}),
        city: patch.city,
        state: patch.state,
        pincode: patch.pincode,
        gstin: patch.gstNumber,
        pan: patch.panNumber,
        profileVerified: true,
        ...(isRealPhone ? { phoneVerified: true } : {}),
        status: 'ACTIVE_VERIFIED',
        verificationStatus: 'verified',
        onboardingRequired: false,
        isAutoRegistered: false,
        tempPasswordRequired: false,
      });
      await storeService.dispatchPendingQuoteNotifications(email);
    } catch (syncErr) {
      logger.warn('Failed to sync storeService buyerAccount in saveProfile', { error: syncErr.message, email }, LOG_CATEGORY);
    }
  }

  return {
    profile: saved.found ? saved.profile : null,
    categoryCount: result.categoryCount,
    fieldsUpdated: result.fieldsUpdated,
  };
}

/**
 * Read the major/minor procurement taxonomy the profile screen selects from.
 */
async function getCategoryTaxonomy() {
  assertIdentityConfigured();

  try {
    const taxonomy = await buyerProfileQueries.findCategoryTaxonomy();
    logger.info(
      'Procurement category taxonomy loaded',
      {
        majorCount: taxonomy.length,
        minorCount: taxonomy.reduce((total, entry) => total + entry.minorCategories.length, 0),
      },
      LOG_CATEGORY
    );
    return taxonomy;
  } catch (err) {
    logger.error('Procurement category taxonomy read failed', err, LOG_CATEGORY);
    throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.TAXONOMY_LOAD_FAILED, 503);
  }
}

module.exports = {
  BuyerProfileError,
  assertIdentityConfigured,
  resolveBuyerIdentity,
  raiseLookupFailure,
  normalizeCategories,
  pickPatchableFields,
  getProfile,
  saveProfile,
  getCategoryTaxonomy,
  getDispatchTemplates,
  saveDispatchTemplate,
  PATCHABLE_FIELDS,
};

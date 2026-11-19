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
const d1Bridge = require('../db/d1Bridge');
const storeService = require('./storeService');
const domainQueries = require('../db/domainQueries');
const { logger } = require('./loggerService');
const {
  derivePanFromGstin,
  parsePrimaryPlantLocation,
} = require('../config/validationSchemas');
const {
  AUTH_MESSAGES,
  BUYER_PROFILE_MESSAGES,
  D1_OVERLOAD_CONFIG,
  DEFAULT_CATEGORY_TAXONOMY,
  VALIDATION_SCHEMAS,
  validatePayload,
} = require('../config/constants');

const LOG_CATEGORY = 'BUYER_PROFILE_SERVICE';

/**
 * A failure that carries the HTTP status the controller should return, so
 * "not linked to an organisation" (404) and "database unreachable" (503) are not
 * both flattened into a 500 with the same unhelpful message.
 */
class BuyerProfileError extends Error {
  constructor(message, status = 400, details = null, options = {}) {
    super(message);
    this.name = 'BuyerProfileError';
    this.status = status;
    this.details = details;
    this.retryable = Boolean(options && options.retryable);
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
function buildFallbackProfileFromBuyerAccount({ userId, email, buyerAcc }) {
  const pickString = (...values) => values.find((v) => typeof v === 'string' && v.trim() !== '') || '';
  const phone = pickString(buyerAcc.phone, buyerAcc.mobile);
  const parsedPlant = parsePrimaryPlantLocation(buyerAcc.primaryPlantLocation);
  const city = pickString(buyerAcc.city, parsedPlant.city);
  const state = pickString(buyerAcc.state, parsedPlant.state);
  const pincode = pickString(buyerAcc.pincode, buyerAcc.zip_code, buyerAcc.zipCode, parsedPlant.pincode);
  const street = pickString(
    buyerAcc.street,
    buyerAcc.streetAddress,
    buyerAcc.address1,
    buyerAcc.address,
    buyerAcc.registeredAddress,
    city && state ? `${city}, ${state}` : city
  );
  const gstNumber = pickString(buyerAcc.gstin, buyerAcc.gstNumber, buyerAcc.gst).toUpperCase();
  const panNumber = (pickString(buyerAcc.pan, buyerAcc.panNumber) || derivePanFromGstin(gstNumber)).toUpperCase();
  return {
    userId,
    email,
    organizationId: pickString(buyerAcc.organizationId, buyerAcc.id) || userId,
    companyName: pickString(buyerAcc.organizationName, buyerAcc.companyName),
    contactName: pickString(buyerAcc.contactPerson, buyerAcc.name),
    contactEmail: email,
    contactPhone: phone,
    phone,
    street,
    city,
    state,
    pincode,
    country: pickString(buyerAcc.country) || 'India',
    gstNumber,
    panNumber,
    categories: [],
  };
}

async function getProfile(sessionUser) {
  assertIdentityConfigured();
  const { userId, email } = resolveBuyerIdentity(sessionUser);

  logger.info('Loading buyer organization profile', { userId, email }, LOG_CATEGORY);

  let result;
  try {
    result = await buyerProfileQueries.findProfileByUserId(userId);
  } catch (err) {
    if ((d1Bridge.isRetryableD1Error(err) || d1Bridge.isD1Overloaded()) && email) {
      const buyerAcc = await storeService.getBuyerAccountByEmail(email).catch(() => null);
      if (buyerAcc) {
        logger.warn(
          'Serving fallback buyer profile from storeService during transient D1 overload',
          { userId, email, error: err.message },
          LOG_CATEGORY
        );
        return buildFallbackProfileFromBuyerAccount({ userId, email, buyerAcc });
      }
    }
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
    let buyerAcc = await storeService.getBuyerAccountByEmail(email);
    if (!buyerAcc && (userId || profile.organizationId)) {
      const memAccounts = typeof storeService.getBuyerAccounts === 'function' ? storeService.getBuyerAccounts() : [];
      buyerAcc =
        memAccounts.find((candidate) => (
          candidate && (
            (userId && (candidate.id === userId || candidate.userId === userId)) ||
            (profile.organizationId && (candidate.organizationId === profile.organizationId || candidate.id === profile.organizationId)) ||
            (email && String(candidate.corporateEmail || '').trim().toLowerCase() === email)
          )
        )) || null;
    }
    if (!buyerAcc && pool.hasStorage() && typeof domainQueries.getBuyerAccountByIdFromDB === 'function') {
      if (userId) {
        buyerAcc = await domainQueries.getBuyerAccountByIdFromDB(userId).catch(() => null);
      }
      if (!buyerAcc && profile.organizationId) {
        buyerAcc = await domainQueries.getBuyerAccountByIdFromDB(profile.organizationId).catch(() => null);
      }
    }

    let needsDbUpdate = false;
    const patch = {};

    if (buyerAcc) {
      const parsedPlant = parsePrimaryPlantLocation(buyerAcc.primaryPlantLocation);
      const mirrorCity = buyerAcc.city || parsedPlant.city || '';
      const mirrorState = buyerAcc.state || parsedPlant.state || '';
      const mirrorPincode = buyerAcc.pincode || buyerAcc.zip_code || buyerAcc.zipCode || parsedPlant.pincode || '';
      const mirrorStreet =
        buyerAcc.street ||
        buyerAcc.streetAddress ||
        buyerAcc.address1 ||
        buyerAcc.address ||
        buyerAcc.registeredAddress ||
        (mirrorCity && mirrorState ? `${mirrorCity}, ${mirrorState}` : mirrorCity || '');

      if (!profile.street && mirrorStreet) {
        profile.street = mirrorStreet;
        patch.street = profile.street;
        needsDbUpdate = true;
      }
      if (!profile.city && mirrorCity) {
        profile.city = mirrorCity;
        patch.city = profile.city;
        needsDbUpdate = true;
      }
      if (!profile.state && mirrorState) {
        profile.state = mirrorState;
        patch.state = profile.state;
        needsDbUpdate = true;
      }
      if (!profile.pincode && mirrorPincode) {
        profile.pincode = mirrorPincode;
        patch.pincode = profile.pincode;
        needsDbUpdate = true;
      }
      if (!profile.gstNumber && (buyerAcc.gstin || buyerAcc.gstNumber || buyerAcc.gst)) {
        profile.gstNumber = (buyerAcc.gstin || buyerAcc.gstNumber || buyerAcc.gst).toUpperCase();
        patch.gstNumber = profile.gstNumber;
        needsDbUpdate = true;
      }
      if (!profile.panNumber && (buyerAcc.pan || buyerAcc.panNumber)) {
        profile.panNumber = (buyerAcc.pan || buyerAcc.panNumber).toUpperCase();
        if (profile.panNumber) {
          patch.panNumber = profile.panNumber;
          needsDbUpdate = true;
        }
      }
      if (!profile.brandName && buyerAcc.brandName) {
        profile.brandName = buyerAcc.brandName;
        patch.brandName = profile.brandName;
        needsDbUpdate = true;
      }
      if (!profile.country || profile.country === '') {
        profile.country = buyerAcc.country || 'India';
        if (needsDbUpdate) {
          patch.country = profile.country;
        }
      }
    }

    if (!profile.panNumber && profile.gstNumber) {
      const derivedPan = derivePanFromGstin(profile.gstNumber);
      if (derivedPan) {
        profile.panNumber = derivedPan;
        patch.panNumber = derivedPan;
        needsDbUpdate = true;
      }
    }

    if (needsDbUpdate && profile.organizationId) {
      try {
        await buyerProfileQueries.updateProfile({
          organizationId: profile.organizationId,
          userId,
          patch,
          actor: email,
        });
      } catch (err) {
        logger.warn('Failed to auto-heal buyer profile address in DB', { error: err.message }, LOG_CATEGORY);
      }
    }

    if (buyerAcc && typeof storeService.updateBuyerAccountDurably === 'function') {
      const mirrorBackfill = {};
      const mirrorStreetExisting =
        buyerAcc.street || buyerAcc.streetAddress || buyerAcc.address1 || buyerAcc.address || buyerAcc.registeredAddress || '';
      const mirrorGstExisting = buyerAcc.gstin || buyerAcc.gstNumber || buyerAcc.gst || '';
      const mirrorPanExisting = buyerAcc.pan || buyerAcc.panNumber || '';
      const mirrorPinExisting = buyerAcc.pincode || buyerAcc.zip_code || buyerAcc.zipCode || '';
      if (profile.organizationId && !buyerAcc.organizationId) mirrorBackfill.organizationId = profile.organizationId;
      if (profile.gstNumber && !mirrorGstExisting) {
        mirrorBackfill.gstin = profile.gstNumber;
        mirrorBackfill.gstNumber = profile.gstNumber;
      }
      if (profile.panNumber && !mirrorPanExisting) {
        mirrorBackfill.pan = profile.panNumber;
        mirrorBackfill.panNumber = profile.panNumber;
      }
      if (profile.street && !mirrorStreetExisting) {
        mirrorBackfill.street = profile.street;
        mirrorBackfill.streetAddress = profile.street;
        mirrorBackfill.address1 = profile.street;
        mirrorBackfill.address = profile.street;
        mirrorBackfill.registeredAddress = profile.street;
      }
      if (profile.city && !buyerAcc.city) mirrorBackfill.city = profile.city;
      if (profile.state && !buyerAcc.state) mirrorBackfill.state = profile.state;
      if (profile.pincode && !mirrorPinExisting) {
        mirrorBackfill.pincode = profile.pincode;
        mirrorBackfill.zip_code = profile.pincode;
        mirrorBackfill.zipCode = profile.pincode;
      }
      if (profile.country && !buyerAcc.country) mirrorBackfill.country = profile.country;
      if (profile.brandName && !buyerAcc.brandName) mirrorBackfill.brandName = profile.brandName;
      if (Object.keys(mirrorBackfill).length > 0 && (buyerAcc.id || email)) {
        try {
          await storeService.updateBuyerAccountDurably(buyerAcc.id || email, mirrorBackfill);
        } catch (mirrorErr) {
          logger.warn('Failed to backfill buyer account mirror from profile', { error: mirrorErr.message }, LOG_CATEGORY);
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

  // Unlimited major and minor procurement categories supported per organization.
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

function buildSavedProfileSnapshot(baseProfile = {}, patch = {}, categories) {
  const snapshot = {
    ...baseProfile,
    ...patch,
    ...(categories !== undefined ? { categories } : {}),
  };
  if (typeof snapshot.panNumber === 'string') snapshot.panNumber = snapshot.panNumber.trim().toUpperCase();
  if (typeof snapshot.gstNumber === 'string') snapshot.gstNumber = snapshot.gstNumber.trim().toUpperCase();
  if (typeof snapshot.cinNumber === 'string') snapshot.cinNumber = snapshot.cinNumber.trim().toUpperCase();
  if (typeof patch.annualTurnover === 'string') {
    snapshot.annualTurnover = buyerProfileQueries.normalizeTurnover(patch.annualTurnover);
  }
  return snapshot;
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
    lookup = await buyerProfileQueries.findProfileByUserId(userId, {
      includeCategories: categories === undefined,
    });
  } catch (err) {
    if ((d1Bridge.isRetryableD1Error(err) || d1Bridge.isD1Overloaded()) && email) {
      const buyerAcc = await storeService.getBuyerAccountByEmail(email).catch(() => null);
      if (buyerAcc && buyerAcc.organizationId) {
        logger.warn(
          'Resolved buyer organization ID from storeService mirror during transient D1 lookup failure',
          { userId, email, organizationId: buyerAcc.organizationId, error: err.message },
          LOG_CATEGORY
        );
        lookup = {
          found: true,
          profile: {
            organizationId: buyerAcc.organizationId,
            userId,
            companyName: buyerAcc.organizationName || '',
            contactEmail: email,
          },
        };
      }
    }
    if (!lookup) {
      logger.error('Buyer organization profile lookup failed before save', err, LOG_CATEGORY);
      if (d1Bridge.isD1OverloadError(err) || d1Bridge.isD1Overloaded()) {
        throw new BuyerProfileError(D1_OVERLOAD_CONFIG.MESSAGE, 503, null, { retryable: true });
      }
      throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_SAVE_FAILED, 503);
    }
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
    if (d1Bridge.isD1OverloadError(err) || d1Bridge.isD1Overloaded()) {
      throw new BuyerProfileError(D1_OVERLOAD_CONFIG.MESSAGE, 503, null, { retryable: true });
    }
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
    if (d1Bridge.isD1OverloadError(err) || d1Bridge.isD1Overloaded()) {
      logger.warn(
        'Buyer organization profile re-read hit D1 overload after commit; returning normalized snapshot',
        { userId, organizationId, error: err.message },
        LOG_CATEGORY
      );
      saved = {
        found: true,
        profile: buildSavedProfileSnapshot(lookup.profile, patch, categories),
      };
    } else {
      logger.error('Buyer organization profile re-read failed after save', err, LOG_CATEGORY);
      throw new BuyerProfileError(BUYER_PROFILE_MESSAGES.PROFILE_LOAD_FAILED, 503);
    }
  }

  const targetCompanyName = patch.companyName || lookup.profile?.companyName || organizationId;
  logger.audit(`Buyer organization profile updated: ${targetCompanyName}`, email, {
    organizationId,
    userId,
    ipAddress,
    categoryCount: result.categoryCount,
  });
  storeService.addAuditLog({
    userEmail: email,
    action: `Updated buyer organization profile and procurement categories for ${targetCompanyName}`,
    ipAddress,
  });

  if (email) {
    try {
      const mirrorUpdate = {
        organizationName: patch.companyName,
        profileVerified: true,
        status: 'ACTIVE_VERIFIED',
        verificationStatus: 'verified',
        onboardingRequired: false,
        isAutoRegistered: false,
        tempPasswordRequired: false,
      };
      if (patch.brandName !== undefined) mirrorUpdate.brandName = patch.brandName;
      if (patch.organizationType !== undefined) mirrorUpdate.organizationType = patch.organizationType;
      if (patch.contactName !== undefined) mirrorUpdate.contactPerson = patch.contactName;
      if (patch.contactDesignation !== undefined) mirrorUpdate.contactDesignation = patch.contactDesignation;
      if (patch.street !== undefined) {
        mirrorUpdate.street = patch.street;
        mirrorUpdate.address1 = patch.street;
        mirrorUpdate.address = patch.street;
      }
      if (patch.city !== undefined) mirrorUpdate.city = patch.city;
      if (patch.state !== undefined) mirrorUpdate.state = patch.state;
      if (patch.pincode !== undefined) {
        mirrorUpdate.pincode = patch.pincode;
        mirrorUpdate.zip_code = patch.pincode;
        mirrorUpdate.zipCode = patch.pincode;
      }
      if (patch.country !== undefined) mirrorUpdate.country = patch.country;
      if (patch.city !== undefined || patch.state !== undefined || patch.pincode !== undefined) {
        const plantCity = patch.city ?? saved.profile?.city ?? '';
        const plantState = patch.state ?? saved.profile?.state ?? '';
        const plantPin = patch.pincode ?? saved.profile?.pincode ?? '';
        const plantParts = [plantCity, plantState].filter(Boolean).join(', ');
        if (plantParts || plantPin) {
          mirrorUpdate.primaryPlantLocation = plantPin
            ? (plantParts ? `${plantParts} (${plantPin})` : plantPin)
            : plantParts;
        }
      }
      if (patch.gstNumber !== undefined) {
        mirrorUpdate.gstin = patch.gstNumber;
        mirrorUpdate.gstNumber = patch.gstNumber;
      }
      if (patch.panNumber !== undefined) {
        mirrorUpdate.pan = patch.panNumber;
        mirrorUpdate.panNumber = patch.panNumber;
      }
      if (patch.cinNumber !== undefined) mirrorUpdate.cinNumber = patch.cinNumber;
      if (patch.website !== undefined) mirrorUpdate.website = patch.website;
      if (patch.annualTurnover !== undefined) mirrorUpdate.annualTurnover = patch.annualTurnover;

      let syncedAccount = await storeService.updateBuyerAccountDurably(email, mirrorUpdate);
      if (!syncedAccount && userId) {
        syncedAccount = await storeService.updateBuyerAccountDurably(userId, mirrorUpdate);
      }
      if (!syncedAccount) {
        logger.warn('Buyer organization profile saved but no buyer-account mirror was found to synchronize', {
          email,
          organizationId,
          userId,
        }, LOG_CATEGORY);
      }
    } catch (syncErr) {
      logger.warn('Failed to durably sync storeService buyerAccount in saveProfile', {
        error: syncErr,
        email,
        organizationId,
        userId,
      }, LOG_CATEGORY);
    }

    try {
      await storeService.dispatchPendingQuoteNotifications(email);
    } catch (dispatchErr) {
      logger.warn('Failed to dispatch pending quote notifications after buyer profile save', {
        error: dispatchErr,
        email,
        organizationId,
        userId,
      }, LOG_CATEGORY);
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
    if (d1Bridge.isRetryableD1Error(err) || d1Bridge.isD1Overloaded()) {
      logger.warn(
        'D1 transiently overloaded during category taxonomy read; serving canonical DEFAULT_CATEGORY_TAXONOMY fallback',
        { error: err.message },
        LOG_CATEGORY
      );
      return DEFAULT_CATEGORY_TAXONOMY.map((entry) => ({
        majorCategory: entry.majorCategory,
        minorCategories: [...entry.minorCategories],
      }));
    }
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

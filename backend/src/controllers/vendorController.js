const crypto = require('crypto');
const vendorDossierExtensions = require('./vendorDossierExtensions');

const storeService = require('../services/storeService');
const domainQueries = require('../db/domainQueries');
const pool = require('../db/pool');
const { isD1Overloaded } = require('../db/d1Bridge');
const identityQueries = require('../db/identityQueries');
const vendorIngestionQueries = require('../db/vendorIngestionQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const eventOutboxService = require('../services/eventOutboxService');
const { generateVendorOnboardingEmail } = require('../services/emailService');
const zohoPaymentService = require('../services/zohoPaymentService');
const zohoReconciliationService = require('../services/zohoReconciliationService');
const { generateReceiptPdf } = require('../services/invoiceService');
const { normalizePhone } = require('../db/identityQueries');
const { logger } = require('../services/loggerService');
const { buyerScopeIdsFor } = require('../services/buyerVendorScope');
const {
  EMAIL_REGEX,
  PAN_REGEX,
  PAN_MESSAGE,
  DUMMY_PAN_MESSAGE,
  VALIDATION_SCHEMAS,
  validatePayload,
  isDummyPan,
  usablePan,
  clearDummyPanFields,
} = require('../config/validationSchemas');
const {
  ZOHO_CONFIG,
  computeZohoPlanAmount,
  VENDOR_SUBSCRIPTION_PLANS,
  getSubscriptionPricingConfig,
  parseSearchTokens,
  AUTH_MESSAGES,
  VENDOR_FREE_CREDITS_LIMIT,
  PERSISTENCE_MESSAGES,
  EVENT_OUTBOX_TYPES,
  VENDOR_EVALUATION_REQUEST,
  BUYER_LOCKED_STATUTORY_FIELDS,
  VENDOR_ASSIGNMENT_LIMITS,
  VENDOR_DIRECTORY_QUERY_CONFIG,
  VENDOR_CATEGORY_VALIDATION_MESSAGES,
  isPlaceholderVendorCategory,
  normalizeVendorCategoryList,
  resolveValidVendorCategories,
  formatMessage,
  foldCategoryDashes,
  VENDOR_ACTIVE_STATUSES,
  VENDOR_STATUS_MESSAGES,
  isVendorInactive,
  normalizeVendorRating,
} = require('../config/constants');
const vendorPresenceService = require('../services/vendorPresenceService');

/**
 * A vendor profile may only be created/edited by the vendor it belongs to
 * (matched by session email) or an admin. Buyers/category managers browse
 * and rate vendors elsewhere but have no business editing a vendor's own
 * registration details.
 */
async function buildBuyerOwnershipContext(user) {
  const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
  const resolvedOrgId = await resolveBuyerOrgIdForScope(user, buyerAccount);
  const buyerScope = buyerScopeIdsFor(user, buyerAccount, resolvedOrgId);
  const buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
  // A buyer can have more than one buyer_accounts row under the same
  // corporate_email (re-registration, org re-provisioning, etc.), and
  // `is_active` is a single global pointer rather than a per-user flag —
  // getBuyerAccountByEmail above only ever resolves the current active (or
  // most recently touched) row. A vendor imported while a different one of
  // the buyer's own rows was active still carries that other row's id as its
  // buyerId/buyerAccountId, so scope must include every row sharing this
  // email, not just the one currently resolved, or the buyer gets locked out
  // of editing their own historical vendors the moment the active row changes.
  let allOwnAccountIds = [];
  if (typeof domainQueries.getBuyerAccountsByEmailFromDB === 'function' && user?.email) {
    try {
      const ownAccounts = await domainQueries.getBuyerAccountsByEmailFromDB(user.email);
      allOwnAccountIds = ownAccounts.flatMap((acc) => [acc?.id, acc?.corporateEmail, acc?.organizationId]);
    } catch (err) {
      logger.warn('Failed to load all buyer accounts for ownership scope; continuing with the single resolved account', {
        error: err,
      }, 'VENDOR_CONTROLLER');
    }
  }
  const scopeSet = new Set(
    [...buyerScope, buyerAccount?.email, ...allOwnAccountIds]
      .map((id) => String(id || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const sId = buyerId ? String(buyerId).toLowerCase() : '';
  const uEmail = user.email ? String(user.email).toLowerCase() : '';
  const buyerCompany = buyerAccount?.organizationName || user.orgName || user.name || 'Buyer';
  const orgName = String(buyerCompany).trim().toLowerCase();
  return {
    buyerAccount,
    resolvedOrgId,
    buyerScope,
    buyerCompany,
    buyerId,
    scopeSet,
    sId,
    uEmail,
    orgName,
  };
}

function checkVendorOwnershipWithContext(user, vendorOrEmail, buyerContext = null) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const vendorEmail = typeof vendorOrEmail === 'string' ? vendorOrEmail : vendorOrEmail && vendorOrEmail.email;
  if (user.role === 'vendor' && vendorEmail && user.email && vendorEmail.toLowerCase() === user.email.toLowerCase()) {
    return true;
  }

  if (user.role === 'buyer' && buyerContext) {
    const { scopeSet, sId, uEmail, orgName } = buyerContext;

    if (typeof vendorOrEmail === 'object' && vendorOrEmail !== null) {
      const vBuyerId = vendorOrEmail.buyerId ? String(vendorOrEmail.buyerId).toLowerCase() : '';
      const vBuyerAccountId = vendorOrEmail.buyerAccountId ? String(vendorOrEmail.buyerAccountId).toLowerCase() : '';
      const vBuyerEmail = vendorOrEmail.buyerEmail ? String(vendorOrEmail.buyerEmail).toLowerCase() : '';
      const vCompany = vendorOrEmail.addedByBuyerCompany ? String(vendorOrEmail.addedByBuyerCompany).toLowerCase() : '';

      const matchesBuyerId = (vBuyerId && (vBuyerId === sId || scopeSet.has(vBuyerId))) ||
        (vBuyerAccountId && (vBuyerAccountId === sId || scopeSet.has(vBuyerAccountId)));
      const matchesBuyerEmail = Boolean(vBuyerEmail && (vBuyerEmail === uEmail || vBuyerEmail === sId || scopeSet.has(vBuyerEmail)));
      const matchesCompany = Boolean(vCompany && orgName && vCompany === orgName);

      if (matchesBuyerId || matchesBuyerEmail || matchesCompany) {
        return true;
      }

      // If it belongs to a different buyer explicitly, deny
      if (
        (vBuyerId && !scopeSet.has(vBuyerId) && vBuyerId !== sId) ||
        (vBuyerAccountId && !scopeSet.has(vBuyerAccountId) && vBuyerAccountId !== sId) ||
        (vBuyerEmail && !scopeSet.has(vBuyerEmail) && vBuyerEmail !== uEmail && vBuyerEmail !== sId)
      ) {
        return false;
      }

      // Check buyer source or buyer-prefixed ID or buyer empanelment
      const isBuyerSource = [
        'buyer_uploaded',
        'buyer_manual',
        'buyer_excel',
        'vendor_master_ingestion',
        'historical_purchase_dump',
        'buyer',
        'manual_buyer_upload'
      ].includes(String(vendorOrEmail.source || vendorOrEmail.uploadSource || '').toLowerCase());

      const hasBuyerPrefix = vendorOrEmail.id && (
        String(vendorOrEmail.id).startsWith('v-hist-') ||
        String(vendorOrEmail.id).startsWith('v-buyer-') ||
        String(vendorOrEmail.id).startsWith('vm-') ||
        String(vendorOrEmail.id).startsWith('v-ingest-') ||
        String(vendorOrEmail.id).startsWith('v-bulk-')
      );

      if (isBuyerSource || hasBuyerPrefix || vendorOrEmail.isBuyerEmpanelled === true || vendorOrEmail.empanelledByBuyer === true) {
        return true;
      }
    } else if (typeof vendorOrEmail === 'string') {
      const idStr = String(vendorOrEmail).trim();
      if (
        idStr.startsWith('v-hist-') ||
        idStr.startsWith('v-buyer-') ||
        idStr.startsWith('vm-') ||
        idStr.startsWith('v-ingest-') ||
        idStr.startsWith('v-bulk-')
      ) {
        return true;
      }
    }
  }

  return false;
}

async function checkVendorOwnership(user, vendorOrEmail, precomputedContext = null) {
  const buyerContext =
    user && user.role === 'buyer' ? precomputedContext || (await buildBuyerOwnershipContext(user)) : null;
  return checkVendorOwnershipWithContext(user, vendorOrEmail, buyerContext);
}

async function assertVendorOwnership(req, res, vendorOrEmail, precomputedContext = null) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  const isOwner = await checkVendorOwnership(user, vendorOrEmail, precomputedContext);
  if (isOwner) return true;

  res.status(403).json({ success: false, error: 'You do not have permission to modify this vendor profile.' });
  return false;
}

/**
 * Bulk vendor upload is available to a category manager (onboarding a whole
 * vendor master list into the shared Procucev network) and to a buyer
 * (onboarding their own private roster, same as the single-add path already
 * scopes to that buyer) — a vendor themselves has no business
 * bulk-registering other companies' vendor records. Kept separate from
 * assertVendorOwnership (single-record, vendor-self-or-admin) since the
 * roles allowed and the reasoning are both different.
 */
function assertBulkImportRole(req, res) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  if (user.role === 'category_manager' || user.role === 'admin' || user.role === 'buyer') return true;
  res.status(403).json({ success: false, error: 'Only a category manager, buyer, or admin may bulk-import vendors.' });
  return false;
}

function hasBulkImportSessionAccess(user, session) {
  if (user?.role === 'admin') return true;
  const actorEmail = String(user?.email || '').trim().toLowerCase();
  const ownerEmail = String(session?.created_by_email || '').trim().toLowerCase();
  return Boolean(actorEmail && ownerEmail && actorEmail === ownerEmail);
}

function publicBulkImportSession(session) {
  if (!session) return session;
  const safeSession = { ...session };
  delete safeSession.created_by_email;
  return safeSession;
}

// Fields a vendor may edit about their own profile via self-service PUT.
// Deliberately excludes rating/score/status/tempPassword/onboarding flags and
// the dual-stream category fields (those go through updateCategories) —
// without this, a vendor could PUT their own rating/score straight to a max
// value through the same endpoint that saves their profile form.
const VENDOR_SELF_EDIT_FIELDS = [
  'name', 'brandName', 'orgType', 'pan', 'gst', 'msme', 'website', 'annualTurnover',
  'factoryAddress', 'city', 'state', 'pincode', 'country', 'location',
  'contactPerson', 'contactDesignation', 'phone',
  'majorCategory', 'minorCategories',
];

function pickVendorSelfEditFields(body) {
  const picked = {};
  VENDOR_SELF_EDIT_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      picked[field] = body[field];
    }
  });
  return picked;
}

// A buyer may read a vendor's statutory identifiers but may not write them. Those identifiers come from the supplier's
// own registration, so a buyer's update keeps every other field and reports which locked fields it dropped.
function splitBuyerLockedFields(body) {
  const kept = {};
  const dropped = [];
  Object.keys(body || {}).forEach((field) => {
    if (BUYER_LOCKED_STATUTORY_FIELDS.includes(field)) {
      dropped.push(field);
    } else {
      kept[field] = body[field];
    }
  });
  return { kept, dropped };
}

// A buyer adding a vendor they already deal with directly may set these
// contact/profile fields, but never the record's identity/ownership fields
// (buyerId, addedByBuyerCompany, subscriptionPlan, etc.) — those are always
// resolved server-side from the authenticated buyer's own account below.
const VENDOR_BUYER_CREATE_FIELDS = [
  'name', 'brandName', 'email', 'phone', 'contactPerson', 'contactDesignation',
  'gstin', 'gst', 'gstNumber', 'pan', 'msme', 'annualTurnover', 'location', 'city', 'state',
  'country', 'pincode', 'majorCategory', 'minorCategories', 'products',
  'rating', 'score',
];

function pickVendorBuyerCreateFields(body) {
  const picked = {};
  VENDOR_BUYER_CREATE_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      picked[field] = body[field];
    }
  });
  return picked;
}

// Max rows a single page may request, regardless of what the client asks for.
// Guards against a typo'd limit=100000 still shipping the whole vendor table
// (the exact bug a real request hit: 87k vendors in one response crashed the
// browser rendering an unpaginated "All Vendors" list).
const MAX_VENDOR_PAGE_SIZE = VENDOR_DIRECTORY_QUERY_CONFIG.MAX_PAGE_SIZE;
const DEFAULT_VENDOR_PAGE_SIZE = VENDOR_DIRECTORY_QUERY_CONFIG.DEFAULT_PAGE_SIZE;

function withoutTemporaryPassword(vendor) {
  if (!vendor || typeof vendor !== 'object') return vendor;
  const { tempPassword: _temporaryPassword, ...safeVendor } = vendor;
  if (safeVendor.raw && typeof safeVendor.raw === 'object') {
    safeVendor.raw = clearDummyPanFields({ ...safeVendor.raw });
  }
  return clearDummyPanFields(safeVendor);
}

/**
 * Validates and normalizes `pan` / `panNumber` on self-service or admin vendor
 * write payloads. Rejects known sample/placeholder PANs and malformed non-empty
 * PANs with HTTP 400, while stripping blank PAN strings so placeholder defaults
 * are never stored on a vendor profile.
 */
function validateAndNormalizeVendorPanUpdate(payload, res) {
  if (!payload || typeof payload !== 'object') return true;
  const panFields = ['pan', 'panNumber'];
  for (const field of panFields) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
    const rawValue = payload[field];
    const clean = typeof rawValue === 'string' ? rawValue.trim().toUpperCase() : '';
    if (!clean) {
      delete payload[field];
      continue;
    }
    if (isDummyPan(clean)) {
      res.status(400).json({ success: false, error: DUMMY_PAN_MESSAGE });
      return false;
    }
    if (!PAN_REGEX.test(clean)) {
      res.status(400).json({ success: false, error: PAN_MESSAGE });
      return false;
    }
    payload[field] = clean;
  }
  return true;
}

/**
 * Strips all fields a public/anonymous visitor should never receive:
 * internal auth credentials, private buyer ownership tags, system
 * notes. Everything else (category, contacts, compliance creds,
 * rating) is safe to expose in the public directory.
 */
/**
 * Masks an email for public directory responses (e.g. "sXXXX@gmail.com" or "mXXXX@japl.org").
 * Ensures raw email is never exposed in the API response or Network tab inspection.
 */
function maskPublicEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) return null;
  const username = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);
  return `${username.charAt(0)}XXXX${domain}`;
}

/**
 * Masks a phone number for public directory responses (e.g. "9XXXXXXX09").
 * Ensures raw phone is never exposed in the API response or Network tab inspection.
 */
function maskPublicPhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 4) return null;

  let prefix = '';
  let nationalNumber = digits;
  if (trimmed.startsWith('+91') || (digits.length === 12 && digits.startsWith('91'))) {
    prefix = '+91 ';
    nationalNumber = digits.slice(-10);
  } else if (trimmed.startsWith('+')) {
    prefix = '+ ';
    nationalNumber = digits.slice(-10);
  } else if (digits.length > 10) {
    nationalNumber = digits.slice(-10);
  }

  const firstDigit = nationalNumber.charAt(0);
  const lastTwo = nationalNumber.slice(-2);
  const maskLength = Math.max(1, nationalNumber.length - 3);
  const maskedMiddle = 'X'.repeat(maskLength);
  return `${prefix}${firstDigit}${maskedMiddle}${lastTwo}`;
}

function sanitizePublicVendor(vendor) {
  if (!vendor || typeof vendor !== 'object') return null;
  const rawObj = vendor.raw && typeof vendor.raw === 'object' ? vendor.raw : {};
  const v = { ...rawObj, ...vendor };
  const majorCategory = v._majorCategory || v.major_category || v.majorCategory || rawObj.majorCategory || 'General Industrial';
  const rating = normalizeVendorRating(v.rating, v.score);
  const city = v.city || null;
  const state = v.state || null;
  const location = [city, state].filter(Boolean).join(', ') || v.location || city || state || 'India';
  const publicPan = usablePan(v.pan || v.panNumber);
  return {
    id: v.id || null,
    name: v.name || 'Unnamed Supplier',
    brandName: v.brandName || null,
    email: maskPublicEmail(v.email),
    phone: maskPublicPhone(v.phone),
    contactPerson: v.contactPerson || null,
    contactDesignation: v.contactDesignation || null,
    website: v.website || null,
    majorCategory,
    minorCategories: Array.isArray(v.minorCategories) ? v.minorCategories : [],
    products: Array.isArray(v.products) ? v.products : [],
    location,
    city,
    state,
    pincode: v.pincode || null,
    country: v.country || 'India',
    factoryAddress: v.factoryAddress || null,
    // Compliance — PAN is partially masked for privacy; dummy/placeholder PANs are never shown
    gstin: v.gstin || v.gst || null,
    pan: publicPan ? `${publicPan.slice(0, 3)}****${publicPan.slice(-2)}` : null,
    msme: v.msme || null,
    orgType: v.orgType || null,
    annualTurnover: v.annualTurnover || null,
    // Badges
    status: v._status || v.status || null,
    rating,
    isVerified: Boolean(v.gstin || v.gst),
    isProcucevNetwork: true,
    createdAt: v._createdAt || v.created_at || v.createdAt || null,
  };
}

/**
 * Parses comma-separated or repeated category query parameters, dropping blank entries
 * and the "All Categories" placeholder while preserving caller order.
 */
function parseCategoryFilterList(rawValue) {
  const joined = Array.isArray(rawValue) ? rawValue.map(String).join(',') : rawValue;
  if (typeof joined !== 'string' || !joined.trim()) return [];
  const allLabel = VENDOR_DIRECTORY_QUERY_CONFIG.ALL_CATEGORIES_LABEL.toLowerCase();
  const seen = new Set();
  const parsed = [];
  for (const part of joined.split(',')) {
    const trimmed = normalizeCategoryDashes(part).trim();
    const norm = trimmed.toLowerCase();
    if (!trimmed || norm === allLabel || seen.has(norm)) continue;
    seen.add(norm);
    parsed.push(trimmed);
    if (parsed.length >= VENDOR_DIRECTORY_QUERY_CONFIG.MAX_CATEGORY_FILTERS) break;
  }
  return parsed;
}

/**
 * Category names are stored with a plain hyphen ("Others - New Product"), but UI labels and
 * pasted text often carry an en dash (–) or em dash (—). Folding them to "-" keeps a stray
 * dash from turning a valid category filter into an empty result.
 */
function normalizeCategoryDashes(value) {
  return foldCategoryDashes(value);
}

/**
 * Deduplicates category strings case-insensitively while preserving the first casing seen.
 */
function dedupeCategoryStrings(values) {
  const seen = new Set();
  const out = [];
  for (const val of values) {
    const trimmed = String(val || '').trim();
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Normalizes and schema-validates GET /api/vendors query parameters.
 */
function validateVendorDirectoryQuery(rawQuery) {
  const q = rawQuery && typeof rawQuery === 'object' ? rawQuery : {};
  const normalized = {};
  for (const key of ['buyerId', 'search', 'email', 'category', 'minor', 'state', 'city']) {
    if (q[key] !== undefined) normalized[key] = q[key];
  }
  // Pincode / preferredPincode: digits only (spaces stripped, e.g. "560 001"); empty means no filter.
  for (const pinKey of ['pincode', 'preferredPincode']) {
    if (q[pinKey] !== undefined && String(q[pinKey]).trim() !== '') {
      normalized[pinKey] = String(q[pinKey]).replace(/\s+/g, '');
    }
  }
  for (const listKey of ['majors', 'minors']) {
    if (q[listKey] !== undefined) {
      normalized[listKey] = Array.isArray(q[listKey]) ? q[listKey].map(String).join(',') : q[listKey];
    }
  }
  if (q.publicOnly !== undefined && String(q.publicOnly).trim() !== '') {
    normalized.publicOnly = String(q.publicOnly).trim().toLowerCase();
  }
  if (q.activeOnly !== undefined && String(q.activeOnly).trim() !== '') {
    normalized.activeOnly = String(q.activeOnly).trim().toLowerCase();
  }
  return validatePayload(VALIDATION_SCHEMAS.vendorDirectoryQuery, normalized);
}

function mergeUniquePublicVendors(targetMap, candidates, cap) {
  if (!Array.isArray(candidates)) return;
  for (const vendor of candidates) {
    if (targetMap.size >= cap) break;
    if (!vendor || isVendorInactive(vendor) || !storeService.isProcucevVendor(vendor)) continue;
    const key = vendor.id || vendor.vendorCode || String(vendor.email || '').toLowerCase();
    if (!key || targetMap.has(key)) continue;
    targetMap.set(key, vendor);
  }
}

async function fetchMajorPoolsFromDB(majors, poolMap, poolLimit, preferredPincode = '') {
  if (!Array.isArray(majors) || majors.length === 0 || poolMap.size >= poolLimit) return;
  const pinOpts = preferredPincode ? [{ pincode: preferredPincode }] : [];
  if (majors.length === 1) {
    const rows = await domainQueries.getPublicVendorsByMajorCategoryFromDB(majors, poolLimit, ...pinOpts);
    mergeUniquePublicVendors(poolMap, rows, poolLimit);
    return;
  }
  // Query each division separately and round-robin merge so populous divisions do not crowd
  // out secondary line-item divisions under a single SQL LIMIT.
  const perMajorLimit = Math.max(20, Math.ceil(poolLimit / majors.length));
  const buckets = await Promise.all(
    majors.map((major) => domainQueries.getPublicVendorsByMajorCategoryFromDB([major], perMajorLimit, ...pinOpts))
  );
  const maxLen = buckets.reduce((max, arr) => Math.max(max, Array.isArray(arr) ? arr.length : 0), 0);
  for (let idx = 0; idx < maxLen && poolMap.size < poolLimit; idx += 1) {
    for (const bucket of buckets) {
      if (poolMap.size >= poolLimit) break;
      if (Array.isArray(bucket) && idx < bucket.length) {
        mergeUniquePublicVendors(poolMap, [bucket[idx]], poolLimit);
      }
    }
  }
  if (poolMap.size < poolLimit) {
    const combined = await domainQueries.getPublicVendorsByMajorCategoryFromDB(majors, poolLimit, ...pinOpts);
    mergeUniquePublicVendors(poolMap, combined, poolLimit);
  }
}

/**
 * Fetches indexed public Procucev network candidates matching RFQ minor/major categories.
 * Minor matches lead the pool; parent-major vendors top up the pool when minor matches are sparse.
 */
async function fetchPublicCategoryCandidatesFromDB({ minors, majors, pageSize, preferredPincode = '' }) {
  const poolLimit = Math.min(
    VENDOR_DIRECTORY_QUERY_CONFIG.MAX_POOL_LIMIT,
    Math.max(pageSize, VENDOR_ASSIGNMENT_LIMITS.MODE3_TOP_LIMIT * VENDOR_DIRECTORY_QUERY_CONFIG.MIN_MINOR_POOL_FACTOR)
  );
  const minorTarget = VENDOR_ASSIGNMENT_LIMITS.MODE3_TOP_LIMIT;
  const pinOpts = preferredPincode ? [{ pincode: preferredPincode }] : [];
  const poolMap = new Map();

  if (minors.length > 0) {
    const inferredMajors = storeService._majorCategoriesForMinors(minors, { allMajors: true });
    const lookupMajors = dedupeCategoryStrings([...majors, ...inferredMajors]);
    const searchTerms = storeService.minorSearchTerms(minors);
    const batchMinorRows = await domainQueries.getPublicVendorsByMinorCategoryFromDB(searchTerms, lookupMajors, poolLimit, ...pinOpts);
    mergeUniquePublicVendors(poolMap, batchMinorRows, poolLimit);

    if (minors.length > 1 && poolMap.size < poolLimit) {
      const perMinorLimit = Math.max(25, Math.ceil(poolLimit / minors.length));
      for (const minor of minors) {
        if (poolMap.size >= poolLimit) break;
        const alreadyHasMinor = Array.from(poolMap.values()).some((v) => storeService.vendorCoversMinorCategory(v, minor));
        if (alreadyHasMinor) continue;
        const singleMinorRows = await domainQueries.getPublicVendorsByMinorCategoryFromDB(
          storeService.minorSearchTerms([minor]),
          storeService._majorCategoriesForMinors([minor], { allMajors: true }),
          perMinorLimit,
          ...pinOpts
        );
        mergeUniquePublicVendors(poolMap, singleMinorRows, poolLimit);
      }
    }

    const minorMatchedCount = Array.from(poolMap.values()).filter((v) =>
      minors.some((minor) => storeService.vendorCoversMinorCategory(v, minor))
    ).length;

    if (minorMatchedCount < minorTarget && poolMap.size < poolLimit && lookupMajors.length === 0 && !isD1Overloaded()) {
      const legacyMinorRows = await domainQueries.getPublicVendorsMatchingCategories(searchTerms, minorTarget * 2, ...pinOpts);
      mergeUniquePublicVendors(poolMap, legacyMinorRows, poolLimit);
    }

    if (poolMap.size < pageSize && lookupMajors.length > 0) {
      await fetchMajorPoolsFromDB(lookupMajors, poolMap, poolLimit, preferredPincode);
    }
  } else {
    await fetchMajorPoolsFromDB(majors, poolMap, poolLimit, preferredPincode);
  }

  return Array.from(poolMap.values()).slice(0, pageSize);
}

function matchesMajorInMemory(vendor, rawMajor) {
  const normTarget = normalizeCategoryDashes(rawMajor || '').toLowerCase().trim();
  if (!normTarget) return false;
  if (normalizeCategoryDashes(vendor.majorCategory || vendor.category || '').toLowerCase().trim() === normTarget) {
    return true;
  }
  for (const list of [vendor.categories, vendor.vendorSelectedCategories, vendor.clientMappedCategories]) {
    if (parseCategoryFilterList(list).some((label) => label.toLowerCase() === normTarget)) {
      return true;
    }
  }
  return false;
}

function applyCategoryFiltersInMemory(vendors, { minors, majors, publicOnly }) {
  if (minors.length === 0 && majors.length === 0) return vendors;
  if (minors.length > 0) {
    const minorHits = vendors.filter((v) => minors.some((minor) => storeService.vendorCoversMinorCategory(v, minor)));
    if (!publicOnly && majors.length === 0) return minorHits;
    const minorSet = new Set(minorHits);
    const lookupMajors = dedupeCategoryStrings([
      ...storeService._majorCategoriesForMinors(minors, { allMajors: true }),
      ...majors,
    ]);
    const majorTopUp = vendors.filter(
      (v) => !minorSet.has(v) && lookupMajors.some((major) => matchesMajorInMemory(v, major))
    );
    return [...minorHits, ...majorTopUp];
  }
  return vendors.filter((v) => majors.some((major) => matchesMajorInMemory(v, major)));
}

async function getVendors(req, res, next) {
  try {
    const rawQuery = (req && req.query) || {};
    const queryValidation = validateVendorDirectoryQuery(rawQuery);
    if (!queryValidation.isValid) {
      logger.warn('Rejected invalid vendor directory query', { fields: Object.keys(queryValidation.errors) }, 'VENDOR_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: 'Invalid vendor directory query parameters.',
        errors: queryValidation.errors,
      });
    }
    const cleanQuery = queryValidation.sanitizedData;
    const publicOnly = ['true', '1'].includes(String(cleanQuery.publicOnly || '').trim().toLowerCase());
    const activeOnly = ['true', '1'].includes(String(cleanQuery.activeOnly || '').trim().toLowerCase());
    const minors = dedupeCategoryStrings([
      ...parseCategoryFilterList(cleanQuery.minors),
      ...parseCategoryFilterList(cleanQuery.minor),
    ]);
    const majors = dedupeCategoryStrings([
      ...parseCategoryFilterList(cleanQuery.majors),
      ...parseCategoryFilterList(cleanQuery.category),
    ]);

    const user = req.user;
    let buyerId = null;
    if (!publicOnly) {
      if (user && user.role === 'buyer') {
        const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
        buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
      } else if (cleanQuery.buyerId) {
        buyerId = cleanQuery.buyerId;
      }
    }
    // buyerId may be an email fallback when identity linkage has not completed;
    // log scope presence without copying a contact identifier into diagnostics.
    logger.info('Fetching vendors with scoping', {
      hasBuyerScope: Boolean(buyerId && buyerId !== 'all'),
      publicOnly,
      minorsCount: minors.length,
      majorsCount: majors.length,
      role: user && user.role,
    }, 'VENDOR_CONTROLLER');

    // Pagination is opt-in (passing `page`) so existing callers that expect
    // the full array (vendor-console metrics, GraphQL, etc.) are unaffected.
    const { page } = rawQuery;
    const { search, email, category, state, city, pincode, preferredPincode } = cleanQuery;

    // Any paginated request is answered straight from Postgres with
    // LIMIT/OFFSET — it must never route through storeService.getVendors(),
    // which re-syncs (and re-serializes) every row in the table on every
    // single call. That was fine at a few hundred vendors; once the table
    // reached 80k+ (a bulk Vendor Master import), it meant every "Load more"
    // click re-fetched the entire table just to keep 50 rows — slow/heavy
    // enough to hang the browser mid-pagination. This used to only cover
    // buyerId === 'all'; a buyer-scoped page request fell through to the
    // in-memory path below, which still fetched the whole table anyway
    // (almost every vendor is public and thus visible to every buyer), so at
    // 600k+ rows a buyer merely opening their vendor list re-pulled and
    // re-parsed the entire directory on every click — the actual scale risk.
    // getVendorsPageFromDB applies the same public-or-mine scoping in SQL
    // when scopedBuyerId is set (skipped entirely for 'all').
    if (page !== undefined && pool.hasStorage()) {
      const pageNumber = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = Math.min(
        MAX_VENDOR_PAGE_SIZE,
        Math.max(1, parseInt(rawQuery.pageSize, 10) || DEFAULT_VENDOR_PAGE_SIZE)
      );
      try {
        if (publicOnly && (minors.length > 0 || majors.length > 0) && !search && !email && !state && !city && !pincode && pageNumber === 1) {
          const candidates = await fetchPublicCategoryCandidatesFromDB({
            minors,
            majors,
            pageSize,
            ...(preferredPincode ? { preferredPincode } : {}),
          });
          logger.info('Fetched indexed public vendor category candidates', {
            minorsCount: minors.length,
            majorsCount: majors.length,
            returned: candidates.length,
            pageSize,
          }, 'VENDOR_CONTROLLER');
          return res.json({
            success: true,
            source: 'persisted',
            data: candidates.map(withoutTemporaryPassword),
            pagination: { page: 1, pageSize, total: candidates.length, totalPages: 1 },
          });
        }
        const effectiveCategory = majors.length === 1 ? majors[0] : '';
        const { rows, total } = await domainQueries.getVendorsPageFromDB({
          limit: pageSize,
          offset: (pageNumber - 1) * pageSize,
          search: search ? String(search).trim() : '',
          email: email ? String(email).trim() : '',
          category: effectiveCategory,
          ...(minors.length > 0 ? { minorTerms: storeService.minorSearchTerms(minors) } : {}),
          ...(state ? { state: String(state).trim() } : {}),
          ...(city ? { city: String(city).trim() } : {}),
          ...(pincode ? { pincode } : {}),
          ...(publicOnly ? { publicOnly: true } : {}),
          ...(activeOnly ? { activeOnly: true } : {}),
          scopedBuyerId: !publicOnly && buyerId && buyerId !== 'all' ? buyerId : '',
        });
        const filteredRows = (publicOnly || activeOnly) ? rows.filter((v) => !isVendorInactive(v)) : rows;
        return res.json({
          success: true,
          source: 'persisted',
          data: filteredRows.map(withoutTemporaryPassword),
          pagination: { page: pageNumber, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
        });
      } catch (err) {
        logger.error('Persisted vendor directory page query failed', {
          error: err,
          operation: 'vendor-directory-page-read',
          hasBuyerScope: Boolean(buyerId && buyerId !== 'all'),
          hasSearch: Boolean(search),
          hasEmailFilter: Boolean(email),
          hasCategoryFilter: Boolean(category),
          hasStateFilter: Boolean(state),
          hasCityFilter: Boolean(city),
          hasPincodeFilter: Boolean(pincode),
          page: pageNumber,
          pageSize,
        }, 'VENDOR_CONTROLLER');
        return res.status(503).json({
          success: false,
          error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
          code: 'PERSISTENCE_UNAVAILABLE',
          retryable: true,
        });
      }
    }

    const hasFilters = Boolean(search || email || category || state || city || pincode || minors.length > 0 || majors.length > 0 || publicOnly || activeOnly);
    const limitQuery = (!hasFilters && rawQuery.limit)
      ? Math.min(Number(rawQuery.limit), 500)
      : null;
    let vendors = await storeService.getVendors(publicOnly ? null : buyerId, limitQuery);
    if (publicOnly) {
      vendors = vendors.filter((v) => !isVendorInactive(v) && storeService.isProcucevVendor(v));
    } else if (activeOnly) {
      vendors = vendors.filter((v) => !isVendorInactive(v));
    }
    if (search) {
      const tokens = parseSearchTokens(search);
      if (tokens.length > 0) {
        vendors = vendors.filter((v) => {
          return tokens.some((token) => {
            const q = token.toLowerCase().trim();
            if (!q) return false;
            return (
              [
                v.name,
                v.email,
                v.corporateEmail,
                v.contactPerson,
                v.contact,
                v.location,
                v.city,
                v.deliveryLocation,
              ].some((field) => String(field || '').toLowerCase().includes(q)) ||
              (q.length <= 3
                ? String(v.majorCategory || v.category || '').toLowerCase().split(/[\s,–—\-_/\\()]+/).includes(q)
                : String(v.majorCategory || v.category || '').toLowerCase().includes(q)
              ) ||
              (v.minorCategories || []).some((m) =>
                q.length <= 3
                  ? String(m || '').toLowerCase().split(/[\s,–—\-_/\\()]+/).includes(q)
                  : String(m || '').toLowerCase().includes(q)
              )
            );
          });
        });
      }
    }
    if (email) {
      const eq = String(email).toLowerCase().trim();
      vendors = vendors.filter((v) => String(v.email || '').toLowerCase().includes(eq));
    }
    vendors = applyCategoryFiltersInMemory(vendors, { minors, majors, publicOnly });
    if (state) {
      const sq = String(state).toLowerCase().trim();
      vendors = vendors.filter((v) =>
        String(v.state || '').toLowerCase().trim() === sq ||
        String(v.location || '').toLowerCase().includes(sq)
      );
    }
    if (city) {
      const cq = String(city).toLowerCase().trim();
      const aliasMatch = cq.match(/^([^(]+)\s*\(([^)]+)\)$/);
      const p1 = aliasMatch ? aliasMatch[1].trim() : cq;
      const p2 = aliasMatch ? aliasMatch[2].trim() : null;
      vendors = vendors.filter((v) => {
        const vCity = String(v.city || '').toLowerCase().trim();
        const vLoc = String(v.location || '').toLowerCase();
        if (p2) {
          return vCity === cq || vCity === p1 || vCity === p2 || vLoc.includes(p1) || vLoc.includes(p2);
        }
        return vCity === cq || vLoc.includes(cq);
      });
    }
    if (pincode) {
      vendors = vendors.filter((v) => String(v.pincode || '').replace(/\s+/g, '').startsWith(pincode));
    }
    if (page !== undefined) {
      const pageNumber = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = Math.min(
        MAX_VENDOR_PAGE_SIZE,
        Math.max(1, parseInt(req.query.pageSize, 10) || DEFAULT_VENDOR_PAGE_SIZE)
      );
      const total = vendors.length;
      const start = (pageNumber - 1) * pageSize;
      const pageData = vendors.slice(start, start + pageSize);
      return res.json({
        success: true,
        source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory',
        data: pageData.map(withoutTemporaryPassword),
        pagination: { page: pageNumber, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      });
    }

    if (req.query && req.query.limit) {
      const limit = Number(req.query.limit);
      if (Number.isInteger(limit) && limit > 0) {
        vendors = vendors.slice(0, Math.min(limit, 500));
      }
    }

    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory',
      data: vendors.map(withoutTemporaryPassword),
    });
  } catch (err) {
    logger.error('Error fetching vendors', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function getVendorById(req, res, next) {
  try {
    const { id } = req.params;
    const user = req.user;
    let buyerId = null;
    let vendor = null;
    if (user && user.role === 'vendor') {
      vendor = await storeService.getVendorByIdWithDBFallback(id, 'all');
      const requestedEmail = String(user.email || '').trim().toLowerCase();
      const recordEmail = String(vendor?.email || '').trim().toLowerCase();
      if (!requestedEmail || !vendor || recordEmail !== requestedEmail) {
        logger.warn('Vendor profile read denied outside the signed-in vendor identity', {
          requestedId: id,
          subject: user.sub || user.id || null,
        }, 'VENDOR_CONTROLLER');
        return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
      }
      buyerId = 'all';
    } else if (user && user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
      buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    } else if (req.query && req.query.buyerId) {
      buyerId = req.query.buyerId;
    }
    logger.info(`Fetching vendor with ID ${id}`, { id, buyerId }, 'VENDOR_CONTROLLER');
    if (!vendor) vendor = await storeService.getVendorByIdWithDBFallback(id, buyerId);
    if (!vendor) {
      logger.warn(`Vendor not found: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({
      success: true,
      source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory',
      data: withoutTemporaryPassword(vendor),
    });
  } catch (err) {
    logger.error(`Error fetching vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function createVendor(req, res, next) {
  try {
    let body = { ...(req.body || {}) };
    let buyerId = null;
    let addedByBuyerCompany = null;
    // A vendor can only ever register themselves; the identity-DB session
    // email is authoritative, never whatever email the client body claims.
    if (req.user.role === 'vendor') {
      body.email = req.user.email;
      // storeService.addVendor falls back to 'buyer_manual' when no source
      // is given, which the frontend's isBuyerUploaded() classifier reads
      // as "added by a buyer" — a genuine vendor self-registration then gets
      // silently sorted into the wrong tab (buyer-summary's "Uploaded by
      // Buyer" list instead of "Procucev Vendors"), and a buyer searching
      // for that vendor by name/email in the tab it's actually documented
      // to live in ("Category Manager uploads & Direct Self-Registration")
      // finds nothing. Confirmed live.
      body.source = 'self_registration';
    } else if (req.user.role === 'admin') {
      buyerId = (req.query && req.query.buyerId) || null;
      clearDummyPanFields(body);
    } else if (req.user.role === 'category_manager') {
      buyerId = null;
      addedByBuyerCompany = null;
      body.source = 'procucev_network';
      clearDummyPanFields(body);
    } else if (req.user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(req.user.email);
      if (!buyerAccount) {
        return res.status(403).json({
          success: false,
          error: 'Your account is not linked to a buyer organization yet, so a vendor cannot be added.',
        });
      }
      buyerId = buyerAccount.id;
      addedByBuyerCompany = buyerAccount.organizationName;
      body = clearDummyPanFields(pickVendorBuyerCreateFields(body));
    } else {
      return res.status(403).json({ success: false, error: 'You do not have permission to create a vendor profile.' });
    }
    const resolvedCreateGstin = String(body.gstin || body.gst || body.gstNumber || '').trim().toUpperCase();
    if (resolvedCreateGstin) {
      body.gstin = resolvedCreateGstin;
      body.gst = resolvedCreateGstin;
    }
    const cleanVendorName = String(body.name || '').trim();
    const cleanCategories = resolveValidVendorCategories(body);
    const hasOnlyPlaceholderMinors =
      Array.isArray(body.minorCategories) &&
      body.minorCategories.length > 0 &&
      cleanCategories.minorCategories.length === 0;
    if (!cleanVendorName || !cleanCategories.majorCategory || hasOnlyPlaceholderMinors) {
      logger.warn('Failed to create vendor: Missing name or valid category', { body }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: VENDOR_CATEGORY_VALIDATION_MESSAGES.CATEGORY_REQUIRED });
    }
    body.name = cleanVendorName;
    body.majorCategory = cleanCategories.majorCategory;
    if (cleanCategories.minorCategories.length > 0) {
      body.minorCategories = cleanCategories.minorCategories;
      if (body.clientMappedCategories === undefined) {
        body.clientMappedCategories = [...cleanCategories.minorCategories];
      }
    }
    if (req.user.role === 'vendor' && !validateAndNormalizeVendorPanUpdate(body, res)) {
      return;
    }
    if ((req.user.role === 'buyer' || req.user.role === 'category_manager') && !body.email) {
      return res.status(400).json({ success: false, error: 'Vendor email is required.' });
    }
    if (addedByBuyerCompany) {
      body.addedByBuyerCompany = addedByBuyerCompany;
    }
    if (req.user && req.user.role === 'buyer' && req.user.email) {
      body.buyerEmail = req.user.email;
    }
    // Check uniqueness before mutating the cache. Durable confirmation below
    // still handles a concurrent insert; onboarding is only provisioned after
    // that confirmation succeeds. This must run before addVendor starts any
    // identity or email side effects for a duplicate submission.
    if (body.email) {
      // A migrated vendor who signed in first already has an auto-created,
      // unowned profile; this add takes it over rather than 409ing.
      const claimed = await storeService.claimMigratedVendorProfile(body.email, body, buyerId, req.user && req.user.email);
      if (claimed) {
        return res.status(201).json({ success: true, data: withoutTemporaryPassword(claimed) });
      }
      if (storeService.getVendorById(body.email, 'all')) {
        return res.status(409).json({ success: false, error: `A vendor with the email ${body.email} already exists.` });
      }
    }
    const phone = body.contactPhone || body.phone;
    if (phone && Array.isArray(storeService.vendors)) {
      const existingByPhone = storeService.vendors.find(
        (v) => (v.contactPhone && v.contactPhone === phone) || (v.phone && v.phone === phone)
      );
      if (existingByPhone) {
        return res.status(409).json({ success: false, error: `A vendor with the contact number ${phone} already exists.` });
      }
    }
    logger.info(`Creating new vendor: ${body.name}`, { name: body.name, majorCategory: body.majorCategory, buyerId, role: req.user.role }, 'VENDOR_CONTROLLER');
    // Persist before adding the record to the isolate cache or starting vendor
    // onboarding side effects. This also resolves concurrent duplicate-email
    // races against the database unique constraint.
    const created = await storeService.addVendorDurably(body, req.user && req.user.email, buyerId);
    // Awaited here rather than left to addVendor's internal fire-and-forget
    // waitUntil call: that path can silently never complete on Workers (the
    // request-scoped bindings it depends on aren't guaranteed to survive
    // past the response), which is exactly how a real buyer-added vendor
    // ended up with onboardingEmailStatus 'failed' and no identity account
    // at all, with nothing surfacing the failure anywhere. This makes the
    // provisioning outcome — success or failure — reflected in `created`
    // before the response is sent.
    const onboarding = created.email
      ? await storeService.provisionVendorOnboarding(created, req.user && req.user.email)
      : null;
    const persistedVendor = storeService.getVendorById(created.id, 'all') || created;
    const vendor = withoutTemporaryPassword(persistedVendor);
    if (req.user.role === 'buyer') {
      const organizationId = req.user.orgId || req.user.organizationId || null;
      if (organizationId && typeof vendorIngestionQueries.markVendorMasterUploaded === 'function') {
        await vendorIngestionQueries.markVendorMasterUploaded(organizationId).catch((markErr) => {
          logger.warn('Failed to mark organization vendorMasterUploaded after buyer vendor creation', { error: markErr, organizationId }, 'VENDOR_CONTROLLER');
        });
      }
    }
    res.status(201).json({
      success: true,
      data: vendor,
      ...(onboarding?.error ? { warning: onboarding.error } : {}),
    });
  } catch (err) {
    logger.error('Error creating vendor', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function sanitizeVendorCategoryUpdates(updates, existing, userRole, res) {
  if (!updates || typeof updates !== 'object') return true;
  const hasMajorUpdate = Object.prototype.hasOwnProperty.call(updates, 'majorCategory');
  const hasMinorUpdate = Object.prototype.hasOwnProperty.call(updates, 'minorCategories');

  if (hasMajorUpdate) {
    if (isPlaceholderVendorCategory(updates.majorCategory)) {
      res.status(400).json({ success: false, error: VENDOR_CATEGORY_VALIDATION_MESSAGES.CATEGORY_REQUIRED });
      return false;
    }
    updates.majorCategory = String(updates.majorCategory).trim();
  }

  if (hasMinorUpdate) {
    const rawMinors = Array.isArray(updates.minorCategories) ? updates.minorCategories : [];
    const cleanedMinors = normalizeVendorCategoryList(rawMinors);
    if (rawMinors.length > 0 && cleanedMinors.length === 0) {
      res.status(400).json({ success: false, error: VENDOR_CATEGORY_VALIDATION_MESSAGES.CATEGORY_REQUIRED });
      return false;
    }
    updates.minorCategories = cleanedMinors;
    if (userRole === 'buyer' && updates.clientMappedCategories === undefined) {
      updates.clientMappedCategories = [...cleanedMinors];
    }
  }

  if (hasMajorUpdate || hasMinorUpdate) {
    const effectiveMajor = hasMajorUpdate ? updates.majorCategory : existing?.majorCategory;
    const effectiveMinors = hasMinorUpdate ? updates.minorCategories : existing?.minorCategories;
    if (isPlaceholderVendorCategory(effectiveMajor) && normalizeVendorCategoryList(effectiveMinors).length === 0) {
      res.status(400).json({ success: false, error: VENDOR_CATEGORY_VALIDATION_MESSAGES.UPDATE_REQUIRES_CATEGORY });
      return false;
    }
  }
  return true;
}

async function updateVendor(req, res, next) {
  try {
    const { id } = req.params;
    const hasActiveFlag = Boolean(req.body && typeof req.body.isActive === 'boolean');
    let existing = await storeService.getVendorByIdWithDBFallback(id, 'all');
    if (!existing && req.user?.role === 'buyer' && isSyntheticFallbackVendorId(id)) {
      const { kept, dropped } = splitBuyerLockedFields(req.body);
      if (dropped.length > 0) {
        logger.info(`Ignored buyer changes to locked statutory fields on vendor ${id}`, { id, droppedFields: dropped }, 'VENDOR_CONTROLLER');
      }
      if (!validateAndNormalizeVendorPanUpdate(kept, res)) return;
      if (!sanitizeVendorCategoryUpdates(kept, null, req.user.role, res)) return;
      if (hasActiveFlag) {
        Object.assign(kept, storeService.buildVendorActiveStatusUpdates(null, kept.isActive, req.user.email));
      }
      const buyerAccount = await storeService.getBuyerAccountByEmail(req.user.email);
      const resolvedOrgId = await resolveBuyerOrgIdForScope(req.user, buyerAccount);
      const buyerScope = buyerScopeIdsFor(req.user, buyerAccount, resolvedOrgId);
      const buyerCompany = buyerAccount?.organizationName || req.user.orgName || req.user.name || 'Buyer';
      const resolved = await resolveFallbackVendorRecord({
        id,
        user: req.user,
        buyerAccount,
        buyerScope,
        resolvedOrgId,
        buyerCompany,
        bodyData: req.body || {},
        updates: kept,
        requireEmail: false,
        allowUnassignedCategory: hasActiveFlag,
      });
      if (resolved.missingCategory) {
        return res.status(400).json({
          success: false,
          code: 'VENDOR_CATEGORY_REQUIRED',
          error: VENDOR_CATEGORY_VALIDATION_MESSAGES.UPDATE_REQUIRES_CATEGORY,
        });
      }
      if (!resolved.vendor) {
        logger.warn(`Vendor not found for update: ${id}`, { id }, 'VENDOR_CONTROLLER');
        return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
      }
      if (resolved.promoted) {
        return res.json({ success: true, data: withoutTemporaryPassword(resolved.vendor) });
      }
      existing = resolved.vendor;
    }
    if (!existing) {
      logger.warn(`Vendor not found for update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!(await assertVendorOwnership(req, res, existing))) return;
    // A vendor editing their own record only gets the self-service field set. A buyer's edit drops the locked
    // statutory identifiers. An admin keeps full field access.
    let updates = { ...(req.body || {}) };
    if (req.user.role === 'vendor') {
      updates = pickVendorSelfEditFields(req.body);
    } else if (req.user.role === 'buyer') {
      const { kept, dropped } = splitBuyerLockedFields(req.body);
      updates = kept;
      if (dropped.length > 0) {
        logger.info(`Ignored buyer changes to locked statutory fields on vendor ${id}`, { id, droppedFields: dropped }, 'VENDOR_CONTROLLER');
      }
    }
    if (req.user.role !== 'vendor' && typeof updates.isActive === 'boolean') {
      Object.assign(updates, storeService.buildVendorActiveStatusUpdates(existing, updates.isActive, req.user.email));
    }
    if (!validateAndNormalizeVendorPanUpdate(updates, res)) return;
    if (!sanitizeVendorCategoryUpdates(updates, existing, req.user.role, res)) return;
    logger.info(`Updating vendor ${id}`, { id, updatedFields: Object.keys(updates || {}) }, 'VENDOR_CONTROLLER');
    const updated = await storeService.updateVendorDurably(existing.id, updates);
    res.json({ success: true, data: withoutTemporaryPassword(updated) });
  } catch (err) {
    logger.error(`Error updating vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function pickFallbackField(primary, secondary) {
  return primary || secondary || null;
}

async function syncVendorMasterRecordStatus({ id, vendor, resolvedOrgId, isActive, actorEmail }) {
  const masterRecordId =
    (vendor && vendor.masterRecordId) ||
    (typeof id === 'string' && id.startsWith(SYNTHETIC_MASTER_PREFIX) ? id.slice(SYNTHETIC_MASTER_PREFIX.length) : '');
  if (!masterRecordId || !resolvedOrgId) {
    return null;
  }
  const statusUpdates = storeService.buildVendorActiveStatusUpdates(vendor || null, isActive, actorEmail);
  try {
    return await vendorIngestionQueries.updateVendorMasterRecordActiveStatus(masterRecordId, resolvedOrgId, statusUpdates);
  } catch (err) {
    logger.warn('Failed to synchronize active status onto vendor_master_records', {
      error: err,
      masterRecordId,
      resolvedOrgId,
      isActive,
    }, 'VENDOR_CONTROLLER');
    return null;
  }
}

function buildBuyerMasterStatusFallbackVendor({
  masterRec,
  isActive,
  user,
  buyerAccount,
  buyerCompany,
  metadataHint = {},
}) {
  const statusUpdates = storeService.buildVendorActiveStatusUpdates(masterRec, isActive, user.email);
  const attributedBuyerId = [buyerAccount?.id, user.sub, user.id, user.email].find(Boolean) || null;
  const email = pickFallbackField(masterRec.email, metadataHint.vendorEmail);
  const name = [masterRec.companyName, metadataHint.vendorName, email, masterRec.vendorCode, 'Supplier'].find(Boolean);
  return {
    id: `${SYNTHETIC_MASTER_PREFIX}${masterRec.id}`,
    masterRecordId: masterRec.id,
    vendorCode: pickFallbackField(masterRec.vendorCode, metadataHint.vendorCode),
    name,
    email,
    contactPerson: pickFallbackField(masterRec.contactPerson, metadataHint.contactPerson),
    phone: pickFallbackField(masterRec.phone, metadataHint.phone),
    location: pickFallbackField(masterRec.address, metadataHint.location),
    city: pickFallbackField(masterRec.city, metadataHint.city),
    state: pickFallbackField(masterRec.state, metadataHint.state),
    pincode: pickFallbackField(masterRec.pincode, metadataHint.pincode),
    gstin: pickFallbackField(masterRec.gstin, metadataHint.gstin),
    source: 'vendor_master_ingestion',
    addedByBuyerCompany: pickFallbackField(buyerCompany, buyerAccount?.organizationName),
    buyerId: attributedBuyerId,
    buyerAccountId: attributedBuyerId,
    buyerEmail: pickFallbackField(buyerAccount?.corporateEmail, user.email),
    isExistingInDatabase: true,
    ...statusUpdates,
  };
}

async function resolveOrPromoteVendorForStatusChange({ id, user, isActive, metadataHint = {}, buyerContext = null }) {
  const existing = await storeService.getVendorByIdWithDBFallback(id, 'all', { fresh: true });
  if (existing) {
    return { vendor: existing, promoted: false, ownershipDenied: false };
  }
  if (user?.role === 'buyer' && isSyntheticFallbackVendorId(id)) {
    const ctx = buyerContext || (await buildBuyerOwnershipContext(user));
    const { buyerAccount, resolvedOrgId, buyerScope, buyerCompany } = ctx;
    const initialStatusFields = storeService.buildVendorActiveStatusUpdates(null, isActive, user.email);

    if (id.startsWith(SYNTHETIC_MASTER_PREFIX)) {
      const rawMasterId = id.slice(SYNTHETIC_MASTER_PREFIX.length);
      const candidateOrgIds = [
        resolvedOrgId,
        user?.orgId,
        user?.organizationId,
        buyerAccount?.organizationId,
        buyerAccount?.id,
      ].filter(Boolean);
      let masterRec = null;
      for (const orgCandidate of candidateOrgIds) {
        masterRec = await vendorIngestionQueries.findVendorMasterRecord(rawMasterId, orgCandidate).catch(() => null);
        if (masterRec) break;
      }
      const candidateEmail = masterRec ? String(masterRec.email || metadataHint.vendorEmail || '').trim().toLowerCase() : '';
      if (masterRec && candidateEmail) {
        const buyerOwned = await storeService.getVendorByIdWithDBFallback(candidateEmail, buyerScope, { fresh: true });
        if (buyerOwned && checkVendorOwnershipWithContext(user, buyerOwned, ctx)) {
          return { vendor: buyerOwned, promoted: false, ownershipDenied: false };
        }
        const globalCollision = await storeService.getVendorByIdWithDBFallback(candidateEmail, 'all', { fresh: true });
        if (globalCollision) {
          await syncVendorMasterRecordStatus({
            id,
            vendor: masterRec,
            resolvedOrgId,
            isActive,
            actorEmail: user.email,
          });
          const masterVendor = buildBuyerMasterStatusFallbackVendor({
            masterRec,
            isActive,
            user,
            buyerAccount,
            buyerCompany,
            metadataHint,
          });
          storeService.addAuditLog({
            userEmail: user.email || SYSTEM_ACTOR_EMAIL,
            action: isActive
              ? `Marked vendor ${masterVendor.name} (${candidateEmail}) ACTIVE and eligible for future workflows`
              : `Marked vendor ${masterVendor.name} (${candidateEmail}) INACTIVE (historical data preserved; excluded from future flows)`,
          });
          return { vendor: masterVendor, promoted: true, ownershipDenied: false };
        }
      }
    }

    const resolved = await resolveFallbackVendorRecord({
      id,
      user,
      buyerAccount,
      buyerScope,
      resolvedOrgId,
      buyerCompany,
      bodyData: metadataHint,
      updates: initialStatusFields,
      requireEmail: false,
      allowUnassignedCategory: true,
    });
    if (resolved.vendor && !resolved.promoted && !checkVendorOwnershipWithContext(user, resolved.vendor, ctx)) {
      return { vendor: null, promoted: false, ownershipDenied: true };
    }
    if (resolved.promoted && id.startsWith(SYNTHETIC_MASTER_PREFIX) && resolvedOrgId) {
      await syncVendorMasterRecordStatus({
        id,
        vendor: resolved.vendor,
        resolvedOrgId,
        isActive,
        actorEmail: user.email,
      });
    }
    return { vendor: resolved.vendor || null, promoted: Boolean(resolved.promoted), ownershipDenied: false };
  }
  return { vendor: null, promoted: false, ownershipDenied: false };
}

async function updateVendorStatus(req, res, next) {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (user.role === 'vendor') {
      return res.status(403).json({ success: false, error: VENDOR_STATUS_MESSAGES.VENDOR_ROLE_FORBIDDEN });
    }

    const validation = validatePayload(VALIDATION_SCHEMAS.vendorActiveStatusUpdate, req.body || {});
    if (!validation.isValid) {
      logger.warn('Rejected invalid vendor active status update', { id, fields: Object.keys(validation.errors) }, 'VENDOR_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: Object.values(validation.errors)[0] || VENDOR_STATUS_MESSAGES.INVALID_ACTIVE_FLAG,
        errors: validation.errors,
      });
    }

    const { isActive, ...metadataHint } = validation.sanitizedData;
    const buyerContext = user.role === 'buyer' ? await buildBuyerOwnershipContext(user) : null;
    const resolved = await resolveOrPromoteVendorForStatusChange({ id, user, isActive, metadataHint, buyerContext });
    if (resolved.ownershipDenied) {
      return res.status(403).json({ success: false, error: 'You do not have permission to modify this vendor profile.' });
    }
    if (!resolved.vendor) {
      logger.warn(`Vendor not found for status update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }

    if (resolved.promoted) {
      logger.info(`Promoted and marked fallback vendor ${resolved.vendor.id} as ${isActive ? 'ACTIVE' : 'INACTIVE'}`, {
        vendorId: resolved.vendor.id,
        originalId: id,
        isActive,
      }, 'VENDOR_CONTROLLER');
      return res.json({
        success: true,
        message: isActive ? VENDOR_STATUS_MESSAGES.MARKED_ACTIVE_SUCCESS : VENDOR_STATUS_MESSAGES.MARKED_INACTIVE_SUCCESS,
        data: withoutTemporaryPassword(resolved.vendor),
      });
    }

    if (!(await assertVendorOwnership(req, res, resolved.vendor, buyerContext))) return;
    logger.info(`Updating vendor ${resolved.vendor.id} active status to ${isActive ? 'ACTIVE' : 'INACTIVE'}`, {
      vendorId: resolved.vendor.id,
      isActive,
      actorEmail: user.email,
    }, 'VENDOR_CONTROLLER');
    const updated = await storeService.updateVendorActiveStatusDurably(resolved.vendor.id, isActive, user.email);
    if (updated && buyerContext?.resolvedOrgId) {
      await syncVendorMasterRecordStatus({
        id,
        vendor: updated,
        resolvedOrgId: buyerContext.resolvedOrgId,
        isActive,
        actorEmail: user.email,
      });
    }
    return res.json({
      success: true,
      message: isActive ? VENDOR_STATUS_MESSAGES.MARKED_ACTIVE_SUCCESS : VENDOR_STATUS_MESSAGES.MARKED_INACTIVE_SUCCESS,
      data: withoutTemporaryPassword(updated),
    });
  } catch (err) {
    logger.error(`Error updating vendor status ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function bulkUpdateVendorStatus(req, res, next) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (user.role === 'vendor') {
      return res.status(403).json({ success: false, error: VENDOR_STATUS_MESSAGES.VENDOR_ROLE_FORBIDDEN });
    }

    const validation = validatePayload(VALIDATION_SCHEMAS.vendorBulkActiveStatusUpdate, req.body || {});
    if (!validation.isValid) {
      logger.warn('Rejected invalid bulk vendor status request', { fields: Object.keys(validation.errors) }, 'VENDOR_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: Object.values(validation.errors)[0] || VENDOR_STATUS_MESSAGES.BULK_VENDOR_IDS_REQUIRED,
        errors: validation.errors,
      });
    }

    const { vendorIds, isActive, vendors: vendorHints } = validation.sanitizedData;
    const cleanedIds = Array.from(new Set(vendorIds.map((rawId) => String(rawId || '').trim()).filter(Boolean)));
    if (cleanedIds.length === 0) {
      return res.status(400).json({ success: false, error: VENDOR_STATUS_MESSAGES.BULK_VENDOR_IDS_REQUIRED });
    }

    const hintById = new Map();
    for (const hint of Array.isArray(vendorHints) ? vendorHints : []) {
      if (hint && typeof hint === 'object' && hint.id) {
        hintById.set(String(hint.id).trim(), hint);
      }
    }

    const buyerContext = user.role === 'buyer' ? await buildBuyerOwnershipContext(user) : null;
    const updatedIds = [];
    const updatedVendors = [];
    const idMappings = {};
    const skippedIds = [];
    const skippedReasons = {};

    for (const id of cleanedIds) {
      const resolved = await resolveOrPromoteVendorForStatusChange({
        id,
        user,
        isActive,
        metadataHint: hintById.get(id) || {},
        buyerContext,
      });
      if (!resolved.vendor) {
        skippedIds.push(id);
        skippedReasons[id] = resolved.ownershipDenied ? 'FORBIDDEN' : 'NOT_FOUND';
        continue;
      }
      if (resolved.promoted) {
        updatedIds.push(resolved.vendor.id);
        idMappings[id] = resolved.vendor.id;
        updatedVendors.push(withoutTemporaryPassword(resolved.vendor));
        continue;
      }
      const isOwner = user.role === 'buyer'
        ? checkVendorOwnershipWithContext(user, resolved.vendor, buyerContext)
        : await checkVendorOwnership(user, resolved.vendor);
      if (!isOwner) {
        skippedIds.push(id);
        skippedReasons[id] = 'FORBIDDEN';
        continue;
      }
      const updated = await storeService.updateVendorActiveStatusDurably(resolved.vendor.id, isActive, user.email, {
        preloadedVendor: resolved.vendor,
        skipAuditLog: true,
      });
      if (updated) {
        if (buyerContext?.resolvedOrgId) {
          await syncVendorMasterRecordStatus({
            id,
            vendor: updated,
            resolvedOrgId: buyerContext.resolvedOrgId,
            isActive,
            actorEmail: user.email,
          });
        }
        updatedIds.push(updated.id);
        idMappings[id] = updated.id;
        updatedVendors.push(withoutTemporaryPassword(updated));
      } else {
        skippedIds.push(id);
        skippedReasons[id] = 'UPDATE_FAILED';
      }
    }

    if (updatedIds.length === 0) {
      const allForbidden = skippedIds.length > 0 && skippedIds.every((sid) => skippedReasons[sid] === 'FORBIDDEN');
      logger.warn('Bulk vendor active status update modified zero vendors', {
        isActive,
        requestedCount: cleanedIds.length,
        skippedIds,
        skippedReasons,
      }, 'VENDOR_CONTROLLER');
      return res.status(allForbidden ? 403 : 404).json({
        success: false,
        isActive,
        error: allForbidden ? VENDOR_STATUS_MESSAGES.BULK_OWNERSHIP_DENIED : VENDOR_STATUS_MESSAGES.BULK_NO_VENDORS_UPDATED,
        updatedCount: 0,
        updatedIds: [],
        skippedIds,
        skippedReasons,
        data: [],
      });
    }

    storeService.addAuditLog({
      userEmail: user.email || SYSTEM_ACTOR_EMAIL,
      action: isActive
        ? `Bulk marked ${updatedIds.length} vendor(s) ACTIVE and eligible for future workflows`
        : `Bulk marked ${updatedIds.length} vendor(s) INACTIVE (historical data preserved; excluded from future flows)`,
    });

    logger.info(`Bulk updated status (${isActive ? 'ACTIVE' : 'INACTIVE'}) for ${updatedIds.length} vendors`, {
      isActive,
      updatedCount: updatedIds.length,
      skippedCount: skippedIds.length,
    }, 'VENDOR_CONTROLLER');

    return res.json({
      success: true,
      isActive,
      message: isActive
        ? `Successfully marked ${updatedIds.length} vendor${updatedIds.length === 1 ? '' : 's'} active.`
        : `Successfully marked ${updatedIds.length} vendor${updatedIds.length === 1 ? '' : 's'} inactive.`,
      updatedCount: updatedIds.length,
      updatedIds,
      idMappings,
      skippedIds,
      data: updatedVendors,
    });
  } catch (err) {
    logger.error('Error during bulk vendor status update', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function deleteVendor(req, res, next) {
  try {
    const { id } = req.params;
    let existing = await storeService.getVendorByIdWithDBFallback(id, 'all');
    if (!existing) {
      existing = storeService.getVendorById(id, 'all');
    }
    if (!existing) {
      // If it's a buyer vendor ID pattern or buyer session, handle deletion idempotently
      if (
        (req.user && (req.user.role === 'buyer' || req.user.role === 'admin')) &&
        (id.startsWith('v-') || id.startsWith('vm-'))
      ) {
        logger.info(`Cleaning up vendor ID ${id}`, { id }, 'VENDOR_CONTROLLER');
        await storeService.deleteVendorDurably(id, req.user && req.user.email);
        return res.json({ success: true, message: `Vendor ${id} deleted successfully.` });
      }
      logger.warn(`Vendor not found for deletion: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!(await assertVendorOwnership(req, res, existing))) return;
    logger.info(`Deleting vendor ${id}`, { id }, 'VENDOR_CONTROLLER');
    await storeService.deleteVendorDurably(existing.id, req.user && req.user.email);
    res.json({ success: true, message: `Vendor ${id} deleted successfully.` });
  } catch (err) {
    logger.error(`Error deleting vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function canDeleteMissingVendorId(user, id) {
  return (user.role === 'buyer' || user.role === 'admin') && (id.startsWith('v-') || id.startsWith('vm-'));
}

async function bulkDeleteVendors(req, res, next) {
  try {
    const { vendorIds, ids } = req.body || {};
    const targetIds = Array.isArray(vendorIds) ? vendorIds : (Array.isArray(ids) ? ids : []);

    if (targetIds.length === 0) {
      return res.status(400).json({ success: false, error: 'vendorIds array is required and must not be empty.' });
    }

    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const deletedIds = [];
    const skippedIds = [];
    const cleanedIds = Array.from(new Set(targetIds.map((rawId) => String(rawId || '').trim()).filter(Boolean)));

    const useBatchDbPath =
      pool.hasStorage() &&
      cleanedIds.length > 1 &&
      typeof domainQueries.getVendorsByIdsFromDB === 'function' &&
      typeof storeService.deleteVendorsDurably === 'function';

    if (useBatchDbPath) {
      const dbVendors = await domainQueries.getVendorsByIdsFromDB(cleanedIds);
      const vendorById = new Map(dbVendors.map((vendor) => [vendor.id, vendor]));
      const idsToDelete = [];

      for (const id of cleanedIds) {
        const existing = vendorById.get(id) || storeService.getVendorById(id, 'all');
        if (!existing) {
          if (canDeleteMissingVendorId(user, id)) {
            idsToDelete.push(id);
          } else {
            skippedIds.push(id);
          }
        } else if (await checkVendorOwnership(user, existing)) {
          idsToDelete.push(existing.id);
        } else {
          skippedIds.push(id);
        }
      }

      if (idsToDelete.length > 0) {
        await storeService.deleteVendorsDurably(idsToDelete, user.email);
        deletedIds.push(...idsToDelete);
      }
    } else {
      for (const id of cleanedIds) {
        let existing = await storeService.getVendorByIdWithDBFallback(id, 'all');
        if (!existing) {
          existing = storeService.getVendorById(id, 'all');
        }

        if (!existing) {
          if (canDeleteMissingVendorId(user, id)) {
            await storeService.deleteVendorDurably(id, user.email);
            deletedIds.push(id);
            continue;
          }
          skippedIds.push(id);
          continue;
        }

        if (await checkVendorOwnership(user, existing)) {
          const deleted = await storeService.deleteVendorDurably(existing.id, user.email);
          if (deleted) deletedIds.push(existing.id);
          else skippedIds.push(id);
        } else {
          skippedIds.push(id);
        }
      }
    }

    logger.info(`Bulk deleted ${deletedIds.length} vendors`, { deletedCount: deletedIds.length, skippedCount: skippedIds.length }, 'VENDOR_CONTROLLER');

    return res.json({
      success: true,
      message: `Successfully deleted ${deletedIds.length} vendor${deletedIds.length === 1 ? '' : 's'}.`,
      deletedCount: deletedIds.length,
      deletedIds,
      skippedIds,
    });
  } catch (err) {
    logger.error('Error during bulk vendor deletion', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}


async function reviseRating(req, res, next) {
  try {
    const { id } = req.params;
    const ratingData = req.body;
    // Rating a vendor is a buyer-side action — a vendor must not be able to
    // rate any vendor (least of all itself) through this endpoint.
    if (req.user.role === 'vendor') {
      return res.status(403).json({ success: false, error: 'Vendors cannot submit rating revisions.' });
    }
    const { qualityScore, costScore, deliveryScore } = ratingData;
    if (qualityScore === undefined || costScore === undefined || deliveryScore === undefined) {
      logger.warn(`Failed to revise rating for vendor ${id}: Missing score components`, { id, ratingData }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: 'qualityScore, costScore, and deliveryScore are required.' });
    }
    // Reject anything that isn't a finite number in [0, 100] rather than
    // letting NaN/out-of-range values silently propagate into the vendor's
    // stored rating/score (previously: Number() coercion with no validation
    // could write null/absurd values — BUGS.md #15).
    const scores = { qualityScore, costScore, deliveryScore };
    for (const [key, value] of Object.entries(scores)) {
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0 || num > 100) {
        logger.warn(`Failed to revise rating for vendor ${id}: invalid ${key}`, { id, value }, 'VENDOR_CONTROLLER');
        return res.status(400).json({ success: false, error: `${key} must be a number between 0 and 100.` });
      }
    }
    // Resolve buyer scope for buyer-owned vendors (v-hist-, v-buyer-, etc.)
    let buyerId = null;
    let buyerScope = null;
    let buyerCompany = 'Buyer';
    if (req.user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(req.user.email);
      const resolvedOrgId = await resolveBuyerOrgIdForScope(req.user, buyerAccount);
      buyerScope = buyerScopeIdsFor(req.user, buyerAccount, resolvedOrgId);
      if (buyerAccount) {
        buyerId = buyerAccount.id;
      } else {
        // Fallback: try to find by sub or email directly
        buyerId = req.user.sub || req.user.email;
      }
      buyerCompany = buyerAccount?.organizationName || req.user.orgName || req.user.name || 'Buyer';
      logger.info(`Resolved buyer scope for rating revision`, { email: req.user.email, buyerId, buyerAccountExists: !!buyerAccount }, 'VENDOR_CONTROLLER');
    }
    logger.info(`Revising rating for vendor ${id}`, { id, ratingFields: Object.keys(ratingData || {}), buyerId }, 'VENDOR_CONTROLLER');
    const scopedArg = buyerScope && buyerScope.length > 0 ? buyerScope : buyerId;
    let result = await storeService.reviseVendorRatingDurably(id, ratingData, scopedArg);
    if (!result && req.user.role === 'buyer') {
      const globalVendor = await storeService.getVendorByIdWithDBFallback(id, 'all', { fresh: true });
      if (globalVendor) {
        const uEmail = String(req.user.email || '').trim().toLowerCase();
        const bCompany = String(buyerCompany || '').trim().toLowerCase();
        const vEmail = String(globalVendor.email || '').trim().toLowerCase();
        const vCompany = String(globalVendor.addedByBuyerCompany || '').trim().toLowerCase();
        const isOwner =
          (uEmail && vEmail === uEmail) ||
          (bCompany && vCompany === bCompany) ||
          checkVendorOwnershipWithContext(req.user, globalVendor, {
            scopeSet: new Set((buyerScope || []).map((s) => String(s).toLowerCase())),
            sId: String(buyerId || '').toLowerCase(),
            uEmail,
            orgName: bCompany,
          });
        if (isOwner) {
          result = await storeService.reviseVendorRatingDurably(id, ratingData, 'all');
        }
      }
    }
    if (!result) {
      logger.warn(`Vendor not found for rating revision: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error(`Error revising rating for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

const SYNTHETIC_MASTER_PREFIX = 'v-master-';
const SYNTHETIC_LOCAL_HISTORY_PREFIX = 'v-hist-local-';

function isSyntheticFallbackVendorId(id) {
  return typeof id === 'string' && (id.startsWith(SYNTHETIC_MASTER_PREFIX) || id.startsWith(SYNTHETIC_LOCAL_HISTORY_PREFIX));
}

async function resolveBuyerOrgIdForScope(user, buyerAccount) {
  let resolvedOrgId = user?.orgId || user?.organizationId || buyerAccount?.organizationId || null;
  if (
    user?.role === 'buyer' &&
    !resolvedOrgId &&
    (user?.sub || user?.id) &&
    typeof buyerProfileQueries.findProfileByUserId === 'function'
  ) {
    const profileLookup = await buyerProfileQueries.findProfileByUserId(user.sub || user.id).catch(() => null);
    if (profileLookup?.found && profileLookup.profile?.organizationId) {
      resolvedOrgId = profileLookup.profile.organizationId;
    }
  }
  if (!resolvedOrgId && buyerAccount?.id) {
    resolvedOrgId = buyerAccount.id;
  }
  return resolvedOrgId;
}

async function empanelFallbackVendorForEvaluation({
  candidate,
  buyerAccount,
  resolvedOrgId,
  user,
  buyerCompany,
  requireEmail = true,
  allowUnassignedCategory = false,
}) {
  const email = String(candidate.email || '').trim().toLowerCase();
  if (requireEmail && !email) return null;
  const attributedBuyerId = buyerAccount?.id || resolvedOrgId || user?.sub || user?.id || user?.email || null;
  // Never overwrite or claim an existing vendor owned by another buyer. The preceding
  // getVendorByIdWithDBFallback lookup already synced any DB match into storeService.vendors.
  if (email) {
    const existing = storeService.getVendorById(email, 'all');
    if (existing) {
      const isOwner = checkVendorOwnershipWithContext(user, existing, {
        scopeSet: new Set(buyerScopeIdsFor(user, buyerAccount, resolvedOrgId).map((s) => String(s).toLowerCase())),
        sId: String(attributedBuyerId || '').toLowerCase(),
        uEmail: String(user?.email || '').toLowerCase(),
        orgName: String(buyerCompany || '').toLowerCase(),
      });
      if (isOwner) return existing;
      return null;
    }
  }

  const cleanCategories = resolveValidVendorCategories(candidate);
  return storeService.empanelIngestedVendor(
    {
      ...candidate,
      name: candidate.name || email || candidate.vendorCode || 'Supplier',
      email: email || null,
      contactPerson: candidate.contactPerson || null,
      phone: candidate.phone || null,
      location: candidate.location || null,
      city: candidate.city || null,
      state: candidate.state || null,
      pincode: candidate.pincode || null,
      gstin: String(candidate.gstin || candidate.gstNumber || candidate.gst || '').trim().toUpperCase() || null,
      gst: String(candidate.gstin || candidate.gstNumber || candidate.gst || '').trim().toUpperCase() || null,
      vendorCode: candidate.vendorCode || null,
      majorCategory: cleanCategories.majorCategory || '',
      minorCategories: cleanCategories.minorCategories,
      clientMappedCategories: [...cleanCategories.minorCategories],
      source: candidate.source || 'buyer_uploaded',
      addedByBuyerCompany: buyerCompany || buyerAccount?.organizationName || null,
      buyerId: attributedBuyerId,
      buyerAccountId: attributedBuyerId,
      buyerEmail: buyerAccount?.corporateEmail || user?.email || null,
    },
    user?.email || null,
    ...(allowUnassignedCategory ? [{ allowUnassignedCategory: true }] : [])
  );
}

async function resolveFallbackVendorRecord({
  id,
  user,
  buyerAccount,
  buyerScope,
  resolvedOrgId,
  buyerCompany,
  bodyData = {},
  updates = null,
  requireEmail = true,
  allowUnassignedCategory = false,
}) {
  let vendor = await storeService.getVendorByIdWithDBFallback(id, buyerScope, { fresh: true });
  if (vendor) return { vendor, missingEmail: false, missingCategory: false, promoted: false };
  if (id.startsWith(SYNTHETIC_MASTER_PREFIX)) {
    const byMasterId = storeService.getVendorById(id, buyerScope);
    if (byMasterId) return { vendor: byMasterId, missingEmail: false, missingCategory: false, promoted: false };
  }

  const sanitizedVendorEmail = String(bodyData.vendorEmail || updates?.email || bodyData.email || '').trim().toLowerCase();
  const checkForeignOwnership = (foreign) => {
    if (!foreign) return false;
    const uEmail = String(user?.email || '').trim().toLowerCase();
    const bCompany = String(buyerCompany || '').trim().toLowerCase();
    const vEmail = String(foreign.email || '').trim().toLowerCase();
    const vCompany = String(foreign.addedByBuyerCompany || '').trim().toLowerCase();
    if (user?.role === 'buyer' && ((uEmail && vEmail && vEmail === uEmail) || (bCompany && vCompany && vCompany === bCompany))) {
      return true;
    }
    return checkVendorOwnershipWithContext(user, foreign, {
      scopeSet: new Set(buyerScope.map((s) => String(s).toLowerCase())),
      sId: String(resolvedOrgId || '').toLowerCase(),
      uEmail: String(user?.email || '').toLowerCase(),
      orgName: String(buyerCompany).trim().toLowerCase(),
    });
  };

  if (!sanitizedVendorEmail) {
    const foreignCheckById = await storeService.getVendorByIdWithDBFallback(id, 'all', { fresh: true });
    if (foreignCheckById) {
      if (checkForeignOwnership(foreignCheckById)) {
        return { vendor: foreignCheckById, missingEmail: !foreignCheckById.email && requireEmail, missingCategory: false, promoted: false };
      }
      return { vendor: null, missingEmail: false, missingCategory: false, promoted: false };
    }
  }

  if (sanitizedVendorEmail) {
    vendor = await storeService.getVendorByIdWithDBFallback(sanitizedVendorEmail, buyerScope, { fresh: true });
    if (vendor) return { vendor, missingEmail: false, missingCategory: false, promoted: false };
    // Trigger cross-buyer DB sync without exposing foreign buyer record in buyerScope
    const foreignCheck = await storeService.getVendorByIdWithDBFallback(sanitizedVendorEmail, 'all', { fresh: true });
    if (foreignCheck) {
      if (checkForeignOwnership(foreignCheck)) return { vendor: foreignCheck, missingEmail: false, missingCategory: false, promoted: false };
      return { vendor: null, missingEmail: false, missingCategory: false, promoted: false };
    }
  }

  if (id.startsWith(SYNTHETIC_MASTER_PREFIX) && typeof vendorIngestionQueries.findVendorMasterRecord === 'function') {
    const rawMasterId = id.slice(SYNTHETIC_MASTER_PREFIX.length);
    const candidateOrgIds = buyerScope;
    let masterRec = null;
    for (const orgCandidate of candidateOrgIds) {
      masterRec = await vendorIngestionQueries.findVendorMasterRecord(rawMasterId, orgCandidate).catch(() => null);
      if (masterRec) break;
    }
    if (!masterRec && typeof vendorIngestionQueries.findVendorMasterRecordById === 'function') {
      masterRec = await vendorIngestionQueries.findVendorMasterRecordById(rawMasterId).catch(() => null);
    }
    if (!masterRec && user?.role === 'buyer' && (updates?.name || bodyData.vendorName || bodyData.name)) {
      const fallbackMasterName = updates?.name || bodyData.vendorName || bodyData.name;
      const fallbackGstin = String(updates?.gstin || updates?.gst || bodyData.gstin || '').trim().toUpperCase() || null;
      const payloadCategories = resolveValidVendorCategories({ ...bodyData, ...(updates || {}) });
      masterRec = {
        id: rawMasterId,
        masterRecordId: rawMasterId,
        companyName: fallbackMasterName,
        email: sanitizedVendorEmail,
        contactPerson: updates?.contactPerson || bodyData.contactPerson,
        phone: updates?.phone || bodyData.phone,
        location: updates?.location || bodyData.location,
        city: updates?.city || bodyData.city,
        state: updates?.state || bodyData.state,
        pincode: updates?.pincode || bodyData.pincode,
        gstin: fallbackGstin,
        gst: fallbackGstin,
        vendorCode: updates?.vendorCode || bodyData.vendorCode,
        majorCategory: payloadCategories.majorCategory,
        minorCategories: payloadCategories.minorCategories,
        source: 'vendor_master_ingestion',
      };
    }
    if (masterRec) {
      const candidateEmail = String(masterRec.email || sanitizedVendorEmail || '').trim().toLowerCase();
      if (requireEmail && !candidateEmail) return { vendor: null, missingEmail: true, missingCategory: false, promoted: false };
      if (candidateEmail) {
        vendor = await storeService.getVendorByIdWithDBFallback(candidateEmail, buyerScope, { fresh: true });
        if (vendor) return { vendor, missingEmail: false, missingCategory: false, promoted: false };
        const foreignMasterMatch = await storeService.getVendorByIdWithDBFallback(candidateEmail, 'all', { fresh: true });
        if (foreignMasterMatch) {
          if (checkForeignOwnership(foreignMasterMatch)) return { vendor: foreignMasterMatch, missingEmail: false, missingCategory: false, promoted: false };
          return { vendor: null, missingEmail: false, missingCategory: false, promoted: false };
        }
      }
      const mapping =
        masterRec.sessionId && typeof vendorIngestionQueries.findCategoryMappingByVendorRecord === 'function'
          ? await vendorIngestionQueries
            .findCategoryMappingByVendorRecord(masterRec.sessionId, resolvedOrgId || masterRec.organizationId, masterRec.id)
            .catch(() => null)
          : null;
      const isRejectedMapping =
        mapping?.status === 'SELF_MAP_REQUIRED' || mapping?.reviewAction === 'REJECTED';
      const mappingCategories = mapping
        ? resolveValidVendorCategories({
          majorCategory:
            mapping.buyerMajorCategory || (!isRejectedMapping ? mapping.aiSuggestion?.majorCategory : ''),
          minorCategories:
            Array.isArray(mapping.buyerMinorCategories) && mapping.buyerMinorCategories.length > 0
              ? mapping.buyerMinorCategories
              : !isRejectedMapping
                ? mapping.aiSuggestion?.minorCategories || []
                : [],
        })
        : { majorCategory: '', minorCategories: [], hasCategory: false };
      const payloadCategories = resolveValidVendorCategories({ ...bodyData, ...(updates || {}) });
      const resolvedMasterGstin = String(
        masterRec.gstin ||
        masterRec.gstNumber ||
        masterRec.gst ||
        bodyData.gstin ||
        bodyData.gst ||
        bodyData.gstNumber ||
        updates?.gstin ||
        updates?.gst ||
        updates?.gstNumber ||
        ''
      ).trim().toUpperCase() || null;
      const effectiveCandidate = {
        ...masterRec,
        ...(updates || {}),
        masterRecordId: masterRec.id,
        name: updates?.name || bodyData.vendorName || bodyData.name || masterRec.companyName,
        email: candidateEmail || null,
        gstin: resolvedMasterGstin,
        gst: resolvedMasterGstin,
        majorCategory: payloadCategories.majorCategory || mappingCategories.majorCategory || '',
        minorCategories:
          payloadCategories.minorCategories.length > 0
            ? payloadCategories.minorCategories
            : mappingCategories.minorCategories,
        source: 'vendor_master_ingestion',
      };
      if (!allowUnassignedCategory && !resolveValidVendorCategories(effectiveCandidate).hasCategory) {
        return { vendor: null, missingEmail: false, missingCategory: true, promoted: false };
      }
      vendor = await empanelFallbackVendorForEvaluation({
        candidate: effectiveCandidate,
        buyerAccount,
        resolvedOrgId,
        user,
        buyerCompany,
        requireEmail,
        allowUnassignedCategory,
      });
      return { vendor, missingEmail: false, missingCategory: false, promoted: Boolean(vendor) };
    }
  }

  if (id.startsWith(SYNTHETIC_MASTER_PREFIX) && user?.role === 'buyer') {
    const hasMasterIdentity = Boolean(sanitizedVendorEmail || bodyData.vendorName || bodyData.name || updates?.name);
    if (hasMasterIdentity) {
      if (requireEmail && !sanitizedVendorEmail) return { vendor: null, missingEmail: true, missingCategory: false, promoted: false };
      const effectiveCandidate = {
        ...(updates || {}),
        name: updates?.name || bodyData.vendorName || bodyData.name || sanitizedVendorEmail || id,
        email: sanitizedVendorEmail || null,
        contactPerson: updates?.contactPerson || bodyData.contactPerson || null,
        phone: updates?.phone || bodyData.phone || null,
        location: updates?.location || bodyData.location || null,
        city: updates?.city || bodyData.city || null,
        state: updates?.state || bodyData.state || null,
        pincode: updates?.pincode || bodyData.pincode || null,
        gstin: String(updates?.gstin || updates?.gst || bodyData.gstin || bodyData.gst || bodyData.gstNumber || '').trim().toUpperCase() || null,
        gst: String(updates?.gstin || updates?.gst || bodyData.gstin || bodyData.gst || bodyData.gstNumber || '').trim().toUpperCase() || null,
        vendorCode: updates?.vendorCode || bodyData.vendorCode || null,
        majorCategory: updates?.majorCategory ?? bodyData.majorCategory,
        minorCategories: updates?.minorCategories ?? bodyData.minorCategories,
        clientMappedCategories: updates?.clientMappedCategories ?? bodyData.clientMappedCategories,
        source: 'vendor_master_ingestion',
        masterRecordId: id.slice(SYNTHETIC_MASTER_PREFIX.length),
      };
      if (!allowUnassignedCategory && !resolveValidVendorCategories(effectiveCandidate).hasCategory) {
        return { vendor: null, missingEmail: false, missingCategory: true, promoted: false };
      }
      vendor = await empanelFallbackVendorForEvaluation({
        candidate: effectiveCandidate,
        buyerAccount,
        resolvedOrgId,
        user,
        buyerCompany,
        requireEmail,
        allowUnassignedCategory,
      });
      return { vendor, missingEmail: false, missingCategory: false, promoted: Boolean(vendor) };
    }
  }

  if (id.startsWith(SYNTHETIC_LOCAL_HISTORY_PREFIX) && user?.role === 'buyer') {
    if (requireEmail && !sanitizedVendorEmail) return { vendor: null, missingEmail: true, missingCategory: false, promoted: false };
    const effectiveCandidate = {
      ...(updates || {}),
      name: updates?.name || bodyData.vendorName || bodyData.name || sanitizedVendorEmail || id,
      email: sanitizedVendorEmail || null,
      contactPerson: updates?.contactPerson || bodyData.contactPerson || null,
      phone: updates?.phone || bodyData.phone || null,
      location: updates?.location || bodyData.location || null,
      city: updates?.city || bodyData.city || null,
      state: updates?.state || bodyData.state || null,
      pincode: updates?.pincode || bodyData.pincode || null,
      gstin: String(updates?.gstin || updates?.gst || bodyData.gstin || bodyData.gst || bodyData.gstNumber || '').trim().toUpperCase() || null,
      gst: String(updates?.gstin || updates?.gst || bodyData.gstin || bodyData.gst || bodyData.gstNumber || '').trim().toUpperCase() || null,
      vendorCode: updates?.vendorCode || bodyData.vendorCode || null,
      majorCategory: updates?.majorCategory ?? bodyData.majorCategory,
      minorCategories: updates?.minorCategories ?? bodyData.minorCategories,
      clientMappedCategories: updates?.clientMappedCategories ?? bodyData.clientMappedCategories,
      source: 'buyer_uploaded',
    };
    if (!allowUnassignedCategory && !resolveValidVendorCategories(effectiveCandidate).hasCategory) {
      return { vendor: null, missingEmail: false, missingCategory: true, promoted: false };
    }
    vendor = await empanelFallbackVendorForEvaluation({
      candidate: effectiveCandidate,
      buyerAccount,
      resolvedOrgId,
      user,
      buyerCompany,
      requireEmail,
      allowUnassignedCategory,
    });
    return { vendor, missingEmail: false, missingCategory: false, promoted: Boolean(vendor) };
  }

  return { vendor: null, missingEmail: false, missingCategory: false, promoted: false };
}

async function resolveVendorForEvaluationRequest(params) {
  return resolveFallbackVendorRecord({ ...params, requireEmail: true });
}

async function requestEvaluation(req, res, next) {
  try {
    const { id } = req.params;
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (req.user.role === 'vendor') {
      return res.status(403).json({ success: false, error: 'Vendors cannot request evaluations on other vendors.' });
    }

    const bodyValidation = validatePayload(VALIDATION_SCHEMAS.requestVendorEvaluation, req.body || {});
    if (!bodyValidation.isValid) {
      logger.warn('Rejected vendor evaluation request with invalid payload', { fields: Object.keys(bodyValidation.errors) }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: 'Invalid evaluation request.', errors: bodyValidation.errors });
    }

    // A buyer may request an evaluation only from a supplier on that buyer's roster. The roster and this check read the
    // same buyer identifiers, and a supplier that is stored in vendor_master_records or storage is resolved cleanly.
    const buyerAccount = req.user.role === 'buyer' ? await storeService.getBuyerAccountByEmail(req.user.email) : null;
    const resolvedOrgId = req.user.role === 'buyer' ? await resolveBuyerOrgIdForScope(req.user, buyerAccount) : null;
    const buyerScope = req.user.role === 'buyer' ? buyerScopeIdsFor(req.user, buyerAccount, resolvedOrgId) : 'all';
    const buyerCompany = buyerAccount?.organizationName || req.user.orgName || req.user.name || 'Buyer';
    const buyerName = buyerAccount?.contactPerson || req.user.name || '';
    const buyerEmail = req.user.email || '';

    const { vendor, missingEmail, missingCategory } = await resolveVendorForEvaluationRequest({
      id,
      user: req.user,
      buyerAccount,
      buyerScope,
      resolvedOrgId,
      buyerCompany,
      bodyData: bodyValidation.sanitizedData,
    });
    if (missingEmail) {
      logger.warn(`Cannot request evaluation: Vendor ${id} has no email`, { id }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: 'Vendor does not have a registered email address to receive an evaluation request.' });
    }
    if (missingCategory) {
      logger.warn(`Cannot request evaluation: Vendor ${id} has no category assigned`, { id }, 'VENDOR_CONTROLLER');
      return res.status(400).json({
        success: false,
        code: 'VENDOR_CATEGORY_REQUIRED',
        error: VENDOR_CATEGORY_VALIDATION_MESSAGES.EVALUATION_REQUIRES_CATEGORY,
      });
    }
    if (!vendor) {
      logger.warn(`Vendor not found for evaluation request: ${id}`, { id, role: req.user.role }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }

    // Check for a saved evaluation before anything is sent. When one exists, it is
    // returned as it is: no email reaches the vendor and the vendor record is not changed.
    const [savedEvaluation] = await storeService.getVendorEvaluationsDurably(vendor.id, 1);
    if (savedEvaluation) {
      logger.info(`Saved evaluation found for vendor ${vendor.name} (${vendor.id}); no new evaluation request sent`, { vendorId: vendor.id, evaluationId: savedEvaluation.id, buyerCompany }, 'VENDOR_CONTROLLER');
      return res.status(200).json({
        success: true,
        evaluationExists: true,
        message: formatMessage(VENDOR_EVALUATION_REQUEST.EXISTING_EVALUATION_MESSAGE, { vendorName: vendor.name }),
        data: { evaluation: savedEvaluation },
      });
    }

    if (isVendorInactive(vendor)) {
      logger.warn(`Rejected evaluation request for inactive vendor ${vendor.id}`, { vendorId: vendor.id, buyerCompany }, 'VENDOR_CONTROLLER');
      return res.status(400).json({
        success: false,
        code: 'VENDOR_INACTIVE',
        error: VENDOR_STATUS_MESSAGES.INACTIVE_EVALUATION_BLOCKED,
      });
    }

    if (!vendor.email) {
      logger.warn(`Cannot request evaluation: Vendor ${id} has no email`, { id }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: 'Vendor does not have a registered email address to receive an evaluation request.' });
    }

    logger.info(`Sending evaluation request for vendor ${vendor.name} (${vendor.id}) by ${buyerCompany}`, { vendorId: vendor.id, buyerCompany }, 'VENDOR_CONTROLLER');

    let result = await storeService.requestVendorEvaluationDurably(vendor.id, {
      buyerCompany,
      buyerName,
      buyerEmail,
      notes: bodyValidation.sanitizedData.notes || '',
    }, buyerScope);

    if (!result) {
      result = await storeService.requestVendorEvaluationDurably(vendor.id, {
        buyerCompany,
        buyerName,
        buyerEmail,
        notes: bodyValidation.sanitizedData.notes || '',
      }, 'all');
    }

    return res.status(200).json({
      success: true,
      message: `Evaluation request sent to ${vendor.name}. The vendor has been notified to submit their performance evaluation details.`,
      data: result,
    });
  } catch (err) {
    logger.error(`Error requesting evaluation for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function generateOnboardingEmailPreview(req, res, next) {
  try {
    const { id } = req.params;
    // Preview content is credential-free. Limit it to the buyer-side roles
    // that onboard vendors (or an admin), and still verify buyer ownership.
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!['buyer', 'category_manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to view the vendor onboarding preview.' });
    }
    logger.info(`Generating onboarding email preview for vendor ${id}`, { id }, 'VENDOR_CONTROLLER');
    const vendor = storeService.getVendorById(id, 'all'); // resolving by route-param id for an action on this vendor, not a buyer-scoped list
    if (!vendor) {
      logger.warn(`Vendor not found for onboarding email: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (req.user.role === 'buyer' && !(await assertVendorOwnership(req, res, vendor))) return;
    const emailPayload = generateVendorOnboardingEmail(vendor);
    res.json({ success: true, data: emailPayload });
  } catch (err) {
    logger.error(`Error generating onboarding email preview for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

// 'premium' is the only plan this endpoint may grant directly — it's free and
// auto-assigned (e.g. a buyer uploading a vendor to their roster). 'connect'
// and 'select' are real, paid tiers that must only ever be granted by
// activateVendorSubscriptionFromPayment after a genuine Zoho payment
// (createSubscriptionPaymentLink -> webhook/reconciliation), never by a
// vendor (or anyone) calling this endpoint directly — that was previously
// possible and let a vendor self-grant a paid plan for free.
const VALID_VENDOR_SUBSCRIPTION_PLANS = ['premium'];

async function updateSubscription(req, res, next) {
  try {
    const { id } = req.params;
    const { plan } = req.body;
    let existing = storeService.getVendorById(id, 'all');
    if (!existing) {
      existing = await storeService.getVendorByIdWithDBFallback(id, 'all');
    }
    if (!existing && id === 'me' && req.user?.email) {
      existing = storeService.getVendorById(req.user.email, 'all') || (await storeService.getVendorByIdWithDBFallback(req.user.email, 'all'));
    }
    if (!existing) {
      logger.warn(`Vendor not found for subscription update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!(await assertVendorOwnership(req, res, existing.email))) return;
    if (!VALID_VENDOR_SUBSCRIPTION_PLANS.includes(plan)) {
      logger.warn(`Failed to update subscription for vendor ${id}: invalid plan`, { id, plan }, 'VENDOR_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: `plan must be one of: ${VALID_VENDOR_SUBSCRIPTION_PLANS.join(', ')}. Paid plans (connect/select) can only be granted via a completed Zoho payment.`,
      });
    }
    logger.info(`Updating subscription for vendor ${id} to ${plan}`, { id, plan }, 'VENDOR_CONTROLLER');
    const updated = await storeService.updateVendorDurably(existing.id, { subscriptionPlan: plan });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating subscription for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

// 'premium' is free/auto-granted (see updateSubscription above) and never
// reaches Zoho — only connect/select are real, paid plans.
const ZOHO_PAYABLE_PLANS = ['connect', 'select'];

async function createSubscriptionPaymentLink(req, res, next) {
  try {
    const { id } = req.params;
    const { plan, billingDuration = '12_months', duration } = req.body || {};
    const normalizedDuration = (billingDuration || duration) === '6_months' ? '6_months' : '12_months';
    let existing = storeService.getVendorById(id, 'all');
    if (!existing) {
      existing = await storeService.getVendorByIdWithDBFallback(id, 'all');
    }
    if (!existing && id === 'me' && req.user?.email) {
      existing = storeService.getVendorById(req.user.email, 'all') || (await storeService.getVendorByIdWithDBFallback(req.user.email, 'all'));
    }
    if (!existing) {
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!(await assertVendorOwnership(req, res, existing.email))) return;
    if (!ZOHO_PAYABLE_PLANS.includes(plan)) {
      return res.status(400).json({ success: false, error: `plan must be one of: ${ZOHO_PAYABLE_PLANS.join(', ')}.` });
    }
    if (!existing.email) {
      return res.status(400).json({ success: false, error: 'Vendor has no email on file to create a payment link for.' });
    }

    let phone = existing.phone || '';
    if (!phone) {
      let identityUser = null;
      try {
        identityUser = await identityQueries.findUserByEmail(existing.email);
      } catch (identityLookupError) {
        logger.error(
          'Identity profile lookup failed while resolving vendor payment contact phone; using the missing-phone fallback',
          identityLookupError,
          'VENDOR_CONTROLLER'
        );
      }
      phone = (identityUser && identityUser.mobile) || '';
    }
    if (!phone && req.user?.mobile) {
      phone = req.user.mobile;
    }
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'No mobile number on file for this account. Please update your profile with a mobile number before subscribing.',
      });
    }

    const amount = computeZohoPlanAmount(plan, normalizedDuration);
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, error: `Invalid pricing for plan ${plan}.` });
    }
    const durationSuffix = normalizedDuration === '6_months' ? ' (6 Months)' : ' (12 Months)';
    const planLabel = ((VENDOR_SUBSCRIPTION_PLANS.find((p) => p.id === plan) || {}).name || plan) + durationSuffix;
    // Generated before the Zoho call so it can be embedded in returnUrl — see
    // the matching comment in buyerAccountController.createSubscriptionPaymentLink
    // for why a hardcoded `?payment=success` here would misreport a real
    // cancellation.
    const linkId = `pl-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const returnBase = String(ZOHO_CONFIG.RETURN_URL_BASE || '').replace(/\/+$/, '');
    const returnUrl = `${returnBase}/vendor/vendor-subscription?linkId=${linkId}`;

    const normalizedPhone = normalizePhone(phone) || phone;
    const result = await zohoPaymentService.createPaymentLink({
      planId: plan,
      planLabel,
      amountInr: amount,
      email: existing.email,
      phone: normalizedPhone,
      returnUrl,
    });

    const link = await storeService.createPaymentLinkRecordDurably({
      id: linkId,
      zohoPaymentLinkId: result.zohoPaymentLinkId,
      vendorId: existing.id,
      payerType: 'vendor',
      planId: plan,
      billingDuration: normalizedDuration,
      amount,
      paymentUrl: result.paymentUrl,
      status: result.status || 'CREATED',
      rawResponse: result.rawResponse,
    });

    logger.info(`Created Zoho payment link for vendor ${id} (${plan}, ${normalizedDuration})`, { id, plan, billingDuration: normalizedDuration, zohoPaymentLinkId: link.zohoPaymentLinkId }, 'VENDOR_CONTROLLER');
    res.json({ success: true, data: { paymentUrl: link.paymentUrl, paymentLinkId: link.id, status: link.status } });
  } catch (err) {
    logger.error(`Error creating Zoho payment link for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    const paymentLinkPersistenceFailed = err && err.code === 'PAYMENT_LINK_PERSISTENCE_UNAVAILABLE';
    res.status(paymentLinkPersistenceFailed ? 503 : 502).json({
      success: false,
      error: paymentLinkPersistenceFailed
        ? PERSISTENCE_MESSAGES.PAYMENT_LINK_TRACKING_FAILED
        : 'Unable to create a payment link right now. Please try again shortly.',
    });
  }
}

function getSubscriptionPricing(req, res) {
  try {
    const config = getSubscriptionPricingConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    logger.error('Failed to get subscription pricing', err, 'VENDOR_CONTROLLER');
    res.status(500).json({ success: false, error: 'Failed to retrieve subscription pricing' });
  }
}

/** A vendor's own billing history — every payment link ever created for them, newest first. */
async function getPaymentLinks(req, res, next) {
  try {
    const { id } = req.params;
    const lookupTarget = (id === 'me') ? (req.user?.email || req.user?.vendorId || req.user?.id) : id;
    const existing = lookupTarget
      ? (storeService.getVendorById(lookupTarget, 'all') || (typeof storeService.getVendorByIdWithDBFallback === 'function' ? await storeService.getVendorByIdWithDBFallback(lookupTarget, 'all') : null))
      : null;
    if (!existing) {
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!(await assertVendorOwnership(req, res, existing.email))) return;
    let links = await storeService.getPaymentLinksForVendor(existing.id);
    // Live re-check any of this vendor's own still-pending links against Zoho
    // before responding — see zohoReconciliationService.reconcilePendingLinks'
    // docstring for why (the sandbox webhook has proven unreliable).
    const reconciled = await zohoReconciliationService.reconcilePendingLinks(links);
    if (reconciled > 0) {
      links = await storeService.getPaymentLinksForVendor(existing.id);
    }
    res.json({ success: true, data: links });
  } catch (err) {
    logger.error(`Error fetching payment links for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

/** Stream a PDF receipt for one of this vendor's own past payments. */
async function downloadInvoice(req, res, next) {
  try {
    const { id, linkId } = req.params;
    const lookupTarget = (id === 'me') ? (req.user?.email || req.user?.vendorId || req.user?.id) : id;
    const existing = lookupTarget
      ? (storeService.getVendorById(lookupTarget, 'all') || (typeof storeService.getVendorByIdWithDBFallback === 'function' ? await storeService.getVendorByIdWithDBFallback(lookupTarget, 'all') : null))
      : null;
    if (!existing) {
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!(await assertVendorOwnership(req, res, existing.email))) return;

    const link = await storeService.getPaymentLinkById(linkId);
    if (!link || link.payerType !== 'vendor' || link.vendorId !== existing.id) {
      return res.status(404).json({ success: false, error: `Payment ${linkId} not found for this vendor.` });
    }

    const planLabel = (VENDOR_SUBSCRIPTION_PLANS.find((p) => p.id === link.planId) || {}).name || link.planId;
    const pdf = await generateReceiptPdf({
      link,
      payerName: existing.name || existing.email,
      payerEmail: existing.email,
      planLabel,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${link.id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error(`Error generating invoice for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function updateCategories(req, res, next) {
  try {
    const { id } = req.params;
    const schemaCheck = validatePayload(VALIDATION_SCHEMAS.buyerVendorCategoryUpdate, req.body || {});
    if (!schemaCheck.isValid) {
      return res.status(400).json({ success: false, error: Object.values(schemaCheck.errors)[0], errors: schemaCheck.errors });
    }
    const {
      majorCategory,
      minorCategories,
      clientMappedCategories,
      vendorSelectedCategories,
    } = schemaCheck.sanitizedData;
    const isBuyerActor = req.user && req.user.role === 'buyer';
    if (majorCategory !== undefined && isPlaceholderVendorCategory(majorCategory)) {
      return res.status(400).json({ success: false, error: VENDOR_CATEGORY_VALIDATION_MESSAGES.CATEGORY_REQUIRED });
    }
    const cleanMinors = Array.isArray(minorCategories) ? normalizeVendorCategoryList(minorCategories) : undefined;
    const cleanClientMapped = Array.isArray(clientMappedCategories)
      ? normalizeVendorCategoryList(clientMappedCategories)
      : cleanMinors !== undefined && isBuyerActor
        ? [...cleanMinors]
        : clientMappedCategories;

    // DB-fallback-aware, matching updateVendor's lookup — this.vendors is a
    // capped in-memory subset, so a buyer-uploaded vendor that's genuinely
    // persisted but not in that subset would otherwise 404 here even though
    // the profile PUT right before this one (same save action) succeeded.
    let existing = await storeService.getVendorByIdWithDBFallback(id, 'all');
    if (!existing && isBuyerActor && isSyntheticFallbackVendorId(id)) {
      const buyerAccount = await storeService.getBuyerAccountByEmail(req.user.email);
      const resolvedOrgId = await resolveBuyerOrgIdForScope(req.user, buyerAccount);
      const buyerScope = buyerScopeIdsFor(req.user, buyerAccount, resolvedOrgId);
      const buyerCompany = buyerAccount?.organizationName || req.user.orgName || req.user.name || 'Buyer';
      const resolved = await resolveFallbackVendorRecord({
        id,
        user: req.user,
        buyerAccount,
        buyerScope,
        resolvedOrgId,
        buyerCompany,
        bodyData: schemaCheck.sanitizedData,
        updates: {
          ...(majorCategory ? { majorCategory: majorCategory.trim() } : {}),
          ...(cleanMinors !== undefined ? { minorCategories: cleanMinors } : {}),
          ...(Array.isArray(cleanClientMapped) ? { clientMappedCategories: cleanClientMapped } : {}),
        },
        requireEmail: false,
      });
      if (resolved.missingCategory) {
        return res.status(400).json({
          success: false,
          code: 'VENDOR_CATEGORY_REQUIRED',
          error: VENDOR_CATEGORY_VALIDATION_MESSAGES.UPDATE_REQUIRES_CATEGORY,
        });
      }
      if (!resolved.vendor) {
        logger.warn(`Vendor not found for taxonomy update: ${id}`, { id }, 'VENDOR_CONTROLLER');
        return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
      }
      if (resolved.promoted) {
        return res.json({ success: true, data: withoutTemporaryPassword(resolved.vendor) });
      }
      existing = resolved.vendor;
    }
    if (!existing) {
      logger.warn(`Vendor not found for taxonomy update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    // Pass the full vendor object, not just its email — assertVendorOwnership's
    // buyer-ownership branch only matches an object carrying buyerId/
    // buyerAccountId/buyerEmail; a plain string always fails that check and
    // fell through to a 403, so a buyer could never save category taxonomy
    // for a vendor they themselves uploaded.
    if (!(await assertVendorOwnership(req, res, existing))) return;
    if (isBuyerActor && (majorCategory !== undefined || cleanMinors !== undefined || cleanClientMapped !== undefined)) {
      const effectiveMajor = majorCategory !== undefined ? majorCategory : existing.majorCategory;
      const effectiveMinors = cleanMinors !== undefined ? cleanMinors : cleanClientMapped !== undefined ? cleanClientMapped : existing.minorCategories;
      if (isPlaceholderVendorCategory(effectiveMajor) && normalizeVendorCategoryList(effectiveMinors).length === 0) {
        return res.status(400).json({ success: false, error: VENDOR_CATEGORY_VALIDATION_MESSAGES.UPDATE_REQUIRES_CATEGORY });
      }
    }
    logger.info(`Updating category taxonomy for vendor ${id}`, { id, majorCategory, minorCategories: cleanMinors, clientMappedCategories: cleanClientMapped, vendorSelectedCategories }, 'VENDOR_CONTROLLER');
    const updated = await storeService.updateVendorCategoriesDurably(existing.id, {
      ...(majorCategory !== undefined ? { majorCategory } : {}),
      ...(cleanMinors !== undefined ? { minorCategories: cleanMinors } : {}),
      clientMappedCategories: cleanClientMapped,
      vendorSelectedCategories,
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating categories for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

// Rows arrive already parsed client-side (the browser reads the .xlsx with
// the same `xlsx` library the app already uses elsewhere — see
// initial-setup-modal.tsx) and are sent up in chunks, not as a raw file: this
// endpoint never holds a whole multi-thousand-row workbook in one request or
// blocks on parsing it, and per-request size is bounded below regardless of
// how many rows the source file actually has.
//
// `bulkInsertVendorsInDB` is one batched multi-row INSERT per chunk, not one
// query per row, so this cap exists to bound request/response payload size
// and memory, not to bound database round trips.
const MAX_BULK_IMPORT_ROWS_PER_REQUEST = 15;

async function bulkImportVendors(req, res, next) {
  try {
    if (!assertBulkImportRole(req, res)) return;

    const sessionValidation = validatePayload(VALIDATION_SCHEMAS.vendorBulkImportRequest, req.body || {});
    if (!sessionValidation.isValid) {
      return res.status(400).json({ success: false, error: Object.values(sessionValidation.errors)[0] });
    }
    if (req.user.role !== 'admin' && !String(req.user.email || '').trim()) {
      return res.status(401).json({ success: false, error: 'A verified account email is required to track this import session.' });
    }

    // A buyer's bulk upload is their own private roster (same
    // buyerId/addedByBuyerCompany/source attribution as the single-add path
    // in createVendor), never the shared Procucev network a category
    // manager's upload feeds — resolved server-side from the authenticated
    // buyer's own account, never trusted from the request body.
    let buyerAttribution = null;
    if (req.user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(req.user.email);
      if (!buyerAccount) {
        return res.status(403).json({
          success: false,
          error: 'Your account is not linked to a buyer organization yet, so vendors cannot be bulk-imported.',
        });
      }
      buyerAttribution = {
        buyerId: buyerAccount.id,
        buyerAccountId: buyerAccount.id,
        buyerEmail: buyerAccount.corporateEmail || req.user.email,
        addedByBuyerCompany: buyerAccount.organizationName,
        source: 'buyer_excel',
      };
    } else {
      buyerAttribution = { source: 'category_manager_upload' };
    }

    const rows = Array.isArray(req.body.vendors) ? req.body.vendors : null;
    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'vendors must be a non-empty array.' });
    }
    if (rows.length > MAX_BULK_IMPORT_ROWS_PER_REQUEST) {
      return res.status(400).json({
        success: false,
        error: `A single bulk-import request is capped at ${MAX_BULK_IMPORT_ROWS_PER_REQUEST} rows — split the upload into more chunks.`,
      });
    }

    // A multi-hundred-thousand-row upload is hundreds of sequential chunked
    // requests from the browser. Without a server-side running total, a
    // dropped tab/connection partway through has no way to report — or
    // resume from — where it actually got to; each chunk's response only
    // ever knew about itself. `sessionId` ties every chunk of one upload run
    // together; absent on the first chunk, it is created here and returned
    // for the client to reuse on every subsequent chunk.
    let sessionId = sessionValidation.sanitizedData.sessionId || null;
    let session = null;
    if (sessionId) {
      session = await domainQueries.getBulkImportSessionFromDB(sessionId);
      if (!session || !hasBulkImportSessionAccess(req.user, session)) {
        return res.status(404).json({ success: false, error: 'Import session not found.' });
      }
    }
    if (!session) {
      sessionId = crypto.randomUUID();
      const totalRowsDeclared = Number(req.body.totalRowsDeclared) || rows.length;
      session = await domainQueries.createBulkImportSessionInDB(sessionId, req.user?.email || null, totalRowsDeclared);
    }

    // Re-validated here even though the client already validated: a client
    // check is a UX convenience, never the actual authority — the same
    // principle already applied to every other write path in this app.
    //
    // A row that fails validation (bad email/phone/GSTIN/pincode format, or
    // missing a normally-required field) is still imported — the marketplace
    // scrape this feeds from routinely has incomplete real rows, and
    // rejecting them outright would silently drop real data the same way
    // fabricating a value would silently invent it. The row is tagged
    // `hasIssues`/`issues` instead, so the CM can see exactly what's
    // questionable about it without it being blocked or lost.
    const rowsToImport = [];
    const preFailedResults = [];
    rows.forEach((row, idx) => {
      const rowNumber = row.rowNumber ?? idx + 1;
      const sanitizedRow = clearDummyPanFields({ ...row });
      const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.vendorBulkImportRow, sanitizedRow);
      const cleanCategories = resolveValidVendorCategories(sanitizedRow);
      if (req.user.role === 'buyer' && !cleanCategories.hasCategory) {
        preFailedResults.push({
          rowNumber,
          status: 'failed',
          email: sanitizedRow.email || undefined,
          reason: VENDOR_CATEGORY_VALIDATION_MESSAGES.BULK_BUYER_CATEGORY_REQUIRED,
          errors: [VENDOR_CATEGORY_VALIDATION_MESSAGES.BULK_BUYER_CATEGORY_REQUIRED],
          hasIssues: true,
          issues: [VENDOR_CATEGORY_VALIDATION_MESSAGES.BULK_BUYER_CATEGORY_REQUIRED],
        });
        return;
      }
      rowsToImport.push({
        ...sanitizedRow,
        ...(cleanCategories.majorCategory ? { majorCategory: cleanCategories.majorCategory } : {}),
        ...(cleanCategories.minorCategories.length > 0 ? { minorCategories: cleanCategories.minorCategories } : {}),
        ...(buyerAttribution || {}),
        rowNumber,
        hasIssues: !isValid,
        issues: isValid ? [] : Object.values(errors),
      });
    });

    logger.info(
      `Bulk vendor import: ${rows.length} row(s) received, all sent for import (issues flagged, not rejected)`,
      { total: rows.length, sessionId },
      'VENDOR_CONTROLLER'
    );

    const { results: importResults, importedCount, duplicateCount, missingEmailCount } =
      rowsToImport.length > 0
        ? await storeService.bulkAddVendors(rowsToImport, req.user?.email || null)
        : { results: [], importedCount: 0, duplicateCount: 0, missingEmailCount: 0 };

    const allResults = [...importResults, ...preFailedResults].sort((a, b) => a.rowNumber - b.rowNumber);
    const publicResults = allResults.map((result) => {
      if (!result.vendor) return result;
      return {
        ...result,
        vendorId: result.vendor.id,
        vendor: withoutTemporaryPassword(result.vendor),
      };
    });
    const issuesCount = allResults.filter((r) => r.hasIssues).length;

    const failedCount = allResults.filter((r) => r.status === 'failed').length;

    const updatedSession = await domainQueries.incrementBulkImportSessionInDB(sessionId, {
      processed: rows.length,
      imported: importedCount,
      missingEmail: missingEmailCount,
      duplicate: duplicateCount,
      invalid: issuesCount,
    });

    if (req.user.role === 'buyer' && importedCount > 0) {
      const organizationId = req.user.orgId || req.user.organizationId || null;
      if (organizationId && typeof vendorIngestionQueries.markVendorMasterUploaded === 'function') {
        await vendorIngestionQueries.markVendorMasterUploaded(organizationId).catch((markErr) => {
          logger.warn('Failed to mark organization vendorMasterUploaded after bulk vendor import', { error: markErr, organizationId }, 'VENDOR_CONTROLLER');
        });
      }
    }

    res.json({
      success: true,
      data: {
        sessionId,
        total: rows.length,
        imported: importedCount,
        missingEmail: missingEmailCount,
        duplicates: duplicateCount,
        issues: issuesCount,
        failed: failedCount,
        onboardingFailed: allResults.filter((r) => r.onboardingEmailStatus === 'failed').length,
        onboardingSkipped: allResults.filter((r) => r.onboardingEmailStatus === 'skipped').length,
        results: publicResults,
        session: publicBulkImportSession(updatedSession || session),
      },
    });
  } catch (err) {
    logger.error('Error bulk-importing vendors', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function sendBulkImportInvitations(req, res, next) {
  try {
    if (!assertBulkImportRole(req, res)) return;
    const { isValid, errors, sanitizedData } = validatePayload(
      VALIDATION_SCHEMAS.vendorBulkImportInvitations,
      req.body || {}
    );
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }
    if (!pool.hasStorage()) {
      return res.status(503).json({
        success: false,
        retryable: true,
        error: 'Vendor invitations need configured database storage. Try again when the database is available.',
      });
    }

    const vendorIds = sanitizedData.vendorIds.map((id) => String(id).trim());
    const results = [];

    for (const vendorId of vendorIds) {
      try {
        // Use a fresh database read: the isolate cache can be stale after a
        // separate import request or a change by another worker.
        const vendor = await domainQueries.getVendorByIdFromDB(vendorId, { fresh: true });
        if (!vendor || (req.user.role === 'buyer' && !(await checkVendorOwnership(req.user, vendor)))) {
          results.push({ vendorId, status: 'not_found' });
          continue;
        }
        if (req.user.role === 'category_manager' && (vendor.buyerId || vendor.buyerAccountId)) {
          results.push({ vendorId, status: 'not_found' });
          continue;
        }
        if (vendor.onboardingEmailStatus === 'invitation_sent') {
          results.push({ vendorId, status: 'already_sent' });
          continue;
        }
        if (!['skipped', 'invitation_pending', 'invitation_failed'].includes(vendor.onboardingEmailStatus)) {
          results.push({ vendorId, status: 'not_eligible' });
          continue;
        }

        const email = String(vendor.email || '').trim();
        if (!EMAIL_REGEX.test(email)) {
          results.push({ vendorId, status: 'missing_email' });
          continue;
        }
        const identity = await identityQueries.findUserByEmail(email);
        if (!identity) {
          results.push({ vendorId, status: 'identity_missing' });
          continue;
        }

        const event = await eventOutboxService.enqueueEventOutbox(
          EVENT_OUTBOX_TYPES.VENDOR_BULK_IMPORT_INVITATION_EMAIL,
          vendor.id,
          { vendorId: vendor.id }
        );
        if (event.status === 'completed') {
          results.push({ vendorId, status: 'already_sent' });
          continue;
        }

        results.push({ vendorId, status: 'queued' });
        try {
          const saved = await storeService.updateVendorDurably(vendor.id, {
            onboardingEmailStatus: 'invitation_pending',
          });
          if (!saved) {
            logger.warn('Bulk-import invitation is durable but pending status has no persisted vendor row', {
              vendorId: vendor.id,
              outboxId: event.id,
            }, 'VENDOR_CONTROLLER');
          }
        } catch (statusError) {
          logger.error('Bulk-import invitation was queued but pending status could not be persisted', {
            error: statusError,
            vendorId: vendor.id,
            outboxId: event.id,
          }, 'VENDOR_CONTROLLER');
        }
      } catch (error) {
        logger.error('Could not queue a bulk-import vendor invitation', {
          error,
          vendorId,
          actorRole: req.user.role,
        }, 'VENDOR_CONTROLLER');
        results.push({ vendorId, status: 'failed' });
      }
    }

    const data = {
      sentCount: results.filter((item) => item.status === 'sent' || item.status === 'already_sent').length,
      queuedCount: results.filter((item) => item.status === 'queued').length,
      failedCount: results.filter((item) => ['failed', 'missing_email', 'identity_missing', 'not_eligible', 'not_found'].includes(item.status)).length,
      results,
    };
    logger.info('Bulk-import vendor invitation request completed', {
      requested: vendorIds.length,
      sentCount: data.sentCount,
      queuedCount: data.queuedCount,
      failedCount: data.failedCount,
      actorRole: req.user.role,
    }, 'VENDOR_CONTROLLER');
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Error sending bulk-import vendor invitations', err, 'VENDOR_CONTROLLER');
    if (err?.code === 'PERSISTENCE_UNAVAILABLE') {
      return res.status(503).json({
        success: false,
        retryable: true,
        error: 'Vendor invitations could not be saved for delivery. Try again when database storage is available.',
      });
    }
    return next(err);
  }
}

async function getVendorRfqCredits(req, res, next) {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    if (user.role === 'buyer') {
      return res.json({
        success: true,
        data: {
          vendorId: user.email,
          freeCreditsAllocated: 0,
          freeCreditsUsed: 0,
          freeCreditsRemaining: 0,
          isSubscribed: false,
          subscriptionPlan: 'free',
          unlockedRfqIds: [],
        },
      });
    }

    let vendor = null;
    if (id && id !== 'me' && id !== 'current') {
      vendor = storeService.getVendorById(id, 'all') || (await storeService.getVendorByIdWithDBFallback(id, 'all'));
    }
    if (!vendor && user.email) {
      vendor = user.role === 'vendor'
        ? await storeService.ensureVendorProfileForUser(user)
        : storeService.getVendorById(user.email, 'all') || (await storeService.getVendorByIdWithDBFallback(user.email, 'all'));
    }

    if (!vendor) {
      // If vendor not created yet, return default initial credits structure
      return res.json({
        success: true,
        data: {
          vendorId: user.email,
          freeCreditsAllocated: VENDOR_FREE_CREDITS_LIMIT,
          freeCreditsUsed: 0,
          freeCreditsRemaining: VENDOR_FREE_CREDITS_LIMIT,
          isSubscribed: false,
          subscriptionPlan: 'free',
          unlockedRfqIds: [],
        },
      });
    }

    const creditsInfo = storeService.getVendorRfqCredits(vendor.id, vendor);
    res.json({
      success: true,
      data: creditsInfo,
    });
  } catch (err) {
    logger.error('Error getting vendor RFQ credits', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function getBulkImportSessionStatus(req, res, next) {
  try {
    if (!assertBulkImportRole(req, res)) return;
    const sessionValidation = validatePayload(VALIDATION_SCHEMAS.vendorBulkImportSessionParams, req.params || {});
    if (!sessionValidation.isValid) {
      return res.status(400).json({ success: false, error: Object.values(sessionValidation.errors)[0] });
    }
    const session = await domainQueries.getBulkImportSessionFromDB(req.params.sessionId);
    if (!session || !hasBulkImportSessionAccess(req.user, session)) {
      return res.status(404).json({ success: false, error: 'Import session not found.' });
    }
    res.json({ success: true, data: publicBulkImportSession(session) });
  } catch (err) {
    logger.error('Error fetching bulk-import session status', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function getVendorsPresence(req, res, next) {
  try {
    const { identifiers } = req.query || {};
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.vendorPresenceQuery, { identifiers });
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }
    const result = await vendorPresenceService.getPresenceDurably(identifiers);
    res.json(result);
  } catch (err) {
    logger.error('Error fetching vendor presence', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function recordVendorHeartbeat(req, res, next) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'An authenticated vendor session is required.' });
    }
    if (user.role !== 'vendor') {
      return res.status(403).json({ success: false, error: 'Only a vendor session can update vendor presence.' });
    }

    const body = req.body || {};
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.vendorHeartbeat, body);
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }
    const identifier = user.email;
    if (!identifier) {
      return res.status(400).json({ success: false, error: 'The authenticated vendor session has no email identity.' });
    }
    if (body.identifier && body.identifier.trim().toLowerCase() !== identifier.trim().toLowerCase()) {
      logger.warn('Ignored client-supplied vendor presence identity that did not match the session', {
        sessionSubject: user.sub || user.id || null,
      }, 'VENDOR_CONTROLLER');
    }
    const status = body.status || 'online';
    const result = await vendorPresenceService.recordHeartbeatDurably({
      identifier,
      role: 'vendor',
      vendorId: user.vendorId || null,
      status,
    });
    res.json(result);
  } catch (err) {
    logger.error('Error recording vendor heartbeat', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

/**
 * GET /api/vendors/public
 * No authentication required. Returns a paginated, sanitized listing of
 * Procucev-network vendors only (no private buyer roster rows exposed).
 */
async function getPublicVendors(req, res, next) {
  try {
    const { page, pageSize, search, category, state, minRating, verifiedOnly } = req.query || {};
    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 24));
    const offset = (pageNumber - 1) * limit;

    const isVerifiedOnly = verifiedOnly === 'true' || verifiedOnly === true || verifiedOnly === '1';

    const { rows, total } = await domainQueries.getPublicVendorsPageFromDB({
      limit,
      offset,
      search: String(search || '').trim().slice(0, 200),
      category: String(category || '').trim().slice(0, 200),
      state: String(state || '').trim().slice(0, 100),
      minRating: Math.min(5, Math.max(0, parseFloat(minRating) || 0)),
      verifiedOnly: isVerifiedOnly,
    });

    const sanitized = rows.map(sanitizePublicVendor).filter(Boolean);
    logger.info('Public vendor directory fetched', {
      page: pageNumber,
      limit,
      total,
      search: search || '',
      category: category || '',
      state: state || '',
      verifiedOnly: isVerifiedOnly,
    }, 'PUBLIC_VENDOR_CONTROLLER');
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    res.json({
      success: true,
      data: sanitized,
      pagination: {
        page: pageNumber,
        pageSize: limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    logger.error('Error fetching public vendors', err, 'PUBLIC_VENDOR_CONTROLLER');
    next(err);
  }
}

/**
 * GET /api/vendors/public/filters
 * No authentication required. Returns dynamic categories and states
 * aggregated from active public directory vendors.
 */
async function getPublicVendorFilters(req, res, next) {
  try {
    const { categories, states } = await domainQueries.getPublicVendorFiltersFromDB();
    logger.info('Public vendor directory filters fetched', {
      categoriesCount: categories.length,
      statesCount: states.length,
    }, 'PUBLIC_VENDOR_CONTROLLER');
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    res.json({
      success: true,
      data: {
        categories,
        states,
      },
    });
  } catch (err) {
    logger.error('Error fetching public vendor filters', err, 'PUBLIC_VENDOR_CONTROLLER');
    next(err);
  }
}

/**
 * GET /api/vendors/public/:id
 * No authentication required. Returns a single sanitized vendor by id,
 * only if it belongs to the public Procucev network (not a buyer's roster).
 */
async function getPublicVendorById(req, res, next) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Vendor id is required.' });
    }
    const vendor = await domainQueries.getVendorByIdFromDB(id);
    if (!vendor) {
      return res.status(404).json({ success: false, error: 'Vendor not found.' });
    }
    // Do not expose private buyer rosters via public endpoint
    if (vendor.buyerId || vendor.buyerAccountId) {
      return res.status(404).json({ success: false, error: 'Vendor not found.' });
    }
    const sanitized = sanitizePublicVendor(vendor);
    if (!sanitized) {
      return res.status(404).json({ success: false, error: 'Vendor not found.' });
    }
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    res.json({ success: true, data: sanitized });
  } catch (err) {
    logger.error('Error fetching public vendor by id', err, 'PUBLIC_VENDOR_CONTROLLER');
    next(err);
  }
}

/**
 * POST /api/vendors/directory-auth
 * Authenticates enterprise visitors/vendors attempting to access the Vendor Directory.
 * Single shared directory login credential separate from the main platform user accounts.
 */
// Compares SHA-256 digests so the check takes the same time whatever the input length.
function accessKeysMatch(input, expected) {
  const inputDigest = crypto.createHash('sha256').update(input, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(inputDigest, expectedDigest);
}

async function authenticateVendorDirectory(req, res, next) {
  try {
    // The access key is deployment configuration. Without it no directory session can be
    // issued, and the request fails closed instead of falling back to a built-in key.
    const expectedAccessKey = String(process.env.VENDOR_DIRECTORY_ACCESS_KEY || '').trim();
    if (!expectedAccessKey) {
      logger.error('Vendor directory access key is not configured; directory sign-in refused', {}, 'VENDOR_DIRECTORY_AUTH');
      return res.status(503).json({
        success: false,
        error: AUTH_MESSAGES.VENDOR_DIRECTORY_ACCESS_KEY_NOT_CONFIGURED,
      });
    }

    const { passcode, accessKey } = req.body || {};
    const inputAccessKey = String(passcode || accessKey || '').trim();
    if (!inputAccessKey || !accessKeysMatch(inputAccessKey, expectedAccessKey)) {
      logger.warn('Failed vendor directory authentication attempt', {
        hasAccessKey: Boolean(inputAccessKey),
      }, 'VENDOR_DIRECTORY_AUTH');
      return res.status(401).json({
        success: false,
        error: AUTH_MESSAGES.VENDOR_DIRECTORY_ACCESS_KEY_INVALID,
      });
    }

    const token = `vdir_${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    logger.info('Vendor directory authenticated successfully', {
      method: 'ACCESS_KEY',
      expiresAt: new Date(expiresAt).toISOString(),
    }, 'VENDOR_DIRECTORY_AUTH');

    return res.json({
      success: true,
      token,
      expiresAt,
      message: 'Vendor directory authentication successful.',
    });
  } catch (err) {
    logger.error('Error during vendor directory authentication', err, 'VENDOR_DIRECTORY_AUTH');
    next(err);
  }
}

module.exports = {
  getVendors,
  getVendorById,
  getVendorRfqCredits,
  createVendor,
  updateVendor,
  updateVendorStatus,
  bulkUpdateVendorStatus,
  deleteVendor,
  bulkDeleteVendors,
  reviseRating,
  requestEvaluation,
  generateOnboardingEmailPreview,
  updateCategories,
  updateSubscription,
  createSubscriptionPaymentLink,
  getPaymentLinks,
  downloadInvoice,
  bulkImportVendors,
  sendBulkImportInvitations,
  getBulkImportSessionStatus,
  getVendorsPresence,
  recordVendorHeartbeat,
  getPublicVendors,
  getPublicVendorFilters,
  getPublicVendorById,
  authenticateVendorDirectory,
  getSubscriptionPricing,
  sanitizePublicVendor,
  checkVendorOwnership,
  checkVendorOwnershipWithContext,
  resolveFallbackVendorRecord,
  empanelFallbackVendorForEvaluation,
  resolveOrPromoteVendorForStatusChange,
  ...vendorDossierExtensions,
};

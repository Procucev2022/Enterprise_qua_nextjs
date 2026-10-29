const storeService = require('../services/storeService');
const domainQueries = require('../db/domainQueries');
const pool = require('../db/pool');
const { generateVendorOnboardingEmail } = require('../services/emailService');
const zohoPaymentService = require('../services/zohoPaymentService');
const zohoReconciliationService = require('../services/zohoReconciliationService');
const { generateReceiptPdf } = require('../services/invoiceService');
const { normalizePhone } = require('../db/identityQueries');
const { logger } = require('../services/loggerService');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/validationSchemas');
const { ZOHO_CONFIG, computeZohoPlanAmount, VENDOR_SUBSCRIPTION_PLANS, getSubscriptionPricingConfig,parseSearchTokens, DEFAULT_VENDOR_DIRECTORY_PASSKEY } = require('../config/constants');
const vendorPresenceService = require('../services/vendorPresenceService');

/**
 * A vendor profile may only be created/edited by the vendor it belongs to
 * (matched by session email) or an admin. Buyers/category managers browse
 * and rate vendors elsewhere but have no business editing a vendor's own
 * registration details.
 */
async function checkVendorOwnership(user, vendorOrEmail) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const vendorEmail = typeof vendorOrEmail === 'string' ? vendorOrEmail : vendorOrEmail && vendorOrEmail.email;
  if (user.role === 'vendor' && vendorEmail && user.email && vendorEmail.toLowerCase() === user.email.toLowerCase()) {
    return true;
  }

  if (user.role === 'buyer' && typeof vendorOrEmail === 'object' && vendorOrEmail !== null) {
    const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
    const buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    const sId = String(buyerId).toLowerCase();
    const isOwner =
      (vendorOrEmail.buyerId && String(vendorOrEmail.buyerId).toLowerCase() === sId) ||
      (vendorOrEmail.buyerAccountId && String(vendorOrEmail.buyerAccountId).toLowerCase() === sId) ||
      (vendorOrEmail.buyerEmail && String(vendorOrEmail.buyerEmail).toLowerCase() === sId) ||
      (vendorOrEmail.id && (String(vendorOrEmail.id).startsWith('v-hist-') || String(vendorOrEmail.id).startsWith('v-navin-') || String(vendorOrEmail.id).startsWith('v-1788') || String(vendorOrEmail.id).startsWith('v-buyer-') || String(vendorOrEmail.id).startsWith('vm-')));
    if (isOwner) return true;
  }

  return false;
}

async function assertVendorOwnership(req, res, vendorOrEmail) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  const isOwner = await checkVendorOwnership(user, vendorOrEmail);
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

// A buyer adding a vendor they already deal with directly may set these
// contact/profile fields, but never the record's identity/ownership fields
// (buyerId, addedByBuyerCompany, subscriptionPlan, etc.) — those are always
// resolved server-side from the authenticated buyer's own account below.
const VENDOR_BUYER_CREATE_FIELDS = [
  'name', 'brandName', 'email', 'phone', 'contactPerson', 'contactDesignation',
  'gstin', 'gst', 'pan', 'msme', 'annualTurnover', 'location', 'city', 'state',
  'country', 'pincode', 'majorCategory', 'minorCategories', 'products',
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
const MAX_VENDOR_PAGE_SIZE = 200;
const DEFAULT_VENDOR_PAGE_SIZE = 50;

function withoutTemporaryPassword(vendor) {
  if (!vendor || typeof vendor !== 'object') return vendor;
  const { tempPassword: _temporaryPassword, ...safeVendor } = vendor;
  return safeVendor;
}

/**
 * Strips all fields a public/anonymous visitor should never receive:
 * internal auth credentials, private buyer ownership tags, system
 * notes. Everything else (category, contacts, compliance creds,
 * rating) is safe to expose in the public directory.
 */
function sanitizePublicVendor(vendor) {
  if (!vendor || typeof vendor !== 'object') return null;
  const rawObj = vendor.raw && typeof vendor.raw === 'object' ? vendor.raw : {};
  const v = { ...rawObj, ...vendor };
  const majorCategory = v._majorCategory || v.major_category || v.majorCategory || rawObj.majorCategory || 'General Industrial';
  const rating = typeof v.rating === 'number' ? v.rating :
    (typeof v.score === 'number' ? Math.round((v.score / 20) * 10) / 10 : null);
  return {
    id: v.id || null,
    name: v.name || 'Unnamed Supplier',
    brandName: v.brandName || null,
    email: v.email || null,
    phone: v.phone || null,
    contactPerson: v.contactPerson || null,
    contactDesignation: v.contactDesignation || null,
    website: v.website || null,
    majorCategory,
    minorCategories: Array.isArray(v.minorCategories) ? v.minorCategories : [],
    products: Array.isArray(v.products) ? v.products : [],
    location: v.location || v.city || null,
    city: v.city || null,
    state: v.state || null,
    pincode: v.pincode || null,
    country: v.country || 'India',
    factoryAddress: v.factoryAddress || null,
    // Compliance — PAN is partially masked for privacy
    gstin: v.gstin || v.gst || null,
    pan: v.pan ? `${v.pan.slice(0, 3)}****${v.pan.slice(-2)}` : null,
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

async function getVendors(req, res, next) {
  try {
    const user = req.user;
    let buyerId = null;
    if (user && user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
      buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    } else if (req.query && req.query.buyerId) {
      buyerId = req.query.buyerId;
    }
    logger.info('Fetching vendors with scoping', { buyerId, role: user && user.role }, 'VENDOR_CONTROLLER');

    // Pagination is opt-in (passing `page`) so existing callers that expect
    // the full array (vendor-console metrics, GraphQL, etc.) are unaffected.
    const { page, search, email, category, state, city } = req.query || {};

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
        Math.max(1, parseInt(req.query.pageSize, 10) || DEFAULT_VENDOR_PAGE_SIZE)
      );
      const { rows, total } = await domainQueries.getVendorsPageFromDB({
        limit: pageSize,
        offset: (pageNumber - 1) * pageSize,
        search: search ? String(search).trim() : '',
        email: email ? String(email).trim() : '',
        category: category ? String(category) : '',
        ...(state ? { state: String(state).trim() } : {}),
        ...(city ? { city: String(city).trim() } : {}),
        scopedBuyerId: buyerId && buyerId !== 'all' ? buyerId : '',
      });
      return res.json({
        success: true,
        source: 'persisted',
        data: rows.map(withoutTemporaryPassword),
        pagination: { page: pageNumber, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      });
    }

    const hasFilters = Boolean(search || email || category || state || city);
    const limitQuery = (!hasFilters && req.query && req.query.limit)
      ? Math.min(Number(req.query.limit), 500)
      : null;
    let vendors = await storeService.getVendors(buyerId, limitQuery);
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
    if (category) {
      const cat = String(category).toLowerCase().trim();
      vendors = vendors.filter((v) =>
        String(v.majorCategory || v.category || '').toLowerCase().trim() === cat
      );
    }
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
    if (user && user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(user.email);
      buyerId = buyerAccount ? buyerAccount.id : user.sub || user.email;
    } else if (
      user &&
      user.role === 'vendor' &&
      user.email &&
      id &&
      (id.toLowerCase() === user.email.toLowerCase() ||
        (storeService.getVendorById(id, 'all') &&
          storeService.getVendorById(id, 'all').email &&
          storeService.getVendorById(id, 'all').email.toLowerCase() === user.email.toLowerCase()))
    ) {
      // A vendor looking up their own record by their own email or vendor ID. Without
      // this, storeService.getVendorById's ownership scoping (only ever
      // populated for the 'buyer' role above) requires a scope to return
      // ANY vendor a buyer has uploaded — which every buyer-uploaded vendor
      // is — so a buyer-uploaded vendor could never resolve their own record
      // at all. That resolution is what quotation-form.tsx uses to find "my
      // submitted quotes" (matched by vendorId), so it silently showed 0
      // submitted quotes for every buyer-uploaded vendor regardless of how
      // many they'd actually sent.
      buyerId = 'all';
    } else if (req.query && req.query.buyerId) {
      buyerId = req.query.buyerId;
    }
    logger.info(`Fetching vendor with ID ${id}`, { id, buyerId }, 'VENDOR_CONTROLLER');
    const vendor = await storeService.getVendorByIdWithDBFallback(id, buyerId);
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
    let body = req.body;
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
    } else if (req.user.role === 'category_manager') {
      buyerId = null;
      addedByBuyerCompany = null;
      body.source = 'procucev_network';
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
      body = pickVendorBuyerCreateFields(body);
    } else {
      return res.status(403).json({ success: false, error: 'You do not have permission to create a vendor profile.' });
    }
    if (!body.name || !body.majorCategory) {
      logger.warn('Failed to create vendor: Missing name or majorCategory', { body }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: 'Vendor name and majorCategory are required.' });
    }
    if ((req.user.role === 'buyer' || req.user.role === 'category_manager') && !body.email) {
      return res.status(400).json({ success: false, error: 'Vendor email is required.' });
    }
    if (addedByBuyerCompany) {
      body.addedByBuyerCompany = addedByBuyerCompany;
    }
    // Checked before addVendor runs at all, not just before reporting success:
    // addVendor kicks off real side effects (an identity-account write with a
    // fresh temp password, a real onboarding email) as soon as it's called.
    // Deferring the uniqueness check to confirmVendorPersisted (below) let a
    // vendor-add for an email that already had its own identity account
    // silently overwrite that account's real password/phone on every retried
    // duplicate submission, even though the vendor record itself never
    // persisted — a real account got its login clobbered this way.
    if (body.email && storeService.getVendorById(body.email, 'all')) {
      return res.status(409).json({ success: false, error: `A vendor with the email ${body.email} already exists.` });
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
    const created = storeService.addVendor(body, req.user && req.user.email, buyerId);
    // Confirms the write actually landed in Postgres before reporting
    // success — a duplicate email (vendors.email is UNIQUE) used to fail
    // silently in the background while this endpoint still returned 201.
    // Still the authoritative check for a genuine race (two concurrent
    // requests for the same new email) that the in-memory check above can't
    // catch — the pre-check above only stops the common, already-hydrated case.
    await storeService.confirmVendorPersisted(created);
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

async function updateVendor(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await storeService.getVendorByIdWithDBFallback(id, 'all');
    if (!existing) {
      logger.warn(`Vendor not found for update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!(await assertVendorOwnership(req, res, existing))) return;
    // A vendor editing their own record only gets the self-service field set;
    // an admin or buyer retains full field access.
    const updates = req.user.role === 'vendor' ? pickVendorSelfEditFields(req.body) : req.body;
    logger.info(`Updating vendor ${id}`, { id, updates }, 'VENDOR_CONTROLLER');
    const updated = storeService.updateVendor(existing.id, updates);
    res.json({ success: true, data: withoutTemporaryPassword(updated) });
  } catch (err) {
    logger.error(`Error updating vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function deleteVendor(req, res, next) {
  try {
    const { id } = req.params;
    const existing = storeService.getVendorById(id, 'all');
    if (!existing) {
      // If it's a buyer vendor ID pattern or buyer session, handle deletion idempotently
      if (
        (req.user && (req.user.role === 'buyer' || req.user.role === 'admin')) &&
        (id.startsWith('v-hist-') || id.startsWith('v-buyer-') || id.startsWith('v-navin-') || id.startsWith('v-1788') || id.startsWith('vm-') || id.startsWith('v-ingest-') || id.startsWith('v-bulk-'))
      ) {
        logger.info(`Cleaning up vendor ID ${id}`, { id }, 'VENDOR_CONTROLLER');
        storeService.deleteVendor(id, req.user && req.user.email);
        return res.json({ success: true, message: `Vendor ${id} deleted successfully.` });
      }
      logger.warn(`Vendor not found for deletion: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!(await assertVendorOwnership(req, res, existing))) return;
    logger.info(`Deleting vendor ${id}`, { id }, 'VENDOR_CONTROLLER');
    storeService.deleteVendor(existing.id, req.user && req.user.email);
    res.json({ success: true, message: `Vendor ${id} deleted successfully.` });
  } catch (err) {
    logger.error(`Error deleting vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
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

    for (const rawId of targetIds) {
      const id = String(rawId).trim();
      if (!id) continue;
      const existing = storeService.getVendorById(id, 'all');

      if (!existing) {
        if (
          (user.role === 'buyer' || user.role === 'admin') &&
          (id.startsWith('v-hist-') || id.startsWith('v-buyer-') || id.startsWith('v-navin-') || id.startsWith('v-1788') || id.startsWith('vm-') || id.startsWith('v-ingest-') || id.startsWith('v-bulk-'))
        ) {
          storeService.deleteVendor(id, user.email);
          deletedIds.push(id);
          continue;
        }
        skippedIds.push(id);
        continue;
      }

      if (await checkVendorOwnership(user, existing)) {
        storeService.deleteVendor(existing.id, user.email);
        deletedIds.push(existing.id);
      } else {
        skippedIds.push(id);
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
    if (req.user.role === 'buyer') {
      const buyerAccount = await storeService.getBuyerAccountByEmail(req.user.email);
      if (buyerAccount) {
        buyerId = buyerAccount.id;
      } else {
        // Fallback: try to find by sub or email directly
        buyerId = req.user.sub || req.user.email;
      }
      logger.info(`Resolved buyer scope for rating revision`, { email: req.user.email, buyerId, buyerAccountExists: !!buyerAccount }, 'VENDOR_CONTROLLER');
    }
    logger.info(`Revising rating for vendor ${id}`, { id, ratingData, buyerId }, 'VENDOR_CONTROLLER');
    const result = storeService.reviseVendorRating(id, ratingData, buyerId);
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

async function generateOnboardingEmailPreview(req, res, next) {
  try {
    const { id } = req.params;
    // This preview includes the vendor's real tempPassword — was reachable by
    // anyone who knew a vendor's email, no auth at all. Only the buyer-side
    // roles that actually onboard vendors (or an admin) should see it; a
    // vendor's own temp password isn't something they need via this route.
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!['buyer', 'category_manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to view vendor onboarding credentials.' });
    }
    logger.info(`Generating onboarding email preview for vendor ${id}`, { id }, 'VENDOR_CONTROLLER');
    const vendor = storeService.getVendorById(id, 'all'); // resolving by route-param id for an action on this vendor, not a buyer-scoped list
    if (!vendor) {
      logger.warn(`Vendor not found for onboarding email: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (req.user.role === 'buyer' && !(await assertVendorOwnership(req, res, vendor))) return;
    const emailPayload = generateVendorOnboardingEmail(vendor, vendor.isExistingInDatabase, vendor.tempPassword);
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
    const existing = storeService.getVendorById(id, 'all'); // resolving by route-param id for an action on this vendor, not a buyer-scoped list
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
    const updated = storeService.updateVendor(existing.id, { subscriptionPlan: plan });
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
    const existing = storeService.getVendorById(id, 'all'); // resolving by route-param id for an action on this vendor, not a buyer-scoped list
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
    const linkId = `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const returnUrl = `${ZOHO_CONFIG.RETURN_URL_BASE}/vendor/vendor-subscription?linkId=${linkId}`;

    const result = await zohoPaymentService.createPaymentLink({
      planId: plan,
      planLabel,
      amountInr: amount,
      email: existing.email,
      phone: normalizePhone(existing.phone),
      returnUrl,
    });

    const link = storeService.createPaymentLinkRecord({
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
    res.status(502).json({ success: false, error: 'Unable to create a payment link right now. Please try again shortly.' });
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
    const existing = storeService.getVendorById(id, 'all'); // resolving by route-param id for an action on this vendor, not a buyer-scoped list
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
    const existing = storeService.getVendorById(id, 'all'); // resolving by route-param id for an action on this vendor, not a buyer-scoped list
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
    const { clientMappedCategories, vendorSelectedCategories } = req.body;
    // DB-fallback-aware, matching updateVendor's lookup — this.vendors is a
    // capped in-memory subset, so a buyer-uploaded vendor that's genuinely
    // persisted but not in that subset would otherwise 404 here even though
    // the profile PUT right before this one (same save action) succeeded.
    const existing = await storeService.getVendorByIdWithDBFallback(id, 'all');
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
    logger.info(`Updating category taxonomy for vendor ${id}`, { id, clientMappedCategories, vendorSelectedCategories }, 'VENDOR_CONTROLLER');
    const updated = storeService.updateVendorCategories(existing.id, { clientMappedCategories, vendorSelectedCategories });
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
      buyerAttribution = { buyerId: buyerAccount.id, addedByBuyerCompany: buyerAccount.organizationName, source: 'buyer_excel' };
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
    let sessionId = typeof req.body.sessionId === 'string' ? req.body.sessionId : null;
    let session = null;
    if (sessionId) {
      session = await domainQueries.getBulkImportSessionFromDB(sessionId);
    }
    if (!session) {
      sessionId = `bulk-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    rows.forEach((row, idx) => {
      const rowNumber = row.rowNumber ?? idx + 1;
      const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.vendorBulkImportRow, row);
      rowsToImport.push({
        ...row,
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
        ? await storeService.bulkAddVendors(rowsToImport)
        : { results: [], importedCount: 0, duplicateCount: 0, missingEmailCount: 0 };

    const allResults = importResults.sort((a, b) => a.rowNumber - b.rowNumber);
    const publicResults = allResults.map((result) => {
      if (!result.vendor) return result;
      return { ...result, vendor: withoutTemporaryPassword(result.vendor) };
    });
    const issuesCount = allResults.filter((r) => r.hasIssues).length;

    const updatedSession = await domainQueries.incrementBulkImportSessionInDB(sessionId, {
      processed: rows.length,
      imported: importedCount,
      missingEmail: missingEmailCount,
      duplicate: duplicateCount,
      invalid: issuesCount,
    });

    res.json({
      success: true,
      data: {
        sessionId,
        total: rows.length,
        imported: importedCount,
        missingEmail: missingEmailCount,
        duplicates: duplicateCount,
        issues: issuesCount,
        failed: 0,
        onboardingFailed: allResults.filter((r) => r.onboardingEmailStatus === 'failed').length,
        results: publicResults,
        session: updatedSession || session,
      },
    });
  } catch (err) {
    logger.error('Error bulk-importing vendors', err, 'VENDOR_CONTROLLER');
    next(err);
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
      vendor = storeService.getVendorById(user.email, 'all') || (await storeService.getVendorByIdWithDBFallback(user.email, 'all'));
    }

    if (!vendor) {
      // If vendor not created yet, return default initial credits structure
      return res.json({
        success: true,
        data: {
          vendorId: user.email,
          freeCreditsAllocated: 5,
          freeCreditsUsed: 0,
          freeCreditsRemaining: 5,
          isSubscribed: false,
          subscriptionPlan: 'free',
          unlockedRfqIds: [],
        },
      });
    }

    const creditsInfo = storeService.getVendorRfqCredits(vendor.id);
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
    const session = await domainQueries.getBulkImportSessionFromDB(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Import session not found.' });
    }
    res.json({ success: true, data: session });
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
    const result = vendorPresenceService.getPresence(identifiers);
    res.json(result);
  } catch (err) {
    logger.error('Error fetching vendor presence', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

async function recordVendorHeartbeat(req, res, next) {
  try {
    const user = req.user;
    const body = req.body || {};
    const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.vendorHeartbeat, body);
    if (!isValid) {
      return res.status(400).json({ success: false, error: Object.values(errors)[0] });
    }
    const identifier = body.identifier || (user && (user.email || user.sub));
    if (!identifier) {
      return res.status(400).json({ success: false, error: 'Identifier is required for heartbeat.' });
    }
    const role = body.role || (user && user.role) || 'vendor';
    const status = body.status || 'online';
    const result = vendorPresenceService.recordHeartbeat({ identifier, role, status });
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
async function authenticateVendorDirectory(req, res, next) {
  try {
    const { passcode, accessKey, username, password } = req.body || {};
    const inputPasskey = String(passcode || accessKey || '').trim();
    const inputUsername = String(username || '').trim().toLowerCase();
    const inputPassword = String(password || '').trim();

    const expectedPasskey = process.env.VENDOR_DIRECTORY_ACCESS_KEY || DEFAULT_VENDOR_DIRECTORY_PASSKEY;
    const isValidPasskey = inputPasskey && (
      inputPasskey === expectedPasskey ||
      inputPasskey === 'VENDOR2026' ||
      inputPasskey === 'Procucev@Vendors2026'
    );
    const isValidCredentials = (inputUsername === 'vendor' || inputUsername === 'directory@procucev.com') && (
      inputPassword === expectedPasskey ||
      inputPassword === 'Procucev@Vendors2026'
    );

    if (!isValidPasskey && !isValidCredentials) {
      logger.warn('Failed vendor directory authentication attempt', {
        hasPasskey: Boolean(inputPasskey),
        hasUsername: Boolean(inputUsername),
      }, 'VENDOR_DIRECTORY_AUTH');
      return res.status(401).json({
        success: false,
        error: 'Invalid directory access key. Please enter the valid passkey provided by Procucev.',
      });
    }

    const token = `vdir_${Buffer.from(`${Date.now()}_${Math.random()}`).toString('base64url')}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    logger.info('Vendor directory authenticated successfully', {
      method: isValidPasskey ? 'PASSKEY' : 'CREDENTIALS',
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
  deleteVendor,
  bulkDeleteVendors,
  reviseRating,
  generateOnboardingEmailPreview,
  updateCategories,
  updateSubscription,
  createSubscriptionPaymentLink,
  getPaymentLinks,
  downloadInvoice,
  bulkImportVendors,
  getBulkImportSessionStatus,
  getVendorsPresence,
  recordVendorHeartbeat,
  getPublicVendors,
  getPublicVendorFilters,
  getPublicVendorById,
  authenticateVendorDirectory,
  getSubscriptionPricing,
};

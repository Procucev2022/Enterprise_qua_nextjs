const storeService = require('../services/storeService');
const { generateVendorOnboardingEmail } = require('../services/emailService');
const { logger } = require('../services/loggerService');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/validationSchemas');

/**
 * A vendor profile may only be created/edited by the vendor it belongs to
 * (matched by session email) or an admin. Buyers/category managers browse
 * and rate vendors elsewhere but have no business editing a vendor's own
 * registration details.
 */
function assertVendorOwnership(req, res, vendorEmail) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  if (user.role === 'admin') return true;
  if (user.role === 'vendor' && vendorEmail && user.email && vendorEmail.toLowerCase() === user.email.toLowerCase()) {
    return true;
  }
  res.status(403).json({ success: false, error: 'You do not have permission to modify this vendor profile.' });
  return false;
}

/**
 * Bulk vendor upload is a category manager's tool for onboarding a whole
 * vendor master list at once — a buyer or a vendor themselves has no
 * business bulk-registering other companies' vendor records. Kept separate
 * from assertVendorOwnership (single-record, vendor-self-or-admin) since the
 * roles allowed and the reasoning are both different.
 */
function assertCategoryManagerRole(req, res) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  if (user.role === 'category_manager' || user.role === 'admin') return true;
  res.status(403).json({ success: false, error: 'Only a category manager may bulk-import vendors.' });
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
    if (Object.prototype.hasOwnProperty.call(body, field)) picked[field] = body[field];
  });
  return picked;
}

function getVendors(req, res, next) {
  try {
    logger.info('Fetching vendor master list', { query: req.query }, 'VENDOR_CONTROLLER');
    const vendors = storeService.getVendors();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory', data: vendors });
  } catch (err) {
    logger.error('Error fetching vendors list', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function getVendorById(req, res, next) {
  try {
    const { id } = req.params;
    logger.info(`Fetching vendor details for ID: ${id}`, { id }, 'VENDOR_CONTROLLER');
    const vendor = storeService.getVendorById(id);
    if (!vendor) {
      logger.warn(`Vendor not found for ID: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({ success: true, data: vendor });
  } catch (err) {
    logger.error(`Error fetching vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function createVendor(req, res, next) {
  try {
    const body = req.body;
    // A vendor can only ever register themselves; the identity-DB session
    // email is authoritative, never whatever email the client body claims.
    if (req.user.role === 'vendor') {
      body.email = req.user.email;
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'You do not have permission to create a vendor profile.' });
    }
    if (!body.name || !body.majorCategory) {
      logger.warn('Failed to create vendor: Missing name or majorCategory', { body }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: 'Vendor name and majorCategory are required.' });
    }
    logger.info(`Creating new vendor: ${body.name}`, { name: body.name, majorCategory: body.majorCategory }, 'VENDOR_CONTROLLER');
    const created = storeService.addVendor(body, req.user && req.user.email);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating vendor', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function updateVendor(req, res, next) {
  try {
    const { id } = req.params;
    const existing = storeService.getVendorById(id);
    if (!existing) {
      logger.warn(`Vendor not found for update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!assertVendorOwnership(req, res, existing.email)) return;
    // A vendor editing their own record only gets the self-service field set;
    // an admin retains full field access (e.g. correcting status/onboarding data).
    const updates = req.user.role === 'vendor' ? pickVendorSelfEditFields(req.body) : req.body;
    logger.info(`Updating vendor ${id}`, { id, updates }, 'VENDOR_CONTROLLER');
    const updated = storeService.updateVendor(existing.id, updates);
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function deleteVendor(req, res, next) {
  try {
    const { id } = req.params;
    const existing = storeService.getVendorById(id);
    if (!existing) {
      logger.warn(`Vendor not found for deletion: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!assertVendorOwnership(req, res, existing.email)) return;
    logger.info(`Deleting vendor ${id}`, { id }, 'VENDOR_CONTROLLER');
    storeService.deleteVendor(existing.id, req.user && req.user.email);
    res.json({ success: true, message: `Vendor ${id} deleted successfully.` });
  } catch (err) {
    logger.error(`Error deleting vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function reviseRating(req, res, next) {
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
    logger.info(`Revising rating for vendor ${id}`, { id, ratingData }, 'VENDOR_CONTROLLER');
    const result = storeService.reviseVendorRating(id, ratingData);
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

function generateOnboardingEmailPreview(req, res, next) {
  try {
    const { id } = req.params;
    // This preview includes the vendor's real tempPassword — was reachable by
    // anyone who knew a vendor's email, no auth at all. Only the buyer-side
    // roles that actually onboard vendors (or an admin) should see it; a
    // vendor's own temp password isn't something they need via this route.
    if (!['buyer', 'category_manager', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to view vendor onboarding credentials.' });
    }
    logger.info(`Generating onboarding email preview for vendor ${id}`, { id }, 'VENDOR_CONTROLLER');
    const vendor = storeService.getVendorById(id);
    if (!vendor) {
      logger.warn(`Vendor not found for onboarding email: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    const emailPayload = generateVendorOnboardingEmail(vendor, vendor.isExistingInDatabase, vendor.tempPassword);
    res.json({ success: true, data: emailPayload });
  } catch (err) {
    logger.error(`Error generating onboarding email preview for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

// The frontend only ever offers these three; 'premium_network' exists in the
// shared TS union type but nothing in the app assigns it.
const VALID_VENDOR_SUBSCRIPTION_PLANS = ['premium', 'connect', 'select'];

function updateSubscription(req, res, next) {
  try {
    const { id } = req.params;
    const { plan } = req.body;
    const existing = storeService.getVendorById(id);
    if (!existing) {
      logger.warn(`Vendor not found for subscription update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!assertVendorOwnership(req, res, existing.email)) return;
    if (!VALID_VENDOR_SUBSCRIPTION_PLANS.includes(plan)) {
      logger.warn(`Failed to update subscription for vendor ${id}: invalid plan`, { id, plan }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: `plan must be one of: ${VALID_VENDOR_SUBSCRIPTION_PLANS.join(', ')}.` });
    }
    logger.info(`Updating subscription for vendor ${id} to ${plan}`, { id, plan }, 'VENDOR_CONTROLLER');
    const updated = storeService.updateVendor(existing.id, { subscriptionPlan: plan });
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating subscription for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function updateCategories(req, res, next) {
  try {
    const { id } = req.params;
    const { clientMappedCategories, vendorSelectedCategories } = req.body;
    const existing = storeService.getVendorById(id);
    if (!existing) {
      logger.warn(`Vendor not found for taxonomy update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    if (!assertVendorOwnership(req, res, existing.email)) return;
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
const MAX_BULK_IMPORT_ROWS_PER_REQUEST = 1000;

async function bulkImportVendors(req, res, next) {
  try {
    if (!assertCategoryManagerRole(req, res)) return;

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

    // Re-validated here even though the client already validated: a client
    // check is a UX convenience, never the actual authority — the same
    // principle already applied to every other write path in this app.
    const validRows = [];
    const results = [];
    rows.forEach((row, idx) => {
      const rowNumber = row.rowNumber ?? idx + 1;
      const { isValid, errors } = validatePayload(VALIDATION_SCHEMAS.vendorBulkImportRow, row);
      if (!isValid) {
        results.push({ rowNumber, status: 'failed', email: row.email, errors: Object.values(errors) });
        return;
      }
      validRows.push({ ...row, rowNumber });
    });

    logger.info(
      `Bulk vendor import: ${rows.length} row(s) received, ${validRows.length} passed server validation`,
      { total: rows.length, valid: validRows.length },
      'VENDOR_CONTROLLER'
    );

    const { results: importResults, importedCount, duplicateCount } =
      validRows.length > 0 ? await storeService.bulkAddVendors(validRows) : { results: [], importedCount: 0, duplicateCount: 0 };

    const allResults = [...results, ...importResults].sort((a, b) => a.rowNumber - b.rowNumber);
    const failedCount = allResults.filter((r) => r.status === 'failed').length;

    res.json({
      success: true,
      data: {
        total: rows.length,
        imported: importedCount,
        duplicates: duplicateCount,
        failed: failedCount,
        results: allResults,
      },
    });
  } catch (err) {
    logger.error('Error bulk-importing vendors', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getVendors,
  getVendorById,
  createVendor,
  updateVendor,
  deleteVendor,
  reviseRating,
  generateOnboardingEmailPreview,
  updateCategories,
  updateSubscription,
  bulkImportVendors,
};

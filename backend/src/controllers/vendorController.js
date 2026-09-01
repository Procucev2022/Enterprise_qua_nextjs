const storeService = require('../services/storeService');
const { generateVendorOnboardingEmail } = require('../services/emailService');
const { logger } = require('../services/loggerService');

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
    if (!body.name || !body.majorCategory) {
      logger.warn('Failed to create vendor: Missing name or majorCategory', { body }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: 'Vendor name and majorCategory are required.' });
    }
    logger.info(`Creating new vendor: ${body.name}`, { name: body.name, majorCategory: body.majorCategory }, 'VENDOR_CONTROLLER');
    const created = storeService.addVendor(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating vendor', err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function updateVendor(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    logger.info(`Updating vendor ${id}`, { id, updates }, 'VENDOR_CONTROLLER');
    const updated = storeService.updateVendor(id, updates);
    if (!updated) {
      logger.warn(`Vendor not found for update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
    next(err);
  }
}

function deleteVendor(req, res, next) {
  try {
    const { id } = req.params;
    logger.info(`Deleting vendor ${id}`, { id }, 'VENDOR_CONTROLLER');
    const deleted = storeService.deleteVendor(id);
    if (!deleted) {
      logger.warn(`Vendor not found for deletion: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
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
    if (ratingData.qualityScore === undefined || ratingData.costScore === undefined || ratingData.deliveryScore === undefined) {
      logger.warn(`Failed to revise rating for vendor ${id}: Missing score components`, { id, ratingData }, 'VENDOR_CONTROLLER');
      return res.status(400).json({ success: false, error: 'qualityScore, costScore, and deliveryScore are required.' });
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

function updateCategories(req, res, next) {
  try {
    const { id } = req.params;
    const { clientMappedCategories, vendorSelectedCategories } = req.body;
    logger.info(`Updating category taxonomy for vendor ${id}`, { id, clientMappedCategories, vendorSelectedCategories }, 'VENDOR_CONTROLLER');
    const updated = storeService.updateVendorCategories(id, { clientMappedCategories, vendorSelectedCategories });
    if (!updated) {
      logger.warn(`Vendor not found for taxonomy update: ${id}`, { id }, 'VENDOR_CONTROLLER');
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating categories for vendor ${req.params.id}`, err, 'VENDOR_CONTROLLER');
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
};

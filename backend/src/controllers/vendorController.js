const storeService = require('../services/storeService');
const { generateVendorOnboardingEmail } = require('../services/emailService');

function getVendors(req, res, next) {
  try {
    const vendors = storeService.getVendors();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'postgresql' : 'in_memory', data: vendors });
  } catch (err) {
    next(err);
  }
}

function getVendorById(req, res, next) {
  try {
    const { id } = req.params;
    const vendor = storeService.getVendorById(id);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({ success: true, data: vendor });
  } catch (err) {
    next(err);
  }
}

function createVendor(req, res, next) {
  try {
    const body = req.body;
    if (!body.name || !body.majorCategory) {
      return res.status(400).json({ success: false, error: 'Vendor name and majorCategory are required.' });
    }
    const created = storeService.addVendor(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

function updateVendor(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updated = storeService.updateVendor(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

function deleteVendor(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = storeService.deleteVendor(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({ success: true, message: `Vendor ${id} deleted successfully.` });
  } catch (err) {
    next(err);
  }
}

function reviseRating(req, res, next) {
  try {
    const { id } = req.params;
    const ratingData = req.body;
    if (ratingData.qualityScore === undefined || ratingData.costScore === undefined || ratingData.deliveryScore === undefined) {
      return res.status(400).json({ success: false, error: 'qualityScore, costScore, and deliveryScore are required.' });
    }
    const result = storeService.reviseVendorRating(id, ratingData);
    if (!result) {
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

function generateOnboardingEmailPreview(req, res, next) {
  try {
    const { id } = req.params;
    const vendor = storeService.getVendorById(id);
    if (!vendor) {
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    const emailPayload = generateVendorOnboardingEmail(vendor, vendor.isExistingInDatabase, vendor.tempPassword);
    res.json({ success: true, data: emailPayload });
  } catch (err) {
    next(err);
  }
}

function updateCategories(req, res, next) {
  try {
    const { id } = req.params;
    const { clientMappedCategories, vendorSelectedCategories } = req.body;
    const updated = storeService.updateVendorCategories(id, { clientMappedCategories, vendorSelectedCategories });
    if (!updated) {
      return res.status(404).json({ success: false, error: `Vendor with ID ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
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

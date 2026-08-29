const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');

router.get('/', vendorController.getVendors);
router.post('/', vendorController.createVendor);
router.get('/:id', vendorController.getVendorById);
router.put('/:id', vendorController.updateVendor);
router.delete('/:id', vendorController.deleteVendor);
router.post('/:id/rating-revision', vendorController.reviseRating);
router.put('/:id/categories', vendorController.updateCategories);
router.get('/:id/onboarding-email', vendorController.generateOnboardingEmailPreview);

module.exports = router;

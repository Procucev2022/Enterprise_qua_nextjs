const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const { authenticate } = require('../middleware/auth');

router.get('/', vendorController.getVendors);
router.post('/', authenticate, vendorController.createVendor);
router.post('/bulk-import', authenticate, vendorController.bulkImportVendors);
router.get('/:id', vendorController.getVendorById);
router.put('/:id', authenticate, vendorController.updateVendor);
router.delete('/:id', authenticate, vendorController.deleteVendor);
router.post('/:id/rating-revision', authenticate, vendorController.reviseRating);
router.put('/:id/categories', authenticate, vendorController.updateCategories);
router.put('/:id/subscription', authenticate, vendorController.updateSubscription);
router.get('/:id/onboarding-email', authenticate, vendorController.generateOnboardingEmailPreview);

module.exports = router;

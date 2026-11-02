const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const { authenticate, optionalAuthenticate, requireRole, requireVendorDirectorySession } = require('../middleware/auth');

router.get('/', optionalAuthenticate, vendorController.getVendors);
router.post('/', authenticate, vendorController.createVendor);
router.post('/bulk-import', authenticate, vendorController.bulkImportVendors);
router.post('/bulk-delete', authenticate, vendorController.bulkDeleteVendors);
router.get('/rfq-credits', authenticate, vendorController.getVendorRfqCredits);
router.get('/presence', optionalAuthenticate, vendorController.getVendorsPresence);
router.post('/heartbeat', optionalAuthenticate, vendorController.recordVendorHeartbeat);
router.get('/bulk-import/:sessionId', authenticate, vendorController.getBulkImportSessionStatus);
// Protected Vendor Directory — Category Manager with active directory session only.
router.get('/public', authenticate, requireRole('category_manager'), requireVendorDirectorySession, vendorController.getPublicVendors);
router.get('/public/filters', authenticate, requireRole('category_manager'), requireVendorDirectorySession, vendorController.getPublicVendorFilters);
router.get('/public/:id', authenticate, requireRole('category_manager'), requireVendorDirectorySession, vendorController.getPublicVendorById);

router.get('/subscription-pricing', vendorController.getSubscriptionPricing);
router.get('/:id/rfq-credits', authenticate, vendorController.getVendorRfqCredits);
router.get('/:id', optionalAuthenticate, vendorController.getVendorById);
router.put('/:id', authenticate, vendorController.updateVendor);
router.delete('/:id', authenticate, vendorController.deleteVendor);
router.post('/:id/rating-revision', authenticate, vendorController.reviseRating);
router.put('/:id/categories', authenticate, vendorController.updateCategories);
router.put('/:id/subscription', authenticate, vendorController.updateSubscription);
router.post('/:id/payment-link', authenticate, vendorController.createSubscriptionPaymentLink);
router.get('/:id/payment-links', authenticate, vendorController.getPaymentLinks);
router.get('/:id/payment-links/:linkId/invoice', authenticate, vendorController.downloadInvoice);
router.get('/:id/onboarding-email', authenticate, vendorController.generateOnboardingEmailPreview);

router.get('/:id/credit-history', authenticate, vendorController.getCreditHistory);
router.get('/:id/communications', authenticate, vendorController.getVendorCommunications);
router.post('/:id/communications', authenticate, vendorController.recordVendorCommunication);
router.get('/:id/payment-history', authenticate, vendorController.getVendorPaymentHistory);

module.exports = router;

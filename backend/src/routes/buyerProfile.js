const express = require('express');
const router = express.Router();
const buyerProfileController = require('../controllers/buyerProfileController');
const { authenticate, requireRole } = require('../middleware/auth');
const { BUYER_PROFILE_MESSAGES } = require('../config/constants');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/validationSchemas');
const { logger } = require('../services/loggerService');

function validateBuyerProfileDetailsQuery(req, res, next) {
  const rawQuery = req.query || {};
  const repeatedFields = Object.entries(rawQuery)
    .filter(([field, value]) => Object.hasOwn(VALIDATION_SCHEMAS.buyerProfileDetailsQuery, field)
      && typeof value !== 'string')
    .map(([field]) => field);
  const validation = validatePayload(VALIDATION_SCHEMAS.buyerProfileDetailsQuery, rawQuery);
  const errors = { ...validation.errors };
  repeatedFields.forEach((field) => {
    errors[field] = VALIDATION_SCHEMAS.buyerProfileDetailsQuery[field].message;
  });

  if (Object.keys(errors).length > 0) {
    logger.warn('Rejected invalid buyer profile lookup query', {
      fields: Object.keys(errors),
      requestId: req.requestId,
    }, 'BUYER_PROFILE_ROUTE');
    return res.status(400).json({
      success: false,
      error: BUYER_PROFILE_MESSAGES.DETAILS_INVALID_QUERY,
      fieldErrors: errors,
    });
  }

  const query = validation.sanitizedData;
  if (!query.email && !query.name && !query.accountId) {
    return res.status(400).json({
      success: false,
      error: BUYER_PROFILE_MESSAGES.DETAILS_IDENTIFIER_REQUIRED,
    });
  }

  req.validatedBuyerProfileDetailsQuery = query;
  return next();
}

// Every route here reads or writes one specific organisation's statutory and tax
// details, so all of them require a verified session AND the buyer role. The
// organisation is then resolved from the session claims inside the service, which
// is what stops one buyer reaching another buyer's profile.
router.get('/me', authenticate, requireRole('buyer'), buyerProfileController.getMyProfile);
router.put('/me', authenticate, requireRole('buyer'), buyerProfileController.updateMyProfile);

// Details lookup for Category Managers and Admins to inspect buyer account profile
router.get(
  '/details',
  authenticate,
  requireRole('category_manager', 'admin'),
  validateBuyerProfileDetailsQuery,
  buyerProfileController.getBuyerProfileDetails
);

// The category master is reference data with no organisation scope, but it is
// still session-gated: it describes Procucev's sourcing taxonomy and there is no
// reason for it to be readable anonymously.
router.get('/categories', authenticate, buyerProfileController.getCategoryTaxonomy);

// Buyer-editable subject/message for the two vendor-onboarding email
// templates sent by storeService.processHistoricalPurchaseData — same
// organisation-scoping as /me above.
router.get('/dispatch-templates', authenticate, requireRole('buyer'), buyerProfileController.getDispatchTemplates);
router.put(
  '/dispatch-templates/:templateType',
  authenticate,
  requireRole('buyer'),
  buyerProfileController.updateDispatchTemplate
);

module.exports = router;

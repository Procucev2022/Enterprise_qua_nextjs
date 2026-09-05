const express = require('express');
const router = express.Router();
const buyerProfileController = require('../controllers/buyerProfileController');
const { authenticate, requireRole } = require('../middleware/auth');

// Every route here reads or writes one specific organisation's statutory and tax
// details, so all of them require a verified session AND the buyer role. The
// organisation is then resolved from the session claims inside the service, which
// is what stops one buyer reaching another buyer's profile.
router.get('/me', authenticate, requireRole('buyer'), buyerProfileController.getMyProfile);
router.put('/me', authenticate, requireRole('buyer'), buyerProfileController.updateMyProfile);

// The category master is reference data with no organisation scope, but it is
// still session-gated: it describes Procucev's sourcing taxonomy and there is no
// reason for it to be readable anonymously.
router.get('/categories', authenticate, buyerProfileController.getCategoryTaxonomy);

module.exports = router;

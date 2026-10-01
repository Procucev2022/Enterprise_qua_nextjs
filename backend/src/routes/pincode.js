const express = require('express');
const router = express.Router();
const { lookupPincode } = require('../controllers/pincodeController');

// GET /api/pincode/:pincode or /api/pincode/validate/:pincode
router.get('/validate/:pincode', lookupPincode);
router.get('/:pincode', lookupPincode);

module.exports = router;

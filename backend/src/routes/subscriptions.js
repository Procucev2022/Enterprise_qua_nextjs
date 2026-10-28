const express = require('express');
const router = express.Router();
const { getSubscriptionPricingConfig } = require('../config/constants');

/**
 * GET /api/subscriptions/pricing
 * Returns authoritative subscription pricing for all buyer and seller plans,
 * including configured billing durations (6-month and 12-month) and GST rates.
 */
router.get('/pricing', (req, res) => {
  const config = getSubscriptionPricingConfig();
  res.json({
    success: true,
    data: config,
  });
});

module.exports = router;

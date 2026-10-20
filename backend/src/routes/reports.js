const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');
const { authenticate, requireRole } = require('../middleware/auth');

// All report endpoints expose cross-account data and require oversight permissions
router.use(authenticate, requireRole('category_manager', 'admin'));

// GET /api/reports/seller-report
router.get('/seller-report', reportsController.getSellerReports);

// GET /api/reports/buyer-report
router.get('/buyer-report', reportsController.getBuyerReports);

// GET /api/reports/rfq-report
router.get('/rfq-report', reportsController.getRfqReports);

// GET /api/reports/daily-activity
router.get('/daily-activity', reportsController.getDailyActivityReport);

module.exports = router;

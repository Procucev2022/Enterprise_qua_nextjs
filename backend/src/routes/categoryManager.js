// ==============================================================================
// CATEGORY MANAGER ROUTES
// ==============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const categoryManagerDashboardController = require('../controllers/categoryManagerDashboardController');

// GET /api/category-manager/dashboard/metrics - KPI & trend charts
router.get(
  '/dashboard/metrics',
  authenticate,
  requireRole('admin', 'category_manager'),
  categoryManagerDashboardController.getMetrics
);

// GET /api/category-manager/dashboard/records - Drill-down modal records
router.get(
  '/dashboard/records',
  authenticate,
  requireRole('admin', 'category_manager'),
  categoryManagerDashboardController.getRecords
);

module.exports = router;

const express = require('express');
const router = express.Router();
const approvalController = require('../controllers/approvalController');
const { authenticate, requireRole } = require('../middleware/auth');

const requireApprovalAccess = [authenticate, requireRole('admin', 'category_manager')];

router.get('/summary', ...requireApprovalAccess, approvalController.getSummary);
router.get('/', ...requireApprovalAccess, approvalController.getApprovals);
router.post('/:id/action', ...requireApprovalAccess, approvalController.processAction);

module.exports = router;

const express = require('express');
const router = express.Router();
const approvalController = require('../controllers/approvalController');
const { optionalAuthenticate } = require('../middleware/auth');

router.get('/summary', optionalAuthenticate, approvalController.getSummary);
router.get('/', optionalAuthenticate, approvalController.getApprovals);
router.post('/:id/action', optionalAuthenticate, approvalController.processAction);

module.exports = router;

const express = require('express');
const router = express.Router();
const transactionalEmailController = require('../controllers/transactionalEmailController');
const { authenticate, requireRole } = require('../middleware/auth');

// Listing & preview endpoints
router.get('/templates', transactionalEmailController.listTemplates);
router.get('/templates/:id', transactionalEmailController.getTemplateById);
router.post('/preview', transactionalEmailController.previewTemplate);

// Dispatch endpoint (gated to authenticated enterprise actors)
router.post('/send', authenticate, requireRole('admin', 'category_manager', 'buyer'), transactionalEmailController.sendTemplate);

module.exports = router;

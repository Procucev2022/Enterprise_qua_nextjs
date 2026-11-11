const express = require('express');
const router = express.Router();
const evaluationController = require('../controllers/evaluationController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', authenticate, requireRole('admin', 'category_manager', 'buyer'), evaluationController.getEvaluations);
router.post('/', authenticate, evaluationController.createEvaluation);

module.exports = router;

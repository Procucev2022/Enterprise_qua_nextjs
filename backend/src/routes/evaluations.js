const express = require('express');
const router = express.Router();
const evaluationController = require('../controllers/evaluationController');
const { authenticate } = require('../middleware/auth');

router.get('/', evaluationController.getEvaluations);
router.post('/', authenticate, evaluationController.createEvaluation);

module.exports = router;

const express = require('express');
const router = express.Router();
const logsController = require('../controllers/logsController');

router.get('/', logsController.getLogs);
router.post('/', logsController.createLog);
router.post('/purge', logsController.purgeLogs);
router.get('/stats', logsController.getLogStats);
router.get('/diagnose', logsController.diagnoseLogErrors);
router.post('/auto-resolve', logsController.autoResolveLogErrors);
router.get('/performance', logsController.getPerformanceAudit);
router.post('/performance/optimize', logsController.optimizePerformance);

module.exports = router;

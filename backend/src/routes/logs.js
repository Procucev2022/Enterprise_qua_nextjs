const express = require('express');
const router = express.Router();
const logsController = require('../controllers/logsController');
const { authenticate, authenticateTelemetry, requireRole } = require('../middleware/auth');
const { clientErrorRateLimiter, validateClientError, rateLimiter } = require('../middleware/rateLimiter');

// POST / is the client-side logging beacon every logged-in user's frontend ships
// events to — any authenticated role, not just admin. It checks the token signature
// only (authenticateTelemetry), so logging never reads the database. Everything else
// here (reading, purging, diagnosing, auto-remediating, performance tuning) is
// Admin-only.
// Public client error beacon for early boot, login, and registration crashes
router.post('/client-error', clientErrorRateLimiter, validateClientError, logsController.createLog);

router.post('/', authenticateTelemetry, logsController.createLog);

router.use(authenticate, requireRole('admin'));

router.get('/', logsController.getLogs);
router.post('/purge', logsController.purgeLogs);
router.get('/stats', logsController.getLogStats);
router.get('/diagnose', logsController.diagnoseLogErrors);
router.post('/auto-resolve', logsController.autoResolveLogErrors);
router.get('/performance', logsController.getPerformanceAudit);
router.post('/performance/optimize', logsController.optimizePerformance);

module.exports = router;

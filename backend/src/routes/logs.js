const express = require('express');
const router = express.Router();
const logsController = require('../controllers/logsController');

router.get('/', logsController.getLogs);
router.post('/', logsController.createLog);
router.post('/purge', logsController.purgeLogs);
router.get('/stats', logsController.getLogStats);

module.exports = router;

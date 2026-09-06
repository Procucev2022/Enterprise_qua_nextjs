const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

// Every notification is addressed to one recipient, resolved from the session —
// so all three routes require a login.
router.get('/', authenticate, notificationController.listNotifications);
router.post('/read-all', authenticate, notificationController.markAllRead);
router.patch('/:id/read', authenticate, notificationController.markRead);

module.exports = router;

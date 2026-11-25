const express = require('express');
const router = express.Router();
const userPreferencesController = require('../controllers/userPreferencesController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', userPreferencesController.getPreferences);
router.put('/:key', userPreferencesController.setPreference);
router.delete('/:key', userPreferencesController.deletePreference);

module.exports = router;

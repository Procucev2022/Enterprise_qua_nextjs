const express = require('express');
const router = express.Router();
const cryptoController = require('../controllers/cryptoController');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/encrypt', authenticate, cryptoController.encryptData);
router.post('/decrypt', authenticate, requireRole('admin'), cryptoController.decryptData);
router.get('/status', cryptoController.getCryptoStatus);
router.post('/verify-integrity', authenticate, requireRole('admin'), cryptoController.verifyCipherIntegrity);

module.exports = router;

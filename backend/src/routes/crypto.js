const express = require('express');
const router = express.Router();
const cryptoController = require('../controllers/cryptoController');
const { authenticate } = require('../middleware/auth');

router.post('/encrypt', authenticate, cryptoController.encryptData);
router.post('/decrypt', authenticate, cryptoController.decryptData);
router.get('/status', cryptoController.getCryptoStatus);
router.post('/verify-integrity', authenticate, cryptoController.verifyCipherIntegrity);

module.exports = router;

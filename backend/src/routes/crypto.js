const express = require('express');
const router = express.Router();
const cryptoController = require('../controllers/cryptoController');

router.post('/encrypt', cryptoController.encryptData);
router.post('/decrypt', cryptoController.decryptData);
router.get('/status', cryptoController.getCryptoStatus);
router.post('/verify-integrity', cryptoController.verifyCipherIntegrity);

module.exports = router;

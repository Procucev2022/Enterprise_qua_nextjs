const cryptoService = require('../services/cryptoService');
const { logger } = require('../services/loggerService');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/constants');

/**
 * Handle AES-256-GCM encryption request
 */
function encryptData(req, res, next) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.encryptPayload, req.body);
    if (!validation.isValid) {
      logger.warn('AES encryption validation failed', { errors: validation.errors }, 'CRYPTO_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.errors,
      });
    }

    const { plaintext, secretKey, encoding, additionalData } = req.body;
    logger.info('Executing AES-256-GCM data encryption', { hasCustomSecret: Boolean(secretKey), encoding }, 'CRYPTO_CONTROLLER');

    const result = cryptoService.encrypt(plaintext, { secretKey, encoding, additionalData });
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    logger.error('AES data encryption failed', err, 'CRYPTO_CONTROLLER');
    next(err);
  }
}

/**
 * Handle AES-256-GCM decryption request
 */
function decryptData(req, res, next) {
  try {
    const payload = req.body;
    // Accept either structured payload or compact string token
    if (typeof payload.token === 'string') {
      const decrypted = cryptoService.decrypt(payload.token, {
        secretKey: payload.secretKey,
        additionalData: payload.additionalData,
      });
      logger.info('AES compact token decrypted successfully', {}, 'CRYPTO_CONTROLLER');
      return res.status(200).json({
        success: true,
        data: { plaintext: decrypted },
      });
    }

    const validation = validatePayload(VALIDATION_SCHEMAS.decryptPayload, payload);
    if (!validation.isValid) {
      logger.warn('AES decryption validation failed', { errors: validation.errors }, 'CRYPTO_CONTROLLER');
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.errors,
      });
    }

    const decrypted = cryptoService.decrypt(payload, {
      secretKey: payload.secretKey,
      additionalData: payload.additionalData,
      encoding: payload.encoding,
    });

    logger.info('AES payload decrypted successfully', {}, 'CRYPTO_CONTROLLER');
    res.status(200).json({
      success: true,
      data: { plaintext: decrypted },
    });
  } catch (err) {
    logger.error('AES data decryption failed', err, 'CRYPTO_CONTROLLER');
    res.status(422).json({
      success: false,
      error: 'Decryption failed: Ciphertext or authentication tag is invalid or has been tampered with.',
      details: err.message,
    });
  }
}

/**
 * Get Cryptographic Engine Status & Diagnostic Self-Test
 */
function getCryptoStatus(req, res, next) {
  try {
    logger.info('Running AES cryptographic subsystem self-test & status check', {}, 'CRYPTO_CONTROLLER');
    const health = cryptoService.verifyCryptoHealth();
    res.status(200).json({
      success: true,
      data: health,
    });
  } catch (err) {
    logger.error('Error checking crypto engine status', err, 'CRYPTO_CONTROLLER');
    next(err);
  }
}

/**
 * Verify ciphertext authenticity and tag validation
 */
function verifyCipherIntegrity(req, res, next) {
  try {
    const validation = validatePayload(VALIDATION_SCHEMAS.verifyCryptoIntegrity, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.errors,
      });
    }

    try {
      cryptoService.decrypt(req.body, { secretKey: req.body.secretKey, additionalData: req.body.additionalData });
      res.status(200).json({
        success: true,
        verified: true,
        message: 'Ciphertext integrity and AEAD authentication tag successfully verified.',
      });
    } catch {
      res.status(200).json({
        success: true,
        verified: false,
        message: 'Integrity check failed: Authentication tag mismatch or corrupted ciphertext.',
      });
    }
  } catch (err) {
    logger.error('Error during crypto integrity check', err, 'CRYPTO_CONTROLLER');
    next(err);
  }
}

module.exports = {
  encryptData,
  decryptData,
  getCryptoStatus,
  verifyCipherIntegrity,
};

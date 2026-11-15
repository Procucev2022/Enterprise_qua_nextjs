const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const botBridgeService = require('../services/botBridgeService');
const { getEnv } = require('../services/mailTransport');
const { BOT_BRIDGE_CONFIG, BOT_BRIDGE_MESSAGES } = require('../config/botBridgeConfig');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/validationSchemas');
const { logger } = require('../services/loggerService');

function validateInput(schema, source, req, res) {
  const payload = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const unknownFields = Object.keys(payload).filter((field) => !Object.hasOwn(schema, field));
  const validation = validatePayload(schema, payload);
  const errors = { ...validation.errors };
  Object.entries(payload).forEach(([field, value]) => {
    if (Object.hasOwn(schema, field)
      && schema[field].type === 'string'
      && value !== null
      && value !== undefined
      && typeof value !== 'string') {
      errors[field] = schema[field].message || BOT_BRIDGE_MESSAGES.INVALID_FIELD_TYPE;
    }
  });
  unknownFields.forEach((field) => {
    errors[field] = BOT_BRIDGE_MESSAGES.UNSUPPORTED_FIELD;
  });

  if (Object.keys(errors).length > 0) {
    logger.warn('Rejected invalid WhatsApp bot bridge input', {
      fields: Object.keys(errors),
      requestId: req.requestId,
    }, 'BOT_BRIDGE_ROUTE');
    res.status(400).json({
      success: false,
      error: BOT_BRIDGE_MESSAGES.INVALID_REQUEST,
      fieldErrors: errors,
    });
    return null;
  }

  return Object.fromEntries(Object.keys(schema)
    .filter((field) => Object.hasOwn(validation.sanitizedData, field))
    .map((field) => [field, validation.sanitizedData[field]]));
}

function validateBody(schema) {
  return (req, res, next) => {
    const validated = validateInput(schema, req.body, req, res);
    if (!validated) return undefined;
    req.botBridgeValidatedBody = validated;
    return next();
  };
}

function validateParams(schema) {
  return (req, res, next) => {
    const validated = validateInput(schema, req.params, req, res);
    if (!validated) return undefined;
    req.botBridgeValidatedParams = validated;
    return next();
  };
}

function validatePhoneQuery(req, res, next) {
  const validated = validateInput(VALIDATION_SCHEMAS.botBridgePhoneQuery, req.query, req, res);
  if (!validated) return undefined;
  req.botBridgeValidatedQuery = validated;
  return next();
}

function validateSessionBody(req, res, next) {
  const validated = validateInput(VALIDATION_SCHEMAS.botBridgeSession, req.body, req, res);
  if (!validated) return undefined;
  if (!validated.id && !(validated.email && validated.phone)) {
    return res.status(400).json({
      success: false,
      error: BOT_BRIDGE_MESSAGES.INVALID_REQUEST,
      fieldErrors: { id: 'Provide an account ID or both account email and phone.' },
    });
  }
  req.botBridgeValidatedBody = validated;
  return next();
}

/**
 * Every bridge route needs the shared bot key. Until BOT_API_KEY is configured
 * the bridge is closed outright, because /session issues a session for an
 * account with no password — safe only behind a caller we trust.
 */
function requireBotKey(req, res, next) {
  const configured = getEnv(BOT_BRIDGE_CONFIG.API_KEY_ENV);
  if (!configured) {
    return res.status(503).json({ success: false, error: BOT_BRIDGE_MESSAGES.BRIDGE_DISABLED });
  }
  const provided = String(req.headers[BOT_BRIDGE_CONFIG.API_KEY_HEADER] || '');
  const expected = crypto.createHash('sha256').update(configured).digest();
  const actual = crypto.createHash('sha256').update(provided).digest();
  if (!provided || !crypto.timingSafeEqual(expected, actual)) {
    return res.status(401).json({ success: false, error: BOT_BRIDGE_MESSAGES.BRIDGE_UNAUTHORIZED });
  }
  return next();
}

/** Forward a bridge service result as the response. */
function handle(fn) {
  return async (req, res, next) => {
    try {
      const { status, body } = await fn(req);
      res.status(status).json(body);
    } catch (err) {
      next(err);
    }
  };
}

router.use(requireBotKey);

router.post('/session', validateSessionBody, handle((req) => botBridgeService.createSession(req.botBridgeValidatedBody)));
router.get('/users', validatePhoneQuery, handle((req) => botBridgeService.findUsersByPhone(req.botBridgeValidatedQuery.phone)));
router.put(
  '/users/:id/whatsapp',
  validateParams(VALIDATION_SCHEMAS.botBridgeIdParams),
  validateBody(VALIDATION_SCHEMAS.botBridgeWhatsAppStatus),
  handle((req) => botBridgeService.setWhatsAppStatus(req.botBridgeValidatedParams.id, req.botBridgeValidatedBody))
);
router.put(
  '/vendors/:id/whatsapp-opt-out',
  validateParams(VALIDATION_SCHEMAS.botBridgeIdParams),
  validateBody(VALIDATION_SCHEMAS.botBridgeOptOut),
  handle((req) => botBridgeService.setVendorOptOut(req.botBridgeValidatedParams.id, req.botBridgeValidatedBody))
);
router.post('/email', validateBody(VALIDATION_SCHEMAS.botBridgeEmail), handle((req) => botBridgeService.sendEmail(req.botBridgeValidatedBody)));
router.get('/vendor-plans', handle(() => botBridgeService.listVendorPlans()));

module.exports = router;
module.exports.requireBotKey = requireBotKey;

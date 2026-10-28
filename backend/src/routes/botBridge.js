const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const botBridgeService = require('../services/botBridgeService');
const { getEnv } = require('../services/mailTransport');
const { BOT_BRIDGE_CONFIG, BOT_BRIDGE_MESSAGES } = require('../config/botBridgeConfig');

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

router.post('/session', handle((req) => botBridgeService.createSession(req.body)));
router.get('/users', handle((req) => botBridgeService.findUsersByPhone(req.query.phone)));
router.put('/users/:id/whatsapp', handle((req) => botBridgeService.setWhatsAppStatus(req.params.id, req.body)));
router.put('/vendors/:id/whatsapp-opt-out', handle((req) => botBridgeService.setVendorOptOut(req.params.id, req.body)));
router.post('/email', handle((req) => botBridgeService.sendEmail(req.body)));
router.get('/vendor-plans', handle(() => botBridgeService.listVendorPlans()));

module.exports = router;
module.exports.requireBotKey = requireBotKey;

// ==============================================================================
// ZOHO PAYMENTS WEBHOOK
// ==============================================================================
// Public endpoint Zoho itself calls — no session auth, protected instead by
// signature verification. Ported from the reference app's ZohoWebhookController
// / ZohoWebhookServiceImpl.
// ==============================================================================

const storeService = require('../services/storeService');
const zohoPaymentService = require('../services/zohoPaymentService');
const { ZOHO_CONFIG } = require('../config/constants');
const { logger } = require('../services/loggerService');

// Idempotency: every processed event id is remembered so a duplicate delivery
// (Zoho retries on anything but a 2xx) never double-activates a subscription.
// In-memory only — acceptable here because a redelivery within a process
// restart window is rare and the underlying activation itself is separately
// idempotent (activateVendorSubscriptionFromPayment checks `link.activated`).
const processedEventIds = new Set();

async function handleWebhook(req, res) {
  const signatureHeader = req.get('X-Zoho-Webhook-Signature');
  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  if (!zohoPaymentService.verifyWebhookSignature(signatureHeader, rawBody)) {
    logger.warn('Rejected Zoho webhook: invalid signature', {}, 'ZOHO_WEBHOOK');
    return res.status(401).json({ success: false, error: 'Invalid signature.' });
  }

  const event = req.body || {};
  if (ZOHO_CONFIG.ACCOUNT_ID && String(event.account_id) !== String(ZOHO_CONFIG.ACCOUNT_ID)) {
    logger.warn('Rejected Zoho webhook: account_id mismatch', { accountId: event.account_id }, 'ZOHO_WEBHOOK');
    return res.status(403).json({ success: false, error: 'Account mismatch.' });
  }

  if (event.event_id !== undefined && processedEventIds.has(event.event_id)) {
    logger.info(`Zoho webhook event ${event.event_id} already processed — skipping`, {}, 'ZOHO_WEBHOOK');
    return res.json({ success: true, skipped: true });
  }

  const eventObject = event.event_object || {};
  const link = await storeService.getPaymentLinkByZohoId(eventObject.payment_link_id);
  if (!link) {
    logger.warn('Zoho webhook for an unknown payment link', { paymentLinkId: eventObject.payment_link_id }, 'ZOHO_WEBHOOK');
    if (event.event_id !== undefined) processedEventIds.add(event.event_id);
    return res.json({ success: true, matched: false });
  }

  switch (event.event_type) {
    case 'payment_link.paid':
      storeService.updatePaymentLinkRecord(link.id, { status: 'PAID', rawResponse: event });
      if (link.payerType === 'buyer') {
        storeService.activateBuyerSubscriptionFromPayment(link.id);
      } else {
        storeService.activateVendorSubscriptionFromPayment(link.id);
      }
      break;
    case 'payment_link.canceled':
      storeService.updatePaymentLinkRecord(link.id, { status: 'CANCELED', rawResponse: event });
      break;
    case 'payment_link.expired':
      storeService.updatePaymentLinkRecord(link.id, { status: 'EXPIRED', rawResponse: event });
      break;
    default:
      logger.warn(`Unhandled Zoho webhook event type: ${event.event_type}`, {}, 'ZOHO_WEBHOOK');
  }

  if (event.event_id !== undefined) processedEventIds.add(event.event_id);
  res.json({ success: true });
}

module.exports = { handleWebhook, processedEventIds };

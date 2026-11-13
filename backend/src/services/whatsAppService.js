const crypto = require('crypto');
const { logger } = require('./loggerService');

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Gateway Configuration
//
// Primary gateway: sendmsg.in (ICS / Procucev production WABA)
//   Set WHATSAPP_USERNAME + WHATSAPP_PASSWORD + WHATSAPP_FROM_NUMBER.
//
// Secondary gateway: Meta Cloud API (graph.facebook.com)
//   Set WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN.
//
// When no gateway is configured, or every gateway attempt fails, the function
//   returns a wa.me deep-link with success:false so a person can share it.
//   Nothing is reported as sent in that case.
// ─────────────────────────────────────────────────────────────────────────────
function getEnv(key, fallback = '') {
  if (process.env[key] !== undefined && process.env[key] !== '') return process.env[key];
  if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__[key]) {
    return globalThis.__CF_ENV__[key];
  }
  return fallback;
}

const WHATSAPP_CONFIG = {
  // ── sendmsg.in (primary) ──────────────────────────────────────────────────
  get SENDMSG_BASE_URL() { return getEnv('WHATSAPP_BASE_URL', 'https://media.sendmsg.in'); },
  get SENDMSG_TEMPLATE_URL() { return getEnv('WHATSAPP_TEMPLATE_BASE_URL', 'https://wsapi.sendmsg.in'); },
  get USERNAME() { return getEnv('WHATSAPP_USERNAME', ''); },
  get PASSWORD() { return getEnv('WHATSAPP_PASSWORD', ''); },
  get FROM_NUMBER() { return getEnv('WHATSAPP_FROM_NUMBER', ''); },
  get TEMPLATE_RFQ_INVITE() { return getEnv('WHATSAPP_TEMPLATE_RFQ_INVITE', getEnv('WHATSAPP_TEMPLATE_RFQ_NOTIFICATION', 'rfq_notification_for_sellers_for_rfq_feb_5')); },

  // ── Meta Cloud API (secondary) ────────────────────────────────────────────
  get META_API_URL() { return getEnv('WHATSAPP_API_URL', 'https://graph.facebook.com/v19.0'); },
  get PHONE_NUMBER_ID() { return getEnv('WHATSAPP_PHONE_NUMBER_ID', ''); },
  get ACCESS_TOKEN() { return getEnv('WHATSAPP_ACCESS_TOKEN', ''); },

  // ── Shared ────────────────────────────────────────────────────────────────
  get SUPPORT_NUMBER() { return getEnv('WHATSAPP_SUPPORT_NUMBER', ''); },
};

// In-memory throttle cache (30-second cooldown per destination number)
const recentWhatsAppDispatches = new Map();
const WA_THROTTLE_WINDOW_MS = 30000;

// Status reported for every send attempt. `success` is true only when a provider accepted the message.
const WHATSAPP_SEND_STATUS = Object.freeze({
  SENT: 'sent',
  THROTTLED: 'throttled',
  LINK_ONLY: 'link_only',
  NOT_CONFIGURED: 'not_configured',
  SKIPPED: 'skipped',
});

// Messages stay in this module until they move to backend/src/config/constants.js.
const WHATSAPP_MESSAGES = Object.freeze({
  INVALID_PHONE: 'Invalid phone number format',
  RFQ_NUMBER_REQUIRED: 'An RFQ number is required to send a WhatsApp RFQ invitation.',
  THROTTLED: 'A WhatsApp invitation to this number was sent within the last 30 seconds. Retry after the cooldown ends.',
  LINK_ONLY: 'No WhatsApp provider accepted the message. Share the returned link manually.',
  NOT_CONFIGURED: 'No WhatsApp provider is configured. Set WHATSAPP_USERNAME, WHATSAPP_PASSWORD and WHATSAPP_FROM_NUMBER for sendmsg.in, or WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN for Meta Cloud API. Share the returned link manually until then.',
  NOT_SPECIFIED: 'Not specified',
});

function clearWhatsAppThrottleCache() {
  recentWhatsAppDispatches.clear();
}

/**
 * Clear the throttle entry for a single phone number.
 * Called by rfqChaserScheduler before each scheduled chaser dispatch so the
 * chaser always fires regardless of a recent immediate invite send.
 * @param {string} phone
 */
function clearWhatsAppThrottleForPhone(phone) {
  const formatted = formatWhatsAppNumber(phone);
  if (formatted) recentWhatsAppDispatches.delete(formatted);
}

/**
 * Normalizes destination phone number with 91 country code.
 * @param {string} phone
 * @returns {string} E.g. '919876543210'
 */
function formatWhatsAppNumber(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
}

/**
 * Generates an interactive 1-click WhatsApp quote web URL.
 * @param {string} rfqNumber
 * @param {string} [vendorEmail]
 * @returns {string}
 */
function generateOneClickBidUrl(rfqNumber, vendorEmail) {
  const base = process.env.PUBLIC_FRONTEND_URL || 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';
  const emailParam = vendorEmail ? `&email=${encodeURIComponent(vendorEmail)}` : '';
  return `${base}/vendor/quotation-form?rfq=${encodeURIComponent(rfqNumber)}&source=wa_1click${emailParam}`;
}

/**
 * Builds direct wa.me interactive deep-link.
 * @param {string} phone
 * @param {string} messageText
 * @returns {string}
 */
function buildDirectWhatsAppLink(phone, messageText) {
  const formatted = formatWhatsAppNumber(phone);
  return `https://wa.me/${formatted}?text=${encodeURIComponent(messageText)}`;
}

/**
 * Invitation text shared by the wa.me link and the Meta Cloud API message.
 * Optional descriptive fields show "Not specified" when the caller omits them.
 */
function _buildInvitationText({ rfqNumber, rfqTitle, deliveryDate, deliveryLocation, bidUrl }) {
  return `An RFQ is available on Procucev Portal (QUA AI).\n\n*RFQ ID:* ${rfqNumber}\n*Delivery Date:* ${deliveryDate || WHATSAPP_MESSAGES.NOT_SPECIFIED}\n*Delivery Location:* ${deliveryLocation || WHATSAPP_MESSAGES.NOT_SPECIFIED}\n*Description:* ${rfqTitle || WHATSAPP_MESSAGES.NOT_SPECIFIED}\n\nClick on the Procucev Portal ${bidUrl} link to view or submit your quote.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal gateway helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the provider's own message id from a sendmsg.in response item, or undefined.
 * Never derives an id locally: a local id would claim the provider issued one.
 * @param {unknown} firstItem
 * @returns {string|undefined}
 */
function _extractSendmsgMessageId(firstItem) {
  if (!firstItem || typeof firstItem !== 'object') return undefined;
  const providerId = firstItem.messageId || firstItem.message_id || firstItem.msgid || firstItem.id;
  return providerId ? String(providerId) : undefined;
}

/**
 * Build the 5-placeholder template parameter array expected by
 * rfq_notification_for_sellers_for_rfq_feb_5:
 *   {{1}} RFQ ID   {{2}} Delivery Date   {{3}} Location
 *   {{4}} Description   {{5}} Portal link
 *
 * @param {object} params
 * @returns {object} keyed placeholders dict { "0": val0, ... }
 */
function _buildRfqTemplatePlaceholders({ vendorName, contactPerson, rfqNumber, rfqTitle, deliveryDate, deliveryLocation, portalLink }) {
  const defaultFrontend = process.env.PUBLIC_FRONTEND_URL || 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';
  const resolvedPortalLink = portalLink || `${defaultFrontend}/vendor/quotation-form?rfq=${encodeURIComponent(rfqNumber || '')}`;

  // Approved 5-placeholder template: rfq_notification_for_sellers_for_rfq_feb_5
  // Body (sendmsg.in dashboard, status: Approved):
  //   An RFQ is available on Procucev Portal (QUA AI).
  //
  //   *RFQ ID:* {{1}}
  //   *Delivery Date:* {{2}}
  //   *Delivery Location:* {{3}}
  //   *Description:* {{4}}
  //
  //   Click on the Procucev Portal {{5}} link to view or submit your quote.
  const lp1 = String(rfqNumber);
  const lp2 = deliveryDate ? String(deliveryDate) : WHATSAPP_MESSAGES.NOT_SPECIFIED;
  const lp3 = deliveryLocation ? String(deliveryLocation) : WHATSAPP_MESSAGES.NOT_SPECIFIED;
  const lp4 = rfqTitle ? String(rfqTitle) : WHATSAPP_MESSAGES.NOT_SPECIFIED;
  const lp5 = resolvedPortalLink;

  return {
    '1': lp1,
    '2': lp2,
    '3': lp3,
    '4': lp4,
    '5': lp5,
  };
}

/**
 * Send via sendmsg.in template message API (/mediasend).
 * Returns { success, messageId } or throws on network failure.
 *
 * @param {string} formattedPhone  E.164 without '+', e.g. '919876543210'
 * @param {object} placeholders    Keyed placeholder dict
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function _sendViaSendmsg(formattedPhone, placeholders) {
  const endpoint = `${WHATSAPP_CONFIG.SENDMSG_BASE_URL}/mediasend`;

  const payload = {
    user: WHATSAPP_CONFIG.USERNAME,
    pass: WHATSAPP_CONFIG.PASSWORD,
    whatsapptosend: [
      {
        from: WHATSAPP_CONFIG.FROM_NUMBER,
        to: formattedPhone,
        templateid: WHATSAPP_CONFIG.TEMPLATE_RFQ_INVITE,
        smsgid: `rfq_${formattedPhone}_${WHATSAPP_CONFIG.TEMPLATE_RFQ_INVITE}_${crypto.randomUUID()}`,
        placeholders: [placeholders],
        buttons: [],
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  // sendmsg.in returns 200 with a text or JSON body on success/failure.
  // Even on real delivery failures it returns HTTP 200, so we must parse
  // the body to distinguish success from a template/account error.
  const bodyText = await res.text().catch(() => '');
  let bodyJson = null;
  try { bodyJson = JSON.parse(bodyText); } catch { /* plain text body */ }

  // Failure indicators in the sendmsg.in WhatsApp response body:
  //   { "status": "error" | "fail" }  or  [{ "status": "error" }]
  const firstItem = Array.isArray(bodyJson) ? bodyJson[0] : bodyJson;
  const gatewayStatus = firstItem && (firstItem.status || firstItem.Status || '');
  const isGatewayError = typeof gatewayStatus === 'string' &&
    /^(error|fail|failure|invalid)/i.test(gatewayStatus);

  if (res.ok && !isGatewayError) {
    logger.info(
      `[WHATSAPP] sendmsg.in delivered to ${formattedPhone}`,
      { response: bodyText.slice(0, 200) },
      'WHATSAPP_SERVICE'
    );
    return { success: true, messageId: _extractSendmsgMessageId(firstItem) };
  }

  const errDetail = (firstItem && (firstItem.message || firstItem.error || firstItem.reason)) ||
    `HTTP ${res.status}`;
  logger.warn(
    `[WHATSAPP] sendmsg.in failed for ${formattedPhone}: ${errDetail}`,
    { status: res.status, response: bodyText.slice(0, 200) },
    'WHATSAPP_SERVICE'
  );
  return { success: false, error: `sendmsg.in: ${errDetail}` };
}

/**
 * Send via Meta Cloud API (graph.facebook.com).
 * Returns { success, messageId } or throws on network failure.
 *
 * @param {string} formattedPhone
 * @param {string} waMessage  Plain-text body
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function _sendViaMeta(formattedPhone, waMessage) {
  const endpoint = `${WHATSAPP_CONFIG.META_API_URL}/${WHATSAPP_CONFIG.PHONE_NUMBER_ID}/messages`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_CONFIG.ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'text',
      text: { preview_url: true, body: waMessage },
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.messages?.[0]?.id) {
    logger.info(`[WHATSAPP] Meta Cloud API delivered to ${formattedPhone}`, { messageId: data.messages[0].id }, 'WHATSAPP_SERVICE');
    return { success: true, messageId: data.messages[0].id };
  }

  const errMsg = data?.error?.message || `HTTP ${res.status}`;
  logger.warn(`[WHATSAPP] Meta Cloud API failed for ${formattedPhone}: ${errMsg}`, {}, 'WHATSAPP_SERVICE');
  return { success: false, error: errMsg };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dispatches an RFQ invitation over WhatsApp.
 *
 * Gateway priority:
 *   1. sendmsg.in — when WHATSAPP_USERNAME + WHATSAPP_PASSWORD + WHATSAPP_FROM_NUMBER are set
 *   2. Meta Cloud API — when WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN are set
 *   3. Link only — returned with success:false when no gateway accepted the message
 *
 * @param {Object} params
 * @param {string} params.phone             Destination mobile number
 * @param {string} params.vendorName        Vendor company name
 * @param {string} [params.contactPerson]   Contact person name
 * @param {string} params.rfqNumber         RFQ reference number (required)
 * @param {string} params.rfqTitle          RFQ title/scope
 * @param {string} [params.vendorEmail]     Vendor email (embedded in bid URL)
 * @param {string} [params.deliveryDate]    Expected delivery date string
 * @param {string} [params.deliveryLocation] City/state for delivery
 * @returns {Promise<{ success: boolean, status: string, messageId?: string, link?: string, bidUrl?: string, throttled?: boolean, error?: string }>}
 */
async function sendRFQInvitationWhatsApp({
  phone,
  vendorName,
  contactPerson,
  rfqNumber,
  rfqTitle,
  vendorEmail,
  deliveryDate,
  deliveryLocation,
}) {
  const formattedPhone = formatWhatsAppNumber(phone);
  if (!formattedPhone || formattedPhone.length < 10) {
    logger.warn('[WHATSAPP] Dispatch skipped: invalid phone number', { phone }, 'WHATSAPP_SERVICE');
    return { success: false, status: WHATSAPP_SEND_STATUS.SKIPPED, error: WHATSAPP_MESSAGES.INVALID_PHONE };
  }

  if (!rfqNumber) {
    logger.warn('[WHATSAPP] Dispatch skipped: RFQ number missing', { phone: formattedPhone }, 'WHATSAPP_SERVICE');
    return { success: false, status: WHATSAPP_SEND_STATUS.SKIPPED, error: WHATSAPP_MESSAGES.RFQ_NUMBER_REQUIRED };
  }

  const bidUrl = generateOneClickBidUrl(rfqNumber, vendorEmail);
  const invitationText = _buildInvitationText({ rfqNumber, rfqTitle, deliveryDate, deliveryLocation, bidUrl });
  const directLink = buildDirectWhatsAppLink(formattedPhone, invitationText);

  // With no gateway credentials nothing can be sent, so no throttle entry is recorded.
  const sendmsgConfigured = Boolean(WHATSAPP_CONFIG.USERNAME && WHATSAPP_CONFIG.PASSWORD && WHATSAPP_CONFIG.FROM_NUMBER);
  const metaConfigured = Boolean(WHATSAPP_CONFIG.PHONE_NUMBER_ID && WHATSAPP_CONFIG.ACCESS_TOKEN);
  if (!sendmsgConfigured && !metaConfigured) {
    logger.warn('[WHATSAPP] No gateway configured: returning wa.me link only', { phone: formattedPhone, rfqNumber }, 'WHATSAPP_SERVICE');
    return {
      success: false,
      status: WHATSAPP_SEND_STATUS.NOT_CONFIGURED,
      link: directLink,
      bidUrl,
      error: WHATSAPP_MESSAGES.NOT_CONFIGURED,
    };
  }

  // Throttle guard — skip in test env
  const now = Date.now();
  const lastSent = recentWhatsAppDispatches.get(formattedPhone) || 0;
  if (process.env.NODE_ENV !== 'test' && now - lastSent < WA_THROTTLE_WINDOW_MS) {
    logger.warn(`[WHATSAPP] Throttled: ${formattedPhone} within cooldown`, {}, 'WHATSAPP_SERVICE');
    const greeting = contactPerson ? `Hi ${contactPerson}, ` : '';
    return {
      success: false,
      status: WHATSAPP_SEND_STATUS.THROTTLED,
      throttled: true,
      error: WHATSAPP_MESSAGES.THROTTLED,
      link: buildDirectWhatsAppLink(formattedPhone, `${greeting}view RFQ ${rfqNumber}: ${bidUrl}`),
      bidUrl,
    };
  }
  recentWhatsAppDispatches.set(formattedPhone, now);
  let gatewayError = null;

  // ── 1. sendmsg.in (primary) ────────────────────────────────────────────────
  if (sendmsgConfigured && process.env.NODE_ENV !== 'test') {
    try {
      const placeholders = _buildRfqTemplatePlaceholders({
        vendorName,
        contactPerson,
        rfqNumber,
        rfqTitle,
        deliveryDate,
        deliveryLocation,
        portalLink: bidUrl,
      });
      const result = await _sendViaSendmsg(formattedPhone, placeholders);
      if (result.success) {
        return { success: true, status: WHATSAPP_SEND_STATUS.SENT, messageId: result.messageId, link: directLink, bidUrl };
      }
      gatewayError = result.error;
      // Fall through to Meta if sendmsg.in fails
      logger.warn(`[WHATSAPP] sendmsg.in failed, trying Meta fallback: ${result.error}`, {}, 'WHATSAPP_SERVICE');
    } catch (err) {
      gatewayError = err.message;
      logger.warn(`[WHATSAPP] sendmsg.in threw, trying Meta fallback: ${err.message}`, {}, 'WHATSAPP_SERVICE');
    }
  }

  // ── 2. Meta Cloud API (secondary) ─────────────────────────────────────────
  if (metaConfigured && process.env.NODE_ENV !== 'test') {
    try {
      const result = await _sendViaMeta(formattedPhone, invitationText);
      if (result.success) {
        return { success: true, status: WHATSAPP_SEND_STATUS.SENT, messageId: result.messageId, link: directLink, bidUrl };
      }
      gatewayError = result.error;
    } catch (err) {
      gatewayError = err.message;
      logger.warn(`[WHATSAPP] Meta Cloud API threw: ${err.message}`, {}, 'WHATSAPP_SERVICE');
    }
  }

  // ── 3. Link only: no provider accepted the message ────────────────────────
  // gatewayError carries the last provider error, when a provider was reached.
  logger.info(`[WHATSAPP] Link-only result for ${formattedPhone} (${rfqNumber})`, { gatewayError }, 'WHATSAPP_SERVICE');
  return {
    success: false,
    status: WHATSAPP_SEND_STATUS.LINK_ONLY,
    link: directLink,
    bidUrl,
    error: gatewayError || WHATSAPP_MESSAGES.LINK_ONLY,
  };
}

module.exports = {
  WHATSAPP_CONFIG,
  WHATSAPP_SEND_STATUS,
  clearWhatsAppThrottleCache,
  clearWhatsAppThrottleForPhone,
  formatWhatsAppNumber,
  generateOneClickBidUrl,
  buildDirectWhatsAppLink,
  sendRFQInvitationWhatsApp,
};

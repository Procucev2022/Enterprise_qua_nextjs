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
// Fallback (no credentials): returns a deep wa.me direct-link so the
//   caller always gets something usable regardless of configuration state.
// ─────────────────────────────────────────────────────────────────────────────
const WHATSAPP_CONFIG = {
  // ── sendmsg.in (primary) ──────────────────────────────────────────────────
  SENDMSG_BASE_URL: process.env.WHATSAPP_BASE_URL || 'https://media.sendmsg.in',
  SENDMSG_TEMPLATE_URL: process.env.WHATSAPP_TEMPLATE_BASE_URL || 'https://wsapi.sendmsg.in',
  USERNAME: process.env.WHATSAPP_USERNAME || '',
  PASSWORD: process.env.WHATSAPP_PASSWORD || '',
  FROM_NUMBER: process.env.WHATSAPP_FROM_NUMBER || '',
  TEMPLATE_RFQ_INVITE: process.env.WHATSAPP_TEMPLATE_RFQ_NOTIFICATION || 'rfq_notification_for_sellers_for_rfq_feb_5',

  // ── Meta Cloud API (secondary) ────────────────────────────────────────────
  META_API_URL: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v19.0',
  PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',

  // ── Shared ────────────────────────────────────────────────────────────────
  SUPPORT_NUMBER: process.env.WHATSAPP_SUPPORT_NUMBER || '+917090170855',
};

// In-memory throttle cache (30-second cooldown per destination number)
const recentWhatsAppDispatches = new Map();
const WA_THROTTLE_WINDOW_MS = 30000;

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

// ─────────────────────────────────────────────────────────────────────────────
// Internal gateway helpers
// ─────────────────────────────────────────────────────────────────────────────

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
  const currentTemplate = WHATSAPP_CONFIG.TEMPLATE_RFQ_INVITE || '';
  const defaultFrontend = process.env.PUBLIC_FRONTEND_URL || 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';
  const resolvedPortalLink = portalLink || `${defaultFrontend}/vendor/quotation-form?rfq=${encodeURIComponent(rfqNumber || '')}`;

  // 6-placeholder template: rfq_reminder_notification_v2
  // {{1}} Vendor Name  {{2}} Title  {{3}} RFQ No  {{4}} Delivery Date  {{5}} Location  {{6}} Portal link
  if (currentTemplate.includes('v2') || currentTemplate.includes('reminder')) {
    return {
      '0': String(vendorName || contactPerson || 'Partner'),
      '1': String(rfqTitle || 'RFQ Requirement'),
      '2': String(rfqNumber || 'N/A'),
      '3': deliveryDate ? String(deliveryDate) : 'As per RFQ',
      '4': deliveryLocation ? String(deliveryLocation) : 'India',
      '5': resolvedPortalLink,
    };
  }

  // Legacy 5-placeholder template: rfq_notification_for_sellers_for_rfq_feb_5
  return {
    '0': String(rfqNumber || 'N/A'),
    '1': deliveryDate ? String(deliveryDate) : 'N/A',
    '2': deliveryLocation ? String(deliveryLocation) : 'N/A',
    '3': rfqTitle ? String(rfqTitle) : 'N/A',
    '4': resolvedPortalLink,
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
        smsgid: `rfq_${formattedPhone}_${WHATSAPP_CONFIG.TEMPLATE_RFQ_INVITE}`,
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
    return { success: true, messageId: `sendmsg-${Date.now()}` };
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
 *   3. Deep-link fallback — always available; returns a wa.me link the caller can surface
 *
 * @param {Object} params
 * @param {string} params.phone             Destination mobile number
 * @param {string} params.vendorName        Vendor company name
 * @param {string} [params.contactPerson]   Contact person name
 * @param {string} params.rfqNumber         RFQ reference number
 * @param {string} params.rfqTitle          RFQ title/scope
 * @param {string} [params.vendorEmail]     Vendor email (embedded in bid URL)
 * @param {string} [params.deliveryDate]    Expected delivery date string
 * @param {string} [params.deliveryLocation] City/state for delivery
 * @returns {Promise<{ success: boolean, messageId?: string, link?: string, throttled?: boolean, error?: string }>}
 */
async function sendRFQInvitationWhatsApp({
  phone,
  vendorName,
  contactPerson = 'Supplier Partner',
  rfqNumber,
  rfqTitle,
  vendorEmail,
  deliveryDate,
  deliveryLocation,
}) {
  const formattedPhone = formatWhatsAppNumber(phone);
  if (!formattedPhone || formattedPhone.length < 10) {
    logger.warn('[WHATSAPP] Dispatch skipped: invalid phone number', { phone }, 'WHATSAPP_SERVICE');
    return { success: false, error: 'Invalid phone number format' };
  }

  // Throttle guard — skip in test env
  const now = Date.now();
  const lastSent = recentWhatsAppDispatches.get(formattedPhone) || 0;
  if (process.env.NODE_ENV !== 'test' && now - lastSent < WA_THROTTLE_WINDOW_MS) {
    logger.warn(`[WHATSAPP] Throttled: ${formattedPhone} within cooldown`, {}, 'WHATSAPP_SERVICE');
    const bidUrl = generateOneClickBidUrl(rfqNumber, vendorEmail);
    return {
      success: true,
      throttled: true,
      messageId: 'wa-throttled',
      link: buildDirectWhatsAppLink(formattedPhone, `Hi ${contactPerson}, view RFQ ${rfqNumber}: ${bidUrl}`),
    };
  }
  recentWhatsAppDispatches.set(formattedPhone, now);

  const bidUrl = generateOneClickBidUrl(rfqNumber, vendorEmail);
  const directLink = buildDirectWhatsAppLink(
    formattedPhone,
    `💬 Procucev RFQ Alert — ${rfqNumber}: ${bidUrl}`,
  );

  // ── 1. sendmsg.in (primary) ────────────────────────────────────────────────
  if (
    WHATSAPP_CONFIG.USERNAME &&
    WHATSAPP_CONFIG.PASSWORD &&
    WHATSAPP_CONFIG.FROM_NUMBER &&
    process.env.NODE_ENV !== 'test'
  ) {
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
        return { success: true, messageId: result.messageId, link: directLink, bidUrl };
      }
      // Fall through to Meta if sendmsg.in fails
      logger.warn(`[WHATSAPP] sendmsg.in failed, trying Meta fallback: ${result.error}`, {}, 'WHATSAPP_SERVICE');
    } catch (err) {
      logger.warn(`[WHATSAPP] sendmsg.in threw, trying Meta fallback: ${err.message}`, {}, 'WHATSAPP_SERVICE');
    }
  }

  // ── 2. Meta Cloud API (secondary) ─────────────────────────────────────────
  if (
    WHATSAPP_CONFIG.PHONE_NUMBER_ID &&
    WHATSAPP_CONFIG.ACCESS_TOKEN &&
    process.env.NODE_ENV !== 'test'
  ) {
    try {
      const waMessage = `💬 *Procucev Enterprise RFQ Alert*\n\nHello ${contactPerson} (${vendorName}),\n\nYou have been invited to quote for:\n📌 *${rfqTitle || rfqNumber}*\n🔖 RFQ Ref: ${rfqNumber}\n\n⚡ Submit your line-item quote with 1-click:\n👉 ${bidUrl}\n\nFor support reply to this message or contact ${WHATSAPP_CONFIG.SUPPORT_NUMBER}.`;
      const result = await _sendViaMeta(formattedPhone, waMessage);
      if (result.success) {
        return { success: true, messageId: result.messageId, link: directLink, bidUrl };
      }
    } catch (err) {
      logger.warn(`[WHATSAPP] Meta Cloud API threw: ${err.message}`, {}, 'WHATSAPP_SERVICE');
    }
  }

  // ── 3. Deep-link fallback ─────────────────────────────────────────────────
  logger.info(`[WHATSAPP] Deep-link fallback for ${formattedPhone} (${rfqNumber})`, {}, 'WHATSAPP_SERVICE');
  return {
    success: true,
    messageId: `wa-link-${Date.now()}`,
    link: directLink,
    bidUrl,
  };
}

module.exports = {
  WHATSAPP_CONFIG,
  clearWhatsAppThrottleCache,
  clearWhatsAppThrottleForPhone,
  formatWhatsAppNumber,
  generateOneClickBidUrl,
  buildDirectWhatsAppLink,
  sendRFQInvitationWhatsApp,
};

const { logger } = require('./loggerService');
const { SMS_DLT_TEMPLATES } = require('../config/constants');

// ─────────────────────────────────────────────────────────────────────────────
// URL Shortener
//
// This helper is not used for RFQ DLT messages: their URL must remain on a
// domain registered for the approved {#urg#} variable.
// ─────────────────────────────────────────────────────────────────────────────

// In-memory cache: original URL → shortened URL (avoids re-shortening on retries)
const _shortUrlCache = new Map();

/**
 * Shorten a URL via TinyURL's free API (no key required).
 * Returns the shortened URL, or the original if shortening fails.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function shortenUrl(url) {
  if (!url) return url;
  if (_shortUrlCache.has(url)) return _shortUrlCache.get(url);

  try {
    const res = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(5000) }
    );

    if (res.ok) {
      const short = (await res.text()).trim();

      // Validate it's actually a tinyurl.com link, not an error string
      if (
        short.startsWith('https://tinyurl.com/') ||
        short.startsWith('http://tinyurl.com/')
      ) {
        _shortUrlCache.set(url, short);
        logger.info(
          `[SMS_SERVICE] URL shortened: ${url.slice(0, 60)}... → ${short}`,
          {},
          'SMS_SERVICE'
        );
        return short;
      }
    }
  } catch (err) {
    logger.warn(
      `[SMS_SERVICE] URL shortening failed (using original): ${err.message}`,
      { url },
      'SMS_SERVICE'
    );
  }

  return url; // fallback — never block SMS dispatch
}

/**
 * Clear the short URL cache (used in tests).
 */
function clearShortUrlCache() {
  _shortUrlCache.clear();
}

function getEnv(key, fallback = '') {
  if (process.env[key] !== undefined && process.env[key] !== '') {
    return process.env[key];
  }

  if (
    typeof globalThis !== 'undefined' &&
    globalThis.__CF_ENV__ &&
    globalThis.__CF_ENV__[key]
  ) {
    return globalThis.__CF_ENV__[key];
  }

  return fallback;
}

// SMS Gateway configuration loaded from environment with defaults
const SMS_GATEWAY_CONFIG = {
  get URL() {
    return getEnv('SMS_GATEWAY_URL', 'https://sms.sendmsg.in/datasend');
  },

  get USER() {
    return getEnv('SMS_GATEWAY_USER', '');
  },

  get RFQ_USER() {
    return getEnv('SMS_GATEWAY_RFQ_USER', '');
  },

  get PASS() {
    return getEnv('SMS_GATEWAY_PASS', '');
  },

  get RFQ_PASS() {
    return getEnv('SMS_GATEWAY_RFQ_PASS');
  },

  get SENDER() {
    return getEnv('SMS_GATEWAY_SENDER', 'PROCUC');
  },

  get SMSGID() {
    return getEnv('SMS_GATEWAY_SMSGID', '1102294821');
  },

  // RFQ chaser template — uses SMS_DLT_TEMPLATES.RFQ_CHASER.SMSGID as source of truth,
  // overridable via SMS_GATEWAY_RFQ_SMSGID env var.
  get RFQ_SMSGID() {
    return getEnv(
      'SMS_GATEWAY_RFQ_SMSGID',
      SMS_DLT_TEMPLATES.RFQ_CHASER.SMSGID
    );
  },

  // Buyer 48h bids unlocked template — uses SMS_DLT_TEMPLATES.BUYER_BIDS_UNLOCKED.SMSGID
  // overridable via SMS_GATEWAY_BUYER_UNLOCKED_SMSGID env var.
  get BUYER_UNLOCKED_SMSGID() {
    return getEnv(
      'SMS_GATEWAY_BUYER_UNLOCKED_SMSGID',
      SMS_DLT_TEMPLATES.BUYER_BIDS_UNLOCKED.SMSGID
    );
  },

  get ACTION_CENTER_SMSGID() {
    return getEnv(
      'SMS_GATEWAY_ACTION_CENTER_SMSGID',
      (SMS_DLT_TEMPLATES.ACTION_CENTER_COMM && SMS_DLT_TEMPLATES.ACTION_CENTER_COMM.SMSGID) || '1777179138668879299'
    );
  },
};

// In-memory cooldown throttle cache to prevent infinite / spam loop SMS dispatches
// to the same phone number
const recentSmsDispatches = new Map();
const SMS_THROTTLE_WINDOW_MS = 30000; // 30-second throttle cooldown per destination number

// Status reported for every send attempt. `success` is true only when the gateway accepted the message.
const SMS_SEND_STATUS = Object.freeze({
  SENT: 'sent',
  THROTTLED: 'throttled',
  SKIPPED: 'skipped',
  NOT_CONFIGURED: 'not_configured',
  FAILED: 'failed',
});

// Messages stay in this module until they move to backend/src/config/constants.js.
const SMS_MESSAGES = Object.freeze({
  INVALID_MOBILE: 'Invalid mobile number format',
  INVALID_ACTION_CENTER_MOBILE: 'Invalid mobile number format. A 10-digit Indian mobile number is required.',
  RFQ_NUMBER_REQUIRED: 'An RFQ number is required to send this SMS.',
  QUOTES_COUNT_REQUIRED: 'A whole number of quotes (0 or more) is required to send the buyer comparison SMS.',
  MESSAGE_REQUIRED: 'Message text is required to send an Action Center SMS.',
  RFQ_GATEWAY_NOT_CONFIGURED: 'RFQ SMS gateway credentials are not configured',
  GATEWAY_NOT_CONFIGURED: 'SMS gateway credentials are not configured. Set SMS_GATEWAY_USER and SMS_GATEWAY_PASS before sending.',
  THROTTLED: 'SMS was not dispatched because this recipient is temporarily rate-limited. Retry after 30 seconds.',
  TEST_ENVIRONMENT: 'SMS was not dispatched because the test environment never sends live messages.',
  GATEWAY_REJECTED: 'SMS gateway rejected the message',
  NOT_SPECIFIED: 'Not specified',
});

const SMS_SKIP_REASON = Object.freeze({
  TEST_ENVIRONMENT: 'test_environment',
});

function clearSmsThrottleCache() {
  recentSmsDispatches.clear();
}

/**
 * Clear the throttle entry for a single phone number.
 * Called by rfqChaserScheduler before each scheduled chaser dispatch so the
 * chaser always fires regardless of a recent immediate invite send.
 * @param {string} mobile
 */
function clearSmsThrottleForPhone(mobile) {
  const formatted = formatMobileNumber(mobile);

  if (formatted) {
    recentSmsDispatches.delete(formatted);
  }
}

/**
 * Normalizes Indian mobile number for SMS gateway delivery (10 national digits)
 * @param {string} mobile
 * @returns {string}
 */
function formatMobileNumber(mobile) {
  if (!mobile) return '';

  const digits = String(mobile).replace(/\D/g, '');

  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }

  return digits;
}

/**
 * True when the gateway response shows a rejection: an HTTP error status, or an
 * error marker in the body. `success` is only set for messages the gateway accepted.
 * @param {Response} res
 * @param {string} responseText
 * @returns {boolean}
 */
function _isGatewayRejection(res, responseText) {
  return !res.ok ||
    /^(ERR|ERROR|FAIL|INVALID|REJECTED)/i.test(responseText.trim()) ||
    /"status"\s*:\s*"(?:error|failed|failure|invalid|rejected)"/i.test(responseText);
}

/**
 * Returns the gateway's own message id from its response body, or undefined when
 * the gateway returns none. A local id is never generated.
 * @param {string} responseText
 * @returns {string|undefined}
 */
function _extractGatewayMessageId(responseText) {
  try {
    const parsed = JSON.parse(responseText);
    const id = parsed && (parsed.msgid || parsed.messageId || parsed.id);
    return id ? String(id) : undefined;
  } catch {
    const match = responseText.match(/msgid[=:]\s*([a-zA-Z0-9_-]+)/i);
    return match ? match[1] : undefined;
  }
}

/**
 * Error text for a gateway rejection, including the HTTP status for diagnosis.
 * @param {Response} res
 * @returns {string}
 */
function _rejectionError(res) {
  return `${SMS_MESSAGES.GATEWAY_REJECTED} (HTTP ${res.status}).`;
}

/**
 * True for a whole, non-negative count (number or digit string).
 * @param {unknown} value
 * @returns {boolean}
 */
function _isWholeCount(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0;
  if (typeof value === 'string') return /^\d+$/.test(value.trim());
  return false;
}

/**
 * Dispatches an OTP verification SMS via the SMS gateway
 * @param {string} mobile Destination mobile number
 * @param {string} code OTP verification code
 * @param {number} [expiresInSeconds=900] Code validity in seconds
 * @returns {Promise<{ success: boolean, status: string, messageId?: string, reason?: string, throttled?: boolean, error?: string }>}
 */
async function sendOtpSms(mobile, code, expiresInSeconds = 900) {
  const formattedNumber = formatMobileNumber(mobile);

  if (!formattedNumber || formattedNumber.length !== 10) {
    logger.warn(
      'SMS dispatch skipped: Invalid mobile number format',
      { mobileLength: String(mobile || '').length },
      'SMS_SERVICE'
    );

    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      error: SMS_MESSAGES.INVALID_MOBILE,
    };
  }

  // In test environment, skip live HTTP dispatch to avoid spamming recipient with test OTPs.
  // Nothing is recorded in the throttle cache because nothing is dispatched.
  if (process.env.NODE_ENV === 'test') {
    logger.info(
      '[TEST MODE] SMS OTP dispatch skipped',
      { reason: SMS_SKIP_REASON.TEST_ENVIRONMENT },
      'SMS_SERVICE'
    );

    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      reason: SMS_SKIP_REASON.TEST_ENVIRONMENT,
      error: SMS_MESSAGES.TEST_ENVIRONMENT,
    };
  }

  if (!SMS_GATEWAY_CONFIG.USER || !SMS_GATEWAY_CONFIG.PASS) {
    logger.error(SMS_MESSAGES.GATEWAY_NOT_CONFIGURED, {}, 'SMS_SERVICE');
    return {
      success: false,
      status: SMS_SEND_STATUS.NOT_CONFIGURED,
      error: SMS_MESSAGES.GATEWAY_NOT_CONFIGURED,
    };
  }

  const now = Date.now();
  const lastSent = recentSmsDispatches.get(formattedNumber) || 0;

  if (now - lastSent < SMS_THROTTLE_WINDOW_MS) {
    logger.warn(
      'SMS dispatch throttled by the recipient cooldown window',
      { cooldownSeconds: SMS_THROTTLE_WINDOW_MS / 1000 },
      'SMS_SERVICE'
    );

    return {
      success: false,
      status: SMS_SEND_STATUS.THROTTLED,
      throttled: true,
      error: SMS_MESSAGES.THROTTLED,
    };
  }

  recentSmsDispatches.set(formattedNumber, now);

  // DLT Approved Template:
  // "OTP for registering your access to Get My quoTe (GMT): <OTP>.
  // Valid for 5 mins. Do not share. - Team Procucev."
  const message = `OTP for registering your access to Get My quoTe (GMT): ${code}. Valid for 5 mins. Do not share. - Team Procucev.`;

  const payload = {
    user: SMS_GATEWAY_CONFIG.USER,
    pass: SMS_GATEWAY_CONFIG.PASS,
    smstosend: [
      {
        to: `91${formattedNumber}`,
        from: SMS_GATEWAY_CONFIG.SENDER,
        smstext: message,
        smsgid: SMS_GATEWAY_CONFIG.SMSGID,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(SMS_GATEWAY_CONFIG.URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseText = await res.text();
    const rejected = _isGatewayRejection(res, responseText);

    logger.info(
      'SMS OTP delivery provider responded',
      {
        status: res.status,
        accepted: !rejected,
        responseLength: responseText.length,
      },
      'SMS_SERVICE'
    );

    if (rejected) {
      return {
        success: false,
        status: SMS_SEND_STATUS.FAILED,
        error: _rejectionError(res),
        response: responseText,
      };
    }

    return {
      success: true,
      status: SMS_SEND_STATUS.SENT,
      messageId: _extractGatewayMessageId(responseText),
      response: responseText,
    };
  } catch (err) {
    logger.error(
      'Failed to dispatch SMS OTP via gateway',
      err,
      'SMS_SERVICE'
    );

    return {
      success: false,
      status: SMS_SEND_STATUS.FAILED,
      error: err.message,
    };
  }
}

/**
 * Dispatches an RFQ chaser SMS to a supplier
 * @param {Object} params
 * @param {string} params.mobile
 * @param {string} params.vendorName
 * @param {string} params.rfqNumber   Required; rendered into the DLT template.
 * @param {string} params.rfqTitle
 * @param {string} [params.bidLink]
 * @returns {Promise<{ success: boolean, status: string, messageId?: string, reason?: string, throttled?: boolean, error?: string }>}
 */
async function sendRFQChaserSms({
  mobile,
  vendorName,
  rfqNumber,
  rfqTitle,
  bidLink,
}) {
  const formattedNumber = formatMobileNumber(mobile);

  if (!formattedNumber || formattedNumber.length !== 10) {
    logger.warn(
      'SMS dispatch skipped: Invalid mobile number format',
      { mobile },
      'SMS_SERVICE'
    );

    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      error: SMS_MESSAGES.INVALID_MOBILE,
    };
  }

  if (!rfqNumber) {
    logger.warn('SMS dispatch skipped: RFQ number missing', { vendorName }, 'SMS_SERVICE');
    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      error: SMS_MESSAGES.RFQ_NUMBER_REQUIRED,
    };
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      reason: SMS_SKIP_REASON.TEST_ENVIRONMENT,
      error: SMS_MESSAGES.TEST_ENVIRONMENT,
    };
  }

  if (!SMS_GATEWAY_CONFIG.RFQ_USER || !SMS_GATEWAY_CONFIG.RFQ_PASS) {
    const error = SMS_MESSAGES.RFQ_GATEWAY_NOT_CONFIGURED;
    logger.error(error, { rfqNumber }, 'SMS_SERVICE');
    return { success: false, status: SMS_SEND_STATUS.NOT_CONFIGURED, error };
  }

  const now = Date.now();
  const lastSent = recentSmsDispatches.get(formattedNumber) || 0;

  if (now - lastSent < SMS_THROTTLE_WINDOW_MS) {
    return {
      success: false,
      status: SMS_SEND_STATUS.THROTTLED,
      throttled: true,
      error: SMS_MESSAGES.THROTTLED,
    };
  }

  recentSmsDispatches.set(formattedNumber, now);

  const defaultFrontend =
    getEnv('PUBLIC_FRONTEND_URL') ||
    'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';

  // Build the quotation-form URL on the DLT-approved frontend domain.
  // Note: We use the approved workers.dev domain directly as registered under TRAI DLT {#urg#}.
  // Clean URL to prevent WhatsApp-specific params (&source=wa_1click) from exceeding carrier limits.
  let resolvedBidLink = bidLink || `${defaultFrontend}/vendor/quotation-form?rfq=${encodeURIComponent(rfqNumber)}`;
  if (resolvedBidLink.includes('&source=wa_1click')) {
    resolvedBidLink = resolvedBidLink.replace(/[?&]source=wa_1click(&|$)/, '$1').replace(/[?&]$/, '');
  }

  // Sanitize {#alp#} placeholders: TRAI DLT requires strictly alphanumeric characters and spaces for {#alp#}
  const sanitizedRfqNumber = String(rfqNumber).replace(/[^\w-]/g, '').trim();
  const sanitizedTitle = String(rfqTitle || rfqNumber)
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || sanitizedRfqNumber;

  const message = SMS_DLT_TEMPLATES.RFQ_CHASER.TEMPLATE
    .replace('{#alp#}', sanitizedRfqNumber)
    .replace('{#alp#}', sanitizedTitle)
    .replace('{#urg#}', resolvedBidLink);

  const messageChars = message.length;
  const smsUnits = Math.ceil(messageChars / 160);

  logger.info(
    `[SMS_SERVICE] RFQ chaser SMS prepared: ${messageChars} chars (${smsUnits} unit${
      smsUnits > 1 ? 's' : ''
    })`,
    {
      rfqNumber,
      messageChars,
      smsUnits,
      bidUrl: resolvedBidLink,
    },
    'SMS_SERVICE'
  );

  const payload = {
    user: SMS_GATEWAY_CONFIG.RFQ_USER,
    pass: SMS_GATEWAY_CONFIG.RFQ_PASS,
    smstosend: [
      {
        to: `91${formattedNumber}`,
        from: SMS_GATEWAY_CONFIG.SENDER,
        smstext: message,
        smsgid: SMS_GATEWAY_CONFIG.RFQ_SMSGID,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(SMS_GATEWAY_CONFIG.URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const responseText = await res.text();
      const rejected = _isGatewayRejection(res, responseText);

      if (rejected) {
        logger.warn(
          `SMS RFQ chaser gateway rejected message for 91${formattedNumber} — HTTP ${res.status}: ${responseText}`,
          {
            status: res.status,
            response: responseText,
            rfqNumber,
            vendorName,
            smsgid: SMS_GATEWAY_CONFIG.RFQ_SMSGID,
            templateName: SMS_DLT_TEMPLATES.RFQ_CHASER.NAME,
          },
          'SMS_SERVICE'
        );
        return {
          success: false,
          status: SMS_SEND_STATUS.FAILED,
          error: _rejectionError(res),
          response: responseText,
        };
      }

      logger.info(
        `SMS RFQ chaser dispatched to 91${formattedNumber} for ${rfqNumber}`,
        {
          status: res.status,
          response: responseText,
          rfqNumber,
          vendorName,
          smsgid: SMS_GATEWAY_CONFIG.RFQ_SMSGID,
          templateName: SMS_DLT_TEMPLATES.RFQ_CHASER.NAME,
          templateCategory: SMS_DLT_TEMPLATES.RFQ_CHASER.CATEGORY,
        },
        'SMS_SERVICE'
      );

      return {
        success: true,
        status: SMS_SEND_STATUS.SENT,
        messageId: _extractGatewayMessageId(responseText),
        response: responseText,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logger.error(
      `Failed to dispatch RFQ Chaser SMS to 91${formattedNumber} for ${rfqNumber}`,
      err,
      'SMS_SERVICE'
    );

    return {
      success: false,
      status: SMS_SEND_STATUS.FAILED,
      error: err.message,
    };
  }
}

/**
 * Dispatches an SMS acknowledgment regarding quotation comparison to the buyer upon RFQ closure
 * @param {Object} params
 * @param {string} params.mobile
 * @param {string} params.buyerName
 * @param {string} params.rfqNumber   Required; rendered into the DLT template.
 * @param {number} params.quotesCount Required whole number of quotes received. Never defaulted.
 * @param {string} [params.matrixLink]
 * @returns {Promise<{ success: boolean, status: string, messageId?: string, reason?: string, throttled?: boolean, error?: string }>}
 */
async function sendBuyerComparisonSms({
  mobile,
  buyerName,
  rfqNumber,
  quotesCount,
  matrixLink,
}) {
  const formattedNumber = formatMobileNumber(mobile);

  if (!formattedNumber || formattedNumber.length !== 10) {
    logger.warn(
      'SMS dispatch skipped: Invalid buyer mobile number format',
      { mobile },
      'SMS_SERVICE'
    );

    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      error: SMS_MESSAGES.INVALID_MOBILE,
    };
  }

  if (!rfqNumber) {
    logger.warn('SMS dispatch skipped: RFQ number missing', { buyerName }, 'SMS_SERVICE');
    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      error: SMS_MESSAGES.RFQ_NUMBER_REQUIRED,
    };
  }

  if (!_isWholeCount(quotesCount)) {
    logger.warn('SMS dispatch skipped: quotes count missing or invalid', { rfqNumber }, 'SMS_SERVICE');
    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      error: SMS_MESSAGES.QUOTES_COUNT_REQUIRED,
    };
  }

  if (process.env.NODE_ENV === 'test') {
    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      reason: SMS_SKIP_REASON.TEST_ENVIRONMENT,
      error: SMS_MESSAGES.TEST_ENVIRONMENT,
    };
  }

  if (!SMS_GATEWAY_CONFIG.RFQ_USER || !SMS_GATEWAY_CONFIG.RFQ_PASS) {
    const error = SMS_MESSAGES.RFQ_GATEWAY_NOT_CONFIGURED;
    logger.error(error, { rfqNumber }, 'SMS_SERVICE');
    return { success: false, status: SMS_SEND_STATUS.NOT_CONFIGURED, error };
  }

  const now = Date.now();
  const lastSent = recentSmsDispatches.get(formattedNumber) || 0;

  if (now - lastSent < SMS_THROTTLE_WINDOW_MS) {
    return {
      success: false,
      status: SMS_SEND_STATUS.THROTTLED,
      throttled: true,
      error: SMS_MESSAGES.THROTTLED,
    };
  }

  recentSmsDispatches.set(formattedNumber, now);

  const defaultFrontend =
    process.env.PUBLIC_FRONTEND_URL ||
    'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';

  const resolvedLink =
    matrixLink ||
    `${defaultFrontend}/buyer/quote-matrix?rfq=${encodeURIComponent(
      rfqNumber
    )}`;

  const rfqText = String(rfqNumber);
  const rfqLabel = rfqText.toUpperCase().startsWith('RFQ ')
    ? rfqText
    : `RFQ ${rfqText}`.trim();
  const quotesText = String(quotesCount).trim();

  const rawTemplate = SMS_DLT_TEMPLATES.BUYER_BIDS_UNLOCKED.TEMPLATE;
  const message = rawTemplate.includes('{#alp#}')
    ? rawTemplate
        .replace('{#alp#}', rfqLabel)
        .replace('{#num#}', quotesText)
        .replace('{#urg#}', resolvedLink)
    : rawTemplate
        .replace('{#var#}', rfqLabel)
        .replace('{#var#}', quotesText)
        .replace('{#var#}', resolvedLink);

  const messageChars = message.length;
  const smsUnits = Math.ceil(messageChars / 160);

  logger.info(
    `[SMS_SERVICE] Buyer bids unlocked comparison SMS prepared: ${messageChars} chars (${smsUnits} unit${
      smsUnits > 1 ? 's' : ''
    })`,
    {
      rfqNumber,
      messageChars,
      smsUnits,
      quotesCount: quotesText,
      matrixUrl: resolvedLink,
    },
    'SMS_SERVICE'
  );

  const payload = {
    user: SMS_GATEWAY_CONFIG.RFQ_USER,
    pass: SMS_GATEWAY_CONFIG.RFQ_PASS,
    smstosend: [
      {
        to: `91${formattedNumber}`,
        from: SMS_GATEWAY_CONFIG.SENDER,
        smstext: message,
        smsgid: SMS_GATEWAY_CONFIG.BUYER_UNLOCKED_SMSGID,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(SMS_GATEWAY_CONFIG.URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await res.text();
      const rejected = _isGatewayRejection(res, responseText);

      if (rejected) {
        logger.warn(
          `SMS buyer bids unlocked gateway error for 91${formattedNumber} — HTTP ${res.status}: ${responseText}`,
          {
            status: res.status,
            response: responseText,
            rfqNumber,
            buyerName,
            smsgid: SMS_GATEWAY_CONFIG.BUYER_UNLOCKED_SMSGID,
            templateName: SMS_DLT_TEMPLATES.BUYER_BIDS_UNLOCKED.NAME,
          },
          'SMS_SERVICE'
        );
        return {
          success: false,
          status: SMS_SEND_STATUS.FAILED,
          error: _rejectionError(res),
          response: responseText,
        };
      }

      logger.info(
        `Buyer bids unlocked comparison SMS dispatched to 91${formattedNumber} for ${rfqNumber}`,
        {
          status: res.status,
          response: responseText,
          rfqNumber,
          buyerName,
          smsgid: SMS_GATEWAY_CONFIG.BUYER_UNLOCKED_SMSGID,
          templateName: SMS_DLT_TEMPLATES.BUYER_BIDS_UNLOCKED.NAME,
        },
        'SMS_SERVICE'
      );

      return {
        success: true,
        status: SMS_SEND_STATUS.SENT,
        messageId: _extractGatewayMessageId(responseText),
        response: responseText,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logger.error(
      `Failed to dispatch buyer comparison SMS to 91${formattedNumber} for ${rfqNumber}`,
      err,
      'SMS_SERVICE'
    );

    return {
      success: false,
      status: SMS_SEND_STATUS.FAILED,
      error: err.message,
    };
  }
}

/**
 * Dispatch an Action Center SMS notification using the DLT-compliant template.
 * @param {Object} params
 * @param {string} params.mobile - Recipient mobile number
 * @param {string} [params.recipientName] - Recipient name; "Not specified" when omitted
 * @param {string} params.message - Notification text (required)
 * @param {string} [params.linkUrl] - Link URL; the public frontend home when omitted
 * @param {string} [params.entityType] - Entity category (logging only)
 * @returns {Promise<{ success: boolean, status: string, messageId?: string, reason?: string, error?: string, throttled?: boolean, renderedMessage?: string, isTruncated?: boolean }>}
 */
async function sendActionCenterSms({
  mobile,
  recipientName,
  message: alertText,
  linkUrl = '',
  entityType,
}) {
  const formattedNumber = formatMobileNumber(mobile);

  if (!formattedNumber || formattedNumber.length !== 10) {
    logger.warn(
      'SMS dispatch skipped: Invalid mobile number format for Action Center SMS',
      { mobile, entityType },
      'SMS_SERVICE'
    );
    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      error: SMS_MESSAGES.INVALID_ACTION_CENTER_MOBILE,
    };
  }

  const rawMessage = String(alertText || '').replace(/[^a-zA-Z0-9\s.,-]/g, '').trim();
  if (!rawMessage) {
    logger.warn('SMS dispatch skipped: Action Center message missing', { entityType }, 'SMS_SERVICE');
    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      error: SMS_MESSAGES.MESSAGE_REQUIRED,
    };
  }

  const cleanMessage = rawMessage.length > 70 ? rawMessage.slice(0, 67) + '...' : rawMessage;

  if (process.env.NODE_ENV === 'test') {
    return {
      success: false,
      status: SMS_SEND_STATUS.SKIPPED,
      reason: SMS_SKIP_REASON.TEST_ENVIRONMENT,
      error: SMS_MESSAGES.TEST_ENVIRONMENT,
      renderedMessage: cleanMessage,
      isTruncated: rawMessage.length > 70,
    };
  }

  if (!SMS_GATEWAY_CONFIG.USER || !SMS_GATEWAY_CONFIG.PASS) {
    logger.error(SMS_MESSAGES.GATEWAY_NOT_CONFIGURED, { entityType }, 'SMS_SERVICE');
    return {
      success: false,
      status: SMS_SEND_STATUS.NOT_CONFIGURED,
      error: SMS_MESSAGES.GATEWAY_NOT_CONFIGURED,
    };
  }

  const now = Date.now();
  const lastSent = recentSmsDispatches.get(formattedNumber) || 0;

  if (now - lastSent < SMS_THROTTLE_WINDOW_MS) {
    return {
      success: false,
      status: SMS_SEND_STATUS.THROTTLED,
      throttled: true,
      error: SMS_MESSAGES.THROTTLED,
    };
  }

  recentSmsDispatches.set(formattedNumber, now);

  const defaultFrontend =
    process.env.PUBLIC_FRONTEND_URL ||
    'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';

  const resolvedLink = linkUrl || defaultFrontend;
  const cleanRecipient = String(recipientName || SMS_MESSAGES.NOT_SPECIFIED).replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 30);

  const rawTemplate = SMS_DLT_TEMPLATES.ACTION_CENTER_COMM.TEMPLATE;
  const values = [cleanRecipient, cleanMessage, resolvedLink];
  let valIdx = 0;
  const renderedMessage = rawTemplate.replace(/\{#[a-z0-9_]+#\}/gi, () => {
    if (valIdx < values.length) {
      return values[valIdx++];
    }
    return '';
  });

  const smsgid = SMS_GATEWAY_CONFIG.ACTION_CENTER_SMSGID;
  const payload = {
    user: SMS_GATEWAY_CONFIG.USER,
    pass: SMS_GATEWAY_CONFIG.PASS,
    smstosend: [
      {
        to: '91' + formattedNumber,
        from: SMS_GATEWAY_CONFIG.SENDER,
        smstext: renderedMessage,
        smsgid,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(SMS_GATEWAY_CONFIG.URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain, */*',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await res.text();
      const messageId = _extractGatewayMessageId(responseText);
      const rejected = _isGatewayRejection(res, responseText);

      if (rejected) {
        logger.warn(
          'Action Center SMS gateway error for 91' + formattedNumber + ' — HTTP ' + res.status + ': ' + responseText,
          { formattedNumber, entityType, smsgid },
          'SMS_SERVICE'
        );
        return {
          success: false,
          status: SMS_SEND_STATUS.FAILED,
          error: _rejectionError(res),
          renderedMessage,
          isTruncated: rawMessage.length > 70,
          response: responseText,
        };
      }

      logger.info(
        'Action Center SMS dispatched to 91' + formattedNumber,
        { messageId, response: responseText, entityType },
        'SMS_SERVICE'
      );

      return {
        success: true,
        status: SMS_SEND_STATUS.SENT,
        messageId,
        renderedMessage,
        isTruncated: rawMessage.length > 70,
        response: responseText,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logger.error(
      'Failed to dispatch Action Center SMS to 91' + formattedNumber,
      err,
      'SMS_SERVICE'
    );
    return {
      success: false,
      status: SMS_SEND_STATUS.FAILED,
      error: err.message,
    };
  }
}

module.exports = {
  SMS_GATEWAY_CONFIG,
  SMS_SEND_STATUS,
  formatMobileNumber,
  shortenUrl,
  clearShortUrlCache,
  sendOtpSms,
  sendRFQChaserSms,
  sendBuyerComparisonSms,
  sendActionCenterSms,
  clearSmsThrottleCache,
  clearSmsThrottleForPhone,
};

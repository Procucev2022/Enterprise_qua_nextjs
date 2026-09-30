const { logger } = require('./loggerService');

// SMS Gateway configuration loaded from environment with defaults
const SMS_GATEWAY_CONFIG = {
  URL: process.env.SMS_GATEWAY_URL || 'https://sms.sendmsg.in/datasend',
  USER: process.env.SMS_GATEWAY_USER || 'Procucev_OTP',
  PASS: process.env.SMS_GATEWAY_PASS || 'TzlzyMcFEZRF',
  SENDER: process.env.SMS_GATEWAY_SENDER || 'PROCUC',
  SMSGID: process.env.SMS_GATEWAY_SMSGID || 'TEST',
  RFQ_SMSGID: process.env.SMS_GATEWAY_RFQ_SMSGID || process.env.SMS_GATEWAY_SMSGID || 'TEST',
};

// In-memory cooldown throttle cache to prevent infinite / spam loop SMS dispatches to the same phone number
const recentSmsDispatches = new Map();
const SMS_THROTTLE_WINDOW_MS = 30000; // 30-second throttle cooldown per destination number

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
  if (formatted) recentSmsDispatches.delete(formatted);
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
 * Dispatches an OTP verification SMS via the SMS gateway
 * @param {string} mobile Destination mobile number
 * @param {string} code OTP verification code
 * @param {number} [expiresInSeconds=900] Code validity in seconds
 * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
 */
async function sendOtpSms(mobile, code, expiresInSeconds = 900) {
  const formattedNumber = formatMobileNumber(mobile);
  if (!formattedNumber || formattedNumber.length !== 10) {
    logger.warn('SMS dispatch skipped: Invalid mobile number format', { mobile }, 'SMS_SERVICE');
    return { success: false, error: 'Invalid mobile number format' };
  }

  const now = Date.now();
  const lastSent = recentSmsDispatches.get(formattedNumber) || 0;
  if (process.env.NODE_ENV !== 'test' && now - lastSent < SMS_THROTTLE_WINDOW_MS) {
    logger.warn(`SMS dispatch throttled: ${formattedNumber} requested within ${SMS_THROTTLE_WINDOW_MS / 1000}s cooldown`, {}, 'SMS_SERVICE');
    return {
      success: true,
      throttled: true,
      messageId: 'throttled-cooldown',
      response: 'OK (Throttled)',
    };
  }
  recentSmsDispatches.set(formattedNumber, now);

  // In test environment, skip live HTTP dispatch to avoid spamming recipient with test OTPs
  if (process.env.NODE_ENV === 'test') {
    logger.info(`[TEST MODE] Mock SMS OTP dispatched to 91${formattedNumber} (Code: ${code})`, {}, 'SMS_SERVICE');
    return {
      success: true,
      messageId: 'mock-test-sms-id',
      response: 'OK (Test Mode)',
    };
  }

  // DLT Approved Template: "OTP for registering your access to Get My quoTe (GMT): <OTP>. Valid for 5 mins. Do not share. - Team Procucev."
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
        'Accept': 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseText = await res.text();
    logger.info(`SMS OTP dispatched to 91${formattedNumber}`, { status: res.status, response: responseText }, 'SMS_SERVICE');

    return {
      success: res.ok,
      response: responseText,
    };
  } catch (err) {
    logger.error('Failed to dispatch SMS OTP via gateway', err, 'SMS_SERVICE');
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Dispatches an RFQ chaser SMS to a supplier
 * @param {Object} params
 * @param {string} params.mobile
 * @param {string} params.vendorName
 * @param {string} params.rfqNumber
 * @param {string} params.rfqTitle
 * @param {string} [params.bidLink]
 * @returns {Promise<{ success: boolean, messageId?: string, throttled?: boolean, error?: string }>}
 */
async function sendRFQChaserSms({ mobile, vendorName, rfqNumber, rfqTitle, bidLink }) {
  const formattedNumber = formatMobileNumber(mobile);
  if (!formattedNumber || formattedNumber.length !== 10) {
    logger.warn('SMS dispatch skipped: Invalid mobile number format', { mobile }, 'SMS_SERVICE');
    return { success: false, error: 'Invalid mobile number format' };
  }

  const now = Date.now();
  const lastSent = recentSmsDispatches.get(formattedNumber) || 0;
  if (process.env.NODE_ENV !== 'test' && now - lastSent < SMS_THROTTLE_WINDOW_MS) {
    return {
      success: true,
      throttled: true,
      messageId: 'sms-throttled',
    };
  }
  recentSmsDispatches.set(formattedNumber, now);

  if (process.env.NODE_ENV === 'test') {
    return {
      success: true,
      messageId: 'mock-test-sms-chaser',
    };
  }

  const defaultFrontend = process.env.PUBLIC_FRONTEND_URL || 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';
  const resolvedBidLink = bidLink || `${defaultFrontend}/vendor/quotation-form?rfq=${encodeURIComponent(rfqNumber)}`;
  const message = `[PRCU-RFQ] RFQ Alert ${rfqNumber}: You are invited to bid for ${rfqTitle || rfqNumber}. Submit quote: ${resolvedBidLink} - Team Procucev.`;

  const payload = {
    user: SMS_GATEWAY_CONFIG.USER,
    pass: SMS_GATEWAY_CONFIG.PASS,
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

    const res = await fetch(SMS_GATEWAY_CONFIG.URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseText = await res.text();
    const messageId = `sms-${Date.now()}`;

    if (res.ok) {
      logger.info(
        `SMS RFQ chaser dispatched to 91${formattedNumber} for ${rfqNumber}`,
        { status: res.status, response: responseText, rfqNumber, vendorName },
        'SMS_SERVICE'
      );
    } else {
      logger.warn(
        `SMS RFQ chaser gateway error for 91${formattedNumber} — HTTP ${res.status}`,
        { status: res.status, response: responseText, rfqNumber, vendorName },
        'SMS_SERVICE'
      );
    }

    return {
      success: res.ok,
      messageId,
      response: responseText,
    };
  } catch (err) {
    logger.error(
      `Failed to dispatch RFQ Chaser SMS to 91${formattedNumber} for ${rfqNumber}`,
      err,
      'SMS_SERVICE'
    );
    return { success: false, error: err.message };
  }
}

/**
 * Dispatches an SMS acknowledgment regarding quotation comparison to the buyer upon RFQ closure
 * @param {Object} params
 * @param {string} params.mobile
 * @param {string} params.buyerName
 * @param {string} params.rfqNumber
 * @param {number} [params.quotesCount=0]
 * @param {string} [params.matrixLink]
 * @returns {Promise<{ success: boolean, messageId?: string, throttled?: boolean, error?: string }>}
 */
async function sendBuyerComparisonSms({ mobile, buyerName, rfqNumber, quotesCount = 0, matrixLink }) {
  const formattedNumber = formatMobileNumber(mobile);
  if (!formattedNumber || formattedNumber.length !== 10) {
    logger.warn('SMS dispatch skipped: Invalid buyer mobile number format', { mobile }, 'SMS_SERVICE');
    return { success: false, error: 'Invalid mobile number format' };
  }

  const now = Date.now();
  const lastSent = recentSmsDispatches.get(formattedNumber) || 0;
  if (process.env.NODE_ENV !== 'test' && now - lastSent < SMS_THROTTLE_WINDOW_MS) {
    return {
      success: true,
      throttled: true,
      messageId: 'sms-throttled',
    };
  }
  recentSmsDispatches.set(formattedNumber, now);

  if (process.env.NODE_ENV === 'test') {
    return {
      success: true,
      messageId: 'mock-test-sms-buyer-comparison',
    };
  }

  const defaultFrontend = process.env.PUBLIC_FRONTEND_URL || 'https://procucev-enterprise-frontend.procucev-enterprise.workers.dev';
  const resolvedLink = matrixLink || `${defaultFrontend}/buyer/quote-matrix?rfq=${encodeURIComponent(rfqNumber)}`;
  const message = `[PRCU-RFQ] RFQ ${rfqNumber} closed. Quotation comparison matrix is ready (${quotesCount} quotes). Review: ${resolvedLink} - Team Procucev.`;

  const payload = {
    user: SMS_GATEWAY_CONFIG.USER,
    pass: SMS_GATEWAY_CONFIG.PASS,
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

    const res = await fetch(SMS_GATEWAY_CONFIG.URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseText = await res.text();
    const messageId = `sms-comp-${Date.now()}`;

    if (res.ok) {
      logger.info(
        `Buyer quotation comparison SMS dispatched to 91${formattedNumber} for ${rfqNumber}`,
        { status: res.status, response: responseText, rfqNumber },
        'SMS_SERVICE'
      );
    } else {
      logger.warn(
        `Buyer quotation comparison SMS gateway error for 91${formattedNumber} — HTTP ${res.status}`,
        { status: res.status, response: responseText, rfqNumber },
        'SMS_SERVICE'
      );
    }

    return {
      success: res.ok,
      messageId,
      response: responseText,
    };
  } catch (err) {
    logger.error(
      `Failed to dispatch buyer comparison SMS to 91${formattedNumber} for ${rfqNumber}`,
      err,
      'SMS_SERVICE'
    );
    return { success: false, error: err.message };
  }
}

module.exports = {
  SMS_GATEWAY_CONFIG,
  formatMobileNumber,
  sendOtpSms,
  sendRFQChaserSms,
  sendBuyerComparisonSms,
  clearSmsThrottleCache,
  clearSmsThrottleForPhone,
};

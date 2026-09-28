const { logger } = require('./loggerService');

// SMS Gateway configuration loaded from environment with defaults
const SMS_GATEWAY_CONFIG = {
  URL: process.env.SMS_GATEWAY_URL || 'https://sms.sendmsg.in/datasend',
  USER: process.env.SMS_GATEWAY_USER || 'Procucev_OTP',
  PASS: process.env.SMS_GATEWAY_PASS || 'TzlzyMcFEZRF',
  SENDER: process.env.SMS_GATEWAY_SENDER || 'PROCUC',
  SMSGID: process.env.SMS_GATEWAY_SMSGID || 'TEST',
};

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

  const minutes = Math.round(expiresInSeconds / 60) || 15;
  const message = `Your Procucev verification code is ${code}. Valid for ${minutes} minutes. Do not share this OTP.`;

  const payload = {
    user: SMS_GATEWAY_CONFIG.USER,
    pass: SMS_GATEWAY_CONFIG.PASS,
    sms: [
      {
        to: formattedNumber,
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
    logger.info(`SMS OTP dispatched to ${formattedNumber}`, { status: res.status, response: responseText }, 'SMS_SERVICE');

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

module.exports = {
  SMS_GATEWAY_CONFIG,
  formatMobileNumber,
  sendOtpSms,
};

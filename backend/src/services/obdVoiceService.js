const { logger } = require('./loggerService');

// ─────────────────────────────────────────────────────────────────────────────
// OBD (Outbound Dialer) Voice Calling Service
// Provider: ivrsms.com / cloudobd.in (telecom voice gateway)
// Base URL: https://obdapi2.ivrsms.com
// ─────────────────────────────────────────────────────────────────────────────

function getEnv(key, fallback = '') {
  const val = process.env[key];
  if (val) return val;
  if (typeof globalThis !== 'undefined' && globalThis.__CF_ENV__ && globalThis.__CF_ENV__[key]) {
    return globalThis.__CF_ENV__[key];
  }
  return fallback;
}

const OBD_CONFIG = {
  get BASE_URL() { return getEnv('OBD_API_BASE_URL', 'https://obdapi2.ivrsms.com'); },
  get USERNAME() { return getEnv('OBD_USERNAME', ''); },
  get PASSWORD() { return getEnv('OBD_PASSWORD', ''); },
  get USER_ID() { return getEnv('OBD_USER_ID', ''); },
  get WEBHOOK_ID() { return getEnv('OBD_WEBHOOK_ID', ''); },
  get DEFAULT_PROMPT_ID() { return getEnv('OBD_DEFAULT_PROMPT_ID', '1667'); },
  get DEFAULT_LANGUAGE() { return getEnv('OBD_DEFAULT_LANGUAGE', 'en-IN'); },
  get DEFAULT_GENDER() { return getEnv('OBD_DEFAULT_GENDER', 'FEMALE'); },
};

// In-memory token cache
let _cachedToken = null;
let _tokenExpiresAt = 0;

// Throttle cache: phone number -> last dispatch timestamp (30-second cooldown)
const _recentDispatches = new Map();
const THROTTLE_WINDOW_MS = 30000;

function isConfigured() {
  return Boolean(OBD_CONFIG.USERNAME && OBD_CONFIG.PASSWORD && OBD_CONFIG.USER_ID);
}

function clearTokenCache() {
  _cachedToken = null;
  _tokenExpiresAt = 0;
  _recentDispatches.clear();
}

/**
 * Format date to 'YYYY-MM-DD HH:MM:SS' required by OBD API.
 * @param {Date} [date]
 * @returns {string}
 */
function formatScheduleTime(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Log in to OBD API to obtain a JWT Bearer Token.
 * @returns {Promise<string>}
 */
async function getAuthToken() {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt) {
    return _cachedToken;
  }

  if (!OBD_CONFIG.USERNAME || !OBD_CONFIG.PASSWORD) {
    throw new Error('OBD credentials not configured (OBD_USERNAME, OBD_PASSWORD)');
  }

  const res = await fetch(`${OBD_CONFIG.BASE_URL}/api/obd/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: OBD_CONFIG.USERNAME,
      password: OBD_CONFIG.PASSWORD,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`OBD login failed with HTTP ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  if (!data || !data.token) {
    throw new Error('OBD login response missing auth token');
  }

  _cachedToken = data.token;
  _tokenExpiresAt = now + 12 * 60 * 60 * 1000;
  return _cachedToken;
}

/**
 * Dispatch an automated voice call to a vendor for an RFQ reminder.
 * Uses Action 2 (Inline contact list) and Template 7 (TTS Simple) or 8 (TTS DTMF).
 *
 * @param {object} params
 * @param {string} params.phone - Vendor mobile number (10 digits)
 * @param {string} [params.vendorName] - Vendor name
 * @param {string} [params.rfqNumber] - RFQ Number
 * @param {string} [params.promptId] - Pre-approved voice prompt ID
 * @param {string} [params.dtmf] - DTMF expected input (e.g., '1' for Template 8)
 * @param {string} [params.language] - Language ('en-IN' or 'hi-IN')
 * @param {string} [params.gender] - Voice gender ('FEMALE' or 'MALE')
 * @returns {Promise<{ success: boolean, status: string, campaignId?: string, error?: string, message?: string }>}
 */
async function sendRfqVoiceReminder(params = {}) {
  if (process.env.NODE_ENV === 'test' && !process.env.OBD_TEST_LIVE) {
    return { success: true, status: 'sent', campaignId: 'obd-test-camp-id' };
  }

  if (!isConfigured()) {
    return {
      success: false,
      status: 'not_configured',
      error: 'OBD gateway credentials not configured (set OBD_USERNAME, OBD_PASSWORD, OBD_USER_ID)',
    };
  }

  const cleanPhone = String(params.phone || '').replace(/\D/g, '').slice(-10);
  if (cleanPhone.length !== 10) {
    return {
      success: false,
      status: 'skipped',
      error: 'Invalid 10-digit Indian phone number',
    };
  }

  const lastSent = _recentDispatches.get(cleanPhone) || 0;
  if (Date.now() - lastSent < THROTTLE_WINDOW_MS) {
    return {
      success: false,
      status: 'throttled',
      error: 'Voice call to this number was initiated within the last 30 seconds',
    };
  }

  try {
    const token = await getAuthToken();

    const safeVendor = String(params.vendorName || 'Partner').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30);
    const safeRfq = String(params.rfqNumber || 'RFQ').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 30);
    const promptId = String(params.promptId || OBD_CONFIG.DEFAULT_PROMPT_ID);
    const isDtmf = Boolean(params.dtmf);
    const templateId = isDtmf ? '8' : '7';
    const language = params.language || OBD_CONFIG.DEFAULT_LANGUAGE;
    const gender = String(params.gender || OBD_CONFIG.DEFAULT_GENDER).toUpperCase();

    const contactList = `mobile_number,tts_1,tts_2\n${cleanPhone},${safeVendor},${safeRfq}`;

    const ttsRows = JSON.stringify({
      ttsList: [
        { ttsType: 'prompt', value: promptId, variableType: '' },
        { ttsType: 'variable', value: '1', variableType: 'text' },
        { ttsType: 'variable', value: '2', variableType: 'text' },
      ],
    });

    const campaignPayload = {
      action: 2,
      userId: String(OBD_CONFIG.USER_ID),
      campaignName: `RFQ_${safeRfq}_${Date.now()}`.slice(0, 40),
      templateId,
      contactList,
      baseName: `Base_${safeRfq}`.slice(0, 30),
      dtmf: isDtmf ? String(params.dtmf) : '',
      baseId: '',
      welcomePId: '',
      menuPId: isDtmf ? promptId : '',
      noInputPId: '',
      wrongInputPId: '',
      thanksPId: '',
      scheduleTime: formatScheduleTime(),
      smsSuccessApi: '',
      smsFailApi: '',
      smsDtmfApi: '',
      callDurationSMS: 0,
      retries: '0',
      retryInterval: 0,
      agentRows: '',
      menuWaitTime: isDtmf ? '5' : '',
      rePrompt: isDtmf ? '1' : '',
      location: '',
      clis: '',
      webhook: Boolean(OBD_CONFIG.WEBHOOK_ID),
      webhookId: OBD_CONFIG.WEBHOOK_ID ? String(OBD_CONFIG.WEBHOOK_ID) : '',
      ttsRows,
      gender,
      language,
      noAgentId: '',
      callPatchSuccessMessage: '',
      callPatchFailMessage: '',
      repeatMenu: '',
    };

    const formData = new FormData();
    formData.append('campaign', JSON.stringify(campaignPayload));

    const res = await fetch(`${OBD_CONFIG.BASE_URL}/api/obd/campaign/compose/outdial`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data && data.campaignId) {
      _recentDispatches.set(cleanPhone, Date.now());
      logger.info(
        `[OBD_SERVICE] Voice call queued for ${cleanPhone} (RFQ: ${safeRfq}, Campaign: ${data.campaignId})`,
        { rfqNumber: safeRfq, campaignId: data.campaignId, phone: cleanPhone },
        'OBD_SERVICE'
      );
      return {
        success: true,
        status: 'sent',
        campaignId: String(data.campaignId),
        message: data.message || 'Campaign Created Successfully',
      };
    }

    const errorMsg = (data && data.message) || `HTTP ${res.status}`;
    logger.warn(`[OBD_SERVICE] Outdial rejected: ${errorMsg}`, { rfqNumber: safeRfq, phone: cleanPhone }, 'OBD_SERVICE');
    return {
      success: false,
      status: 'failed',
      error: errorMsg,
    };
  } catch (error) {
    logger.error(`[OBD_SERVICE] Outdial failed for ${cleanPhone}: ${error.message}`, error, 'OBD_SERVICE');
    return {
      success: false,
      status: 'failed',
      error: error.message,
    };
  }
}

/**
 * Update RFQ follow-up telemetry with call outcome.
 * @param {object} rfq - The RFQ object (from storeService or database)
 * @param {object} outcome - Webhook payload { campaignId, phone, status, duration, dtmf }
 * @returns {object|null}
 */
function recordCallOutcome(rfq, outcome = {}) {
  if (!rfq) return null;
  const cleanPhone = outcome.phone ? String(outcome.phone).replace(/\D/g, '').slice(-10) : '';
  const now = new Date().toISOString();

  if (!rfq.followUpData) {
    rfq.followUpData = {
      vendors: [],
      callStats: { total: 0, connected: 0, avgDuration: null },
    };
  }
  if (!Array.isArray(rfq.followUpData.vendors)) {
    rfq.followUpData.vendors = [];
  }
  if (!rfq.followUpData.callStats) {
    rfq.followUpData.callStats = { total: 0, connected: 0, avgDuration: null };
  }

  const vendorRecord = rfq.followUpData.vendors.find((v) => {
    const vPhone = v.phone || v.mobile || v.mobileNumber;
    const cleanVPhone = vPhone ? String(vPhone).replace(/\D/g, '').slice(-10) : '';
    return (cleanPhone && cleanVPhone === cleanPhone) || (v.call && v.call.messageId === String(outcome.campaignId));
  });

  if (vendorRecord) {
    const isConnected = outcome.status === 'ANSWERED' || outcome.status === 'connected' || outcome.status === 'answered';
    if (isConnected) {
      rfq.followUpData.callStats.connected = (rfq.followUpData.callStats.connected || 0) + 1;
      if (outcome.duration) {
        const prevAvg = rfq.followUpData.callStats.avgDuration || 0;
        const count = rfq.followUpData.callStats.connected;
        rfq.followUpData.callStats.avgDuration = Math.round(((prevAvg * (count - 1)) + Number(outcome.duration)) / count);
      }
    }
    vendorRecord.call = {
      ...(vendorRecord.call || {}),
      status: outcome.status ? String(outcome.status).toLowerCase() : 'completed',
      duration: outcome.duration ? Number(outcome.duration) : undefined,
      dtmf: outcome.dtmf || undefined,
      lastAttempt: now,
      answeredAt: isConnected ? now : undefined,
    };
    vendorRecord.lastInteraction = now;
    return vendorRecord;
  }
  return null;
}

module.exports = {
  getEnv,
  isConfigured,
  getAuthToken,
  formatScheduleTime,
  sendRfqVoiceReminder,
  recordCallOutcome,
  clearTokenCache,
  OBD_CONFIG,
};

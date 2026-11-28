const userPreferencesQueries = require('../db/userPreferencesQueries');
const pool = require('../db/pool');
const { logger } = require('../services/loggerService');
const { USER_PREFERENCE_CONFIG } = require('../config/constants');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/validationSchemas');

function resolveUserKey(user) {
  if (!user || typeof user !== 'object') return '';
  return String(user.email || user.sub || '').trim().toLowerCase();
}

async function getPreferences(req, res, next) {
  try {
    const userKey = resolveUserKey(req.user);
    if (!userKey) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!pool.hasStorage()) {
      return res.json({ success: true, data: {} });
    }
    const data = await userPreferencesQueries.getPreferencesForUser(userKey);
    return res.json({ success: true, data });
  } catch (err) {
    logger.error('Failed to fetch user preferences', err, 'USER_PREFERENCES_CONTROLLER');
    return next(err);
  }
}

async function setPreference(req, res, next) {
  try {
    const userKey = resolveUserKey(req.user);
    if (!userKey) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    const keyValidation = validatePayload(VALIDATION_SCHEMAS.userPreferenceParams, { key: req.params?.key });
    if (!keyValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: Object.values(keyValidation.errors)[0],
      });
    }
    const prefKey = String(req.params.key).trim();
    const value = req.body && Object.prototype.hasOwnProperty.call(req.body, 'value') ? req.body.value : undefined;
    if (value === undefined) {
      return res.status(400).json({ success: false, error: USER_PREFERENCE_CONFIG.MESSAGES.VALUE_REQUIRED });
    }
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > USER_PREFERENCE_CONFIG.MAX_VALUE_BYTES) {
      return res.status(400).json({ success: false, error: USER_PREFERENCE_CONFIG.MESSAGES.VALUE_TOO_LARGE });
    }
    if (!pool.hasStorage()) {
      return res.json({ success: true, data: { key: prefKey, value } });
    }
    const saved = await userPreferencesQueries.upsertPreferenceForUser(userKey, prefKey, value);
    return res.json({ success: true, data: saved });
  } catch (err) {
    logger.error('Failed to save user preference', err, 'USER_PREFERENCES_CONTROLLER');
    return next(err);
  }
}

async function deletePreference(req, res, next) {
  try {
    const userKey = resolveUserKey(req.user);
    if (!userKey) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    const keyValidation = validatePayload(VALIDATION_SCHEMAS.userPreferenceParams, { key: req.params?.key });
    if (!keyValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: Object.values(keyValidation.errors)[0],
      });
    }
    const prefKey = String(req.params.key).trim();
    if (pool.hasStorage()) {
      await userPreferencesQueries.deletePreferenceForUser(userKey, prefKey);
    }
    return res.json({ success: true, data: { key: prefKey } });
  } catch (err) {
    logger.error('Failed to delete user preference', err, 'USER_PREFERENCES_CONTROLLER');
    return next(err);
  }
}

module.exports = {
  getPreferences,
  setPreference,
  deletePreference,
};

'use strict';

const mailerService = require('./mailerService');
const { EMAIL_REGEX } = require('../config/constants');

const REQUIRED_TEXT_FIELDS = Object.freeze([
  'rfqNumber',
  'rfqTitle',
  'rfqCategory',
  'vendorName',
  'vendorCurrentCategory',
  'buyerAccountName',
]);

function invalidPersistedPayload(message) {
  const error = new Error(message);
  error.code = 'INVALID_PERSISTED_RECORD';
  return error;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidPersistedPayload('Vendor category update email payload must be an object.');
  }
  const recipientEmail = typeof payload.recipientEmail === 'string' ? payload.recipientEmail.trim() : '';
  if (!EMAIL_REGEX.test(recipientEmail)) {
    throw invalidPersistedPayload('Vendor category update email payload has an invalid recipient.');
  }
  for (const field of REQUIRED_TEXT_FIELDS) {
    if (typeof payload[field] !== 'string' || payload[field].trim().length === 0 || payload[field].length > 1000) {
      throw invalidPersistedPayload(`Vendor category update email payload has an invalid ${field}.`);
    }
  }
  if (payload.buyerEmail !== null && payload.buyerEmail !== undefined) {
    if (typeof payload.buyerEmail !== 'string' || !EMAIL_REGEX.test(payload.buyerEmail.trim())) {
      throw invalidPersistedPayload('Vendor category update email payload has an invalid buyer email.');
    }
  }
  return {
    recipientEmail,
    emailContext: Object.fromEntries(REQUIRED_TEXT_FIELDS.map((field) => [field, payload[field].trim()])),
    buyerEmail: typeof payload.buyerEmail === 'string' ? payload.buyerEmail.trim() : null,
  };
}

async function sendVendorCategoryUpdateNotification(payload) {
  const validated = validatePayload(payload);
  return mailerService.sendVendorCategoryMismatchEmail(validated.recipientEmail, {
    ...validated.emailContext,
    buyerEmail: validated.buyerEmail,
  });
}

module.exports = {
  validatePayload,
  sendVendorCategoryUpdateNotification,
};

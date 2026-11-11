'use strict';

const mailerService = require('./mailerService');
const {
  EMAIL_REGEX,
  QUA_AI_EMAIL_SUPPORT,
  REGISTRATION_DECISION_EMAIL_COPY,
} = require('../config/constants');

function invalidRecord() {
  const error = new Error('Registration decision notification payload is invalid.');
  error.code = 'INVALID_PERSISTED_RECORD';
  return error;
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalidRecord();

  const registrationId = typeof payload.registrationId === 'string' ? payload.registrationId.trim() : '';
  const recipientEmail = typeof payload.recipientEmail === 'string' ? payload.recipientEmail.trim() : '';
  const recipientName = typeof payload.recipientName === 'string' && payload.recipientName.trim()
    ? payload.recipientName.trim()
    : 'there';
  const role = typeof payload.accountType === 'string' ? payload.accountType.trim().toLowerCase() : '';
  const decision = typeof payload.decision === 'string' ? payload.decision.trim().toLowerCase() : '';

  if (
    !registrationId
    || registrationId.length > 128
    || !EMAIL_REGEX.test(recipientEmail)
    || !['buyer', 'vendor', 'seller'].includes(role)
    || !['accepted', 'rejected'].includes(decision)
  ) {
    throw invalidRecord();
  }

  return {
    registrationId,
    recipientEmail,
    recipientName,
    accountType: role === 'buyer' ? 'Buyer' : 'Vendor',
    decision,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function interpolate(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, key) => String(values[key]));
}

function buildRegistrationDecisionEmail(payload) {
  const normalized = normalizePayload(payload);
  const accepted = normalized.decision === 'accepted';
  const signInUrl = normalized.accountType === 'Vendor'
    ? mailerService.vendorSignInUrl()
    : mailerService.buyerPortalUrl();
  const values = {
    accountType: normalized.accountType,
    decisionStatus: accepted ? 'approved' : 'not approved',
    recipientName: normalized.recipientName,
    signInUrl,
    supportEmail: QUA_AI_EMAIL_SUPPORT.EMAIL,
  };
  const greeting = interpolate(REGISTRATION_DECISION_EMAIL_COPY.GREETING, values);
  const decisionMessage = interpolate(
    accepted ? REGISTRATION_DECISION_EMAIL_COPY.APPROVED : REGISTRATION_DECISION_EMAIL_COPY.REJECTED,
    values
  );
  const signIn = interpolate(REGISTRATION_DECISION_EMAIL_COPY.SIGN_IN, values);
  const recovery = REGISTRATION_DECISION_EMAIL_COPY.RECOVERY;
  const support = interpolate(REGISTRATION_DECISION_EMAIL_COPY.SUPPORT, values);
  const subject = interpolate(REGISTRATION_DECISION_EMAIL_COPY.SUBJECT, values);
  const html = [greeting, decisionMessage, signIn, recovery, support]
    .map((line, index) => {
      const content = escapeHtml(line);
      if (index === 2) {
        return `<p><a href="${escapeHtml(signInUrl)}">${escapeHtml(REGISTRATION_DECISION_EMAIL_COPY.SIGN_IN_LINK_LABEL)}</a></p>`;
      }
      return `<p>${content}</p>`;
    })
    .join('');

  return {
    to: normalized.recipientEmail,
    subject,
    text: [greeting, decisionMessage, signIn, recovery, support].join('\n\n'),
    html,
  };
}

async function sendRegistrationDecisionNotification(payload) {
  const normalized = normalizePayload(payload);
  const message = buildRegistrationDecisionEmail(normalized);
  const send = normalized.accountType === 'Vendor'
    ? mailerService.deliverVendor
    : mailerService.deliver;
  return send.call(mailerService, message, `${normalized.accountType} registration decision email`);
}

module.exports = {
  buildRegistrationDecisionEmail,
  sendRegistrationDecisionNotification,
};

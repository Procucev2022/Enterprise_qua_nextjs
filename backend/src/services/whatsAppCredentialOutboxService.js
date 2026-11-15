'use strict';

const botBridgeQueries = require('../db/botBridgeQueries');
const domainQueries = require('../db/domainQueries');
const mailerService = require('./mailerService');
const cryptoService = require('./cryptoService');
const { logger } = require('./loggerService');
const { EMAIL_REGEX } = require('../config/constants');

const LOG_CONTEXT = 'WHATSAPP_CREDENTIAL_OUTBOX';
const VERIFIED_STATUS = 'EMAIL_VERIFIED';

function invalidRecord(message) {
  const error = new Error(message);
  error.code = 'INVALID_PERSISTED_RECORD';
  return error;
}

async function dispatchWhatsAppCredentialEmail(job) {
  const raw = job?.raw || {};
  const { accountId, role, encryptedTempPassword, vendorId } = raw;
  if (
    typeof accountId !== 'string' || !accountId
    || !['buyer', 'vendor'].includes(role)
    || typeof encryptedTempPassword !== 'string' || !encryptedTempPassword
    || (vendorId !== undefined && (typeof vendorId !== 'string' || !vendorId))
  ) {
    throw invalidRecord('WhatsApp credential email retry payload is invalid.');
  }

  const user = await botBridgeQueries.findUserByUuid(accountId, { fresh: true });
  if (
    !user
    || user.role !== role
    || user.isActive !== true
    || user.verificationStatus !== VERIFIED_STATUS
    || user.resetPasswordRequired !== true
    || typeof user.email !== 'string'
    || !EMAIL_REGEX.test(user.email.trim())
  ) {
    throw invalidRecord('WhatsApp credential email no longer matches a verified active account.');
  }

  let tempPassword;
  try {
    tempPassword = cryptoService.decrypt(encryptedTempPassword, {
      additionalData: `whatsapp-registration-credentials:${accountId}`,
    });
  } catch {
    throw invalidRecord('WhatsApp credential email payload could not be decrypted.');
  }
  if (!tempPassword) throw invalidRecord('WhatsApp credential email payload is empty.');

  let delivery;
  let vendor = null;
  if (role === 'vendor') {
    if (vendorId) {
      try {
        vendor = await domainQueries.getVendorByIdFromDB(vendorId, { fresh: true });
      } catch (error) {
        logger.error('Could not load vendor details for WhatsApp credential email', {
          error,
          accountId,
          vendorId,
          outboxId: job.id,
        }, LOG_CONTEXT);
      }
    }
    const emailPayload = mailerService.buildVendorOnboardingEmail({
      to: user.email,
      recipientName: user.name,
      buyerOrganizationName: 'Procucev Enterprise',
      vendorCode: vendor?.id || vendorId || accountId,
      tempPassword,
      contactPhone: user.mobile,
    });
    try {
      delivery = await mailerService.sendVendorIngestionEmail(emailPayload, 'onboarding');
    } catch {
      const error = new Error('WhatsApp vendor credential email provider request failed.');
      error.code = 'WHATSAPP_CREDENTIAL_EMAIL_FAILED';
      throw error;
    }
  } else {
    try {
      delivery = await mailerService.sendBuyerCredentialsEmail({
        to: user.email,
        recipientName: user.name,
        tempPassword,
        contactPhone: user.mobile,
      });
    } catch {
      const error = new Error('WhatsApp buyer credential email provider request failed.');
      error.code = 'WHATSAPP_CREDENTIAL_EMAIL_FAILED';
      throw error;
    }
  }

  if (!delivery?.sent) {
    const error = new Error('WhatsApp credential email provider did not accept the message.');
    error.code = 'WHATSAPP_CREDENTIAL_EMAIL_FAILED';
    throw error;
  }

  if (role === 'vendor' && (vendor?.id || vendorId)) {
    try {
      const saved = await require('./storeService').updateVendorDurably(vendor?.id || vendorId, {
        onboardingEmailStatus: 'sent',
      });
      if (!saved) {
        logger.warn('WhatsApp credential email was accepted but vendor delivery status was not updated', {
          accountId,
          vendorId: vendor?.id || vendorId,
          outboxId: job.id,
        }, LOG_CONTEXT);
      }
    } catch (error) {
      // Provider acceptance is authoritative; retrying would resend the same
      // credentials solely because a display-status mirror could not be saved.
      logger.error('WhatsApp credential email was accepted but vendor delivery status persistence failed', {
        error,
        accountId,
        vendorId: vendor?.id || vendorId,
        outboxId: job.id,
      }, LOG_CONTEXT);
    }
  }

  logger.info('WhatsApp credential email was accepted by a provider', {
    accountId,
    role,
    vendorId: vendor?.id || vendorId || null,
    outboxId: job.id,
  }, LOG_CONTEXT);
}

module.exports = { dispatchWhatsAppCredentialEmail };

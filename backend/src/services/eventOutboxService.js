'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');
const domainQueries = require('../db/domainQueries');
const enterpriseInquiryQueries = require('../db/enterpriseInquiryQueries');
const eventOutboxQueries = require('../db/eventOutboxQueries');
const { dispatchWhatsAppCredentialEmail } = require('./whatsAppCredentialOutboxService');
const registrationDecisionNotificationService = require('./registrationDecisionNotificationService');
const mailerService = require('./mailerService');
const cryptoService = require('./cryptoService');
const {
  EVENT_OUTBOX_TYPES,
  EVENT_OUTBOX_MAX_ATTEMPTS,
  EVENT_OUTBOX_MAX_BATCH_SIZE,
  EVENT_OUTBOX_LEASE_MS,
  EVENT_OUTBOX_RETRY_BASE_MS,
  EVENT_OUTBOX_RETRY_MAX_MS,
  EVENT_OUTBOX_ENQUEUE_ATTEMPTS,
  EVENT_OUTBOX_ENQUEUE_RETRY_MS,
  EVENT_OUTBOX_RETENTION_DAYS,
  EVENT_OUTBOX_NOTIFICATION_BATCH_SIZE,
  EMAIL_REGEX,
  DAILY_RFQ_REPORT_CONFIG,
} = require('../config/constants');
const { logger } = require('./loggerService');

const VALID_EVENT_TYPES = new Set(Object.values(EVENT_OUTBOX_TYPES));

function buildEventOutboxId(eventType, idempotencyKey) {
  if (!VALID_EVENT_TYPES.has(eventType)) {
    const error = new Error(`Unsupported event-outbox type: ${eventType}`);
    error.code = 'INVALID_EVENT_OUTBOX_TYPE';
    throw error;
  }
  const digest = crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex');
  return `retry:${eventType}:${digest}`;
}

function getSafeErrorLabel(error) {
  const code = typeof error?.code === 'string' ? error.code : 'UNCLASSIFIED';
  const name = typeof error?.name === 'string' ? error.name : 'Error';
  return `${code}:${name}`.slice(0, 128);
}

function getRetryDelayMs(attempts) {
  return Math.min(EVENT_OUTBOX_RETRY_BASE_MS * (2 ** Math.max(attempts - 1, 0)), EVENT_OUTBOX_RETRY_MAX_MS);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function enqueueWithRetry(event, operation) {
  let lastError;
  for (let attempt = 1; attempt <= EVENT_OUTBOX_ENQUEUE_ATTEMPTS; attempt += 1) {
    try {
      const saved = await eventOutboxQueries.enqueueEventOutboxInDB(event);
      if (saved) return saved;
      throw new Error('Event-outbox enqueue returned no persisted state.');
    } catch (error) {
      lastError = error;
      logger.error('Failed to record a background event for retry', {
        error,
        eventType: event.eventType,
        outboxId: event.id,
        operation,
        enqueueAttempt: attempt,
        enqueueAttempts: EVENT_OUTBOX_ENQUEUE_ATTEMPTS,
      }, 'EVENT_OUTBOX');
      if (attempt < EVENT_OUTBOX_ENQUEUE_ATTEMPTS) {
        await delay(EVENT_OUTBOX_ENQUEUE_RETRY_MS * attempt);
      }
    }
  }
  throw lastError;
}

async function enqueueEventOutbox(eventType, idempotencyKey, payload) {
  if (!pool.hasStorage()) {
    const error = new Error('A durable event outbox requires configured database storage.');
    error.code = 'PERSISTENCE_UNAVAILABLE';
    throw error;
  }
  const id = buildEventOutboxId(eventType, idempotencyKey);
  return enqueueWithRetry({ id, eventType, payload }, `enqueue-${eventType}`);
}

async function persistWithOutboxFallback({ eventType, idempotencyKey, payload, write, operation }) {
  const storageConfigured = pool.hasStorage();
  const id = buildEventOutboxId(eventType, idempotencyKey);
  try {
    const persisted = await write();
    if (storageConfigured && (persisted === null || persisted === undefined)) {
      throw new Error(`${operation} completed without a persisted row.`);
    }
    return { persisted: storageConfigured ? true : null };
  } catch (error) {
    if (!storageConfigured) {
      logger.error('Background event persistence failed; durable retry is unavailable', {
        error,
        eventType,
        outboxId: id,
        operation,
      }, 'EVENT_OUTBOX');
      return { persisted: null };
    }
    logger.error('Background event persistence failed; queuing a retry', {
      error,
      eventType,
      outboxId: id,
      operation,
    }, 'EVENT_OUTBOX');
    await enqueueWithRetry({ id, eventType, payload }, operation);

    try {
      await dispatchDueEventOutboxJobs(1);
    } catch (dispatchError) {
      logger.error('Immediate event-outbox retry failed; scheduled recovery will retry it', {
        error: dispatchError,
        eventType,
        outboxId: id,
        operation,
      }, 'EVENT_OUTBOX');
    }
    return { queued: true, id };
  }
}

async function dispatchEvent(job) {
  switch (job.event_type) {
    case EVENT_OUTBOX_TYPES.AI_FEED: {
      const saved = await domainQueries.upsertAIFeedItemInDB(job.raw);
      if (!saved) throw new Error('AI feed retry completed without a persisted row.');
      return;
    }
    case EVENT_OUTBOX_TYPES.NOTIFICATION: {
      const saved = await domainQueries.insertNotificationInDB(job.raw);
      if (!saved) throw new Error('Notification retry completed without a persisted row.');
      return;
    }
    case EVENT_OUTBOX_TYPES.NOTIFICATION_BATCH: {
      const notifications = Array.isArray(job.raw) ? job.raw : [];
      if (notifications.length === 0) return;
      for (let index = 0; index < notifications.length; index += EVENT_OUTBOX_NOTIFICATION_BATCH_SIZE) {
        await domainQueries.bulkInsertNotificationsInDB(
          notifications.slice(index, index + EVENT_OUTBOX_NOTIFICATION_BATCH_SIZE)
        );
      }
      return;
    }
    case EVENT_OUTBOX_TYPES.ENTERPRISE_INQUIRY_EMAIL: {
      const inquiryId = job.raw?.inquiryId;
      const notificationType = job.raw?.notificationType;
      if (typeof inquiryId !== 'string' || !inquiryId || !['team', 'buyer_confirmation'].includes(notificationType)) {
        const error = new Error('Enterprise inquiry email retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      const inquiry = await enterpriseInquiryQueries.getEnterpriseInquiryById(inquiryId);
      if (!inquiry) {
        const error = new Error('Enterprise inquiry email retry references a missing inquiry.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      const send = notificationType === 'team'
        ? mailerService.sendEnterpriseInquiryNotificationEmail
        : mailerService.sendEnterpriseInquiryBuyerConfirmationEmail;
      const result = await send(inquiry);
      if (!result?.sent) {
        const error = new Error('Enterprise inquiry email provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }
      return;
    }
    case EVENT_OUTBOX_TYPES.VENDOR_RATING_REVISION_EMAIL: {
      const { vendorId, revisionId, recipientEmail } = job.raw || {};
      if (
        typeof vendorId !== 'string' || !vendorId
        || typeof revisionId !== 'string' || !revisionId
        || typeof recipientEmail !== 'string' || !recipientEmail.trim()
      ) {
        const error = new Error('Vendor rating revision email retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      const vendor = await domainQueries.getVendorByIdFromDB(vendorId, { fresh: true });
      const revision = vendor?.ratingRevisionHistory?.find((entry) => entry.id === revisionId);
      if (!vendor || !revision) {
        const error = new Error('Vendor rating revision email retry references a missing revision.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      const numericFields = [
        'previousRating',
        'newRating',
        'previousScore',
        'newCompositeScore',
        'qualityScore',
        'costScore',
        'deliveryScore',
      ];
      if (numericFields.some((field) => typeof revision[field] !== 'number' || !Number.isFinite(revision[field]))) {
        const error = new Error('Vendor rating revision email references an invalid persisted rating.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      const emailPayload = mailerService.buildRatingRevisionEmail({
        to: recipientEmail,
        recipientName: vendor.contactPerson || vendor.name,
        vendorName: revision.vendorName || vendor.name,
        buyerCompany: revision.buyerCompany || 'A buyer on Procucev',
        buyerName: revision.buyerName || '',
        previousRating: revision.previousRating,
        newRating: revision.newRating,
        previousScore: revision.previousScore,
        newScore: revision.newCompositeScore,
        remarks: revision.remarks,
        qualityScore: revision.qualityScore,
        costScore: revision.costScore,
        deliveryScore: revision.deliveryScore,
      });
      const delivery = await mailerService.sendVendorIngestionEmail(emailPayload, 'rating-revision');
      if (!delivery?.sent) {
        const error = new Error('Vendor rating revision email provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }
      logger.info('Vendor rating revision email accepted by a provider', {
        vendorId,
        revisionId,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL: {
      const { vendorId, encryptedTempPassword } = job.raw || {};
      if (
        typeof vendorId !== 'string' || !vendorId
        || typeof encryptedTempPassword !== 'string' || !encryptedTempPassword
      ) {
        const error = new Error('Vendor onboarding email retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const vendor = await domainQueries.getVendorByIdFromDB(vendorId, { fresh: true });
      if (!vendor) {
        const error = new Error('Vendor onboarding email retry references a missing vendor.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      if (vendor.onboardingEmailStatus === 'sent') return;
      if (vendor.onboardingEmailStatus !== 'pending') {
        const error = new Error('Vendor onboarding email retry references a vendor that is no longer pending.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const recipient = String(vendor.email || '').trim();
      if (!EMAIL_REGEX.test(recipient)) {
        const error = new Error('Vendor onboarding email has no valid persisted recipient.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      let tempPassword;
      try {
        tempPassword = cryptoService.decrypt(encryptedTempPassword, {
          additionalData: `vendor-onboarding-email:${vendorId}`,
        });
      } catch {
        const error = new Error('Vendor onboarding credential payload could not be decrypted.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      if (!tempPassword) {
        const error = new Error('Vendor onboarding credential payload is empty.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const emailPayload = mailerService.buildVendorOnboardingEmail({
        to: recipient,
        recipientName: vendor.contactPerson || vendor.name,
        buyerOrganizationName: 'Procucev Enterprise',
        vendorCode: vendor.id,
        tempPassword,
        contactPhone: vendor.phone,
      });
      let delivery;
      try {
        delivery = await mailerService.sendVendorIngestionEmail(emailPayload, 'onboarding');
      } catch {
        const error = new Error('Vendor onboarding email provider request failed.');
        error.code = 'VENDOR_ONBOARDING_EMAIL_FAILED';
        throw error;
      }
      if (!delivery?.sent) {
        const error = new Error('Vendor onboarding email provider did not accept the message.');
        error.code = 'VENDOR_ONBOARDING_EMAIL_FAILED';
        throw error;
      }

      const saved = await require('./storeService').updateVendorDurably(vendorId, {
        onboardingEmailStatus: 'sent',
      });
      if (!saved) {
        const error = new Error('Vendor onboarding email was accepted but its status was not persisted.');
        error.code = 'VENDOR_ONBOARDING_STATUS_NOT_SAVED';
        throw error;
      }
      logger.info('Vendor onboarding email accepted and status persisted', {
        vendorId,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.HISTORICAL_VENDOR_ONBOARDING_EMAIL: {
      const { vendorId, encryptedEmailPayload } = job.raw || {};
      if (
        typeof vendorId !== 'string' || !vendorId
        || typeof encryptedEmailPayload !== 'string' || !encryptedEmailPayload
      ) {
        const error = new Error('Historical vendor onboarding email retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const vendor = await domainQueries.getVendorByIdFromDB(vendorId, { fresh: true });
      if (!vendor) {
        const error = new Error('Historical vendor onboarding email retry references a missing vendor.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      if (vendor.onboardingEmailStatus === 'sent') return;
      if (!['pending', 'failed'].includes(vendor.onboardingEmailStatus)) {
        const error = new Error('Historical vendor onboarding email retry references a vendor that is no longer eligible for delivery.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      let emailPayload;
      try {
        const serializedPayload = cryptoService.decrypt(encryptedEmailPayload, {
          additionalData: `vendor-historical-onboarding-email:${vendorId}`,
        });
        emailPayload = JSON.parse(serializedPayload);
      } catch {
        const error = new Error('Historical vendor onboarding email payload could not be decrypted.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      const recipient = String(vendor.email || '').trim();
      if (
        !emailPayload || typeof emailPayload !== 'object' || Array.isArray(emailPayload)
        || !EMAIL_REGEX.test(recipient)
        || String(emailPayload.to || '').trim().toLowerCase() !== recipient.toLowerCase()
        || typeof emailPayload.subject !== 'string' || !emailPayload.subject.trim()
        || (typeof emailPayload.html !== 'string' && typeof emailPayload.text !== 'string')
      ) {
        const error = new Error('Historical vendor onboarding email payload does not match its persisted vendor.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      let delivery;
      try {
        delivery = await mailerService.sendVendorIngestionEmail(emailPayload, 'onboarding');
      } catch {
        const error = new Error('Historical vendor onboarding email provider request failed.');
        error.code = 'HISTORICAL_VENDOR_ONBOARDING_EMAIL_FAILED';
        throw error;
      }
      if (!delivery?.sent) {
        const error = new Error('Historical vendor onboarding email provider did not accept the message.');
        error.code = 'HISTORICAL_VENDOR_ONBOARDING_EMAIL_FAILED';
        throw error;
      }

      const saved = await require('./storeService').updateVendorDurably(vendorId, {
        onboardingEmailStatus: 'sent',
      });
      if (!saved) {
        const error = new Error('Historical vendor onboarding email was accepted but its status was not persisted.');
        error.code = 'VENDOR_ONBOARDING_STATUS_NOT_SAVED';
        throw error;
      }
      logger.info('Historical vendor onboarding email accepted and status persisted', {
        vendorId,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.WHATSAPP_CREDENTIALS_EMAIL: {
      await dispatchWhatsAppCredentialEmail(job);
      return;
    }
    case EVENT_OUTBOX_TYPES.PAYMENT_DUES_EMAIL: {
      const paymentDuesQueries = require('../db/paymentDuesQueries');
      const communicationId = job.raw?.communicationId;
      if (typeof communicationId !== 'string' || !communicationId) {
        const error = new Error('Payment dues email retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      const communication = await paymentDuesQueries.getCommunicationById(communicationId);
      if (!communication || String(communication.channel).toLowerCase() !== 'email') {
        const error = new Error('Payment dues email retry references a missing communication.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      if (communication.deliveryStatus === 'Delivered') return;
      if (communication.deliveryStatus !== 'Pending') {
        const error = new Error('Payment dues email retry references a non-pending communication.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const delivery = await mailerService.deliver({
        to: communication.recipient,
        subject: communication.subject,
        text: communication.message,
      }, 'PAYMENT_DUES_NOTIFICATION');
      if (!delivery?.sent) {
        const error = new Error('Payment dues email provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }

      const updated = await paymentDuesQueries.updateCommunicationDeliveryStatus({
        communicationId,
        notificationStatus: 'Notification Sent',
        deliveryStatus: 'Delivered',
        acknowledgementStatus: 'Acknowledgement Pending',
      });
      if (!updated) {
        const error = new Error('Payment dues email was accepted but its status update was not persisted.');
        error.code = 'COMMUNICATION_STATUS_NOT_SAVED';
        throw error;
      }
      logger.info('Payment dues email accepted and communication updated', {
        communicationId,
        accountId: communication.accountId,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY: {
      const paymentDuesQueries = require('../db/paymentDuesQueries');
      const communicationId = job.raw?.communicationId;
      if (typeof communicationId !== 'string' || !communicationId) {
        const error = new Error('Communication delivery retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const communication = await paymentDuesQueries.getCommunicationById(communicationId);
      if (!communication) {
        const error = new Error('Communication delivery retry references a missing record.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      if (communication.deliveryStatus === 'Delivered') return;
      if (communication.deliveryStatus !== 'Pending') {
        const error = new Error('Communication delivery retry references a non-pending record.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const channel = String(communication.channel || '').toLowerCase();
      const metadata = communication.metadata && typeof communication.metadata === 'object'
        ? communication.metadata
        : {};
      if (channel === 'email') {
        const delivery = await mailerService.deliver({
          to: communication.recipient,
          subject: metadata.deliveryEmailSubject || communication.subject,
          text: communication.message || communication.notes || '',
          ...(typeof metadata.deliveryReplyTo === 'string' ? { replyTo: metadata.deliveryReplyTo } : {}),
        }, 'COMMUNICATION_DELIVERY');
        if (!delivery?.sent) {
          const error = new Error('Communication email provider did not accept the message.');
          error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
          throw error;
        }
      } else if (channel === 'sms') {
        const smsService = require('./smsService');
        const accountType = String(communication.accountType || '').toLowerCase();
        const delivery = await smsService.sendActionCenterSms({
          mobile: communication.recipient,
          recipientName: metadata.deliveryRecipientName || (accountType === 'vendor' ? 'Supplier' : 'Buyer'),
          message: communication.message || communication.subject || 'Important account update',
          entityType: metadata.deliveryEntityType || `${accountType || 'account'}_dossier`,
        });
        if (!delivery?.success) {
          const error = new Error('Communication SMS provider did not accept the message.');
          error.code = 'SMS_DELIVERY_NOT_ACCEPTED';
          throw error;
        }
      } else {
        const error = new Error('Communication delivery retry references an unsupported channel.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const updated = await paymentDuesQueries.updateCommunicationDeliveryStatus({
        communicationId,
        notificationStatus: 'Notification Sent',
        deliveryStatus: 'Delivered',
        acknowledgementStatus: 'Acknowledgement Pending',
      });
      if (!updated) {
        const error = new Error('Communication was accepted but its delivery status was not persisted.');
        error.code = 'COMMUNICATION_STATUS_NOT_SAVED';
        throw error;
      }
      logger.info('Persisted communication delivered and status updated', {
        communicationId,
        accountId: communication.accountId,
        accountType: communication.accountType,
        channel,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.RFQ_CREATED_EMAIL: {
      const rfqId = job.raw?.rfqId;
      if (typeof rfqId !== 'string' || !rfqId) {
        const error = new Error('RFQ creation acknowledgement retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const rfq = await domainQueries.getRFQByIdFromDB(rfqId);
      if (!rfq || rfq.creationAcknowledgementRequested !== true) {
        const error = new Error('RFQ creation acknowledgement retry references a missing or ineligible RFQ.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      const recipient = String(rfq.buyerEmail || rfq.raisedByEmail || '').trim();
      if (!recipient) {
        const error = new Error('RFQ creation acknowledgement has no persisted buyer recipient.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const lineItems = Array.isArray(rfq.extractedEntities) ? rfq.extractedEntities : [];
      const items = lineItems.map((item) => ({
        item_name: item.itemName || item.name || item.item_name || 'Line Item',
        item_spec: item.technicalSpecs || item.specifications || item.specs || item.description || item.item_spec || 'Standard Specification',
        qty: item.quantity != null ? item.quantity : (item.qty != null ? item.qty : 1),
        uom: item.unit || item.uom || 'Nos',
      }));
      const delivery = await mailerService.sendRfqAcknowledgementEmail({
        to: recipient,
        buyerName: rfq.raisedByName || rfq.buyerAccountName || 'Valued Buyer',
        rfqNumber: rfq.rfqNumber,
        rfqTitle: rfq.title,
        category: rfq.category,
        itemCount: items.length || 1,
        deliveryLocation: rfq.deliveryLocation,
        deliveryDate: rfq.targetDeliveryDate,
        requiredBy: rfq.targetDeliveryDate,
        quoteDeadline: rfq.deadline,
        deadline: rfq.deadline,
        suppliersInvited: Array.isArray(rfq.assignedVendors) && rfq.assignedVendors.length > 0
          ? rfq.assignedVendors.length
          : (rfq.procucevVendorCount || 5),
        items,
      });
      if (!delivery?.sent) {
        const error = new Error('RFQ creation acknowledgement email provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }
      logger.info('RFQ creation acknowledgement accepted by a provider', {
        rfqId,
        rfqNumber: rfq.rfqNumber,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.RFQ_VENDOR_INVITE_EMAIL: {
      const rfqId = job.raw?.rfqId;
      const target = job.raw?.target;
      if (
        typeof rfqId !== 'string' || !rfqId
        || typeof target?.key !== 'string' || !target.key
        || typeof target.recipientEmail !== 'string' || !target.recipientEmail.trim()
        || !target.vendor || typeof target.vendor !== 'object'
      ) {
        const error = new Error('RFQ vendor invitation retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const rfq = await domainQueries.getRFQByIdFromDB(rfqId);
      if (!rfq) {
        const error = new Error('RFQ vendor invitation retry references a missing RFQ.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }
      const delivery = await mailerService.sendRfqInviteEmail(target.recipientEmail, {
        rfq,
        recipientName: target.recipientName,
        buyerEmail: target.buyerEmail,
        freeCreditsRemaining: target.freeCreditsRemaining,
        isSubscribed: target.isSubscribed,
        isBuyerUploaded: target.isBuyerUploaded,
        vendor: target.vendor,
      });
      if (!delivery?.sent) {
        const error = new Error('RFQ vendor invitation email provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }
      logger.info('RFQ vendor invitation email accepted by a provider', {
        rfqId,
        rfqNumber: rfq.rfqNumber,
        vendorId: target.vendorId,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.RFQ_GATEWAY_NOTIFICATION_EMAIL: {
      const rfqId = job.raw?.rfqId;
      if (typeof rfqId !== 'string' || !rfqId) {
        const error = new Error('RFQ gateway notification retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const rfq = await domainQueries.getRFQByIdFromDB(rfqId);
      const target = rfq?.gatewayNotificationTarget;
      const recipientEmail = typeof target?.recipientEmail === 'string' ? target.recipientEmail.trim() : '';
      const sourceEmail = typeof target?.sourceEmail === 'string' ? target.sourceEmail.trim() : '';
      if (!rfq || !EMAIL_REGEX.test(recipientEmail) || (sourceEmail && !EMAIL_REGEX.test(sourceEmail))) {
        const error = new Error('RFQ gateway notification references a missing RFQ or invalid persisted recipient.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const delivery = await mailerService.sendRequisitionNotificationEmail(
        recipientEmail,
        rfq,
        sourceEmail || undefined
      );
      if (!delivery?.sent) {
        const error = new Error('RFQ gateway notification email provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }
      logger.info('RFQ gateway notification accepted by a provider', {
        rfqId,
        rfqNumber: rfq.rfqNumber,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.RFQ_QUOTE_RECEIVED_EMAIL: {
      const rfqId = job.raw?.rfqId;
      const quoteId = job.raw?.quoteId;
      const recipientEmail = typeof job.raw?.recipientEmail === 'string' ? job.raw.recipientEmail.trim() : '';
      const recipientName = typeof job.raw?.recipientName === 'string' && job.raw.recipientName.trim()
        ? job.raw.recipientName.trim()
        : null;
      if (
        typeof rfqId !== 'string' || !rfqId
        || typeof quoteId !== 'string' || !quoteId
        || !EMAIL_REGEX.test(recipientEmail)
      ) {
        const error = new Error('RFQ quote notification retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const rfq = await domainQueries.getRFQByIdFromDB(rfqId);
      const quote = Array.isArray(rfq?.quotes)
        ? rfq.quotes.find((candidate) => String(candidate.id || '') === quoteId)
        : null;
      if (!rfq || !quote) {
        const error = new Error('RFQ quote notification references a missing persisted RFQ or quote.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const delivery = await mailerService.sendQuoteReceivedEmail(recipientEmail, {
        rfq,
        quote,
        recipientName: recipientName || rfq.buyerAccountName || rfq.buyerName || 'Buyer',
      });
      if (!delivery?.sent) {
        const error = new Error('RFQ quote notification email provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }
      logger.info('RFQ quote notification accepted by a provider', {
        rfqId,
        rfqNumber: rfq.rfqNumber,
        vendorId: quote.vendorId,
        quoteId,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.RFQ_AUTO_CLOSURE_ACK_EMAIL: {
      const rfqId = job.raw?.rfqId;
      const quoteId = job.raw?.quoteId;
      const recipientEmail = typeof job.raw?.recipientEmail === 'string' ? job.raw.recipientEmail.trim() : '';
      const recipientName = typeof job.raw?.recipientName === 'string' && job.raw.recipientName.trim()
        ? job.raw.recipientName.trim()
        : null;
      if (
        typeof rfqId !== 'string' || !rfqId
        || typeof quoteId !== 'string' || !quoteId
        || !EMAIL_REGEX.test(recipientEmail)
      ) {
        const error = new Error('RFQ auto-closure acknowledgement retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const rfq = await domainQueries.getRFQByIdFromDB(rfqId);
      const quoteExists = Array.isArray(rfq?.quotes)
        && rfq.quotes.some((candidate) => String(candidate.id || '') === quoteId);
      if (!rfq || !quoteExists) {
        const error = new Error('RFQ auto-closure acknowledgement references a missing persisted RFQ or quote.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const delivery = await mailerService.sendRfqAutoClosureAcknowledgementEmail(recipientEmail, {
        rfq,
        quotesCount: rfq.quotes.length,
        recipientName: recipientName || rfq.buyerAccountName || rfq.buyerName || 'Buyer',
      });
      if (!delivery?.sent) {
        const error = new Error('RFQ auto-closure acknowledgement provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }
      logger.info('RFQ auto-closure acknowledgement accepted by a provider', {
        rfqId,
        rfqNumber: rfq.rfqNumber,
        quoteId,
        quotesCount: rfq.quotes.length,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.DAILY_RFQ_REPORT_EMAIL: {
      const reportDate = typeof job.raw?.reportDate === 'string' ? job.raw.reportDate : '';
      const timezone = typeof job.raw?.timezone === 'string' ? job.raw.timezone.trim() : '';
      const recipients = Array.isArray(job.raw?.recipients) ? job.raw.recipients : [];
      const parsedReportDate = new Date(`${reportDate}T00:00:00.000Z`);
      const reportDateValid = /^\d{4}-\d{2}-\d{2}$/.test(reportDate)
        && Number.isFinite(parsedReportDate.getTime())
        && parsedReportDate.toISOString().slice(0, 10) === reportDate;
      let timezoneValid = false;
      try {
        if (timezone && timezone.length <= DAILY_RFQ_REPORT_CONFIG.MAX_TIMEZONE_LENGTH) {
          Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
          timezoneValid = true;
        }
      } catch {
        timezoneValid = false;
      }
      if (
        !reportDateValid
        || !timezoneValid
        || recipients.length === 0
        || recipients.some((recipient) => typeof recipient !== 'string' || !EMAIL_REGEX.test(recipient.trim()))
      ) {
        const error = new Error('Daily RFQ report retry payload is invalid.');
        error.code = 'INVALID_PERSISTED_RECORD';
        throw error;
      }

      const dailyRfqReportService = require('./dailyRfqReportService');
      const result = await dailyRfqReportService.sendDailyRfqReport({ date: reportDate, timezone, recipients });
      if (!result?.success) {
        const error = new Error('Daily RFQ report email provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }
      logger.info('Daily RFQ report accepted by a provider', {
        reportDate,
        totalRFQs: result.totalRFQs,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    case EVENT_OUTBOX_TYPES.REGISTRATION_DECISION_EMAIL: {
      const delivery = await registrationDecisionNotificationService.sendRegistrationDecisionNotification(job.raw);
      if (!delivery?.sent) {
        const error = new Error('Registration decision email provider did not accept the message.');
        error.code = 'EMAIL_DELIVERY_NOT_ACCEPTED';
        throw error;
      }
      logger.info('Registration decision email accepted by a provider', {
        registrationId: job.raw.registrationId,
        accountType: job.raw.accountType,
        decision: job.raw.decision,
        outboxId: job.id,
      }, 'EVENT_OUTBOX');
      return;
    }
    default: {
      const error = new Error(`Unsupported persisted event-outbox type: ${job.event_type}`);
      error.code = 'INVALID_EVENT_OUTBOX_TYPE';
      throw error;
    }
  }
}

async function dispatchScheduledEventOutboxJobs(limit = EVENT_OUTBOX_MAX_BATCH_SIZE) {
  if (!pool.hasStorage()) return { claimed: 0, completed: 0, retried: 0, dead: 0 };
  try {
    const readyOnboardingEvents = await eventOutboxQueries.releaseReadyOnboardingQuoteNotificationsInDB();
    if (readyOnboardingEvents.length > 0) {
      logger.info('Released onboarding quote notifications whose buyers are complete', {
        operation: 'release-ready-onboarding-quote-notifications',
        released: readyOnboardingEvents.length,
      }, 'EVENT_OUTBOX');
    }
  } catch (error) {
    logger.error('Could not release completed-buyer quote notifications from deferred state', {
      operation: 'release-ready-onboarding-quote-notifications',
      error,
    }, 'EVENT_OUTBOX');
  }

  return dispatchDueEventOutboxJobs(limit);
}

async function dispatchDueEventOutboxJobs(limit = EVENT_OUTBOX_MAX_BATCH_SIZE, eventIds = null) {
  if (!pool.hasStorage()) return { claimed: 0, completed: 0, retried: 0, dead: 0 };

  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const jobs = await eventOutboxQueries.claimDueEventOutboxInDB({
    now: now.toISOString(),
    staleBefore: new Date(now.getTime() - EVENT_OUTBOX_LEASE_MS).toISOString(),
    leaseUntil: new Date(now.getTime() + EVENT_OUTBOX_LEASE_MS).toISOString(),
    leaseToken,
    limit: Math.min(Math.max(Number(limit) || 1, 1), EVENT_OUTBOX_MAX_BATCH_SIZE),
    ids: eventIds,
  });

  let completed = 0;
  let retried = 0;
  let dead = 0;
  const completedIds = [];
  for (const job of jobs) {
    try {
      if (job.parseError) throw job.parseError;
      await dispatchEvent(job);
      const saved = await eventOutboxQueries.markEventOutboxCompleteInDB(job.id, job.lease_token || leaseToken);
      if (!saved) {
        logger.warn('Event-outbox lease expired before completion was recorded', {
          outboxId: job.id,
          eventType: job.event_type,
        }, 'EVENT_OUTBOX');
        continue;
      }
      completed += 1;
      completedIds.push(job.id);
    } catch (error) {
      const permanentFailure = error?.code === 'INVALID_EVENT_OUTBOX_TYPE' || error?.code === 'INVALID_PERSISTED_RECORD';
      const isDead = permanentFailure || job.attempts >= EVENT_OUTBOX_MAX_ATTEMPTS;
      const availableAt = new Date(Date.now() + getRetryDelayMs(job.attempts)).toISOString();
      if (
        isDead
        && job.event_type === EVENT_OUTBOX_TYPES.COMMUNICATION_DELIVERY
        && typeof job.raw?.communicationId === 'string'
        && job.raw.communicationId
      ) {
        try {
          const paymentDuesQueries = require('../db/paymentDuesQueries');
          const failedRecord = await paymentDuesQueries.updateCommunicationDeliveryStatus({
            communicationId: job.raw.communicationId,
            notificationStatus: 'Failed',
            deliveryStatus: 'Failed',
            acknowledgementStatus: 'Failed',
          });
          if (!failedRecord) {
            logger.warn('Dead-lettered communication has no matching delivery-history row', {
              communicationId: job.raw.communicationId,
              outboxId: job.id,
            }, 'EVENT_OUTBOX');
          }
        } catch (communicationError) {
          logger.error('Could not mark dead-lettered communication as failed', {
            error: communicationError,
            communicationId: job.raw.communicationId,
            outboxId: job.id,
          }, 'EVENT_OUTBOX');
        }
      }
      if (
        isDead
        && [
          EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
          EVENT_OUTBOX_TYPES.HISTORICAL_VENDOR_ONBOARDING_EMAIL,
          EVENT_OUTBOX_TYPES.WHATSAPP_CREDENTIALS_EMAIL,
        ].includes(job.event_type)
        && typeof job.raw?.vendorId === 'string'
        && job.raw.vendorId
      ) {
        try {
          const updated = await require('./storeService').updateVendorDurably(job.raw.vendorId, {
            onboardingEmailStatus: 'failed',
          });
          if (!updated) {
            logger.warn('Dead-lettered vendor onboarding email has no matching vendor record', {
              vendorId: job.raw.vendorId,
              outboxId: job.id,
            }, 'EVENT_OUTBOX');
          }
        } catch (vendorError) {
          logger.error('Could not mark dead-lettered vendor onboarding email as failed', {
            error: vendorError,
            vendorId: job.raw.vendorId,
            outboxId: job.id,
          }, 'EVENT_OUTBOX');
        }
      }
      try {
        await eventOutboxQueries.rescheduleEventOutboxInDB({
          id: job.id,
          leaseToken: job.lease_token || leaseToken,
          status: isDead ? 'dead' : 'pending',
          availableAt,
          lastError: getSafeErrorLabel(error),
        });
      } catch (stateError) {
        logger.error('Failed to persist event-outbox retry state', {
          error: stateError,
          outboxId: job.id,
          eventType: job.event_type,
          attempt: job.attempts,
        }, 'EVENT_OUTBOX');
      }
      logger.error(isDead ? 'Background event moved to the event-outbox dead-letter state' : 'Background event delivery failed and was rescheduled', {
        error,
        outboxId: job.id,
        eventType: job.event_type,
        attempt: job.attempts,
        nextAttemptAt: isDead ? null : availableAt,
      }, 'EVENT_OUTBOX');
      if (isDead) dead += 1;
      else retried += 1;
    }
  }

  if (jobs.length > 0) {
    logger.info('Background event-outbox dispatch completed', {
      claimed: jobs.length,
      completed,
      retried,
      dead,
    }, 'EVENT_OUTBOX');
  }
  return { claimed: jobs.length, completed, retried, dead, completedIds };
}

async function purgeExpiredEventOutboxRows() {
  if (!pool.hasStorage()) return 0;
  const retentionMs = EVENT_OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  const removed = await eventOutboxQueries.purgeEventOutboxInDB(cutoff, cutoff);
  if (removed > 0) {
    logger.info('Expired event-outbox rows purged', { removed, retentionDays: EVENT_OUTBOX_RETENTION_DAYS }, 'EVENT_OUTBOX');
  }
  return removed;
}

module.exports = {
  buildEventOutboxId,
  enqueueEventOutbox,
  persistWithOutboxFallback,
  dispatchScheduledEventOutboxJobs,
  dispatchDueEventOutboxJobs,
  purgeExpiredEventOutboxRows,
  getSafeErrorLabel,
  getRetryDelayMs,
};

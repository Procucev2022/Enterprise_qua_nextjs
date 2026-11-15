/**
 * Action Center Communication Controller
 * HTTP handler for dispatching, retrieving, and tracking SMS and Email communications.
 */

const crypto = require('crypto');
const { logger } = require('../services/loggerService');
const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
const actionCenterNotificationService = require('../services/actionCenterNotificationService');
const paymentDuesQueries = require('../db/paymentDuesQueries');
const { SYSTEM_ACTOR_EMAIL } = require('../config/constants');

// Messages stay in this module until they move to backend/src/config/constants.js.
const ACTION_CENTER_CONTROLLER_MESSAGES = Object.freeze({
  AUTHENTICATED_SESSION_REQUIRED: 'An authenticated session is required to dispatch an Action Center communication.',
});

/**
 * Resolves the actor strictly from the authenticated session (req.user).
 * Returns null fields when there is no session; callers must reject those requests.
 */
function resolveActor(req) {
  const user = req?.user;
  return {
    id: user?.id || user?.uuid || user?.sub || null,
    name: user?.fullName || user?.name || user?.email || null,
    email: user?.email || null,
  };
}

/**
 * Timing-safe string comparison to prevent side-channel timing attacks.
 */
function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Verifies authenticity of inbound webhook callbacks.
 */
function verifyWebhookAuthenticity(req) {
  const expectedSecret =
    process.env.ACTION_CENTER_COMM_WEBHOOK_SECRET ||
    process.env.ACTION_CENTER_WEBHOOK_SECRET ||
    process.env.WEBHOOK_SECRET;

  if (!expectedSecret) {
    return { valid: false, error: 'Webhook authentication is not configured.' };
  }

  const providedSecret =
    req?.headers?.['x-webhook-secret'] ||
    req?.headers?.['x-signature'] ||
    req?.headers?.['x-gateway-secret'];

  if (!providedSecret) {
    return { valid: false, error: 'Missing webhook authentication signature.' };
  }

  const providedSecretStr = String(providedSecret);
  if (!timingSafeCompare(providedSecretStr, expectedSecret)) {
    return { valid: false, error: 'Invalid webhook authentication signature.' };
  }

  return { valid: true };
}

/**
 * Express middleware enforcing webhook signature authentication before invoking delivery webhook handlers.
 */
function verifyWebhookSignature(req, res, next) {
  const authCheck = verifyWebhookAuthenticity(req);
  if (!authCheck.valid) {
    logger.warn(`Rejected unauthorized delivery webhook: ${authCheck.error}`, {}, 'ACTION_CENTER_CONTROLLER');
    return res.status(401).json({
      success: false,
      error: authCheck.error,
    });
  }
  return next();
}

/**
 * POST /api/action-center/communications
 * Dispatches an SMS, Email, or multi-channel communication from Action Center.
 */
async function dispatchCommunication(req, res) {
  try {
    const actor = resolveActor(req);

    // The route mounts optionalAuthenticate, so the session is checked here.
    if (!req?.user || !(actor.email || actor.id)) {
      return res.status(401).json({
        success: false,
        error: ACTION_CENTER_CONTROLLER_MESSAGES.AUTHENTICATED_SESSION_REQUIRED,
      });
    }

    const validation = validatePayload(
      VALIDATION_SCHEMAS.actionCenterCommunicationSend,
      req.body
    );

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid communication payload.',
        details: validation.errors,
      });
    }

    const channel = (validation.sanitizedData.channel || '').toUpperCase();
    const { recipientEmail, recipientPhone } = validation.sanitizedData;

    const { INDIAN_MOBILE_REGEX, EMAIL_REGEX } = require('../config/validationSchemas');

    // Contact requirement assertions based on selected channel
    if ((channel === 'EMAIL' || channel === 'BOTH')) {
      if (!recipientEmail || !EMAIL_REGEX.test(recipientEmail)) {
        return res.status(400).json({
          success: false,
          error: 'A valid recipient email address is required for Email dispatch.',
        });
      }
    }

    if ((channel === 'SMS' || channel === 'BOTH')) {
      if (!recipientPhone) {
        return res.status(400).json({
          success: false,
          error: 'A valid recipient phone number is required for SMS dispatch.',
        });
      }
      if (!INDIAN_MOBILE_REGEX.test(recipientPhone)) {
        return res.status(400).json({
          success: false,
          error: 'A valid 10-digit Indian mobile number is required for SMS dispatch.',
        });
      }
    }

    const payload = {
      ...validation.sanitizedData,
      channel,
    };

    const result = await actionCenterNotificationService.dispatchActionCenterCommunication(
      payload,
      actor
    );

    const actorLabel = actor.email || actor.id;
    logger.audit(
      `[ACTION_CENTER_COMM] ${result.queued ? 'Queued' : 'Dispatched'} ${channel} communication for ${validation.sanitizedData.entityType} ${validation.sanitizedData.entityId} by ${actorLabel}`,
      actorLabel,
      {
        actor: actorLabel,
        channel,
        recipientEmail,
        recipientPhone,
        success: result.success,
        queued: Boolean(result.queued),
      }
    );

    return res.status(200).json({
      success: result.success,
      queued: Boolean(result.queued),
      message: result.queued
        ? 'Communication was saved and queued for delivery.'
        : result.followupError
        ? 'Communication dispatched, but scheduling follow-up task failed.'
        : result.success
        ? 'Communication dispatched and recorded successfully.'
        : 'Communication dispatch partially failed, but record was stored.',
      communication: result.communication,
      emailResult: result.emailResult,
      smsResult: result.smsResult,
      completedTask: result.completedTask,
      followupTask: result.followupTask,
      followupError: result.followupError || null,
    });
  } catch (err) {
    logger.error('Error dispatching Action Center communication', err, 'ACTION_CENTER_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while dispatching the communication.',
      details: err.message,
    });
  }
}

/**
 * GET /api/action-center/communications
 * Retrieves communication logs for Action Center entities.
 */
async function getCommunications(req, res) {
  try {
    const validation = validatePayload(
      VALIDATION_SCHEMAS.actionCenterCommunicationQuery,
      req.query
    );

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid query parameters.',
        details: validation.errors,
      });
    }

    const result = await actionCenterNotificationService.getActionCenterCommunications(
      validation.sanitizedData
    );

    return res.status(200).json({
      success: true,
      items: result.items,
      pagination: result.pagination,
    });
  } catch (err) {
    logger.error('Error fetching Action Center communications', err, 'ACTION_CENTER_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve communication records.',
      details: err.message,
    });
  }
}

/**
 * POST /api/action-center/communications/webhook
 * Receives delivery status and acknowledgement updates using unique communication ID.
 */
async function handleDeliveryWebhook(req, res) {
  try {
    const authCheck = verifyWebhookAuthenticity(req);
    if (!authCheck.valid) {
      logger.warn(`Rejected unauthorized delivery webhook: ${authCheck.error}`, {}, 'ACTION_CENTER_CONTROLLER');
      return res.status(401).json({
        success: false,
        error: authCheck.error,
      });
    }

    const body = (req && typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body)) ? req.body : {};
    const { communicationId, messageId, msgid, accountId, acknowledgementStatus, deliveryStatus, notes } = body;
    const effectiveCommId = communicationId || messageId || msgid;

    if (!effectiveCommId) {
      return res.status(400).json({
        success: false,
        error: 'A unique communicationId or gateway messageId is required for delivery status webhooks.',
      });
    }

    const updatePayload = {
      communicationId: effectiveCommId,
      // Webhooks are authenticated by a shared secret, not a user session, so the write is attributed to the system account.
      updatedBy: SYSTEM_ACTOR_EMAIL,
      notes: notes || (deliveryStatus ? `Webhook delivery status: ${deliveryStatus}` : `Webhook acknowledgement status: ${acknowledgementStatus || 'Acknowledged'}`),
    };
    if (accountId) {
      updatePayload.accountId = accountId;
    }

    if (deliveryStatus) {
      updatePayload.deliveryStatus = deliveryStatus;
    }
    if (acknowledgementStatus) {
      updatePayload.acknowledgementStatus = acknowledgementStatus;
    } else if (!deliveryStatus) {
      updatePayload.acknowledgementStatus = 'Acknowledged';
    }

    const updated = await paymentDuesQueries.updateAcknowledgementStatus(updatePayload);

    if (!updated) {
      return res.status(404).json({
        success: false,
        error: `Communication record with ID '${effectiveCommId}' was not found.`,
      });
    }

    logger.audit(
      `[ACTION_CENTER_WEBHOOK] Updated status for communication ${effectiveCommId}: delivery=${updatePayload.deliveryStatus || 'unchanged'}, ack=${updatePayload.acknowledgementStatus || 'unchanged'}`,
      SYSTEM_ACTOR_EMAIL,
      { communicationId: effectiveCommId, deliveryStatus: updatePayload.deliveryStatus, acknowledgementStatus: updatePayload.acknowledgementStatus }
    );

    return res.status(200).json({
      success: true,
      message: 'Communication status updated successfully.',
      updated,
    });
  } catch (err) {
    logger.error('Error in communication webhook handler', err, 'ACTION_CENTER_CONTROLLER');
    return res.status(500).json({
      success: false,
      error: 'Failed to process delivery status webhook.',
      details: err.message,
    });
  }
}

module.exports = {
  dispatchCommunication,
  getCommunications,
  handleDeliveryWebhook,
  resolveActor,
  timingSafeCompare,
  verifyWebhookAuthenticity,
  verifyWebhookSignature,
};

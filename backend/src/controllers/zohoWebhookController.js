// ============================================================================
// ZOHO PAYMENTS WEBHOOK
// ============================================================================
// Public endpoint Zoho itself calls — no session auth, protected instead by
// signature verification. Event claims and completion receipts are durable in
// D1/PostgreSQL so isolate restarts and parallel Workers cannot double-run an
// event. Business mutations remain independently idempotent for crash recovery.
// ============================================================================

const storeService = require('../services/storeService');
const zohoPaymentService = require('../services/zohoPaymentService');
const zohoWebhookQueries = require('../db/zohoWebhookQueries');
const { ZOHO_CONFIG, ZOHO_WEBHOOK_MESSAGES, PERSISTENCE_MESSAGES } = require('../config/constants');
const { logger } = require('../services/loggerService');

function retryResponse(res, message = ZOHO_WEBHOOK_MESSAGES.RETRY_DELIVERY) {
  return res.status(503).json({ success: false, error: message, retryable: true });
}

async function handleWebhook(req, res) {
  const signatureHeader = req.get('X-Zoho-Webhook-Signature');
  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  if (!zohoPaymentService.verifyWebhookSignature(signatureHeader, rawBody)) {
    logger.warn('Rejected Zoho webhook: invalid signature', {}, 'ZOHO_WEBHOOK');
    return res.status(401).json({ success: false, error: ZOHO_WEBHOOK_MESSAGES.INVALID_SIGNATURE });
  }

  const event = req.body || {};
  if (ZOHO_CONFIG.ACCOUNT_ID && String(event.account_id) !== String(ZOHO_CONFIG.ACCOUNT_ID)) {
    logger.warn('Rejected Zoho webhook: account_id mismatch', { accountId: event.account_id }, 'ZOHO_WEBHOOK');
    return res.status(403).json({ success: false, error: ZOHO_WEBHOOK_MESSAGES.ACCOUNT_MISMATCH });
  }

  const eventId = event.event_id === undefined || event.event_id === null ? '' : String(event.event_id).trim();
  const receiptAccountId = event.account_id === undefined || event.account_id === null ? '' : String(event.account_id);
  let receipt = null;

  if (eventId) {
    try {
      receipt = await zohoWebhookQueries.claimWebhookEvent(receiptAccountId, eventId, event);
    } catch (error) {
      logger.error('Zoho webhook event claim failed; delivery remains retryable', {
        error,
        eventId,
        eventType: event.event_type,
      }, 'ZOHO_WEBHOOK');
      return retryResponse(res);
    }

    if (!receipt || !receipt.claimed) {
      logger.info('Zoho webhook event already claimed or processed', {
        eventId,
        eventType: event.event_type,
        claimReason: receipt && receipt.reason,
      }, 'ZOHO_WEBHOOK');
      if (receipt && receipt.reason === 'PROCESSED') {
        return res.json({ success: true, skipped: true });
      }
      return retryResponse(res);
    }
  }

  try {
    const eventObject = event.event_object || {};
    const link = await storeService.getPaymentLinkByZohoId(eventObject.payment_link_id);
    if (!link) {
      const error = Object.assign(new Error('Payment link is not available for this webhook yet.'), {
        code: 'PAYMENT_LINK_NOT_FOUND',
      });
      throw error;
    }

    switch (event.event_type) {
      case 'payment_link.paid': {
        const activated = await storeService.activatePaymentLinkDurably(link.id, event);
        if (!activated) {
          throw Object.assign(new Error('Paid Zoho payment had no durable subscription owner.'), {
            code: 'PAYMENT_ACTIVATION_UNAVAILABLE',
          });
        }
        break;
      }
      case 'payment_link.canceled': {
        const updated = await storeService.updatePaymentLinkRecordDurably(link.id, {
          status: 'CANCELED',
          rawResponse: event,
        });
        if (!updated) {
          throw Object.assign(new Error('Cancellation was not applied to durable storage.'), {
            code: 'PAYMENT_STATUS_UPDATE_FAILED',
          });
        }
        break;
      }
      case 'payment_link.expired': {
        const updated = await storeService.updatePaymentLinkRecordDurably(link.id, {
          status: 'EXPIRED',
          rawResponse: event,
        });
        if (!updated) {
          throw Object.assign(new Error('Expiration was not applied to durable storage.'), {
            code: 'PAYMENT_STATUS_UPDATE_FAILED',
          });
        }
        break;
      }
      default:
        logger.warn(`Unhandled Zoho webhook event type: ${event.event_type}`, { eventId }, 'ZOHO_WEBHOOK');
    }

    if (receipt) {
      const completed = await zohoWebhookQueries.completeWebhookEvent(
        receiptAccountId,
        eventId,
        receipt.ownerToken
      );
      if (!completed) {
        throw Object.assign(new Error('Zoho webhook completion receipt was not saved.'), {
          code: 'WEBHOOK_RECEIPT_WRITE_FAILED',
        });
      }
    }

    return res.json({ success: true });
  } catch (error) {
    if (receipt) {
      try {
        await zohoWebhookQueries.failWebhookEvent(
          receiptAccountId,
          eventId,
          receipt.ownerToken,
          error.code || error.name || 'PROCESSING_FAILED'
        );
      } catch (receiptError) {
        logger.error('Zoho webhook failure receipt could not be saved; lease expiry will allow retry', {
          error: receiptError,
          eventId,
          originalError: error,
        }, 'ZOHO_WEBHOOK');
      }
    }

    logger.error('Zoho webhook event processing failed and remains retryable', {
      error,
      eventId: eventId || undefined,
      eventType: event.event_type,
      paymentLinkId: event.event_object && event.event_object.payment_link_id,
    }, 'ZOHO_WEBHOOK');

    if (error.code === 'PAYMENT_STATUS_UPDATE_FAILED') {
      return retryResponse(res, PERSISTENCE_MESSAGES.PAYMENT_STATUS_UPDATE_FAILED);
    }
    if (error.code === 'PAYMENT_ACTIVATION_UNAVAILABLE') {
      return retryResponse(res, ZOHO_WEBHOOK_MESSAGES.PAYMENT_ACTIVATION_RETRY);
    }
    return retryResponse(res);
  }
}

module.exports = { handleWebhook, retryResponse };

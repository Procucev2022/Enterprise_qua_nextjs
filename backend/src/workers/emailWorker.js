// ==============================================================================
// CLOUDFLARE EMAIL WORKER (AUTONOMOUS EMAIL-TO-RFQ & BID INGESTION)
// ==============================================================================
// Edge email handler invoked natively by Cloudflare Email Routing events.
// Replaces persistent IMAP socket polling daemons with edge-triggered execution.
// ==============================================================================

const emailIngestionService = require('../services/emailIngestionService');
const rfqIngestionService = require('../services/rfqIngestionService');
const geminiService = require('../services/geminiService');
const storeService = require('../services/storeService');
const mailerService = require('../services/mailerService');
const { logger } = require('../services/loggerService');
const pool = require('../db/pool');
const { EMAIL_INGESTION_STATUS } = require('../config/constants');

/**
 * Read raw email payload stream into a Node Buffer
 * Handles Web Streams, Node Readable streams, and ArrayBuffers
 */
async function readRawStreamToBuffer(raw) {
  if (!raw) return Buffer.alloc(0);
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);

  // Web Streams (Response.body, ReadableStream, or Cloudflare message.raw)
  if (
    typeof raw.getReader === 'function' ||
    (typeof ReadableStream !== 'undefined' && raw instanceof ReadableStream)
  ) {
    try {
      const response = new Response(raw);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      // Fall through to manual chunk collection
    }
  }

  // Node.js stream collection fallback
  if (typeof raw.on === 'function') {
    return new Promise((resolve, reject) => {
      const chunks = [];
      raw.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      raw.on('end', () => resolve(Buffer.concat(chunks)));
      raw.on('error', (err) => reject(err));
    });
  }

  return Buffer.from(String(raw));
}

/**
 * Handles incoming email event in Cloudflare Worker runtime
 *
 * @param {Object} message - Cloudflare EmailMessage (from, to, headers, raw, setReject)
 * @param {Object} env - Cloudflare environment bindings
 * @param {Object} ctx - Cloudflare execution context
 * @returns {Promise<Object>} Outcome summary of processed email
 */
async function handleEmail(message = {}, env = {}, ctx = null) {
  const fromAddress = String(message.from || '').trim().toLowerCase();
  const toAddress = String(message.to || '').trim().toLowerCase();
  const messageId =
    message.headers && typeof message.headers.get === 'function'
      ? message.headers.get('message-id') || `cf-${Date.now()}`
      : `cf-${Date.now()}`;

  logger.info(`[EmailWorker] Inbound email from <${fromAddress}> to <${toAddress}>`, { messageId }, 'EMAIL_WORKER');

  if (env && (env.HYPERDRIVE || env.DATABASE_URL)) {
    pool.initFromEnv(env);
  }

  if (!fromAddress) {
    if (typeof message.setReject === 'function') {
      message.setReject('Sender address is missing.');
    }
    return { outcome: 'REJECTED_NO_SENDER', messageId };
  }

  try {
    const rawBuffer = await readRawStreamToBuffer(message.raw);
    const prepared = await emailIngestionService.prepareEmailForExtraction(rawBuffer, 'inbound-email.eml');

    if (prepared.status === EMAIL_INGESTION_STATUS.NO_CONTENT) {
      logger.warn(`[EmailWorker] Email <${messageId}> has no extractable content`, {}, 'EMAIL_WORKER');
      return { outcome: 'IGNORED_NO_CONTENT', messageId };
    }

    // Authorization: Verify if sender is registered buyer
    const buyerAccount = await storeService.getBuyerAccountByEmail(fromAddress);

    if (!buyerAccount) {
      logger.warn(`[EmailWorker] Unauthorized sender <${fromAddress}>. Halting RFQ creation.`, {}, 'EMAIL_WORKER');

      // Send registration required notification per Enterprise QUA Standard
      try {
        await mailerService.sendUnauthorizedBuyerNotificationEmail(fromAddress, {
          subject: prepared.message ? prepared.message.subject : 'Enterprise QUA - Buyer Registration Required',
        });
      } catch (mailErr) {
        logger.error('[EmailWorker] Failed to send registration notice', mailErr, 'EMAIL_WORKER');
      }

      return { outcome: 'UNAUTHORIZED_BUYER_NOTIFICATION_SENT', fromAddress, messageId };
    }

    // Authorized buyer: Extract RFQ line items via Gemini
    logger.info(`[EmailWorker] Processing RFQ extraction for buyer "${buyerAccount.companyName}"`, {}, 'EMAIL_WORKER');
    const extractionResult = await geminiService.extractLineItems(prepared.extractionInput);

    // Build and persist RFQ
    const { draft } = await rfqIngestionService.buildRFQDraft({
      lineItems: extractionResult?.lineItems || [],
      title: prepared.message?.subject || 'Email RFQ',
      category: extractionResult?.category,
      estimatedBudget: extractionResult?.estimatedBudget,
      source: 'email_worker',
      sourceEmail: fromAddress,
    });

    const createdRfq = await storeService.createRFQ(draft, buyerAccount);

    const rfqId = createdRfq?.id || createdRfq?.rfqId || 'N/A';
    logger.info(`[EmailWorker] Successfully created RFQ ${rfqId}`, {}, 'EMAIL_WORKER');
    return {
      outcome: 'RFQ_CREATED',
      rfqId,
      buyerId: buyerAccount.id,
      messageId,
    };
  } catch (err) {
    logger.error(`[EmailWorker] Error processing email <${messageId}>`, err, 'EMAIL_WORKER');
    return { outcome: 'ERROR', error: err.message, messageId };
  }
}

module.exports = { handleEmail, readRawStreamToBuffer };

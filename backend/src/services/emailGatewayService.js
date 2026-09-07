// ==============================================================================
// AUTONOMOUS EMAIL INGESTION GATEWAY
// ==============================================================================
// Watches a mailbox and turns inbound requisitions into RFQs without anyone
// uploading a file.
//
// It owns none of the parsing or extraction logic. A fetched message goes through
// exactly the same emailIngestionService -> geminiService -> rfqIngestionService
// path as an `.eml` a buyer uploads by hand, so there is one implementation of
// "read an email into line items" and both routes cannot drift.
//
// THREE DELIBERATE CONSTRAINTS, none of which are incidental:
//
//   1. The sender must resolve to an existing buyer account. This is both the
//      security control and a functional necessity — RFQs are scoped by
//      buyerAccountId, so a requisition from an unknown address has no owner and
//      would appear on nobody's dashboard. Without this check, anyone who learns
//      the intake address could inject RFQs and reach the vendor panel.
//   2. An ingested RFQ lands in 'Parsing', not 'Quotes Pending'. Nothing has
//      reviewed it, and the category manager kanban already has a Parsing column
//      standing empty. Auto-circulating unreviewed inbound mail to vendors is not
//      something that should happen by default.
//   3. Idempotence comes from our own ledger, not from the IMAP \Seen flag. See
//      db/emailGatewayQueries.js for why the flag alone is not enough.
// ==============================================================================

const { ImapFlow } = require('imapflow');
const emailIngestionService = require('./emailIngestionService');
const geminiService = require('./geminiService');
const rfqIngestionService = require('./rfqIngestionService');
const storeService = require('./storeService');
const emailGatewayQueries = require('../db/emailGatewayQueries');
const { logger } = require('./loggerService');
const {
  EMAIL_GATEWAY_CONFIG,
  EMAIL_GATEWAY_MESSAGES,
  EMAIL_INGESTION_STATUS,
} = require('../config/constants');

const { INGESTION_OUTCOME } = emailGatewayQueries;

/** Live state, reported by getStatus and mutated only by the poll loop. */
const runtime = {
  pollTimer: null,
  isPolling: false,
  lastPollAt: null,
  lastPollDurationMs: null,
  lastError: null,
  lastConnectedAt: null,
  consideredThisRun: 0,
  ingestedThisRun: 0,
};

/**
 * Resolve gateway configuration from the environment.
 *
 * Read on every call rather than captured at import, so a test can vary it and so
 * a deployment does not need a restart to change the allow-list.
 */
function resolveConfig(env = process.env) {
  const splitList = (value) =>
    String(value || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

  return {
    enabled: String(env.EMAIL_GATEWAY_ENABLED || '').toLowerCase() === 'true',
    host: (env.EMAIL_GATEWAY_HOST || '').trim(),
    port: Number(env.EMAIL_GATEWAY_PORT || 993),
    secure: String(env.EMAIL_GATEWAY_SECURE || 'true').toLowerCase() !== 'false',
    user: (env.EMAIL_GATEWAY_USER || '').trim(),
    password: env.EMAIL_GATEWAY_PASSWORD || '',
    mailbox: (env.EMAIL_GATEWAY_MAILBOX || 'INBOX').trim(),
    pollIntervalMs: Math.max(
      Number(env.EMAIL_GATEWAY_POLL_MS || EMAIL_GATEWAY_CONFIG.DEFAULT_POLL_MS),
      EMAIL_GATEWAY_CONFIG.MIN_POLL_MS
    ),
    maxPerPoll: Math.max(Number(env.EMAIL_GATEWAY_MAX_PER_POLL || EMAIL_GATEWAY_CONFIG.DEFAULT_MAX_PER_POLL), 1),
    // Optional extra restriction on top of the buyer-account requirement.
    allowedDomains: splitList(env.EMAIL_GATEWAY_ALLOWED_DOMAINS),
    allowedSenders: splitList(env.EMAIL_GATEWAY_ALLOWED_SENDERS),
  };
}

/** True when enough is configured to attempt a connection. */
function isConfigured(config = resolveConfig()) {
  return !!(config.host && config.user && config.password);
}

/**
 * May a requisition from this address be ingested?
 *
 * Order matters. An explicit sender allow-list, when set, is the whole rule — that
 * is the tightest configuration and it should not be widened by the account lookup
 * below. Otherwise the address must belong to a buyer account, optionally narrowed
 * further to a set of domains.
 *
 * Returns `{ allowed, reason, buyerAccount }`. `buyerAccount` is needed by the
 * caller regardless, to scope the RFQ.
 */
function resolveSenderAuthorisation(fromAddress, config = resolveConfig()) {
  const address = String(fromAddress || '').trim().toLowerCase();
  if (!address) {
    return { allowed: false, reason: EMAIL_GATEWAY_MESSAGES.SENDER_MISSING, buyerAccount: null };
  }

  const buyerAccount = storeService.getBuyerAccountByEmail(address) || null;

  if (config.allowedSenders.length > 0) {
    if (!config.allowedSenders.includes(address)) {
      return {
        allowed: false,
        reason: EMAIL_GATEWAY_MESSAGES.SENDER_NOT_LISTED.replace('{address}', address),
        buyerAccount,
      };
    }
    // Still needs an owning account: an RFQ with no buyerAccountId is invisible.
    if (!buyerAccount) {
      return {
        allowed: false,
        reason: EMAIL_GATEWAY_MESSAGES.SENDER_NO_ACCOUNT.replace('{address}', address),
        buyerAccount: null,
      };
    }
    return { allowed: true, reason: null, buyerAccount };
  }

  if (config.allowedDomains.length > 0) {
    const domain = address.split('@')[1] || '';
    if (!config.allowedDomains.includes(domain)) {
      return {
        allowed: false,
        reason: EMAIL_GATEWAY_MESSAGES.DOMAIN_NOT_LISTED.replace('{domain}', domain || address),
        buyerAccount,
      };
    }
  }

  if (!buyerAccount) {
    return {
      allowed: false,
      reason: EMAIL_GATEWAY_MESSAGES.SENDER_NO_ACCOUNT.replace('{address}', address),
      buyerAccount: null,
    };
  }

  return { allowed: true, reason: null, buyerAccount };
}

/**
 * Turn one raw message into an RFQ.
 *
 * Resolves to the ledger outcome rather than throwing, so one unusable message
 * cannot abort the rest of the batch. Every path records why.
 */
async function processMessage(rawSource, config = resolveConfig()) {
  const prepared = await emailIngestionService.prepareEmailForExtraction({
    // The gateway holds raw bytes; prepareEmailForExtraction takes base64, the
    // same shape the upload route provides.
    fileName: EMAIL_GATEWAY_CONFIG.SYNTHETIC_FILE_NAME,
    content: Buffer.isBuffer(rawSource) ? rawSource.toString('base64') : String(rawSource || ''),
  });

  if (prepared.status !== EMAIL_INGESTION_STATUS.READY) {
    return {
      status: INGESTION_OUTCOME.UNREADABLE,
      detail: EMAIL_GATEWAY_MESSAGES.PREPARE_REFUSED.replace('{status}', prepared.status),
      message: prepared.message || null,
    };
  }

  const { message } = prepared;

  const authorisation = resolveSenderAuthorisation(message.fromAddress, config);
  if (!authorisation.allowed) {
    return { status: INGESTION_OUTCOME.SENDER_NOT_ALLOWED, detail: authorisation.reason, message };
  }

  const extraction = await geminiService.extractLineItems(prepared.extractionInput);
  if (extraction.status !== geminiService.EXTRACTION_STATUS.SUCCESS) {
    return {
      status: INGESTION_OUTCOME.NO_LINE_ITEMS,
      detail: EMAIL_GATEWAY_MESSAGES.EXTRACTION_FAILED.replace('{status}', extraction.status),
      message,
    };
  }

  const { draft, classification } = await rfqIngestionService.buildRFQDraft({
    lineItems: extraction.lineItems,
    title: extraction.documentTitle || message.subject,
    category: extraction.category,
    estimatedBudget: extraction.estimatedBudget,
    source: 'email_gateway',
    sourceEmail: message.fromAddress,
  });

  if (classification.accepted === 0) {
    return {
      status: INGESTION_OUTCOME.NO_LINE_ITEMS,
      detail: EMAIL_GATEWAY_MESSAGES.NO_ITEMS_ACCEPTED,
      message,
    };
  }

  const created = storeService.createRFQ(
    {
      title: draft.title,
      category: draft.category,
      sourcingMode: EMAIL_GATEWAY_CONFIG.INGESTED_SOURCING_MODE,
      // Held for review rather than circulated. Nothing has checked this yet.
      status: EMAIL_GATEWAY_CONFIG.INGESTED_STATUS,
      source: 'email_gateway',
      sourceEmail: message.fromAddress,
      sourceFileName: message.subject || EMAIL_GATEWAY_CONFIG.SYNTHETIC_FILE_NAME,
      raisedByEmail: message.fromAddress,
      budget: draft.estimatedBudget || 0,
      targetDeliveryDate: draft.targetDeliveryDate,
      extractedEntities: draft.extractedEntities,
      attachments: [],
    },
    authorisation.buyerAccount
  );

  logger.audit(
    `RFQ ${created.rfqNumber} raised from inbound email`,
    message.fromAddress,
    { rfqId: created.id, messageId: message.messageId, accepted: classification.accepted }
  );

  return {
    status: INGESTION_OUTCOME.INGESTED,
    detail: EMAIL_GATEWAY_MESSAGES.INGESTED_DETAIL.replace(
      '{count}',
      String(classification.accepted)
    ).replace('{needsReview}', String(classification.needsReview)),
    message,
    rfq: created,
  };
}

/**
 * Read the mailbox once and ingest whatever is new.
 *
 * Only unseen messages are fetched, and only up to `maxPerPoll` per run so a
 * backlog cannot spend an unbounded amount of time (and Gemini quota) in one
 * pass — the remainder is picked up next tick.
 *
 * A message is marked \Seen only after its outcome is in the ledger. Doing it the
 * other way round would lose the requisition entirely if the ledger write failed.
 *
 * Overlapping runs are refused rather than queued: a slow extraction should not
 * cause two passes to fetch the same unseen message concurrently.
 */
async function pollOnce(config = resolveConfig()) {
  if (runtime.isPolling) {
    return { skipped: true, reason: EMAIL_GATEWAY_MESSAGES.POLL_ALREADY_RUNNING };
  }
  if (!isConfigured(config)) {
    return { skipped: true, reason: EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED };
  }

  runtime.isPolling = true;
  runtime.consideredThisRun = 0;
  runtime.ingestedThisRun = 0;
  const startedAt = Date.now();
  const outcomes = [];

  const client = new emailGateway.ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    // The library logs every protocol frame at info level otherwise, which buries
    // app.log and would include message headers.
    logger: false,
  });

  try {
    await client.connect();
    runtime.lastConnectedAt = new Date().toISOString();
    const lock = await client.getMailboxLock(config.mailbox);
    try {
      const unseenUids = await client.search({ seen: false });
      const batch = (unseenUids || []).slice(0, config.maxPerPoll);

      for (const uid of batch) {
        runtime.consideredThisRun += 1;
        let messageId = null;
        try {
          const fetched = await client.fetchOne(String(uid), { source: true, envelope: true });
          if (!fetched || !fetched.source) {
            outcomes.push({ uid, status: INGESTION_OUTCOME.UNREADABLE });
            continue;
          }
          messageId = fetched.envelope && fetched.envelope.messageId ? fetched.envelope.messageId : null;

          // Ours is the authoritative dedupe check; see emailGatewayQueries.
          if (messageId && (await emailGatewayQueries.hasProcessed(messageId))) {
            await client.messageFlagsAdd(String(uid), ['\\Seen']);
            outcomes.push({ uid, messageId, status: EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED });
            continue;
          }

          const result = await emailGateway.processMessage(fetched.source, config);
          const resolvedMessageId =
            messageId || (result.message && result.message.messageId) || `uid-${uid}@${config.mailbox}`;

          await emailGatewayQueries.recordProcessed({
            messageId: resolvedMessageId,
            status: result.status,
            detail: result.detail,
            fromAddress: result.message ? result.message.fromAddress : null,
            subject: result.message ? result.message.subject : null,
            rfqId: result.rfq ? result.rfq.id : null,
            rfqNumber: result.rfq ? result.rfq.rfqNumber : null,
          });

          if (result.status === INGESTION_OUTCOME.INGESTED) runtime.ingestedThisRun += 1;
          // Flagged after the ledger write, so a failed write leaves the message
          // to be retried rather than silently dropped.
          await client.messageFlagsAdd(String(uid), ['\\Seen']);
          outcomes.push({ uid, messageId: resolvedMessageId, status: result.status });
        } catch (err) {
          logger.error('Inbound message could not be processed', err, 'EMAIL_GATEWAY');
          if (messageId) {
            await emailGatewayQueries.recordProcessed({
              messageId,
              status: INGESTION_OUTCOME.FAILED,
              detail: err.message,
            });
          }
          outcomes.push({ uid, messageId, status: INGESTION_OUTCOME.FAILED });
        }
      }

      runtime.lastError = null;
      return {
        skipped: false,
        considered: runtime.consideredThisRun,
        ingested: runtime.ingestedThisRun,
        pending: Math.max((unseenUids || []).length - batch.length, 0),
        outcomes,
      };
    } finally {
      lock.release();
    }
  } catch (err) {
    // A connection or authentication failure. Reported through status rather than
    // thrown, so the panel can explain it and the interval keeps trying.
    runtime.lastError = err.message;
    logger.error('Email gateway poll failed', err, 'EMAIL_GATEWAY');
    return { skipped: false, error: err.message, considered: runtime.consideredThisRun, outcomes };
  } finally {
    try {
      await client.logout();
    } catch {
      // Already disconnected; nothing useful to do.
    }
    runtime.isPolling = false;
    runtime.lastPollAt = new Date().toISOString();
    runtime.lastPollDurationMs = Date.now() - startedAt;
  }
}

/**
 * Begin polling on an interval.
 *
 * The first backend background task, so it is deliberately conservative: it
 * refuses to start twice, does nothing when unconfigured or disabled, and unrefs
 * the timer so it can never hold the process open on shutdown.
 */
function startPolling(config = resolveConfig()) {
  if (runtime.pollTimer) return { started: false, reason: EMAIL_GATEWAY_MESSAGES.ALREADY_STARTED };
  if (!config.enabled) return { started: false, reason: EMAIL_GATEWAY_MESSAGES.DISABLED };
  if (!isConfigured(config)) return { started: false, reason: EMAIL_GATEWAY_MESSAGES.NOT_CONFIGURED };

  runtime.pollTimer = setInterval(() => {
    emailGateway.pollOnce(resolveConfig()).catch((err) => {
      logger.error('Email gateway interval poll threw', err, 'EMAIL_GATEWAY');
    });
  }, config.pollIntervalMs);
  if (typeof runtime.pollTimer.unref === 'function') runtime.pollTimer.unref();

  logger.info(
    `Email ingestion gateway watching ${config.user} every ${Math.round(config.pollIntervalMs / 1000)}s`,
    { mailbox: config.mailbox, host: config.host },
    'EMAIL_GATEWAY'
  );
  return { started: true, pollIntervalMs: config.pollIntervalMs };
}

/** Stop the interval. Safe to call when it was never started. */
function stopPolling() {
  if (!runtime.pollTimer) return false;
  clearInterval(runtime.pollTimer);
  runtime.pollTimer = null;
  return true;
}

/**
 * Everything the gateway panel needs.
 *
 * Credentials are never included — only the account being watched, which the buyer
 * has to see to know which address to forward requisitions to.
 */
async function getStatus() {
  const config = resolveConfig();
  const configured = isConfigured(config);

  return {
    enabled: config.enabled,
    configured,
    watching: !!runtime.pollTimer,
    mailboxUser: config.user || null,
    mailbox: config.mailbox,
    host: config.host || null,
    pollIntervalMs: config.pollIntervalMs,
    // Empty means "any address that maps to a buyer account", which is the
    // baseline rule and worth stating explicitly in the panel.
    allowedSenders: config.allowedSenders,
    allowedDomains: config.allowedDomains,
    lastPollAt: runtime.lastPollAt,
    lastPollDurationMs: runtime.lastPollDurationMs,
    lastConnectedAt: runtime.lastConnectedAt,
    lastError: runtime.lastError,
    isPolling: runtime.isPolling,
    counts: configured ? await emailGatewayQueries.countsByStatus() : {},
    recent: configured ? await emailGatewayQueries.listRecent() : [],
    // So the panel can say where an ingested RFQ ends up without hardcoding it.
    ingestedStatus: EMAIL_GATEWAY_CONFIG.INGESTED_STATUS,
  };
}

// Mutable holder, like viewModule in db/view.js, so the interval callback and
// pollOnce resolve their collaborators at call time and stay substitutable.
const emailGateway = {
  runtime,
  INGESTION_OUTCOME,
  resolveConfig,
  isConfigured,
  resolveSenderAuthorisation,
  processMessage,
  pollOnce,
  startPolling,
  stopPolling,
  getStatus,
  ImapFlow,
};

module.exports = emailGateway;

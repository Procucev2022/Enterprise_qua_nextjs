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
const mailerService = require('./mailerService');
const emailGatewayQueries = require('../db/emailGatewayQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const pool = require('../db/pool');
const { logger } = require('./loggerService');
const {
  EMAIL_GATEWAY_CONFIG,
  EMAIL_GATEWAY_MESSAGES,
  EMAIL_GATEWAY_STATE,
  EMAIL_GATEWAY_SMTP_PORTS,
  EMAIL_INGESTION_STATUS,
  resolveBuyerSourcingMode,
  SYSTEM_ACTOR_EMAIL,
  VENDOR_QUOTE_SUPPORT_CC,
} = require('../config/constants');

const { INGESTION_OUTCOME } = emailGatewayQueries;

/** Live state, reported by getStatus and mutated only by the poll loop. */
const runtime = {
  pollTimer: null,
  isPolling: false,
  // Mail older than this is never considered. Set when watching begins so an
  // existing backlog is left alone; see the search call in pollOnce.
  watchingSince: new Date().toISOString(),
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
    // IMAP login. An operational credential — this is the account the backend
    // authenticates as, and it is not what a buyer needs to know.
    user: (env.EMAIL_GATEWAY_USER || '').trim(),
    password: env.EMAIL_GATEWAY_PASSWORD || '',
    // The Procucev intake address buyers actually send their requisition TO.
    // Kept separate from the IMAP login because the two are different things and
    // routinely differ: mail addressed to an alias or shared mailbox such as
    // client@procucev.com can be collected by a login of intake@procucev.com.
    // Conflating them is what put a personal Gmail login in front of buyers as
    // though it were the address to forward requisitions to.
    address: (env.EMAIL_GATEWAY_ADDRESS || env.EMAIL_GATEWAY_USER || EMAIL_GATEWAY_CONFIG.DEFAULT_GATEWAY_ADDRESS).trim(),
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
 * Catch the misconfiguration that cannot be diagnosed from the socket error.
 *
 * Pointing this at an SMTP host or port fails with
 * `SSL routines::wrong version number`, which says nothing about the cause. The
 * check happens before connecting so the panel can name the wrong variable.
 *
 * Returns a message, or null when the combination looks sane.
 */
function describeConfigurationFault(config = resolveConfig()) {
  if (/^smtp\./i.test(config.host)) {
    return EMAIL_GATEWAY_MESSAGES.SMTP_HOST_CONFIGURED.replace('{host}', config.host);
  }
  if (EMAIL_GATEWAY_SMTP_PORTS.includes(config.port)) {
    return EMAIL_GATEWAY_MESSAGES.SMTP_PORT_CONFIGURED.replace('{port}', String(config.port));
  }
  return null;
}

/**
 * Translate a connection failure into something actionable.
 *
 * The raw errors here are OpenSSL and IMAP protocol text — a stack trace
 * mentioning `SSL routines` tells the reader nothing about which environment
 * variable is wrong. The original message is still logged; only the panel gets
 * this version.
 */
function describeConnectionError(err) {
  const message = String((err && err.message) || '');

  if (/wrong version number|packet length too long|record layer/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.TLS_VERSION_MISMATCH;
  }
  if (/AUTHENTICATIONFAILED|Invalid credentials|Username and Password not accepted|LOGIN failed/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.AUTH_REJECTED;
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.HOST_UNRESOLVED;
  }
  if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|timed out/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.HOST_UNREACHABLE;
  }
  if (/certificate|CERT_|self.signed|altname/i.test(message)) {
    return EMAIL_GATEWAY_MESSAGES.CERTIFICATE_REJECTED;
  }
  return EMAIL_GATEWAY_MESSAGES.CONNECTION_FAILED_FALLBACK;
}

/**
 * Which of the four states the panel should show.
 *
 * A configuration fault counts as a connection error even before a connection has
 * been attempted, because the outcome is already known and the buyer needs to be
 * told the gateway is not going to work.
 */
function resolveConnectionState(config, { lastError, watching } = {}) {
  if (!isConfigured(config)) return EMAIL_GATEWAY_STATE.NOT_CONFIGURED;
  if (describeConfigurationFault(config)) return EMAIL_GATEWAY_STATE.CONNECTION_ERROR;
  if (!config.enabled) return EMAIL_GATEWAY_STATE.SWITCHED_OFF;
  if (lastError) return EMAIL_GATEWAY_STATE.CONNECTION_ERROR;
  if (watching) return EMAIL_GATEWAY_STATE.ACTIVE_LISTENING;
  return EMAIL_GATEWAY_STATE.SWITCHED_OFF;
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
 * Resolves the registered buyer's default delivery location (city, state, pincode)
 * dynamically from the validated buyer account or linked organization profile.
 */
async function resolveBuyerRegisteredLocation(buyerAccount) {
  if (!buyerAccount) {
    return { city: '', state: '', pincode: '' };
  }

  // 1. Direct fields on buyerAccount (in-memory or store service account object)
  const directCity = buyerAccount.city || buyerAccount.deliveryCity || '';
  const directState = buyerAccount.state || buyerAccount.deliveryState || '';
  const directPincode = buyerAccount.pincode || buyerAccount.zipCode || buyerAccount.deliveryPincode || '';

  if (directCity || directState || directPincode) {
    return {
      city: String(directCity).trim(),
      state: String(directState).trim(),
      pincode: String(directPincode).trim(),
    };
  }

  // 2. Query Neon PostgreSQL buyer profile if pool is active and buyer has corporateEmail
  if (pool && pool.pool && buyerAccount.corporateEmail) {
    try {
      const email = String(buyerAccount.corporateEmail).trim().toLowerCase();
      const rows = await pool.rows(
        `${buyerProfileQueries.PROFILE_SELECT} where lower(u.username) = lower($1) or lower(u.email) = lower($1) limit 1`,
        [email]
      );
      if (rows.length > 0) {
        const mapped = buyerProfileQueries.mapRowToProfile(rows[0]);
        if (mapped) {
          return {
            city: mapped.city || '',
            state: mapped.state || '',
            pincode: mapped.pincode || '',
          };
        }
      }
    } catch (dbErr) {
      logger.error('Failed to query buyer profile for location fallback', dbErr, 'EMAIL_GATEWAY');
    }
  }

  return { city: '', state: '', pincode: '' };
}

/**
 * Processes extracted line items, applies deterministic defaults (delivery date and location),
 * and groups items by (delivery_date + delivery_city + delivery_state + delivery_pincode).
 *
 * @param {Array<Object>} lineItems Extracted line items from geminiService
 * @param {Object} extraction Document-level extraction metadata
 * @param {Object} buyerLocation Registered buyer location ({ city, state, pincode })
 * @returns {Array<{ groupKey: string, targetDate: string, deliveryCity: string, deliveryState: string, deliveryPincode: string, deliveryLocation: string, items: Array<Object> }>}
 */
function processLineItemsAndGroups(lineItems, extraction = {}, buyerLocation = {}) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const defaultDate = rfqIngestionService.defaultTargetDate(5);

  const groupsMap = new Map();

  items.forEach((item) => {
    // 1. Delivery Date: Explicit on item -> Explicit on document -> Default (today + 5 days)
    const rawTargetDate =
      item.targetDate ||
      item.deliveryDate ||
      item.delivery_date ||
      extraction.deliveryDate ||
      extraction.targetDeliveryDate;

    const targetDate = String(rawTargetDate || defaultDate).trim();

    // 2. Location Handling:
    const explicitCity = String(item.deliveryCity || item.delivery_city || extraction.deliveryCity || '').trim();
    const explicitState = String(item.deliveryState || item.delivery_state || extraction.deliveryState || '').trim();
    const explicitPincode = String(item.deliveryPincode || item.delivery_pincode || extraction.deliveryPincode || '').trim();
    const explicitLocation = String(item.deliveryLocation || item.delivery_location || extraction.deliveryLocation || '').trim();

    let deliveryCity = explicitCity;
    let deliveryState = explicitState;
    let deliveryPincode = explicitPincode;
    let deliveryLocation = explicitLocation;

    const hasExplicitLocation = Boolean(explicitCity || explicitState || explicitPincode || explicitLocation);

    if (!hasExplicitLocation) {
      // Entirely missing: apply registered buyer's default delivery location
      deliveryCity = buyerLocation.city || '';
      deliveryState = buyerLocation.state || '';
      deliveryPincode = buyerLocation.pincode || '';
      deliveryLocation = [deliveryCity, deliveryState, deliveryPincode].filter(Boolean).join(', ');
    } else {
      // Partial location handling: preserve explicit fields without replacing them with buyer defaults
      if (!deliveryCity && deliveryLocation) {
        deliveryCity = deliveryLocation;
      }
      if (!deliveryLocation) {
        deliveryLocation = [deliveryCity, deliveryState, deliveryPincode].filter(Boolean).join(', ');
      }
    }

    const processedItem = {
      ...item,
      targetDate,
      deliveryCity,
      deliveryState,
      deliveryPincode,
      deliveryLocation,
    };

    // Group key: (delivery_date + delivery_city + delivery_state + delivery_pincode)
    const groupKey = [
      targetDate,
      deliveryCity.toLowerCase(),
      deliveryState.toLowerCase(),
      deliveryPincode.toLowerCase(),
    ].join('|');

    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        groupKey,
        targetDate,
        deliveryCity,
        deliveryState,
        deliveryPincode,
        deliveryLocation,
        items: [],
      });
    }

    groupsMap.get(groupKey).items.push(processedItem);
  });

  return Array.from(groupsMap.values());
}

/**
 * Extract referenced RFQ number and lookup target RFQ from subject, body, or thread references.
 */
function extractRfqReferenceFromEmail(message) {
  if (!message) return { targetRfq: null, referencedNumber: null };
  const sources = [
    message.subject || '',
    message.bodyText || '',
    message.textBody || '',
    message.text || '',
    message.inReplyTo || '',
    message.references || '',
  ].join(' ');

  const rfqRegex = /#?(RFQ[-\w\d]+)/gi;
  const rawMatches = [];
  let m;
  while ((m = rfqRegex.exec(sources)) !== null) {
    rawMatches.push(m[1]);
  }
  if (rawMatches.length === 0) return { targetRfq: null, referencedNumber: null };

  const candidates = [];
  for (const raw of rawMatches) {
    const trimmed = raw.trim();
    const standardMatch = trimmed.match(/RFQ-?\d{4}-\d{4,6}/i) || trimmed.match(/RFQ\d{10,14}/i);
    if (standardMatch) {
      candidates.push(standardMatch[0].toUpperCase());
    }
    const stripped = trimmed.replace(/-(?:dispatch|reply|notification|mailer|inbound|gateway|update)$/i, '');
    candidates.push(stripped.toUpperCase());
    candidates.push(trimmed.toUpperCase());
  }

  for (const cand of candidates) {
    const foundRfq = storeService.getRFQById(cand);
    if (foundRfq) return { targetRfq: foundRfq, referencedNumber: foundRfq.rfqNumber || cand };
  }
  return { targetRfq: null, referencedNumber: (candidates[0] || rawMatches[0].trim()).toUpperCase() };
}

/**
 * Resolve vendor record from sender email address or vendor directory.
 */
function resolveVendorFromEmail(fromAddress) {
  if (!fromAddress) return null;
  const email = String(fromAddress).trim().toLowerCase();

  const direct = storeService.getVendorById(email);
  if (direct) return direct;

  const allVendors = storeService.getVendors ? storeService.getVendors() : [];
  const found = allVendors.find(
    (v) => (v.email && v.email.toLowerCase() === email) || (v.corporateEmail && v.corporateEmail.toLowerCase() === email)
  );
  if (found) return found;

  return null;
}

/**
 * Ingests a vendor quotation received via email into the referenced RFQ.
 */
async function processVendorQuoteMessage(message, targetRfq, vendorRecord) {
  logger.info(
    `Processing inbound vendor quotation email for RFQ ${targetRfq.rfqNumber} from ${vendorRecord.name} (${message.fromAddress})`,
    { rfqNumber: targetRfq.rfqNumber, vendorId: vendorRecord.id, fromAddress: message.fromAddress },
    'EMAIL_GATEWAY'
  );

  const extraction = await geminiService.extractQuotationFromEmail(
    {
      bodyText: message.bodyText || message.textBody || message.text,
      subject: message.subject,
      fromAddress: message.fromAddress,
      attachments: message.attachments || [],
    },
    targetRfq
  );

  const unitPriceNum = Number(extraction.unitPrice);
  if (!extraction.unitPrice || isNaN(unitPriceNum) || unitPriceNum <= 0) {
    logger.warn(
      `Vendor quote from ${vendorRecord.name} for RFQ ${targetRfq.rfqNumber} failed validation: missing or invalid unit price (${extraction.unitPrice})`,
      { rfqNumber: targetRfq.rfqNumber, vendorId: vendorRecord.id, fromAddress: message.fromAddress },
      'EMAIL_GATEWAY'
    );

    const buyerEmail = storeService.resolveBuyerEmailForRFQ(targetRfq);
    const ccList = [buyerEmail, VENDOR_QUOTE_SUPPORT_CC].filter(Boolean);

    try {
      await mailerService.sendQuoteFailureEmail(message.fromAddress, {
        rfqNumber: targetRfq.rfqNumber,
        rfqTitle: targetRfq.title,
        vendorName: vendorRecord.name,
        reason: 'Unit Price (₹) is mandatory and must be greater than 0.',
        missingFields: ['Unit Price (₹)'],
        cc: ccList.length > 0 ? ccList.join(', ') : undefined,
      });
    } catch (mailErr) {
      logger.error('Failed to send vendor quote failure email', mailErr, 'EMAIL_GATEWAY');
    }

    return {
      status: INGESTION_OUTCOME.QUOTE_VALIDATION_FAILED,
      detail: EMAIL_GATEWAY_MESSAGES.QUOTE_VALIDATION_FAILED_DETAIL
        .replace('{rfqNumber}', targetRfq.rfqNumber)
        .replace('{vendorName}', vendorRecord.name)
        .replace('{reason}', 'Missing mandatory unit price'),
      message,
      rfq: targetRfq,
    };
  }

  const quote = {
    vendorId: vendorRecord.id,
    vendorName: vendorRecord.name,
    vendorCategory: vendorRecord.category || 'Client List',
    unitPrice: extraction.unitPrice,
    totalPrice: extraction.totalPrice || extraction.unitPrice,
    leadTimeDays: extraction.leadTimeDays || 7,
    aiMatchScore: 0,
    warrantyYears: extraction.warrantyYears || 1,
    complianceStatus: extraction.complianceStatus || 'Fully Compliant',
    paymentTerms: extraction.paymentTerms || '',
    remarks: extraction.remarks || 'Email quotation submitted',
    submittedAt: new Date().toISOString(),
    source: 'email',
    submissionMethod: 'Email Submission',
    sourceMessageId: message.messageId || null,
    lineItemQuotes: extraction.lineItemQuotes || [],
    taxes: extraction.taxes || 0,
    deliveryCharges: extraction.deliveryCharges || 0,
    deliveryDate: extraction.deliveryDate || null,
    quotationValidity: extraction.quotationValidity || null,
  };

  const updatedRFQ = storeService.addQuoteToRFQ(targetRfq.id, quote);

  storeService.addAuditLog({
    userEmail: message.fromAddress || SYSTEM_ACTOR_EMAIL,
    action: `Quotation for ${targetRfq.rfqNumber} received via email from ${vendorRecord.name} (Total: ₹${quote.totalPrice})`,
    rfqNumber: targetRfq.rfqNumber,
  });

  logger.audit(
    `Quotation for ${targetRfq.rfqNumber} received via email from ${vendorRecord.name} (Total: ₹${quote.totalPrice})`,
    message.fromAddress,
    {
      rfqNumber: targetRfq.rfqNumber,
      vendorId: vendorRecord.id,
      vendorName: vendorRecord.name,
      totalPrice: quote.totalPrice,
      unitPrice: quote.unitPrice,
      source: 'email',
    }
  );

  const buyerEmail = storeService.resolveBuyerEmailForRFQ(targetRfq);
  const ccList = [buyerEmail, VENDOR_QUOTE_SUPPORT_CC].filter(Boolean);

  try {
    await mailerService.sendQuoteAcknowledgementEmail(message.fromAddress, {
      rfqNumber: targetRfq.rfqNumber,
      rfqTitle: targetRfq.title,
      vendorName: vendorRecord.name,
      quote,
      cc: ccList.length > 0 ? ccList.join(', ') : undefined,
    });
  } catch (mailErr) {
    logger.error('Failed to send vendor quote acknowledgement email', mailErr, 'EMAIL_GATEWAY');
  }

  return {
    status: INGESTION_OUTCOME.QUOTE_INGESTED,
    detail: EMAIL_GATEWAY_MESSAGES.QUOTE_INGESTED_DETAIL
      .replace('{rfqNumber}', targetRfq.rfqNumber)
      .replace('{vendorName}', vendorRecord.name),
    message,
    quote,
    rfq: updatedRFQ || targetRfq,
  };
}

/**
 * Turn one raw message into an RFQ or vendor quote.
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

  // 1. Check if this message is a vendor quotation reply for an existing RFQ
  const { targetRfq, referencedNumber } = extractRfqReferenceFromEmail(message);
  const vendorRecord = resolveVendorFromEmail(message.fromAddress);

  if (targetRfq && vendorRecord) {
    return await processVendorQuoteMessage(message, targetRfq, vendorRecord);
  }

  if (!targetRfq && referencedNumber && vendorRecord) {
    return {
      status: INGESTION_OUTCOME.INVALID_RFQ,
      detail: EMAIL_GATEWAY_MESSAGES.INVALID_RFQ_REFERENCED.replace('{rfqNumber}', referencedNumber),
      message,
    };
  }


  // 2. Otherwise process as Inbound Buyer RFQ Requisition
  const authorisation = resolveSenderAuthorisation(message.fromAddress, config);
  if (!authorisation.allowed) {
    if (message.fromAddress) {
      try {
        await mailerService.sendUnauthorizedBuyerNotificationEmail(message.fromAddress, {
          subject: message.subject,
          gatewayAddress: config.user || EMAIL_GATEWAY_CONFIG.DEFAULT_GATEWAY_ADDRESS,
        });
      } catch (mailErr) {
        logger.error('Failed to dispatch registration notification to unauthorized sender', mailErr, 'EMAIL_GATEWAY');
      }
    }
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

  const buyerLocation = await emailGateway.resolveBuyerRegisteredLocation(authorisation.buyerAccount);
  const groups = emailGateway.processLineItemsAndGroups(extraction.lineItems, extraction, buyerLocation);

  if (groups.length === 0) {
    return {
      status: INGESTION_OUTCOME.NO_LINE_ITEMS,
      detail: EMAIL_GATEWAY_MESSAGES.NO_ITEMS_ACCEPTED,
      message,
    };
  }

  // Enforce maximum 49 line items per RFQ
  for (const group of groups) {
    if (group.items.length > EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ) {
      const detail = EMAIL_GATEWAY_MESSAGES.LINE_ITEMS_EXCEED_LIMIT
        .replace('{max}', String(EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ))
        .replace('{count}', String(group.items.length));
      logger.warn(
        `RFQ ingestion rejected: line items exceed limit of ${EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ}`,
        { count: group.items.length, max: EMAIL_GATEWAY_CONFIG.MAX_LINE_ITEMS_PER_RFQ },
        'EMAIL_GATEWAY'
      );
      return {
        status: INGESTION_OUTCOME.LINE_ITEMS_EXCEED_LIMIT,
        detail,
        message,
      };
    }
  }

  const createdRFQs = [];
  let totalAccepted = 0;
  let totalNeedsReview = 0;

  for (const group of groups) {
    const { draft, classification } = await rfqIngestionService.buildRFQDraft({
      lineItems: group.items,
      title: extraction.documentTitle || message.subject,
      category: extraction.category,
      estimatedBudget: extraction.estimatedBudget,
      source: 'email_gateway',
      sourceEmail: message.fromAddress,
      deliveryLocation: group.deliveryLocation,
      deliveryCity: group.deliveryCity,
      deliveryState: group.deliveryState,
      deliveryPincode: group.deliveryPincode,
      targetDeliveryDate: group.targetDate,
    });

    if (classification.accepted === 0) {
      continue;
    }

    totalAccepted += classification.accepted;
    totalNeedsReview += classification.needsReview;

    const sourcingMode = resolveBuyerSourcingMode(authorisation.buyerAccount);

    const created = storeService.createRFQ(
      {
        title: draft.title,
        category: draft.category,
        sourcingMode,
        // Held for review rather than circulated. Nothing has checked this yet.
        status: EMAIL_GATEWAY_CONFIG.INGESTED_STATUS,
        source: 'email_gateway',
        sourceEmail: message.fromAddress,
        sourceFileName: message.subject || EMAIL_GATEWAY_CONFIG.SYNTHETIC_FILE_NAME,
        raisedByEmail: message.fromAddress,
        budget: draft.estimatedBudget || 0,
        targetDeliveryDate: draft.targetDeliveryDate,
        extractedEntities: draft.extractedEntities,
        deliveryLocation: draft.deliveryLocation,
        deliveryCity: draft.deliveryCity,
        deliveryState: draft.deliveryState,
        deliveryPincode: draft.deliveryPincode,
        attachments: [],
      },
      authorisation.buyerAccount
    );

    createdRFQs.push(created);

    // Dispatch RFQ creation acknowledgement email to the buyer
    if (message.fromAddress) {
      try {
        const buyerName =
          authorisation.buyerAccount?.contactPerson ||
          authorisation.buyerAccount?.organizationName ||
          message.fromName ||
          'Valued Buyer';

        await mailerService.sendRfqAcknowledgementEmail({
          to: message.fromAddress,
          buyerName,
          rfqNumber: created.rfqNumber,
          rfqTitle: created.title,
        });
      } catch (ackErr) {
        logger.error('Failed to dispatch RFQ acknowledgement email to buyer', ackErr, 'EMAIL_GATEWAY');
      }
    }

    logger.audit(
      `RFQ ${created.rfqNumber} raised from inbound email`,
      message.fromAddress,
      { rfqId: created.id, messageId: message.messageId, accepted: classification.accepted }
    );
  }

  if (createdRFQs.length === 0) {
    return {
      status: INGESTION_OUTCOME.NO_LINE_ITEMS,
      detail: EMAIL_GATEWAY_MESSAGES.NO_ITEMS_ACCEPTED,
      message,
    };
  }

  return {
    status: INGESTION_OUTCOME.INGESTED,
    detail: EMAIL_GATEWAY_MESSAGES.INGESTED_DETAIL.replace(
      '{count}',
      String(totalAccepted)
    ).replace('{needsReview}', String(totalNeedsReview)),
    message,
    rfq: createdRFQs[0],
    rfqs: createdRFQs,
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

  // Refused before opening a socket: the failure is already certain, and the
  // socket error it would produce names none of the offending variables.
  const configurationFault = describeConfigurationFault(config);
  if (configurationFault) {
    runtime.lastError = configurationFault;
    logger.error(
      'Email gateway is misconfigured and was not contacted',
      new Error(configurationFault),
      'EMAIL_GATEWAY'
    );
    return { skipped: true, reason: configurationFault };
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
      // Bounded by when the gateway started watching, not just by the unseen
      // flag. A real mailbox has a backlog — the account this was first pointed at
      // had 110 unread messages — and without this bound the gateway would work
      // through years of unrelated mail, spend its per-poll budget on it, and
      // never reach the requisition that just arrived.
      const unseenUids = await client.search({ seen: false, since: new Date(runtime.watchingSince) });
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
          const dedupeKey = messageId || `uid-${uid}@${config.mailbox}`;

          // Ours is the authoritative dedupe check; see emailGatewayQueries.
          if (await emailGatewayQueries.hasProcessed(dedupeKey)) {
            await client.messageFlagsAdd(String(uid), ['\\Seen']);
            outcomes.push({ uid, messageId: dedupeKey, status: EMAIL_GATEWAY_MESSAGES.ALREADY_PROCESSED });
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
            rfqNumber:
              result.rfqs && result.rfqs.length > 1
                ? result.rfqs.map((r) => r.rfqNumber).join(', ')
                : result.rfq
                ? result.rfq.rfqNumber
                : null,
          });

          if (result.status === INGESTION_OUTCOME.INGESTED || result.status === INGESTION_OUTCOME.QUOTE_INGESTED) {
            runtime.ingestedThisRun += 1;
            // Marked read only for a message we actually acted on, and only after
            // the ledger write, so a failed write leaves it to be retried. Mail
            // the gateway rejected is left untouched: it belongs to the mailbox
            // owner, not to us, and the ledger already stops it being
            // reconsidered on the next poll.
            await client.messageFlagsAdd(String(uid), ['\\Seen']);
          }
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
    // thrown, so the panel can explain it and the interval keeps trying. The raw
    // OpenSSL/IMAP text goes to the log; the panel gets the actionable version.
    runtime.lastError = err.message;
    logger.error(`Email gateway poll failed: ${err.message}`, err, 'EMAIL_GATEWAY');
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

  // Surfaced at boot rather than on the first tick, so a bad host or port is in
  // the startup log instead of appearing two minutes later as a TLS error.
  const configurationFault = describeConfigurationFault(config);
  if (configurationFault) {
    runtime.lastError = configurationFault;
    return { started: false, reason: configurationFault };
  }

  // Anchored here so only mail arriving from now on is considered.
  runtime.watchingSince = new Date().toISOString();
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

  const configurationFault = configured ? describeConfigurationFault(config) : null;
  // A configuration fault is reported as the last error even before a connection
  // has been tried, because the outcome is already known.
  const lastError = configurationFault || runtime.lastError;

  return {
    enabled: config.enabled,
    configured,
    watching: !!runtime.pollTimer,
    connectionState: resolveConnectionState(config, { lastError, watching: !!runtime.pollTimer }),
    // What a buyer addresses their requisition to.
    gatewayAddress: config.address || null,
    // The IMAP account the backend reads it from. Operational detail, shown as
    // such rather than presented to the buyer as a destination.
    mailboxUser: config.user || null,
    mailbox: config.mailbox,
    host: config.host || null,
    pollIntervalMs: config.pollIntervalMs,
    // Empty means "any address that maps to a buyer account", which is the
    // baseline rule and worth stating explicitly in the panel.
    allowedSenders: config.allowedSenders,
    allowedDomains: config.allowedDomains,
    watchingSince: runtime.watchingSince,
    lastPollAt: runtime.lastPollAt,
    lastPollDurationMs: runtime.lastPollDurationMs,
    lastConnectedAt: runtime.lastConnectedAt,
    lastError,
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
  describeConfigurationFault,
  describeConnectionError,
  resolveConnectionState,
  resolveSenderAuthorisation,
  resolveBuyerRegisteredLocation,
  processLineItemsAndGroups,
  extractRfqReferenceFromEmail,
  resolveVendorFromEmail,
  processVendorQuoteMessage,
  processMessage,
  pollOnce,
  startPolling,
  stopPolling,
  getStatus,
  ImapFlow,
};

module.exports = emailGateway;

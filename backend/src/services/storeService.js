const {
  DATABASE_HEALTH_SERVICE_LABEL,
  INFRASTRUCTURE_HEALTH,
  SYSTEM_ACTOR_EMAIL,
  GEMINI_CONFIG,
  VENDOR_RATING_LABELS,
  CHASER_CHANNEL_LABELS,
  CHASER_OUTCOME_STATUS,
  CHASER_OUTREACH_MESSAGES,
  SUPPORT_CHAT_STATUS,
  SUPPORT_CHAT_MESSAGES,
  formatMessage,
  RFQ_DEFAULTS,
  resolveBuyerSourcingMode,
  hasUnlimitedRfqAccess,
  hasUnlimitedQuoteAccess,
  hasUnlimitedDownloadAccess,
  VENDOR_FREE_CREDITS_LIMIT,
  VENDOR_PLAN_RFQ_QUOTA,
  RFQ_DOWNLOAD_ERRORS,
  RFQ_CREATION_ERRORS,
  VENDOR_ASSIGNMENT_LIMITS,
  PERSISTENCE_MESSAGES,
  RFQ_AUTO_CLOSE_AFTER_MS,
  RFQ_AUTO_CLOSE_REASON,
  RFQ_STATE_WRITE_RETRIES,
  PERSISTED_RECORD_WRITE_RETRIES,
  RFQ_NOTIFICATION_MESSAGES,
  RFQ_NOTIFICATION_ERROR_CODES,
  EVENT_OUTBOX_TYPES,
  EMAIL_REGEX,
  MAJOR_CATEGORY_ALIASES,
  KEYWORD_TAXONOMY_MAP,
  DEFAULT_CATEGORY_TAXONOMY,
  RFQ_QUOTE_WRITE_RETRIES,
  BUYER_FREE_TRIAL_RFQ_CREDITS,
} = require('../config/constants');
const crypto = require('crypto');
const pool = require('../db/pool');
const domainQueries = require('../db/domainQueries');
const rfqInquiryQueries = require('../db/rfqInquiryQueries');
const auditLogQueries = require('../db/auditLogQueries');
const paymentActivationQueries = require('../db/paymentActivationQueries');
const identityQueries = require('../db/identityQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const { getWaitUntil } = require('../db/d1Bridge');
const { createAuditEntry, verifyAuditTrail } = require('./auditService');
const { evaluateQuotes, calculate360Evaluation, calculateRevisedRating } = require('./evaluationService');
// Called through the namespace so tests can stub the senders without rewiring
// storeService; every send is fire-and-forget and no-ops under test / when SMTP
// is unconfigured.
const mailerService = require('./mailerService');
// Real multi-channel outreach services — both are fire-and-forget and
// no-op under test (NODE_ENV === 'test') or when credentials are not
// configured, matching the same pattern mailerService uses above.
const whatsAppService = require('./whatsAppService');
const smsService = require('./smsService');
const rfqChaserScheduler = require('./rfqChaserScheduler');
const rfqIngestionService = require('./rfqIngestionService');
const purchaseOrderService = require('./purchaseOrderService');
const eventOutboxService = require('./eventOutboxService');
const eventOutboxQueries = require('../db/eventOutboxQueries');
const cryptoService = require('./cryptoService');
const { logger } = require('./loggerService');

// Bound on the vendors table read at boot hydration (see hydrateFromDB) —
// same cap the bootstrap payload already applies (MAX_BOOTSTRAP_VENDORS
// below), reused here rather than invented separately: this.vendors is one
// shared in-memory cache used by both paths, so they should stay consistent.
const MAX_HYDRATION_VENDORS = 500;

const MINOR_TO_MAJOR_MAP = new Map();
const MAJOR_TO_MINORS_MAP = new Map();

function buildTaxonomyMaps(taxonomy) {
  if (!Array.isArray(taxonomy)) return;
  for (const group of taxonomy) {
    if (!group || !group.majorCategory) continue;
    const majorCanonical = String(group.majorCategory).trim();
    const majorKey = majorCanonical.toLowerCase();
    if (!MAJOR_TO_MINORS_MAP.has(majorKey)) {
      MAJOR_TO_MINORS_MAP.set(majorKey, new Set());
    }
    const minorSet = MAJOR_TO_MINORS_MAP.get(majorKey);
    for (const minor of Array.isArray(group.minorCategories) ? group.minorCategories : []) {
      if (!minor) continue;
      const mTrimmed = String(minor).trim();
      const mKey = mTrimmed.toLowerCase();
      minorSet.add(mKey);
      if (!MINOR_TO_MAJOR_MAP.has(mKey)) {
        MINOR_TO_MAJOR_MAP.set(mKey, majorCanonical);
      }
    }
  }
}
buildTaxonomyMaps(DEFAULT_CATEGORY_TAXONOMY);

function resolveCanonicalCategory(cat) {
  if (!cat) return '';
  const trimmed = String(cat).trim();
  const lower = trimmed.toLowerCase();
  const alias = MAJOR_CATEGORY_ALIASES && MAJOR_CATEGORY_ALIASES[lower];
  if (alias) return alias;
  return trimmed;
}

function extractCategories(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((s) => String(s || '').trim()).filter(Boolean);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((s) => String(s || '').trim()).filter(Boolean);
        }
      } catch {
        // fall through
      }
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeRFQForRead(rfq) {
  const normalized = { ...rfq };
  delete normalized.vendorInvitationTargets;
  delete normalized.gatewayNotificationTarget;
  if ((normalized.poFinalised || normalized.poNumber) && normalized.status === 'Closed') {
    normalized.status = 'PO Generated';
    normalized.poFinalised = true;
  }
  if (normalized.source === 'ai_extraction' && !normalized.sourceFileName) {
    normalized.source = 'manual_entry';
  }
  return normalized;
}

/**
 * A rating or score as a finite number, or null when none was recorded. Number(null)
 * is 0, so missing and blank values are rejected before the conversion.
 */
function optionalScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Maps a send helper's result onto the outcome stored on records and in the feed.
 * A message counts as sent only when the provider accepted it. Throttled, link-only,
 * unconfigured and failed results keep their own status.
 */
function toChannelOutcome(sendResult) {
  const raw = sendResult && typeof sendResult === 'object' ? sendResult : {};
  const providerStatus = typeof raw.status === 'string' && raw.status.trim() ? raw.status.trim() : null;
  const accepted = raw.success === true || raw.sent === true;
  if (accepted && raw.throttled !== true && (providerStatus === null || providerStatus === CHASER_OUTCOME_STATUS.SENT)) {
    return { success: true, status: CHASER_OUTCOME_STATUS.SENT, messageId: raw.messageId || null, error: null };
  }
  let status = providerStatus || (raw.throttled === true ? CHASER_OUTCOME_STATUS.THROTTLED : CHASER_OUTCOME_STATUS.FAILED);
  if (status === CHASER_OUTCOME_STATUS.SENT) status = CHASER_OUTCOME_STATUS.FAILED;
  let fallbackError = CHASER_OUTREACH_MESSAGES.PROVIDER_NOT_ACCEPTED;
  if (status === CHASER_OUTCOME_STATUS.THROTTLED) fallbackError = CHASER_OUTREACH_MESSAGES.THROTTLED;
  return {
    success: false,
    status,
    messageId: null,
    error: raw.error || fallbackError,
  };
}

function newFeedItemId() {
  return `feed-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/** A recorded delivered count, or 0 when none has been recorded. */
function recordedCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** The database row shown before the first connection probe has finished. */
function buildPendingDatabaseHealthRow() {
  return {
    service: DATABASE_HEALTH_SERVICE_LABEL,
    status: INFRASTRUCTURE_HEALTH.STATUS.CHECKING,
    latency: INFRASTRUCTURE_HEALTH.EMPTY_VALUE,
    uptime: INFRASTRUCTURE_HEALTH.EMPTY_VALUE,
    details: INFRASTRUCTURE_HEALTH.MESSAGES.AWAITING_PROBE,
  };
}

class StoreService {
  constructor() {
    // Every collection starts empty and is filled from Neon by hydrateFromDB().
    //
    // Nothing here is seeded. The vendor, evaluation and catalogue seeds this
    // constructor used to inflate — five invented supplier companies with
    // contact names, phone numbers and ratings, one fabricated 360° audit, and
    // three demo SKUs — were indistinguishable from real records once loaded:
    // they appeared in the vendor master, in category dashboards and in RFQ
    // vendor selection, and the buyer had no way to tell which suppliers
    // actually existed. Buyer accounts were worse: the seed shipped four real
    // company names with invented spend and `activeBuyerAccount` was simply
    // `buyerAccounts[0]`, so whoever signed in, the dashboard attributed their
    // work to the first seeded company.
    //
    // An empty collection now means exactly that — no rows — and is reported as
    // such rather than back-filled.
    this.buyerAccounts = [];
    this.activeBuyerAccount = null;
    this.vendors = [];
    this.rfqs = [];
    this.evaluations = [];
    this.auditLogs = [];
    this.aiFeed = [];
    this.notifications = [];
    this.vendorCatalogue = [];
    this.paymentLinks = [];
    this.azureHealth = [buildPendingDatabaseHealthRow()];
    this.isHydratedFromDB = false;
    this._rfqSyncPromises = new Map();
    this._lastRfqSyncMap = new Map();
    this._lastRfqSyncTime = 0;
    this._auditWriteQueue = Promise.resolve();
  }

  reset() {
    this.buyerAccounts = [];
    this.activeBuyerAccount = null;
    this.vendors = [];
    this.rfqs = [];
    this.evaluations = [];
    this.auditLogs = [];
    this.aiFeed = [];
    this.notifications = [];
    this.vendorCatalogue = [];
    this.paymentLinks = [];
    this.azureHealth = [buildPendingDatabaseHealthRow()];
    this.isHydratedFromDB = false;
    this._rfqSyncPromises = new Map();
    this._lastRfqSyncMap = new Map();
    this._lastRfqSyncTime = 0;
    this._auditWriteQueue = Promise.resolve();
    this._pendingQuoteNotifications = new Map();
    this._rfqQuoteAckSent = new Set();
    if (this._delayedQuoteTimers) {
      this._delayedQuoteTimers.forEach((timers) => {
        if (Array.isArray(timers)) timers.forEach((t) => clearTimeout(t));
      });
      this._delayedQuoteTimers = new Map();
    }
  }

  /**
   * Load every domain collection from Neon.
   *
   * Assignment is unconditional: an empty table overwrites the in-memory copy
   * with an empty array. That is the whole point of the change — the previous
   * version applied each collection only `if (rows.length > 0)`, which meant an
   * empty table silently left the seed in place and the API then served invented
   * records while reporting itself healthy.
   *
   * `isHydratedFromDB` now reports whether the read *succeeded*, not whether it
   * happened to return rows, so a legitimately empty database is still "loaded
   * from the database" rather than being mislabelled as an in-memory fallback.
   *
   * A missing DATABASE_URL or a failed read is surfaced to the caller instead of
   * being swallowed: there is no second datastore to fall back to.
   */
  async hydrateFromDB() {
    if (!pool.hasStorage()) {
      this.isHydratedFromDB = false;
      this._setDatabaseHealthRow({
        status: INFRASTRUCTURE_HEALTH.STATUS.NOT_CONFIGURED,
        details: pool.NOT_CONFIGURED_MESSAGE,
      });
      logger.error(
        'DATABASE_URL is not set — no records can be loaded and every data-backed request will fail.',
        null,
        'STORE_SERVICE'
      );
      return { hydrated: false, source: 'not_configured', error: pool.NOT_CONFIGURED_MESSAGE };
    }

    try {
      // Bounded, not domainQueries.getVendorsFromDB() (a full unbounded
      // table read) — this runs on every Worker cold start, and D1's
      // free-tier daily row-read cap was exhausted twice by exactly this:
      // Cloudflare's edge fan-out spins up many isolates under load /
      // during a deploy, each one re-reading the entire vendors table
      // once at boot. this.vendors is already documented elsewhere
      // (getVendorByIdWithDBFallback) as "a capped, bootstrap-time
      // subset" that individual DB fallbacks paper over — hydration
      // should actually honor that instead of loading everything.
      //
      // Queries are sequenced rather than run via Promise.all so Cloudflare D1
      // is not flooded with 9 parallel table scans within the same millisecond,
      // which previously triggered D1_ERROR: D1 DB is overloaded within a 10s window.
      const vendorPage = await domainQueries.getVendorsPageFromDB({ limit: MAX_HYDRATION_VENDORS, offset: 0, skipCount: true, publicOnly: true });
      const rfqs = await domainQueries.getRFQsFromDB(null, 100);
      const evaluations = await domainQueries.getEvaluationsFromDB(100);
      const vendorCatalogue = await domainQueries.getVendorCatalogueFromDB(100);
      const buyerAccountsResult = await domainQueries.getBuyerAccountsFromDB(500);
      const aiFeed = await domainQueries.getAIFeedFromDB(100);
      const auditLogs = await domainQueries.getAuditLogsFromDB(100);
      const notifications = await domainQueries.getNotificationsFromDB(null, 100);
      const paymentLinks = await domainQueries.getPaymentLinksFromDB(100);

      this.vendors = vendorPage.rows;
      this.vendorsTotal = vendorPage.total ?? vendorPage.rows.length;
      this.rfqs = rfqs.map((rfq) => {
        return this._reconcileRFQFollowUpStats(normalizeRFQForRead(rfq));
      });
      this.evaluations = evaluations;
      this.vendorCatalogue = vendorCatalogue;
      this.notifications = notifications;
      this.paymentLinks = paymentLinks;
      this.buyerAccounts = buyerAccountsResult.accounts;
      if (Array.isArray(this.buyerAccounts)) {
        for (const a of this.buyerAccounts) {
          if (a && typeof a.totalSpend === 'string' && a.totalSpend.includes('$')) {
            a.totalSpend = a.totalSpend.replace('$', '₹');
          }
        }
      }
      // activeBuyerAccount must stay a reference into this.buyerAccounts (the
      // same invariant every mutator keeps), not a separately-hydrated duplicate.
      this.activeBuyerAccount =
        this.buyerAccounts.find((a) => a.id === buyerAccountsResult.activeId) || this.buyerAccounts[0] || null;
      this.aiFeed = aiFeed;
      this.auditLogs = auditLogs;

      this.isHydratedFromDB = true;
      // The admin infrastructure list should describe the connection this load
      // just used, not a placeholder, so it is refreshed off the same boot.
      await this.refreshInfrastructureHealth().catch((err) =>
        logger.warn('Infrastructure health probe failed after hydration', { error: err.message }, 'STORE_SERVICE')
      );
      logger.info(
        'Domain records loaded from PostgreSQL',
        {
          vendors: vendorPage.rows.length,
          vendorsTotal: vendorPage.total,
          rfqs: rfqs.length,
          evaluations: evaluations.length,
          vendorCatalogue: vendorCatalogue.length,
          buyerAccounts: this.buyerAccounts.length,
          aiFeed: aiFeed.length,
          auditLogs: auditLogs.length,
          notifications: notifications.length,
          paymentLinks: paymentLinks.length,
        },
        'STORE_SERVICE'
      );
      return { hydrated: true, source: 'postgres' };
    } catch (err) {
      logger.error('Failed to load domain records from PostgreSQL', err, 'STORE_SERVICE');
      this.isHydratedFromDB = false;
      this._setDatabaseHealthRow({
        status: INFRASTRUCTURE_HEALTH.STATUS.UNREACHABLE,
        details: err.message,
      });
      return { hydrated: false, source: 'unavailable', error: err.message };
    }
  }

  // Fire-and-forget write-through helpers — never awaited by callers, mirroring
  // the pattern already used for identity-DB writes elsewhere in this backend.
  _generateTempPassword() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(crypto.randomInt(chars.length));
    }
    return password;
  }

  /**
   * Runs a fire-and-forget persistence write, logging on failure instead of
   * propagating it to the (already-responded) caller.
   *
   * On Workers, an async call that's neither awaited nor passed to
   * ctx.waitUntil() can be cancelled the moment the HTTP response is sent —
   * confirmed live: a created RFQ's write never reached D1 at all. This
   * hands the same promise to Workers' waitUntil (imported once in
   * worker.mjs, read back via getWaitUntil()) so the write actually
   * completes after the response goes out; a plain no-op wrapper on
   * Node/Render, where the process just keeps running regardless.
   */
  _background(promise, errorMessage, metadata = {}) {
    const tracked = Promise.resolve(promise)
      .then((delivery) => {
        if (metadata.deliveryChannel === 'email') {
          if (delivery?.sent === true) {
            logger.info('Background email accepted by provider', metadata, 'STORE_SERVICE');
          } else {
            logger.error(errorMessage, {
              ...metadata,
              error: {
                code: RFQ_NOTIFICATION_ERROR_CODES.EMAIL_DELIVERY_NOT_ACCEPTED,
                message: RFQ_NOTIFICATION_MESSAGES.BACKGROUND_EMAIL_PROVIDER_NOT_ACCEPTED,
                deliveryResultPresent: Boolean(delivery),
              },
            }, 'STORE_SERVICE');
          }
        }
        return delivery;
      })
      .catch((error) => logger.error(
        errorMessage,
        Object.keys(metadata).length > 0 ? { ...metadata, error } : error,
        'STORE_SERVICE'
      ));
    const waitUntil = getWaitUntil();
    if (waitUntil) {
      try {
        waitUntil(tracked);
      } catch (error) {
        logger.error('Could not register background work with the Worker lifecycle', {
          ...metadata,
          error,
        }, 'STORE_SERVICE');
      }
    }
    return tracked;
  }

  /**
   * Starts a real provider send and writes its feed entry from the send's result.
   * The entry says "sent" only when the provider accepted the message; it never
   * reports a result before the send has settled.
   */
  _sendWithFeedOutcome(sendPromise, errorMessage, metadata, feedDetails) {
    const tracked = this._background(sendPromise, errorMessage, metadata);
    tracked
      .then((result) => this._recordChannelFeedItem(feedDetails, toChannelOutcome(result)))
      .catch((error) => logger.error('Could not record the outcome of a channel send', { error }, 'STORE_SERVICE'));
    return tracked;
  }

  /** Adds one feed entry for a channel message, using the real outcome as its status. */
  _recordChannelFeedItem({ channel, vendor, rfqNumber, buyerAccountId }, outcome) {
    const vendorName = (vendor && (vendor.name || vendor.contactPerson)) || 'Vendor';
    const values = {
      channel: CHASER_CHANNEL_LABELS[channel] || channel,
      vendorName,
      rfqNumber: rfqNumber || '',
      status: outcome.status,
      error: outcome.error || '',
    };
    return this.addAIFeedItem({
      id: newFeedItemId(),
      type: channel,
      channel,
      title: formatMessage(
        outcome.success ? CHASER_OUTREACH_MESSAGES.FEED_TITLE_SENT : CHASER_OUTREACH_MESSAGES.FEED_TITLE_NOT_SENT,
        values
      ),
      message: formatMessage(
        outcome.success ? CHASER_OUTREACH_MESSAGES.FEED_MESSAGE_SENT : CHASER_OUTREACH_MESSAGES.FEED_MESSAGE_NOT_SENT,
        values
      ),
      recipient: vendorName,
      rfqNumber: rfqNumber || null,
      buyerAccountId: buyerAccountId || null,
      status: outcome.status,
      channelDetails: { messageId: outcome.messageId || null, error: outcome.error || null },
    });
  }

  _persistVendor(vendor) {
    this._background(domainQueries.upsertVendorInDB(vendor), 'Failed to persist vendor');
  }

  /**
   * Awaits real Postgres confirmation for a just-created vendor, specifically
   * to surface a duplicate-email conflict (`vendors.email` is UNIQUE) that
   * `addVendor`'s normal fire-and-forget `_persistVendor` swallows into a log
   * line — the caller previously got a 201 for a vendor whose insert then
   * silently failed. On a real conflict, the in-memory row is rolled back so
   * the API's response matches what Postgres actually holds, and there is no
   * audit-log entry (unlike deleteVendor — this vendor was never really
   * "added" as far as the durable record is concerned).
   *
   * No-ops when no DB pool is configured, matching every other query in
   * domainQueries.js — nothing to confirm against.
   */
  async confirmVendorPersisted(vendor) {
    if (!pool.hasStorage()) return { persisted: null };
    try {
      await domainQueries.upsertVendorInDB(vendor);
      return { persisted: true };
    } catch (err) {
      const isUniqueConflict =
        (err && err.code === '23505') ||
        (err && typeof err.message === 'string' && /unique constraint/i.test(err.message)) ||
        (err && err.cause && typeof err.cause.message === 'string' && /unique constraint/i.test(err.cause.message));
      if (isUniqueConflict) {
        this.vendors = this.vendors.filter((v) => v.id !== vendor.id);
        const conflictErr = new Error(`A vendor with the email ${vendor.email} already exists.`);
        conflictErr.statusCode = 409;
        throw conflictErr;
      }
      // Any other DB failure: leave the in-memory row in place (matches the
      // existing fire-and-forget behavior elsewhere) but surface it instead
      // of reporting false success.
      logger.error('Failed to persist vendor', err, 'STORE_SERVICE');
      const persistErr = new Error('The vendor was not saved. Try again.');
      persistErr.statusCode = 500;
      throw persistErr;
    }
  }

  _removeVendor(id) {
    this._background(domainQueries.deleteVendorInDB(id), 'Failed to delete persisted vendor');
  }

  _persistPaymentLink(link) {
    this._background(domainQueries.upsertPaymentLinkInDB(link), 'Failed to persist payment link');
  }

  async confirmRfqPersisted(rfq) {
    this._lastRfqSyncTime = 0;
    if (!pool.hasStorage()) return { persisted: null };
    try {
      await domainQueries.upsertRFQInDB(rfq);
      return { persisted: true };
    } catch (err) {
      logger.error('Failed to confirm RFQ persisted in database', err, 'STORE_SERVICE');
      throw err;
    }
  }

  _persistRFQ(rfq) {
    this._lastRfqSyncTime = 0;
    this._background(domainQueries.upsertRFQInDB(rfq), 'Failed to persist RFQ');
  }

  async persistRFQDurably(rfq) {
    try {
      const storageConfigured = pool.hasStorage();
      const persistedRFQ = await domainQueries.upsertRFQInDB(rfq);
      if (storageConfigured && !persistedRFQ) {
        throw new Error('RFQ upsert completed without a persisted row');
      }
      this._lastRfqSyncTime = 0;
      return { persisted: storageConfigured ? true : null };
    } catch (error) {
      logger.error('Failed to persist RFQ mutation', error, 'STORE_SERVICE');
      const persistError = new Error('The RFQ could not be saved to storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
  }

  _removeRFQ(id) {
    this._lastRfqSyncTime = 0;
    this._background(domainQueries.deleteRFQInDB(id), 'Failed to delete persisted RFQ');
  }

  _persistEvaluation(evaluation) {
    this._background(domainQueries.upsertEvaluationInDB(evaluation), 'Failed to persist evaluation');
  }

  _persistCatalogueProduct(product) {
    this._background(domainQueries.upsertCatalogueProductInDB(product), 'Failed to persist catalogue product');
  }

  _removeCatalogueProduct(id) {
    this._background(domainQueries.deleteCatalogueProductInDB(id), 'Failed to delete persisted catalogue product');
  }

  _persistBuyerAccount(account) {
    this._background(domainQueries.upsertBuyerAccountInDB(account), 'Failed to persist buyer account');
  }

  _removeBuyerAccount(id) {
    this._background(domainQueries.deleteBuyerAccountInDB(id), 'Failed to delete persisted buyer account');
  }

  _setActiveBuyerAccount(id) {
    this._background(domainQueries.setActiveBuyerAccountInDB(id), 'Failed to persist active buyer account');
  }

  _persistAIFeedItem(item) {
    this._background(
      eventOutboxService.persistWithOutboxFallback({
        eventType: EVENT_OUTBOX_TYPES.AI_FEED,
        idempotencyKey: item.id,
        payload: item,
        operation: 'persist-ai-feed-item',
        write: () => domainQueries.upsertAIFeedItemInDB(item),
      }),
      'Failed to persist AI feed item or schedule its retry'
    );
  }

  _persistAuditLog(entry) {
    const write = this._queueAuditLogPersistence(entry).catch((error) => {
      this.auditLogs = this.auditLogs.filter((candidate) => candidate.id !== entry.id);
      throw error;
    });
    this._background(write, 'Failed to persist audit log entry');
  }

  _queueAuditLogPersistence(entry) {
    const pendingWrite = this._auditWriteQueue.then(async () => {
      const requestedPreviousHash = entry.previousHash || '';
      const persisted = await auditLogQueries.appendAuditLogInDB(entry);
      if (pool.hasStorage() && !persisted) {
        throw new Error('Audit-chain append completed without a persisted row');
      }
      if (persisted) Object.assign(entry, persisted);

      const existingIndex = this.auditLogs.findIndex((candidate) => candidate.id === entry.id);
      if (existingIndex === -1) this.auditLogs.unshift(entry);
      else this.auditLogs[existingIndex] = entry;

      if (persisted && (persisted.previousHash || '') !== requestedPreviousHash) {
        try {
          const persistedLogs = await domainQueries.getAuditLogsFromDB(500, { fresh: true });
          const persistedIds = new Set(persistedLogs.map((candidate) => candidate.id));
          const notYetPersisted = this.auditLogs.filter((candidate) => !persistedIds.has(candidate.id));
          this.auditLogs = [...notYetPersisted, ...persistedLogs].slice(0, 500);
        } catch (error) {
          logger.error('Audit log was saved but the local chain cache could not be refreshed', {
            error,
            entryId: entry.id,
          }, 'STORE_SERVICE');
        }
      }

      logger.audit(
        entry.action,
        entry.userEmail || SYSTEM_ACTOR_EMAIL,
        { rfqNumber: entry.rfqNumber, ipAddress: entry.ipAddress, shaSignature: entry.shaSignature },
        entry.rfqNumber
      );
      return entry;
    });
    this._auditWriteQueue = pendingWrite.catch(() => undefined);
    return pendingWrite;
  }

  _persistNotification(notification) {
    this._background(
      eventOutboxService.persistWithOutboxFallback({
        eventType: EVENT_OUTBOX_TYPES.NOTIFICATION,
        idempotencyKey: notification.id,
        payload: notification,
        operation: 'persist-notification',
        write: () => domainQueries.insertNotificationInDB(notification),
      }),
      'Failed to persist notification or schedule its retry'
    );
  }

  _persistNotificationBatch(notifications) {
    if (!Array.isArray(notifications) || notifications.length === 0) return;
    const idempotencyKey = JSON.stringify(notifications.map((notification) => notification.id).sort());
    this._background(
      eventOutboxService.persistWithOutboxFallback({
        eventType: EVENT_OUTBOX_TYPES.NOTIFICATION_BATCH,
        idempotencyKey,
        payload: notifications,
        operation: 'persist-notification-batch',
        write: () => domainQueries.bulkInsertNotificationsInDB(notifications),
      }),
      'Failed to persist notification batch or schedule its retry'
    );
  }

  // ==========================================
  // 1. BUYER ACCOUNTS
  // ==========================================
  getBuyerAccounts(limit = null) {
    if (Number.isInteger(Number(limit)) && Number(limit) > 0) {
      return (this.buyerAccounts || []).slice(0, Math.min(Number(limit), 500));
    }
    return (this.buyerAccounts || []).slice(0, 500);
  }

  async syncBuyerAccountsFromDB(limit = 500) {
    if (!pool.hasStorage()) return this.buyerAccounts;
    try {
      const res = await domainQueries.getBuyerAccountsFromDB(limit);
      if (res && Array.isArray(res.accounts)) {
        this.buyerAccounts = res.accounts;
        if (res.activeId) {
          this.activeBuyerAccount = this.buyerAccounts.find((a) => a.id === res.activeId) || this.buyerAccounts[0] || null;
        } else if (!this.activeBuyerAccount && this.buyerAccounts.length > 0) {
          this.activeBuyerAccount = this.buyerAccounts[0];
        }
      }
    } catch (err) {
      logger.warn('Failed to sync buyer accounts from DB', { error: err.message }, 'STORE_SERVICE');
    }
    return this.buyerAccounts;
  }

  getActiveBuyerAccount() {
    return this.activeBuyerAccount;
  }

  /**
   * Resolves a buyer account by its login email, case-insensitively — reads
   * straight from Postgres on every call rather than the in-memory
   * `buyerAccounts` cache, so a plan/role change made by another process (a
   * one-off script, another running instance) is visible immediately instead
   * of only after this process restarts and re-hydrates.
   *
   * Falls back to the in-memory cache when no database is configured
   * (`pool.pool` unset — the same guard every other DB-backed read in this
   * file uses, and how the test suite runs: `jest.setup.js` blanks
   * `DATABASE_URL` so tests never touch the real, shared Neon database).
   *
   * The in-memory cache entry is refreshed as a side effect so the handful of
   * other in-process paths that still iterate `this.buyerAccounts` directly
   * (e.g. `getBuyerAccounts()`) stay consistent with what was just read.
   */
  async getBuyerAccountByEmail(email) {
    if (!email) return null;
    const target = email.toLowerCase();

    if (pool.hasStorage()) {
      try {
        const fresh = await domainQueries.getBuyerAccountByEmailFromDB(email);
        if (fresh) {
          const idx = this.buyerAccounts.findIndex((a) => a.id === fresh.id);
          if (idx === -1) {
            this.buyerAccounts.unshift(fresh);
          } else {
            this.buyerAccounts[idx] = fresh;
          }
          if (this.activeBuyerAccount && this.activeBuyerAccount.id === fresh.id) {
            this.activeBuyerAccount = fresh;
          }
          return fresh;
        }
        return null;
      } catch (error) {
        logger.error('Buyer account database lookup failed; refusing to use stale in-memory identity data', {
          error,
          operation: 'get-buyer-account-by-email',
        }, 'STORE_SERVICE');
        const unavailable = new Error('Buyer account storage is temporarily unavailable.');
        unavailable.code = 'PERSISTENCE_UNAVAILABLE';
        unavailable.status = 503;
        unavailable.statusCode = 503;
        unavailable.cause = error;
        throw unavailable;
      }
    }

    return this.buyerAccounts.find((a) => (a.corporateEmail || '').toLowerCase() === target) || null;
  }

  /**
   * The signed-in buyer's account, created on first use when none exists.
   *
   * A buyer inserted straight into the identity `user` table (bulk import,
   * manual DB insert) can sign in but never went through the app's
   * POST /api/buyer-accounts step, so getBuyerAccountByEmail found nothing:
   * their RFQs were saved with no buyerAccountId and the scoped list always
   * came back empty. The id is the user's own uuid (`sub`) — stable, so a
   * racing second request upserts the same row instead of a duplicate, and
   * the same value the vendor/bootstrap paths already fall back to for an
   * account-less buyer, so vendors they uploaded before still match.
   */
  async ensureBuyerAccountForUser(user) {
    if (!user || user.role !== 'buyer' || !user.email) return null;
    let existing = await this.getBuyerAccountByEmail(user.email);
    const id = user.sub || user.id;

    if (!existing && id && pool.hasStorage()) {
      existing = await domainQueries.getBuyerAccountByIdFromDB(id, { fresh: true });
      if (existing) {
        const existingIndex = this.buyerAccounts.findIndex((account) => account.id === existing.id);
        if (existingIndex >= 0) this.buyerAccounts[existingIndex] = existing;
        else this.buyerAccounts.unshift(existing);
      }
    } else if (!existing && id) {
      existing = this.buyerAccounts.find((a) => a.id === id) || null;
    }

    let profile = null;
    try {
      const lookup = await buyerProfileQueries.findProfileByIdentifier({
        email: user.email,
        userId: id,
        organizationId: user.orgId,
      });
      if (lookup && lookup.found) profile = lookup.profile;
    } catch (error) {
      logger.warn('Buyer profile lookup failed; account enrichment will use the existing account values', {
        error,
        operation: 'ensure-buyer-account-profile-enrichment',
        userId: id || null,
      }, 'STORE_SERVICE');
    }

    if (existing) {
      if (profile && (!existing.gstin || !existing.mobileNumber || !existing.city)) {
        const enriched = {
          ...existing,
          organizationName: profile.companyName || existing.organizationName,
          brandName: profile.brandName || existing.brandName,
          organizationType: profile.organizationType || existing.organizationType,
          contactPerson: profile.contactName || existing.contactPerson,
          contactDesignation: profile.contactDesignation || existing.contactDesignation,
          mobileNumber: profile.contactPhone || existing.mobileNumber,
          corporateEmail: profile.contactEmail || existing.corporateEmail,
          gstin: profile.gstNumber || existing.gstin,
          pan: profile.panNumber || existing.pan,
          cinNumber: profile.cinNumber || existing.cinNumber,
          website: profile.website || existing.website,
          street: profile.street || existing.street,
          city: profile.city || existing.city,
          state: profile.state || existing.state,
          pincode: profile.pincode || existing.pincode,
          country: profile.country || existing.country,
          categories: profile.categories || existing.categories,
        };
        const saved = await this.updateBuyerAccountDurably(existing.id, enriched);
        if (!saved && pool.hasStorage()) {
          throw new Error('Buyer profile enrichment did not find a durable account row.');
        }
        return saved || enriched;
      }
      return existing;
    }

    if (!id) return null;
    if (!pool.hasStorage()) {
      const cached = this.buyerAccounts.find((a) => a.id === id);
      if (cached) return cached;
    }

    logger.info('Auto-creating missing buyer account', { id, email: user.email }, 'STORE_SERVICE');
    return this.addBuyerAccountDurably({
      id,
      organizationName: profile?.companyName || user.orgName || user.email,
      brandName: profile?.brandName || '',
      organizationType: profile?.organizationType || null,
      corporateEmail: profile?.contactEmail || user.email.toLowerCase(),
      contactPerson: profile?.contactName || user.name || '',
      contactDesignation: profile?.contactDesignation || null,
      mobileNumber: profile?.contactPhone || user.phone || '',
      organizationId: user.orgId || profile?.organizationId || null,
      gstin: profile?.gstNumber || '',
      pan: profile?.panNumber || '',
      cinNumber: profile?.cinNumber || '',
      website: profile?.website || '',
      street: profile?.street || '',
      city: profile?.city || '',
      state: profile?.state || '',
      pincode: profile?.pincode || '',
      country: profile?.country || 'India',
      categories: profile?.categories || [],
    });
  }

  /**
   * The signed-in vendor's profile, created on first use when none exists.
   *
   * Vendors migrated straight into the identity `user` table (e.g.
   * mumbai@japl.org) can sign in but have no `vendors` row, so every
   * vendor-scoped lookup resolved to null and the RFQ list, credits and quote
   * submission all came back empty. The profile is built from the identity
   * record with no category, which existing visibility rules treat as "show
   * all V0/V2/V3 RFQs" until the vendor sets one on their profile. No login is
   * provisioned and no onboarding email is sent: the account already exists.
   * Concurrent calls in one isolate share a single creation; a cross-isolate
   * race loses on vendors.email UNIQUE and re-reads the winner's row.
   */
  async ensureVendorProfileForUser(user) {
    if (!user || user.role !== 'vendor' || !user.email) return null;
    const email = String(user.email).trim().toLowerCase();
    const existing = pool.hasStorage()
      ? await this.getVendorByIdWithDBFallback(email, 'all', { fresh: true })
      : this.getVendorById(user.email, 'all');
    if (existing) return existing;

    if (!this._pendingVendorProfiles) this._pendingVendorProfiles = new Map();
    const pending = this._pendingVendorProfiles.get(email);
    if (pending) return pending;

    const task = this._createVendorProfileFromIdentity(user, email).finally(() => {
      this._pendingVendorProfiles.delete(email);
    });
    this._pendingVendorProfiles.set(email, task);
    return task;
  }

  async _createVendorProfileFromIdentity(user, email) {
    let identity = null;
    try {
      identity = await identityQueries.findUserByEmail(email);
    } catch (err) {
      logger.warn('Could not read identity record for vendor profile', { email, error: err.message }, 'STORE_SERVICE');
    }

    const contactName = (identity && identity.name) || user.name || '';
    try {
      const created = await this.addVendorDurably(
        {
          name: (identity && identity.orgName) || user.orgName || contactName || email,
          contactPerson: contactName,
          email,
          phone: (identity && identity.mobile) || '',
          source: 'migrated_identity',
          onboardingEmailStatus: 'account_exists',
          status: 'PENDING EVALUATION',
          subscriptionPlan: 'premium',
          freeQuotationCredits: VENDOR_FREE_CREDITS_LIMIT,
          majorCategory: '',
          minorCategories: [],
          vendorSelectedCategories: [],
          clientMappedCategories: [],
          isCategoryAligned: false,
          country: 'India',
        },
        email,
        null
      );
      logger.info('Auto-created missing vendor profile', { id: created.id, email }, 'STORE_SERVICE');
      return created;
    } catch (err) {
      if (err.statusCode === 409) {
        return (await domainQueries.getVendorByEmailFromDB(email, { fresh: true })) || null;
      }
      logger.error('Failed to auto-create vendor profile', err, 'STORE_SERVICE');
      return null;
    }
  }

  /**
   * Hand an auto-created migrated profile (see ensureVendorProfileForUser) to
   * whoever adds that vendor next — a buyer, CM, admin or bulk import —
   * instead of rejecting the add as a duplicate. Without this, a migrated
   * vendor who signed in before their buyer added them could never be linked
   * to that buyer. Only an unowned `migrated_identity` profile whose email
   * matches exactly is claimable; anything else returns null so the caller
   * keeps its normal duplicate handling. The vendor's own usage (credits,
   * quoted/unlocked RFQs, plan) is preserved; no login or email is issued.
   */
  async claimMigratedVendorProfile(email, details, buyerId = null, actorEmail = null) {
    if (!email) return null;
    const normalized = String(email).trim().toLowerCase();
    const existing = await this.getVendorByIdWithDBFallback(normalized, 'all', { fresh: true });
    if (
      !existing ||
      existing.source !== 'migrated_identity' ||
      existing.buyerId ||
      existing.buyerAccountId ||
      String(existing.email || '').toLowerCase() !== normalized
    ) {
      return null;
    }

    const {
      id: _id,
      email: _email,
      quotedRfqIds: _quoted,
      unlockedRfqIds: _unlocked,
      rfqDownloadsUsed: _downloads,
      freeQuotationCredits: _credits,
      subscriptionPlan: _plan,
      onboardingEmailStatus: _onboarding,
      createdAt: _createdAt,
      created_at: _createdAtRaw,
      ...claimable
    } = details || {};
    const updates = {
      ...claimable,
      buyerId: buyerId || null,
      buyerAccountId: buyerId || null,
      source: claimable.source || (buyerId || claimable.addedByBuyerCompany ? 'buyer_manual' : 'procucev_network'),
      isCategoryAligned: claimable.isCategoryAligned !== undefined ? claimable.isCategoryAligned : true,
      onboardingEmailStatus: 'account_exists',
    };

    const savedVendor = await this.updateVendorDurably(existing.id, updates);
    if (!savedVendor) return null;
    this.addAuditLog({
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Linked migrated vendor ${savedVendor.name} (${savedVendor.email}) in category ${savedVendor.majorCategory}`,
    });
    return savedVendor;
  }

  _buildBuyerAccountRecord(accData) {
    const newAcc = {
      ...accData,
      id: accData.id || `buyer-acc-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      totalRFQsCreated: accData.totalRFQsCreated || 0,
      totalSpend: accData.totalSpend ? String(accData.totalSpend).replace('$', '₹') : '₹0',
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      createdDate: accData.createdDate || new Date().toISOString().substring(0, 10),
      status: accData.status || 'ACTIVE_VERIFIED',
      sourcingMode: accData.sourcingMode || 'mode_1',
      subscriptionPlan: accData.subscriptionPlan || 'free_trial',
      remainingFreeRFQs: accData.remainingFreeRFQs !== undefined ? accData.remainingFreeRFQs : BUYER_FREE_TRIAL_RFQ_CREDITS,
    };
    return newAcc;
  }

  addBuyerAccount(accData) {
    const newAcc = this._buildBuyerAccountRecord(accData);
    this.buyerAccounts.unshift(newAcc);
    this._persistBuyerAccount(newAcc);
    this.addAuditLog({
      userEmail: newAcc.corporateEmail,
      action: `Created buyer account for ${newAcc.organizationName} (${newAcc.corporateEmail})`,
    });

    return newAcc;
  }

  async addBuyerAccountDurably(accData) {
    const newAcc = this._buildBuyerAccountRecord(accData);
    const storageConfigured = pool.hasStorage();
    let persisted;

    try {
      persisted = await domainQueries.upsertBuyerAccountInDB(newAcc);
      if (storageConfigured && !persisted) {
        throw new Error('Buyer account upsert completed without a persisted row');
      }
    } catch (error) {
      logger.error('Failed to persist buyer account creation', error, 'STORE_SERVICE');
      const isUniqueConflict =
        (error && error.code === '23505') ||
        (error && typeof error.message === 'string' && /unique constraint/i.test(error.message));
      const persistError = new Error(
        isUniqueConflict
          ? `A buyer account with the email ${newAcc.corporateEmail} already exists.`
          : 'The buyer account could not be saved to storage. Try again.'
      );
      persistError.statusCode = isUniqueConflict ? 409 : 503;
      persistError.code = isUniqueConflict ? 'BUYER_EMAIL_CONFLICT' : 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }

    const savedAccount = persisted || newAcc;
    this.buyerAccounts.unshift(savedAccount);
    this.addAuditLog({
      userEmail: savedAccount.corporateEmail,
      action: `Created buyer account for ${savedAccount.organizationName} (${savedAccount.corporateEmail})`,
    });
    return savedAccount;
  }

  updateBuyerAccount(idOrEmail, updates, { persist = true } = {}) {
    const key = String(idOrEmail || '').trim().toLowerCase();
    const idx = this.buyerAccounts.findIndex(
      (a) => a.id === idOrEmail || (a.corporateEmail && a.corporateEmail.toLowerCase() === key)
    );
    if (idx === -1) return null;

    const updated = {
      ...this.buyerAccounts[idx],
      ...updates,
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
    };
    this.buyerAccounts[idx] = updated;
    if (persist) this._persistBuyerAccount(updated);

    if (this.activeBuyerAccount && this.activeBuyerAccount.id === updated.id) {
      this.activeBuyerAccount = updated;
    }

    return updated;
  }

  async updateBuyerAccountDurably(idOrEmail, updates) {
    const key = String(idOrEmail || '').trim().toLowerCase();
    let idx = this.buyerAccounts.findIndex(
      (account) => account.id === idOrEmail || (account.corporateEmail && account.corporateEmail.toLowerCase() === key)
    );
    const storageConfigured = pool.hasStorage();
    let updated;
    let savedAccount;

    try {
      if (storageConfigured) {
        const snapshotReader = String(idOrEmail || '').includes('@')
          ? domainQueries.getBuyerAccountSnapshotByEmailFromDB
          : domainQueries.getBuyerAccountSnapshotByIdFromDB;
        let snapshot = await snapshotReader(idOrEmail);
        if (!snapshot) return null;

        for (let attempt = 0; attempt < PERSISTED_RECORD_WRITE_RETRIES; attempt += 1) {
          updated = {
            ...snapshot.account,
            ...updates,
            syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
          };
          savedAccount = await domainQueries.updateBuyerAccountIfUnchangedInDB(snapshot, updated);
          if (savedAccount) break;
          snapshot = await domainQueries.getBuyerAccountSnapshotByIdFromDB(snapshot.id);
          if (!snapshot) return null;
        }
        if (!savedAccount) throw new Error('Buyer account changed repeatedly while saving; retry the update.');
      } else {
        const previous = idx >= 0 ? this.buyerAccounts[idx] : null;
        if (!previous) return null;
        updated = {
          ...previous,
          ...updates,
          syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
        };
        savedAccount = updated;
      }
      idx = this.buyerAccounts.findIndex((account) => account.id === savedAccount.id);
      if (idx >= 0) this.buyerAccounts[idx] = savedAccount;
      else this.buyerAccounts.unshift(savedAccount);
      if (this.activeBuyerAccount && this.activeBuyerAccount.id === savedAccount.id) {
        this.activeBuyerAccount = savedAccount;
      }
      return savedAccount;
    } catch (error) {
      logger.error('Failed to persist buyer account update', error, 'STORE_SERVICE');
      const isUniqueConflict =
        (error && error.code === '23505') ||
        (error && typeof error.message === 'string' && /unique constraint/i.test(error.message)) ||
        (error && error.cause && typeof error.cause.message === 'string' && /unique constraint/i.test(error.cause.message));
      const persistError = new Error(
        isUniqueConflict
          ? `A buyer account with the email ${updated?.corporateEmail || idOrEmail} already exists.`
          : 'The buyer account could not be updated in storage. Try again.'
      );
      persistError.statusCode = isUniqueConflict ? 409 : 503;
      persistError.code = isUniqueConflict ? 'BUYER_EMAIL_CONFLICT' : 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
  }

  async addBuyerCreditsDurably(id, amount, transaction) {
    const accountIndex = this.buyerAccounts.findIndex((account) => account.id === id);
    const storageConfigured = pool.hasStorage();
    if (!storageConfigured) {
      if (accountIndex === -1) return null;
      const currentAccount = this.buyerAccounts[accountIndex];
      const previousBalance = Number(currentAccount.remainingFreeRFQs ?? BUYER_FREE_TRIAL_RFQ_CREDITS);
      const updatedBalance = previousBalance + amount;
      const updatedAccount = {
        ...currentAccount,
        remainingFreeRFQs: updatedBalance,
        syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      };
      this.buyerAccounts[accountIndex] = updatedAccount;
      if (this.activeBuyerAccount?.id === id) this.activeBuyerAccount = updatedAccount;
      return {
        account: updatedAccount,
        previousBalance,
        updatedBalance,
        transaction: { ...transaction, previousBalance, updatedBalance },
        replayed: false,
      };
    }

    try {
      const saved = await domainQueries.addBuyerCreditsInDB({ buyerId: id, amount, transaction });
      if (!saved?.account) throw new Error('Atomic buyer credit adjustment returned no account row');
      const currentIndex = this.buyerAccounts.findIndex((account) => account.id === id);
      if (currentIndex === -1) {
        this.buyerAccounts.unshift(saved.account);
      } else {
        this.buyerAccounts[currentIndex] = saved.account;
      }
      if (this.activeBuyerAccount?.id === id) this.activeBuyerAccount = saved.account;
      return saved;
    } catch (error) {
      logger.error('Failed to add buyer credits durably', error, 'STORE_SERVICE');
      const persistError = new Error(error.message || 'Buyer credits could not be saved. Try again.');
      persistError.statusCode = error.statusCode || 503;
      persistError.code = error.code || 'PERSISTENCE_UNAVAILABLE';
      persistError.retryable = persistError.statusCode >= 500;
      throw persistError;
    }
  }

  deleteBuyerAccount(id) {
    const beforeLen = this.buyerAccounts.length;
    this.buyerAccounts = this.buyerAccounts.filter((a) => a.id !== id);
    if (this.buyerAccounts.length < beforeLen) {
      this._removeBuyerAccount(id);
      if (this.activeBuyerAccount && this.activeBuyerAccount.id === id) {
        this.activeBuyerAccount = this.buyerAccounts[0] || null;
        if (this.activeBuyerAccount) this._setActiveBuyerAccount(this.activeBuyerAccount.id);
      }
      return true;
    }
    return false;
  }

  async deleteBuyerAccountDurably(id) {
    const storageConfigured = pool.hasStorage();
    const deletedAccount = this.buyerAccounts.find((account) => account.id === id) || null;
    try {
      let deletion;
      if (storageConfigured) {
        deletion = await domainQueries.deleteBuyerAccountAndPromoteActiveInDB(id);
        if (!deletion || !deletion.deleted) return false;
      } else {
        if (!deletedAccount) return false;
        deletion = {
          deleted: true,
          activeAccount: this.activeBuyerAccount && this.activeBuyerAccount.id !== id
            ? this.activeBuyerAccount
            : null,
        };
      }

      this.buyerAccounts = this.buyerAccounts.filter((account) => account.id !== id);
      if (!storageConfigured && this.activeBuyerAccount?.id === id) {
        deletion.activeAccount = this.buyerAccounts[0] || null;
      }
      if (deletion.activeAccount) {
        const activeIndex = this.buyerAccounts.findIndex((account) => account.id === deletion.activeAccount.id);
        if (activeIndex === -1) {
          this.buyerAccounts.unshift(deletion.activeAccount);
          this.activeBuyerAccount = this.buyerAccounts[0];
        } else {
          this.buyerAccounts[activeIndex] = deletion.activeAccount;
          this.activeBuyerAccount = this.buyerAccounts[activeIndex];
        }
      } else {
        this.activeBuyerAccount = null;
      }

      if (deletedAccount) {
        this.addAuditLog({
          userEmail: deletedAccount.corporateEmail || SYSTEM_ACTOR_EMAIL,
          action: `Deleted buyer account for ${deletedAccount.organizationName || id}`,
        });
      }
      return {
        deleted: true,
        activeAccount: this.activeBuyerAccount,
      };
    } catch (error) {
      logger.error('Failed to durably delete buyer account and reconcile active account', error, 'STORE_SERVICE');
      const persistError = new Error('The buyer account could not be deleted from storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      persistError.retryable = true;
      throw persistError;
    }
  }

  alignActiveBuyerAccount(id) {
    const target = this.buyerAccounts.find((a) => a.id === id);
    if (!target) return null;
    this.activeBuyerAccount = target;
    this._setActiveBuyerAccount(id);
    return target;
  }

  async alignActiveBuyerAccountDurably(id) {
    const storageConfigured = pool.hasStorage();
    try {
      const persisted = storageConfigured
        ? await domainQueries.setActiveBuyerAccountDurablyInDB(id)
        : this.buyerAccounts.find((account) => account.id === id) || null;
      if (!persisted) return null;

      const activeIndex = this.buyerAccounts.findIndex((account) => account.id === id);
      if (activeIndex === -1) {
        this.buyerAccounts.unshift(persisted);
        this.activeBuyerAccount = this.buyerAccounts[0];
      } else {
        this.buyerAccounts[activeIndex] = persisted;
        this.activeBuyerAccount = this.buyerAccounts[activeIndex];
      }
      return this.activeBuyerAccount;
    } catch (error) {
      logger.error('Failed to durably set active buyer account', error, 'STORE_SERVICE');
      const persistError = new Error('The active buyer account could not be saved. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      persistError.retryable = true;
      throw persistError;
    }
  }

  /**
   * Atomically check and consume one free trial RFQ slot for a buyer account.
   * Eliminates race conditions from concurrent RFQ creation requests.
   */
  tryConsumeFreeRFQ(idOrAccount) {
    const candidateId = typeof idOrAccount === 'object' && idOrAccount !== null ? idOrAccount.id : idOrAccount;
    const candidateEmail = typeof idOrAccount === 'object' && idOrAccount !== null
      ? (idOrAccount.corporateEmail || idOrAccount.email)
      : (typeof idOrAccount === 'string' && idOrAccount.includes('@') ? idOrAccount : null);
    const key = candidateEmail ? candidateEmail.trim().toLowerCase() : '';

    const idx = this.buyerAccounts.findIndex((a) => {
      if (candidateId && (a.id === candidateId || a.organizationId === candidateId || a.userId === candidateId)) return true;
      if (key && a.corporateEmail && a.corporateEmail.trim().toLowerCase() === key) return true;
      return false;
    });

    if (idx === -1) {
      if (typeof idOrAccount === 'object' && idOrAccount !== null) {
        if (hasUnlimitedRfqAccess(idOrAccount)) {
          return { ok: true, remaining: idOrAccount.remainingFreeRFQs !== undefined ? idOrAccount.remainingFreeRFQs : 999999 };
        }
        const remaining = idOrAccount.remainingFreeRFQs !== undefined ? idOrAccount.remainingFreeRFQs : BUYER_FREE_TRIAL_RFQ_CREDITS;
        if (remaining <= 0) {
          return { ok: false, remaining: 0 };
        }
        const updated = {
          ...idOrAccount,
          remainingFreeRFQs: remaining - 1,
          freeRFQsUsed: (idOrAccount.freeRFQsUsed || (BUYER_FREE_TRIAL_RFQ_CREDITS - remaining)) + 1,
          syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
        };
        this.buyerAccounts.unshift(updated);
        this._persistBuyerAccount(updated);
        if (this.activeBuyerAccount && (this.activeBuyerAccount.id === updated.id || (key && this.activeBuyerAccount.corporateEmail?.toLowerCase() === key))) {
          this.activeBuyerAccount = updated;
        }
        idOrAccount.remainingFreeRFQs = updated.remainingFreeRFQs;
        idOrAccount.freeRFQsUsed = updated.freeRFQsUsed;
        return { ok: true, remaining: updated.remainingFreeRFQs };
      }
      return { ok: false, remaining: 0 };
    }

    const buyer = this.buyerAccounts[idx];
    if (hasUnlimitedRfqAccess(buyer)) {
      return { ok: true, remaining: buyer.remainingFreeRFQs !== undefined ? buyer.remainingFreeRFQs : 999999 };
    }
    const remaining = buyer.remainingFreeRFQs !== undefined ? buyer.remainingFreeRFQs : BUYER_FREE_TRIAL_RFQ_CREDITS;
    if (remaining <= 0) {
      return { ok: false, remaining: 0 };
    }
    const updated = {
      ...buyer,
      remainingFreeRFQs: remaining - 1,
      freeRFQsUsed: (buyer.freeRFQsUsed || (BUYER_FREE_TRIAL_RFQ_CREDITS - remaining)) + 1,
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
    };
    buyer.remainingFreeRFQs = updated.remainingFreeRFQs;
    buyer.freeRFQsUsed = updated.freeRFQsUsed;
    this.buyerAccounts[idx] = updated;
    this._persistBuyerAccount(updated);
    if (this.activeBuyerAccount && (this.activeBuyerAccount.id === buyer.id || (key && this.activeBuyerAccount.corporateEmail?.toLowerCase() === key))) {
      this.activeBuyerAccount = updated;
    }
    if (typeof idOrAccount === 'object' && idOrAccount !== null) {
      idOrAccount.remainingFreeRFQs = updated.remainingFreeRFQs;
      idOrAccount.freeRFQsUsed = updated.freeRFQsUsed;
    }
    return { ok: true, remaining: updated.remainingFreeRFQs };
  }

  /**
   * Refund a reserved free trial RFQ slot if RFQ creation fails downstream.
   */
  refundFreeRFQ(idOrAccount) {
    const candidateId = typeof idOrAccount === 'object' && idOrAccount !== null ? idOrAccount.id : idOrAccount;
    const candidateEmail = typeof idOrAccount === 'object' && idOrAccount !== null
      ? (idOrAccount.corporateEmail || idOrAccount.email)
      : (typeof idOrAccount === 'string' && idOrAccount.includes('@') ? idOrAccount : null);
    const key = candidateEmail ? candidateEmail.trim().toLowerCase() : '';

    const idx = this.buyerAccounts.findIndex((a) => {
      if (candidateId && (a.id === candidateId || a.organizationId === candidateId || a.userId === candidateId)) return true;
      if (key && a.corporateEmail && a.corporateEmail.trim().toLowerCase() === key) return true;
      return false;
    });
    if (idx === -1) return;
    const buyer = this.buyerAccounts[idx];
    if (hasUnlimitedRfqAccess(buyer)) return;
    const current = buyer.remainingFreeRFQs !== undefined ? buyer.remainingFreeRFQs : 0;
    const updated = {
      ...buyer,
      remainingFreeRFQs: Math.min(BUYER_FREE_TRIAL_RFQ_CREDITS, current + 1),
      freeRFQsUsed: Math.max(0, (buyer.freeRFQsUsed || (BUYER_FREE_TRIAL_RFQ_CREDITS - current)) - 1),
      syncTimestamp: new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
    };
    this.buyerAccounts[idx] = updated;
    this._persistBuyerAccount(updated);
    if (this.activeBuyerAccount && (this.activeBuyerAccount.id === buyer.id || (key && this.activeBuyerAccount.corporateEmail?.toLowerCase() === key))) {
      this.activeBuyerAccount = updated;
    }
    if (typeof idOrAccount === 'object' && idOrAccount !== null) {
      idOrAccount.remainingFreeRFQs = updated.remainingFreeRFQs;
      idOrAccount.freeRFQsUsed = updated.freeRFQsUsed;
    }
  }

  /**
   * True when a sourcing mode is V0 (Free Starter), which never consumes a
   * sourcing credit. Accepts every alias the codebase uses for V0.
   */
  isV0SourcingMode(mode) {
    return mode === 'mode_0' || mode === 'v0' || mode === 'version_0';
  }

  /**
   * Apply the sourcing-credit rule for a single RFQ creation, regardless of
   * how the RFQ was raised (portal, AI wizard, or inbound email gateway).
   *
   * The rule — identical to the one the portal createRFQ controller enforces:
   *   • V0 (Free Starter) RFQs consume 0 credits, always allowed.
   *   • V1/V2/V3 RFQs on the `free_trial` plan consume 1 of the 5 free credits.
   *   • V1/V2/V3 RFQs on a paid plan (version_1/2/3) consume 0 (quota is by mode).
   *   • An account with no buyer record (admin/CM-raised) consumes nothing.
   *   • Unlimited RFQ accounts consume 0 credits across all modes.
   *
   * Email-ingested RFQs previously bypassed this entirely by calling createRFQ
   * directly, so a buyer's sourcing-credit count under-reported every RFQ that
   * arrived by email. Routing both paths through here keeps the count correct
   * across all creation methods.
   *
   * @returns {{ consumed: boolean, remaining: number|null }} whether a credit
   *   was deducted and the buyer's remaining free credits (null when no buyer).
   */
  consumeRFQCreditIfApplicable(buyerAccount, sourcingMode) {
    if (!buyerAccount) return { consumed: false, remaining: null };
    const hasId = Boolean(buyerAccount.id || buyerAccount.organizationId || buyerAccount.userId);
    const hasEmail = Boolean(buyerAccount.corporateEmail || buyerAccount.email);
    if (!hasId && !hasEmail) return { consumed: false, remaining: null };

    // Database-level unlimited RFQ access bypasses credit deductions
    if (hasUnlimitedRfqAccess(buyerAccount)) {
      const current =
        buyerAccount.remainingFreeRFQs !== undefined ? buyerAccount.remainingFreeRFQs : null;
      return { consumed: false, remaining: current };
    }

    const plan = buyerAccount.subscriptionPlan || 'free_trial';
    const isPaidPlan = plan === 'version_1' || plan === 'version_2' || plan === 'version_3' || plan === 'unlimited';

    // V0 and paid plans never draw down the free-trial credit pool.
    if (this.isV0SourcingMode(sourcingMode) || isPaidPlan) {
      const current =
        buyerAccount.remainingFreeRFQs !== undefined ? buyerAccount.remainingFreeRFQs : null;
      return { consumed: false, remaining: current };
    }

    const result = this.tryConsumeFreeRFQ(buyerAccount);
    if (result.ok && buyerAccount) {
      buyerAccount.remainingFreeRFQs = result.remaining;
      buyerAccount.freeRFQsUsed = Math.max(0, 5 - result.remaining);
    }
    return { consumed: result.ok, remaining: result.remaining };
  }

  // ==========================================
  // 2. VENDORS
  // ==========================================
  /**
   * Re-syncs `this.vendors` from Neon before reading. A vendor row written by
   * a different process instance (another backend deploy, or a bulk import
   * that ran against a process other than the one serving this request)
   * would otherwise be invisible forever — the in-memory cache only reflects
   * what this specific process happened to load at boot or write itself.
   * Same pattern as getPaymentLinksForVendor/getPaymentLinksForBuyer.
   */
  async getVendors(scopedBuyerId = null, limit = null) {
    if (pool.hasStorage()) {
      const allFromDB = await domainQueries.getVendorsFromDB(limit);
      const byId = new Map(this.vendors.map((v) => [v.id, v]));
      for (const vendor of allFromDB) byId.set(vendor.id, vendor);
      this.vendors = Array.from(byId.values());
    }
    let list = this.vendors;
    if (scopedBuyerId !== 'all') {
      list = list.filter((v) => {
        // Platform / network vendors with no buyerId are public
        if (!v.buyerId && !v.buyerAccountId) {
          return true;
        }
        // Buyer-uploaded vendors are only visible if scopedBuyerId matches
        if (!scopedBuyerId) {
          return false;
        }
        const candidateIds = Array.isArray(scopedBuyerId)
          ? scopedBuyerId.map((id) => String(id).toLowerCase())
          : [String(scopedBuyerId).toLowerCase()];
        return candidateIds.some(
          (sId) =>
            (v.buyerId && String(v.buyerId).toLowerCase() === sId) ||
            (v.buyerAccountId && String(v.buyerAccountId).toLowerCase() === sId) ||
            (v.buyerEmail && String(v.buyerEmail).toLowerCase() === sId)
        );
      });
    }
    if (limit && Number.isInteger(Number(limit)) && Number(limit) > 0) {
      return list.slice(0, Number(limit));
    }
    return list;
  }

  getVendorById(id, scopedBuyerId = null) {
    const vendor = this.vendors.find((v) => v.id === id || v.email === id);
    if (!vendor) return undefined;
    if (scopedBuyerId === 'all') return vendor;
    if (!vendor.buyerId && !vendor.buyerAccountId) return vendor;
    if (!scopedBuyerId) return undefined;
    const candidateIds = Array.isArray(scopedBuyerId)
      ? scopedBuyerId.map((id) => String(id).toLowerCase())
      : [String(scopedBuyerId).toLowerCase()];
    const matches = candidateIds.some(
      (sId) =>
        (vendor.buyerId && String(vendor.buyerId).toLowerCase() === sId) ||
        (vendor.buyerAccountId && String(vendor.buyerAccountId).toLowerCase() === sId) ||
        (vendor.buyerEmail && String(vendor.buyerEmail).toLowerCase() === sId)
    );
    return matches ? vendor : undefined;
  }

  /**
   * getVendorById, but resolves the persisted record from D1/Postgres when
   * storage is configured (by id, then by email). The isolate-local vendor
   * list is only a bootstrap subset and cannot establish current ownership or
   * profile state across Workers. Indexed DB query caching bounds repeat reads.
   *
   * this.vendors is a capped, bootstrap-time subset (600k+ real vendors can't
   * all live in memory — see getVendorsPageFromDB), so a vendor that exists
   * for real but wasn't in that subset previously 404'd here even though it
   * was genuinely persisted. That silently broke a vendor's own "load my
   * profile" GET, which made the frontend treat it as a first-time profile
   * (blank form) and then hit the real UNIQUE-email conflict on save. Mirrors
   * the identical fallback already used for RFQ-invite vendor resolution.
   */
  async getVendorByIdWithDBFallback(id, scopedBuyerId = null, { fresh = false } = {}) {
    const inMemory = this.getVendorById(id, scopedBuyerId);
    if (!pool.hasStorage()) return inMemory;

    const normalizedId = String(id || '').trim();
    const isEmail = normalizedId.includes('@');
    const lookupById = () => fresh
      ? domainQueries.getVendorByIdFromDB(normalizedId, { fresh: true })
      : domainQueries.getVendorByIdFromDB(normalizedId);
    const lookupByEmail = () => fresh
      ? domainQueries.getVendorByEmailFromDB(normalizedId, { fresh: true })
      : domainQueries.getVendorByEmailFromDB(normalizedId);
    let vendor = isEmail ? await lookupByEmail() : await lookupById();
    if (!vendor && !isEmail) vendor = await lookupByEmail();
    if (!vendor) {
      const normalizedEmail = isEmail
        ? normalizedId.toLowerCase()
        : String(inMemory?.email || '').trim().toLowerCase();
      this.vendors = this.vendors.filter((cached) => {
        const sameId = cached.id === normalizedId;
        const sameEmail = normalizedEmail && String(cached.email || '').trim().toLowerCase() === normalizedEmail;
        return !sameId && !sameEmail;
      });
      return undefined;
    }

    const normalizedEmail = String(vendor.email || '').trim().toLowerCase();
    const cachedIndex = this.vendors.findIndex((cached) =>
      cached.id === vendor.id || (normalizedEmail && String(cached.email || '').trim().toLowerCase() === normalizedEmail)
    );
    if (cachedIndex < 0) {
      this.vendors.push(vendor);
      return this.getVendorById(vendor.id, scopedBuyerId);
    }

    this.vendors = this.vendors.filter((cached) => {
      const sameId = cached.id === vendor.id;
      const cachedEmail = String(cached.email || '').trim().toLowerCase();
      return !sameId && (!normalizedEmail || cachedEmail !== normalizedEmail);
    });
    this.vendors.splice(Math.min(cachedIndex, this.vendors.length), 0, vendor);
    return this.getVendorById(vendor.id, scopedBuyerId);
  }

  _buildVendorRecord(vendorData, buyerId = null) {
    // A client-supplied id was previously trusted as-is (never checked for
    // uniqueness) and the auto-generated fallback was only the last 4 digits
    // of Date.now() — collision-prone within the same ~10s window, and a
    // deliberate duplicate `id` in the request body would shadow an existing
    // vendor for every future id-based lookup (getVendorById/updateVendor
    // resolve by the *first* array match). The id is now always generated
    // server-side; nothing in the app currently has a legitimate reason to
    // request a specific vendor id.
    const { id: _ignoredClientId, tempPassword: _ignoredTemporaryPassword, ...safeVendorData } = vendorData;
    const resolvedBuyerId = buyerId || vendorData.buyerId || vendorData.buyerAccountId || null;
    const normalizedEmail = safeVendorData.email === undefined || safeVendorData.email === null
      ? safeVendorData.email
      : String(safeVendorData.email).trim().toLowerCase();
    return {
      ...safeVendorData,
      ...(safeVendorData.email !== undefined ? { email: normalizedEmail } : {}),
      id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      buyerId: resolvedBuyerId,
      buyerAccountId: resolvedBuyerId,
      buyerEmail: vendorData.buyerEmail || null,
      rating: optionalScore(vendorData.rating),
      score: optionalScore(vendorData.score),
      source: vendorData.source || (resolvedBuyerId || vendorData.addedByBuyerCompany ? 'buyer_manual' : 'procucev_network'),
      status: vendorData.status || 'PENDING EVALUATION',
      evaluated: vendorData.evaluated !== undefined ? vendorData.evaluated : false,
      hasRecord: vendorData.hasRecord !== undefined ? vendorData.hasRecord : false,
      isExistingInDatabase: vendorData.isExistingInDatabase !== undefined ? vendorData.isExistingInDatabase : true,
      // 'pending' until mailerService confirms the onboarding email was accepted. A
      // vendor without an email address cannot receive one, so it is 'skipped'.
      onboardingEmailStatus: vendorData.onboardingEmailStatus || (normalizedEmail ? 'pending' : 'skipped'),
      isCategoryAligned: vendorData.isCategoryAligned !== undefined ? vendorData.isCategoryAligned : true,
      // Every vendor starts on the free client-uploaded tier with a clean
      // download counter and initial free quotation credits.
      subscriptionPlan: vendorData.subscriptionPlan || 'premium',
      rfqDownloadsUsed: vendorData.rfqDownloadsUsed || 0,
      freeQuotationCredits: vendorData.freeQuotationCredits !== undefined
        ? Number(vendorData.freeQuotationCredits)
        : VENDOR_FREE_CREDITS_LIMIT,
      quotedRfqIds: Array.isArray(vendorData.quotedRfqIds) ? vendorData.quotedRfqIds : [],
      createdAt: vendorData.createdAt || vendorData.created_at || new Date().toISOString(),
      created_at: vendorData.createdAt || vendorData.created_at || new Date().toISOString(),
    };
  }

  addVendor(vendorData, actorEmail = null, buyerId = null, { deferPersistence = false } = {}) {
    const newVendor = this._buildVendorRecord(vendorData, buyerId);

    this.vendors.unshift(newVendor);
    if (!deferPersistence) this._persistVendor(newVendor);
    this.addAuditLog({
      // The signed-in caller when the controller could resolve one. Falls back to
      // the system marker rather than naming a fabricated procurement mailbox.
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Registered vendor ${newVendor.name} in category ${newVendor.majorCategory}`,
    });

    // Onboarding provisioning is NOT auto-fired here anymore. It used to run
    // via this._background(), a fire-and-forget waitUntil call — but that can
    // silently never complete on Workers (confirmed live: a buyer added a
    // vendor, got a normal 201, and the vendor had no login at all
    // afterward, no error surfaced anywhere). Worse, once the controller
    // started awaiting provisioning itself (see createVendor), having BOTH
    // this background call and the controller's explicit await fire at once
    // raced past _provisionVendorOnboarding's existing-identity guard before
    // either had committed, creating two separate "user" rows for the same
    // email with two different temp passwords — confirmed live. The REST
    // controller awaits provisioning after durable creation; other callers do
    // not trigger onboarding as an implicit side effect.
    return newVendor;
  }

  async addVendorDurably(vendorData, actorEmail = null, buyerId = null) {
    const newVendor = this._buildVendorRecord(vendorData, buyerId);
    const storageConfigured = pool.hasStorage();
    let persistedVendor;

    try {
      persistedVendor = await domainQueries.upsertVendorInDB(newVendor);
      if (storageConfigured && !persistedVendor) {
        throw new Error('Vendor creation upsert completed without a persisted row');
      }
    } catch (error) {
      logger.error('Failed to persist vendor creation', error, 'STORE_SERVICE');
      const isUniqueConflict =
        (error && error.code === '23505') ||
        (error && typeof error.message === 'string' && /unique constraint/i.test(error.message)) ||
        (error && error.cause && typeof error.cause.message === 'string' && /unique constraint/i.test(error.cause.message));
      const persistError = new Error(
        isUniqueConflict
          ? `A vendor with the email ${newVendor.email} already exists.`
          : 'The vendor could not be saved to storage. Try again.'
      );
      persistError.statusCode = isUniqueConflict ? 409 : 503;
      persistError.code = isUniqueConflict ? 'VENDOR_EMAIL_CONFLICT' : 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }

    const savedVendor = persistedVendor || newVendor;
    this.vendors.unshift(savedVendor);
    this.addAuditLog({
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Registered vendor ${savedVendor.name} in category ${savedVendor.majorCategory}`,
    });
    return savedVendor;
  }

  /**
   * Public entry point for callers that need onboarding provisioning to
   * genuinely complete before they respond — e.g. createVendor's controller,
   * which awaits this directly rather than relying on addVendor's internal
   * fire-and-forget call (below). Safe to call twice for the same vendor:
   * _provisionVendorOnboarding checks for an existing identity account first
   * and no-ops if one is already there, so repeated explicit provisioning
   * attempts do not create a second identity account.
   */
  async provisionVendorOnboarding(vendor, actorEmail = null, options = {}) {
    return this._provisionVendorOnboarding(vendor, actorEmail, options);
  }

  async _persistVendorOnboardingStatus(vendor, status) {
    try {
      const updated = await this.updateVendorDurably(vendor.id, { onboardingEmailStatus: status });
      if (!updated) throw new Error('Vendor onboarding status update returned no persisted row.');
      return { updated, warning: null };
    } catch (error) {
      logger.error('Failed to persist vendor onboarding status', {
        error,
        vendorId: vendor.id,
        onboardingEmailStatus: status,
      }, 'STORE_SERVICE');
      return {
        updated: null,
        warning: 'The vendor was added, but the onboarding status could not be saved. Please retry the onboarding action.',
      };
    }
  }

  async _provisionVendorOnboarding(vendor, actorEmail = null, { skipEmail = false } = {}) {
    // Real, previously-shipped bug found live: identityQueries.insertVendorAccount
    // unconditionally resets password + phone on an *existing* identity
    // account when one is found for the email — correct for the CLI
    // provisioning script this function shares that code with (an explicit
    // admin action recreating known credentials), but this function runs
    // automatically on every ordinary vendor-profile creation, including for
    // an email that already has a real login the vendor actually knows and
    // uses. That combination silently clobbered a real account's password
    // with a random temp one the vendor was never told, breaking their login
    // with no warning (confirmed live: yagnik.c@ahduni.edu.in). A vendor
    // *profile* being created is not the same event as a vendor *identity*
    // being created — this only provisions identity/sends onboarding
    // credentials when there is genuinely no identity account yet.
    let existingIdentity;
    try {
      existingIdentity = await identityQueries.findUserByEmail(vendor.email);
    } catch (err) {
      logger.error(`Could not verify identity for vendor ${vendor.email}`, err, 'STORE_SERVICE');
      const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
      return {
        status: 'failed',
        error: [
          'The vendor was added, but their login could not be verified. Please contact support to resend the invitation.',
          statusWrite.warning,
        ].join(' ').trim(),
      };
    }
    if (existingIdentity) {
      logger.info(
        `Skipped onboarding identity provisioning for ${vendor.email}: an identity account already exists`,
        { vendorId: vendor.id },
        'STORE_SERVICE'
      );
      const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'account_exists');
      return { status: 'account_exists', error: statusWrite.warning };
    }

    const tempPassword = this._generateTempPassword();

    let onboardingEvent = null;
    if (pool.hasStorage() && !skipEmail) {
      const configuredKey = String(process.env.AES_ENCRYPTION_KEY || process.env.AES_SECRET_KEY || '').trim();
      if (!configuredKey) {
        logger.error('Vendor onboarding was stopped because durable credential encryption is not configured', {
          vendorId: vendor.id,
          email: vendor.email,
          operation: 'provision-vendor-onboarding',
          requiredConfiguration: 'AES_ENCRYPTION_KEY or AES_SECRET_KEY',
        }, 'STORE_SERVICE');
        const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
        return {
          status: 'failed',
          error: [
            'The vendor was added, but secure onboarding email delivery is not configured. Set AES_ENCRYPTION_KEY or AES_SECRET_KEY, then retry the invitation.',
            statusWrite.warning,
          ].join(' ').trim(),
        };
      }

      try {
        const encryptedTempPassword = cryptoService.encrypt(tempPassword, {
          additionalData: `vendor-onboarding-email:${vendor.id}`,
        });
        onboardingEvent = {
          id: eventOutboxService.buildEventOutboxId(
            EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
            vendor.id
          ),
          eventType: EVENT_OUTBOX_TYPES.VENDOR_ONBOARDING_EMAIL,
          payload: {
            vendorId: vendor.id,
            encryptedTempPassword: encryptedTempPassword.encoded,
          },
        };
      } catch (error) {
        logger.error('Vendor onboarding credentials could not be encrypted for durable delivery', {
          error,
          vendorId: vendor.id,
          operation: 'provision-vendor-onboarding',
        }, 'STORE_SERVICE');
        const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
        return {
          status: 'failed',
          error: [
            'The vendor was added, but their credentials could not be secured for email delivery. Please contact support to retry the invitation.',
            statusWrite.warning,
          ].join(' ').trim(),
        };
      }
    }

    let identityCreated = false;
    for (let attempt = 1; attempt <= 2 && !identityCreated; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await identityQueries.insertVendorAccount({
          email: vendor.email,
          password: tempPassword,
          phone: vendor.phone || null,
          fullName: vendor.contactPerson || vendor.name,
          organizationName: vendor.name,
          createdBy: actorEmail || 'buyer-manual-add',
          resetExisting: false,
          resetPasswordRequired: true,
          ...(onboardingEvent ? { onboardingEvent } : {}),
        });
        identityCreated = result.created === true;
        if (!identityCreated) {
          const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'account_exists');
          return { status: 'account_exists', error: statusWrite.warning };
        }
      } catch (err) {
        logger.error(
          `Failed to create vendor identity account for ${vendor.email} (attempt ${attempt}/2)`,
          err,
          'STORE_SERVICE'
        );
      }
    }

    if (!identityCreated) {
      const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
      return {
        status: 'failed',
        error: [
          'The vendor was added, but their login account could not be created. Please contact support to resend the invitation.',
          statusWrite.warning,
        ].join(' ').trim(),
      };
    }

    if (skipEmail) {
      // CM bulk-upload path: the login account is still created so the
      // vendor can be given/reset credentials later, but no automated
      // credentials email goes out for this import channel.
      const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'skipped');
      logger.info(
        `Identity created for ${vendor.email} via CM bulk upload; onboarding email intentionally skipped`,
        { vendorId: vendor.id },
        'STORE_SERVICE'
      );
      return { status: 'skipped', error: statusWrite.warning };
    }

    if (onboardingEvent) {
      logger.info('Vendor onboarding email recorded for durable delivery', {
        vendorId: vendor.id,
        email: vendor.email,
        outboxId: onboardingEvent.id,
      }, 'STORE_SERVICE');
      return { status: 'pending', error: null };
    }

    const emailPayload = mailerService.buildVendorOnboardingEmail({
      to: vendor.email,
      recipientName: vendor.contactPerson || vendor.name,
      buyerOrganizationName: 'Procucev Enterprise',
      vendorCode: vendor.id,
      tempPassword,
      contactPhone: vendor.phone,
    });

    try {
      const delivery = await mailerService.sendVendorIngestionEmail(emailPayload, 'onboarding');
      if (delivery.sent) {
        const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'sent');
        logger.info(`Onboarding email sent to ${vendor.email}`, { vendorId: vendor.id }, 'STORE_SERVICE');
        return { status: 'sent', error: statusWrite.warning };
      } else {
        const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
        logger.warn(`Failed to send onboarding email to ${vendor.email}`, { reason: delivery.reason }, 'STORE_SERVICE');
        return {
          status: 'failed',
          error: [
            'The vendor account was created, but the credentials email could not be delivered. Please contact support to resend the invitation.',
            statusWrite.warning,
          ].join(' ').trim(),
        };
      }
    } catch (err) {
      const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
      logger.error(`Error sending onboarding email to ${vendor.email}`, err, 'STORE_SERVICE');
      return {
        status: 'failed',
        error: [
          'The vendor account was created, but the credentials email could not be delivered. Please contact support to resend the invitation.',
          statusWrite.warning,
        ].join(' ').trim(),
      };
    }
  }

  /** A bulk-import row as a new vendor record (see bulkAddVendors). */
  _buildBulkVendor(row, idx) {
    return {
      id: `v-bulk-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      vendorCode: row.vendorCode || '',
      name: row.name,
      contactPerson: row.contactPerson || '',
      phone: row.phone,
      email: row.email || null,
      majorCategory: row.majorCategory || 'Uncategorised',
      minorCategories: row.minorCategories || [],
      location: row.city || '',
      city: row.city || '',
      state: row.state || '',
      pincode: row.pincode || '',
      gstin: row.gstin || '',
      products: row.products || '',
      // Not evaluated yet, so no rating or score is recorded. An unrated supplier
      // must not carry a score that nobody assessed.
      rating: null,
      score: null,
      // A category manager's upload feeds the shared Procucev network
      // ('excel', unscoped); a buyer's own upload is their private roster
      // and carries buyerId/addedByBuyerCompany through from the
      // controller (see vendorController.bulkImportVendors) — same
      // attribution the single-add createVendor path already applies.
      source: row.source || 'excel',
      ...(row.buyerId ? { buyerId: row.buyerId } : {}),
      ...(row.addedByBuyerCompany ? { addedByBuyerCompany: row.addedByBuyerCompany } : {}),
      status: 'REGISTERED / NOT EVALUATED',
      evaluated: false,
      hasRecord: false,
      isExistingInDatabase: true,
      onboardingEmailStatus: 'pending',
      isCategoryAligned: true,
      // No subscription plan or credit balance is granted here. The vendor has not
      // registered, and neither value is a column in the vendors table.
      rfqDownloadsUsed: 0,
      quotedRfqIds: [],
      // Carried through from the request's server-side re-validation
      // (see vendorController.bulkImportVendors) so a row that failed a
      // format check (bad email/phone/GSTIN/pincode, or a normally-
      // required field left blank) still lands as a real vendor record —
      // just one the CM can see is questionable, not one that got
      // silently dropped or had a value invented for it.
      hasIssues: !!row.hasIssues,
      issues: Array.isArray(row.issues) ? row.issues : [],
    };
  }

  /**
   * Bulk-import already-validated vendor rows from a category manager's
   * Excel upload (one call per uploaded-file chunk from the client, not one
   * call per row). Unlike addVendor's fire-and-forget persistence, this
   * awaits the real Neon write so the caller's per-row result — imported,
   * duplicate, or failed — reflects what was actually stored, not an
   * optimistic guess. The reference p2pservices app reports every row as
   * "Failed" regardless of outcome (it re-checks each row against the
   * record it just inserted); the whole point of this method is to never
   * repeat that.
   *
   * @param {object[]} rows - Rows that already passed field-format
   *   validation (VALIDATION_SCHEMAS.vendorBulkImportRow) — this method's
   *   only remaining job is duplicate detection and the actual bulk write.
   * @returns {Promise<{results: object[], importedCount: number, duplicateCount: number}>}
   */
  async bulkAddVendors(rows, actorEmail = null) {
    // Neon is the single source of truth for vendor records (see the standing
    // "no in-memory-only data path" principle). A bulk import with no database
    // configured must fail loudly, not silently accept rows into `this.vendors`
    // that vanish on the next restart and were never really "imported".
    if (!pool.hasStorage()) {
      const err = new Error('Database is not configured — vendors cannot be bulk-imported right now.');
      err.statusCode = 500;
      throw err;
    }

    const existingEmails = new Set(this.vendors.map((v) => (v.email || '').toLowerCase()));
    const seenInBatch = new Set();
    const seenVendorCodesInBatch = new Set();
    const results = [];
    const toInsert = [];
    // Duplicate-email rows that may match an unowned auto-created migrated
    // profile (see claimMigratedVendorProfile) — claimed after the insert.
    const claimCandidates = [];

    rows.forEach((row, idx) => {
      const email = (row.email || '').toLowerCase();
      const vendorCode = (row.vendorCode || '').trim().toLowerCase();

      if (vendorCode) {
        if (seenVendorCodesInBatch.has(vendorCode)) {
          results.push({
            rowNumber: row.rowNumber,
            status: 'duplicate',
            email: row.email,
            reason: `Duplicate Vendor Code "${row.vendorCode}" within the uploaded file.`,
            errors: [`Duplicate Vendor Code "${row.vendorCode}" within the uploaded file.`],
          });
          return;
        }
        seenVendorCodesInBatch.add(vendorCode);
      }

      if (email) {
        if (existingEmails.has(email)) {
          const duplicate = {
            rowNumber: row.rowNumber,
            status: 'duplicate',
            email: row.email,
            reason: 'A vendor with this email already exists.',
            errors: ['A vendor with this email already exists.'],
          };
          results.push(duplicate);
          claimCandidates.push({ result: duplicate, vendor: this._buildBulkVendor(row, idx) });
          return;
        }
        if (seenInBatch.has(email)) {
          results.push({
            rowNumber: row.rowNumber,
            status: 'duplicate',
            email: row.email,
            reason: 'Duplicate email within the uploaded file.',
            errors: ['Duplicate email within the uploaded file.'],
          });
          return;
        }
        seenInBatch.add(email);
      }

      const newVendor = this._buildBulkVendor(row, idx);
      toInsert.push({ rowNumber: row.rowNumber, vendor: newVendor });
    });

    let insertedEmails = [];
    if (toInsert.length > 0) {
      insertedEmails = await domainQueries.bulkInsertVendorsInDB(toInsert.map((r) => r.vendor));
    }
    const insertedEmailSet = new Set(insertedEmails.map((e) => (e || '').toLowerCase()));

    // One round trip for the whole batch instead of one findUserByEmail call
    // per row — a bulk import chunk in the hundreds/thousands of rows made
    // that many sequential D1 subrequests inside this loop alone, which hit
    // the Workers per-invocation subrequest cap outright ("Too many API
    // requests by single Worker invocation"), confirmed live.
    const existingUsernames = await identityQueries
      .findExistingUsernames(insertedEmails.filter(Boolean))
      .catch((err) => {
        logger.error('Failed to batch-check vendor identities before bulk onboarding', err, 'STORE_SERVICE');
        return new Set();
      });

    // insertVendorAccount itself makes several sequential subrequests per
    // call (role/org-type/status resolution + an org lookup + the insert),
    // so firing it for every new row in a large chunk hits the same
    // per-invocation subrequest cap the insert/lookup batching above just
    // fixed — a 1000-new-row chunk alone would need ~5000 more subrequests.
    // The controller caps each request at 15 rows, bounding identity
    // provisioning to a safe number of sequential database operations.
    for (const { rowNumber, vendor } of toInsert) {
      // A null-email row can never hit the ON CONFLICT (email) target, so it
      // always inserts — there is nothing to look up in insertedEmailSet.
      const persisted = !vendor.email || insertedEmailSet.has(vendor.email.toLowerCase());
      if (persisted) {
        this.vendors.unshift(vendor);
        const importedResult = {
          rowNumber,
          status: 'imported',
          email: vendor.email,
          missingEmail: !vendor.email,
          hasIssues: vendor.hasIssues,
          issues: vendor.issues,
          vendor,
        };
        results.push(importedResult);

        if (vendor.email && existingUsernames.has(vendor.email.toLowerCase())) {
          // Same real bug as _provisionVendorOnboarding's comment describes:
          // insertVendorAccount resets password+phone on an existing
          // identity account. A bulk import row for an email that already
          // has a real login must never touch it or mail out fake "new"
          // credentials for an account the buyer/vendor already uses.
          logger.info(
            `Skipped onboarding identity provisioning for ${vendor.email}: an identity account already exists`,
            { vendorId: vendor.id },
            'STORE_SERVICE'
          );
          const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'account_exists');
          importedResult.onboardingError = statusWrite.warning;
        } else if (vendor.email) {
          try {
            const onboarding = await this.provisionVendorOnboarding(vendor, 'vendor-bulk-import', {
              skipEmail: true,
            });
            importedResult.onboardingEmailStatus = onboarding?.status || 'failed';
            if (onboarding?.error) importedResult.onboardingError = onboarding.error;
          } catch (err) {
            logger.error(`Failed to provision login for bulk-imported vendor ${vendor.email}`, err, 'STORE_SERVICE');
            const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
            importedResult.onboardingEmailStatus = 'failed';
            importedResult.onboardingError = [
              'The vendor was added, but their login could not be set up. Please contact support to resend the invitation.',
              statusWrite.warning,
            ].join(' ').trim();
          }
        }

        importedResult.vendor = this.getVendorById(vendor.id) || vendor;
        if (importedResult.onboardingEmailStatus === undefined) {
          importedResult.onboardingEmailStatus = importedResult.vendor.onboardingEmailStatus;
        }
      } else {
        const duplicate = { rowNumber, status: 'duplicate', email: vendor.email, reason: 'A vendor with this email already exists.' };
        results.push(duplicate);
        claimCandidates.push({ result: duplicate, vendor });
      }
    }

    for (const { result, vendor } of claimCandidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        let claimed = await this.claimMigratedVendorProfile(vendor.email, vendor, vendor.buyerId || null, 'vendor-bulk-import');

        if (!claimed && vendor.buyerId && vendor.email) {
          const normalized = String(vendor.email).trim().toLowerCase();
          let existing = this.vendors.find((v) => (v.email || '').toLowerCase() === normalized);
          if (!existing && pool.hasStorage()) {
            // eslint-disable-next-line no-await-in-loop
            existing = await domainQueries.getVendorByEmailFromDB(normalized, { fresh: true });
          }
          if (existing) {
            const isOwnedByOtherBuyer = existing.buyerId && existing.buyerId !== vendor.buyerId;
            if (!isOwnedByOtherBuyer) {
              const updates = {
                ...existing,
                name: vendor.name || existing.name,
                companyName: vendor.name || existing.companyName || existing.name,
                phone: vendor.phone || existing.phone,
                contactPhone: vendor.phone || existing.contactPhone || existing.phone,
                contactPerson: vendor.contactPerson || existing.contactPerson,
                majorCategory: vendor.majorCategory || existing.majorCategory,
                minorCategories: Array.isArray(vendor.minorCategories) && vendor.minorCategories.length > 0 ? vendor.minorCategories : existing.minorCategories,
                city: vendor.city || existing.city,
                state: vendor.state || existing.state,
                pincode: vendor.pincode || existing.pincode,
                gstin: vendor.gstin || existing.gstin,
                buyerId: vendor.buyerId,
                buyerAccountId: vendor.buyerId,
                addedByBuyerCompany: vendor.addedByBuyerCompany || existing.addedByBuyerCompany,
                source: existing.source === 'procucev_network' ? 'procucev_network' : 'buyer_excel',
                isCategoryAligned: true,
                onboardingEmailStatus: existing.onboardingEmailStatus || 'account_exists',
              };
              // eslint-disable-next-line no-await-in-loop
              claimed = await this.updateVendorDurably(existing.id, updates);
              if (claimed) {
                const memIdx = this.vendors.findIndex((v) => v.id === existing.id);
                if (memIdx !== -1) {
                  this.vendors[memIdx] = { ...this.vendors[memIdx], ...claimed };
                } else {
                  this.vendors.unshift(claimed);
                }
              }
            } else {
              result.status = 'failed';
              result.reason = `A vendor with the email "${vendor.email}" is already registered to another buyer organization.`;
              result.errors = [result.reason];
            }
          }
        }

        if (claimed) {
          delete result.reason;
          delete result.errors;
          Object.assign(result, {
            status: 'imported',
            missingEmail: false,
            hasIssues: claimed.hasIssues,
            issues: claimed.issues,
            vendor: claimed,
            onboardingEmailStatus: claimed.onboardingEmailStatus || 'account_exists',
          });
        }
      } catch (err) {
        logger.error(`Failed to link vendor ${vendor.email} during bulk import`, err, 'STORE_SERVICE');
      }
    }

    const importedCount = results.filter((r) => r.status === 'imported').length;
    const duplicateCount = results.filter((r) => r.status === 'duplicate').length;
    const missingEmailCount = results.filter((r) => r.status === 'imported' && r.missingEmail).length;

    if (importedCount > 0) {
      this.addAuditLog({
        userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
        action: `Bulk-imported ${importedCount} vendor(s) via Excel upload (${duplicateCount} duplicate row(s) skipped, ${missingEmailCount} missing an email)`,
      });
    }

    return { results, importedCount, duplicateCount, missingEmailCount };
  }

  updateVendor(id, updates, { persist = true } = {}) {
    const idx = this.vendors.findIndex((v) => v.id === id || v.email === id);
    if (idx === -1) return null;

    // A client payload must never be able to reassign the record's primary
    // key (would corrupt this.vendors' id-uniqueness and orphan the old id).
    const { id: _ignoredId, tempPassword: _ignoredTemporaryPassword, ...safeUpdates } = updates;
    const updated = { ...this.vendors[idx], ...safeUpdates };
    this.vendors[idx] = updated;
    if (persist) this._persistVendor(updated);

    return updated;
  }

  async updateVendorDurably(id, updates) {
    let idx = this.vendors.findIndex((vendor) => vendor.id === id || vendor.email === id);
    const storageConfigured = pool.hasStorage();
    let updated;
    let savedVendor;

    const resolveUpdates = (currentVendor) => {
      const candidate = typeof updates === 'function' ? updates(currentVendor) : updates;
      const { id: _ignoredId, tempPassword: _ignoredTemporaryPassword, ...safeUpdates } = candidate || {};
      return safeUpdates;
    };

    try {
      if (storageConfigured) {
        const snapshotReader = String(id || '').includes('@')
          ? domainQueries.getVendorSnapshotByEmailFromDB
          : domainQueries.getVendorSnapshotByIdFromDB;
        let snapshot = await snapshotReader(id);
        if (!snapshot) return null;

        for (let attempt = 0; attempt < PERSISTED_RECORD_WRITE_RETRIES; attempt += 1) {
          updated = { ...snapshot.vendor, ...resolveUpdates(snapshot.vendor) };
          savedVendor = await domainQueries.updateVendorIfUnchangedInDB(snapshot, updated);
          if (savedVendor) break;
          snapshot = await domainQueries.getVendorSnapshotByIdFromDB(snapshot.id);
          if (!snapshot) return null;
        }
        if (!savedVendor) throw new Error('Vendor changed repeatedly while saving; retry the update.');
      } else {
        const previous = idx >= 0 ? this.vendors[idx] : null;
        if (!previous) return null;
        updated = { ...previous, ...resolveUpdates(previous) };
        savedVendor = updated;
      }
      idx = this.vendors.findIndex((vendor) => vendor.id === savedVendor.id);
      if (idx >= 0) this.vendors[idx] = savedVendor;
      else this.vendors.unshift(savedVendor);
      return savedVendor;
    } catch (error) {
      logger.error('Failed to persist vendor update', error, 'STORE_SERVICE');
      const isUniqueConflict =
        (error && error.code === '23505') ||
        (error && typeof error.message === 'string' && /unique constraint/i.test(error.message)) ||
        (error && error.cause && typeof error.cause.message === 'string' && /unique constraint/i.test(error.cause.message));
      const persistError = new Error(
        isUniqueConflict ? `A vendor with the email ${updated?.email || id} already exists.` : 'The vendor could not be updated in storage. Try again.'
      );
      persistError.statusCode = isUniqueConflict ? 409 : 503;
      persistError.code = isUniqueConflict ? 'VENDOR_EMAIL_CONFLICT' : 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
  }

  deleteVendor(id, actorEmail = null, { deferPersistence = false, deferAudit = false } = {}) {
    const target = this.vendors.find((v) => v.id === id || v.email === id);
    const beforeLen = this.vendors.length;
    this.vendors = this.vendors.filter((v) => v.id !== id && v.email !== id);
    if (this.vendors.length < beforeLen) {
      if (!deferPersistence) this._removeVendor(target ? target.id : id);
      // Deletion was the only vendor mutation that wrote no audit entry, so a
      // vendor disappearing from the master left no record of who removed it or
      // when — the addVendor and updateVendor paths both log, and the removal of
      // a supplier is the change most worth being able to account for.
      if (!deferAudit) {
        this.addAuditLog({
          userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
          action: `Removed vendor ${target ? target.name : id} (${target && target.email ? target.email : 'no email on record'}) from the vendor master`,
        });
      }
      return true;
    }
    return false;
  }

  async deleteVendorDurably(id, actorEmail = null) {
    let target = this.vendors.find((vendor) => vendor.id === id || vendor.email === id);
    if (!target && pool.hasStorage()) {
      target = await domainQueries.getVendorByIdFromDB(id);
      if (!target && typeof id === 'string' && id.includes('@')) {
        target = await domainQueries.getVendorByEmailFromDB(id);
      }
    }
    if (!target) return false;

    if (pool.hasStorage()) {
      try {
        await domainQueries.deleteVendorInDB(target.id);
      } catch (error) {
        logger.error('Failed to persist vendor deletion', error, 'STORE_SERVICE');
        const persistError = new Error('The vendor could not be deleted from storage. Try again.');
        persistError.statusCode = 503;
        persistError.code = 'PERSISTENCE_UNAVAILABLE';
        throw persistError;
      }
    }

    this.deleteVendor(target.id, actorEmail, { deferPersistence: true, deferAudit: true });
    this.addAuditLog({
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Removed vendor ${target.name || id} (${target.email || 'no email on record'}) from the vendor master`,
    });
    return true;
  }



  /**
   * Checks whether a vendor is mapped to / owned by the buyer who created the given RFQ.
   *
   * A vendor is buyer-mapped when uploaded or added by that respective buyer:
   *  - vendor.buyerId / vendor.buyerAccountId matches rfq.buyerAccountId
   *  - vendor.addedByBuyerCompany matches rfq.buyerAccountName
   *  - vendor.buyerEmail matches rfq.buyerEmail / rfq.raisedByEmail
   *  - vendor.mappedBuyerIds / vendor.buyerIds includes rfq.buyerAccountId
   *  - or the resolved buyerAccount for the RFQ matches the vendor's buyer fields.
   */
  isVendorMappedToRfqBuyer(vendor, rfq) {
    if (!vendor || !rfq) return false;

    const rfqBuyerId = rfq.buyerAccountId ? String(rfq.buyerAccountId).trim().toLowerCase() : null;
    const rfqBuyerName = rfq.buyerAccountName ? String(rfq.buyerAccountName).trim().toLowerCase() : null;
    const rfqBuyerEmail = (rfq.buyerEmail || rfq.raisedByEmail) ? String(rfq.buyerEmail || rfq.raisedByEmail).trim().toLowerCase() : null;

    const vBuyerId = vendor.buyerId ? String(vendor.buyerId).trim().toLowerCase() : null;
    const vBuyerAccountId = vendor.buyerAccountId ? String(vendor.buyerAccountId).trim().toLowerCase() : null;
    const vAddedBy = vendor.addedByBuyerCompany ? String(vendor.addedByBuyerCompany).trim().toLowerCase() : null;
    const vBuyerEmail = vendor.buyerEmail ? String(vendor.buyerEmail).trim().toLowerCase() : null;

    // Direct id match
    if (rfqBuyerId && (vBuyerId === rfqBuyerId || vBuyerAccountId === rfqBuyerId)) {
      return true;
    }

    // Direct company name match
    if (rfqBuyerName && vAddedBy && vAddedBy === rfqBuyerName) {
      return true;
    }

    // Normalized company name match (stripping punctuation/symbols)
    if (rfqBuyerName && vAddedBy) {
      const cleanRfqName = rfqBuyerName.replace(/[^a-z0-9]/g, '');
      const cleanAddedBy = vAddedBy.replace(/[^a-z0-9]/g, '');
      if (cleanRfqName && cleanAddedBy && (cleanRfqName === cleanAddedBy || cleanRfqName.includes(cleanAddedBy) || cleanAddedBy.includes(cleanRfqName))) {
        return true;
      }
    }

    // Direct email match
    if (rfqBuyerEmail && vBuyerEmail && vBuyerEmail === rfqBuyerEmail) {
      return true;
    }

    // Array of mapped buyer ids if present
    const mappedIds = Array.isArray(vendor.mappedBuyerIds)
      ? vendor.mappedBuyerIds
      : (Array.isArray(vendor.buyerIds) ? vendor.buyerIds : []);
    if (rfqBuyerId && mappedIds.some((id) => String(id).trim().toLowerCase() === rfqBuyerId)) {
      return true;
    }

    // Check if another in-memory vendor profile with the same email has the buyer mapping
    const vEmail = vendor.email ? String(vendor.email).trim().toLowerCase() : null;
    const vId = vendor.id ? String(vendor.id).trim().toLowerCase() : null;
    const vName = vendor.name ? String(vendor.name).trim().toLowerCase() : null;
    if (vEmail && Array.isArray(this.vendors)) {
      const peer = this.vendors.find(
        (v) =>
          v &&
          v !== vendor &&
          v.email &&
          String(v.email).trim().toLowerCase() === vEmail &&
          ((rfqBuyerId && (String(v.buyerId || '').trim().toLowerCase() === rfqBuyerId || String(v.buyerAccountId || '').trim().toLowerCase() === rfqBuyerId)) ||
            (rfqBuyerName && v.addedByBuyerCompany && String(v.addedByBuyerCompany).trim().toLowerCase() === rfqBuyerName) ||
            (rfqBuyerEmail && v.buyerEmail && String(v.buyerEmail).trim().toLowerCase() === rfqBuyerEmail))
      );
      if (peer) return true;
    }

    // Fallback: check buyerAccount lookup if one side only has email/id and the other has company name
    if (rfqBuyerId && Array.isArray(this.buyerAccounts)) {
      const buyerAcc = this.buyerAccounts.find(
        (a) => a && (String(a.id).trim().toLowerCase() === rfqBuyerId || (a.corporateEmail && String(a.corporateEmail).trim().toLowerCase() === rfqBuyerId))
      );
      if (buyerAcc) {
        const orgName = (buyerAcc.organizationName || '').trim().toLowerCase();
        const corpEmail = (buyerAcc.corporateEmail || '').trim().toLowerCase();
        if (orgName && vAddedBy && vAddedBy === orgName) return true;
        if (corpEmail && vBuyerEmail && vBuyerEmail === corpEmail) return true;
      }
    }

    // Direct invitation match: buyer specifically assigned or invited this vendor to this private RFQ
    if (Array.isArray(rfq.assignedVendors)) {
      const isAssigned = rfq.assignedVendors.some((av) => {
        if (!av) return false;
        const avId = av.id ? String(av.id).trim().toLowerCase() : null;
        const avEmail = av.email ? String(av.email).trim().toLowerCase() : null;
        const avName = av.name ? String(av.name).trim().toLowerCase() : null;
        return (vId && avId && vId === avId) || (vEmail && avEmail && vEmail === avEmail) || (vName && avName && vName === avName);
      });
      if (isAssigned) return true;
    }

    if (rfq.followUpData && Array.isArray(rfq.followUpData.vendors)) {
      const isInvited = rfq.followUpData.vendors.some((fv) => {
        if (!fv) return false;
        const fvId = (fv.id || fv.vendorId) ? String(fv.id || fv.vendorId).trim().toLowerCase() : null;
        const fvEmail = fv.email ? String(fv.email).trim().toLowerCase() : null;
        const fvName = (fv.name || fv.vendorName) ? String(fv.name || fv.vendorName).trim().toLowerCase() : null;
        return (vId && fvId && vId === fvId) || (vEmail && fvEmail && vEmail === fvEmail) || (vName && fvName && vName === fvName);
      });
      if (isInvited) return true;
    }

    return false;
  }

  isVendorPrivateToDifferentBuyer(vendor, rfq) {
    if (!vendor || !rfq) return false;

    const hasBuyerOwnership = Boolean(
      vendor.buyerId ||
      vendor.buyerAccountId ||
      vendor.addedByBuyerCompany ||
      vendor.buyerEmail ||
      (Array.isArray(vendor.mappedBuyerIds) && vendor.mappedBuyerIds.length > 0) ||
      (Array.isArray(vendor.buyerIds) && vendor.buyerIds.length > 0)
    );
    if (!hasBuyerOwnership) return false;

    // Invitation is an access grant, not evidence that a buyer owns a private
    // vendor. Ignore invitation lists while resolving the owning buyer.
    const rfqWithoutInvitations = { ...rfq, assignedVendors: [], followUpData: null };
    return !this.isVendorMappedToRfqBuyer(vendor, rfqWithoutInvitations);
  }

  /**
   * Check whether a vendor is eligible to submit a quotation for an RFQ.
   *
   * Buyer-specific vendor access rule:
   * When a buyer uploads or adds a vendor to their vendor list, that vendor is eligible
   * to submit unlimited quotations for RFQs created by that respective buyer, without requiring
   * a subscription or consuming the vendor's 5 free bid credits.
   *
   * Otherwise (for other buyers' RFQs or network RFQs):
   * Initial allowance: Each vendor starts with VENDOR_FREE_CREDITS_LIMIT (5) free quotation credits.
   * Once free credits are exhausted, an active paid subscription ('connect' or 'select')
   * is strictly required.
   */
  checkVendorQuotationEligibility(vendorOrId, rfq = null) {
    const vendor = typeof vendorOrId === 'string' ? this.getVendorById(vendorOrId, 'all') : vendorOrId;
    if (!vendor) {
      return {
        eligible: false,
        reason: 'Vendor record not found',
        freeCreditsRemaining: 0,
        isSubscribed: false,
        isBuyerMapped: false,
        subscriptionPlan: 'none',
      };
    }

    const hasUnlimitedQuotes = hasUnlimitedQuoteAccess(vendor);
    const isBuyerMapped = Boolean(rfq && this.isVendorMappedToRfqBuyer(vendor, rfq));

    const freeCredits = vendor.freeQuotationCredits !== undefined
      ? Number(vendor.freeQuotationCredits)
      : (vendor.freeRfqDownloadCredits !== undefined ? Number(vendor.freeRfqDownloadCredits) : VENDOR_FREE_CREDITS_LIMIT);

    const isSubscribed = Boolean(
      vendor.subscriptionPlan === 'connect' ||
      vendor.subscriptionPlan === 'select' ||
      vendor.isSubscribed === true ||
      vendor.subscriptionStatus === 'active' ||
      hasUnlimitedQuotes
    );

    // If buyer-mapped for this respective buyer's RFQ or has unlimited quotes: unlimited quotations, no subscription needed.
    const eligible = hasUnlimitedQuotes || isBuyerMapped || freeCredits > 0 || isSubscribed;

    return {
      eligible,
      freeCreditsRemaining: hasUnlimitedQuotes ? 999999 : Math.max(0, freeCredits),
      isSubscribed: isSubscribed || isBuyerMapped || hasUnlimitedQuotes,
      isBuyerMapped,
      hasUnlimitedQuotes,
      subscriptionPlan: vendor.subscriptionPlan || 'premium',
    };
  }

  /**
   * Retrieves authoritative RFQ download credit balance & stats for a vendor.
   */
  getVendorRfqCredits(vendorIdOrEmail) {
    const vendor = this.getVendorById(vendorIdOrEmail, 'all');
    if (!vendor) {
      return {
        vendorId: vendorIdOrEmail,
        freeCreditsAllocated: VENDOR_FREE_CREDITS_LIMIT,
        freeCreditsUsed: 0,
        freeCreditsRemaining: VENDOR_FREE_CREDITS_LIMIT,
        isSubscribed: false,
        subscriptionPlan: 'none',
        unlockedRfqIds: [],
      };
    }

    const hasUnlimitedDownloads = hasUnlimitedDownloadAccess(vendor);
    const freeCredits = vendor.freeQuotationCredits !== undefined
      ? Number(vendor.freeQuotationCredits)
      : (vendor.freeRfqDownloadCredits !== undefined ? Number(vendor.freeRfqDownloadCredits) : VENDOR_FREE_CREDITS_LIMIT);

    const isSubscribed = Boolean(
      vendor.subscriptionPlan === 'connect' ||
      vendor.subscriptionPlan === 'select' ||
      vendor.isSubscribed === true ||
      vendor.subscriptionStatus === 'active' ||
      hasUnlimitedDownloads
    );

    // A Connect/Select subscriber's balance is their plan's download quota
    // less the downloads used. Their free-tier field stays 0 (subscribers are
    // never charged against it), and showing it made every subscriber read
    // "0 credits" while the Subscription page showed the real balance.
    const planQuota = hasUnlimitedDownloads ? undefined : VENDOR_PLAN_RFQ_QUOTA[vendor.subscriptionPlan];
    if (planQuota !== undefined) {
      const planUsed = Math.max(0, Number(vendor.rfqDownloadsUsed) || 0);
      return {
        vendorId: vendor.id,
        freeCreditsAllocated: planQuota,
        freeCreditsUsed: Math.min(planUsed, planQuota),
        freeCreditsRemaining: Math.max(0, planQuota - planUsed),
        isSubscribed,
        hasUnlimitedDownloads,
        subscriptionPlan: vendor.subscriptionPlan,
        unlockedRfqIds: Array.isArray(vendor.unlockedRfqIds) ? vendor.unlockedRfqIds : [],
      };
    }

    const allocated = hasUnlimitedDownloads ? 999999 : (vendor.freeCreditsAllocated !== undefined ? Number(vendor.freeCreditsAllocated) : VENDOR_FREE_CREDITS_LIMIT);
    const remaining = hasUnlimitedDownloads ? 999999 : Math.max(0, freeCredits);
    const used = vendor.freeCreditsUsed !== undefined ? Number(vendor.freeCreditsUsed) : Math.max(0, allocated - remaining);

    return {
      vendorId: vendor.id,
      freeCreditsAllocated: allocated,
      freeCreditsUsed: used,
      freeCreditsRemaining: remaining,
      isSubscribed,
      hasUnlimitedDownloads,
      subscriptionPlan: vendor.subscriptionPlan || 'premium',
      unlockedRfqIds: Array.isArray(vendor.unlockedRfqIds) ? vendor.unlockedRfqIds : [],
    };
  }

  /**
   * Checks whether an RFQ has been unlocked / downloaded by a given vendor.
   * Buyer-mapped vendors quoting their own buyer's RFQs are always unlocked.
   */
  isRfqUnlockedForVendor(vendorIdOrEmail, rfqIdOrNumber) {
    if (!vendorIdOrEmail || !rfqIdOrNumber) return false;
    const vendor = this.getVendorById(vendorIdOrEmail, 'all');
    if (!vendor) return false;
    const rfq = this.getRFQById(rfqIdOrNumber);

    // Direct buyer-mapped vendors always have access without lock
    if (rfq && this.isVendorMappedToRfqBuyer(vendor, rfq)) {
      return true;
    }

    // Unlimited access vendors bypass download lock
    if (hasUnlimitedDownloadAccess(vendor)) {
      return true;
    }

    const normRfqId = rfq ? String(rfq.id).toLowerCase() : String(rfqIdOrNumber).toLowerCase();
    const normRfqNum = rfq && rfq.rfqNumber ? String(rfq.rfqNumber).toLowerCase() : String(rfqIdOrNumber).toLowerCase();

    const unlockedList = Array.isArray(vendor.unlockedRfqIds) ? vendor.unlockedRfqIds : [];
    return unlockedList.some((id) => {
      const s = String(id).toLowerCase();
      return s === normRfqId || s === normRfqNum;
    });
  }

  /**
   * Atomically unlocks / downloads an RFQ for a vendor, consuming 1 credit if using free allowance.
   * Re-downloading an already-unlocked RFQ does NOT deduct another credit.
   */
  async unlockRFQForVendor(vendorIdOrEmail, rfqIdOrNumber, options = {}) {
    const hadCachedVendor = this.getVendorById(vendorIdOrEmail, 'all');
    let vendor;
    if (pool.hasStorage()) {
      try {
        vendor = await this.getVendorByIdWithDBFallback(vendorIdOrEmail, 'all', { fresh: true });
      } catch (error) {
        logger.error('Vendor profile refresh failed before RFQ unlock; refusing to use stale credit state', {
          error,
          vendorLookupByEmail: String(vendorIdOrEmail || '').includes('@'),
          rfqId: rfqIdOrNumber,
          operation: 'unlock-rfq-vendor-refresh',
        }, 'STORE_SERVICE');
        const unavailable = new Error(RFQ_DOWNLOAD_ERRORS.VENDOR_STORAGE_UNAVAILABLE);
        unavailable.statusCode = 503;
        unavailable.code = 'PERSISTENCE_UNAVAILABLE';
        unavailable.cause = error;
        throw unavailable;
      }
    } else {
      vendor = await this.getVendorByIdWithDBFallback(vendorIdOrEmail, 'all');
    }

    if (!vendor) {
      return {
        success: false,
        error: hadCachedVendor && pool.hasStorage()
          ? RFQ_DOWNLOAD_ERRORS.VENDOR_STORAGE_MISSING
          : RFQ_DOWNLOAD_ERRORS.VENDOR_NOT_FOUND,
        notFound: true,
      };
    }

    const rfq = (await this.getRFQByIdAsync(rfqIdOrNumber)) || this.getRFQById(rfqIdOrNumber);
    if (!rfq) {
      return {
        success: false,
        error: RFQ_DOWNLOAD_ERRORS.RFQ_NOT_FOUND.replace('{rfqId}', String(rfqIdOrNumber)),
        notFound: true,
      };
    }

    const hasUnlimitedDownloads = hasUnlimitedDownloadAccess(vendor);

    // Check if vendor has permission to access the RFQ
    const mode = String(rfq.sourcingMode || '').trim().toLowerCase();
    const isV0 = mode === 'mode_0' || mode === 'v0' || mode === 'version_0';
    const isV2 = mode === 'mode_2' || mode === 'v2' || mode === 'version_2';
    const isV3 = mode === 'mode_3' || mode === 'v3' || mode === 'version_3';
    const isNetworkMode = isV0 || isV2 || isV3;

    const signals = this._rfqCategorySignals(rfq);
    const categoryMatches =
      signals.length === 0 ||
      !vendor.majorCategory ||
      signals.some((c) => this.vendorCoversCategory(vendor, c));

    if (!hasUnlimitedDownloads && !this.vendorCoversRFQ(vendor, rfq) && !(isNetworkMode && categoryMatches)) {
      return {
        success: false,
        error: RFQ_DOWNLOAD_ERRORS.UNAUTHORIZED,
        unauthorized: true,
      };
    }

    // Check if RFQ has already been unlocked for this vendor
    const isDirect = this.isVendorMappedToRfqBuyer(vendor, rfq);
    const unlockedList = Array.isArray(vendor.unlockedRfqIds) ? [...vendor.unlockedRfqIds] : [];
    const normRfqId = String(rfq.id);
    const normRfqNum = rfq.rfqNumber ? String(rfq.rfqNumber) : normRfqId;
    const isAlreadyUnlocked = unlockedList.includes(normRfqId) || unlockedList.includes(normRfqNum) || isDirect;

    const creditInfo = this.getVendorRfqCredits(vendor.id);

    if (isAlreadyUnlocked) {
      return {
        success: true,
        alreadyUnlocked: true,
        unlocked: true,
        freeCreditsRemaining: creditInfo.freeCreditsRemaining,
        creditCharged: 0,
        rfq,
        vendor,
      };
    }

    if (pool.hasStorage()) {
      let durableResult;
      try {
        durableResult = await domainQueries.unlockVendorRfqDurablyInDB({
          vendorId: vendor.id,
          rfqId: rfq.id,
          rfqNumber: rfq.rfqNumber || null,
          unlockId: `unl-${crypto.randomUUID()}`,
          transactionId: `tx-${crypto.randomUUID()}`,
          idempotencyKey: `tx-${vendor.id}-${rfq.id}`,
        });
        if (!durableResult) throw new Error('Vendor RFQ unlock did not return a persisted result.');
      } catch (error) {
        logger.error('Vendor RFQ unlock failed before response; durable balance and ledger state were preserved', {
          error,
          vendorId: vendor.id,
          rfqId: rfq.id,
          rfqNumber: rfq.rfqNumber,
          operation: 'unlock-rfq-vendor',
        }, 'STORE_SERVICE');
        if (error.statusCode === 400 || error.statusCode === 409) throw error;
        const unavailable = new Error(RFQ_DOWNLOAD_ERRORS.UNLOCK_STORAGE_UNAVAILABLE);
        unavailable.statusCode = 503;
        unavailable.code = 'PERSISTENCE_UNAVAILABLE';
        unavailable.cause = error;
        throw unavailable;
      }

      if (durableResult.creditsExhausted) {
        this.addAuditLog({
          userEmail: vendor.email || SYSTEM_ACTOR_EMAIL,
          action: `Download rejected for Vendor ${vendor.name || vendor.id} on RFQ ${rfq.rfqNumber}: Free RFQ download credits exhausted (0 balance).`,
          rfqNumber: rfq.rfqNumber,
        });
        return {
          success: false,
          error: RFQ_DOWNLOAD_ERRORS.CREDITS_EXHAUSTED,
          creditsExhausted: true,
          freeCreditsRemaining: durableResult.freeCreditsRemaining ?? 0,
        };
      }

      if (durableResult.vendor) {
        const cachedIndex = this.vendors.findIndex((candidate) => candidate.id === vendor.id);
        if (cachedIndex >= 0) this.vendors[cachedIndex] = durableResult.vendor;
        else this.vendors.unshift(durableResult.vendor);
        vendor = durableResult.vendor;
      }

      if (!durableResult.alreadyUnlocked) {
        const action = durableResult.creditCharged
          ? `Vendor ${vendor.name || vendor.id} unlocked RFQ ${rfq.rfqNumber}. 1 credit consumed. Balance remaining: ${durableResult.freeCreditsRemaining}.`
          : `Vendor ${vendor.name || vendor.id} unlocked RFQ ${rfq.rfqNumber} (${durableResult.source || 'subscription'} entitlement).`;
        this.addAuditLog({
          userEmail: vendor.email || SYSTEM_ACTOR_EMAIL,
          action,
          rfqNumber: rfq.rfqNumber,
        });
      }

      return {
        success: true,
        alreadyUnlocked: Boolean(durableResult.alreadyUnlocked),
        unlocked: true,
        freeCreditsRemaining: durableResult.freeCreditsRemaining,
        creditCharged: durableResult.creditCharged || 0,
        rfq,
        vendor,
      };
    }

    // Direct buyer-mapped, subscribed, or unlimited download vendors do not consume free credits
    if (isDirect || creditInfo.isSubscribed || hasUnlimitedDownloads) {
      if (!unlockedList.includes(normRfqId)) unlockedList.push(normRfqId);
      if (rfq.rfqNumber && !unlockedList.includes(normRfqNum)) unlockedList.push(normRfqNum);

      // Only a first-time download of a non-buyer-mapped RFQ counts against a
      // subscriber's plan quota; re-downloads and direct invites are free.
      const updates = { unlockedRfqIds: unlockedList };
      if (!isDirect) updates.rfqDownloadsUsed = (Number(vendor.rfqDownloadsUsed) || 0) + 1;
      Object.assign(vendor, updates);
      this.updateVendor(vendor.id, updates);
      const balanceAfter = this.getVendorRfqCredits(vendor.id).freeCreditsRemaining;
      await domainQueries.unlockRFQInDB({
        id: `unl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        vendorId: vendor.id,
        rfqId: rfq.id,
        creditCharged: 0,
        source: isDirect ? 'buyer_mapped' : (hasUnlimitedDownloads ? 'unlimited_entitlement' : 'subscription'),
      });

      this.addAuditLog({
        userEmail: vendor.email || SYSTEM_ACTOR_EMAIL,
        action: `Vendor ${vendor.name || vendor.id} unlocked RFQ ${rfq.rfqNumber} (unlimited entitlement).`,
        rfqNumber: rfq.rfqNumber,
      });

      return {
        success: true,
        alreadyUnlocked: false,
        unlocked: true,
        freeCreditsRemaining: balanceAfter,
        creditCharged: 0,
        rfq,
        vendor,
      };
    }

    // Free allowance check
    if (creditInfo.freeCreditsRemaining <= 0) {
      this.addAuditLog({
        userEmail: vendor.email || SYSTEM_ACTOR_EMAIL,
        action: `Download rejected for Vendor ${vendor.name || vendor.id} on RFQ ${rfq.rfqNumber}: Free RFQ download credits exhausted (0 balance).`,
        rfqNumber: rfq.rfqNumber,
      });
      return {
        success: false,
        error: RFQ_DOWNLOAD_ERRORS.CREDITS_EXHAUSTED,
        creditsExhausted: true,
        freeCreditsRemaining: 0,
      };
    }

    // Deduct 1 credit atomically and record unlock
    const newRemaining = Math.max(0, creditInfo.freeCreditsRemaining - 1);
    const newUsed = (creditInfo.freeCreditsUsed || 0) + 1;
    if (!unlockedList.includes(normRfqId)) unlockedList.push(normRfqId);
    if (rfq.rfqNumber && !unlockedList.includes(normRfqNum)) unlockedList.push(normRfqNum);

    const rfqDownloadsUsed = (Number(vendor.rfqDownloadsUsed) || 0) + 1;
    vendor.freeQuotationCredits = newRemaining;
    vendor.freeRfqDownloadCredits = newRemaining;
    vendor.freeCreditsUsed = newUsed;
    vendor.rfqDownloadsUsed = rfqDownloadsUsed;
    vendor.unlockedRfqIds = unlockedList;

    this.updateVendor(vendor.id, {
      freeQuotationCredits: newRemaining,
      freeRfqDownloadCredits: newRemaining,
      freeCreditsUsed: newUsed,
      rfqDownloadsUsed,
      unlockedRfqIds: unlockedList,
    });

    const unlockRecordId = `unl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await domainQueries.unlockRFQInDB({
      id: unlockRecordId,
      vendorId: vendor.id,
      rfqId: rfq.id,
      creditCharged: 1,
      source: 'free_credit',
    });

    await domainQueries.recordCreditTransactionInDB({
      id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      vendorId: vendor.id,
      rfqId: rfq.id,
      transactionType: 'RFQ_UNLOCK',
      amount: -1,
      balanceAfter: newRemaining,
      idempotencyKey: `tx-${vendor.id}-${rfq.id}`,
    });

    this.addAuditLog({
      userEmail: vendor.email || SYSTEM_ACTOR_EMAIL,
      action: `Vendor ${vendor.name || vendor.id} unlocked RFQ ${rfq.rfqNumber}. 1 credit consumed. Balance remaining: ${newRemaining}.`,
      rfqNumber: rfq.rfqNumber,
    });

    return {
      success: true,
      alreadyUnlocked: false,
      unlocked: true,
      freeCreditsRemaining: newRemaining,
      creditCharged: 1,
      rfq,
      vendor,
    };
  }

  /**
   * Deduct 1 quotation credit from a vendor after quotation submission on a new RFQ.
   * Resubmitting/updating a quote for the same RFQ does not consume an extra credit.
   * Buyer-mapped vendors quoting their respective buyer's RFQs do NOT consume free credits.
   * Subscribed vendors do not consume free credits below 0.
   */
  consumeVendorQuotationCredit(vendorId, rfqId) {
    const vendor = this.getVendorById(vendorId, 'all');
    if (!vendor) return null;

    const rfq = rfqId ? this.getRFQById(rfqId) : null;
    const mode = String(rfq?.sourcingMode || '').trim().toLowerCase();
    const isNetworkMode =
      mode === 'mode_0' ||
      mode === 'v0' ||
      mode === 'version_0' ||
      mode === 'mode_3' ||
      mode === 'v3' ||
      mode === 'version_3' ||
      mode === 'mode_2' ||
      mode === 'v2' ||
      mode === 'version_2';

    const isBuyerMapped = Boolean(
      rfq &&
      this.isVendorMappedToRfqBuyer(vendor, rfq)
    );

    const eligibility = this.checkVendorQuotationEligibility(vendor, rfq);
    const quotedRfqIds = Array.isArray(vendor.quotedRfqIds) ? [...vendor.quotedRfqIds] : [];
    const canonicalId = rfq?.id ? String(rfq.id).trim() : (rfqId ? String(rfqId).trim() : null);
    const canonicalRfqNumber = rfq?.rfqNumber ? String(rfq.rfqNumber).trim() : null;
    const alreadyQuoted = Boolean(
      (canonicalId && quotedRfqIds.includes(canonicalId)) ||
      (canonicalRfqNumber && quotedRfqIds.includes(canonicalRfqNumber)) ||
      (rfqId && quotedRfqIds.includes(String(rfqId).trim()))
    );

    if (!alreadyQuoted) {
      if (canonicalId) quotedRfqIds.push(canonicalId);
      if (canonicalRfqNumber && canonicalRfqNumber !== canonicalId) quotedRfqIds.push(canonicalRfqNumber);
    }

    // Also ensure RFQ is marked in unlockedRfqIds
    const unlockedList = Array.isArray(vendor.unlockedRfqIds) ? [...vendor.unlockedRfqIds] : [];
    if (canonicalId && !unlockedList.includes(canonicalId)) {
      unlockedList.push(canonicalId);
    }
    if (canonicalRfqNumber && !unlockedList.includes(canonicalRfqNumber)) {
      unlockedList.push(canonicalRfqNumber);
    }

    let newCredits = eligibility.freeCreditsRemaining;
    if (!alreadyQuoted && !eligibility.isSubscribed && !isBuyerMapped) {
      newCredits = Math.max(0, eligibility.freeCreditsRemaining - 1);
    }

    vendor.freeQuotationCredits = newCredits;
    vendor.freeRfqDownloadCredits = newCredits;
    vendor.quotedRfqIds = quotedRfqIds;
    vendor.unlockedRfqIds = unlockedList;

    const updated = this.updateVendor(vendor.id, {
      freeQuotationCredits: newCredits,
      freeRfqDownloadCredits: newCredits,
      quotedRfqIds,
      unlockedRfqIds: unlockedList,
    });

    logger.info(
      `Quotation credit updated for vendor ${vendor.name || vendor.id}: remaining ${newCredits} (RFQ ${rfqId || 'N/A'}, subscribed: ${eligibility.isSubscribed}, buyerMapped: ${isBuyerMapped})`,
      { vendorId: vendor.id, freeQuotationCredits: newCredits, isSubscribed: eligibility.isSubscribed, isBuyerMapped },
      'STORE_SERVICE'
    );

    return updated || vendor;
  }

  async consumeVendorQuotationCreditDurably(vendorId, rfqId) {
    if (!pool.hasStorage()) return this.consumeVendorQuotationCredit(vendorId, rfqId);

    let vendor;
    let rfq;
    try {
      [vendor, rfq] = await Promise.all([
        domainQueries.getVendorByIdFromDB(vendorId, { fresh: true }),
        domainQueries.getRFQByIdFromDB(rfqId),
      ]);
    } catch (error) {
      logger.error('Failed to load authoritative records before quotation credit update', { error, vendorId, rfqId }, 'STORE_SERVICE');
      const persistError = new Error('Quotation eligibility could not be verified from storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
    if (!vendor) {
      const persistError = new Error('The vendor could not be verified in storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
    if (!rfq) {
      const persistError = new Error('The RFQ could not be found in storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }

    const isResubmission = Array.isArray(rfq.quotes) && rfq.quotes.some((quote) => String(quote.vendorId) === String(vendor.id));
    const eligibility = this.checkVendorQuotationEligibility(vendor, rfq);
    if (!eligibility.eligible && !isResubmission) {
      const error = new Error('Your free quotation credits have been used. Upgrade your subscription to submit another quote.');
      error.statusCode = 403;
      error.code = 'VENDOR_QUOTE_CREDITS_EXHAUSTED';
      error.freeCreditsRemaining = eligibility.freeCreditsRemaining;
      throw error;
    }

    let result;
    try {
      result = await domainQueries.recordVendorQuoteCreditInDB({
        vendorId: vendor.id,
        rfqId: rfq.id,
        rfqNumber: rfq.rfqNumber || null,
        transactionId: `qtx-${crypto.randomUUID()}`,
        idempotencyKey: `rfq-quote:${vendor.id}:${rfq.id}`,
        isBuyerMapped: this.isVendorMappedToRfqBuyer(vendor, rfq),
        isResubmission,
      });
    } catch (error) {
      logger.error('Failed to persist vendor quotation credit and ledger together', { error, vendorId: vendor.id, rfqId: rfq.id }, 'STORE_SERVICE');
      if (error.statusCode === 400 || error.statusCode === 403 || error.statusCode === 409) throw error;
      const persistError = new Error('Quotation credits could not be saved. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      persistError.cause = error;
      throw persistError;
    }
    if (!result) {
      const persistError = new Error('Quotation credit update returned no persisted vendor.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
    if (result.creditsExhausted) {
      const error = new Error('Your free quotation credits have been used. Upgrade your subscription to submit another quote.');
      error.statusCode = 403;
      error.code = 'VENDOR_QUOTE_CREDITS_EXHAUSTED';
      error.freeCreditsRemaining = result.freeCreditsRemaining;
      throw error;
    }

    const cachedIndex = this.vendors.findIndex((item) => item.id === result.vendor.id);
    if (cachedIndex === -1) this.vendors.unshift(result.vendor);
    else this.vendors[cachedIndex] = result.vendor;
    logger.info('Vendor quotation credit update confirmed by durable storage', {
      vendorId: vendor.id,
      rfqId: rfq.id,
      creditCharged: result.creditCharged,
      freeCreditsRemaining: result.vendor.freeQuotationCredits,
      alreadyQuoted: result.alreadyQuoted,
    }, 'STORE_SERVICE');
    return result.vendor;
  }


  // ==========================================
  // ZOHO PAYMENT LINKS
  // ==========================================

  /**
   * Look up a payment link by Zoho's own id — the identifier the webhook and
   * the reconciliation poller both key off.
   *
   * Falls back to Neon when the in-memory cache misses, rather than trusting
   * only whatever this process happened to hydrate at boot. This matters
   * concretely: the link may have been created by a *different* process
   * instance than the one now receiving Zoho's webhook (a redeploy, a
   * cold-started serverless/sleeping-dyno backend between checkout and the
   * webhook firing, or simply two instances behind a load balancer) — that
   * process's in-memory paymentLinks array never saw the link get created, so
   * a memory-only lookup here silently reports "unknown payment link" and the
   * subscription never activates, even though the row is sitting right there
   * in Neon. A DB hit is hydrated into the in-memory cache so the immediately
   * following updatePaymentLinkRecord/activate* calls (which are memory-only)
   * still work.
   */
  async getPaymentLinkByZohoId(zohoPaymentLinkId) {
    const cached = this.paymentLinks.find((l) => l.zohoPaymentLinkId === zohoPaymentLinkId);
    if (cached) return cached;
    if (!pool.hasStorage()) return null;
    const fromDB = await domainQueries.getPaymentLinkByZohoIdFromDB(zohoPaymentLinkId);
    if (!fromDB) return null;
    if (!this.paymentLinks.some((l) => l.id === fromDB.id)) {
      this.paymentLinks.unshift(fromDB);
    }
    return fromDB;
  }

  /**
   * Payment links still in a reconcilable status, re-synced from Neon first —
   * same cross-process reasoning as getPaymentLinkByZohoId: the reconciliation
   * poller runs in whichever process happens to be alive at the 10-minute
   * mark, which is not guaranteed to be the process that created the link.
   */
  async getPaymentLinksByStatusIn(statuses) {
    if (pool.hasStorage()) {
      const requestedStatuses = new Set(
        (Array.isArray(statuses) ? statuses : []).map((status) => String(status || '').trim()).filter(Boolean)
      );
      if (requestedStatuses.size === 0) return [];

      try {
        const fromDB = await domainQueries.getPaymentLinksByStatusFromDB([...requestedStatuses]);
        const databaseIds = new Set(fromDB.map((link) => link.id));
        const byId = new Map(
          this.paymentLinks
            .filter((link) => !requestedStatuses.has(link.status) && !databaseIds.has(link.id))
            .map((link) => [link.id, link])
        );
        for (const link of fromDB) byId.set(link.id, link);
        this.paymentLinks = Array.from(byId.values());
        return fromDB;
      } catch (error) {
        logger.error('Failed to load reconcilable payment links from authoritative storage', {
          error,
          statuses: [...requestedStatuses],
          operation: 'get-payment-links-by-status',
        }, 'STORE_SERVICE');
        throw error;
      }
    }
    const requestedStatuses = new Set(Array.isArray(statuses) ? statuses : []);
    return this.paymentLinks.filter((link) => requestedStatuses.has(link.status));
  }

  /**
   * A vendor's own billing history, newest first — re-synced from Neon first
   * for the same reason getPaymentLinksByStatusIn is: a link created by a
   * different process instance than the one now serving this request would
   * otherwise be invisible.
   */
  async getPaymentLinksForVendor(vendorId) {
    if (pool.hasStorage()) {
      const fromDB = await domainQueries.getPaymentLinksByVendorFromDB(vendorId);
      const byId = new Map(this.paymentLinks.map((l) => [l.id, l]));
      for (const link of fromDB) byId.set(link.id, link);
      this.paymentLinks = Array.from(byId.values());
    }
    return this.paymentLinks
      .filter((l) => l.payerType === 'vendor' && l.vendorId === vendorId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /** Same as getPaymentLinksForVendor, scoped to a buyer account instead. */
  async getPaymentLinksForBuyer(buyerAccountId) {
    if (pool.hasStorage()) {
      const fromDB = await domainQueries.getPaymentLinksByBuyerFromDB(buyerAccountId);
      const byId = new Map(this.paymentLinks.map((l) => [l.id, l]));
      for (const link of fromDB) byId.set(link.id, link);
      this.paymentLinks = Array.from(byId.values());
    }
    return this.paymentLinks
      .filter((l) => l.payerType === 'buyer' && l.buyerAccountId === buyerAccountId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Look up a single payment link by its own (not Zoho's) id — used by the
   * invoice download route. Falls back to Neon on a memory miss, same
   * cross-process reasoning as getPaymentLinkByZohoId.
   */
  async getPaymentLinkById(id) {
    const cached = this.paymentLinks.find((l) => l.id === id);
    if (cached) return cached;
    if (!pool.hasStorage()) return null;
    const fromDB = typeof domainQueries.getPaymentLinkByIdFromDB === 'function'
      ? await domainQueries.getPaymentLinkByIdFromDB(id)
      : null;
    if (fromDB) {
      if (!this.paymentLinks.some((l) => l.id === fromDB.id)) {
        this.paymentLinks.unshift(fromDB);
      }
      return fromDB;
    }
    const allFromDB = await domainQueries.getPaymentLinksFromDB(50);
    const link = allFromDB.find((l) => l.id === id);
    if (link && !this.paymentLinks.some((l) => l.id === link.id)) {
      this.paymentLinks.unshift(link);
    }
    return link || null;
  }

  _buildPaymentLinkRecord({
    id,
    zohoPaymentLinkId,
    vendorId,
    buyerAccountId,
    payerType = 'vendor',
    planId,
    billingDuration,
    amount,
    paymentUrl,
    status,
    rawResponse,
  }) {
    return {
      id,
      zohoPaymentLinkId,
      vendorId: vendorId || null,
      buyerAccountId: buyerAccountId || null,
      payerType,
      planId,
      billingDuration: billingDuration || null,
      amount,
      paymentUrl,
      status,
      rawResponse: rawResponse || null,
      activated: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  createPaymentLinkRecord(data) {
    const link = this._buildPaymentLinkRecord(data);
    this.paymentLinks.unshift(link);
    this._persistPaymentLink(link);
    return link;
  }

  async createPaymentLinkRecordDurably(data) {
    const link = this._buildPaymentLinkRecord(data);
    const storageConfigured = pool.hasStorage();
    let persisted;
    try {
      persisted = await domainQueries.upsertPaymentLinkInDB(link);
      if (storageConfigured && !persisted) {
        throw new Error('Payment-link upsert completed without a persisted row');
      }
    } catch (error) {
      logger.error('Failed to persist payment-link record after provider creation', {
        error,
        paymentLinkId: link.id,
        zohoPaymentLinkId: link.zohoPaymentLinkId,
        operation: 'create-payment-link-record',
      }, 'STORE_SERVICE');
      const persistError = new Error(PERSISTENCE_MESSAGES.PAYMENT_LINK_TRACKING_FAILED);
      persistError.statusCode = 503;
      persistError.code = 'PAYMENT_LINK_PERSISTENCE_UNAVAILABLE';
      persistError.cause = error;
      throw persistError;
    }

    const savedLink = persisted || link;
    this.paymentLinks.unshift(savedLink);
    return savedLink;
  }

  updatePaymentLinkRecord(id, updates) {
    const idx = this.paymentLinks.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    const updated = { ...this.paymentLinks[idx], ...updates, updatedAt: new Date().toISOString() };
    this.paymentLinks[idx] = updated;
    this._persistPaymentLink(updated);
    return updated;
  }

  async updatePaymentLinkRecordDurably(id, updates) {
    const storageConfigured = pool.hasStorage();
    let idx = this.paymentLinks.findIndex((link) => link.id === id);
    let previous = idx >= 0 ? this.paymentLinks[idx] : null;
    if (!storageConfigured && !previous) return null;

    if (!storageConfigured && previous?.activated && updates.status && String(updates.status).toLowerCase() !== 'paid') {
      logger.warn('Ignored a non-paid status update for an already activated payment link', {
        paymentLinkId: id,
        attemptedStatus: updates.status,
      }, 'STORE_SERVICE');
      return previous;
    }

    let persisted;
    if (storageConfigured) {
      try {
        persisted = await paymentActivationQueries.updatePaymentLinkStatusInDB(id, updates);
      } catch (error) {
        logger.error('Failed to atomically update payment-link status', {
          error,
          paymentLinkId: id,
          operation: 'update-payment-link-status',
        }, 'STORE_SERVICE');
        const persistError = new Error(PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE);
        persistError.statusCode = 503;
        persistError.code = 'PERSISTENCE_UNAVAILABLE';
        persistError.cause = error;
        throw persistError;
      }

      if (!persisted) {
        try {
          previous = await domainQueries.getPaymentLinkByIdFromDB(id, { fresh: true });
        } catch (error) {
          logger.error('Failed to verify payment-link status after an atomic update conflict', {
            error,
            paymentLinkId: id,
            operation: 'read-payment-link-after-update-conflict',
          }, 'STORE_SERVICE');
          const persistError = new Error(PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE);
          persistError.statusCode = 503;
          persistError.code = 'PERSISTENCE_UNAVAILABLE';
          persistError.cause = error;
          throw persistError;
        }
        if (!previous) {
          this.paymentLinks = this.paymentLinks.filter((link) => link.id !== id);
          return null;
        }
        idx = this.paymentLinks.findIndex((link) => link.id === previous.id);
        if (previous.activated && updates.status && String(updates.status).toLowerCase() !== 'paid') {
          logger.warn('Ignored a non-paid status update for an already activated payment link', {
            paymentLinkId: id,
            attemptedStatus: updates.status,
          }, 'STORE_SERVICE');
          if (idx >= 0) this.paymentLinks[idx] = previous;
          else this.paymentLinks.unshift(previous);
          return previous;
        }
        const persistError = new Error(PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE);
        persistError.statusCode = 503;
        persistError.code = 'PERSISTENCE_UNAVAILABLE';
        logger.error('Atomic payment-link status update affected no durable row', {
          paymentLinkId: id,
          operation: 'update-payment-link-status',
        }, 'STORE_SERVICE');
        throw persistError;
      }
    }

    const savedLink = persisted || { ...previous, ...updates, updatedAt: new Date().toISOString() };
    if (idx >= 0) this.paymentLinks[idx] = savedLink;
    else this.paymentLinks.unshift(savedLink);
    return savedLink;
  }

  /**
   * Grant a vendor the plan they just paid for.
   *
   * Mirrors the reference app's PaymentLink activation: flips the vendor's
   * subscriptionPlan and resets their download quota. Idempotent — a link
   * already marked `activated` is a no-op, so both the webhook and the
   * reconciliation poller can safely call this for the same paid link without
   * double-granting.
   */
  activateVendorSubscriptionFromPayment(paymentLinkId) {
    const link = this.paymentLinks.find((l) => l.id === paymentLinkId);
    if (!link || link.activated) return null;

    const vendor = this.getVendorById(link.vendorId);
    if (!vendor) return null;

    this.updateVendor(vendor.id, { subscriptionPlan: link.planId, rfqDownloadsUsed: 0 });
    const updatedLink = this.updatePaymentLinkRecord(link.id, { activated: true });

    this.addAuditLog({
      userEmail: SYSTEM_ACTOR_EMAIL,
      action: `Activated ${link.planId} subscription for vendor ${vendor.name || vendor.email} via Zoho payment ${link.zohoPaymentLinkId}`,
    });

    return updatedLink;
  }

  /**
   * Grant a buyer the plan they just paid for.
   *
   * Mirrors activateVendorSubscriptionFromPayment. `remainingFreeRFQs` is only
   * reset for `free_trial` — the three paid tiers gate by sourcing mode, not a
   * numeric RFQ quota, so there is nothing to reset for them.
   */
  activateBuyerSubscriptionFromPayment(paymentLinkId) {
    const link = this.paymentLinks.find((l) => l.id === paymentLinkId);
    if (!link || link.activated) return null;

    const buyer = this.buyerAccounts.find((a) => a.id === link.buyerAccountId);
    if (!buyer) return null;

    const updates = {
      subscriptionPlan: link.planId,
      ...(link.billingDuration ? { billingDuration: link.billingDuration } : {}),
    };
    if (link.planId === 'free_trial') {
      updates.remainingFreeRFQs = BUYER_FREE_TRIAL_RFQ_CREDITS;
    }
    this.updateBuyerAccount(buyer.id, updates);
    const updatedLink = this.updatePaymentLinkRecord(link.id, { activated: true });

    this.addAuditLog({
      userEmail: SYSTEM_ACTOR_EMAIL,
      action: `Activated ${link.planId}${link.billingDuration ? ` (${link.billingDuration})` : ''} subscription for buyer ${buyer.organizationName || buyer.corporateEmail} via Zoho payment ${link.zohoPaymentLinkId}`,
    });

    return updatedLink;
  }

  async activatePaymentLinkDurably(paymentLinkId, rawResponse) {
    if (!pool.hasStorage()) {
      const currentLink = this.paymentLinks.find((link) => link.id === paymentLinkId);
      if (!currentLink || currentLink.activated) return currentLink || null;
      const link = this.updatePaymentLinkRecord(paymentLinkId, { status: 'PAID', rawResponse });
      return link.payerType === 'buyer'
        ? this.activateBuyerSubscriptionFromPayment(paymentLinkId)
        : this.activateVendorSubscriptionFromPayment(paymentLinkId);
    }

    try {
      const activation = await paymentActivationQueries.activatePaymentLinkSubscriptionInDB({ paymentLinkId, rawResponse });
      if (!activation?.link) return null;
      if (!activation.link.activated) {
        throw Object.assign(
          new Error('The payment link was not activated because its subscription owner could not be updated.'),
          { statusCode: 409, code: 'PAYMENT_ACTIVATION_CONFLICT' }
        );
      }

      const linkIndex = this.paymentLinks.findIndex((link) => link.id === paymentLinkId);
      if (linkIndex >= 0) this.paymentLinks[linkIndex] = activation.link;
      else this.paymentLinks.unshift(activation.link);

      if (activation.payer) {
        const collection = activation.payerType === 'buyer' ? this.buyerAccounts : this.vendors;
        const payerIndex = collection.findIndex((payer) => payer.id === activation.payer.id);
        if (payerIndex >= 0) collection[payerIndex] = activation.payer;
        else collection.unshift(activation.payer);
        if (activation.payerType === 'buyer' && this.activeBuyerAccount?.id === activation.payer.id) {
          this.activeBuyerAccount = activation.payer;
        }
      }

      if (activation.activated) {
        const payerName = activation.payer?.organizationName || activation.payer?.name || activation.payer?.email || activation.payer?.corporateEmail || activation.payer?.id;
        this.addAuditLog({
          userEmail: SYSTEM_ACTOR_EMAIL,
          action: `Activated ${activation.link.planId} subscription for ${activation.payerType} ${payerName} via Zoho payment ${activation.link.zohoPaymentLinkId}`,
        });
      }
      return activation.link;
    } catch (error) {
      logger.error('Atomic payment subscription activation failed', {
        error,
        paymentLinkId,
        payerType: this.paymentLinks.find((link) => link.id === paymentLinkId)?.payerType,
      }, 'STORE_SERVICE');
      throw error;
    }
  }

  _prepareVendorRatingRevision(vendor, ratingData) {
    const { qualityScore, costScore, deliveryScore, remarks, buyerCompany, buyerName, buyerEmail } = ratingData;
    const normalizedQualityScore = Number(qualityScore);
    const normalizedCostScore = Number(costScore);
    const normalizedDeliveryScore = Number(deliveryScore);
    // An unrated vendor has no earlier score to weight, so its first revision uses the
    // buyer's own average as the base. The recorded previous values stay null.
    const previousScore = optionalScore(vendor.score);
    const previousRating = optionalScore(vendor.rating);
    const buyerBaseline = parseFloat((((normalizedQualityScore + normalizedCostScore + normalizedDeliveryScore) / 3)).toFixed(2));
    const { buyerAverage, newCompositeScore, newRating } = calculateRevisedRating({
      qualityScore: normalizedQualityScore,
      costScore: normalizedCostScore,
      deliveryScore: normalizedDeliveryScore,
      previousScore: previousScore ?? buyerBaseline,
    });

    const revisionRecord = {
      id: `rev-${crypto.randomUUID()}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      buyerCompany: buyerCompany || null,
      buyerName: buyerName || null,
      buyerEmail: buyerEmail || null,
      timestamp: new Date().toISOString(),
      qualityScore: normalizedQualityScore,
      costScore: normalizedCostScore,
      deliveryScore: normalizedDeliveryScore,
      buyerAverage,
      previousScore,
      newCompositeScore,
      previousRating,
      newRating,
      remarks: remarks || 'Periodic Buyer Rating Assessment',
      emailDispatched: Boolean(vendor.email),
    };
    revisionRecord.shaSignature = `sha256-${crypto.createHash('sha256').update(JSON.stringify(revisionRecord)).digest('hex')}`;

    const history = [
      ...(Array.isArray(vendor.ratingRevisionHistory) ? vendor.ratingRevisionHistory : []),
    ];
    history.unshift(revisionRecord);

    return {
      revisionRecord,
      updates: {
        score: newCompositeScore,
        rating: newRating,
        latestRatingRevision: revisionRecord,
        ratingRevisionHistory: history,
      },
      newCompositeScore,
      newRating,
    };
  }

  _sendVendorRatingRevisionEmail(vendor, ratingData, prepared) {
    const { qualityScore, costScore, deliveryScore, remarks, buyerCompany, buyerName } = ratingData;
    const { newCompositeScore, newRating } = prepared;
    // Send rating revision email to the vendor
    if (vendor.email) {
      let emailPayload;
      try {
        emailPayload = mailerService.buildRatingRevisionEmail({
          to: vendor.email,
          recipientName: vendor.contactPerson || vendor.name,
          vendorName: vendor.name,
          buyerCompany: buyerCompany || 'A buyer on Procucev',
          buyerName: buyerName || '',
          // null for a vendor that has never been rated; the email template must say so.
          previousRating: prepared.revisionRecord.previousRating,
          newRating: newRating,
          previousScore: prepared.revisionRecord.previousScore,
          newScore: newCompositeScore,
          remarks: remarks || 'Periodic Buyer Rating Assessment',
          qualityScore,
          costScore,
          deliveryScore,
        });
      } catch (error) {
        logger.error('Rating revision email could not be built; no email was sent', { vendorId: vendor.id, error }, 'STORE_SERVICE');
        return;
      }

      this._background(
        mailerService.sendVendorIngestionEmail(emailPayload, 'rating-revision'),
        'Failed to send rating revision email',
        {
          deliveryChannel: 'email',
          operation: 'vendor-rating-revision-email',
          vendorId: vendor.id,
        }
      );
    }
  }

  _auditVendorRatingRevision(vendor, ratingData, prepared) {
    const { buyerEmail } = ratingData;
    const { newCompositeScore, newRating } = prepared;
    this.addAuditLog({
      userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
      action: `Revised vendor rating for ${vendor.name}: ${optionalScore(vendor.rating) ?? VENDOR_RATING_LABELS.UNRATED} -> ${newRating} (Score: ${newCompositeScore})`,
    });
  }

  reviseVendorRating(vendorId, ratingData, scopedBuyerId = null) {
    const vendor = this.getVendorById(vendorId, scopedBuyerId);
    if (!vendor) return null;
    const prepared = this._prepareVendorRatingRevision(vendor, ratingData);
    const updatedVendor = this.updateVendor(vendor.id, prepared.updates);
    if (!pool.hasStorage()) this._sendVendorRatingRevisionEmail(vendor, ratingData, prepared);
    this._auditVendorRatingRevision(vendor, ratingData, prepared);

    return { updatedVendor, revisionRecord: prepared.revisionRecord };
  }

  async reviseVendorRatingDurably(vendorId, ratingData, scopedBuyerId = null) {
    let vendor = this.getVendorById(vendorId, scopedBuyerId);
    if (!vendor && pool.hasStorage()) {
      vendor = await this.getVendorByIdWithDBFallback(vendorId, scopedBuyerId, { fresh: true });
    }
    if (!vendor) return null;
    let revisionSource = vendor;
    let prepared;
    const updatedVendor = await this.updateVendorDurably(vendor.id, (currentVendor) => {
      revisionSource = currentVendor;
      prepared = this._prepareVendorRatingRevision(currentVendor, ratingData);
      return prepared.updates;
    });
    if (!updatedVendor) return null;

    // Persistent updates atomically enqueue their email through the vendor
    // rating revision database trigger. Only memory-only mode needs a direct
    // send, because it has no durable event-outbox table or dispatcher.
    if (!pool.hasStorage()) this._sendVendorRatingRevisionEmail(revisionSource, ratingData, prepared);
    this._auditVendorRatingRevision(revisionSource, ratingData, prepared);
    return { updatedVendor, revisionRecord: prepared.revisionRecord };
  }

  requestVendorEvaluation(vendorId, options = {}, scopedBuyerId = null) {
    const vendor = this.getVendorById(vendorId, scopedBuyerId);
    if (!vendor) return null;

    const requestedAt = new Date().toISOString();
    const buyerCompany = options.buyerCompany || 'A buyer on Procucev';
    const buyerName = options.buyerName || '';
    const buyerEmail = options.buyerEmail || '';
    const notes = options.notes || '';

    const updates = {
      evaluationRequested: true,
      evaluationRequestedAt: requestedAt,
      evaluationRequestedBy: buyerCompany,
      status: vendor.status || 'PENDING EVALUATION',
    };

    const updatedVendor = this.updateVendor(vendor.id, updates);

    if (vendor.email) {
      try {
        void mailerService.sendVendorEvaluationRequestEmail({
          to: vendor.email,
          recipientName: vendor.contactPerson || vendor.name,
          vendorName: vendor.name,
          buyerCompany,
          buyerName,
          buyerEmail,
          notes,
        });
      } catch (emailErr) {
        logger.error('Failed to dispatch evaluation request email', emailErr, 'STORE_SERVICE');
      }
    }

    this.addFeedItem({
      title: `Vendor Evaluation Requested: ${vendor.name}`,
      description: `Buyer ${buyerCompany} requested 360° performance evaluation from ${vendor.name} (${vendor.email}).`,
      source: 'system',
      vendorName: vendor.name,
    });

    this.addAuditLog({
      userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
      action: `Requested performance evaluation for vendor ${vendor.name} (${vendor.email}) on behalf of ${buyerCompany}.`,
    });

    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorEmail: vendor.email,
      evaluationRequested: true,
      evaluationRequestedAt: requestedAt,
      evaluationRequestedBy: buyerCompany,
      status: updatedVendor?.status || vendor.status,
    };
  }

  async requestVendorEvaluationDurably(vendorId, options = {}, scopedBuyerId = null) {
    let vendor = this.getVendorById(vendorId, scopedBuyerId);
    if (!vendor && pool.hasStorage()) {
      vendor = await this.getVendorByIdWithDBFallback(vendorId, scopedBuyerId, { fresh: true });
    }
    if (!vendor) return null;

    const requestedAt = new Date().toISOString();
    const buyerCompany = options.buyerCompany || 'A buyer on Procucev';
    const buyerName = options.buyerName || '';
    const buyerEmail = options.buyerEmail || '';
    const notes = options.notes || '';

    const updates = {
      evaluationRequested: true,
      evaluationRequestedAt: requestedAt,
      evaluationRequestedBy: buyerCompany,
      status: vendor.status || 'PENDING EVALUATION',
    };

    const updatedVendor = await this.updateVendorDurably(vendor.id, () => updates);

    if (vendor.email) {
      try {
        void mailerService.sendVendorEvaluationRequestEmail({
          to: vendor.email,
          recipientName: vendor.contactPerson || vendor.name,
          vendorName: vendor.name,
          buyerCompany,
          buyerName,
          buyerEmail,
          notes,
        });
      } catch (emailErr) {
        logger.error('Failed to dispatch evaluation request email', emailErr, 'STORE_SERVICE');
      }
    }

    this.addFeedItem({
      title: `Vendor Evaluation Requested: ${vendor.name}`,
      description: `Buyer ${buyerCompany} requested 360° performance evaluation from ${vendor.name} (${vendor.email}).`,
      source: 'system',
      vendorName: vendor.name,
    });

    this.addAuditLog({
      userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
      action: `Requested performance evaluation for vendor ${vendor.name} (${vendor.email}) on behalf of ${buyerCompany}.`,
    });

    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorEmail: vendor.email,
      evaluationRequested: true,
      evaluationRequestedAt: requestedAt,
      evaluationRequestedBy: buyerCompany,
      status: updatedVendor?.status || vendor.status,
    };
  }

  // ==========================================
  // 3. RFQS
  // ==========================================
  /**
   * Close due RFQs through one conditional database update before changing the
   * cache or sending closure notifications. The in-memory path is retained for
   * local in-memory operation when no persistent store is configured.
   */
  async closeExpiredRFQsDurably(now = Date.now()) {
    const nowMs = Number(now);
    if (!Number.isFinite(nowMs)) throw new TypeError('Closure time must be a valid timestamp.');
    const cutoffIso = new Date(nowMs - RFQ_AUTO_CLOSE_AFTER_MS).toISOString();
    const closedAtIso = new Date(nowMs).toISOString();
    let closedList;

    if (pool.hasStorage()) {
      try {
        closedList = await domainQueries.closeExpiredRFQsInDB(
          cutoffIso,
          closedAtIso,
          RFQ_AUTO_CLOSE_REASON
        );
      } catch (error) {
        logger.error('Durable RFQ closure query failed; cached RFQs were left unchanged', {
          error,
          cutoffIso,
          operation: 'close-expired-rfqs',
        }, 'STORE_SERVICE');
        throw error;
      }
    } else {
      closedList = this.rfqs.reduce((closed, rfq, index) => {
        const createdMs = rfq?.createdAt ? new Date(rfq.createdAt).getTime() : 0;
        if (
          rfq &&
          createdMs > 0 &&
          nowMs - createdMs >= RFQ_AUTO_CLOSE_AFTER_MS &&
          rfq.status !== 'Closed' &&
          rfq.status !== 'PO Generated' &&
          !rfq.poFinalised &&
          !rfq.poNumber &&
          rfq.status !== 'Expired'
        ) {
          const updated = {
            ...rfq,
            status: 'Closed',
            closedAt: closedAtIso,
            closedReason: RFQ_AUTO_CLOSE_REASON,
          };
          this.rfqs[index] = updated;
          closed.push(updated);
        }
        return closed;
      }, []);
    }

    for (const updated of closedList) {
      const index = this.rfqs.findIndex((rfq) => rfq.id === updated.id || rfq.rfqNumber === updated.rfqNumber);
      if (index >= 0) this.rfqs[index] = updated;
      try {
        this.notifyOfRFQClosure(updated);
      } catch (error) {
        logger.error('RFQ closure was persisted but closure notification processing failed', {
          error,
          rfqId: updated.id,
          rfqNumber: updated.rfqNumber,
        }, 'STORE_SERVICE');
      }
    }

    if (closedList.length > 0) {
      logger.info('Automatically closed expired RFQs after durable status transition', {
        closedCount: closedList.length,
        rfqIds: closedList.map((rfq) => rfq.id),
      }, 'STORE_SERVICE');
    }
    return closedList;
  }

  _reconcileRFQFollowUpStats(rfq) {
    if (!rfq) return rfq;
    const hasAssigned = Array.isArray(rfq.assignedVendors) && rfq.assignedVendors.length > 0;
    const assigned = hasAssigned
      ? rfq.assignedVendors
      : (Array.isArray(rfq.followUpData?.vendors) && rfq.followUpData.vendors.length > 0 ? rfq.followUpData.vendors : []);

    let vCount = assigned.length;
    const fupExisting = rfq.followUpData;
    if (vCount === 0) {
      vCount = fupExisting?.totalInvited || fupExisting?.whatsappStats?.total || fupExisting?.smsStats?.total || fupExisting?.emailStats?.total || rfq.procucevVendorCount || 0;
    } else {
      vCount = Math.max(
        vCount,
        rfq.procucevVendorCount || 0,
        fupExisting?.totalInvited || 0,
        fupExisting?.whatsappStats?.total || 0,
        fupExisting?.smsStats?.total || 0,
        fupExisting?.emailStats?.total || 0
      );
    }

    if (vCount === 0 || rfq.status === 'Draft' || rfq.status === 'Parsing' || rfq.status === 'Ingested') {
      if (rfq.followUpData) {
        rfq.followUpData.totalInvited = 0;
      }
      return rfq;
    }

    if (!rfq.followUpData) {
      rfq.followUpData = {
        rfqNumber: rfq.rfqNumber,
        totalInvited: vCount,
        respondedCount: 0,
        callStats: { total: 0, connected: 0, avgDuration: null },
        whatsappStats: { total: vCount, delivered: 0, read: 0, replied: 0 },
        smsStats: { total: vCount, delivered: 0, clicked: 0 },
        emailStats: { total: vCount, delivered: 0, sent24h: 0, opened: 0 },
        autoChasingEnabled: true,
        vendors: [...assigned],
      };
    }

    const fup = rfq.followUpData;
    fup.totalInvited = Math.max(
      fup.totalInvited || 0,
      vCount,
      fup.whatsappStats?.total || 0,
      fup.smsStats?.total || 0,
      fup.emailStats?.total || 0
    );
    if (!Array.isArray(fup.vendors) || fup.vendors.length === 0) {
      fup.vendors = [...assigned];
    }

    const quotesCount = Math.max(
      Array.isArray(rfq.quotes) ? rfq.quotes.length : 0,
      rfq.quotesCount || 0
    );
    const vendorSubmittedCount = Array.isArray(fup.vendors)
      ? fup.vendors.filter((v) => v && (v.bidStatus === 'Submitted' || v.overallStatus === 'Responded')).length
      : 0;
    fup.respondedCount = Math.max(fup.respondedCount || 0, quotesCount, vendorSubmittedCount);

    if (Array.isArray(rfq.quotes) && rfq.quotes.length > 0 && Array.isArray(fup.vendors)) {
      rfq.quotes.forEach((q) => {
        if (!q) return;
        const v = fup.vendors.find(
          (vend) =>
            vend &&
            ((q.vendorId && (vend.vendorId === q.vendorId || vend.id === q.vendorId)) ||
              (q.vendorName && vend.vendorName === q.vendorName) ||
              (q.vendorEmail && vend.email === q.vendorEmail))
        );
        if (v) {
          v.bidStatus = 'Submitted';
          v.overallStatus = 'Responded';
        }
      });
    }

    // Channel counts and per-vendor statuses come only from what the chaser services
    // recorded. The age of an RFQ is not evidence that a message went out, so no
    // delivered count or sent flag is derived from elapsed time.
    fup.callStats = { total: 0, connected: 0, avgDuration: null };

    fup.emailStats = fup.emailStats || { total: vCount, delivered: 0, sent24h: 0, opened: 0 };
    fup.emailStats.total = Math.max(fup.emailStats.total || 0, vCount);
    fup.emailStats.delivered = recordedCount(fup.emailStats.delivered);

    fup.smsStats = fup.smsStats || { total: vCount, delivered: 0, clicked: 0 };
    fup.smsStats.total = Math.max(fup.smsStats.total || 0, vCount);
    fup.smsStats.delivered = recordedCount(fup.smsStats.delivered);

    fup.whatsappStats = fup.whatsappStats || { total: vCount, delivered: 0, read: 0, replied: 0 };
    fup.whatsappStats.total = Math.max(fup.whatsappStats.total || 0, vCount);
    fup.whatsappStats.delivered = recordedCount(fup.whatsappStats.delivered);

    if (Array.isArray(fup.vendors)) {
      fup.vendors.forEach((v) => {
        if (!v) return;
        if (typeof v.emailSent !== 'boolean') v.emailSent = false;
        if (!v.email24h) v.email24h = v.email ? { ...v.email } : { status: 'pending' };
        if (!v.sms) v.sms = { status: 'pending' };
        if (!v.whatsapp) v.whatsapp = { status: 'pending' };
      });
    }

    return rfq;
  }

  getRFQs(buyerAccountId = null) {
    let list = this.rfqs;
    if (buyerAccountId) {
      const targetId = String(buyerAccountId).toLowerCase();
      list = list.filter((r) => {
        if (String(r.buyerAccountId || '').toLowerCase() === targetId) return true;
        if (Array.isArray(r.sharedBuyerAccountIds) && r.sharedBuyerAccountIds.some((id) => String(id).toLowerCase() === targetId)) {
          return true;
        }
        return false;
      });
    }
    return list.map((r) => {
      const item = this._reconcileRFQFollowUpStats(normalizeRFQForRead(r));
      return item.quotes ? { ...item, quotes: evaluateQuotes(item.quotes) } : item;
    });
  }

  /**
   * Re-sync RFQs from Neon PostgreSQL so records inserted by external processes
   * (e.g. check-email CLI, background workers) are merged into memory.
   */
  async syncRFQsFromDB(force = false, buyerAccountId = null) {
    if (!pool.hasStorage()) return this.getRFQs(buyerAccountId);
    const now = Date.now();
    const cacheKey = buyerAccountId || '__all__';
    const lastSync = buyerAccountId ? this._lastRfqSyncMap.get(cacheKey) : this._lastRfqSyncTime;
    if (!force && lastSync && (now - lastSync < 25000)) {
      return this.getRFQs(buyerAccountId);
    }
    const pendingSync = this._rfqSyncPromises.get(cacheKey);
    if (pendingSync) {
      return pendingSync;
    }

    const syncPromise = (async () => {
      try {
        const allFromDB = buyerAccountId
          ? await domainQueries.getRFQsFromDB(buyerAccountId, 100)
          : await domainQueries.getRFQsFromDB(null, 200);
        if (!Array.isArray(allFromDB)) {
          throw new Error('RFQ database query returned an invalid result');
        }

        const byId = new Map(this.rfqs.map((r) => [r.id, r]));
        for (const rfq of allFromDB) {
          const normalizedRFQ = this._reconcileRFQFollowUpStats(normalizeRFQForRead(rfq));
          byId.set(normalizedRFQ.id, normalizedRFQ);
        }
        this.rfqs = Array.from(byId.values()).sort(
          (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );
        if (buyerAccountId) {
          this._lastRfqSyncMap.set(cacheKey, Date.now());
        } else {
          this._lastRfqSyncTime = Date.now();
        }
      } catch (err) {
        logger.error('Failed to sync RFQs from authoritative storage', {
          error: err,
          buyerAccountId: buyerAccountId || null,
          operation: 'sync-rfqs-from-database',
        }, 'STORE_SERVICE');
        const unavailable = new Error(PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE);
        unavailable.status = 503;
        unavailable.statusCode = 503;
        unavailable.code = 'PERSISTENCE_UNAVAILABLE';
        unavailable.retryable = true;
        unavailable.cause = err;
        throw unavailable;
      } finally {
        this._rfqSyncPromises.delete(cacheKey);
      }
      return this.getRFQs(buyerAccountId);
    })();
    this._rfqSyncPromises.set(cacheKey, syncPromise);
    return syncPromise;
  }

  async getRFQByIdAsync(id) {
    if (!pool.hasStorage()) return this.getRFQById(id);

    try {
      const dbRfq = await domainQueries.getRFQByIdFromDB(id);
      if (!dbRfq) {
        this.rfqs = this.rfqs.filter((rfq) => rfq.id !== id && rfq.rfqNumber !== id);
        return undefined;
      }

      const idx = this.rfqs.findIndex((rfq) => rfq.id === dbRfq.id || rfq.rfqNumber === dbRfq.rfqNumber);
      if (idx !== -1) {
        this.rfqs[idx] = { ...this.rfqs[idx], ...dbRfq };
      } else {
        this.rfqs.unshift(dbRfq);
      }
      return this.getRFQById(id);
    } catch (error) {
      logger.error('RFQ lookup failed against authoritative storage; refusing cached fallback', {
        error,
        rfqId: id,
        operation: 'get-rfq-by-id',
      }, 'STORE_SERVICE');
      const unavailable = new Error(PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE);
      unavailable.status = 503;
      unavailable.statusCode = 503;
      unavailable.code = 'PERSISTENCE_UNAVAILABLE';
      unavailable.cause = error;
      throw unavailable;
    }
  }

  getRFQById(id) {
    const found = this.rfqs.find((r) => r.id === id || r.rfqNumber === id);
    if (!found) return undefined;
    const rfq = this._reconcileRFQFollowUpStats(normalizeRFQForRead(found));
    return rfq.quotes
      ? {
        ...rfq,
        quotes: evaluateQuotes(rfq.quotes),
      }
      : rfq;
  }

  /**
   * Generates a unique RFQ number matching p2pservices_v1_qua AutomaticRfqServiceImpl:
   * [Company prefix (3 letters uppercase, default 'RFQ')][yyddMM][6-digit suffix]
   * e.g., RFQ261109000123 (matching ^RFQ\\d{12}$)
   */
  generateRFQNumber(company = 'RFQ') {
    let companyLetters = 'RFQ';
    if (company && typeof company === 'string' && company.trim().length > 0) {
      const clean = company.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
      companyLetters = clean.length >= 3 ? clean.substring(0, 3) : clean.padEnd(3, 'X');
    }

    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const datePart = `${yy}${dd}${mm}`;

    const existing = new Set(this.rfqs.map((r) => r.rfqNumber));
    let candidate;
    let attempts = 0;
    do {
      const suffix = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
      candidate = `${companyLetters}${datePart}${suffix}`;
      attempts++;
    } while (existing.has(candidate) && attempts < 1000000);
    return candidate;
  }

  createRFQ(rfqData, requestingBuyerAccount = null, { deferPersistence = false, deferSideEffects = false } = {}) {
    const rfqTitle = String(rfqData.title ?? '').trim();
    if (!rfqTitle) {
      const titleError = new Error(RFQ_CREATION_ERRORS.TITLE_REQUIRED);
      titleError.statusCode = 422;
      titleError.code = 'RFQ_TITLE_REQUIRED';
      throw titleError;
    }
    const hasBudget = rfqData.budget !== undefined && rfqData.budget !== null && String(rfqData.budget).trim() !== '';
    const budgetAmount = hasBudget && Number.isFinite(Number(rfqData.budget)) ? Number(rfqData.budget) : null;
    const hadExplicitVendors = Array.isArray(rfqData.assignedVendors) && rfqData.assignedVendors.length > 0;
    const rfqNumber = rfqData.rfqNumber || this.generateRFQNumber();
    const id = rfqData.id || `rfq-${Date.now()}`;

    const resolvedBuyer =
      requestingBuyerAccount ||
      (rfqData.buyerEmail
        ? this.buyerAccounts.find(
            (a) =>
              a.corporateEmail &&
              a.corporateEmail.toLowerCase() === String(rfqData.buyerEmail).trim().toLowerCase()
          )
        : null);

    const buyerEmail =
      rfqData.buyerEmail ||
      (resolvedBuyer ? resolvedBuyer.corporateEmail : (rfqData.raisedByEmail || rfqData.sourceEmail || null));

    const newRFQ = {
      id,
      rfqNumber,
      title: rfqTitle,
      // Not defaulted to a category the buyer never chose: 'Engineering Spares -
      // Mechanical' used to be substituted here, which silently mis-filed the RFQ
      // and routed it to the wrong vendor pool.
      category: rfqData.category || null,
      createdAt: rfqData.createdAt || new Date().toISOString().replace('T', ' ').substring(0, 16) + ' UTC',
      deadline: rfqData.deadline
        ? (new Date(rfqData.deadline) >= new Date() ? rfqData.deadline : rfqIngestionService.ensureFutureDeliveryDate(rfqData.deadline, 5))
        : (rfqData.targetDeliveryDate
            ? (new Date(rfqData.targetDeliveryDate) >= new Date() ? rfqData.targetDeliveryDate : rfqIngestionService.ensureFutureDeliveryDate(rfqData.targetDeliveryDate, 5))
            : rfqIngestionService.ensureFutureDeliveryDate(null, 5)),
      targetDeliveryDate: rfqData.targetDeliveryDate
        ? (new Date(rfqData.targetDeliveryDate) >= new Date() ? rfqData.targetDeliveryDate : rfqIngestionService.ensureFutureDeliveryDate(rfqData.targetDeliveryDate, 5))
        : (rfqData.deadline
            ? (new Date(rfqData.deadline) >= new Date() ? rfqData.deadline : rfqIngestionService.ensureFutureDeliveryDate(rfqData.deadline, 5))
            : rfqIngestionService.ensureFutureDeliveryDate(null, 5)),
      // Budget is optional (VALIDATION_SCHEMAS.createRFQ). An RFQ that states none keeps
      // null, and the UI shows it as not stated. Zero is never stored in its place.
      budget: budgetAmount,
      // Vendors price freight against these, so they round-trip with the RFQ.
      deliveryLocation: rfqData.deliveryLocation || '',
      deliveryCity: rfqData.deliveryCity || '',
      deliveryState: rfqData.deliveryState || '',
      deliveryPincode: rfqData.deliveryPincode || '',
      // Metadata only. The bytes live in object storage under
      // rfqAttachmentService, so the bootstrap payload stays a fixed size no
      // matter how much is attached.
      attachments: Array.isArray(rfqData.attachments) ? rfqData.attachments : [],
      // Provenance. All four of these were previously dropped here — the field
      // list below simply did not mention them — so every stored RFQ came back
      // with a null `source` and a null `sourceFileName`. That mattered twice
      // over: the RFQ details screen had no way to say where a record came from,
      // and the ingestion wizard's own documented fallback for the uploaded
      // document ("recorded as sourceFileName instead") could never have worked,
      // because the value never reached the database.
      source: rfqData.source === 'ai_extraction' && !rfqData.sourceFileName
        ? 'manual_entry'
        : (rfqData.source !== undefined ? rfqData.source : null),
      sourceFileName: rfqData.sourceFileName || null,
      sourceEmail: rfqData.sourceEmail || null,
      buyerEmail,
      raisedByName: rfqData.raisedByName || null,
      creationAcknowledgementRequested: rfqData.creationAcknowledgementRequested === true,
      ...(rfqData.gatewayNotificationTarget && typeof rfqData.gatewayNotificationTarget === 'object' ? {
        gatewayNotificationTarget: {
          recipientEmail: String(rfqData.gatewayNotificationTarget.recipientEmail || '').trim(),
          sourceEmail: typeof rfqData.gatewayNotificationTarget.sourceEmail === 'string'
            ? rfqData.gatewayNotificationTarget.sourceEmail.trim()
            : null,
        },
      } : {}),
      raisedByEmail: resolvedBuyer ? resolvedBuyer.corporateEmail : (rfqData.raisedByEmail || buyerEmail || null),
      status: rfqData.status || 'Quotes Pending',
      // Stamped from the authenticated caller's own buyer account (resolved
      // by the controller/resolver from the session, never trusted from the
      // client body) so an RFQ is attributed to whoever actually created it.
      // Falls back to the legacy system-wide "active" buyer account only for
      // callers that don't have a per-request buyer identity to resolve
      // (e.g. historical-data ingestion, admin-driven creation).
      buyerAccountId: resolvedBuyer
        ? resolvedBuyer.id
        : this.activeBuyerAccount ? this.activeBuyerAccount.id : null,
      buyerAccountName: resolvedBuyer
        ? resolvedBuyer.organizationName
        : this.activeBuyerAccount ? this.activeBuyerAccount.organizationName : null,
      sharedBuyerAccountIds: Array.isArray(rfqData.sharedBuyerAccountIds) ? rfqData.sharedBuyerAccountIds : [],
      sharedBuyerEmails: Array.isArray(rfqData.sharedBuyerEmails) ? rfqData.sharedBuyerEmails : [],
      isSharedRfq: Boolean(Array.isArray(rfqData.sharedBuyerAccountIds) && rfqData.sharedBuyerAccountIds.length > 0),
      emailRfqScenario: rfqData.emailRfqScenario || null,
      sourcingMode: rfqData.source === 'email_gateway'
        ? (resolvedBuyer ? resolveBuyerSourcingMode(resolvedBuyer) : (rfqData.sourcingMode || 'mode_0'))
        : (rfqData.sourcingMode || (resolvedBuyer && resolvedBuyer.subscriptionPlan && resolvedBuyer.subscriptionPlan !== 'free_trial' ? resolveBuyerSourcingMode(resolvedBuyer) : 'mode_1')),
      quotesCount: rfqData.quotes ? rfqData.quotes.length : 0,
      chasingActive: rfqData.chasingActive !== undefined ? rfqData.chasingActive : true,
      allocatedTime: rfqData.allocatedTime || RFQ_DEFAULTS.ALLOCATED_TIME,
      elapsedTime: rfqData.elapsedTime || RFQ_DEFAULTS.ELAPSED_TIME,
      // A savings target is a commitment the buyer sets, not a number the system
      // invents. '12-18%' was previously stamped on every RFQ regardless.
      targetSavings: rfqData.targetSavings || null,
      quotes: evaluateQuotes(rfqData.quotes || []),
      // Real line items the buyer's document extraction produced. Previously
      // only the legacy `lineItems` key was read here, so a real RFQ created
      // through the actual app flow (which sends `extractedEntities`, the
      // RFQItem field) silently lost every item on persistence — the buyer's
      // own optimistic client state showed them, but a refresh (re-hydrated
      // from this persisted shape) showed none, and PO generation
      // (approvePurchaseOrder, which reads rfq.extractedEntities) produced
      // an empty line-item PO for any RFQ created this way.
      extractedEntities: rfqData.extractedEntities || rfqData.lineItems || [],
      // AI-generated headline/scope/risk-notes built from the line items above,
      // before the RFQ is constructed here (see rfqController.createRFQ) — a
      // deterministic fallback when there's nothing to summarise or the model
      // call fails, never fabricated content.
      aiSummary: rfqData.aiSummary || null,
      assignedVendors: Array.isArray(rfqData.assignedVendors) ? rfqData.assignedVendors : [],
      // Counters start at zero and are driven up by real outreach. They used to be
      // seeded with a channel total of 3 and 3 messages already "delivered" on
      // every RFQ — including RFQs with no vendors assigned at all — so the
      // follow-up panel reported delivery for messages that were never sent.
      followUpData: rfqData.followUpData || {
        rfqNumber,
        totalInvited: (Array.isArray(rfqData.assignedVendors) ? rfqData.assignedVendors : []).length,
        respondedCount: 0,
        callStats: { total: 0, connected: 0, avgDuration: null },
        whatsappStats: { total: (Array.isArray(rfqData.assignedVendors) ? rfqData.assignedVendors : []).length, delivered: 0, read: 0, replied: 0 },
        smsStats: { total: (Array.isArray(rfqData.assignedVendors) ? rfqData.assignedVendors : []).length, delivered: 0, clicked: 0 },
        emailStats: { total: (Array.isArray(rfqData.assignedVendors) ? rfqData.assignedVendors : []).length, delivered: 0, sent24h: 0, opened: 0 },
        autoChasingEnabled: true,
      },
    };

    // Private vendor records belong only to the buyer account that uploaded
    // them. Never carry another buyer's private roster entry onto this RFQ.
    const foreignPrivateVendors = [];
    newRFQ.assignedVendors = newRFQ.assignedVendors.filter((entry) => {
      const vendor = entry && entry.id ? this.getVendorById(entry.id, 'all') : null;
      if (!this.isVendorPrivateToDifferentBuyer(vendor || entry, newRFQ)) return true;
      foreignPrivateVendors.push(vendor || entry);
      return false;
    });
    if (foreignPrivateVendors.length > 0) {
      logger.warn(
        `Excluded ${foreignPrivateVendors.length} private vendor(s) owned by another buyer from RFQ ${newRFQ.rfqNumber}.`,
        {
          rfqNumber: newRFQ.rfqNumber,
          vendorIds: foreignPrivateVendors.map((vendor) => vendor.id).filter(Boolean),
        },
        'STORE_SERVICE'
      );
      if (newRFQ.followUpData) {
        newRFQ.followUpData.vendors = newRFQ.assignedVendors;
        const remCount = newRFQ.assignedVendors.length;
        newRFQ.followUpData.totalInvited = remCount;
        ['callStats', 'whatsappStats', 'smsStats', 'emailStats'].forEach((stat) => {
          if (newRFQ.followUpData[stat]) newRFQ.followUpData[stat].total = remCount;
        });
      }
    }

    // Verify each vendor in assignedVendors against the RFQ's category signals.
    // If a vendor does not match the category:
    // 1. Exclude the vendor from the RFQ vendor shortlist (assignedVendors).
    // 2. Dispatch an email to the vendor requesting them to update their category/business details.
    // 3. Record an audit log.
    const rfqCategorySignals = this._rfqCategorySignals(newRFQ);
    const maxClientPerCat = VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY;
    const distinctCategories = this._rfqDistinctCategories(newRFQ);

    // Verify whether the RFQ category is available in our master category list / taxonomy.
    // If the category is specified but NOT available in our category list:
    // - The RFQ must NOT be sent to vendors from unrelated categories.
    // - Clear assignedVendors and set needsCategoryManagerAssignment = true and categoryNotAvailable = true.
    // - Flag for Category Manager to review, identify and add relevant vendors.
    const specifiedCategory = newRFQ.category || newRFQ.minorCategory || (rfqCategorySignals.length > 0 ? rfqCategorySignals[0] : null);
    const hasCategorySignal = Boolean(specifiedCategory && String(specifiedCategory).trim());
    const isCategoryKnown = hasCategorySignal && (this.isCategoryAvailable(specifiedCategory) || rfqCategorySignals.some((sig) => this.isCategoryAvailable(sig)));

    if (hasCategorySignal && !isCategoryKnown) {
      newRFQ.assignedVendors = [];
      if (newRFQ.followUpData) {
        newRFQ.followUpData.totalInvited = 0;
        newRFQ.followUpData.vendors = [];
        ['callStats', 'whatsappStats', 'smsStats', 'emailStats'].forEach((stat) => {
          if (newRFQ.followUpData[stat]) newRFQ.followUpData[stat].total = 0;
        });
      }
      newRFQ.procucevVendorCount = 0;
      newRFQ.needsCategoryManagerAssignment = true;
      newRFQ.categoryNotAvailable = true;

      this.addAuditLog({
        userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
        action: `RFQ ${newRFQ.rfqNumber} raised under unlisted category "${specifiedCategory}". Category is not available in our category list. Flagged for Category Manager review; excluded from auto-dispatch to unrelated vendors.`,
        rfqNumber,
      });

      const cmNotification = this._buildNotification({
        recipientType: 'category_manager',
        recipientId: 'category-manager-team',
        kind: 'rfq_pending_assignment',
        rfq: newRFQ,
        title: `Action Required: RFQ ${newRFQ.rfqNumber} Category Review Needed`,
        message: `RFQ ${newRFQ.rfqNumber} was raised under category "${specifiedCategory}", which is not available in our category list. Please review, add relevant vendors, and share the RFQ.`,
        meta: {
          rfqId: newRFQ.id,
          rfqNumber: newRFQ.rfqNumber,
          category: specifiedCategory,
          categoryNotAvailable: true,
          needsAssignment: true,
        },
      });
      this.notifications.unshift(cmNotification);
      this._persistNotification(cmNotification);
    }

    if (!newRFQ.needsCategoryManagerAssignment && !newRFQ.categoryNotAvailable && rfqCategorySignals.length > 0 && Array.isArray(newRFQ.assignedVendors) && newRFQ.assignedVendors.length > 0) {
      const shortlisted = [];
      const mismatched = [];

      for (const v of newRFQ.assignedVendors) {
        const full = (v.id ? this.getVendorById(v.id, 'all') : null);
        const resolved = full ? { ...v, ...full } : v;
        const hasCategory = Boolean(
          resolved.majorCategory ||
          extractCategories(resolved.minorCategories).length > 0 ||
          extractCategories(resolved.vendorSelectedCategories).length > 0 ||
          extractCategories(resolved.clientMappedCategories).length > 0 ||
          extractCategories(resolved.categories).length > 0
        );
        const isMatch = !hasCategory || rfqCategorySignals.some((sig) => this.vendorCoversCategory(resolved, sig));
        if (isMatch) {
          shortlisted.push(resolved);
        } else {
          mismatched.push(resolved);
        }
      }

      // Limit client vendors to MAX_CLIENT_PER_CATEGORY per unique minor category (with major fallback)
      if (shortlisted.length > 0) {
        const selected = this.selectVendorsForRFQ(
          shortlisted,
          newRFQ,
          maxClientPerCat,
          {
            pincode: newRFQ.deliveryPincode ? String(newRFQ.deliveryPincode).trim() : null,
            location: newRFQ.deliveryLocation ? String(newRFQ.deliveryLocation).trim() : null,
          }
        );
newRFQ.assignedVendors = Array.isArray(selected) && selected.length > 0 ? selected : shortlisted;
      } else {
        newRFQ.assignedVendors = shortlisted;
      }

      if (newRFQ.followUpData) {
        newRFQ.followUpData.totalInvited = newRFQ.assignedVendors.length;
        newRFQ.followUpData.vendors = newRFQ.assignedVendors;
      }

      for (const vendor of mismatched) {
        this.addAuditLog({
          userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
          action: `Vendor ${vendor.name || vendor.id} excluded from automatic RFQ matching due to category mismatch.`,
          rfqNumber,
        });
      }
    }

    // Enterprise QUA – V1 (Mode 1 / Client Sourcing):
    // If assignedVendors is empty, automatically identify and assign eligible vendors from
    // the buyer's private roster matching the RFQ category and delivery location.
    const isV1 = newRFQ.sourcingMode === 'mode_1' || newRFQ.sourcingMode === 'v1' || newRFQ.sourcingMode === 'version_1';
    if (!newRFQ.needsCategoryManagerAssignment && !newRFQ.categoryNotAvailable && isV1 && !hadExplicitVendors) {
      const categories = this._rfqDistinctCategories(newRFQ);
      const targetCategories = categories.length > 0 ? categories : (newRFQ.category ? [newRFQ.category] : []);
      if (targetCategories.length > 0) {
        const clientCandidates = this.candidateVendorsForRFQ(newRFQ).filter(
          (v) => !this.isProcucevVendor(v) && this.isVendorMappedToRfqBuyer(v, newRFQ)
        );
        let clientMatches = this.selectVendorsForRFQ(
          clientCandidates,
          newRFQ,
          maxClientPerCat,
          {
            pincode: newRFQ.deliveryPincode ? String(newRFQ.deliveryPincode).trim() : null,
            location: newRFQ.deliveryLocation ? String(newRFQ.deliveryLocation).trim() : null,
          }
        );
        if (clientMatches.length === 0 && clientCandidates.length > 0) {
          clientMatches = clientCandidates.slice(0, targetCategories.length * maxClientPerCat);
        }
        if (clientMatches.length > 0) {
          newRFQ.assignedVendors = clientMatches.map((v) => ({
            id: v.id,
            name: v.name,
            email: v.email || null,
            contactPerson: v.contactPerson || null,
            phone: v.phone || v.mobile || v.mobileNumber || null,
            source: v.source || 'buyer_uploaded',
            vendorCategory: 'Client List',
            majorCategory: v.majorCategory || v.category || null,
            minorCategories: Array.isArray(v.minorCategories) ? v.minorCategories : [],
            city: v.city || null,
            state: v.state || null,
            location: v.location || (v.city ? `${v.city}${v.state ? ', ' + v.state : ''}` : null),
            pincode: v.pincode || null,
          }));
          if (newRFQ.followUpData) {
            newRFQ.followUpData.totalInvited = newRFQ.assignedVendors.length;
            newRFQ.followUpData.vendors = newRFQ.assignedVendors;
          }
        }
      }
    }

    // Enterprise QUA – V0 (Free Starter Trial) Flow:
    // When buyer raises RFQ from V0 (mode_0), RFQ is sent ONLY to Procucev vendors.
    // Buyer-uploaded vendors are excluded from V0 RFQs.
    if (!newRFQ.needsCategoryManagerAssignment && !newRFQ.categoryNotAvailable && (newRFQ.sourcingMode === 'mode_0' || newRFQ.sourcingMode === 'v0' || newRFQ.sourcingMode === 'version_0')) {
      const maxProcucevPerCat = VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY;
      // Filter existing assignedVendors to strictly Procucev vendors
      newRFQ.assignedVendors = (Array.isArray(newRFQ.assignedVendors) ? newRFQ.assignedVendors : []).filter((v) => {
        const resolved = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
        return this.isProcucevVendor(resolved);
      });

      const signals = this._rfqCategorySignals(newRFQ);
      const categories = this._rfqDistinctCategories(newRFQ);
      if (signals.length > 0 && categories.length > 0) {
        for (const v of this.vendors) {
          if (this.isProcucevVendor(v)) {
            const hasCategory = v.majorCategory || (Array.isArray(v.minorCategories) && v.minorCategories.length > 0);
            const isMatch = signals.some((sig) => this.vendorCoversCategory(v, sig));
            if (hasCategory && !isMatch) {
              this.addAuditLog({
                userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
                action: `Vendor ${v.name || v.id} excluded from automatic RFQ matching due to category mismatch.`,
                rfqNumber,
              });
            }
          }
        }

        // Auto-populate category-matched Procucev verified vendors up to maxProcucevPerCat per category
        const candidatePool = this.candidateVendorsForRFQ(newRFQ).filter((v) => this.isProcucevVendor(v));
        const procucevMatches = this.selectVendorsForRFQ(
          candidatePool,
          newRFQ,
          maxProcucevPerCat,
          {
            pincode: newRFQ.deliveryPincode ? String(newRFQ.deliveryPincode).trim() : null,
            location: newRFQ.deliveryLocation ? String(newRFQ.deliveryLocation).trim() : null,
          }
        );

        const existingKeys = new Set(
          (newRFQ.assignedVendors || []).map((v) => (v.id || v.email || v.name || '').toLowerCase())
        );
        const additions = procucevMatches
          .filter((v) => !existingKeys.has((v.id || v.email || v.name || '').toLowerCase()))
          .map((v) => ({
            id: v.id,
            name: v.name,
            email: v.email || null,
            contactPerson: v.contactPerson || null,
            phone: v.phone || null,
            source: v.source || 'procucev_network',
          }));

        if (additions.length > 0) {
          newRFQ.assignedVendors = [...newRFQ.assignedVendors, ...additions];
        }
        if (newRFQ.followUpData) {
          newRFQ.followUpData.totalInvited = newRFQ.assignedVendors.length;
          newRFQ.followUpData.vendors = newRFQ.assignedVendors;
        }
      } else {
        // V0 RFQ created without selecting a category:
        // Do NOT automatically assign to all Procucev vendors.
        // Route to Category Manager for manual vendor assignment.
        newRFQ.assignedVendors = [];
        if (newRFQ.followUpData) {
          newRFQ.followUpData.totalInvited = 0;
          newRFQ.followUpData.vendors = [];
          ['callStats', 'whatsappStats', 'smsStats', 'emailStats'].forEach((stat) => {
            if (newRFQ.followUpData[stat]) newRFQ.followUpData[stat].total = 0;
          });
        }
        newRFQ.procucevVendorCount = 0;
        newRFQ.needsCategoryManagerAssignment = true;

        this.addAuditLog({
          userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
          action: `V0 RFQ created without category. Routed to Category Manager for manual vendor assignment.`,
          rfqNumber,
        });

        const cmNotification = this._buildNotification({
          recipientType: 'category_manager',
          recipientId: 'category-manager-team',
          kind: 'rfq_pending_assignment',
          rfq: newRFQ,
          title: `Action Required: RFQ ${newRFQ.rfqNumber} Pending Vendor Assignment`,
          message: `V0 RFQ ${newRFQ.rfqNumber} was submitted without category. Please manually assign appropriate vendor(s).`,
          meta: {
            rfqId: newRFQ.id,
            rfqNumber: newRFQ.rfqNumber,
            sourcingMode: 'mode_0',
            needsAssignment: true,
          },
        });
        this.notifications.unshift(cmNotification);
        this._persistNotification(cmNotification);
      }
    }

    // Category-based network-wide vendor invite — Version 2 (mode_2, "Hybrid
    // Sourcing Pool: Private Roster + AI Routing") ONLY. Every vendor whose
    // major/minor category matches this RFQ is merged into assignedVendors,
    // in addition to whatever the client already supplied. Reuses
    // candidateVendorsForRFQ (same category-match rule the CM's invite
    // picker uses) — this bypasses the invite-only requirement deliberately,
    // but only for mode_2, which is explicitly advertised to buyers as
    // hybrid. Version 1 (mode_1) is advertised as "🔒 Private Roster Only" /
    // "strictly dispatched to your private, pre-approved supplier network"
    // (see ingestion-wizard.tsx) — this used to also run for mode_1, quietly
    // pulling in network-wide vendors having nothing to do with the buyer's
    // own roster and breaking that explicit promise (confirmed live: a
    // vendor never added to a buyer's private roster received a mode_1 RFQ
    // meant to stay strictly private). mode_1 now only ever gets whatever
    // the client-supplied assignedVendors already contains (the buyer's own
    // roster, category-filtered on the frontend).
    if (!newRFQ.needsCategoryManagerAssignment && !newRFQ.categoryNotAvailable && (newRFQ.sourcingMode === 'mode_2' || newRFQ.sourcingMode === 'v2' || newRFQ.sourcingMode === 'version_2' || newRFQ.source === 'email_gateway')) {
      const maxClientPerCat = VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY;
      const maxProcucevPerCat = VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY;
      const categories = this._rfqDistinctCategories(newRFQ);
      const targetCategories = categories.length > 0 ? categories : (newRFQ.category ? [newRFQ.category] : []);
      const targetLocation = {
        pincode: newRFQ.deliveryPincode ? String(newRFQ.deliveryPincode).trim() : null,
        location: newRFQ.deliveryLocation ? String(newRFQ.deliveryLocation).trim() : null,
      };

      const allCandidates = this.candidateVendorsForRFQ(newRFQ);
      const clientCandidates = allCandidates.filter((v) => !this.isProcucevVendor(v) && this.isVendorMappedToRfqBuyer(v, newRFQ));
      const procucevCandidates = allCandidates.filter((v) => this.isProcucevVendor(v));

      let clientMatches = this.selectVendorsForRFQ(clientCandidates, newRFQ, maxClientPerCat, targetLocation);
      if (clientMatches.length === 0 && clientCandidates.length > 0) {
        clientMatches = clientCandidates.slice(0, targetCategories.length * maxClientPerCat);
      }
      let procucevMatches = this.selectVendorsForRFQ(procucevCandidates, newRFQ, maxProcucevPerCat, targetLocation);
      if (procucevMatches.length === 0 && procucevCandidates.length > 0) {
        procucevMatches = procucevCandidates.slice(0, targetCategories.length * maxProcucevPerCat);
      }
      const categoryMatches = [...clientMatches, ...procucevMatches];

      const existingKeys = new Set(
        (newRFQ.assignedVendors || []).map((v) => (v.id || v.email || v.name || '').toLowerCase())
      );
      const additions = categoryMatches
        .filter((v) => !existingKeys.has((v.id || v.email || v.name || '').toLowerCase()))
        .map((v) => {
          const isProc = this.isProcucevVendor(v);
          return {
            id: v.id,
            name: v.name,
            email: v.email || null,
            contactPerson: v.contactPerson || null,
            phone: v.phone || v.mobile || v.mobileNumber || null,
            source: v.source || (isProc ? 'procucev_network' : 'buyer_uploaded'),
            vendorCategory: isProc ? 'Procucev Network' : 'Client List',
            majorCategory: v.majorCategory || v.category || null,
            minorCategories: Array.isArray(v.minorCategories) ? v.minorCategories : [],
            city: v.city || null,
            state: v.state || null,
            location: v.location || (v.city ? `${v.city}${v.state ? ', ' + v.state : ''}` : null),
            pincode: v.pincode || null,
          };
        });
      if (additions.length > 0) {
        newRFQ.assignedVendors = [...newRFQ.assignedVendors, ...additions];
        if (newRFQ.followUpData) {
          newRFQ.followUpData.totalInvited = newRFQ.assignedVendors.length;
          newRFQ.followUpData.vendors = newRFQ.assignedVendors;
        }
      }
    }

    // Enterprise QUA – Version 3 (mode_3 / v3 / version_3, "AI Autonomous Sourcing Plan"):
    // Autonomous Procucev Network Sourcing with double-blind evaluation protocol.
    // Dynamically retrieve category-matched Procucev verified vendors for Version 3 RFQs.
    let mode3ProcucevCount = 0;
    if (
      !newRFQ.needsCategoryManagerAssignment &&
      !newRFQ.categoryNotAvailable &&
      (newRFQ.sourcingMode === 'mode_3' ||
      newRFQ.sourcingMode === 'v3' ||
      newRFQ.sourcingMode === 'version_3')
    ) {
      const maxProcucevPerCat = VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY;
      const categories = this._rfqDistinctCategories(newRFQ);
      const targetCategories = categories.length > 0 ? categories : (newRFQ.category ? [newRFQ.category] : []);
      const procucevCandidates = this.candidateVendorsForRFQ(newRFQ).filter((v) => this.isProcucevVendor(v));
      const v3Matches = this.selectVendorsPerCategory(
        procucevCandidates,
        targetCategories,
        maxProcucevPerCat,
        {
          pincode: newRFQ.deliveryPincode ? String(newRFQ.deliveryPincode).trim() : null,
          location: newRFQ.deliveryLocation ? String(newRFQ.deliveryLocation).trim() : null,
        }
      );
      mode3ProcucevCount = v3Matches.length;
    }

    // Dynamically calculate and attach vendor count for Version 0, Version 2, and Version 3.
    // V0: Procucev-network-only count (all invited vendors ARE Procucev vendors for mode_0).
    // V2: Total invited count = buyer private roster + Procucev network (hybrid mode).
    // V3: Total invited count = buyer private roster (or category-matched pool if not supplied).
    let procucevVendorCount = 0;
    const isV0 = newRFQ.sourcingMode === 'mode_0' || newRFQ.sourcingMode === 'v0' || newRFQ.sourcingMode === 'version_0';
    const isV2 = newRFQ.sourcingMode === 'mode_2' || newRFQ.sourcingMode === 'v2' || newRFQ.sourcingMode === 'version_2';
    const isV3 = newRFQ.sourcingMode === 'mode_3' || newRFQ.sourcingMode === 'v3' || newRFQ.sourcingMode === 'version_3';

    if (isV0) {
      // V0: Every invited vendor is a Procucev network vendor — report total assigned.
      // If no category was selected, strictly 0 vendors until Category Manager assigns them.
      const signals = this._rfqCategorySignals(newRFQ);
      if (!signals || signals.length === 0) {
        procucevVendorCount = (newRFQ.assignedVendors || []).length;
      } else {
        procucevVendorCount = (newRFQ.assignedVendors || []).length > 0
          ? (newRFQ.assignedVendors || []).length
          : this.candidateVendorsForRFQ(newRFQ).filter((v) => this.isProcucevVendor(v)).length;
      }
    } else if (isV2) {
      // V2 Hybrid: report the count of Procucev verified vendors that can assign / are assigned to this RFQ
      const procucevAssigned = (newRFQ.assignedVendors || []).filter((v) => {
        const resolved = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
        return this.isProcucevVendor(resolved);
      });
      const candidateProcucevCount = this.candidateVendorsForRFQ(newRFQ).filter((v) => this.isProcucevVendor(v)).length;
      procucevVendorCount = procucevAssigned.length > 0
        ? procucevAssigned.length
        : candidateProcucevCount;
    } else if (isV3) {
      const procucevAssigned = (newRFQ.assignedVendors || []).filter((v) => {
        const resolved = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
        return this.isProcucevVendor(resolved);
      });
      procucevVendorCount = procucevAssigned.length > 0
        ? procucevAssigned.length
        : mode3ProcucevCount > 0
        ? mode3ProcucevCount
        : this.candidateVendorsForRFQ(newRFQ).filter((v) => this.isProcucevVendor(v)).length;
    }

    newRFQ.procucevVendorCount = procucevVendorCount;

    if (newRFQ.status === 'Parsing' && Array.isArray(newRFQ.assignedVendors) && newRFQ.assignedVendors.length > 0) {
      newRFQ.status = 'Quotes Pending';
    }

    this._reconcileRFQFollowUpStats(newRFQ);
    const initialInviteCandidates = newRFQ.status === 'Draft'
      ? []
      : [
        ...this.selectVendorsForRFQEmail(newRFQ),
        ...(Array.isArray(newRFQ.assignedVendors) ? newRFQ.assignedVendors : []),
      ];
    newRFQ.vendorInvitationTargets = this._buildRFQVendorInviteTargets(newRFQ, initialInviteCandidates);

    this.rfqs.unshift(newRFQ);
    if (!deferPersistence) this._persistRFQ(newRFQ);
    if (!deferSideEffects) this.dispatchRFQCreationSideEffects(newRFQ, requestingBuyerAccount);

    return newRFQ;
  }

  async createRFQDurably(rfqData, requestingBuyerAccount = null) {
    const requestedId = rfqData && rfqData.id;
    const storageConfigured = pool.hasStorage();
    if (requestedId) {
      let existing = null;
      if (storageConfigured) {
        try {
          existing = await domainQueries.getRFQByIdFromDB(requestedId);
        } catch (error) {
          logger.error('Failed to check the durable RFQ idempotency key', {
            error,
            rfqId: requestedId,
          }, 'STORE_SERVICE');
          const lookupError = new Error('The RFQ could not be checked for an existing save. Try again.');
          lookupError.statusCode = 503;
          lookupError.code = 'PERSISTENCE_UNAVAILABLE';
          throw lookupError;
        }
      } else {
        existing = this.rfqs.find((rfq) => rfq.id === requestedId) || null;
      }

      if (existing) {
        if (storageConfigured && requestingBuyerAccount && requestingBuyerAccount.id) {
          try {
            const result = await domainQueries.createRFQWithCreditInDB({
              rfq: existing,
              buyerId: requestingBuyerAccount.id,
            });
            if (!result?.success || !result.rfq) {
              if (result?.creditsExhausted) {
                const exhaustedError = new Error(RFQ_CREATION_ERRORS.FREE_CREDITS_EXHAUSTED);
                exhaustedError.statusCode = 403;
                exhaustedError.code = 'FREE_RFQ_CREDITS_EXHAUSTED';
                exhaustedError.remaining = result.remaining;
                throw exhaustedError;
              }
              throw new Error('The existing RFQ could not be verified against the buyer credit ledger.');
            }
            const existingIndex = this.rfqs.findIndex((rfq) => rfq.id === result.rfq.id);
            if (existingIndex === -1) this.rfqs.unshift(result.rfq);
            else this.rfqs[existingIndex] = result.rfq;
            if (result.account) {
              this.updateBuyerAccountCache(result.account);
              if (typeof result.account.remainingFreeRFQs === 'number') {
                requestingBuyerAccount.remainingFreeRFQs = result.account.remainingFreeRFQs;
              }
            }
            return normalizeRFQForRead(result.rfq);
          } catch (error) {
            logger.error('Failed to verify buyer ownership for the existing RFQ idempotency key', {
              error,
              rfqId: requestedId,
              buyerId: requestingBuyerAccount.id,
            }, 'BUYER_RFQ_CREDIT');
            if (error.statusCode && error.statusCode < 500) throw error;
            const lookupError = new Error('The RFQ could not be verified for this buyer. Try again.');
            lookupError.statusCode = 503;
            lookupError.code = error.code || 'PERSISTENCE_UNAVAILABLE';
            lookupError.cause = error;
            throw lookupError;
          }
        }
        const existingIndex = this.rfqs.findIndex((rfq) => rfq.id === existing.id);
        if (existingIndex === -1) this.rfqs.unshift(existing);
        else this.rfqs[existingIndex] = { ...this.rfqs[existingIndex], ...existing };
        return normalizeRFQForRead(existing);
      }

      // A configured database is authoritative. Drop a stale local row when
      // the durable lookup confirms that the requested ID does not exist.
      if (storageConfigured) {
        this.rfqs = this.rfqs.filter((rfq) => rfq.id !== requestedId);
      }
    }

    const created = this.createRFQ(rfqData, requestingBuyerAccount, {
      deferPersistence: true,
      deferSideEffects: true,
    });

    if (storageConfigured && requestingBuyerAccount && requestingBuyerAccount.id) {
      try {
        const result = await domainQueries.createRFQWithCreditInDB({
          rfq: created,
          buyerId: requestingBuyerAccount.id,
        });
        if (!result || !result.success) {
          this.rfqs = this.rfqs.filter((rfq) => rfq.id !== created.id);
          if (result?.account) this.updateBuyerAccountCache(result.account);
          if (result?.creditsExhausted) {
            const exhaustedError = new Error(RFQ_CREATION_ERRORS.FREE_CREDITS_EXHAUSTED);
            exhaustedError.statusCode = 403;
            exhaustedError.code = 'FREE_RFQ_CREDITS_EXHAUSTED';
            exhaustedError.remaining = result.remaining;
            logger.warn('Durable RFQ creation rejected because free credits are exhausted', {
              buyerId: requestingBuyerAccount.id,
              rfqId: created.id,
              remaining: result.remaining,
            }, 'BUYER_RFQ_CREDIT');
            throw exhaustedError;
          }
          throw new Error('The atomic RFQ and buyer-credit write returned no durable RFQ.');
        }

        const savedRFQ = result.rfq;
        const savedIndex = this.rfqs.findIndex((rfq) => rfq.id === savedRFQ.id);
        if (savedIndex === -1) this.rfqs.unshift(savedRFQ);
        else this.rfqs[savedIndex] = savedRFQ;
        if (result.account) {
          this.updateBuyerAccountCache(result.account);
          if (typeof result.account.remainingFreeRFQs === 'number') {
            requestingBuyerAccount.remainingFreeRFQs = result.account.remainingFreeRFQs;
          }
        }

        if (!result.replayed) {
          try {
            this.dispatchRFQCreationSideEffects(savedRFQ, requestingBuyerAccount);
          } catch (error) {
            logger.error('RFQ persisted atomically but post-create dispatch failed', {
              rfqNumber: savedRFQ.rfqNumber,
              error,
            }, 'STORE_SERVICE');
          }
        }
        logger.info('RFQ creation and buyer credit update committed atomically', {
          rfqId: savedRFQ.id,
          rfqNumber: savedRFQ.rfqNumber,
          buyerId: requestingBuyerAccount.id,
          creditConsumed: result.credit?.consumed || false,
          remainingCredits: result.credit?.remaining,
          replayed: Boolean(result.replayed),
        }, 'BUYER_RFQ_CREDIT');
        return normalizeRFQForRead(savedRFQ);
      } catch (error) {
        this.rfqs = this.rfqs.filter((rfq) => rfq.id !== created.id);
        if (error.code === 'FREE_RFQ_CREDITS_EXHAUSTED' || (error.statusCode && error.statusCode < 500)) {
          throw error;
        }
        logger.error('Atomic RFQ and buyer-credit persistence failed', {
          error,
          rfqId: created.id,
          buyerId: requestingBuyerAccount.id,
        }, 'BUYER_RFQ_CREDIT');
        const persistError = new Error('The RFQ and buyer credit could not be saved together. Try again.');
        persistError.statusCode = 503;
        persistError.code = error.code || 'PERSISTENCE_UNAVAILABLE';
        persistError.retryable = true;
        persistError.cause = error;
        throw persistError;
      }
    }

    let locallyConsumedCredit = false;
    if (!storageConfigured && requestingBuyerAccount && requestingBuyerAccount.id) {
      const plan = String(requestingBuyerAccount.subscriptionPlan || 'free_trial').toLowerCase();
      const isPaidPlan = ['version_1', 'version_2', 'version_3', 'unlimited'].includes(plan);
      const creditSourcingMode = created.sourcingMode || rfqData.sourcingMode;
      const requiresCredit = !this.isV0SourcingMode(creditSourcingMode)
        && !isPaidPlan
        && !hasUnlimitedRfqAccess(requestingBuyerAccount);
      const creditResult = this.consumeRFQCreditIfApplicable(requestingBuyerAccount, creditSourcingMode);
      locallyConsumedCredit = creditResult.consumed;
      if (requiresCredit && !creditResult.consumed) {
        this.rfqs = this.rfqs.filter((rfq) => rfq.id !== created.id);
        const exhaustedError = new Error(RFQ_CREATION_ERRORS.FREE_CREDITS_EXHAUSTED);
        exhaustedError.statusCode = 403;
        exhaustedError.code = 'FREE_RFQ_CREDITS_EXHAUSTED';
        exhaustedError.remaining = creditResult.remaining;
        throw exhaustedError;
      }
    }

    try {
      await this.persistRFQDurably(created);
    } catch (error) {
      this.rfqs = this.rfqs.filter((rfq) => rfq.id !== created.id);
      if (locallyConsumedCredit && requestingBuyerAccount) {
        this.refundFreeRFQ(requestingBuyerAccount.id);
      }
      throw error;
    }

    try {
      this.dispatchRFQCreationSideEffects(created, requestingBuyerAccount);
    } catch (error) {
      logger.error('RFQ persisted but post-create dispatch failed', {
        rfqNumber: created.rfqNumber,
        error,
      }, 'STORE_SERVICE');
    }
    return normalizeRFQForRead(created);
  }

  updateBuyerAccountCache(account) {
    const existingIndex = this.buyerAccounts.findIndex((candidate) => candidate.id === account.id);
    if (existingIndex === -1) this.buyerAccounts.unshift(account);
    else this.buyerAccounts[existingIndex] = account;
    if (this.activeBuyerAccount && this.activeBuyerAccount.id === account.id) {
      this.activeBuyerAccount = account;
    }
    return account;
  }

  dispatchRFQCreationSideEffects(newRFQ, requestingBuyerAccount = null) {
    const rfqNumber = newRFQ.rfqNumber;
    this.addAuditLog({
      // Attributed to the buyer account the controller resolved from the session.
      userEmail: requestingBuyerAccount
        ? requestingBuyerAccount.corporateEmail
        : this.activeBuyerAccount ? this.activeBuyerAccount.corporateEmail : SYSTEM_ACTOR_EMAIL,
      action: `Created ${rfqNumber} (${newRFQ.title}) under Sourcing ${newRFQ.sourcingMode}`,
      rfqNumber,
    });

    // System event for RFQ creation. It records what was created. Outreach results
    // are written only by the services that actually send messages.
    this.addAIFeedItem({
      type: 'ingestion',
      title: `Autonomous Sourcing Engine Initialized: ${rfqNumber}`,
      message: `RFQ ${rfqNumber} created with ${(newRFQ.extractedEntities || []).length} line items and ${(newRFQ.assignedVendors || []).length} assigned vendor(s).`,
      recipient: 'Procurement AI Orchestrator',
      rfqNumber,
      buyerAccountId: newRFQ.buyerAccountId,
      status: CHASER_OUTCOME_STATUS.RECORDED,
    });

    // In-app alert to every vendor whose category covers this RFQ, and an email
    // to the top matched vendors (same category, ranked by pincode + tier).
    this.notifyVendorsOfNewRFQ(newRFQ);
    this.emailRFQToMatchedVendors(newRFQ);

    // Timed multi-channel chaser sequence for every assigned vendor:
    //   • Within 5 minutes → SMS reminder
    //   • After 6 hours   → Call reminder (logic kept, telephony deferred)
    //   • After 12 hours  → WhatsApp reminder
    //   • After 24 hours  → Email reminder
    if (
      Array.isArray(newRFQ.assignedVendors) &&
      newRFQ.assignedVendors.length > 0
    ) {
      const resolvedVendors = newRFQ.assignedVendors.map((v) => {
        const full = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
        return {
          ...v,
          phone: full.phone || full.mobile || full.mobileNumber || v.phone,
          email: full.email || v.email,
          name: full.name || v.name,
          contactPerson: full.contactPerson || v.contactPerson,
        };
      });

      rfqChaserScheduler.scheduleRFQChasers(
        newRFQ,
        resolvedVendors,
        (vendor) => this.checkVendorQuotationEligibility(vendor)
      );
    }
  }

  updateRFQ(id, updates, { persist = true, notify = true } = {}) {
    const idx = this.rfqs.findIndex((r) => r.id === id || r.rfqNumber === id);
    if (idx === -1) return null;

    const oldStatus = this.rfqs[idx].status;
    let quotes = updates.quotes ? evaluateQuotes(updates.quotes) : this.rfqs[idx].quotes;

    const updated = {
      ...this.rfqs[idx],
      ...updates,
      quotes,
      quotesCount: quotes.length,
    };
    this.rfqs[idx] = updated;
    if (persist) this._persistRFQ(updated);

    if (notify) this._notifyRFQUpdate(updated, oldStatus, updates);

    return updated;
  }

  async updateRFQDurably(id, updates, options = {}) {
    const idx = this.rfqs.findIndex((rfq) => rfq.id === id || rfq.rfqNumber === id);
    const resolveUpdates = typeof updates === 'function' ? updates : () => updates;
    if (!pool.hasStorage()) {
      if (idx === -1) return null;
      const previous = this.rfqs[idx];
      const resolvedUpdates = resolveUpdates(previous);
      const previousQuotes = Array.isArray(previous.quotes) ? previous.quotes : [];
      const quotes = Array.isArray(resolvedUpdates.quotes) ? evaluateQuotes(resolvedUpdates.quotes) : previousQuotes;
      const updated = { ...previous, ...resolvedUpdates, id: previous.id, quotes, quotesCount: quotes.length };
      const publicUpdated = normalizeRFQForRead(updated);
      this.rfqs[idx] = publicUpdated;
      this._notifyRFQUpdate(publicUpdated, previous.status, resolvedUpdates);
      if (options.outboxResult) options.outboxResult.atomicUnsupported = true;
      return publicUpdated;
    }

    let snapshot;
    let updated = null;
    let previous = null;
    let appliedUpdates = updates;
    try {
      snapshot = await domainQueries.getRFQSnapshotByIdFromDB(id);
      if (!snapshot) return null;

      for (let attempt = 0; attempt < RFQ_STATE_WRITE_RETRIES; attempt += 1) {
        previous = snapshot.rfq;
        appliedUpdates = resolveUpdates(previous);
        const previousQuotes = Array.isArray(previous.quotes) ? previous.quotes : [];
        const quotes = Array.isArray(appliedUpdates.quotes) ? evaluateQuotes(appliedUpdates.quotes) : previousQuotes;
        const candidate = { ...previous, ...appliedUpdates, id: previous.id, quotes, quotesCount: quotes.length };
        if (options.outboxEvent) {
          // eslint-disable-next-line no-await-in-loop
          const atomicResult = await rfqInquiryQueries.updateRFQAndEnqueueInquiryEmailInDB(
            snapshot,
            candidate,
            options.outboxEvent
          );
          if (atomicResult?.atomicUnsupported) {
            if (options.outboxResult) options.outboxResult.atomicUnsupported = true;
            // The D1 HTTP adapter cannot guarantee a multi-statement transaction.
            // Keep the RFQ write available there and let the controller use its
            // existing direct-send fallback for the separate acknowledgement.
            // eslint-disable-next-line no-await-in-loop
            updated = await domainQueries.updateRFQIfUnchangedInDB(snapshot, candidate);
          } else if (atomicResult) {
            updated = atomicResult.rfq;
            if (options.outboxResult) options.outboxResult.event = atomicResult.outboxEvent;
          } else {
            updated = null;
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          updated = await domainQueries.updateRFQIfUnchangedInDB(snapshot, candidate);
        }
        if (updated) break;
        // Another isolate changed the row after the snapshot read. Reload and
        // reapply this patch so disjoint updates are not lost.
        // eslint-disable-next-line no-await-in-loop
        snapshot = await domainQueries.getRFQSnapshotByIdFromDB(id);
        if (!snapshot) return null;
      }
      if (!updated) throw new Error('RFQ changed repeatedly while applying a durable update.');
    } catch (error) {
      logger.error('Failed to persist RFQ mutation', {
        error,
        rfqId: id,
        operation: 'update-rfq-compare-and-swap',
      }, 'STORE_SERVICE');
      const persistError = new Error('The RFQ could not be saved to storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      persistError.cause = error;
      throw persistError;
    }

    const publicUpdated = normalizeRFQForRead(updated);
    const updatedIndex = this.rfqs.findIndex((rfq) => rfq.id === publicUpdated.id);
    if (updatedIndex >= 0) this.rfqs[updatedIndex] = publicUpdated;
    else this.rfqs.unshift(publicUpdated);
    this._notifyRFQUpdate(publicUpdated, previous.status, appliedUpdates);
    return publicUpdated;
  }

  _buildRFQVendorInviteTargets(rfq, vendors, { includeBuyerEmail = false } = {}) {
    const targetsByEmail = new Map();
    for (const vendor of Array.isArray(vendors) ? vendors : []) {
      const recipientEmail = String((vendor && vendor.email) || '').trim();
      if (!recipientEmail) continue;

      const emailKey = recipientEmail.toLowerCase();
      if (targetsByEmail.has(emailKey)) continue;

      const resolvedVendor = (vendor.id ? this.getVendorById(vendor.id, 'all') : null) || vendor;
      const creditInfo = this.checkVendorQuotationEligibility(resolvedVendor);
      const isBuyerUploaded = this.isBuyerUploaded(resolvedVendor);
      const vendorContext = {
        id: resolvedVendor.id || vendor.id,
        email: recipientEmail,
        name: resolvedVendor.name || vendor.name,
        contactPerson: resolvedVendor.contactPerson || vendor.contactPerson,
        source: resolvedVendor.source || vendor.source,
        isBuyerUploaded,
      };
      const key = crypto.createHash('sha256').update(`${rfq.id}:${emailKey}`).digest('hex');

      targetsByEmail.set(emailKey, {
        key,
        vendorId: vendorContext.id,
        recipientEmail,
        recipientName: vendorContext.contactPerson || vendorContext.name,
        freeCreditsRemaining: creditInfo.freeCreditsRemaining,
        isSubscribed: creditInfo.isSubscribed,
        buyerEmail: includeBuyerEmail ? this.resolveBuyerEmailForRFQ(rfq) : null,
        vendor: vendorContext,
      });
    }
    return Array.from(targetsByEmail.values());
  }

  _dispatchRFQVendorInviteOutbox(rfq, operation) {
    if (!pool.hasStorage()) return false;
    this._background(
      eventOutboxService.dispatchDueEventOutboxJobs(),
      'Failed to dispatch durable RFQ vendor invitation events',
      {
        operation,
        rfqId: rfq.id,
        rfqNumber: rfq.rfqNumber,
      }
    );
    return true;
  }

  async _appendRFQAssignmentsDurably(id, additions, {
    ensureFollowUpData = false,
    clearCategoryManagerAssignment = false,
    clearCategoryNotAvailable = false,
    advanceStatus = false,
    includeBuyerEmailInInvite = false,
  } = {}) {
    let committedAdditions = [];
    const updatedRFQ = await this.updateRFQDurably(id, (current) => {
      const existing = Array.isArray(current.assignedVendors) ? current.assignedVendors : [];
      const assignedIds = new Set(existing.map((vendor) => vendor.id));
      committedAdditions = [];
      for (const vendor of additions) {
        if (assignedIds.has(vendor.id)) continue;
        assignedIds.add(vendor.id);
        committedAdditions.push(vendor);
      }

      const assignedVendors = [...existing, ...committedAdditions];
      const isV1 = current.sourcingMode === 'mode_1' || current.sourcingMode === 'v1' || current.sourcingMode === 'version_1';
      const procucevCount = isV1
        ? 0
        : assignedVendors.filter((v) => {
            const resolved = (v && v.id ? this.getVendorById(v.id, 'all') : null) || v;
            return v.vendorCategory === 'Procucev Network' || (!v.vendorCategory && this.isProcucevVendor(resolved));
          }).length;
      const updates = {
        assignedVendors,
        procucevVendorCount: procucevCount,
        vendorInvitationTargets: this._buildRFQVendorInviteTargets(
          { ...current, assignedVendors },
          committedAdditions,
          { includeBuyerEmail: includeBuyerEmailInInvite }
        ),
      };
      if (current.followUpData || ensureFollowUpData) {
        updates.followUpData = {
          ...(current.followUpData || {}),
          totalInvited: assignedVendors.length,
          vendors: assignedVendors,
        };
      }
      if (clearCategoryManagerAssignment) updates.needsCategoryManagerAssignment = false;
      if (clearCategoryNotAvailable) updates.categoryNotAvailable = false;
      if (advanceStatus && (current.status === 'Parsing' || current.status === 'Draft' || !current.status)) {
        updates.status = 'Quotes Pending';
      }
      return updates;
    });

    return { updatedRFQ, committedAdditions };
  }

  _notifyRFQUpdate(updated, oldStatus, updates) {
    if (updates.status === 'Closed' && oldStatus !== 'Closed') {
      this.notifyOfRFQClosure(updated);
    } else if (
      (updates.status === 'AI Recommended' || updates.status === 'In Evaluation') &&
      oldStatus !== updates.status &&
      updated.quotesCount >= 1
    ) {
      this.notifyBuyerOfFinalComparison(updated);
    }
  }

  extendRFQ(id, { hours, userEmail } = {}) {
    const rfq = this.getRFQById(id);
    if (!rfq) return { success: false, reason: 'NOT_FOUND', error: `RFQ with ID ${id} not found.` };

    if (rfq.status === 'Closed' || rfq.status === 'Expired') {
      return { success: false, reason: 'INVALID_STATUS', error: 'Cannot extend a closed or expired RFQ.' };
    }

    if (rfq.isExtended || rfq.extendedAt || rfq.extensionHours) {
      return { success: false, reason: 'ALREADY_EXTENDED', error: 'This RFQ has already received its one-time deadline extension.' };
    }

    const extHours = Number(hours);
    if (![24, 48].includes(extHours)) {
      return { success: false, reason: 'VALIDATION', error: 'Extension duration must be either 24 or 48 hours.' };
    }

    const currentDeadlineStr = rfq.closingDeadline || rfq.deadline || rfq.targetDeliveryDate;
    let baseMs = Date.now();
    if (currentDeadlineStr && !isNaN(Date.parse(currentDeadlineStr))) {
      baseMs = Math.max(Date.parse(currentDeadlineStr), Date.now());
    } else if (rfq.createdAt && !isNaN(Date.parse(rfq.createdAt))) {
      baseMs = Math.max(new Date(rfq.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000, Date.now());
    }

    const newDeadlineMs = baseMs + extHours * 60 * 60 * 1000;
    const newDeadlineIso = new Date(newDeadlineMs).toISOString();

    const updates = {
      closingDeadline: newDeadlineIso,
      deadline: newDeadlineIso,
      isExtended: true,
      extensionHours: extHours,
      extendedAt: new Date().toISOString(),
      extendedByEmail: userEmail || rfq.raisedByEmail || null,
      updatedAt: new Date().toISOString(),
    };

    const updated = this.updateRFQ(rfq.id, updates);
    return { success: true, rfq: updated };
  }

  async extendRFQDurably(id, { hours, userEmail } = {}) {
    const storageConfigured = pool.hasStorage();
    let rfq;
    try {
      rfq = storageConfigured
        ? await domainQueries.getRFQByIdFromDB(id)
        : this.getRFQById(id);
    } catch (error) {
      logger.error('Failed to load RFQ before deadline extension', { error, rfqId: id }, 'STORE_SERVICE');
      const persistError = new Error('The RFQ could not be loaded from storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
    if (!rfq) return { success: false, reason: 'NOT_FOUND', error: `RFQ with ID ${id} not found.` };

    const extensionFailure = (current) => {
      if (current.status === 'Closed' || current.status === 'Expired') {
        return { success: false, reason: 'INVALID_STATUS', error: 'Cannot extend a closed or expired RFQ.' };
      }
      if (current.isExtended || current.extendedAt || current.extensionHours) {
        return { success: false, reason: 'ALREADY_EXTENDED', error: 'This RFQ has already received its one-time deadline extension.' };
      }
      return null;
    };
    const initialFailure = extensionFailure(rfq);
    if (initialFailure) return initialFailure;

    const extHours = Number(hours);
    if (![24, 48].includes(extHours)) {
      return { success: false, reason: 'VALIDATION', error: 'Extension duration must be either 24 or 48 hours.' };
    }
    const now = new Date();
    const currentDeadlineStr = rfq.closingDeadline || rfq.deadline || rfq.targetDeliveryDate;
    let baseMs = now.getTime();
    if (currentDeadlineStr && !isNaN(Date.parse(currentDeadlineStr))) {
      baseMs = Math.max(Date.parse(currentDeadlineStr), now.getTime());
    } else if (rfq.createdAt && !isNaN(Date.parse(rfq.createdAt))) {
      baseMs = Math.max(new Date(rfq.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000, now.getTime());
    }
    const newDeadlineIso = new Date(baseMs + extHours * 60 * 60 * 1000).toISOString();
    const updates = {
      closingDeadline: newDeadlineIso,
      deadline: newDeadlineIso,
      isExtended: true,
      extensionHours: extHours,
      extendedAt: now.toISOString(),
      extendedByEmail: userEmail || rfq.raisedByEmail || null,
      updatedAt: now.toISOString(),
    };

    if (!storageConfigured) {
      const updated = this.updateRFQ(rfq.id, updates);
      return updated
        ? { success: true, rfq: updated }
        : { success: false, reason: 'NOT_FOUND', error: `RFQ with ID ${id} not found.` };
    }

    let updated;
    try {
      updated = await domainQueries.extendRFQOnceInDB(rfq.id, updates);
    } catch (error) {
      logger.error('Failed to persist RFQ deadline extension', { error, rfqId: rfq.id, extensionHours: extHours }, 'STORE_SERVICE');
      const persistError = new Error('The RFQ deadline extension could not be saved. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
    if (!updated) {
      let current;
      try {
        current = await domainQueries.getRFQByIdFromDB(rfq.id);
      } catch (error) {
        logger.error('Failed to verify a rejected RFQ deadline extension', { error, rfqId: rfq.id }, 'STORE_SERVICE');
        const persistError = new Error('The RFQ extension could not be verified. Try again.');
        persistError.statusCode = 503;
        persistError.code = 'PERSISTENCE_UNAVAILABLE';
        throw persistError;
      }
      if (!current) return { success: false, reason: 'NOT_FOUND', error: `RFQ with ID ${id} not found.` };
      const currentFailure = extensionFailure(current);
      if (currentFailure) return currentFailure;
      return { success: false, reason: 'CONCURRENT_UPDATE', error: 'This RFQ changed while the extension was being saved. Reload and try again.' };
    }

    const cachedIndex = this.rfqs.findIndex((item) => item.id === updated.id);
    const oldStatus = cachedIndex === -1 ? updated.status : this.rfqs[cachedIndex].status;
    if (cachedIndex === -1) this.rfqs.push(updated);
    else this.rfqs[cachedIndex] = updated;
    this._lastRfqSyncTime = 0;
    this._notifyRFQUpdate(updated, oldStatus, updates);
    return { success: true, rfq: updated };
  }

  addQuoteToRFQ(rfqId, quote, { persist = true, notify = true } = {}) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    // A resubmission from the same vendor replaces their previous quote on
    // this RFQ rather than piling up duplicates, preserving quotation integrity.
    const existingQuotes = rfq.quotes || [];
    const quotes = quote.vendorId
      ? [...existingQuotes.filter((q) => q.vendorId !== quote.vendorId), quote]
      : [...existingQuotes, quote];

    // Update followUpData telemetry if present
    let followUpData = rfq.followUpData
      ? {
          ...rfq.followUpData,
          ...(Array.isArray(rfq.followUpData.vendors) ? { vendors: [...rfq.followUpData.vendors] } : {}),
        }
      : rfq.followUpData;
    if (followUpData) {
      if (Array.isArray(followUpData.vendors)) {
        const vIdx = followUpData.vendors.findIndex(
          (v) =>
            v &&
            (v.vendorId === quote.vendorId ||
              v.id === quote.vendorId ||
              (quote.vendorName && v.vendorName === quote.vendorName) ||
              (quote.vendorEmail && v.email === quote.vendorEmail))
        );
        if (vIdx !== -1) {
          const wasSubmitted = followUpData.vendors[vIdx].bidStatus === 'Submitted';
          followUpData.vendors[vIdx] = {
            ...followUpData.vendors[vIdx],
            bidStatus: 'Submitted',
            overallStatus: 'Responded',
            lastInteraction: quote.submittedAt || new Date().toISOString(),
          };
          if (!wasSubmitted) {
            followUpData.respondedCount = (followUpData.respondedCount || 0) + 1;
          }
        }
      }
      followUpData.respondedCount = Math.max(followUpData.respondedCount || 0, quotes.length);
    }

    const isV0 =
      rfq.sourcingMode === 'mode_0' ||
      rfq.sourcingMode === 'v0' ||
      rfq.sourcingMode === 'version_0';

    const nextStatus = isV0 ? 'Quotes Received' : (rfq.status === 'PO Generated' ? 'PO Generated' : 'In Evaluation');

    // Requirement 1: Automatic RFQ Closure as soon as 100% of invited vendors submit valid quotes
    const assignedVendors = Array.isArray(rfq.assignedVendors) && rfq.assignedVendors.length > 0
      ? rfq.assignedVendors
      : (followUpData && Array.isArray(followUpData.vendors) ? followUpData.vendors : []);

    const allInvitedSubmitted =
      assignedVendors.length > 0 &&
      assignedVendors.every((av) => {
        if (!av) return false;
        const avId = av.id || av.vendorId;
        const avEmail = av.email;
        const avName = av.name || av.vendorName;
        return quotes.some((q) =>
          (avId && String(q.vendorId) === String(avId)) ||
          (avEmail && String(q.vendorEmail || '').toLowerCase() === String(avEmail).toLowerCase()) ||
          (avName && String(q.vendorName || '').trim().toLowerCase() === String(avName).trim().toLowerCase())
        );
      });

    let autoClosed = false;
    let finalStatus = nextStatus;

    if (!isV0 && allInvitedSubmitted && rfq.status !== 'Closed' && rfq.status !== 'PO Generated' && !rfq.poFinalised && !rfq.poNumber && rfq.status !== 'Expired') {
      finalStatus = 'Closed';
      autoClosed = true;
      logger.info(
        `[AUTO_RFQ_CLOSURE] 100% of invited vendors (${assignedVendors.length}) submitted quotes for RFQ ${rfq.rfqNumber}. Closing RFQ immediately.`,
        { rfqNumber: rfq.rfqNumber, quotesCount: quotes.length, invitedCount: assignedVendors.length },
        'STORE_SERVICE'
      );
    }

    const updated = this.updateRFQ(rfq.id, {
      quotes,
      quotesCount: quotes.length,
      status: finalStatus,
      ...(autoClosed ? { quotesHidden: false, closedAt: new Date().toISOString(), autoClosedReason: 'All invited vendors submitted quotes' } : {}),
      followUpData,
    }, { persist, notify });

    if (notify) this._dispatchQuoteSubmissionSideEffects(rfq, updated, quote, autoClosed);

    return updated;
  }

  _dispatchQuoteSubmissionSideEffects(rfq, updated, quote, autoClosed, {
    skipQuoteEmail = false,
    skipAutoClosureEmail = false,
    comparisonJob = null,
  } = {}) {
    if (autoClosed) {
      this.cancelDelayedQuoteTimers(rfq.id);
      this.notifyBuyerOfAutoClosureAndScheduleComparison(updated, updated.quotes || [], {
        skipEmail: skipAutoClosureEmail,
        comparisonJob,
      });
      return;
    }
    this.notifyBuyerOfQuote(rfq, quote);
    if (!skipQuoteEmail) this.emailQuoteToBuyer(rfq, quote);
  }

  async addQuoteToRFQDurably(rfqId, quote) {
    if (!pool.hasStorage()) return this.addQuoteToRFQ(rfqId, quote);

    let rfq;
    try {
      rfq = await domainQueries.getRFQByIdFromDB(rfqId);
    } catch (error) {
      logger.error('Failed to load RFQ before quote submission', { error, rfqId }, 'STORE_SERVICE');
      const persistError = new Error('The RFQ could not be loaded from storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
    if (!rfq) return null;

    const cachedIndex = this.rfqs.findIndex((item) => item.id === rfq.id);
    const previousCached = cachedIndex === -1 ? null : this.rfqs[cachedIndex];
    if (cachedIndex === -1) this.rfqs.unshift(rfq);
    else this.rfqs[cachedIndex] = rfq;

    const updated = this.addQuoteToRFQ(rfq.id, quote, { persist: false, notify: false });
    if (!updated) {
      if (cachedIndex === -1) this.rfqs = this.rfqs.filter((item) => item.id !== rfq.id);
      else this.rfqs[cachedIndex] = previousCached;
      return null;
    }

    let persisted;
    try {
      persisted = await domainQueries.upsertRFQInDB(updated);
      if (!persisted) throw new Error('RFQ quote update completed without a persisted row.');
    } catch (error) {
      if (cachedIndex === -1) this.rfqs = this.rfqs.filter((item) => item.id !== rfq.id);
      else this.rfqs[cachedIndex] = previousCached;
      logger.error('Failed to persist RFQ quote before acknowledgement', {
        error,
        rfqId: rfq.id,
        vendorId: quote.vendorId,
      }, 'STORE_SERVICE');
      const persistError = new Error('The quote could not be saved. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }

    const currentIndex = this.rfqs.findIndex((item) => item.id === persisted.id);
    if (currentIndex === -1) this.rfqs.unshift(persisted);
    else this.rfqs[currentIndex] = persisted;
    this._lastRfqSyncTime = 0;
    this._notifyRFQUpdate(persisted, rfq.status, { status: persisted.status });
    const autoClosed = persisted.status === 'Closed' && rfq.status !== 'Closed';
    this._dispatchQuoteSubmissionSideEffects(rfq, persisted, quote, autoClosed);
    return persisted;
  }

  async submitVendorQuoteDurably(rfqId, quote, {
    includeDeliveryState = false,
    vendorQuoteAcknowledgement = null,
  } = {}) {
    const durableQuoteId = quote.id || crypto.randomUUID();
    if (!pool.hasStorage()) {
      const existingRfq = this.getRFQById(rfqId);
      const updated = this.addQuoteToRFQ(rfqId, { ...quote, id: durableQuoteId });
      if (!updated) {
        return includeDeliveryState
          ? { rfq: null, quoteId: durableQuoteId, buyerQuoteNotificationQueued: false, buyerProfileReminderQueued: false, vendorQuoteAcknowledgementQueued: false, autoClosureEmailQueued: false, autoClosedByQuote: false }
          : null;
      }
      if (quote && quote.vendorId) this.consumeVendorQuotationCredit(quote.vendorId, rfqId);
      const autoClosedByQuote = updated.status === 'Closed' && existingRfq?.status !== 'Closed';
      const buyerEmailPlan = this._buildBuyerQuoteEmailPlan(updated);
      return includeDeliveryState
        ? {
          rfq: updated,
          quoteId: durableQuoteId,
          buyerQuoteNotificationQueued: Boolean(buyerEmailPlan && !buyerEmailPlan.requiresProfileCompletion && !autoClosedByQuote),
          buyerProfileReminderQueued: Boolean(buyerEmailPlan?.requiresProfileCompletion && !autoClosedByQuote),
          vendorQuoteAcknowledgementQueued: false,
          autoClosureEmailQueued: autoClosedByQuote,
          autoClosedByQuote,
        }
        : updated;
    }

    for (let attempt = 0; attempt < RFQ_QUOTE_WRITE_RETRIES; attempt += 1) {
      let rfq;
      let vendor;
      try {
        [rfq, vendor] = await Promise.all([
          domainQueries.getRFQByIdFromDB(rfqId),
          domainQueries.getVendorByIdFromDB(quote.vendorId, { fresh: true }),
        ]);
      } catch (error) {
        logger.error('Failed to load authoritative records before atomic vendor quote submission', {
          error,
          rfqId,
          vendorId: quote.vendorId,
          attempt: attempt + 1,
        }, 'STORE_SERVICE');
        const persistError = new Error('Quotation eligibility could not be verified from storage. Try again.');
        persistError.statusCode = 503;
        persistError.code = 'PERSISTENCE_UNAVAILABLE';
        throw persistError;
      }

      if (!rfq) {
        return includeDeliveryState
          ? { rfq: null, buyerQuoteNotificationQueued: false, buyerProfileReminderQueued: false, vendorQuoteAcknowledgementQueued: false, autoClosureEmailQueued: false, autoClosedByQuote: false }
          : null;
      }
      if (!vendor) {
        const persistError = new Error('The vendor could not be verified in storage. Try again.');
        persistError.statusCode = 503;
        persistError.code = 'PERSISTENCE_UNAVAILABLE';
        throw persistError;
      }

      const vendorHasSubmitted = Array.isArray(rfq.quotes) && rfq.quotes.some(
        (existingQuote) => String(existingQuote.vendorId) === String(vendor.id)
      );
      const vendorHasCreditMarker = Array.isArray(vendor.quotedRfqIds) && vendor.quotedRfqIds.some(
        (quotedRfqId) => String(quotedRfqId) === String(rfq.id)
      );
      const isResubmission = vendorHasSubmitted || vendorHasCreditMarker;
      const eligibility = this.checkVendorQuotationEligibility(vendor, rfq);
      if (!eligibility.eligible && !isResubmission) {
        const error = new Error('Your free quotation credits have been used. Upgrade your subscription to submit another quote.');
        error.statusCode = 403;
        error.code = 'VENDOR_QUOTE_CREDITS_EXHAUSTED';
        error.freeCreditsRemaining = eligibility.freeCreditsRemaining;
        throw error;
      }

      const durableQuote = { ...quote, id: durableQuoteId };
      const cachedIndex = this.rfqs.findIndex((item) => item.id === rfq.id);
      const previousCached = cachedIndex === -1 ? null : this.rfqs[cachedIndex];
      if (cachedIndex === -1) this.rfqs.unshift(rfq);
      else this.rfqs[cachedIndex] = rfq;
      const updatedRFQ = this.addQuoteToRFQ(rfq.id, durableQuote, { persist: false, notify: false });
      if (cachedIndex === -1) this.rfqs = this.rfqs.filter((item) => item.id !== rfq.id);
      else this.rfqs[cachedIndex] = previousCached;
      if (!updatedRFQ) return null;

      const autoClosedByQuote = updatedRFQ.status === 'Closed' && rfq.status !== 'Closed';
      const buyerEmailPlan = this._buildBuyerQuoteEmailPlan(rfq);
      const quoteNotificationEventId = !autoClosedByQuote && buyerEmailPlan
        ? eventOutboxService.buildEventOutboxId(
          EVENT_OUTBOX_TYPES.RFQ_QUOTE_RECEIVED_EMAIL,
          `${rfq.id}:${durableQuoteId}`
        )
        : null;
      const buyerProfileReminderEventId = buyerEmailPlan?.requiresProfileCompletion
        ? eventOutboxService.buildEventOutboxId(
          EVENT_OUTBOX_TYPES.BUYER_PROFILE_COMPLETION_REMINDER_EMAIL,
          rfq.id
        )
        : null;
      const vendorQuoteAcknowledgementEventId = vendorQuoteAcknowledgement?.recipientEmail
        ? eventOutboxService.buildEventOutboxId(
          EVENT_OUTBOX_TYPES.RFQ_VENDOR_QUOTE_ACK_EMAIL,
          `${rfq.id}:${vendorQuoteAcknowledgement.idempotencyKey || durableQuoteId}`
        )
        : null;
      const autoClosureEmailEventId = autoClosedByQuote && buyerEmailPlan
        ? eventOutboxService.buildEventOutboxId(
          EVENT_OUTBOX_TYPES.RFQ_AUTO_CLOSURE_ACK_EMAIL,
          `${rfq.id}:${durableQuoteId}`
        )
        : null;
      const autoClosureComparisonIntent = autoClosedByQuote
        ? rfqChaserScheduler.buildBuyerComparisonJobIntent(updatedRFQ)
        : null;
      const idempotencyKey = `rfq-quote:${vendor.id}:${rfq.id}`;
      let saved;
      try {
        saved = await domainQueries.submitVendorQuoteInDB({
          vendorId: vendor.id,
          rfqId: rfq.id,
          rfqNumber: rfq.rfqNumber,
          transactionId: `tx-${crypto.randomUUID()}`,
          idempotencyKey,
          isBuyerMapped: eligibility.isBuyerMapped,
          isResubmission,
          quoteId: durableQuoteId,
          quoteNotificationEventId,
          ...(quoteNotificationEventId ? {
            quoteNotificationRecipient: buyerEmailPlan.buyerEmail,
            quoteNotificationRecipientName: buyerEmailPlan.buyer?.organizationName || null,
            quoteNotificationPendingOnboarding: buyerEmailPlan.requiresProfileCompletion,
          } : {}),
          ...(buyerProfileReminderEventId ? {
            buyerProfileReminderEventId,
            buyerProfileReminderRecipient: buyerEmailPlan.buyerEmail,
            buyerProfileReminderRecipientName: buyerEmailPlan.buyer?.organizationName || null,
          } : {}),
          ...(vendorQuoteAcknowledgementEventId ? {
            vendorQuoteAcknowledgementEventId,
            vendorQuoteAcknowledgementRecipient: vendorQuoteAcknowledgement.recipientEmail,
            vendorQuoteAcknowledgementRecipientName: vendorQuoteAcknowledgement.recipientName || quote.vendorName || null,
            vendorQuoteAcknowledgementBuyerEmail: vendorQuoteAcknowledgement.buyerEmail || null,
          } : {}),
          autoClosureEmailEventId,
          ...(autoClosureEmailEventId ? {
            autoClosureRecipientEmail: buyerEmailPlan.buyerEmail,
            autoClosureRecipientName: buyerEmailPlan.buyer?.organizationName || null,
          } : {}),
          ...(autoClosureComparisonIntent ? {
            autoClosureComparisonJobId: autoClosureComparisonIntent.id,
            autoClosureComparisonFireAt: autoClosureComparisonIntent.fireAt,
          } : {}),
          expectedVendor: vendor,
          expectedRFQ: rfq,
          updatedRFQ,
        });
      } catch (error) {
        logger.error('Atomic quote and vendor credit write failed', {
          error,
          rfqId: rfq.id,
          vendorId: vendor.id,
          attempt: attempt + 1,
        }, 'STORE_SERVICE');
        const persistError = new Error('The quote could not be saved. Try again.');
        persistError.statusCode = error.statusCode || 503;
        persistError.code = error.code || 'PERSISTENCE_UNAVAILABLE';
        throw persistError;
      }

      if (saved && saved.creditsExhausted) {
        const error = new Error('Your free quotation credits have been used. Upgrade your subscription to submit another quote.');
        error.statusCode = 403;
        error.code = 'VENDOR_QUOTE_CREDITS_EXHAUSTED';
        error.freeCreditsRemaining = saved.freeCreditsRemaining;
        throw error;
      }
      if (saved && saved.notFound) return null;
      if (saved && saved.conflict) continue;
      if (!saved || !saved.rfq || !saved.vendor) {
        const persistError = new Error('The quote transaction returned no saved vendor and RFQ rows. Try again.');
        persistError.statusCode = 503;
        persistError.code = 'PERSISTENCE_UNAVAILABLE';
        throw persistError;
      }

      const savedRFQ = saved.rfq;
      const vendorIndex = this.vendors.findIndex((item) => item.id === saved.vendor.id);
      if (vendorIndex === -1) this.vendors.unshift(saved.vendor);
      else this.vendors[vendorIndex] = saved.vendor;
      const currentRFQIndex = this.rfqs.findIndex((item) => item.id === savedRFQ.id);
      if (currentRFQIndex === -1) this.rfqs.unshift(savedRFQ);
      else this.rfqs[currentRFQIndex] = savedRFQ;
      this._lastRfqSyncTime = 0;
      this._notifyRFQUpdate(savedRFQ, rfq.status, { status: savedRFQ.status });
      const autoClosed = savedRFQ.status === 'Closed' && rfq.status !== 'Closed';
      if (vendorQuoteAcknowledgementEventId) {
        this._background(
          eventOutboxService.dispatchDueEventOutboxJobs(1, [vendorQuoteAcknowledgementEventId]),
          'Failed to dispatch durable vendor quote acknowledgement',
          {
            operation: 'vendor-quote-acknowledgement',
            rfqId: rfq.id,
            rfqNumber: rfq.rfqNumber,
            vendorId: vendor.id,
            quoteId: durableQuoteId,
          }
        );
      }
      if (quoteNotificationEventId || buyerProfileReminderEventId || autoClosureEmailEventId) {
        this._dispatchQuoteSubmissionSideEffects(rfq, savedRFQ, durableQuote, autoClosed, {
          ...((quoteNotificationEventId || buyerProfileReminderEventId || autoClosureEmailEventId)
            ? { skipQuoteEmail: true }
            : {}),
          ...(autoClosureEmailEventId ? { skipAutoClosureEmail: true } : {}),
          ...(autoClosureComparisonIntent ? { comparisonJob: autoClosureComparisonIntent } : {}),
        });
      } else {
        this._dispatchQuoteSubmissionSideEffects(rfq, savedRFQ, durableQuote, autoClosed);
      }
      if (quoteNotificationEventId && buyerEmailPlan.requiresProfileCompletion) {
        try {
          const persistedBuyer = await domainQueries.getBuyerAccountByEmailFromDB(buyerEmailPlan.buyerEmail, { fresh: true });
          if (persistedBuyer && !this.isBuyerProfileUpdateRequired(persistedBuyer, rfq)) {
            await this._releasePersistedPendingQuoteNotifications(buyerEmailPlan.buyerEmail);
          }
        } catch (error) {
          logger.warn('Could not recheck buyer onboarding after quote commit; deferred quote email remains queued', {
            operation: 'recheck-buyer-quote-onboarding',
            rfqId: rfq.id,
            rfqNumber: rfq.rfqNumber,
            buyerEmail: buyerEmailPlan.buyerEmail,
            error,
          }, 'STORE_SERVICE');
        }
      }
      logger.info('Vendor quote submission committed with credit accounting', {
        rfqId: rfq.id,
        vendorId: vendor.id,
        creditCharged: saved.creditCharged,
        attempt: attempt + 1,
      }, 'STORE_SERVICE');
      return includeDeliveryState
        ? {
          rfq: savedRFQ,
          quoteId: durableQuoteId,
          buyerQuoteNotificationQueued: Boolean(quoteNotificationEventId),
          buyerProfileReminderQueued: Boolean(buyerProfileReminderEventId),
          vendorQuoteAcknowledgementQueued: Boolean(vendorQuoteAcknowledgementEventId),
          autoClosureEmailQueued: Boolean(autoClosureEmailEventId),
          autoClosedByQuote: autoClosed,
        }
        : savedRFQ;
    }

    const conflictError = new Error('This RFQ changed while the quote was being submitted. Please retry your submission.');
    conflictError.statusCode = 409;
    conflictError.code = 'RFQ_QUOTE_WRITE_CONFLICT';
    logger.warn('Vendor quote could not commit after bounded RFQ conflict retries', {
      rfqId,
      vendorId: quote && quote.vendorId,
      retries: RFQ_QUOTE_WRITE_RETRIES,
    }, 'STORE_SERVICE');
    throw conflictError;
  }

  cancelDelayedQuoteTimers(rfqId) {
    if (!rfqId || !this._delayedQuoteTimers) return;
    const timers = this._delayedQuoteTimers.get(rfqId);
    if (Array.isArray(timers)) {
      timers.forEach((t) => clearTimeout(t));
      this._delayedQuoteTimers.delete(rfqId);
    }
  }

  notifyBuyerOfAutoClosureAndScheduleComparison(rfq, quotes, { skipEmail = false, comparisonJob = null } = {}) {
    if (!rfq) return;
    const buyerEmail = this.resolveBuyerEmailForRFQ(rfq);
    const buyer = (rfq.buyerAccountId && this.buyerAccounts.find((a) => a.id === rfq.buyerAccountId)) || {
      id: rfq.buyerAccountId || null,
      corporateEmail: buyerEmail,
      organizationName: rfq.buyerAccountName || rfq.buyerName || 'Buyer',
      phone: rfq.buyerPhone || null,
    };

    // 1. In-app notification for buyer
    if (rfq.buyerAccountId) {
      const notification = this._buildNotification({
        recipientType: 'buyer',
        recipientId: rfq.buyerAccountId,
        kind: 'rfq_auto_closed',
        rfq,
        title: `RFQ ${rfq.rfqNumber} Auto-Closed (100% Quotes Received)`,
        message: `All ${quotes.length} invited vendor(s) have submitted quotes for RFQ ${rfq.rfqNumber} — ${rfq.title}. RFQ is closed. Comparative evaluation will be ready in 5 minutes.`,
        meta: {
          quotesCount: quotes.length,
          autoClosed: true,
        },
      });
      this.notifications.unshift(notification);
      this._persistNotification(notification);
    }

    // 2. Immediate RFQ Auto-Closure Acknowledgement Email to buyer
    if (buyer.corporateEmail && !skipEmail) {
      this._background(
        mailerService.sendRfqAutoClosureAcknowledgementEmail(buyer.corporateEmail, {
          rfq,
          quotesCount: quotes.length,
          recipientName: buyer.organizationName,
        }),
        'Failed to email auto-closure acknowledgement to buyer',
        {
          deliveryChannel: 'email',
          operation: 'rfq-auto-closure-acknowledgement',
          rfqId: rfq.id,
          rfqNumber: rfq.rfqNumber,
        }
      );
    }

    // 3. Persist the delayed comparison notice. Node uses a timer backed by
    // this row; Workers dispatch it from the existing one-minute Cron trigger.
    if (comparisonJob) rfqChaserScheduler.schedulePersistedBuyerComparison(rfq, comparisonJob);
    else rfqChaserScheduler.scheduleBuyerComparison(rfq);
  }

  async dispatchBuyerComparisonNotification(rfq, deliveryState = {}) {
    if (!rfq) throw new Error('Cannot dispatch buyer comparison notification without an RFQ');
    const freshRfq = this.getRFQById(rfq.id || rfq.rfqNumber) || rfq;
    const quotes = Array.isArray(freshRfq.quotes) ? freshRfq.quotes : [];
    const buyerEmail = this.resolveBuyerEmailForRFQ(freshRfq);
    const buyer = (freshRfq.buyerAccountId && this.buyerAccounts.find((account) => account.id === freshRfq.buyerAccountId)) || {
      id: freshRfq.buyerAccountId || null,
      corporateEmail: buyerEmail,
      organizationName: freshRfq.buyerAccountName || freshRfq.buyerName || 'Buyer',
      phone: freshRfq.buyerPhone || null,
    };

    logger.info(
      `Auto-closure comparison delay complete for RFQ ${freshRfq.rfqNumber}. Dispatching comparison email and SMS.`,
      { rfqNumber: freshRfq.rfqNumber, quotesCount: quotes.length, buyerEmail: buyer.corporateEmail },
      'STORE_SERVICE'
    );

    let emailCompleted = Boolean(deliveryState.emailCompleted);
    let smsCompleted = Boolean(deliveryState.smsCompleted);

    if (this.isBuyerProfileUpdateRequired(buyer, freshRfq)) {
      logger.info(
        `Buyer profile verification is pending. Queueing submitted quotes and withholding comparison email for RFQ ${freshRfq.rfqNumber}.`,
        { rfqNumber: freshRfq.rfqNumber, quotesCount: quotes.length, buyerEmail: buyer.corporateEmail },
        'STORE_SERVICE'
      );
      if (buyer.corporateEmail && !this.hasQuoteAckBeenSent(freshRfq)) {
        quotes.forEach((quote) => this.queuePendingQuoteNotification(buyer.corporateEmail, { rfq: freshRfq, quote }));
      }
      if (buyer.corporateEmail && !emailCompleted) {
        if (!this.hasQuoteAckBeenSent(freshRfq)) this.markQuoteAckSent(freshRfq);
        const reminderResult = await mailerService.sendBuyerProfileCompletionReminderEmail({
          to: buyer.corporateEmail,
          recipientName: buyer.organizationName,
          rfqNumber: freshRfq.rfqNumber,
          rfqTitle: freshRfq.title,
          quotesCount: quotes.length,
        });
        emailCompleted = !(reminderResult && reminderResult.sent === false);
        if (!emailCompleted) {
          logger.error('Buyer profile completion reminder email was not sent', {
            rfqId: freshRfq.id,
            rfqNumber: freshRfq.rfqNumber,
            buyerEmail: buyer.corporateEmail,
            error: reminderResult.error || null,
          }, 'STORE_SERVICE');
        }
      }
      if (!buyer.corporateEmail) emailCompleted = true;
      // A pending profile intentionally withholds SMS and the comparison matrix.
      smsCompleted = true;
      return { emailCompleted, smsCompleted };
    }

    const deliveries = [];
    if (buyer.corporateEmail && !emailCompleted) {
      deliveries.push({
        channel: 'email',
        promise: mailerService.sendRfqFinalComparisonEmail(buyer.corporateEmail, {
          rfq: freshRfq,
          quotes,
          recipientName: buyer.organizationName,
        }),
      });
    } else if (!buyer.corporateEmail) emailCompleted = true;
    const buyerPhone = buyer.phone || buyer.corporatePhone || freshRfq.buyerPhone;
    if (buyerPhone && !smsCompleted) {
      deliveries.push({
        channel: 'sms',
        promise: smsService.sendBuyerComparisonSms({
          mobile: buyerPhone,
          rfqNumber: freshRfq.rfqNumber,
          quotesCount: quotes.length,
          buyerName: buyer.organizationName,
        }),
      });
    } else if (!buyerPhone) smsCompleted = true;

    if (!buyer.corporateEmail && !buyerPhone && !deliveryState.emailCompleted && !deliveryState.smsCompleted) {
      logger.warn('Buyer comparison notification has no configured delivery destination', {
        rfqId: freshRfq.id,
        rfqNumber: freshRfq.rfqNumber,
      }, 'STORE_SERVICE');
      emailCompleted = true;
      smsCompleted = true;
      return { emailCompleted, smsCompleted };
    }

    const results = await Promise.allSettled(deliveries.map(({ promise }) => promise));
    const failures = results.flatMap((result, index) => {
      if (result.status === 'rejected') {
        return [{ channel: deliveries[index].channel, error: result.reason }];
      }
      if (result.value && (result.value.sent === false || result.value.success === false)) {
        return [{ channel: deliveries[index].channel, error: result.value.error || 'delivery returned unsuccessful status' }];
      }
      if (deliveries[index].channel === 'email') emailCompleted = true;
      if (deliveries[index].channel === 'sms') smsCompleted = true;
      return [];
    });
    if (failures.length) {
      logger.error('Buyer comparison notification delivery failed', {
        rfqId: freshRfq.id,
        rfqNumber: freshRfq.rfqNumber,
        failures,
      }, 'STORE_SERVICE');
    }
    return { emailCompleted, smsCompleted };
  }

  async addInquiryToRFQ(rfqId, inquiry) {
    const rfq = await this.getRFQByIdAsync(rfqId);
    if (!rfq) return null;

    const existingInquiries = Array.isArray(rfq.inquiries) ? [...rfq.inquiries] : [];
    const timestamp = inquiry.createdAt || new Date().toISOString();
    const vendorEmail = inquiry.vendorEmail || null;
    const vendorName = inquiry.vendorName || 'Vendor Partner';
    const vendorId = inquiry.vendorId || null;

    const chatMsg = {
      id: inquiry.messageId
        ? `msg-email-${crypto.createHash('sha256').update(String(inquiry.messageId)).digest('hex')}`
        : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderRole: 'vendor',
      senderName: vendorName,
      senderEmail: vendorEmail,
      message: inquiry.message || '',
      timestamp,
    };

    // Check if there is an existing thread for this vendor
    const existingIndex = existingInquiries.findIndex(
      (inq) =>
        (vendorId && inq.vendorId === vendorId) ||
        (vendorEmail && inq.vendorEmail && inq.vendorEmail.toLowerCase() === vendorEmail.toLowerCase()) ||
        (inq.vendorName && inq.vendorName.toLowerCase() === vendorName.toLowerCase())
    );

    let updatedInquiry;
    let inquiries;

    if (existingIndex !== -1) {
      const target = existingInquiries[existingIndex];
      const prevMsgs = Array.isArray(target.messages) && target.messages.length > 0
        ? target.messages
        : [
            {
              id: `msg-${target.id}-orig`,
              senderRole: 'vendor',
              senderName: target.vendorName,
              senderEmail: target.vendorEmail,
              message: target.message,
              timestamp: target.createdAt,
            },
            ...(target.reply
              ? [
                  {
                    id: `msg-${target.id}-reply`,
                    senderRole: 'buyer',
                    senderName: target.repliedBy || 'Procurement Team',
                    message: target.reply,
                    timestamp: target.repliedAt || target.createdAt,
                  },
                ]
              : []),
          ];

      if (prevMsgs.some((message) => message.id === chatMsg.id)) {
        return { updatedRfq: rfq, inquiry: target, inquiryMessageId: chatMsg.id, duplicate: true };
      }

      updatedInquiry = {
        ...target,
        message: inquiry.message || target.message,
        createdAt: timestamp,
        status: 'open',
        messages: [...prevMsgs, chatMsg],
      };
      existingInquiries[existingIndex] = updatedInquiry;
      inquiries = existingInquiries;
    } else {
      updatedInquiry = {
        id: inquiry.id || `inq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        rfqNumber: rfq.rfqNumber,
        rfqId: rfq.id,
        vendorId,
        vendorName,
        vendorEmail,
        message: inquiry.message || '',
        createdAt: timestamp,
        status: 'open',
        messages: [chatMsg],
      };
      inquiries = [...existingInquiries, updatedInquiry];
    }

    const shouldQueueAcknowledgement = inquiry.queueAcknowledgement === true && Boolean(vendorEmail);
    const outboxResult = {};
    const outboxEvent = shouldQueueAcknowledgement
      ? {
          id: eventOutboxService.buildEventOutboxId(
            EVENT_OUTBOX_TYPES.RFQ_VENDOR_INQUIRY_ACK_EMAIL,
            `${rfq.id}:${chatMsg.id}`
          ),
          eventType: EVENT_OUTBOX_TYPES.RFQ_VENDOR_INQUIRY_ACK_EMAIL,
          payload: {
            rfqId: rfq.id,
            inquiryId: updatedInquiry.id,
            messageId: chatMsg.id,
          },
        }
      : null;
    const updated = await this.updateRFQDurably(
      rfq.id,
      { inquiries },
      outboxEvent ? { outboxEvent, outboxResult } : {}
    );
    if (!updated) return null;

    this.addFeedItem({
      type: 'system',
      channel: 'email',
      title: `Vendor Clarification on ${rfq.rfqNumber}`,
      message: `${vendorName} asked: "${inquiry.message.slice(0, 120)}"`,
      recipient: rfq.raisedByEmail || rfq.buyerAccountName,
      rfqNumber: rfq.rfqNumber,
    });

    this.addAuditLog({
      action: `Inquiry / Clarification submitted by ${vendorName} on ${rfq.rfqNumber}: "${inquiry.message.slice(0, 100)}"`,
      rfqNumber: rfq.rfqNumber,
      userEmail: vendorEmail || 'system@procucev.ai',
    });

    // Notify buyer
    if (rfq.buyerAccountId) {
      this.notifyBuyerOfInquiry(rfq, updatedInquiry);
    }

    return {
      updatedRfq: updated,
      inquiry: updatedInquiry,
      inquiryMessageId: chatMsg.id,
      ...(shouldQueueAcknowledgement
        ? {
            acknowledgementOutboxEvent: outboxResult.event || null,
            acknowledgementAtomicUnsupported: outboxResult.atomicUnsupported === true,
          }
        : {}),
    };
  }

  async replyToRFQInquiry(rfqId, inquiryId, replyData) {
    const rfq = await this.getRFQByIdAsync(rfqId);
    if (!rfq) return null;

    const existingInquiries = Array.isArray(rfq.inquiries) ? [...rfq.inquiries] : [];
    const inqIndex = existingInquiries.findIndex((i) => i.id === inquiryId);
    if (inqIndex === -1) return null;

    const target = existingInquiries[inqIndex];
    const timestamp = new Date().toISOString();
    const repliedBy = replyData.repliedBy || 'Procurement Officer';

    const prevMsgs = Array.isArray(target.messages) && target.messages.length > 0
      ? target.messages
      : [
          {
            id: `msg-${target.id}-orig`,
            senderRole: 'vendor',
            senderName: target.vendorName,
            senderEmail: target.vendorEmail,
            message: target.message,
            timestamp: target.createdAt,
          },
          ...(target.reply
            ? [
                {
                  id: `msg-${target.id}-reply`,
                  senderRole: 'buyer',
                  senderName: target.repliedBy || 'Procurement Team',
                  message: target.reply,
                  timestamp: target.repliedAt || target.createdAt,
                },
              ]
            : []),
        ];

    const replyMsg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderRole: 'buyer',
      senderName: repliedBy,
      message: replyData.reply || '',
      timestamp,
    };

    const updatedInquiry = {
      ...target,
      reply: replyData.reply || '',
      repliedAt: timestamp,
      repliedBy,
      status: 'answered',
      messages: [...prevMsgs, replyMsg],
    };

    existingInquiries[inqIndex] = updatedInquiry;
    const updated = await this.updateRFQDurably(rfq.id, { inquiries: existingInquiries });
    if (!updated) return null;

    this.addFeedItem({
      type: 'system',
      channel: 'email',
      title: `Clarification Answered on ${rfq.rfqNumber}`,
      message: `Buyer replied to ${updatedInquiry.vendorName}: "${(replyData.reply || '').slice(0, 120)}"`,
      recipient: updatedInquiry.vendorEmail || updatedInquiry.vendorName,
      rfqNumber: rfq.rfqNumber,
    });

    this.addAuditLog({
      action: `Buyer replied to vendor inquiry on ${rfq.rfqNumber} for ${updatedInquiry.vendorName}: "${(replyData.reply || '').slice(0, 100)}"`,
      rfqNumber: rfq.rfqNumber,
      userEmail: replyData.repliedByEmail || 'system@procucev.ai',
    });

    return { updatedRfq: updated, inquiry: updatedInquiry };
  }

  deleteRFQ(id) {
    const rfq = this.rfqs.find((record) => record.id === id || record.rfqNumber === id);
    if (!rfq) return false;

    // The database delete is keyed by the persisted row ID. Callers may use
    // either that ID or the public RFQ number, so resolve the row before
    // writing or the cache could report a deletion that never reached storage.
    this._removeRFQ(rfq.id);
    this._removeRFQFromMemory(rfq, id);
    return true;
  }

  async deleteRFQDurably(id) {
    const rfq = this.rfqs.find((record) => record.id === id || record.rfqNumber === id);
    if (!rfq) return false;

    if (pool.hasStorage()) {
      try {
        await domainQueries.deleteRFQInDB(rfq.id);
      } catch (error) {
        logger.error('Failed to persist RFQ deletion', error, 'STORE_SERVICE');
        const persistError = new Error('The RFQ could not be deleted from storage. Try again.');
        persistError.statusCode = 503;
        persistError.code = 'PERSISTENCE_UNAVAILABLE';
        throw persistError;
      }
    }

    this._lastRfqSyncTime = 0;
    this._removeRFQFromMemory(rfq, id);
    return true;
  }

  _removeRFQFromMemory(rfq, requestedId) {
    this.rfqs = this.rfqs.filter((record) => record.id !== rfq.id);

    if (this._delayedQuoteTimers) {
      for (const timerId of new Set([requestedId, rfq.id, rfq.rfqNumber])) {
        if (!this._delayedQuoteTimers.has(timerId)) continue;
        const handles = this._delayedQuoteTimers.get(timerId) || [];
        handles.forEach((h) => clearTimeout(h));
        this._delayedQuoteTimers.delete(timerId);
      }
    }
  }

  // getRFQSummary was removed with the RFQ seeds. The portfolio roll-up now
  // lives in rfqSummaryService.buildPortfolioSummary, which is handed one
  // organisation's rows rather than reducing over a single global array, and
  // which no longer invents follow-up channel statistics.

  // ==========================================
  // 3b. NOTIFICATIONS
  // ==========================================
  // In-app alerts, persisted to Neon like every other domain collection. Two
  // producers today: a category-matched RFQ fan-out to vendors (createRFQ) and
  // a "quote received" alert to the RFQ's owning buyer (addQuoteToRFQ). Reads
  // are always scoped to one recipient — the controller resolves the caller's
  // vendor row or buyer account from the session and passes its id here.

  /** Every notification addressed to one recipient, newest first. */
  getNotificationsFor(recipientType, recipientId, limit = null) {
    if (!recipientId) return [];
    const list = this.notifications.filter(
      (n) => n.recipientType === recipientType && n.recipientId === recipientId
    );
    if (Number.isInteger(limit) && limit > 0) {
      return list.slice(0, limit);
    }
    return list;
  }

  /** Count of that recipient's unread notifications. */
  getUnreadNotificationCountFor(recipientType, recipientId) {
    return this.getNotificationsFor(recipientType, recipientId).filter((n) => !n.read).length;
  }

  // Both producers pass a real RFQ and a meta object; keep it that way so this
  // has no defensive branches to leave uncovered.
  _buildNotification({ recipientType, recipientId, kind, rfq, title, message, meta }) {
    return {
      id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      recipientType,
      recipientId,
      kind,
      rfqId: rfq ? rfq.id : (meta && meta.rfqId) || null,
      rfqNumber: rfq ? rfq.rfqNumber : (meta && meta.rfqNumber) || null,
      title,
      message,
      meta,
      read: false,
      createdAt: new Date().toISOString(),
    };
  }

  async createNotificationDurably({ recipientType, recipientId, kind, title, message, meta }) {
    const notification = this._buildNotification({
      recipientType,
      recipientId,
      kind,
      title,
      message,
      meta,
    });

    try {
      await eventOutboxService.persistWithOutboxFallback({
        eventType: EVENT_OUTBOX_TYPES.NOTIFICATION,
        idempotencyKey: notification.id,
        payload: notification,
        operation: 'persist-notification',
        write: () => domainQueries.insertNotificationInDB(notification),
      });
    } catch (error) {
      logger.error('Failed to durably persist low-credit notification', {
        error,
        notificationId: notification.id,
        recipientType,
      }, 'STORE_SERVICE');
      const persistError = new Error(PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE);
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      persistError.retryable = true;
      throw persistError;
    }

    this.notifications.unshift(notification);
    return notification;
  }

  /**
   * Mark one notification read, but only if it belongs to the caller — a
   * recipient must not be able to flip another recipient's notification by id.
   * Returns the updated notification, or null when it is not theirs / not found.
   */
  markNotificationRead(id, recipientType, recipientId) {
    const notification = this.notifications.find(
      (n) => n.id === id && n.recipientType === recipientType && n.recipientId === recipientId
    );
    if (!notification) return null;
    if (!notification.read) {
      notification.read = true;
      this._background(
        domainQueries.markNotificationReadInDB(id, recipientType, recipientId),
        'Failed to persist notification read'
      );
    }
    return notification;
  }

  async markNotificationReadDurably(id, recipientType, recipientId) {
    if (!pool.hasStorage()) return this.markNotificationRead(id, recipientType, recipientId);

    const notification = this.notifications.find(
      (item) => item.id === id && item.recipientType === recipientType && item.recipientId === recipientId
    );
    if (!notification) return null;

    try {
      const persisted = await domainQueries.markNotificationReadInDB(id, recipientType, recipientId);
      if (!persisted) {
        this.notifications = this.notifications.filter((item) => item.id !== id);
        return null;
      }
      notification.read = true;
      return notification;
    } catch (error) {
      logger.error('Failed to persist notification read state', error, 'STORE_SERVICE');
      const persistError = new Error(PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE);
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      persistError.retryable = true;
      throw persistError;
    }
  }

  /** Mark all of one recipient's notifications read. Returns how many changed. */
  markAllNotificationsRead(recipientType, recipientId) {
    let changed = 0;
    for (const n of this.notifications) {
      if (n.recipientType === recipientType && n.recipientId === recipientId && !n.read) {
        n.read = true;
        changed += 1;
      }
    }
    if (changed > 0) {
      this._background(
        domainQueries.markAllNotificationsReadInDB(recipientType, recipientId),
        'Failed to persist bulk notification read'
      );
    }
    return changed;
  }

  async markAllNotificationsReadDurably(recipientType, recipientId) {
    if (!pool.hasStorage()) return this.markAllNotificationsRead(recipientType, recipientId);

    try {
      const changed = await domainQueries.markAllNotificationsReadInDB(recipientType, recipientId);
      this.notifications.forEach((notification) => {
        if (notification.recipientType === recipientType && notification.recipientId === recipientId) {
          notification.read = true;
        }
      });
      return changed;
    } catch (error) {
      logger.error('Failed to persist bulk notification read state', error, 'STORE_SERVICE');
      const persistError = new Error(PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE);
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      persistError.retryable = true;
      throw persistError;
    }
  }

  isBuyerUploaded(vendor) {
    if (!vendor) return false;
    if (
      vendor.addedByBuyerCompany ||
      vendor.buyerAccountId ||
      vendor.buyerId ||
      vendor.buyerEmail ||
      (Array.isArray(vendor.mappedBuyerIds) && vendor.mappedBuyerIds.length > 0) ||
      (Array.isArray(vendor.buyerIds) && vendor.buyerIds.length > 0)
    ) return true;
    const s = String(vendor.source || '').toLowerCase().trim();
    const id = String(vendor.id || '').toLowerCase().trim();
    return Boolean(
      s === 'buyer_uploaded' ||
      s === 'vendor_master_ingestion' ||
      s === 'historical_purchase_dump' ||
      s === 'buyer_manual' ||
      s === 'buyer_excel' ||
      s === 'excel_upload' ||
      s === 'po_ingestion' ||
      s === 'client_uploaded' ||
      s === 'buyer' ||
      s.includes('buyer') ||
      s.includes('ingestion') ||
      s.includes('purchase_dump') ||
      id.startsWith('v-hist-') ||
      id.startsWith('vm-') ||
      id.startsWith('v-ingest-') ||
      id.startsWith('v-buyer-')
    );
  }

  /**
   * Scores vendor location relevance to delivery destination.
   * Priority:
   *  - Exact 6-digit pincode match: 100
   *  - Same 3-digit postal district prefix: 90
   *  - Same 1-digit postal region: 70
   *  - City name match in destination or vendor: 85
   *  - State name match in destination or vendor: 65
   *  - Regional token match (>=4 chars): 60
   *  - Nationwide baseline / no location specified: 40
   */
  scoreVendorLocation(vendor, destination) {
    if (!vendor || !destination) return 40;
    const vendorPin = String(vendor.pincode || '').replace(/\D/g, '');
    const destPin = String(
      (typeof destination === 'string' && /^\d{6}$/.test(destination.trim())
        ? destination
        : destination.pincode || destination.deliveryPincode) || ''
    ).replace(/\D/g, '');

    if (vendorPin.length === 6 && destPin.length === 6) {
      if (vendorPin === destPin) return 100;
      if (vendorPin.slice(0, 3) === destPin.slice(0, 3)) return 90;
      if (vendorPin[0] === destPin[0]) return 70;
    }

    const destText = String(
      (typeof destination === 'string' && !/^\d{6}$/.test(destination.trim())
        ? destination
        : destination.location || destination.deliveryLocation) || ''
    )
      .toLowerCase()
      .trim();

    const vendorText = `${vendor.location || ''} ${vendor.city || ''} ${vendor.state || ''}`.toLowerCase().trim();

    if (destText) {
      if (vendor.city && destText.includes(String(vendor.city).toLowerCase().trim())) {
        return 85;
      }
      if (vendor.state && destText.includes(String(vendor.state).toLowerCase().trim())) {
        return 65;
      }
      if (vendorText) {
        const tokens = destText.split(/[\s,/]+/).filter((t) => t.length >= 4);
        if (tokens.some((tok) => vendorText.includes(tok))) {
          return 60;
        }
      }
    }

    return 40;
  }

  /**
   * Whether a vendor covers an RFQ's category.
   *
   * Matches across:
   * 1. Exact match (case-insensitive, trimmed)
   * 2. Canonical major category alias matching
   * 3. Taxonomy hierarchy: Major covering Minor, or Minor mapped to Major
   * 4. Token & word boundary matching for specific categories
   */
  /**
   * Checks whether a category or minor category is recognized in our taxonomy / master category list.
   * @param {string} category
   * @returns {boolean}
   */
  isCategoryAvailable(category) {
    if (!category || typeof category !== 'string') return false;
    const trimmed = category.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    if (MINOR_TO_MAJOR_MAP.has(lower)) return true;
    if (MAJOR_TO_MINORS_MAP.has(lower)) return true;
    const canonical = resolveCanonicalCategory(trimmed);
    if (canonical) {
      const canLower = canonical.toLowerCase();
      if (MAJOR_TO_MINORS_MAP.has(canLower)) return true;
      if (MINOR_TO_MAJOR_MAP.has(canLower)) return true;
    }
    if (KEYWORD_TAXONOMY_MAP && KEYWORD_TAXONOMY_MAP[lower]) return true;
    for (const group of DEFAULT_CATEGORY_TAXONOMY || []) {
      if (!group) continue;
      if (group.majorCategory && group.majorCategory.trim().toLowerCase() === lower) return true;
      if (Array.isArray(group.minorCategories)) {
        if (group.minorCategories.some((m) => m && String(m).trim().toLowerCase() === lower)) return true;
      }
    }
    if (Array.isArray(this.vendors) && this.vendors.some((v) => {
      if (!v) return false;
      if (v.majorCategory && String(v.majorCategory).trim().toLowerCase() === lower) return true;
      if (Array.isArray(v.minorCategories) && v.minorCategories.some((m) => m && String(m).trim().toLowerCase() === lower)) return true;
      return false;
    })) {
      return true;
    }
    return false;
  }

  vendorCoversCategory(vendor, category) {
    if (!vendor || !category) return false;
    const target = String(category).trim().toLowerCase();
    if (!target) return false;

    const targetCanonical = resolveCanonicalCategory(target).toLowerCase();
    const targetMajorFromMinor = MINOR_TO_MAJOR_MAP.get(target);

    const pools = [
      vendor.majorCategory,
      ...extractCategories(vendor.minorCategories),
      ...extractCategories(vendor.vendorSelectedCategories),
      ...extractCategories(vendor.clientMappedCategories),
      ...extractCategories(vendor.categories),
    ];

    return pools.some((c) => {
      if (!c) return false;
      const normalized = String(c).trim().toLowerCase();
      if (!normalized) return false;

      // 1. Exact match
      if (normalized === target) return true;

      // 2. Canonical alias match
      const poolCanonical = resolveCanonicalCategory(normalized).toLowerCase();
      if (poolCanonical === targetCanonical) return true;

      // 3. Taxonomy hierarchy
      // a) RFQ target is Major Category, vendor's category is Minor under that Major
      const poolMajor = MINOR_TO_MAJOR_MAP.get(normalized);
      if (poolMajor && (poolMajor.toLowerCase() === targetCanonical || poolMajor.toLowerCase() === target)) {
        return true;
      }
      const targetMinors = MAJOR_TO_MINORS_MAP.get(targetCanonical) || MAJOR_TO_MINORS_MAP.get(target);
      if (targetMinors && targetMinors.has(normalized)) {
        return true;
      }

      // b) RFQ target is Minor Category, vendor's category is the Major Category
      if (targetMajorFromMinor && (normalized === targetMajorFromMinor.toLowerCase() || poolCanonical === targetMajorFromMinor.toLowerCase())) {
        return true;
      }
      const poolMinors = MAJOR_TO_MINORS_MAP.get(poolCanonical) || MAJOR_TO_MINORS_MAP.get(normalized);
      if (poolMinors && poolMinors.has(target)) {
        return true;
      }

      // 4. Token / word-boundary matching
      if (target.length >= 4 && normalized.length >= 4) {
        if (target.includes(normalized) || normalized.includes(target)) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Every category string an RFQ carries — its own `category` plus each
   * confirmed line item's major/minor/category. An RFQ raised from a BOQ often
   * only tags the line items, not the RFQ header, so matching on the header
   * alone would route nothing.
   */
  _rfqCategorySignals(rfq) {
    if (!rfq) return [];
    const items = [
      ...(Array.isArray(rfq.extractedEntities) ? rfq.extractedEntities : []),
      ...(Array.isArray(rfq.lineItems) ? rfq.lineItems : []),
    ];

    const rawSignals = [];
    if (rfq.category) rawSignals.push(rfq.category);
    if (rfq.minorCategory) rawSignals.push(rfq.minorCategory);
    if (Array.isArray(rfq.minorCategories)) rawSignals.push(...rfq.minorCategories);

    for (const ent of items) {
      if (!ent) continue;
      if (ent.majorCategory) rawSignals.push(ent.majorCategory);
      if (ent.minorCategory) rawSignals.push(ent.minorCategory);
      if (ent.subCategory) rawSignals.push(ent.subCategory);
      if (ent.category) rawSignals.push(ent.category);
      const text = [ent.description, ent.itemName, ent.name, ent.materialDescription].filter(Boolean).join(' ').toLowerCase();
      if (text) {
        if (text.includes('pipe') || text.includes('plumbing') || text.includes('fitting') || text.includes('flange') || text.includes('pvc')) {
          rawSignals.push('Pipes & Pipe Fittings', 'Plumbing');
        }
        if (text.includes('bubble roll') || text.includes('bubble wrap') || text.includes('packing') || text.includes('corrugated')) {
          rawSignals.push('Packing Material', 'Packaging Material');
        }
      }
    }
    const titleText = String(rfq.title || '').toLowerCase();
    if (titleText) {
      if (titleText.includes('pipe') || titleText.includes('plumbing') || titleText.includes('fitting') || titleText.includes('flange') || titleText.includes('pvc')) {
        rawSignals.push('Pipes & Pipe Fittings', 'Plumbing');
      }
      if (titleText.includes('bubble roll') || titleText.includes('bubble wrap') || titleText.includes('packing') || titleText.includes('corrugated')) {
        rawSignals.push('Packing Material', 'Packaging Material');
      }
    }

    const expanded = new Set();
    for (const sig of rawSignals) {
      if (!sig || typeof sig !== 'string') continue;
      const trimmed = sig.trim();
      if (!trimmed) continue;
      expanded.add(trimmed);

      const canonical = resolveCanonicalCategory(trimmed);
      if (canonical) expanded.add(canonical);

      const lower = trimmed.toLowerCase();
      const minors = MAJOR_TO_MINORS_MAP.get(lower) || (canonical ? MAJOR_TO_MINORS_MAP.get(canonical.toLowerCase()) : null);
      if (minors) {
        for (const m of minors) {
          if (m) expanded.add(m);
        }
      }
      // Strictly do not expand minor category to parent major category.
    }

    return Array.from(expanded);
  }

  /**
   * Returns distinct category strings representing the line item / RFQ categories.
   * Priority:
   * 1. Line item majorCategory or category
   * 2. RFQ header category
   * 3. Line item minorCategory (fallback if no major/category)
   *
   * @param {Object} rfq
   * @returns {string[]} Unique trimmed category names.
   */
  _rfqDistinctCategories(rfq) {
    if (!rfq) return [];
    const cats = new Set();
    const items = Array.isArray(rfq.extractedEntities)
      ? rfq.extractedEntities
      : Array.isArray(rfq.lineItems)
      ? rfq.lineItems
      : [];
    for (const ent of items) {
      const c = ent.majorCategory || ent.category;
      if (c && typeof c === 'string' && c.trim()) {
        cats.add(c.trim());
      }
    }
    if (rfq.category && typeof rfq.category === 'string' && rfq.category.trim()) {
      cats.add(rfq.category.trim());
    }
    if (cats.size === 0) {
      for (const ent of items) {
        if (ent.minorCategory && typeof ent.minorCategory === 'string' && ent.minorCategory.trim()) {
          cats.add(ent.minorCategory.trim());
        }
      }
    }
    return Array.from(cats);
  }

  /**
   * Checks whether a vendor covers a specific minor category.
   * Matches across:
   * 1. vendor.minorCategories (exact or token/substring)
   * 2. vendor.vendorSelectedCategories
   * 3. vendor.clientMappedCategories
   * 4. vendor.majorCategory if it matches the minorCategory directly
   *
   * @param {Object} vendor
   * @param {string} minorCategory
   * @returns {boolean}
   */
  vendorCoversMinorCategory(vendor, minorCategory) {
    if (!vendor || !minorCategory) return false;
    const target = String(minorCategory).trim().toLowerCase();
    if (!target) return false;

    // Check direct major category equality or token match
    if (vendor.majorCategory) {
      const vMaj = String(vendor.majorCategory).trim().toLowerCase();
      if (vMaj === target) return true;
      if (target.length >= 4 && vMaj.length >= 4 && (target.includes(vMaj) || vMaj.includes(target))) {
        return true;
      }
    }

    const pools = [
      ...extractCategories(vendor.minorCategories),
      ...extractCategories(vendor.vendorSelectedCategories),
      ...extractCategories(vendor.clientMappedCategories),
      ...extractCategories(vendor.categories),
      ...extractCategories(vendor.category),
    ];

    return pools.some((c) => {
      if (!c) return false;
      const normalized = String(c).trim().toLowerCase();
      if (!normalized) return false;
      if (normalized === target) return true;
      if (target.length >= 4 && normalized.length >= 4) {
        if (target.includes(normalized) || normalized.includes(target)) {
          return true;
        }
      }
      return false;
    });
  }

  /**
   * Extracts unique minor categories and their associated major category from an RFQ.
   * If an RFQ contains line items with minor categories, each unique minor category
   * is returned along with its parent/associated major category.
   * If an RFQ has no minor categories, returns distinct categories with minorCategory: null.
   *
   * @param {Object} rfq
   * @returns {Array<{ minorCategory: string|null, majorCategory: string|null }>}
   */
  _rfqTaxonomyGroups(rfq) {
    if (!rfq) return [];
    const groups = [];
    const seenMinors = new Set();
    const items = Array.isArray(rfq.extractedEntities)
      ? rfq.extractedEntities
      : Array.isArray(rfq.lineItems)
      ? rfq.lineItems
      : [];

    for (const ent of items) {
      if (!ent) continue;
      const minor = ent.minorCategory || ent.subCategory;
      if (minor && typeof minor === 'string' && minor.trim()) {
        const mTrimmed = minor.trim();
        const mKey = mTrimmed.toLowerCase();
        if (!seenMinors.has(mKey)) {
          seenMinors.add(mKey);
          const parentMajor = MINOR_TO_MAJOR_MAP.get(mKey);
          groups.push({
            minorCategory: mTrimmed,
            majorCategory: ent.majorCategory || parentMajor || null,
          });
        }
      }
    }

    // Check RFQ header minorCategory / minorCategories
    if (rfq.minorCategory && typeof rfq.minorCategory === 'string' && rfq.minorCategory.trim()) {
      const mTrimmed = rfq.minorCategory.trim();
      const mKey = mTrimmed.toLowerCase();
      if (!seenMinors.has(mKey)) {
        seenMinors.add(mKey);
        const parentMajor = MINOR_TO_MAJOR_MAP.get(mKey);
        groups.push({
          minorCategory: mTrimmed,
          majorCategory: parentMajor || null,
        });
      }
    }
    if (Array.isArray(rfq.minorCategories)) {
      for (const m of rfq.minorCategories) {
        if (m && typeof m === 'string' && m.trim()) {
          const mTrimmed = m.trim();
          const mKey = mTrimmed.toLowerCase();
          if (!seenMinors.has(mKey)) {
            seenMinors.add(mKey);
            const parentMajor = MINOR_TO_MAJOR_MAP.get(mKey);
            groups.push({
              minorCategory: mTrimmed,
              majorCategory: parentMajor || null,
            });
          }
        }
      }
    }

    // Fallback: If no minor categories were found on the RFQ, fallback to distinct major categories
    if (groups.length === 0) {
      const distinctCats = this._rfqDistinctCategories(rfq);
      for (const cat of distinctCats) {
        const mKey = cat.toLowerCase();
        const parentMajor = MINOR_TO_MAJOR_MAP.get(mKey);
        if (parentMajor) {
          groups.push({
            minorCategory: cat,
            majorCategory: parentMajor,
          });
        } else {
          groups.push({
            minorCategory: null,
            majorCategory: cat,
          });
        }
      }
    }

    return groups;
  }

  /**
   * Helper that extracts taxonomy groups (unique minor categories)
   * from an RFQ and selects vendors strictly based on the Minor Category (capped at 25 per minor).
   *
   * @param {Array<Object>} candidatePool
   * @param {Object} rfq
   * @param {number|null} maxPerCategory
   * @param {Object|string|null} targetLocationOrPincode
   * @returns {Array<Object>}
   */
  selectVendorsForRFQ(candidatePool, rfq, maxPerCategory = null, targetLocationOrPincode = null) {
    if (!Array.isArray(candidatePool) || candidatePool.length === 0) return [];
    const destination = targetLocationOrPincode || {
      pincode: rfq?.deliveryPincode ? String(rfq.deliveryPincode).trim() : null,
      location: rfq?.deliveryLocation ? String(rfq.deliveryLocation).trim() : null,
    };
    const groups = this._rfqTaxonomyGroups(rfq);
    return this.selectVendorsPerCategory(candidatePool, groups, maxPerCategory, destination);
  }

  /**
   * Selects candidate vendors for an RFQ strictly based on Minor Category:
   * - Invites up to `maxPerCategory` (default 25) vendors per unique minor category.
   * - No fallback to major category: if fewer than 25 minor category vendors exist, exactly that count is invited.
   * - Prioritization within each category: Delivery location proximity (pincode, city, state), then vendor rating.
   * - Deduplicated across categories.
   *
   * @param {Array<Object>} candidatePool
   * @param {Array<string|Object>} categories Array of category names or { minorCategory, majorCategory } taxonomy groups.
   * @param {number} maxPerCategory Limit per unique category (default 25).
   * @param {string|Object|null} targetLocationOrPincode
   * @returns {Array<Object>}
   */
  selectVendorsPerCategory(candidatePool, categories, maxPerCategory = null, targetLocationOrPincode = null) {
    if (!Array.isArray(candidatePool) || candidatePool.length === 0) return [];

    const defaultLimit = VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY || 25;
    const limit = typeof maxPerCategory === 'number' && maxPerCategory > 0 ? maxPerCategory : defaultLimit;

    if (!Array.isArray(categories) || categories.length === 0) {
      return candidatePool.slice(0, limit);
    }

    // Normalize input to taxonomy groups [{ minorCategory, majorCategory }]
    const groups = [];
    for (const item of categories) {
      if (!item) continue;
      if (typeof item === 'object') {
        const minor = item.minorCategory || null;
        groups.push({
          minorCategory: minor,
          majorCategory: minor ? null : (item.majorCategory || item.category || null),
        });
      } else if (typeof item === 'string' && item.trim()) {
        const str = item.trim();
        const lower = str.toLowerCase();
        const parentMajor = MINOR_TO_MAJOR_MAP.get(lower);
        if (parentMajor) {
          groups.push({
            minorCategory: str,
            majorCategory: null,
          });
        } else {
          groups.push({
            minorCategory: null,
            majorCategory: str,
          });
        }
      }
    }

    if (groups.length === 0) {
      return candidatePool.slice(0, limit);
    }

    const sortCandidates = (list) => {
      list.sort((a, b) => {
        if (targetLocationOrPincode) {
          const aLoc = this.scoreVendorLocation(a, targetLocationOrPincode);
          const bLoc = this.scoreVendorLocation(b, targetLocationOrPincode);
          if (aLoc !== bLoc) return bLoc - aLoc;
        }
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      });
    };

    const selectedMap = new Map();

    for (const group of groups) {
      const { minorCategory, majorCategory } = group;
      const groupSelected = [];
      const groupSeenKeys = new Set();

      if (minorCategory) {
        // Step 1: Minor category matching strictly
        const minorCandidates = candidatePool.filter((candidate) => {
          const full = (candidate && candidate.id ? this.getVendorById(candidate.id, 'all') : null);
          const v = full ? { ...candidate, ...full } : candidate;
          return this.vendorCoversMinorCategory(v, minorCategory);
        });

        sortCandidates(minorCandidates);

        for (const v of minorCandidates) {
          if (groupSelected.length >= limit) break;
          const key = (v.id || v.email || v.name || '').toLowerCase().trim();
          if (key && !groupSeenKeys.has(key)) {
            groupSeenKeys.add(key);
            groupSelected.push(v);
          }
        }
        // Major category fallback: if fewer than limit vendors matched minor category and majorCategory exists,
        // fill remaining slots with vendors matching the parent major category
        if (groupSelected.length < limit && majorCategory) {
          const majorCandidates = candidatePool.filter((candidate) => {
            const v = (candidate && candidate.id ? this.getVendorById(candidate.id, 'all') : null) || candidate;
            const hasCategory = Boolean(
              v.majorCategory ||
              (Array.isArray(v.minorCategories) && v.minorCategories.length > 0) ||
              (Array.isArray(v.vendorSelectedCategories) && v.vendorSelectedCategories.length > 0) ||
              (Array.isArray(v.clientMappedCategories) && v.clientMappedCategories.length > 0)
            );
            return !hasCategory || this.vendorCoversCategory(v, majorCategory);
          });

          sortCandidates(majorCandidates);

          for (const v of majorCandidates) {
            if (groupSelected.length >= limit) break;
            const key = (v.id || v.email || v.name || '').toLowerCase().trim();
            if (key && !groupSeenKeys.has(key)) {
              groupSeenKeys.add(key);
              groupSelected.push(v);
            }
          }
        }
      } else if (majorCategory) {
        // Pure major category matching (used only when no minor category is present)
        const majorCandidates = candidatePool.filter((candidate) => {
          const full = (candidate && candidate.id ? this.getVendorById(candidate.id, 'all') : null);
          const v = full ? { ...candidate, ...full } : candidate;
          const hasCategory = Boolean(
            v.majorCategory ||
            extractCategories(v.minorCategories).length > 0 ||
            extractCategories(v.vendorSelectedCategories).length > 0 ||
            extractCategories(v.clientMappedCategories).length > 0 ||
            extractCategories(v.categories).length > 0
          );
          return !hasCategory || this.vendorCoversCategory(v, majorCategory);
        });

        sortCandidates(majorCandidates);

        for (const v of majorCandidates) {
          if (groupSelected.length >= limit) break;
          const key = (v.id || v.email || v.name || '').toLowerCase().trim();
          if (key && !groupSeenKeys.has(key)) {
            groupSeenKeys.add(key);
            groupSelected.push(v);
          }
        }
      }

      // Add to overall selected map (deduplicated across categories)
      for (const v of groupSelected) {
        const key = (v.id || v.email || v.name || '').toLowerCase().trim();
        if (key && !selectedMap.has(key)) {
          selectedMap.set(key, v);
        }
      }
    }

    return Array.from(selectedMap.values());
  }

  /**
   * Whether a vendor belongs to the Procucev Network vendor pool (mode_0 / V0).
   * Private buyer-uploaded vendors (having buyerId, buyerAccountId, or addedByBuyerCompany)
   * are excluded from the public Procucev Network pool.
   */
  isProcucevVendor(vendor) {
    if (!vendor) return false;
    if (this.isBuyerUploaded(vendor)) return false;
    return true;
  }

  /**
   * Dynamically retrieves the count of Procucev verified / network vendors associated
   * with the given RFQ and its sourcing mode.
   * @param {Object} rfq
   * @returns {number}
   */
  getProcucevVendorCount(rfq) {
    if (!rfq) return 0;
    if (typeof rfq.procucevVendorCount === 'number') {
      return rfq.procucevVendorCount;
    }
    const mode = rfq.sourcingMode || '';
    const isV0 = mode === 'mode_0' || mode === 'v0' || mode === 'version_0';
    const isV2 = mode === 'mode_2' || mode === 'v2' || mode === 'version_2';
    const isV3 = mode === 'mode_3' || mode === 'v3' || mode === 'version_3';

    if (isV0 || isV2) {
      const assigned = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
      const procucevAssigned = assigned.filter((v) => {
        const resolved = (v && v.id ? this.getVendorById(v.id, 'all') : null) || v;
        return this.isProcucevVendor(resolved);
      });
      if (procucevAssigned.length > 0) return procucevAssigned.length;
    }
    if (isV0) {
      const signals = this._rfqCategorySignals(rfq);
      if (!signals || signals.length === 0) {
        return (Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors.length : 0);
      }
    }
    if (isV0 || isV2 || isV3) {
      return this.candidateVendorsForRFQ(rfq).filter((v) => this.isProcucevVendor(v)).length;
    }
    return 0;
  }

  /**
   * Database-backed Procucev vendor count for an RFQ's version (V0/V2/V3).
   *
   * `getProcucevVendorCount` / `createRFQ` count against `this.vendors`, which
   * is only a capped bootstrap-time *subset* of the directory (see
   * getVendorsPageFromDB's own comment — the real table is 80k+ rows). When
   * the category-matched Procucev vendors simply aren't on the loaded page the
   * in-memory count comes back 0 even though vendors exist, which is exactly
   * why the RFQ success popup showed "0" for V2/V3. This recomputes the count
   * straight from Postgres so the popup reflects the whole directory.
   *
   * Reuses the existing getVendorsPageFromDB primitive (which already filters
   * to public/Procucev vendors via `publicOnly` and counts in-DB via its
   * `total`), one query per distinct major-category signal, and reports the
   * largest — categories overlap, so summing would double-count; the dominant
   * category is the honest "vendors available for this RFQ" figure. Falls back
   * to the in-memory count when no DB pool is configured (dev/in-memory mode),
   * and when a buyer explicitly assigned Procucev vendors that assignment wins,
   * matching getProcucevVendorCount's precedence.
   *
   * @param {Object} rfq
   * @returns {Promise<number>}
   */
  async resolveProcucevVendorCountFromDB(rfq) {
    if (!rfq) return 0;
    const mode = rfq.sourcingMode || '';
    const isV0 = mode === 'mode_0' || mode === 'v0' || mode === 'version_0';
    const isV2 = mode === 'mode_2' || mode === 'v2' || mode === 'version_2';
    const isV3 = mode === 'mode_3' || mode === 'v3' || mode === 'version_3';
    if (!isV0 && !isV2 && !isV3) return 0;

    // A buyer's own explicit Procucev assignment is authoritative and already
    // in memory — no DB round-trip needed.
    const assigned = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    const procucevAssigned = assigned.filter((v) => {
      const resolved = (v && v.id ? this.getVendorById(v.id, 'all') : null) || v;
      return this.isProcucevVendor(resolved);
    });
    if (procucevAssigned.length > 0) return procucevAssigned.length;

    // No DB configured (dev/in-memory): the capped-subset count is all we have.
    if (!pool.hasStorage()) return this.getProcucevVendorCount(rfq);

    // Every category string the RFQ carries — its header `category` plus each
    // line item's major/minor/category (an email/BOQ-ingested RFQ often tags
    // only the line items, with a null header category, which is exactly the
    // shape that produced the zero).
    const signals = this._rfqCategorySignals(rfq);

    let dbCount = 0;
    if (Array.isArray(signals) && signals.length > 0) {
      try {
        // One query: distinct public vendors matching ANY signal across major,
        // minor, vendor-selected and client-mapped categories — the same four
        // pools vendorCoversCategory checks, so it mirrors the in-memory
        // candidate match over the whole directory instead of the capped page.
        dbCount = await domainQueries.countPublicVendorsMatchingCategories(signals);
      } catch (err) {
        logger.warn(
          'Procucev vendor count DB query failed',
          { rfqNumber: rfq.rfqNumber, error: err.message },
          'STORE_SERVICE'
        );
      }
    }

    // Fallback: if category matching found nothing (no signals, or the RFQ's
    // category labels don't line up with how vendors were tagged — the common
    // real-world case for an email/BOQ-ingested RFQ), report the size of the
    // public Procucev network the RFQ CAN reach rather than a misleading 0.
    // This is the same directory total the Operational Kanban already shows.
    // Autonomous V3 and hybrid V2 both expand into this whole public network,
    // so it is the honest "Procucev vendors available for this version" figure.
    // For V0 without categories, do NOT fallback to the directory-wide count!
    if (dbCount === 0 && !isV0) {
      try {
        const page = await domainQueries.getVendorsPageFromDB({ limit: 1, offset: 0, publicOnly: true });
        if (page && typeof page.total === 'number') {
          dbCount = page.total;
        }
      } catch (err) {
        logger.warn(
          'Procucev network total count DB query failed',
          { rfqNumber: rfq.rfqNumber, error: err.message },
          'STORE_SERVICE'
        );
      }
    }

    if (isV0 && (!signals || signals.length === 0)) {
      return (Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors.length : 0);
    }

    // Never regress below whatever the in-memory subset already counted.
    return Math.max(dbCount || 0, this.getProcucevVendorCount(rfq));
  }

  /**
   * Assign the real category-matched Procucev vendors to a V0 RFQ from the
   * DATABASE, not the capped in-memory bootstrap page.
   *
   * createRFQ's V0 block matches against `this.vendors`, a capped subset of the
   * 80k+ directory, so at scale it frequently assigns zero vendors even though
   * matching vendors exist — the RFQ then has an empty assignedVendors list and
   * nobody is actually invited. This runs after createRFQ (same async-after-sync
   * pattern as resolveProcucevVendorCountFromDB) to pull the matching public
   * vendors from the DB, merge them into assignedVendors (de-duplicated), cap
   * the list, persist it, and set procucevVendorCount to the real assigned
   * count — so the success modal, the buyer panel and the CM tabs all agree.
   *
   * No-ops for non-V0 RFQs, when no DB pool is configured (dev/in-memory, where
   * createRFQ's in-memory match already ran), or when the RFQ carries no
   * category signal (a category-less RFQ cannot be matched).
   *
   * @param {Object} rfq The RFQ created by createRFQ.
   * @returns {Promise<Object>} The RFQ with DB-backed V0 assignments applied.
   */
  async augmentV0AssignmentsFromDB(rfq, { deferChasers = false } = {}) {
    if (!rfq) return rfq;
    const mode = rfq.sourcingMode || '';
    const isV0 = mode === 'mode_0' || mode === 'v0' || mode === 'version_0';
    if (!isV0) return rfq;

    const maxProcucevPerCat = VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY;
    const signals = this._rfqCategorySignals(rfq);
    const categories = this._rfqDistinctCategories(rfq);

    // If a V0 RFQ was submitted without selecting a category, do NOT automatically assign
    // vendors or fallback to the general public directory. It routes to Category Manager for manual assignment.
    if (!Array.isArray(signals) || signals.length === 0) {
      const assignedVendors = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
      const updated = await this.updateRFQDurably(rfq.id, (current) => ({
        procucevVendorCount: Array.isArray(current.assignedVendors) ? current.assignedVendors.length : 0,
        needsCategoryManagerAssignment: true,
      }));
      return updated || {
        ...rfq,
        assignedVendors,
        procucevVendorCount: assignedVendors.length,
        needsCategoryManagerAssignment: true,
      };
    }
    const targetCategories = categories.length > 0 ? categories : signals;
    const limit = Math.max(targetCategories.length, 1) * maxProcucevPerCat;

    let dbMatches = [];
    if (pool.hasStorage()) {
      // 1. Category-matched public vendors from the whole directory.
      if (Array.isArray(signals) && signals.length > 0) {
        try {
          dbMatches = await domainQueries.getPublicVendorsMatchingCategories(signals, limit);
        } catch (err) {
          logger.warn(
            'V0 DB-backed vendor assignment query failed',
            { rfqNumber: rfq.rfqNumber, error: err.message },
            'STORE_SERVICE'
          );
        }
      }
      if (!Array.isArray(dbMatches) || dbMatches.length === 0) {
        try {
          const page = await domainQueries.getVendorsPageFromDB({
            limit,
            offset: 0,
            publicOnly: true,
            skipCount: true,
          });
          dbMatches = (page && Array.isArray(page.rows)) ? page.rows : [];
        } catch (err) {
          logger.warn(
            'V0 DB-backed network fallback query failed',
            { rfqNumber: rfq.rfqNumber, error: err.message },
            'STORE_SERVICE'
          );
        }
      }
    }

    // Fallback to in-memory candidates if storage is unavailable or returned 0 matches
    if (!Array.isArray(dbMatches) || dbMatches.length === 0) {
      dbMatches = this.candidateVendorsForRFQ(rfq).filter((v) => this.isProcucevVendor(v));
    }

    if (!Array.isArray(dbMatches) || dbMatches.length === 0) {
      const existing = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
      if (existing.length > 0) return rfq;
      const updated = await this.updateRFQDurably(rfq.id, (current) => ({
        needsCategoryManagerAssignment: !Array.isArray(current.assignedVendors) || current.assignedVendors.length === 0,
        procucevVendorCount: 0,
      }));
      return updated || rfq;
    }

    // Prefer vendors in the RFQ's delivery location and pincode, then by rating — select up to maxProcucevPerCat per category.
    const targetLocation = {
      pincode: rfq.deliveryPincode ? String(rfq.deliveryPincode).trim() : null,
      location: rfq.deliveryLocation ? String(rfq.deliveryLocation).trim() : null,
    };
    const candidatePool = dbMatches.filter((v) => this.isProcucevVendor(v));
    let sorted = this.selectVendorsForRFQ(
      candidatePool,
      rfq,
      maxProcucevPerCat,
      targetLocation
    );

    if (!sorted || sorted.length === 0) {
      sorted = candidatePool
        .sort((a, b) => {
          if (targetLocation.pincode || targetLocation.location) {
            const aLoc = this.scoreVendorLocation(a, targetLocation);
            const bLoc = this.scoreVendorLocation(b, targetLocation);
            if (aLoc !== bLoc) return bLoc - aLoc;
          }
          return (Number(b.rating) || 0) - (Number(a.rating) || 0);
        })
        .slice(0, limit);
    }

    const existing = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];

    const existingKeys = new Set(
      existing.map((v) => (v.id || v.email || v.name || '').toLowerCase())
    );
    const additions = sorted
      .filter((v) => !existingKeys.has((v.id || v.email || v.name || '').toLowerCase()))
      .map((v) => ({
        id: v.id,
        name: v.name,
        email: v.email || null,
        contactPerson: v.contactPerson || null,
        phone: v.phone || v.mobile || v.mobileNumber || null,
        source: v.source || 'procucev_network',
        majorCategory: v.majorCategory || v.category || null,
        minorCategories: v.minorCategories || [],
        city: v.city || null,
        state: v.state || null,
        location: v.location || (v.city ? `${v.city}${v.state ? ', ' + v.state : ''}` : null),
        pincode: v.pincode || null,
      }));

    if (additions.length === 0) return rfq;

    const { updatedRFQ: updated, committedAdditions } = await this._appendRFQAssignmentsDurably(
      rfq.id,
      additions,
      { ensureFollowUpData: true }
    );
    if (!updated) return rfq;
    if (committedAdditions.length === 0) return updated;

    // Schedule multi-channel / 5-minute SMS chasers for newly assigned V0 vendors
    const resolvedAdditions = committedAdditions.map((v) => {
      const full = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
      return {
        ...v,
        phone: full.phone || full.mobile || full.mobileNumber || v.phone,
        email: full.email || v.email,
        name: full.name || v.name,
        contactPerson: full.contactPerson || v.contactPerson,
      };
    });

    if (!deferChasers) {
      rfqChaserScheduler.scheduleRFQChasers(
        updated,
        resolvedAdditions,
        (vendor) => this.checkVendorQuotationEligibility(vendor)
      );
    }

    const categoryLabel = updated.category || this._rfqCategorySignals(updated)[0] || 'your categories';

    for (const vendor of resolvedAdditions) {
      const isBuyerUploaded = this.isBuyerUploaded(vendor);
      const buyerDisplayName = isBuyerUploaded && updated.buyerAccountName ? updated.buyerAccountName : 'A buyer';
      const notification = this._buildNotification({
        recipientType: 'vendor',
        recipientId: vendor.id,
        kind: 'rfq_category_match',
        rfq: updated,
        title: 'New RFQ in ' + categoryLabel,
        message: buyerDisplayName + ' invited you to ' + updated.rfqNumber + ' — ' + updated.title + '.',
        meta: { category: categoryLabel, buyerAccountName: isBuyerUploaded ? (updated.buyerAccountName || null) : null },
      });
      this.notifications.unshift(notification);
      this._persistNotification(notification);

      if (updated.followUpData && Array.isArray(updated.followUpData.vendors)) {
        let vEntry = updated.followUpData.vendors.find((fv) => fv && (fv.id === vendor.id || fv.vendorId === vendor.id || fv.name === vendor.name));
        if (!vEntry) {
          vEntry = { ...vendor, id: vendor.id, vendorId: vendor.id };
          updated.followUpData.vendors.push(vEntry);
        }
      if (vendor.email) {
          vEntry.email = vendor.email;
          vEntry.emailSent = false;
          vEntry.email24h = { status: 'pending' };
        }
        if (vendor.phone) {
          vEntry.sms = { status: 'pending' };
          vEntry.whatsapp = { status: 'pending' };
        }
      }

      if (vendor.email) {
        const creditInfo = this.checkVendorQuotationEligibility(vendor);
        this._sendWithFeedOutcome(
          mailerService.sendRfqInviteEmail(vendor.email, {
            rfq: updated,
            recipientName: vendor.contactPerson || vendor.name,
            freeCreditsRemaining: creditInfo.freeCreditsRemaining,
            isSubscribed: creditInfo.isSubscribed,
            vendor,
            isBuyerUploaded,
          }),
          'Failed to email RFQ invite to DB-augmented vendor',
          {
            deliveryChannel: 'email',
            operation: 'rfq-db-augmented-vendor-invite',
            rfqId: updated.id,
            rfqNumber: updated.rfqNumber,
            vendorId: vendor.id,
          },
          { channel: 'email', vendor, rfqNumber: updated.rfqNumber, buyerAccountId: updated.buyerAccountId }
        );
      }

      if (vendor.phone) {
        const bidUrl = whatsAppService.generateOneClickBidUrl(updated.rfqNumber, vendor.email);
        this._sendWithFeedOutcome(
          smsService.sendRFQChaserSms({
            mobile: vendor.phone,
            vendorName: vendor.name,
            rfqNumber: updated.rfqNumber,
            rfqTitle: updated.title,
            bidLink: bidUrl,
          }),
          'Failed to dispatch initial SMS alert',
          {},
          { channel: 'sms', vendor, rfqNumber: updated.rfqNumber, buyerAccountId: updated.buyerAccountId }
        );
      }
    }

    if (updated.followUpData) {
      const assignedCount = Array.isArray(updated.assignedVendors) ? updated.assignedVendors.length : 0;
      updated.followUpData.totalInvited = Math.max(updated.followUpData.totalInvited || 0, assignedCount);
      if (!updated.followUpData.emailStats) {
        updated.followUpData.emailStats = { total: assignedCount, delivered: 0, sent24h: 0, opened: 0 };
      }
      updated.followUpData.emailStats.total = Math.max(updated.followUpData.emailStats.total || 0, assignedCount);

      if (!updated.followUpData.smsStats) {
        updated.followUpData.smsStats = { total: assignedCount, delivered: 0, clicked: 0 };
      }
      updated.followUpData.smsStats.total = Math.max(updated.followUpData.smsStats.total || 0, assignedCount);

      if (!updated.followUpData.whatsappStats) {
        updated.followUpData.whatsappStats = { total: assignedCount, delivered: 0, read: 0, replied: 0 };
      }
      updated.followUpData.whatsappStats.total = Math.max(updated.followUpData.whatsappStats.total || 0, assignedCount);
    }

    this._persistRFQ(updated);

    logger.info(
      `V0 RFQ ${rfq.rfqNumber}: assigned ${updated.assignedVendors.length} Procucev vendors from DB match (${committedAdditions.length} added)`,
      { rfqNumber: rfq.rfqNumber, assigned: updated.assignedVendors.length },
      'STORE_SERVICE'
    );
    return updated;
  }

  /**
   * Automatically identify and assign eligible vendors based on RFQ category,
   * delivery location, and vendor eligibility rules from the DATABASE.
   *
   * Covers Mode 0, Mode 2, Mode 3, and Email-ingested RFQs.
   * Mode 1 (Private Roster Only) is strictly guarded and never auto-assigned from the public network.
   *
   * @param {Object} rfq The RFQ to assign vendors to.
   * @returns {Promise<Object>} The updated RFQ with assigned vendors.
   */
  async autoAssignVendorsFromDB(rfq, { deferChasers = false } = {}) {
    if (!rfq) return rfq;
    const mode = String(rfq.sourcingMode || '');
    const isV1 = mode === 'mode_1' || mode === 'v1' || mode === 'version_1';
    const isV2 = mode === 'mode_2' || mode === 'v2' || mode === 'version_2' || rfq.source === 'email_gateway';

    const isV0 = mode === 'mode_0' || mode === 'v0' || mode === 'version_0';
    if (isV0) {
      return await this.augmentV0AssignmentsFromDB(rfq, { deferChasers });
    }

    const maxClientPerCat = VENDOR_ASSIGNMENT_LIMITS.MAX_CLIENT_PER_CATEGORY || 5;
    const maxProcucevPerCat = VENDOR_ASSIGNMENT_LIMITS.MAX_PROCUCEV_PER_CATEGORY || 5;
    const signals = this._rfqCategorySignals(rfq);
    const categories = this._rfqDistinctCategories(rfq);

    if (!Array.isArray(signals) || signals.length === 0) {
      return rfq;
    }
    const targetCategories = categories.length > 0 ? categories : signals;
    const limit = Math.max(targetCategories.length, 1) * maxProcucevPerCat;

    const targetLocation = {
      pincode: rfq.deliveryPincode ? String(rfq.deliveryPincode).trim() : null,
      location: rfq.deliveryLocation ? String(rfq.deliveryLocation).trim() : null,
    };
let clientCandidates = [];
    if (isV1 || isV2) {
      let clientDbMatches = [];
      if (pool.hasStorage()) {
        try {
          const buyerId = rfq.buyerAccountId || rfq.buyerCompanyId || rfq.buyerId || null;
          const buyerEmail = rfq.buyerEmail || rfq.createdBy || null;
          clientDbMatches = await domainQueries.getVendorsByBuyerFromDB(buyerId, limit * 2, buyerEmail);
        } catch (err) {
          logger.warn(
            'Auto-assign DB-backed client vendor query failed',
            { rfqNumber: rfq.rfqNumber, error: err.message },
            'STORE_SERVICE'
          );
        }
      }
      const rawClient = [
        ...(Array.isArray(clientDbMatches) ? clientDbMatches : []),
        ...this.candidateVendorsForRFQ(rfq).filter(
          (v) => !this.isProcucevVendor(v) && this.isVendorMappedToRfqBuyer(v, rfq)
        ),
      ];
      const seenClient = new Set();
      for (const v of rawClient) {
        const k = (v.id || v.email || v.name || '').toLowerCase();
        if (k && !seenClient.has(k)) {
          seenClient.add(k);
          clientCandidates.push(v);
        }
      }
    }

    let sortedClient = [];
    if (clientCandidates.length > 0) {
      sortedClient = this.selectVendorsForRFQ(
        clientCandidates,
        rfq,
        maxClientPerCat,
        targetLocation
      ) || [];
      if (sortedClient.length === 0) {
        sortedClient = clientCandidates.slice(0, targetCategories.length * maxClientPerCat);
      }
    }

    let sortedProcucev = [];
    if (!isV1) {
      let dbMatches = [];
      if (pool.hasStorage()) {
        try {
          dbMatches = await domainQueries.getPublicVendorsMatchingCategories(signals, limit * 2);
        } catch (err) {
          logger.warn(
            'Auto-assign DB-backed vendor assignment query failed',
            { rfqNumber: rfq.rfqNumber, error: err.message },
            'STORE_SERVICE'
          );
        }
      }

      if (!Array.isArray(dbMatches) || dbMatches.length === 0) {
        dbMatches = this.candidateVendorsForRFQ(rfq).filter((v) => this.isProcucevVendor(v));
      }

      const candidatePool = (dbMatches || []).filter((v) => this.isProcucevVendor(v));
      sortedProcucev = this.selectVendorsForRFQ(
        candidatePool,
        rfq,
        maxProcucevPerCat,
        targetLocation
      ) || [];
      if (sortedProcucev.length === 0 && candidatePool.length > 0) {
        sortedProcucev = candidatePool.slice(0, targetCategories.length * maxProcucevPerCat);
      }
    }

    const candidatePool = [...sortedClient, ...sortedProcucev];
    if (candidatePool.length === 0) {
      return rfq;
    }

    const existing = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    const existingKeys = new Set(
      existing.map((v) => (v.id || v.email || v.name || '').toLowerCase())
    );
    const additions = candidatePool
      .filter((v) => !existingKeys.has((v.id || v.email || v.name || '').toLowerCase()))
      .map((v) => {
        const isProc = this.isProcucevVendor(v);
        return {
          id: v.id,
          name: v.name,
          email: v.email || null,
          contactPerson: v.contactPerson || null,
          phone: v.phone || v.mobile || v.mobileNumber || null,
          source: v.source || (isProc ? 'procucev_network' : 'buyer_uploaded'),
          vendorCategory: isProc ? 'Procucev Network' : 'Client List',
          majorCategory: v.majorCategory || v.category || null,
          minorCategories: Array.isArray(v.minorCategories) ? v.minorCategories : [],
          city: v.city || null,
          state: v.state || null,
          location: v.location || (v.city ? `${v.city}${v.state ? ', ' + v.state : ''}` : null),
          pincode: v.pincode || null,
        };
      });

    if (additions.length === 0) return rfq;

    const { updatedRFQ: updated, committedAdditions } = await this._appendRFQAssignmentsDurably(
      rfq.id,
      additions,
      { ensureFollowUpData: true }
    );
    if (!updated) return rfq;
    if (committedAdditions.length === 0) return updated;

    if (!deferChasers) {
      const resolvedAdditions = committedAdditions.map((vendor) => {
        const full = (vendor.id ? this.getVendorById(vendor.id, 'all') : null) || vendor;
        return {
          ...vendor,
          phone: full.phone || vendor.phone || null,
          email: full.email || vendor.email || null,
          name: full.name || vendor.name,
          contactPerson: full.contactPerson || vendor.contactPerson || null,
        };
      });
      try {
        rfqChaserScheduler.scheduleRFQChasers(
          updated,
          resolvedAdditions,
          (vendor) => this.checkVendorQuotationEligibility(vendor)
        );
      } catch (error) {
        logger.warn('Failed to schedule chasers for auto-assigned vendors', {
          rfqNumber: rfq.rfqNumber,
          error,
        }, 'STORE_SERVICE');
      }

      const categoryLabel = updated.category || this._rfqCategorySignals(updated)[0] || 'your categories';
      try {
        for (const vendor of resolvedAdditions) {
        const isBuyerUploaded = this.isBuyerUploaded(vendor);
        const buyerDisplayName = isBuyerUploaded && updated.buyerAccountName ? updated.buyerAccountName : 'A buyer';
        const notification = this._buildNotification({
          recipientType: 'vendor',
          recipientId: vendor.id,
          kind: 'rfq_category_match',
          rfq: updated,
          title: `New RFQ in ${categoryLabel}`,
          message: `${buyerDisplayName} invited you to ${updated.rfqNumber} — ${updated.title}.`,
          meta: { category: categoryLabel, buyerAccountName: isBuyerUploaded ? (updated.buyerAccountName || null) : null },
        });
        this.notifications.unshift(notification);
        this._persistNotification(notification);

        if (updated.followUpData && Array.isArray(updated.followUpData.vendors)) {
          let vEntry = updated.followUpData.vendors.find((fv) => fv && (fv.id === vendor.id || fv.vendorId === vendor.id || fv.name === vendor.name));
          if (!vEntry) {
            vEntry = { ...vendor, id: vendor.id, vendorId: vendor.id };
            updated.followUpData.vendors.push(vEntry);
          }
        if (vendor.email) {
            vEntry.email = vendor.email;
            vEntry.emailSent = false;
            vEntry.email24h = { status: 'pending' };
          }
          if (vendor.phone) {
            vEntry.sms = { status: 'pending' };
            vEntry.whatsapp = { status: 'pending' };
          }
        }

        if (vendor.email) {
          const creditInfo = this.checkVendorQuotationEligibility(vendor);
          this._sendWithFeedOutcome(
            mailerService.sendRfqInviteEmail(vendor.email, {
              rfq: updated,
              recipientName: vendor.contactPerson || vendor.name,
              freeCreditsRemaining: creditInfo.freeCreditsRemaining,
              isSubscribed: creditInfo.isSubscribed,
              vendor,
              isBuyerUploaded,
            }),
            'Failed to email RFQ invite to DB auto-assigned vendor',
            {
              deliveryChannel: 'email',
              operation: 'rfq-db-auto-assigned-vendor-invite',
              rfqId: updated.id,
              rfqNumber: updated.rfqNumber,
              vendorId: vendor.id,
            },
            { channel: 'email', vendor, rfqNumber: updated.rfqNumber, buyerAccountId: updated.buyerAccountId }
          );
        }

        if (vendor.phone) {
          const bidUrl = whatsAppService.generateOneClickBidUrl(updated.rfqNumber, vendor.email);
          this._sendWithFeedOutcome(
            smsService.sendRFQChaserSms({
              mobile: vendor.phone,
              vendorName: vendor.name,
              rfqNumber: updated.rfqNumber,
              rfqTitle: updated.title,
              bidLink: bidUrl,
            }),
            'Failed to dispatch initial SMS alert',
            {},
            { channel: 'sms', vendor, rfqNumber: updated.rfqNumber, buyerAccountId: updated.buyerAccountId }
          );

          if (updated.sourcingMode === 'mode_2' || updated.sourcingMode === 'mode_3') {
            this._sendWithFeedOutcome(
              whatsAppService.sendRFQInvitationWhatsApp({
                phone: vendor.phone,
                vendorName: vendor.name,
                contactPerson: vendor.contactPerson,
                rfqNumber: updated.rfqNumber,
                rfqTitle: updated.title,
                vendorEmail: vendor.email,
                deliveryDate: updated.targetDeliveryDate || updated.deadline,
                deliveryLocation: updated.deliveryLocation || updated.deliveryCity,
              }),
              'Failed to dispatch initial WhatsApp prompt',
              {},
              { channel: 'whatsapp', vendor, rfqNumber: updated.rfqNumber, buyerAccountId: updated.buyerAccountId }
            );
        }
      }
      }
      } catch (dispatchError) {
        logger.error('RFQ assignments were saved but automatic vendor dispatch failed', {
          rfqId: updated.id,
          rfqNumber: updated.rfqNumber,
          assignedVendorIds: committedAdditions.map((vendor) => vendor.id),
          error: dispatchError,
        }, 'STORE_SERVICE');
      }
    }

    if (updated.followUpData) {
        const assignedCount = Array.isArray(updated.assignedVendors) ? updated.assignedVendors.length : 0;
        updated.followUpData.totalInvited = Math.max(updated.followUpData.totalInvited || 0, assignedCount);
        if (!updated.followUpData.emailStats) {
          updated.followUpData.emailStats = { total: assignedCount, delivered: 0, sent24h: 0, opened: 0 };
        }
        updated.followUpData.emailStats.total = Math.max(updated.followUpData.emailStats.total || 0, assignedCount);

        if (!updated.followUpData.smsStats) {
          updated.followUpData.smsStats = { total: assignedCount, delivered: 0, clicked: 0 };
        }
        updated.followUpData.smsStats.total = Math.max(updated.followUpData.smsStats.total || 0, assignedCount);

        if (!updated.followUpData.whatsappStats) {
          updated.followUpData.whatsappStats = { total: assignedCount, delivered: 0, read: 0, replied: 0 };
        }
        updated.followUpData.whatsappStats.total = Math.max(updated.followUpData.whatsappStats.total || 0, assignedCount);
      }

    this._persistRFQ(updated);
    this._dispatchRFQVendorInviteOutbox(updated, 'rfq-auto-assigned-vendor-invites');
    logger.info(
      `RFQ ${rfq.rfqNumber}: auto-assigned ${updated.assignedVendors.length} vendors from DB (${committedAdditions.length} added)`,
      { rfqNumber: rfq.rfqNumber, assigned: updated.assignedVendors.length },
      'STORE_SERVICE'
    );
    return updated;
  }

  /**
   * Whether an RFQ should reach a given vendor.
   *
   * True when the vendor was explicitly added by the RFQ's buyer
   * (`addedByBuyerCompany`) or is on the RFQ's `assignedVendors` invite list —
   * that's it. Category coverage alone is deliberately NOT enough: it used to
   * grant access directly, but a category manager now has to review the
   * category-matched pool (`candidateVendorsForRFQ`) and explicitly invite
   * from it (`inviteVendorsToRFQ`) before a vendor can see, be notified about,
   * be emailed about, or quote an RFQ.
   */
  vendorCoversRFQ(vendor, rfq) {
    if (!vendor || !rfq) return false;
    if (rfq.needsCategoryManagerAssignment || rfq.categoryNotAvailable) {
      return this._isInvitedVendor(vendor, rfq);
    }

    const mode = String(rfq.sourcingMode || '').trim().toLowerCase();
    const isV0 = mode === 'mode_0' || mode === 'v0' || mode === 'version_0';

    // V0 (Free Starter): category-matched vendors, uncategorized vendors, or invited vendors
    if (isV0) {
      const isUncategorized = !vendor.majorCategory || String(vendor.majorCategory).toLowerCase().includes('uncategorized');
      const signals = this._rfqCategorySignals(rfq);
      if (signals.length === 0 || isUncategorized || signals.some((c) => this.vendorCoversCategory(vendor, c))) {
        return true;
      }
      return this._isInvitedVendor(vendor, rfq);
    }

    // Buyer-specific vendor access rule:
    // When a buyer uploads or adds a vendor to their vendor list, that vendor can view and cover
    // RFQs created by that respective buyer across all modes.
    if (this.isVendorMappedToRfqBuyer(vendor, rfq)) {
      const isUncategorized = !vendor.majorCategory || String(vendor.majorCategory).toLowerCase().includes('uncategorized');
      const signals = this._rfqCategorySignals(rfq);
      if (signals.length === 0 || isUncategorized || signals.some((c) => this.vendorCoversCategory(vendor, c))) {
        return true;
      }
      return this._isInvitedVendor(vendor, rfq);
    }

    if (
      vendor.addedByBuyerCompany &&
      rfq.buyerAccountName &&
      vendor.addedByBuyerCompany.trim().toLowerCase() === rfq.buyerAccountName.trim().toLowerCase()
    ) {
      const isUncategorized = !vendor.majorCategory || String(vendor.majorCategory).toLowerCase().includes('uncategorized');
      const signals = this._rfqCategorySignals(rfq);
      if (signals.length === 0 || isUncategorized || signals.some((c) => this.vendorCoversCategory(vendor, c))) {
        return true;
      }
    }

    return this._isInvitedVendor(vendor, rfq);
  }

  /** Whether a vendor is on the RFQ's assignedVendors invite list. */
  _isInvitedVendor(vendor, rfq) {
    const invited = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    return invited.some(
      (v) =>
        v &&
        ((v.id && v.id === vendor.id) ||
          (v.email && vendor.email && v.email.toLowerCase() === vendor.email.toLowerCase()) ||
          (v.name && vendor.name && v.name.toLowerCase() === vendor.name.toLowerCase()))
    );
  }

  /**
   * Every vendor whose category covers this RFQ — the candidate pool a
   * category manager picks invitees from. Grants no access by itself; only
   * `inviteVendorsToRFQ` (via `assignedVendors`) does that. Flags which
   * candidates are already invited so a picker UI can show that state.
   */
  candidateVendorsForRFQ(rfq, limit = null) {
    const signals = this._rfqCategorySignals(rfq);
    const destination = {
      pincode: rfq?.deliveryPincode ? String(rfq.deliveryPincode).trim() : null,
      location: rfq?.deliveryLocation ? String(rfq.deliveryLocation).trim() : null,
    };
    const hasMinorSignals = Boolean(
      (rfq && rfq.minorCategory) ||
      (rfq && Array.isArray(rfq.minorCategories) && rfq.minorCategories.length > 0) ||
      (rfq && Array.isArray(rfq.extractedEntities) && rfq.extractedEntities.some((e) => e && e.minorCategory)) ||
      (rfq && Array.isArray(rfq.lineItems) && rfq.lineItems.some((e) => e && e.minorCategory))
    );
    const candidates = this.vendors
      .filter((v) => !this.isVendorPrivateToDifferentBuyer(v, rfq))
      .filter((v) => {
        if (signals.length === 0) return true;
        if (hasMinorSignals && signals.some((sig) => this.vendorCoversMinorCategory(v, sig))) {
          return true;
        }
        return signals.some((c) => this.vendorCoversCategory(v, c));
      })
      .map((v) => ({ ...v, alreadyInvited: this._isInvitedVendor(v, rfq) }));

    if (destination.pincode || destination.location) {
      candidates.sort((a, b) => {
        const aLoc = this.scoreVendorLocation(a, destination);
        const bLoc = this.scoreVendorLocation(b, destination);
        if (aLoc !== bLoc) return bLoc - aLoc;
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      });
    }

    if (limit && Number.isInteger(Number(limit)) && Number(limit) > 0) {
      return candidates.slice(0, Number(limit));
    }
    return candidates;
  }

  /**
   * Async version of candidateVendorsForRFQ that falls back to querying the database
   * when in-memory candidate count is zero.
   */
  async candidateVendorsForRFQAsync(rfq, limit = null) {
    let candidates = this.candidateVendorsForRFQ(rfq, limit);
    if ((!candidates || candidates.length === 0) && pool.hasStorage()) {
      const signals = this._rfqCategorySignals(rfq);
      if (Array.isArray(signals) && signals.length > 0) {
        try {
          const fetchLimit = (limit && Number.isInteger(Number(limit)) && Number(limit) > 0)
            ? Number(limit)
            : 100;
          const dbVendors = await domainQueries.getPublicVendorsMatchingCategories(signals, fetchLimit);
          if (Array.isArray(dbVendors) && dbVendors.length > 0) {
            const destination = {
              pincode: rfq?.deliveryPincode ? String(rfq.deliveryPincode).trim() : null,
              location: rfq?.deliveryLocation ? String(rfq.deliveryLocation).trim() : null,
            };
            candidates = dbVendors.map((v) => ({
              ...v,
              alreadyInvited: this._isInvitedVendor(v, rfq),
            }));
            if (destination.pincode || destination.location) {
              candidates.sort((a, b) => {
                const aLoc = this.scoreVendorLocation(a, destination);
                const bLoc = this.scoreVendorLocation(b, destination);
                if (aLoc !== bLoc) return bLoc - aLoc;
                return (Number(b.rating) || 0) - (Number(a.rating) || 0);
              });
            }
          }
        } catch (err) {
          logger.warn('Failed to query candidate vendors from DB', { error: err.message }, 'STORE_SERVICE');
        }
      }
    }
    if (limit && Number.isInteger(Number(limit)) && Number(limit) > 0 && Array.isArray(candidates)) {
      return candidates.slice(0, Number(limit));
    }
    return candidates || [];
  }

  /**
   * A category manager invites specific vendors to an RFQ.
   *
   * Merges the given vendor ids into `assignedVendors` (dedup'd against
   * whoever's already on it), then — for each vendor newly added — fires the
   * same simulated multi-channel chaser outreach `createRFQ` fires fo  /**
   * Inviting specific vendors to an RFQ (Category Manager manual assignment or override).
   *
   * Only invited vendors (plus any direct buyer roster matches) can see, be
   * notified about, or quote this RFQ afterward.
   *
   * Category Manager manual assignments allow manual override even if category
   * does not automatically match, logging the override and sending normal RFQ
   * invitation emails. Category mismatch emails are disabled.
   */
  async inviteVendorsToRFQ(rfqId, vendorIds, actorEmail) {
    // Load the authoritative row before merging assignments. Isolate-local RFQ
    // state can lag behind another Worker or Node process.
    const rfq = await this.getRFQByIdAsync(rfqId);
    if (!rfq) return null;

    const existing = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    const newlyInvited = [];
    const overrideVendors = [];
    const excludedVendors = [];
    const signals = this._rfqCategorySignals(rfq);

    for (const id of Array.isArray(vendorIds) ? vendorIds : []) {
      let vendor = this.getVendorById(id, 'all');
      if (!vendor) {
        vendor = await domainQueries.getVendorByIdFromDB(id);
        if (vendor && !this.vendors.some((v) => v.id === vendor.id)) {
          this.vendors.push(vendor);
        }
      }
      if (!vendor) continue;
      if (this.isVendorPrivateToDifferentBuyer(vendor, rfq)) {
        excludedVendors.push({
          id: vendor.id,
          name: vendor.name,
          reason: 'This private vendor belongs to a different buyer account.',
        });
        logger.warn(
          `Rejected invitation of private vendor ${vendor.id} owned by another buyer to RFQ ${rfq.rfqNumber}.`,
          { rfqNumber: rfq.rfqNumber, vendorId: vendor.id },
          'STORE_SERVICE'
        );
        continue;
      }
      if (this._isInvitedVendor(vendor, rfq)) continue;

      const hasCategory = Boolean(
        vendor.majorCategory ||
        (Array.isArray(vendor.minorCategories) && vendor.minorCategories.length > 0) ||
        (Array.isArray(vendor.vendorSelectedCategories) && vendor.vendorSelectedCategories.length > 0) ||
        (Array.isArray(vendor.clientMappedCategories) && vendor.clientMappedCategories.length > 0)
      );
      const hasMinorSignals = Boolean(
        (rfq && rfq.minorCategory) ||
        (rfq && Array.isArray(rfq.minorCategories) && rfq.minorCategories.length > 0) ||
        (rfq && Array.isArray(rfq.extractedEntities) && rfq.extractedEntities.some((e) => e && e.minorCategory)) ||
        (rfq && Array.isArray(rfq.lineItems) && rfq.lineItems.some((e) => e && e.minorCategory))
      );
      const isMatch = signals.length === 0 || (
        hasCategory && (
          hasMinorSignals
            ? (signals.some((c) => this.vendorCoversMinorCategory(vendor, c)) || signals.some((c) => this.vendorCoversCategory(vendor, c)))
            : signals.some((c) => this.vendorCoversCategory(vendor, c))
        )
      );

      if (!isMatch) {
        overrideVendors.push(vendor);
      }

      newlyInvited.push(vendor);
    }

    if (newlyInvited.length === 0) {
      return {
        updatedRFQ: rfq,
        invitedCount: 0,
        excludedCount: excludedVendors.length,
        excludedVendors,
      };
    }

    const entries = newlyInvited.map((v) => ({
      id: v.id,
      name: v.name,
      email: v.email || null,
      contactPerson: v.contactPerson || null,
      phone: v.phone || v.mobile || v.mobileNumber || null,
      source: v.source || (this.isProcucevVendor(v) ? 'procucev_network' : 'buyer_uploaded'),
      majorCategory: v.majorCategory || v.category || null,
      minorCategories: v.minorCategories || [],
      city: v.city || null,
      state: v.state || null,
      location: v.location || (v.city ? `${v.city}${v.state ? ', ' + v.state : ''}` : null),
      pincode: v.pincode || null,
    }));
    // Persist the assignment before emitting any invitation side effects or
    // acknowledging the request. A configured database failure must not leave
    // vendors notified about an invitation that disappears after restart.
    const { updatedRFQ, committedAdditions } = await this._appendRFQAssignmentsDurably(rfq.id, entries, {
      clearCategoryManagerAssignment: true,
      clearCategoryNotAvailable: true,
      advanceStatus: true,
      includeBuyerEmailInInvite: true,
    });
    if (!updatedRFQ) return null;
    const committedIds = new Set(committedAdditions.map((vendor) => vendor.id));
    const dispatchedInvites = newlyInvited.filter((vendor) => {
      if (!committedIds.has(vendor.id)) return false;
      committedIds.delete(vendor.id);
      return true;
    });
    const dispatchedIds = new Set(dispatchedInvites.map((vendor) => vendor.id));
    const dispatchedOverrides = overrideVendors.filter((vendor) => dispatchedIds.has(vendor.id));
    if (dispatchedInvites.length === 0) {
      return {
        updatedRFQ,
        invitedCount: 0,
        overrideCount: 0,
        excludedCount: excludedVendors.length,
        excludedVendors,

      };
    }

    for (const vendor of dispatchedInvites) {
      const isOverride = dispatchedOverrides.some((ov) => ov.id === vendor.id);
      this.addAuditLog({
        userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
        action: isOverride
          ? `Category Manager manual override: Vendor ${vendor.name} (${vendor.id}) invited to RFQ ${rfq.rfqNumber}`
          : `Category Manager manual assignment: Vendor ${vendor.name} (${vendor.id}) invited to RFQ ${rfq.rfqNumber}`,
        rfqNumber: rfq.rfqNumber,
      });

      // Real in-app notification
      const categoryLabel = updatedRFQ.category || this._rfqCategorySignals(updatedRFQ)[0] || 'your categories';
      const isBuyerUploaded = this.isBuyerUploaded(vendor);
      const buyerDisplayName = isBuyerUploaded && updatedRFQ.buyerAccountName ? updatedRFQ.buyerAccountName : 'A buyer';
      const notification = this._buildNotification({
        recipientType: 'vendor',
        recipientId: vendor.id,
        kind: 'rfq_category_match',
        rfq: updatedRFQ,
        title: `New RFQ in ${categoryLabel}`,
        message: buyerDisplayName + ' invited you to ' + updatedRFQ.rfqNumber + ' — ' + updatedRFQ.title + '.',
        meta: { category: categoryLabel, buyerAccountName: isBuyerUploaded ? (updatedRFQ.buyerAccountName || null) : null },
      });
      this.notifications.unshift(notification);
      this._persistNotification(notification);

      // Real invite email
      if (vendor.email && !pool.hasStorage()) {
        const buyerEmail = this.resolveBuyerEmailForRFQ(updatedRFQ);
        const creditInfo = this.checkVendorQuotationEligibility(vendor);
        logger.info(
          `Checking quotation credits for invited vendor ${vendor.name || vendor.email}: ${creditInfo.freeCreditsRemaining} free credits, subscribed: ${creditInfo.isSubscribed}`,
          { vendorId: vendor.id, freeCreditsRemaining: creditInfo.freeCreditsRemaining, isSubscribed: creditInfo.isSubscribed },
          'STORE_SERVICE'
        );
        const resolvedVendor = (vendor.id ? this.getVendorById(vendor.id, 'all') : null) || vendor;
        const resolvedIsBuyerUploaded = this.isBuyerUploaded(resolvedVendor);
        this._background(
          mailerService.sendRfqInviteEmail(vendor.email, {
            rfq: updatedRFQ,
            recipientName: vendor.contactPerson || vendor.name,
            freeCreditsRemaining: creditInfo.freeCreditsRemaining,
            isSubscribed: creditInfo.isSubscribed,
            vendor: resolvedVendor,
            isBuyerUploaded: resolvedIsBuyerUploaded,
            buyerEmail,
          }),
          'Failed to email RFQ invite to vendor',
          {
            deliveryChannel: 'email',
            operation: 'rfq-manual-vendor-invite',
            rfqId: updatedRFQ.id,
            rfqNumber: updatedRFQ.rfqNumber,
            vendorId: vendor.id,
          }
        );
      }
    }

    if (pool.hasStorage()) {
      this._dispatchRFQVendorInviteOutbox(updatedRFQ, 'manual-vendor-assignment');
    }

    this.addAuditLog({
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Invited ${dispatchedInvites.length} vendor(s) to ${rfq.rfqNumber}`,
      rfqNumber: rfq.rfqNumber,
    });

    // Schedule multi-channel / 5-minute SMS chasers for newly invited vendors
    const resolvedNewlyInvited = dispatchedInvites.map((v) => {
      const full = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
      return {
        ...v,
        phone: full.phone || full.mobile || full.mobileNumber || v.phone,
        email: full.email || v.email,
        name: full.name || v.name,
        contactPerson: full.contactPerson || v.contactPerson,
      };
    });

    rfqChaserScheduler.scheduleRFQChasers(
      updatedRFQ,
      resolvedNewlyInvited,
      (vendor) => this.checkVendorQuotationEligibility(vendor)
    );

    return {
      updatedRFQ,
      invitedCount: dispatchedInvites.length,
      overrideCount: dispatchedOverrides.length,
      excludedCount: excludedVendors.length,
      excludedVendors,
    };
  }

  /**
   * Validates vendor candidates against RFQ category signals.
   * Shortlists vendors matching the category, and excludes mismatched vendors
   * without sending mismatch emails.
   */
  validateAndShortlistVendors(rfq, vendorList, buyerEmail) {
    if (!rfq || !Array.isArray(vendorList)) return { shortlisted: [], excluded: [] };
    const signals = this._rfqCategorySignals(rfq);
    const shortlisted = [];
    const excluded = [];

    for (const v of vendorList) {
      const vendorRecord = (v.id ? this.getVendorById(v.id, 'all') : null) || v;
      const hasCategory = Boolean(
        vendorRecord.majorCategory ||
        (Array.isArray(vendorRecord.minorCategories) && vendorRecord.minorCategories.length > 0) ||
        (Array.isArray(vendorRecord.vendorSelectedCategories) && vendorRecord.vendorSelectedCategories.length > 0) ||
        (Array.isArray(vendorRecord.clientMappedCategories) && vendorRecord.clientMappedCategories.length > 0)
      );
      const isMatch = signals.length === 0 || (hasCategory && signals.some((sig) => this.vendorCoversCategory(vendorRecord, sig)));

      if (isMatch) {
        shortlisted.push(v);
      } else {
        excluded.push(vendorRecord);
      }
    }

    for (const vendor of excluded) {
      this.addAuditLog({
        userEmail: buyerEmail || SYSTEM_ACTOR_EMAIL,
        action: `Vendor ${vendor.name || vendor.id} excluded from automatic RFQ matching due to category mismatch.`,
        rfqNumber: rfq.rfqNumber,
      });
    }

    return { shortlisted, excluded };
  }

  /** The RFQs one vendor may see, in the store's current (newest-first) order. */
  getRFQsForVendor(vendorIdOrEmail) {
    const vendor = this.getVendorById(vendorIdOrEmail);
    if (!vendor) return [];
    return this.rfqs.filter((rfq) => this.vendorCoversRFQ(vendor, rfq)).map(normalizeRFQForRead);
  }

  /**
   * Raise a notification for every vendor an RFQ should reach.
   *
   * Fired from createRFQ. Uses the exact same `vendorCoversRFQ` rule the
   * opportunity feed and RFQ reads are scoped by, so a vendor is notified about
   * precisely the RFQs they can actually see. The whole fan-out is one batched
   * insert.
   */
  notifyVendorsOfNewRFQ(rfq) {
    if (!rfq || rfq.needsCategoryManagerAssignment || rfq.categoryNotAvailable) return [];
    const matches = this.vendors.filter((v) => this.vendorCoversRFQ(v, rfq));
    if (matches.length === 0) return [];

    const categoryLabel = rfq.category || this._rfqCategorySignals(rfq)[0] || 'your categories';

    const created = matches.map((vendor) => {
      const isBuyerUploaded = this.isBuyerUploaded(vendor);
      const buyerDisplayName = isBuyerUploaded && rfq.buyerAccountName ? rfq.buyerAccountName : 'A buyer';
      return this._buildNotification({
        recipientType: 'vendor',
        recipientId: vendor.id,
        kind: 'rfq_category_match',
        rfq,
        title: `New RFQ in ${categoryLabel}`,
        message: `${buyerDisplayName} raised ${rfq.rfqNumber} — ${rfq.title}.`,
        meta: { category: categoryLabel, buyerAccountName: isBuyerUploaded ? (rfq.buyerAccountName || null) : null },
      });
    });

    this.notifications.unshift(...created);
    this._persistNotificationBatch(created);
    return created;
  }

  /**
   * Tell an RFQ's owning buyer that a vendor has quoted.
   *
   * Fired from addQuoteToRFQ. The buyer is resolved from the RFQ's
   * `buyerAccountId` (the Neon buyer-account id stamped at creation), so a
   * quote against an RFQ with no owner attributed raises nothing.
   */
  notifyBuyerOfQuote(rfq, quote) {
    // Only reached from addQuoteToRFQ, which has already resolved a real RFQ and
    // built the quote — the one thing that can be missing is an owning buyer.
    if (!rfq.buyerAccountId) return null;
    const isHidden = this.isPortalRFQ(rfq) && this.isWithin48HourWindow(rfq);

    const notification = this._buildNotification({
      recipientType: 'buyer',
      recipientId: rfq.buyerAccountId,
      kind: 'quote_received',
      rfq,
      title: isHidden ? `New quote on ${rfq.rfqNumber} (Sealed)` : `New quote on ${rfq.rfqNumber}`,
      message: isHidden
        ? `${quote.vendorName || 'A vendor'} submitted a quotation on ${rfq.rfqNumber} — ${rfq.title}. (Commercial bid details sealed under 48-hour bidding integrity rule).`
        : `${quote.vendorName || 'A vendor'} submitted a quote on ${rfq.rfqNumber} — ${rfq.title}.`,
      meta: {
        vendorId: quote.vendorId || null,
        vendorName: quote.vendorName || null,
        totalPrice: quote.totalPrice,
        bidSealed: isHidden,
      },
    });
    this.notifications.unshift(notification);
    this._persistNotification(notification);
    return notification;
  }

  notifyBuyerOfInquiry(rfq, inquiry) {
    if (!rfq.buyerAccountId) return null;
    const notification = this._buildNotification({
      recipientType: 'buyer',
      recipientId: rfq.buyerAccountId,
      kind: 'vendor_inquiry',
      rfq,
      title: `New vendor clarification on ${rfq.rfqNumber}`,
      message: `${inquiry.vendorName || 'A vendor'} submitted a question on ${rfq.rfqNumber}: "${(inquiry.message || '').slice(0, 100)}"`,
      meta: {
        inquiryId: inquiry.id,
        vendorName: inquiry.vendorName,
        vendorEmail: inquiry.vendorEmail,
      },
    });
    this.notifications.unshift(notification);
    this._persistNotification(notification);
    return notification;
  }

  notifyBuyer(emailOrId, { kind, title, message, meta } = {}) {
    if (!emailOrId) return null;
    let buyerAccount = this.buyerAccounts.find(
      (a) => a.id === emailOrId || (a.corporateEmail && a.corporateEmail.toLowerCase() === String(emailOrId).toLowerCase())
    );
    const recipientId = buyerAccount ? buyerAccount.id : emailOrId;
    const notification = this._buildNotification({
      recipientType: 'buyer',
      recipientId,
      kind: kind || 'system_alert',
      title: title || 'System Update',
      message: message || '',
      meta: meta || {},
    });
    this.notifications.unshift(notification);
    this._persistNotification(notification);
    return notification;
  }

  notifyBuyerOfFinalComparison(rfq) {
    if (!rfq || !rfq.buyerAccountId) return null;

    const isPortal = this.isPortalRFQ(rfq);
    const in48hWindow = this.isWithin48HourWindow(rfq);

    // During the 48-hour bidding integrity window on portal RFQs, commercial comparisons
    // must NOT be emailed to the buyer.
    if (isPortal && in48hWindow) {
      logger.info(
        `[48H_BID_RULE] Portal RFQ ${rfq.rfqNumber}: suppressed final comparison email to buyer during 48-hour sealed window.`,
        { rfqNumber: rfq.rfqNumber },
        'STORE_SERVICE'
      );
      return null;
    }

    const notification = this._buildNotification({
      recipientType: 'buyer',
      recipientId: rfq.buyerAccountId,
      kind: 'rfq_final_comparison',
      rfq,
      title: `Final Evaluation Matrix Ready: ${rfq.rfqNumber}`,
      message: `Quotation comparison & AI scoring matrix is ready for ${rfq.rfqNumber} (${rfq.quotesCount || 0} quotes received).`,
      meta: {
        rfqNumber: rfq.rfqNumber,
        quotesCount: rfq.quotesCount || 0,
      },
    });
    this.notifications.unshift(notification);
    this._persistNotification(notification);

    // Dispatches final comparison email to the buyer
    const buyerEmail = this.resolveBuyerEmailForRFQ(rfq);
    if (buyerEmail) {
      this._background(
        mailerService.sendRfqFinalComparisonEmail(buyerEmail, {
          rfq,
          quotes: rfq.quotes || [],
          recipientName: rfq.buyerAccountName || rfq.buyerName,
        }),
        'Failed to send RFQ final comparison email',
        {
          deliveryChannel: 'email',
          operation: 'rfq-final-comparison-email',
          rfqId: rfq.id,
          rfqNumber: rfq.rfqNumber,
        }
      );
    }

    return notification;
  }

  notifyOfRFQClosure(rfq) {
    if (rfq.buyerAccountId) {
      const buyerNotif = this._buildNotification({
        recipientType: 'buyer',
        recipientId: rfq.buyerAccountId,
        kind: 'rfq_closed',
        rfq,
        title: `RFQ Closed: ${rfq.rfqNumber}`,
        message: `Sourcing requisition ${rfq.rfqNumber} (${rfq.title}) has been officially closed.`,
        meta: { rfqNumber: rfq.rfqNumber },
      });
      this.notifications.unshift(buyerNotif);
      this._persistNotification(buyerNotif);

      // Dispatches final comparison & closure result email to the buyer
      const buyerEmail = this.resolveBuyerEmailForRFQ(rfq);
      if (buyerEmail) {
        this._background(
          mailerService.sendRfqFinalComparisonEmail(buyerEmail, {
            rfq,
            quotes: rfq.quotes || [],
            recipientName: rfq.buyerAccountName || rfq.buyerName,
          }),
          'Failed to send RFQ final closure comparison email',
          {
            deliveryChannel: 'email',
            operation: 'rfq-final-closure-comparison-email',
            rfqId: rfq.id,
            rfqNumber: rfq.rfqNumber,
          }
        );
      }

      // Dispatches SMS acknowledgment regarding quotation comparison to the buyer within 10 minutes
      this.scheduleBuyerComparisonSms(rfq, 0);

      // Clear any pending delayed quote email timers since final closure email was sent
      if (this._delayedQuoteTimers && this._delayedQuoteTimers.has(rfq.id)) {
        const handles = this._delayedQuoteTimers.get(rfq.id) || [];
        handles.forEach((h) => clearTimeout(h));
        this._delayedQuoteTimers.delete(rfq.id);
      }
    }
    const matches = this.vendors.filter((v) => this.vendorCoversRFQ(v, rfq));
    if (matches.length > 0) {
      const vendorNotifs = matches.map((vendor) =>
        this._buildNotification({
          recipientType: 'vendor',
          recipientId: vendor.id,
          kind: 'rfq_closed',
          rfq,
          title: `RFQ Closed: ${rfq.rfqNumber}`,
          message: `Requisition ${rfq.rfqNumber} has been closed by the buyer. Bidding is now concluded.`,
          meta: { rfqNumber: rfq.rfqNumber },
        })
      );
      this.notifications.unshift(...vendorNotifs);
      this._persistNotificationBatch(vendorNotifs);
    }
  }

  /**
   * Schedules an SMS acknowledgment to the buyer regarding quotation comparison upon RFQ closure within 10 minutes.
   */
  async scheduleBuyerComparisonSms(rfq, delayMs = 0) {
    const effectiveDelay = Math.min(Math.max(0, delayMs), 10 * 60 * 1000);
    const trigger = async () => {
      try {
        const buyer = rfq.buyerEmail ? await this.getBuyerAccountByEmail(rfq.buyerEmail) : null;
        const mobile = rfq.buyerPhone || (buyer && (buyer.phone || buyer.mobile || buyer.contactPhone));
        if (mobile) {
          await smsService.sendBuyerComparisonSms({
            mobile,
            buyerName: rfq.buyerAccountName || rfq.buyerName,
            rfqNumber: rfq.rfqNumber,
            quotesCount: rfq.quotesCount || (rfq.quotes ? rfq.quotes.length : 0),
          });
        }
      } catch (err) {
        logger.error(`Error sending buyer comparison SMS for ${rfq.rfqNumber}`, err, 'STORE_SERVICE');
      }
    };

    if (effectiveDelay > 0 && process.env.NODE_ENV !== 'test') {
      setTimeout(trigger, effectiveDelay);
    } else {
      await trigger();
    }
  }

  // ==========================================
  // 3c. TRANSACTIONAL EMAIL (RFQ fan-out + quote-received)
  // ==========================================
  // Every send is fire-and-forget: mailerService no-ops under test and when
  // SMTP is unconfigured, and a real per-recipient failure is logged, never
  // thrown, so one bad address can't stop the rest of a fan-out.

  /** Subscription-tier priority for RFQ-email ranking. Unknown/free → 0. */
  _vendorTierRank(plan) {
    if (plan === 'select') return 3;
    if (plan === 'connect') return 2;
    if (plan === 'premium' || plan === 'premium_network') return 1;
    return 0;
  }

  /**
   * Up to `limit` vendors to email a new RFQ to.
   *
   * Starts from the vendors the RFQ actually reaches (`vendorCoversRFQ` — same
   * category rule as the opportunity feed), keeps only those with an email
   * address, then ranks by subscription tier, a delivery-pincode match, and
   * rating so the enquiry lands with the best-matched suppliers first.
   */
  selectVendorsForRFQEmail(rfq, limit = 10) {
    const pincode = rfq.deliveryPincode ? String(rfq.deliveryPincode).trim() : null;
    const rawSignals = this._rfqCategorySignals(rfq);
    const distinctSignals = Array.from(new Set(rawSignals.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)));

    const rankVendor = (v) => ({
      vendor: v,
      score:
        this._vendorTierRank(v.subscriptionPlan) * 1000 +
        (pincode && v.pincode && String(v.pincode).trim() === pincode ? 100 : 0) +
        (Number(v.rating) || 0),
    });

    const eligible = this.vendors.filter((v) => v.email && this.vendorCoversRFQ(v, rfq));

    if (distinctSignals.length > 3) {
      const selected = new Map();
      for (const sig of distinctSignals) {
        const catMatched = eligible
          .filter((v) => this.vendorCoversCategory(v, sig))
          .map(rankVendor)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((x) => x.vendor);

        for (const v of catMatched) {
          const key = v.id || v.email;
          if (key && !selected.has(key)) {
            selected.set(key, v);
          }
        }
      }
      return Array.from(selected.values());
    }

    return eligible
      .map(rankVendor)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.vendor);
  }

  /** Email a newly-created RFQ to its top matched vendors and assigned vendors. Fired from createRFQ. */
  emailRFQToMatchedVendors(rfq) {
    if (!rfq || rfq.status === 'Draft') {
      return 0;
    }
    const recipients = this.selectVendorsForRFQEmail(rfq);
    const assigned = (Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : []).filter((v) => v && v.email);
    const allEmails = new Set();

    if (pool.hasStorage()) {
      this._dispatchRFQVendorInviteOutbox(rfq, 'rfq-creation-vendor-invites');
      return Array.isArray(rfq.vendorInvitationTargets) ? rfq.vendorInvitationTargets.length : 0;
    }

    for (const vendor of recipients) {
      if (vendor.email && !allEmails.has(vendor.email.toLowerCase())) {
        allEmails.add(vendor.email.toLowerCase());
        const resolvedVendor = (vendor.id ? this.getVendorById(vendor.id, 'all') : null) || vendor;
        const creditInfo = this.checkVendorQuotationEligibility(resolvedVendor);
        const isBuyerUploaded = this.isBuyerUploaded(resolvedVendor);
        this._background(
          mailerService.sendRfqInviteEmail(vendor.email, {
            rfq,
            recipientName: vendor.contactPerson || vendor.name,
            freeCreditsRemaining: creditInfo.freeCreditsRemaining,
            isSubscribed: creditInfo.isSubscribed,
            vendor: resolvedVendor,
            isBuyerUploaded,
          }),
          'Failed to email RFQ invite to matched vendor',
          {
            deliveryChannel: 'email',
            operation: 'rfq-matched-vendor-invite',
            rfqId: rfq.id,
            rfqNumber: rfq.rfqNumber,
            vendorId: vendor.id,
          }
        );
      }
    }

    for (const vendor of assigned) {
      if (vendor.email && !allEmails.has(vendor.email.toLowerCase())) {
        allEmails.add(vendor.email.toLowerCase());
        const resolvedVendor = this.getVendorById(vendor.id || vendor.email, 'all') || vendor;
        const creditInfo = this.checkVendorQuotationEligibility(resolvedVendor);
        const isBuyerUploaded = this.isBuyerUploaded(resolvedVendor);
        this._background(
          mailerService.sendRfqInviteEmail(vendor.email, {
            rfq,
            recipientName: vendor.contactPerson || vendor.name,
            freeCreditsRemaining: creditInfo.freeCreditsRemaining,
            isSubscribed: creditInfo.isSubscribed,
            vendor: resolvedVendor,
            isBuyerUploaded,
          }),
          'Failed to email RFQ invite to assigned vendor',
          {
            deliveryChannel: 'email',
            operation: 'rfq-assigned-vendor-invite',
            rfqId: rfq.id,
            rfqNumber: rfq.rfqNumber,
            vendorId: vendor.id,
          }
        );
      }
    }

    if (rfq.followUpData) {
      if (!rfq.followUpData.emailStats) {
        rfq.followUpData.emailStats = { total: allEmails.size, delivered: 0, sent24h: 0, opened: 0 };
      }
      rfq.followUpData.emailStats.total = Math.max(rfq.followUpData.emailStats.total || 0, allEmails.size);
      this._persistRFQ(rfq);
    }

    return allEmails.size;
  }

  /**
   * Whether an RFQ originated from the web portal (vs inbound email gateway).
   */
  isPortalRFQ(rfq) {
    if (!rfq) return false;
    const src = String(rfq.source || '').toLowerCase().trim();
    return src !== 'email' && src !== 'email_gateway' && src !== 'inbound_email';
  }

  /**
   * Whether an RFQ is currently within its 48-hour bidding integrity window.
   */
  isWithin48HourWindow(rfq) {
    if (!rfq || rfq.status === 'Closed' || rfq.status === 'PO Generated' || rfq.poFinalised || Boolean(rfq.poNumber) || rfq.status === 'Expired') return false;
    const isV0 =
      rfq.sourcingMode === 'mode_0' ||
      rfq.sourcingMode === 'v0' ||
      rfq.sourcingMode === 'version_0';
    if (isV0) return false;
    if (rfq.quotesHidden) return true;
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    let createdAtMs = 0;
    if (rfq.createdAt) {
      const parsed = Date.parse(rfq.createdAt);
      if (!isNaN(parsed) && parsed > 0) {
        createdAtMs = parsed;
      }
    }
    if (createdAtMs <= 0) return true;
    return Date.now() - createdAtMs < FORTY_EIGHT_HOURS_MS;
  }

  /**
   * Calculates the remaining milliseconds in the 48-hour bidding window.
   */
  getRemaining48HourMs(rfq) {
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
    let createdAtMs = 0;
    if (rfq && rfq.createdAt) {
      const parsed = Date.parse(rfq.createdAt);
      if (!isNaN(parsed) && parsed > 0) {
        createdAtMs = parsed;
      }
    }
    if (createdAtMs <= 0) return FORTY_EIGHT_HOURS_MS;
    const elapsed = Date.now() - createdAtMs;
    return Math.max(0, FORTY_EIGHT_HOURS_MS - elapsed);
  }

  /**
   * Schedules a delayed quotation notification email to the buyer after the 48-hour window expires.
   */
  scheduleDelayedBuyerQuoteEmail(rfq, quote, buyer, delayMs) {
    const timer = setTimeout(() => {
      try {
        const currentRfq = this.getRFQById(rfq.id) || rfq;
        if (!currentRfq) return;
        logger.info(
          `[48H_BID_RULE] 48-hour sealed window expired for portal RFQ ${currentRfq.rfqNumber}. Dispatching quote email to buyer (${buyer.corporateEmail}).`,
          { rfqNumber: currentRfq.rfqNumber, quoteVendor: quote.vendorName, buyerEmail: buyer.corporateEmail },
          'STORE_SERVICE'
        );
        this._background(
          mailerService.sendQuoteReceivedEmail(buyer.corporateEmail, {
            rfq: currentRfq,
            quote,
            recipientName: buyer.organizationName,
          }),
          'Failed to dispatch delayed 48-hour quote email to buyer',
          {
            deliveryChannel: 'email',
            operation: 'rfq-delayed-quote-notification',
            rfqId: currentRfq.id,
            rfqNumber: currentRfq.rfqNumber,
            quoteId: quote.id,
          }
        );
      } catch (err) {
        logger.error(`Error in delayed quote email dispatch for ${rfq.rfqNumber}`, err, 'STORE_SERVICE');
      }
    }, delayMs);

    if (timer && timer.unref) {
      timer.unref();
    }

    if (!this._delayedQuoteTimers) {
      this._delayedQuoteTimers = new Map();
    }
    const list = this._delayedQuoteTimers.get(rfq.id) || [];
    list.push(timer);
    this._delayedQuoteTimers.set(rfq.id, list);
  }

  isBuyerProfileUpdateRequired(buyer, rfq) {
    if (!buyer) return false;

    // A profile update reminder is ONLY required for an unregistered buyer whose account was
    // auto-created via inbound email and who has NOT yet logged in and completed their profile onboarding.
    // Existing registered buyers, and auto-created buyers who have already completed/verified their profile,
    // must NEVER be asked to update their profile — quotations must be shared directly with them.

    // 1. Explicitly completed / verified profile or confirmed onboarding complete:
    if (
      buyer.onboardingRequired === false ||
      buyer.profileVerified === true ||
      buyer.accountSource === 'web_registration' ||
      buyer.verificationStatus === 'verified'
    ) {
      const hasPlaceholderPhone = Boolean(
        String(buyer.phone || buyer.mobileNumber || '').includes('9999999999') ||
        String(buyer.phone || buyer.mobileNumber || '').includes('0000000000')
      );
      if (!hasPlaceholderPhone) {
        return false;
      }
    }

    // 2. Identify if this buyer is an unregistered / auto-created buyer whose onboarding is pending:
    const isPendingOnboarding = Boolean(
      buyer.onboardingRequired === true ||
      buyer.status === 'PENDING_ONBOARDING' ||
      buyer.verificationStatus === 'PENDING_ONBOARDING' ||
      (buyer.isAutoRegistered === true && buyer.onboardingRequired !== false) ||
      buyer.tempPasswordRequired === true ||
      buyer.profileVerified === false ||
      buyer.phoneVerified === false ||
      String(buyer.phone || buyer.mobileNumber || '').includes('9999999999') ||
      String(buyer.phone || buyer.mobileNumber || '').includes('0000000000')
    );

    if (isPendingOnboarding) {
      // If the buyer is an established active account without explicit pending onboarding flags,
      // do not block them.
      const isEstablishedActiveBuyer = Boolean(
        (buyer.status === 'ACTIVE' || buyer.status === 'ACTIVE_VERIFIED') &&
        buyer.onboardingRequired !== true &&
        buyer.status !== 'PENDING_ONBOARDING' &&
        buyer.profileVerified !== false &&
        buyer.phoneVerified !== false &&
        !String(buyer.phone || buyer.mobileNumber || '').includes('9999999999') &&
        !String(buyer.phone || buyer.mobileNumber || '').includes('0000000000')
      );
      if (isEstablishedActiveBuyer) {
        return false;
      }
      return true;
    }

    // 3. For any existing registered buyer across all sourcing modes (mode_0, mode_1, mode_2, mode_3):
    // If they have no pending onboarding markers, never ask them to update profile.
    // Directly share the quotation.
    return false;
  }



  hasQuoteAckBeenSent(rfq) {
    if (!rfq) return false;
    this._rfqQuoteAckSent = this._rfqQuoteAckSent || new Set();
    const idKey = rfq.id ? String(rfq.id) : null;
    const numKey = rfq.rfqNumber ? String(rfq.rfqNumber) : null;
    return Boolean((idKey && this._rfqQuoteAckSent.has(idKey)) || (numKey && this._rfqQuoteAckSent.has(numKey)));
  }

  markQuoteAckSent(rfq) {
    if (!rfq) return;
    this._rfqQuoteAckSent = this._rfqQuoteAckSent || new Set();
    if (rfq.id) this._rfqQuoteAckSent.add(String(rfq.id));
    if (rfq.rfqNumber) this._rfqQuoteAckSent.add(String(rfq.rfqNumber));
  }

  _unmarkQuoteAckSent(rfq) {
    if (!rfq || !this._rfqQuoteAckSent) return;
    if (rfq.id) this._rfqQuoteAckSent.delete(String(rfq.id));
    if (rfq.rfqNumber) this._rfqQuoteAckSent.delete(String(rfq.rfqNumber));
  }

  /**
   * Email a submitted quote to the RFQ's owning buyer. Fired from addQuoteToRFQ.
   *
   * Dispatches immediately via mailerService.sendQuoteReceivedEmail:
   * - If the RFQ is within the 48-hour bidding integrity window (and non-V0),
   *   mailerService sends a sealed quotation alert to the buyer (notifying them
   *   that a bid landed while preserving integrity until the window concludes).
   * - If the buyer is unverified or in V0 without profile completion, full quote details
   *   are queued in pendingQuoteNotifications, and a single quotation acknowledgment
   *   is dispatched instructing the buyer to update their profile to access their quotes.
   * - Otherwise, mailerService sends the unsealed quote details.
   */
  emailQuoteToBuyer(rfq, quote) {
    const plan = this._buildBuyerQuoteEmailPlan(rfq);
    if (!plan) return false;
    const { buyer } = plan;
    const isPendingVerification = plan.requiresProfileCompletion;

    if (isPendingVerification) {
      logger.info(
        `Buyer ${buyer.corporateEmail} profile update/verification is pending. Queueing quotation and sending profile completion acknowledgment for RFQ ${rfq.rfqNumber}`,
        { rfqNumber: rfq.rfqNumber, quoteVendor: quote.vendorName },
        'STORE_SERVICE'
      );
      this.queuePendingQuoteNotification(buyer.corporateEmail, { rfq, quote });

      if (!this.hasQuoteAckBeenSent(rfq)) {
        this.markQuoteAckSent(rfq);
        const reminderDelivery = Promise.resolve(mailerService.sendBuyerProfileCompletionReminderEmail({
          to: buyer.corporateEmail,
          recipientName: buyer.organizationName,
          rfqNumber: rfq.rfqNumber,
          rfqTitle: rfq.title,
          quotesCount: 1,
        })).then((delivery) => {
          if (delivery?.sent !== true) this._unmarkQuoteAckSent(rfq);
          return delivery;
        }).catch((error) => {
          this._unmarkQuoteAckSent(rfq);
          throw error;
        });
        this._background(
          reminderDelivery,
          'Failed to email profile completion reminder to buyer',
          {
            deliveryChannel: 'email',
            operation: 'buyer-profile-completion-reminder',
            rfqId: rfq.id,
            rfqNumber: rfq.rfqNumber,
          }
        );
        this.addAuditLog({
          userEmail: buyer.corporateEmail,
          action: `Notification outcome: Started quotation acknowledgment and profile update reminder delivery to ${buyer.corporateEmail} for RFQ ${rfq.rfqNumber}`,
        });
      }
      return true;
    }

    if (!pool.hasStorage()) {
      this.queuePendingQuoteNotification(buyer.corporateEmail, { rfq, quote });
      this._background(
        this.dispatchPendingQuoteNotifications(buyer.corporateEmail, buyer),
        'Failed to dispatch local buyer quote notifications',
        {
          operation: 'rfq-quote-received-email-local-retry',
          rfqId: rfq.id,
          rfqNumber: rfq.rfqNumber,
          quoteId: quote.id,
        }
      );
      return true;
    }

    this._background(
      mailerService.sendQuoteReceivedEmail(buyer.corporateEmail, { rfq, quote, recipientName: buyer.organizationName }),
      'Failed to email quote to buyer',
      {
        deliveryChannel: 'email',
        operation: 'rfq-quote-received-email',
        rfqId: rfq.id,
        rfqNumber: rfq.rfqNumber,
        quoteId: quote.id,
      }
    );
    return true;
  }

  _buildBuyerQuoteEmailPlan(rfq) {
    if (!rfq) return null;
    const buyerEmail = this.resolveBuyerEmailForRFQ(rfq);
    if (!buyerEmail) return null;

    const buyer = (rfq.buyerAccountId && this.buyerAccounts.find((account) => account.id === rfq.buyerAccountId)) ||
      (this.buyerAccounts && this.buyerAccounts.find((account) => String(account.corporateEmail || '').trim().toLowerCase() === String(buyerEmail).trim().toLowerCase())) || {
        id: rfq.buyerAccountId || null,
        corporateEmail: buyerEmail,
        organizationName: rfq.buyerAccountName || rfq.buyerName || 'Buyer',
      };

    return {
      buyer,
      buyerEmail,
      requiresProfileCompletion: this.isBuyerProfileUpdateRequired(buyer, rfq),
    };
  }

  queuePendingQuoteNotification(buyerEmail, { rfq, quote }) {
    if (!buyerEmail || !rfq || !quote) return;
    const normEmail = String(buyerEmail).trim().toLowerCase();
    this._pendingQuoteNotifications = this._pendingQuoteNotifications || new Map();
    const list = this._pendingQuoteNotifications.get(normEmail) || [];
    const quoteKey = `${rfq.id || rfq.rfqNumber}:${quote.id || quote.vendorId || quote.vendorName}`;
    const alreadyQueued = list.some((item) => {
      const existingKey = `${item.rfq.id || item.rfq.rfqNumber}:${item.quote.id || item.quote.vendorId || item.quote.vendorName}`;
      return existingKey === quoteKey;
    });
    if (!alreadyQueued) {
      list.push({ rfq, quote });
      this._pendingQuoteNotifications.set(normEmail, list);
    }
  }

  async _releasePersistedPendingQuoteNotifications(buyerEmail) {
    const events = await eventOutboxQueries.releasePendingBuyerQuoteNotificationsInDB(buyerEmail);
    if (events.length === 0) return [];

    const eventIds = events.map((event) => event.id);
    const dispatch = await eventOutboxService.dispatchDueEventOutboxJobs(eventIds.length, eventIds);
    const completedIds = new Set(Array.isArray(dispatch.completedIds) ? dispatch.completedIds : []);
    const completed = events.filter((event) => completedIds.has(event.id));
    logger.info('Released durable buyer quote notifications after onboarding', {
      operation: 'release-buyer-quote-notifications',
      notificationCount: events.length,
      deliveredCount: completed.length,
    }, 'STORE_SERVICE');
    return completed;
  }

  async dispatchPendingQuoteNotifications(buyerEmail, buyerOverride = null) {
    if (!buyerEmail) return [];
    const normEmail = String(buyerEmail).trim().toLowerCase();
    if (pool.hasStorage()) {
      return this._releasePersistedPendingQuoteNotifications(normEmail);
    }
    const list = this._pendingQuoteNotifications ? (this._pendingQuoteNotifications.get(normEmail) || []) : [];
    if (list.length === 0) return [];

    let buyer = buyerOverride;
    if (!buyer) {
      try {
        // No buyer record is invented when none exists. The notice is then sent without a name.
        buyer = (await this.getBuyerAccountByEmail(normEmail)) || null;
      } catch (error) {
        list.forEach((item) => this.queuePendingQuoteNotification(normEmail, item));
        logger.error('Failed to load buyer before pending quote notification delivery', {
          operation: 'pending-buyer-quote-recipient-lookup',
          notificationCount: list.length,
          error,
        }, 'STORE_SERVICE');
        return [];
      }
    }

    const dispatched = [];
    this._pendingQuoteNotificationDispatching = this._pendingQuoteNotificationDispatching || new Set();
    for (const item of list) {
      const notificationKey = `${normEmail}:${item.rfq.id || item.rfq.rfqNumber}:${item.quote.id || item.quote.vendorId || item.quote.vendorName}`;
      if (this._pendingQuoteNotificationDispatching.has(notificationKey)) continue;
      this._pendingQuoteNotificationDispatching.add(notificationKey);
      const metadata = {
        operation: 'pending-buyer-quote-notification',
        rfqId: item.rfq.id,
        rfqNumber: item.rfq.rfqNumber,
        quoteId: item.quote.id,
        vendorId: item.quote.vendorId,
      };
      try {
        const delivery = await mailerService.sendQuoteReceivedEmail(normEmail, {
          rfq: item.rfq,
          quote: item.quote,
          recipientName: buyer?.organizationName || null,
        });
        if (delivery?.sent === true) {
          dispatched.push(item);
          if (this._pendingQuoteNotifications) {
            const current = this._pendingQuoteNotifications.get(normEmail) || [];
            const remaining = current.filter((pending) => (
              `${normEmail}:${pending.rfq.id || pending.rfq.rfqNumber}:${pending.quote.id || pending.quote.vendorId || pending.quote.vendorName}` !== notificationKey
            ));
            if (remaining.length > 0) this._pendingQuoteNotifications.set(normEmail, remaining);
            else this._pendingQuoteNotifications.delete(normEmail);
          }
          logger.info('Pending quote email accepted by provider', metadata, 'STORE_SERVICE');
          continue;
        }

        logger.error('Provider did not accept pending quote notification', {
          ...metadata,
          error: {
            code: RFQ_NOTIFICATION_ERROR_CODES.EMAIL_DELIVERY_NOT_ACCEPTED,
            reason: delivery?.reason,
            deliveryResultPresent: delivery !== undefined && delivery !== null,
          },
        }, 'STORE_SERVICE');
      } catch (error) {
        logger.error('Failed to dispatch pending quote notification', {
          ...metadata,
          error,
        }, 'STORE_SERVICE');
      } finally {
        this._pendingQuoteNotificationDispatching.delete(notificationKey);
      }
    }
    return dispatched;
  }

  /**
   * Resolve the owning buyer's corporate email for an RFQ.
   *
   * Used by the email gateway to CC the buyer on vendor quotation
   * acknowledgements and failure notifications. Falls back to the RFQ's
   * `raisedByEmail` when no buyer account is attributed.
   */
  resolveBuyerEmailForRFQ(rfq) {
    if (!rfq) return null;
    if (rfq.buyerAccountId) {
      const buyer = this.buyerAccounts.find((a) => a.id === rfq.buyerAccountId);
      if (buyer && buyer.corporateEmail) return buyer.corporateEmail;
    }
    return (
      rfq.raisedByEmail ||
      rfq.buyerEmail ||
      rfq.sourceEmail ||
      rfq.buyerCorporateEmail ||
      rfq.corporateEmail ||
      (rfq.buyer && (rfq.buyer.corporateEmail || rfq.buyer.email)) ||
      (rfq.buyerAccount && (rfq.buyerAccount.corporateEmail || rfq.buyerAccount.email)) ||
      null
    );
  }

  // ==========================================
  // 4. EVALUATIONS
  // ==========================================
  getEvaluations(limit = null) {
    if (limit && Number.isInteger(Number(limit)) && Number(limit) > 0) {
      return this.evaluations.slice(0, Math.min(Number(limit), 500));
    }
    return this.evaluations.slice(0, 500);
  }

  /**
   * Saved evaluations for one vendor, newest first. With persistent storage the
   * database is queried directly, so a record older than the in-memory window is
   * still found. Without storage, the in-memory list is searched by vendor id or
   * vendor name. A failed read throws a 503 so callers never treat an unreadable
   * store as "no evaluation exists".
   */
  async getVendorEvaluationsDurably(vendorId, limit = 1) {
    const normalizedId = String(vendorId || '').trim();
    if (!normalizedId) return [];

    if (!pool.hasStorage()) {
      const lookupKey = normalizedId.toLowerCase();
      return this.evaluations
        .filter((evaluation) =>
          String(evaluation.vendorId || '').toLowerCase() === lookupKey ||
          String(evaluation.vendorName || '').toLowerCase() === lookupKey
        )
        .slice(0, limit);
    }

    try {
      return await domainQueries.getEvaluationsForVendorFromDB(normalizedId, limit);
    } catch (error) {
      logger.error('Failed to read saved vendor evaluations', error, 'STORE_SERVICE');
      const readError = new Error('Saved evaluations could not be read from storage. No evaluation request was sent. Try again.');
      readError.statusCode = 503;
      readError.code = 'PERSISTENCE_UNAVAILABLE';
      throw readError;
    }
  }

  _buildEvaluationRecord(evalData) {
    const { moduleScores, overallScore, status, systemAction } = calculate360Evaluation(evalData.moduleScores || {});

    const mergedModuleScores = { ...moduleScores };
    if (evalData.moduleScores && typeof evalData.moduleScores === 'object') {
      for (const [key, val] of Object.entries(evalData.moduleScores)) {
        if (mergedModuleScores[key] && typeof val === 'object') {
          mergedModuleScores[key] = { ...mergedModuleScores[key], ...val };
        } else if (val) {
          mergedModuleScores[key] = val;
        }
      }
    }

    const newEval = {
      id: evalData.id || `eval-${Date.now()}`,
      vendorId: evalData.vendorId || `v-${Date.now()}`,
      // An evaluation identifies a real supplier or it identifies nobody. These
      // used to default to 'Enterprise Supplier' / 'vendor@supplier.com' /
      // '+91 98000 00000', which produced audit records that looked like a
      // genuine assessment of a company that did not exist.
      vendorName: evalData.vendorName || null,
      contactPerson: evalData.contactPerson || null,
      email: evalData.email || null,
      phone: evalData.phone || null,
      category: evalData.category || null,
      submissionDate: evalData.submissionDate || new Date().toISOString().substring(0, 10),
      status: evalData.status || status,
      overallScore: evalData.overallScore || overallScore,
      systemAction: evalData.systemAction || systemAction,
      moduleScores: mergedModuleScores,
      documents: evalData.documents || [],
      // The per-question detail was previously silently dropped here even
      // though the client always sent it — only the rolled-up moduleScores
      // survived.
      questionBreakdown: evalData.questionBreakdown || [],
    };

    return newEval;
  }

  createEvaluation(evalData) {
    const newEval = this._buildEvaluationRecord(evalData);
    this.evaluations.unshift(newEval);
    this._persistEvaluation(newEval);

    this.addAuditLog({
      userEmail: evalData.actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Executed 360° AI Supplier Audit for ${newEval.vendorName || newEval.vendorId}: Score ${newEval.overallScore}% (${newEval.status})`,
    });

    return newEval;
  }

  async createEvaluationDurably(evalData) {
    const newEval = this._buildEvaluationRecord(evalData);
    const storageConfigured = pool.hasStorage();
    let persistedEvaluation;

    try {
      persistedEvaluation = await domainQueries.upsertEvaluationInDB(newEval);
      if (storageConfigured && !persistedEvaluation) {
        throw new Error('Evaluation upsert completed without a persisted row');
      }
    } catch (error) {
      logger.error('Failed to persist vendor evaluation', error, 'STORE_SERVICE');
      const persistError = new Error('The evaluation could not be saved to storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }

    const savedEvaluation = persistedEvaluation || newEval;
    this.evaluations.unshift(savedEvaluation);
    this.addAuditLog({
      userEmail: evalData.actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Executed 360° AI Supplier Audit for ${savedEvaluation.vendorName || savedEvaluation.vendorId}: Score ${savedEvaluation.overallScore}% (${savedEvaluation.status})`,
    });
    return savedEvaluation;
  }

  // ==========================================
  // 5. AUDIT LOGS & CRYPTO VERIFICATION
  // ==========================================
  getAuditLogs(limit = null) {
    if (Number.isInteger(Number(limit)) && Number(limit) > 0) {
      return this.auditLogs.slice(0, Math.min(Number(limit), 500));
    }
    return this.auditLogs.slice(0, 500);
  }

  addAuditLog({ userEmail, action, rfqNumber, ipAddress }) {
    const previousHash = this.auditLogs.length > 0 ? this.auditLogs[0].shaSignature : '';
    const entry = createAuditEntry({ userEmail, action, rfqNumber, ipAddress, previousHash });
    this.auditLogs.unshift(entry);
    this._persistAuditLog(entry);
    return entry;
  }

  async addAuditLogDurably({ userEmail, action, rfqNumber, ipAddress }) {
    const previousHash = this.auditLogs.length > 0 ? this.auditLogs[0].shaSignature : '';
    const entry = createAuditEntry({ userEmail, action, rfqNumber, ipAddress, previousHash });
    try {
      return await this._queueAuditLogPersistence(entry);
    } catch (error) {
      logger.error('Failed to durably append audit log entry', error, 'STORE_SERVICE');
      const persistError = new Error('The audit log entry could not be saved to storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = error.code || 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
  }

  verifyAuditIntegrity() {
    return verifyAuditTrail(this.auditLogs);
  }

  async verifyAuditIntegrityDurably() {
    if (!pool.hasStorage()) {
      return {
        ...this.verifyAuditIntegrity(),
        valid: null,
        complete: false,
        source: 'in_memory',
        expectedCount: null,
        reason: 'Persistent storage is not configured; the capped process cache cannot verify the full audit chain.',
      };
    }
    return auditLogQueries.verifyAuditChainInDB();
  }

  // ==========================================
  // 6. AI BOT FEED
  // ==========================================
  getAIFeed(limit = null) {
    if (limit && Number.isInteger(Number(limit)) && Number(limit) > 0) {
      return this.aiFeed.slice(0, Math.min(Number(limit), 500));
    }
    return this.aiFeed.slice(0, 500);
  }

  async getAIFeedDurably(limit = 100) {
    if (!pool.hasStorage()) return this.getAIFeed(limit);

    try {
      const feed = await domainQueries.getAIFeedFromDB(limit);
      this.aiFeed = Array.isArray(feed) ? feed : [];
      return this.aiFeed;
    } catch (error) {
      logger.error('Failed to refresh AI feed from persistence', error, 'STORE_SERVICE');
      const unavailable = new Error('The AI activity feed could not be refreshed from storage. Try again.');
      unavailable.statusCode = 503;
      unavailable.code = 'PERSISTENCE_UNAVAILABLE';
      throw unavailable;
    }
  }

  addFeedItem(feedItem) {
    return this.addAIFeedItem(feedItem);
  }

  _buildAIFeedItem(feedItem) {
    let buyerAccountId = feedItem.buyerAccountId || null;
    if (!buyerAccountId && feedItem.rfqNumber) {
      const rfq = this.getRFQById(feedItem.rfqNumber);
      if (rfq && rfq.buyerAccountId) {
        buyerAccountId = rfq.buyerAccountId;
      }
    }

    const item = {
      id: feedItem.id || newFeedItemId(),
      timestamp: feedItem.timestamp || new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
      timeAgo: feedItem.timeAgo || 'Just now',
      type: feedItem.type || 'call',
      channel: feedItem.channel || 'call',
      title: feedItem.title || 'AI Bot Event',
      message: feedItem.message || '',
      recipient: feedItem.recipient || 'Vendor Contact',
      rfqNumber: feedItem.rfqNumber || null,
      buyerAccountId,
      status: feedItem.status || CHASER_OUTCOME_STATUS.RECORDED,
      channelDetails: feedItem.channelDetails || {},
    };

    return item;
  }

  _cacheAIFeedItem(item) {
    this.aiFeed.unshift(item);
    if (this.aiFeed.length > 100) this.aiFeed.pop();
    return item;
  }

  addAIFeedItem(feedItem) {
    const item = this._buildAIFeedItem(feedItem);
    this._cacheAIFeedItem(item);
    this._persistAIFeedItem(item);
    return item;
  }

  async addAIFeedItemDurably(feedItem) {
    const item = this._buildAIFeedItem(feedItem);
    const storageConfigured = pool.hasStorage();
    let persistedItem;

    try {
      persistedItem = await domainQueries.upsertAIFeedItemInDB(item);
      if (storageConfigured && !persistedItem) {
        throw new Error('AI feed item upsert completed without a persisted row');
      }
    } catch (error) {
      logger.error('Failed to persist AI feed item', error, 'STORE_SERVICE');
      const persistError = new Error('The AI feed item could not be saved to storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }

    return this._cacheAIFeedItem(persistedItem || item);
  }

  // ==========================================
  // 7. SYSTEM CONFIG & AZURE HEALTH
  // ==========================================
  /**
   * Read-only configuration that the backend itself uses. Nothing here is stored or
   * editable, so the only values listed are the ones application code reads.
   */
  getSystemConfig() {
    return {
      aiModel: GEMINI_CONFIG.PRIMARY_MODEL,
      aiTemperature: GEMINI_CONFIG.TEMPERATURE,
    };
  }

  getAzureHealth() {
    return this.azureHealth;
  }

  /** Replaces the infrastructure list with the single database row. */
  _setDatabaseHealthRow({ status, details, latency = INFRASTRUCTURE_HEALTH.EMPTY_VALUE, service = DATABASE_HEALTH_SERVICE_LABEL }) {
    const row = {
      service,
      status,
      latency,
      uptime: INFRASTRUCTURE_HEALTH.EMPTY_VALUE,
      details,
    };
    this.azureHealth = [row];
    return row;
  }

  /**
   * Replace the database row in the infrastructure list with a live probe result.
   *
   * The row is reported from an actual connection attempt rather than asserted:
   * `latency` is the measured round trip and `status` reflects whether the query
   * succeeded. `uptime` is left as '—' because nothing in this process observes
   * it, so no uptime figure is claimed.
   */
  async refreshInfrastructureHealth() {
    const health = await pool.checkDatabaseHealth();
    const isConnected = Boolean(health.isConnected);
    let status = INFRASTRUCTURE_HEALTH.STATUS.NOT_CONFIGURED;
    if (isConnected) status = INFRASTRUCTURE_HEALTH.STATUS.ONLINE;
    else if (health.isConfigured) status = INFRASTRUCTURE_HEALTH.STATUS.UNREACHABLE;

    this._setDatabaseHealthRow({
      service: health.isConfigured
        ? `${health.providerLabel}${health.database ? ` — ${health.database}` : ''}`
        : DATABASE_HEALTH_SERVICE_LABEL,
      status,
      latency: isConnected ? `${health.latencyMs}ms` : INFRASTRUCTURE_HEALTH.EMPTY_VALUE,
      details: isConnected
        ? `${health.poolStatus}. ${health.userCount} active account(s), ${health.vendorCount} vendor(s), ${health.rfqCount} RFQ(s).`
        : health.errorMessage || INFRASTRUCTURE_HEALTH.MESSAGES.CONNECTION_FAILED,
    });

    return health;
  }

  // ==========================================
  // 9. HISTORICAL PURCHASE DATA INGESTION & SETUP
  // ==========================================
  /**
   * Empanel suppliers from a buyer's historical purchase dump.
   *
   * Only what the dump actually contains is stored. Every missing field used to
   * be back-filled with an invention — a name of "Historical Supplier 3", an
   * address of "supplier.3@historical.com", a phone of "+91 98000 00000", a
   * category of "Engineering Spares - Mechanical", a location of "Industrial
   * Zone, India", a rating of 4.6 and a score of 88.0 — and the row was then
   * marked `evaluated: true`. The result was a vendor master full of suppliers
   * that could not be contacted, carrying scores nobody had assessed, which the
   * RFQ engine would then select against.
   *
   * A record without a company name and a contact email cannot identify a
   * supplier, so it is skipped and counted, and the caller is told how many were
   * rejected and why.
   */
  async processHistoricalPurchaseData(period, vendorRecords = [], requestingBuyerAccount = null) {
    let importedCount = 0;
    const skipped = [];
    // Every genuinely-new vendor pushed into `this.vendors` this run — awaited
    // against Postgres below before the response goes out, since `vendors.email`
    // is UNIQUE and this ingestion never checked for a collision outside the
    // requesting buyer's own scope. A colliding email used to insert cleanly
    // into memory while the real Postgres write silently failed in the
    // background, so the buyer saw "imported" for a supplier that was never
    // actually persisted.
    const createdThisRun = [];
    const attributedAccount = requestingBuyerAccount || this.activeBuyerAccount;
    const buyerId = attributedAccount ? attributedAccount.id : null;
    const buyerEmail = attributedAccount ? attributedAccount.corporateEmail : null;
    const buyerOrganizationName = attributedAccount ? attributedAccount.organizationName : 'Procucev Enterprise';

    // Step 5 of the buyer setup wizard previews "Template A" (PO-history
    // match) / "Template B" (no match) per vendor — this is the one place
    // that actually has to honor that, instead of always sending the
    // generic onboarding email regardless of what was previewed. Templates
    // are org-scoped and buyer-editable (vendor_dispatch_templates); a
    // lookup failure here must not block vendor ingestion, so it falls back
    // to the hardcoded default wording on any error.
    let dispatchTemplates = {};
    if (buyerEmail) {
      try {
        const identity = await identityQueries.findUserByEmail(buyerEmail);
        if (identity && identity.orgId) {
          dispatchTemplates = await buyerProfileQueries.getDispatchTemplates(identity.orgId);
        }
      } catch (err) {
        logger.error('Failed to load vendor dispatch templates', err, 'STORE_SERVICE');
      }
    }

    const isMappedRecord = (rec) => {
      if (rec.categoriesMappedByBuyer === true) return true;
      if (rec.categoriesMappedByBuyer === false) return false;
      const maj = (rec.majorCategory || '').trim();
      return Boolean(maj && !maj.toLowerCase().includes('uncategorized'));
    };

    /** Template A when the vendor has a buyer-mapped category, else Template B. */
    const buildMappingEmail = (rec, { to, recipientName, vendorCode, tempPassword, contactPhone }) => {
      const hasMapping = isMappedRecord(rec);
      if (hasMapping) {
        const override = dispatchTemplates.category_mapped || {};
        return {
          templateType: 'Template A',
          payload: mailerService.buildVendorCategoryMappingEmail({
            to,
            recipientName,
            buyerOrganizationName,
            vendorCode,
            majorCategory: rec.majorCategory || 'Engineering Spares - Mechanical',
            minorCategories: Array.isArray(rec.minorCategories) ? rec.minorCategories : [],
            customSubject: override.subject,
            customMessage: override.message,
            tempPassword,
            contactPhone,
          }),
        };
      }
      const override = dispatchTemplates.self_map_required || {};
      return {
        templateType: 'Template B',
        payload: mailerService.buildVendorSelfMappingEmail({
          to,
          recipientName,
          buyerOrganizationName,
          vendorCode,
          customSubject: override.subject,
          customMessage: override.message,
          tempPassword,
          contactPhone,
        }),
      };
    };

    const buildHistoricalOnboardingEvent = (vendorId, emailPayload) => {
      const configuredKey = String(process.env.AES_ENCRYPTION_KEY || process.env.AES_SECRET_KEY || '').trim();
      if (!configuredKey) {
        const error = new Error('Secure historical vendor email delivery is not configured. Set AES_ENCRYPTION_KEY or AES_SECRET_KEY.');
        error.code = 'ONBOARDING_ENCRYPTION_NOT_CONFIGURED';
        throw error;
      }
      const encryptedEmailPayload = cryptoService.encrypt(JSON.stringify(emailPayload), {
        additionalData: `vendor-historical-onboarding-email:${vendorId}`,
      });
      const eventType = EVENT_OUTBOX_TYPES.HISTORICAL_VENDOR_ONBOARDING_EMAIL;
      return {
        id: eventOutboxService.buildEventOutboxId(eventType, vendorId),
        eventType,
        payload: {
          vendorId,
          encryptedEmailPayload: encryptedEmailPayload.encoded,
        },
      };
    };

    const ensureVendorEmailPending = async (vendor) => {
      if (vendor.onboardingEmailStatus === 'pending') return;
      const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'pending');
      if (!statusWrite.updated) {
        throw new Error(statusWrite.warning || 'Vendor onboarding status could not be saved before email delivery.');
      }
    };

    let mappedCount = 0;
    let mappedEmailsSent = 0;
    let mappedEmailsQueued = 0;
    let unmappedCount = 0;
    let unmappedEmailsSent = 0;
    let unmappedEmailsQueued = 0;
    const failedEmails = [];
    const vendorsToEmail = [];

    for (let idx = 0; idx < vendorRecords.length; idx++) {
      const rec = vendorRecords[idx];
      const name = (rec.companyName || rec.name || '').trim();
      const email = (rec.email || '').trim();

      if (!name || !email) {
        skipped.push({
          row: idx + 1,
          reason: !name && !email
            ? 'Missing both company name and contact email.'
            : !name
              ? 'Missing company name.'
              : 'Missing contact email.',
        });
        continue;
      }

      const isMapped = isMappedRecord(rec);
      if (isMapped) mappedCount++;
      else unmappedCount++;

      const minorCategories = Array.isArray(rec.minorCategories) ? rec.minorCategories : [];
      const majorCategory = (rec.majorCategory || '').trim() || null;

      // Check if vendor already exists in memory or in DB
      let existing = this.vendors.find(
        (v) => v.email && v.email.toLowerCase() === email.toLowerCase()
      );
      if (!existing && pool.hasStorage()) {
        try {
          // eslint-disable-next-line no-await-in-loop
          existing = await domainQueries.getVendorByEmailFromDB(email, { fresh: true });
          if (existing && !this.vendors.some((v) => v.id === existing.id)) {
            this.vendors.push(existing);
          }
        } catch (e) {
          logger.error('Failed to lookup vendor by email from DB', e, 'STORE_SERVICE');
          skipped.push({
            row: idx + 1,
            reason: 'Could not verify whether this vendor already exists. Retry after database connectivity is restored.',
          });
          continue;
        }
      }

      if (existing) {
        const sBuyerId = buyerId ? String(buyerId).toLowerCase() : null;
        const sBuyerEmail = buyerEmail ? String(buyerEmail).toLowerCase() : null;
        const alreadyScopedToThisBuyer = Boolean(
          (sBuyerId && (
            (existing.buyerId && String(existing.buyerId).toLowerCase() === sBuyerId) ||
            (existing.buyerAccountId && String(existing.buyerAccountId).toLowerCase() === sBuyerId)
          )) ||
          (sBuyerEmail && existing.buyerEmail && String(existing.buyerEmail).toLowerCase() === sBuyerEmail)
        );

        const updatedVendor = { ...existing };
        updatedVendor.buyerId = buyerId || updatedVendor.buyerId || null;
        updatedVendor.buyerAccountId = buyerId || updatedVendor.buyerAccountId || null;
        updatedVendor.buyerEmail = buyerEmail || updatedVendor.buyerEmail || null;
        if (name) updatedVendor.name = name;
        if (rec.contactPerson) updatedVendor.contactPerson = (rec.contactPerson || '').trim();
        if (rec.phone) updatedVendor.phone = (rec.phone || '').trim();
        if (rec.location || rec.address) updatedVendor.location = (rec.location || rec.address || '').trim();
        if (majorCategory) updatedVendor.majorCategory = majorCategory;
        if (minorCategories.length > 0) {
          updatedVendor.minorCategories = minorCategories;
          updatedVendor.clientMappedCategories = minorCategories;
        }
        const recordedRating = optionalScore(rec.rating);
        if (recordedRating !== null) updatedVendor.rating = recordedRating;
        const recordedScore = optionalScore(rec.score);
        if (recordedScore !== null) updatedVendor.score = recordedScore;
        updatedVendor.hasRecord = true;
        updatedVendor.isExistingInDatabase = true;

        if (pool.hasStorage()) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const persisted = await domainQueries.upsertVendorInDB(updatedVendor);
            if (!persisted) throw new Error('Vendor update returned no persisted row');
            Object.assign(existing, persisted);
          } catch (err) {
            logger.error('Failed to update existing vendor in DB', err, 'STORE_SERVICE');
            skipped.push({ row: idx + 1, reason: 'Could not save this vendor. Retry after database connectivity is restored.' });
            continue;
          }
        } else {
          Object.assign(existing, updatedVendor);
        }

        if (!alreadyScopedToThisBuyer) {
          importedCount++;
        }
        vendorsToEmail.push({ rec, vendor: existing, isNew: !alreadyScopedToThisBuyer, isMapped });
        continue;
      }

      const newVendor = {
        id: `v-hist-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        buyerId: buyerId || null,
        buyerAccountId: buyerId || null,
        buyerEmail: buyerEmail || null,
        name,
        email,
        contactPerson: (rec.contactPerson || '').trim() || null,
        phone: (rec.phone || '').trim() || null,
        majorCategory,
        minorCategories,
        location: (rec.location || rec.address || '').trim() || null,
        // Absent, not assumed. A supplier arriving from a spend extract has not
        // been rated or audited by anyone yet.
        rating: Number.isFinite(Number(rec.rating)) ? Number(rec.rating) : null,
        score: Number.isFinite(Number(rec.score)) ? Number(rec.score) : null,
        source: 'historical_purchase_dump',
        status: 'PENDING EVALUATION',
        evaluated: false,
        hasRecord: true,
        isExistingInDatabase: true,
        onboardingEmailStatus: 'pending',
        clientMappedCategories: minorCategories,
        vendorSelectedCategories: [],
        // Nothing to align against until the vendor confirms their own categories.
        isCategoryAligned: false,
      };
      this.vendors.push(newVendor);
      createdThisRun.push({ row: idx + 1, vendor: newVendor, isMapped });
      importedCount++;
      vendorsToEmail.push({ rec, vendor: newVendor, isNew: true, isMapped });
    }

    // Confirm each new vendor actually landed in Postgres before reporting
    // success for it — a row whose email collided with one from a different
    // buyer (or the marketplace directory) is rolled back here instead of
    // staying an in-memory-only phantom.
    for (const { row, vendor, isMapped } of createdThisRun) {
      try {
        await this.confirmVendorPersisted(vendor);
      } catch (err) {
        if (err && err.statusCode === 409 && pool.hasStorage()) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const existingInDB = await domainQueries.getVendorByEmailFromDB(vendor.email, { fresh: true });
            if (existingInDB) {
              const updated = {
                ...existingInDB,
                buyerId: buyerId || existingInDB.buyerId,
                buyerAccountId: buyerAccountId || existingInDB.buyerAccountId,
                buyerEmail: buyerEmail || existingInDB.buyerEmail,
                addedByBuyerCompany: buyerAccount?.organizationName || existingInDB.addedByBuyerCompany,
                minorCategories: vendor.minorCategories?.length ? vendor.minorCategories : existingInDB.minorCategories,
                majorCategory: vendor.majorCategory || existingInDB.majorCategory,
              };
              // eslint-disable-next-line no-await-in-loop
              await domainQueries.upsertVendorInDB(updated);
              const memIdx = this.vendors.findIndex((v) => v.id === existingInDB.id);
              if (memIdx !== -1) this.vendors[memIdx] = { ...this.vendors[memIdx], ...updated };
              else this.vendors.push(updated);
              continue;
            }
          } catch (linkErr) {
            logger.error('Failed to link existing vendor on 409 conflict', linkErr, 'STORE_SERVICE');
          }
        }
        this.vendors = this.vendors.filter((v) => v.id !== vendor.id);
        importedCount--;
        if (isMapped) mappedCount--; else unmappedCount--;
        const toEmailIdx = vendorsToEmail.findIndex((item) => item.vendor.id === vendor.id);
        if (toEmailIdx !== -1) vendorsToEmail.splice(toEmailIdx, 1);
        skipped.push({
          row,
          reason: err && err.statusCode === 409
            ? `A vendor with the email ${vendor.email} already exists.`
            : 'Could not be saved — try again.',
        });
      }
    }

    // Process email dispatches for both mapped (Template A) and unmapped (Template B) vendors in a single action
    for (const { rec, vendor, isNew, isMapped } of vendorsToEmail) {
      if (!vendor.email || !EMAIL_REGEX.test(vendor.email)) {
        const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
        failedEmails.push({
          vendorId: vendor.id,
          vendorName: vendor.name,
          email: vendor.email || '',
          template: isMapped ? 'Template A' : 'Template B',
          reason: [
            !vendor.email ? 'Vendor record has no registered email address.' : 'Invalid email address format.',
            statusWrite.warning,
          ].join(' ').trim(),
        });
        continue;
      }

      // Avoid duplicate emails on retried actions if already confirmed sent
      if (vendor.onboardingEmailStatus === 'sent') {
        if (isMapped) mappedEmailsSent++;
        else unmappedEmailsSent++;
        logger.info(`Skipping duplicate onboarding email to ${vendor.email} (already sent)`, { vendorId: vendor.id }, 'STORE_SERVICE');
        continue;
      }

      let tempPassword = null;
      let templateType = isMapped ? 'Template A' : 'Template B';
      let payload = null;
      let onboardingEvent = null;
      try {
        const existingIdentity = await identityQueries.findUserByEmail(vendor.email);
        if (existingIdentity) {
          logger.info(`Skipped onboarding identity provisioning for ${vendor.email}: an identity account already exists`, { vendorId: vendor.id }, 'STORE_SERVICE');
          if (isNew) {
            await this._persistVendorOnboardingStatus(vendor, 'account_exists');
            continue;
          }
        } else {
          tempPassword = this._generateTempPassword();
        }

        ({ templateType, payload } = buildMappingEmail(rec, {
          to: vendor.email,
          recipientName: vendor.contactPerson || vendor.name,
          vendorCode: vendor.id,
          tempPassword,
          contactPhone: String(rec.phone || vendor.phone || '').trim(),
        }));

        if (pool.hasStorage()) {
          onboardingEvent = buildHistoricalOnboardingEvent(vendor.id, payload);
          await ensureVendorEmailPending(vendor);
        }

        if (!existingIdentity) {
          const result = await identityQueries.insertVendorAccount({
            email: vendor.email,
            password: tempPassword,
            phone: vendor.phone || null,
            fullName: vendor.contactPerson || vendor.name,
            organizationName: vendor.name,
            createdBy: 'vendor-ingestion',
            resetExisting: false,
            ...(onboardingEvent ? { onboardingEvent } : {}),
          });
          if (result && result.created) {
            logger.info(`Vendor identity account created for ${vendor.email}`, { vendorId: vendor.id }, 'STORE_SERVICE');
            if (onboardingEvent) {
              if (isMapped) mappedEmailsQueued++;
              else unmappedEmailsQueued++;
              logger.info('Historical vendor onboarding email recorded for durable delivery', {
                vendorId: vendor.id,
                outboxId: onboardingEvent.id,
                template: templateType,
              }, 'STORE_SERVICE');
              continue;
            }
          } else if (result && result.reason === 'ALREADY_EXISTS') {
            tempPassword = null;
            onboardingEvent = null;
            logger.info(`Vendor identity appeared during onboarding for ${vendor.email}; retaining existing credentials`, { vendorId: vendor.id }, 'STORE_SERVICE');
            if (isNew) {
              await this._persistVendorOnboardingStatus(vendor, 'account_exists');
              continue;
            }
            ({ templateType, payload } = buildMappingEmail(rec, {
              to: vendor.email,
              recipientName: vendor.contactPerson || vendor.name,
              vendorCode: vendor.id,
              tempPassword: null,
              contactPhone: String(rec.phone || vendor.phone || '').trim(),
            }));
          } else {
            throw new Error('Vendor identity creation returned without a persisted account.');
          }
        }
      } catch (idErr) {
        logger.error(`Failed to verify or provision identity for ${vendor.email}`, idErr, 'STORE_SERVICE');
        const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
        failedEmails.push({
          vendorId: vendor.id,
          vendorName: vendor.name,
          email: vendor.email,
          template: isMapped ? 'Template A' : 'Template B',
          reason: [
            `Vendor login could not be verified or created: ${idErr.message || 'identity storage unavailable'}`,
            statusWrite.warning,
          ].join(' ').trim(),
        });
        continue;
      }

      if (pool.hasStorage()) {
        try {
          onboardingEvent = onboardingEvent || buildHistoricalOnboardingEvent(vendor.id, payload);
          await ensureVendorEmailPending(vendor);
          const queued = await eventOutboxService.enqueueEventOutbox(
            onboardingEvent.eventType,
            vendor.id,
            onboardingEvent.payload
          );
          if (!queued) throw new Error('Historical vendor onboarding email was not confirmed in the durable outbox.');
          if (queued.status === 'completed') {
            const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'sent');
            if (!statusWrite.updated) throw new Error(statusWrite.warning || 'Completed vendor email status could not be saved.');
            if (isMapped) mappedEmailsSent++;
            else unmappedEmailsSent++;
            logger.info('Historical vendor onboarding email was already delivered', {
              vendorId: vendor.id,
              outboxId: onboardingEvent.id,
              template: templateType,
            }, 'STORE_SERVICE');
          } else if (queued.status === 'pending' || queued.status === 'processing') {
            if (isMapped) mappedEmailsQueued++;
            else unmappedEmailsQueued++;
            logger.info('Historical vendor onboarding email queued for durable delivery', {
              vendorId: vendor.id,
              outboxId: onboardingEvent.id,
              template: templateType,
              outboxStatus: queued.status,
            }, 'STORE_SERVICE');
          } else {
            throw new Error(`Historical vendor onboarding email returned unexpected outbox state: ${queued.status || 'unknown'}`);
          }
        } catch (queueErr) {
          const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
          failedEmails.push({
            vendorId: vendor.id,
            vendorName: vendor.name,
            email: vendor.email,
            template: templateType,
            reason: [queueErr.message || 'Could not record email for durable delivery.', statusWrite.warning].filter(Boolean).join(' ').trim(),
          });
          logger.error('Could not queue historical vendor onboarding email', {
            error: queueErr,
            vendorId: vendor.id,
            outboxId: onboardingEvent?.id,
            template: templateType,
          }, 'STORE_SERVICE');
        }
        continue;
      }

      try {
        const delivery = await mailerService.sendVendorIngestionEmail(payload, 'onboarding');
        if (delivery && delivery.sent) {
          await this._persistVendorOnboardingStatus(vendor, 'sent');
          if (isMapped) mappedEmailsSent++;
          else unmappedEmailsSent++;
          logger.info(`Onboarding email (${templateType}) sent to ${vendor.email}`, { vendorId: vendor.id }, 'STORE_SERVICE');
        } else {
          const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
          failedEmails.push({
            vendorId: vendor.id,
            vendorName: vendor.name,
            email: vendor.email,
            template: templateType,
            reason: [
              (delivery && delivery.reason) || 'Email service rejected delivery',
              statusWrite.warning,
            ].join(' ').trim(),
          });
          logger.warn(`Failed to send onboarding email to ${vendor.email}`, { reason: delivery?.reason }, 'STORE_SERVICE');
        }
      } catch (sendErr) {
        const statusWrite = await this._persistVendorOnboardingStatus(vendor, 'failed');
        failedEmails.push({
          vendorId: vendor.id,
          vendorName: vendor.name,
          email: vendor.email,
          template: templateType,
          reason: [
            sendErr.message || 'Error communicating with email service',
            statusWrite.warning,
          ].join(' ').trim(),
        });
        logger.error(`Error sending onboarding email to ${vendor.email}`, sendErr, 'STORE_SERVICE');
      }
    }

    const totalProcessed = mappedCount + unmappedCount;
    const deliveredOrQueuedCount = mappedEmailsSent + unmappedEmailsSent + mappedEmailsQueued + unmappedEmailsQueued;
    const overallStatus = failedEmails.length === 0 ? 'COMPLETED' : (deliveredOrQueuedCount > 0 ? 'COMPLETED_WITH_FAILURES' : 'FAILED');

    // Attributed to the requesting buyer's own account when the controller
    // resolved one from the session (same convention as createRFQ).
    this.addAuditLog({
      userEmail: attributedAccount ? attributedAccount.corporateEmail : SYSTEM_ACTOR_EMAIL,
      action: `Processed ${period.replace('_', ' ')} historical purchase dump: ${importedCount} supplier(s) empanelled (${mappedEmailsSent} Template A sent, ${mappedEmailsQueued} queued, ${unmappedEmailsSent} Template B sent, ${unmappedEmailsQueued} queued, ${failedEmails.length} failed).`,
    });

    return {
      success: true,
      importedCount,
      totalProcessed,
      mappedCount,
      mappedEmailsSent,
      mappedEmailsQueued,
      unmappedCount,
      unmappedEmailsSent,
      unmappedEmailsQueued,
      failedEmailCount: failedEmails.length,
      failedEmails,
      skippedCount: skipped.length,
      skipped,
      period,
      totalVendors: this.vendors.length,
      overallStatus,
    };
  }

  /**
   * Empanel a supplier whose category mapping the buyer has just approved.
   *
   * Deliberately separate from addVendor, which stores no rating or score and gives
   * an unevaluated supplier the "PENDING EVALUATION" status. This path must not
   * invent a status or score either: a supplier arriving from a vendor-master
   * and PO ingestion has had its categories established from real purchasing
   * evidence, but nobody has evaluated it. Carrying an invented score would let
   * the RFQ engine rank it against suppliers that were actually assessed.
   *
   * So the only things stored are the things the ingestion established. Absent
   * stays absent: rating, score and evaluated are null/false until a real
   * evaluation produces them.
   */
  async empanelIngestedVendor(vendorData, actorEmail = null) {
    const minorCategories = Array.isArray(vendorData.minorCategories) ? vendorData.minorCategories : [];
    const newVendor = {
      id: `v-ingest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: vendorData.name,
      email: vendorData.email,
      contactPerson: vendorData.contactPerson || null,
      phone: vendorData.phone || null,
      location: vendorData.location || null,
      gstin: vendorData.gstin || null,
      vendorCode: vendorData.vendorCode || null,
      majorCategory: vendorData.majorCategory || null,
      minorCategories,
      // The buyer mapped these from PO history; the vendor has not confirmed
      // them yet, so there is nothing to align against.
      clientMappedCategories: Array.isArray(vendorData.clientMappedCategories)
        ? vendorData.clientMappedCategories
        : minorCategories,
      vendorSelectedCategories: [],
      isCategoryAligned: false,
      rating: null,
      score: null,
      evaluated: false,
      hasRecord: true,
      isExistingInDatabase: true,
      status: 'REGISTERED / NOT EVALUATED',
      source: 'vendor_master_ingestion',
      onboardingEmailStatus: 'pending',
      profileCompletionStatus: 'pending',
      addedByBuyerCompany: vendorData.addedByBuyerCompany || null,
      buyerId: vendorData.buyerId || vendorData.buyerAccountId || null,
      buyerAccountId: vendorData.buyerAccountId || vendorData.buyerId || null,
      buyerEmail: vendorData.buyerEmail || actorEmail || null,
      subscriptionPlan: 'premium',
      rfqDownloadsUsed: 0,
    };

    let persistedVendor;
    try {
      persistedVendor = await domainQueries.upsertVendorInDB(newVendor);
      if (pool.hasStorage() && !persistedVendor) {
        throw new Error('Vendor empanelment completed without a persisted row');
      }
    } catch (error) {
      logger.error('Failed to persist vendor empanelled from vendor master ingestion', error, 'STORE_SERVICE');
      const isUniqueConflict =
        (error && error.code === '23505') ||
        (error && typeof error.message === 'string' && /unique constraint/i.test(error.message)) ||
        (error && error.cause && typeof error.cause.message === 'string' && /unique constraint/i.test(error.cause.message));
      const persistError = new Error(
        isUniqueConflict
          ? `A vendor with the email ${newVendor.email} already exists.`
          : 'The vendor could not be empanelled in storage. Try again.'
      );
      persistError.statusCode = isUniqueConflict ? 409 : 503;
      persistError.code = isUniqueConflict ? 'VENDOR_EMAIL_CONFLICT' : 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }

    const savedVendor = persistedVendor || newVendor;
    this.vendors.unshift(savedVendor);
    this.addAuditLog({
      userEmail: actorEmail || SYSTEM_ACTOR_EMAIL,
      action: `Empanelled ${savedVendor.name} from vendor master ingestion in category ${savedVendor.majorCategory || 'unassigned'
        }`,
    });

    return savedVendor;
  }

  // ==========================================
  // 10. DUAL-STREAM CATEGORY RECONCILIATION
  // ==========================================
  updateVendorCategories(vendorId, { clientMappedCategories = [], vendorSelectedCategories = [] }) {
    // Scoped 'all': the controller has already authorized the caller (see
    // vendorController.updateCategories) by the time this runs, so re-scoping
    // by buyer here is redundant — and was actively wrong: an unscoped lookup
    // returns undefined for any vendor carrying a buyerId/buyerAccountId
    // (every buyer-uploaded vendor), silently returning null from this whole
    // function. The controller then responded 200 {success:true, data:null},
    // and the frontend's follow-up read of data.clientMappedCategories on
    // that null threw a TypeError right after reporting the save succeeded.
    const vendor = this.getVendorById(vendorId, 'all');
    if (!vendor) return null;

    // Check alignment
    const isCategoryAligned =
      clientMappedCategories.length === 0 ||
      clientMappedCategories.every((cat) => vendorSelectedCategories.includes(cat));

    const updated = this.updateVendor(vendor.id, {
      clientMappedCategories,
      vendorSelectedCategories: vendorSelectedCategories.slice(0, 10), // Max 10 categories
      isCategoryAligned,
    });

    this.addAuditLog({
      userEmail: vendor.email,
      action: `Reconciled categories for ${vendor.name}: ${vendorSelectedCategories.length} categories active (Aligned: ${isCategoryAligned})`,
    });

    return updated;
  }

  async updateVendorCategoriesDurably(vendorId, { clientMappedCategories = [], vendorSelectedCategories = [] }) {
    const vendor = this.getVendorById(vendorId, 'all');
    if (!vendor) return null;

    const isCategoryAligned =
      clientMappedCategories.length === 0 ||
      clientMappedCategories.every((category) => vendorSelectedCategories.includes(category));
    const updated = await this.updateVendorDurably(vendor.id, {
      clientMappedCategories,
      vendorSelectedCategories: vendorSelectedCategories.slice(0, 10),
      isCategoryAligned,
    });
    if (!updated) return null;

    this.addAuditLog({
      userEmail: vendor.email,
      action: `Reconciled categories for ${vendor.name}: ${vendorSelectedCategories.length} categories active (Aligned: ${isCategoryAligned})`,
    });
    return updated;
  }

  // ==========================================
  // 11. AI SUPPORT CHAT ASSISTANT & ESCALATION
  // ==========================================
  /**
   * AI support chat. No assistant grounded in this application's data is connected,
   * so no reply is composed. Every message gets the not_configured result, and no
   * support ticket is created or claimed.
   */
  handleSupportChat() {
    return {
      success: false,
      status: SUPPORT_CHAT_STATUS.NOT_CONFIGURED,
      reply: null,
      isEscalated: false,
      ticketId: null,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      error: SUPPORT_CHAT_MESSAGES.NOT_CONFIGURED,
    };
  }

  // ==========================================
  // 12. VENDOR ITEM SKU CATALOGUE CRUD
  // ==========================================
  // Scoped per vendor. Called without a vendorId (the buyer-side catalogue
  // browse) it returns every product; the three unowned demo SKUs that used to
  // be visible only through that unfiltered path are gone.
  getVendorCatalogue(vendorId, limit = null) {
    let items = !vendorId ? this.vendorCatalogue : this.vendorCatalogue.filter((p) => p.vendorId === vendorId);
    if (limit && Number.isInteger(Number(limit)) && Number(limit) > 0) {
      items = items.slice(0, Math.min(Number(limit), 500));
    } else {
      items = items.slice(0, 500);
    }
    return items;
  }

  async getVendorCatalogueDurably(vendorId, limit = 100) {
    if (!pool.hasStorage()) return this.getVendorCatalogue(vendorId, limit);
    try {
      const products = vendorId
        ? await domainQueries.getVendorCatalogueByVendorFromDB(vendorId, limit)
        : await domainQueries.getVendorCatalogueFromDB(limit, { fresh: true });
      if (vendorId) {
        this.vendorCatalogue = [
          ...products,
          ...this.vendorCatalogue.filter((product) => product.vendorId !== vendorId),
        ];
      } else {
        const refreshedIds = new Set(products.map((product) => product.id));
        this.vendorCatalogue = [
          ...products,
          ...this.vendorCatalogue.filter((product) => !refreshedIds.has(product.id)),
        ];
      }
      return products;
    } catch (error) {
      logger.error('Failed to refresh vendor catalogue from storage', error, 'STORE_SERVICE');
      const persistError = new Error('The catalogue could not be loaded from storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
  }

  getCatalogueProductById(id) {
    return this.vendorCatalogue.find((p) => p.id === id);
  }

  async getCatalogueProductByIdDurably(id) {
    if (!pool.hasStorage()) return this.getCatalogueProductById(id) || null;
    try {
      const product = await domainQueries.getCatalogueProductByIdFromDB(id);
      const cachedIndex = this.vendorCatalogue.findIndex((candidate) => candidate.id === id);
      if (product && cachedIndex >= 0) {
        this.vendorCatalogue[cachedIndex] = product;
      } else if (product) {
        this.vendorCatalogue.unshift(product);
      } else if (cachedIndex >= 0) {
        this.vendorCatalogue.splice(cachedIndex, 1);
      }
      return product;
    } catch (error) {
      logger.error('Failed to refresh catalogue product from storage', error, 'STORE_SERVICE');
      const persistError = new Error('The catalogue item could not be loaded from storage. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
  }

  _buildCatalogueProduct(product, vendorId) {
    return {
      ...product,
      id: product.id || `prod-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      vendorId,
      unitPrice: Number(product.unitPrice) || 0,
      leadTimeDays: Number(product.leadTimeDays) || 7,
      moq: Number(product.moq) || 1,
    };
  }

  _auditCatalogueMutation(userEmail, action) {
    this.addAuditLog({ userEmail: userEmail || 'unknown', action });
  }

  addProductToCatalogue(product, vendorId, userEmail) {
    const newProd = this._buildCatalogueProduct(product, vendorId);
    this.vendorCatalogue.unshift(newProd);
    this._persistCatalogueProduct(newProd);
    this._auditCatalogueMutation(userEmail, `Added product ${newProd.sku} (${newProd.name}) to item SKU catalogue`);
    return newProd;
  }

  async addProductToCatalogueDurably(product, vendorId, userEmail) {
    if (!pool.hasStorage()) return this.addProductToCatalogue(product, vendorId, userEmail);
    const newProduct = this._buildCatalogueProduct(product, vendorId);
    try {
      const persisted = await domainQueries.upsertCatalogueProductInDB(newProduct);
      if (!persisted) throw new Error('Catalogue product upsert completed without a persisted row');
      this.vendorCatalogue.unshift(persisted);
      this._auditCatalogueMutation(userEmail, `Added product ${persisted.sku} (${persisted.name}) to item SKU catalogue`);
      logger.info('Catalogue product creation committed', {
        productId: persisted.id,
        vendorId: persisted.vendorId,
      }, 'STORE_SERVICE');
      return persisted;
    } catch (error) {
      if (error?.code === 'CATALOGUE_SKU_CONFLICT') {
        logger.warn('Catalogue product creation rejected because the SKU is already in use', {
          productId: newProduct.id,
          vendorId: newProduct.vendorId,
        }, 'STORE_SERVICE');
        throw error;
      }
      logger.error('Failed to persist catalogue product creation', error, 'STORE_SERVICE');
      const persistError = new Error('The catalogue item could not be saved. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
  }

  updateCatalogueProduct(id, updates, userEmail) {
    const idx = this.vendorCatalogue.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const { vendorId: _ignoredVendorId, id: _ignoredId, ...safeUpdates } = updates;
    this.vendorCatalogue[idx] = { ...this.vendorCatalogue[idx], ...safeUpdates };
    this._persistCatalogueProduct(this.vendorCatalogue[idx]);
    this._auditCatalogueMutation(userEmail, `Updated SKU ${this.vendorCatalogue[idx].sku} in catalogue`);
    return this.vendorCatalogue[idx];
  }

  async updateCatalogueProductDurably(id, updates, userEmail) {
    const idx = this.vendorCatalogue.findIndex((product) => product.id === id);
    if (idx === -1) return null;
    if (!pool.hasStorage()) return this.updateCatalogueProduct(id, updates, userEmail);

    const { vendorId: _ignoredVendorId, id: _ignoredId, ...safeUpdates } = updates;
    const candidate = { ...this.vendorCatalogue[idx], ...safeUpdates };
    try {
      const persisted = await domainQueries.upsertCatalogueProductInDB(candidate);
      if (!persisted) throw new Error('Catalogue product update completed without a persisted row');
      this.vendorCatalogue[idx] = persisted;
      this._auditCatalogueMutation(userEmail, `Updated SKU ${persisted.sku} in catalogue`);
      logger.info('Catalogue product update committed', {
        productId: persisted.id,
        vendorId: persisted.vendorId,
        changedFields: Object.keys(safeUpdates),
      }, 'STORE_SERVICE');
      return persisted;
    } catch (error) {
      if (error?.code === 'CATALOGUE_SKU_CONFLICT') {
        logger.warn('Catalogue product update rejected because the SKU is already in use', {
          productId: candidate.id,
          vendorId: candidate.vendorId,
        }, 'STORE_SERVICE');
        throw error;
      }
      logger.error('Failed to persist catalogue product update', error, 'STORE_SERVICE');
      const persistError = new Error('The catalogue item could not be updated. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
  }

  deleteCatalogueProduct(id, userEmail) {
    const idx = this.vendorCatalogue.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const removed = this.vendorCatalogue.splice(idx, 1)[0];
    this._removeCatalogueProduct(id);
    this._auditCatalogueMutation(userEmail, `Removed product ${removed.sku} from SKU catalogue`);
    return true;
  }

  async deleteCatalogueProductDurably(id, userEmail) {
    const idx = this.vendorCatalogue.findIndex((product) => product.id === id);
    if (idx === -1) return false;
    if (!pool.hasStorage()) return this.deleteCatalogueProduct(id, userEmail);

    const product = this.vendorCatalogue[idx];
    try {
      const deleted = await domainQueries.deleteCatalogueProductInDB(id);
      if (!deleted) {
        this.vendorCatalogue.splice(idx, 1);
        return false;
      }
      this.vendorCatalogue.splice(idx, 1);
      this._auditCatalogueMutation(userEmail, `Removed product ${product.sku} from SKU catalogue`);
      logger.info('Catalogue product deletion committed', {
        productId: id,
        vendorId: product.vendorId,
      }, 'STORE_SERVICE');
      return true;
    } catch (error) {
      logger.error('Failed to persist catalogue product deletion', error, 'STORE_SERVICE');
      const persistError = new Error('The catalogue item could not be deleted. Try again.');
      persistError.statusCode = 503;
      persistError.code = 'PERSISTENCE_UNAVAILABLE';
      throw persistError;
    }
  }

  // ==========================================
  // 13. BATCH CHASER DISPATCH & PO APPROVAL
  // ==========================================
  /**
   * Chases every vendor invited to an RFQ over the requested channels.
   *
   * WhatsApp and SMS attempts wait for the provider's answer, and only that answer
   * is recorded: the vendor's channel status, the RFQ's channel counts and the feed.
   * This backend has no voice-call provider, so a call is reported as not_configured
   * and never recorded as made.
   *
   * @param {string} rfqId
   * @param {string[]} channels
   * @param {{ email?: string }|null} actor The authenticated user who triggered the batch.
   * @returns {Promise<null|object>} null when the RFQ does not exist.
   */
  async triggerBatchChaser(rfqId, channels, actor = null) {
    const rfq = this.getRFQById(rfqId);
    if (!rfq) return null;

    // Only the vendors actually invited to this RFQ. Nobody outside the assignment
    // list is contacted.
    const vendors = Array.isArray(rfq.assignedVendors) ? rfq.assignedVendors : [];
    if (vendors.length === 0) {
      return {
        success: false,
        count: 0,
        logs: [],
        results: [],
        sentCount: 0,
        error: CHASER_OUTREACH_MESSAGES.NO_VENDORS_ASSIGNED,
      };
    }

    const requestedChannels = Array.isArray(channels) ? [...new Set(channels)] : [];
    if (requestedChannels.length === 0) {
      return {
        success: false,
        count: 0,
        logs: [],
        results: [],
        sentCount: 0,
        error: CHASER_OUTREACH_MESSAGES.NO_CHANNELS_SELECTED,
      };
    }
    const dispatches = [];
    vendors.forEach((vendor) => {
      requestedChannels.forEach((channel) => dispatches.push(this._dispatchChaserChannel(rfq, vendor, channel)));
    });
    const attempts = await Promise.all(dispatches);

    const sentCount = attempts.filter((attempt) => attempt.outcome.success).length;
    const notSentCount = attempts.length - sentCount;
    const attemptedSends = attempts.filter((attempt) => attempt.attempted);

    this._recordChaserOutcomesOnRfq(rfq, attemptedSends);
    const feedItems = attemptedSends.map((attempt) => this._recordChannelFeedItem(
      { channel: attempt.channel, vendor: attempt.vendor, rfqNumber: rfq.rfqNumber, buyerAccountId: rfq.buyerAccountId },
      attempt.outcome
    ));

    this.addAuditLog({
      userEmail: (actor && actor.email) || SYSTEM_ACTOR_EMAIL,
      action: formatMessage(CHASER_OUTREACH_MESSAGES.AUDIT_BATCH_CHASER, {
        rfqNumber: rfq.rfqNumber,
        channels: requestedChannels.join(' + '),
        sentCount,
        notSentCount,
      }),
      rfqNumber: rfq.rfqNumber,
    });

    return {
      success: sentCount > 0,
      count: feedItems.length,
      logs: feedItems,
      results: attempts.map((attempt) => this._chaserResultRow(attempt)),
      sentCount,
      ...(sentCount > 0 ? {} : { error: CHASER_OUTREACH_MESSAGES.NOTHING_SENT }),
    };
  }

  /**
   * One vendor on one channel. Never throws: a provider error becomes a failed
   * outcome, so the batch can report every channel.
   */
  async _dispatchChaserChannel(rfq, vendor, channel) {
    const notAttempted = (status, error) => ({
      vendor,
      channel,
      attempted: false,
      outcome: { success: false, status, messageId: null, error },
    });

    if (channel === 'call') {
      return notAttempted(CHASER_OUTCOME_STATUS.NOT_CONFIGURED, CHASER_OUTREACH_MESSAGES.VOICE_NOT_CONFIGURED);
    }
    if (channel !== 'whatsapp' && channel !== 'sms') {
      return notAttempted(CHASER_OUTCOME_STATUS.SKIPPED, CHASER_OUTREACH_MESSAGES.UNSUPPORTED_CHANNEL);
    }
    const vendorPhone = vendor.phone || vendor.mobile || vendor.mobileNumber;
    if (!vendorPhone) {
      return notAttempted(CHASER_OUTCOME_STATUS.SKIPPED, CHASER_OUTREACH_MESSAGES.NO_PHONE_ON_RECORD);
    }

    let sendResult;
    try {
      if (channel === 'whatsapp') {
        sendResult = await whatsAppService.sendRFQInvitationWhatsApp({
          phone: vendorPhone,
          vendorName: vendor.name,
          contactPerson: vendor.contactPerson,
          rfqNumber: rfq.rfqNumber,
          rfqTitle: rfq.title,
          vendorEmail: vendor.email,
          deliveryDate: rfq.targetDeliveryDate || rfq.deadline,
          deliveryLocation: rfq.deliveryLocation || rfq.deliveryCity,
        });
      } else {
        sendResult = await smsService.sendRFQChaserSms({
          mobile: vendorPhone,
          vendorName: vendor.name,
          rfqNumber: rfq.rfqNumber,
          rfqTitle: rfq.title,
          bidLink: whatsAppService.generateOneClickBidUrl(rfq.rfqNumber, vendor.email),
        });
      }
    } catch (error) {
      logger.error(
        `[CHASER] ${CHASER_CHANNEL_LABELS[channel]} dispatch threw`,
        { vendorId: vendor.id, rfqNumber: rfq.rfqNumber, error },
        'STORE_SERVICE'
      );
      sendResult = { success: false, status: CHASER_OUTCOME_STATUS.FAILED, error: error && error.message };
    }

    const outcome = toChannelOutcome(sendResult);
    logger.info(
      `[CHASER] ${CHASER_CHANNEL_LABELS[channel]} to ${vendor.name}: ${outcome.status}`,
      { vendorId: vendor.id, rfqNumber: rfq.rfqNumber, status: outcome.status, messageId: outcome.messageId },
      'STORE_SERVICE'
    );
    return { vendor, channel, attempted: true, outcome };
  }

  /**
   * Writes the real outcome of each attempted WhatsApp or SMS send onto the stored
   * RFQ: the vendor's status for that channel, and one delivered-count step per
   * message the provider accepted.
   */
  _recordChaserOutcomesOnRfq(rfq, attempts) {
    const sends = attempts.filter((attempt) => attempt.channel === 'whatsapp' || attempt.channel === 'sms');
    if (sends.length === 0) return;

    const stored = this.rfqs.find((candidate) => candidate.id === rfq.id || candidate.rfqNumber === rfq.rfqNumber) || rfq;
    this._reconcileRFQFollowUpStats(stored);
    const followUp = stored.followUpData;
    if (!followUp) return;

    const recordedAt = new Date().toISOString();
    sends.forEach(({ vendor, channel, outcome }) => {
      const stats = channel === 'whatsapp' ? followUp.whatsappStats : followUp.smsStats;
      if (stats && outcome.success) stats.delivered = recordedCount(stats.delivered) + 1;

      const record = this._followUpVendorRecord(followUp, vendor);
      record[channel] = {
        status: outcome.status,
        lastAttempt: recordedAt,
        messageId: outcome.messageId,
        error: outcome.error,
      };
    });
    this._persistRFQ(stored);
  }

  /** The follow-up entry for one vendor, created when the RFQ does not have one yet. */
  _followUpVendorRecord(followUp, vendor) {
    if (!Array.isArray(followUp.vendors)) followUp.vendors = [];
    let record = followUp.vendors.find((entry) => entry && (
      (vendor.id && (entry.vendorId === vendor.id || entry.id === vendor.id))
      || (vendor.name && (entry.vendorName === vendor.name || entry.name === vendor.name))
    ));
    if (!record) {
      record = { id: vendor.id, vendorId: vendor.id, name: vendor.name, vendorName: vendor.name };
      followUp.vendors.push(record);
    }
    return record;
  }

  _chaserResultRow({ vendor, channel, outcome }) {
    return {
      vendorId: vendor.id || null,
      vendorName: vendor.name || null,
      channel,
      status: outcome.status,
      success: outcome.success,
      messageId: outcome.messageId || null,
      error: outcome.error || null,
    };
  }

  approvePurchaseOrder(rfqNumber, vendorId, vendorName, totalAmount, approverNotes = '', approverEmail = null) {
    const rfq = this.rfqs.find((r) => r.rfqNumber === rfqNumber || r.id === rfqNumber);
    if (!rfq) return null;

    const poNumber = rfq.poNumber || (`PO-2026-` + (rfqNumber || '').replace('RFQ-2026-', ''));
    const issueDate = rfq.poIssueDate || new Date().toISOString().substring(0, 10);

    // Prevent duplicate PPO submission if already finalised
    if (rfq.status === 'PO Generated' && rfq.poFinalised) {
      return {
        success: true,
        alreadyFinalised: true,
        poNumber,
        rfqNumber,
        vendorId: rfq.awardedVendorId || vendorId || null,
        vendorName: rfq.awardedVendor || vendorName,
        totalAmount: rfq.awardedAmount || totalAmount,
        issueDate,
        lineItems: (rfq.extractedEntities || []).map((ent) => ({
          description: ent.itemName,
          quantity: ent.quantity,
          unit: ent.unit,
        })),
        shaSignature: rfq.poShaSignature || '',
      };
    }

    rfq.status = 'PO Generated';
    rfq.awardedVendorId = vendorId || null;
    rfq.awardedVendor = vendorName;
    rfq.awardedAmount = totalAmount;
    rfq.poNumber = poNumber;
    rfq.poIssueDate = issueDate;
    rfq.poFinalised = true;

    // Update quotes status in rfq.quotes
    if (Array.isArray(rfq.quotes)) {
      rfq.quotes = rfq.quotes.map((q) => {
        const isAwarded = (vendorId && q.vendorId === vendorId) ||
          (vendorName && q.vendorName && q.vendorName.toLowerCase().trim() === vendorName.toLowerCase().trim());
        return {
          ...q,
          status: isAwarded ? 'Awarded' : (q.status || 'Submitted'),
          awarded: isAwarded,
        };
      });
    }

    const auditRecord = this.addAuditLog({
      userEmail: approverEmail || (this.activeBuyerAccount ? this.activeBuyerAccount.corporateEmail : SYSTEM_ACTOR_EMAIL),
      action: `Formally approved & sealed Pre-Purchase Order ${poNumber} awarded to ${vendorName} (₹${Number(totalAmount).toLocaleString()}). Notes: ${approverNotes}`,
      rfqNumber,
    });
    rfq.poShaSignature = auditRecord.shaSignature;
    this._persistRFQ(rfq);

    // Notify the buyer of PO generation / award
    this.notifyBuyer(rfq.buyerAccountId || approverEmail, {
      kind: 'po_approved',
      title: `Pre-PO Approved — ${rfq.rfqNumber}`,
      message: `Pre-Purchase order ${poNumber} awarded to ${vendorName} (₹${Number(totalAmount).toLocaleString()}).`,
      meta: { poNumber, rfqNumber: rfq.rfqNumber, vendorId, vendorName, totalAmount },
    });

    // Notify the awarded vendor
    if (vendorId) {
      const vendorNotification = this._buildNotification({
        recipientType: 'vendor',
        recipientId: vendorId,
        kind: 'po_awarded',
        rfq,
        title: `Pre-Purchase Order Awarded — ${rfq.rfqNumber}`,
        message: `Congratulations! ${rfq.buyerAccountName || 'The buyer'} has approved and awarded pre-purchase order ${poNumber} to you.`,
        meta: { poNumber, rfqNumber: rfq.rfqNumber, totalAmount },
      });
      this.notifications.unshift(vendorNotification);
      this._persistNotification(vendorNotification);
    }

    return {
      success: true,
      poNumber,
      rfqNumber,
      vendorId: vendorId || null,
      vendorName,
      totalAmount,
      issueDate,
      // Real RFQ line items, not a hardcoded pump description — the PO
      // document should reflect what was actually procured.
      lineItems: (rfq.extractedEntities || []).map((ent) => ({
        description: ent.itemName,
        quantity: ent.quantity,
        unit: ent.unit,
      })),
      shaSignature: auditRecord.shaSignature,
    };
  }

  async approvePurchaseOrderDurably(rfqNumber, vendorId, vendorName, totalAmount, approverNotes = '', approverEmail = null) {
    return purchaseOrderService.approvePurchaseOrderDurably(
      this,
      rfqNumber,
      vendorId,
      vendorName,
      totalAmount,
      approverNotes,
      approverEmail
    );
  }

  // ==========================================
  // 14. UNIFIED BOOTSTRAP DATA
  // ==========================================
  /**
   * Reference data the app needs to start up.
   * RFQs and AI Bot feed events are deliberately NOT here. This endpoint is anonymous,
   * and returning global arrays from it leaks one buyer's data onto another buyer's
   * dashboard. RFQs are fetched from GET /api/rfqs and follow-up alerts from
   * GET /api/ai-feed, which are both authenticated and org-scoped.
   *
   * `vendors` is capped: the real marketplace vendor directory reached 80k+
   * rows (a bulk Vendor Master import), and shipping all of them on every
   * single page load — anonymous or not — crashed the browser tab. Real
   * per-vendor lookups (GET /api/vendors, the paginated "All Vendors" invite
   * flow) are unaffected; only this anonymous startup payload is capped.
   * `sessionEmail`, when given, guarantees the caller's own vendor record is
   * present even if it falls outside the cap, since several screens resolve
   * "my own vendor" purely from this list (billing, opportunity feed).
   */
  async getBootstrapData(scopedBuyerId = null, sessionEmail = null) {
    const MAX_BOOTSTRAP_VENDORS = 500;
    let vendors;
    let vendorsTotal;
    const readBootstrapVendors = async (operation, read) => {
      try {
        return await read();
      } catch (error) {
        logger.error('Configured vendor read failed while building bootstrap data', {
          error,
          operation,
          buyerScopePresent: Boolean(scopedBuyerId),
          sessionEmailPresent: Boolean(sessionEmail),
        }, 'STORE_SERVICE');
        throw error;
      }
    };

    // The common case (no buyer scoping — anonymous, vendor, CM, or admin
    // bootstrap) is answered straight from Postgres with LIMIT, the same way
    // the paginated vendors endpoint is: this used to call this.getVendors(),
    // which re-syncs (fetches + re-serializes) every row in the table on
    // every call. At 500 vendors that was unnoticeable; once the table
    // reached 80k+ (a bulk Vendor Master import), it meant every single page
    // load / login / refreshFromDB() call across the whole app re-fetched
    // the entire vendor table just to keep the first 500 — the same
    // performance disaster the CM's "Load more" pagination hit, just
    // triggered by something as ordinary as loading the app.
    if (!scopedBuyerId && pool.hasStorage()) {
      if (this.isHydratedFromDB && Array.isArray(this.vendors) && this.vendors.length > 0) {
        vendors = this.vendors.slice(0, MAX_BOOTSTRAP_VENDORS);
        vendorsTotal = this.vendorsTotal || vendors.length;
      } else {
        const page = await readBootstrapVendors(
          'public-vendor-page',
          () => domainQueries.getVendorsPageFromDB({ limit: MAX_BOOTSTRAP_VENDORS, offset: 0, publicOnly: true, skipCount: true })
        );
        vendors = page.rows;
        vendorsTotal = page.total || (Array.isArray(this.vendors) ? this.vendors.length : 0);
      }
      if (sessionEmail) {
        const email = String(sessionEmail).toLowerCase();
        if (!vendors.some((v) => (v.email || '').toLowerCase() === email)) {
          const own = await readBootstrapVendors(
            'session-vendor-by-email',
            () => domainQueries.getVendorByEmailFromDB(email)
          );
          if (own) vendors = [own, ...vendors];
        }
      }
    } else if (scopedBuyerId && pool.hasStorage()) {
      const ownVendors = await readBootstrapVendors(
        'buyer-owned-vendor-page',
        () => sessionEmail
          ? domainQueries.getVendorsByBuyerFromDB(scopedBuyerId, MAX_BOOTSTRAP_VENDORS, sessionEmail)
          : domainQueries.getVendorsByBuyerFromDB(scopedBuyerId, MAX_BOOTSTRAP_VENDORS)
      );
      const remaining = Math.max(0, MAX_BOOTSTRAP_VENDORS - ownVendors.length);
      let publicRows = [];
      let publicTotal = 0;
      if (remaining > 0) {
        const publicPage = await readBootstrapVendors(
          'public-vendor-page-for-buyer',
          () => domainQueries.getVendorsPageFromDB({ limit: remaining, offset: 0, publicOnly: true, skipCount: true })
        );
        publicRows = publicPage.rows || [];
        publicTotal = publicPage.total || 0;
      }
      vendors = [...ownVendors, ...publicRows];
      vendorsTotal = ownVendors.length + publicTotal;
      if (sessionEmail) {
        const email = String(sessionEmail).toLowerCase();
        if (!vendors.some((v) => (v.email || '').toLowerCase() === email)) {
          const own = await readBootstrapVendors(
            'session-vendor-by-email',
            () => domainQueries.getVendorByEmailFromDB(email)
          );
          if (own) vendors = [own, ...vendors];
        }
      }
    } else {
      // No DB configured: the in-memory-only fallback, a small enough set
      // that the full in-memory path is fine. Same own-first-then-cap
      // shape the DB-backed branches above apply, since there's no SQL
      // LIMIT to lean on here.
      const allVendors = await this.getVendors(scopedBuyerId);
      vendorsTotal = allVendors.length;
      const candidateIds = new Set();
      if (Array.isArray(scopedBuyerId)) scopedBuyerId.forEach((id) => id && candidateIds.add(String(id).toLowerCase()));
      else if (scopedBuyerId) candidateIds.add(String(scopedBuyerId).toLowerCase());
      if (sessionEmail) candidateIds.add(String(sessionEmail).toLowerCase());

      const ownVendors = candidateIds.size > 0
        ? allVendors.filter((v) =>
            candidateIds.has(String(v.buyerId || '').toLowerCase()) ||
            candidateIds.has(String(v.buyerAccountId || '').toLowerCase()) ||
            candidateIds.has(String(v.buyerEmail || '').toLowerCase())
          )
        : [];
      const publicVendors = candidateIds.size > 0
        ? allVendors.filter((v) =>
            !candidateIds.has(String(v.buyerId || '').toLowerCase()) &&
            !candidateIds.has(String(v.buyerAccountId || '').toLowerCase()) &&
            !candidateIds.has(String(v.buyerEmail || '').toLowerCase())
          )
        : allVendors;
      vendors = [...ownVendors, ...publicVendors].slice(0, MAX_BOOTSTRAP_VENDORS);
      if (sessionEmail) {
        const email = String(sessionEmail).toLowerCase();
        if (!vendors.some((v) => (v.email || '').toLowerCase() === email)) {
          const own = allVendors.find((v) => (v.email || '').toLowerCase() === email);
          if (own) vendors = [own, ...vendors];
        }
      }
    }

    let scopedCatalogue = [];
    if (sessionEmail) {
      const email = String(sessionEmail).toLowerCase();
      const ownVendor = (this.vendors || []).find((v) => (v.email || '').toLowerCase() === email);
      if (ownVendor) {
        scopedCatalogue = (this.vendorCatalogue || []).filter((p) => p.vendorId === ownVendor.id);
      }
    } else if (!scopedBuyerId) {
      scopedCatalogue = (this.vendorCatalogue || []).slice(0, 50);
    }

    let buyerAccounts = this.buyerAccounts;
    let activeBuyerAccount = this.activeBuyerAccount;
    if ((!Array.isArray(buyerAccounts) || buyerAccounts.length === 0) && pool.hasStorage()) {
      try {
        const buyerAccountsResult = await domainQueries.getBuyerAccountsFromDB(500);
        buyerAccounts = buyerAccountsResult.accounts || [];
        activeBuyerAccount = buyerAccounts.find((a) => a.id === buyerAccountsResult.activeId) || buyerAccounts[0] || null;
        this.buyerAccounts = buyerAccounts;
        this.activeBuyerAccount = activeBuyerAccount;
      } catch (err) {
        buyerAccounts = this.buyerAccounts || [];
      }
    }

    let evaluations = this.evaluations;
    if ((!Array.isArray(evaluations) || evaluations.length === 0) && pool.hasStorage()) {
      try {
        evaluations = await domainQueries.getEvaluationsFromDB(50);
        this.evaluations = evaluations || [];
      } catch (err) {
        evaluations = this.evaluations || [];
      }
    }

    let auditLogs = this.auditLogs;
    if ((!Array.isArray(auditLogs) || auditLogs.length === 0) && pool.hasStorage()) {
      try {
        auditLogs = await domainQueries.getAuditLogsFromDB(100);
        this.auditLogs = auditLogs || [];
      } catch (err) {
        auditLogs = this.auditLogs || [];
      }
    }

    return {
      buyerAccounts: (buyerAccounts || []).slice(0, 500),
      activeBuyerAccount,
      vendors,
      vendorsTotal,
      evaluations: (evaluations || []).slice(0, 50),
      auditLogs: (auditLogs || []).slice(0, 100),
      aiFeed: [],
      systemConfig: this.getSystemConfig(),
      azureHealth: this.getAzureHealth(),
      vendorCatalogue: scopedCatalogue,
    };
  }

}

// Global Singleton Instance for Node.js process
const storeService = new StoreService();

module.exports = storeService;

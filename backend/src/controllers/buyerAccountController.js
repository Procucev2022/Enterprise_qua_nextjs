const crypto = require('crypto');
const storeService = require('../services/storeService');
const buyerAccountResolver = require('../services/buyerAccountResolver');
const zohoPaymentService = require('../services/zohoPaymentService');
const zohoReconciliationService = require('../services/zohoReconciliationService');
const { generateReceiptPdf } = require('../services/invoiceService');
const { logger } = require('../services/loggerService');
const {
  ZOHO_CONFIG,
  computeZohoBuyerPlanAmount,
  BUYER_SUBSCRIPTION_PLANS,
  getSubscriptionPricingConfig,
  PERSISTENCE_MESSAGES,
  DOSSIER_MESSAGES,
  formatMessage,
} = require('../config/constants');
const identityQueries = require('../db/identityQueries');
const domainQueries = require('../db/domainQueries');
const buyerProfileQueries = require('../db/buyerProfileQueries');
const vendorIngestionQueries = require('../db/vendorIngestionQueries');
const pool = require('../db/pool');
const { VALIDATION_SCHEMAS, validatePayload, derivePanFromGstin } = require('../config/validationSchemas');

/** A stored number, or null when the record holds no usable value. */
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Trimmed text from a source field, or '' when it is absent. */
function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The most frequent non-empty value in a list, ties going to the value seen first.
 * Used for category values read from the buyer's own PO lines.
 */
function mostFrequent(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The buyer's real credit balance, or null when the record does not hold one.
 * Callers must not substitute a number for null unless an account exists on record.
 */
function knownCreditBalance(buyer) {
  if (!buyer) return null;
  const balance = numberOrNull(buyer.creditBalance) ??
                  numberOrNull(buyer.remainingFreeRFQs) ??
                  numberOrNull(buyer.remainingFreeCredits) ??
                  numberOrNull(buyer.available_credits) ??
                  numberOrNull(buyer.credit_balance) ??
                  numberOrNull(buyer.freeRFQsRemaining);
  return balance;
}

/**
 * Robustly resolve a buyer account from memory, database, or buyer profile.
 * Supports resolution by account id, user id, buyer id, organization id, or corporate email.
 */
async function resolveBuyerAccount(identifier, req = null) {
  if (!identifier) return null;
  const domainQueries = require('../db/domainQueries');
  const target = String(identifier).trim().toLowerCase();

  // 1. Check in-memory store
  let buyer = storeService.getBuyerAccounts().find(
    (b) => b.id === identifier ||
           b.userId === identifier ||
           b.buyerId === identifier ||
           b.organizationId === identifier ||
           (b.corporateEmail && b.corporateEmail.toLowerCase() === target)
  );

  // 2. If buyer role session and still not found, try session email
  if (!buyer && req && req.user && req.user.role === 'buyer' && req.user.email) {
    buyer = await storeService.getBuyerAccountByEmail(req.user.email);
  }

  // 3. Check database (supports matching on id, corporate_email, or raw JSON fields)
  if (!buyer && pool.hasStorage()) {
    try {
      buyer = await domainQueries.getBuyerAccountByIdFromDB(identifier);
      if (!buyer && identifier.includes('@')) {
        buyer = await domainQueries.getBuyerAccountByEmailFromDB(identifier);
      }
      if (!buyer) {
        const queryRes = await pool.query(
          `SELECT raw FROM buyer_accounts 
           WHERE raw->>'userId' = $1 
              OR raw->>'user_id' = $1 
              OR raw->>'buyerId' = $1 
              OR raw->>'organizationId' = $1 
              OR lower(corporate_email) = lower($1)
           ORDER BY is_active DESC, updated_at DESC LIMIT 1`,
          [identifier],
          { d1: true, useCache: true, tag: 'buyer_accounts', ttlMs: 60000 }
        );
        if (queryRes?.rows?.[0]?.raw) {
          const raw = queryRes.rows[0].raw;
          buyer = typeof raw === 'string' ? JSON.parse(raw) : raw;
        }
      }
    } catch {
      buyer = null;
    }
  }

  // 4. Check buyer profile identity tables if still not found
  if (!buyer && pool.hasStorage()) {
    try {
      const buyerProfileQueries = require('../db/buyerProfileQueries');
      const lookup = await buyerProfileQueries.findProfileByIdentifier({
        userId: identifier,
        email: identifier.includes('@') ? identifier : undefined,
        organizationId: identifier,
      });
      if (lookup?.found && lookup.profile) {
        const p = lookup.profile;
        const mirrorUser = {
          role: 'buyer',
          email: p.contactEmail || p.email,
          sub: p.userId || identifier,
          id: p.userId || identifier,
          orgId: p.organizationId,
        };
        buyer = await storeService.ensureBuyerAccountForUser(mirrorUser);
      }
    } catch (err) {
      logger.warn('Buyer profile fallback lookup failed in resolveBuyerAccount', { error: err.message, identifier }, 'BUYER_ACCOUNT_CONTROLLER');
    }
  }

  // Sync into memory cache if found
  if (buyer) {
    const idx = storeService.buyerAccounts.findIndex((a) => a.id === buyer.id);
    if (idx >= 0) {
      storeService.buyerAccounts[idx] = buyer;
    } else {
      storeService.buyerAccounts.unshift(buyer);
    }
  }

  return buyer || null;
}

/**
 * Buyer accounts are buyer-side org records: only a buyer (or an admin acting
 * on their behalf) has any business creating, editing, deleting or switching
 * the active one, or triggering the buyer-only historical-purchase ingestion.
 * Vendors and category managers browse buyer accounts read-only and must not
 * be able to mutate them.
 *
 * This is deliberately a role-level gate and NOT a per-record ownership check
 * like vendorController's assertVendorOwnership: any buyer/admin can still
 * mutate any buyer account record, not just their own — there is no
 * "this buyer account belongs to this specific buyer" concept enforced here.
 * (rfqController.createRFQ *does* resolve the requesting buyer's own account
 * from req.user — via storeService.getBuyerAccountByEmail — to attribute new
 * RFQs correctly; that's a separate, already-solved concern from the
 * buyer-account-record ownership gap this comment is about.)
 */
function assertCategoryManagerOrAdmin(req, res) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  if (user.role === 'category_manager' || user.role === 'admin') return true;
  res.status(403).json({ success: false, error: 'Only administrators and category managers can perform this operation.' });
  return false;
}

function assertCategoryManagerOrBuyer(req, res, targetBuyer = null) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  if (user.role === 'category_manager' || user.role === 'admin') return true;
  if (user.role === 'buyer') {
    if (!targetBuyer) return true;
    const buyerEmail = targetBuyer.corporateEmail || targetBuyer.email;
    const isOwner =
      (user.email && buyerEmail && user.email.toLowerCase() === buyerEmail.toLowerCase()) ||
      (user.buyerAccountId && user.buyerAccountId === targetBuyer.id) ||
      (user.orgId && user.orgId === targetBuyer.id) ||
      (user.organizationId && user.organizationId === targetBuyer.id) ||
      (targetBuyer.userId && targetBuyer.userId === user.id) ||
      (targetBuyer.id === user.id);
    if (isOwner) return true;
  }
  res.status(403).json({ success: false, error: 'You do not have permission to access buyer profile dossier.' });
  return false;
}

function assertBuyerAccountRole(req, res) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return false;
  }
  if (user.role === 'buyer' || user.role === 'admin') return true;
  logger.warn('Rejected buyer account mutation from a non-buyer role', { role: user.role }, 'BUYER_ACCOUNT_CONTROLLER');
  res.status(403).json({ success: false, error: 'You do not have permission to modify buyer accounts.' });
  return false;
}

async function assertBuyerAccountAccess(req, res, id) {
  if (!assertBuyerAccountRole(req, res)) return false;
  const domainQueries = require('../db/domainQueries');
  const buyer = pool.hasStorage()
    ? (await domainQueries.getBuyerAccountByIdFromDB(id) || await resolveBuyerAccount(id, req))
    : await resolveBuyerAccount(id, req);
  if (!buyer) {
    res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    return false;
  }
  if (req.user.role === 'admin') return true;

  const identityValues = [
    req.user.email,
    req.user.id,
    req.user.sub,
    req.user.orgId,
    req.user.organizationId,
    req.user.buyerAccountId,
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  const ownerValues = [buyer.corporateEmail, buyer.email, buyer.userId, buyer.organizationId, buyer.id]
    .filter(Boolean).map((value) => String(value).toLowerCase());
  if (identityValues.some((value) => ownerValues.includes(value))) return true;

  logger.warn('Rejected buyer account mutation outside the caller account scope', {
    id,
    role: req.user.role,
  }, 'BUYER_ACCOUNT_CONTROLLER');
  res.status(403).json({ success: false, error: 'You do not have permission to modify this buyer account.' });
  return false;
}

async function getBuyerAccounts(req, res, next) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!['admin', 'category_manager', 'buyer'].includes(user.role)) {
      logger.warn('Rejected buyer account listing from a non-buyer role', { role: user.role }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(403).json({ success: false, error: 'You do not have permission to access buyer accounts.' });
    }
    if (!pool.hasStorage()) {
      logger.error('Buyer account listing refused: database storage is not configured', {}, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(503).json({
        success: false,
        code: 'PERSISTENCE_UNAVAILABLE',
        retryable: true,
        error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
      });
    }
    logger.info('Fetching buyer accounts', {}, 'BUYER_ACCOUNT_CONTROLLER');
    const parsedLimit = req.query && req.query.limit ? Number(req.query.limit) : null;
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
    let accounts;
    if (user.role === 'buyer') {
      const account = await domainQueries.getBuyerAccountByEmailFromDB(user.email);
      accounts = account ? [account] : [];
    } else {
      const persisted = await domainQueries.getBuyerAccountsFromDB(limit);
      accounts = persisted.accounts;
    }
    res.json({ success: true, source: 'persisted', data: accounts });
  } catch (err) {
    if (pool.hasStorage()) {
      err.status = 503;
      err.retryable = true;
    }
    logger.error('Error fetching buyer accounts', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

/**
 * The signed-in buyer's own account, read from the shared identity schema.
 *
 * Previously returned `buyerAccounts[0]` from a seeded array on an anonymous
 * route, so every session was told it belonged to the same fabricated company.
 * There is no fallback now: if the directory cannot answer, that is reported
 * rather than papered over with invented data.
 */
async function getActiveAccount(req, res, next) {
  try {
    logger.info('Resolving active buyer account from the identity schema', {}, 'BUYER_ACCOUNT_CONTROLLER');
    const resolved = await buyerAccountResolver.resolveActiveBuyerAccount(req.user);

    if (!resolved.ok) {
      return res.status(resolved.status).json({ success: false, error: resolved.error });
    }
    return res.json({ success: true, source: 'identity_database', data: resolved.account });
  } catch (err) {
    logger.error('Error resolving active buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    return next(err);
  }
}

async function createBuyerAccount(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const body = req.body;
    if (!body.organizationName || !body.corporateEmail) {
      logger.warn('Failed to create buyer account: Missing organizationName or corporateEmail', { body }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(400).json({ success: false, error: 'organizationName and corporateEmail are required.' });
    }
    const normalizedEmail = String(body.corporateEmail).trim().toLowerCase();
    const sessionUserId = req.user && (req.user.sub || req.user.id);
    const sessionOrgId = req.user && (req.user.orgId || req.user.organizationId);
    const sessionEmail = String((req.user && req.user.email) || '').trim().toLowerCase();
    const isSelfRegistrationMirrorSync = !body.id && Boolean(sessionUserId) && sessionEmail === normalizedEmail;
    const existing = isSelfRegistrationMirrorSync
      ? await storeService.getBuyerAccountByEmail(normalizedEmail)
      : null;
    if (existing) {
      const sanitizedUpdates = sanitizeBuyerAccountUpdates(body, res);
      if (!sanitizedUpdates) return;
      logger.info(`Merging buyer account update into existing mirror: ${body.organizationName}`, { id: existing.id, email: normalizedEmail }, 'BUYER_ACCOUNT_CONTROLLER');
      const mergePayload = {
        ...sanitizedUpdates,
        userId: existing.userId || sessionUserId || undefined,
        organizationId: sanitizedUpdates.organizationId || existing.organizationId || sessionOrgId || null,
      };
      const merged =
        (existing.id ? await storeService.updateBuyerAccountDurably(existing.id, mergePayload) : null) ||
        (await storeService.updateBuyerAccountDurably(normalizedEmail, mergePayload));
      if (merged) {
        await syncOrganizationFromBuyerAccount(merged, sessionUserId, sessionEmail || normalizedEmail);
        return res.status(201).json({ success: true, data: merged });
      }
    }
    logger.info(`Creating new buyer account: ${body.organizationName}`, { organizationName: body.organizationName, email: body.corporateEmail }, 'BUYER_ACCOUNT_CONTROLLER');
    const createPayload = isSelfRegistrationMirrorSync
      ? {
          ...body,
          userId: body.userId || sessionUserId,
          organizationId: body.organizationId || sessionOrgId || null,
        }
      : body;
    let created;
    try {
      created = await storeService.addBuyerAccountDurably(createPayload);
    } catch (createErr) {
      if (createErr?.statusCode === 409 && isSelfRegistrationMirrorSync) {
        const sanitizedUpdates = sanitizeBuyerAccountUpdates(createPayload, res);
        if (!sanitizedUpdates) return;
        const merged = await storeService.updateBuyerAccountDurably(normalizedEmail, sanitizedUpdates);
        if (merged) {
          await syncOrganizationFromBuyerAccount(merged, sessionUserId, sessionEmail || normalizedEmail);
          return res.status(201).json({ success: true, data: merged });
        }
      }
      throw createErr;
    }
    await syncOrganizationFromBuyerAccount(created, sessionUserId, sessionEmail || normalizedEmail);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

// 'free_trial' is the only subscriptionPlan value this generic endpoint may
// set directly (the free/reset-to-starter path subscription-center.tsx's
// handleResetTrial already relies on). version_1/2/3 are real, paid tiers
// that must only ever be granted by activateBuyerSubscriptionFromPayment
// after a genuine Zoho payment (createSubscriptionPaymentLink ->
// webhook/reconciliation) — this endpoint previously accepted any
// subscriptionPlan value with no check at all, letting any buyer/admin
// grant a paid plan to any buyer account (not even scoped to their own)
// for free.
function sanitizeBuyerAccountUpdates(updates, res) {
  if (!Object.prototype.hasOwnProperty.call(updates, 'subscriptionPlan')) return updates;
  if (updates.subscriptionPlan === 'free_trial') return updates;
  res.status(400).json({
    success: false,
    error: 'subscriptionPlan can only be reset to free_trial here — paid plans can only be granted via a completed Zoho payment.',
  });
  return null;
}

/**
 * Keep the canonical `organization` row aligned whenever statutory tax or
 * address fields are saved through the buyer-account APIs.
 */
async function syncOrganizationFromBuyerAccount(account, userId = null, actorEmail = null) {
  const organizationId = account && account.organizationId;
  if (!pool.hasStorage() || !organizationId || typeof buyerProfileQueries.updateProfile !== 'function') {
    return;
  }
  const patch = {};
  if (account.organizationName) patch.companyName = account.organizationName;
  if (account.brandName) patch.brandName = account.brandName;
  if (account.contactPerson) patch.contactName = account.contactPerson;
  if (account.contactDesignation) patch.contactDesignation = account.contactDesignation;
  const street = account.street || account.streetAddress || account.address1 || account.address || account.registeredAddress || '';
  if (street) patch.street = street;
  if (account.city) patch.city = account.city;
  if (account.state) patch.state = account.state;
  const pincode = account.pincode || account.zip_code || account.zipCode || '';
  if (pincode) patch.pincode = pincode;
  if (account.country) patch.country = account.country;
  const gstin = (account.gstin || account.gstNumber || account.gst || '').trim().toUpperCase();
  if (gstin) patch.gstNumber = gstin;
  const pan = (account.pan || account.panNumber || '').trim().toUpperCase() || derivePanFromGstin(gstin);
  if (pan) patch.panNumber = pan;
  if (Object.keys(patch).length === 0) return;

  try {
    await buyerProfileQueries.updateProfile({
      organizationId,
      userId: userId || account.userId || null,
      patch,
      actor: actorEmail || account.corporateEmail || 'buyer-account-sync',
    });
  } catch (err) {
    logger.warn('Failed to synchronize organization profile from buyer account write', {
      error: err.message,
      organizationId,
      accountId: account.id,
    }, 'BUYER_ACCOUNT_CONTROLLER');
  }
}

async function updateBuyerAccount(req, res, next) {
  try {
    const { id } = req.params;
    if (!await assertBuyerAccountAccess(req, res, id)) return;
    const updates = sanitizeBuyerAccountUpdates(req.body, res);
    if (!updates) return;
    logger.info(`Updating buyer account ${id}`, { id, updatedFields: Object.keys(updates || {}) }, 'BUYER_ACCOUNT_CONTROLLER');
    const updated = await storeService.updateBuyerAccountDurably(id, updates);
    if (!updated) {
      logger.warn(`Buyer account not found for update: ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    await syncOrganizationFromBuyerAccount(updated, req.user && (req.user.sub || req.user.id), req.user && req.user.email);
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('Error updating buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

async function deleteBuyerAccount(req, res, next) {
  try {
    const { id } = req.params;
    if (!await assertBuyerAccountAccess(req, res, id)) return;
    logger.info(`Deleting buyer account ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
    const deletion = await storeService.deleteBuyerAccountDurably(id);
    if (!deletion?.deleted) {
      logger.warn(`Buyer account not found for deletion: ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({
      success: true,
      message: `Buyer account ${id} deleted successfully.`,
      data: { activeAccount: deletion.activeAccount || null },
    });
  } catch (err) {
    logger.error('Error deleting buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

async function setActiveAccount(req, res, next) {
  try {
    const { id } = req.params;
    if (!await assertBuyerAccountAccess(req, res, id)) return;
    logger.info(`Setting active buyer account to ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
    const active = await storeService.alignActiveBuyerAccountDurably(id);
    if (!active) {
      logger.warn(`Buyer account not found to set active: ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({ success: true, data: active });
  } catch (err) {
    logger.error('Error setting active buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

// 'free_trial' is free/instant (see the frontend's handleSubscribe) and never
// reaches Zoho — only the three paid tiers are real, payable plans.
const ZOHO_PAYABLE_BUYER_PLANS = ['version_1', 'version_2', 'version_3'];

async function createSubscriptionPaymentLink(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { id } = req.params;
    const { plan, billingDuration = '12_months', duration } = req.body || {};
    const normalizedDuration = (billingDuration || duration) === '6_months' ? '6_months' : '12_months';
    if (!ZOHO_PAYABLE_BUYER_PLANS.includes(plan)) {
      return res.status(400).json({ success: false, error: `plan must be one of: ${ZOHO_PAYABLE_BUYER_PLANS.join(', ')}.` });
    }

    // The frontend's activeBuyerAccount comes from the identity-DB-backed
    // GET /active (organisation uuid space) — a different id space from the
    // legacy storeService.buyerAccounts records this feature's subscription
    // fields actually live on (same mismatch the whole 2026-09-04
    // activeBuyerAccount investigation was about). Resolving by the caller's
    // own session email — not trusting :id to already be a
    // storeService.buyerAccounts id — is what makes both id spaces work here;
    // a real buyer with no legacy record yet (registered before this feature,
    // or via the identity DB only) gets one created on first use rather than
    // 404ing. req.user is guaranteed present here — assertBuyerAccountRole
    // above already rejected the request otherwise.
    let existing = await storeService.getBuyerAccountByEmail(req.user.email);
    if (!existing && req.user.email) {
      const buyerData = {
        organizationName: req.user.orgName || req.user.email,
        corporateEmail: req.user.email,
        mobileNumber: '',
      };
      try {
        existing = await storeService.addBuyerAccountDurably(buyerData);
      } catch (persistError) {
        // Two first-time payment requests can race to create the same mirror.
        // Re-read the winner after a uniqueness conflict so the second request
        // can continue without creating a duplicate or a false failure.
        if (persistError.statusCode === 409) {
          existing = await storeService.getBuyerAccountByEmail(req.user.email);
        } else {
          throw persistError;
        }
      }
    }
    if (!existing) {
      return res.status(404).json({ success: false, error: `Buyer account with ID ${id} not found.` });
    }
    if (!existing.corporateEmail) {
      return res.status(400).json({ success: false, error: 'Buyer account has no email on file to create a payment link for.' });
    }

    // The legacy storeService.buyerAccounts record (`existing`) often has no
    // mobileNumber — e.g. it's auto-created above with '' on first payment
    // attempt, before the buyer ever fills in a profile mobile field. Login
    // itself requires email+mobile+password though, so the identity DB
    // always has a real phone for this user; Zoho's paymentlinks API 400s
    // ("Invalid data provided") on an empty phone, so fall back to the
    // identity record rather than sending a blank value.
    let phone = existing.mobileNumber || '';
    if (!phone) {
      let identityUser = null;
      try {
        identityUser = await identityQueries.findUserByEmail(existing.corporateEmail);
      } catch (identityLookupError) {
        logger.error(
          'Identity profile lookup failed while resolving buyer payment contact phone; using the missing-phone fallback',
          identityLookupError,
          'BUYER_ACCOUNT_CONTROLLER'
        );
      }
      phone = (identityUser && identityUser.mobile) || '';
    }
    if (!phone) {
      return res.status(400).json({ success: false, error: 'No mobile number on file for this account. Please update your profile with a mobile number before subscribing.' });
    }


    const amount = computeZohoBuyerPlanAmount(plan, normalizedDuration);
    const durationSuffix = normalizedDuration === '6_months' ? ' (6 Months)' : ' (12 Months)';
    const planLabel = ((BUYER_SUBSCRIPTION_PLANS.find((p) => p.id === plan) || {}).name || plan) + durationSuffix;
    // Generated before the Zoho call (not after, like the payment link record's
    // id used to be) so it can be embedded in returnUrl — Zoho's hosted
    // checkout redirects back to this exact URL regardless of whether the
    // buyer actually paid or cancelled, so a hardcoded `?payment=success`
    // here would lie about a real cancellation. The frontend instead looks
    // this id up against GET .../payment-links on return to show the link's
    // real status (PAID/CANCELED/EXPIRED/still CREATED).
    const linkId = `pl-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const returnBase = String(ZOHO_CONFIG.RETURN_URL_BASE || '').replace(/\/+$/, '');
    const returnUrl = `${returnBase}/buyer/subscription-center?linkId=${linkId}`;

    const result = await zohoPaymentService.createPaymentLink({
      planId: plan,
      planLabel,
      amountInr: amount,
      email: existing.corporateEmail,
      phone,
      returnUrl,
    });

    const link = await storeService.createPaymentLinkRecordDurably({
      id: linkId,
      zohoPaymentLinkId: result.zohoPaymentLinkId,
      buyerAccountId: existing.id,
      payerType: 'buyer',
      planId: plan,
      billingDuration: normalizedDuration,
      amount,
      paymentUrl: result.paymentUrl,
      status: result.status || 'CREATED',
      rawResponse: result.rawResponse,
    });

    logger.info(`Created Zoho payment link for buyer account ${id} (${plan}, ${normalizedDuration})`, { id, plan, billingDuration: normalizedDuration, zohoPaymentLinkId: link.zohoPaymentLinkId }, 'BUYER_ACCOUNT_CONTROLLER');
    res.json({ success: true, data: { paymentUrl: link.paymentUrl, paymentLinkId: link.id, status: link.status } });
  } catch (err) {
    logger.error(`Error creating Zoho payment link for buyer account ${req.params.id}`, err, 'BUYER_ACCOUNT_CONTROLLER');
    const paymentLinkPersistenceFailed = err && err.code === 'PAYMENT_LINK_PERSISTENCE_UNAVAILABLE';
    const persistenceUnavailable = err && err.statusCode === 503;
    res.status(persistenceUnavailable ? 503 : 502).json({
      success: false,
      error: paymentLinkPersistenceFailed
        ? PERSISTENCE_MESSAGES.PAYMENT_LINK_TRACKING_FAILED
        : persistenceUnavailable
          ? 'Your buyer account could not be saved. No payment link was created; please retry shortly.'
          : 'Unable to create a payment link right now. Please try again shortly.',
    });
  }
}

/**
 * The caller's own billing history — resolved by session email, same
 * reasoning as createSubscriptionPaymentLink above (never trust :id to
 * already be the right storeService.buyerAccounts record). No auto-create
 * here, unlike the payment-link endpoint: a buyer with no legacy billing
 * record yet just sees an empty list.
 *
 * Any of the caller's own links still sitting in a non-terminal status get
 * live re-checked against Zoho before responding (zohoReconciliationService's
 * on-demand path — see its docstring for why: the sandbox webhook has proven
 * unreliable, and a buyer actively opening this list to check "did my
 * payment go through" should get a real answer immediately, not one that
 * depends on a webhook that may never arrive or the 10-minute interval poll).
 */
async function getPaymentLinks(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const existing = await storeService.getBuyerAccountByEmail(req.user.email);
    if (!existing) {
      return res.json({ success: true, data: [] });
    }
    let links = await storeService.getPaymentLinksForBuyer(existing.id);
    const reconciled = await zohoReconciliationService.reconcilePendingLinks(links);
    if (reconciled > 0) {
      links = await storeService.getPaymentLinksForBuyer(existing.id);
    }
    res.json({ success: true, data: links });
  } catch (err) {
    logger.error(`Error fetching payment links for buyer account ${req.params.id}`, err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

/** Stream a PDF receipt for one of the caller's own past payments. */
async function downloadInvoice(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { linkId } = req.params;
    const existing = await storeService.getBuyerAccountByEmail(req.user.email);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'No buyer account found for this session.' });
    }

    const link = await storeService.getPaymentLinkById(linkId);
    if (!link || link.payerType !== 'buyer' || link.buyerAccountId !== existing.id) {
      return res.status(404).json({ success: false, error: `Payment ${linkId} not found for this buyer account.` });
    }

    const planLabel = (BUYER_SUBSCRIPTION_PLANS.find((p) => p.id === link.planId) || {}).name || link.planId;
    const pdf = await generateReceiptPdf({
      link,
      payerName: existing.organizationName || existing.corporateEmail,
      payerEmail: existing.corporateEmail,
      planLabel,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${link.id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error(`Error generating invoice for buyer account ${req.params.id}`, err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

async function ingestHistoricalData(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { period, vendorRecords } = req.body;
    if (!period) {
      logger.warn('Failed to ingest historical data: Missing period', { body: req.body }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(400).json({ success: false, error: 'period is required.' });
    }
    logger.info(`Ingesting historical purchase data for period: ${period}`, { period }, 'BUYER_ACCOUNT_CONTROLLER');
    const requestingBuyerAccount =
      (await storeService.ensureBuyerAccountForUser?.(req.user)) ||
      (await storeService.getBuyerAccountByEmail(req.user.email));
    const result = await storeService.processHistoricalPurchaseData(period, vendorRecords || [], requestingBuyerAccount);
    if (result?.success !== false && (result?.importedCount > 0 || (Array.isArray(vendorRecords) && vendorRecords.length > 0))) {
      const organizationId = req.user?.orgId || req.user?.organizationId || requestingBuyerAccount?.organizationId || null;
      if (organizationId && typeof vendorIngestionQueries.markVendorMasterUploaded === 'function') {
        await vendorIngestionQueries.markVendorMasterUploaded(organizationId).catch((markErr) => {
          logger.warn('Failed to mark organization vendorMasterUploaded after historical ingestion', { error: markErr, organizationId }, 'BUYER_ACCOUNT_CONTROLLER');
        });
      }
    }
    res.json(result);
  } catch (err) {
    logger.error('Error ingesting historical purchase data', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

function aiCrossMatch(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { vendors = [], poLineItems = [] } = req.body;
    logger.info(`Running AI Category Cross-Match API for ${vendors.length} vendors and ${poLineItems.length} POs`, {
      vendorCount: vendors.length,
      poCount: poLineItems.length,
    }, 'BUYER_ACCOUNT_CONTROLLER');

    const matchedVendors = vendors.map((v) => {
      const vName = (v.companyName || '').toLowerCase().trim();
      const vCode = (v.vendorCode || '').toLowerCase().trim();

      // An empty identifier on either side must never match: `'x'.includes('')`
      // is true, which would attach every PO line to every vendor.
      const matchingPOs = poLineItems.filter((po) => {
        const pVendor = cleanText(po.vendorIdentifier).toLowerCase();
        if (!pVendor) return false;
        return (
          (vName && (pVendor.includes(vName) || vName.includes(pVendor))) ||
          (vCode && pVendor.includes(vCode))
        );
      });

      const hasMatchingPOs = matchingPOs.length > 0;
      const items = matchingPOs.map((p) => p.itemName).filter(Boolean);
      const totalAmount = matchingPOs.reduce((acc, p) => acc + (Number(p.totalSpend) || 0), 0);

      // Category mappings come only from category fields on the buyer's own PO
      // lines. Item text is not classified by keyword, and no category is assumed.
      // If the PO lines carry no category, these stay empty.
      const firstSetMajor = hasMatchingPOs
        ? mostFrequent(matchingPOs.map((p) => cleanText(p.existingCategory)).filter(Boolean))
        : '';
      const secondSetMinors = hasMatchingPOs
        ? Array.from(new Set(matchingPOs.map((p) => cleanText(p.existingSubcategory)).filter(Boolean)))
        : [];

      const formattedTotal = totalAmount >= 10000000
        ? `₹${(totalAmount / 10000000).toFixed(2)} Cr`
        : totalAmount >= 100000
        ? `₹${(totalAmount / 100000).toFixed(2)} Lakh`
        : `₹${totalAmount.toLocaleString('en-IN')}`;

      return {
        id: v.id,
        vendorCode: v.vendorCode,
        companyName: v.companyName,
        email: v.email,
        contactPerson: v.contactPerson,
        phone: v.phone,
        address: v.address,
        gstNumber: v.gstNumber,
        vendorRatingScore: v.vendorRatingScore,
        hasPoHistory: hasMatchingPOs,
        categoriesMappedByBuyer: hasMatchingPOs,
        itemsSupplied: items,
        pastPoSpend: hasMatchingPOs
          ? `${formattedTotal} (${matchingPOs.length} POs)`
          : 'No PO History in Dump',
        poCount: matchingPOs.length,
        firstSetMajorCategory: firstSetMajor,
        secondSetMinorCategories: secondSetMinors,
        // No stored source for secondary majors exists in the PO dump, so none is assumed.
        secondSetSecondaryMajors: [],
      };
    });

    res.json({
      success: true,
      data: matchedVendors,
      totalMatched: matchedVendors.filter((v) => v.categoriesMappedByBuyer).length,
      totalUnmatched: matchedVendors.filter((v) => !v.categoriesMappedByBuyer).length,
    });
  } catch (err) {
    logger.error('Error running AI Category Cross-Match API', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}


async function getCreditHistory(req, res, next) {
  try {
    if (!assertCategoryManagerOrBuyer(req, res)) return;
    const { id } = req.params;
    const domainQueries = require('../db/domainQueries');

    const buyer = await resolveBuyerAccount(id, req);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    const remainingFree = numberOrNull(buyer.remainingFreeRFQs);
    const sourcingMode = buyer.sourcingMode || null;
    const subscriptionPlan = buyer.subscriptionPlan || null;

    const candidateIds = [
      buyer.id,
      buyer.userId,
      buyer.buyerId,
      buyer.organizationId,
      id,
      req.params?.id,
    ].filter(Boolean);

    let transactions = [];
    try {
      transactions = (await domainQueries.getBuyerCreditTransactionsFromDB(candidateIds, 200)) || [];
    } catch (dbErr) {
      logger.warn('[buyerAccountController] Failed to fetch buyer credit transactions from DB:', { error: dbErr?.message || dbErr }, 'BUYER_ACCOUNT_CONTROLLER');
    }

    // Reconcile buyer's RFQs:
    // If RFQs exist that do not have a recorded credit transaction, synthesize and persist them
    try {
      const rfqs = (await domainQueries.getRFQsFromDB(buyer.id, 1000)) || [];
      const existingRfqIds = new Set(
        transactions.map((t) => t.rfq_id || t.rfqId).filter(Boolean)
      );

      const missingRfqs = rfqs.filter((r) => r && r.id && !existingRfqIds.has(r.id));
      if (missingRfqs.length > 0) {
        for (const rfq of missingRfqs) {
          const rfqDate = rfq.createdAt || rfq.created_at || new Date().toISOString();
          const syntheticTx = {
            id: `ctx-rfq-${rfq.id}`,
            buyer_id: buyer.id,
            rfq_id: rfq.id,
            transaction_type: 'Credits Consumed',
            credit_source: rfq.sourcingMode ? String(rfq.sourcingMode).toUpperCase() : 'MODE_1',
            credits_added: 0,
            credits_consumed: 1,
            previous_balance: remainingFree || 0,
            updated_balance: remainingFree || 0,
            status: 'COMPLETED',
            description: `Credit consumed for RFQ ${rfq.rfqNumber || rfq.id}: ${rfq.title || rfq.category || 'Requisition'}`,
            idempotency_key: `rfq-credit-reconcile-${buyer.id}-${rfq.id}`,
            created_at: rfqDate,
          };
          transactions.push(syntheticTx);

          if (pool.hasStorage()) {
            pool.query(
              `INSERT INTO buyer_credit_transactions (
                 id, buyer_id, rfq_id, transaction_type, credit_source, credits_added, credits_consumed,
                 previous_balance, updated_balance, status, description, idempotency_key, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
               ON CONFLICT (id) DO NOTHING`,
              [
                syntheticTx.id,
                syntheticTx.buyer_id,
                syntheticTx.rfq_id,
                syntheticTx.transaction_type,
                syntheticTx.credit_source,
                0,
                1,
                syntheticTx.previous_balance,
                syntheticTx.updated_balance,
                syntheticTx.status,
                syntheticTx.description,
                syntheticTx.idempotency_key,
                syntheticTx.created_at,
              ],
              {
                d1: true,
                d1Text: `INSERT OR IGNORE INTO buyer_credit_transactions (
                  id, buyer_id, rfq_id, transaction_type, credit_source, credits_added, credits_consumed,
                  previous_balance, updated_balance, status, description, idempotency_key, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              }
            ).catch((err) => {
              logger.warn('[buyerAccountController] Failed to backfill credit transaction for RFQ:', { rfqId: rfq.id, error: err?.message }, 'BUYER_ACCOUNT_CONTROLLER');
            });
          }
        }
      }
    } catch (rfqErr) {
      logger.warn('[buyerAccountController] Failed to reconcile RFQs for credit history:', { error: rfqErr?.message || rfqErr }, 'BUYER_ACCOUNT_CONTROLLER');
    }

    transactions.sort((a, b) => {
      const dateA = new Date(a.created_at || a.createdAt || 0).getTime();
      const dateB = new Date(b.created_at || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    let totalAllocated = 0;
    let totalConsumed = 0;
    let purchasedCredits = 0;
    let adjustedCredits = 0;

    for (const t of transactions) {
      const added = Number(t.credits_added || t.creditsAdded || 0);
      const rawConsumed = Number(t.credits_consumed || t.creditsConsumed || 0);
      const type = t.transaction_type || t.transactionType || '';
      const isRfqConsumption = type.includes('Consumed') || type.includes('RFQ_CREATE');
      const consumed = rawConsumed > 0 ? rawConsumed : (isRfqConsumption ? 1 : 0);

      if (type.includes('Allocated') || type.includes('Addition')) {
        totalAllocated += added;
      }
      if (type.includes('Purchased')) {
        purchasedCredits += added;
        totalAllocated += added;
      }
      if (type.includes('Adjustment') || type.includes('Refund')) {
        adjustedCredits += added;
      }
      if (consumed > 0 || isRfqConsumption) {
        totalConsumed += consumed;
      }
    }

    if (transactions.length > 0 && remainingFree !== null && totalAllocated < remainingFree + totalConsumed) {
      totalAllocated = remainingFree + totalConsumed;
    }

    if (pool.hasStorage()) {
      pool.query(
        `UPDATE buyer_credit_transactions SET credits_consumed = 1 WHERE (transaction_type = 'RFQ_CREATE' OR transaction_type = 'Credits Consumed') AND credits_consumed = 0 AND buyer_id = $1`,
        [buyer.id],
        {
          d1: true,
          d1Text: `UPDATE buyer_credit_transactions SET credits_consumed = 1 WHERE (transaction_type = 'RFQ_CREATE' OR transaction_type = 'Credits Consumed') AND credits_consumed = 0 AND buyer_id = $1`,
        }
      ).catch(() => {});
    }

    const summary = {
      totalCreditsAllocated: totalAllocated,
      totalCreditsConsumed: totalConsumed,
      remainingFreeCredits: remainingFree,
      purchasedCredits,
      adjustedCredits,
      currentEntitlementMode: sourcingMode,
      currentSubscriptionPlan: subscriptionPlan,
    };

    const formattedTransactions = transactions.map((t) => {
      const type = t.transaction_type || t.transactionType || '';
      const rawConsumed = numberOrNull(t.credits_consumed ?? t.creditsConsumed);
      const isRfqConsumption = type.includes('Consumed') || type.includes('RFQ_CREATE');
      const creditsConsumed = rawConsumed !== null && rawConsumed > 0 ? rawConsumed : (isRfqConsumption ? 1 : (rawConsumed ?? 0));
      return {
        id: t.id,
        transactionId: t.id,
        transactionDate: t.created_at || t.createdAt,
        transactionType: t.transaction_type || t.transactionType,
        creditSource: t.credit_source || t.creditSource || null,
        creditsAdded: numberOrNull(t.credits_added ?? t.creditsAdded),
        creditsConsumed,
        previousBalance: numberOrNull(t.previous_balance ?? t.previousBalance),
        updatedBalance: numberOrNull(t.updated_balance ?? t.updatedBalance),
        relatedRfqId: t.rfq_id || t.rfqId || null,
        paymentReference: t.payment_reference || t.paymentReference || null,
        status: t.status || null,
        description: t.description || null,
      };
    });

    return res.json({
      success: true,
      summary,
      transactions: formattedTransactions,
      historyAvailable: transactions.length > 0,
    });
  } catch (err) {
    logger.error('Error fetching buyer credit history', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

async function addCredit(req, res, next) {
  try {
    if (!assertCategoryManagerOrAdmin(req, res)) return;
    const { id } = req.params;
    const rawIdempotencyKey = req.headers?.['idempotency-key'] || req.get?.('Idempotency-Key');
    const bodyValidation = validatePayload(VALIDATION_SCHEMAS.addBuyerCredit, req.body || {});
    const idempotencyValidation = rawIdempotencyKey
      ? validatePayload(VALIDATION_SCHEMAS.enterpriseInquiryIdempotencyKey, { idempotencyKey: rawIdempotencyKey })
      : { isValid: true, errors: {}, sanitizedData: {} };
    if (!bodyValidation.isValid || !idempotencyValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Credit addition details are invalid. Use a positive whole number and a valid Idempotency-Key UUID.',
        details: { ...bodyValidation.errors, ...idempotencyValidation.errors },
      });
    }
    const { amount, reason, source } = bodyValidation.sanitizedData;
    const creditAmount = amount;

    // The guard above guarantees an authenticated caller, so the actor is the session.
    const actorEmail = req.user.email;

    const buyer = await resolveBuyerAccount(id, req);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }

    const txId = `ctx-add-${crypto.randomBytes(6).toString('hex')}`;
    const tx = {
      id: txId,
      buyerId: buyer.id,
      rfqId: null,
      transactionType: 'Admin Credit Addition',
      creditSource: source || null,
      creditsAdded: creditAmount,
      creditsConsumed: 0,
      paymentReference: `MANUAL-${actorEmail}`,
      status: 'COMPLETED',
      description: reason || `Admin manual credit addition of ${creditAmount} credits by ${actorEmail}`,
      idempotencyKey: idempotencyValidation.sanitizedData.idempotencyKey || `add-${txId}`,
      createdAt: new Date().toISOString(),
    };

    const creditUpdate = await storeService.addBuyerCreditsDurably(id, creditAmount, tx);
    if (!creditUpdate) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    const { previousBalance, updatedBalance } = creditUpdate;
    tx.id = creditUpdate.transaction.id;
    tx.previousBalance = previousBalance;
    tx.updatedBalance = updatedBalance;

    if (!creditUpdate.replayed) {
      storeService.addAuditLog({
        userEmail: actorEmail,
        action: `Added ${creditAmount} credits to ${buyer.organizationName} (${buyer.corporateEmail}). New balance: ${updatedBalance}`,
      });
    }

    return res.json({
      success: true,
      message: `Successfully allocated ${creditAmount} credits to ${buyer.organizationName}.`,
      data: {
        buyerId: id,
        previousBalance,
        updatedBalance,
        replayed: Boolean(creditUpdate.replayed),
        transaction: tx,
      },
    });
  } catch (err) {
    logger.error('Error adding credit to buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}


async function requestCreditApproval(req, res, next) {
  try {
    if (!assertCategoryManagerOrAdmin(req, res)) return;
    const { id } = req.params;
    const buyer = await resolveBuyerAccount(id, req);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account "${id}" not found.` });
    }

    const { validatePayload, VALIDATION_SCHEMAS } = require('../config/validationSchemas');
    const internalTaskQueries = require('../db/internalTaskQueries');

    const validation = validatePayload(VALIDATION_SCHEMAS.buyerCreditApprovalRequest, req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed on credit approval request.',
        details: validation.errors,
      });
    }

    const {
      amount,
      reason,
      approverName,
      approverId,
      initiatorName,
      initiatorId,
      startDate,
      endDate,
      paymentDate,
      paymentType,
      transactionId,
      buyerSourceMode,
      paymentAmount,
      proofFileName,
      proofFileUrl,
      proofFileType,
      proofFileSize,
      idempotencyKey,
      requestType = 'Buyer Credit Addition',
      discountPercentage,
      durationDays,
      paymentReference,
      selectedMode,
      billingDuration,
      originalPrice,
      discountAmount,
      remainingAmount,
      gstAmount,
      finalPayableAmount,
    } = validation.sanitizedData;

    // The maker is the signed-in account, not a name typed into the form.
    const makerEmail = req.user.email;
    const makerRole = req.user.role;
    const makerName = req.user.fullName || req.user.name || req.user.email;
    const makerId = req.user.uuid || req.user.id || null;

    // The approver decides against the balance this request is made on. A buyer
    // with no balance on record is refused, not shown an assumed balance.
    const balance = knownCreditBalance(buyer);
    if (balance === null && (requestType === 'Buyer Credit Addition' || requestType === 'Buyer Credit Deletion')) {
      return res.status(422).json({
        success: false,
        error: `The credit balance for ${buyer.organizationName} is not on record, so the approver cannot see the balance this request is made against. Refresh the buyer account and try again.`,
      });
    }

    const numAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;

    if (requestType === 'Buyer Credit Deletion') {
      if (numAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'A positive credit amount is required for Buyer Credit Deletion.',
        });
      }
      if (balance !== null && numAmount > balance) {
        return res.status(400).json({
          success: false,
          error: `Cannot delete ${numAmount} credits: ${buyer.organizationName} only has ${balance} credits available.`,
        });
      }
    }

    let taskCategory = 'CREDIT_MANAGEMENT';
    let taskType = 'Add Credits';
    let title = `Credit Allocation Request: ${numAmount} Credits for ${buyer.organizationName}`;
    let description = reason || `Requested credit top-up for ${buyer.organizationName}`;
    let valueImpact = `${numAmount} RFQ Credits (${buyer.organizationName})`;
    let quantity = numAmount || 1;
    let effectiveAmount = numAmount;

    if (requestType === 'Buyer Credit Deletion') {
      taskCategory = 'CREDIT_MANAGEMENT';
      taskType = 'Credit Deletion';
      title = `Credit Deduction Request: ${numAmount} Credits from ${buyer.organizationName}`;
      description = reason || `Requested credit deduction for ${buyer.organizationName}`;
      valueImpact = `-${numAmount} RFQ Credits (${buyer.organizationName})`;
      quantity = numAmount;
      effectiveAmount = numAmount;
    } else if (requestType === 'Discounts') {
      taskCategory = 'CREDIT_MANAGEMENT';
      taskType = 'Discounts';
      const pct = discountPercentage !== undefined ? discountPercentage : (amount || 0);
      title = `Discount Approval Request: ${pct}% for ${buyer.organizationName}`;
      description = reason || `Requested ${pct}% discount for ${buyer.organizationName}`;
      valueImpact = `${pct}% Subscription Discount (${buyer.organizationName})`;
      effectiveAmount = pct;
      quantity = 1;
    } else if (requestType === 'Trial Periods') {
      taskCategory = 'ONBOARDING';
      taskType = 'Trial Periods';
      const days = durationDays || amount || 30;
      title = `Trial Period Request: ${days} Days for ${buyer.organizationName}`;
      description = reason || `Requested ${days} days trial extension for ${buyer.organizationName}`;
      valueImpact = `${days} Days Free Trial (${buyer.organizationName})`;
      effectiveAmount = days;
      quantity = 1;
    } else if (requestType === 'Offline Payments') {
      taskCategory = 'PAYMENT';
      taskType = 'Offline Payments';
      effectiveAmount = paymentAmount !== undefined ? paymentAmount : numAmount;
      const ref = transactionId || paymentReference || (paymentType === 'Cash' ? 'Cash' : '');
      const mode = buyerSourceMode || selectedMode || 'Mode 2';
      title = `Offline Payment Verification: ₹${effectiveAmount.toLocaleString('en-IN')} for ${buyer.organizationName}`;
      description = reason || `Offline payment verification (${paymentReference ? `Ref: ${paymentReference}` : (ref ? `Ref: ${ref}` : 'Offline')}) for ${buyer.organizationName}`;
      valueImpact = `₹${effectiveAmount.toLocaleString('en-IN')} (${paymentReference ? `Ref: ${paymentReference}` : (paymentType ? `${paymentType}${ref && paymentType !== 'Cash' ? ` • ${ref}` : ''}` : 'Offline Payment')})`;
      quantity = 1;
    }

    const discountPct = discountPercentage !== undefined ? discountPercentage : (requestType === 'Discounts' ? (amount || 0) : undefined);

    const taskAttachments = [];
    if (proofFileName) {
      taskAttachments.push({
        name: proofFileName,
        url: proofFileUrl || '',
        size: proofFileSize || 0,
        type: proofFileType || 'image/jpeg',
      });
    }

    const isCreditRequest = ['ADD_CREDIT', 'DELETE_CREDIT'].includes(taskType) ||
      ['Add Credits', 'Delete Credits', 'Buyer Credit Addition', 'Buyer Credit Deletion'].includes(taskCategory) ||
      ['Buyer Credit Addition', 'Buyer Credit Deletion'].includes(requestType) ||
      String(requestType || '').toLowerCase().includes('credit');

    const taskAssignedUserId = isCreditRequest ? (makerId || null) : (approverId || null);
    const taskAssignedName = isCreditRequest ? (makerName || 'Requester') : approverName;
    const taskAssignedTeam = isCreditRequest ? 'Requester Tracking' : 'Management Approvers';

    const task = await internalTaskQueries.createInternalTaskWithApproval(
      {
        taskCategory,
        taskType,
        title,
        description,
        priority: 'High',
        status: 'Pending Approval',
        approvalStatus: 'PENDING',
        assignedToUserId: taskAssignedUserId,
        assignedToName: taskAssignedName,
        assignedTeam: taskAssignedTeam,
        createdByName: makerName,
        createdByUserId: makerId || null,
        creditAccountType: 'buyer',
        creditAccountId: buyer.id,
        creditAccountName: buyer.organizationName,
        creditQuantity: effectiveAmount,
        creditReason: reason,
        notes: isCreditRequest
          ? `Initiated By: ${makerName}. Routed to Admin (${approverName}) for review and approval.`
          : `Initiated By: ${makerName}. Requires review and approval by ${approverName}.`,
        relatedEntityType: 'BUYER',
        relatedEntityId: buyer.id,
        relatedEntityLabel: buyer.organizationName,
        attachments: taskAttachments,
        raw: {
          request_type: requestType,
          discount_percentage: discountPct,
          duration_days: durationDays,
          trial_days: durationDays,
          start_date: startDate,
          end_date: endDate,
          payment_reference: paymentReference || transactionId,
          payment_date: paymentDate,
          payment_type: paymentType,
          transaction_id: transactionId || paymentReference,
          buyer_source_mode: buyerSourceMode || selectedMode,
          payment_amount: effectiveAmount,
          proof_file_name: proofFileName,
          proof_file_url: proofFileUrl,
          proof_file_type: proofFileType,
          proof_file_size: proofFileSize,
          selected_mode: selectedMode,
          billing_duration: billingDuration,
          original_price: originalPrice,
          discount_amount: discountAmount,
          remaining_amount: remainingAmount,
          gst_amount: gstAmount,
          final_payable_amount: finalPayableAmount,
          initiator_name: makerName,
          initiator_id: makerId,
          assigned_approver: approverName,
          assigned_approver_id: approverId,
        },
      },
      {
        uuid: makerId,
        fullName: makerName,
        name: makerName,
        email: makerEmail,
        role: makerRole,
      },
      {
        module: requestType,
        idempotencyKey,
        request_type: requestType,
        project: buyer.organizationName,
        applicant_name: buyer.organizationName,
        applicant_email: buyer.corporateEmail || '',
        value_impact: valueImpact,
        amount: effectiveAmount,
        quantity,
        available_balance: balance,
        maker_name: makerName,
        maker_role: makerRole,
        assigned_approver: approverName,
        status: 'Pending',
        details: requestType === 'Offline Payments'
          ? [
              reason,
              `[${buyerSourceMode || selectedMode || 'Mode 2'} • ${paymentType || 'Offline'}${paymentType !== 'Cash' && (transactionId || paymentReference) ? ` • Txn ID: ${transactionId || paymentReference}` : ''}${paymentDate ? ` • Date: ${paymentDate}` : ''}${proofFileName ? ` • Proof: ${proofFileName}` : ''}]`,
            ].filter(Boolean).join(' ')
          : requestType === 'Trial Periods'
          ? [
              reason,
              `[${selectedMode || 'Mode 1'} • ${durationDays || effectiveAmount} Days | ${startDate || ''} to ${endDate || ''}]`,
            ].filter(Boolean).join(' ')
          : originalPrice !== undefined
          ? [
              reason,
              `[${selectedMode || 'Mode 1'} • ${billingDuration || '12 Months'} | Original: ₹${Number(originalPrice).toLocaleString('en-IN')}, Discount: ${discountPct}%, Discount Amount: -₹${Number(discountAmount || 0).toLocaleString('en-IN')}, Remaining: ₹${Number(remainingAmount || 0).toLocaleString('en-IN')}, GST: +₹${Number(gstAmount || 0).toLocaleString('en-IN')}, Final: ₹${Number(finalPayableAmount || 0).toLocaleString('en-IN')}]`,
            ].filter(Boolean).join(' ')
          : (reason || description),
        attachments: taskAttachments,
        buyer_id: buyer.id,
        history: [
          {
            action: 'SUBMITTED',
            actor_name: makerName,
            actor_role: makerRole,
            timestamp: new Date().toISOString(),
            remarks: reason || (requestType === 'Buyer Credit Addition'
              ? `Submitted for credit approval by ${approverName}.`
              : `Submitted for ${requestType} approval by ${approverName}.`),
          },
        ],
        raw: {
          buyer_id: buyer.id,
          amount: effectiveAmount,
          quantity,
          available_balance: balance,
          assigned_approver: approverName,
          assigned_approver_id: approverId,
          initiator_name: makerName,
          initiator_id: makerId,
          request_type: requestType,
          discount_percentage: discountPct,
          duration_days: durationDays,
          trial_days: durationDays,
          start_date: startDate,
          end_date: endDate,
          payment_reference: paymentReference || transactionId,
          payment_date: paymentDate,
          payment_type: paymentType,
          transaction_id: transactionId || paymentReference,
          buyer_source_mode: buyerSourceMode || selectedMode,
          payment_amount: effectiveAmount,
          proof_file_name: proofFileName,
          proof_file_url: proofFileUrl,
          proof_file_type: proofFileType,
          proof_file_size: proofFileSize,
          selected_mode: selectedMode,
          billing_duration: billingDuration,
          original_price: originalPrice,
          discount_amount: discountAmount,
          remaining_amount: remainingAmount,
          gst_amount: gstAmount,
          final_payable_amount: finalPayableAmount,
        },
      }
    );

    if (proofFileName && proofFileUrl) {
      try {
        const accountDocumentQueries = require('../db/accountDocumentQueries');
        await accountDocumentQueries.createAccountDocument(
          {
            accountType: 'buyer',
            accountId: buyer.id,
            documentName: `Offline Payment Proof - ${proofFileName}`,
            category: 'Financial Documents',
            description: `Payment proof uploaded for Offline Payment approval (${paymentType || 'Offline'}, ₹${effectiveAmount})`,
            fileName: proofFileName,
            fileUrl: proofFileUrl,
            mimeType: proofFileType || 'image/jpeg',
            fileSize: proofFileSize || 0,
          },
          { name: makerName, email: makerEmail, role: makerRole, uuid: makerId }
        );
      } catch (docErr) {
        logger.warn('Could not auto-register offline payment document in vault', { error: docErr?.message }, 'BUYER_ACCOUNT_CONTROLLER');
      }
    }

    logger.info(`Approval request created for ${requestType}: ${task.task_number} (${valueImpact}) assigned to ${approverName}`, { buyerId: id, requestType, approverName }, 'BUYER_ACCOUNT_CONTROLLER');

    return res.status(201).json({
      success: true,
      message: `${requestType} request submitted for approval by ${approverName}. Status: Pending Approval.`,
      task,
    });
  } catch (err) {
    logger.error('Error requesting credit approval for buyer', err, 'BUYER_ACCOUNT_CONTROLLER');
    if (err?.code === 'PERSISTENCE_UNAVAILABLE') {
      return res.status(503).json({
        success: false,
        error: PERSISTENCE_MESSAGES.DATABASE_UNAVAILABLE,
        code: 'PERSISTENCE_UNAVAILABLE',
        retryable: true,
      });
    }
    next(err);
  }
}

async function updateSupportedCategories(req, res, next) {
  try {
    if (!assertCategoryManagerOrBuyer(req, res)) return;
    const { id } = req.params;
    const { categories } = req.body || {};
    if (!Array.isArray(categories)) {
      return res.status(400).json({ success: false, error: 'categories must be an array of strings.' });
    }

    const buyer = await resolveBuyerAccount(id, req);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    const cleanCategories = Array.from(new Set(categories.map((c) => String(c).trim()).filter(Boolean)));
    const updated = await storeService.updateBuyerAccountDurably(buyer.id, {
      supportedMajorCategories: cleanCategories,
    });

    storeService.addAuditLog({
      userEmail: req.user.email,
      action: `Updated supported major categories for ${buyer.organizationName}: [${cleanCategories.join(', ')}]`,
    });

    return res.json({
      success: true,
      message: 'Supported major categories updated successfully.',
      data: updated,
    });
  } catch (err) {
    logger.error('Error updating buyer supported categories', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

async function getBuyerCommunications(req, res, next) {
  try {
    if (!assertCategoryManagerOrBuyer(req, res)) return;
    const { id } = req.params;
    const paymentDuesQueries = require('../db/paymentDuesQueries');

    let buyer = await resolveBuyerAccount(id, req);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    const candidateIds = [
      buyer.id,
      buyer.userId,
      buyer.buyerId,
      buyer.organizationId,
      id,
      req.params?.id,
    ].filter(Boolean);
    const emails = [buyer.corporateEmail, buyer.email, buyer.contactEmail].filter(Boolean);
    const phones = [buyer.phone, buyer.mobileNumber, buyer.contactPhone].filter(Boolean);

    let comms = [];
    try {
      comms = (await paymentDuesQueries.getCommunicationHistory(candidateIds, { emails, phones })) || [];
    } catch (dbErr) {
      logger.warn('Failed to load communication history from database, returning empty list', { id, error: dbErr.message }, 'BUYER_ACCOUNT_CONTROLLER');
      comms = [];
    }
    return res.json({ success: true, data: comms });
  } catch (err) {
    logger.error('Error fetching buyer communications', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

async function recordBuyerCommunication(req, res, next) {
  try {
    if (!assertCategoryManagerOrBuyer(req, res)) return;
    const { id } = req.params;
    const {
      channel,
      recipient,
      subject,
      message,
      notes,
      metadata,
      callOutcome,
      duration,
      nextFollowupDate,
      followupPriority,
      followupAssigneeId,
      followupAssigneeName,
      followupNotes,
    } = req.body || {};
    const paymentDuesQueries = require('../db/paymentDuesQueries');
    const internalTaskQueries = require('../db/internalTaskQueries');

    let buyer = await resolveBuyerAccount(id, req);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    // The sender recorded on the communication is the signed-in user. A request without
    // a name or email fails here instead of recording an unknown sender.
    const actorName = req.user.fullName || req.user.name || req.user.email || null;
    if (!actorName) {
      return res.status(401).json({
        success: false,
        error: 'Sign in with a staff account to record this buyer communication. The signed-in session has no name or email, so the action cannot be attributed.',
      });
    }

    const normalizedChannel = (channel || 'EMAIL').toUpperCase();
    const commNotes = [
      callOutcome ? `Call Outcome: ${callOutcome}` : null,
      duration ? `Duration: ${duration}` : null,
      notes || null,
    ].filter(Boolean).join(' | ');

    const isStaff = ['admin', 'category_manager', 'support'].includes(req.user.role);
    const smsService = require('../services/smsService');
    const normalizedBuyerPhone = smsService.formatMobileNumber(recipient);
    const buyerEmail = (recipient && recipient.includes('@')) ? recipient : (buyer.corporateEmail || buyer.email);
    const buyerPhone = (normalizedBuyerPhone && normalizedBuyerPhone.length === 10)
      ? normalizedBuyerPhone
      : (buyer.phone || buyer.mobileNumber);
    const shouldDispatchEmail = isStaff && normalizedChannel === 'EMAIL' && Boolean(buyerEmail);
    const shouldDispatchSms = isStaff && normalizedChannel === 'SMS' && Boolean(buyerPhone);
    const deliveryPending = shouldDispatchEmail || shouldDispatchSms;

    const scenarioId = req.body?.scenarioId || req.body?.metadata?.scenarioId || req.body?.metadata?.templateType;
    const { resolveStandardizedCommunicationCategory } = require('../config/constants');
    const canonicalCategory = resolveStandardizedCommunicationCategory(scenarioId || req.body?.category || req.body?.metadata?.category);

    const record = await paymentDuesQueries.recordCommunication({
      accountId: id,
      accountType: 'buyer',
      channel: normalizedChannel,
      subject: subject || null,
      message: message || '',
      notificationStatus: deliveryPending ? 'Delivery Pending' : 'Delivered',
      deliveryStatus: deliveryPending ? 'Pending' : 'Delivered',
      acknowledgementStatus: deliveryPending ? 'Delivery Pending' : 'Acknowledgement Pending',
      communicatedBy: actorName,
      notes: commNotes || null,
      metadata: {
        ...(metadata || {}),
        category: canonicalCategory,
        templateType: scenarioId || canonicalCategory,
        scenarioId: scenarioId || 'followup_new',
        callOutcome: callOutcome || null,
        duration: duration || null,
        nextFollowupDate: nextFollowupDate || null,
        ...(shouldDispatchEmail ? {
          deliveryEmailSubject: `[Procucev] ${subject || 'Buyer Account Update'}`,
          ...(req.user?.email ? { deliveryReplyTo: req.user.email } : {}),
        } : {}),
        ...(shouldDispatchSms ? {
          deliveryRecipientName: buyer.organizationName || null,
          deliveryEntityType: 'buyer_dossier',
        } : {}),
      },
      recipient: shouldDispatchEmail
        ? buyerEmail
        : shouldDispatchSms
          ? buyerPhone
          : recipient || buyer.corporateEmail || buyer.phone || buyer.mobileNumber || '',
    });

    let deliveryRecord = record;
    if (deliveryPending && pool.hasStorage()) {
      try {
        const eventOutboxService = require('../services/eventOutboxService');
        await eventOutboxService.dispatchDueEventOutboxJobs(1);
      } catch (dispatchError) {
        logger.error('Immediate buyer dossier delivery failed; durable recovery will retry', {
          error: dispatchError,
          accountId: id,
          communicationId: record.id,
        }, 'BUYER_ACCOUNT_CONTROLLER');
      }
      try {
        const current = await paymentDuesQueries.getCommunicationById(record.id);
        if (current) deliveryRecord = current;
        else logger.error('Buyer dossier communication disappeared after durable delivery was queued', {
          accountId: id,
          communicationId: record.id,
        }, 'BUYER_ACCOUNT_CONTROLLER');
      } catch (lookupError) {
        logger.error('Buyer dossier delivery state could not be reloaded after queueing', {
          error: lookupError,
          accountId: id,
          communicationId: record.id,
        }, 'BUYER_ACCOUNT_CONTROLLER');
      }
    } else {
      let deliveryError = null;
      if (shouldDispatchEmail) {
        try {
          const mailerService = require('../services/mailerService');
          if (typeof mailerService.deliver !== 'function') {
            throw new Error('Shared email delivery service is unavailable.');
          }
          const result = await mailerService.deliver({
            to: buyerEmail,
            subject: '[Procucev] ' + (subject || 'Buyer Account Update'),
            text: message || commNotes || '',
            replyTo: req.user?.email || undefined,
          }, 'BUYER_DOSSIER_COMM');
          if (!result?.sent) deliveryError = new Error(result?.reason || 'Email provider did not accept the message.');
        } catch (error) {
          deliveryError = error;
          logger.error('Buyer dossier email dispatch failed', { error, accountId: id, communicationId: record.id }, 'BUYER_ACCOUNT_CONTROLLER');
        }
      } else if (shouldDispatchSms) {
        try {
          const result = await smsService.sendActionCenterSms({
            mobile: buyerPhone,
            recipientName: buyer.organizationName || null,
            message: message || subject || 'Buyer account notification',
            entityType: 'buyer_dossier',
          });
          if (!result?.success) deliveryError = new Error(result?.error || 'SMS provider did not accept the message.');
        } catch (error) {
          deliveryError = error;
          logger.error('Buyer dossier SMS dispatch failed', { error, accountId: id, communicationId: record.id }, 'BUYER_ACCOUNT_CONTROLLER');
        }
      }

      if (deliveryPending) {
        const delivered = !deliveryError;
        const status = delivered ? 'Delivered' : 'Failed';
        try {
          const updated = await paymentDuesQueries.updateCommunicationDeliveryStatus({
            communicationId: record.id,
            notificationStatus: delivered ? 'Notification Sent' : 'Failed',
            deliveryStatus: status,
            acknowledgementStatus: delivered ? 'Acknowledgement Pending' : 'Failed',
          });
          if (updated) {
            deliveryRecord = updated;
          } else {
            logger.error('Buyer dossier delivery result could not be matched to its persisted communication', {
              accountId: id,
              communicationId: record.id,
              deliveryStatus: status,
            }, 'BUYER_ACCOUNT_CONTROLLER');
          }
        } catch (statusError) {
          logger.error('Buyer dossier delivery result could not be saved; communication remains pending', {
            error: statusError,
            accountId: id,
            communicationId: record.id,
            providerAccepted: delivered,
          }, 'BUYER_ACCOUNT_CONTROLLER');
        }
      }
    }

    let completedTask = null;
    try {
      const channelLabel = normalizedChannel === 'CALL' ? 'Call' : normalizedChannel === 'WHATSAPP' ? 'WhatsApp' : normalizedChannel === 'SMS' ? 'SMS' : 'Email';
      const actor = req.user;
      completedTask = await internalTaskQueries.createInternalTask({
        title: `[${channelLabel} Log / Completed] ${subject || buyer.organizationName}`,
        description: message || commNotes || 'Buyer communication activity recorded.',
        taskTypeId: 'itt_buyer_onboarding',
        priority: 'Medium',
        status: 'Completed',
        relatedEntityType: 'BUYER',
        relatedEntityId: buyer.id,
        relatedEntityLabel: buyer.organizationName,
        assignedToUserId: actor.uuid || actor.id || null,
        assignedToName: actor.fullName || actor.name || actor.email || null,
        dueDate: new Date().toISOString(),
        notes: commNotes || '',
      }, actor);
    } catch (taskErr) {
      logger.warn('Failed to create completed internal task for buyer communication', { error: taskErr.message }, 'BUYER_ACCOUNT_CONTROLLER');
    }

    let followupTask = null;
    if (nextFollowupDate) {
      try {
        const actor = req.user;
        followupTask = await internalTaskQueries.createInternalTask({
          title: `[Follow-up] ${buyer.organizationName} - ${subject || 'Buyer Follow-up'}`,
          description: followupNotes || `Follow-up needed following ${normalizedChannel} outreach: ${message || ''}`,
          taskTypeId: 'itt_buyer_onboarding',
          priority: followupPriority || 'Medium',
          status: 'Pending',
          relatedEntityType: 'BUYER',
          relatedEntityId: buyer.id,
          relatedEntityLabel: buyer.organizationName,
          assignedToUserId: followupAssigneeId || actor.uuid || actor.id || null,
          assignedToName: followupAssigneeName || actor.fullName || actor.name || actor.email || null,
          dueDate: nextFollowupDate,
          notes: followupNotes || '',
        }, actor);
      } catch (followupErr) {
        logger.warn('Failed to create pending follow-up internal task for buyer communication', { error: followupErr.message }, 'BUYER_ACCOUNT_CONTROLLER');
      }
    }

    if (scenarioId) {
      try {
        await internalTaskQueries.autoCompleteTasksForScenario('BUYER', id, scenarioId, req.user);
      } catch (autoErr) {
        logger.warn('Failed to auto-complete tasks for buyer scenario', { error: autoErr.message }, 'BUYER_ACCOUNT_CONTROLLER');
      }
    }

    return res.status(201).json({ success: true, data: deliveryRecord, completedTask, followupTask });
  } catch (err) {
    logger.error('Error recording buyer communication', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

async function getBuyerPaymentHistory(req, res, next) {
  try {
    if (!assertCategoryManagerOrBuyer(req, res)) return;
    const { id } = req.params;
    let buyer = await resolveBuyerAccount(id, req);
    if (!buyer) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    const candidateIds = [
      buyer.id,
      buyer.userId,
      buyer.buyerId,
      buyer.organizationId,
      id,
      req.params?.id,
    ].filter(Boolean);

    let links = await storeService.getPaymentLinksForBuyer(candidateIds);
    const reconciled = await zohoReconciliationService.reconcilePendingLinks(links);
    if (reconciled > 0) {
      links = await storeService.getPaymentLinksForBuyer(candidateIds);
    }

    const payments = [];

    // Subscription state is not proof of a payment; only provider records count.
    // Each field is what the stored payment link holds. A missing value stays
    // null: nothing is assumed about the method, currency, status, or date.
    for (const link of links) {
      payments.push({
        id: link.id,
        paymentId: link.id,
        invoiceNo: link.invoiceNumber || null,
        invoiceNumber: link.invoiceNumber || null,
        description: link.planId ? `Subscription Renewal: ${link.planId}` : 'Subscription payment',
        subscriptionPlan: link.planId || null,
        amount: numberOrNull(link.amount),
        currency: link.currency || null,
        gateway: 'Zoho Payments',
        paymentMethod: null,
        status: link.status ? String(link.status).toUpperCase() : null,
        gatewayRef: link.zohoPaymentLinkId || link.id,
        date: link.createdAt || null,
        transactionDate: link.createdAt || null,
        receiptUrl: `/api/buyer-accounts/${buyer.id}/payment-links/${link.id}/invoice`,
      });
    }

    // Calculate Payment Summary
    let totalPaid = 0;
    let totalSuccessful = 0;
    let pending = 0;
    let failed = 0;
    let refunded = 0;

    // Totals add only amounts that are on record. A payment with no amount is
    // counted by status but adds nothing to the money totals.
    for (const p of payments) {
      const st = String(p.status || '').toUpperCase();
      if (st === 'PAID' || st === 'SUCCESS' || st === 'COMPLETED') {
        if (p.amount !== null) totalPaid += p.amount;
        totalSuccessful += 1;
      } else if (st === 'PENDING' || st === 'CREATED' || st === 'IN_PROGRESS') {
        pending += 1;
      } else if (st === 'FAILED' || st === 'EXPIRED') {
        failed += 1;
      } else if (st === 'REFUNDED') {
        if (p.amount !== null) refunded += p.amount;
      }
    }

    const summary = {
      totalAmountPaid: totalPaid,
      totalSuccessfulPayments: totalSuccessful,
      pendingPayments: pending,
      failedPayments: failed,
      totalRefundedAmount: refunded,
    };

    return res.json({ success: true, summary, payments });
  } catch (err) {
    logger.error('Error fetching buyer payment history', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

function getSubscriptionPricing(req, res) {
  try {
    const config = getSubscriptionPricingConfig();
    res.json({ success: true, data: config });
  } catch (err) {
    logger.error('Failed to get subscription pricing', err, 'BUYER_ACCOUNT_CONTROLLER');
    res.status(500).json({ success: false, error: 'Failed to retrieve subscription pricing' });
  }
}

async function getBuyerUploadedVendors(req, res, next) {
  try {
    if (!assertCategoryManagerOrBuyer(req, res)) return;
    const { id } = req.params;

    let buyer = await resolveBuyerAccount(id, req);
    if (!buyer) {
      return res.status(404).json({ success: false, error: formatMessage(DOSSIER_MESSAGES.BUYER_NOT_FOUND, { id }) });
    }
    if (!assertCategoryManagerOrBuyer(req, res, buyer)) return;

    let dbVendors = [];
    if (pool.hasStorage()) {
      dbVendors = await domainQueries.getVendorsUploadedByBuyerFromDB(
        buyer.id,
        buyer.corporateEmail || buyer.email,
        buyer.organizationName || buyer.companyName
      );
    }

    const inMemVendors = (storeService.vendors || []).filter((v) => {
      if (!v) return false;
      const bId = String(buyer.id).toLowerCase();
      const bEmail = buyer.corporateEmail ? String(buyer.corporateEmail).toLowerCase() : '';
      const bOrg = buyer.organizationName ? String(buyer.organizationName).toLowerCase() : '';
      const vBuyerId = v.buyerId ? String(v.buyerId).toLowerCase() : '';
      const vBuyerAccountId = v.buyerAccountId ? String(v.buyerAccountId).toLowerCase() : '';
      const vBuyerEmail = v.buyerEmail ? String(v.buyerEmail).toLowerCase() : '';
      const vAddedBy = v.addedByBuyerCompany ? String(v.addedByBuyerCompany).toLowerCase() : '';
      return (
        (vBuyerId && vBuyerId === bId) ||
        (vBuyerAccountId && vBuyerAccountId === bId) ||
        (bEmail && vBuyerEmail && vBuyerEmail === bEmail) ||
        (bOrg && vAddedBy && vAddedBy === bOrg)
      );
    });

    const vendorMap = new Map();
    for (const v of [...dbVendors, ...inMemVendors]) {
      if (v?.id && !vendorMap.has(v.id)) {
        vendorMap.set(v.id, {
          id: v.id,
          name: v.name || v.brandName || 'Unnamed Vendor',
          companyName: v.companyName || v.name || v.brandName || 'Unnamed Vendor',
          contactPerson: v.contactPerson || v.name || 'Primary Contact',
          email: v.email || '',
          phone: v.phone || v.contactPhone || v.mobileNumber || v.mobile || '',
          createdAt: v.createdAt || v.created_at || new Date().toISOString(),
          status: v.status || 'PENDING EVALUATION',
          majorCategory: v.majorCategory || v.category || 'General',
          minorCategories: Array.isArray(v.minorCategories) ? v.minorCategories : [],
          location: v.location || (v.city ? `${v.city}${v.state ? ', ' + v.state : ''}` : ''),
          city: v.city || '',
          state: v.state || '',
          pincode: v.pincode || '',
          source: v.source || 'buyer_uploaded',
          score: v.score ?? v.score360 ?? null,
          rating: v.rating ?? null,
          gstin: v.gstin || v.gstNumber || '',
          pan: v.pan || v.panNumber || '',
          ...v,
        });
      }
    }

    const vendors = Array.from(vendorMap.values());
    return res.status(200).json({
      success: true,
      count: vendors.length,
      data: vendors,
    });
  } catch (err) {
    logger.error('Error fetching buyer uploaded vendors', err, 'BUYER_ACCOUNT_CONTROLLER');
    return next(err);
  }
}

async function getBuyerDirectoryKPIStats(req, res, next) {
  try {
    if (!assertCategoryManagerOrAdmin(req, res)) return;
    const directoryKPIQueries = require('../db/directoryKPIQueries');
    const stats = await directoryKPIQueries.getBuyerDirectoryKPIStatsFromDB();
    res.json({ success: true, ...stats });
  } catch (err) {
    logger.error('Error fetching buyer directory KPI stats', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getBuyerAccounts,
  getActiveAccount,
  createBuyerAccount,
  updateBuyerAccount,
  deleteBuyerAccount,
  setActiveAccount,
  createSubscriptionPaymentLink,
  getPaymentLinks,
  downloadInvoice,
  ingestHistoricalData,
  aiCrossMatch,
  getSubscriptionPricing,
  getCreditHistory,
  addCredit,
  requestCreditApproval,
  updateSupportedCategories,
  getBuyerCommunications,
  recordBuyerCommunication,
  getBuyerPaymentHistory,
  getBuyerUploadedVendors,
  getBuyerDirectoryKPIStats,
  assertCategoryManagerOrAdmin,
  assertCategoryManagerOrBuyer,
};

const storeService = require('../services/storeService');
const buyerAccountResolver = require('../services/buyerAccountResolver');
const zohoPaymentService = require('../services/zohoPaymentService');
const { logger } = require('../services/loggerService');
const { ZOHO_CONFIG, computeZohoBuyerPlanAmount, BUYER_SUBSCRIPTION_PLANS } = require('../config/constants');

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

function getBuyerAccounts(req, res, next) {
  try {
    logger.info('Fetching buyer accounts', {}, 'BUYER_ACCOUNT_CONTROLLER');
    const accounts = storeService.getBuyerAccounts();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'persisted' : 'in_memory', data: accounts });
  } catch (err) {
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

function createBuyerAccount(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const body = req.body;
    if (!body.organizationName || !body.corporateEmail) {
      logger.warn('Failed to create buyer account: Missing organizationName or corporateEmail', { body }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(400).json({ success: false, error: 'organizationName and corporateEmail are required.' });
    }
    logger.info(`Creating new buyer account: ${body.organizationName}`, { organizationName: body.organizationName, email: body.corporateEmail }, 'BUYER_ACCOUNT_CONTROLLER');
    const created = storeService.addBuyerAccount(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error creating buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

function updateBuyerAccount(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { id } = req.params;
    const updates = req.body;
    logger.info(`Updating buyer account ${id}`, { id, updates }, 'BUYER_ACCOUNT_CONTROLLER');
    const updated = storeService.updateBuyerAccount(id, updates);
    if (!updated) {
      logger.warn(`Buyer account not found for update: ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('Error updating buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

function deleteBuyerAccount(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { id } = req.params;
    logger.info(`Deleting buyer account ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
    const deleted = storeService.deleteBuyerAccount(id);
    if (!deleted) {
      logger.warn(`Buyer account not found for deletion: ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({ success: true, message: `Buyer account ${id} deleted successfully.` });
  } catch (err) {
    logger.error('Error deleting buyer account', err, 'BUYER_ACCOUNT_CONTROLLER');
    next(err);
  }
}

function setActiveAccount(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { id } = req.params;
    logger.info(`Setting active buyer account to ${id}`, { id }, 'BUYER_ACCOUNT_CONTROLLER');
    const active = storeService.alignActiveBuyerAccount(id);
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
    const { plan } = req.body;

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
    let existing = storeService.getBuyerAccountByEmail(req.user.email);
    if (!existing && req.user.email) {
      existing = storeService.addBuyerAccount({
        organizationName: req.user.orgName || req.user.email,
        corporateEmail: req.user.email,
        mobileNumber: '',
      });
    }
    if (!existing) {
      return res.status(404).json({ success: false, error: `Buyer account with ID ${id} not found.` });
    }
    if (!ZOHO_PAYABLE_BUYER_PLANS.includes(plan)) {
      return res.status(400).json({ success: false, error: `plan must be one of: ${ZOHO_PAYABLE_BUYER_PLANS.join(', ')}.` });
    }
    if (!existing.corporateEmail) {
      return res.status(400).json({ success: false, error: 'Buyer account has no email on file to create a payment link for.' });
    }

    const amount = computeZohoBuyerPlanAmount(plan);
    const planLabel = (BUYER_SUBSCRIPTION_PLANS.find((p) => p.id === plan) || {}).name || plan;
    const returnUrl = `${ZOHO_CONFIG.RETURN_URL_BASE}/buyer/subscription-center?payment=success`;

    const result = await zohoPaymentService.createPaymentLink({
      planId: plan,
      planLabel,
      amountInr: amount,
      email: existing.corporateEmail,
      phone: existing.mobileNumber || '',
      returnUrl,
    });

    const link = storeService.createPaymentLinkRecord({
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      zohoPaymentLinkId: result.zohoPaymentLinkId,
      buyerAccountId: existing.id,
      payerType: 'buyer',
      planId: plan,
      amount,
      paymentUrl: result.paymentUrl,
      status: result.status || 'CREATED',
      rawResponse: result.rawResponse,
    });

    logger.info(`Created Zoho payment link for buyer account ${id} (${plan})`, { id, plan, zohoPaymentLinkId: link.zohoPaymentLinkId }, 'BUYER_ACCOUNT_CONTROLLER');
    res.json({ success: true, data: { paymentUrl: link.paymentUrl, paymentLinkId: link.id, status: link.status } });
  } catch (err) {
    logger.error(`Error creating Zoho payment link for buyer account ${req.params.id}`, err, 'BUYER_ACCOUNT_CONTROLLER');
    res.status(502).json({ success: false, error: 'Unable to create a payment link right now. Please try again shortly.' });
  }
}

function ingestHistoricalData(req, res, next) {
  try {
    if (!assertBuyerAccountRole(req, res)) return;
    const { period, vendorRecords } = req.body;
    if (!period) {
      logger.warn('Failed to ingest historical data: Missing period', { body: req.body }, 'BUYER_ACCOUNT_CONTROLLER');
      return res.status(400).json({ success: false, error: 'period is required.' });
    }
    logger.info(`Ingesting historical purchase data for period: ${period}`, { period }, 'BUYER_ACCOUNT_CONTROLLER');
    const requestingBuyerAccount = storeService.getBuyerAccountByEmail(req.user.email);
    const result = storeService.processHistoricalPurchaseData(period, vendorRecords || [], requestingBuyerAccount);
    res.json(result);
  } catch (err) {
    logger.error('Error ingesting historical purchase data', err, 'BUYER_ACCOUNT_CONTROLLER');
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
  ingestHistoricalData,
};

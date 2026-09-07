const storeService = require('../services/storeService');
const buyerAccountResolver = require('../services/buyerAccountResolver');
const { logger } = require('../services/loggerService');

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
  ingestHistoricalData,
};

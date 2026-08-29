const storeService = require('../services/storeService');

function getBuyerAccounts(req, res, next) {
  try {
    const accounts = storeService.getBuyerAccounts();
    res.json({ success: true, source: storeService.isHydratedFromDB ? 'postgresql' : 'in_memory', data: accounts });
  } catch (err) {
    next(err);
  }
}

function getActiveAccount(req, res, next) {
  try {
    const active = storeService.getActiveBuyerAccount();
    res.json({ success: true, data: active });
  } catch (err) {
    next(err);
  }
}

function createBuyerAccount(req, res, next) {
  try {
    const body = req.body;
    if (!body.organizationName || !body.corporateEmail) {
      return res.status(400).json({ success: false, error: 'organizationName and corporateEmail are required.' });
    }
    const created = storeService.addBuyerAccount(body);
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

function updateBuyerAccount(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    const updated = storeService.updateBuyerAccount(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

function deleteBuyerAccount(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = storeService.deleteBuyerAccount(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({ success: true, message: `Buyer account ${id} deleted successfully.` });
  } catch (err) {
    next(err);
  }
}

function setActiveAccount(req, res, next) {
  try {
    const { id } = req.params;
    const active = storeService.alignActiveBuyerAccount(id);
    if (!active) {
      return res.status(404).json({ success: false, error: `Buyer account ${id} not found.` });
    }
    res.json({ success: true, data: active });
  } catch (err) {
    next(err);
  }
}

function ingestHistoricalData(req, res, next) {
  try {
    const { period, vendorRecords } = req.body;
    if (!period) {
      return res.status(400).json({ success: false, error: 'period is required.' });
    }
    const result = storeService.processHistoricalPurchaseData(period, vendorRecords || []);
    res.json(result);
  } catch (err) {
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

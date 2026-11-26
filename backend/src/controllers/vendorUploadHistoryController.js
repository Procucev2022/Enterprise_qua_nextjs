const vendorUploadHistoryQueries = require('../db/vendorUploadHistoryQueries');
const storeService = require('../services/storeService');
const pool = require('../db/pool');
const { logger } = require('../services/loggerService');
const { VENDOR_UPLOAD_HISTORY_CONFIG } = require('../config/constants');
const { VALIDATION_SCHEMAS, validatePayload } = require('../config/validationSchemas');

async function resolveScopeForUser(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  const role = String(user?.role || 'buyer').trim();
  const userId = String(user?.sub || user?.id || '').trim();
  const orgId = String(user?.orgId || user?.organizationId || '').trim();

  if (role === 'buyer') {
    let buyerAccount = null;
    if (email && typeof storeService.getBuyerAccountByEmail === 'function') {
      buyerAccount = await storeService.getBuyerAccountByEmail(email).catch(() => null);
    }
    const buyerId = buyerAccount?.id || orgId || userId || null;
    const ownerKey = buyerId || email || userId;
    const ownerKeys = [ownerKey, buyerId, orgId, email, userId].filter(Boolean);
    const buyerIds = [buyerId, orgId].filter(Boolean);
    return {
      ownerKey,
      ownerKeys,
      buyerId,
      buyerIds,
      buyerEmail: buyerAccount?.corporateEmail || email || null,
      role,
    };
  }

  const ownerKey = email || userId;
  return {
    ownerKey,
    ownerKeys: [ownerKey, userId].filter(Boolean),
    buyerId: null,
    buyerIds: [],
    buyerEmail: email || null,
    role,
  };
}

async function getUploadHistory(req, res, next) {
  try {
    const scope = await resolveScopeForUser(req.user);
    if (!scope.ownerKey) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!pool.hasStorage()) {
      return res.json({ success: true, data: [] });
    }
    const rawLimit = req.query && req.query.limit ? Number(req.query.limit) : VENDOR_UPLOAD_HISTORY_CONFIG.DEFAULT_LIMIT;
    const batches = await vendorUploadHistoryQueries.listUploadHistory({
      ownerKeys: scope.ownerKeys,
      buyerIds: scope.buyerIds,
      limit: rawLimit,
    });
    return res.json({ success: true, data: batches });
  } catch (err) {
    logger.error('Failed to fetch vendor upload history', err, 'VENDOR_UPLOAD_HISTORY_CONTROLLER');
    return next(err);
  }
}

async function createUploadHistory(req, res, next) {
  try {
    const scope = await resolveScopeForUser(req.user);
    if (!scope.ownerKey) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    const body = req.body || {};
    const validation = validatePayload(VALIDATION_SCHEMAS.vendorUploadHistoryCreate, body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: Object.values(validation.errors)[0] || VENDOR_UPLOAD_HISTORY_CONFIG.MESSAGES.FILENAME_REQUIRED,
      });
    }
    const records = Array.isArray(body.records)
      ? body.records.slice(0, VENDOR_UPLOAD_HISTORY_CONFIG.MAX_RECORDS_PER_BATCH)
      : [];
    const entry = {
      id: body.id ? String(body.id).trim().slice(0, 64) : undefined,
      ownerKey: scope.ownerKey,
      buyerId: scope.buyerId,
      buyerEmail: scope.buyerEmail,
      role: scope.role,
      fileName: String(body.fileName).trim(),
      total: Number(body.total) || 0,
      imported: Number(body.imported) || 0,
      duplicates: Number(body.duplicates) || 0,
      failed: Number(body.failed) || 0,
      onboardingFailed: Number(body.onboardingFailed) || 0,
      onboardingSkipped: Number(body.onboardingSkipped) || 0,
      status: body.status ? String(body.status).trim() : 'COMPLETED',
      records,
    };

    if (!pool.hasStorage()) {
      return res.status(201).json({
        success: true,
        data: { ...entry, id: entry.id || `up-${Date.now()}`, timestamp: new Date().toISOString() },
      });
    }
    const saved = await vendorUploadHistoryQueries.upsertUploadHistory(entry);
    return res.status(201).json({ success: true, data: saved });
  } catch (err) {
    logger.error('Failed to save vendor upload history', err, 'VENDOR_UPLOAD_HISTORY_CONTROLLER');
    return next(err);
  }
}

async function deleteUploadHistory(req, res, next) {
  try {
    const scope = await resolveScopeForUser(req.user);
    if (!scope.ownerKey) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    const id = req.params?.id ? String(req.params.id).trim() : '';
    const fileName = req.query?.fileName ? String(req.query.fileName).trim() : '';
    if (!id && !fileName) {
      return res.status(400).json({ success: false, error: VENDOR_UPLOAD_HISTORY_CONFIG.MESSAGES.INVALID_ID });
    }
    const deletedCount = pool.hasStorage()
      ? await vendorUploadHistoryQueries.deleteUploadHistory({
          id: id || undefined,
          fileName: fileName || undefined,
          ownerKeys: scope.ownerKeys,
          buyerIds: scope.buyerIds,
        })
      : 0;
    return res.json({ success: true, data: { deletedCount } });
  } catch (err) {
    logger.error('Failed to delete vendor upload history', err, 'VENDOR_UPLOAD_HISTORY_CONTROLLER');
    return next(err);
  }
}

module.exports = {
  getUploadHistory,
  createUploadHistory,
  deleteUploadHistory,
};

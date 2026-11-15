const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

// Resolves the caller's own vendor record id (for ownership checks below).
// Returns null for a non-vendor role or a vendor with no profile record yet.
async function resolveOwnVendorId(req) {
  if (!req.user || req.user.role !== 'vendor') return null;
  // 'all': resolving the caller's own vendor identity by session email, not
  // filtering a buyer-scoped list — omitting this silently returns nothing
  // for any buyer-uploaded vendor (one with a buyerId set).
  const candidate = req.user.email || req.user.vendorId || req.user.id;
  let vendor = candidate ? storeService.getVendorById(candidate, 'all') : null;
  if (!vendor && candidate && typeof storeService.getVendorByIdWithDBFallback === 'function') {
    vendor = await storeService.getVendorByIdWithDBFallback(candidate, 'all');
  }
  return vendor ? vendor.id : (req.user.vendorId || null);
}

async function getProducts(req, res, next) {
  try {
    const { vendorId } = req.query;
    logger.info('Fetching vendor items catalogue', { query: req.query }, 'CATALOGUE_CONTROLLER');
    const parsedLimit = req.query && req.query.limit ? Number(req.query.limit) : null;
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;
    const products = await storeService.getVendorCatalogueDurably(vendorId, limit);
    res.json({ success: true, data: products });
  } catch (err) {
    logger.error('Error fetching catalogue items', err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

async function addProduct(req, res, next) {
  try {
    const { name, sku, unitPrice, category, leadTimeDays, moq, specs } = req.body;
    if (!name || !sku || !unitPrice) {
      logger.warn('Failed to add product: Missing name, sku, or unitPrice', { body: req.body }, 'CATALOGUE_CONTROLLER');
      return res.status(400).json({ success: false, error: 'name, sku, and unitPrice are required.' });
    }
    if (req.user.role !== 'vendor' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Only a vendor can add to their own catalogue.' });
    }
    const vendorId = req.user.role === 'admin' ? req.body.vendorId : await resolveOwnVendorId(req);
    if (!vendorId) {
      return res.status(400).json({ success: false, error: 'Create your vendor profile before adding catalogue items.' });
    }
    const vendorProducts = await storeService.getVendorCatalogueDurably(vendorId, 101);
    if (vendorProducts.length >= 100) {
      return res.status(409).json({ success: false, error: 'Catalogue capacity is limited to 100 products per vendor.' });
    }
    if (vendorProducts.some((product) => String(product.sku || '').trim().toLowerCase() === String(sku).trim().toLowerCase())) {
      return res.status(409).json({ success: false, error: `SKU "${sku}" already exists in this catalogue.` });
    }
    if (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) <= 0 ||
        (leadTimeDays !== undefined && (!Number.isInteger(Number(leadTimeDays)) || Number(leadTimeDays) <= 0)) ||
        (moq !== undefined && (!Number.isInteger(Number(moq)) || Number(moq) <= 0))) {
      return res.status(400).json({ success: false, error: 'unitPrice must be positive; provided leadTimeDays and moq values must be positive whole numbers.' });
    }
    logger.info(`Adding item to catalogue: ${name} (${sku})`, { name, sku, unitPrice, category, vendorId }, 'CATALOGUE_CONTROLLER');
    const created = await storeService.addProductToCatalogueDurably(
      { name, sku, unitPrice, category, leadTimeDays, moq, specs },
      vendorId,
      req.user.email
    );
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error adding product to catalogue', err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

async function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await storeService.getCatalogueProductByIdDurably(id);
    if (!existing) {
      logger.warn(`Product not found for update: ${id}`, { id }, 'CATALOGUE_CONTROLLER');
      return res.status(404).json({ success: false, error: `Product with ID ${id} not found.` });
    }
    if (req.user.role !== 'admin') {
      const ownVendorId = await resolveOwnVendorId(req);
      if (!ownVendorId || existing.vendorId !== ownVendorId) {
        return res.status(403).json({ success: false, error: 'You do not have permission to modify this catalogue item.' });
      }
    }
    logger.info(`Updating catalogue product ${id}`, { id, updates: req.body }, 'CATALOGUE_CONTROLLER');
    const updated = await storeService.updateCatalogueProductDurably(id, req.body, req.user.email);
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating product ${req.params.id}`, err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

async function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await storeService.getCatalogueProductByIdDurably(id);
    if (!existing) {
      logger.warn(`Product not found for deletion: ${id}`, { id }, 'CATALOGUE_CONTROLLER');
      return res.status(404).json({ success: false, error: `Product with ID ${id} not found.` });
    }
    if (req.user.role !== 'admin') {
      const ownVendorId = await resolveOwnVendorId(req);
      if (!ownVendorId || existing.vendorId !== ownVendorId) {
        return res.status(403).json({ success: false, error: 'You do not have permission to delete this catalogue item.' });
      }
    }
    logger.info(`Deleting catalogue product ${id}`, { id }, 'CATALOGUE_CONTROLLER');
    const deleted = await storeService.deleteCatalogueProductDurably(id, req.user.email);
    if (!deleted) {
      return res.status(404).json({ success: false, error: `Product with ID ${id} was already removed.` });
    }
    res.json({ success: true, message: 'Product deleted.' });
  } catch (err) {
    logger.error(`Error deleting product ${req.params.id}`, err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

module.exports = {
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
};

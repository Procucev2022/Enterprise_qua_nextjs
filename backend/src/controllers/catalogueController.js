const storeService = require('../services/storeService');
const { logger } = require('../services/loggerService');

function getProducts(req, res, next) {
  try {
    logger.info('Fetching vendor items catalogue', { query: req.query }, 'CATALOGUE_CONTROLLER');
    const products = storeService.getVendorCatalogue();
    res.json({ success: true, data: products });
  } catch (err) {
    logger.error('Error fetching catalogue items', err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

function addProduct(req, res, next) {
  try {
    const { name, sku, unitPrice, category, leadTimeDays, moq, specs } = req.body;
    if (!name || !sku || !unitPrice) {
      logger.warn('Failed to add product: Missing name, sku, or unitPrice', { body: req.body }, 'CATALOGUE_CONTROLLER');
      return res.status(400).json({ success: false, error: 'name, sku, and unitPrice are required.' });
    }
    logger.info(`Adding item to catalogue: ${name} (${sku})`, { name, sku, unitPrice, category }, 'CATALOGUE_CONTROLLER');
    const created = storeService.addProductToCatalogue({ name, sku, unitPrice, category, leadTimeDays, moq, specs });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    logger.error('Error adding product to catalogue', err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    logger.info(`Updating catalogue product ${id}`, { id, updates: req.body }, 'CATALOGUE_CONTROLLER');
    const updated = storeService.updateCatalogueProduct(id, req.body);
    if (!updated) {
      logger.warn(`Product not found for update: ${id}`, { id }, 'CATALOGUE_CONTROLLER');
      return res.status(404).json({ success: false, error: `Product with ID ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error(`Error updating product ${req.params.id}`, err, 'CATALOGUE_CONTROLLER');
    next(err);
  }
}

function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;
    logger.info(`Deleting catalogue product ${id}`, { id }, 'CATALOGUE_CONTROLLER');
    const removed = storeService.deleteCatalogueProduct(id);
    if (!removed) {
      logger.warn(`Product not found for deletion: ${id}`, { id }, 'CATALOGUE_CONTROLLER');
      return res.status(404).json({ success: false, error: `Product with ID ${id} not found.` });
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

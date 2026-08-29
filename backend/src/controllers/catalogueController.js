const storeService = require('../services/storeService');

function getProducts(req, res, next) {
  try {
    const products = storeService.getVendorCatalogue();
    res.json({ success: true, data: products });
  } catch (err) {
    next(err);
  }
}

function addProduct(req, res, next) {
  try {
    const { name, sku, unitPrice, category, leadTimeDays, moq, specs } = req.body;
    if (!name || !sku || !unitPrice) {
      return res.status(400).json({ success: false, error: 'name, sku, and unitPrice are required.' });
    }
    const created = storeService.addProductToCatalogue({ name, sku, unitPrice, category, leadTimeDays, moq, specs });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    next(err);
  }
}

function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    const updated = storeService.updateCatalogueProduct(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: `Product with ID ${id} not found.` });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

function deleteProduct(req, res, next) {
  try {
    const { id } = req.params;
    const removed = storeService.deleteCatalogueProduct(id);
    if (!removed) {
      return res.status(404).json({ success: false, error: `Product with ID ${id} not found.` });
    }
    res.json({ success: true, message: 'Product deleted.' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
};

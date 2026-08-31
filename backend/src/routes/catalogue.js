const express = require('express');
const router = express.Router();
const catalogueController = require('../controllers/catalogueController');

router.get('/', catalogueController.getProducts);
router.post('/', catalogueController.addProduct);
router.put('/:id', catalogueController.updateProduct);
router.delete('/:id', catalogueController.deleteProduct);

module.exports = router;

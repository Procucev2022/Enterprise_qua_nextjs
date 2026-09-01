const express = require('express');
const router = express.Router();
const catalogueController = require('../controllers/catalogueController');
const { authenticate } = require('../middleware/auth');

router.get('/', catalogueController.getProducts);
router.post('/', authenticate, catalogueController.addProduct);
router.put('/:id', authenticate, catalogueController.updateProduct);
router.delete('/:id', authenticate, catalogueController.deleteProduct);

module.exports = router;

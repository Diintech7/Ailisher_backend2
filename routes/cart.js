const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const cartController = require('../controllers/cartController');

// All routes require mobile authentication and client in path
router.get('/', authenticateMobileUser, cartController.getCart);
router.post('/add', authenticateMobileUser, cartController.addItem);
router.post('/update', authenticateMobileUser, cartController.updateItem);
router.delete('/item/:workbookId', authenticateMobileUser, cartController.removeItem);
router.post('/clear', authenticateMobileUser, cartController.clearCart);
// Checkout flows
router.post('/checkout/item', authenticateMobileUser, cartController.checkoutItem);
router.post('/callback',cartController.paytmCallback)

module.exports = router;



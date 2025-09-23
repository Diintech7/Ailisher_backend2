const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const cartController = require('../controllers/cartController');

router.post('/callback',cartController.paytmCallback)
// All routes require mobile authentication and client in path
router.use(authenticateMobileUser);

router.get('/', cartController.getCart);
router.post('/add', cartController.addItem);
router.post('/update', cartController.updateItem);
router.delete('/item/:workbookId', cartController.removeItem);
router.post('/clear', cartController.clearCart);
// Checkout flows
router.post('/checkout/item', cartController.checkoutItem);

module.exports = router;



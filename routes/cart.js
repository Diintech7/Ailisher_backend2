const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const cartController = require('../controllers/cartController');

// All routes require mobile authentication and client in path
router.use(authenticateMobileUser);

router.get('/', cartController.getCart);
router.post('/add', cartController.addItem);
router.post('/update', cartController.updateItem);
router.delete('/item/:workbookId', cartController.removeItem);
router.post('/clear', cartController.clearCart);
router.post('/checkout', cartController.checkout);

module.exports = router;



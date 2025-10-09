const express = require('express');
const router = express.Router();
const { authenticateMobileUser, ensureUserBelongsToClient } = require('../middleware/mobileAuth');
const { getCreditAccount, getCreditTransactions, getCreditRechargePlans, getCreditRechargePlanById, getCreditRechargePlansWithItems, getCreditRechargePlansWithoutItems, getOrders, getOrderDetails, getPaymentByOrderId, getOrderWithPayment, getOrdersByPlan, getOrdersByPlanAdmin, getUserOrders, getOrdersForUser, getSucessOrdersByPlan, getPendingOrdersByPlan, getFailedPaymentsByPlan, getPendingPaymentsByPlan, getPaymentsByPlanAndStatus, getPlanPaymentOverview, togglePlanStatus, togglePlanEnabled} = require('../controllers/creditManagement');

router.get('/account',authenticateMobileUser, getCreditAccount );

router.get('/transactions', authenticateMobileUser, getCreditTransactions );

router.get('/allPlans',authenticateMobileUser,getCreditRechargePlans)

router.get('/plans', authenticateMobileUser, getCreditRechargePlansWithItems);

router.get('/plans/without-items', authenticateMobileUser, getCreditRechargePlansWithoutItems);

router.get('/plan/:id',authenticateMobileUser, getCreditRechargePlanById);

// orders for a user
router.get('/orders', authenticateMobileUser,ensureUserBelongsToClient,getOrdersForUser);

// details of an order
router.get('/order/:orderId', authenticateMobileUser, getOrderDetails);

// Routes for getting orders by plan through client
router.get('/plan/:planId/orders', getSucessOrdersByPlan);

router.get('/plan/:planId/orders/failed', getFailedPaymentsByPlan);
router.get('/plan/:planId/orders/pending', getPendingPaymentsByPlan);
router.get('/plan/:planId/payment-overview', getPlanPaymentOverview);

router.patch('/plan/:planId/toggle-status', togglePlanStatus);
router.patch('/plan/:planId/toggle-enabled', togglePlanEnabled);

module.exports = router;
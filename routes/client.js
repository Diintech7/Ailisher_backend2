
// routes/client.js - Client routes
const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { verifyToken, isClient } = require('../middleware/auth');

// All routes require valid token and client role
router.use(verifyToken, isClient);

// Get client dashboard data
router.get('/dashboard', clientController.getDashboard);

//get all users
router.get('/users', clientController.getAllUsers);

// POST /api/clients/:clientId/mobile/auth/profile
router.get('/userprofile', clientController.getuserprofile);

//get all orders for client users
router.get('/orders', clientController.getClientOrders);

//get all credit recharge plans
router.get('/credit-recharge-plans', clientController.getCreditRechargePlans);

//create credit recharge plan
router.post('/credit-recharge-plans', clientController.createCreditRechargePlan);

// get one credit recharge plan
router.get('/credit-recharge-plans/:id', clientController.getCreditRechargePlanById);

// update credit recharge plan
router.put('/credit-recharge-plans/:id', clientController.updateCreditRechargePlan);

// delete credit recharge plan
router.delete('/credit-recharge-plans/:id', clientController.deleteCreditRechargePlan);

// add/delete single plan item
router.post('/credit-recharge-plans/:planId/items', clientController.addCreditRechargePlanItem);

router.delete('/credit-recharge-plans/:planId/items/:itemId', clientController.deleteCreditRechargePlanItem);

router.get('/:userId/analytics',verifyToken, clientController.getAppAnalytics);
// Additional routes would go here
// Such as routes for managing AI books, workbooks, agents, users, etc.

module.exports = router;
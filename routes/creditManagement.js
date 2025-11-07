const express = require('express');
const router = express.Router();
const { authenticateMobileUser, ensureUserBelongsToClient } = require('../middleware/mobileAuth');
const { getCreditAccount, getCreditTransactions, getCreditRechargePlans, getCreditRechargePlanById, getCreditRechargePlansWithItems, getCreditRechargePlansWithoutItems, getOrders, getOrderDetails, getPaymentByOrderId, getOrderWithPayment, getOrdersByPlan, getOrdersByPlanAdmin, getUserOrders, getOrdersForUser, getSucessOrdersByPlan, getPendingOrdersByPlan, getFailedPaymentsByPlan, getPendingPaymentsByPlan, getPaymentsByPlanAndStatus, getPlanPaymentOverview, togglePlanStatus, togglePlanEnabled} = require('../controllers/creditManagement');
const UserPlan = require('../models/UserPlan');
const CreditAccount = require('../models/CreditAccount');
const UserProfile = require('../models/UserProfile');
const MobileUser = require('../models/MobileUser');
const CreditRechargePlan = require('../models/CreditRechargePlan');

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

// Grant a time-bound trial plan (client-scoped)
router.post('/trial/grant', async (req, res) => {
  try {
    const clientId = req.clientId;
    const { profileId, planId } = req.body || {};
    if (!clientId) return res.status(400).json({ success: false, message: 'Missing clientId' });
    if (!profileId) return res.status(400).json({ success: false, message: 'Provide profileId or mobileUserId' });

    // Resolve profile and mobile details
    let profile = null;
    if (profileId) {
      profile = await UserProfile.findOne({ _id: profileId, clientId });
    } 
    if (!profile) return res.status(404).json({ success: false, message: 'User profile not found for client' });
    const mobileUser = await MobileUser.findOne({ _id: profile.userId, clientId });
    if (!mobileUser) return res.status(404).json({ success: false, message: 'Mobile user not found for client' });

    // Determine trial plan
    let plan = null;
    if (planId) {
      const now = new Date();
      plan = await CreditRechargePlan.findOne({
        _id: planId,
        clientId,
        category: 'Trial',
        status: 'active',
        isEnabled: true,
        offerEndAt: { $gte: now },
        $or: [ { offerStartAt: { $exists: false } }, { offerStartAt: null }, { offerStartAt: { $lte: now } } ]
      });
      if (!plan) return res.status(404).json({ success: false, message: 'Trial plan not found or not active' });
    } else {
      const now = new Date();
      plan = await CreditRechargePlan.findOne({
        clientId,
        category: 'Trial',
        status: 'active',
        isEnabled: true,
        offerEndAt: { $gte: now },
        $or: [ { offerStartAt: { $exists: false } }, { offerStartAt: null }, { offerStartAt: { $lte: now } } ]
      }).sort({ updatedAt: -1 });
      if (!plan) return res.status(404).json({ success: false, message: 'No active Trial plan configured for this client' });
    }

    const effDuration = plan.duration
    const effCredits = plan.credits

    // Upsert credit account
    let creditAccount = await CreditAccount.findOne({ userId: profile._id });
    if (!creditAccount) {
      creditAccount = await CreditAccount.create({
        userId: profile._id,
        name: profile.name || '',
        mobile: mobileUser.mobile,
        clientId,
        planId: plan ? [plan._id] : [],
        balance: 0,
      });
    }

    // Create trial user plan
    const now = new Date();
    const endDate = new Date(now.getTime() + Number(effDuration) * 24 * 60 * 60 * 1000);
    const userPlan = await UserPlan.create({
      userId: profile._id,
      planId: plan?._id,
      clientId,
      orderId: `TRIAL-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      creditsGranted: Number(effCredits) || 0,
      startDate: now,
      endDate,
      status: 'active',
      trial: true,
    });

    // Credit the account if credits > 0
    if (Number(effCredits) > 0) {
      creditAccount.balance = (creditAccount.balance || 0) + Number(effCredits);
      creditAccount.totalEarned = (creditAccount.totalEarned || 0) + Number(effCredits);
      if (plan?._id) {
        const has = (creditAccount.planId || []).some(id => String(id) === String(plan._id));
        if (!has) creditAccount.planId.push(plan._id);
      }
      creditAccount.lastTransactionDate = new Date();
      await creditAccount.save();
    }

    return res.status(200).json({ success: true, data: { userPlan, creditAccount, plan } });
  } catch (e) {
    console.error('[Trial][Grant] error:', e && e.message);
    return res.status(500).json({ success: false, message: 'Failed to grant trial' });
  }
});

// Cancel a trial (client-scoped)
router.patch('/trial/:userPlanId/cancel', async (req, res) => {
  try {
    const clientId = req.clientId;
    const { userPlanId } = req.params;
    const userPlan = await UserPlan.findOne({ _id: userPlanId, clientId });
    if (!userPlan) return res.status(404).json({ success: false, message: 'UserPlan not found' });
    if (!userPlan.trial) return res.status(400).json({ success: false, message: 'Not a trial plan' });
    if (userPlan.status !== 'cancelled') {
      userPlan.status = 'cancelled';
      await userPlan.save();
    }
    return res.status(200).json({ success: true, data: { userPlan } });
  } catch (e) {
    console.error('[Trial][Cancel] error:', e && e.message);
    return res.status(500).json({ success: false, message: 'Failed to cancel trial' });
  }
});

// Get active trial plan for a given profile (client scoped)
router.get('/trial/user/:profileId/active', async (req, res) => {
  try {
    const clientId = req.clientId;
    const { profileId } = req.params;
    if (!clientId || !profileId) {
      return res.status(400).json({ success: false, message: 'Missing clientId or profileId' });
    }
    const now = new Date();
    const userPlan = await UserPlan.findOne({
      userId: profileId,
      clientId,
      trial: true,
      status: 'active',
      $or: [ { endDate: null }, { endDate: { $gt: now } } ]
    }).sort({ updatedAt: -1 }).lean();
    if (!userPlan) return res.status(200).json({ success: true, data: null });
    let plan = null;
    if (userPlan.planId) {
      plan = await CreditRechargePlan.findById(userPlan.planId).lean();
    }
    return res.status(200).json({ success: true, data: { userPlan, plan } });
  } catch (e) {
    console.error('[Trial][Active] error:', e && e.message);
    return res.status(500).json({ success: false, message: 'Failed to fetch active trial' });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const { getCreditAccount, getCreditTransactions, getCreditRechargePlans} = require('../controllers/creditManagement');

router.get('/account',authenticateMobileUser, getCreditAccount );

// router.get('/plans', authenticateMobileUser, getCreditPlans );

// router.post('/buy-credits', authenticateMobileUser, buyCredits );

// router.get('/get-credits', authenticateMobileUser, getCredit );

router.get('/transactions', authenticateMobileUser, getCreditTransactions );

// router.get('/:creditId/balance', authenticateMobileUser, getCreditBalance );

// router.post('/use-credits', authenticateMobileUser, useCreditsForService );

router.get('/recharge-plans',authenticateMobileUser, getCreditRechargePlans)

module.exports = router;
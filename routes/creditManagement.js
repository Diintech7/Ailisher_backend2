const express = require('express');
const router = express.Router();
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const { getCreditAccount, getCreditTransactions, getCreditRechargePlans, getCreditRechargePlanById} = require('../controllers/creditManagement');

router.get('/account',authenticateMobileUser, getCreditAccount );

router.get('/transactions', authenticateMobileUser, getCreditTransactions );

router.get('/plans',authenticateMobileUser, getCreditRechargePlans);

router.get('/plan/:id',authenticateMobileUser, getCreditRechargePlanById);

module.exports = router;
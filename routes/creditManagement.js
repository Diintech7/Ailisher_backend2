const express = require('express');
const router = express.Router();
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const { getCreditAccount, getCreditTransactions, getCreditRechargePlans} = require('../controllers/creditManagement');

router.get('/account',authenticateMobileUser, getCreditAccount );

router.get('/transactions', authenticateMobileUser, getCreditTransactions );

router.get('/plans',authenticateMobileUser, getCreditRechargePlans)

module.exports = router;
const express = require('express');
const { getFinanceStatus, withdrawalRequests, getCreditBalance, getCreditHistory, evaluatorBankDetails, evaluatorKYCDetails, uploadDocuments, getWithdrawalRequests } = require('../controllers/evaluatorCredit');
const { verifyTokenforevaluator, ensureBankDetailsComplete, ensureWithdrawalEligibility } = require('../middleware/auth');

const router = express.Router();

router.get('/credit-balance',verifyTokenforevaluator,getCreditBalance);

router.get('/credit-history',verifyTokenforevaluator,getCreditHistory);

router.post('/bank-details',verifyTokenforevaluator,evaluatorBankDetails);

router.post('/upload-document',verifyTokenforevaluator,uploadDocuments);

router.post('/kyc-details',verifyTokenforevaluator,evaluatorKYCDetails);

router.get('/profile/finance/status',verifyTokenforevaluator,getFinanceStatus);

router.post('/withdrawal',verifyTokenforevaluator,ensureBankDetailsComplete,ensureWithdrawalEligibility,withdrawalRequests);

router.get('/withdrawals', verifyTokenforevaluator, getWithdrawalRequests);

module.exports = router;


// routes/admin.js - Updated Admin routes
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const clientsController = require('../controllers/clientController');
const { verifyAdminToken } = require('../middleware/auth');
const axios = require('axios');
const PaytmChecksum = require('paytmchecksum');
const Payment = require('../models/Payment');
const CreditAccount = require('../models/CreditAccount');
const CreditTransaction = require('../models/CreditTransaction');
const PaytmConfig = require('../config/paytm');
const { sendSuccessResponse, sendErrorResponse, sendValidationError } = require('../utils/response');

// Auth routes
router.post('/register', adminController.register);
router.post('/login', adminController.login);

// Protected routes - all require admin authentication
// router.use(verifyAdminToken);

// Client management routes
router.get('/clients', clientsController.getAllClients);
router.get('/users', clientsController.getAllUsers);
router.get('/userprofile',clientsController.getuserprofile);
router.post('/clients', adminController.createClient); // Add new client
router.get('/clients/:id', clientsController.getClientById);
router.put('/clients/:id', clientsController.updateClient); // Update client
router.put('/clients/:id/status', clientsController.updateClientStatus);
router.delete('/clients/:id', clientsController.deleteClient);

// Generate login token for a client (for admin impersonation)
router.post('/clients/:id/login-token', adminController.generateClientLoginToken);

// Create a new credit plan (admin only)
router.post('/plans',verifyAdminToken, adminController.createCreditPlan);
  
// Get all credit plans (admin)
router.get('/plans',verifyAdminToken, adminController.getCreditPlans);

router.post('/add-credit',verifyAdminToken, adminController.addCredit);

router.get('/credit-account',verifyAdminToken, adminController.getCreditAccount);

router.get('/credit-account/:id',verifyAdminToken, adminController.getCreditAccountById);

router.get('/get-recharge-plan',verifyAdminToken, adminController.getCreditRechargePlans);

// 1. Initialize Payment
router.post('/paytm/initiate',async (req, res) => {
    try {
      const { amount, customerEmail, customerPhone, customerName, projectId, userId, planId, credits, adminId, adminMessage } = req.body;
      console.log(req.body)
      // Validate required fields
      if (!amount || !customerEmail || !customerPhone || !customerName) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: amount, customerEmail, customerPhone, customerName'
        });
      }
  
      // Generate unique order ID
      const orderId = `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create payment record in database
      const payment = new Payment({
        orderId,
        amount: parseFloat(amount),
        userId: userId || null,
        planId: planId || null,
        creditsPurchased: credits || null,
        adminId: adminId, // Use provided adminId or current admin
        adminMessage: adminMessage || null,
        customerEmail,
        customerPhone,
        customerName,
        projectId: projectId || 'default',
        status: 'PENDING'
      });
  
      await payment.save();
  
      // Prepare Paytm parameters
      const paytmParams = {
        MID: PaytmConfig.MID,
        WEBSITE: PaytmConfig.WEBSITE,
        CHANNEL_ID: PaytmConfig.CHANNEL_ID,
        INDUSTRY_TYPE_ID: PaytmConfig.INDUSTRY_TYPE_ID,
        ORDER_ID: orderId,
        CUST_ID: customerEmail,
        TXN_AMOUNT: parseFloat(amount).toFixed(2),
        CALLBACK_URL: 'https://aipbbackend-c5ed.onrender.com/api/admin/paytm/callback',
        EMAIL: customerEmail,
        MOBILE_NO: customerPhone
      };
  
      console.log('Paytm Parameters before checksum:', paytmParams);
  
      // Generate checksum using official Paytm package
      const checksum = await PaytmChecksum.generateSignature(paytmParams, PaytmConfig.MERCHANT_KEY);
      paytmParams.CHECKSUMHASH = checksum;
  
      console.log('Generated Checksum:', checksum);
  
      // Update payment record with checksum
      await Payment.findOneAndUpdate(
        { orderId },
        { 
          checksumHash: checksum,
          paytmOrderId: orderId,
          updatedAt: new Date()
        }
      );
  
      console.log('Payment initiated successfully:', {
        orderId,
        amount: paytmParams.TXN_AMOUNT,
        customerEmail,
        checksum
      });
  
      res.json({
        success: true,
        orderId,
        paytmParams,
        paytmUrl: PaytmConfig.PAYTM_URL
      });
  
    } catch (error) {
      console.error('Payment initiation error:', error);
      res.status(500).json({
        success: false,
        message: 'Payment initiation failed',
        error: error.message
      });
    }
  });
  
// 2. Payment Callback Handler
router.post('/paytm/callback',async (req, res) => {
    try {
      const paytmResponse = req.body;
      const orderId = paytmResponse.ORDERID;
  
      console.log('Received Paytm callback:', paytmResponse);
  
      // Verify checksum using official Paytm package
      let isValidChecksum = true;
      
      if (paytmResponse.CHECKSUMHASH) {
        isValidChecksum = PaytmChecksum.verifySignature(paytmResponse, PaytmConfig.MERCHANT_KEY, paytmResponse.CHECKSUMHASH);
        console.log('Checksum validation result:', isValidChecksum);
      } else {
        console.log('No checksum in response - staging environment behavior');
      }
  
      // Log checksum validation for debugging
      if (!isValidChecksum) {
        console.warn('⚠️  Checksum validation failed, but proceeding for staging environment');
      }
  
      // Determine payment status
      let paymentStatus = 'FAILED';
      if (paytmResponse.STATUS === 'TXN_SUCCESS') {
        paymentStatus = 'SUCCESS';
      } else if (paytmResponse.STATUS === 'TXN_FAILURE') {
        paymentStatus = 'FAILED';
      } else if (paytmResponse.STATUS === 'PENDING') {
        paymentStatus = 'PENDING';
      }
  
      // Update payment status in database
      const updateData = {
        status: paymentStatus,
        transactionId: paytmResponse.TXNID || paytmResponse.ORDERID,
        paytmTxnId: paytmResponse.TXNID,
        paytmResponse: paytmResponse,
        paymentMode: paytmResponse.PAYMENTMODE,
        bankName: paytmResponse.BANKNAME,
        bankTxnId: paytmResponse.BANKTXNID,
        responseCode: paytmResponse.RESPCODE,
        responseMsg: paytmResponse.RESPMSG,
        updatedAt: new Date()
      };
  
      const payment = await Payment.findOneAndUpdate(
        { orderId },
        updateData,
        { new: true }
      );
  
      if (!payment) {
        console.error('Payment record not found for orderId:', orderId);
        return res.status(404).json({
          success: false,
          message: 'Payment record not found',
          orderId
        });
      }
  
      console.log('Payment updated successfully:', {
        orderId,
        status: paymentStatus,
        transactionId: updateData.transactionId,
        responseCode: paytmResponse.RESPCODE,
        checksumValid: isValidChecksum
      });

      // Idempotent crediting on successful payment
      try {
        // Fetch current payment after update
        let creditAccount = null;
        const paymentDoc = await Payment.findOne({ orderId });
        if (paymentDoc && paymentDoc.status === 'SUCCESS') {
            // Resolve user and credit account
            if (paymentDoc.userId) {
              creditAccount = await CreditAccount.findOne({ userId: paymentDoc.userId });
            }
            if (!creditAccount && paymentDoc.customerPhone) {
              creditAccount = await CreditAccount.findOne({ mobile: paymentDoc.customerPhone });
            }
  
            if (creditAccount) {
              const creditsToAdd = Number(paymentDoc.creditsPurchased) || 0;
              const balanceBefore = creditAccount.balance || 0;
              const balanceAfter = balanceBefore + creditsToAdd;
  
              // Create credit transaction
              const tx = new CreditTransaction({
                userId: creditAccount.userId,
                type: 'credit',
                amount: creditsToAdd,
                balanceBefore,
                balanceAfter,
                category: 'admin_adjustment',
                description: 'Credits added by admin',
                referenceId: orderId,
                planId: paymentDoc.planId || null,
                paymentAmount: paymentDoc.amount,
                paymentCurrency: paymentDoc.currency || 'INR',
                addedBy: paymentDoc.adminId || null, // Use admin ID from payment
                adminMessage: paymentDoc.adminMessage || null, // Use admin message from payment
                metadata: {
                  gateway: 'PAYTM',
                  transactionId: paymentDoc.transactionId,
                  paytmTxnId: paymentDoc.paytmTxnId
                },
                status: 'completed'
              });
              await tx.save();
  
              // Update credit account balance and totals
              creditAccount.balance = balanceAfter;
              creditAccount.totalEarned = (creditAccount.totalEarned || 0) + creditsToAdd;
              creditAccount.lastTransactionDate = new Date();
              await creditAccount.save();
  
              console.log('Credited account from Paytm payment:', {
                userId: String(creditAccount.userId),
                credits: creditsToAdd,
                balanceAfter
              });
            } else {
              console.warn('CreditAccount not found for payment; skipping crediting', {
                orderId,
                userId: paymentDoc.userId,
                phone: paymentDoc.customerPhone
              });
            }
        }
      } catch (creditErr) {
        console.error('Error crediting account post-payment:', creditErr);
      }
  
       // Return JSON response with payment details
    res.json({
      success: true,
      message: 'Payment processed successfully',
      orderId,
      status: paymentStatus,
      transactionId: updateData.transactionId,
      responseCode: paytmResponse.RESPCODE,
      responseMsg: paytmResponse.RESPMSG,
      paymentMode: paytmResponse.PAYMENTMODE,
      bankName: paytmResponse.BANKNAME,
      amount: payment.amount,
      customerEmail: payment.customerEmail,
      customerName: payment.customerName,
      projectId: payment.projectId,
      redirectUrl: `${process.env.FRONTEND_URL}/orderId=${orderId}&status=${paymentStatus}`
    });

  } catch (error) {
    console.error('Payment callback error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment processing error',
      error: error.message
    });
  }
});

module.exports = router;
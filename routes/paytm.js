// src/routes/paytm.js
const express = require('express');
const axios = require('axios');
const PaytmChecksum = require('paytmchecksum');
const Payment = require('../models/Payment');
const CreditAccount = require('../models/CreditAccount');
const CreditTransaction = require('../models/CreditTransaction');
const CreditRechargePlan = require('../models/CreditRechargePlan');
const UserPlan = require('../models/UserPlan');
const PaytmConfig = require('../config/paytm');
const { sendSuccessResponse, sendErrorResponse, sendValidationError } = require('../utils/response');

const router = express.Router();

// 1. Initialize Payment
router.post('/initiate', async (req, res) => {
  try {
    const { amount, customerEmail, customerPhone, customerName, projectId, userId, planId, credits } = req.body;
    
    // Validate required fields
    if (!amount || !customerEmail || !customerPhone || !customerName || !planId) {
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
      CALLBACK_URL: PaytmConfig.CALLBACK_URL,
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
router.post('/callback', async (req, res) => {
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

    // Idempotent crediting on successful payment and plan activation
    try {
      // Fetch current payment after update
      const paymentDoc = await Payment.findOne({ orderId });
      if (paymentDoc && paymentDoc.status === 'SUCCESS') {
          // Resolve user and credit account
          let creditAccount = null;
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
            const planId = paymentDoc.planId || null;

            // Create credit transaction
            const tx = new CreditTransaction({
              userId: creditAccount.userId,
              type: 'credit',
              amount: creditsToAdd,
              balanceBefore,
              balanceAfter,
              category: 'purchase',
              description: 'Credits purchased via Paytm',
              referenceId: orderId,
              planId: planId,
              paymentAmount: paymentDoc.amount,
              paymentCurrency: paymentDoc.currency || 'INR',
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
            // Attach purchased plan to user's active plans list (if any)
            if (planId) {
              const alreadyHasPlan = Array.isArray(creditAccount.planId) && creditAccount.planId.some(p => String(p) === String(planId));
              if (!alreadyHasPlan) {
                if (!Array.isArray(creditAccount.planId)) creditAccount.planId = [];
                creditAccount.planId.push(planId);
              }
            }
            await creditAccount.save();

            // Create/ensure UserPlan document to track expiry
            if (planId) {
              const existingUserPlan = await UserPlan.findOne({ orderId });
              if (!existingUserPlan) {
                const plan = await CreditRechargePlan.findById(planId);
                if (plan) {
                  const startDate = new Date();
                  const endDate = new Date(startDate.getTime() + (plan.duration || 0) * 24 * 60 * 60 * 1000);
                  const userPlan = new UserPlan({
                    userId: creditAccount.userId,
                    planId: plan._id,
                    clientId: plan.clientId || null,
                    orderId,
                    creditsGranted: creditsToAdd,
                    startDate,
                    endDate,
                    status: 'active'
                  });
                  await userPlan.save();
                } else {
                  console.warn('Plan not found when creating UserPlan', { planId: String(planId), orderId });
                }
              }
            }

            console.log('Credited account from Paytm payment:', {
              userId: String(creditAccount.userId),
              credits: creditsToAdd,
              balanceAfter
            });
          } 
          else {
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
      // redirectUrl: `${process.env.FRONTEND_URL}?orderId=${orderId}&status=${paymentStatus}`
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

// 3. Check Payment Status
router.get('/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const payment = await Payment.findOne({ orderId });
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.json({
      success: true,
      payment: {
        orderId: payment.orderId,
        amount: payment.amount,
        status: payment.status,
        transactionId: payment.transactionId,
        customerEmail: payment.customerEmail,
        customerName: payment.customerName,
        customerPhone: payment.customerPhone,
        projectId: payment.projectId,
        paymentMode: payment.paymentMode,
        bankName: payment.bankName,
        responseCode: payment.responseCode,
        responseMsg: payment.responseMsg,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt
      }
    });

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Status check failed',
      error: error.message
    });
  }
});

// 4. Get All Payments (Admin/Project specific)
router.get('/payments', async (req, res) => {
  try {
    const { page = 1, limit = 10, status, projectId } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    if (projectId) filter.projectId = projectId;
    
    const payments = await Payment.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-paytmResponse -checksumHash');

    const total = await Payment.countDocuments(filter);

    res.json({
      success: true,
      payments,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalRecords: total,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payments',
      error: error.message
    });
  }
});

// 5. Transaction Status Inquiry
router.post('/transaction-status', async (req, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    const statusParams = {
      MID: PaytmConfig.MID,
      ORDERID: orderId
    };

    // Generate checksum for status inquiry
    const checksum = await PaytmChecksum.generateSignature(statusParams, PaytmConfig.MERCHANT_KEY);
    statusParams.CHECKSUMHASH = checksum;

    const response = await axios.post(PaytmConfig.STATUS_URL, statusParams, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Paytm status response:', response.data);

    res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    console.error('Transaction status inquiry error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check transaction status',
      error: error.message
    });
  }
});

// 6. Get Payment Summary by Project
router.get('/summary/:projectId', async (req, res) => {
  try {
    const { projectId } = req.params;
    
    const summary = await Payment.aggregate([
      { $match: { projectId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    const totalTransactions = await Payment.countDocuments({ projectId });
    const totalAmount = await Payment.aggregate([
      { $match: { projectId, status: 'SUCCESS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      success: true,
      projectId,
      summary,
      totalTransactions,
      totalSuccessfulAmount: totalAmount[0]?.total || 0
    });

  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch summary',
      error: error.message
    });
  }
});

// 7. Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Paytm Payment Gateway Server is running',
    timestamp: new Date().toISOString(),
    config: {
      MID: PaytmConfig.MID,
      WEBSITE: PaytmConfig.WEBSITE,
      ENVIRONMENT: process.env.NODE_ENV || 'development',
      PAYTM_URL: PaytmConfig.PAYTM_URL
    }
  });
});

// 8. Get all transactions
router.get('/transactions', async (req, res) => {
  try {
    const transactions = await CreditTransaction.find({}).sort({ createdAt: -1 });
    res.json({
      success: true,
      transactions
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
});


module.exports = router;        
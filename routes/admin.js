// routes/admin.js - Updated Admin routes
const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const clientsController = require("../controllers/clientController");
const { verifyAdminToken } = require("../middleware/auth");
const axios = require("axios");
const PaytmChecksum = require("paytmchecksum");
const Payment = require("../models/Payment");
const CreditAccount = require("../models/CreditAccount");
const CreditTransaction = require("../models/CreditTransaction");
const PaytmConfig = require("../config/paytm");
const {
  sendSuccessResponse,
  sendErrorResponse,
  sendValidationError,
} = require("../utils/response");
const Evaluator = require("../models/Evaluator");
const EvaluatorWithdrawalRequest = require("../models/EvaluatorWithdrawalRequest");
const {
  validateAdminWithdrawalAction,
  validateCreditAdjustment,
} = require("../middleware/withdrawalValidation");

// Auth routes
router.post("/register", adminController.register);
router.post("/login", adminController.login);

// Protected routes - all require admin authentication
// router.use(verifyAdminToken);

// Client management routes
router.get("/clients", clientsController.getAllClients);
router.get("/users", clientsController.getAllUsers);
router.get("/userprofile", adminController.getuserprofile);
router.post("/clients", adminController.createClient); // Add new client
router.get("/clients/:id", clientsController.getClientById);
router.put("/clients/:id", clientsController.updateClient); // Update client
router.put("/clients/:id/status", clientsController.updateClientStatus);
router.delete("/clients/:id", clientsController.deleteClient);

// Generate login token for a client (for admin impersonation)
router.post(
  "/clients/:id/login-token",
  adminController.generateClientLoginToken
);

// Create a new credit plan (admin only)
router.post("/plans", verifyAdminToken, adminController.createCreditPlan);

// Get all credit plans (admin)
router.get("/plans", verifyAdminToken, adminController.getCreditPlans);

router.post("/add-credit", verifyAdminToken, adminController.addCredit);

router.get(
  "/credit-account",
  verifyAdminToken,
  adminController.getCreditAccount
);

router.get(
  "/credit-account/:id",
  verifyAdminToken,
  adminController.getCreditAccountById
);

router.get(
  "/:id/get-recharge-plan",
  verifyAdminToken,
  adminController.getCreditRechargePlans
);

// 1. Initialize Payment
router.post("/paytm/initiate", async (req, res) => {
  try {
    const {
      amount,
      customerEmail,
      customerPhone,
      customerName,
      projectId,
      userId,
      planId,
      credits,
      adminId,
      adminMessage,
    } = req.body;
    console.log(req.body);
    // Validate required fields
    if (!amount || !customerEmail || !customerPhone || !customerName) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: amount, customerEmail, customerPhone, customerName",
      });
    }

    // Generate unique order ID
    const orderId = `ORDER_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

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
      projectId: projectId || "default",
      status: "PENDING",
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
      CALLBACK_URL: "https://test.ailisher.com/api/admin/paytm/callback",
      EMAIL: customerEmail,
      MOBILE_NO: customerPhone,
    };

    console.log("Paytm Parameters before checksum:", paytmParams);

    // Generate checksum using official Paytm package
    const checksum = await PaytmChecksum.generateSignature(
      paytmParams,
      PaytmConfig.MERCHANT_KEY
    );
    paytmParams.CHECKSUMHASH = checksum;

    console.log("Generated Checksum:", checksum);

    // Update payment record with checksum
    await Payment.findOneAndUpdate(
      { orderId },
      {
        checksumHash: checksum,
        paytmOrderId: orderId,
        updatedAt: new Date(),
      }
    );

    console.log("Payment initiated successfully:", {
      orderId,
      amount: paytmParams.TXN_AMOUNT,
      customerEmail,
      checksum,
    });

    res.json({
      success: true,
      orderId,
      paytmParams,
      paytmUrl: PaytmConfig.PAYTM_URL,
    });
  } catch (error) {
    console.error("Payment initiation error:", error);
    res.status(500).json({
      success: false,
      message: "Payment initiation failed",
      error: error.message,
    });
  }
});

// 2. Payment Callback Handler
router.post("/paytm/callback", async (req, res) => {
  try {
    const paytmResponse = req.body;
    const orderId = paytmResponse.ORDERID;

    console.log("Received Paytm callback:", paytmResponse);

    // Verify checksum using official Paytm package
    let isValidChecksum = true;

    if (paytmResponse.CHECKSUMHASH) {
      isValidChecksum = PaytmChecksum.verifySignature(
        paytmResponse,
        PaytmConfig.MERCHANT_KEY,
        paytmResponse.CHECKSUMHASH
      );
      console.log("Checksum validation result:", isValidChecksum);
    } else {
      console.log("No checksum in response - staging environment behavior");
    }

    // Log checksum validation for debugging
    if (!isValidChecksum) {
      console.warn(
        "⚠️  Checksum validation failed, but proceeding for staging environment"
      );
    }

    // Determine payment status
    let paymentStatus = "FAILED";
    if (paytmResponse.STATUS === "TXN_SUCCESS") {
      paymentStatus = "SUCCESS";
    } else if (paytmResponse.STATUS === "TXN_FAILURE") {
      paymentStatus = "FAILED";
    } else if (paytmResponse.STATUS === "PENDING") {
      paymentStatus = "PENDING";
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
      updatedAt: new Date(),
    };

    const payment = await Payment.findOneAndUpdate({ orderId }, updateData, {
      new: true,
    });

    if (!payment) {
      console.error("Payment record not found for orderId:", orderId);
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
        orderId,
      });
    }

    console.log("Payment updated successfully:", {
      orderId,
      status: paymentStatus,
      transactionId: updateData.transactionId,
      responseCode: paytmResponse.RESPCODE,
      checksumValid: isValidChecksum,
    });

    // Idempotent crediting on successful payment
    try {
      // Fetch current payment after update
      let creditAccount = null;
      const paymentDoc = await Payment.findOne({ orderId });
      if (paymentDoc && paymentDoc.status === "SUCCESS") {
        // Resolve user and credit account
        if (paymentDoc.userId) {
          creditAccount = await CreditAccount.findOne({
            userId: paymentDoc.userId,
          });
        }
        if (!creditAccount && paymentDoc.customerPhone) {
          creditAccount = await CreditAccount.findOne({
            mobile: paymentDoc.customerPhone,
          });
        }

        if (creditAccount) {
          const creditsToAdd = Number(paymentDoc.creditsPurchased) || 0;
          const balanceBefore = creditAccount.balance || 0;
          const balanceAfter = balanceBefore + creditsToAdd;

          // Create credit transaction
          const tx = new CreditTransaction({
            userId: creditAccount.userId,
            type: "credit",
            amount: creditsToAdd,
            balanceBefore,
            balanceAfter,
            category: "admin_adjustment",
            description: "Credits added by admin",
            referenceId: orderId,
            planId: paymentDoc.planId || null,
            paymentAmount: paymentDoc.amount,
            paymentCurrency: paymentDoc.currency || "INR",
            addedBy: paymentDoc.adminId || null, // Use admin ID from payment
            adminMessage: paymentDoc.adminMessage || null, // Use admin message from payment
            metadata: {
              gateway: "PAYTM",
              transactionId: paymentDoc.transactionId,
              paytmTxnId: paymentDoc.paytmTxnId,
            },
            status: "completed",
          });
          await tx.save();

          // Update credit account balance and totals
          creditAccount.balance = balanceAfter;
          creditAccount.totalEarned =
            (creditAccount.totalEarned || 0) + creditsToAdd;
          creditAccount.lastTransactionDate = new Date();
          // Attach purchased plan to user's active plans list (if any)
          if (paymentDoc.planId) {
            const alreadyHasPlan =
              Array.isArray(creditAccount.planId) &&
              creditAccount.planId.some(
                (p) => String(p) === String(paymentDoc.planId)
              );
            if (!alreadyHasPlan) {
              if (!Array.isArray(creditAccount.planId))
                creditAccount.planId = [];
              creditAccount.planId.push(paymentDoc.planId);
            }
          }
          await creditAccount.save();
          console.log("Credited account from Paytm payment:", {
            userId: String(creditAccount.userId),
            credits: creditsToAdd,
            balanceAfter,
          });
        } else {
          console.warn(
            "CreditAccount not found for payment; skipping crediting",
            {
              orderId,
              userId: paymentDoc.userId,
              phone: paymentDoc.customerPhone,
            }
          );
        }
      }
    } catch (creditErr) {
      console.error("Error crediting account post-payment:", creditErr);
    }

    // Return JSON response with payment details
    res.json({
      success: true,
      message: "Payment processed successfully",
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
      // redirectUrl: `${process.env.FRONTEND_URL}/orderId=${orderId}&status=${paymentStatus}`
    });
  } catch (error) {
    console.error("Payment callback error:", error);
    res.status(500).json({
      success: false,
      message: "Payment processing error",
      error: error.message,
    });
  }
});

// 3. Check Payment Status
router.get("/paytm/status/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const payment = await Payment.findOne({ orderId });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
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
        updatedAt: payment.updatedAt,
      },
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({
      success: false,
      message: "Status check failed",
      error: error.message,
    });
  }
});

router.post(
  "/evaluators/:id/kyc/verify",
  verifyAdminToken,
  async (req, res) => {
  try {
    const evaluatorId = req.params.id;
    const evaluator = await Evaluator.findByIdAndUpdate(evaluatorId);
      if (!evaluator) {
      return res.status(404).json({
          success: false,
          message: "evaluator not found",
        });
      }
      evaluator.kycDetails.status = "verified";
    evaluator.kycDetails.verifiedAt = new Date();
    evaluator.kycDetails.verifiedBy = req.admin._id;
    evaluator.withdrawalSettings.withdrawalEnabled = true;

    await evaluator.save();
    return res.json({
        success: true,
        message: "kyc verified",
      });
    } catch (error) {
    return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

router.post(
  "/evaluators/:id/kyc/reject",
  verifyAdminToken,
  async (req, res) => {
  try {
    const evaluatorId = req.params.id;
      const { reason } = req.body;
    const evaluator = await Evaluator.findById(evaluatorId);
      (evaluator.kycDetails.status = "rejected"),
        (evaluator.kycDetails.rejectionReason = reason);
    evaluator.withdrawalSettings.withdrawalEnabled = false;

    await evaluator.save();
    return res.json({
        success: true,
        message: "kyc rejected",
      });
    } catch (error) {
    return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// Get all withdrawal requests with filtering
router.get("/withdrawals", verifyAdminToken, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const withdrawals = await EvaluatorWithdrawalRequest.find(filter)
      .populate("evaluatorId", "name email phoneNumber")
      .populate("processedBy", "name email")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await EvaluatorWithdrawalRequest.countDocuments(filter);

    return res.json({
      success: true,
      data: withdrawals,
      count: total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// Get withdrawal request by ID
router.get("/withdrawals/:requestId", verifyAdminToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const withdrawal = await EvaluatorWithdrawalRequest.findById(requestId)
      .populate("evaluatorId", "name email phoneNumber bankDetails kycDetails")
      .populate("processedBy", "name email");

    if (!withdrawal) {
      return res
        .status(404)
        .json({ success: false, message: "Withdrawal request not found" });
    }

    return res.json({ success: true, data: withdrawal });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/verified-kyc", verifyAdminToken, async (req, res) => {
  try {
    const evaluators = await Evaluator.find({
      "kycDetails.status": "verified",
    });
    const count = evaluators.length;
    return res.json({ success: true, data: evaluators, count });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/rejected-kyc", verifyAdminToken, async (req, res) => {
  try {
    const evaluators = await Evaluator.find({
      "kycDetails.status": "rejected",
    });
    const count = evaluators.length;
    return res.json({ success: true, data: evaluators, count });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// Admin dashboard analytics
router.get("/dashboard/analytics", verifyAdminToken, async (req, res) => {
  try {
    const EvaluatorCreditTransaction = require("../models/EvaluatorCreditTransaction");

    // Get withdrawal statistics
    const withdrawalStats = await EvaluatorWithdrawalRequest.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    // Get credit transaction statistics
    const creditStats = await EvaluatorCreditTransaction.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    // Get evaluator statistics
    const evaluatorStats = await Evaluator.aggregate([
      {
        $group: {
          _id: "$kycDetails.status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Get total credits in system
    const totalCredits = await Evaluator.aggregate([
      {
        $group: {
          _id: null,
          totalBalance: { $sum: "$creditBalance" },
          totalEarned: { $sum: "$totalCreditsEarned" },
          totalWithdrawn: { $sum: "$totalCreditsWithdrawn" },
        },
      },
    ]);

    return res.json({
      success: true,
      data: {
        withdrawals: withdrawalStats,
        credits: creditStats,
        evaluators: evaluatorStats,
        systemTotals: totalCredits[0] || {
          totalBalance: 0,
          totalEarned: 0,
          totalWithdrawn: 0,
        },
      },
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// Admin: approve a withdrawal request
router.post(
  "/withdrawals/:requestId/approve",
  verifyAdminToken,
  validateAdminWithdrawalAction,
  async (req, res) => {
  try {
    const { requestId } = req.params;
      const { adminComments } = req.body;

      const request = await EvaluatorWithdrawalRequest.findById(
        requestId
      ).populate("evaluatorId");
    if (!request) {
        return res
          .status(404)
          .json({ success: false, message: "Withdrawal request not found" });
      }

      if (request.status !== "pending") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Request is not in pending status",
          });
      }

      request.status = "approved";
      request.adminComments = adminComments || request.adminComments;
    request.processedBy = req.admin._id;
    await request.save();

      return res.json({
        success: true,
        message: "Withdrawal request approved",
        data: request,
      });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
  }
);

// Admin: reject a withdrawal request
router.post(
  "/withdrawals/:requestId/reject",
  verifyAdminToken,
  validateAdminWithdrawalAction,
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const { rejectionReason, adminComments } = req.body;

      if (!rejectionReason) {
        return res
          .status(400)
          .json({ success: false, message: "Rejection reason is required" });
      }

      const request = await EvaluatorWithdrawalRequest.findById(
        requestId
      ).populate("evaluatorId");
      if (!request) {
        return res
          .status(404)
          .json({ success: false, message: "Withdrawal request not found" });
      }

      if (request.status !== "pending") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Request is not in pending status",
          });
      }

      request.status = "rejected";
      request.rejectionReason = rejectionReason;
      request.adminComments = adminComments || request.adminComments;
      request.processedBy = req.admin._id;
      await request.save();

      return res.json({
        success: true,
        message: "Withdrawal request rejected",
        data: request,
      });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  }
);

// 1. Initialize Payment
router.post("/:requestId/initiate",verifyAdminToken, async (req, res) => {
  try {
    const { requestId } = req.params;
    const adminId = req.admin.id;
    const request = await EvaluatorWithdrawalRequest.findById(
      requestId
    ).populate("evaluatorId");
    console.log(request);
    if (!request) {
      return res
        .status(404)
        .json({ success: false, message: "Withdrawal request not found" });
    }
    const amount = Number(request.amount) || 0;
    const evaluator = request.evaluatorId || {};
    const customerEmail = evaluator.email || "unknown@example.com";
    const customerName = evaluator.name || "Unknown";
    const customerPhone = (evaluator.phoneNumber || "").toString();
    
    // // Validate required fields
    // if (!amount || !customerEmail || !customerPhone || !customerName) {
    //   return res.status(400).json({
    //     success: false,
    //     message:
    //       "Missing required fields: amount, customerEmail, customerPhone, customerName",
    //   });
    // }
    
    // Generate unique order ID
    const orderId = `ORDER_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Create payment record in database
    const payment = new Payment({
      orderId,
      amount: parseFloat(amount),
      // userId: userId || null,
      adminId: adminId, // Use provided adminId or current admin
      customerEmail: String(customerEmail),
      customerPhone: String(customerPhone),
      customerName: String(customerName),
      projectId: "ailisher",
      status: "PENDING",
    });

    await payment.save();

    // Prepare Paytm parameters
    const paytmParams = {
      MID: String(PaytmConfig.MID),
      WEBSITE: String(PaytmConfig.WEBSITE),
      CHANNEL_ID: String(PaytmConfig.CHANNEL_ID),
      INDUSTRY_TYPE_ID: String(PaytmConfig.INDUSTRY_TYPE_ID),
      ORDER_ID: String(orderId),
      CUST_ID: String(evaluator._id || customerEmail),
      TXN_AMOUNT: String(parseFloat(amount).toFixed(2)),
      CALLBACK_URL: String("https://test.ailisher.com/api/admin/paytm/callback"),
      EMAIL: String(customerEmail),
      MOBILE_NO: String(customerPhone),
    };

    console.log("Paytm Parameters before checksum:", paytmParams);

    // Generate checksum using official Paytm package
    const checksum = await PaytmChecksum.generateSignature(
      paytmParams,
      PaytmConfig.MERCHANT_KEY
    );
    paytmParams.CHECKSUMHASH = checksum;

    console.log("Generated Checksum:", checksum);

    // Update payment record with checksum
    await Payment.findOneAndUpdate(
      { orderId },
      {
        checksumHash: checksum,
        paytmOrderId: orderId,
        updatedAt: new Date(),
      }
    );

    console.log("Payment initiated successfully:", {
      orderId,
      amount: paytmParams.TXN_AMOUNT,
      customerEmail,
      checksum,
    });

    res.json({
      success: true,
      orderId,
      paytmParams,
      paytmUrl: PaytmConfig.PAYTM_URL,
    });
  } catch (error) {
    console.error("Payment initiation error:", error);
    res.status(500).json({
      success: false,
      message: "Payment initiation failed",
      error: error.message,
    });
  }
});

// 2. Payment Callback Handler
router.post("/:requestId/callback", async (req, res) => {
  try {
    const paytmResponse = req.body;
    const orderId = paytmResponse.ORDERID;
    const requestId = req.params;

    console.log("Received Paytm callback:", paytmResponse);

    // Verify checksum using official Paytm package
    let isValidChecksum = true;

    if (paytmResponse.CHECKSUMHASH) {
      isValidChecksum = PaytmChecksum.verifySignature(
        paytmResponse,
        PaytmConfig.MERCHANT_KEY,
        paytmResponse.CHECKSUMHASH
      );
      console.log("Checksum validation result:", isValidChecksum);
    } else {
      console.log("No checksum in response - staging environment behavior");
    }

    // Log checksum validation for debugging
    if (!isValidChecksum) {
      console.warn(
        "⚠️  Checksum validation failed, but proceeding for staging environment"
      );
    }

    // Determine payment status
    let paymentStatus = "FAILED";
    if (paytmResponse.STATUS === "TXN_SUCCESS") {
      paymentStatus = "SUCCESS";
    } else if (paytmResponse.STATUS === "TXN_FAILURE") {
      paymentStatus = "FAILED";
    } else if (paytmResponse.STATUS === "PENDING") {
      paymentStatus = "PENDING";
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
      updatedAt: new Date(),
    };

    const payment = await Payment.findOneAndUpdate({ orderId }, updateData, {
      new: true,
    });

    if (!payment) {
      console.error("Payment record not found for orderId:", orderId);
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
        orderId,
      });
    }

    console.log("Payment updated successfully:", {
      orderId,
      status: paymentStatus,
      transactionId: updateData.transactionId,
      responseCode: paytmResponse.RESPCODE,
      checksumValid: isValidChecksum,
    });
    
    try {
      const request = await EvaluatorWithdrawalRequest.findById(
        requestId
      ).populate("evaluatorId");
      if (!request) {
        return res
          .status(404)
          .json({ success: false, message: "Withdrawal request not found" });
      }

      // Deduct credits from evaluator balance
      const evaluator = request.evaluatorId;

      // Update evaluator credits
      evaluator.creditBalance -= request.amount;
      evaluator.totalCreditsWithdrawn += request.amount;
      evaluator.lastCreditActivity = new Date();
      await evaluator.save();

      // Create withdrawal transaction record
      const EvaluatorCreditTransaction = require("../models/EvaluatorCreditTransaction");
      const withdrawalTransaction = new EvaluatorCreditTransaction({
        evaluatorId: evaluator._id,
        type: "withdrawn",
        amount: request.amount,
        balanceBefore: evaluator.creditBalance + request.amount,
        balanceAfter: evaluator.creditBalance,
        category: "withdrawal",
        description: `Withdrawal processed - ${request.amount} credits`,
        withdrawalRequestId: request._id,
        status: "completed",
      });
      await withdrawalTransaction.save();

      // Update withdrawal request
      request.status = "processed";
      request.transactionId = transactionId || request.transactionId;
      request.adminNotes = adminNotes || request.adminNotes;
    request.processedAt = new Date();
    request.processedBy = req.admin._id;
      request.screenshot = screenshot || request.screenshot;
      await request.save();
    } 
    catch (error) {
      
    }
    

    // Return JSON response with payment details
    res.json({
      success: true,
      message: "Payment processed successfully",
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
      // redirectUrl: `${process.env.FRONTEND_URL}/orderId=${orderId}&status=${paymentStatus}`
    });
  } catch (error) {
    console.error("Payment callback error:", error);
    res.status(500).json({
      success: false,
      message: "Payment processing error",
      error: error.message,
    });
  }
});

// Admin: mark a withdrawal as processed (paid) - only for approved requests
router.post(
  "/withdrawals/:requestId/process",
  verifyAdminToken,
  validateAdminWithdrawalAction,
  async (req, res) => {
    try {
      const { requestId } = req.params;
      const { transactionId, adminNotes, screenshot } = req.body;

      const request = await EvaluatorWithdrawalRequest.findById(
        requestId
      ).populate("evaluatorId");
      if (!request) {
        return res
          .status(404)
          .json({ success: false, message: "Withdrawal request not found" });
      }

      if (request.status !== "approved") {
        return res
          .status(400)
          .json({
            success: false,
            message: "Request must be approved before processing",
          });
      }

      // Deduct credits from evaluator balance
      const evaluator = request.evaluatorId;
      if (evaluator.creditBalance < request.amount) {
        return res
          .status(400)
          .json({ success: false, message: "Insufficient evaluator balance" });
      }

      // Update evaluator credits
      evaluator.creditBalance -= request.amount;
      evaluator.totalCreditsWithdrawn += request.amount;
      evaluator.lastCreditActivity = new Date();
      await evaluator.save();

      // Create withdrawal transaction record
      const EvaluatorCreditTransaction = require("../models/EvaluatorCreditTransaction");
      const withdrawalTransaction = new EvaluatorCreditTransaction({
        evaluatorId: evaluator._id,
        type: "withdrawn",
        amount: request.amount,
        balanceBefore: evaluator.creditBalance + request.amount,
        balanceAfter: evaluator.creditBalance,
        category: "withdrawal",
        description: `Withdrawal processed - ${request.amount} credits`,
        withdrawalRequestId: request._id,
        status: "completed",
      });
      await withdrawalTransaction.save();

      // Update withdrawal request
      request.status = "processed";
      request.transactionId = transactionId || request.transactionId;
      request.adminNotes = adminNotes || request.adminNotes;
    request.processedAt = new Date();
    request.processedBy = req.admin._id;
      request.screenshot = screenshot || request.screenshot;
      await request.save();

      return res.json({
        success: true,
        message: "Withdrawal processed successfully",
        data: {
          request,
          newBalance: evaluator.creditBalance,
          transaction: withdrawalTransaction,
        },
      });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  }
);

// Admin: adjust evaluator credits
router.post(
  "/evaluators/:evaluatorId/adjust-credits",
  verifyAdminToken,
  validateCreditAdjustment,
  async (req, res) => {
    try {
      const { evaluatorId } = req.params;
      const { amount, reason } = req.body;

      if (!amount || !reason) {
        return res
          .status(400)
          .json({ success: false, message: "Amount and reason are required" });
      }

      const EvaluatorCreditService = require("../services/evaluatorCreditService");
      const result = await EvaluatorCreditService.adjustCredits(
        evaluatorId,
        Number(amount),
        reason,
        req.admin._id
      );

      return res.json({
        success: true,
        message: "Credits adjusted successfully",
        data: result,
      });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  }
);

// Get evaluator credit summary
router.get(
  "/evaluators/:evaluatorId/credits",
  verifyAdminToken,
  async (req, res) => {
    try {
      const { evaluatorId } = req.params;
      const EvaluatorCreditService = require("../services/evaluatorCreditService");
      const summary = await EvaluatorCreditService.getEvaluatorCreditSummary(
        evaluatorId
      );

      return res.json({ success: true, data: summary });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  }
);

// Bulk approve withdrawals
router.post("/withdrawals/bulk-approve", verifyAdminToken, async (req, res) => {
  try {
    const { requestIds, adminComments } = req.body;

    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Request IDs array is required" });
    }

    const results = [];
    for (const requestId of requestIds) {
      try {
        const request = await EvaluatorWithdrawalRequest.findById(requestId);
        if (request && request.status === "pending") {
          request.status = "approved";
          request.adminComments = adminComments || request.adminComments;
          request.processedBy = req.admin._id;
    await request.save();
          results.push({ requestId, status: "approved" });
        } else {
          results.push({
            requestId,
            status: "skipped",
            reason: "Not in pending status",
          });
        }
      } catch (error) {
        results.push({ requestId, status: "error", error: error.message });
      }
    }

    return res.json({
      success: true,
      message: "Bulk approval completed",
      data: results,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;

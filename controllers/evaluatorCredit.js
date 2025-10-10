const Evaluator = require("../models/Evaluator");
const evaluatorCreditTransaction = require("../models/EvaluatorCreditTransaction");
const EvaluatorWithdrawalRequest = require("../models/EvaluatorWithdrawalRequest");
const { generatePresignedUrl } = require("../utils/r2");

// Get evaluator credit balance
exports.getCreditBalance = async (req, res) => {
  try {
    const evaluator = await Evaluator.findById(req.evaluator._id);
    res.json({
      success: true,
      data: {
        balance: evaluator.creditBalance,
        totalEarned: evaluator.totalCreditsEarned,
        totalWithdrawn: evaluator.totalCreditsWithdrawn,
        lastActivity: evaluator.lastCreditActivity,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get evaluator's withdrawal requests (paginated)
exports.getWithdrawalRequests = async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;
    const { page = 1, limit = 20 } = req.query;

    const filter = { evaluatorId };
    const [items, total] = await Promise.all([
      EvaluatorWithdrawalRequest.find(filter)
        .sort({ createdAt: -1 })
        .limit(Number(limit) * 1)
        .skip((Number(page) - 1) * Number(limit)),
      EvaluatorWithdrawalRequest.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        items,
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit) || 1),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get credit transaction history
exports.getCreditHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const transactions = await evaluatorCreditTransaction
      .find({ evaluatorId: req.evaluator._id })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    res.json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.evaluatorBankDetails = async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;
    const {
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      accountType,
      upiId
    } = req.body;
    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res
        .status(404)
        .json({ success: false, message: "Evaluator not found" });
    }
    evaluator.bankDetails = {
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName,
      branchName,
      accountType,
      upiId
    };
    // If UPI is provided, enable withdrawals automatically per your policy
    if (upiId && typeof upiId === 'string' && upiId.trim()) {
      evaluator.withdrawalSettings = evaluator.withdrawalSettings || {};
      evaluator.withdrawalSettings.withdrawalEnabled = true;
    }
    await evaluator.save();
    res.json({
      success: true,
      message: "Bank details updated successfully",
      data: evaluator,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.uploadDocuments = async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;
    const { fileName, contentType, docType} = req.body;

    const evaluator = await Evaluator.findById(evaluatorId);
    if(!evaluator){
      return res.status(404).json({ success: false, message: "Evaluator not found" });
    }
    // const document = await evaluator.kycDetails.documents[docType];
    // if(document){
    //   return res.status(400).json({ success: false, message: "Document already uploaded" });
    // }
    const key = `evaluator/${evaluatorId}/kyc/documents/${docType}/${fileName}`;
    const uploadUrl = await generatePresignedUrl(key, contentType);
    evaluator.kycDetails.documents[docType] = {
      s3Key: key,
      downloadUrl: uploadUrl,
      uploadedAt: new Date()
    };
    await evaluator.save();
    res.json({ success: true, message: "Document uploaded successfully", data: evaluator.kycDetails.documents[docType] });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

exports.evaluatorKYCDetails = async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;
    const { panNumber, aadharNumber, address, documents} = req.body;
    const evaluator = await Evaluator.findById(evaluatorId);
    if(!evaluator){
      return res.status(404).json({ success: false, message: "Evaluator not found" });
    }
    evaluator.kycDetails = {
      ...evaluator.kycDetails,
      panNumber,
      aadharNumber,
      address,
      documents,
      status: 'pending',
      submittedAt: new Date()
    };
    await evaluator.save();
    res.json({ success: true, message: "KYC details updated successfully", data: evaluator });
  } 
  catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

exports.getFinanceStatus = async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;
    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res.status(404).json({ success: false, message: "Evaluator not found" });
    }

    const b = evaluator.bankDetails || {};
    const bankDetailsComplete = (!!b.upiId) || (!!b.accountHolderName && !!b.accountNumber && !!b.ifscCode && !!b.bankName);
    const eligibility = evaluator.getWithdrawalEligibility();

    return res.json({
      success: true,
      data: {
        kycStatus: evaluator.kycDetails?.status,
        bankDetailsComplete,
        withdrawalEnabled: evaluator.withdrawalSettings?.withdrawalEnabled,
        creditStatus: evaluator.creditStatus,
        balance: evaluator.creditBalance,
        minWithdrawal: evaluator.withdrawalSettings?.minimumWithdrawalAmount,
        maxWithdrawal: evaluator.withdrawalSettings?.maximumWithdrawalAmount,
        eligibility
      }
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

exports.withdrawalRequests = async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;
    const { amount, withdrawalMethod = "upi", paymentMethod = "upi" } = req.body;
    const amountNum = Number(amount);
    console.log(amountNum);
    console.log(evaluatorId);

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ success: false, code: 'INVALID_AMOUNT', message: 'Amount must be a positive number' });
    }

    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res.status(404).json({ success: false, message: "Evaluator not found" });
    }

    const { isValid, errors } = evaluator.validateWithdrawalAmount(amountNum);
    if (!isValid) {
      return res.status(400).json({ success: false, code: 'INVALID_AMOUNT', errors });
    }

    // Validate bank details based on withdrawal method
    if (withdrawalMethod === "upi" && !evaluator.bankDetails?.upiId) {
      return res.status(400).json({ 
        success: false, 
        message: "UPI ID is required for UPI withdrawal. Please update your bank details." 
      });
    }

    if (withdrawalMethod === "bank_transfer" && (!evaluator.bankDetails?.accountNumber || !evaluator.bankDetails?.ifscCode)) {
      return res.status(400).json({ 
        success: false, 
        message: "Bank account details are required for bank transfer. Please update your bank details." 
      });
    }

    const withdrawalRequest = await EvaluatorWithdrawalRequest.create({
      evaluatorId,
      amount: amountNum,
      withdrawalMethod,
      paymentMethod,
      accountDetails: evaluator.bankDetails
      // status defaults to 'pending' per your model
    });

    return res.json({
      success: true,
      message: "Withdrawal request submitted successfully",
      data: withdrawalRequest
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
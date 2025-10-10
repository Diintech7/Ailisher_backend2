const mongoose = require('mongoose');

const evaluatorWithdrawalRequestSchema = new mongoose.Schema(
  {
    evaluatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Evaluator",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    withdrawalMethod: {
      type: String,
      enum: ["bank_transfer", "upi", "paytm", "other"],
      required: true,
    },
    accountDetails: {
      accountNumber: String,
      ifscCode: String,
      upiId: String,
      paytmNumber: String,
      bankName: String,
      accountHolderName: String,
      branchName: String,
      accountType: String,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "processed"],
      default: "pending",
    },
    processedAt: {
      type: Date,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    adminNotes: {
      type: String,
    },
    // transactionId: {
    //   type: String,
    // },
    kycVerified: {
      type: Boolean,
      default: false
    },
    bankDetailsVerified: {
      type: Boolean,
      default: false
    },
    rejectionReason: {
      type: String,
      trim: true
    },
    adminComments: {
      type: String,
      trim: true
    },
    screenshot: {
      s3Key: String,
      downloadUrl: String,
      uploadedAt: Date
    },
    // Manual payment fields
    paymentMethod: {
      type: String,
      enum: ["upi", "bank_transfer", "cash", "other"],
      default: "upi"
    },
    paymentReference: {
      type: String,
      trim: true
    },
    paymentScreenshot: {
      s3Key: String,
      downloadUrl: String,
      uploadedAt: Date
    },
    qrCode: {
      type: String, // Base64 QR code for UPI payment
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save middleware to validate KYC and bank details
evaluatorWithdrawalRequestSchema.pre('save', async function(next) {
  try {
    // Populate evaluator details
    await this.populate('evaluatorId', 'kycDetails bankDetails creditBalance withdrawalSettings creditStatus');
    
    const evaluator = this.evaluatorId;
    
    // Check KYC status
    if (!evaluator.isKYCComplete()) {
      return next(new Error('KYC not completed. Please complete KYC verification before withdrawal.'));
    }
    
    // Check withdrawal eligibility
    const eligibility = evaluator.getWithdrawalEligibility();
    if (!eligibility.canWithdraw) {
      return next(new Error(`Withdrawal not eligible: ${eligibility.reasons.join(', ')}`));
    }
    
    // Validate withdrawal amount
    const amountValidation = evaluator.validateWithdrawalAmount(this.amount);
    if (!amountValidation.isValid) {
      return next(new Error(`Invalid withdrawal amount: ${amountValidation.errors.join(', ')}`));
    }
    
    // Set verification flags
    this.kycVerified = true;
    this.bankDetailsVerified = (evaluator.bankDetails.accountNumber || evaluator.bankDetails.upiId) ? true : false;
    
    next();
  } catch (error) {
    next(error);
  }
});

// Instance methods
evaluatorWithdrawalRequestSchema.methods.canProcess = function() {
  return this.status === 'approved' && this.kycVerified && this.bankDetailsVerified;
};

evaluatorWithdrawalRequestSchema.methods.getStatusInfo = function() {
  const statusInfo = {
    canProcess: this.canProcess(),
    requirements: []
  };
  
  if (!this.kycVerified) {
    statusInfo.requirements.push('KYC verification required');
  }
  
  if (!this.bankDetailsVerified) {
    statusInfo.requirements.push('Bank details verification required');
  }
  
  if (this.status !== 'approved') {
    statusInfo.requirements.push('Admin approval required');
  }
  
  return statusInfo;
};

module.exports = mongoose.model('EvaluatorWithdrawalRequest', evaluatorWithdrawalRequestSchema);
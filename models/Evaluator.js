// models/Evaluator.js
const mongoose = require('mongoose');

const evaluatorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    minlength: [2, 'Name must be at least 2 characters long'],
    maxlength: [50, 'Name must not exceed 50 characters'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password:{
    type:String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters long']
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    match: [/^\d{10}$/, 'Phone number must be exactly 10 digits'],
    trim: true
  },
  currentcity:{
    type:String,
    default:""
  },
  subjectMatterExpert: {
    type: String,
    required: [true, 'Subject matter expert field is required'],
    minlength: [2, 'Subject matter expert must be at least 2 characters long'],
    maxlength: [100, 'Subject matter expert must not exceed 100 characters'],
    trim: true
  },
  instituteworkedwith:{
    type:String,
    default:null
  },
  examFocus: {
    type: String,
    required: [true, 'Exam focus is required'],
    minlength: [2, 'Exam focus must be at least 2 characters long'],
    maxlength: [100, 'Exam focus must not exceed 100 characters'],
    trim: true
  },
  experience: {
    type: Number,
    required: [true, 'Experience is required'],
    min: [0, 'Experience cannot be negative'],
    max: [50, 'Experience cannot exceed 50 years']
  },
  grade: {
    type: String,
    // required: [true, 'Grade is required'],
    enum: {
      values: ['1st grade', '2nd grade', '3rd grade'],
      message: 'Grade must be one of: 1st grade, 2nd grade, 3rd grade'
    }
  },
  status: {
    type: String,
    enum: ['PENDING', 'VERIFIED', 'NOT_VERIFIED'],
    default: 'PENDING'
  },
  enabled: {
    type: Boolean,
    default: false
  },
  verifiedAt: {
    type: Date
  },
  isEvaluator: {
    type: Boolean,
    default: true
  },
  clientAccess: [{
    id: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    }
  }],
  // credit system
  creditBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCreditsEarned: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCreditsWithdrawn: {
    type: Number,
    default: 0,
    min: 0
  },
  lastCreditActivity: {
    type: Date
  },
  creditStatus: {
    type: String,
    enum: ['active', 'suspended', 'pending'],
    default: 'active'
  },
  
  // Bank details for credit withdrawals
  bankDetails: {
    accountHolderName: {
      type: String,
      trim: true
    },
    accountNumber: {
      type: String,
      trim: true
    },
    ifscCode: {
      type: String,
      trim: true,
      uppercase: true
    },
    bankName: {
      type: String,
      trim: true
    },
    branchName: {
      type: String,
      trim: true
    },
    accountType: {
      type: String,
      enum: ['savings', 'current'],
      default: 'savings'
    },
    upiId: {
      type: String,
      trim: true,
      lowercase: true, // optional: makes `User@Bank` → `user@bank`
      match: /^[\w.-]+@[\w.-]+$/, // optional: validates UPI format
    }
  },
  
  // KYC (Know Your Customer) details
  kycDetails: {
    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN number format']
    },
    aadharNumber: {
      type: String,
      trim: true,
      match: [/^[0-9]{12}$/, 'Aadhar number must be 12 digits']
    },
    address: {
      street: {
        type: String,
        trim: true
      },
      city: {
        type: String,
        trim: true
      },
      state: {
        type: String,
        trim: true
      },
      pincode: {
        type: String,
        trim: true,
        match: [/^[0-9]{6}$/, 'Pincode must be 6 digits']
      },
      country: {
        type: String,
        trim: true,
        default: 'India'
      }
    },
    documents: {
      panDocument: {
        s3Key: String,
        downloadUrl: String,
        uploadedAt: Date
      },
      aadharFront: {
        s3Key: String,
        downloadUrl: String,
        uploadedAt: Date
      },
      aadharBack: {
        s3Key: String,
        downloadUrl: String,
        uploadedAt: Date
      },
      bankPassbook: {
        s3Key: String,
        downloadUrl: String,
        uploadedAt: Date
      }
    },
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected', 'not_submitted'],
      default: 'not_submitted'
    },
    verifiedAt: {
      type: Date
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    rejectionReason: {
      type: String,
      trim: true
    },
    submittedAt: {
      type: Date
    }
  },
  
  // Withdrawal settings
  withdrawalSettings: {
    minimumWithdrawalAmount: {
      type: Number,
      default: 1,
      min: 1
    },
    maximumWithdrawalAmount: {
      type: Number,
      default: 1,
      min: 1
    },
    withdrawalEnabled: {
      type: Boolean,
      default: false
    },
    lastWithdrawalAt: {
      type: Date
    },
    withdrawalCount: {
      type: Number,
      default: 0,
      min: 0
    }
  }

}, {
  timestamps: true
});

// Index for better query performance
evaluatorSchema.index({ email: 1 });
evaluatorSchema.index({ phoneNumber: 1 });
evaluatorSchema.index({ 'kycDetails.status': 1 });
evaluatorSchema.index({ 'bankDetails.accountNumber': 1 });

// Instance methods for KYC validation
evaluatorSchema.methods.isKYCComplete = function() {
  return this.kycDetails.status === 'verified';
};

evaluatorSchema.methods.isKYCSubmitted = function() {
  return this.kycDetails.status === 'pending' || this.kycDetails.status === 'verified';
};

evaluatorSchema.methods.canWithdrawCredits = function() {
  return this.isKYCComplete() && 
         this.kycDetails.status === 'verified' && 
         this.withdrawalSettings.withdrawalEnabled &&
         this.creditStatus === 'active';
};

evaluatorSchema.methods.getWithdrawalEligibility = function() {
  const eligibility = {
    canWithdraw: false,
    reasons: []
  };
  
  // if (!this.isKYCComplete()) {
  //   eligibility.reasons.push('KYC not completed');
  // }
  
  if (this.kycDetails.status !== 'verified') {
    eligibility.reasons.push('KYC not verified');
  }
  
  if (!this.withdrawalSettings.withdrawalEnabled) {
    eligibility.reasons.push('Withdrawals not enabled');
  }
  
  if (this.creditStatus !== 'active') {
    eligibility.reasons.push('Account status is not active');
  }
  
  if (this.creditBalance < this.withdrawalSettings.minimumWithdrawalAmount) {
    eligibility.reasons.push(`Insufficient balance. Minimum withdrawal: ${this.withdrawalSettings.minimumWithdrawalAmount}`);
  }
  
  eligibility.canWithdraw = eligibility.reasons.length === 0;
  return eligibility;
};

evaluatorSchema.methods.validateWithdrawalAmount = function(amount) {
  const errors = [];
  
  if (amount < this.withdrawalSettings.minimumWithdrawalAmount) {
    errors.push(`Minimum withdrawal amount is ${this.withdrawalSettings.minimumWithdrawalAmount}`);
  }
  
  if (amount > this.withdrawalSettings.maximumWithdrawalAmount) {
    errors.push(`Maximum withdrawal amount is ${this.withdrawalSettings.maximumWithdrawalAmount}`);
  }
  
  if (amount > this.creditBalance) {
    errors.push(`Insufficient balance. Available: ${this.creditBalance}`);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

// Static methods
evaluatorSchema.statics.findByKYCStatus = function(status) {
  return this.find({ 'kycDetails.status': status });
};

evaluatorSchema.statics.findEligibleForWithdrawal = function() {
  return this.find({
    'kycDetails.status': 'verified',
    'withdrawalSettings.withdrawalEnabled': true,
    'creditStatus': 'active',
    'creditBalance': { $gte: 1 } // minimum withdrawal amount
  });
};

module.exports = mongoose.model('Evaluator', evaluatorSchema);
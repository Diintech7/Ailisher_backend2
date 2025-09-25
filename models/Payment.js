const mongoose = require('mongoose');

// Payment Schema
const paymentSchema = new mongoose.Schema({
  orderId: { 
    type: String, 
    required: true, 
    unique: true,
    index: true
  },
  // Link to the platform user who is purchasing credits (optional but recommended)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MobileUser',
    index: true,
    default: null
  },
  transactionId: { 
    type: String,
    index: true
  },
  amount: { 
    type: Number, 
    required: true 
  },
  currency: { 
    type: String, 
    default: 'INR' 
  },
  customerEmail: { 
    type: String, 
    required: true,
    index: true
  },
  customerPhone: { 
    type: String, 
    required: true 
  },
  customerName: { 
    type: String, 
    required: true 
  },
  // Recharge plan purchased (optional)
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreditRechargePlan',
    default: null
  },
  workbookIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workbook',
    default: null
  }],
  // Number of credits intended to be credited on success (snapshot at initiation)
  creditsPurchased: {
    type: Number,
    default: null
  },
  // Admin who initiated the payment
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  // Admin message for the transaction
  adminMessage: {
    type: String,
    default: null
  },
  projectId: {
    type: String,
    default: 'default',
    index: true
  },
  status: { 
    type: String, 
    enum: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'],
    default: 'PENDING',
    index: true
  },
  paytmResponse: { 
    type: Object 
  },
  paytmTxnId: { 
    type: String,
    index: true
  },
  paytmOrderId: { 
    type: String 
  },
  gatewayName: { 
    type: String, 
    default: 'PAYTM' 
  },
  paymentMode: { 
    type: String 
  },
  bankName: { 
    type: String 
  },
  bankTxnId: { 
    type: String 
  },
  responseCode: { 
    type: String 
  },
  responseMsg: { 
    type: String 
  },
  checksumHash: { 
    type: String 
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
});

// Pre-save middleware to update the updatedAt field
paymentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Pre-findOneAndUpdate middleware to update the updatedAt field
paymentSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: Date.now() });
  next();
});

// Virtual for payment URL (if needed)
paymentSchema.virtual('paymentUrl').get(function() {
  return `${process.env.FRONTEND_URL}?orderId=${this.orderId}`;
});

// Method to check if payment is successful
paymentSchema.methods.isSuccessful = function() {
  return this.status === 'SUCCESS';
};

// Method to check if payment is pending
paymentSchema.methods.isPending = function() {
  return this.status === 'PENDING';
};

// Method to check if payment is failed
paymentSchema.methods.isFailed = function() {
  return this.status === 'FAILED';
};

// Static method to find payments by project
paymentSchema.statics.findByProject = function(projectId) {
  return this.find({ projectId });
};

// Static method to find successful payments
paymentSchema.statics.findSuccessful = function(projectId = null) {
  const query = { status: 'SUCCESS' };
  if (projectId) query.projectId = projectId;
  return this.find(query);
};

// Index for compound queries
paymentSchema.index({ projectId: 1, status: 1 });
paymentSchema.index({ customerEmail: 1, status: 1 });
paymentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
const mongoose = require('mongoose');

const CreditTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  balanceBefore: {
    type: Number,
    required: true
  },
  balanceAfter: {
    type: Number,
    required: true
  },
  category: {
    type: String,
    enum: ['purchase', 'service_usage', 'refund', 'bonus', 'referral', 'admin_adjustment', 'expiry', 'other'],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  referenceId: {
    type: String,
    default: null
  },
  // Add plan information for purchases
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreditRechargePlan',
    default: null
  },
  workbookIds: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workbook',
    default: null
  },
  paymentAmount: {
    type: Number,
    default: null
  },
  paymentCurrency: {
    type: String,
    default: 'INR'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'completed'
  },
  // Track who added the credit (for admin-initiated credits)
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin', // Change to the correct model if needed
    default: null
  },
  // Optional message from admin for the transaction
  adminMessage: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('CreditTransaction', CreditTransactionSchema);
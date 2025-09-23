const mongoose = require('mongoose');

const CreditAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: false
  },
  mobile: {
    type: String,
    required: true
  },
  clientId:{
    type:String
  },
  planId: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreditRechargePlan',
    default: null
  }],
  workbookId: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workbook',
    default: null
  }],
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  totalEarned: {
    type: Number,
    default: 0
  },
  totalSpent: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'closed'],
    default: 'active'
  },
  lastTransactionDate: {
    type: Date,
    default: Date.now
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('CreditAccount', CreditAccountSchema);
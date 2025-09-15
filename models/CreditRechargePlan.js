const mongoose = require('mongoose');

const CreditRechargePlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    required: true
  },
  clientId: {
    type: String,
    required: true
  },
  // Duration in days (or your preferred unit)
  duration: {
    type: Number,
    required: function () {
      return Array.isArray(this.items) && this.items.length > 0;
    },
    min: 1
  },
  credits: {
    type: Number,
    min: 0,
    required: function () {
      return !this.items || this.items.length === 0;
    }
  },
  MRP: {
    type: Number,
    required: true,
    min: 0,
    alias: 'mrp'
  },
  offerPrice: {
    type: Number,
    required: true,
    min: 0,
    alias: 'offerprice'
  },
  category: {
    type: String,
    enum: ['Basic', 'Premium', 'Enterprise'],
    default: 'Basic'
  },
  imageKey: {
    type: String
  },
  videoKey: {
    type: String
  },
  items: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PlanItem'
    }
  ],
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
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

module.exports = mongoose.model('CreditRechargePlan', CreditRechargePlanSchema);
const mongoose = require('mongoose');

const PlanItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  itemType: {
    type: String,
    required: true
  },
  itemKey: {
    type: String
  },
  referenceId: {
    type: String
  },
  expiresWithPlan: {
    type: Boolean,
    default: true
  },
  quantity: {
    type: Number,
    default: 1
  },
  clientId: {
    type: String
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

module.exports = mongoose.model('PlanItem', PlanItemSchema);



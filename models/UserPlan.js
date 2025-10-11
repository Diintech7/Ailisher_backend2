const mongoose = require('mongoose');

const UserPlanSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserProfile',
    required: true,
    index: true
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreditRechargePlan',
    // required: true,
    // index: true
  },
  workbookId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workbook',
    // required: true,
    // index: true
  },
  bookId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    // required: true,
    // index: true
  },
  clientId: {
    type: String,
    default: null,
    index: true
  },
  orderId: {
    type: String,
    default: null,
    index: true
  },
  creditsGranted: {
    type: Number,
    default: 0
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    // required: true
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled'],
    default: 'active',
    index: true
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

// Helpful compound index for common lookups
UserPlanSchema.index({ userId: 1, workbookId: 1, status: 1, endDate: 1 });

// Mark as expired automatically if endDate is in the past
UserPlanSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (this.endDate && this.endDate <= new Date() && this.status !== 'expired') {
    this.status = 'expired';
  }
  next();
});

// Ensure queries for active plans exclude expired ones by time
UserPlanSchema.query.active = function() {
  return this.where({ status: 'active' }).where({
    $or: [
      { endDate: null },
      { endDate: { $gt: new Date() } }
    ]
  });
};

// Static: expire all overdue plans (run on a schedule or before critical reads)
UserPlanSchema.statics.expireOverdue = function() {
  return this.updateMany(
    {
      endDate: { $ne: null, $lte: new Date() },
      status: { $ne: 'expired' }
    },
    {
      $set: { status: 'expired', updatedAt: new Date() }
    }
  );
};

// Static: find currently active plans for a user (optionally for a workbook)
UserPlanSchema.statics.findActiveForUser = function(userId, workbookId) {
  const query = { userId, status: 'active' };
  if (workbookId) query.workbookId = workbookId;
  return this.find(query).active();
};

module.exports = mongoose.model('UserPlan', UserPlanSchema);



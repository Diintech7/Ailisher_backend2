const mongoose = require('mongoose');

const BannerSchema = new mongoose.Schema({
  clientId: {
    type: String,
    required: [true, 'Client ID is required'],
    index: true
  },
  imageKey: {
    type: String,
    required: [true, 'Banner image key is required']
  },
  placement: {
    type: String,
    required: [true, 'Placement is required'],
    enum: ['top', 'medium', 'bottom'],
    lowercase: true
  },
  order: {
    type: Number,
    required: [true, 'Order number is required'],
    default: 0
  },
  redirectUrl: {
    type: String,
    trim: true,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient fetching by placement and order
BannerSchema.index({ clientId: 1, placement: 1, order: 1 });

module.exports = mongoose.model('Banner', BannerSchema);

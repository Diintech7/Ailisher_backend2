// Updated MobileUser.js - Clean version with proper indexing

const mongoose = require('mongoose');

const MobileUserSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: true,
    trim: true,
    match: [/^\d{10}$/, 'Please enter a valid 10-digit mobile number']
    // NOTE: No unique constraint here - uniqueness is handled by compound index
  },
  isVerified: {
    type: Boolean,
    default: true
  },
  clientId: {
    type: String,
    required: true,
    index: true // Individual index for better query performance
  },
  authToken: {
    type: String,
    default: null
  },
  // Step-2 onboarding: link the email user that owns this mobile within a client
  emailUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "MobileEmailUser",
    default: null,
    index: true,
  },
  lastLoginAt: {
    type: Date,
    default: Date.now
  },
  loginCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
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
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual populate for profile
MobileUserSchema.virtual('profile', {
  ref: 'UserProfile',
  localField: '_id',
  foreignField: 'userId',
  justOne: true
});

// CRITICAL: Compound index for mobile and clientId combination
// This ensures same mobile can exist across different clients but not within same client
MobileUserSchema.index({ mobile: 1, clientId: 1 }, { 
  unique: true, 
  name: 'mobile_1_clientId_1'  // Explicitly name the index
});

// Additional indexes for better performance
MobileUserSchema.index({ clientId: 1, isActive: 1 });
MobileUserSchema.index({ authToken: 1 });

// Static method to find user by mobile and client
MobileUserSchema.statics.findByMobileAndClient = function(mobile, clientId) {
  return this.findOne({ mobile, clientId, isActive: true });
};

// Static method to check if mobile exists across all clients
MobileUserSchema.statics.getMobileUsageAcrossClients = function(mobile) {
  return this.find({ mobile, isActive: true }).select('clientId createdAt');
};

// Instance method to generate unique identifier
MobileUserSchema.methods.getUniqueIdentifier = function() {
  return `${this.mobile}_${this.clientId}`;
};

// Update timestamp and login tracking on save
MobileUserSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  if (this.isModified('authToken') && this.authToken) {
    this.lastLoginAt = Date.now();
    this.loginCount += 1;
  }
  
  next();
});

// Pre-save validation to ensure client exists
MobileUserSchema.pre('save', async function(next) {
  if (this.isModified('clientId')) {
    // Ensure clientId is not null or empty
    if (!this.clientId) {
      next(new Error('Client ID is required and cannot be null.'));
      return;
    }
    
    const User = mongoose.model('User');
    const OrgClient = mongoose.model('OrgClient');
    let client = await User.findOne({
      userId: this.clientId,
      role: 'client',
      status: 'active'
    });

    if(!client)
    {
      client = await OrgClient.findOne({
        userId: this.clientId,
        role: 'client',
        status: 'active'
      });
    }
    
    if (!client) {
      next(new Error('Invalid client ID or client is not active.'));
      return;
    }
  }
  next();
});

// Custom error handling for duplicate key errors
MobileUserSchema.post('save', function(error, doc, next) {
  if (error.name === 'MongoError' && error.code === 11000) {
    if (error.keyPattern && error.keyPattern.mobile && error.keyPattern.clientId) {
      next(new Error('Mobile number already exists for this client.'));
    } else {
      next(error);
    }
  } else {
    next(error);
  }
});

// Ensure no documents are saved with null clientId
MobileUserSchema.pre('validate', function(next) {
  if (!this.clientId) {
    this.invalidate('clientId', 'Client ID is required');
  }
  next();
});

module.exports = mongoose.model('MobileUser', MobileUserSchema);
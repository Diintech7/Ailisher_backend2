// Updated MobileUser.js - Clean version with proper indexing

const mongoose = require('mongoose');

const MobileUserSchema = new mongoose.Schema({
  mobile: {
    type: String,
    required: false,
    trim: true,
    match: [/^\d{10}$/, 'Please enter a valid 10-digit mobile number']
    // NOTE: No unique constraint here - uniqueness is handled by compound index
  },
  email: {
    type: String,
    required: false,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email"],
  },
  passwordHash: {
    type: String,
    default: null,
  },
  loginProvider: {
    type: String,
    enum: ["google", "email", "mobile"],
    default: "mobile",
  },
  // Step 1 (email+password): false until Brevo OTP verified; undefined = legacy treated as verified
  emailOtpVerified: {
    type: Boolean,
  },
  // Step 2 (mobile OTP)
  mobileOtpVerified: {
    type: Boolean,
    default: false,
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

// CRITICAL: Unique per client, but allow onboarding records without mobile yet (partial index)
MobileUserSchema.index(
  { mobile: 1, clientId: 1 },
  {
    unique: true,
    name: "mobile_1_clientId_1",
    partialFilterExpression: { mobile: { $type: "string" } },
  }
);

// Unique email per client (partial index)
MobileUserSchema.index(
  { email: 1, clientId: 1 },
  {
    unique: true,
    name: "email_1_clientId_1",
    partialFilterExpression: { email: { $type: "string" } },
  }
);

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
  // Require at least one identifier
  if (!this.mobile && !this.email) {
    this.invalidate('mobile', 'Mobile or email is required');
  }
  next();
});

module.exports = mongoose.model('MobileUser', MobileUserSchema);
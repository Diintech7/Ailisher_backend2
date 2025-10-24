// models/User.js - Updated User model with enhanced user ID generation
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const OrgClientSchema = new mongoose.Schema({
  // Basic user info
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  isEvaluator: {
    type: Boolean,
    default: false
  },
  role: {
    type: String,
    enum: ['admin', 'client', 'user', null],
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'pending'],
    default: 'active'
  },
  isEnabled: {
    type: Boolean,
    default: true
  },
  
  // Business registration fields
  businessName: {
    type: String,
    required: function() { return this.role === 'client'; }
  },
  businessOwnerName: {
    type: String,
    required: function() { return this.role === 'client'; }
  },
  businessNumber: {
    type: String,
    // required: function() { return this.role === 'client'; }
  },
  businessGSTNumber: {
    type: String,
    required: function() { return this.role === 'client'; }
  },
  businessPANNumber: {
    type: String,
    required: function() { return this.role === 'client'; }
  },
  businessMobileNumber: {
    type: String,
    required: function() { return this.role === 'client'; }
  },
  businessCategory: {
    type: String,
    required: function() { return this.role === 'client'; }
  },
  businessAddress: {
    type: String,
    required: function() { return this.role === 'client'; }
  },
  city: {
    type: String,
    required: function() { return this.role === 'client'; }
  },
  pinCode: {
    type: String,
    required: function() { return this.role === 'client'; }
  },
  businessLogo: {
    type: String, // Cloudinary URL
    default: null
  },
  businessWebsite: {
    type: String,
    default: null
  },
  businessYoutubeChannel: {
    type: String,
    default: null
  },
  turnOverRange: {
    type: String,
    default: null
  },
  
  // Auto-generated user ID for clients
  userId: {
    type: String,
    unique: true,
    sparse: true // Only unique if not null
  },
  
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization'
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Generate unique user ID for clients
OrgClientSchema.pre('save', async function(next) {
  // Hash password if modified
  if (this.isModified('password')) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    } catch (error) {
      return next(error);
    }
  }
  
  // Generate user ID for new clients
  if (this.role === 'client' && this.isNew && !this.userId) {
    try {
      let userId;
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 10;
      
      while (!isUnique && attempts < maxAttempts) {
        // Generate a more unique ID: CLI + timestamp + random string
        const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
        const randomString = Math.random().toString(36).substr(2, 4).toUpperCase();
        userId = `CLI${timestamp}${randomString}`;
        
        // Check if this ID already exists
        const existingUser = await this.constructor.findOne({ userId });
        if (!existingUser) {
          isUnique = true;
        }
        attempts++;
      }
      
      if (!isUnique) {
        // Fallback to a more random approach if needed
        userId = `CLI${Date.now()}${Math.floor(Math.random() * 1000)}`;
      }
      
      this.userId = userId;
    } catch (error) {
      console.error('Error generating user ID:', error);
      return next(error);
    }
  }
  
  next();
});

// Compare password method
OrgClientSchema.methods.comparePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

// Method to generate a new user ID (if needed)
OrgClientSchema.methods.generateUserId = async function() {
  if (this.role !== 'client' || this.userId) {
    return this.userId;
  }
  
  let userId;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;
  
  while (!isUnique && attempts < maxAttempts) {
    const timestamp = Date.now().toString().slice(-6);
    const randomString = Math.random().toString(36).substr(2, 4).toUpperCase();
    userId = `CLI${timestamp}${randomString}`;
    
    const existingUser = await this.constructor.findOne({ userId });
    if (!existingUser) {
      isUnique = true;
    }
    attempts++;
  }
  
  if (!isUnique) {
    userId = `CLI${Date.now()}${Math.floor(Math.random() * 1000)}`;
  }
  
  this.userId = userId;
  await this.save();
  return userId;
};

module.exports = mongoose.model('OrgClient', OrgClientSchema);
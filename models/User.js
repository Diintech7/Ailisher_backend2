const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  // Basic user info
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
    // ❌ removed unique:true (we handle it with compound indexes below)
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
    required: function () { return this.role === 'client'; }
  },
  businessOwnerName: {
    type: String,
    required: function () { return this.role === 'client'; }
  },
  businessNumber: {
    type: String,
    // required: function () { return this.role === 'client'; }
  },
  businessGSTNumber: {
    type: String,
    required: function () { return this.role === 'client'; }
  },
  businessPANNumber: {
    type: String,
    required: function () { return this.role === 'client'; }
  },
  businessMobileNumber: {
    type: String,
    required: function () { return this.role === 'client'; }
  },
  businessCategory: {
    type: String,
    required: function () { return this.role === 'client'; }
  },
  businessAddress: {
    type: String,
    required: function () { return this.role === 'client'; }
  },
  city: {
    type: String,
    required: function () { return this.role === 'client'; }
  },
  pinCode: {
    type: String,
    required: function () { return this.role === 'client'; }
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

  // Organization reference (each doc belongs to one org or none)
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    default: null
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ======================================================
// 🔐 PASSWORD HASHING
// ======================================================
UserSchema.pre('save', async function (next) {
  if (this.isModified('password')) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    } catch (error) {
      return next(error);
    }
  }

  // Generate userId for clients
  if (this.role === 'client' && this.isNew && !this.userId) {
    try {
      let userId;
      let isUnique = false;
      let attempts = 0;
      const maxAttempts = 10;

      while (!isUnique && attempts < maxAttempts) {
        const timestamp = Date.now().toString().slice(-6); // last 6 digits
        const randomString = Math.random().toString(36).substr(2, 4).toUpperCase();
        userId = `CLI${timestamp}${randomString}`;

        const existingUser = await this.constructor.findOne({ userId });
        if (!existingUser) isUnique = true;

        attempts++;
      }

      if (!isUnique) {
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

// ======================================================
// 🔍 PASSWORD COMPARISON
// ======================================================
UserSchema.methods.comparePassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// ======================================================
// 🔁 MANUAL USER ID GENERATION METHOD
// ======================================================
UserSchema.methods.generateUserId = async function () {
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
    if (!existingUser) isUnique = true;
    attempts++;
  }

  if (!isUnique) {
    userId = `CLI${Date.now()}${Math.floor(Math.random() * 1000)}`;
  }

  this.userId = userId;
  await this.save();
  return userId;
};

// ======================================================
// 🧠 INDEXES TO ALLOW SAME EMAIL WITH MULTIPLE ORGS
// ======================================================

// ✅ Unique email per organization (only when organization is set)
UserSchema.index(
  { email: 1, organization: 1 },
  {
    unique: true,
    partialFilterExpression: { organization: { $type: 'objectId' } }
  }
);

// ✅ Unique email globally (only when organization is null)
UserSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { organization: null }
  }
);



module.exports = mongoose.model('User', UserSchema);

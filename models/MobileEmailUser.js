const mongoose = require("mongoose");

const MobileEmailUserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email"],
    },
    clientId: {
      type: String,
      required: true,
      index: true,
    },
    authToken: {
      type: String,
      default: null,
    },
    passwordHash: {
      type: String,
      default: null,
    },
    loginProvider: {
      type: String,
      enum: ["google", "email"],
      default: "google",
    },
    /** Step 1 (email+password): false until Brevo OTP verified; omit/undefined = legacy accounts treated as verified in app logic. */
    emailOtpVerified: {
      type: Boolean,
    },
    /** Step 2: verified mobile via WhatsApp OTP */
    linkedMobile: {
      type: String,
      default: null,
      trim: true,
    },
    linkedMobileUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MobileUser",
      default: null,
    },
    mobileOtpVerified: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
    loginCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

MobileEmailUserSchema.index({ email: 1, clientId: 1 }, { unique: true, name: "email_1_clientId_1" });
MobileEmailUserSchema.index({ clientId: 1, isActive: 1 });
MobileEmailUserSchema.index({ authToken: 1 });

MobileEmailUserSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  if (this.isModified("authToken") && this.authToken) {
    this.lastLoginAt = Date.now();
    this.loginCount += 1;
  }
  next();
});

MobileEmailUserSchema.pre("save", async function (next) {
  if (!this.isModified("clientId")) return next();
  const User = mongoose.model("User");
  const OrgClient = mongoose.model("OrgClient");
  let c = await User.findOne({
    userId: this.clientId,
    role: "client",
    status: "active",
  });
  if (!c) {
    c = await OrgClient.findOne({
      userId: this.clientId,
      role: "client",
      status: "active",
    });
  }
  if (!c) {
    return next(new Error("Invalid client ID or client is not active."));
  }
  next();
});

module.exports = mongoose.model("MobileEmailUser", MobileEmailUserSchema);

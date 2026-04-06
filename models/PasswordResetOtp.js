const mongoose = require("mongoose");

const PasswordResetOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  clientId: { type: String, required: true, index: true },
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  isUsed: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

// TTL cleanup
PasswordResetOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PasswordResetOtp", PasswordResetOtpSchema);


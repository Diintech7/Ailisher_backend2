// Enhanced mobileAuth.js with better duplicate handling and validation
// Response codes aligned with previous implementation (1500-1530)

const express = require("express");
const router = express.Router({ mergeParams: true });
const axios = require("axios");
const MobileUser = require("../models/MobileUser");
const UserProfile = require("../models/UserProfile");
const User = require("../models/User");
const {
  generateToken,
  authenticateMobileUser,
  checkClientAccess,
} = require("../middleware/mobileAuth");
const CreditAccount = require("../models/CreditAccount");
const OrgClient = require("../models/OrgClient");
const EmailResetToken = require("../models/EmailResetToken");
const { Telegraf } = require('telegraf');
const OTP = require("../models/OTP");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const {
  sendWelcomeEmail,
  sendPasswordResetEmail,
} = require("../services/emailService");
const EmailOtp = require("../models/EmailOtp");
const PasswordResetOtp = require("../models/PasswordResetOtp");
const {
  brevoEnabled,
  sendEmailOtp: sendEmailOtpViaBrevo,
  sendPasswordResetOtp: sendPasswordResetOtpViaBrevo,
} = require("../services/brevoService");

// Validation helpers
const validateMobile = (mobile) => /^\d{10}$/.test(mobile);
const validateAgeGroup = (age) =>
  ["<15", "15-18", "19-25", "26-31", "32-40", "40+"].includes(age);
const validateOtp = (otp) => /^\d{6}$/.test(String(otp || "").trim());

/** Store pincode as string; never coerce with Number() (empty becomes 0 and breaks validation). */
function normalizeProfilePincode(pincode) {
  if (pincode === undefined || pincode === null) return "";
  return String(pincode).trim();
}

// ================= WhatsApp OTP (for App Login) =================
const whatsappEnabled =
  String(process.env.USE_WHATSAPP || process.env.WHATSAPP_ENABLED || "false") ===
  "true";

function generateSixDigitOtp() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

function normalizeWhatsAppTo(mobile) {
  // WhatsApp Graph API expects E.164 phone number.
  const m = String(mobile || "").trim();
  if (m.startsWith("+")) return m;
  return `+91${m}`;
}

async function sendWhatsAppTemplateOtp({ to, otp }) {
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  const GRAPH_VERSION = process.env.GRAPH_VERSION || "v20.0";
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || "otp_verification";
  const templateLanguage =
    process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US";

  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    throw new Error("WhatsApp API credentials are not configured");
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${WHATSAPP_PHONE_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  const data = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: templateLanguage },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: otp,
            },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [
            {
              type: "text",
              text: otp,
            },
          ],
        },
      ],
    },
  };

  const response = await axios.post(url, data, { headers });
  return response.data;
}

async function sendLoginOtpToWhatsApp({ mobile, clientKey }) {
  if (!whatsappEnabled) {
    throw new Error("WhatsApp OTP is not enabled");
  }

  const otp = generateSixDigitOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // Store OTP with TTL in DB
  await OTP.create({
    mobile,
    otp,
    client: clientKey,
    expiresAt,
    isUsed: false,
  });

  await sendWhatsAppTemplateOtp({
    to: normalizeWhatsAppTo(mobile),
    otp,
  });

  return { otp };
}

async function verifyLoginOtpFromWhatsApp({ mobile, otp, clientKey }) {
  const record = await OTP.findOne({
    mobile,
    otp: String(otp).trim(),
    client: clientKey,
    isUsed: false,
  });

  if (!record) return { success: false, message: "Invalid OTP" };

  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
    return { success: false, message: "OTP expired" };
  }

  record.isUsed = true;
  await record.save();

  return { success: true, message: "OTP verified successfully" };
}

const validateEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());

function profileOptionsPayload() {
  return {
    exams: [
      "UPSC",
      "CA",
      "CMA",
      "CS",
      "ACCA",
      "CFA",
      "FRM",
      "NEET",
      "JEE",
      "GATE",
      "CAT",
      "GMAT",
      "GRE",
      "IELTS",
      "TOEFL",
      "NET/JRF",
      "BPSC",
      "UPPCS",
      "NDA",
      "SSC",
      "Teacher",
      "CLAT",
      "Judiciary",
      "Other",
    ],
    languages: [
      "Hindi",
      "English",
      "Bengali",
      "Telugu",
      "Marathi",
      "Tamil",
      "Gujarati",
      "Urdu",
      "Kannada",
      "Odia",
      "Malayalam",
      "Punjabi",
      "Assamese",
      "Other",
    ],
    age_groups: ["<15", "15-18", "19-25", "26-31", "32-40", "40+"],
    genders: ["Male", "Female", "Other"],
  };
}

// ----- Email (Brevo) OTP + onboarding (steps 1–3) -----
function step1EmailComplete(user) {
  if (user.loginProvider === "google") return true;
  return user.emailOtpVerified !== false;
}

function step2MobileComplete(user, profile) {
  // Step 2 is strictly "mobile linked + OTP verified".
  // Profile existence must NOT imply mobile verification (some legacy users may have profiles without mobile).
  return !!(user.mobileOtpVerified && user.mobile);
}

function attachOnboarding(user, profile, payload) {
  const s1 = step1EmailComplete(user);
  const s2 = step2MobileComplete(user, profile);
  const s3 = !!profile;
  const next = !s1 ? 1 : !s2 ? 2 : !s3 ? 3 : null;
  payload.onboarding_complete = next === null;
  payload.next_step = next;
  payload.step1_email_verified = s1;
  payload.step2_mobile_verified = s2;
  payload.step3_profile_complete = s3;
}

async function createAndSendEmailOtp({ email, clientId, clientName }) {
  if (!brevoEnabled()) {
    throw new Error(
      "Email OTP requires Brevo: set USE_BREVO=true and BREVO_API_KEY in .env"
    );
  }
  const emailNorm = String(email).toLowerCase().trim();
  await EmailOtp.updateMany(
    { email: emailNorm, clientId, isUsed: false },
    { isUsed: true }
  );
  const otp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await EmailOtp.create({
    email: emailNorm,
    clientId,
    otp,
    expiresAt,
    isUsed: false,
  });
  const result = await sendEmailOtpViaBrevo({
    to: emailNorm,
    otp,
    clientName,
  });
  if (!result.sent) {
    throw new Error(
      result.reason === "missing_api_key"
        ? "BREVO_API_KEY is not set"
        : "Failed to send verification email"
    );
  }
}

async function verifyEmailOtpRecord({ email, clientId, otp }) {
  const emailNorm = String(email).toLowerCase().trim();
  const record = await EmailOtp.findOne({
    email: emailNorm,
    clientId,
    otp: String(otp).trim(),
    isUsed: false,
  });
  if (!record) return { ok: false, message: "Invalid OTP" };
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    return { ok: false, message: "OTP expired" };
  }
  record.isUsed = true;
  await record.save();
  return { ok: true };
}

/**
 * Keeps `mobileUser`, copies email credentials from `emailUser`, migrates profile/credit, deletes `emailUser`.
 */
async function mergeEmailUserIntoMobileUser({
  emailUser,
  mobileUser,
  mobile,
  clientId,
}) {
  // Copy fields before deleting — unique index (email, clientId) allows only one doc with that email.
  // Must delete `emailUser` before saving `mobileUser` with the same email.
  const mergedEmail = emailUser.email || mobileUser.email;
  const mergedPasswordHash = emailUser.passwordHash || mobileUser.passwordHash;
  const mergedEmailOtpVerified =
    emailUser.emailOtpVerified !== undefined
      ? emailUser.emailOtpVerified
      : mobileUser.emailOtpVerified;

  const fromProfile = await UserProfile.findOne({ userId: emailUser._id });
  const toProfile = await UserProfile.findOne({ userId: mobileUser._id });
  if (fromProfile && !toProfile) {
    await UserProfile.updateOne(
      { _id: fromProfile._id },
      { $set: { userId: mobileUser._id } }
    );
  }

  const fromCredit = await CreditAccount.findOne({ userId: emailUser._id });
  const toCredit = await CreditAccount.findOne({ userId: mobileUser._id });
  if (fromCredit && !toCredit) {
    await CreditAccount.updateOne(
      { _id: fromCredit._id },
      { $set: { userId: mobileUser._id, mobile } }
    );
  } else if (toCredit) {
    await CreditAccount.updateOne(
      { _id: toCredit._id },
      { $set: { mobile } }
    );
  }

  await MobileUser.deleteOne({ _id: emailUser._id });

  mobileUser.email = mergedEmail;
  mobileUser.passwordHash = mergedPasswordHash;
  mobileUser.loginProvider = mergedPasswordHash
    ? "email"
    : mobileUser.loginProvider || "mobile";
  mobileUser.emailOtpVerified = mergedEmailOtpVerified;
  mobileUser.mobile = mobile;
  mobileUser.mobileOtpVerified = true;

  const mergedToken = generateToken(
    mobileUser._id,
    mobileUser.mobile ?? undefined,
    clientId
  );
  mobileUser.authToken = mergedToken;
  await mobileUser.save();
  return MobileUser.findById(mobileUser._id);
}

async function finalizeEmailUserSessionResponse(
  user,
  clientId,
  client,
  isNewUser,
  authTypeLabel
) {
  // UserProfile.userId belongs to MobileUser (single model flow).
  const profileOwnerId = user._id;
  const profile = await UserProfile.findOne({ userId: profileOwnerId });
  const isProfileComplete = !!profile;

  const response = {
    success: true,
    responseCode: isNewUser ? 1591 : 1590,
    token: undefined, // final auth token only after step 3 completes
    temp_token: undefined, // used for onboarding steps (step 1 + step 2)
    auth_type: authTypeLabel,
    is_profile_complete: isProfileComplete,
    is_new_user: isNewUser,
    user_id: user._id,
    email: user.email,
    mobile: user.mobile || null,
    client_id: clientId,
    client_name: client.businessName,
    login_count: user.loginCount,
  };

  attachOnboarding(user, profile, response);

  const fullyDone = response.onboarding_complete && isProfileComplete;
  response.status = fullyDone ? "LOGIN_SUCCESS" : "ONBOARDING_OR_PROFILE_REQUIRED";
  response.token = fullyDone ? user.authToken : undefined;
  response.temp_token = !fullyDone ? user.authToken : undefined;
  if (!fullyDone && response.next_step === 2) {
    response.whatsapp_otp_required = true;
  }

  if (fullyDone) {
    response.message = isNewUser
      ? "Account created and login successful."
      : "Login successful.";
    response.profile = {
      name: profile.name,
      age: profile.age,
      gender: profile.gender,
      exams: profile.exams,
      native_language: profile.nativeLanguage,
    };
  } else {
    if (response.next_step === 2) {
      response.message =
        "Step 1 complete. Verify your mobile number with WhatsApp OTP (step 2).";
    } else if (response.next_step === 3) {
      response.message = "Complete your profile (step 3).";
    } else if (response.next_step === 1) {
      response.message = "Verify your email with the OTP sent to your inbox.";
    } else {
      response.message = "Please complete onboarding and your profile.";
    }
    if (!isProfileComplete) {
      response.profile_options = profileOptionsPayload();
    }
  }

  return response;
}

// Enhanced client validation middleware
const validateClient = async (req, res, next) => {
  try {
    const clientId = req.params.clientId;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        responseCode: 1500, // Same as check-user missing clientId
        message: "Client ID is required.",
      });
    }

    let client = await User.findOne({
      userId: clientId,
      role: "client",
      status: "active",
    });

    if (!client) {
      client = await OrgClient.findOne({
        userId: clientId,
        role: "client",
        status: "active",
      });
    }

    else if (!client) {
      return res.status(400).json({
        success: false,
        responseCode: 1501, // Same as check-user invalid client
        message: "Invalid client ID or client is not active.",
      });
    }
    console.log(client);

    req.client = client; // Attach client info to request
    console.log(req.client);
    next();
  } catch (error) {
    console.error("Client validation error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1506, // Using internal server error code
      message: "Error validating client.",
    });
  }
};

// Route: Enhanced Check User Status with cross-client info
router.post("/check-user", validateClient, async (req, res) => {
  try {
    const { mobile, email } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;

    // If email is provided, check email-user and (if already verified) the linked mobile profile.
    if (email) {
      const emailNorm = String(email || "").toLowerCase().trim();
      if (!validateEmail(emailNorm)) {
        return res.status(400).json({
          success: false,
          responseCode: 1502,
          message: "Please enter a valid email address.",
        });
      }

      const emailUser = await MobileUser.findOne({
        email: emailNorm,
        clientId,
        isActive: true,
      });

      if (!emailUser) {
        return res.status(200).json({
          success: true,
          responseCode: 1503,
          user_exists: false,
          client_id: clientId,
          client_name: client.businessName,
          email: emailNorm,
          mobile: null,
          message: "New user. Registration required.",
        });
      }

      const profile = await UserProfile.findOne({ userId: emailUser._id });

      return res.status(200).json({
        success: true,
        responseCode: profile ? 1504 : 1505,
        user_exists: true,
        is_profile_complete: !!profile,
        client_id: clientId,
        client_name: client.businessName,
        user_id: emailUser._id,
        email: emailNorm,
        mobile: emailUser.mobile || null,
        last_login: emailUser.lastLoginAt || null,
        login_count: emailUser.loginCount || 0,
        message: profile
          ? "User exists with complete profile."
          : "User exists but profile incomplete.",
      });
    }

    // Mobile (legacy) check-user flow
    if (!mobile || !validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        responseCode: 1502, // Same as original check-user mobile validation
        message: "Please enter a valid 10-digit mobile number.",
      });
    }

    // Check if user exists for this specific client
    const mobileUser = await MobileUser.findByMobileAndClient(mobile, clientId);

    if (!mobileUser) {
      // Optional: Check if mobile exists with other clients (for analytics)
      const crossClientUsage = await MobileUser.getMobileUsageAcrossClients(
        mobile
      );

      return res.status(200).json({
        success: true,
        responseCode: 1503, // Same as original - new user
        user_exists: false,
        client_id: clientId,
        client_name: client.businessName,
        message: "New user. Registration required.",
        // Optional info for debugging (remove in production if privacy concern)
        cross_client_usage_count: crossClientUsage.length,
      });
    }

    // Check profile completeness
    const profile = await UserProfile.findOne({ userId: mobileUser._id });

    res.status(200).json({
      success: true,
      responseCode: profile ? 1504 : 1505, // Same as original - complete/incomplete profile
      user_exists: true,
      is_profile_complete: !!profile,
      client_id: clientId,
      client_name: client.businessName,
      user_id: mobileUser._id,
      last_login: mobileUser.lastLoginAt,
      login_count: mobileUser.loginCount,
      message: profile
        ? "User exists with complete profile."
        : "User exists but profile incomplete.",
    });
  } catch (error) {
    console.error("Check user error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1506, // Same as original check-user internal error
      message: "Internal server error. Please try again later.",
    });
  }
});

// Route: Delete user (mobile/email) + related profile
// POST /api/clients/:clientId/mobile/auth/delete-user
// Body: { "mobile": "9876543210" } OR { "email": "user@gmail.com" }
router.post("/delete-user", validateClient, async (req, res) => {
  try {
    const clientId = req.params.clientId;
    const { mobile, email } = req.body || {};

    const hasMobile = typeof mobile !== "undefined" && mobile !== null && String(mobile).trim() !== "";
    const hasEmail = typeof email !== "undefined" && email !== null && String(email).trim() !== "";

    if (!hasMobile && !hasEmail) {
      return res.status(400).json({
        success: false,
        responseCode: 1602,
        message: "Provide either mobile or email.",
      });
    }
    if (hasMobile && hasEmail) {
      return res.status(400).json({
        success: false,
        responseCode: 1603,
        message: "Provide only one of mobile or email.",
      });
    }

    let deleted = {
      mobile_user: false,
      email_user: false,
      profile: false,
      credit_account: false,
    };

    let mobileUserId = null;

    if (hasMobile) {
      const mobileNorm = String(mobile).trim();
      if (!validateMobile(mobileNorm)) {
        return res.status(400).json({
          success: false,
          responseCode: 1502,
          message: "Please enter a valid 10-digit mobile number.",
        });
      }

      const mobileUser = await MobileUser.findByMobileAndClient(
        mobileNorm,
        clientId
      );
      if (!mobileUser) {
        return res.status(404).json({
          success: false,
          responseCode: 1604,
          message: "User not found for this mobile and client.",
        });
      }

      mobileUserId = mobileUser._id;
      deleted.mobile_user = true;

      // Delete profile (UserProfile belongs to MobileUser.userId)
      const profileRes = await UserProfile.deleteMany({ userId: mobileUserId });
      deleted.profile = profileRes.deletedCount > 0;

      // Delete credit account
      const creditRes = await CreditAccount.deleteMany({ userId: mobileUserId });
      deleted.credit_account = creditRes.deletedCount > 0;

      await MobileUser.deleteMany({ _id: mobileUserId });
    } else {
      const emailNorm = String(email).toLowerCase().trim();
      if (!validateEmail(emailNorm)) {
        return res.status(400).json({
          success: false,
          responseCode: 1605,
          message: "Please enter a valid email address.",
        });
      }

      const emailUser = await MobileUser.findOne({
        email: emailNorm,
        clientId,
        isActive: true,
      });
      if (!emailUser) {
        return res.status(404).json({
          success: false,
          responseCode: 1606,
          message: "User not found for this email and client.",
        });
      }

      deleted.email_user = true;
      mobileUserId = emailUser._id;
      const profileRes = await UserProfile.deleteMany({ userId: mobileUserId });
      deleted.profile = profileRes.deletedCount > 0;
      const creditRes = await CreditAccount.deleteMany({ userId: mobileUserId });
      deleted.credit_account = creditRes.deletedCount > 0;
      await MobileUser.deleteMany({ _id: mobileUserId });
      deleted.mobile_user = true;
    }

    return res.status(200).json({
      success: true,
      responseCode: 1601,
      message: "User deleted successfully.",
      deleted,
    });
  } catch (error) {
    console.error("delete-user error:", error);
    return res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Route: Enhanced Login/Register with better duplicate handling
// Enhanced Login Route with clearer duplicate handling
router.post("/login", validateClient, async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    let org = null;
    if (client.organization && client.organization !== null) {
      org = client.organization.toString()
    }
    if (!mobile || !validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        responseCode: 1509,
        message: "Please enter a valid 10-digit mobile number.",
      });
    }

    const otpClientKey = "ailisher";
    // OTP verification must happen on a separate API.
    if (otp) {
      return res.status(400).json({
        success: false,
        responseCode: 1563,
        message: "OTP verification is not supported in /login. Use /verify-login-otp.",
      });
    }

    await sendLoginOtpToWhatsApp({ mobile, clientKey: otpClientKey });
    return res.status(200).json({
      success: true,
      responseCode: 1562,
      otp_required: true,
      message: "OTP sent to WhatsApp. Please verify to login.",
      client_id: clientId,
      mobile,
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Route: Verify OTP and perform login/register
router.post("/verify-login-otp", validateClient, async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    let org = null;
    if (client.organization && client.organization !== null) {
      org = client.organization.toString();
    }

    if (!mobile || !validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        responseCode: 1509,
        message: "Please enter a valid 10-digit mobile number.",
      });
    }

    if (!otp || !validateOtp(otp)) {
      return res.status(400).json({
        success: false,
        responseCode: 1563,
        message: "Please enter a valid 6-digit OTP.",
      });
    }

    const otpClientKey = "ailisher";
    const otpResult = await verifyLoginOtpFromWhatsApp({
      mobile,
      otp,
      clientKey: otpClientKey,
    });

    if (!otpResult.success) {
      return res.status(400).json({
        success: false,
        responseCode: 1563,
        message: otpResult.message,
      });
    }

    // First, try to find existing user
    let mobileUser = await MobileUser.findByMobileAndClient(mobile, clientId);
    let isNewUser = false;

    if (mobileUser) {
      // EXISTING USER - Treat as login
      console.log(`Existing user login: ${mobile} for client: ${clientId}`);

      // Generate new token for existing user
      const token = generateToken(mobileUser._id, mobile, clientId);
      mobileUser.authToken = token;
      await mobileUser.save(); // This will increment loginCount via pre-save hook

      // 2. Immediately create a credit account for this user
      const existing = await CreditAccount.findOne({
        userId: mobileUser._id,
      });
      if (!existing) {
        const creditAccount = new CreditAccount({
          userId: mobileUser._id,
          mobile: mobileUser.mobile,
          clientId: mobileUser.clientId,
          balance: 0,
          totalEarned: 0,
          totalSpent: 0,
        });
        await creditAccount.save();
      }
    } else {
      // NEW USER - Create account
      console.log(`Creating new user: ${mobile} for client: ${clientId}`);
      isNewUser = true;

      try {
        // Determine registration position within this client BEFORE creating
        const totalUsersBefore = await MobileUser.countDocuments({ clientId });
        const registrationNumber = totalUsersBefore + 1;
        mobileUser = new MobileUser({
          mobile,
          clientId,
          isVerified: true,
        });

        const token = generateToken(null, mobile, clientId); // Temporary token for new user
        mobileUser.authToken = token;

        await mobileUser.save();

        if (clientId === "CLI147189HIGB") {
          // Send Telegram alert for new user
          try {
            await axios.post(
              `http://localhost:4000/api/clients/${clientId}/telegram/send-text`,
              {
                text: `🆕 <b>New User Registered!</b>\n\n📱 <b>Mobile:${mobile}</b>\n#️⃣ <b>User No:</b> ${registrationNumber}\n⏰ <b>Time:${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</b>`,
              }
            );
          } catch (telegramError) {
            console.error(
              "Failed to send Telegram alert:",
              telegramError.message
            );
            // Don't fail the registration if Telegram fails
          }
        }

        if (org === "68eceaefbc63e372b4906b67") {
          try {
            const botToken = process.env.TELEGRAM_ORG_ALERT_BOT_TOKEN;
            const chatId = process.env.TELEGRAM_ORG_ALERT_CHAT_ID;
            if (!botToken || !chatId) {
              console.warn(
                "Org Telegram alert skipped: set TELEGRAM_ORG_ALERT_BOT_TOKEN and TELEGRAM_ORG_ALERT_CHAT_ID in .env"
              );
            } else {
              const bot = new Telegraf(botToken);
              const text = `🆕 <b>New User Registered in ${client.businessName}</b>\n\n🏢 <b>ClientId:</b> ${clientId}\n📱 <b>Mobile:${mobile}</b>\n#️⃣ <b>User No:</b> ${registrationNumber}\n⏰ <b>Time:${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</b>`;
              await bot.telegram.sendMessage(chatId, text, {
                parse_mode: "HTML",
              });
            }
          } catch (error) {
            console.error("Error sending text to Telegram:", error);
          }
        }

        // 2. Immediately create a credit account for this user
        const existing = await CreditAccount.findOne({
          userId: mobileUser._id,
        });
        if (!existing) {
          const creditAccount = new CreditAccount({
            userId: mobileUser._id,
            mobile: mobileUser.mobile,
            clientId: mobileUser.clientId,
            balance: 0,
            totalEarned: 0,
            totalSpent: 0,
          });
          await creditAccount.save();
        }

        // Update token with actual user ID after save
        const finalToken = generateToken(mobileUser._id, mobile, clientId);
        mobileUser.authToken = finalToken;
        await mobileUser.save();

        console.log(
          `New mobile user created successfully: ${mobile} for client: ${clientId}`
        );
      } catch (saveError) {
        // Handle race condition where user might have been created between our check and save
        if (saveError.message.includes("Mobile number already exists for this client")) {
          console.log(
            `Race condition detected - user created concurrently: ${mobile} for client: ${clientId}`
          );

          // Fetch the user that was created in the meantime
          mobileUser = await MobileUser.findByMobileAndClient(mobile, clientId);

          if (!mobileUser) {
            throw new Error(
              "User creation failed and subsequent lookup failed"
            );
          }

          // Treat as existing user login
          const token = generateToken(mobileUser._id, mobile, clientId);
          mobileUser.authToken = token;
          await mobileUser.save();
          isNewUser = false; // Update flag since user already existed
        } else {
          throw saveError; // Re-throw other errors
        }
      }
    }

    // Check profile completeness
    const profile = await UserProfile.findOne({ userId: mobileUser._id });
    const isProfileComplete = !!profile;

    // Prepare response
    const response = {
      status: isProfileComplete ? "LOGIN_SUCCESS" : "PROFILE_REQUIRED",
      success: true,
      responseCode: isProfileComplete ? 1510 : 1511,
      // Only return final auth token after profile completion (step 3).
      token: isProfileComplete ? mobileUser.authToken : undefined,
      // Use this token to call `/profile` when profile is incomplete.
      temp_token: !isProfileComplete ? mobileUser.authToken : undefined,
      is_profile_complete: isProfileComplete,
      is_new_user: isNewUser,
      user_id: mobileUser._id,
      client_id: clientId,
      client_name: client.businessName,
      mobile: mobileUser.mobile,
      login_count: mobileUser.loginCount,
      message: isProfileComplete
        ? isNewUser
          ? "Account created and login successful."
          : "Login successful."
        : "Please complete your profile to continue.",
    };

    // Add profile data if complete
    if (isProfileComplete) {
      response.profile = {
        name: profile.name,
        age: profile.age,
        gender: profile.gender,
        exams: profile.exams,
        native_language: profile.nativeLanguage,
      };
    } else {
      response.profile_options = profileOptionsPayload();
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("Verify-login-otp error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Google sign-in: email + clientId — no email OTP; step 1 done. New users continue to mobile OTP (step 2).
router.post("/google-login", validateClient, async (req, res) => {
  try {
    const { email } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    const emailNorm = String(email || "").toLowerCase().trim();

    if (!emailNorm || !validateEmail(emailNorm)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "A valid email is required.",
      });
    }

    let user = await MobileUser.findOne({
      email: emailNorm,
      clientId,
      isActive: true,
    });
    let isNewUser = false;

    if (user) {
      if (user.loginProvider === "email" && user.passwordHash) {
        return res.status(409).json({
          success: false,
          responseCode: 1592,
          message:
            "This email is registered with a password. Sign in with email and password or use the account that matches Google.",
        });
      }
      const token = generateToken(user._id, user.mobile ?? undefined, clientId);
      user.authToken = token;
      user.loginProvider = "google";
      await user.save();
    } else {
      isNewUser = true;
      user = new MobileUser({
        email: emailNorm,
        clientId,
        loginProvider: "google",
        isVerified: true,
        emailOtpVerified: true,
        mobileOtpVerified: false,
      });
      await user.save();
      const token = generateToken(user._id, user.mobile ?? undefined, clientId);
      user.authToken = token;
      await user.save();
      await sendWelcomeEmail({
        to: user.email,
        clientName: client.businessName,
        clientId,
      });
    }

    const response = await finalizeEmailUserSessionResponse(
      user,
      clientId,
      client,
      isNewUser,
      "google_email"
    );
    res.status(200).json(response);
  } catch (error) {
    console.error("Google login error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Step 1a — Email + password: creates account, sends Brevo OTP (no auth token until verify-email-otp)
router.post("/onboarding/register-email-password", validateClient, async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    const emailNorm = String(email || "").toLowerCase().trim();

    if (!emailNorm || !validateEmail(emailNorm)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "A valid email is required.",
      });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Password must be at least 6 characters.",
      });
    }

    const existing = await MobileUser.findOne({
      email: emailNorm,
      clientId,
      isActive: true,
    });
    if (existing) {
      if (existing.emailOtpVerified !== false) {
        return res.status(409).json({
          success: false,
          responseCode: 1592,
          message: "Email already registered. Sign in or use Google login.",
        });
      }
      // Verification still pending: allow repeat calls — update password and send a fresh OTP each time
      existing.passwordHash = await bcrypt.hash(String(password), 10);
      existing.loginProvider = "email";
      await existing.save();

      await createAndSendEmailOtp({
        email: emailNorm,
        clientId,
        clientName: client.businessName,
      });

      return res.status(200).json({
        success: true,
        responseCode: 1597,
        email_otp_required: true,
        message: "Verification code sent to your email.",
        email: emailNorm,
        next_step: 1,
        resent: true,
      });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = new MobileUser({
      email: emailNorm,
      clientId,
      passwordHash,
      loginProvider: "email",
      emailOtpVerified: false,
      mobileOtpVerified: false,
      authToken: null,
    });
    await user.save();

    await createAndSendEmailOtp({
      email: emailNorm,
      clientId,
      clientName: client.businessName,
    });

    return res.status(200).json({
      success: true,
      responseCode: 1597,
      email_otp_required: true,
      message: "Verification code sent to your email.",
      email: emailNorm,
      next_step: 1,
      resent: false,
    });
  } catch (error) {
    console.error("register-email-password error:", error);
    const msg =
      error.message && String(error.message).includes("Brevo")
        ? error.message
        : "Internal server error. Please try again later.";
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: msg,
    });
  }
});

router.post("/onboarding/resend-email-otp", validateClient, async (req, res) => {
  try {
    const { email } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    const emailNorm = String(email || "").toLowerCase().trim();

    if (!emailNorm || !validateEmail(emailNorm)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "A valid email is required.",
      });
    }

    const user = await MobileUser.findOne({
      email: emailNorm,
      clientId,
      isActive: true,
    });
    if (!user || user.emailOtpVerified !== false) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "No pending email verification for this address.",
      });
    }

    await createAndSendEmailOtp({
      email: emailNorm,
      clientId,
      clientName: client.businessName,
    });

    return res.status(200).json({
      success: true,
      responseCode: 1597,
      email_otp_required: true,
      message:
        "Verification code sent to your email. You can request a new code again anytime before you verify.",
      email: emailNorm,
      next_step: 1,
    });
  } catch (error) {
    console.error("resend-email-otp error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: error.message || "Internal server error.",
    });
  }
});

// Step 1b — Verify Brevo email OTP → JWT; then continue to step 2 (mobile)
router.post("/onboarding/verify-email-otp", validateClient, async (req, res) => {
  try {
    const { email, otp } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    const emailNorm = String(email || "").toLowerCase().trim();

    if (!emailNorm || !validateEmail(emailNorm) || !otp || !validateOtp(otp)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Valid email and 6-digit OTP are required.",
      });
    }

    const chk = await verifyEmailOtpRecord({
      email: emailNorm,
      clientId,
      otp,
    });
    if (!chk.ok) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: chk.message,
      });
    }

    const user = await MobileUser.findOne({
      email: emailNorm,
      clientId,
      isActive: true,
    });
    if (!user) {
      return res.status(404).json({
        success: false,
        responseCode: 1592,
        message: "User not found.",
      });
    }

    user.emailOtpVerified = true;
    const token = generateToken(user._id, user.mobile ?? undefined, clientId);
    user.authToken = token;
    await user.save();

    const profile = await UserProfile.findOne({ userId: user._id });
    const isNewUser = !profile;

    const response = await finalizeEmailUserSessionResponse(
      user,
      clientId,
      client,
      isNewUser,
      "email_password"
    );
    response.responseCode = 1598;
    res.status(200).json(response);
  } catch (error) {
    console.error("verify-email-otp error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Step 1 — Sign in with email + password (after email OTP was verified once)
router.post("/onboarding/login-email-password", validateClient, async (req, res) => {
  try {
    const { email, password, mobile, mobile_for_otp } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    const emailNorm = String(email || "").toLowerCase().trim();
    const mobileNorm = String(mobile || "").trim();

    // Allow: (email + password) OR (mobile + password)
    const hasEmail = !!emailNorm;
    const hasMobile = !!mobileNorm;

    if ((!hasEmail && !hasMobile) || !password) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Email or mobile, and password are required.",
      });
    }
    if (hasEmail && !validateEmail(emailNorm)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Please enter a valid email address.",
      });
    }
    if (hasMobile && !validateMobile(mobileNorm)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Please enter a valid 10-digit mobile number.",
      });
    }

    const user = await MobileUser.findOne(
      hasEmail
        ? { email: emailNorm, clientId, isActive: true }
        : { mobile: mobileNorm, clientId, isActive: true }
    );
    if (!user) {
      return res.status(401).json({
        success: false,
        responseCode: 1592,
        message: "Invalid credentials.",
      });
    }
    if (!user.passwordHash) {
      return res.status(409).json({
        success: false,
        responseCode: 1592,
        message:
          "This account does not have a password. Please login using WhatsApp OTP.",
      });
    }
    if (user.emailOtpVerified === false) {
      return res.status(403).json({
        success: false,
        responseCode: 1592,
        message: "Verify your email with the OTP first.",
      });
    }

    const match = await bcrypt.compare(String(password), user.passwordHash);
    if (!match) {
      return res.status(401).json({
        success: false,
        responseCode: 1592,
        message: "Invalid credentials.",
      });
    }

    const token = generateToken(user._id, user.mobile ?? undefined, clientId);
    user.authToken = token;
    user.loginProvider = "email";
    await user.save();

    const profile = await UserProfile.findOne({ userId: user._id });
    const response = await finalizeEmailUserSessionResponse(
      user,
      clientId,
      client,
      false,
      "email_password"
    );

    // Optional: if the client app already has a mobile and wants to trigger WhatsApp OTP immediately,
    // allow it in the same login call (still verified via /onboarding/verify-mobile-otp).
    // NOTE: use `mobile_for_otp` to avoid conflicting with "login by mobile + password"
    if (response.next_step === 2 && mobile_for_otp && validateMobile(mobile_for_otp)) {
      const otpClientKey = "ailisher";
      await sendLoginOtpToWhatsApp({ mobile: mobile_for_otp, clientKey: otpClientKey });
      response.otp_required = true;
      response.mobile_for_otp = mobile_for_otp;
      response.message =
        "Step 1 complete. OTP sent to WhatsApp for mobile verification (step 2).";
    }

    res.status(200).json(response);
  } catch (error) {
    console.error("login-email-password error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Main onboarding mobile login (WhatsApp OTP) — send OTP
router.post("/onboarding/login-mobile", validateClient, async (req, res) => {
  try {
    const { mobile } = req.body;
    const clientId = req.params.clientId;
    if (!mobile || !validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        responseCode: 1509,
        message: "Please enter a valid 10-digit mobile number.",
      });
    }
    const otpClientKey = "ailisher";
    await sendLoginOtpToWhatsApp({ mobile, clientKey: otpClientKey });
    return res.status(200).json({
      success: true,
      responseCode: 1562,
      otp_required: true,
      message: "OTP sent to WhatsApp. Please verify to continue.",
      client_id: clientId,
      mobile,
    });
  } catch (error) {
    console.error("onboarding login-mobile error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Main onboarding mobile login (WhatsApp OTP) — verify OTP and finalize response
// Pass optional `email` if you already registered with email+password so both merge into one MobileUser.
router.post("/onboarding/verify-mobile-login-otp", validateClient, async (req, res) => {
  try {
    const { mobile, otp, email } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    const emailNorm = email ? String(email || "").toLowerCase().trim() : "";

    if (!mobile || !validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        responseCode: 1509,
        message: "Please enter a valid 10-digit mobile number.",
      });
    }
    if (!otp || !validateOtp(otp)) {
      return res.status(400).json({
        success: false,
        responseCode: 1563,
        message: "Please enter a valid 6-digit OTP.",
      });
    }
    if (emailNorm && !validateEmail(emailNorm)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Please enter a valid email address.",
      });
    }

    const otpClientKey = "ailisher";
    const otpResult = await verifyLoginOtpFromWhatsApp({
      mobile,
      otp,
      clientKey: otpClientKey,
    });
    if (!otpResult.success) {
      return res.status(400).json({
        success: false,
        responseCode: 1563,
        message: otpResult.message,
      });
    }

    let user = await MobileUser.findByMobileAndClient(mobile, clientId);
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = new MobileUser({
        mobile,
        clientId,
        isVerified: true,
        loginProvider: "mobile",
        emailOtpVerified: true,
        mobileOtpVerified: true,
      });
      await user.save();
    }

    let merged = false;
    if (emailNorm) {
      const emailUser = await MobileUser.findOne({
        email: emailNorm,
        clientId,
        isActive: true,
      });
      if (emailUser && String(emailUser._id) !== String(user._id)) {
        if (user.email && user.email !== emailNorm) {
          return res.status(409).json({
            success: false,
            responseCode: 1592,
            message: "This mobile is already linked to a different email for this client.",
          });
        }
        user = await mergeEmailUserIntoMobileUser({
          emailUser,
          mobileUser: user,
          mobile,
          clientId,
        });
        merged = true;
        isNewUser = false;
      }
    }

    if (!merged) {
      user.mobile = mobile;
      user.mobileOtpVerified = true;
      if (user.emailOtpVerified === false) user.emailOtpVerified = true;
      user.loginProvider = user.loginProvider || "mobile";

      const token = generateToken(user._id, user.mobile ?? undefined, clientId);
      user.authToken = token;
      await user.save();
    }

    const response = await finalizeEmailUserSessionResponse(
      user,
      clientId,
      client,
      isNewUser,
      merged ? "email_password" : "whatsapp_mobile"
    );
    response.responseCode = isNewUser ? 1591 : 1590;
    if (merged) {
      response.merged_user = true;
      response.auth_type = "email_password";
    }
    res.status(200).json(response);
  } catch (error) {
    console.error("onboarding verify-mobile-login-otp error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Step 2 — Send WhatsApp OTP for mobile (requires email/Google JWT)
router.post(
  "/onboarding/send-mobile-otp",
  validateClient,
  authenticateMobileUser,
  async (req, res) => {
    try {
      const clientId = req.params.clientId;
      const { mobile } = req.body;

      const user = await MobileUser.findOne({
        _id: req.user.id,
        clientId,
        isActive: true,
      });
      if (!user || !step1EmailComplete(user)) {
        return res.status(403).json({
          success: false,
          responseCode: 1592,
          message: "Complete email verification (step 1) first.",
        });
      }

      if (!mobile || !validateMobile(mobile)) {
        return res.status(400).json({
          success: false,
          responseCode: 1509,
          message: "Please enter a valid 10-digit mobile number.",
        });
      }

      const otpClientKey = "ailisher";
      await sendLoginOtpToWhatsApp({ mobile, clientKey: otpClientKey });

      return res.status(200).json({
        success: true,
        responseCode: 1599,
        otp_required: true,
        message: "OTP sent to WhatsApp. Use verify-mobile-otp next.",
        client_id: clientId,
        mobile,
        next_step: 2,
      });
    } catch (error) {
      console.error("onboarding send-mobile-otp error:", error);
      res.status(500).json({
        success: false,
        responseCode: 1512,
        message: "Internal server error. Please try again later.",
      });
    }
  }
);

// Step 2 — Verify WhatsApp OTP and link mobile
router.post(
  "/onboarding/verify-mobile-otp",
  validateClient,
  authenticateMobileUser,
  async (req, res) => {
    try {
      const clientId = req.params.clientId;
      const client = req.client;
      const { mobile, otp, email } = req.body;
      const emailNorm = email ? String(email || "").toLowerCase().trim() : "";

      if (!mobile || !validateMobile(mobile) || !otp || !validateOtp(otp)) {
        return res.status(400).json({
          success: false,
          responseCode: 1592,
          message: "Valid 10-digit mobile and 6-digit OTP are required.",
        });
      }
      if (emailNorm && !validateEmail(emailNorm)) {
        return res.status(400).json({
          success: false,
          responseCode: 1592,
          message: "Please enter a valid email address.",
        });
      }

      const otpClientKey = "ailisher";
      const otpResult = await verifyLoginOtpFromWhatsApp({
        mobile,
        otp,
        clientKey: otpClientKey,
      });
      if (!otpResult.success) {
        return res.status(400).json({
          success: false,
          responseCode: 1563,
          message: otpResult.message,
        });
      }

      const user = await MobileUser.findOne({
        _id: req.user.id,
        clientId,
        isActive: true,
      });
      if (!user) {
        return res.status(404).json({
          success: false,
          responseCode: 1592,
          message: "User not found.",
        });
      }

      // If caller provides an email, and that email belongs to a different user in this client,
      // merge that email-user into the mobile-owner user so both identifiers live in ONE document.
      if (emailNorm) {
        const emailUser = await MobileUser.findOne({
          email: emailNorm,
          clientId,
          isActive: true,
        });
        const mobileUser = await MobileUser.findOne({
          mobile,
          clientId,
          isActive: true,
        });

        if (emailUser && mobileUser && String(emailUser._id) !== String(mobileUser._id)) {
          const mergedUser = await mergeEmailUserIntoMobileUser({
            emailUser,
            mobileUser,
            mobile,
            clientId,
          });
          const response = await finalizeEmailUserSessionResponse(
            mergedUser,
            clientId,
            client,
            false,
            mergedUser.loginProvider === "google" ? "google_email" : "email_password"
          );
          response.responseCode = 1600;
          response.merged_user = true;
          return res.status(200).json(response);
        }
      }
      // Enforce unique mobile per client across all users.
      // If this mobile already exists on another "mobile-only" user, MERGE accounts into one record.
      const existingWithMobile = await MobileUser.findOne({
        mobile,
        clientId,
        isActive: true,
        _id: { $ne: user._id },
      });
      if (existingWithMobile) {
        // If the existing record already has an email, we cannot merge safely (would violate unique email).
        if (existingWithMobile.email) {
          return res.status(409).json({
            success: false,
            responseCode: 1592,
            message: "This mobile number is already registered for this client.",
          });
        }
        const mergedUser = await mergeEmailUserIntoMobileUser({
          emailUser: user,
          mobileUser: existingWithMobile,
          mobile,
          clientId,
        });
        const response = await finalizeEmailUserSessionResponse(
          mergedUser,
          clientId,
          client,
          false,
          mergedUser.loginProvider === "google" ? "google_email" : "email_password"
        );
        response.responseCode = 1600;
        response.merged_user = true;
        return res.status(200).json(response);
      }

      user.mobile = mobile;
      user.mobileOtpVerified = true;
      await user.save();

      const response = await finalizeEmailUserSessionResponse(
        user,
        clientId,
        client,
        false,
        user.loginProvider === "google" ? "google_email" : "email_password"
      );
      response.responseCode = 1600;
      res.status(200).json(response);
    } catch (error) {
      console.error("onboarding verify-mobile-otp error:", error);
      res.status(500).json({
        success: false,
        responseCode: 1512,
        message: "Internal server error. Please try again later.",
      });
    }
  }
);

// Forgot password / resend reset email (email accounts with password only).
async function handleForgotOrResendPasswordEmail(req, res) {
  try {
    const { email } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    const emailNorm = String(email || "").toLowerCase().trim();

    if (!emailNorm || !validateEmail(emailNorm)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "A valid email is required.",
      });
    }

    const user = await MobileUser.findOne({
      email: emailNorm,
      clientId,
      isActive: true,
    });

    const generic = {
      success: true,
      responseCode: 1593,
      message:
        "If an account with this email exists, a password reset link has been sent.",
    };

    if (!user || !user.passwordHash) {
      return res.status(200).json(generic);
    }

    await EmailResetToken.updateMany(
      { email: emailNorm, clientId, used: false },
      { used: true }
    );

    const rawToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await EmailResetToken.create({
      email: emailNorm,
      clientId,
      token: rawToken,
      expiresAt,
      used: false,
    });

    const base =
      process.env.PASSWORD_RESET_BASE_URL ||
      process.env.MOBILE_APP_URL ||
      "https://example.com";
    const resetUrl = `${String(base).replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(rawToken)}&clientId=${encodeURIComponent(clientId)}`;

    await sendPasswordResetEmail({
      to: emailNorm,
      resetUrl,
      clientName: client.businessName,
    });

    return res.status(200).json(generic);
  } catch (error) {
    console.error("Forgot-password-email error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
}

// Reset password using token from email (body: token, newPassword)
async function handleResetPasswordEmail(req, res) {
  try {
    const { token, newPassword } = req.body;
    const clientId = req.params.clientId;

    if (!token || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Valid token and new password (min 6 characters) are required.",
      });
    }

    const record = await EmailResetToken.findOne({
      token: String(token).trim(),
      clientId,
      used: false,
    });

    if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Invalid or expired reset token.",
      });
    }

    const user = await MobileUser.findOne({
      email: record.email,
      clientId,
      isActive: true,
    });
    if (!user) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "User not found.",
      });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    user.loginProvider = "email";
    await user.save();

    record.used = true;
    await record.save();

    res.status(200).json({
      success: true,
      responseCode: 1594,
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("Reset-password-email error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
}

router.post("/forgot-password-email", validateClient, handleForgotOrResendPasswordEmail);
router.post("/resend-password-reset-email", validateClient, handleForgotOrResendPasswordEmail);
router.post("/reset-password-email", validateClient, handleResetPasswordEmail);

// ---------- Password reset via Brevo OTP (preferred) ----------
async function handleForgotOrResendPasswordEmailOtp(req, res) {
  try {
    const { email } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    const emailNorm = String(email || "").toLowerCase().trim();

    if (!emailNorm || !validateEmail(emailNorm)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "A valid email is required.",
      });
    }
    if (!brevoEnabled()) {
      return res.status(500).json({
        success: false,
        responseCode: 1512,
        message: "Email OTP requires Brevo: set USE_BREVO=true and BREVO_API_KEY in .env",
      });
    }

    const user = await MobileUser.findOne({
      email: emailNorm,
      clientId,
      isActive: true,
    });

    // Generic response for privacy (same as link flow)
    const generic = {
      success: true,
      responseCode: 1593,
      message:
        "If an account with this email exists, a password reset OTP has been sent.",
    };

    if (!user || !user.passwordHash) {
      return res.status(200).json(generic);
    }

    await PasswordResetOtp.updateMany(
      { email: emailNorm, clientId, isUsed: false },
      { isUsed: true }
    );

    const otp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await PasswordResetOtp.create({
      email: emailNorm,
      clientId,
      otp,
      expiresAt,
      isUsed: false,
    });

    const result = await sendPasswordResetOtpViaBrevo({
      to: emailNorm,
      otp,
      clientName: client.businessName,
    });
    if (!result.sent) {
      throw new Error(
        result.reason === "missing_api_key"
          ? "BREVO_API_KEY is not set"
          : "Failed to send reset OTP email"
      );
    }

    return res.status(200).json(generic);
  } catch (error) {
    console.error("Forgot-password-email-otp error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: error.message || "Internal server error. Please try again later.",
    });
  }
}

async function handleResetPasswordEmailOtp(req, res) {
  try {
    const { email, otp, newPassword } = req.body;
    const clientId = req.params.clientId;
    const emailNorm = String(email || "").toLowerCase().trim();

    if (!emailNorm || !validateEmail(emailNorm) || !otp || !validateOtp(otp)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Valid email and 6-digit OTP are required.",
      });
    }
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "New password must be at least 6 characters.",
      });
    }

    const record = await PasswordResetOtp.findOne({
      email: emailNorm,
      clientId,
      otp: String(otp).trim(),
      isUsed: false,
    });
    if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "Invalid or expired reset OTP.",
      });
    }

    const user = await MobileUser.findOne({
      email: emailNorm,
      clientId,
      isActive: true,
    });
    if (!user) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "User not found.",
      });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    user.loginProvider = "email";
    await user.save();

    record.isUsed = true;
    await record.save();

    res.status(200).json({
      success: true,
      responseCode: 1594,
      message: "Password updated successfully.",
    });
  } catch (error) {
    console.error("Reset-password-email-otp error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
}

router.post(
  "/forgot-password-email-otp",
  validateClient,
  handleForgotOrResendPasswordEmailOtp
);
router.post(
  "/resend-password-reset-email-otp",
  validateClient,
  handleForgotOrResendPasswordEmailOtp
);
router.post("/reset-password-email-otp", validateClient, handleResetPasswordEmailOtp);

// Same handlers under /onboarding/ for frontend grouping
router.post(
  "/onboarding/forgot-password-email",
  validateClient,
  handleForgotOrResendPasswordEmail
);
router.post(
  "/onboarding/resend-password-reset-email",
  validateClient,
  handleForgotOrResendPasswordEmail
);
router.post(
  "/onboarding/reset-password-email",
  validateClient,
  handleResetPasswordEmail
);

router.post(
  "/onboarding/forgot-password-email-otp",
  validateClient,
  handleForgotOrResendPasswordEmailOtp
);
router.post(
  "/onboarding/resend-password-reset-email-otp",
  validateClient,
  handleForgotOrResendPasswordEmailOtp
);
router.post(
  "/onboarding/reset-password-email-otp",
  validateClient,
  handleResetPasswordEmailOtp
);

router.post("/resend-welcome-email", validateClient, async (req, res) => {
  try {
    const { email } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;
    const emailNorm = String(email || "").toLowerCase().trim();

    if (!emailNorm || !validateEmail(emailNorm)) {
      return res.status(400).json({
        success: false,
        responseCode: 1592,
        message: "A valid email is required.",
      });
    }


    const user = await MobileUser.findOne({
      email: emailNorm,
      clientId,
      isActive: true,
    });
    if (!user) {
      return res.status(404).json({
        success: false,
        responseCode: 1592,
        message: "No account found for this email and client.",
      });
    }

    await sendWelcomeEmail({
      to: user.email,
      clientName: client.businessName,
      clientId,
    });

    res.status(200).json({
      success: true,
      responseCode: 1595,
      message: "Welcome email sent.",
    });
  } catch (error) {
    console.error("Resend-welcome-email error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Resend WhatsApp login OTP (same behaviour as POST /login)
router.post("/resend-login-otp", validateClient, async (req, res) => {
  try {
    const { mobile } = req.body;
    const clientId = req.params.clientId;

    if (!mobile || !validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        responseCode: 1509,
        message: "Please enter a valid 10-digit mobile number.",
      });
    }

    const otpClientKey = "ailisher";
    await sendLoginOtpToWhatsApp({ mobile, clientKey: otpClientKey });

    res.status(200).json({
      success: true,
      responseCode: 1562,
      otp_required: true,
      message: "OTP resent to WhatsApp. Please verify to login.",
      client_id: clientId,
      mobile,
    });
  } catch (error) {
    console.error("Resend-login-otp error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1512,
      message: "Internal server error. Please try again later.",
    });
  }
});

// Route: Get Mobile Usage Analytics (Admin only - optional)
router.get("/mobile-analytics/:mobile", async (req, res) => {
  try {
    const { mobile } = req.params;

    if (!validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        responseCode: 1502, // Using mobile validation error code
        message: "Please provide a valid 10-digit mobile number.",
      });
    }

    const usage = await MobileUser.getMobileUsageAcrossClients(mobile);
    const clientDetails = await Promise.all(
      usage.map(async (user) => {
        const client = await User.findOne({ userId: user.clientId }).select(
          "businessName userId"
        );
        return {
          client_id: user.clientId,
          client_name: client?.businessName || "Unknown",
          registered_at: user.createdAt,
        };
      })
    );

    res.status(200).json({
      success: true,
      responseCode: 1529, // Using test route success code for analytics
      mobile,
      total_clients: usage.length,
      client_details: clientDetails,
      message: `Mobile number is registered with ${usage.length} client(s).`,
    });
  } catch (error) {
    console.error("Mobile analytics error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1530, // Using router error code
      message: "Internal server error.",
    });
  }
});

// Route: Bulk Check Mobile Numbers (for client admin)
router.post("/bulk-check", validateClient, async (req, res) => {
  try {
    const { mobiles } = req.body;
    const clientId = req.params.clientId;

    if (!Array.isArray(mobiles) || mobiles.length === 0) {
      return res.status(400).json({
        success: false,
        responseCode: 1502, // Using mobile validation error code
        message: "Please provide an array of mobile numbers.",
      });
    }

    const results = await Promise.all(
      mobiles.map(async (mobile) => {
        if (!validateMobile(mobile)) {
          return {
            mobile,
            status: "invalid",
            message: "Invalid mobile number format",
          };
        }

        const user = await MobileUser.findByMobileAndClient(mobile, clientId);
        if (user) {
          const profile = await UserProfile.findOne({ userId: user._id });
          return {
            mobile,
            status: "exists",
            user_id: user._id,
            profile_complete: !!profile,
            last_login: user.lastLoginAt,
          };
        } else {
          return { mobile, status: "new", message: "Ready for registration" };
        }
      })
    );

    res.status(200).json({
      success: true,
      responseCode: 1529, // Using test route success code for bulk operations
      results,
      summary: {
        total: mobiles.length,
        existing: results.filter((r) => r.status === "exists").length,
        new: results.filter((r) => r.status === "new").length,
        invalid: results.filter((r) => r.status === "invalid").length,
      },
    });
  } catch (error) {
    console.error("Bulk check error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1530, // Using router error code
      message: "Internal server error.",
    });
  }
});

// Route: Create/Update Profile
router.post("/profile", authenticateMobileUser, async (req, res) => {
  try {
    console.log("=== PROFILE CREATE ROUTE HIT ===");
    const { name, age, gender, exams, native_language, city, pincode } = req.body;
    const clientId = req.params.clientId;
    const userId = req.user.id;
    const client = await User.findOne({ userId: clientId });
    let org = null;
    if (client.organization && client.organization !== null) {
      org = client.organization.toString()
    }
    console.log(req.body)
    const account = await MobileUser.findOne({ _id: userId, clientId });
    if (!account) {
      return res.status(403).json({
        success: false,
        responseCode: 1513, // Same as original profile access denied
        message: "Access denied. User does not belong to this client.",
      });
    }
    const profileOwnerId = userId;
    const contactLabel = account.mobile || account.email || "-";

    const pinStr = normalizeProfilePincode(pincode);
    const examsArr = Array.isArray(exams) ? exams : [];

    let profile = await UserProfile.findOne({ userId: profileOwnerId });
    const isNewProfile = !profile;
    console.log(profile);

    if (profile) {
      if (name !== undefined && name !== null)
        profile.name = String(name).trim();
      if (age !== undefined && age !== null) profile.age = String(age);
      if (gender !== undefined && gender !== null) profile.gender = String(gender);
      if (exams !== undefined) profile.exams = examsArr;
      if (native_language !== undefined && native_language !== null)
        profile.nativeLanguage = String(native_language);
      if (city !== undefined && city !== null) profile.city = String(city);
      if (pincode !== undefined) profile.pincode = pinStr;
      profile.updatedAt = new Date();
    } else {
      profile = new UserProfile({
        userId: profileOwnerId,
        name: name != null ? String(name).trim() : "",
        age: age != null ? String(age) : "",
        gender: gender != null ? String(gender) : "",
        exams: examsArr,
        nativeLanguage: native_language != null ? String(native_language) : "",
        clientId,
        city: city != null ? String(city) : "",
        pincode: pinStr,
      });
    }

    await profile.save();
    if (clientId === "CLI147189HIGB") {
      // Send Telegram alert for new user
      try {
        await axios.post(
          `http://localhost:4000/api/clients/${clientId}/telegram/send-text`,
          {
            text: `📄 <b>New Profile Created</b>\n\n👤 Name: ${profile.name || "-"}\n📱 Contact: ${contactLabel}\n🎂 Age: ${profile.age || "-"}\n📝 Exams: ${profile.exams || []}\n🗣️ Native Language: ${profile.nativeLanguage || "-"}\n🏙️ City: ${profile.city || '-'}\n🏷️ Pincode: ${profile.pincode || '-'}\n⏰ Created On: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
          }
        );
      } catch (telegramError) {
        console.error("Failed to send Telegram alert:", telegramError.message);
        // Don't fail the registration if Telegram fails
      }
    }
    if (org === "68eceaefbc63e372b4906b67") {
      try {
        const botToken = process.env.TELEGRAM_ORG_ALERT_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_ORG_ALERT_CHAT_ID;
        if (!botToken || !chatId) {
          console.warn(
            "Org Telegram alert skipped: set TELEGRAM_ORG_ALERT_BOT_TOKEN and TELEGRAM_ORG_ALERT_CHAT_ID in .env"
          );
        } else {
          const bot = new Telegraf(botToken);
          const text = `📄 <b>New Profile Created in ${client.businessName}</b>\n\n👤 Name: ${profile.name || "-"}\n📱 Contact: ${contactLabel}\n🎂 Age: ${profile.age || "-"}\n📝 Exams: ${profile.exams || []}\n🗣️ Native Language: ${profile.nativeLanguage || "-"}\n🏙️ City: ${profile.city || '-'}\n🏷️ Pincode: ${profile.pincode || '-'}\n⏰ Created On: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`;
          await bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
        }
      } catch (error) {
        console.error('Error sending text to Telegram:', error);
      }
    }

    // Token should be returned only after step 3 (profile saved).
    // For mobile flow, keep the same token used for this request.
    // For email flow, create the final mobile token now.
    const finalToken = account.authToken;

    res.status(200).json({
      status: "PROFILE_SAVED",
      success: true,
      responseCode: isNewProfile ? 1515 : 1516, // Same as original profile created/updated
      message: isNewProfile
        ? "Profile created successfully."
        : "Profile updated successfully.",
      token: finalToken,
      profile: {
        name: profile.name,
        age: profile.age,
        gender: profile.gender,
        exams: profile.exams,
        native_language: profile.nativeLanguage,
        city: profile.city,
        pincode: profile.pincode,
      },
    });
  } catch (error) {
    console.error("Profile creation error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1517, // Same as original profile internal error
      message: "Internal server error. Please try again later.",
    });
  }
});

// Route: Get Profile
router.get("/profile", authenticateMobileUser, async (req, res) => {
  try {
    console.log("=== GET PROFILE ROUTE HIT ===");
    const clientId = req.params.clientId;
    const userId = req.user.id;
    const client = await User.findOne({ userId: clientId });
    console.log("client", client)
    const account = await MobileUser.findOne({ _id: userId, clientId });
    if (!account) {
      return res.status(403).json({
        success: false,
        responseCode: 1518, // Same as original get profile access denied
        message: "Access denied. User does not belong to this client.",
      });
    }

    const profileOwnerId = userId;
    const profile = await UserProfile.findOne({ userId: profileOwnerId });

    if (!profile) {
      return res.status(200).json({
        success: true,
        responseCode: 1519, // Same as original profile not found
        is_profile_complete: false,
        message: "Profile not found. Please complete your profile setup.",
      });
    }

    const profileOut = {
      name: profile.name,
      age: profile.age,
      gender: profile.gender,
      exams: profile.exams,
      native_language: profile.nativeLanguage,
      city: profile.city,
      pincode: profile.pincode,
      isEvaluator: profile.isEvaluator,
      institute_name: client?.businessName,
      institute_logo: client?.businessLogo,
      created_at: profile.createdAt,
      updated_at: profile.updatedAt,
    };
    profileOut.email = account.email || null;
    profileOut.mobile = account.mobile || null;

    res.status(200).json({
      success: true,
      responseCode: 1520, // Same as original profile found
      is_profile_complete: true,
      profile: profileOut,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1521, // Same as original get profile internal error
      message: "Internal server error. Please try again later.",
    });
  }
});

// Route: Update Profile
router.put("/profile", authenticateMobileUser, async (req, res) => {
  try {
    console.log("=== UPDATE PROFILE ROUTE HIT ===");
    const { name, age, gender, exams, native_language, city, pincode } = req.body;
    const clientId = req.params.clientId;
    const userId = req.user.id;

    const account = await MobileUser.findOne({ _id: userId, clientId });
    if (!account) {
      return res.status(403).json({
        success: false,
        responseCode: 1522, // Same as original update profile access denied
        message: "Access denied. User does not belong to this client.",
      });
    }

    const profileOwnerId = userId;
    const profile = await UserProfile.findOne({ userId: profileOwnerId });
    if (!profile) {
      return res.status(404).json({
        success: false,
        responseCode: 1523, // Same as original update profile not found
        message: "Profile not found. Please create profile first.",
      });
    }

    // Update only provided fields — no required-field validation
    if (name !== undefined)
      profile.name = name != null ? String(name).trim() : "";
    if (age !== undefined)
      profile.age = age != null ? String(age) : "";
    if (gender !== undefined)
      profile.gender = gender != null ? String(gender) : "";
    if (exams !== undefined)
      profile.exams = Array.isArray(exams) ? exams : [];
    if (native_language !== undefined)
      profile.nativeLanguage =
        native_language != null ? String(native_language) : "";
    if (city !== undefined) profile.city = city != null ? String(city) : "";
    if (pincode !== undefined) profile.pincode = normalizeProfilePincode(pincode);
    profile.updatedAt = new Date();
    await profile.save();

    res.status(200).json({
      success: true,
      responseCode: 1525, // Same as original profile updated successfully
      message: "Profile updated successfully.",
      profile: {
        name: profile.name,
        age: profile.age,
        gender: profile.gender,
        exams: profile.exams,
        native_language: profile.nativeLanguage,
        city: profile.city,
        pincode: profile.pincode
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1526, // Same as original update profile internal error
      message: "Internal server error. Please try again later.",
    });
  }
});

// Route: Logout (invalidate token)
router.post("/logout", authenticateMobileUser, async (req, res) => {
  try {
    console.log("=== LOGOUT ROUTE HIT ===");
    const clientId = req.params.clientId;
    const userId = req.user.id;

    await MobileUser.findOneAndUpdate(
      { _id: userId, clientId },
      { authToken: null }
    );

    res.status(200).json({
      success: true,
      responseCode: 1527, // Same as original logout success
      message: "Logged out successfully.",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      responseCode: 1528, // Same as original logout internal error
      message: "Internal server error. Please try again later.",
    });
  }
});

// Add a test route to verify the router is working
router.get("/test", (req, res) => {
  console.log("=== TEST ROUTE HIT ===");
  console.log("req.params:", req.params);
  res.json({
    success: true,
    responseCode: 1529, // Same as original test route
    message: "Mobile auth router is working!",
    clientId: req.params.clientId,
    timestamp: new Date().toISOString(),
  });
});

// Add error handling middleware specific to this router
router.use((error, req, res, next) => {
  console.error("=== MOBILE AUTH ROUTER ERROR ===");
  console.error("Error:", error);
  console.error("Request URL:", req.originalUrl);
  console.error("Request Method:", req.method);
  console.error("Request Params:", req.params);
  console.error("Request Body:", req.body);

  res.status(500).json({
    success: false,
    responseCode: 1530, // Same as original router error
    message: "Router error occurred",
    error: error.message,
  });
});

console.log("Mobile Auth Routes module exported successfully");

module.exports = router;

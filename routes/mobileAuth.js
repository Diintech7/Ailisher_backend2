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

// Validation helpers
const validateMobile = (mobile) => /^\d{10}$/.test(mobile);
const validateAgeGroup = (age) =>
  ["<15", "15-18", "19-25", "26-31", "32-40", "40+"].includes(age);

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

    const client = await User.findOne({
      userId: clientId,
      role: "client",
      status: "active",
    });

    if (!client) {
      return res.status(400).json({
        success: false,
        responseCode: 1501, // Same as check-user invalid client
        message: "Invalid client ID or client is not active.",
      });
    }

    req.client = client; // Attach client info to request
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
    const { mobile } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;

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

// Route: Enhanced Login/Register with better duplicate handling
// Enhanced Login Route with clearer duplicate handling
router.post("/login", validateClient, async (req, res) => {
  try {
    const { mobile } = req.body;
    const clientId = req.params.clientId;
    const client = req.client;

    if (!mobile || !validateMobile(mobile)) {
      return res.status(400).json({
        success: false,
        responseCode: 1509,
        message: "Please enter a valid 10-digit mobile number.",
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

      // // Send Telegram alert for existing user login
      // try {
      //   await axios.post(`https://test.ailisher.com/api/clients/CLI147189HIGB/telegram/send-text`, {
      //     text: `👤 <b>User Login</b>\n\n📱 Mobile: ${mobile}\n🏢 Client ID: ${clientId}\n⏰ Time: ${new Date().toLocaleString()}\n🆔 User ID: ${mobileUser._id}\n🔢 Login Count: ${mobileUser.loginCount || 1}`
      //   });
      // } catch (telegramError) {
      //   console.error('Failed to send Telegram alert:', telegramError.message);
      //   // Don't fail the login if Telegram fails
      // }
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

        if(clientId === "CLI147189HIGB")
        {
        // Send Telegram alert for new user
        try {
          await axios.post(
            `https://test.ailisher.com/api/clients/${clientId}/telegram/send-text`,
            {
              text: `🆕 <b>New User Registered!</b>\n\n📱 <b>Mobile:${mobile}</b>\n#️⃣ <b>Registration No:</b> ${registrationNumber}\n⏰ <b>Time:${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</b>`
            },
            // {
            //   headers:{
            //     Authorization:`Bearer ${token}`
            //   }
            // }
            
          );
        } catch (telegramError) {
          console.error(
            "Failed to send Telegram alert:",
            telegramError.message
          );
          // Don't fail the registration if Telegram fails
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
        if (
          saveError.message.includes(
            "Mobile number already exists for this client"
          )
        ) {
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
      token: mobileUser.authToken,
      is_profile_complete: isProfileComplete,
      is_new_user: isNewUser,
      user_id: mobileUser._id,
      client_id: clientId,
      client_name: client.businessName,
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
      // Add profile options for incomplete profiles
      response.profile_options = {
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

    res.status(200).json(response);
  } catch (error) {
    console.error("Login error:", error);
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
    console.log(req.body)
    const mobileUser = await MobileUser.findOne({ _id: userId, clientId });
    if (!mobileUser) {
      return res.status(403).json({
        success: false,
        responseCode: 1513, // Same as original profile access denied
        message: "Access denied. User does not belong to this client.",
      });
    }

    // Validation
    const errors = [];
    if (!name || name.trim().length === 0) errors.push("Name is required.");
    if (!age || !validateAgeGroup(age))
      errors.push("Please select a valid age group.");
    if (!gender || !["Male", "Female", "Other"].includes(gender))
      errors.push("Please select a valid gender.");
    if (!exams || !Array.isArray(exams) || exams.length === 0)
      errors.push("Please select at least one exam.");
    if (!native_language) errors.push("Please select your native language.");
    // Optional: basic pincode validation if provided
    if (typeof pincode !== 'undefined' && pincode !== null && pincode !== '') {
      const pinStr = String(pincode).trim();
      if (!/^\d{6}$/.test(pinStr)) {
        errors.push("Please enter a valid 6-digit pincode.");
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        responseCode: 1514, // Same as original profile validation failed
        message: "Validation failed.",
        errors,
      });
    }

    let profile = await UserProfile.findOne({ userId });
    const isNewProfile = !profile;
    console.log(profile);

    if (profile) {
      profile.name = name.trim();
      profile.age = age;
      profile.gender = gender;
      profile.exams = exams;
      profile.nativeLanguage = native_language;
      profile.city = city;
      profile.pincode = Number(pincode) || 0;
      profile.updatedAt = new Date();
    } else {
      profile = new UserProfile({
        userId,
        name: name.trim(),
        age,
        gender,
        exams,
        nativeLanguage: native_language,
        clientId,
        city: typeof city !== 'undefined' ? city : '',
        pincode: typeof pincode !== 'undefined' ? (Number(pincode) || 0) : 0,
      });
    }

    await profile.save();
    if(clientId === "CLI147189HIGB")
    {
      // Send Telegram alert for new user
      try {
        await axios.post(
          `https://test.ailisher.com/api/clients/${clientId}/telegram/send-text`,
          {
            text: `📄 <b>New Profile Created</b>\n\n👤 Name: ${name}\n📱 Mobile: ${mobileUser.mobile}\n🎂 Age: ${age}\n📝 Exams: ${exams}\n🗣️ Native Language: ${native_language}\n🏙️ City: ${profile.city || '-'}\n🏷️ Pincode: ${profile.pincode || '-'}\n⏰ Created On: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
          }
        );
      } catch (telegramError) {
        console.error("Failed to send Telegram alert:", telegramError.message);
        // Don't fail the registration if Telegram fails
      }
    }


    res.status(200).json({
      status: "PROFILE_SAVED",
      success: true,
      responseCode: isNewProfile ? 1515 : 1516, // Same as original profile created/updated
      message: isNewProfile
        ? "Profile created successfully."
        : "Profile updated successfully.",
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

    const mobileUser = await MobileUser.findOne({ _id: userId, clientId });
    if (!mobileUser) {
      return res.status(403).json({
        success: false,
        responseCode: 1518, // Same as original get profile access denied
        message: "Access denied. User does not belong to this client.",
      });
    }

    const profile = await UserProfile.findOne({ userId }).populate(
      "userId",
      "mobile createdAt"
    );

    if (!profile) {
      return res.status(200).json({
        success: true,
        responseCode: 1519, // Same as original profile not found
        is_profile_complete: false,
        message: "Profile not found. Please complete your profile setup.",
      });
    }

    res.status(200).json({
      success: true,
      responseCode: 1520, // Same as original profile found
      is_profile_complete: true,
      profile: {
        name: profile.name,
        age: profile.age,
        gender: profile.gender,
        exams: profile.exams,
        native_language: profile.nativeLanguage,
        city:profile.city,
        pincode:profile.pincode,
        mobile: profile.userId.mobile,
        isEvaluator: profile.isEvaluator,
        created_at: profile.createdAt,
        updated_at: profile.updatedAt,
      },
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

    const mobileUser = await MobileUser.findOne({ _id: userId, clientId });
    if (!mobileUser) {
      return res.status(403).json({
        success: false,
        responseCode: 1522, // Same as original update profile access denied
        message: "Access denied. User does not belong to this client.",
      });
    }

    const profile = await UserProfile.findOne({ userId });
    if (!profile) {
      return res.status(404).json({
        success: false,
        responseCode: 1523, // Same as original update profile not found
        message: "Profile not found. Please create profile first.",
      });
    }

    // Update only provided fields with validation
    if (name !== undefined) profile.name = name.trim();
    if (age !== undefined) {
      if (!validateAgeGroup(age)) {
        return res.status(400).json({
          success: false,
          responseCode: 1524, // Same as original update profile invalid age
          message: "Please select a valid age group.",
        });
      }
      profile.age = age;
    }
    if (gender !== undefined) profile.gender = gender;
    if (exams !== undefined) profile.exams = exams;
    if (native_language !== undefined) profile.nativeLanguage = native_language;
    if(city !== undefined)profile.city = city;
    // Optional: basic pincode validation if provided
    if (pincode !== undefined) {
      const pinStr = String(pincode).trim();
      if (!/^\d{6}$/.test(pinStr)) {
        errors.push("Please enter a valid 6-digit pincode.");
      }
    } profile.pincode = pincode;
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
        city:profile.city,
        pincode:profile.pincode
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

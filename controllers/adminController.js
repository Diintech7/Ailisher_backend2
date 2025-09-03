// controllers/adminController.js - Admin controller functions
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');
const CreditPlan = require('../models/CreditPlan');
const MobileUser = require('../models/MobileUser');
const CreditAccount = require('../models/CreditAccount');
const CreditTransaction = require('../models/CreditTransaction');
const Client = require('../models/Client');
const CreditRechargePlan = require('../models/CreditRechargePlan');
const Payment = require('../models/Payment');
const UserProfile = require('../models/UserProfile');

// Generate JWT Token for admin
const generateAdminToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
};

// Register a new admin
exports.register = async (req, res) => {
  try {
    const { name, email, password, adminCode } = req.body;

    // Verify admin registration code
    if (adminCode !== process.env.ADMIN_REGISTRATION_CODE) {
      return res.status(401).json({ success: false, message: 'Invalid admin registration code' });
    }

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({ success: false, message: 'Admin with this email already exists' });
    }

    // Create new admin
    const admin = await Admin.create({
      name,
      email,
      password
    });

    // Generate token
    const token = generateAdminToken(admin._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email
      }
    });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Login admin
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check if admin exists
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check if password matches
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Generate token
    const token = generateAdminToken(admin._id);

    res.json({
      success: true,
      token,
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// Create new client
exports.createClient = async (req, res) => {
  try {
    const {
      businessName,
      businessOwnerName,
      email,
      businessNumber,
      businessGSTNumber,
      businessPANNumber,
      businessMobileNumber,
      businessCategory,
      businessAddress,
      city,
      pinCode,
      businessLogo,
      businessWebsite,
      businessYoutubeChannel,
      turnOverRange
    } = req.body;

    // Validate required fields
    const requiredFields = {
      businessName,
      businessOwnerName,
      email,
      businessNumber,
      businessGSTNumber,
      businessPANNumber,
      businessMobileNumber,
      businessCategory,
      businessAddress,
      city,
      pinCode
    };

    for (const [field, value] of Object.entries(requiredFields)) {
      if (!value || !value.toString().trim()) {
        return res.status(400).json({ 
          success: false, 
          message: `${field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} is required` 
        });
      }
    }

    // Check if client already exists
    const existingClient = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingClient) {
      return res.status(400).json({ 
        success: false, 
        message: 'Client with this email already exists' 
      });
    }

    // Generate a secure temporary password
    const tempPassword = generateTempPassword();

    // Create new client
    const client = await User.create({
      name: businessOwnerName.trim(),
      email: email.toLowerCase().trim(),
      password: tempPassword,
      role: 'client',
      status: 'pending',
      businessName: businessName.trim(),
      businessOwnerName: businessOwnerName.trim(),
      businessNumber: businessNumber.trim(),
      businessGSTNumber: businessGSTNumber.trim(),
      businessPANNumber: businessPANNumber.trim(),
      businessMobileNumber: businessMobileNumber.trim(),
      businessCategory: businessCategory.trim(),
      businessAddress: businessAddress.trim(),
      city: city.trim(),
      pinCode: pinCode.trim(),
      businessLogo: businessLogo || null,
      businessWebsite: businessWebsite ? businessWebsite.trim() : null,
      businessYoutubeChannel: businessYoutubeChannel ? businessYoutubeChannel.trim() : null,
      turnOverRange: turnOverRange || null
    });

    // Ensure user ID is generated (fallback if pre-save hook fails)
    if (!client.userId) {
      await client.generateUserId();
    }

    console.log('Client created successfully:', {
      id: client._id,
      userId: client.userId,
      email: client.email,
      businessName: client.businessName
    });

    // Return client data with generated user ID
    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      client: {
        id: client._id,
        userId: client.userId,
        name: client.name,
        email: client.email,
        businessName: client.businessName,
        businessOwnerName: client.businessOwnerName,
        businessCategory: client.businessCategory,
        city: client.city,
        status: client.status,
        createdAt: client.createdAt,
        tempPassword: tempPassword // Only show once for setup
      }
    });
  } catch (error) {
    console.error('Create client error:', error);
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ 
        success: false, 
        message: `${field === 'email' ? 'Email' : 'User ID'} already exists` 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create client. Please try again.' 
    });
  }
};

// Helper function to generate secure temporary password
function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const symbols = '!@#$%&*';
  let password = '';
  
  // Ensure at least one uppercase, one lowercase, one number, and one symbol
  password += chars.charAt(Math.floor(Math.random() * 25)); // Uppercase
  password += chars.charAt(Math.floor(Math.random() * 25) + 25); // Lowercase
  password += chars.charAt(Math.floor(Math.random() * 8) + 50); // Number
  password += symbols.charAt(Math.floor(Math.random() * symbols.length)); // Symbol
  
  // Fill the rest randomly
  for (let i = 4; i < 12; i++) {
    const allChars = chars + symbols;
    password += allChars.charAt(Math.floor(Math.random() * allChars.length));
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}


// Generate login token for client (admin impersonation)
exports.generateClientLoginToken = async (req, res) => {
  try {
    const clientId = req.params.id;
    
    // Find client by ID
    const client = await User.findById(clientId);
    if (!client || client.role !== 'client') {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    // Generate a short-lived token for this client (e.g., 1 hour)
    const token = jwt.sign({ 
      id: client._id,
      type: 'client',
      clientId: client._id
    }, process.env.JWT_SECRET, {
      expiresIn: '1d'
    });
    
    res.json({
      success: true,
      token,
      user: {
        id: client._id,
        name: client.name,
        email: client.email,
        role: client.role
      }
    });
  } catch (error) {
    console.error('Generate client login token error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getuserprofile = async (req, res) => {
  try {
    const userProfiles = await UserProfile.find({ isComplete: true })
      .populate('userId', 'mobile isVerified lastLoginAt')
      .select('-__v')
      .sort({ createdAt: -1 });

    if (!userProfiles || userProfiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No user profiles found'
      });
    }

    return res.status(200).json({
      success: true,
      count: userProfiles.length,
      data: userProfiles
    });
  } catch (error) {
    console.error('Error fetching user profiles:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching user profiles',
      error: error.message
    });
  }
}

exports.createCreditPlan = async (req, res) => {
  try {
    // Check if user is admin
    console.log(req.admin);
    if (!req.admin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const {
      name,
      description,
      credits,
      price,
      currency,
      discount,
      isPopular,
      features
    } = req.body;

    const plan = new CreditPlan({
      name,
      description,
      credits,
      price,
      currency,
      discount,
      isPopular,
      features
    });

    await plan.save();

    res.json({
      success: true,
      message: 'Credit plan created successfully',
      data: plan
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

exports.getCreditPlans =  async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const plans = await CreditPlan.find().sort({ sortOrder: 1 });

    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

exports.getCreditAccount = async (req,res) => {
  try {
    if(!req.admin){
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    const creditAccounts = await CreditAccount.find()
    .sort({ createdAt: -1 })
    .populate({
      path: 'userId', 
      model: 'UserProfile',
      localField: 'userId',        
      foreignField: 'userId',      
      justOne: true,
      select: 'name'             
    });
    
    // Fetch client information for each credit account
    const accountsWithClientInfo = await Promise.all(
      creditAccounts.map(async (account) => {
        let clientInfo = null;
        if (account.clientId) {
          clientInfo = await User.findOne({userId:account.clientId}).select('businessName name email');
        }
        return {
          ...account.toObject(),
          client: clientInfo
        };
      })
    );
    
  res.json({
    success: true,
    data: accountsWithClientInfo,
  });
  }
  catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

exports.addCredit = async (req,res) => {
  try {
    if(!req.admin){
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    const {userId, credits, adminMessage} = req.body;
    const user = await MobileUser.findById(userId);
    if(!user){
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    const creditAccount = await CreditAccount.findOne({userId: user._id});
    if(!creditAccount){
      return res.status(404).json({
        success: false,
        message: 'Credit account not found'
      });
    }
    
    if(Payment.status === "SUCCESS")
    {
      const transaction = new CreditTransaction({
        userId,
        type: 'credit',
        amount: credits,
        balanceBefore: creditAccount.balance,
        balanceAfter: creditAccount.balance + credits,
        category: 'admin_adjustment',
        description: 'Admin added credits',
        addedBy: req.admin._id,
        adminMessage: adminMessage || null,
      });
  
      await transaction.save();
  
      creditAccount.balance += credits;
      await creditAccount.save();
  
      res.json({
        success: true,
        message: 'Credit added successfully',
        data: creditAccount
      });
    }
    else
    {
      res.status(400).json({
        success: false,
        message: 'Payment failed'
      });
    }
    
  } 
  catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

exports.getCreditAccountById = async (req, res) => {
  try {
    if (!req.admin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    const { id } = req.params;
    
    // Find the credit account
    const creditAccount = await CreditAccount.findById(id)
    .populate({
      path: 'userId', 
      model: 'UserProfile',
      localField: 'userId',        
      foreignField: 'userId',      
      justOne: true,
      select: 'name'             
    });
    if (!creditAccount) {
      return res.status(404).json({
        success: false,
        message: 'Credit account not found'
      });
    }

    // Fetch client information
    let clientInfo = null;
    if (creditAccount.clientId) {
      clientInfo = await User.findOne({userId:creditAccount.clientId}).select('businessName name email');
    }

   const transactions = await CreditTransaction.find({userId: creditAccount.userId.userId})
   .sort({ createdAt: -1 })
   .populate('addedBy', 'name email');

    res.json({
      success: true,
      data: {
        ...creditAccount.toObject(),
        client: clientInfo,
        transactions
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getCreditRechargePlans = async (req,res) => {
  try {
    const clientId = req.params.id;
    if (!req.admin){
      return res.status(403).json({
        success : false,
        message : 'Admin access required'
      })
    }
    const plans = await CreditRechargePlan.find({clientId}).sort({ createdAt: -1 });

    res.json({
      success : true,
      data : plans
    })
  } 
  catch (error) {
    res.status(500).json({
      success : false,
      message : error.message
    })
  }
}

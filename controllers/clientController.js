// controllers/clientController.js - Updated Client controller with enhanced user ID handling
const CreditRechargePlan = require('../models/CreditRechargePlan');
const User = require('../models/User');
const UserProfile = require('../models/UserProfile');

// Get client dashboard data
exports.getDashboard = async (req, res) => {
  try {
    // Get statistics and data needed for client dashboard
    // This is a placeholder - implement actual dashboard data retrieval based on your requirements
    
    // Example: Get count of users managed by this client
    const userCount = await User.countDocuments({ managedBy: req.user._id });
    
    res.json({
      success: true,
      data: {
        userCount,
        // Add other relevant dashboard data
        recentActivity: [],
        performanceStats: {
          booksCreated: 5,
          activeUsers: 25,
          completionRate: 78
        }
      }
    });
  } catch (error) {
    console.error('Client dashboard error:', error);
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

// Get all clients
exports.getAllClients = async (req, res) => {
  try {
    const clients = await User.find({ role: 'client' })
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: clients.length,
      clients
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

//get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('-password');
    res.status(200).json({ success: true, users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getuserprofile = async (req, res) => {
  try {
    const clientId = req.user.userId;
    console.log(clientId)
    const userProfiles = await UserProfile.find({ isComplete: true, clientId })
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

// Get client by ID
exports.getClientById = async (req, res) => {
  try {
    const client = await User.findById(req.params.id).select('-password');
    
    if (!client || client.role !== 'client') {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    res.json({
      success: true,
      client
    });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update client
exports.updateClient = async (req, res) => {
  try {
    const clientId = req.params.id;
    const updateData = { ...req.body };
    
    // Remove sensitive fields from update
    delete updateData.password;
    delete updateData.userId;
    delete updateData.role;
    
    const client = await User.findByIdAndUpdate(
      clientId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    res.json({
      success: true,
      message: 'Client updated successfully',
      client
    });
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update client status
exports.updateClientStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['active', 'inactive', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    
    const client = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select('-password');
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    res.json({
      success: true,
      message: 'Client status updated successfully',
      client
    });
  } catch (error) {
    console.error('Update client status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// Delete client
exports.deleteClient = async (req, res) => {
  try {
    const client = await User.findById(req.params.id);
    
    if (!client || client.role !== 'client') {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    await User.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Client deleted successfully'
    });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createCreditRechargePlan = async (req, res) => {
  try {
    const clientId  = req.user.userId;
    const {
      name,
      description,
      credits,
      MRP,
      offerPrice,
      status
    } = req.body;

    const plan = new CreditRechargePlan({
      name,
      description,
      clientId,
      credits,
      MRP,
      offerPrice,
      status
    });

    await plan.save();

    res.json({
      success: true,
      message: 'Credit recharge plan created successfully',
      data: plan
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}   

exports.getCreditRechargePlans = async (req,res) => {
  try {
    const clientId = req.user.userId
    const plans = await CreditRechargePlan.find({clientId:clientId});

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

exports.deleteCreditRechargePlans = async (req,res) => {
  try {
    const clientId = req.clientId;
  } 
  catch (error) {
    
  }
}

exports.updateCreditRechargePlans = async (req,res) => {
  try {
    
  } 
  catch (error) {
    
  }
}
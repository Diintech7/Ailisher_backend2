// controllers/authController.js - Authentication controller functions
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OrgClient = require('../models/OrgClient');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
};

// Register a new user
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Create new user
    const user = await User.create({
      name,
      email,
      password
    });

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { email} = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // // Check if password matches
    // const isMatch = await user.comparePassword(password);
    // if (!isMatch) {
    //   return res.status(401).json({ success: false, message: 'Invalid credentials' });
    // }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update user role
exports.updateRole = async (req, res) => {
  try {
    const { role } = req.body;
    
    // Validate role
    if (!['client', 'user'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    
    // Update user role
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { role },
      { new: true }
    ).select('-password');
    
    res.json({
      success: true,
      user: updatedUser
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Validate token
exports.validate = async (req, res) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find user by id
    let user = await User.findById(decoded.id).select('-password');

    if(!user)
    {
    user = await OrgClient.findById(decoded.id).select('-password');
    }
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    res.json({
      success: true,
      role: user.role,
      name: user.name
    });
  } catch (error) {
    console.error('Token validation error:', error);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

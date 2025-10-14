// middleware/auth.js - Authentication middleware
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');
const Evaluator = require('../models/Evaluator');
const Superadmin = require('../models/Superadmin');

// Verify evaluator token
exports.verifyTokenforevaluator = async (req, res, next) => {
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
    const evaluator = await Evaluator.findById(decoded.id).select('-password');
    if (!evaluator) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    // Add user to request object
    req.evaluator = evaluator;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Verify user token
exports.verifyToken = async (req, res, next) => {
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
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    // Add user to request object
    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Verify admin token
exports.verifyAdminToken = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find admin by id
    const admin = await Admin.findById(decoded.id).select('-password');
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    // Add admin to request object
    req.admin = admin;
    next();
  } catch (error) {
    console.error('Admin token verification error:', error);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Verify admin token
exports.verifySuperadminToken = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Find admin by id
    const superadmin = await Superadmin.findById(decoded.id).select('-password');
    if (!superadmin) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    // Add admin to request object
    req.superadmin = superadmin;
    next();
  } catch (error) {
    console.error('Superadmin token verification error:', error);
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// Check if user has client role
exports.isClient = (req, res, next) => {
  if (req.user.role !== 'client') {
    return res.status(403).json({ success: false, message: 'Access denied: Client role required' });
  }
  next();
};

// Check if user has user role
exports.isUser = (req, res, next) => {
  if (req.user.role !== 'user') {
    return res.status(403).json({ success: false, message: 'Access denied: User role required' });
  }
  next();
};

// Check if user has a role assigned
exports.hasRole = (req, res, next) => {
  if (!req.user.role) {
    return res.status(403).json({ success: false, message: 'Access denied: No role assigned' });
  }
  next();
};

exports.ensureBankDetailsComplete = async (req, res, next) => {
  try {
    const b = req.evaluator?.bankDetails || {};
    const hasMinimum =
     ( !!b.accountHolderName &&
      !!b.accountNumber &&
      !!b.ifscCode &&
      !!b.bankName) || !!b.upiId

    if (!hasMinimum) {
      return res.status(400).json({
        success: false,
        code: 'BANK_DETAILS_INCOMPLETE',
        message: 'Please complete bank details before withdrawing.'
      });
    }
    return next();
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Bank details validation failed' });
  }
};

exports.ensureWithdrawalEligibility = async (req, res, next) => {
  try {
    console.log(req.evaluator)
    const eligibility = req.evaluator.getWithdrawalEligibility();
    if (!eligibility.canWithdraw) {
      return res.status(400).json({
        success: false,
        code: 'WITHDRAWAL_NOT_ALLOWED',
        message: 'Withdrawal not allowed.',
        reasons: eligibility.reasons
      });
    }
    return next();
  } catch (error) {
    return res.status(400).json({ success: false, message: 'Eligibility check failed' });
  }
};
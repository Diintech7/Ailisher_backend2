const jwt = require('jsonwebtoken');
const Evaluator = require('../models/Evaluator');
const User = require('../models/User');
const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');

// Generate JWT Token for evaluator
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
};

exports.registerEvaluator = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phoneNumber,
      currentcity,
      subjectMatterExpert,
      instituteworkedwith,
      examFocus,
      experience,
      grade
    } = req.body;

    // Check if evaluator already exists
    const existingEvaluator = await Evaluator.findOne({
      $or: [{ email }, { phoneNumber }]
    });

    if (existingEvaluator) {
      return res.status(400).json({
        success: false,
        message: 'Evaluator with this email or phone number already exists'
      });
    }

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new evaluator
    const evaluator = await Evaluator.create({
      name,
      email,
      password: hashedPassword,
      phoneNumber,
      currentcity,
      subjectMatterExpert,
      instituteworkedwith,
      examFocus,
      experience,
      grade,
      status: 'PENDING'
    });

    // Generate token
    const token = generateToken(evaluator._id);

    res.status(201).json({
      success: true,
      token,
      evaluator: {
        id: evaluator._id,
        name: evaluator.name,
        email: evaluator.email,
        phoneNumber: evaluator.phoneNumber,
        status: evaluator.status
      }
    });
  } catch (error) {
    console.error('Evaluator registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.loginEvaluator = async (req, res) => {
  try {
    const { email, phoneNumber, password } = req.body;

    // Find evaluator by email or phone number
    const evaluator = await Evaluator.findOne({
      $or: [{ email }, { phoneNumber }]
    });

    if (!evaluator) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if evaluator is enabled
    if (!evaluator.enabled || evaluator.status==="NOT_VERIFIED" || evaluator.status==="PENDING" ) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been disabled or not verified yet. Please contact support.'
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, evaluator.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate token
    const token = generateToken(evaluator._id);

    res.json({
      success: true,
      token,
      evaluator: {
        id: evaluator._id,
        name: evaluator.name,
        email: evaluator.email,
        phoneNumber: evaluator.phoneNumber,
        status: evaluator.status,
        subjectMatterExpert: evaluator.subjectMatterExpert,
        examFocus: evaluator.examFocus,
        grade: evaluator.grade
      }
    });
  } catch (error) {
    console.error('Evaluator login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};


// Get all evaluators
exports.getAllEvaluators = async (req, res) => {
  try {
    const evaluators = await Evaluator.find().select('-__v');
    res.status(200).json({
      success: true,
      count: evaluators.length,
      data: evaluators
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// Get single evaluator
exports.getEvaluator = async (req, res) => {
  try {
    const evaluator = await Evaluator.findById(req.params.id).select('-__v');
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        error: 'Evaluator not found'
      });
    }

    res.status(200).json({
      success: true,
      data: evaluator
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// Create new evaluator
exports.createEvaluator = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }

  try {
    // Check if user exists
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'User not found. Please register first.'
      });
    }

    // Check if evaluator already exists
    const existingEvaluator = await Evaluator.findOne({
      $or: [
        { email: req.body.email },
        { phoneNumber: req.body.phoneNumber }
      ]
    });

    if (existingEvaluator) {
      return res.status(400).json({
        success: false,
        error: 'Evaluator with this email or phone number already exists'
      });
    }

    const evaluator = await Evaluator.create(req.body);
    res.status(201).json({
      success: true,
      data: evaluator
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        error: messages
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// Update evaluator
exports.updateEvaluator = async (req, res) => {
  try {
    const evaluator = await Evaluator.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true
      }
    );

    if (!evaluator) {
      return res.status(404).json({
        success: false,
        error: 'Evaluator not found'
      });
    }

    res.status(200).json({
      success: true,
      data: evaluator
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        error: messages
      });
    }
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};

// Delete evaluator
exports.deleteEvaluator = async (req, res) => {
  try {
    const evaluator = await Evaluator.findByIdAndDelete(req.params.id);

    if (!evaluator) {
      return res.status(404).json({
        success: false,
        error: 'Evaluator not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
};


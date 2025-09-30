// routes/evaluations.js
const express = require('express');
const router = express.Router();
const evaluationController = require('../controllers/evaluationController');
const {
  validateSaveEvaluation,
  validateUserId,
  validateEvaluationId,
  validateStatusUpdate,
  validateUserEvaluationsQuery,
  validateQuestionEvaluationQuery  // New validation for questionId and count
} = require('../middleware/evaluationValidation');
const MobileUser = require('../models/MobileUser');
const UserProfile = require('../models/UserProfile');
const User = require('../models/User');

// Save Evaluated Answer API
// POST /api/aiswb/submissions/evaluate
router.post('/submissions/evaluate', 
  validateSaveEvaluation, 
  evaluationController.saveEvaluatedAnswer
);

// Get User's Evaluated Answers API
// GET /api/aiswb/submissions/evaluated/:userId
router.get('/submissions/evaluated/:userId', 
  validateUserId,
  validateUserEvaluationsQuery,
  evaluationController.getUserEvaluatedAnswers
);

// Update Evaluation Status API
// PATCH /api/aiswb/submissions/evaluation/:evaluationId/status
router.patch('/submissions/evaluation/:evaluationId/status', 
  validateEvaluationId,
  validateStatusUpdate,
  evaluationController.updateEvaluationStatus
);

// Get Single Evaluation Details API (Original - by evaluationId)
// GET /api/aiswb/submissions/evaluation/:evaluationId
router.get('/submissions/evaluation/:evaluationId', 
  validateEvaluationId,
  evaluationController.getEvaluationDetails
);

// NEW: Get Evaluation Details by Question ID and Count
// GET /api/aiswb/submissions/evaluation/question/:questionId?count=1
router.get('/submissions/evaluation/question/:questionId', 
  validateQuestionEvaluationQuery,
  evaluationController.getEvaluationDetailsByQuestion
);

// Get All Evaluations (Admin) API
// GET /api/aiswb/submissions/evaluations
router.get('/submissions/evaluations', 
  validateUserEvaluationsQuery,
  evaluationController.getAllEvaluations
);

// Client-specific routes (for mobile users)
// These routes will be used with the client middleware

// Get Client User's Evaluated Answers
// GET /api/clients/:clientId/mobile/evaluations/user/:userId
router.get('/user/:userId', 
  validateUserId,
  validateUserEvaluationsQuery,
  evaluationController.getUserEvaluatedAnswers
);

// Get Client Evaluation Details (Original - by evaluationId)
// GET /api/clients/:clientId/mobile/evaluations/:evaluationId
router.get('/:evaluationId', 
  validateEvaluationId,
  evaluationController.getEvaluationDetails
);

// NEW: Get Client Evaluation Details by Question ID and Count
// GET /api/clients/:clientId/mobile/evaluations/question/:questionId?count=1
router.get('/question/:questionId', 
  validateQuestionEvaluationQuery,
  evaluationController.getEvaluationDetailsByQuestion
);

// Save Evaluation for Client User
// POST /api/clients/:clientId/mobile/evaluations/evaluate
router.post('/evaluate', 
  validateSaveEvaluation,
  evaluationController.saveEvaluatedAnswer
);

// Update Evaluation Status for Client
// PATCH /api/clients/:clientId/mobile/evaluations/:evaluationId/status
router.patch('/:evaluationId/status', 
  validateEvaluationId,
  validateStatusUpdate,
  evaluationController.updateEvaluationStatus
);


// APPROVE EVALUATOR BY MOBILE OR EMAIL
router.post('/addexistinguserasevaluator', async (req, res) => {
  try {
    const { mobile, email } = req.body;
    const clientId = req.clientId; // Use clientId set by parent router
    console.log('req.clientId:', req.clientId);
    console.log('Received request data:', { mobile, email, clientId });

    // Validate that either mobile or email is provided
    if (!mobile && !email) {
      console.log('Validation failed: No mobile or email provided');
      return res.status(400).json({
        success: false,
        message: 'Please provide either mobile number or email'
      });
    }

    // Validate mobile format if provided
    if (mobile && !/^\d{10}$/.test(mobile)) {
      console.log('Validation failed: Invalid mobile format');
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 10-digit mobile number'
      });
    }

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log('Validation failed: Invalid email format');
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    let user = null;
    let userProfile = null;

    // Case 1: Email - Match with User model
    if (email) {
      console.log('Searching for user with email:', email);
      user = await User.findOne({ email: email.toLowerCase() });

      if (!user) {
        console.log('User not found with email:', email);
        return res.status(400).json({
          success: false,
          message: 'User not found with provided email'
        });
      }

      // Check if user belongs to the client (User model uses userId for client association)
      if (!user.userId || user.userId !== clientId) {
        console.log('User does not belong to this client:', clientId);
        return res.status(403).json({
          success: false,
          message: 'User does not belong to this client'
        });
      }

      console.log('Found user:', user._id);

      // Check if user is already an evaluator
      if (user.isEvaluator) {
        console.log('User is already an evaluator');
        return res.status(400).json({
          success: false,
          message: 'User is already registered as an evaluator'
        });
      }

      // Update user
      user.isEvaluator = true;
      await user.save();
      console.log('Updated user as evaluator');

      return res.json({
        success: true,
        message: 'User approved as evaluator successfully'
      });
    }
    // Case 2: Mobile - Match with MobileUser and UserProfile models
    else if (mobile) {
      console.log('Searching for mobile user:', mobile, 'and client:', clientId);
      // First find the mobile user for this client
      const mobileUser = await MobileUser.findOne({ mobile, clientId });
      if (!mobileUser) {
        console.log('Mobile user not found or does not belong to this client');
        return res.status(400).json({
          success: false,
          message: 'User not found with provided mobile number for this client'
        });
      }

      console.log('Found mobile user:', mobileUser._id);

      // Find the associated user profile (first one found)
      userProfile = await UserProfile.findOne({ userId: mobileUser._id, clientId });

      if (!userProfile) {
        console.log('User profile not found for mobile user and client.');
        return res.status(400).json({
          success: false,
          message: 'User profile not found for this mobile number and client'
        });
      }

      console.log('Found user profile:', userProfile._id, 'with name:', userProfile.name);

      // Check if user profile is already an evaluator
      if (userProfile.isEvaluator) {
        console.log('User profile is already an evaluator');
        return res.status(400).json({
          success: false,
          message: 'User is already registered as an evaluator'
        });
      }

      // Update user profile
      userProfile.isEvaluator = true;
      await userProfile.save();
      console.log('Updated user profile as evaluator');

      // Also update the associated user if it exists
      user = await User.findById(mobileUser.userId);
      if (user) {
        user.isEvaluator = true;
        await user.save();
        console.log('Updated associated user as evaluator');
      }

      return res.json({
        success: true,
        message: 'User approved as evaluator successfully'
      });
    }

  } catch (error) {
    console.error('Approve evaluator error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Update Evaluation with Complete Data API
// PUT /api/aiswb/submissions/evaluation/:evaluationId/complete
router.put('/submissions/evaluation/:evaluationId/complete', 
  validateEvaluationId,
  evaluationController.updateEvaluationComplete
);

module.exports = router;
// routes/evaluators.js
const express = require('express');
const router = express.Router();
const Evaluator = require('../models/Evaluator');
const UserProfile = require('../models/UserProfile');
const MobileUser = require('../models/MobileUser');
const { verifyAdminToken, verifyTokenforevaluator } = require('../middleware/auth');
const User = require('../models/User');
const ReviewRequest = require('../models/ReviewRequest');
const { registerEvaluator, loginEvaluator} = require('../controllers/evaluatorController');
const { generateGetPresignedUrl } = require('../utils/r2');

// Public routes (no authentication required)
router.post('/register', registerEvaluator);
router.post('/login', loginEvaluator);

// // 2. GET SINGLE EVALUATOR
// router.get('/:id',verifyTokenforevaluator, async (req, res) => {
//   try {
//     const { id } = req.params;
    
//     const evaluator = await Evaluator.findById(id);
//     console.log(evaluator)
//     if (!evaluator) {
//       return res.status(404).json({
//         success: false,
//         message: 'Evaluator not found'
//       });
//     }

//     if(evaluator.kycDetails.status === "pending") 
//     {
//       if(evaluator.kycDetails.documents.panDocument.s3Key)
//       {
//         evaluator.kycDetails.documents.panDocument.downloadUrl = await generateGetPresignedUrl(evaluator.kycDetails.documents.panDocument.s3Key);
//       }
//       if(evaluator.kycDetails.documents.aadharFront.s3Key)
//       {
//         evaluator.kycDetails.documents.aadharFront.downloadUrl = await generateGetPresignedUrl(evaluator.kycDetails.documents.aadharFront.s3Key);
//       }
//       if(evaluator.kycDetails.documents.aadharBack.s3Key)
//       {
//         evaluator.kycDetails.documents.aadharBack.downloadUrl = await generateGetPresignedUrl(evaluator.kycDetails.documents.aadharBack.s3Key);
//       }
//       if(evaluator.kycDetails.documents.bankPassbook.s3Key)
//       {
//         evaluator.kycDetails.documents.bankPassbook.downloadUrl = await generateGetPresignedUrl(evaluator.kycDetails.documents.bankPassbook.s3Key);
//       }
//     }
    
//     res.json({
//       success: true,
//       evaluator
//     });
//   } catch (error) {
//     console.error('Get single evaluator error:', error);
    
//     // Handle invalid ObjectId
//     if (error.name === 'CastError') {
//       return res.status(404).json({
//         success: false,
//         message: 'Evaluator not found'
//       });
//     }
    
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error'
//     });
//   }
// });

// Apply admin authentication to all other routes
router.use(verifyAdminToken);

// 1. GET ALL EVALUATORS
router.get('/', async (req, res) => {
  try {
    const evaluators = await Evaluator.find().sort({ createdAt: -1 });
    
    res.json({
      success: true,
      evaluators
    });
  } catch (error) {
    console.error('Get all evaluators error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// 2. GET SINGLE EVALUATOR
router.get('/:id',async (req, res) => {
  try {
    const { id } = req.params;
    
    const evaluator = await Evaluator.findById(id);
    console.log(evaluator)
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }

    // Generate presigned URLs for KYC documents regardless of status
    if(evaluator.kycDetails && evaluator.kycDetails.documents) 
    {
      console.log('KYC Details found, generating presigned URLs...');
      if(evaluator.kycDetails.documents.panDocument && evaluator.kycDetails.documents.panDocument.s3Key)
      {
        console.log('Generating presigned URL for PAN document:', evaluator.kycDetails.documents.panDocument.s3Key);
        evaluator.kycDetails.documents.panDocument.downloadUrl = await generateGetPresignedUrl(evaluator.kycDetails.documents.panDocument.s3Key);
        console.log('PAN document URL generated:', evaluator.kycDetails.documents.panDocument.downloadUrl);
      }
      if(evaluator.kycDetails.documents.aadharFront && evaluator.kycDetails.documents.aadharFront.s3Key)
      {
        console.log('Generating presigned URL for Aadhar Front:', evaluator.kycDetails.documents.aadharFront.s3Key);
        evaluator.kycDetails.documents.aadharFront.downloadUrl = await generateGetPresignedUrl(evaluator.kycDetails.documents.aadharFront.s3Key);
        console.log('Aadhar Front URL generated:', evaluator.kycDetails.documents.aadharFront.downloadUrl);
      }
      if(evaluator.kycDetails.documents.aadharBack && evaluator.kycDetails.documents.aadharBack.s3Key)
      {
        console.log('Generating presigned URL for Aadhar Back:', evaluator.kycDetails.documents.aadharBack.s3Key);
        evaluator.kycDetails.documents.aadharBack.downloadUrl = await generateGetPresignedUrl(evaluator.kycDetails.documents.aadharBack.s3Key);
        console.log('Aadhar Back URL generated:', evaluator.kycDetails.documents.aadharBack.downloadUrl);
      }
      if(evaluator.kycDetails.documents.bankPassbook && evaluator.kycDetails.documents.bankPassbook.s3Key)
      {
        console.log('Generating presigned URL for Bank Passbook:', evaluator.kycDetails.documents.bankPassbook.s3Key);
        evaluator.kycDetails.documents.bankPassbook.downloadUrl = await generateGetPresignedUrl(evaluator.kycDetails.documents.bankPassbook.s3Key);
        console.log('Bank Passbook URL generated:', evaluator.kycDetails.documents.bankPassbook.downloadUrl);
      }
    }
    
    res.json({
      success: true,
      evaluator
    });
  } catch (error) {
    console.error('Get single evaluator error:', error);
    
    // Handle invalid ObjectId
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// 3. CREATE EVALUATOR
router.post('/', async (req, res) => {
  try {
    const {
      name,
      email,
      phoneNumber,
      subjectMatterExpert,
      examFocus,
      experience,
      grade,
      clientAccess
    } = req.body;
    
    // Create new evaluator
    const evaluator = new Evaluator({
      name,
      email,
      phoneNumber,
      subjectMatterExpert,
      examFocus,
      experience,
      grade,
      clientAccess: clientAccess || []
    });
    
    await evaluator.save();
    
    res.status(201).json({
      success: true,
      message: 'Evaluator created successfully',
      evaluator
    });
  } catch (error) {
    console.error('Create evaluator error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const message = field === 'email' ? 'Email already exists' : 'Phone number already exists';
      
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: [{
          field,
          message
        }]
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// 4. UPDATE EVALUATOR
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Remove undefined fields
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });
    
    const evaluator = await Evaluator.findByIdAndUpdate(
      id,
      updateData,
      { 
        new: true, 
        runValidators: true 
      }
    );
    
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Evaluator updated successfully',
      evaluator
    });
  } catch (error) {
    console.error('Update evaluator error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const message = field === 'email' ? 'Email already exists' : 'Phone number already exists';
      
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: [{
          field,
          message
        }]
      });
    }
    
    // Handle invalid ObjectId
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// 5. DELETE EVALUATOR
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const evaluator = await Evaluator.findByIdAndDelete(id);
    
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Evaluator deleted successfully'
    });
  } catch (error) {
    console.error('Delete evaluator error:', error);
    
    // Handle invalid ObjectId
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});


// // APPROVE EVALUATOR BY MOBILE OR EMAIL
// router.post('/addexistinguserasevaluator', async (req, res) => {
//   try {
//     const { mobile, email } = req.body;

//     // Log incoming request data
//     console.log('Received request data:', { mobile, email });

//     // Validate that either mobile or email is provided
//     if (!mobile && !email) {
//       console.log('Validation failed: No mobile or email provided');
//       return res.status(400).json({
//         success: false,
//         message: 'Please provide either mobile number or email'
//       });
//     }

//     // Validate mobile format if provided
//     if (mobile && !/^\d{10}$/.test(mobile)) {
//       console.log('Validation failed: Invalid mobile format');
//       return res.status(400).json({
//         success: false,
//         message: 'Please provide a valid 10-digit mobile number'
//       });
//     }

//     // Validate email format if provided
//     if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
//       console.log('Validation failed: Invalid email format');
//       return res.status(400).json({
//         success: false,
//         message: 'Please provide a valid email address'
//       });
//     }

//     let user = null;
//     let userProfile = null;

//     // Case 1: Email - Match with User model
//     if (email) {
//       console.log('Searching for user with email:', email);
//       user = await User.findOne({ email: email.toLowerCase() });

//       if (!user) {
//         console.log('User not found with email:', email);
//         return res.status(400).json({
//           success: false,
//           message: 'User not found with provided email'
//         });
//       }

//       console.log('Found user:', user._id);

//       // Check if user is already an evaluator
//       if (user.isEvaluator) {
//         console.log('User is already an evaluator');
//         return res.status(400).json({
//           success: false,
//           message: 'User is already registered as an evaluator'
//         });
//       }

//       // Update user
//       user.isEvaluator = true;
//       await user.save();
//       console.log('Updated user as evaluator');

//       return res.json({
//         success: true,
//         message: 'User approved as evaluator successfully'
//       });
//     }
//     // Case 2: Mobile - Match with MobileUser and UserProfile models
//     else if (mobile) {
//       console.log('Searching for mobile user:', mobile);
//       // First find the mobile user
//       const mobileUser = await MobileUser.findOne({ mobile });
//       if (!mobileUser) {
//         console.log('Mobile user not found');
//         return res.status(400).json({
//           success: false,
//           message: 'User not found with provided mobile number'
//         });
//       }

//       console.log('Found mobile user:', mobileUser._id);

//       // Find the associated user profile (first one found)
//       userProfile = await UserProfile.findOne({ userId: mobileUser._id });

//       if (!userProfile) {
//         console.log('User profile not found for mobile user.');
//         return res.status(400).json({
//           success: false,
//           message: 'User profile not found for this mobile number'
//         });
//       }

//       console.log('Found user profile:', userProfile._id, 'with name:', userProfile.name);

//       // Check if user profile is already an evaluator
//       if (userProfile.isEvaluator) {
//         console.log('User profile is already an evaluator');
//         return res.status(400).json({
//           success: false,
//           message: 'User is already registered as an evaluator'
//         });
//       }

//       // Update user profile
//       userProfile.isEvaluator = true;
//       await userProfile.save();
//       console.log('Updated user profile as evaluator');

//       // Also update the associated user if it exists
//       user = await User.findById(mobileUser.userId);
//       if (user) {
//         user.isEvaluator = true;
//         await user.save();
//         console.log('Updated associated user as evaluator');
//       }

//       return res.json({
//         success: true,
//         message: 'User approved as evaluator successfully'
//       });
//     }

//   } catch (error) {
//     console.error('Approve evaluator error:', error);
//     res.status(500).json({
//       success: false,
//       message: error.message || 'Internal server error'
//     });
//   }
// });

// 6. VERIFY/UNVERIFY EVALUATOR
router.post('/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    
    const evaluator = await Evaluator.findById(id);
    
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }

    // Toggle between verified and not verified states
    if (evaluator.status === 'VERIFIED') {
      evaluator.status = 'NOT_VERIFIED';
      evaluator.verifiedAt = null;
      await evaluator.save();
      
      return res.json({
        success: true,
        message: 'Evaluator marked as not verified',
        evaluator
      });
    } else {
      evaluator.status = 'VERIFIED';
      evaluator.verifiedAt = new Date();
      await evaluator.save();
      
      return res.json({
        success: true,
        message: 'Evaluator verified successfully',
        evaluator
      });
    }
  } catch (error) {
    console.error('Verify/Unverify evaluator error:', error);
    
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Toggle evaluator enabled status
router.post('/:id/togglestatus', async (req, res) => {
  try {
    const evaluator = await Evaluator.findById(req.params.id);

    if (!evaluator) {
      return res.status(404).json({
        success: false,
        error: 'Evaluator not found'
      });
    }

    // Toggle the enabled status
    evaluator.enabled = !evaluator.enabled;
    await evaluator.save();

    res.status(200).json({
      success: true,
      data: evaluator,
      message: evaluator.enabled ? 'Evaluator enabled successfully' : 'Evaluator disabled successfully'
    });
  } 
  catch (error) {
    res.status(500).json({
      success: false,
      error: 'Server Error'
    });
  }
}); 



module.exports = router;
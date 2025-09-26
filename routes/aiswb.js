const express = require('express');
const router = express.Router();
const aiswbController = require('../controllers/aiswbController');
const aiswbValidation = require('../middleware/aiswbValidation');
const aiswbQRRoutes = require('./aiswbQR');
const {verifyToken} = require('../middleware/auth'); // Assuming you have auth middleware
const UserAnswer = require('../models/UserAnswer');
const UserProfile = require('../models/UserProfile');
// Apply authentication to all routes
router.use('/qr', aiswbQRRoutes);

// Question routes
router.post('/questions', 
  aiswbValidation.validateQuestion, 
  aiswbController.addQuestion
);

router.put('/questions/:questionId', 
  aiswbValidation.validateQuestionUpdate, 
  aiswbController.updateQuestion
);

router.delete('/questions/:questionId', 
  aiswbValidation.validateQuestionId, 
  aiswbController.deleteQuestion
);

router.get('/questions/:questionId', 
  aiswbValidation.validateQuestionId, 
  aiswbController.getQuestionDetails
);

// Set routes
router.get('/:itemType/:itemId/sets', 
  aiswbValidation.validateSetParams, 
  aiswbController.getAISWBSets
);

router.post('/:itemType/:itemId/sets', 
  aiswbValidation.validateSetParams,
  aiswbValidation.validateSetName, 
  aiswbController.createAISWBSet
);

router.put('/:itemType/:itemId/sets/:setId', 
  aiswbValidation.validateSetParams,
  aiswbValidation.validateSetId,
  aiswbValidation.validateSetName, 
  aiswbController.updateAISWBSet
);

router.delete('/:itemType/:itemId/sets/:setId', 
  aiswbValidation.validateSetParams,
  aiswbValidation.validateSetId, 
  aiswbController.deleteAISWBSet
);

router.patch('/:itemType/:itemId/sets/:id',
  aiswbController.toggleIsEnabled
)

router.get('/:itemType/:itemId/sets/:setId/questions', 
  aiswbValidation.validateSetParams,
  aiswbValidation.validateSetId, 
  aiswbController.getQuestionsInSet
);

router.post('/:itemType/:itemId/sets/:setId/questions', 
  aiswbValidation.validateSetParams,
  aiswbValidation.validateSetId,
  aiswbValidation.validateQuestionToSet, 
  aiswbController.addQuestionToSet
);

router.delete('/:itemType/:itemId/sets/:setId/questions/:questionId', 
  aiswbValidation.validateSetParams,
  aiswbValidation.validateSetId,
  aiswbValidation.validateQuestionId, 
  aiswbController.deleteQuestionFromSet
);

router.get('/questions/:questionId/submissions', 
  aiswbValidation.validateQuestionSubmissionsQuery, 
  aiswbController.getQuestionSubmissions
);

// Get default evaluation framework
router.get('/default-evaluation-framework', 
  aiswbController.getDefaultEvaluationFramework
);

// PDF upload helpers
router.post('/questions/:questionId/pdf/presign', verifyToken,
  aiswbController.generatePdfUploadUrl
);

router.post('/questions/:questionId/pdf/attach', verifyToken,
  aiswbController.attachPdfToQuestion
);

router.delete('/questions/:questionId/pdf/delete', verifyToken,
  aiswbController.deletePdfFromQuestion
);

module.exports = router;
const express = require('express');
const router = express.Router();
const myQuestionController = require('../controllers/myQuestionController');
const myQuestionValidation = require('../middleware/myQuestionValidation');
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const { verifyToken } = require('../middleware/auth');

// User routes (mobile authentication)
router.post('/questions',
  authenticateMobileUser,
  myQuestionValidation.validateQuestionCreation,
  myQuestionController.createQuestion
);

router.get('/questions',
  authenticateMobileUser,
  myQuestionValidation.validateQuestionQuery,
  myQuestionController.getQuestions
);

// Client routes (web authentication)
// NOTE: Define specific route before the parameterized :questionId route to avoid conflicts
router.get('/questions/pending',
  verifyToken,
  myQuestionValidation.validateQuestionQuery,
  myQuestionController.getPendingFormatting
);

router.get('/questions/:questionId',
  authenticateMobileUser,
  myQuestionValidation.validateQuestionId,
  myQuestionController.getQuestion
);

router.put('/questions/:questionId',
  authenticateMobileUser,
  myQuestionValidation.validateQuestionId,
  myQuestionValidation.validateQuestionUpdate,
  myQuestionController.updateQuestion
);

router.delete('/questions/:questionId',
  authenticateMobileUser,
  myQuestionValidation.validateQuestionId,
  myQuestionController.deleteQuestion
);

// File upload routes (user)
// Temporary upload (before question creation)
router.post('/files/presign',
  authenticateMobileUser,
  myQuestionValidation.validateTemporaryFileUpload,
  myQuestionController.generateTemporaryFileUploadUrl
);

router.post('/questions/:questionId/files/confirm',
  authenticateMobileUser,
  myQuestionValidation.validateQuestionId,
  myQuestionValidation.validateFileConfirm,
  myQuestionController.confirmFileUpload
);

router.put('/questions/:questionId/format',
  verifyToken,
  myQuestionValidation.validateQuestionId,
  myQuestionValidation.validateQuestionFormatting,
  myQuestionController.formatQuestion
);

router.post('/questions/:questionId/activate',
  verifyToken,
  myQuestionValidation.validateQuestionId,
  myQuestionController.activateQuestion
);

module.exports = router;


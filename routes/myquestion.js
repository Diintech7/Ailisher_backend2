const express = require('express');
const router = express.Router();
const myQuestionController = require('../controllers/myQuestionController');
const myQuestionValidation = require('../middleware/myQuestionValidation');
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const { verifyToken } = require('../middleware/auth');
const multer = require("multer");
const R2Storage = require("../utils/r2multer");
const { validationResult } = require('express-validator');
const MyQuestion = require('../models/MyQuestion');
const UserAnswer = require('../models/UserAnswer');

// User routes (mobile authentication)
router.post('/questions',
  authenticateMobileUser,
  myQuestionValidation.validateQuestionCreation,
  myQuestionController.createQuestion
);

const storage = new R2Storage({
  folder: "user-answers"
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image files and PDFs are allowed"), false);
    }
  },
});

// Combined: create question and submit answer (multipart/form-data with key 'images')
router.post('/questions/with-answer',
  authenticateMobileUser,
  upload.array("images", 10),
  myQuestionController.createQuestionWithAnswer
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

router.patch('/questions/:answerId/send-to-expert',
  verifyToken,
  myQuestionController.sendToExpert
);

router.patch('/questions/:questionId/reject',
  verifyToken,
  myQuestionController.rejectQuestion
);

router.get('/questions/:questionId',
  verifyToken,
  myQuestionValidation.validateQuestionId,
  myQuestionController.getQuestion
);

router.get('/questions/:questionId/answers',
  verifyToken,
  myQuestionValidation.validateQuestionId,
  myQuestionController.getAnswersForEvaluation
);

router.put('/questions/:questionId',
  verifyToken,
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


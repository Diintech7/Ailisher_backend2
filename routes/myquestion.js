const express = require('express');
const router = express.Router();
const myQuestionController = require('../controllers/myQuestionController');
const myQuestionValidation = require('../middleware/myQuestionValidation');
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const { verifyToken } = require('../middleware/auth');
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;

// User routes (mobile authentication)
router.post('/questions',
  authenticateMobileUser,
  myQuestionValidation.validateQuestionCreation,
  myQuestionController.createQuestion
);

// Configure cloudinary (reuse existing env)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "user-answers",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "pdf"],
    transformation: [
      { width: 1200, height: 1600, crop: "limit", quality: "auto" },
      { flags: "progressive" },
    ],
  },
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


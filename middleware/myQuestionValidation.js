const { body, param, query } = require('express-validator');

// Validation for user uploading a question
const validateQuestionCreation = [
  body('question')
    .notEmpty()
    .withMessage('Question is required')
    .isString()
    .withMessage('Question must be a string')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Question must be at least 10 characters'),
  
  body('wordLimit')
    .notEmpty()
    .withMessage('Word limit is required')
    .isInt({ min: 1 })
    .withMessage('Word limit must be a positive integer'),
  
  body('maximumMarks')
    .notEmpty()
    .withMessage('Maximum marks is required')
    .isInt({ min: 1 })
    .withMessage('Maximum marks must be a positive integer'),
  
  body('subject')
    .notEmpty()
    .withMessage('Subject is required')
    .isString()
    .withMessage('Subject must be a string')
    .trim(),
  
  body('exam')
    .notEmpty()
    .withMessage('Exam is required')
    .isString()
    .withMessage('Exam must be a string')
    .trim(),
  
  body('answerFiles')
    .optional()
    .isArray()
    .withMessage('Answer files must be an array'),
  
  body('answerFiles.*.fileUrl')
    .optional()
    .isString()
    .withMessage('File URL must be a string'),
  
  body('answerFiles.*.fileKey')
    .optional()
    .isString()
    .withMessage('File key must be a string'),
  
  body('answerFiles.*.fileName')
    .optional()
    .isString()
    .withMessage('File name must be a string'),
  
  body('answerFiles.*.fileType')
    .optional()
    .isIn(['image', 'pdf'])
    .withMessage('File type must be either image or pdf')
];

// Validation for updating question (before formatting)
const validateQuestionUpdate = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId'),
  
  body('question')
    .optional()
    .isString()
    .withMessage('Question must be a string')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Question must be at least 10 characters'),
  
  body('wordLimit')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Word limit must be a positive integer'),
  
  body('maximumMarks')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Maximum marks must be a positive integer'),
  
  body('subject')
    .optional()
    .isString()
    .withMessage('Subject must be a string')
    .trim(),
  
  body('exam')
    .optional()
    .isString()
    .withMessage('Exam must be a string')
    .trim()
];

// Validation for client formatting question
const validateQuestionFormatting = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId'),
  
  body('detailedAnswer')
    .notEmpty()
    .withMessage('Detailed answer is required')
    .isString()
    .withMessage('Detailed answer must be a string')
    .trim(),
  
  body('modalAnswer')
    .optional()
    .isString()
    .withMessage('Modal answer must be a string')
    .trim(),
  
  body('modalAnswerPdfKey')
    .optional()
    .isArray()
    .withMessage('Modal answer PDF keys must be an array'),
  
  body('modalAnswerPdfKey.*')
    .optional()
    .isString()
    .withMessage('Each PDF key must be a string'),
  
  body('answerVideoUrls')
    .optional()
    .isArray()
    .withMessage('Answer video URLs must be an array'),
  
  body('answerVideoUrls.*')
    .optional()
    .isString()
    .withMessage('Each answer video URL must be a string')
    .trim()
    .custom((value) => {
      if (!value) return true;
      const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]+(&[\w=]*)?$/;
      if (!youtubeRegex.test(value)) {
        throw new Error('Answer video URL must be a valid YouTube URL');
      }
      return true;
    }),
  
  body('metadata.keywords')
    .optional()
    .isArray()
    .withMessage('Keywords must be an array'),
  
  body('metadata.keywords.*')
    .optional()
    .isString()
    .withMessage('Each keyword must be a string')
    .trim(),
  
  body('metadata.difficultyLevel')
    .notEmpty()
    .withMessage('Difficulty level is required')
    .isIn(['level1', 'level2', 'level3'])
    .withMessage('Difficulty level must be level1, level2, or level3'),
  
  body('metadata.estimatedTime')
    .notEmpty()
    .withMessage('Estimated time is required')
    .isInt({ min: 0 })
    .withMessage('Estimated time must be a positive integer'),
  
  body('languageMode')
    .notEmpty()
    .withMessage('Language mode is required')
    .isIn(['english', 'hindi'])
    .withMessage('Language mode must be english or hindi'),
  
  body('evaluationMode')
    .notEmpty()
    .withMessage('Evaluation mode is required')
    .isIn(['auto', 'manual'])
    .withMessage('Evaluation mode must be auto or manual'),
  
  body('evaluationType')
    .if(body('evaluationMode').equals('manual'))
    .notEmpty()
    .withMessage('Evaluation type is required for manual evaluation mode')
    .isIn(['with annotation', 'without annotation'])
    .withMessage('Evaluation type must be "with annotation" or "without annotation"'),
  
  body('evaluationGuideline')
    .optional()
    .isString()
    .withMessage('Evaluation guideline must be a string')
    .trim()
];

// Validation for question ID parameter
const validateQuestionId = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId')
];

// Validation for temporary file upload (before question creation)
const validateTemporaryFileUpload = [
  body('fileName')
    .notEmpty()
    .withMessage('File name is required')
    .isString()
    .withMessage('File name must be a string'),
  
  body('contentType')
    .notEmpty()
    .withMessage('Content type is required')
    .isString()
    .withMessage('Content type must be a string')
    .matches(/^(image|application)\/(jpeg|jpg|png|gif|pdf)$/i)
    .withMessage('Content type must be image (jpeg, jpg, png, gif) or application/pdf')
];

// Validation for file upload presign (after question creation)
const validateFileUpload = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId'),
  
  body('fileName')
    .notEmpty()
    .withMessage('File name is required')
    .isString()
    .withMessage('File name must be a string'),
  
  body('contentType')
    .notEmpty()
    .withMessage('Content type is required')
    .isString()
    .withMessage('Content type must be a string')
    .matches(/^(image|application)\/(jpeg|jpg|png|gif|pdf)$/i)
    .withMessage('Content type must be image (jpeg, jpg, png, gif) or application/pdf')
];

// Validation for file upload confirmation
const validateFileConfirm = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId'),
  
  body('key')
    .notEmpty()
    .withMessage('File key is required')
    .isString()
    .withMessage('File key must be a string'),
  
  body('fileName')
    .notEmpty()
    .withMessage('File name is required')
    .isString()
    .withMessage('File name must be a string'),
  
  body('fileType')
    .notEmpty()
    .withMessage('File type is required')
    .isIn(['image', 'pdf'])
    .withMessage('File type must be either image or pdf')
];

// Validation for query parameters (list questions)
const validateQuestionQuery = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('status')
    .optional()
    .isIn(['pending', 'formatted', 'active', 'archived'])
    .withMessage('Status must be one of: pending, formatted, active, archived'),
  
  query('subject')
    .optional()
    .isString()
    .withMessage('Subject must be a string'),
  
  query('exam')
    .optional()
    .isString()
    .withMessage('Exam must be a string')
];

module.exports = {
  validateQuestionCreation,
  validateQuestionUpdate,
  validateQuestionFormatting,
  validateQuestionId,
  validateTemporaryFileUpload,
  validateFileUpload,
  validateFileConfirm,
  validateQuestionQuery
};


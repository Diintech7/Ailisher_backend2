const { body, param, query } = require('express-validator');

const validateQuestion = [
  body('question.question')
    .notEmpty()
    .withMessage('Question is required')
    .isString()
    .withMessage('Question must be a string')
    .trim(),
  
  body('question.detailedAnswer')
    .notEmpty()
    .withMessage('Detailed answer is required')
    .isString()
    .withMessage('Detailed answer must be a string')
    .trim(),
  
  body('question.modalAnswer')
    .optional()
    .isString()
    .withMessage('Modal answer must be a string')
    .trim(),
  
  body('question.answerVideoUrls')
    .optional()
    .isArray()
    .withMessage('Answer video URLs must be an array'),
  
  body('question.answerVideoUrls.*')
    .optional()
    .isString()
    .withMessage('Each answer video URL must be a string')
    .trim()
    .custom((value) => {
      if (!value) return true; // Optional field
      const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|v\/)|youtu\.be\/)[\w-]+(&[\w=]*)?$/;
      if (!youtubeRegex.test(value)) {
        throw new Error('Answer video URL must be a valid YouTube URL');
      }
      return true;
    }),
  
  body('question.metadata.keywords')
    .optional()
    .isArray()
    .withMessage('Keywords must be an array'),
  
  body('question.metadata.keywords.*')
    .optional()
    .isString()
    .withMessage('Each keyword must be a string')
    .trim(),
  
  body('question.metadata.difficultyLevel')
    .notEmpty()
    .withMessage('Difficulty level is required')
    .isIn(['level1', 'level2', 'level3'])
    .withMessage('Difficulty level must be level1, level2, or level3'),
  
  body('question.metadata.wordLimit')
    .notEmpty()
    .withMessage('Word limit is required')
    .isInt({ min: 0 })
    .withMessage('Word limit must be a positive integer'),
  
  body('question.metadata.estimatedTime')
    .notEmpty()
    .withMessage('Estimated time is required')
    .isInt({ min: 0 })
    .withMessage('Estimated time must be a positive integer'),
  
  body('question.metadata.maximumMarks')
    .notEmpty()
    .withMessage('Maximum marks is required')
    .isInt({ min: 0 })
    .withMessage('Maximum marks must be a positive integer'),
  
  body('question.languageMode')
    .notEmpty()
    .withMessage('Language mode is required')
    .isIn(['english', 'hindi'])
    .withMessage('Language mode must be english or hindi'),
  
  body('question.evaluationMode')
    .notEmpty()
    .withMessage('Evaluation mode is required')
    .isIn(['auto', 'manual'])
    .withMessage('Evaluation mode must be auto or manual'),
  
  body('question.evaluationType')
    .if(body('question.evaluationMode').equals('manual'))
    .notEmpty()
    .withMessage('Evaluation type is required for manual evaluation mode')
    .isIn(['with annotation', 'without annotation'])
    .withMessage('Evaluation type must be "with annotation" or "without annotation"'),
  
  body('question.evaluationGuideline')
    .optional()
    .isString()
    .withMessage('Evaluation guideline must be a string')
    .trim()
    .isLength({ min: 5, max: 7000 })
    .withMessage('Evaluation guideline must be between 5 and 7000 characters'),
  
  body('setId')
    .optional()
    .isMongoId()
    .withMessage('Set ID must be a valid MongoDB ObjectId')
];

const validateQuestionUpdate = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId'),
  
  ...validateQuestion.slice(0, -1) // Remove setId validation for updates
];

const validateSetName = [
  body('name')
    .notEmpty()
    .withMessage('Set name is required')
    .isString()
    .withMessage('Set name must be a string')
    .trim()
];

const validateSetParams = [
  param('itemType')
    .isIn(['book', 'workbook', 'chapter', 'topic', 'subtopic'])
    .withMessage('Item type must be one of: book, workbook, chapter, topic, subtopic'),
  
  param('itemId')
    .isMongoId()
    .withMessage('Item ID must be a valid MongoDB ObjectId')
];

const validateSetId = [
  param('setId')
    .isMongoId()
    .withMessage('Set ID must be a valid MongoDB ObjectId')
];
const validateTestId = [
  param('testId')
    .isMongoId()
    .withMessage('Test ID must be a valid MongoDB ObjectId')
];
const validateQuestionId = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId')
];

const validateQuestionToSet = [
  body('question')
    .notEmpty()
    .withMessage('Question is required')
    .isString()
    .withMessage('Question must be a string')
    .trim(),
  
  body('detailedAnswer')
    .notEmpty()
    .withMessage('Detailed answer is required')
    .isString()
    .withMessage('Detailed answer must be a string')
    .trim(),
  
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
      if (!value) return true; // Optional field
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
  
  body('metadata.difficultyLevel')
    .notEmpty()
    .withMessage('Difficulty level is required')
    .isIn(['level1', 'level2', 'level3'])
    .withMessage('Difficulty level must be level1, level2, or level3'),
  
  body('metadata.wordLimit')
    .notEmpty()
    .withMessage('Word limit is required')
    .isInt({ min: 0 })
    .withMessage('Word limit must be a positive integer'),
  
  body('metadata.estimatedTime')
    .notEmpty()
    .withMessage('Estimated time is required')
    .isInt({ min: 0 })
    .withMessage('Estimated time must be a positive integer'),
  
  body('metadata.maximumMarks')
    .notEmpty()
    .withMessage('Maximum marks is required')
    .isInt({ min: 0 })
    .withMessage('Maximum marks must be a positive integer'),
  
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
    .isLength({ min: 5, max: 10000 })
    .withMessage('Evaluation guideline must be between 5 and 10000 characters')
];

const validateQuestionSubmissionsQuery = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId'),
  
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
    .isIn(['published', 'not_published', 'all'])
    .withMessage('Status must be one of: published, not_published, all'),
  
  query('sortBy')
    .optional()
    .isIn(['submittedAt', 'marks', 'accuracy'])
    .withMessage('SortBy must be one of: submittedAt, marks, accuracy'),
  
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('SortOrder must be either asc or desc')
];

module.exports = {
  validateQuestion,
  validateQuestionUpdate,
  validateSetName,
  validateSetParams,
  validateSetId,
  validateQuestionId,
  validateQuestionToSet,
  validateQuestionSubmissionsQuery,
  validateTestId
};
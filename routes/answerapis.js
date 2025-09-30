const express = require('express');
const router = express.Router();
const UserAnswer = require('../models/UserAnswer');
const AiswbQuestion = require('../models/AiswbQuestion');
const SubjectiveTestQuestion = require('../models/SubjectiveTestQuestion');
const AISWBSet = require('../models/AISWBSet');
const { validationResult, param, body, query } = require('express-validator');
const { verifyTokenforevaluator } = require('../middleware/auth');
const { generateAnnotatedImageUrl } = require('../utils/s3');

// GET /crud/answers - List all submitted answers with pagination and filters
router.get('/answers', [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('publishStatus')
    .optional()
    .isIn(['published', 'not_published'])
    .withMessage('Invalid publish status filter'),
  query('submissionStatus')
    .optional()
    .isIn(['submitted', 'rejected', 'evaluated'])
    .withMessage('Invalid submission status filter'),
  query('reviewStatus')
    .optional()
    .isIn(['review_pending', 'review_accepted', 'review_completed'])
    .withMessage('Invalid review status filter'),
  query('evaluationMode')
    .optional()
    .isIn(['auto', 'manual'])
    .withMessage('Invalid evaluation mode filter'),
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Search term must be less than 100 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: {
          code: "INVALID_QUERY",
          details: errors.array()
        }
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {};
    
    if (req.query.publishStatus) {
      filter.publishStatus = req.query.publishStatus;
    }
    
    if (req.query.submissionStatus) {
      filter.submissionStatus = req.query.submissionStatus;
    }
    
    if (req.query.reviewStatus) {
      filter.reviewStatus = req.query.reviewStatus;
    }

    // Build aggregation pipeline
    const pipeline = [
      { $match: filter },
      // Lookup questions based on testType
      {
        $lookup: {
          from: 'aiswbquestions',
          localField: 'questionId',
          foreignField: '_id',
          as: 'aiswbQuestion'
        }
      },
      {
        $lookup: {
          from: 'subjectivetestquestions',
          localField: 'questionId',
          foreignField: '_id',
          as: 'subjectiveQuestion'
        }
      },
      // Lookup test info for subjective questions
      {
        $lookup: {
          from: 'subjectivetests',
          localField: 'testId',
          foreignField: '_id',
          as: 'test'
        }
      },
      {
        $lookup: {
          from: 'mobileusers',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $lookup: {
          from: 'aiswbsets',
          localField: 'setId',
          foreignField: '_id',
          as: 'set'
        }
      },
      // Combine question data based on testType
      {
        $addFields: {
          question: {
            $cond: {
              if: { $eq: ['$testType', 'subjective'] },
              then: { $arrayElemAt: ['$subjectiveQuestion', 0] },
              else: { $arrayElemAt: ['$aiswbQuestion', 0] }
            }
          }
        }
      },
      {
        $unwind: {
          path: '$question',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$set',
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    // Add evaluation mode filter if specified
    if (req.query.evaluationMode) {
      pipeline.push({
        $match: {
          'question.evaluationMode': req.query.evaluationMode
        }
      });
    }

    // Add search functionality
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'question.question': searchRegex },
            { 'user.name': searchRegex },
            { 'user.email': searchRegex },
            { textAnswer: searchRegex }
          ]
        }
      });
    }

    // Add projection to select only needed fields
    pipeline.push({
      $project: {
        _id: 1,
        userId: 1,
        clientId: 1,
        questionId: 1,
        testType: 1,
        testId: 1,
        setId: 1,
        attemptNumber: 1,
        answerImages: 1,
        textAnswer: 1,
        submissionStatus: 1,
        reviewStatus: 1,
        publishStatus: 1,
        popularityStatus: 1,
        submittedAt: 1,
        reviewedAt: 1,
        evaluatedAt: 1,
        evaluation: 1,
        feedback: 1,
        extractedTexts: 1,
        metadata: 1,
        annotations: 1,
        'question._id': 1,
        'question.question': 1,
        'question.evaluationMode': 1,
        'question.evaluationType': 1,
        'question.metadata.difficultyLevel': 1,
        'question.metadata.maximumMarks': 1,
        'question.metadata.estimatedTime': 1,
        'test._id': 1,
        'test.name': 1,
        'test.description': 1,
        'test.category': 1,
        'test.subcategory': 1,
        'user._id': 1,
        'user.name': 1,
        'user.email': 1,
        'user.phoneNumber': 1,
        'set._id': 1,
        'set.name': 1,
        'set.itemType': 1
      }
    });

    // Add sorting
    pipeline.push({
      $sort: { submittedAt: -1 }
    });

    // Get total count for pagination
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: "total" });
    
    const [countResult] = await UserAnswer.aggregate(countPipeline);
    const totalCount = countResult ? countResult.total : 0;

    // Add pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    const answers = await UserAnswer.aggregate(pipeline);

    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      message: "Answers retrieved successfully",
      data: {
        answers: answers,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalCount: totalCount,
          limit: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Error fetching answers:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// GET /crud/answers/evaluated - List all evaluated answers
router.get('/answers/evaluated', [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('evaluationMode')
    .optional()
    .isIn(['auto', 'manual'])
    .withMessage('Invalid evaluation mode filter'),
  query('evaluatorId')
    .optional()
    .isMongoId()
    .withMessage('Evaluator ID must be a valid MongoDB ObjectId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: {
          code: "INVALID_QUERY",
          details: errors.array()
        }
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build filter for evaluated answers
    const filter = {
      submissionStatus: 'evaluated',
      publishStatus:'published',
      evaluatedAt: { $exists: true, $ne: null }
    };

    // Add evaluatorId filter if provided
    if (req.query.evaluatorId) {
      filter.reviewedByEvaluator = require('mongoose').Types.ObjectId(req.query.evaluatorId);
    }
    console.log(req.query.evaluatorId)

    const pipeline = [
      { $match: filter },
      {
        $lookup: {
          from: 'aiswbquestions',
          localField: 'questionId',
          foreignField: '_id',
          as: 'question'
        }
      },
      {
        $lookup: {
          from: 'mobileusers',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $lookup: {
          from: 'aiswbsets',
          localField: 'setId',
          foreignField: '_id',
          as: 'set'
        }
      },
      {
        $unwind: {
          path: '$question',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$set',
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    // Add evaluation mode filter if specified
    if (req.query.evaluationMode) {
      pipeline.push({
        $match: {
          'question.evaluationMode': req.query.evaluationMode
        }
      });
    }

    // Add projection
    pipeline.push({
      $project: {
        _id: 1,
        userId: 1,
        questionId: 1,
        setId: 1,
        attemptNumber: 1,
        answerImages: 1,
        textAnswer: 1,
        submissionStatus: 1,
        reviewStatus: 1,
        publishStatus: 1,
        popularityStatus: 1,
        submittedAt: 1,
        reviewedAt: 1,
        evaluatedAt: 1,
        evaluation: 1,
        extractedTexts: 1,
        metadata: 1,
        annotations: 1,
        'question._id': 1,
        'question.question': 1,
        'question.evaluationMode': 1,
        'question.metadata.difficultyLevel': 1,
        'question.metadata.maximumMarks': 1,
        'question.metadata.estimatedTime': 1,
        'user._id': 1,
        'user.name': 1,
        'user.email': 1,
        'user.phoneNumber': 1,
        'set._id': 1,
        'set.name': 1,
        'set.itemType': 1
      }
    });

    // Add sorting
    pipeline.push({
      $sort: { evaluatedAt: -1 }
    });

    // Get total count
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: "total" });
    
    const [countResult] = await UserAnswer.aggregate(countPipeline);
    const totalCount = countResult ? countResult.total : 0;

    // Add pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    const evaluatedAnswers = await UserAnswer.aggregate(pipeline);

    // Add downloadUrl to each annotation
   await Promise.all(
   evaluatedAnswers.map(async (answer) => {
    if (Array.isArray(answer.annotations)) {
      console.log(answer.annotations)
      await Promise.all(
        answer.annotations.map(async (annotation) => {
          if (annotation.s3Key) {
            annotation.downloadUrl = await generateAnnotatedImageUrl(annotation.s3Key);
            console.log(annotation.downloadUrl)
          }
        })
      );
    }
  })
);

    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      message: "Evaluated answers retrieved successfully",
      data: {
        answers: evaluatedAnswers,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalCount: totalCount,
          limit: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Error fetching evaluated answers:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// PUT /crud/answers/:answerId/evaluate - Evaluate answer (for manual mode)
router.put('/answers/:answerId/evaluate', [
  param('answerId')
    .isMongoId()
    .withMessage('Answer ID must be a valid MongoDB ObjectId'),
  body('evaluation')
    .optional()
    .isObject()
    .withMessage('Evaluation must be an object'),
  body('evaluation.relevancy')
    .optional()
    .isInt({ min: 0, max: 100 })
    .withMessage('Relevancy must be between 0 and 100'),
  body('evaluation.score')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Score must be a positive integer'),
  body('evaluation.remark')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 2250 })
    .withMessage('Remark must be a string up to 2250 chars'),
  body('evaluation.comments')
    .optional()
    .isArray()
    .withMessage('Comments must be an array'),
  body('evaluation.analysis')
    .optional()
    .isObject()
    .withMessage('Analysis must be an object'),
  body('evaluation.analysis.introduction')
    .optional()
    .isArray()
    .withMessage('Introduction must be an array'),
  body('evaluation.analysis.body')
    .optional()
    .isArray()
    .withMessage('Body must be an array'),
  body('evaluation.analysis.conclusion')
    .optional()
    .isArray()
    .withMessage('Conclusion must be an array'),
  body('evaluation.analysis.strengths')
    .optional()
    .isArray()
    .withMessage('Strengths must be an array'),
  body('evaluation.analysis.weaknesses')
    .optional()
    .isArray()
    .withMessage('Weaknesses must be an array'),
  body('evaluation.analysis.suggestions')
    .optional()
    .isArray()
    .withMessage('Suggestions must be an array'),
  body('evaluation.analysis.feedback')
    .optional()
    .isArray()
    .withMessage('Feedback must be an array'),
  body('publish')
    .optional()
    .isBoolean()
    .withMessage('Publish must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        error: {
          code: "INVALID_INPUT",
          details: errors.array()
        }
      });
    }

    const { answerId } = req.params;
    const { evaluation, publish = false } = req.body;

    // Find the answer first
    const answer = await UserAnswer.findById(answerId);
    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        error: {
          code: "ANSWER_NOT_FOUND",
          details: "The specified answer does not exist"
        }
      });
    }

    // Dynamically populate question based on testType
    let question;
    if (answer.testType === 'aiswb') {
      question = await AiswbQuestion.findById(answer.questionId);
    } else if (answer.testType === 'subjective') {
      const SubjectiveTestQuestion = require('../models/SubjectiveTestQuestion');
      question = await SubjectiveTestQuestion.findById(answer.questionId);
    }

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        error: {
          code: "QUESTION_NOT_FOUND",
          details: "The question associated with this answer does not exist"
        }
      });
    }

    // Check if question is in manual evaluation mode
    if (question.evaluationMode !== 'manual') {
      return res.status(400).json({
        success: false,
        message: "Answer is not in manual evaluation mode",
        error: {
          code: "INVALID_EVALUATION_MODE",
          details: "Only answers in manual evaluation mode can be manually evaluated"
        }
      });
    }

    // Prepare update data
    const updateData = {
      submissionStatus: 'evaluated',
    };

    // Update evaluation if provided
    if (evaluation) {
      updateData.evaluation = {
        ...answer.evaluation,
        ...evaluation,
        analysis: {
          ...((answer.evaluation && answer.evaluation.analysis) || {}),
          ...(evaluation.analysis || {})
        }
      };
    }

    // Handle publish status
    if (publish) {
      updateData.publishStatus = 'published';
    }

    const updatedAnswer = await UserAnswer.findByIdAndUpdate(
      answerId,
      updateData,
      { new: true, runValidators: true }
    ).populate([
      {
        path: 'questionId',
        select: 'question evaluationMode metadata'
      },
      {
        path: 'userId',
        select: 'name email phoneNumber'
      },
      {
        path: 'setId',
        select: 'name itemType'
      }
    ]);

    res.status(200).json({
      success: true,
      message: publish ? "Answer evaluated and published successfully" : "Answer evaluated successfully",
      data: {
        answer: updatedAnswer
      }
    });

  } catch (error) {
    console.error('Error evaluating answer:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// GET /crud/answers/accepted - Get all accepted answers
router.get('/answers/accepted', [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Search term must be less than 100 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: {
          code: "INVALID_QUERY",
          details: errors.array()
        }
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Build aggregation pipeline for accepted answers
    const pipeline = [
      { $match: { submissionStatus: 'accepted' } },
      {
        $lookup: {
          from: 'aiswbquestions',
          localField: 'questionId',
          foreignField: '_id',
          as: 'question'
        }
      },
      {
        $lookup: {
          from: 'mobileusers',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $lookup: {
          from: 'aiswbsets',
          localField: 'setId',
          foreignField: '_id',
          as: 'set'
        }
      },
      {
        $lookup: {
          from: 'evaluators',
          localField: 'reviewedByEvaluator',
          foreignField: '_id',
          as: 'evaluator'
        }
      },
      {
        $unwind: {
          path: '$question',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$set',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $unwind: {
          path: '$evaluator',
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    // Add search functionality
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'question.question': searchRegex },
            { 'user.name': searchRegex },
            { 'user.email': searchRegex },
            { 'evaluator.name': searchRegex },
            { textAnswer: searchRegex }
          ]
        }
      });
    }

    // Add projection to select only needed fields
    pipeline.push({
      $project: {
        _id: 1,
        userId: 1,
        questionId: 1,
        setId: 1,
        attemptNumber: 1,
        answerImages: 1,
        textAnswer: 1,
        submissionStatus: 1,
        reviewStatus: 1,
        publishStatus: 1,
        popularityStatus: 1,
        submittedAt: 1,
        acceptedAt: 1,
        evaluation: 1,
        feedback: 1,
        extractedTexts: 1,
        metadata: 1,
        annotations: 1,
        reviewedByEvaluator: 1,
        'question._id': 1,
        'question.question': 1,
        'question.evaluationMode': 1,
        'question.evaluationType': 1,
        'question.metadata.difficultyLevel': 1,
        'question.metadata.maximumMarks': 1,
        'question.metadata.estimatedTime': 1,
        'user._id': 1,
        'user.name': 1,
        'user.email': 1,
        'user.phoneNumber': 1,
        'set._id': 1,
        'set.name': 1,
        'set.itemType': 1,
        'evaluator._id': 1,
        'evaluator.name': 1,
        'evaluator.email': 1
      }
    });

    // Add sorting by review date (most recent first)
    pipeline.push({
      $sort: { acceptedAt: -1 }
    });

    // Get total count for pagination
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: "total" });
    
    const [countResult] = await UserAnswer.aggregate(countPipeline);
    const totalCount = countResult ? countResult.total : 0;

    // Add pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    const acceptedAnswers = await UserAnswer.aggregate(pipeline);

    res.status(200).json({
      success: true,
      message: "Accepted answers retrieved successfully",
      data: {
        answers: acceptedAnswers,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalCount: totalCount,
          limit: limit
        }
      }
    });

  } catch (error) {
    console.error('Error fetching accepted answers:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// PUT /crud/answers/:answerId/publish - Publish answer
router.put('/answers/:answerId/publish', [
  param('answerId')
    .isMongoId()
    .withMessage('Answer ID must be a valid MongoDB ObjectId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        error: {
          code: "INVALID_INPUT",
          details: errors.array()
        }
      });
    }

    const { answerId } = req.params;

    const answer = await UserAnswer.findById(answerId);
    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        error: {
          code: "ANSWER_NOT_FOUND",
          details: "The specified answer does not exist"
        }
      });
    }

    // Check if answer is evaluated
    if (answer.submissionStatus !== 'evaluated') {
      return res.status(400).json({
        success: false,
        message: "Answer must be evaluated before publishing",
        error: {
          code: "ANSWER_NOT_EVALUATED",
          details: "Only evaluated answers can be published"
        }
      });
    }

    const updatedAnswer = await UserAnswer.findByIdAndUpdate(
      answerId,
      {
        publishStatus: 'published',
        // reviewStatus: 'review_completed'
      },
      { new: true, runValidators: true }
    );

    // Dynamically populate question based on testType
    if (updatedAnswer.testType === 'aiswb') {
      const question = await AiswbQuestion.findById(updatedAnswer.questionId).select('question evaluationMode metadata');
      updatedAnswer.questionId = question;
    } else if (updatedAnswer.testType === 'subjective') {
      const SubjectiveTestQuestion = require('../models/SubjectiveTestQuestion');
      const question = await SubjectiveTestQuestion.findById(updatedAnswer.questionId).select('question evaluationMode metadata');
      updatedAnswer.questionId = question;
    }

    // Populate other fields
    const User = require('../models/User');
    const user = await User.findById(updatedAnswer.userId).select('name email phoneNumber');
    updatedAnswer.userId = user;

    if (updatedAnswer.setId) {
      const AISWBSet = require('../models/AISWBSet');
      const setId = await AISWBSet.findById(updatedAnswer.setId).select('name itemType');
      updatedAnswer.setId = setId;
    }

    res.status(200).json({
      success: true,
      message: "Answer published successfully",
      data: {
        answer: updatedAnswer
      }
    });

  } catch (error) {
    console.error('Error publishing answer:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// PUT /crud/answers/:answerId/unpublish - Unpublish answer
router.put('/answers/:answerId/unpublish', [
  param('answerId')
    .isMongoId()
    .withMessage('Answer ID must be a valid MongoDB ObjectId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        error: {
          code: "INVALID_INPUT",
          details: errors.array()
        }
      });
    }

    const { answerId } = req.params;

    const answer = await UserAnswer.findById(answerId);
    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        error: {
          code: "ANSWER_NOT_FOUND",
          details: "The specified answer does not exist"
        }
      });
    }

    const updatedAnswer = await UserAnswer.findByIdAndUpdate(
      answerId,
      {
        publishStatus: 'not_published',
        // reviewStatus: 'review_accepted'
      },
      { new: true, runValidators: true }
    ).populate([
      {
        path: 'questionId',
        select: 'question evaluationMode metadata'
      },
      {
        path: 'userId',
        select: 'name email phoneNumber'
      },
      {
        path: 'setId',
        select: 'name itemType'
      }
    ]);

    res.status(200).json({
      success: true,
      message: "Answer unpublished successfully",
      data: {
        answer: updatedAnswer
      }
    });

  } catch (error) {
    console.error('Error unpublishing answer:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// PUT /crud/answers/:answerId/status - Update answer status
router.put('/answers/:answerId/status', [
  param('answerId')
    .isMongoId()
    .withMessage('Answer ID must be a valid MongoDB ObjectId'),
  body('publishStatus')
    .optional()
    .isIn(['published', 'not_published'])
    .withMessage('Publish status must be either published or not_published'),
  body('submissionStatus')
    .optional()
    .isIn(['submitted', 'rejected', 'evaluated'])
    .withMessage('Submission status must be valid'),
  body('reviewStatus')
    .optional()
    .isIn(['review_pending', 'review_accepted', 'review_completed'])
    .withMessage('Review status must be valid'),
  body('popularityStatus')
    .optional()
    .isIn(['popular', 'not_popular'])
    .withMessage('Popularity status must be valid')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        error: {
          code: "INVALID_INPUT",
          details: errors.array()
        }
      });
    }

    const { answerId } = req.params;
    const { publishStatus, submissionStatus, reviewStatus, popularityStatus } = req.body;

    const answer = await UserAnswer.findById(answerId);
    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        error: {
          code: "ANSWER_NOT_FOUND",
          details: "The specified answer does not exist"
        }
      });
    }

    // Prepare update data
    const updateData = {};
    
    if (publishStatus !== undefined) {
      updateData.publishStatus = publishStatus;
    }
    
    if (submissionStatus !== undefined) {
      updateData.submissionStatus = submissionStatus;
    }
    
    if (reviewStatus !== undefined) {
      updateData.reviewStatus = reviewStatus;
    }
    
    if (popularityStatus !== undefined) {
      updateData.popularityStatus = popularityStatus;
    }

    // // Add timestamps based on status changes
    // if (reviewStatus === 'review_completed' && !answer.reviewedAt) {
    //   updateData.reviewedAt = new Date();
    // }

    const updatedAnswer = await UserAnswer.findByIdAndUpdate(
      answerId,
      updateData,
      { new: true, runValidators: true }
    ).populate([
      {
        path: 'questionId',
        select: 'question evaluationMode metadata'
      },
      {
        path: 'userId',
        select: 'name email phoneNumber'
      },
      {
        path: 'setId',
        select: 'name itemType'
      }
    ]);

    res.status(200).json({
      success: true,
      message: "Answer status updated successfully",
      data: {
        answer: updatedAnswer
      }
    });

  } catch (error) {
    console.error('Error updating answer status:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// GET /crud/answers/:answerId - Get single answer details
router.get('/answers/:answerId', [
  param('answerId')
    .isMongoId()
    .withMessage('Answer ID must be a valid MongoDB ObjectId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        error: {
          code: "INVALID_INPUT",
          details: errors.array()
        }
      });
    }

    const { answerId } = req.params;

    const answer = await UserAnswer.findById(answerId).populate([
      {
        path: 'questionId',
        select: 'question detailedAnswer evaluationMode metadata'
      },
      {
        path: 'userId',
        select: 'name email phoneNumber'
      },
      {
        path: 'setId',
        select: 'name itemType description'
      }
    ]);

    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        error: {
          code: "ANSWER_NOT_FOUND",
          details: "The specified answer does not exist"
        }
      });
    }

    res.status(200).json({
      success: true,
      message: "Answer retrieved successfully",
      data: {
        answer: answer
      }
    });

  } catch (error) {
    console.error('Error fetching answer:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// PUT /crud/answers/:answerId/accept - Accept answer (for manual mode)
router.put('/answers/:answerId/accept', verifyTokenforevaluator, [
  param('answerId')
    .isMongoId()
    .withMessage('Answer ID must be a valid MongoDB ObjectId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        error: {
          code: "INVALID_INPUT",
          details: errors.array()
        }
      });
    }

    const { answerId } = req.params;
    const evaluatorId = req.evaluator._id; // From verifyTokenforevaluator middleware

    // Find the answer
    const answer = await UserAnswer.findById(answerId);
    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        error: {
          code: "ANSWER_NOT_FOUND",
          details: "The specified answer does not exist"
        }
      });
    }

    // Check if answer is in submitted status
    if (answer.submissionStatus !== 'submitted') {
      return res.status(400).json({
        success: false,
        message: "Answer cannot be accepted",
        error: {
          code: "INVALID_STATUS",
          details: `Only answers with 'submitted' status can be accepted. Current status: ${answer.submissionStatus}`
        }
      });
    }

    // Update the answer
    const updatedAnswer = await UserAnswer.findByIdAndUpdate(
      answerId,
      {
        submissionStatus: 'accepted',
        acceptedAt: new Date(),
        reviewedByEvaluator: evaluatorId
      },
      { new: true, runValidators: true }
    ).populate([
      {
        path: 'questionId',
        select: 'question evaluationMode metadata'
      },
      {
        path: 'userId',
        select: 'name email phoneNumber'
      },
      {
        path: 'setId',
        select: 'name itemType'
      },
      {
        path: 'reviewedByEvaluator',
        select: 'name email'
      }
    ]);

    res.status(200).json({
      success: true,
      message: "Answer accepted successfully",
      data: {
        answer: updatedAnswer
      }
    });
    console.log(res)

  } catch (error) {
    console.error('Error accepting answer:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// GET /crud/answers/evaluator/accepted - Get accepted answers for the authenticated evaluator
router.get('/answers/evaluator/evaluated', verifyTokenforevaluator, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Search term must be less than 100 characters'),

], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: {
          code: "INVALID_QUERY",
          details: errors.array()
        }
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get evaluator ID from authenticated request
    const evaluatorId = req.evaluator._id;
    console.log(evaluatorId)
    // Build filter for accepted answers by this evaluator
    const filter = {
      submissionStatus: 'evaluated',
      publishStatus: 'published',
      reviewedByEvaluator: evaluatorId,
      reviewStatus: { $ne: 'review_completed' } // Exclude completed reviews
    };


    // Build aggregation pipeline for accepted answers by this evaluator
    const pipeline = [
      { $match: filter },
      // Lookup questions based on testType
      {
        $lookup: {
          from: 'aiswbquestions',
          localField: 'questionId',
          foreignField: '_id',
          as: 'aiswbQuestion'
        }
      },
      {
        $lookup: {
          from: 'subjectivetestquestions',
          localField: 'questionId',
          foreignField: '_id',
          as: 'subjectiveQuestion'
        }
      },
      // Lookup test info for subjective questions
      {
        $lookup: {
          from: 'subjectivetests',
          localField: 'testId',
          foreignField: '_id',
          as: 'test'
        }
      },
      {
        $lookup: {
          from: 'mobileusers',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $lookup: {
          from: 'aiswbsets',
          localField: 'setId',
          foreignField: '_id',
          as: 'set'
        }
      },
      // Combine question data based on testType
      {
        $addFields: {
          question: {
            $cond: {
              if: { $eq: ['$testType', 'subjective'] },
              then: { $arrayElemAt: ['$subjectiveQuestion', 0] },
              else: { $arrayElemAt: ['$aiswbQuestion', 0] }
            }
          }
        }
      },
      {
        $unwind: {
          path: '$question',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$set',
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    // Add search functionality
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'question.question': searchRegex },
            { 'user.name': searchRegex },
            { 'user.email': searchRegex },
            { textAnswer: searchRegex }
          ]
        }
      });
    }

    // Add projection to select only needed fields
    pipeline.push({
      $project: {
        _id: 1,
        userId: 1,
        questionId: 1,
        clientId: 1,
        testType: 1,
        testId: 1,
        setId: 1,
        attemptNumber: 1,
        answerImages: 1,
        textAnswer: 1,
        submissionStatus: 1,
        reviewStatus: 1,
        publishStatus: 1,
        popularityStatus: 1,
        submittedAt: 1,
        reviewedAt: 1,
        evaluatedAt: 1,
        evaluation: 1,
        feedback: 1,
        extractedTexts: 1,
        metadata: 1,
        annotations: 1,
        'question._id': 1,
        'question.question': 1,
        'question.evaluationMode': 1,
        'question.evaluationType': 1,
        'question.metadata.difficultyLevel': 1,
        'question.metadata.maximumMarks': 1,
        'question.metadata.estimatedTime': 1,
        'test._id': 1,
        'test.name': 1,
        'test.description': 1,
        'test.category': 1,
        'test.subcategory': 1,
        'user._id': 1,
        'user.name': 1,
        'user.email': 1,
        'user.phoneNumber': 1,
        'set._id': 1,
        'set.name': 1,
        'set.itemType': 1
      }
    });

    // Add sorting by review date (most recent first)
    pipeline.push({
      $sort: { reviewedAt: -1 }
    });

    // Get total count for pagination
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: "total" });
    
    const [countResult] = await UserAnswer.aggregate(countPipeline);
    const totalCount = countResult ? countResult.total : 0;

    // Add pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    const evaluatedAnswers = await UserAnswer.aggregate(pipeline);
    // Add downloadUrl to each annotation
    await Promise.all(
      evaluatedAnswers.map(async (answer) => {
       if (Array.isArray(answer.annotations)) {
         await Promise.all(
           answer.annotations.map(async (annotation) => {
             if (annotation.s3Key) {
               annotation.downloadUrl = await generateAnnotatedImageUrl(annotation.s3Key);
             }
           })
         );
       }
     })
   );
    res.status(200).json({
      success: true,
      message: "Your evaluated answers retrieved successfully",
      data: {
        answers: evaluatedAnswers,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalCount: totalCount,
          limit: limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Error fetching evaluator accepted answers:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// GET /crud/answers/evaluator/accepted - Get accepted answers for the authenticated evaluator
router.get('/answers/evaluator/accepted', verifyTokenforevaluator, [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Search term must be less than 100 characters'),
  query('publishStatus')
    .optional()
    .isIn(['published', 'not_published'])
    .withMessage('Invalid publish status filter')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: {
          code: "INVALID_QUERY",
          details: errors.array()
        }
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get evaluator ID from authenticated request
    const evaluatorId = req.evaluator._id;

    // Build filter for accepted answers by this evaluator
    const filter = {
      submissionStatus: 'accepted',
      reviewedByEvaluator: evaluatorId
    };

    // Add publish status filter if specified
    if (req.query.publishStatus) {
      filter.publishStatus = req.query.publishStatus;
    }

    // Build aggregation pipeline for accepted answers by this evaluator
    const pipeline = [
      { $match: filter },
      // Lookup questions based on testType
      {
        $lookup: {
          from: 'aiswbquestions',
          localField: 'questionId',
          foreignField: '_id',
          as: 'aiswbQuestion'
        }
      },
      {
        $lookup: {
          from: 'subjectivetestquestions',
          localField: 'questionId',
          foreignField: '_id',
          as: 'subjectiveQuestion'
        }
      },
      // Lookup test info for subjective questions
      {
        $lookup: {
          from: 'subjectivetests',
          localField: 'testId',
          foreignField: '_id',
          as: 'test'
        }
      },
      {
        $lookup: {
          from: 'mobileusers',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $lookup: {
          from: 'aiswbsets',
          localField: 'setId',
          foreignField: '_id',
          as: 'set'
        }
      },
      // Combine question data based on testType
      {
        $addFields: {
          question: {
            $cond: {
              if: { $eq: ['$testType', 'subjective'] },
              then: { $arrayElemAt: ['$subjectiveQuestion', 0] },
              else: { $arrayElemAt: ['$aiswbQuestion', 0] }
            }
          }
        }
      },
      {
        $unwind: {
          path: '$question',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $unwind: {
          path: '$set',
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    // Add search functionality
    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      pipeline.push({
        $match: {
          $or: [
            { 'question.question': searchRegex },
            { 'user.name': searchRegex },
            { 'user.email': searchRegex },
            { textAnswer: searchRegex }
          ]
        }
      });
    }

    // Add projection to select only needed fields
    pipeline.push({
      $project: {
        _id: 1,
        userId: 1,
        clientId: 1,
        questionId: 1,
        testType: 1,
        testId: 1,
        setId: 1,
        attemptNumber: 1,
        answerImages: 1,
        textAnswer: 1,
        submissionStatus: 1,
        reviewStatus: 1,
        publishStatus: 1,
        popularityStatus: 1,
        submittedAt: 1,
        acceptedAt: 1,
        evaluation: 1,
        hindiEvaluation: 1,
        feedback: 1,
        extractedTexts: 1,
        metadata: 1,
        annotations: 1,
        'question._id': 1,
        'question.question': 1,
        'question.evaluationMode': 1,
        'question.evaluationType': 1,
        'question.metadata.difficultyLevel': 1,
        'question.metadata.maximumMarks': 1,
        'question.metadata.estimatedTime': 1,
        'test._id': 1,
        'test.name': 1,
        'test.description': 1,
        'test.category': 1,
        'test.subcategory': 1,
        'user._id': 1,
        'user.name': 1,
        'user.email': 1,
        'user.phoneNumber': 1,
        'set._id': 1,
        'set.name': 1,
        'set.itemType': 1
      }
    });

    // Add sorting by review date (most recent first)
    pipeline.push({
      $sort: { acceptedAt: -1 }
    });

    // Get total count for pagination
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: "total" });
    
    const [countResult] = await UserAnswer.aggregate(countPipeline);
    const totalCount = countResult ? countResult.total : 0;

    // Add pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limit });

    const acceptedAnswers = await UserAnswer.aggregate(pipeline);

    res.status(200).json({
      success: true,
      message: "Your accepted answers retrieved successfully",
      data: {
        answers: acceptedAnswers,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalCount / limit),
          totalCount: totalCount,
          limit: limit,
          hasNextPage: page < Math.ceil(totalCount / limit),
          hasPrevPage: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Error fetching evaluator accepted answers:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// GET /crud/answers/evaluator/:answerId - Get single answer details for authenticated evaluator
router.get('/answers/evaluator/:answerId', verifyTokenforevaluator, [
  param('answerId')
    .isMongoId()
    .withMessage('Answer ID must be a valid MongoDB ObjectId')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        error: {
          code: "INVALID_INPUT",
          details: errors.array()
        }
      });
    }

    const { answerId } = req.params;
    const evaluatorId = req.evaluator._id; // Get evaluator ID from authenticated request

    const answer = await UserAnswer.findById(answerId).populate([
      {
        path: 'questionId',
        select: 'question detailedAnswer evaluationMode metadata'
      },
      {
        path: 'userId',
        select: 'name email phoneNumber'
      },
      {
        path: 'setId',
        select: 'name itemType description'
      }
    ]);

    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        error: {
          code: "ANSWER_NOT_FOUND",
          details: "The specified answer does not exist"
        }
      });
    }

    // Check if the answer was accepted by the current evaluator
    if (answer.submissionStatus === 'accepted' && answer.reviewedByEvaluator.toString() !== evaluatorId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        error: {
          code: "ACCESS_DENIED",
          details: "You can only view answers that you have accepted"
        }
      });
    }

    res.status(200).json({
      success: true,
      message: "Answer retrieved successfully",
      data: {
        answer: answer
      }
    });

  } catch (error) {
    console.error('Error fetching evaluator answer:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

// PUT /crud/answers/:answerId/update - Update answer evaluation (works for both auto and manual modes)
router.put('/answers/:answerId/update', [
  param('answerId')
    .isMongoId()
    .withMessage('Answer ID must be a valid MongoDB ObjectId'),
  body('evaluation')
    .optional()
    .isObject()
    .withMessage('Evaluation must be an object'),
  body('evaluation.relevancy')
    .optional()
    .isInt({ min: 0, max: 100 })
    .withMessage('Relevancy must be between 0 and 100'),
  body('evaluation.score')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Score must be a positive integer'),
  body('evaluation.remark')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 2250 })
    .withMessage('Remark must be a string up to 2250 chars'),
  body('evaluation.comments')
    .optional()
    .isArray()
    .withMessage('Comments must be an array'),
  body('evaluation.analysis')
    .optional()
    .isObject()
    .withMessage('Analysis must be an object'),
  body('evaluation.analysis.introduction')
    .optional()
    .isArray()
    .withMessage('Introduction must be an array'),
  body('evaluation.analysis.body')
    .optional()
    .isArray()
    .withMessage('Body must be an array'),
  body('evaluation.analysis.conclusion')
    .optional()
    .isArray()
    .withMessage('Conclusion must be an array'),
  body('evaluation.analysis.strengths')
    .optional()
    .isArray()
    .withMessage('Strengths must be an array'),
  body('evaluation.analysis.weaknesses')
    .optional()
    .isArray()
    .withMessage('Weaknesses must be an array'),
  body('evaluation.analysis.suggestions')
    .optional()
    .isArray()
    .withMessage('Suggestions must be an array'),
  body('evaluation.analysis.feedback')
    .optional()
    .isArray()
    .withMessage('Feedback must be an array'),
  body('publishStatus')
    .optional()
    .isIn(['published', 'not_published'])
    .withMessage('Invalid publish status'),
  body('submissionStatus')
    .optional()
    .isIn(['submitted', 'rejected', 'evaluated'])
    .withMessage('Invalid submission status'),
  body('reviewStatus')
    .optional()
    .isIn(['review_pending', 'review_accepted', 'review_completed'])
    .withMessage('Invalid review status')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid input data",
        error: {
          code: "INVALID_INPUT",
          details: errors.array()
        }
      });
    }

    const { answerId } = req.params;
    const { 
      evaluation, 
      publishStatus, 
      submissionStatus, 
      reviewStatus 
    } = req.body;

    // Find the answer
    const answer = await UserAnswer.findById(answerId);
    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        error: {
          code: "ANSWER_NOT_FOUND",
          details: "The specified answer does not exist"
        }
      });
    }

    // Dynamically populate question based on testType
    let question;
    if (answer.testType === 'aiswb') {
      question = await AiswbQuestion.findById(answer.questionId);
    } else if (answer.testType === 'subjective') {
      const SubjectiveTestQuestion = require('../models/SubjectiveTestQuestion');
      question = await SubjectiveTestQuestion.findById(answer.questionId);
    }
    answer.questionId = question;

    // Prepare update data
    const updateData = {
      updatedAt: new Date()
    };

    // Update evaluation if provided
    if (evaluation) {
      updateData.evaluation = {
        ...answer.evaluation,
        ...evaluation,
        analysis: {
          ...((answer.evaluation && answer.evaluation.analysis) || {}),
          ...(evaluation.analysis || {})
        }
      };
      // Ensure the answer is marked as evaluated if evaluation is provided
      updateData.submissionStatus = 'evaluated';
      updateData.evaluatedAt = new Date();
    }

    // Update status fields if provided
    if (publishStatus !== undefined) {
      updateData.publishStatus = publishStatus;
    }
    
    if (submissionStatus !== undefined) {
      updateData.submissionStatus = submissionStatus;
    }
    
    if (reviewStatus !== undefined) {
      updateData.reviewStatus = reviewStatus;
    }

    const updatedAnswer = await UserAnswer.findByIdAndUpdate(
      answerId,
      updateData,
      { new: true, runValidators: true }
    );

    // Dynamically populate question based on testType
    if (updatedAnswer.testType === 'aiswb') {
      const question = await AiswbQuestion.findById(updatedAnswer.questionId).select('question evaluationMode metadata');
      updatedAnswer.questionId = question;
    } else if (updatedAnswer.testType === 'subjective') {
      const SubjectiveTestQuestion = require('../models/SubjectiveTestQuestion');
      const question = await SubjectiveTestQuestion.findById(updatedAnswer.questionId).select('question evaluationMode metadata');
      updatedAnswer.questionId = question;
    }

    // Populate other fields
    const User = require('../models/User');
    const user = await User.findById(updatedAnswer.userId).select('name email phoneNumber');
    updatedAnswer.userId = user;

    if (updatedAnswer.setId) {
      const AISWBSet = require('../models/AISWBSet');
      const setId = await AISWBSet.findById(updatedAnswer.setId).select('name itemType');
      updatedAnswer.setId = setId;
    }

    res.status(200).json({
      success: true,
      message: "Answer updated successfully",
      data: {
        answer: updatedAnswer
      }
    });

  } catch (error) {
    console.error('Error updating answer:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
});

module.exports = router;
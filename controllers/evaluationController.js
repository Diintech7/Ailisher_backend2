// controllers/evaluationController.js
const Evaluation = require('../models/Evaluation');
const UserAnswer = require('../models/UserAnswer');
const AiswbQuestion = require('../models/AiswbQuestion');
const MobileUser = require('../models/MobileUser');

// Save Evaluated Answer
const saveEvaluatedAnswer = async (req, res) => {
  try {
    const {
      submissionId,
      questionId,
      userId,
      evaluation
    } = req.body;

    // Validate required fields
    if (!submissionId || !questionId || !userId || !evaluation) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: submissionId, questionId, userId, or evaluation'
      });
    }

    // Validate evaluation structure
    if (!evaluation.geminiAnalysis || typeof evaluation.geminiAnalysis.accuracy !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Invalid evaluation structure: geminiAnalysis with accuracy is required'
      });
    }

    // Verify submission exists
    const submission = await UserAnswer.findById(submissionId);
    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission not found'
      });
    }

    // Verify question exists
    const question = await AiswbQuestion.findById(questionId);
    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    // Verify user exists
    const user = await MobileUser.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if evaluation already exists for this submission
    const existingEvaluation = await Evaluation.findOne({ submissionId });
    if (existingEvaluation) {
      return res.status(409).json({
        success: false,
        message: 'Evaluation already exists for this submission'
      });
    }

    // Create new evaluation with only the fields that exist in the Evaluation model
    const newEvaluation = new Evaluation({
      submissionId,
      questionId,
      userId,
      clientId: submission.clientId,
      evaluationMode: evaluation.evaluationMode || 'auto',
      evaluation: {
        relevancy: evaluation.evaluation?.relevancy || 0,
        extractedText: evaluation.evaluation?.extractedText || '',
        score: evaluation.evaluation?.score || 0,
        remark: evaluation.evaluation?.remark || '',
        feedbackStatus: evaluation.evaluation?.feedbackStatus || true,
        userFeedback: evaluation.evaluation?.userFeedback || {
          message: '',
          submittedAt: null
        },
        comments: evaluation.evaluation?.comments || [],
        analysis: {
          introduction: evaluation.evaluation?.analysis?.introduction || [],
          body: evaluation.evaluation?.analysis?.body || [],
          conclusion: evaluation.evaluation?.analysis?.conclusion || [],
          strengths: evaluation.evaluation?.analysis?.strengths || [],
          weaknesses: evaluation.evaluation?.analysis?.weaknesses || [],
          suggestions: evaluation.evaluation?.analysis?.suggestions || [],
          feedback: evaluation.evaluation?.analysis?.feedback || []
        }
      },
      hindiEvaluation: {
        relevancy: evaluation.hindiEvaluation?.relevancy || 0,
        score: evaluation.hindiEvaluation?.score || 0,
        remark: evaluation.hindiEvaluation?.remark || '',
        comments: evaluation.hindiEvaluation?.comments || [],
        analysis: {
          introduction: evaluation.hindiEvaluation?.analysis?.introduction || [],
          body: evaluation.hindiEvaluation?.analysis?.body || [],
          conclusion: evaluation.hindiEvaluation?.analysis?.conclusion || [],
          strengths: evaluation.hindiEvaluation?.analysis?.strengths || [],
          weaknesses: evaluation.hindiEvaluation?.analysis?.weaknesses || [],
          suggestions: evaluation.hindiEvaluation?.analysis?.suggestions || [],
          feedback: evaluation.hindiEvaluation?.analysis?.feedback || []
        }
      },
      annotations: evaluation.annotations || []
    });

    const savedEvaluation = await newEvaluation.save();

    res.status(201).json({
      success: true,
      message: 'Evaluation saved successfully',
      data: {
        evaluationId: savedEvaluation._id,
        submissionId: savedEvaluation.submissionId,
        questionId: savedEvaluation.questionId,
        userId: savedEvaluation.userId,
        clientId: savedEvaluation.clientId,
        evaluationMode: savedEvaluation.evaluationMode,
        evaluation: savedEvaluation.evaluation,
        hindiEvaluation: savedEvaluation.hindiEvaluation,
        annotations: savedEvaluation.annotations,
        createdAt: savedEvaluation.createdAt,
        updatedAt: savedEvaluation.updatedAt
      }
    });

  } catch (error) {
    console.error('Error saving evaluation:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while saving evaluation',
      error: error.message
    });
  }
};

// Get User's Evaluated Answers
const getUserEvaluatedAnswers = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      questionId,
      status,
      page = 1,
      limit = 10
    } = req.query;

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required'
      });
    }

    // Verify user exists
    const user = await MobileUser.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get evaluations with pagination
    const result = await Evaluation.getUserEvaluations(userId, {
      questionId,
      status,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    // Format response data
    const formattedEvaluations = result.evaluations.map(evaluation => ({
      evaluationId: evaluation._id,
      submissionId: evaluation.submissionId._id,
      questionId: evaluation.questionId._id,
      userId: evaluation.userId,
      extractedTexts: evaluation.extractedTexts,
      geminiAnalysis: evaluation.geminiAnalysis,
      status: evaluation.status,
      evaluatedAt: evaluation.evaluatedAt,
      question: {
        title: evaluation.questionId.question,
        description: evaluation.questionId.detailedAnswer,
        metadata: evaluation.questionId.metadata
      },
      submission: {
        attemptNumber: evaluation.submissionId.attemptNumber,
        submittedAt: evaluation.submissionId.submittedAt
      }
    }));

    res.status(200).json({
      success: true,
      data: {
        evaluations: formattedEvaluations,
        pagination: result.pagination
      }
    });

  } catch (error) {
    console.error('Error fetching user evaluations:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching evaluations',
      error: error.message
    });
  }
};

// Update Evaluation Status
const updateEvaluationStatus = async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const { status } = req.body;

    // Validate evaluationId
    if (!evaluationId) {
      return res.status(400).json({
        success: false,
        message: 'Evaluation ID is required'
      });
    }

    // Validate status
    if (!status || !['published', 'not_published'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (published or not_published)'
      });
    }

    // Find and update evaluation
    const evaluation = await Evaluation.findById(evaluationId);
    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    evaluation.status = status;
    evaluation.updatedAt = new Date();
    await evaluation.save();

    res.status(200).json({
      success: true,
      message: 'Evaluation status updated successfully',
      data: {
        evaluationId: evaluation._id,
        status: evaluation.status,
        updatedAt: evaluation.updatedAt
      }
    });

  } catch (error) {
    console.error('Error updating evaluation status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating evaluation status',
      error: error.message
    });
  }
};

// Get Single Evaluation Details (Original method by evaluationId)
const getEvaluationDetails = async (req, res) => {
  try {
    const { evaluationId } = req.params;

    if (!evaluationId) {
      return res.status(400).json({
        success: false,
        message: 'Evaluation ID is required'
      });
    }

    const evaluation = await Evaluation.findById(evaluationId)
      .populate('questionId', 'question detailedAnswer metadata')
      .populate('submissionId', 'attemptNumber submittedAt answerImages textAnswer')
      .populate('userId', 'mobile clientId');

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    const formattedEvaluation = {
      evaluationId: evaluation._id,
      submissionId: evaluation.submissionId._id,
      questionId: evaluation.questionId._id,
      userId: evaluation.userId._id,
      extractedTexts: evaluation.extractedTexts,
      geminiAnalysis: evaluation.geminiAnalysis,
      status: evaluation.status,
      evaluatedAt: evaluation.evaluatedAt,
      question: {
        title: evaluation.questionId.question,
        description: evaluation.questionId.detailedAnswer,
        metadata: evaluation.questionId.metadata
      },
      submission: {
        attemptNumber: evaluation.submissionId.attemptNumber,
        submittedAt: evaluation.submissionId.submittedAt,
        answerImages: evaluation.submissionId.answerImages,
        textAnswer: evaluation.submissionId.textAnswer
      },
      user: {
        mobile: evaluation.userId.mobile,
        clientId: evaluation.userId.clientId
      }
    };

    res.status(200).json({
      success: true,
      data: formattedEvaluation
    });

  } catch (error) {
    console.error('Error fetching evaluation details:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching evaluation details',
      error: error.message
    });
  }
};

// NEW: Get Evaluation Details by Question ID and Count (attempt number)
const getEvaluationDetailsByQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { count = 1, userId } = req.query; // count defaults to 1 (first attempt)

    // Validate questionId
    if (!questionId) {
      return res.status(400).json({
        success: false,
        message: 'Question ID is required'
      });
    }

    // Validate count (attempt number)
    const attemptNumber = parseInt(count);
    if (isNaN(attemptNumber) || attemptNumber < 1 || attemptNumber > 5) {
      return res.status(400).json({
        success: false,
        message: 'Count must be a number between 1 and 5'
      });
    }

    // Verify question exists
    const question = await AiswbQuestion.findById(questionId);
    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    // Build query for finding the user answer
    const userAnswerQuery = {
      questionId: questionId,
      attemptNumber: attemptNumber
    };

    // Add userId to query if provided (for client-specific routes)
    if (userId) {
      userAnswerQuery.userId = userId;
    }

    // Find the user answer for the specific attempt
    const userAnswer = await UserAnswer.findOne(userAnswerQuery)
      .populate('userId', 'mobile clientId');

    if (!userAnswer) {
      return res.status(404).json({
        success: false,
        message: `No submission found for question ${questionId} with attempt number ${attemptNumber}${userId ? ` for user ${userId}` : ''}`
      });
    }

    // Find the evaluation for this submission
    const evaluation = await Evaluation.findOne({ submissionId: userAnswer._id })
      .populate('questionId', 'question detailedAnswer metadata')
      .populate('submissionId', 'attemptNumber submittedAt answerImages textAnswer')
      .populate('userId', 'mobile clientId');

    if (!evaluation) {
      return res.status(404).json({
        success: false,
        message: `No evaluation found for question ${questionId} with attempt number ${attemptNumber}${userId ? ` for user ${userId}` : ''}`
      });
    }

    // Format the response
    const formattedEvaluation = {
      evaluationId: evaluation._id,
      submissionId: evaluation.submissionId._id,
      questionId: evaluation.questionId._id,
      userId: evaluation.userId._id,
      attemptNumber: evaluation.submissionId.attemptNumber,
      extractedTexts: evaluation.extractedTexts,
      geminiAnalysis: evaluation.geminiAnalysis,
      status: evaluation.status,
      evaluatedAt: evaluation.evaluatedAt,
      question: {
        title: evaluation.questionId.question,
        description: evaluation.questionId.detailedAnswer,
        metadata: evaluation.questionId.metadata
      },
      submission: {
        attemptNumber: evaluation.submissionId.attemptNumber,
        submittedAt: evaluation.submissionId.submittedAt,
        answerImages: evaluation.submissionId.answerImages,
        textAnswer: evaluation.submissionId.textAnswer
      },
      user: {
        mobile: evaluation.userId.mobile,
        clientId: evaluation.userId.clientId
      },
      // Additional info about attempts
      attemptInfo: {
        currentAttempt: attemptNumber,
        totalAttempts: await UserAnswer.countDocuments({ 
          questionId: questionId, 
          userId: evaluation.userId._id 
        })
      }
    };

    res.status(200).json({
      success: true,
      data: formattedEvaluation
    });

  } catch (error) {
    console.error('Error fetching evaluation details by question:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching evaluation details',
      error: error.message
    });
  }
};

// Get All Evaluations (Admin)
const getAllEvaluations = async (req, res) => {
  try {
    const {
      status,
      questionId,
      clientId,
      page = 1,
      limit = 10
    } = req.query;

    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (questionId) {
      query.questionId = questionId;
    }
    
    if (clientId) {
      query.clientId = clientId;
    }

    const skip = (page - 1) * limit;

    const [evaluations, total] = await Promise.all([
      Evaluation.find(query)
        .populate('questionId', 'question metadata')
        .populate('userId', 'mobile clientId')
        .populate('submissionId', 'attemptNumber submittedAt')
        .sort({ evaluatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Evaluation.countDocuments(query)
    ]);

    const formattedEvaluations = evaluations.map(evaluation => ({
      evaluationId: evaluation._id,
      submissionId: evaluation.submissionId._id,
      questionId: evaluation.questionId._id,
      userId: evaluation.userId._id,
      clientId: evaluation.clientId,
      extractedTexts: evaluation.extractedTexts,
      geminiAnalysis: evaluation.geminiAnalysis,
      status: evaluation.status,
      evaluatedAt: evaluation.evaluatedAt,
      question: {
        title: evaluation.questionId.question,
        metadata: evaluation.questionId.metadata
      },
      user: {
        mobile: evaluation.userId.mobile,
        clientId: evaluation.userId.clientId
      },
      submission: {
        attemptNumber: evaluation.submissionId.attemptNumber,
        submittedAt: evaluation.submissionId.submittedAt
      }
    }));

    res.status(200).json({
      success: true,
      data: {
        evaluations: formattedEvaluations,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching all evaluations:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching evaluations',
      error: error.message
    });
  }
};

// Update evaluation with complete data
const updateEvaluationComplete = async (req, res) => {
  try {
    const { evaluationId } = req.params;
    const { evaluation } = req.body;

    if (!evaluationId || !evaluation) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: evaluationId and evaluation data'
      });
    }

    // Find existing evaluation
    const existingEvaluation = await Evaluation.findById(evaluationId);
    if (!existingEvaluation) {
      return res.status(404).json({
        success: false,
        message: 'Evaluation not found'
      });
    }

    // Update evaluation with only the fields that exist in the Evaluation model
    const updateData = {
      evaluationMode: evaluation.evaluationMode || existingEvaluation.evaluationMode,
      evaluation: {
        relevancy: evaluation.evaluation?.relevancy !== undefined ? evaluation.evaluation.relevancy : existingEvaluation.evaluation?.relevancy || 0,
        extractedText: evaluation.evaluation?.extractedText !== undefined ? evaluation.evaluation.extractedText : existingEvaluation.evaluation?.extractedText || '',
        score: evaluation.evaluation?.score !== undefined ? evaluation.evaluation.score : existingEvaluation.evaluation?.score || 0,
        remark: evaluation.evaluation?.remark !== undefined ? evaluation.evaluation.remark : existingEvaluation.evaluation?.remark || '',
        feedbackStatus: evaluation.evaluation?.feedbackStatus !== undefined ? evaluation.evaluation.feedbackStatus : existingEvaluation.evaluation?.feedbackStatus || true,
        userFeedback: evaluation.evaluation?.userFeedback || existingEvaluation.evaluation?.userFeedback || {
          message: '',
          submittedAt: null
        },
        comments: evaluation.evaluation?.comments || existingEvaluation.evaluation?.comments || [],
        analysis: {
          introduction: evaluation.evaluation?.analysis?.introduction || existingEvaluation.evaluation?.analysis?.introduction || [],
          body: evaluation.evaluation?.analysis?.body || existingEvaluation.evaluation?.analysis?.body || [],
          conclusion: evaluation.evaluation?.analysis?.conclusion || existingEvaluation.evaluation?.analysis?.conclusion || [],
          strengths: evaluation.evaluation?.analysis?.strengths || existingEvaluation.evaluation?.analysis?.strengths || [],
          weaknesses: evaluation.evaluation?.analysis?.weaknesses || existingEvaluation.evaluation?.analysis?.weaknesses || [],
          suggestions: evaluation.evaluation?.analysis?.suggestions || existingEvaluation.evaluation?.analysis?.suggestions || [],
          feedback: evaluation.evaluation?.analysis?.feedback || existingEvaluation.evaluation?.analysis?.feedback || []
        }
      },
      hindiEvaluation: {
        relevancy: evaluation.hindiEvaluation?.relevancy !== undefined ? evaluation.hindiEvaluation.relevancy : existingEvaluation.hindiEvaluation?.relevancy || 0,
        score: evaluation.hindiEvaluation?.score !== undefined ? evaluation.hindiEvaluation.score : existingEvaluation.hindiEvaluation?.score || 0,
        remark: evaluation.hindiEvaluation?.remark !== undefined ? evaluation.hindiEvaluation.remark : existingEvaluation.hindiEvaluation?.remark || '',
        comments: evaluation.hindiEvaluation?.comments || existingEvaluation.hindiEvaluation?.comments || [],
        analysis: {
          introduction: evaluation.hindiEvaluation?.analysis?.introduction || existingEvaluation.hindiEvaluation?.analysis?.introduction || [],
          body: evaluation.hindiEvaluation?.analysis?.body || existingEvaluation.hindiEvaluation?.analysis?.body || [],
          conclusion: evaluation.hindiEvaluation?.analysis?.conclusion || existingEvaluation.hindiEvaluation?.analysis?.conclusion || [],
          strengths: evaluation.hindiEvaluation?.analysis?.strengths || existingEvaluation.hindiEvaluation?.analysis?.strengths || [],
          weaknesses: evaluation.hindiEvaluation?.analysis?.weaknesses || existingEvaluation.hindiEvaluation?.analysis?.weaknesses || [],
          suggestions: evaluation.hindiEvaluation?.analysis?.suggestions || existingEvaluation.hindiEvaluation?.analysis?.suggestions || [],
          feedback: evaluation.hindiEvaluation?.analysis?.feedback || existingEvaluation.hindiEvaluation?.analysis?.feedback || []
        }
      },
      annotations: evaluation.annotations || existingEvaluation.annotations || []
    };

    const updatedEvaluation = await Evaluation.findByIdAndUpdate(
      evaluationId,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Evaluation updated successfully',
      data: {
        evaluationId: updatedEvaluation._id,
        submissionId: updatedEvaluation.submissionId,
        questionId: updatedEvaluation.questionId,
        userId: updatedEvaluation.userId,
        clientId: updatedEvaluation.clientId,
        evaluationMode: updatedEvaluation.evaluationMode,
        evaluation: updatedEvaluation.evaluation,
        hindiEvaluation: updatedEvaluation.hindiEvaluation,
        annotations: updatedEvaluation.annotations,
        createdAt: updatedEvaluation.createdAt,
        updatedAt: updatedEvaluation.updatedAt
      }
    });

  } catch (error) {
    console.error('Error updating evaluation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update evaluation',
      error: error.message
    });
  }
};

module.exports = {
  saveEvaluatedAnswer,
  getUserEvaluatedAnswers,
  updateEvaluationStatus,
  getEvaluationDetails,
  getEvaluationDetailsByQuestion, // NEW method
  getAllEvaluations,
  updateEvaluationComplete
};
const MyQuestion = require('../models/MyQuestion');
const { validationResult } = require('express-validator');
const { getEvaluationFrameworkText } = require('../services/aiServices');
const { generatePresignedUrl, generateGetPresignedUrl, deleteObject } = require('../utils/r2');
const UserAnswer = require('../models/UserAnswer');

// Create question (User uploads)
const createQuestion = async (req, res) => {
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

    const { question, wordLimit, maximumMarks, subject, exam, key} = req.body;
    const clientId = req.user.clientId || req.user.userId;
    const userId = req.user.id;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required",
        error: {
          code: "MISSING_CLIENT_ID",
          details: "Client ID must be provided"
        }
      });
    }

    const myQuestion = new MyQuestion({
      question,
      wordLimit,
      maximumMarks,
      subject,
      exam,
      answerFiles:{
        fileKey: key,
        uploadedAt: new Date()
      },
      clientId,
      createdBy: userId,
      status: 'pending'
    });

    await myQuestion.save();

    res.status(201).json({
      success: true,
      message: "Question uploaded successfully",
      data: {
        id: myQuestion._id.toString(),
        question: myQuestion.question,
        wordLimit: myQuestion.wordLimit,
        maximumMarks: myQuestion.maximumMarks,
        subject: myQuestion.subject,
        exam: myQuestion.exam,
        answerFiles: myQuestion.answerFiles,
        status: myQuestion.status,
        createdAt: myQuestion.createdAt.toISOString()
      }
    });

  } catch (error) {
    console.error('Create question error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};

// Get question details
const getQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const clientId = req.user.clientId || req.user.userId;
    const userId = req.user.id;

    const question = await MyQuestion.findById(questionId);
    
    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        error: {
          code: "QUESTION_NOT_FOUND",
          details: "The specified question does not exist"
        }
      });
    }

    // Check permissions: user can see their own, client can see their clientId's
    const isOwner = question.createdBy.toString() === userId;
    const isClient = question.clientId === clientId;

    if (!isOwner && !isClient) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        error: {
          code: "ACCESS_DENIED",
          details: "You don't have permission to view this question"
        }
      });
    }

    // Generate presigned URLs for answer files
    let answerFilesWithUrls = [];
    if (question.answerFiles && question.answerFiles.length > 0) {
      answerFilesWithUrls = await Promise.all(
        question.answerFiles.map(async (file) => {
          try {
            const url = await generateGetPresignedUrl(file.fileKey);
            return { ...file.toObject(), url };
          } catch (error) {
            console.error('Error generating URL for file:', file.fileKey);
            return { ...file.toObject(), url: null };
          }
        })
      );
    }

    res.status(200).json({
      success: true,
      data: {
        id: question._id.toString(),
        question: question.question,
        wordLimit: question.wordLimit,
        maximumMarks: question.maximumMarks,
        subject: question.subject,
        exam: question.exam,
        answerFiles: answerFilesWithUrls,
        detailedAnswer: question.detailedAnswer,
        modalAnswer: question.modalAnswer,
        modalAnswerPdfKey: question.modalAnswerPdfKey,
        answerVideoUrls: question.answerVideoUrls || [],
        metadata: question.metadata,
        languageMode: question.languageMode,
        evaluationMode: question.evaluationMode,
        evaluationType: question.evaluationType,
        evaluationGuideline: question.evaluationGuideline,
        status: question.status,
        formattedBy: question.formattedBy,
        formattedAt: question.formattedAt,
        activatedAt: question.activatedAt,
        createdAt: question.createdAt.toISOString(),
        updatedAt: question.updatedAt.toISOString()
      }
    });

  } catch (error) {
    console.error('Get question error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};

// Get questions list (with filters)
const getQuestions = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Invalid query parameters",
        error: {
          code: "INVALID_INPUT",
          details: errors.array()
        }
      });
    }

    const { page = 1, limit = 10, status, subject, exam } = req.query;
    const clientId = req.user.clientId || req.user.userId;
    const userId = req.user.id;
    const userRole = req.user.role || 'user';

    // Build query
    const query = {};

    // Users can only see their own questions
    // Clients can see all questions for their clientId
    if (userRole === 'client') {
      query.clientId = clientId;
    } else {
      query.createdBy = userId;
    }

    if (status) {
      query.status = status;
    }
    if (subject) {
      query.subject = new RegExp(subject, 'i');
    }
    if (exam) {
      query.exam = new RegExp(exam, 'i');
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const questions = await MyQuestion.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'name mobile')
      .populate('formattedBy', 'name email');

    const total = await MyQuestion.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        questions: questions.map(q => ({
          id: q._id.toString(),
          question: q.question,
          wordLimit: q.wordLimit,
          maximumMarks: q.maximumMarks,
          subject: q.subject,
          exam: q.exam,
          status: q.status,
          answerFilesCount: q.answerFiles ? q.answerFiles.length : 0,
          createdAt: q.createdAt.toISOString(),
          createdBy: q.createdBy
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalCount: total,
          limit: parseInt(limit),
          hasNextPage: skip + questions.length < total,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('Get questions error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};

// Update question (before formatting)
const updateQuestion = async (req, res) => {
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

    const { questionId } = req.params;
    const userId = req.user.id;
    const updateData = req.body;

    const question = await MyQuestion.findById(questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        error: {
          code: "QUESTION_NOT_FOUND",
          details: "The specified question does not exist"
        }
      });
    }

    // Only owner can update, and only if status is pending
    if (question.createdBy.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        error: {
          code: "ACCESS_DENIED",
          details: "You can only update your own questions"
        }
      });
    }

    if (question.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Cannot update question",
        error: {
          code: "INVALID_STATUS",
          details: "Question can only be updated when status is 'pending'"
        }
      });
    }

    // Update allowed fields
    if (updateData.question) question.question = updateData.question;
    if (updateData.wordLimit) question.wordLimit = updateData.wordLimit;
    if (updateData.maximumMarks) question.maximumMarks = updateData.maximumMarks;
    if (updateData.subject) question.subject = updateData.subject;
    if (updateData.exam) question.exam = updateData.exam;
    if (updateData.answerFiles) question.answerFiles = updateData.answerFiles;

    await question.save();

    res.status(200).json({
      success: true,
      message: "Question updated successfully",
      data: {
        id: question._id.toString(),
        question: question.question,
        wordLimit: question.wordLimit,
        maximumMarks: question.maximumMarks,
        subject: question.subject,
        exam: question.exam,
        status: question.status,
        updatedAt: question.updatedAt.toISOString()
      }
    });

  } catch (error) {
    console.error('Update question error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};

// Delete question
const deleteQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role || 'user';

    const question = await MyQuestion.findById(questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        error: {
          code: "QUESTION_NOT_FOUND",
          details: "The specified question does not exist"
        }
      });
    }

    // Users can delete their own, clients can delete for their clientId
    const isOwner = question.createdBy.toString() === userId;
    const isClient = userRole === 'client' && question.clientId === (req.user.clientId || req.user.userId);

    if (!isOwner && !isClient) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        error: {
          code: "ACCESS_DENIED",
          details: "You don't have permission to delete this question"
        }
      });
    }

    // Delete associated files from R2
    if (question.answerFiles && question.answerFiles.length > 0) {
      for (const file of question.answerFiles) {
        try {
          await deleteObject(file.fileKey);
        } catch (error) {
          console.error('Error deleting file:', file.fileKey, error);
        }
      }
    }

    await MyQuestion.findByIdAndDelete(questionId);

    res.status(200).json({
      success: true,
      message: "Question deleted successfully"
    });

  } catch (error) {
    console.error('Delete question error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};

// Get pending questions (for client)
const getPendingFormatting = async (req, res) => {
  try {
    const clientId = req.user.clientId || req.user.userId;
    const { page = 1, limit = 10 } = req.query;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required",
        error: {
          code: "MISSING_CLIENT_ID",
          details: "Client ID must be provided"
        }
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const questions = await MyQuestion.find({
      clientId,
      status: 'pending'
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'name mobile');

    const total = await MyQuestion.countDocuments({
      clientId,
      status: 'pending'
    });

    res.status(200).json({
      success: true,
      data: {
        questions: questions.map(q => ({
          id: q._id.toString(),
          question: q.question,
          wordLimit: q.wordLimit,
          maximumMarks: q.maximumMarks,
          subject: q.subject,
          exam: q.exam,
          answerFilesCount: q.answerFiles ? q.answerFiles.length : 0,
          createdAt: q.createdAt.toISOString(),
          createdBy: q.createdBy
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalCount: total,
          limit: parseInt(limit),
          hasNextPage: skip + questions.length < total,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });

  } catch (error) {
    console.error('Get pending questions error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};

// Format question (Client)
const formatQuestion = async (req, res) => {
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

    const { questionId } = req.params;
    const clientId = req.user.clientId || req.user.userId;
    const userId = req.user.id;

    const question = await MyQuestion.findById(questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        error: {
          code: "QUESTION_NOT_FOUND",
          details: "The specified question does not exist"
        }
      });
    }

    // Check permissions and status
    if (question.clientId !== clientId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        error: {
          code: "ACCESS_DENIED",
          details: "You can only format questions for your client"
        }
      });
    }

    if (question.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Cannot format question",
        error: {
          code: "INVALID_STATUS",
          details: "Question can only be formatted when status is 'pending'"
        }
      });
    }

    const {
      detailedAnswer,
      modalAnswer,
      modalAnswerPdfKey,
      answerVideoUrls,
      metadata,
      languageMode,
      evaluationMode,
      evaluationType,
      evaluationGuideline
    } = req.body;

    // Update question with formatting data
    question.detailedAnswer = detailedAnswer;
    question.modalAnswer = modalAnswer || '';
    question.modalAnswerPdfKey = modalAnswerPdfKey || [];
    question.answerVideoUrls = answerVideoUrls || [];
    question.metadata = {
      ...question.metadata,
      ...metadata,
      wordLimit: metadata.wordLimit || question.wordLimit,
      maximumMarks: metadata.maximumMarks || question.maximumMarks
    };
    question.languageMode = languageMode;
    question.evaluationMode = evaluationMode;
    question.evaluationType = evaluationType;
    question.evaluationGuideline = evaluationGuideline || getEvaluationFrameworkText();
    question.formattedBy = userId;
    question.status = 'formatted';

    await question.save();

    res.status(200).json({
      success: true,
      message: "Question formatted successfully",
      data: {
        id: question._id.toString(),
        status: question.status,
        formattedAt: question.formattedAt.toISOString()
      }
    });

  } catch (error) {
    console.error('Format question error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};

// Activate question (Client)
const activateQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const clientId = req.user.clientId || req.user.userId;

    const question = await MyQuestion.findById(questionId);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
        error: {
          code: "QUESTION_NOT_FOUND",
          details: "The specified question does not exist"
        }
      });
    }

    // Check permissions and status
    if (question.clientId !== clientId) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        error: {
          code: "ACCESS_DENIED",
          details: "You can only activate questions for your client"
        }
      });
    }

    if (question.status !== 'formatted') {
      return res.status(400).json({
        success: false,
        message: "Cannot activate question",
        error: {
          code: "INVALID_STATUS",
          details: "Question can only be activated when status is 'formatted'"
        }
      });
    }

    // Validate required fields are present
    if (!question.detailedAnswer) {
      return res.status(400).json({
        success: false,
        message: "Cannot activate question",
        error: {
          code: "MISSING_FIELDS",
          details: "Question must be formatted before activation"
        }
      });
    }

    question.status = 'active';
    await question.save();

    res.status(200).json({
      success: true,
      message: "Question activated successfully",
      data: {
        id: question._id.toString(),
        status: question.status,
        activatedAt: question.activatedAt.toISOString()
      }
    });

  } catch (error) {
    console.error('Activate question error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};

// Generate presigned URL for file upload (before question creation)
const generateTemporaryFileUploadUrl = async (req, res) => {
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

    const { fileName, contentType } = req.body;
    const clientId = req.user.clientId || req.user.userId;
    const userId = req.user.id;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required"
      });
    }

    // Generate unique key (using userId for temporary uploads)
    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1e9);
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Use clientId as prefix (mobile users don't have businessName)
    const key = `${req.user.businessName}/myquestion/temp/${clientId}/${userId}/${timestamp}-${randomSuffix}-${safeFileName}`;

    // Generate presigned URL
    const uploadUrl = await generatePresignedUrl(key, contentType);
    const downloadUrl = await generateGetPresignedUrl(key, 604800); // 7 days

    res.json({
      success: true,
      uploadUrl,
      downloadUrl,
      key,
      fileName,
      message: 'Upload URL generated successfully'
    });

  } catch (error) {
    console.error('Generate temporary upload URL error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL',
      error: error.message
    });
  }
};

// Confirm file upload
const confirmFileUpload = async (req, res) => {
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

    const { questionId } = req.params;
    const { key, fileName, fileType, downloadUrl } = req.body;
    const userId = req.user.id;

    const question = await MyQuestion.findById(questionId);
    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found"
      });
    }

    // Only owner can add files, and only if pending
    if (question.createdBy.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    if (question.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Cannot add files to formatted question"
      });
    }

    // Add file to answerFiles array
    question.answerFiles.push({
      fileUrl: downloadUrl,
      fileKey: key,
      fileName,
      fileType,
      uploadedAt: new Date()
    });

    await question.save();

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        file: question.answerFiles[question.answerFiles.length - 1]
      }
    });

  } catch (error) {
    console.error('Confirm file upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm file upload',
      error: error.message
    });
  }
};

// Create question and submit answer in a single request (multipart/form-data with key 'images')
const createQuestionWithAnswer = async (req, res) => {
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

    const clientId = req.user.clientId || req.user.userId;
    const userId = req.user.id;
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required",
        error: {
          code: "MISSING_CLIENT_ID",
          details: "Client ID must be provided"
        }
      });
    }

    const {
      question,
      wordLimit,
      maximumMarks,
      subject,
      exam,
      timeSpent = 0,
      sourceType = "direct_access"
    } = req.body || {};

    if (!question || !wordLimit || !maximumMarks || !subject || !exam) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        error: {
          code: "MISSING_FIELDS",
          details: "question, wordLimit, maximumMarks, subject, exam are required"
        }
      });
    }

    // Build MyQuestion
    const myQuestion = new MyQuestion({
      question,
      wordLimit,
      maximumMarks,
      subject,
      exam,
      clientId,
      createdBy: userId,
      status: 'pending'
    });
    await myQuestion.save();

    // Normalize uploaded files from multer (CloudinaryStorage)
    const uploadedFiles = Array.isArray(req.files)
      ? req.files.map((f) => ({
          imageUrl: f.path || f.secure_url,
          cloudinaryPublicId: f.filename || f.public_id,
          originalName: f.originalname || f.originalName || ""
        }))
      : [];

    if (!uploadedFiles.length) {
      return res.status(400).json({
        success: false,
        message: "images is required",
        error: {
          code: "MISSING_ANSWER_CONTENT",
          details: "Provide at least one answer image under key 'images'"
        }
      });
    }

    // Create UserAnswer linked to this question (no evaluation)
    const answerData = {
      userId,
      questionId: myQuestion._id.toString(),
      clientId,
      testType: "myquestion",
      answerImages: uploadedFiles,
      submissionStatus: "submitted",
      submittedAt: new Date(),
      metadata: {
        timeSpent: Number(timeSpent) || 0,
        sourceType,
      },
    };
    const userAnswer = await UserAnswer.createNewAttemptSafe(answerData);

    return res.status(201).json({
      success: true,
      message: "Question and answer submitted successfully",
      data: {
        question: {
          id: myQuestion._id.toString(),
          question: myQuestion.question,
          wordLimit: myQuestion.wordLimit,
          maximumMarks: myQuestion.maximumMarks,
          subject: myQuestion.subject,
          exam: myQuestion.exam,
          status: myQuestion.status,
          createdAt: myQuestion.createdAt.toISOString()
        },
        answer: {
          id: userAnswer._id,
          attemptNumber: userAnswer.attemptNumber,
          submissionStatus: userAnswer.submissionStatus,
          submittedAt: userAnswer.submittedAt
        }
      }
    });
  } catch (error) {
    console.error('Create question with answer error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};

module.exports = {
  createQuestion,
  getQuestion,
  getQuestions,
  updateQuestion,
  deleteQuestion,
  getPendingFormatting,
  formatQuestion,
  activateQuestion,
  generateTemporaryFileUploadUrl,
  confirmFileUpload,
  createQuestionWithAnswer
};


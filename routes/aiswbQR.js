const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const Question = require('../models/AiswbQuestion');
const AISWBSet = require('../models/AISWBSet');
const Book = require('../models/Book');
const Workbook = require('../models/Workbook');
const Chapter = require('../models/Chapter');
const Topic = require('../models/Topic');
const SubTopic = require('../models/SubTopic');
const User = require('../models/User');
const { validationResult, param, query } = require('express-validator');

// Validation middleware
const validateQuestionId = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId')
];

const validateSetId = [
  param('setId')
    .isMongoId()
    .withMessage('Set ID must be a valid MongoDB ObjectId')
];

const validateQROptions = [
  query('size')
    .optional()
    .isInt({ min: 100, max: 1000 })
    .withMessage('Size must be between 100 and 1000 pixels'),
  query('clientId')
    .optional()
    .isString()
    .withMessage('Client ID must be a string')
];

// Helper function to get client name by clientId
async function getClientName(clientId) {
  try {
    const client = await User.findOne({ 
      $or: [
        { userId: clientId },
      ],
      role: 'client' 
    });
    
    if (client) {
      return client.businessName || client.name;
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching client:', error);
    return null;
  }
}

// Enhanced helper function to get client info from question/set (supports all content types)
async function getClientInfoFromQuestion(questionId) {
  try {
    const question = await Question.findById(questionId).populate('setId');
    if (!question || !question.setId) {
      return null;
    }

    return await getClientInfoFromSet(question.setId._id);
  } catch (error) {
    console.error('Error fetching client info from question:', error);
    return null;
  }
}

// Enhanced helper function to get client info from set (supports all content types including chapters, topics, subtopics)
async function getClientInfoFromSet(setId) {
  try {
    const set = await AISWBSet.findById(setId);
    if (!set) {
      return null;
    }

    let clientId = null;
    let clientName = null;

    // Check the item type and get client info accordingly
    if (set.itemType === 'workbook' || set.isWorkbook) {
      // Get workbook associated with the set
      const workbook = await Workbook.findById(set.itemId).populate('user');
      if (workbook && workbook.user) {
        if (workbook.user.role === 'client') {
          clientId = workbook.user.userId;
          clientName = workbook.user.businessName || workbook.user.name;
        } else {
          clientName = workbook.user.name;
          clientId = workbook.user._id.toString();
        }
      }
    } else if (set.itemType === 'book') {
      // Get book associated with the set
      const book = await Book.findById(set.itemId);
      if (book && book.clientId) {
        clientId = book.clientId;
        clientName = await getClientName(book.clientId);
      }
    } else if (set.itemType === 'chapter') {
      // Get chapter and trace back to parent (book or workbook)
      const chapter = await Chapter.findById(set.itemId);
      if (chapter) {
        if (chapter.parentType === 'book' && chapter.book) {
          const book = await Book.findById(chapter.book);
          if (book && book.clientId) {
            clientId = book.clientId;
            clientName = await getClientName(book.clientId);
          }
        } else if (chapter.parentType === 'workbook' && chapter.workbook) {
          const workbook = await Workbook.findById(chapter.workbook).populate('user');
          if (workbook && workbook.user) {
            if (workbook.user.role === 'client') {
              clientId = workbook.user.userId;
              clientName = workbook.user.businessName || workbook.user.name;
            } else {
              clientName = workbook.user.name;
              clientId = workbook.user._id.toString();
            }
          }
        }
      }
    } else if (set.itemType === 'topic') {
      // Get topic and trace back through chapter to parent (book or workbook)
      const topic = await Topic.findById(set.itemId).populate('chapter');
      if (topic && topic.chapter) {
        const chapter = topic.chapter;
        if (chapter.parentType === 'book' && chapter.book) {
          const book = await Book.findById(chapter.book);
          if (book && book.clientId) {
            clientId = book.clientId;
            clientName = await getClientName(book.clientId);
          }
        } else if (chapter.parentType === 'workbook' && chapter.workbook) {
          const workbook = await Workbook.findById(chapter.workbook).populate('user');
          if (workbook && workbook.user) {
            if (workbook.user.role === 'client') {
              clientId = workbook.user.userId;
              clientName = workbook.user.businessName || workbook.user.name;
            } else {
              clientName = workbook.user.name;
              clientId = workbook.user._id.toString();
            }
          }
        }
      }
    } else if (set.itemType === 'subtopic') {
      // Get subtopic and trace back through topic -> chapter to parent (book or workbook)
      const subtopic = await SubTopic.findById(set.itemId).populate({
        path: 'topic',
        populate: {
          path: 'chapter'
        }
      });
      if (subtopic && subtopic.topic && subtopic.topic.chapter) {
        const chapter = subtopic.topic.chapter;
        if (chapter.parentType === 'book' && chapter.book) {
          const book = await Book.findById(chapter.book);
          if (book && book.clientId) {
            clientId = book.clientId;
            clientName = await getClientName(book.clientId);
          }
        } else if (chapter.parentType === 'workbook' && chapter.workbook) {
          const workbook = await Workbook.findById(chapter.workbook).populate('user');
          if (workbook && workbook.user) {
            if (workbook.user.role === 'client') {
              clientId = workbook.user.userId;
              clientName = workbook.user.businessName || workbook.user.name;
            } else {
              clientName = workbook.user.name;
              clientId = workbook.user._id.toString();
            }
          }
        }
      }
    } else {
      // Fallback: try to get from book if no specific itemType is set
      const book = await Book.findById(set.itemId);
      if (book && book.clientId) {
        clientId = book.clientId;
        clientName = await getClientName(book.clientId);
      }
    }

    if (!clientName) {
      return null;
    }

    return {
      clientId: clientId,
      clientName: clientName
    };
  } catch (error) {
    console.error('Error fetching client info from set:', error);
    return null;
  }
}

// New helper function to get client info directly from content type and ID
async function getClientInfoFromContent(contentType, contentId) {
  try {
    let clientId = null;
    let clientName = null;

    switch (contentType.toLowerCase()) {
      case 'book':
        const book = await Book.findById(contentId);
        if (book && book.clientId) {
          clientId = book.clientId;
          clientName = await getClientName(book.clientId);
        }
        break;

      case 'workbook':
        const workbook = await Workbook.findById(contentId).populate('user');
        if (workbook && workbook.user) {
          if (workbook.user.role === 'client') {
            clientId = workbook.user.userId;
            clientName = workbook.user.businessName || workbook.user.name;
          } else {
            clientName = workbook.user.name;
            clientId = workbook.user._id.toString();
          }
        }
        break;

      case 'chapter':
        const chapter = await Chapter.findById(contentId);
        if (chapter) {
          if (chapter.parentType === 'book' && chapter.book) {
            const parentBook = await Book.findById(chapter.book);
            if (parentBook && parentBook.clientId) {
              clientId = parentBook.clientId;
              clientName = await getClientName(parentBook.clientId);
            }
          } else if (chapter.parentType === 'workbook' && chapter.workbook) {
            const parentWorkbook = await Workbook.findById(chapter.workbook).populate('user');
            if (parentWorkbook && parentWorkbook.user) {
              if (parentWorkbook.user.role === 'client') {
                clientId = parentWorkbook.user.userId;
                clientName = parentWorkbook.user.businessName || parentWorkbook.user.name;
              } else {
                clientName = parentWorkbook.user.name;
                clientId = parentWorkbook.user._id.toString();
              }
            }
          }
        }
        break;

      case 'topic':
        const topic = await Topic.findById(contentId).populate('chapter');
        if (topic && topic.chapter) {
          const topicChapter = topic.chapter;
          if (topicChapter.parentType === 'book' && topicChapter.book) {
            const parentBook = await Book.findById(topicChapter.book);
            if (parentBook && parentBook.clientId) {
              clientId = parentBook.clientId;
              clientName = await getClientName(parentBook.clientId);
            }
          } else if (topicChapter.parentType === 'workbook' && topicChapter.workbook) {
            const parentWorkbook = await Workbook.findById(topicChapter.workbook).populate('user');
            if (parentWorkbook && parentWorkbook.user) {
              if (parentWorkbook.user.role === 'client') {
                clientId = parentWorkbook.user.userId;
                clientName = parentWorkbook.user.businessName || parentWorkbook.user.name;
              } else {
                clientName = parentWorkbook.user.name;
                clientId = parentWorkbook.user._id.toString();
              }
            }
          }
        }
        break;

      case 'subtopic':
        const subtopic = await SubTopic.findById(contentId).populate({
          path: 'topic',
          populate: {
            path: 'chapter'
          }
        });
        if (subtopic && subtopic.topic && subtopic.topic.chapter) {
          const subtopicChapter = subtopic.topic.chapter;
          if (subtopicChapter.parentType === 'book' && subtopicChapter.book) {
            const parentBook = await Book.findById(subtopicChapter.book);
            if (parentBook && parentBook.clientId) {
              clientId = parentBook.clientId;
              clientName = await getClientName(parentBook.clientId);
            }
          } else if (subtopicChapter.parentType === 'workbook' && subtopicChapter.workbook) {
            const parentWorkbook = await Workbook.findById(subtopicChapter.workbook).populate('user');
            if (parentWorkbook && parentWorkbook.user) {
              if (parentWorkbook.user.role === 'client') {
                clientId = parentWorkbook.user.userId;
                clientName = parentWorkbook.user.businessName || parentWorkbook.user.name;
              } else {
                clientName = parentWorkbook.user.name;
                clientId = parentWorkbook.user._id.toString();
              }
            }
          }
        }
        break;

      default:
        console.warn(`Unsupported content type: ${contentType}`);
        return null;
    }

    if (!clientName) {
      return null;
    }

    return {
      clientId: clientId,
      clientName: clientName
    };
  } catch (error) {
    console.error(`Error fetching client info from ${contentType}:`, error);
    return null;
  }
}

// ==================== QR CODE GENERATION ROUTES ====================

// Generate QR code for a single question (URL with client name)
router.get('/questions/:questionId/qrcode', 
  validateQuestionId,
  validateQROptions,
  async (req, res) => {
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
      const { size = 300, clientId } = req.query;

      // Verify question exists
      const question = await Question.findById(questionId);
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

      // Get client information
      let clientInfo = null;
      if (clientId) {
        const clientName = await getClientName(clientId);
        clientInfo = { clientId, clientName };
      } else {
        clientInfo = await getClientInfoFromQuestion(questionId);
      }

      if (!clientInfo || !clientInfo.clientName) {
        return res.status(404).json({
          success: false,
          message: "Client information not found",
          error: {
            code: "CLIENT_NOT_FOUND",
            details: "Unable to determine client information for this question"
          }
        });
      }

      // Generate frontend URL with client name and question ID
      const frontendBaseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.trim() : 'https://ailisher-frontend.vercel.app';
      const encodedClientName = encodeURIComponent(clientInfo.clientName);
      const qrUrl = `${frontendBaseUrl}/question/${questionId}?client=${encodedClientName}&clientId=${clientInfo.clientId}`;

      // QR code options for better scanning
      const qrCodeOptions = {
        width: parseInt(size),
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'H' // High error correction for better scanning
      };

      const qrCodeDataURL = await QRCode.toDataURL(qrUrl, qrCodeOptions);

      res.status(200).json({
        success: true,
        data: {
          questionId: question._id.toString(),
          clientId: clientInfo.clientId,
          clientName: clientInfo.clientName,
          qrCode: qrCodeDataURL,
          url: qrUrl,
          size: parseInt(size),
          metadata: {
            questionPreview: question.question.substring(0, 100) + '...',
            difficultyLevel: question.metadata.difficultyLevel,
            maximumMarks: question.metadata.maximumMarks,
            languageMode: question.languageMode
          }
        }
      });

    } catch (error) {
      console.error('Generate question QR code error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  }
);

// Generate QR code for a question set (URL with client name)
router.get('/sets/:setId/qrcode',
  validateSetId,
  validateQROptions,
  async (req, res) => {
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

      const { setId } = req.params;
      const { size = 300, clientId } = req.query;

      // Verify set exists
      const set = await AISWBSet.findById(setId).populate('questions');
      if (!set) {
        return res.status(404).json({
          success: false,
          message: "Set not found",
          error: {
            code: "SET_NOT_FOUND",
            details: "The specified set does not exist"
          }
        });
      }

      // Get client information
      let clientInfo = null;
      if (clientId) {
        const clientName = await getClientName(clientId);
        clientInfo = { clientId, clientName };
      } else {
        clientInfo = await getClientInfoFromSet(setId);
      }

      if (!clientInfo || !clientInfo.clientName) {
        return res.status(404).json({
          success: false,
          message: "Client information not found",
          error: {
            code: "CLIENT_NOT_FOUND",
            details: "Unable to determine client information for this set"
          }
        });
      }

      // Generate frontend URL with client name and set ID
      const frontendBaseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.trim() : 'https://ailisher-frontend.vercel.app';
      const encodedClientName = encodeURIComponent(clientInfo.clientName);
      const qrUrl = `${frontendBaseUrl}/set/${setId}?client=${encodedClientName}&clientId=${clientInfo.clientId}`;

      const qrCodeOptions = {
        width: parseInt(size),
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'H'
      };

      const qrCodeDataURL = await QRCode.toDataURL(qrUrl, qrCodeOptions);

      res.status(200).json({
        success: true,
        data: {
          setId: set._id.toString(),
          setName: set.name,
          clientId: clientInfo.clientId,
          clientName: clientInfo.clientName,
          qrCode: qrCodeDataURL,
          url: qrUrl,
          size: parseInt(size),
          metadata: {
            itemType: set.itemType,
            isWorkbook: set.isWorkbook,
            totalQuestions: set.questions.length,
            difficultyBreakdown: set.questions.reduce((acc, q) => {
              acc[q.metadata.difficultyLevel] = (acc[q.metadata.difficultyLevel] || 0) + 1;
              return acc;
            }, {})
          }
        }
      });

    } catch (error) {
      console.error('Generate set QR code error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  }
);

// NEW: Generate QR code for any content type (book, workbook, chapter, topic, subtopic)
router.get('/content/:contentType/:contentId/qrcode',
  [
    param('contentType')
      .isIn(['book', 'workbook', 'chapter', 'topic', 'subtopic'])
      .withMessage('Content type must be one of: book, workbook, chapter, topic, subtopic'),
    param('contentId')
      .isMongoId()
      .withMessage('Content ID must be a valid MongoDB ObjectId')
  ],
  validateQROptions,
  async (req, res) => {
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

      const { contentType, contentId } = req.params;
      const { size = 300, clientId } = req.query;

      // Get client information
      let clientInfo = null;
      if (clientId) {
        const clientName = await getClientName(clientId);
        clientInfo = { clientId, clientName };
      } else {
        clientInfo = await getClientInfoFromContent(contentType, contentId);
      }

      if (!clientInfo || !clientInfo.clientName) {
        return res.status(404).json({
          success: false,
          message: "Client information not found",
          error: {
            code: "CLIENT_NOT_FOUND",
            details: `Unable to determine client information for this ${contentType}`
          }
        });
      }

      // Generate frontend URL with client name and content info
      const frontendBaseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.trim() : 'https://ailisher-frontend.vercel.app';
      const encodedClientName = encodeURIComponent(clientInfo.clientName);
      const qrUrl = `${frontendBaseUrl}/${contentType}/${contentId}?client=${encodedClientName}&clientId=${clientInfo.clientId}`;

      const qrCodeOptions = {
        width: parseInt(size),
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'H'
      };

      const qrCodeDataURL = await QRCode.toDataURL(qrUrl, qrCodeOptions);

      // Get content details for metadata
      let contentDetails = {};
      try {
        let content;
        switch (contentType.toLowerCase()) {
          case 'book':
            content = await Book.findById(contentId);
            if (content) {
              contentDetails = {
                title: content.title,
                author: content.author,
                mainCategory: content.mainCategory,
                subCategory: content.subCategory
              };
            }
            break;
          case 'workbook':
            content = await Workbook.findById(contentId);
            if (content) {
              contentDetails = {
                title: content.title,
                description: content.description
              };
            }
            break;
          case 'chapter':
            content = await Chapter.findById(contentId);
            if (content) {
              contentDetails = {
                title: content.title,
                description: content.description,
                parentType: content.parentType
              };
            }
            break;
          case 'topic':
            content = await Topic.findById(contentId);
            if (content) {
              contentDetails = {
                title: content.title,
                description: content.description
              };
            }
            break;
          case 'subtopic':
            content = await SubTopic.findById(contentId);
            if (content) {
              contentDetails = {
                title: content.title,
                description: content.description
              };
            }
            break;
        }
      } catch (detailError) {
        console.warn(`Could not fetch details for ${contentType}:`, detailError);
      }

      res.status(200).json({
        success: true,
        data: {
          contentType: contentType,
          contentId: contentId,
          clientId: clientInfo.clientId,
          clientName: clientInfo.clientName,
          qrCode: qrCodeDataURL,
          url: qrUrl,
          size: parseInt(size),
          metadata: contentDetails
        }
      });

    } catch (error) {
      console.error(`Generate ${req.params.contentType} QR code error:`, error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  }
);

// Generate batch QR codes for multiple questions (URLs with client names)
router.post('/questions/batch/qrcode',
  validateQROptions,
  async (req, res) => {
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

      const { questionIds } = req.body;
      const { size = 300, clientId } = req.query;

      if (!questionIds || !Array.isArray(questionIds) || questionIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Question IDs array is required",
          error: {
            code: "INVALID_INPUT",
            details: "questionIds must be a non-empty array"
          }
        });
      }

      // Find all questions
      const questions = await Question.find({ _id: { $in: questionIds } });
      
      if (questions.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No questions found",
          error: {
            code: "QUESTIONS_NOT_FOUND",
            details: "None of the specified questions exist"
          }
        });
      }

      const frontendBaseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.trim() : 'https://ailisher-frontend.vercel.app';
      const qrCodes = [];

      const qrCodeOptions = {
        width: parseInt(size),
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'H'
      };

      // Generate QR code for each question
      for (const question of questions) {
        try {
          // Get client information for this question
          let clientInfo = null;
          if (clientId) {
            const clientName = await getClientName(clientId);
            clientInfo = { clientId, clientName };
          } else {
            clientInfo = await getClientInfoFromQuestion(question._id);
          }

          if (!clientInfo || !clientInfo.clientName) {
            qrCodes.push({
              questionId: question._id.toString(),
              questionPreview: question.question.substring(0, 100) + '...',
              error: 'Client information not found'
            });
            continue;
          }

          const encodedClientName = encodeURIComponent(clientInfo.clientName);
          const qrUrl = `${frontendBaseUrl}/question/${question._id}?client=${encodedClientName}&clientId=${clientInfo.clientId}`;

          const qrCodeDataURL = await QRCode.toDataURL(qrUrl, qrCodeOptions);

          qrCodes.push({
            questionId: question._id.toString(),
            questionPreview: question.question.substring(0, 100) + '...',
            clientId: clientInfo.clientId,
            clientName: clientInfo.clientName,
            qrCode: qrCodeDataURL,
            url: qrUrl,
            metadata: {
              difficultyLevel: question.metadata.difficultyLevel,
              maximumMarks: question.metadata.maximumMarks,
              languageMode: question.languageMode
            }
          });
        } catch (qrError) {
          console.error(`QR generation failed for question ${question._id}:`, qrError);
          qrCodes.push({
            questionId: question._id.toString(),
            questionPreview: question.question.substring(0, 100) + '...',
            error: 'QR generation failed'
          });
        }
      }

      res.status(200).json({
        success: true,
        data: {
          totalRequested: questionIds.length,
          totalGenerated: qrCodes.filter(qr => qr.qrCode).length,
          size: parseInt(size),
          qrCodes
        }
      });

    } catch (error) {
      console.error('Generate batch QR codes error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  }
);

// ==================== DATA RETRIEVAL ROUTES ====================

// Get single question data (for QR code scanning) - now includes client info in response
router.get('/questions/:questionId/view', 
  validateQuestionId,
  async (req, res) => {
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
      const { includeAnswers = 'false' } = req.query;

      const question = await Question.findById(questionId);
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

      // Get client information
      const clientInfo = await getClientInfoFromQuestion(questionId);

      const responseData = {
        id: question._id.toString(),
        question: question.question,
        modalAnswer: question.modalAnswer,
        answerVideoUrls: question.answerVideoUrls,
        metadata: {
          keywords: question.metadata.keywords,
          difficultyLevel: question.metadata.difficultyLevel,
          wordLimit: question.metadata.wordLimit,
          estimatedTime: question.metadata.estimatedTime,
          maximumMarks: question.metadata.maximumMarks,
          qualityParameters: question.metadata.qualityParameters
        },
        languageMode: question.languageMode,
        evaluationMode: question.evaluationMode,
        setId: question.setId,
        // Include client information
        clientInfo: clientInfo
      };

      // Include detailed answer only if requested
      if (includeAnswers === 'true') {
        responseData.detailedAnswer = question.detailedAnswer;
      }

      res.status(200).json({
        success: true,
        data: responseData
      });

    } catch (error) {
      console.error('Get question view error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  }
);

// Get question set data (for QR code scanning) - now includes client info in response
router.get('/sets/:setId/view',
  validateSetId,
  async (req, res) => {
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

      const { setId } = req.params;
      const { includeAnswers = 'false', page = 1, limit = 10 } = req.query;

      const set = await AISWBSet.findById(setId);
      if (!set) {
        return res.status(404).json({
          success: false,
          message: "Set not found",
          error: {
            code: "SET_NOT_FOUND",
            details: "The specified set does not exist"
          }
        });
      }

      // Get client information
      const clientInfo = await getClientInfoFromSet(setId);

      // Pagination for questions
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const questions = await Question.find({ setId: setId })
        .select(includeAnswers === 'true' ? '' : '-detailedAnswer')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: 1 });

      const totalQuestions = await Question.countDocuments({ setId: setId });

      const responseData = {
        set: {
          id: set._id.toString(),
          name: set.name,
          itemType: set.itemType,
          itemId: set.itemId.toString(),
          isWorkbook: set.isWorkbook,
          totalQuestions: totalQuestions
        },
        // Include client information
        clientInfo: clientInfo,
        questions: questions.map(q => ({
          id: q._id.toString(),
          question: q.question,
          ...(includeAnswers === 'true' && { detailedAnswer: q.detailedAnswer }),
          modalAnswer: q.modalAnswer,
          answerVideoUrls: q.answerVideoUrls,
          metadata: q.metadata,
          languageMode: q.languageMode,
          evaluationMode: q.evaluationMode
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalQuestions / parseInt(limit)),
          totalQuestions: totalQuestions,
          questionsPerPage: parseInt(limit),
          hasNextPage: skip + questions.length < totalQuestions,
          hasPrevPage: parseInt(page) > 1
        }
      };

      res.status(200).json({
        success: true,
        data: responseData
      });

    } catch (error) {
      console.error('Get set view error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  }
);

// Get multiple questions data (for batch QR scanning) - now includes client info
router.post('/questions/batch/view',
  async (req, res) => {
    try {
      const { questionIds } = req.body;
      const { includeAnswers = 'false' } = req.query;

      if (!questionIds || !Array.isArray(questionIds) || questionIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Question IDs array is required",
          error: {
            code: "INVALID_INPUT",
            details: "questionIds must be a non-empty array"
          }
        });
      }

      const questions = await Question.find({ _id: { $in: questionIds } })
        .select(includeAnswers === 'true' ? '' : '-detailedAnswer');

      if (questions.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No questions found",
          error: {
            code: "QUESTIONS_NOT_FOUND",
            details: "None of the specified questions exist"
          }
        });
      }

      const responseData = [];
      
      // Get client info for each question
      for (const q of questions) {
        const clientInfo = await getClientInfoFromQuestion(q._id);
        
        responseData.push({
          id: q._id.toString(),
          question: q.question,
          ...(includeAnswers === 'true' && { detailedAnswer: q.detailedAnswer }),
          modalAnswer: q.modalAnswer,
          answerVideoUrls: q.answerVideoUrls,
          metadata: q.metadata,
          languageMode: q.languageMode,
          evaluationMode: q.evaluationMode,
          setId: q.setId,
          clientInfo: clientInfo
        });
      }

      res.status(200).json({
        success: true,
        data: {
          totalRequested: questionIds.length,
          totalFound: questions.length,
          questions: responseData
        }
      });

    } catch (error) {
      console.error('Get batch questions view error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  }
);

module.exports = router;
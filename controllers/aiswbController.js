const Question = require('../models/AiswbQuestion');
const AISWBSet = require('../models/AISWBSet');
const { validationResult } = require('express-validator');
const UserAnswer = require('../models/UserAnswer');
const UserProfile = require('../models/UserProfile');
const { getEvaluationFrameworkText } = require('../services/aiServices');
const { generatePresignedUrl, generateGetPresignedUrl, deleteObject } = require('../utils/s3');

// Question Controllers
const addQuestion = async (req, res) => {
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

    const questionData = req.body.question;
    const setId = req.body.setId;

    // Validate set exists if setId provided
    if (setId) {
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
    }

    // Set default evaluation guideline if not provided
    if (!questionData.evaluationGuideline || questionData.evaluationGuideline.trim() === '') {
      questionData.evaluationGuideline = getEvaluationFrameworkText();
    }

    const question = new Question({
      ...questionData,
      setId: setId || null
    });

    await question.save();

    // If setId provided, add question to set
    if (setId) {
      await AISWBSet.findByIdAndUpdate(
        setId,
        { $push: { questions: question._id } }
      );
    }

    res.status(200).json({
      success: true,
      message: "Question added successfully",
      data: {
        id: question._id.toString(),
        question: question.question,
        detailedAnswer: question.detailedAnswer,
        modalAnswer: question.modalAnswer,
        answerVideoUrls: question.answerVideoUrls || [], // Updated to handle array
        metadata: question.metadata,
        languageMode: question.languageMode,
        evaluationMode: question.evaluationMode,
        evaluationType: question.evaluationType,
        evaluationGuideline: question.evaluationGuideline,
        createdAt: question.createdAt.toISOString(),
        updatedAt: question.updatedAt.toISOString()
      }
    });

  } catch (error) {
    console.error('Add question error:', error);
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

    const questionId = req.params.questionId;
    const questionData = req.body.question;

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

    // Set default evaluation guideline if not provided
    if (!questionData.evaluationGuideline || questionData.evaluationGuideline.trim() === '') {
      questionData.evaluationGuideline = getEvaluationFrameworkText();
    }

    // Update question fields
    Object.assign(question, questionData);
    await question.save();

    res.status(200).json({
      success: true,
      message: "Question updated successfully",
      data: {
        id: question._id.toString(),
        question: question.question,
        detailedAnswer: question.detailedAnswer,
        modalAnswer: question.modalAnswer,
        answerVideoUrls: question.answerVideoUrls || [], // Updated to handle array
        metadata: question.metadata,
        languageMode: question.languageMode,
        evaluationMode: question.evaluationMode,
        evaluationType: question.evaluationType,
        evaluationGuideline: question.evaluationGuideline,
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

const deleteQuestion = async (req, res) => {
  try {
    const questionId = req.params.questionId;

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

    // Remove question from any sets
    await AISWBSet.updateMany(
      { questions: questionId },
      { $pull: { questions: questionId } }
    );

    await Question.findByIdAndDelete(questionId);

    
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

const getQuestionDetails = async (req, res) => {
  try {
    const questionId = req.params.questionId;

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

    // Build presigned URLs for any modal answer PDFs
    let modalAnswerPdfs = [];
    if (Array.isArray(question.modalAnswerPdfKey) && question.modalAnswerPdfKey.length > 0) {
      modalAnswerPdfs = await Promise.all(
        question.modalAnswerPdfKey.map(async (key) => {
          try {
            const url = await generateGetPresignedUrl(key);
            return { key, url, fileName: key.split('/').pop() };
          } catch {
            return { key, url: null, fileName: key.split('/').pop() };
          }
        })
      );
    }

    res.status(200).json({
      success: true,
      data: {
        id: question._id.toString(),
        question: question.question,
        detailedAnswer: question.detailedAnswer,
        modalAnswer: question.modalAnswer,
        modalAnswerPdfs,
        answerVideoUrls: question.answerVideoUrls || [], // Updated to handle array
        metadata: question.metadata,
        languageMode: question.languageMode,
        evaluationMode: question.evaluationMode,
        evaluationType: question.evaluationType,
        evaluationGuideline: question.evaluationGuideline,
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

// Set Controllers
const getAISWBSets = async (req, res) => {
  try {
    const { itemType, itemId } = req.params;
    const isWorkbook = req.query.isWorkbook === 'true';

    const sets = await AISWBSet.find({
      itemType,
      itemId,
      isWorkbook
    });

    res.status(200).json({
      success: true,
      sets: sets.map(set => ({
        id: set._id.toString(),
        name: set.name,
        questions: set.questions,
        startsAt:set.startsAt,
        endsAt:set.endsAt,
        isEnabled:set.isEnabled
      }))
    });

  } catch (error) {
    console.error('Get AISWB sets error:', error);
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

const createAISWBSet = async (req, res) => {
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

    const { itemType, itemId } = req.params;
    const isWorkbook = req.query.isWorkbook === 'true';
    const { name,startsAt,endsAt } = req.body;

    const newSet = new AISWBSet({
      name,
      itemType,
      itemId,
      isWorkbook,
      questions: [],
      startsAt,
      endsAt
    });

    await newSet.save();

    res.status(200).json({
      success: true,
      set: {
        id: newSet._id.toString(),
        name: newSet.name,
        questions: []
      }
    });

  } catch (error) {
    console.error('Create AISWB set error:', error);
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

const updateAISWBSet = async (req, res) => {
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
    const { name,startsAt,endsAt } = req.body;

    console.log(req.body)
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

    set.name = name;
    set.startsAt = startsAt,
    set.endsAt = endsAt
    await set.save();
    console.log(set)
    res.status(200).json({
      success: true,
      set: {
        id: set._id.toString(),
        name: set.name,
        questions: set.questions
      }
    });

  } catch (error) {
    console.error('Update AISWB set error:', error);
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

const deleteAISWBSet = async (req, res) => {
  try {
    const { setId } = req.params;

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

    // Delete all questions in the set
    await Question.deleteMany({ _id: { $in: set.questions } });

    // Delete the set
    await AISWBSet.findByIdAndDelete(setId);

    res.status(200).json({
      success: true,
      message: "Set deleted successfully"
    });

  } catch (error) {
    console.error('Delete AISWB set error:', error);
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

const toggleIsEnabled = async (req,res) => {
  try {
    const {id} = req.params;
    const {isEnabled} = req.body || {};

    if(!id)
    {
      return res.status(400).json({
        success:true,
        message:"set id is required",
      })
    }

    const set = await AISWBSet.findById(id)
    if(!set)
    {
      return res.status(404).json({success:false,message:"Set not found"})
    }

    const newValue = typeof isEnabled === 'boolean'? isEnabled : !set.isEnabled;
    set.isEnabled = newValue;

    await set.save();

    return res.status(200).json({
      success:true,
      message:"set isEnabled updated"
    })
  } 
  catch (error) {
    console.error('Toggle isEnabled error:',error);
    return res.status(500).json({success:false,message:"Failed to update isEnabled", error:error.message});
  }
};

const getQuestionsInSet = async (req, res) => {
  try {
    const { setId } = req.params;

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

    const questions = set.questions.map(question => ({
      id: question._id.toString(),
      question: question.question,
      detailedAnswer: question.detailedAnswer,
      answerVideoUrls: question.answerVideoUrls || [], // Updated to handle array
      metadata: {
        ...question.metadata.toObject(),
        qualityParameters: {
          ...question.metadata.qualityParameters.toObject(),
          customQualityParameters: question.metadata.qualityParameters.customParams.map(param => ({
            name: param
          }))
        }
      },
      languageMode: question.languageMode,
      evaluationMode: question.evaluationMode,
      evaluationType: question.evaluationType,
      evaluationGuideline: question.evaluationGuideline,
      modalAnswerPdfKey: Array.isArray(question.modalAnswerPdfKey) ? question.modalAnswerPdfKey : []
    }));

    res.status(200).json({
      success: true,
      questions
    });

  } catch (error) {
    console.error('Get questions in set error:', error);
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

const addQuestionToSet = async (req, res) => {
  try {
    console.log('Request body received in addQuestionToSet:', req.body);
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
    const questionData = req.body;

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

    // Transform customQualityParameters to customParams
    if (questionData.metadata && questionData.metadata.qualityParameters && questionData.metadata.qualityParameters.customQualityParameters) {
      questionData.metadata.qualityParameters.customParams = questionData.metadata.qualityParameters.customQualityParameters.map(param => param.name);
      delete questionData.metadata.qualityParameters.customQualityParameters;
    }

    // Set default evaluation guideline if not provided
    if (!questionData.evaluationGuideline || questionData.evaluationGuideline.trim() === '') {
      questionData.evaluationGuideline = getEvaluationFrameworkText();
    }

    const question = new Question({
      ...questionData,
      setId
    });

    await question.save();
    console.log('Saved question in DB:', question);

    // Add question to set
    set.questions.push(question._id);
    await set.save();

    res.status(200).json({
      success: true,
      question: {
        id: question._id.toString(),
        question: question.question,
        detailedAnswer: question.detailedAnswer,
        answerVideoUrls: question.answerVideoUrls || [], // Updated to handle array
        metadata: {
          ...question.metadata.toObject(),
          qualityParameters: {
            ...question.metadata.qualityParameters.toObject(),
            customQualityParameters: question.metadata.qualityParameters.customParams.map(param => ({
              name: param
            }))
          }
        },
        languageMode: question.languageMode,
        evaluationMode: question.evaluationMode,
        evaluationType: question.evaluationType,
        evaluationGuideline: question.evaluationGuideline
      }
    });

  } catch (error) {
    console.error('Add question to set error:', error);
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

const deleteQuestionFromSet = async (req, res) => {
  try {
    const { setId, questionId } = req.params;

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

    // Remove question from set
    set.questions = set.questions.filter(id => id.toString() !== questionId);
    await set.save();

    // Delete the question
    await Question.findByIdAndDelete(questionId);

    res.status(200).json({
      success: true,
      message: "Question deleted successfully"
    });

  } catch (error) {
    console.error('Delete question from set error:', error);
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

const getQuestionSubmissions = async (req, res) => {
  try {
    const { questionId } = req.params;
    const {
      page = 1,
      limit = 10,
      status = 'all',
      sortBy = 'submittedAt',
      sortOrder = 'desc'
    } = req.query;

    // Validate questionId
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

    // Build query filters
    const matchQuery = { questionId };
    
    // Filter by evaluation status if specified
    if (status !== 'all') {
      if (status === 'published') {
        matchQuery['feedback.status'] = 'published';
      } else if (status === 'not_published') {
        matchQuery['feedback.status'] = { $ne: 'published' };
      }
    }

    // Build sort object
    const sortObject = {};
    if (sortBy === 'marks') {
      sortObject['feedback.score'] = sortOrder === 'asc' ? 1 : -1;
    } else if (sortBy === 'accuracy') {
      sortObject['feedback.accuracy'] = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortObject['submittedAt'] = sortOrder === 'asc' ? 1 : -1;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    // Get total count
    const totalSubmissions = await UserAnswer.countDocuments(matchQuery);

    // Get submissions with populated user data
    const submissions = await UserAnswer.find(matchQuery)
      .populate('userId') // Only populate the MobileUser
      .sort(sortObject)
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get user profiles separately
    const userIds = submissions.map(s => s.userId?._id).filter(Boolean);
    const userProfiles = await UserProfile.find({
      userId: { $in: userIds }
    }).lean();

    // Create a map of userId to profile for quick lookup
    const profileMap = userProfiles.reduce((map, profile) => {
      map[profile.userId.toString()] = profile;
      return map;
    }, {});

    // Transform submissions data
    const transformedSubmissions = submissions.map(submission => {
      const mobileUser = submission.userId || {};
      const userProfile = profileMap[mobileUser._id?.toString()] || {};
      
      return {
        submissionId: submission._id.toString(),
        userId: mobileUser._id?.toString() || '',
        userDetails: {
          name: userProfile.name || 'Anonymous User',
          email: mobileUser.mobile || 'N/A', // Using mobile as email equivalent
          profileImage: null, // Not implemented in current schema
          role: 'student' // Default role
        },
        images: submission.answerImages.map(img => ({
          imageId: img._id?.toString() || '',
          imageUrl: img.imageUrl,
          uploadedAt: img.uploadedAt,
          imageType: 'answer',
          imageSize: 0, // Not stored in current schema
          imageFormat: img.imageUrl?.split('.').pop()?.toLowerCase() || 'jpg'
        })),
        evaluation: {
          evaluationId: submission._id.toString(),
          evaluationMode: submission.reviewedBy ? 'manual' : 'auto',
          marks: submission.feedback?.score || 0,
          accuracy: submission.feedback?.accuracy || 0,
          status: submission.feedback?.status || 'not_published',
          evaluatedAt: submission.reviewedAt || submission.updatedAt,
          evaluatedBy: submission.reviewedBy?.toString() || 'system'
        },
        submittedAt: submission.submittedAt,
        updatedAt: submission.updatedAt
      };
    });

    // Calculate pagination info
    const totalPages = Math.ceil(totalSubmissions / limitNum);

    res.status(200).json({
      success: true,
      data: {
        submissions: transformedSubmissions,
        pagination: {
          total: totalSubmissions,
          page: parseInt(page),
          limit: limitNum,
          totalPages
        },
        questionDetails: {
          questionId: question._id.toString(),
          title: question.question,
          description: question.detailedAnswer,
          answerVideoUrls: question.answerVideoUrls || [], // Updated to handle array
          metadata: {
            maximumMarks: question.metadata.maximumMarks,
            qualityParameters: question.metadata.qualityParameters
          }
        }
      }
    });

  } catch (error) {
    console.error('Get question submissions error:', error);
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

const getDefaultEvaluationFramework = async (req, res) => {
  try {
    const defaultFramework = `Introduction
Relevant introduction, as defined, about 
Relevant Introduction Supported by Data like
Your introduction is well presented with factual information 
Your introduction is valid but concise it and mention some keywords like
Your introduction is general, you may start introduction like
Your introduction can be enriched by adding keywords like
Your introduction is relevant but too long — it needs to be concise, within 20–30 words.

Body:
Frame the heading to reflect the core demand of the question, such as:
Well-Formatted Main Heading in a Box
Write Main Heading in a Box
You missed a part of demand of question ---

Rough-Paragraph-Not effective
Your presentation is rough; avoid paragraph format. However, some of your content lines are relevant.
Your points are not very effective; please present them in a more structured and impactful manner.
Relevant-Valid
Your points are relevant, but they need to be substantiated with examples to strengthen your argument.
Valid point with substantiation
Your points are valid as per the implicit demand of the question but add some points like
Your points are valid as per the explicit demand of the question but add some points like
Your points are valid and substantiated with evidence.
Your points are valid and supported by relevant examples.

Heading-Core Demand
Try to use heading and subheadings for better presentation
Try to understand core demand of question
Points are valid but use sub-headings for better presentation
Try to use sub-headings for better presentation 

Your points can be enriched by elaborate properly like 
Underline specific keywords for better presentation like
You should work on presentation
Your points can be enriched by adding examples or substantiate them like 
Enrich your points by adding examples or substantiate
Your points are less effective and can be enriched in effective manner like 

Good use of diagram and relevant content
Good use of map but the map can be drawn better.
Lack of legibility-Please work on it.
Your points are valid but need supporting data, facts, and reports.

Conclusion
Your conclusion is based on balanced answer
Relevant conclusion, as it reflects a futuristic vision
Your conclusion is relevant as it outlines in suggestive manner

Less effective conclusion- you may conclude in effective manner like
Relevant conclusion but you may add—
Relevant conclusion but you may conclude in effective manner like 
Your conclusion is relevant as it outlines steps---but it may be concluded as—
Your conclusion is relevant but too long — it needs to be concise, within 20–30 words.`;

    res.status(200).json({
      success: true,
      data: {
        defaultFramework
      }
    });

  } catch (error) {
    console.error('Get default evaluation framework error:', error);
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

// Generate a presigned S3 URL for uploading a PDF for a question
const generatePdfUploadUrl = async (req, res) => {
  try {
    console.log(req.user);
    const { questionId } = req.params;
    const { fileName, contentType } = req.body || {};

    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'fileName is required',
        error: { code: 'INVALID_INPUT', details: 'fileName must be a string' }
      });
    }

    const finalContentType = contentType || 'application/pdf';
    if (finalContentType !== 'application/pdf') {
      return res.status(400).json({
        success: false,
        message: 'Only application/pdf contentType is allowed',
        error: { code: 'INVALID_CONTENT_TYPE' }
      });
    }

    // Ensure question exists
    const question = await Question.findById(questionId).select('_id');
    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
        error: { code: 'QUESTION_NOT_FOUND' }
      });
    }

    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const timestamp = Date.now();
    const key = `${req.user.businessName}/aiswb/questions/${questionId}/pdfs/${timestamp}-${sanitizedFileName}`;

    const uploadUrl = await generatePresignedUrl(key, finalContentType);

    return res.status(200).json({
      success: true,
      data: { uploadUrl, key, contentType: finalContentType }
    });
  } catch (error) {
    console.error('Generate PDF upload URL error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: { code: 'SERVER_ERROR', details: error.message }
    });
  }
};

// Attach an uploaded PDF S3 key to the question.modalAnswerPdfKey array
const attachPdfToQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { key } = req.body || {};

    if (!key || typeof key !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'key is required',
        error: { code: 'INVALID_INPUT', details: 'key must be a string' }
      });
    }

    const question = await Question.findById(questionId);
    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
        error: { code: 'QUESTION_NOT_FOUND' }
      });
    }

    if (!Array.isArray(question.modalAnswerPdfKey)) {
      question.modalAnswerPdfKey = [];
    }

    // Prevent duplicates
    if (!question.modalAnswerPdfKey.includes(key)) {
      question.modalAnswerPdfKey.push(key);
    }

    await question.save();

    return res.status(200).json({
      success: true,
      message: 'PDF key attached successfully',
      data: { modalAnswerPdfKey: question.modalAnswerPdfKey }
    });
  } catch (error) {
    console.error('Attach PDF to question error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: { code: 'SERVER_ERROR', details: error.message }
    });
  }
};

// Delete a PDF from question's modalAnswerPdfKey array and from S3
const deletePdfFromQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { key } = req.body || {};

    if (!key || typeof key !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'key is required',
        error: { code: 'INVALID_INPUT', details: 'key must be a string' }
      });
    }

    const question = await Question.findById(questionId);
    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
        error: { code: 'QUESTION_NOT_FOUND' }
      });
    }

    // Check if the PDF key exists in the question
    if (!Array.isArray(question.modalAnswerPdfKey) || !question.modalAnswerPdfKey.includes(key)) {
      return res.status(404).json({
        success: false,
        message: 'PDF not found in question',
        error: { code: 'PDF_NOT_FOUND' }
      });
    }

    // Remove the key from the question's modalAnswerPdfKey array
    question.modalAnswerPdfKey = question.modalAnswerPdfKey.filter(pdfKey => pdfKey !== key);
    await question.save();

    // Delete the file from S3/R2
    try {
      await deleteObject(key)
      console.log(`Successfully deleted PDF from S3: ${key}`);
    } catch (s3Error) {
      console.error('Error deleting PDF from S3:', s3Error);
      // Continue even if S3 deletion fails - the database is already updated
    }

    return res.status(200).json({
      success: true,
      message: 'PDF deleted successfully',
      data: { modalAnswerPdfKey: question.modalAnswerPdfKey }
    });
  } catch (error) {
    console.error('Delete PDF from question error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: { code: 'SERVER_ERROR', details: error.message }
    });
  }
};

module.exports = {
  addQuestion,
  updateQuestion,
  deleteQuestion,
  getQuestionDetails,
  getAISWBSets,
  createAISWBSet,
  updateAISWBSet,
  deleteAISWBSet,
  getQuestionsInSet,
  addQuestionToSet,
  deleteQuestionFromSet,
  getQuestionSubmissions,
  getDefaultEvaluationFramework,
  generatePdfUploadUrl,
  attachPdfToQuestion,
  deletePdfFromQuestion,
  toggleIsEnabled
};
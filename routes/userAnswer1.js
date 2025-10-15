const express = require('express');
const router = express.Router();
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const UserAnswer = require('../models/UserAnswer');
const AiswbQuestion = require('../models/AiswbQuestion');
const AISWBSet = require('../models/AISWBSet');
const { validationResult, param, body, query } = require('express-validator');
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const axios = require('axios');
const SubjectiveTestQuestion = require('../models/SubjectiveTestQuestion');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'user-answers',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
    transformation: [
      { width: 1200, height: 1600, crop: 'limit', quality: 'auto' },
      { flags: 'progressive' }
    ]
  }
});
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only image files and PDFs are allowed'), false);
    }
  }
});
const validateQuestionId = [
  param('questionId')
    .isMongoId()
    .withMessage('Question ID must be a valid MongoDB ObjectId')
];
const validateAnswerSubmission = [
  body('textAnswer')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Text answer must be less than 5000 characters'),
  body('timeSpent')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Time spent must be a positive integer'),
  body('sourceType')
    .optional()
    .isIn(['qr_scan', 'direct_access', 'set_practice'])
    .withMessage('Invalid source type'),
  body('setId')
    .optional()
    .isMongoId()
    .withMessage('Set ID must be a valid MongoDB ObjectId')
];
const extractTextFromImages = async (imageUrls) => {
  const extractedTexts = [];
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured');
  }
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    try {
      let processedImageUrl = imageUrl;
      if (imageUrl.includes('cloudinary.com')) {
        processedImageUrl = imageUrl;
      } else {        
        const imageResponse = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TextExtractor/1.0)'
          }
        });
        if (imageResponse.status !== 200) {
          throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
        }
        const contentType = imageResponse.headers['content-type'];
        if (!contentType || !contentType.startsWith('image/')) {
          throw new Error(`Invalid content type: ${contentType}`);
        }
        const imageBuffer = Buffer.from(imageResponse.data);
        if (imageBuffer.length === 0) {
          throw new Error('Empty image buffer received');
        }
        const base64Image = imageBuffer.toString('base64');
        let imageFormat = 'jpeg';
        if (contentType.includes('png')) imageFormat = 'png';
        else if (contentType.includes('webp')) imageFormat = 'webp';
        else if (contentType.includes('gif')) imageFormat = 'gif';
        processedImageUrl = `data:image/${imageFormat};base64,${base64Image}`;
      }
        const visionResponse = await axios.post(
        OPENAI_API_URL,
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `You are a precise OCR (Optical Character Recognition) system. Your task is to extract ALL text content from this image.

Instructions:
1. Extract ALL visible text exactly as it appears
2. Maintain the original formatting, line breaks, and spacing
3. Include mathematical equations, formulas, and symbols
4. Include any handwritten text if clearly readable
5. Do not add explanations, interpretations, or additional commentary
6. If the text is in multiple languages, extract all of it
7. If there are tables, preserve the table structure
8. If no readable text is found, respond with exactly: "No readable text found"

Return only the extracted text content:`
                },
                {
                  type: "image_url",
                  image_url: {
                    url: processedImageUrl,
                    detail: "high"
                  }
                }
              ]
            }
          ],
          max_tokens: 2000,
          temperature: 0.1
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          timeout: 45000 // Increased timeout
        }
      );      
      if (!visionResponse.data || !visionResponse.data.choices || visionResponse.data.choices.length === 0) {
        throw new Error('Invalid response structure from OpenAI Vision API');
      }
      const choice = visionResponse.data.choices[0];
      if (!choice.message || !choice.message.content) {
        throw new Error('No content in OpenAI Vision API response');
      }
      const extractedText = choice.message.content.trim();
      if (extractedText === "No readable text found" || extractedText.length === 0) {
        console.log(`No text found in image ${i + 1}`);
        extractedTexts.push("No readable text found");
      } else {
        console.log(`Successfully extracted ${extractedText.length} characters from image ${i + 1}`);
        extractedTexts.push(extractedText);
      }
    } catch (error) {
      let errorMessage = "Failed to extract text";
      if (error.message.includes('timeout')) {
        errorMessage = "Text extraction timed out - image may be too large";
      } else if (error.message.includes('API key')) {
        errorMessage = "API authentication failed";
      } else if (error.message.includes('rate limit')) {
        errorMessage = "Rate limit exceeded - please try again later";
      } else if (error.message.includes('content type')) {
        errorMessage = "Invalid image format";
      }
      extractedTexts.push(`${errorMessage}: ${error.message}`);
    }
  }
  return extractedTexts;
};
const extractTextFromImagesGemini = async (imageUrls) => {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key is not configured');
  }
  const extractedTexts = [];
  for (const imageUrl of imageUrls) {
    try {
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      const imageBuffer = Buffer.from(imageResponse.data);
      const base64Image = imageBuffer.toString('base64');
      const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
      const response = await axios.post(
        `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
        {
          contents: [{
            parts: [
              {
                text: "Extract all text content from this image. Return only the text as it appears, maintaining original formatting. If no text is found, respond with 'No readable text found'."
              },
              {
                inline_data: {
                  mime_type: contentType,
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
          }
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );
      const extractedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No readable text found';
      extractedTexts.push(extractedText.trim());
    } catch (error) {
      console.error('Gemini extraction error:', error.message);
      extractedTexts.push(`Failed to extract text: ${error.message}`);
    }
  }
  return extractedTexts;
};
const extractTextFromImagesWithFallback = async (imageUrls) => {
  if (!imageUrls || imageUrls.length === 0) {
    return [];
  }  
  try {
    const results = await extractTextFromImages(imageUrls);
    const failedIndices = [];
    results.forEach((result, index) => {
      if (result.startsWith('Failed to extract text') || result.includes('Error')) {
        failedIndices.push(index);
      }
    });
    if (failedIndices.length > 0 && GEMINI_API_KEY) {
      try {
        const failedUrls = failedIndices.map(i => imageUrls[i]);
        const geminiResults = await extractTextFromImagesGemini(failedUrls);
        failedIndices.forEach((originalIndex, geminiIndex) => {
          if (geminiResults[geminiIndex] && !geminiResults[geminiIndex].startsWith('Failed')) {
            results[originalIndex] = geminiResults[geminiIndex];
            console.log(`Successfully recovered text for image ${originalIndex + 1} using Gemini`);
          }
        });
      } catch (geminiError) {
        console.error('Gemini fallback also failed:', geminiError.message);
      }
    }
    return results;
    
  } catch (openaiError) {
    if (GEMINI_API_KEY) {
      console.log('Falling back to Gemini for all images');
      try {
        return await extractTextFromImagesGemini(imageUrls);
      } catch (geminiError) {
        console.error('Both OpenAI and Gemini failed:', geminiError.message);
      }
    }
    return imageUrls.map((_, index) => 
      `Text extraction failed for image ${index + 1}. Please ensure the image is clear and contains readable text.`
    );
  }
};
const generateEvaluationPrompt = (question, extractedTexts) => {
  const combinedText = extractedTexts.join('\n\n--- Next Image ---\n\n');
  
  // Use the stored evaluation guideline (will always have a value - either custom or default)
  const evaluationFramework = question.evaluationGuideline || `Please provide a detailed evaluation in the following format:

ACCURACY: [Score out of 100]
MARKS AWARDED: [Marks out of ${question.metadata?.maximumMarks || 10}]

STRENGTHS:
- [List 2-3 specific strengths]

WEAKNESSES:
- [List 2-3 areas for improvement]

SUGGESTIONS:
- [List 2-3 specific recommendations]

DETAILED FEEDBACK:
[Provide constructive feedback about the answer]

Please be fair, constructive, and specific in your evaluation.`;
  
  return `Please evaluate this student's answer to the given question.

QUESTION:
${question.question}

MAXIMUM MARKS: ${question.metadata?.maximumMarks || 10}

STUDENT'S ANSWER (extracted from images):
${combinedText}

${evaluationFramework}`;
};
const parseEvaluationResponse = (evaluationText, question) => {
  try {
    const lines = evaluationText.split('\n');
    const evaluation = {
      accuracy: 75,
      marks: Math.floor((question.metadata?.maximumMarks || 10) * 0.75),
      strengths: [],
      weaknesses: [],
      suggestions: [],
      feedback: ''
    };
    let currentSection = '';
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('ACCURACY:')) {
        const match = trimmedLine.match(/(\d+)/);
        if (match) evaluation.accuracy = parseInt(match[1]);
      } else if (trimmedLine.startsWith('MARKS AWARDED:')) {
        const match = trimmedLine.match(/(\d+)/);
        if (match) evaluation.marks = parseInt(match[1]);
      } else if (trimmedLine === 'STRENGTHS:') {
        currentSection = 'strengths';
      } else if (trimmedLine === 'WEAKNESSES:') {
        currentSection = 'weaknesses';
      } else if (trimmedLine === 'SUGGESTIONS:') {
        currentSection = 'suggestions';
      } else if (trimmedLine === 'DETAILED FEEDBACK:') {
        currentSection = 'feedback';
      } else if (trimmedLine.startsWith('- ') && currentSection) {
        const content = trimmedLine.substring(2);
        if (currentSection !== 'feedback') {
          evaluation[currentSection].push(content);
        }
      } else if (currentSection === 'feedback' && trimmedLine) {
        evaluation.feedback += (evaluation.feedback ? ' ' : '') + trimmedLine;
      }
    }
    return evaluation;
  } catch (error) {
    console.error('Error parsing evaluation:', error);
    return generateMockEvaluation(question);
  }
};
const generateMockEvaluation = (question) => {
  return {
    accuracy: Math.floor(Math.random() * 30) + 60, // 60-90%
    extractedText: "The answer demonstrates a good understanding of the topic with clear explanations and relevant examples. The content is well-structured and addresses the main points of the question.",
    strengths: [
      'Shows understanding of core concepts',
      'Attempts to address the question requirements'
    ],
    weaknesses: [
      'Could provide more detailed explanations',
      'Some concepts could be explained more clearly'
    ],
    suggestions: [
      'Include more specific examples',
      'Structure your answer with clear sections'
    ],
    marks: Math.floor(Math.random() * (question.metadata.maximumMarks / 2)) + 
           Math.floor(question.metadata.maximumMarks / 2),
    feedback: 'The answer shows understanding of the topic but could be improved with more detailed explanations and examples.'
  };
};

router.post('/questions/:questionId/answers/:answerId/re-evaluate',
    authenticateMobileUser,
    [
      ...validateQuestionId,
      param('answerId')
        .isMongoId()
        .withMessage('Answer ID must be a valid MongoDB ObjectId')
    ],
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
        const { questionId, answerId } = req.params;
        const userId = req.user.id;
        const userAnswer = await UserAnswer.findOne({
          _id: answerId,
          userId: userId,
          questionId: questionId
        }).populate('questionId', 'question metadata');
        if (!userAnswer) {
          return res.status(404).json({
            success: false,
            message: "Answer not found",
            error: {
              code: "ANSWER_NOT_FOUND",
              details: "The specified answer does not exist or you don't have permission to access it"
            }
          });
        }
        if ((!userAnswer.answerImages || userAnswer.answerImages.length === 0) && 
            (!userAnswer.extractedTexts || userAnswer.extractedTexts.length === 0) &&
            (!userAnswer.textAnswer || userAnswer.textAnswer.trim() === '')) {
          return res.status(400).json({
            success: false,
            message: "No content to evaluate",
            error: {
              code: "NO_CONTENT",
              details: "This answer has no images, extracted text, or text content to evaluate"
            }
          });
        }
        let evaluation = null;
        let extractedTexts = userAnswer.extractedTexts || [];
        try {
          if (userAnswer.answerImages && userAnswer.answerImages.length > 0 && extractedTexts.length === 0) {
            console.log('Re-extracting text from images for re-evaluation');
            const imageUrls = userAnswer.answerImages.map(img => img.imageUrl);
            extractedTexts = await extractTextFromImagesWithFallback(imageUrls);
            await UserAnswer.findByIdAndUpdate(answerId, {
              extractedTexts: extractedTexts
            });
          }
          let contentToEvaluate = [];
          if (extractedTexts.length > 0) {
            contentToEvaluate = extractedTexts;
          }
          if (userAnswer.textAnswer && userAnswer.textAnswer.trim()) {
            contentToEvaluate.push(userAnswer.textAnswer);
          }
          if (contentToEvaluate.length === 0) {
            throw new Error('No content available for evaluation');
          }
          const question = userAnswer.questionId;
          if (GEMINI_API_KEY) {
            try {
              console.log('Re-evaluating with Gemini API');
              const prompt = generateEvaluationPrompt(question, contentToEvaluate);
              const response = await axios.post(
                `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
                {
                  contents: [{
                    parts: [{
                      text: prompt
                    }]
                  }],
                  generationConfig: {
                    temperature: 0.7,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 2048,
                  }
                },
                {
                  headers: { 'Content-Type': 'application/json' },
                  timeout: 30000
                }
              );
              if (response.status === 200 && response.data?.candidates?.[0]?.content) {
                const evaluationText = response.data.candidates[0].content.parts[0].text;
                evaluation = parseEvaluationResponse(evaluationText, question);
              } else {
                throw new Error('Invalid response from Gemini API');
              }
            } catch (geminiError) {
              if (OPENAI_API_KEY) {
                const prompt = generateEvaluationPrompt(question, contentToEvaluate);
                const response = await axios.post(
                  OPENAI_API_URL,
                  {
                    model: "gpt-4o-mini",
                    messages: [{
                      role: "user",
                      content: prompt
                    }],
                    max_tokens: 1500,
                    temperature: 0.7
                  },
                  {
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${OPENAI_API_KEY}`
                    },
                    timeout: 30000
                  }
                );
                if (response.data?.choices?.[0]?.message?.content) {
                  const evaluationText = response.data.choices[0].message.content;
                  evaluation = parseEvaluationResponse(evaluationText, question);
                  console.log('Re-evaluation completed successfully with OpenAI');
                } else {
                  throw new Error('Invalid response from OpenAI API');
                }
              } else {
                evaluation = generateMockEvaluation(question);
              }
            }
          } else if (OPENAI_API_KEY) {
            const prompt = generateEvaluationPrompt(question, contentToEvaluate);
            const response = await axios.post(
              OPENAI_API_URL,
              {
                model: "gpt-4o-mini",
                messages: [{
                  role: "user",
                  content: prompt
                }],
                max_tokens: 1500,
                temperature: 0.7
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${OPENAI_API_KEY}`
                },
                timeout: 30000
              }
            );
            if (response.data?.choices?.[0]?.message?.content) {
              const evaluationText = response.data.choices[0].message.content;
              evaluation = parseEvaluationResponse(evaluationText, question);
              console.log('Re-evaluation completed successfully with OpenAI');
            } else {
              throw new Error('Invalid response from OpenAI API');
            }
          } else {
            console.log('No API keys available for re-evaluation, using mock evaluation');
            evaluation = generateMockEvaluation(question);
          }
          const updatedAnswer = await UserAnswer.findByIdAndUpdate(
            answerId,
            {
              evaluation: evaluation,
              evaluatedAt: new Date(),
              extractedTexts: extractedTexts
            },
            { new: true }
          );
          res.status(200).json({
            success: true,
            message: "Answer re-evaluated successfully",
            data: {
              answerId: updatedAnswer._id,
              questionId: questionId,
              attemptNumber: updatedAnswer.attemptNumber,
              previousEvaluation: userAnswer.evaluation,
              newEvaluation: evaluation,
              extractedTexts: extractedTexts,
              evaluatedAt: updatedAnswer.evaluatedAt,
              question: {
                id: question._id,
                question: question.question,
                maximumMarks: question.metadata?.maximumMarks
              }
            }
          });
        } catch (evaluationError) {
          console.error('Re-evaluation error:', evaluationError.message);
          res.status(500).json({
            success: false,
            message: "Re-evaluation failed",
            error: {
              code: "EVALUATION_ERROR",
              details: evaluationError.message
            }
          });
        }
      } catch (error) {
        console.error('Re-evaluate answer error:', error);
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
router.get('/questions/:questionId/answers/:answerId/evaluation',
    authenticateMobileUser,
    [
      ...validateQuestionId,
      param('answerId')
        .isMongoId()
        .withMessage('Answer ID must be a valid MongoDB ObjectId')
    ],
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
        const { questionId, answerId } = req.params;
        const userId = req.user.id;
        const userAnswer = await UserAnswer.findOne({
          _id: answerId,
          userId: userId,
          questionId: questionId
        }).populate('questionId', 'question metadata');
        if (!userAnswer) {
          return res.status(404).json({
            success: false,
            message: "Answer not found",
            error: {
              code: "ANSWER_NOT_FOUND",
              details: "The specified answer does not exist or you don't have permission to access it"
            }
          });
        }
        if (!userAnswer.evaluation) {
          return res.status(404).json({
            success: false,
            message: "Evaluation not found",
            error: {
              code: "EVALUATION_NOT_FOUND",
              details: "This answer has not been evaluated yet"
            }
          });
        }
        res.status(200).json({
          success: true,
          data: {
            answerId: userAnswer._id,
            questionId: userAnswer.questionId._id,
            question: {
              question: userAnswer.questionId.question,
              maximumMarks: userAnswer.questionId.metadata?.maximumMarks
            },
            evaluation: userAnswer.evaluation,
            extractedTexts: userAnswer.extractedTexts,
            evaluatedAt: userAnswer.evaluatedAt
          }
        });
  
      } catch (error) {
        console.error('Get evaluation error:', error);
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
  router.get('/questions/:questionId/complete-data-all-users',
    authenticateMobileUser, // You might want to change this to admin authentication
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
        const { 
          page = 1, 
          limit = 50, 
          submissionStatus, 
          clientId,
          sortBy = 'submittedAt',
          sortOrder = 'desc'
        } = req.query;
        const filter = { questionId: questionId };
        if (submissionStatus) {
          filter.submissionStatus = submissionStatus;
        }
        if (clientId) {
          filter.clientId = clientId;
        }
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const userAnswers = await UserAnswer.find(filter)
          .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate('questionId', 'question detailedAnswer metadata languageMode')
          .populate('setId', 'name itemType')
          .populate('reviewedBy', 'username email')
          .populate({
            path: 'userId',
            select: 'mobile clientId isVerified lastLoginAt createdAt',
            populate: {
              path: 'profile',
              select: 'name age gender exams nativeLanguage isComplete'
            }
          });
        if (userAnswers.length === 0) {
          return res.status(404).json({
            success: false,
            message: "No answers found",
            error: {
              code: "NO_ANSWERS_FOUND",
              details: "No answers found for this question"
            }
          });
        }
        const totalAnswers = await UserAnswer.countDocuments(filter);
        const questionData = userAnswers[0].questionId;
        const userGroupedAnswers = {};
        userAnswers.forEach(answer => {
          const userId = answer.userId._id.toString();
          if (!userGroupedAnswers[userId]) {
            userGroupedAnswers[userId] = {
              userInfo: {
                id: answer.userId._id,
                mobile: answer.userId.mobile,
                clientId: answer.userId.clientId,
                isVerified: answer.userId.isVerified,
                lastLoginAt: answer.userId.lastLoginAt,
                createdAt: answer.userId.createdAt,
                profile: answer.userId.profile ? {
                  name: answer.userId.profile.name,
                  age: answer.userId.profile.age,
                  gender: answer.userId.profile.gender,
                  exams: answer.userId.profile.exams,
                  nativeLanguage: answer.userId.profile.nativeLanguage,
                  isComplete: answer.userId.profile.isComplete
                } : null
              },
              totalAttempts: 0,
              attempts: []
            };
          }
          userGroupedAnswers[userId].totalAttempts++;
          userGroupedAnswers[userId].attempts.push({
            id: answer._id,
            attemptNumber: answer.attemptNumber,
            textAnswer: answer.textAnswer,
            submissionStatus: answer.submissionStatus,
            submittedAt: answer.submittedAt,
            reviewedAt: answer.reviewedAt,
            evaluatedAt: answer.evaluatedAt,
            isFinalAttempt: answer.isFinalAttempt(),
            images: {
              count: answer.answerImages.length,
              details: answer.answerImages.map(img => ({
                imageUrl: img.imageUrl,
                cloudinaryPublicId: img.cloudinaryPublicId,
                originalName: img.originalName,
                uploadedAt: img.uploadedAt
              }))
            },
            extractedTexts: answer.extractedTexts || [],
            evaluation: answer.evaluation ? {
              accuracy: answer.evaluation.accuracy,
              marks: answer.evaluation.marks,
              extractedText: answer.evaluation.extractedText,
              strengths: answer.evaluation.strengths || [],
              weaknesses: answer.evaluation.weaknesses || [],
              suggestions: answer.evaluation.suggestions || [],
              feedback: answer.evaluation.feedback
            } : null,
            feedback: answer.feedback ? {
              score: answer.feedback.score,
              comments: answer.feedback.comments,
              suggestions: answer.feedback.suggestions || []
            } : null,
            metadata: {
              timeSpent: answer.metadata.timeSpent,
              deviceInfo: answer.metadata.deviceInfo,
              appVersion: answer.metadata.appVersion,
              sourceType: answer.metadata.sourceType
            },
            ...(answer.setId && {
              set: {
                id: answer.setId._id,
                name: answer.setId.name,
                itemType: answer.setId.itemType
              }
            }),
            ...(answer.reviewedBy && {
              reviewedBy: {
                id: answer.reviewedBy._id,
                username: answer.reviewedBy.username,
                email: answer.reviewedBy.email
              }
            })
          });
        });
        Object.values(userGroupedAnswers).forEach(userData => {
          userData.attempts.sort((a, b) => a.attemptNumber - b.attemptNumber);
        });
        const statistics = {
          totalUsers: Object.keys(userGroupedAnswers).length,
          totalAnswers: totalAnswers,
          averageAttemptsPerUser: totalAnswers / Object.keys(userGroupedAnswers).length,
          submissionStatusBreakdown: {},
          evaluationStats: {
            averageAccuracy: 0,
            averageMarks: 0,
            totalEvaluated: 0
          }
        };
        userAnswers.forEach(answer => {
          statistics.submissionStatusBreakdown[answer.submissionStatus] = 
            (statistics.submissionStatusBreakdown[answer.submissionStatus] || 0) + 1;
        });
        const evaluatedAnswers = userAnswers.filter(answer => answer.evaluation);
        if (evaluatedAnswers.length > 0) {
          statistics.evaluationStats.totalEvaluated = evaluatedAnswers.length;
          statistics.evaluationStats.averageAccuracy = 
            evaluatedAnswers.reduce((sum, answer) => sum + (answer.evaluation.accuracy || 0), 0) / evaluatedAnswers.length;
          statistics.evaluationStats.averageMarks = 
            evaluatedAnswers.reduce((sum, answer) => sum + (answer.evaluation.marks || 0), 0) / evaluatedAnswers.length;
        }
        const completeData = {
          question: {
            id: questionData._id,
            question: questionData.question,
            detailedAnswer: questionData.detailedAnswer,
            metadata: questionData.metadata,
            languageMode: questionData.languageMode
          },
          statistics: statistics,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalAnswers / parseInt(limit)),
            totalAnswers: totalAnswers,
            answersPerPage: parseInt(limit),
            hasNextPage: parseInt(page) < Math.ceil(totalAnswers / parseInt(limit)),
            hasPrevPage: parseInt(page) > 1
          },
          users: Object.values(userGroupedAnswers)
        };
        res.status(200).json({
          success: true,
          message: "Complete question data for all users retrieved successfully",
          data: completeData
        });
      } catch (error) {
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
  router.put('/questions/:questionId/answers/:answerId/evaluation-update',
    [
      param('questionId')
        .isMongoId()
        .withMessage('Question ID must be a valid MongoDB ObjectId'),
      param('answerId')
        .isMongoId()
        .withMessage('Answer ID must be a valid MongoDB ObjectId'),
      body('userId')
        .optional()
        .isMongoId()
        .withMessage('User ID must be a valid MongoDB ObjectId'),
      body('accuracy')
        .optional()
        .isFloat({ min: 0, max: 100 })
        .withMessage('Accuracy must be between 0 and 100'),
      body('marks')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Marks must be a positive number'),
      body('strengths')
        .optional()
        .isArray()
        .withMessage('Strengths must be an array'),
      body('strengths.*')
        .optional()
        .isString()
        .trim()
        .withMessage('Each strength must be a string'),
      body('weaknesses')
        .optional()
        .isArray()
        .withMessage('Weaknesses must be an array'),
      body('weaknesses.*')
        .optional()
        .isString()
        .trim()
        .withMessage('Each weakness must be a string'),
      body('suggestions')
        .optional()
        .isArray()
        .withMessage('Suggestions must be an array'),
      body('suggestions.*')
        .optional()
        .isString()
        .trim()
        .withMessage('Each suggestion must be a string'),
      body('feedback')
        .optional()
        .isString()
        .trim()
        .isLength({ max: 2000 })
        .withMessage('Feedback must be less than 2000 characters'),
      body('extractedText')
        .optional()
        .isString()
        .trim()
        .withMessage('Extracted text must be a string'),
      body('analysis').optional().isObject().withMessage('Analysis must be an object'),
      body('analysis.introduction').optional().isArray().withMessage('Introduction must be an array'),
      body('analysis.body').optional().isArray().withMessage('Body must be an array'),
      body('analysis.conclusion').optional().isArray().withMessage('Conclusion must be an array'),
      body('analysis.strengths').optional().isArray().withMessage('Strengths must be an array'),
      body('analysis.weaknesses').optional().isArray().withMessage('Weaknesses must be an array'),
      body('analysis.suggestions').optional().isArray().withMessage('Suggestions must be an array'),
      body('analysis.feedback').optional().isString().withMessage('Feedback must be a string')
    ],
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
        const { questionId, answerId } = req.params;
        const {
          userId,
          strengths,
          weaknesses,
          suggestions,
          feedback,
          extractedText,
          analysis,
          marks, // alias for score
          accuracy // alias for relevancy
        } = req.body;
        let queryFilter = { questionId: questionId, _id: answerId };
        if (userId) {
          queryFilter.userId = userId;
        }
        // Fetch the current evaluation for response
        const answerBefore = await UserAnswer.findOne(queryFilter)
          .populate('questionId', 'question metadata')
          .populate('userId', 'name email');
        if (!answerBefore) {
          return res.status(404).json({
            success: false,
            message: "No answer found",
            error: {
              code: "ANSWER_NOT_FOUND",
              details: "No answer matches the specified criteria"
            }
          });
        }
        console.log(answerBefore)
        let questionData = answerBefore.questionId;
        let testType = answerBefore.testType;
        // Fallback: fetch question if not populated
        if (!questionData || !questionData.metadata) {
          try {
            if(testType === 'aiswb')
            questionData = await AiswbQuestion.findById(answerBefore.questionId).select('question metadata');
            if(testType === 'subjective')
            questionData = await SubjectiveTestQuestion.findById(answerBefore.questionId).select('question metadata');
          } catch (_) {
            // ignore and handle below if still missing
          }
        }
        if (!questionData || !questionData.metadata) {
          return res.status(500).json({
            success: false,
            message: "Question metadata not available",
            error: {
              code: "QUESTION_METADATA_MISSING",
              details: "Unable to load question or its metadata for maximumMarks"
            }
          });
        }
        console.log(questionData)
        const maxMarks = questionData.metadata?.maximumMarks || 10;
        console.log(maxMarks)
        if (marks !== undefined && marks > maxMarks) {
          return res.status(400).json({
            success: false,
            message: "Invalid marks",
            error: {
              code: "MARKS_EXCEEDED",
              details: `Marks cannot exceed maximum marks of ${maxMarks}`
            }
          });
        }
        const evaluationUpdate = {};
        if (accuracy !== undefined) evaluationUpdate.relevancy = accuracy;
        if (marks !== undefined) evaluationUpdate.score = marks;
        if (extractedText !== undefined) evaluationUpdate.extractedText = extractedText;
        if (feedback !== undefined) evaluationUpdate.feedback = feedback;
        if (strengths !== undefined) evaluationUpdate.strengths = strengths;
        if (weaknesses !== undefined) evaluationUpdate.weaknesses = weaknesses;
        if (suggestions !== undefined) evaluationUpdate.suggestions = suggestions;
        if (analysis !== undefined) evaluationUpdate.analysis = analysis;
        const currentEvaluation = answerBefore.evaluation || {};
        const updatedEvaluation = {
          ...currentEvaluation,
          ...evaluationUpdate
        };
        // Use findOneAndUpdate to update only the evaluation field
        const updateSet = { evaluation: updatedEvaluation };
        // Also update Hindi evaluation score/relevancy if Hindi evaluation exists
        if (answerBefore && answerBefore.hindiEvaluation) {
          if (accuracy !== undefined) updateSet['hindiEvaluation.relevancy'] = accuracy;
          if (marks !== undefined) updateSet['hindiEvaluation.score'] = marks;
        }
        const updatedAnswer = await UserAnswer.findOneAndUpdate(
          queryFilter,
          { $set: updateSet },
          { new: true }
        )
          .populate('questionId', 'question metadata')
          .populate('userId', 'name email');
        res.status(200).json({
          success: true,
          message: `Evaluation updated for answer`,
          data: {
            answerId: updatedAnswer._id,
            userId: updatedAnswer.userId._id,
            userName: updatedAnswer.userId.name || 'Unknown',
            attemptNumber: updatedAnswer.attemptNumber,
            previousEvaluation: currentEvaluation,
            updatedEvaluation: updatedEvaluation,
            question: {
              id: questionData._id,
              question: questionData.question,
              maximumMarks: questionData.metadata?.maximumMarks
            }
          }
        });
      } catch (error) {
        console.log(error)
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
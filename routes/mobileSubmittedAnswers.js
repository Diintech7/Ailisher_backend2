// routes/mobileSubmittedAnswers.js
const express = require('express');
const router = express.Router();
const UserAnswer = require('../models/UserAnswer');
const AiswbQuestion = require('../models/AiswbQuestion');
const AISWBSet = require('../models/AISWBSet');
const ObjectiveQuestion = require('../models/ObjectiveQuestion');
const SubjectiveQuestion = require('../models/SubjectiveQuestion');
const SubjectiveTestQuestion = require('../models/SubjectiveTestQuestion');
const SubjectiveTest = require('../models/SubjectiveTest');
const Book = require('../models/Book');
const Chapter = require('../models/Chapter');
const Topic = require('../models/Topic');
const SubTopic = require('../models/SubTopic');
const Workbook = require('../models/Workbook');
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const { generateAnnotatedImageUrl, generateGetPresignedUrl } = require('../utils/s3');

// Apply authentication middleware to all routes
router.use(authenticateMobileUser);

/**
 * Helper function to get book/workbook information based on question type and set
 */
const getBookWorkbookInfo = async (question) => {
  try {
    // For AISWB questions
    if (question.setId) {
      console.log(question.setId)
      const aiswbSet = await AISWBSet.findById(question.setId).lean();
      console.log(aiswbSet.itemType)
      if (aiswbSet) {
        let bookInfo = null;
        let workbookInfo = null;
        
        // Get item details based on itemType
        switch (aiswbSet.itemType) {
          case 'book':
            const book = await Book.findById(aiswbSet.itemId).select('title').lean();
            bookInfo = book ? {
              id: book._id,
              title: book.title
            } : null;
            break;
          case 'workbook':
            const workbook = await Workbook.findById(aiswbSet.itemId).select('title').lean();
            workbookInfo = workbook ? {
              id: workbook._id,
              title: workbook.title
            } : null;
            break;
          case 'chapter':
            const chapter = await Chapter.findById(aiswbSet.itemId).select('title parentType book workbook').lean();
            if (chapter.parentType === 'book') {
              const book = await Book.findById(chapter.book).select('title').lean();
              bookInfo = book ? {
                id: book._id,
                title: book.title
              } : null;
            }
            if (chapter.parentType === 'workbook') {
              const workbook = await Workbook.findById(chapter.workbook).select('title').lean();
              workbookInfo = workbook ? {
                id: workbook._id,
                title: workbook.title
              } : null;
            }
            break;
          case 'topic':
            const topic = await Topic.findById(aiswbSet.itemId).select('title chapter').lean();
            if (topic?.chapter) {
              const chapter = await Chapter.findById(topic.chapter);
            if (chapter.parentType === 'book') {
              const book = await Book.findById(chapter.book).select('title description coverImageUrl author publisher mainCategory subCategory rating createdAt updatedAt');
              bookInfo = book;
            }
            if (chapter.parentType === 'workbook') {
              const workbook = await Workbook.findById(chapter.workbook).select('title description coverImageUrl author publisher mainCategory subCategory rating createdAt updatedAt');
              workbookInfo = workbook;
            }
          }
            break;
          case 'subtopic':
            const subtopic = await SubTopic.findById(aiswbSet.itemId).select('title topic').lean();
            if (subtopic?.topic) {
              const topic = await Topic.findById(subtopic.topic).select('title chapter').lean();
              if (topic?.chapter) {
                const chapter = await Chapter.findById(aiswbSet.itemId).select('title parentType book workbook').lean();
                if (chapter.parentType === 'book') {
                  const book = await Book.findById(chapter.book).select('title').lean();
                  bookInfo = book ? {
                    id: book._id,
                    title: book.title
                  } : null;
                }
                if (chapter.parentType === 'workbook') {
                  const workbook = await Workbook.findById(chapter.workbook).select('title').lean();
                  workbookInfo = workbook ? {
                    id: workbook._id,
                    title: workbook.title
                  } : null;
                }
              }
            }
            break;
        }
        
        return {
          book: bookInfo,
          workbook: workbookInfo,
          questionType: 'aiswb'
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error getting book/workbook information:', error);
    return null;
  }
};

/**
 * GET /api/clients/:clientId/mobile/submitted-answers
 * Get list of submitted answers for the authenticated mobile user
 */
router.get('/', async (req, res) => {
  try {
    const { id: userId, clientId } = req.user;
    const { 
      status,
      questionId,
      submissionStatus,
      reviewStatus,
      publishStatus,
      sortBy = 'submittedAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {
      userId: userId,
      clientId: clientId
    };

    // Add optional filters
    if (questionId) filter.questionId = questionId;
    if (submissionStatus) filter.submissionStatus = submissionStatus;
    if (reviewStatus) filter.reviewStatus = reviewStatus;
    if (publishStatus) filter.publishStatus = publishStatus;

    // Legacy status filter support
    if (status) {
      switch (status) {
        case 'submitted':
          filter.submissionStatus = 'submitted';
          break;
        case 'evaluated':
          filter.submissionStatus = 'evaluated';
          break;
        case 'rejected':
          filter.submissionStatus = 'rejected';
          break;
      }
    }
    
    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Fetch submitted answers without population first
    const submittedAnswers = await UserAnswer.find(filter)
      .select(`
        questionId testType testId attemptNumber answerImages textAnswer submissionStatus 
        submittedAt acceptedAt feedback evaluation publishStatus reviewStatus 
        popularityStatus metadata.timeSpent metadata.sourceType evaluatedAt
        requestID requestnote annotations reviewRequestedAt reviewAssignedAt reviewCompletedAt
      `)
      .sort(sort)
      .lean();

    // Populate questions and tests based on testType
    const populatedAnswers = await Promise.all(submittedAnswers.map(async (answer) => {
      let populatedQuestion = null;
      let populatedTest = null;

      // Populate question based on testType
      if (answer.testType === 'subjective') {
        // For subjective questions, populate from SubjectiveTestQuestion
        populatedQuestion = await SubjectiveTestQuestion.findById(answer.questionId)
          .select('question detailedAnswer modalAnswer answerVideoUrls metadata languageMode evaluationMode test')
          .lean();
        
        // Populate test info
        if (answer.testId) {
          populatedTest = await SubjectiveTest.findById(answer.testId)
            .select('name description category subcategory Estimated_time imageKey imageUrl instructions')
            .lean();
        }
      } else {
        // For AISWB questions, populate from AiswbQuestion
        populatedQuestion = await AiswbQuestion.findById(answer.questionId)
          .select('question metadata.difficultyLevel metadata.maximumMarks metadata.wordLimit metadata.estimatedTime languageMode evaluationMode setId book chapter topic subtopic')
          .lean();
      }

      return {
        ...answer,
        questionId: populatedQuestion,
        testId: populatedTest
      };
    }));

    for(const answer of populatedAnswers){
      if(answer.feedback?.expertReview?.annotatedImages){
        for(const image of answer.feedback.expertReview.annotatedImages){
          if(image.s3Key){
            image.downloadUrl = await generateAnnotatedImageUrl(image.s3Key);
          }
        }
      }
      if(answer.annotations){
        for(const annotation of answer.annotations){
          if(annotation.s3Key){
            annotation.downloadUrl = await generateAnnotatedImageUrl(annotation.s3Key);
          }
        }
      }
    }

    // Get book/workbook information for each answer
    const transformedAnswers = await Promise.all(populatedAnswers.map(async (answer) => {
      const bookWorkbookInfo = await getBookWorkbookInfo(answer.questionId);
      
      // Determine if this is a subjective test submission based on testType
      const isSubjectiveTest = answer.testType === 'subjective';
      
      // Get question information based on type
      let questionInfo = null;
      let testInfo = null;
      
      if (isSubjectiveTest) {
        // Subjective test submission
        questionInfo = {
          text: answer.questionId?.question,
          difficultyLevel: answer.questionId?.metadata?.difficultyLevel,
          maximumMarks: answer.questionId?.metadata?.maximumMarks,
          wordLimit: answer.questionId?.metadata?.wordLimit,
          estimatedTime: answer.questionId?.metadata?.estimatedTime,
          languageMode: answer.questionId?.languageMode,
          evaluationMode: answer.questionId?.evaluationMode,
          detailedAnswer: answer.questionId?.detailedAnswer,
          modalAnswer: answer.questionId?.modalAnswer,
          answerVideoUrls: answer.questionId?.answerVideoUrls || []
        };
        console.log("answer.testId", answer.testId);
        if(answer.testId?.imageKey){
          answer.testId.imageUrl = await generateGetPresignedUrl(answer.testId.imageKey, 31536000);
        }
        
        testInfo = {
          id: answer.testId?._id,
          name: answer.testId?.name,
          description: answer.testId?.description,
          category: answer.testId?.category,
          subcategory: answer.testId?.subcategory,
          estimatedTime: answer.testId?.Estimated_time,
          imageUrl: answer.testId?.imageUrl,
          instructions: answer.testId?.instructions
        };
      } else {
        // AISWB submission
        questionInfo = {
          text: answer.questionId?.question,
          difficultyLevel: answer.questionId?.metadata?.difficultyLevel,
          maximumMarks: answer.questionId?.metadata?.maximumMarks,
          wordLimit: answer.questionId?.metadata?.wordLimit,
          estimatedTime: answer.questionId?.metadata?.estimatedTime,
          languageMode: answer.questionId?.languageMode,
          evaluationMode: answer.questionId?.evaluationMode
        };
      }
      
      return {
        _id: answer._id,
        questionId: answer.questionId?._id,
        question: questionInfo,
        
        // Test information (for subjective tests)
        testInfo: testInfo,
        
        // Book/Workbook information (for AISWB)
        bookWorkbookInfo: bookWorkbookInfo,
        
        // Submission type
        submissionType: isSubjectiveTest ? 'subjective_test' : 'aiswb',
        
        attemptNumber: answer.attemptNumber,
        submissionStatus: answer.submissionStatus,
        reviewStatus: answer.reviewStatus,
        requestID: answer.requestID,
        requestnote: answer.requestnote,
        feedback: answer.feedback,
        publishStatus: answer.publishStatus,
        popularityStatus: answer.popularityStatus,
        submittedAt: answer.submittedAt,
        acceptedAt: answer.acceptedAt,
        evaluatedAt: answer.evaluatedAt,
        reviewRequestedAt: answer.reviewRequestedAt,
        reviewAcceptedAt: answer.reviewAssignedAt,
        reviewCompletedAt: answer.reviewCompletedAt,
        hasImages: answer.answerImages && answer.answerImages.length > 0,
        hasTextAnswer: Boolean(answer.textAnswer),
        answerImages: answer.answerImages || [],
        annotations: answer.annotations || [],
        timeSpent: answer.metadata?.timeSpent || 0,
        sourceType: answer.metadata?.sourceType || 'qr_scan',
        
        // Basic feedback/evaluation info (without detailed content)
        isEvaluated: answer.submissionStatus === 'evaluated',
        hasEvaluation: Boolean(answer.evaluation?.relevancy !== undefined || answer.evaluation?.score !== undefined),
        hasFeedback: Boolean(answer.feedback?.score !== undefined || answer.feedback?.comments),
        hasExpertReview: Boolean(answer.feedback?.expertReview?.score !== undefined || answer.feedback?.expertReview?.remarks),
        
        // Summary stats (updated to match new evaluation structure)
        evaluationSummary: answer.evaluation ? {
          relevancy: answer.evaluation.relevancy,
          score: answer.evaluation.score,
          remark: answer.evaluation.remark,
          hasComments: Boolean(answer.evaluation.comments?.length),
          hasAnalysis: Boolean(answer.evaluation.analysis && (
            answer.evaluation.analysis.introduction?.length ||
            answer.evaluation.analysis.body?.length ||
            answer.evaluation.analysis.conclusion?.length ||
            answer.evaluation.analysis.strengths?.length ||
            answer.evaluation.analysis.weaknesses?.length ||
            answer.evaluation.analysis.suggestions?.length ||
            answer.evaluation.analysis.feedback?.length
          ))
        } : null,
        
        feedbackSummary: answer.feedback ? {
          score: answer.feedback.score,
          hasComments: Boolean(answer.feedback.comments),
          hasSuggestions: Boolean(answer.feedback.suggestions?.length)
        } : null,
        
        // Expert Review Summary
        expertReviewSummary: answer.feedback?.expertReview ? {
          score: answer.feedback.expertReview.score,
          result: answer.feedback.expertReview.result,
          hasRemarks: Boolean(answer.feedback.expertReview.remarks),
          hasAnnotatedImages: Boolean(answer.feedback.expertReview.annotatedImages?.length),
          reviewedAt: answer.feedback.expertReview.reviewedAt
        } : null,
        
      };
    }));
    console.log(transformedAnswers)
    res.status(200).json({
      success: true,
      message: 'Submitted answers retrieved successfully',
      data: {
        answers: transformedAnswers,
        summary: {
          totalSubmitted: transformedAnswers.length,
          evaluatedCount: transformedAnswers.filter(a => a.isEvaluated).length,
          publishedCount: transformedAnswers.filter(a => a.publishStatus === 'published').length,
          popularCount: transformedAnswers.filter(a => a.popularityStatus === 'popular').length
        }
      }
    });

  } catch (error) {
    console.error('Error fetching submitted answers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch submitted answers',
      error: {
        code: 'FETCH_SUBMITTED_ANSWERS_ERROR',
        details: error.message
      }
    });
  }
});

/**
 * GET /api/clients/:clientId/mobile/submitted-answers/:answerId
 * Get detailed analysis for a particular submitted answer
 */
router.get('/:answerId', async (req, res) => {
  try {
    const { answerId } = req.params;
    const { id: userId, clientId } = req.user;

    // Find the specific answer with full details
    const userAnswer = await UserAnswer.findOne({
      _id: answerId,
      userId: userId,
      clientId: clientId
    })

    if (!userAnswer) {
      return res.status(404).json({
        success: false,
        message: 'Answer not found or access denied',
        error: {
          code: 'ANSWER_NOT_FOUND',
          details: 'The specified answer does not exist or you do not have access to it'
        }
      });
    }
    console.log(userAnswer);
    console.log(userAnswer.questionId);
    let question = null;
    let test = null;
    // Populate question based on testType
    if (userAnswer.testType === 'subjective') {
      // For subjective questions, populate from SubjectiveTestQuestion
      question = await SubjectiveTestQuestion.findById(userAnswer.questionId)
        .select('question detailedAnswer modalAnswer answerVideoUrls metadata languageMode evaluationMode test')
        .lean();
      
      // Populate test info
      if (userAnswer.testId) {
        test = await SubjectiveTest.findById(userAnswer.testId)
          .select('name description category subcategory Estimated_time imageKey imageUrl instructions')
          .lean();
      }
    } 
    else {
      console.log("AISWB")
      console.log(userAnswer.questionId)
      question = await AiswbQuestion.findById(userAnswer.questionId)
        .select('_id question detailedAnswer modalAnswer answerVideoUrls metadata languageMode evaluationMode setId book chapter topic subtopic')
        .lean();
    }

    
    // Check if evaluation/analysis is available
    const hasEvaluation = Boolean(
      userAnswer.evaluation?.relevancy !== undefined || 
      userAnswer.evaluation?.score !== undefined ||
      userAnswer.feedback?.score !== undefined ||
      userAnswer.feedback?.expertReview?.score !== undefined
    );

    if (!hasEvaluation && userAnswer.submissionStatus !== 'evaluated') {
      return res.status(200).json({
        success: true,
        message: 'Answer found but analysis is not yet available',
        data: {
          answer: {
            _id: userAnswer._id,
            questionId: question._id,
            question: question.question,
            attemptNumber: userAnswer.attemptNumber,
            submissionStatus: userAnswer.submissionStatus,
            reviewStatus: userAnswer.reviewStatus,
            submittedAt: userAnswer.submittedAt,
            requestID: userAnswer.requestID,
            requestnote: userAnswer.requestnote,
            analysisAvailable: false,
            expectedAnalysisTime: '24-48 hours' // You can make this dynamic
          }
        }
      });
    }
    
    if(userAnswer.feedback?.expertReview?.annotatedImages){
      for(const image of userAnswer.feedback.expertReview.annotatedImages){
          if(image.s3Key){  
            image.downloadUrl = await generateAnnotatedImageUrl(image.s3Key);
        }
      }
    }
    if(userAnswer.annotations){
        for(const annotation of userAnswer.annotations){
          if(annotation.s3Key){
            annotation.downloadUrl = await generateAnnotatedImageUrl(annotation.s3Key);
        }
      }
    }

    // Get book/workbook information
    const bookWorkbookInfo = await getBookWorkbookInfo(userAnswer.questionId);

    let questionInfo = null;
    let testInfo = null;
      // Subjective test submission
      questionInfo = {
        _id: question?._id,
        text: question?.question,
        detailedAnswer: question?.detailedAnswer,
        modalAnswer: question?.modalAnswer,
        answerVideoUrls: question?.answerVideoUrls || [],
        metadata: question?.metadata,
        languageMode: question?.languageMode,
        evaluationMode: question?.evaluationMode
      };
      if(test?.imageKey){
        test.imageUrl = await generateGetPresignedUrl(test.imageKey, 31536000);
      }
      
      testInfo = {
        id: test?._id,
        name: test?.name,
        description: test?.description,
        category: test?.category,
        subcategory: test?.subcategory,
        estimatedTime: test?.Estimated_time,
        imageUrl: test?.imageUrl,
        instructions: test?.instructions
      };
    

    // Prepare the detailed response with analysis
    const responseData = {
      answer: {
        _id: userAnswer._id,
        questionId: question?._id,
        testType: userAnswer.testType,
        setId: question?.setId,
        attemptNumber: userAnswer.attemptNumber,
        submissionStatus: userAnswer.submissionStatus,
        reviewStatus: userAnswer.reviewStatus,
        publishStatus: userAnswer.publishStatus,
        popularityStatus: userAnswer.popularityStatus,
        submittedAt: userAnswer.submittedAt,
        acceptedAt: userAnswer.acceptedAt,
        evaluatedAt: userAnswer.evaluatedAt,
        requestID: userAnswer.requestID,
        requestnote: userAnswer.requestnote,
        analysisAvailable: true,
        annotations: userAnswer.annotations,
        
        // Test information (for subjective tests)
        testInfo: testInfo,
        
        // Book/Workbook information (for AISWB)
        bookWorkbookInfo: bookWorkbookInfo,
        
        // Submission type
        submissionType: userAnswer.testType,
        
        // Question details
        question: questionInfo,
        
        // User's submission
        submission: {
          answerImages: userAnswer.answerImages || [],
          textAnswer: userAnswer.textAnswer,
          extractedTexts: userAnswer.extractedTexts || [],
          timeSpent: userAnswer.metadata?.timeSpent || 0,
          sourceType: userAnswer.metadata?.sourceType || 'qr_scan',
          deviceInfo: userAnswer.metadata?.deviceInfo,
          appVersion: userAnswer.metadata?.appVersion
        },
        
        // AI/Manual Evaluation (updated to match new structure)
        evaluation: userAnswer.evaluation ? {
          relevancy: userAnswer.evaluation.relevancy,
          score: userAnswer.evaluation.score.toString(),
          remark: userAnswer.evaluation.remark,
          extractedText: userAnswer.evaluation.extractedText,
          feedbackStatus: userAnswer.evaluation.feedbackStatus,
          userFeedback: userAnswer.evaluation.userFeedback,
          comments: userAnswer.evaluation.comments || [],
          analysis: userAnswer.evaluation.analysis ? {
            introduction: userAnswer.evaluation.analysis.introduction || [],
            body: userAnswer.evaluation.analysis.body || [],
            conclusion: userAnswer.evaluation.analysis.conclusion || [],
            strengths: userAnswer.evaluation.analysis.strengths || [],
            weaknesses: userAnswer.evaluation.analysis.weaknesses || [],
            suggestions: userAnswer.evaluation.analysis.suggestions || [],
            feedback: userAnswer.evaluation.analysis.feedback || []
          } : {
            introduction: [],
            body: [],
            conclusion: [],
            strengths: [],
            weaknesses: [],
            suggestions: [],
            feedback: []
          }
        } : null,

        hindiEvaluation: userAnswer.hindiEvaluation ? {
          relevancy: userAnswer.hindiEvaluation.relevancy,
          score: userAnswer.hindiEvaluation.score,
          remark: userAnswer.hindiEvaluation.remark,
          comments: userAnswer.hindiEvaluation.comments || [],
          analysis: userAnswer.hindiEvaluation.analysis || []
        } : null,
        
        // Manual Review Feedback (if available)
        feedback: userAnswer.feedback ? {
          score: userAnswer.feedback.score,
          comments: userAnswer.feedback.comments,
          suggestions: userAnswer.feedback.suggestions || [],
          feedbackStatus: userAnswer.feedback.feedbackStatus,
          userFeedbackReview: userAnswer.feedback.userFeedbackReview,
          // Include full expert review data
          expertReview: userAnswer.feedback.expertReview ? {
            result: userAnswer.feedback.expertReview.result,
            score: userAnswer.feedback.expertReview.score,
            remarks: userAnswer.feedback.expertReview.remarks,
            annotatedImages: userAnswer.feedback.expertReview.annotatedImages || [],
            reviewedAt: userAnswer.feedback.expertReview.reviewedAt
          } : null
        } : null,
        
        // Reviewer information (if reviewed manually)
        reviewedBy: userAnswer.reviewedBy,
        reviewedByEvaluator: userAnswer.reviewedByEvaluator,

        // Add this line to include top-level annotations in the detail response
        annotations: userAnswer.annotations || [],
        reviewRequestedAt: userAnswer.reviewRequestedAt,
        reviewAcceptedAt: userAnswer.reviewAssignedAt,
        reviewCompletedAt: userAnswer.reviewCompletedAt,
        updatedAt: userAnswer.updatedAt

      }
    };

    res.status(200).json({
      success: true,
      message: 'Answer analysis retrieved successfully',
      data: responseData
    });

  } catch (error) {
    console.error('Error fetching answer analysis:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch answer analysis',
      error: {
        code: 'FETCH_ANSWER_ANALYSIS_ERROR',
        details: error.message
      }
    });
  }
});




module.exports = router;
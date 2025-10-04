// routes/expertReview.js
const express = require('express');
const router = express.Router();
const UserAnswer = require('../models/UserAnswer');
const ReviewRequest = require('../models/ReviewRequest');
const AiswbQuestion = require('../models/AiswbQuestion');
const MobileUser = require('../models/MobileUser');
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const { generatePresignedUrl, generateAnnotatedImageUrl } = require('../utils/s3');
const path = require('path');

// 1. 📋 Get Pending Review Requests
router.get('/pending', async (req, res) => {
  try {
    const { page = 1, limit = 10, priority } = req.query;

    const filter = {
      requestStatus: { $in: ['pending', 'accepted'] }
    };

    if (priority) {
      filter.priority = priority;
    }

    const skip = (page - 1) * limit;

    const requests = await ReviewRequest.find(filter)
      .populate('userId', 'mobile')
      .populate('questionId', 'question metadata difficultyLevel')
      .populate('answerId', 'answerImages submittedAt attemptNumber evaluation')
      .sort({ requestedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ReviewRequest.countDocuments(filter);

    res.json({
      success: true,
      data: {
        requests,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalRequests: total,
          hasMore: skip + requests.length < total
        }
      }
    });

  } catch (error) {
    console.error('Error fetching pending requests:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// 2. ✅ Accept Review Request
router.post('/:requestId/accept', async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await ReviewRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Review request not found'
      });
    }

    // Check if request is available
    if (!['pending', 'assigned'].includes(request.requestStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Request is not available for acceptance'
      });
    }

    // Mark as assigned
    request.requestStatus = 'assigned';
    request.assignedAt = new Date();
    await request.save();

    // Update answer status
    const answer = await UserAnswer.findById(request.answerId);
    if (answer) {
      answer.reviewStatus = 'review_accepted';
      answer.reviewAssignedAt = request.assignedAt;
      await answer.save();
    }

    res.json({
      success: true,
      message: 'Review request accepted successfully',
      data: {
        requestId: request._id,
        status: request.requestStatus,
        assignedAt: request.assignedAt
      }
    });

  } catch (error) {
    console.error('Error accepting review request:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// 3. ✅ Submit Review
router.post('/:requestId/submit', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { review_result, annotated_images = [], expert_score, expert_remarks } = req.body;

    console.log(`[Review Submit] Starting review submission for requestId: ${requestId}`);

    // Validate required fields
    if (!review_result) {
      console.log('[Review Submit] Validation failed: review_result is missing');
      return res.status(400).json({
        success: false,
        message: 'Review result is required'
      });
    }

    // Validate expert_score
    if (expert_score === undefined || expert_score === null || expert_score === '') {
      console.log('[Review Submit] Validation failed: expert_score is missing');
      return res.status(400).json({
        success: false,
        message: 'Expert score is required'
      });
    }

    const score = parseFloat(expert_score);
    if (isNaN(score) || score < 0) {
      console.log('[Review Submit] Validation failed: expert_score is invalid');
      return res.status(400).json({
        success: false,
        message: 'Expert score must be a valid number greater than or equal to 0'
      });
    }

    // Find and validate request
    const request = await ReviewRequest.findById(requestId);
    if (!request) {
      console.log(`[Review Submit] Request not found for requestId: ${requestId}`);
      return res.status(404).json({
        success: false,
        message: 'Review request not found'
      });
    }

    console.log(`[Review Submit] Found review request with status: ${request.requestStatus}`);

    // Find and validate answer
    const answer = await UserAnswer.findById(request.answerId);
    if (!answer) {
      console.log(`[Review Submit] Answer not found for answerId: ${request.answerId}`);
      return res.status(404).json({
        success: false,
        message: 'Answer not found'
      });
    }

    // Check if answer is in correct status
    if (answer.reviewStatus !== 'review_accepted') {
      console.log(`[Review Submit] Invalid answer status: ${answer.reviewStatus}, expected: review_accepted`);
      return res.status(400).json({
        success: false,
        message: `Answer is not in correct status. Current status: ${answer.reviewStatus}`,
        expectedStatus: 'review_accepted'
      });
    }
    // Check if answer is in correct status
    if (answer.reviewStatus === 'review_completed') {
      console.log(`Review already submitted`);
      return res.status(400).json({
        success: false,
        message: `Review already submitted`,
      });
    }


    console.log('[Review Submit] Processing annotated images...');
    // Process annotated images
    const processedImages = await Promise.all(annotated_images.map(async (image) => {
      const downloadUrl = await generateAnnotatedImageUrl(image.s3Key);
      return {
        s3Key: image.s3Key,
        downloadUrl: downloadUrl,
        uploadedAt: new Date()
      };
    }));
    console.log(`[Review Submit] Processed ${processedImages.length} annotated images`);

    // Update answer with review data
    console.log('[Review Submit] Updating answer with review data...');
    answer.reviewStatus = 'review_completed';
    answer.reviewCompletedAt = new Date();
    
    // Preserve existing feedback structure
    const existingFeedback = answer.feedback || {};
    
    answer.feedback = {
      ...existingFeedback,
      expertReview: {
        result: review_result,
        score: score,
        remarks: expert_remarks,
        annotatedImages: processedImages,
        reviewedAt: new Date()
      }
    };
    
    await answer.save();
    console.log('[Review Submit] Answer updated successfully');

    // Update request status
    console.log('[Review Submit] Updating request status...');
    request.requestStatus = 'completed';
    request.completedAt = new Date();
    request.reviewData = {
      score: score,
      remarks: expert_remarks,
      result: review_result,
      annotatedImages: processedImages
    };
    await request.save();
    console.log('[Review Submit] Request status updated successfully');

    console.log(`[Review Submit] Review submission completed successfully for requestId: ${requestId}`);
    res.json({
      success: true,
      message: 'Review submitted successfully',
      data: {
        requestId: request._id,
        status: request.requestStatus,
        completedAt: request.completedAt,
        review: {
          result: review_result,
          score: expert_score,
          remarks: expert_remarks,
          annotatedImages: processedImages
        }
      }
    });

  } catch (error) {
    console.error('[Review Submit] Error submitting review:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Generate presigned URL for annotated image upload
router.post('/annotated-image-upload-url', async (req, res) => {
  try {
    const { fileName, contentType, clientId, answerId } = req.body;

    // Validate required fields
    if (!fileName || !contentType || !clientId || !answerId) {
      return res.status(400).json({
        success: false,
        message: 'fileName, contentType, clientId, and answerId are required'
      });
    }

    // Generate S3 key for the annotated image
    const fileExtension = path.extname(fileName);
    const s3Key = `/KitabAI/annotated-images/${clientId}/${answerId}/${Date.now()}${fileExtension}`;

    // Generate presigned URL for upload
    const uploadUrl = await generatePresignedUrl(s3Key, contentType);

    res.json({
      success: true,
      data: {
        uploadUrl,
        key: s3Key
      }
    });
  } catch (error) {
    console.error('Error generating upload URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL',
      error: error.message
    });
  }
});

// 5. 🌟 Get List of Questions in "Popular"
router.get('/popular', async (req, res) => {
  try {
    const { clientId, page = 1, limit = 20 } = req.query;

    // Build query filter for popular answers
    const filter = {
      popularityStatus: 'popular',
      publishStatus: 'published',
      submissionStatus: { $in: ['submitted', 'evaluated'] }
    };

    if (clientId) {
      filter.clientId = clientId;
    }

    // Get popular answers with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const popularAnswers = await UserAnswer.find(filter)
      .select('_id questionId userId submittedAt feedback.score evaluation.marks')
      .populate('questionId', 'question metadata.difficultyLevel metadata.keywords')
      .populate('userId', 'mobile')
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalCount = await UserAnswer.countDocuments(filter);

    // Format response data
    const formattedData = popularAnswers.map(answer => ({
      question_id: answer.questionId._id.toString(),
      answer_id: answer._id.toString(),
      user_mobile: answer.userId?.mobile,
      question_text: answer.questionId?.question,
      difficulty_level: answer.questionId?.metadata?.difficultyLevel,
      keywords: answer.questionId?.metadata?.keywords || [],
      score: answer.feedback?.score || answer.evaluation?.marks || 0,
      submitted_at: answer.submittedAt
    }));

    res.json({
      status: 'success',
      data: formattedData,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(totalCount / parseInt(limit)),
        total_count: totalCount,
        per_page: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error fetching popular questions:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message
    });
  }
});

// Get review request by submission ID
router.get('/by-submission/:submissionId', async (req, res) => {
  try {
    const { submissionId } = req.params;

    // Find the review request using the submission ID
    const reviewRequest = await ReviewRequest.findOne({ answerId: submissionId });

    if (!reviewRequest) {
      return res.status(404).json({
        success: false,
        message: 'Review request not found for this submission'
      });
    }

    res.json({
      success: true,
      data: {
        requestId: reviewRequest._id,
        status: reviewRequest.requestStatus,
        reviewData: reviewRequest.reviewData
      }
    });

  } catch (error) {
    console.error('Error fetching review request:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
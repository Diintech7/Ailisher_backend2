// routes/evaluatorReviews.js
const express = require("express");
const router = express.Router();
const ReviewRequest = require("../models/ReviewRequest");
const UserAnswer = require("../models/UserAnswer");
const Evaluator = require("../models/Evaluator");
const { verifyTokenforevaluator } = require("../middleware/auth"); // Assuming evaluators use regular auth
const AiswbQuestion = require("../models/AiswbQuestion");
const SubjectiveTestQuestion = require("../models/SubjectiveTestQuestion");
const {
  generatePresignedUrl,
  generateAnnotatedImageUrl,
} = require("../utils/s3");
const path = require("path");
const Evaluation = require("../models/Evaluation");
const EvaluatorCreditService = require("../services/evaluatorCreditService");
const EvaluatorCreditTransaction = require("../models/EvaluatorCreditTransaction");

// // Get pending review requests for evaluator
// router.get('/pending', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;

//     // Find evaluator to get client access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     if (!evaluator) {
//       return res.status(404).json({
//         success: false,
//         message: 'Evaluator not found'
//       });
//     }

//     const clientIds = evaluator.clientAccess.map(client => client.id);
//     const { page = 1, limit = 10, priority } = req.query;

//     const filter = {
//       clientId: { $in: clientIds },
//       requestStatus: { $in: ['pending', 'assigned'] },
//       $or: [
//         { assignedEvaluator: null },
//         { assignedEvaluator: evaluatorId }
//       ]
//     };

//     if (priority) {
//       filter.priority = priority;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata difficultyLevel')
//       .populate('answerId', 'answerImages submittedAt attemptNumber evaluation')
//       .sort({ requestedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching pending requests:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Accept review request
// router.post('/:requestId/accept', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Check if evaluator has access to this client
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     // Check if request is available
//     if (!['pending', 'assigned'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for acceptance'
//       });
//     }

//     // If already assigned to another evaluator, deny
//     if (request.assignedEvaluator && request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is already assigned to another evaluator'
//       });
//     }

//     // Assign to evaluator
//     await request.assignEvaluator(evaluatorId);

//     res.json({
//       success: true,
//       message: 'Review request accepted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         assignedAt: request.assignedAt
//       }
//     });

//   } catch (error) {
//     console.error('Error accepting review request:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Submit review
// router.post('/:requestId/submit', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;
//     const { score, remarks, strengths = [], improvements = [], suggestions = [] } = req.body;

//     // Validation
//     if (score === undefined || score < 0 || score > 100) {
//       return res.status(400).json({
//         success: false,
//         message: 'Score must be between 0 and 100'
//       });
//     }

//     if (!remarks || !remarks.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: 'Remarks are required'
//       });
//     }

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (!['assigned', 'in_progress'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for review submission'
//       });
//     }

//     // Complete the review
//     const reviewData = {
//       score: parseFloat(score),
//       remarks: remarks.trim(),
//       strengths: strengths.filter(s => s && s.trim()),
//       improvements: improvements.filter(i => i && i.trim()),
//       suggestions: suggestions.filter(s => s && s.trim())
//     };

//     await request.completeReview(reviewData);

//     // Update the original answer with expert review
//     await UserAnswer.findByIdAndUpdate(request.answerId, {
//       reviewStatus: 'review_completed',
//       'evaluation.expertReview': {
//         score: reviewData.score,
//         remarks: reviewData.remarks,
//         strengths: reviewData.strengths,
//         improvements: reviewData.improvements,
//         suggestions: reviewData.suggestions,
//         reviewedBy: evaluatorId,
//         reviewedAt: new Date()
//       }
//     });

//     res.json({
//       success: true,
//       message: 'Review submitted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         completedAt: request.completedAt,
//         score: reviewData.score
//       }
//     });

//   } catch (error) {
//     console.error('Error submitting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Start review (mark as in progress)
// router.post('/:requestId/start', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (request.requestStatus !== 'assigned') {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not in assigned status'
//       });
//     }

//     // Mark as in progress
//     await request.markInProgress();

//     res.json({
//       success: true,
//       message: 'Review started successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus
//       }
//     });

//   } catch (error) {
//     console.error('Error starting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get evaluator's assigned requests
// router.get('/my-assignments', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;
//     const { status, page = 1, limit = 10 } = req.query;

//     const filter = { assignedEvaluator: evaluatorId };
//     if (status) {
//       filter.requestStatus = status;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata')
//       .populate('answerId', 'answerImages submittedAt attemptNumber')
//       .sort({ assignedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching assignments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get detailed request for review
// router.get('/:requestId/details', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId)
//       .populate('userId', 'mobile')
//       .populate('questionId')
//       .populate('answerId');

//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator has access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     res.json({
//       success: true,
//       data: request
//     });

//   } catch (error) {
//     console.error('Error fetching request details:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get pending review requests for evaluator
// router.get('/pending', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;

//     // Find evaluator to get client access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     if (!evaluator) {
//       return res.status(404).json({
//         success: false,
//         message: 'Evaluator not found'
//       });
//     }

//     const clientIds = evaluator.clientAccess.map(client => client.id);
//     const { page = 1, limit = 10, priority } = req.query;

//     const filter = {
//       clientId: { $in: clientIds },
//       requestStatus: { $in: ['pending', 'assigned'] },
//       $or: [
//         { assignedEvaluator: null },
//         { assignedEvaluator: evaluatorId }
//       ]
//     };

//     if (priority) {
//       filter.priority = priority;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata difficultyLevel')
//       .populate('answerId', 'answerImages submittedAt attemptNumber evaluation')
//       .sort({ requestedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching pending requests:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Accept review request
// router.post('/:requestId/accept', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Check if evaluator has access to this client
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     // Check if request is available
//     if (!['pending', 'assigned'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for acceptance'
//       });
//     }

//     // If already assigned to another evaluator, deny
//     if (request.assignedEvaluator && request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is already assigned to another evaluator'
//       });
//     }

//     // Assign to evaluator
//     await request.assignEvaluator(evaluatorId);

//     res.json({
//       success: true,
//       message: 'Review request accepted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         assignedAt: request.assignedAt
//       }
//     });

//   } catch (error) {
//     console.error('Error accepting review request:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Submit review
// router.post('/:requestId/submit', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;
//     const { score, remarks, strengths = [], improvements = [], suggestions = [] } = req.body;

//     // Validation
//     if (score === undefined || score < 0 || score > 100) {
//       return res.status(400).json({
//         success: false,
//         message: 'Score must be between 0 and 100'
//       });
//     }

//     if (!remarks || !remarks.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: 'Remarks are required'
//       });
//     }

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (!['assigned', 'in_progress'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for review submission'
//       });
//     }

//     // Complete the review
//     const reviewData = {
//       score: parseFloat(score),
//       remarks: remarks.trim(),
//       strengths: strengths.filter(s => s && s.trim()),
//       improvements: improvements.filter(i => i && i.trim()),
//       suggestions: suggestions.filter(s => s && s.trim())
//     };

//     await request.completeReview(reviewData);

//     // Update the original answer with expert review
//     await UserAnswer.findByIdAndUpdate(request.answerId, {
//       reviewStatus: 'review_completed',
//       'evaluation.expertReview': {
//         score: reviewData.score,
//         remarks: reviewData.remarks,
//         strengths: reviewData.strengths,
//         improvements: reviewData.improvements,
//         suggestions: reviewData.suggestions,
//         reviewedBy: evaluatorId,
//         reviewedAt: new Date()
//       }
//     });

//     res.json({
//       success: true,
//       message: 'Review submitted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         completedAt: request.completedAt,
//         score: reviewData.score
//       }
//     });

//   } catch (error) {
//     console.error('Error submitting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Start review (mark as in progress)
// router.post('/:requestId/start', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (request.requestStatus !== 'assigned') {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not in assigned status'
//       });
//     }

//     // Mark as in progress
//     await request.markInProgress();

//     res.json({
//       success: true,
//       message: 'Review started successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus
//       }
//     });

//   } catch (error) {
//     console.error('Error starting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get evaluator's assigned requests
// router.get('/my-assignments', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;
//     const { status, page = 1, limit = 10 } = req.query;

//     const filter = { assignedEvaluator: evaluatorId };
//     if (status) {
//       filter.requestStatus = status;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata')
//       .populate('answerId', 'answerImages submittedAt attemptNumber')
//       .sort({ assignedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching assignments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get detailed request for review
// router.get('/:requestId/details', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId)
//       .populate('userId', 'mobile')
//       .populate('questionId')
//       .populate('answerId');

//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator has access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     res.json({
//       success: true,
//       data: request
//     });

//   } catch (error) {
//     console.error('Error fetching request details:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get pending review requests for evaluator
// router.get('/pending', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;

//     // Find evaluator to get client access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     if (!evaluator) {
//       return res.status(404).json({
//         success: false,
//         message: 'Evaluator not found'
//       });
//     }

//     const clientIds = evaluator.clientAccess.map(client => client.id);
//     const { page = 1, limit = 10, priority } = req.query;

//     const filter = {
//       clientId: { $in: clientIds },
//       requestStatus: { $in: ['pending', 'assigned'] },
//       $or: [
//         { assignedEvaluator: null },
//         { assignedEvaluator: evaluatorId }
//       ]
//     };

//     if (priority) {
//       filter.priority = priority;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata difficultyLevel')
//       .populate('answerId', 'answerImages submittedAt attemptNumber evaluation')
//       .sort({ requestedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching pending requests:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Accept review request
// router.post('/:requestId/accept', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Check if evaluator has access to this client
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     // Check if request is available
//     if (!['pending', 'assigned'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for acceptance'
//       });
//     }

//     // If already assigned to another evaluator, deny
//     if (request.assignedEvaluator && request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is already assigned to another evaluator'
//       });
//     }

//     // Assign to evaluator
//     await request.assignEvaluator(evaluatorId);

//     res.json({
//       success: true,
//       message: 'Review request accepted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         assignedAt: request.assignedAt
//       }
//     });

//   } catch (error) {
//     console.error('Error accepting review request:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Submit review
// router.post('/:requestId/submit', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;
//     const { score, remarks, strengths = [], improvements = [], suggestions = [] } = req.body;

//     // Validation
//     if (score === undefined || score < 0 || score > 100) {
//       return res.status(400).json({
//         success: false,
//         message: 'Score must be between 0 and 100'
//       });
//     }

//     if (!remarks || !remarks.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: 'Remarks are required'
//       });
//     }

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (!['assigned', 'in_progress'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for review submission'
//       });
//     }

//     // Complete the review
//     const reviewData = {
//       score: parseFloat(score),
//       remarks: remarks.trim(),
//       strengths: strengths.filter(s => s && s.trim()),
//       improvements: improvements.filter(i => i && i.trim()),
//       suggestions: suggestions.filter(s => s && s.trim())
//     };

//     await request.completeReview(reviewData);

//     // Update the original answer with expert review
//     await UserAnswer.findByIdAndUpdate(request.answerId, {
//       reviewStatus: 'review_completed',
//       'evaluation.expertReview': {
//         score: reviewData.score,
//         remarks: reviewData.remarks,
//         strengths: reviewData.strengths,
//         improvements: reviewData.improvements,
//         suggestions: reviewData.suggestions,
//         reviewedBy: evaluatorId,
//         reviewedAt: new Date()
//       }
//     });

//     res.json({
//       success: true,
//       message: 'Review submitted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         completedAt: request.completedAt,
//         score: reviewData.score
//       }
//     });

//   } catch (error) {
//     console.error('Error submitting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Start review (mark as in progress)
// router.post('/:requestId/start', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (request.requestStatus !== 'assigned') {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not in assigned status'
//       });
//     }

//     // Mark as in progress
//     await request.markInProgress();

//     res.json({
//       success: true,
//       message: 'Review started successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus
//       }
//     });

//   } catch (error) {
//     console.error('Error starting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get evaluator's assigned requests
// router.get('/my-assignments', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;
//     const { status, page = 1, limit = 10 } = req.query;

//     const filter = { assignedEvaluator: evaluatorId };
//     if (status) {
//       filter.requestStatus = status;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata')
//       .populate('answerId', 'answerImages submittedAt attemptNumber')
//       .sort({ assignedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching assignments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get detailed request for review
// router.get('/:requestId/details', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId)
//       .populate('userId', 'mobile')
//       .populate('questionId')
//       .populate('answerId');

//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator has access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     res.json({
//       success: true,
//       data: request
//     });

//   } catch (error) {
//     console.error('Error fetching request details:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get pending review requests for evaluator
// router.get('/pending', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;

//     // Find evaluator to get client access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     if (!evaluator) {
//       return res.status(404).json({
//         success: false,
//         message: 'Evaluator not found'
//       });
//     }

//     const clientIds = evaluator.clientAccess.map(client => client.id);
//     const { page = 1, limit = 10, priority } = req.query;

//     const filter = {
//       clientId: { $in: clientIds },
//       requestStatus: { $in: ['pending', 'assigned'] },
//       $or: [
//         { assignedEvaluator: null },
//         { assignedEvaluator: evaluatorId }
//       ]
//     };

//     if (priority) {
//       filter.priority = priority;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata difficultyLevel')
//       .populate('answerId', 'answerImages submittedAt attemptNumber evaluation')
//       .sort({ requestedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching pending requests:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Accept review request
// router.post('/:requestId/accept', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Check if evaluator has access to this client
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     // Check if request is available
//     if (!['pending', 'assigned'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for acceptance'
//       });
//     }

//     // If already assigned to another evaluator, deny
//     if (request.assignedEvaluator && request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is already assigned to another evaluator'
//       });
//     }

//     // Assign to evaluator
//     await request.assignEvaluator(evaluatorId);

//     res.json({
//       success: true,
//       message: 'Review request accepted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         assignedAt: request.assignedAt
//       }
//     });

//   } catch (error) {
//     console.error('Error accepting review request:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Submit review
// router.post('/:requestId/submit', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;
//     const { score, remarks, strengths = [], improvements = [], suggestions = [] } = req.body;

//     // Validation
//     if (score === undefined || score < 0 || score > 100) {
//       return res.status(400).json({
//         success: false,
//         message: 'Score must be between 0 and 100'
//       });
//     }

//     if (!remarks || !remarks.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: 'Remarks are required'
//       });
//     }

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (!['assigned', 'in_progress'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for review submission'
//       });
//     }

//     // Complete the review
//     const reviewData = {
//       score: parseFloat(score),
//       remarks: remarks.trim(),
//       strengths: strengths.filter(s => s && s.trim()),
//       improvements: improvements.filter(i => i && i.trim()),
//       suggestions: suggestions.filter(s => s && s.trim())
//     };

//     await request.completeReview(reviewData);

//     // Update the original answer with expert review
//     await UserAnswer.findByIdAndUpdate(request.answerId, {
//       reviewStatus: 'review_completed',
//       'evaluation.expertReview': {
//         score: reviewData.score,
//         remarks: reviewData.remarks,
//         strengths: reviewData.strengths,
//         improvements: reviewData.improvements,
//         suggestions: reviewData.suggestions,
//         reviewedBy: evaluatorId,
//         reviewedAt: new Date()
//       }
//     });

//     res.json({
//       success: true,
//       message: 'Review submitted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         completedAt: request.completedAt,
//         score: reviewData.score
//       }
//     });

//   } catch (error) {
//     console.error('Error submitting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Start review (mark as in progress)
// router.post('/:requestId/start', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (request.requestStatus !== 'assigned') {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not in assigned status'
//       });
//     }

//     // Mark as in progress
//     await request.markInProgress();

//     res.json({
//       success: true,
//       message: 'Review started successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus
//       }
//     });

//   } catch (error) {
//     console.error('Error starting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get evaluator's assigned requests
// router.get('/my-assignments', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;
//     const { status, page = 1, limit = 10 } = req.query;

//     const filter = { assignedEvaluator: evaluatorId };
//     if (status) {
//       filter.requestStatus = status;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata')
//       .populate('answerId', 'answerImages submittedAt attemptNumber')
//       .sort({ assignedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching assignments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get detailed request for review
// router.get('/:requestId/details', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId)
//       .populate('userId', 'mobile')
//       .populate('questionId')
//       .populate('answerId');

//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator has access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     res.json({
//       success: true,
//       data: request
//     });

//   } catch (error) {
//     console.error('Error fetching request details:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get pending review requests for evaluator
// router.get('/pending', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;

//     // Find evaluator to get client access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     if (!evaluator) {
//       return res.status(404).json({
//         success: false,
//         message: 'Evaluator not found'
//       });
//     }

//     const clientIds = evaluator.clientAccess.map(client => client.id);
//     const { page = 1, limit = 10, priority } = req.query;

//     const filter = {
//       clientId: { $in: clientIds },
//       requestStatus: { $in: ['pending', 'assigned'] },
//       $or: [
//         { assignedEvaluator: null },
//         { assignedEvaluator: evaluatorId }
//       ]
//     };

//     if (priority) {
//       filter.priority = priority;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata difficultyLevel')
//       .populate('answerId', 'answerImages submittedAt attemptNumber evaluation')
//       .sort({ requestedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching pending requests:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Accept review request
// router.post('/:requestId/accept', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Check if evaluator has access to this client
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     // Check if request is available
//     if (!['pending', 'assigned'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for acceptance'
//       });
//     }

//     // If already assigned to another evaluator, deny
//     if (request.assignedEvaluator && request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is already assigned to another evaluator'
//       });
//     }

//     // Assign to evaluator
//     await request.assignEvaluator(evaluatorId);

//     res.json({
//       success: true,
//       message: 'Review request accepted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         assignedAt: request.assignedAt
//       }
//     });

//   } catch (error) {
//     console.error('Error accepting review request:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Submit review
// router.post('/:requestId/submit', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;
//     const { score, remarks, strengths = [], improvements = [], suggestions = [] } = req.body;

//     // Validation
//     if (score === undefined || score < 0 || score > 100) {
//       return res.status(400).json({
//         success: false,
//         message: 'Score must be between 0 and 100'
//       });
//     }

//     if (!remarks || !remarks.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: 'Remarks are required'
//       });
//     }

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (!['assigned', 'in_progress'].includes(request.requestStatus)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not available for review submission'
//       });
//     }

//     // Complete the review
//     const reviewData = {
//       score: parseFloat(score),
//       remarks: remarks.trim(),
//       strengths: strengths.filter(s => s && s.trim()),
//       improvements: improvements.filter(i => i && i.trim()),
//       suggestions: suggestions.filter(s => s && s.trim())
//     };

//     await request.completeReview(reviewData);

//     // Update the original answer with expert review
//     await UserAnswer.findByIdAndUpdate(request.answerId, {
//       reviewStatus: 'review_completed',
//       'evaluation.expertReview': {
//         score: reviewData.score,
//         remarks: reviewData.remarks,
//         strengths: reviewData.strengths,
//         improvements: reviewData.improvements,
//         suggestions: reviewData.suggestions,
//         reviewedBy: evaluatorId,
//         reviewedAt: new Date()
//       }
//     });

//     res.json({
//       success: true,
//       message: 'Review submitted successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus,
//         completedAt: request.completedAt,
//         score: reviewData.score
//       }
//     });

//   } catch (error) {
//     console.error('Error submitting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Start review (mark as in progress)
// router.post('/:requestId/start', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId);
//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator is assigned
//     if (!request.assignedEvaluator || request.assignedEvaluator.toString() !== evaluatorId) {
//       return res.status(403).json({
//         success: false,
//         message: 'You are not assigned to this request'
//       });
//     }

//     // Check status
//     if (request.requestStatus !== 'assigned') {
//       return res.status(400).json({
//         success: false,
//         message: 'Request is not in assigned status'
//       });
//     }

//     // Mark as in progress
//     await request.markInProgress();

//     res.json({
//       success: true,
//       message: 'Review started successfully',
//       data: {
//         requestId: request._id,
//         status: request.requestStatus
//       }
//     });

//   } catch (error) {
//     console.error('Error starting review:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get evaluator's assigned requests
// router.get('/my-assignments', verifyToken, async (req, res) => {
//   try {
//     const evaluatorId = req.user.id;
//     const { status, page = 1, limit = 10 } = req.query;

//     const filter = { assignedEvaluator: evaluatorId };
//     if (status) {
//       filter.requestStatus = status;
//     }

//     const skip = (page - 1) * limit;

//     const requests = await ReviewRequest.find(filter)
//       .populate('userId', 'mobile')
//       .populate('questionId', 'question metadata')
//       .populate('answerId', 'answerImages submittedAt attemptNumber')
//       .sort({ assignedAt: -1 })
//       .skip(skip)
//       .limit(parseInt(limit));

//     const total = await ReviewRequest.countDocuments(filter);

//     res.json({
//       success: true,
//       data: {
//         requests,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages: Math.ceil(total / limit),
//           totalRequests: total,
//           hasMore: skip + requests.length < total
//         }
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching assignments:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

// // Get detailed request for review
// router.get('/:requestId/details', verifyToken, async (req, res) => {
//   try {
//     const { requestId } = req.params;
//     const evaluatorId = req.user.id;

//     const request = await ReviewRequest.findById(requestId)
//       .populate('userId', 'mobile')
//       .populate('questionId')
//       .populate('answerId');

//     if (!request) {
//       return res.status(404).json({
//         success: false,
//         message: 'Review request not found'
//       });
//     }

//     // Verify evaluator has access
//     const evaluator = await Evaluator.findById(evaluatorId);
//     const hasAccess = evaluator.clientAccess.some(client => client.id === request.clientId);

//     if (!hasAccess) {
//       return res.status(403).json({
//         success: false,
//         message: 'Access denied for this client'
//       });
//     }

//     res.json({
//       success: true,
//       data: request
//     });

//   } catch (error) {
//     console.error('Error fetching request details:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Internal server error',
//       error: error.message
//     });
//   }
// });

//evaluator pending requests

//evaluator profile

router.get("/profile", verifyTokenforevaluator, async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;

    // Get evaluator to check client access
    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: "Evaluator not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "successfull retrieved profile",
      evaluator: evaluator,
    });
  } catch (error) {
    console.log(error);
  }
});

router.get("/pending-reviews", verifyTokenforevaluator, async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;

    // Get evaluator to check client access
    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: "Evaluator not found",
      });
    }

    // Query parameters for pagination and filtering
    const { page = 1, limit = 10, clientId } = req.query;
    const skip = (page - 1) * limit;

    // Build filter object
    const filter = {
      reviewStatus: "review_pending",
      reviewedByEvaluator: evaluatorId,
    };

    // Get pending reviews with pagination
    const pendingReviews = await UserAnswer.find(filter)
      .populate("userId", "mobile name")
      .populate("setId", "name")
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Attach question documents dynamically based on testType
    for (const review of pendingReviews) {
      try {
        if (review.testType === "aiswb") {
          const question = await AiswbQuestion.findById(review.questionId)
            .select(
              "question detailedAnswer metadata languageMode evaluationMode evaluationType setId"
            )
            .lean();
          if (question) review.questionId = question;
        } else if (review.testType === "subjective") {
          const question = await SubjectiveTestQuestion.findById(
            review.questionId
          )
            .select(
              "question detailedAnswer metadata languageMode evaluationMode evaluationType setId"
            )
            .lean();
          if (question) review.questionId = question;
        } else {
          const question = await AiswbQuestion.findById(review.questionId)
            .select(
              "question detailedAnswer metadata languageMode evaluationMode evaluationType setId"
            )
            .lean();
          if (question) review.questionId = question;
        }
      } catch (_) {
        /* ignore populate errors per item */
      }
    }

    // Get total count for pagination
    const total = await UserAnswer.countDocuments(filter);
    for (const review of pendingReviews) {
      if (review.annotations && Array.isArray(review.annotations)) {
        for (const annotation of review.annotations) {
          if (annotation.s3Key) {
            annotation.downloadUrl = await generateAnnotatedImageUrl(
              annotation.s3Key
            );
          }
        }
      }
    }

    // Format response data
    const formattedReviews = pendingReviews.map((review) => ({
      _id: review._id,
      userId: review.userId,
      questionId: review.questionId,
      setId: review.setId,
      clientId: review.clientId,
      attemptNumber: review.attemptNumber,
      answerImages: review.answerImages,
      textAnswer: review.textAnswer,
      reviewStatus: review.reviewStatus,
      reviewedByEvaluator: review.reviewedByEvaluator,
      requestId: review.requestID,
      requestnote: review.requestnote,
      evaluation: review.evaluation,
      metadata: review.metadata,
      annotations: review.annotations || [],
      reviewRequestedAt: review.reviewRequestedAt,
      reviewAssignedAt: review.reviewAssignedAt,
      reviewCompletedAt: review.reviewCompletedAt,
    }));

    res.json({
      success: true,
      message: "Pending reviews retrieved successfully",
      data: {
        reviews: formattedReviews,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalReviews: total,
          hasMore: skip + pendingReviews.length < total,
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching pending reviews:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

//evaluator accepted requests
router.get("/accepted-reviews", verifyTokenforevaluator, async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;

    // Get evaluator to check client access
    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: "Evaluator not found",
      });
    }

    // Query parameters for pagination and filtering
    const { page = 1, limit = 10, clientId } = req.query;
    const skip = (page - 1) * limit;

    // Build filter object - filter by review_accepted status
    const filter = {
      reviewStatus: "review_accepted",
      reviewedByEvaluator: evaluatorId,
    };

    // Get accepted reviews with pagination
    const acceptedReviews = await UserAnswer.find(filter)
      .populate("userId", "mobile name")
      .populate("setId", "name")
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Attach question documents dynamically based on testType
    for (const review of acceptedReviews) {
      try {
        if (review.testType === "aiswb") {
          const question = await AiswbQuestion.findById(review.questionId)
            .select(
              "question detailedAnswer metadata languageMode evaluationMode evaluationType setId"
            )
            .lean();
          if (question) review.questionId = question;
        } else if (review.testType === "subjective") {
          const question = await SubjectiveTestQuestion.findById(
            review.questionId
          )
            .select(
              "question detailedAnswer metadata languageMode evaluationMode evaluationType setId"
            )
            .lean();
          if (question) review.questionId = question;
        } else {
          const question = await AiswbQuestion.findById(review.questionId)
            .select(
              "question detailedAnswer metadata languageMode evaluationMode evaluationType setId"
            )
            .lean();
          if (question) review.questionId = question;
        }
      } catch (_) {
        /* ignore populate errors per item */
      }
    }

    // Get total count for pagination
    const total = await UserAnswer.countDocuments(filter);
    for (const review of acceptedReviews) {
      if (review.annotations && Array.isArray(review.annotations)) {
        for (const annotation of review.annotations) {
          if (annotation.s3Key) {
            annotation.downloadUrl = await generateAnnotatedImageUrl(
              annotation.s3Key
            );
          }
        }
      }
    }
    const formattedReviews = acceptedReviews.map((review) => ({
      _id: review._id,
      userId: review.userId,
      questionId: review.questionId,
      setId: review.setId,
      clientId: review.clientId,
      attemptNumber: review.attemptNumber,
      answerImages: review.answerImages,
      textAnswer: review.textAnswer,
      submittedAt: review.submittedAt,
      reviewStatus: review.reviewStatus,
      requestId: review.requestID,
      requestnote: review.requestnote,
      evaluation: review.evaluation,
      metadata: review.metadata,
      annotations: review.annotations || [],
      reviewRequestedAt: review.reviewRequestedAt,
      reviewAssignedAt: review.reviewAssignedAt,
    }));

    res.json({
      success: true,
      message: "Accepted reviews retrieved successfully",
      data: {
        reviews: formattedReviews,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalReviews: total,
          hasMore: skip + acceptedReviews.length < total,
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching accepted reviews:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

//evaluator completed requests
router.get("/completed-reviews", verifyTokenforevaluator, async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;

    // Get evaluator to check client access
    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: "Evaluator not found",
      });
    }

    // Query parameters for pagination and filtering
    const { page = 1, limit = 10, clientId } = req.query;
    const skip = (page - 1) * limit;

    // Build filter object - filter by review_completed status
    const filter = {
      reviewStatus: "review_completed",
    };

    // Get completed reviews with pagination
    const completedReviews = await UserAnswer.find(filter)
      .populate("userId", "mobile name")
      .populate("setId", "name")
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Attach question documents dynamically based on testType
    for (const review of completedReviews) {
      try {
        if (review.testType === "aiswb") {
          const question = await AiswbQuestion.findById(review.questionId)
            .select(
              "question detailedAnswer metadata languageMode evaluationMode evaluationType setId"
            )
            .lean();
          if (question) review.questionId = question;
        } else if (review.testType === "subjective") {
          const question = await SubjectiveTestQuestion.findById(
            review.questionId
          )
            .select(
              "question detailedAnswer metadata languageMode evaluationMode evaluationType setId"
            )
            .lean();
          if (question) review.questionId = question;
        } else {
          const question = await AiswbQuestion.findById(review.questionId)
            .select(
              "question detailedAnswer metadata languageMode evaluationMode evaluationType setId"
            )
            .lean();
          if (question) review.questionId = question;
        }
      } catch (_) {
        /* ignore populate errors per item */
      }
    }

    // Get total count for pagination
    const total = await UserAnswer.countDocuments(filter);
    for (const review of completedReviews) {
      if (review.annotations && Array.isArray(review.annotations)) {
        for (const annotation of review.annotations) {
          if (annotation.s3Key) {
            annotation.downloadUrl = await generateAnnotatedImageUrl(
              annotation.s3Key
            );
          }
        }
      }
      if (review.feedback.expertReview.annotatedImages) {
        for (const image of review.feedback.expertReview.annotatedImages) {
          image.downloadUrl = await generateAnnotatedImageUrl(image.s3Key);
        }
      }
    }
    // Format response data
    const formattedReviews = completedReviews.map((review) => ({
      _id: review._id,
      userId: review.userId,
      questionId: review.questionId,
      setId: review.setId,
      clientId: review.clientId,
      attemptNumber: review.attemptNumber,
      answerImages: review.answerImages,
      textAnswer: review.textAnswer,
      submittedAt: review.submittedAt,
      reviewStatus: review.reviewStatus,
      requestId: review.requestID,
      requestnote: review.requestnote,
      evaluation: review.evaluation,
      metadata: review.metadata,
      feedback: review.feedback,
      annotations: review.annotations,
      reviewRequestedAt: review.reviewRequestedAt,
      reviewAssignedAt: review.reviewAssignedAt,
      reviewCompletedAt: review.reviewCompletedAt,
    }));

    res.json({
      success: true,
      message: "Completed reviews retrieved successfully",
      data: {
        reviews: formattedReviews,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalReviews: total,
          hasMore: skip + completedReviews.length < total,
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching completed reviews:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// 2. ✅ Accept Review Request
router.post("/:requestId/accept", verifyTokenforevaluator, async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;

    // Get evaluator to check client access
    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: "Evaluator not found",
      });
    }
    const { requestId } = req.params;

    const request = await ReviewRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Review request not found",
      });
    }

    // Check if request is available
    if (!["pending", "assigned"].includes(request.requestStatus)) {
      return res.status(400).json({
        success: false,
        message: "Request is not available for acceptance",
      });
    }

    // Mark as assigned
    request.requestStatus = "assigned";
    request.assignedAt = new Date();
    await request.save();

    // Update answer status
    const answer = await UserAnswer.findById(request.answerId);
    if (answer) {
      answer.reviewStatus = "review_accepted";
      answer.reviewAssignedAt = request.assignedAt;
      // ensure evaluator-based filters work for pending/accepted lists
      answer.reviewedByEvaluator = evaluatorId;
      await answer.save();
    }

    res.json({
      success: true,
      message: "Review request accepted successfully",
      data: {
        requestId: request._id,
        status: request.requestStatus,
        assignedAt: request.assignedAt,
      },
    });
  } catch (error) {
    console.error("Error accepting review request:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Generate presigned URL for annotated image upload
router.post("/annotated-image-upload-url", async (req, res) => {
  try {
    const { fileName, contentType, clientId, answerId } = req.body;

    // Validate required fields
    if (!fileName || !contentType || !clientId || !answerId) {
      return res.status(400).json({
        success: false,
        message: "fileName, contentType, clientId, and answerId are required",
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
        key: s3Key,
      },
    });
  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
      error: error.message,
    });
  }
});

router.post("/publishwithannotation", async (req, res) => {
  try {
    const { answerId, annotatedImageKey } = req.body;
    console.log(req.body);
    if (!answerId || !annotatedImageKey) {
      return res.status(400).json({
        success: false,
        message:
          "answerId, annotatedImageKey, feedback, and evaluation are required",
      });
    }

    const userAnswer = await UserAnswer.findById(answerId);
    console.log(userAnswer);
    if (!userAnswer) {
      return res
        .status(404)
        .json({ success: false, message: "UserAnswer not found" });
    }

    // Dynamically populate question based on testType
    let question;
    if (userAnswer.testType) {
      if (userAnswer.testType === "aiswb") {
        const AiswbQuestion = require("../models/AiswbQuestion");
        question = await AiswbQuestion.findById(userAnswer.questionId);
      } else if (userAnswer.testType === "subjective") {
        const SubjectiveTestQuestion = require("../models/SubjectiveTestQuestion");
        question = await SubjectiveTestQuestion.findById(userAnswer.questionId);
      } else {
        const AiswbQuestion = require("../models/AiswbQuestion");
        question = await AiswbQuestion.findById(userAnswer.questionId);
      }
    } 

    console.log(question.evaluationMode);
    console.log(question.evaluationType);
    if (
      !question ||
      question.evaluationMode !== "manual" ||
      question.evaluationType !== "with annotation"
    ) {
      return res.status(400).json({
        success: false,
        message: "This answer cannot be published with an annotation.",
      });
    }

    const downloadUrl = await generateAnnotatedImageUrl(annotatedImageKey);
    console.log(downloadUrl);
    userAnswer.annotations.push({
      s3Key: annotatedImageKey,
      downloadUrl: downloadUrl,
      uploadedAt: new Date(),
    });

    userAnswer.publishStatus = "published";
    userAnswer.submissionStatus = "evaluated";
    userAnswer.evaluatedAt = new Date();

     await userAnswer.save();

     // Check if evaluation already exists
     const existingEvaluation = await Evaluation.findOne({
       submissionId: answerId,
     });

     let evaluationRecord;
     if (!existingEvaluation) {
       // Create new evaluation record
       const newEvaluation = new Evaluation({
         submissionId: userAnswer._id,
         questionId: userAnswer.questionId,
         userId: userAnswer.userId,
         clientId: userAnswer.clientId,
         evaluatorId: userAnswer.reviewedByEvaluator,
         evaluationMode: question.evaluationMode || "manual",
         evaluation: userAnswer.evaluation || {},
         hindiEvaluation: userAnswer.hindiEvaluation || {},
         annotations: userAnswer.annotations || [],
       });

       await newEvaluation.save();
       evaluationRecord = newEvaluation;
       console.log(
         "✅ Evaluation record created for AISWB submission:",
         newEvaluation._id
       );
     } else {
       // Update existing evaluation
       existingEvaluation.evaluation = userAnswer.evaluation || {};
       existingEvaluation.hindiEvaluation = userAnswer.hindiEvaluation || {};
       existingEvaluation.annotations = userAnswer.annotations || [];
       existingEvaluation.evaluationMode = question.evaluationMode || "manual";

       await existingEvaluation.save();
       evaluationRecord = existingEvaluation;
       console.log(
         "✅ Evaluation record updated for AISWB submission:",
         existingEvaluation._id
       );
     }

    // 🎉 Reward evaluator with 5 credits for completing evaluation (idempotent)
    if (userAnswer.reviewedByEvaluator && evaluationRecord) {
      try {
        const creditResult = await EvaluatorCreditService.awardCreditForEvaluation(
          userAnswer.reviewedByEvaluator,
          evaluationRecord._id,
          answerId,
          5
        );
        if (creditResult?.alreadyAwarded) {
          console.log("ℹ️ [PUBLISH ENDPOINT] Credit already awarded for this submission; skipping duplicate award.");
        }
      } catch (creditError) {
        // If unique index prevents duplicate, log and continue
        const dup = /duplicate key/i.test(creditError?.message || '');
        if (dup) {
          console.log("ℹ️ [PUBLISH ENDPOINT] Duplicate credit prevented by unique index.");
        } else {
          console.error("❌ [PUBLISH ENDPOINT] Credit error details:", {
            evaluatorId: userAnswer.reviewedByEvaluator,
            evaluationId: evaluationRecord._id,
            error: creditError.message,
            stack: creditError.stack
          });
        }
      }
    } else {
      console.log(`⚠️ [PUBLISH ENDPOINT] evaluationRecord: ${evaluationRecord ? 'exists' : 'missing'}`);
    }

    res.json({
      success: true,
      message:
        "Annotation saved, evaluation data saved, and answer published successfully.",
      data: {
        userAnswer: {
          _id: userAnswer._id,
          publishStatus: userAnswer.publishStatus,
          submissionStatus: userAnswer.submissionStatus,
          evaluatedAt: userAnswer.evaluatedAt,
          evaluation: userAnswer.evaluation,
          hindiEvaluation: userAnswer.hindiEvaluation,
          annotations: userAnswer.annotations,
        },
        creditsAwarded: userAnswer.reviewedByEvaluator ? 5 : 0,
        message: userAnswer.reviewedByEvaluator 
          ? "Evaluator rewarded with 5 credits for completing evaluation!" 
          : "No evaluator assigned - no credits awarded"
      },
    });
  } catch (error) {
    console.error("Error in /publishwithannotation:", error);
    res.status(500).json({
      success: false,
      message: "Failed to publish annotation.",
      error: error.message,
    });
  }
});

// Edit evaluator profile
router.patch("/profile", verifyTokenforevaluator, async (req, res) => {
  try {
    const evaluatorId = req.evaluator._id;
    const allowedFields = [
      "name",
      "currentcity",
      "subjectMatterExpert",
      "instituteworkedwith",
      "examFocus",
      "experience",
    ];
    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid fields provided for update.",
      });
    }
    const updatedEvaluator = await Evaluator.findByIdAndUpdate(
      evaluatorId,
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!updatedEvaluator) {
      return res.status(404).json({
        success: false,
        message: "Evaluator not found.",
      });
    }
    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      evaluator: updatedEvaluator,
    });
  } catch (error) {
    console.error("Error updating evaluator profile:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile.",
      error: error.message,
    });
  }
});

module.exports = router;

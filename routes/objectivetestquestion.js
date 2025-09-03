const express = require('express');
const router = express.Router();
const objectivetestquestionController = require('../controllers/objectivetestquestion');
const { verifyToken } = require('../middleware/auth');
const { authenticateMobileUser } = require('../middleware/mobileAuth');

router.get('/mobile/:testId',authenticateMobileUser, objectivetestquestionController.getQuestionsByTestForMobile);
// Apply authentication middleware to all routes
// Create a new question
router.post('/:testId',verifyToken, objectivetestquestionController.createQuestion);

// Get all questions for a specific test
router.get('/:testId',verifyToken, objectivetestquestionController.getQuestionsByTest);

// Get a specific question by ID
router.get('/:questionId',verifyToken, objectivetestquestionController.getQuestionById);

// Update a question
router.put('/:questionId',verifyToken, objectivetestquestionController.updateQuestion);

// Delete a question
router.delete('/test/:id/:questionId',verifyToken, objectivetestquestionController.deleteQuestion);

// Record answer attempt
router.post('/:questionId/answer',verifyToken, objectivetestquestionController.recordAnswer);

module.exports = router;
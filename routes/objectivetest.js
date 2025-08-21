const express = require('express');
const router = express.Router();
const testController = require('../controllers/objectivetestcontroller');
const { verifyToken } = require('../middleware/auth');
const { authenticateMobileUser } = require('../middleware/mobileAuth');

// Mobile route (no auth required)
router.get('/get-test', authenticateMobileUser, testController.getAllTestsForMobile);

// Start test (mobile route)
router.post('/:testId/start', authenticateMobileUser, testController.startTest);

// Submit test with all answers
router.post('/:testId/submit', authenticateMobileUser, testController.submitTest);

// Get attempt status and history (mobile routes)
router.get('/:testId/attempt-status', authenticateMobileUser, testController.getCurrentAttemptStatus);
router.get('/:testId/history', authenticateMobileUser, testController.getUserTestHistory);

router.get('/:testId/results',authenticateMobileUser, testController.getUserTestResults);



// Apply authentication middleware to all routes
router.use(verifyToken);

// Get presigned URL for image upload
router.post('/upload-image', testController.uploadImage);

// Create a new test
router.post('/', testController.createTest);

// Get all tests
router.get('/', testController.getAllTests);

// Get test analytics (for admin/client)
router.get('/:testId/analytics', testController.getTestAnalytics);

// Get a specific test by ID
router.get('/:id', testController.getTest);

// Update a test
router.put('/:id', testController.updateTest);

// Toggle isEnabled for a test
router.patch('/:id', testController.toggleIsEnabled);

// Delete a test
router.delete('/:id', testController.deleteTest);

module.exports = router; 
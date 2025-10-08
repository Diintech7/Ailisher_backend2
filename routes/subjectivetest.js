const express = require('express');
const router = express.Router();
const testController = require('../controllers/subjectivetestcontroller');
const { verifyToken } = require('../middleware/auth');
const { authenticateMobileUser } = require('../middleware/mobileAuth');

router.get('/get-test',authenticateMobileUser,testController.getAllTestsForMobile);

// Get presigned URL for image upload
router.post('/upload-image',verifyToken, testController.uploadImage);

// Create a new test
router.post('/', verifyToken, testController.createTest);

// Get all tests
router.get('/', verifyToken, testController.getAllTests);

// Get a specific test by ID
router.get('/get-test/:id', authenticateMobileUser, testController.getTest);

// Update a test
router.put('/:id', verifyToken, testController.updateTest);

//toggle test status
router.patch('/:id', verifyToken, testController.toggleIsEnabled);

// Delete a test
router.delete('/:id', verifyToken, testController.deleteTest);

// // Get a specific test by ID
router.get('/:id', verifyToken, testController.getTest);

// Copy a test
router.post('/:id/copy',verifyToken, testController.copyTest);

// In your routes
router.post('/tests/:testId/start', authenticateMobileUser, testController.startTest);

router.post('/tests/:testId/submit', authenticateMobileUser, testController.submitTest);

router.post('/tests/:testId/end', authenticateMobileUser, testController.endTest);

module.exports = router;


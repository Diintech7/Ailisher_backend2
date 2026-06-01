const express = require('express');
const router = express.Router();
const classroomExamController = require('../controllers/classroomExamController');
const { verifyToken } = require('../middleware/auth');
const { authenticateMobileUser } = require('../middleware/mobileAuth');

// Support both Web and Mobile app token authentication
const authenticateWebOrMobileUser = (req, res, next) => {
  const isMobile = req.params.clientId || req.clientId || req.originalUrl.includes('/mobile/');
  if (isMobile) {
    return authenticateMobileUser(req, res, next);
  } else {
    return verifyToken(req, res, next);
  }
};

// All routes require valid token
router.use(authenticateWebOrMobileUser);

// List all available exams
router.get('/', classroomExamController.getExams);

// Get specific exam tree details (loads cached or syncs dynamically)
router.get('/:examId', classroomExamController.getExamTree);

// Force sync details from Vectorize API
router.post('/:examId/sync', classroomExamController.syncExamTree);

module.exports = router;

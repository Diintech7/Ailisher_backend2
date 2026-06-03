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

// Sequential lazy-load routes
router.get('/:examId/papers', classroomExamController.getPapers);
router.get('/:examId/papers/:paperId/subjects', classroomExamController.getSubjects);
router.get('/:examId/subjects/:subjectId/chapters', classroomExamController.getChapters);
router.get('/:examId/chapters/:chapterId/topics', classroomExamController.getTopics);
router.get('/:examId/topics/:topicId/subtopics', classroomExamController.getSubtopics);
router.get('/:examId/subtopics/:subtopicId', classroomExamController.getSubtopicDetails);
router.get('/:examId/subtopics/:subtopicId/reels', classroomExamController.getSubtopicReels);

// CRUD Sync routes
router.post('/:examId/papers/:paperId/subjects', classroomExamController.createSubject);
router.post('/:examId/subjects/:subjectId/chapters', classroomExamController.createChapter);
router.post('/:examId/chapters/:chapterId/topics', classroomExamController.createTopic);
router.post('/:examId/topics/:topicId/subtopics', classroomExamController.createSubtopic);

// AI Generation routes
router.post('/:examId/subtopics/:subtopicId/generate-notes', classroomExamController.generateNotes);
router.post('/:examId/subtopics/:subtopicId/generate-reel', classroomExamController.generateReel);

module.exports = router;

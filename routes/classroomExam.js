const express = require('express');
const router = express.Router();
const classroomExamController = require('../controllers/classroomExamController');
const { verifyToken } = require('../middleware/auth');
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

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

// Create a new exam
router.post('/', classroomExamController.createExam);

// ======================================================
// 📊 AI PYQs Routes
// ======================================================
router.get('/pyq-sets', classroomExamController.getPyqSets);
router.post('/pyq-sets', classroomExamController.createPyqSet);
router.post('/pyq-sets/:pyqSetId/upload-pdf', upload.single('file'), classroomExamController.uploadPyqPdf);
router.get('/pyq-sets/:pyqSetId/questions', classroomExamController.getPyqQuestions);
router.post('/pyqs/:pyqSetId/generate-transcript', classroomExamController.generatePyqTranscript);
router.get('/pyq-sets/:pyqSetId/reels', classroomExamController.getPyqReels);
router.delete('/pyq-sets/reels/:reelId', classroomExamController.deletePyqReel);

// ======================================================
// 📰 AI Current Affairs Routes
// ======================================================
router.get('/current-affairs', classroomExamController.getCurrentAffairs);
router.post('/current-affairs', classroomExamController.createCurrentAffair);
router.put('/current-affairs/:caTopicId', classroomExamController.updateCurrentAffair);
router.post('/current-affairs/:caTopicId/upload-pdf', upload.single('file'), classroomExamController.uploadCurrentAffairPdf);
router.post('/current-affairs/:caTopicId/generate-transcript', classroomExamController.generateCurrentAffairTranscript);
router.get('/current-affairs/:caTopicId/reels', classroomExamController.getCurrentAffairReels);

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

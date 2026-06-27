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

// ======================================================
// 🔓 Public APIs (No Authentication Required)
// ======================================================
router.get('/public/subtopics/:subtopicId/reels', classroomExamController.getPublicSubtopicReels);
router.get('/tts/speak', classroomExamController.streamTTS);

// All other routes require valid token
router.use(authenticateWebOrMobileUser);

// ======================================================
// 📰 AI Current Affairs Routes (User/Mobile Only)
// ======================================================
router.get('/current-affairs/reels-feed', classroomExamController.getDailyReelsFeed);
router.get('/current-affairs', classroomExamController.getCurrentAffairs);
router.get('/current-affairs/:caTopicId/reels', classroomExamController.getCurrentAffairReels);

// ======================================================
// 📊 AI PYQs Routes (User/Mobile Only)
// ======================================================
router.get('/pyq-sets', classroomExamController.getPyqSets);
router.get('/pyq-sets/:pyqSetId/questions', classroomExamController.getPyqQuestions);
router.get('/pyq-sets/:pyqSetId/reels', classroomExamController.getPyqReels);
router.post('/pyq-sets/:pyqSetId/chat', classroomExamController.chatWithPyqSet);
router.get('/pyq-sets/:pyqSetId/chat/history', classroomExamController.getPyqChatHistory);
router.delete('/pyq-sets/:pyqSetId/chat/history', classroomExamController.clearPyqChatHistory);

// ======================================================
// 🎓 Classroom Exams Routes (User/Mobile Only)
// ======================================================
router.get('/', classroomExamController.getExams);
router.get('/exams', classroomExamController.getExams);

router.get('/:examId', classroomExamController.getExamTree);
router.get('/exams/:examId', classroomExamController.getExamTree);

router.get('/:examId/history', classroomExamController.getStudyHistory);
router.get('/exams/:examId/history', classroomExamController.getStudyHistory);

// ======================================================
// 📄 Papers Routes (User/Mobile Only)
// ======================================================
router.get('/:examId/papers', classroomExamController.getPapers);
router.get('/exams/:examId/papers', classroomExamController.getPapers);

router.get('/:examId/papers/:paperId/subjects', classroomExamController.getSubjects);
router.get('/papers/:paperId/subjects', classroomExamController.getSubjects);

router.post('/papers/:paperId/chat', classroomExamController.chatWithPaper);
router.get('/papers/:paperId/chat/history', classroomExamController.getPaperChatHistory);
router.delete('/papers/:paperId/chat/history', classroomExamController.clearPaperChatHistory);

// ======================================================
// 📚 Subjects Routes (User/Mobile Only)
// ======================================================
router.get('/:examId/subjects/:subjectId/chapters', classroomExamController.getChapters);
router.get('/subjects/:subjectId/chapters', classroomExamController.getChapters);

// ======================================================
// 📁 Chapters Routes (User/Mobile Only)
// ======================================================
router.get('/:examId/chapters/:chapterId/topics', classroomExamController.getTopics);
router.get('/chapters/:chapterId/topics', classroomExamController.getTopics);

// ======================================================
// 🏷️ Topics Routes (User/Mobile Only)
// ======================================================
router.get('/:examId/topics/:topicId/subtopics', classroomExamController.getSubtopics);
router.get('/topics/:topicId/subtopics', classroomExamController.getSubtopics);

router.get('/topics/:topicId/download-notes-pdf', classroomExamController.downloadTopicNotesPdf);
router.post('/topics/:topicId/quiz/generate', classroomExamController.generateTopicQuiz);
router.get('/topics/:topicId/reels', classroomExamController.getTopicReels);

// ======================================================
// 📝 Subtopics Routes (User/Mobile Only)
// ======================================================
router.get('/:examId/subtopics/:subtopicId', classroomExamController.getSubtopicDetails);
router.get('/subtopics/:subtopicId', classroomExamController.getSubtopicDetails);

router.get('/subtopics/:subtopicId/download-notes-pdf', classroomExamController.downloadSubtopicNotesPdf);
router.post('/subtopics/:subtopicId/quiz/generate', classroomExamController.generateSubtopicQuiz);

router.get('/:examId/subtopics/:subtopicId/reels', classroomExamController.getSubtopicReels);
router.get('/subtopics/:subtopicId/reels', classroomExamController.getSubtopicReels);

// ======================================================
// 🎙️ Text-to-Speech (TTS) Routes (User/Mobile Only)
// ======================================================
router.post('/tts/speak', classroomExamController.generateTTS);

module.exports = router;

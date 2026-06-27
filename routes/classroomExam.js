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

// ======================================================
// 🔓 Public APIs (No Authentication Required)
// ======================================================
router.get('/public/subtopics/:subtopicId/reels', classroomExamController.getPublicSubtopicReels);
router.get('/tts/speak', classroomExamController.streamTTS);

// All other routes require valid token
router.use(authenticateWebOrMobileUser);

// ======================================================
// 📰 AI Current Affairs Routes
// ======================================================
router.get('/current-affairs/reels-feed', classroomExamController.getDailyReelsFeed);
router.get('/current-affairs', classroomExamController.getCurrentAffairs);
router.post('/current-affairs', classroomExamController.createCurrentAffair);
router.put('/current-affairs/:caTopicId', classroomExamController.updateCurrentAffair);
router.delete('/current-affairs/:caTopicId', classroomExamController.deleteCurrentAffair);
router.post('/current-affairs/:caTopicId/upload-pdf', upload.single('file'), classroomExamController.uploadCurrentAffairPdf);
router.post('/current-affairs/:caTopicId/generate-transcript', classroomExamController.generateCurrentAffairTranscript);
router.get('/current-affairs/:caTopicId/reels', classroomExamController.getCurrentAffairReels);
router.post('/current-affairs/:caTopicId/reels', classroomExamController.createCurrentAffairReel);
router.patch('/current-affairs/reels/:reelId/status', classroomExamController.toggleCurrentAffairReelStatus);
router.delete('/current-affairs/reels/:reelId', classroomExamController.deleteCurrentAffairReel);

// ======================================================
// 📊 AI PYQs Routes
// ======================================================
router.get('/pyq-sets', classroomExamController.getPyqSets);
router.post('/pyq-sets', classroomExamController.createPyqSet);
router.put('/pyq-sets/:pyqSetId', classroomExamController.updatePyqSet);
router.delete('/pyq-sets/:pyqSetId', classroomExamController.deletePyqSet);
router.post('/pyq-sets/:pyqSetId/reset', classroomExamController.resetPyqSet);
router.post('/pyq-sets/:pyqSetId/upload-pdf', upload.single('file'), classroomExamController.uploadPyqPdf);
router.get('/pyq-sets/:pyqSetId/questions', classroomExamController.getPyqQuestions);
router.delete('/pyq-sets/questions/:questionId', classroomExamController.deletePyqQuestion);
router.post('/pyq-sets/:pyqSetId/generate-overview', classroomExamController.generatePyqOverview);
router.get('/pyq-sets/:pyqSetId/reels', classroomExamController.getPyqReels);
router.delete('/pyq-sets/reels/:reelId', classroomExamController.deletePyqReel);
router.post('/pyq-sets/:pyqSetId/vectorize', classroomExamController.vectorizePyqSet);
router.post('/pyq-sets/:pyqSetId/chat', classroomExamController.chatWithPyqSet);
router.get('/pyq-sets/:pyqSetId/chat/history', classroomExamController.getPyqChatHistory);
router.delete('/pyq-sets/:pyqSetId/chat/history', classroomExamController.clearPyqChatHistory);
router.post('/pyqs/:pyqSetId/generate-transcript', classroomExamController.generatePyqTranscript);
router.post('/pyq-sets/:pyqSetId/generate-transcript', classroomExamController.generatePyqTranscript);

// ======================================================
// 🎓 Classroom Exams Routes
// ======================================================
router.get('/', classroomExamController.getExams);
router.get('/exams', classroomExamController.getExams);

router.get('/:examId', classroomExamController.getExamTree);
router.get('/exams/:examId', classroomExamController.getExamTree);

router.post('/', classroomExamController.createExam);
router.post('/exams', classroomExamController.createExam);

router.put('/:examId', classroomExamController.updateExam);
router.put('/exams/:examId', classroomExamController.updateExam);

router.post('/:examId/images', upload.fields([
  { name: 'image_1_1', maxCount: 1 },
  { name: 'image_9_16', maxCount: 1 },
  { name: 'image_16_9', maxCount: 1 }
]), classroomExamController.uploadExamImages);
router.post('/exams/:examId/images', upload.fields([
  { name: 'image_1_1', maxCount: 1 },
  { name: 'image_9_16', maxCount: 1 },
  { name: 'image_16_9', maxCount: 1 }
]), classroomExamController.uploadExamImages);

router.delete('/:examId', classroomExamController.deleteExam);
router.delete('/exams/:examId', classroomExamController.deleteExam);

router.get('/:examId/history', classroomExamController.getStudyHistory);
router.get('/exams/:examId/history', classroomExamController.getStudyHistory);

router.post('/:examId/sync', classroomExamController.syncExamTree);
router.post('/exams/:examId/sync', classroomExamController.syncExamTree);

// ======================================================
// 📄 Papers Routes
// ======================================================
router.post('/:examId/papers', classroomExamController.createPaper);
router.post('/exams/:examId/papers', classroomExamController.createPaper);

router.put('/papers/:paperId', classroomExamController.updatePaper);
router.delete('/papers/:paperId', classroomExamController.deletePaper);
router.patch('/papers/:paperId/status', classroomExamController.togglePaperStatus);

router.post('/papers/:paperId/images', upload.fields([
  { name: 'image_1_1', maxCount: 1 },
  { name: 'image_9_16', maxCount: 1 },
  { name: 'image_16_9', maxCount: 1 }
]), classroomExamController.uploadPaperImages);

router.get('/:examId/papers', classroomExamController.getPapers);
router.get('/exams/:examId/papers', classroomExamController.getPapers);

router.get('/:examId/papers/:paperId/subjects', classroomExamController.getSubjects);
router.get('/papers/:paperId/subjects', classroomExamController.getSubjects);

router.post('/papers/:paperId/auto-generate', classroomExamController.autoGenerateStructure);
router.post('/papers/:paperId/vectorize', classroomExamController.vectorizePaper);
router.post('/papers/:paperId/chat', classroomExamController.chatWithPaper);
router.get('/papers/:paperId/chat/history', classroomExamController.getPaperChatHistory);
router.delete('/papers/:paperId/chat/history', classroomExamController.clearPaperChatHistory);

// ======================================================
// 📚 Subjects Routes
// ======================================================
router.post('/:examId/papers/:paperId/subjects', classroomExamController.createSubject);
router.post('/papers/:paperId/subjects', classroomExamController.createSubject);

router.put('/subjects/:subjectId', classroomExamController.updateSubject);
router.delete('/subjects/:subjectId', classroomExamController.deleteSubject);
router.patch('/subjects/:subjectId/status', classroomExamController.toggleSubjectStatus);

router.post('/subjects/:subjectId/images', upload.fields([
  { name: 'image_1_1', maxCount: 1 },
  { name: 'image_9_16', maxCount: 1 },
  { name: 'image_16_9', maxCount: 1 }
]), classroomExamController.uploadSubjectImages);

router.get('/:examId/subjects/:subjectId/chapters', classroomExamController.getChapters);
router.get('/subjects/:subjectId/chapters', classroomExamController.getChapters);

router.post('/subjects/:subjectId/upload-index', upload.single('file'), classroomExamController.uploadSubjectIndex);

// ======================================================
// 📁 Chapters Routes
// ======================================================
router.post('/:examId/subjects/:subjectId/chapters', classroomExamController.createChapter);
router.post('/subjects/:subjectId/chapters', classroomExamController.createChapter);

router.put('/chapters/:chapterId', classroomExamController.updateChapter);
router.delete('/chapters/:chapterId', classroomExamController.deleteChapter);

router.get('/:examId/chapters/:chapterId/topics', classroomExamController.getTopics);
router.get('/chapters/:chapterId/topics', classroomExamController.getTopics);

// ======================================================
// 🏷️ Topics Routes
// ======================================================
router.post('/:examId/chapters/:chapterId/topics', classroomExamController.createTopic);
router.post('/chapters/:chapterId/topics', classroomExamController.createTopic);

router.put('/topics/:topicId', classroomExamController.updateTopic);
router.delete('/topics/:topicId', classroomExamController.deleteTopic);

router.get('/:examId/topics/:topicId/subtopics', classroomExamController.getSubtopics);
router.get('/topics/:topicId/subtopics', classroomExamController.getSubtopics);

router.post('/topics/:topicId/generate-description', classroomExamController.generateTopicDescription);
router.post('/topics/:topicId/generate-notes', classroomExamController.generateTopicNotes);
router.get('/topics/:topicId/download-notes-pdf', classroomExamController.downloadTopicNotesPdf);
router.post('/topics/:topicId/quiz/generate', classroomExamController.generateTopicQuiz);
router.post('/topics/:topicId/generate-transcript', classroomExamController.generateTopicTranscript);
router.get('/topics/:topicId/reels', classroomExamController.getTopicReels);

// ======================================================
// 📝 Subtopics Routes
// ======================================================
router.post('/:examId/topics/:topicId/subtopics', classroomExamController.createSubtopic);
router.post('/topics/:topicId/subtopics', classroomExamController.createSubtopic);

router.get('/:examId/subtopics/:subtopicId', classroomExamController.getSubtopicDetails);
router.get('/subtopics/:subtopicId', classroomExamController.getSubtopicDetails);

router.put('/subtopics/:subtopicId', classroomExamController.updateSubtopic);
router.delete('/subtopics/:subtopicId', classroomExamController.deleteSubtopic);

router.post('/subtopics/:subtopicId/generate-description', classroomExamController.generateSubtopicDescription);

router.post('/:examId/subtopics/:subtopicId/generate-notes', classroomExamController.generateNotes);
router.post('/subtopics/:subtopicId/generate-notes', classroomExamController.generateNotes);

router.get('/subtopics/:subtopicId/download-notes-pdf', classroomExamController.downloadSubtopicNotesPdf);
router.post('/subtopics/:subtopicId/quiz/generate', classroomExamController.generateSubtopicQuiz);
router.post('/subtopics/:subtopicId/generate-transcript', classroomExamController.generateSubtopicTranscript);

router.post('/:examId/subtopics/:subtopicId/generate-reel', classroomExamController.generateReel);
router.post('/subtopics/:subtopicId/generate-reel', classroomExamController.generateReel);

router.get('/:examId/subtopics/:subtopicId/reels', classroomExamController.getSubtopicReels);
router.get('/subtopics/:subtopicId/reels', classroomExamController.getSubtopicReels);



// ======================================================
// 🎙️ Text-to-Speech (TTS) Routes
// ======================================================
router.post('/tts/speak', classroomExamController.generateTTS);

module.exports = router;

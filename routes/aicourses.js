const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const {
  getUploadUrl,
  createAICourse,
  getAICourses,
  getAICourse,
  updateAICourse,
  deleteAICourse,
  createLecture,
  getLectures,
  updateLecture,
  deleteLecture,
  addTopic,
  getAICoursesForMobile,
  getAICourseForMobile
} = require('../controllers/aicourseController');
const { authenticateMobileUser, ensureUserBelongsToClient } = require('../middleware/mobileAuth');
const { checkClientAccess } = require('../middleware/mobileAuth');

router.get('/clients/:clientId/mobile',checkClientAccess(), authenticateMobileUser, ensureUserBelongsToClient, getAICoursesForMobile);
router.get('/clients/:clientId/mobile/:id', checkClientAccess(), authenticateMobileUser, ensureUserBelongsToClient, getAICourseForMobile);
router.get('/clients/:clientId/mobile/:courseId/lectures', checkClientAccess(), authenticateMobileUser, ensureUserBelongsToClient, getLectures);

router.post('/upload-url', verifyToken, getUploadUrl);
router.post('/', verifyToken, createAICourse);
router.get('/', verifyToken, getAICourses);
router.get('/:id', verifyToken, getAICourse);
router.put('/:id', verifyToken, updateAICourse);
router.delete('/:id', verifyToken, deleteAICourse);

// Lecture CRUD under a course
router.get('/:courseId/lectures', verifyToken, getLectures);
router.post('/:courseId/lectures', verifyToken, createLecture);
router.put('/:courseId/lectures/:lectureId', verifyToken, updateLecture);
router.delete('/:courseId/lectures/:lectureId', verifyToken, deleteLecture);
router.post('/lecture/:lectureId/add-topic', verifyToken, addTopic);

module.exports = router;



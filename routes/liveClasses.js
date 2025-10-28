const express = require('express');
const router = express.Router();
const liveClassController = require('../controllers/liveClassController');
const { verifyAdminToken } = require('../middleware/auth');
const { verifyToken } = require('../middleware/auth');

/**
 * ADMIN ROUTES
 */

// Classroom management
router.post('/admin/classrooms', verifyAdminToken, liveClassController.createClassroom);
router.get('/admin/classrooms', verifyAdminToken, liveClassController.getClassrooms);

// Class management
router.post('/admin/classes', verifyAdminToken, liveClassController.createClass);
router.get('/admin/classrooms/:classroomId/classes', verifyAdminToken, liveClassController.getClasses);
router.patch('/admin/classes/:classId/status', verifyAdminToken, liveClassController.updateClassStatus);
router.get('/admin/classes/:classId/attendance', verifyAdminToken, liveClassController.getClassAttendance);

/**
 * STUDENT ROUTES
 */

// Get available classes
router.get('/classes', liveClassController.getAvailableClasses);

// Join class
router.post('/classes/:classId/join', verifyToken, liveClassController.generateJoinToken);

// Leave class
router.post('/classes/:classId/leave', verifyToken, liveClassController.markAttendanceLeft);

module.exports = router;


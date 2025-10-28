const Classroom = require('../models/Classroom');
const Class = require('../models/Class');
const User = require('../models/User');
const hmsService = require('../services/100msService');
const { sendSuccessResponse, sendErrorResponse } = require('../utils/response');

/**
 * Create a new classroom
 */
exports.createClassroom = async (req, res) => {
  try {
    const { name, description, organization } = req.body;
    const adminId = req.admin._id;

    if (!name) {
      return sendErrorResponse(res, 'Classroom name is required', 400);
    }

    const classroom = await Classroom.create({
      name,
      description,
      createdBy: adminId,
      organization: organization || null
    });

    return sendSuccessResponse(res, classroom, 'Classroom created successfully', 201);
  } catch (error) {
    console.error('Error creating classroom:', error);
    return sendErrorResponse(res, 'Failed to create classroom', 500);
  }
};

/**
 * Get all classrooms
 */
exports.getClassrooms = async (req, res) => {
  try {
    const adminId = req.admin._id;
    const { status = 'active' } = req.query;

    const classrooms = await Classroom.find({ 
      createdBy: adminId, 
      status 
    })
      .populate('organization', 'name slug')
      .sort({ createdAt: -1 });

    return sendSuccessResponse(res, classrooms, 'Classrooms retrieved successfully');
  } catch (error) {
    console.error('Error getting classrooms:', error);
    return sendErrorResponse(res, 'Failed to get classrooms', 500);
  }
};

/**
 * Create a new class in a classroom
 */
exports.createClass = async (req, res) => {
  try {
    const { classroomId, title, description, scheduledAt, duration } = req.body;
    const adminId = req.admin._id;

    if (!classroomId || !title || !scheduledAt) {
      return sendErrorResponse(res, 'Missing required fields: classroomId, title, scheduledAt', 400);
    }

    // Verify classroom exists and belongs to admin
    const classroom = await Classroom.findOne({ 
      _id: classroomId, 
      createdBy: adminId,
      status: 'active'
    });

    if (!classroom) {
      return sendErrorResponse(res, 'Classroom not found', 404);
    }

    // Create 100ms room
    let roomId = null;
    let roomCode = null;
    
    try {
      const { roomId: hmsRoomId, roomCode: hmsRoomCode } = await hmsService.createRoom(
        title,
        description
      );
      roomId = hmsRoomId;
      roomCode = hmsRoomCode;
    } catch (hmsError) {
      console.error('100ms room creation failed:', hmsError);
      // Continue without room creation - can be created later
    }

    // Create class
    const classDoc = await Class.create({
      title,
      description,
      scheduledAt,
      duration: duration || 60,
      classroom: classroomId,
      createdBy: adminId,
      organization: classroom.organization,
      roomId,
      roomCode
    });

    // Update classroom class count
    await Classroom.updateOne(
      { _id: classroomId },
      { $inc: { classesCount: 1 } }
    );

    return sendSuccessResponse(res, classDoc, 'Class created successfully', 201);
  } catch (error) {
    console.error('Error creating class:', error);
    return sendErrorResponse(res, 'Failed to create class', 500);
  }
};

/**
 * Get all classes in a classroom
 */
exports.getClasses = async (req, res) => {
  try {
    const { classroomId } = req.params;
    const adminId = req.admin._id;

    // Verify classroom access
    const classroom = await Classroom.findOne({ 
      _id: classroomId, 
      createdBy: adminId 
    });

    if (!classroom) {
      return sendErrorResponse(res, 'Classroom not found', 404);
    }

    const classes = await Class.find({ classroom: classroomId })
      .sort({ scheduledAt: -1 });

    return sendSuccessResponse(res, classes, 'Classes retrieved successfully');
  } catch (error) {
    console.error('Error getting classes:', error);
    return sendErrorResponse(res, 'Failed to get classes', 500);
  }
};

/**
 * Update class status
 */
exports.updateClassStatus = async (req, res) => {
  try {
    const { classId } = req.params;
    const { status } = req.body;
    const adminId = req.admin._id;

    const classDoc = await Class.findOne({ _id: classId, createdBy: adminId });

    if (!classDoc) {
      return sendErrorResponse(res, 'Class not found', 404);
    }

    classDoc.status = status;
    await classDoc.save();

    return sendSuccessResponse(res, classDoc, 'Class status updated successfully');
  } catch (error) {
    console.error('Error updating class status:', error);
    return sendErrorResponse(res, 'Failed to update class status', 500);
  }
};

// STUDENT SIDE
/**
 * Get all classes available for students
 */
exports.getAvailableClasses = async (req, res) => {
  try {
    const { status = 'scheduled,live' } = req.query;
    const statusList = status.split(',');

    const classes = await Class.find({ 
      status: { $in: statusList },
      scheduledAt: { $gte: new Date() }
    })
      .populate('classroom', 'name description')
      .sort({ scheduledAt: 1 });

    return sendSuccessResponse(res, classes, 'Available classes retrieved successfully');
  } catch (error) {
    console.error('Error getting available classes:', error);
    return sendErrorResponse(res, 'Failed to get available classes', 500);
  }
};

/**
 * Generate join token for student
 */
exports.generateJoinToken = async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user._id;
    const { role = 'guest' } = req.body;

    // Find class
    const classDoc = await Class.findById(classId);

    if (!classDoc) {
      return sendErrorResponse(res, 'Class not found', 404);
    }

    if (!classDoc.roomId) {
      return sendErrorResponse(res, 'Class room not configured', 400);
    }

    // Check if class is available
    if (!['scheduled', 'live'].includes(classDoc.status)) {
      return sendErrorResponse(res, 'Class is not available', 400);
    }

    // Generate 100ms token
    let token;
    try {
      token = await hmsService.generateToken(classDoc.roomId, userId.toString(), role);
    } catch (hmsError) {
      console.error('Error generating 100ms token:', hmsError);
      return sendErrorResponse(res, 'Failed to generate join token', 500);
    }

    // Log attendance
    const existingAttendance = classDoc.attendees.find(
      att => att.user.toString() === userId.toString() && !att.leftAt
    );

    if (!existingAttendance) {
      classDoc.attendees.push({
        user: userId,
        joinedAt: new Date()
      });
      classDoc.totalAttendees += 1;
      await classDoc.save();
    }

    return sendSuccessResponse(res, {
      token,
      roomId: classDoc.roomId,
      roomCode: classDoc.roomCode,
      class: {
        id: classDoc._id,
        title: classDoc.title,
        description: classDoc.description,
        scheduledAt: classDoc.scheduledAt
      }
    }, 'Join token generated successfully');
  } catch (error) {
    console.error('Error generating join token:', error);
    return sendErrorResponse(res, 'Failed to generate join token', 500);
  }
};

/**
 * Mark student as left
 */
exports.markAttendanceLeft = async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user._id;

    const classDoc = await Class.findById(classId);

    if (!classDoc) {
      return sendErrorResponse(res, 'Class not found', 404);
    }

    // Find attendance record
    const attendance = classDoc.attendees.find(
      att => att.user.toString() === userId.toString() && !att.leftAt
    );

    if (attendance) {
      attendance.leftAt = new Date();
      if (attendance.joinedAt) {
        attendance.duration = Math.floor((attendance.leftAt - attendance.joinedAt) / 1000);
      }
      await classDoc.save();
    }

    return sendSuccessResponse(res, {}, 'Left class successfully');
  } catch (error) {
    console.error('Error marking attendance left:', error);
    return sendErrorResponse(res, 'Failed to mark attendance', 500);
  }
};

/**
 * Get class attendance
 */
exports.getClassAttendance = async (req, res) => {
  try {
    const { classId } = req.params;
    const adminId = req.admin._id;

    const classDoc = await Class.findById(classId).populate('attendees.user', 'name email');

    if (!classDoc) {
      return sendErrorResponse(res, 'Class not found', 404);
    }

    if (classDoc.createdBy.toString() !== adminId.toString()) {
      return sendErrorResponse(res, 'Unauthorized', 403);
    }

    return sendSuccessResponse(res, {
      totalAttendees: classDoc.totalAttendees,
      peakAttendees: classDoc.peakAttendees,
      attendees: classDoc.attendees
    }, 'Attendance retrieved successfully');
  } catch (error) {
    console.error('Error getting attendance:', error);
    return sendErrorResponse(res, 'Failed to get attendance', 500);
  }
};


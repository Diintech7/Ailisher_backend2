const path = require('path');
const AICourse = require('../models/AICourse');
const User = require('../models/User');
const { generatePresignedUrl, generateGetPresignedUrl, deleteObject } = require('../utils/r2');
const AILecture = require('../models/AILecture');

const getClientId = (user) => {
  return user.role === 'client' && user.userId ? user.userId : user._id.toString();
};

exports.getUploadUrl = async (req, res) => {
  try {
    const user = req.user;
    const { fileName, contentType, type = 'cover' } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ success: false, message: 'fileName and contentType are required' });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(fileName);
    const safeType = type === 'faculty' ? 'faculty' : 'cover';
    const key = `${user.businessName || 'default'}/aicourses/${safeType}-${uniqueSuffix}${ext}`;

    const uploadUrl = await generatePresignedUrl(key, contentType);
    return res.status(200).json({ success: true, uploadUrl, key });
  } catch (error) {
    console.error('AICourse getUploadUrl error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

function parseTags(tags) {
  if (!tags) return [];
  try {
    return typeof tags === 'string' ? JSON.parse(tags) : tags;
  } catch (e) {
    return tags
      .toString()
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }
}

exports.createAICourse = async (req, res) => {
  try {
    const {
      title,
      overview,
      details,
      coverImageKey,
      mainCategory,
      subCategory,
      customSubCategory,
      tags,
      isPublic,
      isPaid,
      price,
      faculty = [],
      clientId: providedClientId,
    } = req.body;

    if (!title || !overview || !details) {
      return res.status(400).json({ success: false, message: 'title, overview and details are required' });
    }

    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const clientId = (providedClientId && providedClientId.trim()) || getClientId(currentUser);

    let coverImageUrl = '';
    if (coverImageKey) {
      coverImageUrl = await generateGetPresignedUrl(coverImageKey);
    }

    const processedFaculty = await Promise.all(
      (faculty || []).map(async (fac) => ({
        name: fac.name,
        about: fac.about,
        facultyImageKey: fac.facultyImageKey || '',
        facultyImageUrl: fac.facultyImageKey ? await generateGetPresignedUrl(fac.facultyImageKey) : '',
      }))
    );

    const created = await AICourse.create({
      title: title.trim(),
      overview,
      details,
      coverImageKey: coverImageKey || '',
      coverImageUrl,
      mainCategory: mainCategory || 'Other',
      subCategory: subCategory || 'Other',
      customSubCategory: customSubCategory || '',
      tags: parseTags(tags),
      faculty: processedFaculty,
      clientId,
      user: req.user.id,
      isPublic: isPublic === 'true' || isPublic === true || false,
      isPaid: isPaid === 'true' || isPaid === true || false,
      price: price ? Number(price) : 0,
    });

    return res.status(201).json({ success: true, message: 'AI Course created', course: created });
  } catch (error) {
    console.error('Create AICourse error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server Error' });
  }
};

exports.getAICourses = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const clientId = getClientId(currentUser);
    const { category, subcategory, search, limit, page = 1, isPublic } = req.query;

    const filter = { clientId };
    if (category) filter.mainCategory = category;
    if (subcategory) filter.subCategory = subcategory;
    if (isPublic !== undefined) filter.isPublic = isPublic === 'true' || isPublic === true;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { overview: { $regex: search, $options: 'i' } },
        { details: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
      ];
    }

    let query = AICourse.find(filter).sort({ createdAt: -1 });
    if (limit) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      query = query.skip(skip).limit(parseInt(limit));
    }

    const [items, total] = await Promise.all([query, AICourse.countDocuments(filter)]);
    for(const item of items)
    {
      if(item.coverImageKey)
      {
        item.coverImageUrl = await generateGetPresignedUrl(item.coverImageKey);
      }
    }
    for (const item of items) {
      if (Array.isArray(item.faculty) && item.faculty.length) {
        item.faculty = await Promise.all(
          item.faculty.map(async (fac) => {
            if (fac && fac.facultyImageKey) {
              fac.facultyImageUrl = await generateGetPresignedUrl(fac.facultyImageKey);
            }
            return fac;
          })
        );
      }
    }
    return res.status(200).json({ success: true, total, courses: items });
  } catch (error) {
    console.error('Get AICourses error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getAICourse = async (req, res) => {
  try {
    const item = await AICourse.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }
    if(item.coverImageKey)
    {
      item.coverImageUrl = await generateGetPresignedUrl(item.coverImageKey);
    }
    if (Array.isArray(item.faculty) && item.faculty.length) {
      item.faculty = await Promise.all(
        item.faculty.map(async (fac) => {
          if (fac && fac.facultyImageKey) {
            fac.facultyImageUrl = await generateGetPresignedUrl(fac.facultyImageKey);
          }
          return fac;
        })
      );
    }
    return res.status(200).json({ success: true, course: item });
  } catch (error) {
    console.error('Get AICourse error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getAICoursesForMobile = async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { category, subcategory, search, limit, page = 1, isPublic } = req.query;

    const filter = { clientId };
    if (category) filter.mainCategory = category;
    if (subcategory) filter.subCategory = subcategory;
    if (isPublic !== undefined) filter.isPublic = isPublic === 'true' || isPublic === true;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { overview: { $regex: search, $options: 'i' } },
        { details: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } },
      ];
    }

    let query = AICourse.find(filter).sort({ createdAt: -1 });
    if (limit) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      query = query.skip(skip).limit(parseInt(limit));
    }

    const [items, total] = await Promise.all([query, AICourse.countDocuments(filter)]);
    for(const item of items)
    {
      if(item.coverImageKey)
      {
        item.coverImageUrl = await generateGetPresignedUrl(item.coverImageKey);
      }
    }
    for (const item of items) {
      if (Array.isArray(item.faculty) && item.faculty.length) {
        item.faculty = await Promise.all(
          item.faculty.map(async (fac) => {
            if (fac && fac.facultyImageKey) {
              fac.facultyImageUrl = await generateGetPresignedUrl(fac.facultyImageKey);
            }
            return fac;
          })
        );
      }
    }
    return res.status(200).json({ success: true, total, courses: items });
  } catch (error) {
    console.error('Get AICourses error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getAICourseForMobile = async (req, res) => {
  try {
    const item = await AICourse.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }
    if(item.coverImageKey)
    {
      item.coverImageUrl = await generateGetPresignedUrl(item.coverImageKey);
    }
    if (Array.isArray(item.faculty) && item.faculty.length) {
      item.faculty = await Promise.all(
        item.faculty.map(async (fac) => {
          if (fac && fac.facultyImageKey) {
            fac.facultyImageUrl = await generateGetPresignedUrl(fac.facultyImageKey);
          }
          return fac;
        })
      );
    }
    return res.status(200).json({ success: true, course: item });
  } catch (error) {
    console.error('Get AICourse error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.updateAICourse = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      overview,
      details,
      coverImageKey,
      mainCategory,
      subCategory,
      customSubCategory,
      tags,
      isPublic,
      isPaid,
      price,
      faculty = [],
    } = req.body;

    const course = await AICourse.findById(id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    // Cover image changes
    if (coverImageKey !== undefined && coverImageKey !== course.coverImageKey) {
      if (course.coverImageKey) {
        try { await deleteObject(course.coverImageKey); } catch (_) {}
      }
      course.coverImageKey = coverImageKey || '';
      course.coverImageUrl = coverImageKey ? await generateGetPresignedUrl(coverImageKey) : '';
    }

    if (title !== undefined) course.title = title.trim();
    if (overview !== undefined) course.overview = overview;
    if (details !== undefined) course.details = details;
    if (mainCategory !== undefined) course.mainCategory = mainCategory;
    if (subCategory !== undefined) course.subCategory = subCategory;
    if (customSubCategory !== undefined) course.customSubCategory = customSubCategory || '';
    if (tags !== undefined) course.tags = parseTags(tags);
    if (isPublic !== undefined) course.isPublic = isPublic === 'true' || isPublic === true;
    if (isPaid !== undefined) course.isPaid = isPaid === 'true' || isPaid === true;
    if (price !== undefined) course.price = Number(price) || 0;

    if (faculty !== undefined) {
      const processedFaculty = await Promise.all(
        (faculty || []).map(async (fac) => ({
          name: fac.name,
          about: fac.about,
          facultyImageKey: fac.facultyImageKey || '',
          facultyImageUrl: fac.facultyImageKey ? await generateGetPresignedUrl(fac.facultyImageKey) : '',
        }))
      );
      // delete old images that are not present anymore
      try {
        const oldKeys = new Set((course.faculty || []).map((f) => f.facultyImageKey).filter(Boolean));
        const newKeys = new Set(processedFaculty.map((f) => f.facultyImageKey).filter(Boolean));
        for (const key of oldKeys) {
          if (!newKeys.has(key)) {
            try { await deleteObject(key); } catch (_) {}
          }
        }
      } catch (_) {}
      course.faculty = processedFaculty;
    }

    course.updatedAt = new Date();
    course.user = req.user._id;
    await course.save();

    return res.status(200).json({ success: true, message: 'AI Course updated', course });
  } catch (error) {
    console.error('Update AICourse error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.deleteAICourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await AICourse.findById(id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }
    if (course.coverImageKey) {
      try { await deleteObject(course.coverImageKey); } catch (_) {}
    }
    if (course.faculty && course.faculty.length) {
      for (const fac of course.faculty) {
        if (fac.facultyImageKey) {
          try { await deleteObject(fac.facultyImageKey); } catch (_) {}
        }
      }
    }
    await course.deleteOne();
    return res.status(200).json({ success: true, message: 'AI Course deleted' });
  } catch (error) {
    console.error('Delete AICourse error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};


// ==================== LECTURE CRUD FOR AI COURSES (AILecture) ====================

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

async function hydrateLectureSignedUrls(lectureDoc) {
  const lecture = lectureDoc.toObject ? lectureDoc.toObject() : lectureDoc;
  if (Array.isArray(lecture.topics)) {
    lecture.topics = await Promise.all(
      lecture.topics.map(async (t) => {
        const topic = { ...t };
        if (topic.VideoKey && !isHttpUrl(topic.VideoKey)) {
          try { topic.VideoUrl = await generateGetPresignedUrl(topic.VideoKey); } catch (_) {}
        }
        return topic;
      })
    );
  }
  return lecture;
}

exports.createLecture = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { lectureName, lectureDescription, topics = [] } = req.body;

    if (!lectureName || !lectureDescription) {
      return res.status(400).json({ success: false, message: 'lectureName and lectureDescription are required' });
    }

    const lastLecture = await AILecture.findOne({ courseId }).sort({ lectureNumber: -1 });
    const nextNumber = lastLecture ? (lastLecture.lectureNumber || 0) + 1 : 1;

    const processedTopics = (Array.isArray(topics) ? topics : []).map((t) => {
      let VideoKey = '';
      let VideoUrl = '';
      if (t.VideoUrl && isHttpUrl(t.VideoUrl)) {
        VideoUrl = t.VideoUrl; // do not copy URL into key
      } else if (t.videoKey) {
        VideoKey = t.videoKey;
      } else if (t.VideoUrl && !isHttpUrl(t.VideoUrl)) {
        VideoKey = t.VideoUrl;
      }
      return {
        topicName: t.topicName || '',
        topicDescription: t.topicDescription || '',
        VideoKey,
        VideoUrl,
      };
    });

    const lecture = await AILecture.create({
      courseId,
      lectureNumber: nextNumber,
      lectureName,
      lectureDescription,
      topics: processedTopics,
    });

    const hydrated = await hydrateLectureSignedUrls(lecture);
    return res.status(201).json({ success: true, lecture: hydrated });
  } catch (error) {
    console.error('Create Lecture error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getLectures = async (req, res) => {
  try {
    const { courseId } = req.params;
    const docs = await AILecture.find({ courseId }).sort({ lectureNumber: 1 });
    const lectures = await Promise.all(docs.map(hydrateLectureSignedUrls));
    return res.status(200).json({ success: true, lectures });
  } catch (error) {
    console.error('Get Lectures error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.updateLecture = async (req, res) => {
  try {
    const { courseId, lectureId } = req.params;
    const { lectureName, lectureDescription, topics = [] } = req.body;

    const lecture = await AILecture.findOne({ _id: lectureId, courseId });
    if (!lecture) {
      return res.status(404).json({ success: false, message: 'Lecture not found' });
    }

    if (lectureName !== undefined) lecture.lectureName = lectureName;
    if (lectureDescription !== undefined) lecture.lectureDescription = lectureDescription;

    if (topics !== undefined) {
      const processedTopics = (Array.isArray(topics) ? topics : []).map((t) => {
        let VideoKey = '';
        let VideoUrl = '';
        if (t.VideoUrl && isHttpUrl(t.VideoUrl)) {
          VideoUrl = t.VideoUrl;
        } else if (t.videoKey) {
          VideoKey = t.videoKey;
        } else if (t.VideoUrl && !isHttpUrl(t.VideoUrl)) {
          VideoKey = t.VideoUrl;
        }
        return {
          topicName: t.topicName || '',
          topicDescription: t.topicDescription || '',
          VideoKey,
          VideoUrl,
        };
      });
      lecture.topics = processedTopics;
    }

    await lecture.save();
    const hydrated = await hydrateLectureSignedUrls(lecture);
    return res.status(200).json({ success: true, lecture: hydrated });
  } catch (error) {
    console.error('Update Lecture error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.deleteLecture = async (req, res) => {
  try {
    const { courseId, lectureId } = req.params;
    const lecture = await AILecture.findOne({ _id: lectureId, courseId });
    if (!lecture) {
      return res.status(404).json({ success: false, message: 'Lecture not found' });
    }
    if (lecture.topics && lecture.topics.length) {
      for (const topic of lecture.topics) {
        if (topic.VideoKey) {
          try { await deleteObject(topic.VideoKey); } catch (_) {}
        }
      }
    }
    await lecture.deleteOne();
    return res.status(200).json({ success: true, message: 'Lecture deleted' });
  } catch (error) {
    console.error('Delete Lecture error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.addTopic = async (req, res) => {
  try {
    const { lectureId } = req.params;
    const {
      topicName,
      topicDescription,
      VideoUrl: bodyVideoUrl,
      videoKey: bodyVideoKey,
      transcriptKey,
      transcriptUrl,
    } = req.body;

    if (!topicName || !topicDescription) {
      return res.status(400).json({ success: false, message: 'topicName and topicDescription are required' });
    }

    const lecture = await AILecture.findOne({ _id: lectureId });
    if (!lecture) {
      return res.status(404).json({ success: false, message: 'Lecture not found' });
    }

    let VideoKey = '';
    let VideoUrl = '';
    if (bodyVideoUrl && isHttpUrl(bodyVideoUrl)) {
      VideoUrl = bodyVideoUrl;
    } else if (bodyVideoKey) {
      VideoKey = bodyVideoKey;
    } else if (bodyVideoUrl && !isHttpUrl(bodyVideoUrl)) {
      // client might have sent the key in VideoUrl field
      VideoKey = bodyVideoUrl;
    }

    const newTopic = {
      topicName,
      topicDescription,
      VideoKey,
      VideoUrl,
      transcriptKey: transcriptKey || '',
      transcriptUrl: transcriptUrl || '',
    };

    lecture.topics.push(newTopic);
    await lecture.save();

    // Hydrate signed URL for the newly added topic if stored by key
    const savedTopic = lecture.topics[lecture.topics.length - 1].toObject ? lecture.topics[lecture.topics.length - 1].toObject() : lecture.topics[lecture.topics.length - 1];
    if (savedTopic.VideoKey && !isHttpUrl(savedTopic.VideoKey)) {
      try { savedTopic.VideoUrl = await generateGetPresignedUrl(savedTopic.VideoKey); } catch (_) {}
    }

    return res.status(200).json({ success: true, message: 'Topic added', topic: savedTopic });
  } catch (error) {
    console.error('Add Topic error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.addCourseToHighlights = async (req, res) => {
  try {
    const { note, order } = req.body;
    const aiCourse = await AICourse.findById(req.params.id).populate('user', 'name email userId');
    
    if (!aiCourse) {
      return res.status(404).json({ success: false, message: 'AI Course not found' });
    }

    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const clientId = getClientId(currentUser);
    const canHighlight = aiCourse.clientId === clientId || aiCourse.user._id.toString() === req.user.id;

    if (!canHighlight) {
      return res.status(403).json({ success: false, message: 'Not authorized to highlight this AI Course' });
    }

    if (aiCourse.isHighlighted) {
      return res.status(400).json({ success: false, message: 'AI Course is already highlighted' });
    }

    if (order && order > 0) {
      const existingAICourseWithOrder = await AICourse.findOne({ 
        clientId, 
        isHighlighted: true, 
        highlightOrder: order,
        _id: { $ne: req.params.id }
      });

      if (existingAICourseWithOrder) {
        return res.status(400).json({
          success: false,
          message: `Highlight order ${order} is already taken by another AI Course`
        });
      }
    }

    const userType = 'User'; // Assuming web users are 'User' type
    await aiCourse.toggleHighlight(currentUser._id, userType, note || '', order || 0);
    await aiCourse.populate('highlightedBy', 'name email userId');

    // const aiCourseWithUserInfo = formatAICourseWithUserInfo(aiCourse);

    return res.status(200).json({
      success: true,
      message: 'AI Course added to highlights successfully',
      aiCourse: aiCourse
    });
  } catch (error) {
    console.error('Add AI Course to highlights error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.removeCourseFromHighlights = async (req, res) => {
  try {
    const aiCourse = await AICourse.findById(req.params.id).populate('user', 'name email userId');
    
    if (!aiCourse) {
      return res.status(404).json({ success: false, message: 'AI Course not found' });
    }

    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const clientId = getClientId(currentUser);
      const canRemoveHighlight = aiCourse.clientId === clientId || aiCourse.user._id.toString() === req.user.id;

    if (!canRemoveHighlight) {
      return res.status(403).json({ success: false, message: 'Not authorized to remove highlight from this AI Course' });
    }

    if (!aiCourse.isHighlighted) {
      return res.status(400).json({ success: false, message: 'AI Course is not highlighted' });
    }

    const userType = 'User'; // Assuming web users are 'User' type
    await aiCourse.toggleHighlight(currentUser._id, userType);
    
    // const aiCourseWithUserInfo = formatAICourseWithUserInfo(aiCourse);

    return res.status(200).json({
      success: true,
      message: 'AI Course removed from highlights successfully',
      aiCourse: aiCourse
    });
  } catch (error) {
    console.error('Remove AI Course from highlights error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.addCourseToTrending = async (req, res) => {
  try {
    const { score, endDate } = req.body;
    const aiCourse = await AICourse.findById(req.params.id).populate('user', 'name email userId');
    
    if (!aiCourse) {
      return res.status(404).json({ success: false, message: 'AI Course not found' });
    }

    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const clientId = getClientId(currentUser);
    const canMakeTrending = aiCourse.clientId === clientId || aiCourse.user._id.toString() === req.user.id;

    if (!canMakeTrending) {
      return res.status(403).json({ success: false, message: 'Not authorized to make this AI Course trending' });
    }

    if (aiCourse.isTrending) {
      return res.status(400).json({ success: false, message: 'AI Course is already trending' });
    }

    const userType = 'User'; // Assuming web users are 'User' type
    const parsedScore = score ? parseInt(score) : 0;
    const parsedEndDate = endDate ? new Date(endDate) : null;

    await aiCourse.toggleTrending(currentUser._id, userType, parsedScore, parsedEndDate);
    await aiCourse.populate('trendingBy', 'name email userId');

    // const aiCourseWithUserInfo = formatAICourseWithUserInfo(aiCourse);

    return res.status(200).json({
      success: true,
      message: 'AI Course added to trending successfully',
      aiCourse: aiCourse
    });
  } catch (error) {
    console.error('Add AI Course to trending error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.removeCourseFromTrending = async (req, res) => {
  try {
    const aiCourse = await AICourse.findById(req.params.id).populate('user', 'name email userId');
    
    if (!aiCourse) {
      return res.status(404).json({ success: false, message: 'AI Course not found' });
    }

    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const clientId = getClientId(currentUser);
    const canRemoveTrending = aiCourse.clientId === clientId || aiCourse.user._id.toString() === req.user.id;

    if (!canRemoveTrending) {
      return res.status(403).json({ success: false, message: 'Not authorized to remove trending from this AI Course' });
    }

    if (!aiCourse.isTrending) {
      return res.status(400).json({ success: false, message: 'AI Course is not trending' });
    }

    const userType = 'User'; // Assuming web users are 'User' type
    await aiCourse.toggleTrending(currentUser._id, userType);
    
    // const aiCourseWithUserInfo = formatAICourseWithUserInfo(aiCourse);

    return res.status(200).json({
      success: true,
      message: 'AI Course removed from trending successfully',
      aiCourse: aiCourse
    });
  } catch (error) {
    console.error('Remove AI Course from trending error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};


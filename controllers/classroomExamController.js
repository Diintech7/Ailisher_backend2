const axios = require('axios');
const ClassroomExam = require('../models/ClassroomExam');
const User = require('../models/User');
const PlanItem = require('../models/PlanItem');
const CreditRechargePlan = require('../models/CreditRechargePlan');
const UserPlan = require('../models/UserPlan');
const { uploadFileToS3, generateGetPresignedUrl } = require('../utils/r2');
const FormData = require('form-data');

// Helper to resolve client ID
const getClientId = (req) => {
  if (req.clientId) return req.clientId;
  if (req.params.clientId) return req.params.clientId;
  
  const user = req.user;
  if (!user) return null;
  return user.role === 'client' && user.userId ? user.userId : user._id.toString();
};

// Help helper functions for classroom plans check
const checkExamPlanStatus = async (examId, clientId, userId) => {
  // Find plan items that reference this exam
  const planItems = await PlanItem.find({
    itemType: { $in: ['classroom', 'classroom-exam'] },
    referenceId: examId,
    clientId: clientId
  });

  if (planItems.length === 0) {
    // If not in any plan, it is free
    return { isPaid: false, isLocked: false, isEnrolled: true, plans: [] };
  }

  // Get active plans containing these items
  const plans = await CreditRechargePlan.find({
    items: { $in: planItems.map(item => item._id) },
    clientId: clientId,
    status: 'active'
  }).select('_id name description MRP offerPrice category duration status');

  if (plans.length === 0) {
    return { isPaid: false, isLocked: false, isEnrolled: true, plans: [] };
  }

  let isEnrolled = false;
  if (userId) {
    const now = new Date();
    // Check if user has active plan
    const enrolled = await UserPlan.findOne({
      userId: userId,
      clientId: clientId,
      $or: [
        { planId: { $in: plans.map(p => p._id) } },
        { examId: examId }
      ],
      status: 'active',
      startDate: { $lte: now },
      endDate: { $gte: now }
    }).select('_id');
    isEnrolled = Boolean(enrolled);
  }

  return {
    isPaid: true,
    isLocked: !isEnrolled,
    isEnrolled: isEnrolled,
    plans: plans.map(p => ({
      id: p._id,
      name: p.name,
      description: p.description,
      mrp: p.MRP,
      offerPrice: p.offerPrice,
      category: p.category,
      duration: p.duration,
      status: p.status
    }))
  };
};

const checkSubjectPlanStatus = async (examId, subjectId, clientId, userId) => {
  // Check if they have access to the whole exam first
  const examStatus = await checkExamPlanStatus(examId, clientId, userId);
  if (examStatus.isEnrolled) {
    return { isPaid: examStatus.isPaid, isLocked: false, isEnrolled: true, plans: examStatus.plans };
  }

  // If not enrolled in the exam, check if they have a subject-specific plan
  const planItems = await PlanItem.find({
    itemType: 'classroom-subject',
    referenceId: subjectId,
    clientId: clientId
  });

  if (planItems.length === 0) {
    return {
      isPaid: examStatus.isPaid,
      isLocked: examStatus.isLocked,
      isEnrolled: examStatus.isEnrolled,
      plans: examStatus.plans
    };
  }

  const plans = await CreditRechargePlan.find({
    items: { $in: planItems.map(item => item._id) },
    clientId: clientId,
    status: 'active'
  }).select('_id name description MRP offerPrice category duration status');

  if (plans.length === 0) {
    return {
      isPaid: examStatus.isPaid,
      isLocked: examStatus.isLocked,
      isEnrolled: examStatus.isEnrolled,
      plans: examStatus.plans
    };
  }

  let isEnrolled = false;
  if (userId) {
    const now = new Date();
    const enrolled = await UserPlan.findOne({
      userId: userId,
      clientId: clientId,
      $or: [
        { planId: { $in: plans.map(p => p._id) } },
        { subjectId: subjectId }
      ],
      status: 'active',
      startDate: { $lte: now },
      endDate: { $gte: now }
    }).select('_id');
    isEnrolled = Boolean(enrolled);
  }

  const allPlans = [...examStatus.plans, ...plans.map(p => ({
    id: p._id,
    name: p.name,
    description: p.description,
    mrp: p.MRP,
    offerPrice: p.offerPrice,
    category: p.category,
    duration: p.duration,
    status: p.status
  }))];

  return {
    isPaid: true,
    isLocked: !isEnrolled,
    isEnrolled: isEnrolled,
    plans: allPlans
  };
};

const verifyAccess = async (req, res, examId, subjectId = null) => {
  if (req.user && (req.user.role === 'client' || req.user.role === 'admin' || req.user.role === 'superadmin')) {
    return true;
  }

  const clientId = getClientId(req);
  const userId = req.user?.id || req.user?.userId;

  if (subjectId) {
    const planStatus = await checkSubjectPlanStatus(examId, subjectId, clientId, userId);
    if (planStatus.isLocked) {
      res.status(403).json({
        success: false,
        message: 'Subscription plan required to access this content.',
        isLocked: true,
        planDetails: planStatus.plans
      });
      return false;
    }
  } else {
    const planStatus = await checkExamPlanStatus(examId, clientId, userId);
    if (planStatus.isLocked) {
      res.status(403).json({
        success: false,
        message: 'Subscription plan required to access this content.',
        isLocked: true,
        planDetails: planStatus.plans
      });
      return false;
    }
  }
  return true;
};

const findSubjectIdFromSubtopic = (doc, subtopicId) => {
  for (const paper of doc.tree) {
    for (const subject of paper.subjects) {
      for (const chap of subject.chapters) {
        for (const top of chap.topics) {
          const sub = top.subtopics.find(s => s.subtopic_id === subtopicId);
          if (sub) {
            return subject.subject_id;
          }
        }
      }
    }
  }
  return null;
};

const findIdsForSubtopic = (doc, subtopicId) => {
  for (const paper of doc.tree) {
    for (const subject of paper.subjects) {
      for (const chap of subject.chapters) {
        for (const top of chap.topics) {
          const sub = top.subtopics.find(s => s.subtopic_id === subtopicId);
          if (sub) {
            return {
              paperId: paper.paper_id,
              subjectId: subject.subject_id,
              chapterId: chap.chapter_id,
              topicId: top.topic_id
            };
          }
        }
      }
    }
  }
  return null;
};

const getR2ObjectText = async (key) => {
  try {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const { s3Client } = require('../utils/r2');
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key.startsWith('/') ? key.slice(1) : key
    });
    const response = await s3Client.send(command);
    return await response.Body.transformToString();
  } catch (err) {
    console.error("Error reading R2 object text:", err);
    return "";
  }
};

const findSubjectIdFromTopic = (doc, topicId) => {
  for (const paper of doc.tree) {
    for (const subject of paper.subjects) {
      for (const chap of subject.chapters) {
        const top = chap.topics.find(t => t.topic_id === topicId);
        if (top) {
          return subject.subject_id;
        }
      }
    }
  }
  return null;
};

const findSubjectIdFromChapter = (doc, chapterId) => {
  for (const paper of doc.tree) {
    for (const subject of paper.subjects) {
      const chap = subject.chapters.find(c => c.chapter_id === chapterId);
      if (chap) {
        return subject.subject_id;
      }
    }
  }
  return null;
};

// GET /api/classroom-exams - Fetch all exams from third-party Vectorize API
exports.getExams = async (req, res) => {
  try {
    const clientId = getClientId(req);
    if (req.query.syncedOnly === 'true') {
      const localExams = await ClassroomExam.find({ clientId });
      return res.status(200).json({
        success: true,
        exams: localExams
      });
    }
    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    console.log('Fetching classroom exams from Vectorize API:', `${apiURL}/api/classroom/exams`);
    
    const response = await axios.get(`${apiURL}/api/classroom/exams`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.data && response.data.success) {
      // Find which ones are already synced locally for this client
      const clientId = getClientId(req);
      const syncedExams = await ClassroomExam.find({ clientId }).select('exam_id synced_at');
      const syncedIds = new Set(syncedExams.map(e => e.exam_id));
      const formatImageUrl = (url) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
      };

      const enrichedExams = await Promise.all(response.data.exams.map(async exam => {
        const userId = req.user?.id || req.user?.userId;
        const planStatus = await checkExamPlanStatus(exam.exam_id, clientId, userId);
        return {
          ...exam,
          image_url: formatImageUrl(exam.image_url),
          isSynced: syncedIds.has(exam.exam_id),
          syncedAt: syncedExams.find(e => e.exam_id === exam.exam_id)?.synced_at || null,
          isPaid: planStatus.isPaid,
          isLocked: planStatus.isLocked,
          isEnrolled: planStatus.isEnrolled,
          planDetails: planStatus.plans
        };
      }));

      return res.status(200).json({
        success: true,
        exams: enrichedExams
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Failed to fetch exams from partner API'
      });
    }
  } catch (error) {
    console.error('Error fetching exams from Vectorize API:', error.message);
    
    // Fallback: Return locally synced exams if external API is down
    try {
      const clientId = getClientId(req);
      const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
      const localExams = await ClassroomExam.find({ clientId });

      const formatImageUrl = (url) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
      };

      const formattedLocal = await Promise.all(localExams.map(async exam => {
        const userId = req.user?.id || req.user?.userId;
        const planStatus = await checkExamPlanStatus(exam.exam_id, clientId, userId);
        return {
          exam_id: exam.exam_id,
          name: exam.name,
          category: exam.category,
          image_url: formatImageUrl(exam.image_url),
          description: exam.description,
          isSynced: true,
          syncedAt: exam.synced_at,
          isFallback: true,
          isPaid: planStatus.isPaid,
          isLocked: planStatus.isLocked,
          isEnrolled: planStatus.isEnrolled,
          planDetails: planStatus.plans
        };
      }));

      return res.status(200).json({
        success: true,
        exams: formattedLocal,
        message: 'Returned cached exams (Partner API is offline)'
      });
    } catch (dbError) {
      console.error('Database fallback error in getExams:', dbError.message);
      return res.status(500).json({
        success: false,
        message: 'Server Error fetching classroom data'
      });
    }
  }
};

// POST /api/classroom-exams - Create a new exam on partner server and sync locally
exports.createExam = async (req, res) => {
  try {
    const { name, category, description, image_url } = req.body;
    const clientId = getClientId(req);
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Exam name is required'
      });
    }

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    console.log('Creating new exam on Vectorize API:', `${apiURL}/api/classroom/exams`);
    
    const response = await axios.post(`${apiURL}/api/classroom/exams`, {
      name,
      category: category || '',
      description: description || '',
      image_url: image_url || ''
    }, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    if (response.data && response.data.success) {
      const newExam = response.data.exam || response.data.data;
      
      const formatImageUrl = (url) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
      };

      const newDoc = await ClassroomExam.findOneAndUpdate(
        { exam_id: newExam.exam_id, clientId },
        {
          exam_id: newExam.exam_id,
          name: newExam.name,
          category: newExam.category,
          image_url: formatImageUrl(newExam.image_url),
          description: newExam.description,
          clientId,
          tree: [],
          synced_at: new Date()
        },
        { upsert: true, new: true }
      );

      return res.status(201).json({
        success: true,
        message: 'Exam created successfully',
        exam: {
          exam_id: newDoc.exam_id,
          name: newDoc.name,
          category: newDoc.category,
          image_url: newDoc.image_url,
          description: newDoc.description,
          isSynced: true,
          syncedAt: newDoc.synced_at
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: response.data.message || 'Failed to create exam on partner server'
      });
    }
  } catch (error) {
    console.error('Error creating exam:', error.message);
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Server Error creating classroom exam'
    });
  }
};

// GET /api/classroom-exams/:examId - Get detailed tree for an exam (loads local cache first)
exports.getExamTree = async (req, res) => {
  try {
    const { examId } = req.params;
    // 1. Check local cache
    const clientId = getClientId(req);
    let localDoc = await ClassroomExam.findOne({ exam_id: examId, clientId });

    if (localDoc) {
      return res.status(200).json({
        success: true,
        exam: {
          exam_id: localDoc.exam_id,
          name: localDoc.name,
          category: localDoc.category,
          image_url: localDoc.image_url,
          description: localDoc.description,
          synced_at: localDoc.synced_at
        },
        tree: localDoc.tree,
        isCached: true
      });
    }

    // 2. If not cached, trigger sync logic dynamically
    console.log(`Exam ${examId} not cached locally. Triggering auto-sync for client ${clientId}`);
    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.get(`${apiURL}/api/classroom/exams/${examId}`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });

    if (response.data && response.data.success) {
      const { exam, tree } = response.data;
      
      const formatImageUrl = (url) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
      };

      const newDoc = await ClassroomExam.findOneAndUpdate(
        { exam_id: examId, clientId },
        {
          exam_id: examId,
          name: exam.name,
          category: exam.category,
          image_url: formatImageUrl(exam.image_url),
          description: exam.description,
          clientId,
          tree: tree || [],
          synced_at: new Date()
        },
        { upsert: true, new: true }
      );

      return res.status(200).json({
        success: true,
        exam: {
          exam_id: newDoc.exam_id,
          name: newDoc.name,
          category: newDoc.category,
          image_url: newDoc.image_url,
          description: newDoc.description,
          synced_at: newDoc.synced_at
        },
        tree: newDoc.tree,
        isCached: false
      });
    } else {
      return res.status(404).json({
        success: false,
        message: 'Exam details not found on partner server'
      });
    }
  } catch (error) {
    console.error(`Error loading exam tree for ${req.params.examId}:`, error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve classroom exam tree details'
    });
  }
};

// POST /api/classroom-exams/:examId/sync - Force sync details from partner API
exports.syncExamTree = async (req, res) => {
  try {
    const { examId } = req.params;
    const clientId = getClientId(req);

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    console.log(`Force-syncing classroom exam tree ${examId} for client ${clientId}`);

    const response = await axios.get(`${apiURL}/api/classroom/exams/${examId}`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      },
      timeout: 25000
    });

    if (response.data && response.data.success) {
      const { exam, tree } = response.data;
      
      const formatImageUrl = (url) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
      };

      const newDoc = await ClassroomExam.findOneAndUpdate(
        { exam_id: examId, clientId },
        {
          exam_id: examId,
          name: exam.name,
          category: exam.category,
          image_url: formatImageUrl(exam.image_url),
          description: exam.description,
          clientId,
          tree: tree || [],
          synced_at: new Date()
        },
        { upsert: true, new: true }
      );

      return res.status(200).json({
        success: true,
        message: 'Classroom data synced successfully',
        exam: {
          exam_id: newDoc.exam_id,
          name: newDoc.name,
          category: newDoc.category,
          image_url: newDoc.image_url,
          description: newDoc.description,
          synced_at: newDoc.synced_at
        }
      });
    } else {
      return res.status(400).json({
        success: false,
        message: 'Could not sync. Partner API returned failed status'
      });
    }
  } catch (error) {
    console.error(`Force-sync failed for exam ${req.params.examId}:`, error.message);
    return res.status(500).json({
      success: false,
      message: `Sync failed: ${error.message}`
    });
  }
};

// GET /api/classroom-exams/:examId/papers
exports.getPapers = async (req, res) => {
  try {
    const { examId } = req.params;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });
    
    const rawPapers = doc.tree || [];
    const papers = rawPapers.map(p => ({
      paper_id: p.paper_id,
      exam_id: p.exam_id,
      name: p.name,
      created_at: p.created_at
    }));
    return res.status(200).json({ success: true, papers });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/classroom-exams/:examId/papers/:paperId/subjects
exports.getSubjects = async (req, res) => {
  try {
    const { examId, paperId } = req.params;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });
    const paper = doc.tree.find(p => p.paper_id === paperId);
    if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });
    
    const rawSubjects = paper.subjects || [];
    const subjects = await Promise.all(rawSubjects.map(async s => {
      const userId = req.user?.id || req.user?.userId;
      const planStatus = await checkSubjectPlanStatus(examId, s.subject_id, clientId, userId);
      return {
        subject_id: s.subject_id,
        exam_id: s.exam_id,
        paper_id: s.paper_id,
        name: s.name,
        color: s.color,
        chapter_count: s.chapter_count || 0,
        topic_count: s.topic_count || 0,
        subtopic_count: s.subtopic_count || 0,
        created_at: s.created_at,
        isPaid: planStatus.isPaid,
        isLocked: planStatus.isLocked,
        isEnrolled: planStatus.isEnrolled,
        planDetails: planStatus.plans
      };
    }));
    return res.status(200).json({ success: true, subjects });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/classroom-exams/:examId/subjects/:subjectId/chapters
exports.getChapters = async (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    const hasAccess = await verifyAccess(req, res, examId, subjectId);
    if (!hasAccess) return;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });
    
    let foundSubject = null;
    for (const paper of doc.tree) {
      const sub = paper.subjects.find(s => s.subject_id === subjectId);
      if (sub) {
        foundSubject = sub;
        break;
      }
    }
    if (!foundSubject) return res.status(404).json({ success: false, message: 'Subject not found' });
    
    const rawChapters = foundSubject.chapters || [];
    const chapters = rawChapters.map(c => ({
      chapter_id: c.chapter_id,
      subject_id: c.subject_id,
      name: c.name,
      created_at: c.created_at,
      topics: (c.topics || []).map(t => ({
        topic_id: t.topic_id,
        chapter_id: t.chapter_id,
        name: t.name
      }))
    }));
    return res.status(200).json({ success: true, chapters });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/classroom-exams/:examId/chapters/:chapterId/topics
exports.getTopics = async (req, res) => {
  try {
    const { examId, chapterId } = req.params;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });
    
    const foundSubjectId = findSubjectIdFromChapter(doc, chapterId);
    const hasAccess = await verifyAccess(req, res, examId, foundSubjectId);
    if (!hasAccess) return;
    
    let foundChapter = null;
    for (const paper of doc.tree) {
      for (const subject of paper.subjects) {
        const chap = subject.chapters.find(c => c.chapter_id === chapterId);
        if (chap) {
          foundChapter = chap;
          break;
        }
      }
      if (foundChapter) break;
    }
    if (!foundChapter) return res.status(404).json({ success: false, message: 'Chapter not found' });
    
    const rawTopics = foundChapter.topics || [];
    const topics = rawTopics.map(t => ({
      topic_id: t.topic_id,
      chapter_id: t.chapter_id,
      name: t.name,
      created_at: t.created_at,
      subtopics: (t.subtopics || []).map(s => ({
        subtopic_id: s.subtopic_id,
        topic_id: s.topic_id,
        name: s.name,
        created_at: s.created_at
      }))
    }));
    return res.status(200).json({ success: true, topics });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/classroom-exams/:examId/topics/:topicId/subtopics
exports.getSubtopics = async (req, res) => {
  try {
    const { examId, topicId } = req.params;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });
    
    const foundSubjectId = findSubjectIdFromTopic(doc, topicId);
    const hasAccess = await verifyAccess(req, res, examId, foundSubjectId);
    if (!hasAccess) return;
    
    let foundTopic = null;
    for (const paper of doc.tree) {
      for (const subject of paper.subjects) {
        for (const chap of subject.chapters) {
          const top = chap.topics.find(t => t.topic_id === topicId);
          if (top) {
            foundTopic = top;
            break;
          }
        }
        if (foundTopic) break;
      }
      if (foundTopic) break;
    }
    if (!foundTopic) return res.status(404).json({ success: false, message: 'Topic not found' });
    
    const rawSubtopics = foundTopic.subtopics || [];
    const subtopics = rawSubtopics.map(s => ({
      subtopic_id: s.subtopic_id,
      topic_id: s.topic_id,
      name: s.name,
      created_at: s.created_at
    }));
    return res.status(200).json({ success: true, subtopics });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/classroom-exams/:examId/subtopics/:subtopicId
exports.getSubtopicDetails = async (req, res) => {
  try {
    const { examId, subtopicId } = req.params;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });
    
    const foundSubjectId = findSubjectIdFromSubtopic(doc, subtopicId);
    const hasAccess = await verifyAccess(req, res, examId, foundSubjectId);
    if (!hasAccess) return;
    
    let foundSubtopic = null;
    for (const paper of doc.tree) {
      for (const subject of paper.subjects) {
        for (const chap of subject.chapters) {
          for (const top of chap.topics) {
            const sub = top.subtopics.find(s => s.subtopic_id === subtopicId);
            if (sub) {
              foundSubtopic = sub;
              break;
            }
          }
          if (foundSubtopic) break;
        }
        if (foundSubtopic) break;
      }
      if (foundSubtopic) break;
    }
    if (!foundSubtopic) return res.status(404).json({ success: false, message: 'Subtopic not found' });

    // Format subtopic object to load notes from R2 if needed
    const subtopicObj = foundSubtopic.toObject ? foundSubtopic.toObject() : { ...foundSubtopic };
    if (subtopicObj.notes && subtopicObj.notes.startsWith('classroom/clients/')) {
      subtopicObj.notes = await getR2ObjectText(subtopicObj.notes);
    }

    return res.status(200).json({ success: true, subtopic: subtopicObj });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/classroom-exams/:examId/papers/:paperId/subjects
exports.createSubject = async (req, res) => {
  try {
    const { examId, paperId } = req.params;
    const { name, color } = req.body;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/papers/${paperId}/subjects`, { name, color }, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const newSubject = response.data.subject || response.data.data;
      
      const paperIdx = doc.tree.findIndex(p => p.paper_id === paperId);
      if (paperIdx !== -1) {
        if (!doc.tree[paperIdx].subjects) doc.tree[paperIdx].subjects = [];
        doc.tree[paperIdx].subjects.push({
          subject_id: newSubject.subject_id,
          exam_id: examId,
          paper_id: paperId,
          name: newSubject.name,
          color: newSubject.color || color || '#3b82f6',
          chapter_count: 0,
          topic_count: 0,
          subtopic_count: 0,
          chapters: [],
          created_at: new Date().toISOString()
        });
        doc.markModified('tree');
        await doc.save();
      }

      return res.status(201).json({ success: true, subject: newSubject });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to create subject on partner server' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/classroom-exams/:examId/subjects/:subjectId/chapters
exports.createChapter = async (req, res) => {
  try {
    const { examId, subjectId } = req.params;
    const { name } = req.body;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/subjects/${subjectId}/chapters`, { name }, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const newChapter = response.data.chapter || response.data.data;

      let updated = false;
      for (let paper of doc.tree) {
        const sub = paper.subjects.find(s => s.subject_id === subjectId);
        if (sub) {
          if (!sub.chapters) sub.chapters = [];
          sub.chapters.push({
            chapter_id: newChapter.chapter_id,
            subject_id: subjectId,
            name: newChapter.name,
            topics: [],
            created_at: new Date().toISOString()
          });
          sub.chapter_count = (sub.chapter_count || 0) + 1;
          updated = true;
          break;
        }
      }

      if (updated) {
        doc.markModified('tree');
        await doc.save();
      }

      return res.status(201).json({ success: true, chapter: newChapter });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to create chapter on partner server' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/classroom-exams/:examId/chapters/:chapterId/topics
exports.createTopic = async (req, res) => {
  try {
    const { examId, chapterId } = req.params;
    const { name } = req.body;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/chapters/${chapterId}/topics`, { name }, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const newTopic = response.data.topic || response.data.data;

      let updated = false;
      for (let paper of doc.tree) {
        for (let subject of paper.subjects) {
          const chap = subject.chapters.find(c => c.chapter_id === chapterId);
          if (chap) {
            if (!chap.topics) chap.topics = [];
            chap.topics.push({
              topic_id: newTopic.topic_id,
              chapter_id: chapterId,
              name: newTopic.name,
              subtopics: [],
              created_at: new Date().toISOString()
            });
            subject.topic_count = (subject.topic_count || 0) + 1;
            updated = true;
            break;
          }
        }
        if (updated) break;
      }

      if (updated) {
        doc.markModified('tree');
        await doc.save();
      }

      return res.status(201).json({ success: true, topic: newTopic });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to create topic on partner server' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/classroom-exams/:examId/topics/:topicId/subtopics
exports.createSubtopic = async (req, res) => {
  try {
    const { examId, topicId } = req.params;
    const { name, description } = req.body;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/topics/${topicId}/subtopics`, { name, description }, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const newSub = response.data.subtopic || response.data.data;

      let updated = false;
      for (let paper of doc.tree) {
        for (let subject of paper.subjects) {
          for (let chap of subject.chapters) {
            const top = chap.topics.find(t => t.topic_id === topicId);
            if (top) {
              if (!top.subtopics) top.subtopics = [];
              top.subtopics.push({
                subtopic_id: newSub.subtopic_id,
                topic_id: topicId,
                name: newSub.name,
                description: newSub.description || description || '',
                notes: '',
                created_at: new Date().toISOString()
              });
              subject.subtopic_count = (subject.subtopic_count || 0) + 1;
              updated = true;
              break;
            }
          }
          if (updated) break;
        }
        if (updated) break;
      }

      if (updated) {
        doc.markModified('tree');
        await doc.save();
      }

      return res.status(201).json({ success: true, subtopic: newSub });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to create subtopic on partner server' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/classroom-exams/:examId/subtopics/:subtopicId/generate-notes
exports.generateNotes = async (req, res) => {
  try {
    const { examId, subtopicId } = req.params;
    const { language = 'English' } = req.body;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const foundSubjectId = findSubjectIdFromSubtopic(doc, subtopicId);
    const hasAccess = await verifyAccess(req, res, examId, foundSubjectId);
    if (!hasAccess) return;

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/subtopics/${subtopicId}/generate-notes`, { language }, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const notesText = response.data.notes || response.data.data?.notes || '';
      const notesDescription = response.data.description || '';
      
      const ids = findIdsForSubtopic(doc, subtopicId);
      const notesKey = `classroom/clients/${clientId}/exams/${examId}/topics/${ids?.topicId || 'default'}/subtopics/${subtopicId}/notes.md`;

      // Upload notes to R2
      try {
        await uploadFileToS3(Buffer.from(notesText, 'utf-8'), notesKey, 'text/markdown');
      } catch (uploadErr) {
        console.error("R2 Upload failed for notes:", uploadErr);
      }

      let updated = false;
      for (let paper of doc.tree) {
        for (let subject of paper.subjects) {
          for (let chap of subject.chapters) {
            for (let top of chap.topics) {
              const sub = top.subtopics.find(s => s.subtopic_id === subtopicId);
              if (sub) {
                sub.notes = notesKey;
                if (notesDescription) sub.description = notesDescription;
                updated = true;
                break;
              }
            }
            if (updated) break;
          }
          if (updated) break;
        }
        if (updated) break;
      }

      if (updated) {
        doc.markModified('tree');
        await doc.save();
      }

      return res.status(200).json({ success: true, notes: notesText });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to generate notes' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/classroom-exams/:examId/subtopics/:subtopicId/generate-reel
exports.generateReel = async (req, res) => {
  try {
    const { examId, subtopicId } = req.params;
    const { language = 'English', voice_id } = req.body;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const foundSubjectId = findSubjectIdFromSubtopic(doc, subtopicId);
    const hasAccess = await verifyAccess(req, res, examId, foundSubjectId);
    if (!hasAccess) return;

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/subtopics/${subtopicId}/generate-reel`, { language, voice_id }, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const rawVideoUrl = response.data.video_url || response.data.data?.video_url || '';
      
      // Resolve absolute url for downloading
      const downloadUrl = rawVideoUrl.startsWith('http') 
        ? rawVideoUrl 
        : `${apiURL}${rawVideoUrl.startsWith('/') ? '' : '/'}${rawVideoUrl}`;
        
      const contentId = response.data.content_id || response.data.data?.content_id || Date.now().toString();
      const ids = findIdsForSubtopic(doc, subtopicId);
      const videoKey = `classroom/clients/${clientId}/exams/${examId}/topics/${ids?.topicId || 'default'}/subtopics/${subtopicId}/reels/reel_${contentId}.mp4`;

      // Download from partner and upload to R2
      let finalVideoUrl = downloadUrl;
      try {
        console.log(`Downloading reel from: ${downloadUrl}`);
        const downloadRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
        const videoBuffer = Buffer.from(downloadRes.data);
        
        console.log(`Uploading reel to R2 key: ${videoKey}`);
        await uploadFileToS3(videoBuffer, videoKey, 'video/mp4');
        
        // Generate signed URL to return to frontend
        finalVideoUrl = await generateGetPresignedUrl(videoKey);
      } catch (r2Err) {
        console.error("Failed to sync video reel to R2, falling back to partner URL:", r2Err.message);
      }

      let updated = false;
      for (let paper of doc.tree) {
        for (let subject of paper.subjects) {
          for (let chap of subject.chapters) {
            for (let top of chap.topics) {
              const sub = top.subtopics.find(s => s.subtopic_id === subtopicId);
              if (sub) {
                if (!sub.reels) sub.reels = [];
                sub.reels.push({
                  video_url: videoKey, // Store R2 key
                  content_id: contentId,
                  script: response.data.script || response.data.data?.script || '',
                  created_at: new Date().toISOString()
                });
                updated = true;
                break;
              }
            }
            if (updated) break;
          }
          if (updated) break;
        }
        if (updated) break;
      }

      if (updated) {
        doc.markModified('tree');
        await doc.save();
      }

      return res.status(200).json({ 
        success: true, 
        video_url: finalVideoUrl, 
        reel: {
          ...response.data,
          video_url: finalVideoUrl
        } 
      });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to generate video reel' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/classroom-exams/:examId/subtopics/:subtopicId/reels
exports.getSubtopicReels = async (req, res) => {
  try {
    const { examId, subtopicId } = req.params;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const foundSubjectId = findSubjectIdFromSubtopic(doc, subtopicId);
    const hasAccess = await verifyAccess(req, res, examId, foundSubjectId);
    if (!hasAccess) return;

    // 1. Try to fetch reels cached in local database
    let foundSubtopic = null;
    for (const paper of doc.tree) {
      for (const subject of paper.subjects) {
        for (const chap of subject.chapters) {
          for (const top of chap.topics) {
            const sub = top.subtopics.find(s => s.subtopic_id === subtopicId);
            if (sub) {
              foundSubtopic = sub;
              break;
            }
          }
          if (foundSubtopic) break;
        }
        if (foundSubtopic) break;
      }
      if (foundSubtopic) break;
    }

    let hasUpdates = false;
    if (foundSubtopic && foundSubtopic.reels && foundSubtopic.reels.length > 0) {
      const formattedReels = await Promise.all(foundSubtopic.reels.map(async (reel, index) => {
        const reelObj = reel.toObject ? reel.toObject() : { ...reel };
        if (reelObj.video_url) {
          if (reelObj.video_url.startsWith('classroom/clients/')) {
            try {
              reelObj.video_url = await generateGetPresignedUrl(reelObj.video_url);
            } catch (urlErr) {
              console.error("Failed to sign R2 reel url:", urlErr);
            }
          } else {
            // Legacy / Relative path: download and upload to R2, then save to DB
            const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
            const rawUrl = reelObj.video_url;
            const downloadUrl = rawUrl.startsWith('http') 
              ? rawUrl 
              : `${apiURL}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
            
            const contentId = reelObj.content_id || `legacy_${index}_${Date.now()}`;
            const ids = findIdsForSubtopic(doc, subtopicId);
            const videoKey = `classroom/clients/${clientId}/exams/${examId}/topics/${ids?.topicId || 'default'}/subtopics/${subtopicId}/reels/reel_${contentId}.mp4`;
            
            try {
              console.log(`Migrating legacy reel to R2 on the fly: ${downloadUrl}`);
              const downloadRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
              const videoBuffer = Buffer.from(downloadRes.data);
              
              await uploadFileToS3(videoBuffer, videoKey, 'video/mp4');
              
              // Update in database and local response object
              reel.video_url = videoKey;
              reelObj.video_url = await generateGetPresignedUrl(videoKey);
              hasUpdates = true;
            } catch (err) {
              console.error(`Failed to migrate legacy reel ${downloadUrl} to R2:`, err.message);
              // Fallback to absolute partner URL so it still plays if R2 fails
              reelObj.video_url = downloadUrl;
            }
          }
        }
        return reelObj;
      }));

      if (hasUpdates) {
        doc.markModified('tree');
        await doc.save();
        console.log("Successfully migrated legacy reels to R2 and updated MongoDB.");
      }

      return res.status(200).json({ success: true, reels: formattedReels });
    }

    // 2. If no local reels cached, fallback to partner server & migrate them to R2
    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.get(`${apiURL}/api/classroom/subtopics/${subtopicId}/reels`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const partnerReels = response.data.reels || [];
      const ids = findIdsForSubtopic(doc, subtopicId);
      
      let updatedLocalReels = [];
      const formattedReels = await Promise.all(partnerReels.map(async (reel, index) => {
        const reelObj = { ...reel };
        const rawUrl = reel.video_url || reel.media_url || '';
        const downloadUrl = rawUrl.startsWith('http') 
          ? rawUrl 
          : `${apiURL}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
        
        const contentId = reel.content_id || `migration_${index}_${Date.now()}`;
        const videoKey = `classroom/clients/${clientId}/exams/${examId}/topics/${ids?.topicId || 'default'}/subtopics/${subtopicId}/reels/reel_${contentId}.mp4`;
        
        let finalUrl = downloadUrl;
        try {
          console.log(`Migrating partner reel to R2 on the fly: ${downloadUrl}`);
          const downloadRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
          const videoBuffer = Buffer.from(downloadRes.data);
          
          await uploadFileToS3(videoBuffer, videoKey, 'video/mp4');
          finalUrl = await generateGetPresignedUrl(videoKey);
          
          updatedLocalReels.push({
            video_url: videoKey,
            content_id: contentId,
            script: reel.script || '',
            created_at: reel.created_at || new Date().toISOString()
          });
        } catch (r2Err) {
          console.error(`Failed to migrate partner reel ${downloadUrl} to R2:`, r2Err.message);
          finalUrl = downloadUrl;
        }

        reelObj.video_url = finalUrl;
        reelObj.media_url = finalUrl;
        return reelObj;
      }));

      // Update local MongoDB document with migrated reels
      if (updatedLocalReels.length > 0 && foundSubtopic) {
        foundSubtopic.reels = updatedLocalReels;
        doc.markModified('tree');
        await doc.save();
        console.log("Successfully migrated partner reels to R2 and updated MongoDB.");
      }

      return res.status(200).json({ success: true, reels: formattedReels });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to fetch reels from partner server' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get API configuration details
const getApiConfig = () => {
  const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
  const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';
  return { apiURL, appToken };
};

// ======================================================
// 📊 AI PYQs PROXY CONTROLLERS
// ======================================================

// GET /api/classroom-exams/pyq-sets
exports.getPyqSets = async (req, res) => {
  try {
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/pyq-sets`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error fetching PYQ sets:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/pyq-sets
exports.createPyqSet = async (req, res) => {
  try {
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/pyq-sets`, req.body, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error creating PYQ set:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/pyq-sets/:pyqSetId/upload-pdf
exports.uploadPyqPdf = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const { pyqSetId } = req.params;
    const { apiURL, appToken } = getApiConfig();

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const response = await axios.post(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}/upload-pdf`, form, {
      headers: {
        'X-App-Token': appToken,
        ...form.getHeaders()
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error uploading PYQ PDF:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/pyq-sets/:pyqSetId/questions
exports.getPyqQuestions = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}/questions`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error fetching PYQ questions:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/pyqs/:pyqSetId/generate-transcript
exports.generatePyqTranscript = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/pyqs/${pyqSetId}/generate-transcript`, req.body, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating PYQ transcript:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/pyq-sets/:pyqSetId/reels
exports.getPyqReels = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}/reels`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error fetching PYQ reels:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/pyq-sets/reels/:reelId
exports.deletePyqReel = async (req, res) => {
  try {
    const { reelId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.delete(`${apiURL}/api/classroom/pyq-sets/reels/${reelId}`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting PYQ reel:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 📰 AI CURRENT AFFAIRS PROXY CONTROLLERS
// ======================================================

// GET /api/classroom-exams/current-affairs
exports.getCurrentAffairs = async (req, res) => {
  try {
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/current-affairs`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error fetching current affairs:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/current-affairs
exports.createCurrentAffair = async (req, res) => {
  try {
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/current-affairs`, req.body, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error creating current affair:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// PUT /api/classroom-exams/current-affairs/:caTopicId
exports.updateCurrentAffair = async (req, res) => {
  try {
    const { caTopicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.put(`${apiURL}/api/classroom/current-affairs/${caTopicId}`, req.body, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error updating current affair:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/current-affairs/:caTopicId/upload-pdf
exports.uploadCurrentAffairPdf = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const { caTopicId } = req.params;
    const { apiURL, appToken } = getApiConfig();

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const response = await axios.post(`${apiURL}/api/classroom/current-affairs/${caTopicId}/upload-pdf`, form, {
      headers: {
        'X-App-Token': appToken,
        ...form.getHeaders()
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error uploading current affairs PDF:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/current-affairs/:caTopicId/generate-transcript
exports.generateCurrentAffairTranscript = async (req, res) => {
  try {
    const { caTopicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/current-affairs/${caTopicId}/generate-transcript`, req.body, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating current affairs transcript:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/current-affairs/:caTopicId/reels
exports.getCurrentAffairReels = async (req, res) => {
  try {
    const { caTopicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/current-affairs/${caTopicId}/reels`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error fetching current affairs reels:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

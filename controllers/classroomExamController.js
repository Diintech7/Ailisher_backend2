const axios = require('axios');
const ClassroomExam = require('../models/ClassroomExam');
const ClassroomPyqSet = require('../models/ClassroomPyqSet');
const ClassroomCurrentAffair = require('../models/ClassroomCurrentAffair');
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

// Helper to resolve examId dynamically if missing in req.params
const resolveExamId = async (req, params) => {
  const { examId, paperId, subjectId, chapterId, topicId, subtopicId } = params;
  if (examId) return examId;
  const clientId = getClientId(req);
  if (paperId) {
    const doc = await ClassroomExam.findOne({ "tree.paper_id": paperId, clientId }).select('exam_id');
    return doc ? doc.exam_id : null;
  }
  if (subjectId) {
    const doc = await ClassroomExam.findOne({ "tree.subjects.subject_id": subjectId, clientId }).select('exam_id');
    return doc ? doc.exam_id : null;
  }
  if (chapterId) {
    const doc = await ClassroomExam.findOne({ "tree.subjects.chapters.chapter_id": chapterId, clientId }).select('exam_id');
    return doc ? doc.exam_id : null;
  }
  if (topicId) {
    const doc = await ClassroomExam.findOne({ "tree.subjects.chapters.topics.topic_id": topicId, clientId }).select('exam_id');
    return doc ? doc.exam_id : null;
  }
  if (subtopicId) {
    const doc = await ClassroomExam.findOne({ "tree.subjects.chapters.topics.subtopics.subtopic_id": subtopicId, clientId }).select('exam_id');
    return doc ? doc.exam_id : null;
  }
  return null;
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

// GET /api/classroom-exams - Fetch exams synced/created by the current client (or system defaults)
exports.getExams = async (req, res) => {
  try {
    const clientId = getClientId(req);
    
    // Fetch exams that belong to this client or system default exams
    const localExams = await ClassroomExam.find({
      $or: [
        { clientId: clientId },
        { clientId: 'system' }
      ]
    });

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const formatImageUrl = (url) => {
      if (!url) return '';
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
    };

    const enrichedExams = await Promise.all(localExams.map(async exam => {
      const userId = req.user?.id || req.user?.userId;
      const planStatus = await checkExamPlanStatus(exam.exam_id, clientId, userId);
      return {
        exam_id: exam.exam_id,
        name: exam.name,
        category: exam.category,
        description: exam.description || '',
        image_url: formatImageUrl(exam.image_url),
        isSynced: true, // Since it is in local DB, it is synced
        syncedAt: exam.synced_at || exam.created_at || null,
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
  } catch (error) {
    console.error('Error fetching exams from local database:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Server Error fetching classroom data'
    });
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
    const paperId = req.params.paperId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this paper' });
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });
    const paper = doc.tree.find(p => p.paper_id === paperId);
    if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });
    
    const rawSubjects = paper.subjects || [];
    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const formatImageUrl = (url) => {
      if (!url) return '';
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
    };

    const subjects = await Promise.all(rawSubjects.map(async s => {
      const userId = req.user?.id || req.user?.userId;
      const planStatus = await checkSubjectPlanStatus(examId, s.subject_id, clientId, userId);
      return {
        subject_id: s.subject_id,
        exam_id: s.exam_id,
        paper_id: s.paper_id,
        name: s.name,
        color: s.color,
        image_url: formatImageUrl(s.image_url),
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
    const subjectId = req.params.subjectId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this subject' });
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
    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const formatImageUrl = (url) => {
      if (!url) return '';
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
    };

    const chapters = rawChapters.map(c => ({
      chapter_id: c.chapter_id,
      subject_id: c.subject_id,
      name: c.name,
      image_url: formatImageUrl(c.image_url),
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
    const chapterId = req.params.chapterId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this chapter' });
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
    const topicId = req.params.topicId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this topic' });
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
    const subtopicId = req.params.subtopicId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this subtopic' });
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
    const paperId = req.params.paperId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this paper' });
    const { name, color, image_url } = req.body;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/papers/${paperId}/subjects`, { name, color, image_url }, {
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
          image_url: newSubject.image_url || image_url || '',
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
    const subjectId = req.params.subjectId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this subject' });
    const { name, image_url } = req.body;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/subjects/${subjectId}/chapters`, { name, image_url }, {
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
            image_url: newChapter.image_url || image_url || '',
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
    const chapterId = req.params.chapterId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this chapter' });
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
    const topicId = req.params.topicId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this topic' });
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
    const subtopicId = req.params.subtopicId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this subtopic' });
    const { language = 'English', force = false } = req.body;
    const clientId = getClientId(req);
    const doc = await ClassroomExam.findOne({ exam_id: examId, clientId });
    if (!doc) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const foundSubjectId = findSubjectIdFromSubtopic(doc, subtopicId);
    const hasAccess = await verifyAccess(req, res, examId, foundSubjectId);
    if (!hasAccess) return;

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/subtopics/${subtopicId}/generate-notes`, { 
      language,
      force: force === true || force === 'true'
    }, {
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
    const subtopicId = req.params.subtopicId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this subtopic' });
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
    const subtopicId = req.params.subtopicId;
    const examId = await resolveExamId(req, req.params);
    if (!examId) return res.status(404).json({ success: false, message: 'Classroom not found for this subtopic' });
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

    if (response.data && response.data.success) {
      const clientId = getClientId(req);
      const allSets = response.data.pyq_sets || [];

      // Auto-sync: Upsert all sets from partner API locally for this client
      await Promise.all(allSets.map(async s => {
        await ClassroomPyqSet.findOneAndUpdate(
          { pyq_set_id: s.pyq_set_id, clientId },
          {
            pyq_set_id: s.pyq_set_id,
            name: s.name,
            year: s.year || null,
            description: s.description || '',
            question_count: s.question_count || 0,
            clientId
          },
          { upsert: true, new: true }
        );
      }));

      const localSets = await ClassroomPyqSet.find({ 
        $or: [
          { clientId: clientId },
          { clientId: 'system' }
        ]
      });

      return res.status(200).json({
        success: true,
        pyq_sets: localSets
      });
    } else {
      return res.status(response.status).json(response.data);
    }
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

    if (response.data && response.data.success) {
      const pyqSet = response.data.pyq_set || response.data.data;
      if (pyqSet && pyqSet.pyq_set_id) {
        const clientId = getClientId(req);
        await ClassroomPyqSet.findOneAndUpdate(
          { pyq_set_id: pyqSet.pyq_set_id, clientId },
          {
            pyq_set_id: pyqSet.pyq_set_id,
            name: pyqSet.name || req.body.name,
            year: pyqSet.year || req.body.year || null,
            description: pyqSet.description || req.body.description || '',
            question_count: pyqSet.question_count || 0,
            clientId
          },
          { upsert: true, new: true }
        );
      }
    }

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
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();
    const { isCustom } = req.query;

    if (isCustom === 'true') {
      const localTopics = await ClassroomCurrentAffair.find({ clientId, isCustom: true }).lean();
      const enrichedTopics = localTopics.map(topic => ({
        ...topic,
        title: topic.title || 'Untitled Current Affair',
        name: topic.title || 'Untitled Current Affair',
        reel_count: topic.reels ? topic.reels.length : 0
      }));
      return res.status(200).json({
        success: true,
        topics: enrichedTopics
      });
    }

    const response = await axios.get(`${apiURL}/api/classroom/current-affairs`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.success) {
      const allTopics = response.data.topics || [];

      // Auto-sync: Upsert all topics from partner API locally for this client
      await Promise.all(allTopics.map(async t => {
        await ClassroomCurrentAffair.findOneAndUpdate(
          { ca_topic_id: t.ca_topic_id, clientId },
          {
            ca_topic_id: t.ca_topic_id,
            title: t.title || t.name || 'Untitled Current Affair',
            category: t.category || '',
            isCustom: false,
            clientId
          },
          { upsert: true, new: true }
        );
      }));

      const localTopics = await ClassroomCurrentAffair.find({ clientId, isCustom: { $ne: true } }).lean();

      // Map external fields (name, title, reel_count) in-memory to preserve dynamic metrics and fallbacks
      const apiTopicMap = {};
      allTopics.forEach(t => {
        if (t.ca_topic_id) {
          apiTopicMap[t.ca_topic_id] = t;
        }
      });

      const enrichedTopics = localTopics.map(topic => {
        const apiTopic = apiTopicMap[topic.ca_topic_id] || {};
        return {
          ...topic,
          title: topic.title || apiTopic.title || apiTopic.name || 'Untitled Current Affair',
          name: apiTopic.name || topic.title || 'Untitled Current Affair',
          reel_count: apiTopic.reel_count || 0
        };
      });

      return res.status(200).json({
        success: true,
        topics: enrichedTopics
      });
    } else {
      return res.status(response.status).json(response.data);
    }
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
    const clientId = getClientId(req);
    const { title, category, isCustom } = req.body;

    if (isCustom === true || isCustom === 'true') {
      const topicId = `custom-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const newTopic = await ClassroomCurrentAffair.create({
        ca_topic_id: topicId,
        title: title || 'Untitled Custom Category',
        category: category || '',
        isCustom: true,
        clientId,
        reels: []
      });
      return res.status(201).json({
        success: true,
        topic: newTopic
      });
    }

    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/current-affairs`, req.body, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.success) {
      const topic = response.data.topic || response.data.data;
      if (topic && topic.ca_topic_id) {
        await ClassroomCurrentAffair.findOneAndUpdate(
          { ca_topic_id: topic.ca_topic_id, clientId },
          {
            ca_topic_id: topic.ca_topic_id,
            title: topic.title || req.body.title || req.body.name || topic.name || 'Untitled Current Affair',
            category: topic.category || req.body.category || '',
            isCustom: false,
            clientId
          },
          { upsert: true, new: true }
        );
      }
    }

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
    const clientId = getClientId(req);

    // Verify ownership
    const hasAccess = await ClassroomCurrentAffair.findOne({ ca_topic_id: caTopicId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized current affairs access' });

    if (hasAccess.isCustom) {
      const updated = await ClassroomCurrentAffair.findOneAndUpdate(
        { ca_topic_id: caTopicId, clientId },
        {
          title: req.body.title || hasAccess.title,
          category: req.body.category || hasAccess.category
        },
        { new: true }
      );
      return res.status(200).json({
        success: true,
        topic: updated
      });
    }

    const { apiURL, appToken } = getApiConfig();
    const response = await axios.put(`${apiURL}/api/classroom/current-affairs/${caTopicId}`, req.body, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.success) {
      const topic = response.data.topic || response.data.data;
      if (topic) {
        await ClassroomCurrentAffair.findOneAndUpdate(
          { ca_topic_id: caTopicId, clientId },
          {
            title: topic.title || req.body.title || req.body.name || topic.name,
            category: topic.category || req.body.category || ''
          }
        );
      }
    }

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
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // Verify ownership
    const hasAccess = await ClassroomCurrentAffair.findOne({ ca_topic_id: caTopicId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized current affairs access' });

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
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // Verify ownership
    const hasAccess = await ClassroomCurrentAffair.findOne({ ca_topic_id: caTopicId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized current affairs access' });

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
    const clientId = getClientId(req);

    // Verify ownership
    const hasAccess = await ClassroomCurrentAffair.findOne({ ca_topic_id: caTopicId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized current affairs access' });

    if (hasAccess.isCustom) {
      const enrichedReels = await Promise.all((hasAccess.reels || []).map(async r => {
        let playUrl = r.video_url;
        if (r.video_key) {
          try {
            playUrl = await generateGetPresignedUrl(r.video_key);
          } catch (e) {
            console.error('Error generating presigned URL for custom reel:', e.message);
          }
        }
        return {
          reel_id: r.reel_id,
          title: r.title,
          video_url: playUrl,
          video_key: r.video_key,
          isEnabled: r.isEnabled !== false,
          created_at: r.created_at
        };
      }));
      return res.status(200).json({
        success: true,
        reels: enrichedReels
      });
    }

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

// ======================================================
// 🔄 LOCAL CACHE SYNC HELPER
// ======================================================
const syncLocalExamTree = async (examId, clientId) => {
  try {
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/exams/${examId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    if (response.data && response.data.success) {
      const { exam, tree } = response.data;
      const formatImageUrl = (url) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
      };
      await ClassroomExam.findOneAndUpdate(
        { exam_id: examId, clientId },
        {
          name: exam.name,
          category: exam.category,
          image_url: formatImageUrl(exam.image_url),
          description: exam.description,
          tree: tree || [],
          synced_at: new Date()
        }
      );
    }
  } catch (err) {
    console.error(`Helper sync failed for exam ${examId}:`, err.message);
  }
};

// ======================================================
// 🎓 CLASSROOM EXAMS (PUT / DELETE / HISTORY)
// ======================================================

// PUT /api/classroom-exams/:examId
exports.updateExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.put(`${apiURL}/api/classroom/exams/${examId}`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const exam = response.data.exam || response.data.data;
      const formatImageUrl = (url) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
      };
      await ClassroomExam.findOneAndUpdate(
        { exam_id: examId, clientId },
        {
          name: exam.name || req.body.name,
          category: exam.category || req.body.category,
          description: exam.description || req.body.description,
          image_url: formatImageUrl(exam.image_url || req.body.image_url)
        }
      );
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error updating exam:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/:examId
exports.deleteExam = async (req, res) => {
  try {
    const { examId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.delete(`${apiURL}/api/classroom/exams/${examId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      await ClassroomExam.findOneAndDelete({ exam_id: examId, clientId });
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting exam:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/:examId/history
exports.getStudyHistory = async (req, res) => {
  try {
    const { examId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/exams/${examId}/history`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error fetching study history:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 📄 PAPERS (CRUD / CHATBOT / AI STRUCTURE)
// ======================================================

// POST /api/classroom-exams/:examId/papers
exports.createPaper = async (req, res) => {
  try {
    const { examId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/exams/${examId}/papers`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const paper = response.data.paper || response.data.data;
      if (paper) {
        const exam = await ClassroomExam.findOne({ exam_id: examId, clientId });
        if (exam) {
          if (!exam.tree) exam.tree = [];
          exam.tree.push({
            paper_id: paper.paper_id,
            exam_id: examId,
            name: paper.name,
            subjects: [],
            created_at: new Date().toISOString()
          });
          exam.markModified('tree');
          await exam.save();
        }
      }
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error creating paper:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// PUT /api/classroom-exams/papers/:paperId
exports.updatePaper = async (req, res) => {
  try {
    const { paperId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.put(`${apiURL}/api/classroom/papers/${paperId}`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const paper = response.data.paper || response.data.data;
      const exam = await ClassroomExam.findOne({ "tree.paper_id": paperId, clientId });
      if (exam && paper) {
        const pIdx = exam.tree.findIndex(p => p.paper_id === paperId);
        if (pIdx !== -1) {
          exam.tree[pIdx].name = paper.name || req.body.name;
          exam.markModified('tree');
          await exam.save();
        }
      }
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error updating paper:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/papers/:paperId
exports.deletePaper = async (req, res) => {
  try {
    const { paperId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.delete(`${apiURL}/api/classroom/papers/${paperId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const exam = await ClassroomExam.findOne({ "tree.paper_id": paperId, clientId });
      if (exam) {
        exam.tree = exam.tree.filter(p => p.paper_id !== paperId);
        exam.markModified('tree');
        await exam.save();
      }
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting paper:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/papers/:paperId/auto-generate
exports.autoGenerateStructure = async (req, res) => {
  try {
    const { paperId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // Verify client has access to this paper
    const examDoc = await ClassroomExam.findOne({ "tree.paper_id": paperId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized access to paper' });

    const response = await axios.post(`${apiURL}/api/classroom/papers/${paperId}/auto-generate`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      // Sync the local DB cache in background
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error auto-generating structure:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/papers/:paperId/vectorize
exports.vectorizePaper = async (req, res) => {
  try {
    const { paperId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // Verify ownership
    const examDoc = await ClassroomExam.findOne({ "tree.paper_id": paperId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized access to paper' });

    const response = await axios.post(`${apiURL}/api/classroom/papers/${paperId}/vectorize`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error vectorizing paper:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/papers/:paperId/chat (With Client Isolation Check)
exports.chatWithPaper = async (req, res) => {
  try {
    const { paperId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // STRICT CLIENT ISOLATION CHECK: Validate client owns this paper
    const examDoc = await ClassroomExam.findOne({ "tree.paper_id": paperId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized access to paper' });

    const response = await axios.post(`${apiURL}/api/classroom/papers/${paperId}/chat`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error chatting with paper:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/papers/:paperId/chat/history
exports.getPaperChatHistory = async (req, res) => {
  try {
    const { paperId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // STRICT CLIENT ISOLATION CHECK: Validate client owns this paper
    const examDoc = await ClassroomExam.findOne({ "tree.paper_id": paperId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized access to paper' });

    const response = await axios.get(`${apiURL}/api/classroom/papers/${paperId}/chat/history`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error getting paper chat history:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/papers/:paperId/chat/history
exports.clearPaperChatHistory = async (req, res) => {
  try {
    const { paperId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // STRICT CLIENT ISOLATION CHECK: Validate client owns this paper
    const examDoc = await ClassroomExam.findOne({ "tree.paper_id": paperId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized access to paper' });

    const response = await axios.delete(`${apiURL}/api/classroom/papers/${paperId}/chat/history`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error clearing paper chat history:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 📚 SUBJECTS (PUT / DELETE / UPLOAD INDEX)
// ======================================================

// PUT /api/classroom-exams/subjects/:subjectId
exports.updateSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    const examDoc = await ClassroomExam.findOne({ "tree.subjects.subject_id": subjectId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized subject access' });

    const response = await axios.put(`${apiURL}/api/classroom/subjects/${subjectId}`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error updating subject:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/subjects/:subjectId
exports.deleteSubject = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    const examDoc = await ClassroomExam.findOne({ "tree.subjects.subject_id": subjectId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized subject access' });

    const response = await axios.delete(`${apiURL}/api/classroom/subjects/${subjectId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting subject:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/subjects/:subjectId/upload-index
exports.uploadSubjectIndex = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const { subjectId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    const examDoc = await ClassroomExam.findOne({ "tree.subjects.subject_id": subjectId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized subject access' });

    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    const response = await axios.post(`${apiURL}/api/classroom/subjects/${subjectId}/upload-index`, form, {
      headers: {
        'X-App-Token': appToken,
        ...form.getHeaders()
      }
    });

    if (response.data && response.data.success) {
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error uploading subject index:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 📁 CHAPTERS (PUT / DELETE)
// ======================================================

// PUT /api/classroom-exams/chapters/:chapterId
exports.updateChapter = async (req, res) => {
  try {
    const { chapterId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    const examDoc = await ClassroomExam.findOne({ "tree.subjects.chapters.chapter_id": chapterId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized chapter access' });

    const response = await axios.put(`${apiURL}/api/classroom/chapters/${chapterId}`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error updating chapter:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/chapters/:chapterId
exports.deleteChapter = async (req, res) => {
  try {
    const { chapterId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    const examDoc = await ClassroomExam.findOne({ "tree.subjects.chapters.chapter_id": chapterId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized chapter access' });

    const response = await axios.delete(`${apiURL}/api/classroom/chapters/${chapterId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting chapter:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 🏷️ TOPICS (PUT / DELETE / AI DESC & NOTES / QUIZ / TRANSCRIPT / REELS)
// ======================================================

// PUT /api/classroom-exams/topics/:topicId
exports.updateTopic = async (req, res) => {
  try {
    const { topicId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    const examDoc = await ClassroomExam.findOne({ "tree.subjects.chapters.topics.topic_id": topicId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized topic access' });

    const response = await axios.put(`${apiURL}/api/classroom/topics/${topicId}`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error updating topic:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/topics/:topicId
exports.deleteTopic = async (req, res) => {
  try {
    const { topicId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    const examDoc = await ClassroomExam.findOne({ "tree.subjects.chapters.topics.topic_id": topicId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized topic access' });

    const response = await axios.delete(`${apiURL}/api/classroom/topics/${topicId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting topic:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/topics/:topicId/generate-description
exports.generateTopicDescription = async (req, res) => {
  try {
    const { topicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/topics/${topicId}/generate-description`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating topic description:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/topics/:topicId/generate-notes
exports.generateTopicNotes = async (req, res) => {
  try {
    const { topicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/topics/${topicId}/generate-notes`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating topic notes:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/topics/:topicId/download-notes-pdf
exports.downloadTopicNotesPdf = async (req, res) => {
  try {
    const { topicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/topics/${topicId}/download-notes-pdf`, {
      headers: { 'X-App-Token': appToken },
      responseType: 'stream'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=topic_${topicId}_notes.pdf`);
    response.data.pipe(res);
  } catch (error) {
    console.error('Error downloading topic notes PDF:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/topics/:topicId/quiz/generate
exports.generateTopicQuiz = async (req, res) => {
  try {
    const { topicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/topics/${topicId}/quiz/generate`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating topic quiz:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/topics/:topicId/generate-transcript
exports.generateTopicTranscript = async (req, res) => {
  try {
    const { topicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/topics/${topicId}/generate-transcript`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating topic transcript:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/topics/:topicId/reels
exports.getTopicReels = async (req, res) => {
  try {
    const { topicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/topics/${topicId}/reels`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error fetching topic reels:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 📝 SUBTOPICS (PUT / DELETE / AI DESC / QUIZ / TRANSCRIPT)
// ======================================================

// PUT /api/classroom-exams/subtopics/:subtopicId
exports.updateSubtopic = async (req, res) => {
  try {
    const { subtopicId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    const examDoc = await ClassroomExam.findOne({ "tree.subjects.chapters.topics.subtopics.subtopic_id": subtopicId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized subtopic access' });

    const response = await axios.put(`${apiURL}/api/classroom/subtopics/${subtopicId}`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error updating subtopic:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/subtopics/:subtopicId
exports.deleteSubtopic = async (req, res) => {
  try {
    const { subtopicId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    const examDoc = await ClassroomExam.findOne({ "tree.subjects.chapters.topics.subtopics.subtopic_id": subtopicId, clientId });
    if (!examDoc) return res.status(403).json({ success: false, message: 'Unauthorized subtopic access' });

    const response = await axios.delete(`${apiURL}/api/classroom/subtopics/${subtopicId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      syncLocalExamTree(examDoc.exam_id, clientId);
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting subtopic:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/subtopics/:subtopicId/generate-description
exports.generateSubtopicDescription = async (req, res) => {
  try {
    const { subtopicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/subtopics/${subtopicId}/generate-description`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating subtopic description:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/subtopics/:subtopicId/download-notes-pdf
exports.downloadSubtopicNotesPdf = async (req, res) => {
  try {
    const { subtopicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/subtopics/${subtopicId}/download-notes-pdf`, {
      headers: { 'X-App-Token': appToken },
      responseType: 'stream'
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=subtopic_${subtopicId}_notes.pdf`);
    response.data.pipe(res);
  } catch (error) {
    console.error('Error downloading subtopic notes PDF:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/subtopics/:subtopicId/quiz/generate
exports.generateSubtopicQuiz = async (req, res) => {
  try {
    const { subtopicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/subtopics/${subtopicId}/quiz/generate`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating subtopic quiz:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/subtopics/:subtopicId/generate-transcript
exports.generateSubtopicTranscript = async (req, res) => {
  try {
    const { subtopicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/subtopics/${subtopicId}/generate-transcript`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating subtopic transcript:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 📰 CURRENT AFFAIRS (DELETE TOPIC / DELETE REEL / CUSTOM REEL ACTIONS / FEED)
// ======================================================

// Helper function to check subscription lock for current affairs topics
const checkCurrentAffairPlanStatus = async (caTopicId, clientId, userId) => {
  const planItems = await PlanItem.find({
    itemType: 'classroom-current-affair',
    referenceId: caTopicId,
    clientId: clientId
  });

  if (planItems.length === 0) {
    return { isPaid: false, isLocked: false, isEnrolled: true, plans: [] };
  }

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
    const enrolled = await UserPlan.findOne({
      userId: userId,
      clientId: clientId,
      planId: { $in: plans.map(p => p._id) },
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

// GET /api/classroom-exams/current-affairs/reels-feed
exports.getDailyReelsFeed = async (req, res) => {
  try {
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();
    const userId = req.user?.id || req.user?.userId;

    // 1. Fetch custom categories and extract their active reels
    const customTopics = await ClassroomCurrentAffair.find({ clientId, isCustom: true }).lean();
    const customReels = [];
    for (const topic of customTopics) {
      for (const r of (topic.reels || [])) {
        if (r.isEnabled !== false) {
          let playUrl = r.video_url;
          if (r.video_key) {
            try {
              playUrl = await generateGetPresignedUrl(r.video_key);
            } catch (e) {
              console.error('Error generating presigned URL:', e.message);
            }
          }
          customReels.push({
            reel_id: r.reel_id,
            title: r.title,
            video_url: playUrl,
            video_key: r.video_key,
            created_at: r.created_at || topic.created_at,
            topic_id: topic.ca_topic_id,
            topic_title: topic.title,
            category: (topic.category && topic.category.trim()) ? topic.category.trim() : "General",
            isCustom: true,
            script: r.script || ""
          });
        }
      }
    }

    // 2. Fetch partner categories and extract their reels
    const partnerTopics = await ClassroomCurrentAffair.find({ clientId, isCustom: { $ne: true } }).lean();
    const partnerReels = [];

    await Promise.all(partnerTopics.map(async topic => {
      try {
        const response = await axios.get(`${apiURL}/api/classroom/current-affairs/${topic.ca_topic_id}/reels`, {
          headers: {
            'X-App-Token': appToken,
            'Content-Type': 'application/json'
          },
          timeout: 4000
        });
        if (response.data && response.data.success) {
          const reels = response.data.reels || [];
          reels.forEach(r => {
            partnerReels.push({
              reel_id: r.reel_id,
              title: r.title || topic.title,
              video_url: r.media_url || r.video_url,
              created_at: r.created_at || topic.created_at,
              topic_id: topic.ca_topic_id,
              topic_title: topic.title,
              category: (topic.category && topic.category.trim()) ? topic.category.trim() : "General",
              isCustom: false,
              script: r.script || r.body || r.description || ""
            });
          });
        }
      } catch (err) {
        console.error(`Error loading partner reels for topic ${topic.ca_topic_id}:`, err.message);
      }
    }));

    // 3. Combine and sort newest first
    const allReels = [...customReels, ...partnerReels];
    allReels.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // 4. Plan/Lock status verification checks
    const checkedReels = await Promise.all(allReels.map(async r => {
      const planStatus = await checkCurrentAffairPlanStatus(r.topic_id, clientId, userId);
      return {
        ...r,
        isLocked: planStatus.isLocked,
        isPaid: planStatus.isPaid,
        plans: planStatus.plans,
        video_url: planStatus.isLocked ? '' : r.video_url
      };
    }));

    return res.status(200).json({
      success: true,
      count: checkedReels.length,
      reels: checkedReels
    });
  } catch (error) {
    console.error('Error generating reels feed:', error.message);
    return res.status(500).json({ success: false, message: 'Server Error generating reels feed' });
  }
};

// DELETE /api/classroom-exams/current-affairs/:caTopicId
exports.deleteCurrentAffair = async (req, res) => {
  try {
    const { caTopicId } = req.params;
    const clientId = getClientId(req);

    // Verify ownership
    const hasAccess = await ClassroomCurrentAffair.findOne({ ca_topic_id: caTopicId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized current affairs access' });

    if (hasAccess.isCustom) {
      if (hasAccess.reels && hasAccess.reels.length > 0) {
        const { deleteObject } = require('../utils/r2');
        for (const r of hasAccess.reels) {
          if (r.video_key) {
            try {
              await deleteObject(r.video_key);
            } catch (e) {
              console.error('Error deleting R2 object during topic deletion:', e.message);
            }
          }
        }
      }
      await ClassroomCurrentAffair.findOneAndDelete({ ca_topic_id: caTopicId, clientId });
      return res.status(200).json({ success: true, message: 'Custom current affairs topic deleted successfully' });
    }

    const { apiURL, appToken } = getApiConfig();
    const response = await axios.delete(`${apiURL}/api/classroom/current-affairs/${caTopicId}`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.success) {
      await ClassroomCurrentAffair.findOneAndDelete({ ca_topic_id: caTopicId, clientId });
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting current affair topic:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/current-affairs/:caTopicId/reels
exports.createCurrentAffairReel = async (req, res) => {
  try {
    const { caTopicId } = req.params;
    const clientId = getClientId(req);
    const { title, video_url, video_key } = req.body;

    if (!title || (!video_url && !video_key)) {
      return res.status(400).json({ success: false, message: 'Title and video source are required' });
    }

    const topic = await ClassroomCurrentAffair.findOne({ ca_topic_id: caTopicId, clientId });
    if (!topic) return res.status(404).json({ success: false, message: 'Topic not found' });
    if (!topic.isCustom) return res.status(400).json({ success: false, message: 'Cannot add custom reels to partner synced topics' });

    const reelId = `reel-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const newReel = {
      reel_id: reelId,
      title,
      video_url: video_url || '',
      video_key: video_key || '',
      isEnabled: true,
      created_at: new Date()
    };

    topic.reels.push(newReel);
    await topic.save();

    return res.status(201).json({ success: true, reel: newReel });
  } catch (error) {
    console.error('Error creating custom reel:', error.message);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// PATCH /api/classroom-exams/current-affairs/reels/:reelId/status
exports.toggleCurrentAffairReelStatus = async (req, res) => {
  try {
    const { reelId } = req.params;
    const clientId = getClientId(req);
    const { isEnabled } = req.body;

    const topic = await ClassroomCurrentAffair.findOne({ 'reels.reel_id': reelId, clientId });
    if (!topic) return res.status(404).json({ success: false, message: 'Reel not found' });

    const reel = topic.reels.find(r => r.reel_id === reelId);
    if (reel) {
      reel.isEnabled = typeof isEnabled === 'boolean' ? isEnabled : !reel.isEnabled;
      await topic.save();
      return res.status(200).json({ success: true, message: 'Reel status updated successfully', reel });
    }
    return res.status(404).json({ success: false, message: 'Reel not found inside topic' });
  } catch (error) {
    console.error('Error toggling reel status:', error.message);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// DELETE /api/classroom-exams/current-affairs/reels/:reelId
exports.deleteCurrentAffairReel = async (req, res) => {
  try {
    const { reelId } = req.params;
    const clientId = getClientId(req);

    // Check if it's a local custom reel first
    const topic = await ClassroomCurrentAffair.findOne({ 'reels.reel_id': reelId, clientId });
    if (topic) {
      const reel = topic.reels.find(r => r.reel_id === reelId);
      if (reel && reel.video_key) {
        const { deleteObject } = require('../utils/r2');
        try {
          await deleteObject(reel.video_key);
        } catch (e) {
          console.error('Error deleting R2 object:', e.message);
        }
      }
      topic.reels = topic.reels.filter(r => r.reel_id !== reelId);
      await topic.save();
      return res.status(200).json({ success: true, message: 'Custom reel deleted successfully' });
    }

    // Fallback to partner API delete for partner reels
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.delete(`${apiURL}/api/classroom/current-affairs/reels/${reelId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting current affair reel:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 📊 AI PYQs (PUT / DELETE / RESET / DELETE QUESTION / CHATBOT)
// ======================================================

// PUT /api/classroom-exams/pyq-sets/:pyqSetId
exports.updatePyqSet = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // Verify ownership
    const hasAccess = await ClassroomPyqSet.findOne({ pyq_set_id: pyqSetId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized PYQ set access' });

    const response = await axios.put(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const pyqSet = response.data.pyq_set || response.data.data;
      if (pyqSet) {
        await ClassroomPyqSet.findOneAndUpdate(
          { pyq_set_id: pyqSetId, clientId },
          {
            name: pyqSet.name || req.body.name,
            year: pyqSet.year || req.body.year || null,
            description: pyqSet.description || req.body.description || '',
            question_count: pyqSet.question_count || 0
          }
        );
      }
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error updating PYQ set:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/pyq-sets/:pyqSetId
exports.deletePyqSet = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // Verify ownership
    const hasAccess = await ClassroomPyqSet.findOne({ pyq_set_id: pyqSetId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized PYQ set access' });

    const response = await axios.delete(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      await ClassroomPyqSet.findOneAndDelete({ pyq_set_id: pyqSetId, clientId });
    }
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting PYQ set:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/pyq-sets/:pyqSetId/reset
exports.resetPyqSet = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // Verify ownership
    const hasAccess = await ClassroomPyqSet.findOne({ pyq_set_id: pyqSetId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized PYQ set access' });

    const response = await axios.post(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}/reset`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error resetting PYQ set:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/pyq-sets/questions/:questionId
exports.deletePyqQuestion = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.delete(`${apiURL}/api/classroom/pyq-sets/questions/${questionId}`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error deleting PYQ question:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/pyq-sets/:pyqSetId/generate-overview
exports.generatePyqOverview = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // Verify ownership
    const hasAccess = await ClassroomPyqSet.findOne({ pyq_set_id: pyqSetId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized PYQ set access' });

    const response = await axios.post(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}/generate-overview`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating PYQ overview:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/pyq-sets/:pyqSetId/vectorize
exports.vectorizePyqSet = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // Verify ownership
    const hasAccess = await ClassroomPyqSet.findOne({ pyq_set_id: pyqSetId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized PYQ set access' });

    const response = await axios.post(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}/vectorize`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error vectorizing PYQ set:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// POST /api/classroom-exams/pyq-sets/:pyqSetId/chat (With Client Isolation Check)
exports.chatWithPyqSet = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // STRICT CLIENT ISOLATION CHECK: Validate client owns this PYQ set
    const hasAccess = await ClassroomPyqSet.findOne({ pyq_set_id: pyqSetId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized PYQ set access' });

    const response = await axios.post(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}/chat`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error chatting with PYQ set:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/pyq-sets/:pyqSetId/chat/history
exports.getPyqChatHistory = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // STRICT CLIENT ISOLATION CHECK: Validate client owns this PYQ set
    const hasAccess = await ClassroomPyqSet.findOne({ pyq_set_id: pyqSetId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized PYQ set access' });

    const response = await axios.get(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}/chat/history`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error getting PYQ chat history:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// DELETE /api/classroom-exams/pyq-sets/:pyqSetId/chat/history
exports.clearPyqChatHistory = async (req, res) => {
  try {
    const { pyqSetId } = req.params;
    const clientId = getClientId(req);
    const { apiURL, appToken } = getApiConfig();

    // STRICT CLIENT ISOLATION CHECK: Validate client owns this PYQ set
    const hasAccess = await ClassroomPyqSet.findOne({ pyq_set_id: pyqSetId, clientId });
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized PYQ set access' });

    const response = await axios.delete(`${apiURL}/api/classroom/pyq-sets/${pyqSetId}/chat/history`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error clearing PYQ chat history:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 🎙️ TEXT-TO-SPEECH (TTS) (POST SPEAK / GET STREAM)
// ======================================================

// POST /api/classroom-exams/tts/speak
exports.generateTTS = async (req, res) => {
  try {
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.post(`${apiURL}/api/classroom/tts/speak`, req.body, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error generating TTS speak:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// GET /api/classroom-exams/tts/speak (Stream)
exports.streamTTS = async (req, res) => {
  try {
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/tts/speak`, {
      params: req.query,
      headers: { 'X-App-Token': appToken },
      responseType: 'stream'
    });
    res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
    response.data.pipe(res);
  } catch (error) {
    console.error('Error streaming TTS:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

// ======================================================
// 🔓 PUBLIC APIS (NO AUTH)
// ======================================================

// GET /api/classroom-exams/public/subtopics/:subtopicId/reels
exports.getPublicSubtopicReels = async (req, res) => {
  try {
    const { subtopicId } = req.params;
    const { apiURL, appToken } = getApiConfig();
    const response = await axios.get(`${apiURL}/api/classroom/public/subtopics/${subtopicId}/reels`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });
    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error fetching public subtopic reels:', error.message);
    const status = error.response ? error.response.status : 500;
    const message = error.response && error.response.data ? error.response.data : { success: false, message: error.message };
    return res.status(status).json(message);
  }
};

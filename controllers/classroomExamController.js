const axios = require('axios');
const ClassroomExam = require('../models/ClassroomExam');
const User = require('../models/User');

// Helper to resolve client ID
const getClientId = (req) => {
  if (req.clientId) return req.clientId;
  if (req.params.clientId) return req.params.clientId;
  
  const user = req.user;
  if (!user) return null;
  return user.role === 'client' && user.userId ? user.userId : user._id.toString();
};

// GET /api/classroom-exams - Fetch all exams from third-party Vectorize API
exports.getExams = async (req, res) => {
  try {
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

      const enrichedExams = response.data.exams.map(exam => ({
        ...exam,
        image_url: formatImageUrl(exam.image_url),
        isSynced: syncedIds.has(exam.exam_id),
        syncedAt: syncedExams.find(e => e.exam_id === exam.exam_id)?.synced_at || null
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

      const formattedLocal = localExams.map(exam => ({
        exam_id: exam.exam_id,
        name: exam.name,
        category: exam.category,
        image_url: formatImageUrl(exam.image_url),
        description: exam.description,
        isSynced: true,
        syncedAt: exam.synced_at,
        isFallback: true
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
    const subjects = rawSubjects.map(s => ({
      subject_id: s.subject_id,
      exam_id: s.exam_id,
      paper_id: s.paper_id,
      name: s.name,
      color: s.color,
      chapter_count: s.chapter_count || 0,
      topic_count: s.topic_count || 0,
      subtopic_count: s.subtopic_count || 0,
      created_at: s.created_at
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
    return res.status(200).json({ success: true, subtopic: foundSubtopic });
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

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/subtopics/${subtopicId}/generate-notes`, { language }, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      let updated = false;
      for (let paper of doc.tree) {
        for (let subject of paper.subjects) {
          for (let chap of subject.chapters) {
            for (let top of chap.topics) {
              const sub = top.subtopics.find(s => s.subtopic_id === subtopicId);
              if (sub) {
                sub.notes = response.data.notes || response.data.data?.notes || '';
                if (response.data.description) sub.description = response.data.description;
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

      return res.status(200).json({ success: true, notes: response.data.notes || '' });
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

    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.post(`${apiURL}/api/classroom/subtopics/${subtopicId}/generate-reel`, { language, voice_id }, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      const videoUrl = response.data.video_url || response.data.data?.video_url || '';
      
      let updated = false;
      for (let paper of doc.tree) {
        for (let subject of paper.subjects) {
          for (let chap of subject.chapters) {
            for (let top of chap.topics) {
              const sub = top.subtopics.find(s => s.subtopic_id === subtopicId);
              if (sub) {
                if (!sub.reels) sub.reels = [];
                sub.reels.push({
                  video_url: videoUrl,
                  content_id: response.data.content_id || '',
                  script: response.data.script || '',
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

      return res.status(200).json({ success: true, video_url: videoUrl, reel: response.data });
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
    const { subtopicId } = req.params;
    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const response = await axios.get(`${apiURL}/api/classroom/subtopics/${subtopicId}/reels`, {
      headers: { 'X-App-Token': appToken, 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success) {
      return res.status(200).json({ success: true, reels: response.data.reels || [] });
    } else {
      return res.status(400).json({ success: false, message: 'Failed to fetch reels from partner server' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

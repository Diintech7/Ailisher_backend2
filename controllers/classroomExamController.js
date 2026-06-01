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

const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const Book = require('../models/Book');
const Chapter = require('../models/Chapter');
const Topic = require('../models/Topic');
const SubTopic = require('../models/SubTopic');
const Summary = require('../models/Summary');
const Video = require('../models/Video');
const PYQ = require('../models/PYQ');
const QuestionSet = require('../models/QuestionSet');
const Question = require('../models/Question');
const ObjectiveQuestion = require('../models/ObjectiveQuestion');

const frontendBaseUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.trim() : 'https://ailisher-frontend.vercel.app';

// Helper function to generate colored QR code
const generateColoredQRCode = async (url, qrColor, size = 300) => {
  return await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: size,
    color: {
      dark: qrColor,
      light: '#FFFFFF'
    }
  });
};

// Helper function to fetch all asset data for an item
const fetchAssetData = async (itemType, itemId) => {
  const [summaries, videos, pyqs, questionSets] = await Promise.all([
    Summary.find({ itemType, itemId }),
    Video.find({ itemType, itemId, status: 'active' }),
    PYQ.find({ itemType, itemId }),
    QuestionSet.find({ [itemType]: itemId, isActive: true })
  ]);

  // For each question set, fetch the actual questions
  const questionSetsWithQuestions = await Promise.all(
    questionSets.map(async (set) => {
      let questions = [];
      
      try {
        if (set.type === 'objective') {
          // Fetch objective questions for this set
          questions = await ObjectiveQuestion.find({ questionSet: set._id });
        } else if (set.type === 'subjective') {
          // Fetch subjective questions for this set
          questions = await Question.find({ questionSet: set._id });
        }
      } catch (error) {
        console.error(`Error fetching questions for set ${set._id}:`, error);
        questions = []; // Set empty array if fetching fails
      }

      return {
        ...set.toObject(),
        questions: questions,
        totalQuestions: questions.length
      };
    })
  );

  // Separate question sets into subjective and objective
  const subjectiveQuestionSets = {
    L1: questionSetsWithQuestions.filter(qs => qs.type === 'subjective' && qs.level === 'L1'),
    L2: questionSetsWithQuestions.filter(qs => qs.type === 'subjective' && qs.level === 'L2'),
    L3: questionSetsWithQuestions.filter(qs => qs.type === 'subjective' && qs.level === 'L3')
  };

  const objectiveQuestionSets = {
    L1: questionSetsWithQuestions.filter(qs => qs.type === 'objective' && qs.level === 'L1'),
    L2: questionSetsWithQuestions.filter(qs => qs.type === 'objective' && qs.level === 'L2'),
    L3: questionSetsWithQuestions.filter(qs => qs.type === 'objective' && qs.level === 'L3')
  };

  return {
    summaries,
    videos,
    pyqs,
    subjectiveQuestionSets,
    objectiveQuestionSets
  };
};

// Generate QR code for a book
router.get('/books/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;
    
    const [book, chapters, assetData] = await Promise.all([
      Book.findById(bookId),
      Chapter.find({ book: bookId }).select('_id title description order').sort('order'),
      fetchAssetData('book', bookId)
    ]);

    if (!book) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book not found' 
      });
    }

    const bookUrl = `${frontendBaseUrl}/mobile-asset-view/${bookId}`;
    const qrCodeDataURL = await generateColoredQRCode(bookUrl, '#0047AB');

    res.json({
      success: true,
      qrCodeDataURL, 
      qrCodeType: 'book',
      qrCodeColor: '#0047AB',
      book: {
        id: book._id,
        title: book.title,
        description: book.description,
        coverImage: book.coverImage
      },
      chaptersCount: chapters.length,
      ...assetData
    });
    
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating QR code'
    });
  }
});

// Get book data when scanned from QR code
router.get('/book-data/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;
    
    const [book, chapters, assetData] = await Promise.all([
      Book.findById(bookId),
      Chapter.find({ book: bookId }).select('_id title description order').sort('order'),
      fetchAssetData('book', bookId)
    ]);

    if (!book) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book not found' 
      });
    }

    res.json({
      success: true,
      qrCodeType: 'book',
      book: {
        id: book._id,
        title: book.title,
        description: book.description,
        coverImage: book.coverImage
      },
      chapters: chapters,
      ...assetData
    });
    
  } catch (error) {
    console.error('Error fetching book data:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching book data'
    });
  }
});

// Generate QR code for a chapter
router.get('/books/:bookId/chapters/:chapterId', async (req, res) => {
  try {
    const { bookId, chapterId } = req.params;
    
    const [book, chapter, topics, assetData] = await Promise.all([
      Book.findById(bookId),
      Chapter.findOne({ _id: chapterId, book: bookId }),
      Topic.find({ chapter: chapterId }).select('_id title description order').sort('order'),
      fetchAssetData('chapter', chapterId)
    ]);

    if (!book || !chapter) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book or Chapter not found' 
      });
    }

    const chapterUrl = `${frontendBaseUrl}/mobile-asset-view/${bookId}/chapters/${chapterId}`;
    const qrCodeDataURL = await generateColoredQRCode(chapterUrl, '#009933');

    res.json({
      success: true,
      qrCodeDataURL,
      qrCodeType: 'chapter',
      qrCodeColor: '#009933',
      book: {
        id: book._id,
        title: book.title
      },
      chapter: {
        id: chapter._id,
        title: chapter.title,
        description: chapter.description
      },
      topicsCount: topics.length,
      ...assetData
    });
    
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating QR code'
    });
  }
});

// Get chapter data when scanned from QR code
router.get('/book-data/:bookId/chapters/:chapterId', async (req, res) => {
  try {
    const { bookId, chapterId } = req.params;
    
    const [book, chapter, topics, assetData] = await Promise.all([
      Book.findById(bookId),
      Chapter.findOne({ _id: chapterId, book: bookId }),
      Topic.find({ chapter: chapterId }).select('_id title description order content').sort('order'),
      fetchAssetData('chapter', chapterId)
    ]);

    if (!book || !chapter) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book or Chapter not found' 
      });
    }

    res.json({
      success: true,
      qrCodeType: 'chapter',
      book: {
        id: book._id,
        title: book.title,
        coverImage: book.coverImage
      },
      chapter: {
        id: chapter._id,
        title: chapter.title,
        description: chapter.description,
        order: chapter.order
      },
      topics: topics,
      ...assetData
    });
    
  } catch (error) {
    console.error('Error fetching chapter data:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching chapter data'
    });
    }
});

// Generate QR code for a topic
router.get('/books/:bookId/chapters/:chapterId/topics/:topicId', async (req, res) => {
  try {
    const { bookId, chapterId, topicId } = req.params;
    
    const [book, chapter, topic, subtopics, assetData] = await Promise.all([
      Book.findById(bookId),
      Chapter.findOne({ _id: chapterId, book: bookId }),
      Topic.findOne({ _id: topicId, chapter: chapterId }),
      SubTopic.find({ topic: topicId }).select('_id title description order').sort('order'),
      fetchAssetData('topic', topicId)
    ]);

    if (!book || !chapter || !topic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book, Chapter or Topic not found' 
      });
    }

    const topicUrl = `${frontendBaseUrl}/mobile-asset-view/${bookId}/chapters/${chapterId}/topics/${topicId}`;
    const qrCodeDataURL = await generateColoredQRCode(topicUrl, '#7B68EE');

    res.json({
      success: true,
      qrCodeDataURL,
      qrCodeType: 'topic',
      qrCodeColor: '#7B68EE',
      book: {
        id: book._id,
        title: book.title
      },
      chapter: {
        id: chapter._id,
        title: chapter.title
      },
      topic: {
        id: topic._id,
        title: topic.title,
        description: topic.description
      },
      subtopicsCount: subtopics.length,
      ...assetData
    });
    
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating QR code'
    });
  }
});

// Get topic data when scanned from QR code
router.get('/book-data/:bookId/chapters/:chapterId/topics/:topicId', async (req, res) => {
  try {
    const { bookId, chapterId, topicId } = req.params;
    
    const [book, chapter, topic, subtopics, assetData] = await Promise.all([
      Book.findById(bookId),
      Chapter.findOne({ _id: chapterId, book: bookId }),
      Topic.findOne({ _id: topicId, chapter: chapterId }),
      SubTopic.find({ topic: topicId }).select('_id title description order content').sort('order'),
      fetchAssetData('topic', topicId)
    ]);

    if (!book || !chapter || !topic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book, Chapter or Topic not found' 
      });
    }

    res.json({
      success: true,
      qrCodeType: 'topic',
      book: {
        id: book._id,
        title: book.title,
        coverImage: book.coverImage
      },
      chapter: {
        id: chapter._id,
        title: chapter.title
      },
      topic: {
        id: topic._id,
        title: topic.title,
        description: topic.description,
        content: topic.content,
        order: topic.order
      },
      subtopics: subtopics,
      ...assetData
    });
    
  } catch (error) {
    console.error('Error fetching topic data:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching topic data'
    });
  }
});

// Generate QR code for a subtopic
router.get('/books/:bookId/chapters/:chapterId/topics/:topicId/subtopics/:subtopicId', async (req, res) => {
  try {
    const { bookId, chapterId, topicId, subtopicId } = req.params;
    
    const [book, chapter, topic, subtopic, assetData] = await Promise.all([
      Book.findById(bookId),
      Chapter.findOne({ _id: chapterId, book: bookId }),
      Topic.findOne({ _id: topicId, chapter: chapterId }),
      SubTopic.findOne({ _id: subtopicId, topic: topicId }),
      fetchAssetData('subtopic', subtopicId)
    ]);

    if (!book || !chapter || !topic || !subtopic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book, Chapter, Topic or Sub-topic not found' 
      });
    }

    const subtopicUrl = `${frontendBaseUrl}/mobile-asset-view/${bookId}/chapters/${chapterId}/topics/${topicId}/subtopics/${subtopicId}`;
    const qrCodeDataURL = await generateColoredQRCode(subtopicUrl, '#FF8C00');

    res.json({
      success: true,
      qrCodeDataURL,
      qrCodeType: 'subtopic',
      qrCodeColor: '#FF8C00',
      book: {
        id: book._id,
        title: book.title
      },
      chapter: {
        id: chapter._id,
        title: chapter.title
      },
      topic: {
        id: topic._id,
        title: topic.title
      },
      subtopic: {
        id: subtopic._id,
        title: subtopic.title,
        description: subtopic.description
      },
      ...assetData
    });
    
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating QR code'
    });
  }
});

// Get subtopic data when scanned from QR code
router.get('/book-data/:bookId/chapters/:chapterId/topics/:topicId/subtopics/:subtopicId', async (req, res) => {
  try {
    const { bookId, chapterId, topicId, subtopicId } = req.params;
    
    const [book, chapter, topic, subtopic, assetData] = await Promise.all([
      Book.findById(bookId),
      Chapter.findOne({ _id: chapterId, book: bookId }),
      Topic.findOne({ _id: topicId, chapter: chapterId }),
      SubTopic.findOne({ _id: subtopicId, topic: topicId }),
      fetchAssetData('subtopic', subtopicId)
    ]);

    if (!book || !chapter || !topic || !subtopic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book, Chapter, Topic or Sub-topic not found' 
      });
    }

    res.json({
      success: true,
      qrCodeType: 'subtopic',
      book: {
        id: book._id,
        title: book.title,
        coverImage: book.coverImage
      },
      chapter: {
        id: chapter._id,
        title: chapter.title
      },
      topic: {
        id: topic._id,
        title: topic.title
      },
      subtopic: {
        id: subtopic._id,
        title: subtopic.title,
        description: subtopic.description,
        content: subtopic.content,
        order: subtopic.order
      },
      ...assetData
    });
    
  } catch (error) {
    console.error('Error fetching subtopic data:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching subtopic data'
    });
  }
});

module.exports = router;
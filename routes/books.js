// routes/books.js - Complete router with all functionality
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { 
  getCurrentUser,
  getCategoryMappings,
  getValidSubCategories,
  // Highlight functionality
  getHighlightedBooks,
  addBookToHighlights,
  removeBookFromHighlights,
  updateHighlightDetails,
  // Trending functionality
  getTrendingBooks,
  addBookToTrending,
  removeBookFromTrending,
  updateTrendingDetails,
  // Category order functionality
  updateCategoryOrder,
  resetCategoryOrder,
  updateCategoryOrderForAll
} = require('../controllers/bookController');
const { 
  getChapters, 
  getChapter, 
  createChapter, 
  updateChapter, 
  deleteChapter 
} = require('../controllers/chapterController');
const { 
  getTopics, 
  getTopic, 
  createTopic, 
  updateTopic, 
  deleteTopic 
} = require('../controllers/topicController');
const {
  getSubTopics,
  getSubTopic,
  createSubTopic,
  updateSubTopic,
  deleteSubTopic
} = require('../controllers/subtopicController');

const { 
  getBooks, 
  getBook, 
  createBook,
  getCoverImageUploadUrl,
  updateBook,
  deleteBook,
  getCoverImageDownloadUrl
} = require('../controllers/awsbookcontroller');
const categoryController = require('../controllers/categoryController');

// ==================== UTILITY ROUTES ====================
// Get current user info
router.get('/user', verifyToken, getCurrentUser);

// ==================== HIGHLIGHT ROUTES ====================
// Get all highlighted books
router.get('/highlighted', verifyToken, getHighlightedBooks);

// Add book to highlights
router.post('/:id/highlight', verifyToken, addBookToHighlights);

// Remove book from highlights
router.delete('/:id/highlight', verifyToken, removeBookFromHighlights);

// Update highlight details (note, order)
router.put('/:id/highlight', verifyToken, updateHighlightDetails);

// ==================== TRENDING ROUTES ====================
// Get all trending books
router.get('/trending', verifyToken, getTrendingBooks);

// Add book to trending
router.post('/:id/trending', verifyToken, addBookToTrending);

// Remove book from trending
router.delete('/:id/trending', verifyToken, removeBookFromTrending);

// Update trending details (score, end date)
router.put('/:id/trending', verifyToken, updateTrendingDetails);

// ==================== CATEGORY ORDER ROUTES ====================
// Update category order for a book
router.put('/:id/category-order', verifyToken, updateCategoryOrder);

// Reset category order for a book
router.delete('/:id/category-order', verifyToken, resetCategoryOrder);

// Update category order for all books in a category
router.put('/categories/:mainCategory/order', verifyToken, updateCategoryOrderForAll);

// ==================== BASIC BOOK ROUTES ====================
// Main book routes
// Get presigned URL for cover image upload
router.post('/cover-upload-url', verifyToken, getCoverImageUploadUrl);

// Get presigned URL for cover image
router.post('/cover-get-url', verifyToken, getCoverImageDownloadUrl);

// Main book routes
router.route('/')
  .get(verifyToken, getBooks)
  .post(verifyToken, createBook);

router.route('/:id')
  .get(verifyToken, getBook);

router.route('/:id')
  .put(verifyToken, updateBook)

router.route('/:id')
  .delete(verifyToken, deleteBook);
// ==================== CHAPTER ROUTES ====================
// Chapter routes for books
router.route('/:bookId/chapters')
  .get(verifyToken, getChapters)
  .post(verifyToken, createChapter);

router.route('/:bookId/chapters/:id')
  .get(verifyToken, getChapter)
  .put(verifyToken, updateChapter)
  .delete(verifyToken, deleteChapter);

// ==================== TOPIC ROUTES ====================
// Topic routes for chapters
router.route('/:bookId/chapters/:chapterId/topics')
  .get(verifyToken, getTopics)
  .post(verifyToken, createTopic);

router.route('/:bookId/chapters/:chapterId/topics/:id')
  .get(verifyToken, getTopic)
  .put(verifyToken, updateTopic)
  .delete(verifyToken, deleteTopic);

// ==================== SUBTOPIC ROUTES ====================
// Subtopic routes for topics
router.route('/:bookId/chapters/:chapterId/topics/:topicId/subtopics')
  .get(verifyToken, getSubTopics)
  .post(verifyToken, createSubTopic);

router.route('/:bookId/chapters/:chapterId/topics/:topicId/subtopics/:id')
  .get(verifyToken, getSubTopic)
  .put(verifyToken, updateSubTopic)
  .delete(verifyToken, deleteSubTopic);

module.exports = router;
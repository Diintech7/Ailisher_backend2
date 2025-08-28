const express = require('express');
const router = express.Router();
const { verifyToken, isClient } = require('../middleware/auth');
const {
  createMarketing,
  getMarketing,
  getMarketingById,
  updateMarketing,
  deleteMarketing,
  updatePosition,
  toggleActive,
  uploadImage,
  generateImage,
  getMarketingForMobile,
  importAiImage
} = require('../controllers/marketingController');
const { authenticateMobileUser, ensureUserBelongsToClient } = require('../middleware/mobileAuth');

// Mobile consumers should use a distinct path to avoid conflicting with client routes
router.get('/user',authenticateMobileUser,ensureUserBelongsToClient,getMarketingForMobile);

router.post('/upload-image', verifyToken, isClient, uploadImage);
router.post('/import-ai-image', verifyToken, isClient, importAiImage);

// @route   POST /api/marketing
// @desc    Create a new marketing item
// @access  Client only
router.post('/',verifyToken, isClient, createMarketing);

// @route   GET /api/marketing
// @desc    Get all marketing items with filters and pagination
// @access  Client only
router.get('/',verifyToken, isClient, getMarketing);



// @route   GET /api/marketing/:id
// @desc    Get marketing item by ID
// @access  Client only
router.get('/:id', verifyToken, isClient, getMarketingById);

// @route   PUT /api/marketing/:id
// @desc    Update marketing item
// @access  Client only
router.put('/:id', verifyToken, isClient, updateMarketing);

// @route   DELETE /api/marketing/:id
// @desc    Delete marketing item
// @access  Client only
router.delete('/:id', verifyToken, isClient, deleteMarketing);

// @route   PATCH /api/marketing/:id/position
// @desc    Update marketing item position
// @access  Client only
router.patch('/:id/position', verifyToken, isClient, updatePosition);

// @route   PATCH /api/marketing/:id/toggle-active
// @desc    Toggle marketing item active status
// @access  Client only
router.patch('/:id/toggle-active', verifyToken, isClient, toggleActive);

// @route   POST /api/marketing/generate-image
// @desc    Generate image for marketing item
// @access  Client only
router.post('/generate-image', verifyToken, isClient, generateImage);

module.exports = router;
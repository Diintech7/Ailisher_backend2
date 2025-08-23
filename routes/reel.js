// routes/reelRoutes.js
const express = require('express');
const router = express.Router();
const Reels = require('../models/Reels');
const { verifyToken, isClient } = require('../middleware/auth');
const { authenticateMobileUser, ensureUserBelongsToClient } = require('../middleware/mobileAuth');


// @route   POST /api/reels
// @desc    Add a new reel
// @access  Admin only
router.post('/', verifyToken, isClient, async (req, res) => {
  console.log("get");
  try {
    const { title, description, youtubeLink } = req.body;

    if (!title || !youtubeLink) {
      return res.status(400).json({ 
        success: false, 
        message: 'Title and YouTube link are required'
      });
    }
    console.log("get1");
    // Validate YouTube link
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\s]+)/;
    if (!youtubeRegex.test(youtubeLink)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid YouTube URL' 
      });
    }
    console.log("get2");
    const count = await Reels.countDocuments();

    const reel = new Reels({
      title,
      description,
      youtubeLink,
      createdBy: req.user.id,
      order: count + 1
    });
    console.log("get3");

    await reel.save();
    console.log("get4");
    
    res.status(201).json({
      success: true,
      data: reel
    });
    
  } catch (error) {
    console.error('Error adding reel:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   GET /api/reels
// @desc    Get all reels
// @access  Admin only
router.get('/', verifyToken, isClient, async (req, res) => {
  try {
    const reels = await Reels.find().sort({ order: 1 });
    
    res.json({
      success: true,
      count: reels.length,
      data: reels
    });
    
  } catch (error) {
    console.error('Error fetching reels:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

router.get('/user', authenticateMobileUser,ensureUserBelongsToClient, async (req, res) => {
  try {
    const reels = await Reels.find().sort({ order: 1 });
    
    res.json({
      success: true,
      count: reels.length,
      data: reels
    });
    
  } catch (error) {
    console.error('Error fetching reels:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

router.patch('/reorder', verifyToken, isClient, async (req, res) => {
  try {
    const { reels } = req.body;
    
    if (!reels || !Array.isArray(reels)) {
      return res.status(400).json({
        success: false,
        message: 'Reels array is required'
      });
    }

    // Update each reel with its new order
    const updatePromises = reels.map((reel, index) => {
      return Reels.findByIdAndUpdate(
        reel._id,
        { order: index + 1 },
        { new: true }
      );
    });

    await Promise.all(updatePromises);

    // Fetch updated reels in new order
    const updatedReels = await Reels.find().sort({ order: 1 });

    res.json({
      success: true,
      data: updatedReels
    });
  } catch (error) {
    console.error('Error reordering reels:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   GET /api/reels/:id
// @desc    Get reel by ID
// @access  Admin only
router.get('/:id', verifyToken, isClient, async (req, res) => {
  try {
    const reel = await Reels.findById(req.params.id);
    
    if (!reel) {
      return res.status(404).json({
        success: false,
        message: 'Reels not found'
      });
    }
    
    res.json({
      success: true,
      data: reel
    });
    
  } catch (error) {
    console.error('Error fetching reel:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   PUT /api/reels/:id
// @desc    Update reel
// @access  Admin only
router.put('/:id', verifyToken, isClient, async (req, res) => {
  try {
    const { title, description, youtubeLink, metrics } = req.body;
    
    const reelFields = {};
    if (title) reelFields.title = title;
    if (description !== undefined) reelFields.description = description;
    if (youtubeLink) {
      // Validate YouTube link
      const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\s]+)/;
      if (!youtubeRegex.test(youtubeLink)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid YouTube URL' 
        });
      }
      reelFields.youtubeLink = youtubeLink;
    }
    
    // Handle metrics update
    if (metrics) {
      reelFields.metrics = {};
      if (metrics.views !== undefined) reelFields.metrics.views = metrics.views;
      if (metrics.likes !== undefined) reelFields.metrics.likes = metrics.likes;
      if (metrics.comments !== undefined) reelFields.metrics.comments = metrics.comments;
      if (metrics.shares !== undefined) reelFields.metrics.shares = metrics.shares;
    }
    
    let reel = await Reels.findById(req.params.id);
    
    if (!reel) {
      return res.status(404).json({
        success: false,
        message: 'Reels not found'
      });
    }
    
    reel = await Reels.findByIdAndUpdate(
      req.params.id,
      { $set: reelFields },
      { new: true }
    );
    
    res.json({
      success: true,
      data: reel
    });
    
  } catch (error) {
    console.error('Error updating reel:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// @route   DELETE /api/reels/:id
// @desc    Delete reel
// @access  Admin only
router.delete('/:id', verifyToken, isClient, async (req, res) => {
  try {
    const reel = await Reels.findById(req.params.id);
    
    if (!reel) {
      return res.status(404).json({
        success: false,
        message: 'Reels not found'
      });
    }
    
    await Reels.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Reels removed'
    });
    
  } catch (error) {
    console.error('Error deleting reel:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});

// Toggle isEnabled flag for a test
router.patch('/:id', verifyToken, isClient, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(userId);
    const id = req.params.id;
    const { isEnabled } = req.body || {};

    if (!id) {
      return res.status(400).json({ success: false, message: 'Reel ID is required' });
    }

    const reel = await Reels.findById(id);
    if (!reel) {
        return res.status(404).json({ success: false, message: 'Reel not found' });
    }

    if (reel.createdBy.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    } 

    // If body provides isEnabled, use it; otherwise toggle
    const newValue = typeof isEnabled === 'boolean' ? isEnabled : !reel.isEnabled;
    reel.isEnabled = newValue;

    await reel.save();
    return res.status(200).json({ success: true, message: 'Reel isEnabled updated', reel });
  } catch (error) {
    console.error('Toggle isEnabled error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update isEnabled', error: error.message });
  }
});

// @route   PATCH /api/reels/:id/metrics
// @desc    Update reel metrics
// @access  Admin only
router.patch('/:id/metrics', verifyToken, isClient, async (req, res) => {
  try {
    const { views, likes, comments, shares } = req.body;
    
    const reel = await Reels.findById(req.params.id);
    
    if (!reel) {
      return res.status(404).json({
        success: false,
        message: 'Reels not found'
      });
    }
    
    const updateFields = {};
    
    if (views !== undefined) updateFields['metrics.views'] = views;
    if (likes !== undefined) updateFields['metrics.likes'] = likes;
    if (comments !== undefined) updateFields['metrics.comments'] = comments;
    if (shares !== undefined) updateFields['metrics.shares'] = shares;
    
    const updatedReels = await Reels.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );
    
    res.json({
      success: true,
      data: updatedReels
    });
    
  } catch (error) {
    console.error('Error updating reel metrics:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
});



module.exports = router;
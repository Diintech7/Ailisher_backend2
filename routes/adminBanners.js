const express = require('express');
const router = express.Router({ mergeParams: true });
const Banner = require('../models/Banner');
const { verifyToken } = require('../middleware/auth');
const { generateGetPresignedUrl } = require('../utils/r2');

// @route   GET /api/admin/banners
// @desc    Get all banners for the logged in client
// @access  Private
router.get('/', verifyToken, async (req, res) => {
  try {
    const banners = await Banner.find({ clientId: req.user.userId })
      .sort({ placement: 1, order: 1 });
    
    // Generate signed URLs for each banner
    const bannersWithUrls = await Promise.all(banners.map(async (banner) => {
      const bannerObj = banner.toObject();
      try {
        bannerObj.imageUrl = await generateGetPresignedUrl(banner.imageKey);
      } catch (err) {
        console.error(`Error generating URL for banner ${banner._id}:`, err);
        bannerObj.imageUrl = ''; // Fallback
      }
      return bannerObj;
    }));
    
    res.json({
      success: true,
      data: bannersWithUrls
    });
  } catch (err) {
    console.error('Error fetching banners:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   POST /api/admin/banners
// @desc    Add a new banner
// @access  Private
router.post('/', verifyToken, async (req, res) => {
  try {
    const { imageKey, placement, order, redirectUrl } = req.body;

    if (!imageKey || !placement) {
      return res.status(400).json({ success: false, message: 'Image key and placement are required' });
    }

    const newBanner = new Banner({
      clientId: req.user.userId,
      imageKey,
      placement,
      order: order || 0,
      redirectUrl,
      createdBy: req.user.id
    });

    await newBanner.save();

    res.status(201).json({
      success: true,
      message: 'Banner added successfully',
      data: newBanner
    });
  } catch (err) {
    console.error('Error adding banner:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   PUT /api/admin/banners/:id
// @desc    Update a banner
// @access  Private
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { imageKey, placement, order, redirectUrl, isActive } = req.body;
    
    let banner = await Banner.findById(req.params.id);

    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }

    // Check ownership
    if (banner.clientId !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const updateFields = {};
    if (imageKey) updateFields.imageKey = imageKey;
    if (placement) updateFields.placement = placement;
    if (order !== undefined) updateFields.order = order;
    if (redirectUrl !== undefined) updateFields.redirectUrl = redirectUrl;
    if (isActive !== undefined) updateFields.isActive = isActive;
    updateFields.updatedAt = Date.now();

    banner = await Banner.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Banner updated successfully',
      data: banner
    });
  } catch (err) {
    console.error('Error updating banner:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route   DELETE /api/admin/banners/:id
// @desc    Delete a banner
// @access  Private
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const banner = await Banner.findById(req.params.id);

    if (!banner) {
      return res.status(404).json({ success: false, message: 'Banner not found' });
    }

    // Check ownership
    if (banner.clientId !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await Banner.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Banner deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting banner:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

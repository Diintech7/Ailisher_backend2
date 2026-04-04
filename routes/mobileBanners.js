const express = require('express');
const router = express.Router({ mergeParams: true });
const Banner = require('../models/Banner');
const { authenticateMobileUser, checkClientAccess } = require('../middleware/mobileAuth');

// @route   GET /api/clients/:clientId/mobile/banners
// @desc    Get all active banners grouped by placement for a client
// @access  Public inside the app (Mobile Token Required)
router.get('/', checkClientAccess(), authenticateMobileUser, async (req, res) => {
  try {
    const clientId = req.params.clientId || req.clientId;
    const { generateGetPresignedUrl } = require('../utils/r2');

    if (!clientId) {
      return res.status(400).json({ success: false, message: 'Client ID is required' });
    }

    const banners = await Banner.find({
      clientId: clientId,
      isActive: true
    }).sort({ placement: 1, order: 1 });

    // Grouping banners by placement and generating signed URLs
    const groupedBanners = {
      top: [],
      medium: [],
      bottom: []
    };

    await Promise.all(banners.map(async (banner) => {
      if (groupedBanners[banner.placement]) {
        let imageUrl = '';
        try {
          imageUrl = await generateGetPresignedUrl(banner.imageKey);
        } catch (err) {
          console.error(`Error signing URL for mobile banner ${banner._id}:`, err);
        }

        groupedBanners[banner.placement].push({
          id: banner._id,
          imageUrl: imageUrl,
          order: banner.order,
          redirectUrl: banner.redirectUrl
        });
      }
    }));

    res.json({
      success: true,
      data: groupedBanners
    });
  } catch (err) {
    console.error('Error fetching mobile banners:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { generatePresignedUrl } = require('../utils/r2');

router.post('/presigned-upload', async (req, res) => {
  try {
    const { folder = 'uploads', filename, contentType = 'application/octet-stream' } = req.body;

    if (!filename) {
      return res.status(400).json({ success: false, message: 'Filename is required' });
    }

    const safeFilename = typeof filename === 'string' ? filename.replace(/[^a-zA-Z0-9.-]/g, '_') : 'file';
    const uniqueFilename = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${safeFilename}`;
    const key = `${folder}/${uniqueFilename}`;

    const uploadUrl = await generatePresignedUrl(key, contentType);

    res.json({
      success: true,
      data: {
        uploadUrl,
        key,
        publicUrl: `http://localhost:4000/api/r2/view?key=${encodeURIComponent(key)}`
      }
    });
  } catch (error) {
    console.error('Error generating presigned upload URL:', error);
    res.status(500).json({ success: false, message: 'Failed to generate upload URL' });
  }
});

// GET /view?key=...
// Provides an easy public URL pattern that redirects to the presigned R2 URL 
router.get('/view', async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).send('Key is required');

    // Generate a temporary auth'd URL to redirect to
    const { generateGetPresignedUrl } = require('../utils/r2');
    const url = await generateGetPresignedUrl(key, 3600); // 1 hour access
    res.redirect(url);
  } catch (err) {
    console.error('Error fetching presigned url for view:', err);
    res.status(404).send('Image not found');
  }
});

module.exports = router;

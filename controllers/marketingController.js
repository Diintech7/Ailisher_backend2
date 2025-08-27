const path = require('path');
const Marketing = require('../models/Marketing');
const { generateGetPresignedUrl, generatePresignedUrl, deleteObject } = require('../utils/r2');
const axios = require('axios');
const FormData = require('form-data');

exports.uploadImage = async (req,res) => {
    try {
        const user = req.user;
        console.log(user)
        console.log(user.businessName)
        const { fileName, contentType } = req.body;
        
        if (!fileName || !contentType) {
          return res.status(400).json({ 
            success: false, 
            message: 'File name and content type are required' 
          });
        }
    
        // Create unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(fileName);
        const key = `${user.businessName}/Marketing/image-${uniqueSuffix}${ext}`;
    
        // Generate presigned URL
        const uploadUrl = await generatePresignedUrl(key, contentType);
    
        return res.status(200).json({
          success: true,
          uploadUrl,
          key
        });
      } catch (error) {
        console.error('Get cover image upload URL error:', error);
        return res.status(500).json({ success: false, message: 'Server Error' });
      }
}
// @route   POST /api/marketing
// @desc    Create a new marketing item
// @access  Client only
exports.createMarketing = async (req, res) => {
  try {
    const {
      name,
      category,
      subcategory,
      imageKey,
      imageUrl: imageUrlFromClient,
      imageWidth,
      imageHeight,
      imageSize,
      location,
      route,
      isActive,
      metadata
    } = req.body;

    if (!name || !category || !imageKey || !imageWidth || !imageHeight) {
      return res.status(400).json({
        success: false,
        message: 'Name, category, imageKey, imageWidth, imageHeight are required'
      });
    }

    // Derive imageUrl if not supplied by client
    let imageUrl = imageUrlFromClient || '';
    if (!imageUrl && imageKey) {
      imageUrl = await generateGetPresignedUrl(imageKey);
    }

    // Basic route validation and normalization (model also validates)
    let normalizedRoute = route;
    if (!normalizedRoute || typeof normalizedRoute !== 'object') {
      return res.status(400).json({ success: false, message: 'Valid route object is required' });
    }
    if (!normalizedRoute.type || !['weblink','whatsapp','other'].includes(normalizedRoute.type)) {
      return res.status(400).json({ success: false, message: 'route.type must be one of weblink, whatsapp' });
    }
    if (normalizedRoute.type === 'weblink' || normalizedRoute.type === 'other') {
      const url = normalizedRoute.config && normalizedRoute.config.url;
      if (!url || !/^https?:\/\//i.test(url)) {
        return res.status(400).json({ success: false, message: 'For weblink, route.config.url must be a valid http/https URL' });
      }
    } else if (normalizedRoute.type === 'whatsapp') {
      const phone = normalizedRoute.config && normalizedRoute.config.phone;
      const message = normalizedRoute.config && normalizedRoute.config.message;
      
      if (!phone || !/[0-9]{6,}/.test(String(phone))) {
        return res.status(400).json({ success: false, message: 'For whatsapp, route.config.phone must be a valid phone number' });
      }
      
      // Generate WhatsApp URL
      const encodedMessage = message ? encodeURIComponent(message) : '';
      const whatsappUrl = `https://wa.me/${phone.replace(/\D/g, '')}${encodedMessage ? `?text=${encodedMessage}` : ''}`;
      
      // Update the route config with the generated URL
      normalizedRoute.config.url = whatsappUrl;
    }

    const marketing = new Marketing({
      name,
      category,
      subcategory: subcategory || '',
      imageKey,
      imageUrl: imageUrl,
      imageWidth: Number(imageWidth),
      imageHeight: Number(imageHeight),
      imageSize: imageSize,
      location: location || '',
      route: normalizedRoute,
      isActive: isActive !== undefined ? isActive : true,
      metadata: metadata || {},
      createdBy: req.user.id,
      clientId: req.user.userId
    });

    await marketing.save();

    res.status(201).json({
      success: true,
      data: marketing
    });

  } catch (error) {
    console.error('Error creating marketing item:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @route   GET /api/marketing
// @desc    Get all marketing items with filters and pagination
// @access  Client only
exports.getMarketing = async (req, res) => {
  try {
    const {
      category,
      isActive,
      page = 1,
      limit = 20,
      search,
      sortBy = 'position',
      sortOrder = 'asc'
    } = req.query;

    const filter = { clientId: req.user.userId };
    
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { subcategory: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [marketing, total] = await Promise.all([
      Marketing.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Marketing.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: marketing,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching marketing items:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

exports.getMarketingForMobile = async (req, res) => {
  try {
    const {
      category,
      isActive,
      page = 1,
      limit = 20,
      search,
      sortBy = 'position',
      sortOrder = 'asc'
    } = req.query;

    const filter = { clientId: req.clientId };
    
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { subcategory: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [marketing, total] = await Promise.all([
      Marketing.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Marketing.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: marketing,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching marketing items:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @route   GET /api/marketing/:id
// @desc    Get marketing item by ID
// @access  Client only
exports.getMarketingById = async (req, res) => {
  try {
    const marketing = await Marketing.findOne({
      _id: req.params.id,
      clientId: req.clientId
    });

    if (!marketing) {
      return res.status(404).json({
        success: false,
        message: 'Marketing item not found'
      });
    }

    res.json({
      success: true,
      data: marketing
    });

  } catch (error) {
    console.error('Error fetching marketing item:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @route   PUT /api/marketing/:id
// @desc    Update marketing item
// @access  Client only
exports.updateMarketing = async (req, res) => {
  try {
    const {
      name,
      category,
      subcategory,
      imageKey,
      imageWidth,
      imageHeight,
      location,
      route,
      isActive,
      metadata
    } = req.body;

    const marketing = await Marketing.findOne({
      _id: req.params.id,
      clientId: req.user.userId
    });

    if (!marketing) {
      return res.status(404).json({
        success: false,
        message: 'Marketing item not found'
      });
    }

    // Handle image update
    let imageUrl ='';
    if (imageKey && imageKey !== marketing.imageKey) {
      // Delete old image if it exists and is different
      if (marketing.imageKey) {
        try {
          await deleteObject(marketing.imageKey);
          console.log("Successfully deleted old image from S3:", marketing.imageKey);
        } catch (error) {
          console.error("Error deleting old image from S3:", error);
        }
      }

      // Generate new presigned URL
      try {
        imageUrl = await generateGetPresignedUrl(imageKey, 604800);
      } catch (error) {
        console.error("Error generating presigned URL for new image:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to generate image URL",
        });
      }
    }

    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (category !== undefined) updateFields.category = category;
    if (subcategory !== undefined) updateFields.subcategory = subcategory;
    if (imageUrl !== undefined) updateFields.imageUrl = imageUrl;
    if (imageKey !== undefined) updateFields.imageKey = imageKey;
    if (imageWidth !== undefined) updateFields.imageWidth = Number(imageWidth);
    if (imageHeight !== undefined) updateFields.imageHeight = Number(imageHeight);
    if (location !== undefined) updateFields.location = location;
    if (route !== undefined) updateFields.route = route;
    if (isActive !== undefined) updateFields.isActive = isActive;
    if (metadata !== undefined) updateFields.metadata = metadata;

    const updatedMarketing = await Marketing.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      data: updatedMarketing
    });

  } catch (error) {
    console.error('Error updating marketing item:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @route   DELETE /api/marketing/:id
// @desc    Delete marketing item
// @access  Client only
exports.deleteMarketing = async (req, res) => {
  try {
    const marketing = await Marketing.findOne({
      _id: req.params.id,
      clientId: req.user.userId
    });

    if (!marketing) {
      return res.status(404).json({
        success: false,
        message: 'Marketing item not found'
      });
    }

    // Delete image from R2 if exists
    if (marketing.imageKey) {
      try {
        await deleteObject(marketing.imageKey);
      } catch (e) {
        console.error('Failed to delete R2 object for marketing:', marketing.imageKey, e);
        // continue even if delete fails
      }
    }

    await Marketing.findByIdAndDelete(req.params.id);

    await deleteObject(marketing.imageKey);

    res.json({
      success: true,
      message: 'Marketing item deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting marketing item:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @route   PATCH /api/marketing/:id/position
// @desc    Update marketing item position
// @access  Client only
exports.updatePosition = async (req, res) => {
  try {
    const { position } = req.body;

    if (position === undefined || !Number.isFinite(Number(position))) {
      return res.status(400).json({
        success: false,
        message: 'Valid position is required'
      });
    }

    const marketing = await Marketing.findOne({
      _id: req.params.id,
      clientId: req.user.userId
    });

    if (!marketing) {
      return res.status(404).json({
        success: false,
        message: 'Marketing item not found'
      });
    }

    marketing.position = Number(position);
    await marketing.save();

    res.json({
      success: true,
      data: marketing
    });

  } catch (error) {
    console.error('Error updating marketing position:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// @route   PATCH /api/marketing/:id/toggle-active
// @desc    Toggle marketing item active status
// @access  Client only
exports.toggleActive = async (req, res) => {
  try {
    const marketing = await Marketing.findOne({
      _id: req.params.id,
      clientId: req.user.userId
    });

    if (!marketing) {
      return res.status(404).json({
        success: false,
        message: 'Marketing item not found'
      });
    }

    marketing.isActive = !marketing.isActive;
    await marketing.save();

    res.json({
      success: true,
      data: marketing
    });

  } catch (error) {
    console.error('Error toggling marketing active status:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
}

exports.generateImage = async (req, res) => {
    const { prompt, style = 'realistic', aspect_ratio = '9:16', seed = '5' } = req.body;
    
    if (!prompt) {
        return res.status(400).json({ 
            error: 'prompt is required.' 
        });
    }

    try {
        // Create form data for the API request
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('style', style);
        formData.append('aspect_ratio', aspect_ratio);
        formData.append('seed', seed);

        const response = await axios.post('https://api.vyro.ai/v2/image/generations', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.IMAGINEART_API_KEY}`,
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: 900000 // 15 minutes timeout
        });

        // Convert the image buffer to base64
        const base64Image = Buffer.from(response.data).toString('base64');

        res.json({
            success: true,
            image: base64Image,
            prompt: prompt,
            style: style,
            aspect_ratio: aspect_ratio,
            seed: seed
        });

    } catch (error) {
        console.error('Generate image error:', error);
        
        if (error.response) {
            console.error('ImagineArt API Error:', error.response.data);
            return res.status(error.response.status).json({ 
                error: `Failed to generate image: ${error.response.status} ${error.response.statusText}`
            });
        }
        
        res.status(500).json({ 
            error: error.message || 'Failed to generate image' 
        });
    }
  }

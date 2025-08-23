const { generatePresignedUrl } = require("../utils/s3");

exports.uploadImage = async (req,res) => {
    try {
        const user = req.user;
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

exports.createMarketing = async (req, res) => {
    const { name, category, subcategory, imageKey, imageWidth, imageHeight, position, route, isActive, metadata } = req.body;
    const item = await Marketing.create({ name, category, subcategory, imageKey, imageWidth, imageHeight, position, route, isActive, metadata });
    res.status(201).json({ success: true, data: item });
  };

exports.listMarketing = async (req, res) => {
    const { category, isActive, page=1, limit=20, search } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) filter.name = { $regex: search, $options: 'i' };
  
    const skip = (Number(page)-1) * Number(limit);
    const [items, count] = await Promise.all([
      Marketing.find(filter).sort({ category: 1, position: 1, createdAt: -1 }).skip(skip).limit(Number(limit)),
      Marketing.countDocuments(filter)
    ]);
    res.json({ success: true, data: items, count, page: Number(page), limit: Number(limit) });
  };
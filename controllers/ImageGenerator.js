const axios = require('axios');
const FormData = require('form-data');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, generateGetPresignedUrl } = require('../utils/r2');
const ImageGenerated = require('../models/ImageGenerated');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');

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

exports.saveGeneratedImage = async (req, res) => {
    try {
        const { 
            dataUrl, 
            imageBase64, 
            prompt, 
            style = 'realistic', 
            aspectRatio = '9:16', 
            seed = '5',
            tags = [],
            isPublic = false,
            contentType = 'image/png' 
        } = req.body;

        // Validate required fields
        if (!prompt) {
            return res.status(400).json({ error: 'prompt is required' });
        }

        let base64String = imageBase64;
        if (!base64String && dataUrl) {
            const commaIndex = dataUrl.indexOf(',');
            base64String = commaIndex !== -1 ? dataUrl.slice(commaIndex + 1) : dataUrl;
        }

        if (!base64String) {
            return res.status(400).json({ error: 'imageBase64 or dataUrl is required' });
        }

        // Step 1: Upload to R2
        const prefix = `${req.user.businessName}/AI-generated/images`;
        const imageBuffer = Buffer.from(base64String, 'base64');
        const safePrefix = prefix.replace(/^\/+|\/+$/g, '');
        const fileName = `ai-${Date.now()}-${seed}.png`;
        const key = `${safePrefix}/${fileName}`;

        await s3Client.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: key,
            Body: imageBuffer,
            ContentType: contentType,
        }));

        const url = await generateGetPresignedUrl(key, 7 * 24 * 60 * 60);

        // Step 2: Save to Database
        const imageRecord = new ImageGenerated({
            userId: req.user._id,
            clientId: req.user.userId,
            prompt: prompt,
            style: style,
            aspectRatio: aspectRatio,
            seed: seed,
            generatedImageUrl: url,
            generatedImageKey: key,
            status: 'completed',
            metadata: {
                model: 'vyro-ai',
                apiProvider: 'vyro.ai',
                generationTime: Date.now(),
                imageSize: `${aspectRatio}`,
                quality: 'standard'
            },
            tags: tags,
            isPublic: isPublic
        });

        await imageRecord.save();

        res.json({
            success: true,
            message: 'Image saved successfully',
            data: {
                id: imageRecord._id,
                key: key,
                url: url,
                prompt: prompt,
                style: style,
                aspectRatio: aspectRatio,
                seed: seed,
                createdAt: imageRecord.createdAt
            }
        });

    } catch (error) {
        console.error('Save generated image error:', error);
        return res.status(500).json({ 
            error: error.message || 'Failed to save generated image' 
        });
    }
};

exports.getUserImages = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search } = req.query;
        const skip = (page - 1) * limit;

        let query = { userId: req.user._id };
        
        if (status) {
            query.status = status;
        }

        if (search) {
            query.$text = { $search: search };
        }

        const images = await ImageGenerated.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .select('-__v');

        for(const image of images)
        {
            if(image.generatedImageKey)
            {
            console.log(image.generatedImageKey)
            image.generatedImageUrl = await generateGetPresignedUrl(image.generatedImageKey)
            }
        }
        const total = await ImageGenerated.countDocuments(query);

        res.json({
            success: true,
            data: {
                images: images,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    itemsPerPage: parseInt(limit)
                }
            }
        });

    } catch (error) {
        console.error('Get user images error:', error);
        return res.status(500).json({ 
            error: error.message || 'Failed to fetch user images' 
        });
    }
};

exports.deleteImage = async (req, res) => {
    try {
        const { id } = req.params;
        
        const image = await ImageGenerated.findOne({ 
            _id: id, 
            userId: req.user._id 
        });

        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }

        // Delete from R2 if key exists
        if (image.generatedImageKey) {
            try {
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: image.generatedImageKey
                }));
            } catch (r2Error) {
                console.error('R2 delete error:', r2Error);
                // Continue with database deletion even if R2 deletion fails
            }
        }

        // Delete from database
        await ImageGenerated.findByIdAndDelete(id);

        res.json({
            success: true,
            message: 'Image deleted successfully'
        });

    } catch (error) {
        console.error('Delete image error:', error);
        return res.status(500).json({ 
            error: error.message || 'Failed to delete image' 
        });
    }
};


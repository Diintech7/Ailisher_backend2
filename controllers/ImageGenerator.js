const axios = require('axios');
const FormData = require('form-data');

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
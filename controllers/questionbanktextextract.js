const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

// Utility to derive safe filename and extension from mimetype
function deriveSafeFilename(originalName, mimetype) {
    const mimeToExt = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/bmp': 'bmp',
        'application/pdf': 'pdf'
    };
    const ext = mimeToExt[mimetype] || 'bin';
    const base = path.basename(originalName || `document.${ext}`)
        .replace(/\s+/g, ' ')
        .replace(/[^\w\-\s.]/g, '')
        .trim() || 'document';
    const withoutExt = base.replace(/\.[^.]+$/, '');
    return `${withoutExt}.${ext}`;
}

function buildFormData({ buffer, filename, contentType, includeMarginalia, includeMetadata, fieldName }) {
    const fd = new FormData();
    fd.append('include_marginalia', includeMarginalia);
    fd.append('include_metadata_in_markdown', includeMetadata);
    fd.append(fieldName, buffer, {
        filename,
        contentType,
        knownLength: buffer.length
    });
    return fd;
}

async function postToLandingAI({ formData, apiUrl, apiKey }) {
    return axios.post(apiUrl, formData, {
        headers: {
            ...formData.getHeaders(),
            'Authorization': `Basic ${apiKey}`,
            'User-Agent': 'TextExtractionApp/1.0'
        },
        timeout: 480000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });
}

// Text extraction controller (supports both images and PDFs)
const extractTextFromFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file provided' });
        }

        const allowedTypes = ['image/jpeg','image/jpg','image/png','image/gif','image/bmp','application/pdf'];
        if (!allowedTypes.includes(req.file.mimetype)) {
            return res.status(400).json({ success: false, message: 'Invalid file type. Please upload an image file (JPEG, PNG, GIF, BMP) or PDF file' });
        }

        const maxSize = 10 * 1024 * 1024;
        if (req.file.size > maxSize) {
            return res.status(400).json({ success: false, message: 'File size too large. Maximum size is 10MB' });
        }

        if (!req.file.buffer || !Buffer.isBuffer(req.file.buffer) || req.file.buffer.length === 0) {
            return res.status(422).json({ success: false, message: 'Invalid file buffer provided. Please try re-uploading the file.' });
        }

        if (!process.env.LANDING_AI_API_KEY) {
            console.log('Landing AI API key not configured',process.env.LANDING_AI_API_KEY);
            return res.status(500).json({ success: false, message: 'Landing AI API key not configured' });
        }

        const safeFilename = deriveSafeFilename(req.file.originalname, req.file.mimetype);
        const contentType = req.file.mimetype;
        const apiUrl = 'https://api.va.landing.ai/v1/tools/agentic-document-analysis';

        const includeMarginalia = (req.body.include_marginalia ?? 'true').toString();
        const includeMetadata = (req.body.include_metadata_in_markdown ?? 'true').toString();

        console.log('Making request to Landing AI:', apiUrl);
        console.log('File type:', contentType);
        console.log('File name:', safeFilename);
        console.log('File size:', req.file.size);
        console.log('Using API key:', process.env.LANDING_AI_API_KEY.substring(0, 10) + '...');

        // Determine the correct field name based on file type
        const fieldName = contentType === 'application/pdf' ? 'pdf' : 'image';
        
        console.log(`Using field name: ${fieldName} for content type: ${contentType}`);

        const formData = buildFormData({
            buffer: req.file.buffer,
            filename: safeFilename,
            contentType,
            includeMarginalia,
            includeMetadata,
            fieldName
        });

        const landingAIResponse = await postToLandingAI({ 
            formData, 
            apiUrl, 
            apiKey: process.env.LANDING_AI_API_KEY 
        });

        console.log('Landing AI Response Status:', landingAIResponse.status);
        console.log('Landing AI Response Data:', JSON.stringify(landingAIResponse.data, null, 2));

        let extractedText = '';
        let confidence = null;
        let metadata = {};

        if (landingAIResponse.status === 200 && landingAIResponse.data && landingAIResponse.data.data) {
            const apiData = landingAIResponse.data.data;
            if (apiData.markdown && apiData.markdown.trim()) {
                extractedText = apiData.markdown.trim();
            } else if (apiData.chunks && Array.isArray(apiData.chunks)) {
                const chunkTexts = apiData.chunks
                    .filter((chunk) => chunk.text && chunk.text.trim())
                    .map((chunk) => chunk.text.trim());
                if (chunkTexts.length > 0) {
                    extractedText = chunkTexts.join('\n\n');
                }
            }
            if (apiData.metadata) {
                metadata = apiData.metadata;
            }
            if (landingAIResponse.data.errors && landingAIResponse.data.errors.length > 0) {
                console.warn('Landing AI API warnings:', landingAIResponse.data.errors);
            }
            if (landingAIResponse.data.extraction_error) {
                console.warn('Landing AI API extraction error:', landingAIResponse.data.extraction_error);
            }
        }

        if (!extractedText || extractedText.length === 0) {
            extractedText = 'No readable text found in the file';
        }

        res.status(200).json({
            success: true,
            message: 'Text extracted successfully',
            data: {
                originalFileName: safeFilename,
                fileSize: req.file.size,
                fileType: contentType,
                extractedText,
                confidence,
                metadata,
                warnings: landingAIResponse.data.errors || [],
                extractionError: landingAIResponse.data.extraction_error || null,
                rawResponse: process.env.NODE_ENV === 'development' ? landingAIResponse.data : undefined
            }
        });

    } catch (error) {
        console.error('Error in text extraction:', error);
        console.error('Error response data:', error.response?.data);
        console.error('Error response status:', error.response?.status);

        if (error.response) {
            const statusCode = error.response.status;
            const errorData = error.response.data;

            if (statusCode === 401) {
                return res.status(401).json({ success: false, message: 'Authentication failed - check your Landing AI API key', details: errorData?.message || 'Authentication error' });
            } else if (statusCode === 422) {
                return res.status(422).json({ success: false, message: 'Invalid file format or corrupted file. Please try with a different file.', details: errorData?.message || 'Invalid file provided', suggestion: 'Ensure the filename includes a correct extension (jpg/png/gif/bmp/pdf) and the file is valid.' });
            } else if (statusCode === 429) {
                return res.status(429).json({ success: false, message: 'Rate limit exceeded. Please try again later' });
            } else if (statusCode === 400) {
                return res.status(400).json({ success: false, message: 'Invalid request - check document format', details: errorData?.message || 'Bad request' });
            } else if (statusCode >= 500) {
                return res.status(503).json({ success: false, message: 'Landing AI service is temporarily unavailable. Please try again later' });
            } else {
                return res.status(statusCode).json({ success: false, message: errorData?.message || 'API request failed', details: errorData });
            }
        }

        if (error.code === 'ECONNABORTED') {
            return res.status(408).json({ success: false, message: 'Request timeout - document may be too complex' });
        }
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            return res.status(503).json({ success: false, message: 'Unable to connect to Landing AI service. Please check your internet connection.' });
        }

        res.status(500).json({ success: false, message: 'Internal server error. Please try again later', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};


module.exports = { extractTextFromFile};
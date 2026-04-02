// services/imageTextExtraction.js
const axios = require('axios');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Extract text from images using OpenAI Vision API
 * @param {string[]} imageUrls - Array of image URLs
 * @returns {Promise<string[]>} Array of extracted texts
 */
const extractTextFromImages = async (imageUrls) => {
  const extractedTexts = [];
  
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API key is not configured');
  }

  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    try {
      if (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
        const { generateGetPresignedUrl } = require('../utils/r2');
        imageUrl = await generateGetPresignedUrl(imageUrl);
      }
      let processedImageUrl = imageUrl;
      
      // If not a Cloudinary or R2 URL, convert to base64
      if (!imageUrl.includes('cloudinary.com') && !imageUrl.includes('r2.cloudflarestorage.com') && !imageUrl.includes('r2.dev')) {        
        const imageResponse = await axios.get(imageUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; TextExtractor/1.0)'
          }
        });

        if (imageResponse.status !== 200) {
          throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
        }

        const contentType = imageResponse.headers['content-type'];
        if (!contentType || !contentType.startsWith('image/')) {
          throw new Error(`Invalid content type: ${contentType}`);
        }

        const imageBuffer = Buffer.from(imageResponse.data);
        if (imageBuffer.length === 0) {
          throw new Error('Empty image buffer received');
        }

        const base64Image = imageBuffer.toString('base64');
        let imageFormat = 'jpeg';
        if (contentType.includes('png')) imageFormat = 'png';
        else if (contentType.includes('webp')) imageFormat = 'webp';
        else if (contentType.includes('gif')) imageFormat = 'gif';

        processedImageUrl = `data:image/${imageFormat};base64,${base64Image}`;
      }

      const visionResponse = await axios.post(
        OPENAI_API_URL,
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `You are a precise OCR (Optical Character Recognition) system. Your task is to extract ALL text content from this image.

Instructions:
1. Extract ALL visible text exactly as it appears
2. Maintain the original formatting, line breaks, and spacing
3. Include mathematical equations, formulas, and symbols
4. Include any handwritten text if clearly readable
5. Do not add explanations, interpretations, or additional commentary
6. If the text is in multiple languages, extract all of it
7. If there are tables, preserve the table structure
8. If no readable text is found, respond with exactly: "No readable text found"

Return only the extracted text content:`
                },
                {
                  type: "image_url",
                  image_url: {
                    url: processedImageUrl,
                    detail: "high"
                  }
                }
              ]
            }
          ],
          max_tokens: 2000,
          temperature: 0.1
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          timeout: 45000
        }
      );

      if (!visionResponse.data || !visionResponse.data.choices || visionResponse.data.choices.length === 0) {
        throw new Error('Invalid response structure from OpenAI Vision API');
      }

      const choice = visionResponse.data.choices[0];
      if (!choice.message || !choice.message.content) {
        throw new Error('No content in OpenAI Vision API response');
      }

      const extractedText = choice.message.content.trim();
      if (extractedText === "No readable text found" || extractedText.length === 0) {
        console.log(`No text found in image ${i + 1}`);
        extractedTexts.push("No readable text found");
      } else {
        console.log(`Successfully extracted ${extractedText.length} characters from image ${i + 1}`);
        extractedTexts.push(extractedText);
      }

    } catch (error) {
      let errorMessage = "Failed to extract text";
      if (error.message.includes('timeout')) {
        errorMessage = "Text extraction timed out - image may be too large";
      } else if (error.message.includes('API key')) {
        errorMessage = "API authentication failed";
      } else if (error.message.includes('rate limit')) {
        errorMessage = "Rate limit exceeded - please try again later";
      } else if (error.message.includes('content type')) {
        errorMessage = "Invalid image format";
      }
      extractedTexts.push(`${errorMessage}: ${error.message}`);
    }
  }

  return extractedTexts;
};

/**
 * Extract text from images using Gemini API
 * @param {string[]} imageUrls - Array of image URLs
 * @returns {Promise<string[]>} Array of extracted texts
 */
const extractTextFromImagesGemini = async (imageUrls) => {
  if (!GEMINI_API_KEY) {
    throw new Error('Gemini API key is not configured');
  }

  const extractedTexts = [];

  for (const imageUrl of imageUrls) {
    try {
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const imageBuffer = Buffer.from(imageResponse.data);
      const base64Image = imageBuffer.toString('base64');
      const contentType = imageResponse.headers['content-type'] || 'image/jpeg';

      const response = await axios.post(
        `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
        {
          contents: [{
            parts: [
              {
                text: "Extract all text content from this image. Return only the text as it appears, maintaining original formatting. If no text is found, respond with 'No readable text found'."
              },
              {
                inline_data: {
                  mime_type: contentType,
                  data: base64Image
                }
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
          }
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      const extractedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No readable text found';
      extractedTexts.push(extractedText.trim());

    } catch (error) {
      console.error('Gemini extraction error:', error.message);
      extractedTexts.push(`Failed to extract text: ${error.message}`);
    }
  }

  return extractedTexts;
};

/**
 * Extract text from images with fallback between OpenAI and Gemini
 * @param {string[]} imageUrls - Array of image URLs
 * @returns {Promise<string[]>} Array of extracted texts
 */
const extractTextFromImagesWithFallback = async (imageUrls) => {
  if (!imageUrls || imageUrls.length === 0) {
    return [];
  }

  try {
    // Try OpenAI first
    const results = await extractTextFromImages(imageUrls);
    
    // Check for failed extractions
    const failedIndices = [];
    results.forEach((result, index) => {
      if (result.startsWith('Failed to extract text') || result.includes('Error')) {
        failedIndices.push(index);
      }
    });

    // Retry failed ones with Gemini if available
    if (failedIndices.length > 0 && GEMINI_API_KEY) {
      try {
        const failedUrls = failedIndices.map(i => imageUrls[i]);
        const geminiResults = await extractTextFromImagesGemini(failedUrls);
        
        failedIndices.forEach((originalIndex, geminiIndex) => {
          if (geminiResults[geminiIndex] && !geminiResults[geminiIndex].startsWith('Failed')) {
            results[originalIndex] = geminiResults[geminiIndex];
            console.log(`Successfully recovered text for image ${originalIndex + 1} using Gemini`);
          }
        });
      } catch (geminiError) {
        console.error('Gemini fallback also failed:', geminiError.message);
      }
    }

    return results;
    
  } catch (openaiError) {
    // If OpenAI completely fails, try Gemini for all images
    if (GEMINI_API_KEY) {
      console.log('Falling back to Gemini for all images');
      try {
        return await extractTextFromImagesGemini(imageUrls);
      } catch (geminiError) {
        console.error('Both OpenAI and Gemini failed:', geminiError.message);
      }
    }

    // Return error messages for all images
    return imageUrls.map((_, index) => 
      `Text extraction failed for image ${index + 1}. Please ensure the image is clear and contains readable text.`
    );
  }
};

module.exports = {
  extractTextFromImages,
  extractTextFromImagesGemini,
  extractTextFromImagesWithFallback
};
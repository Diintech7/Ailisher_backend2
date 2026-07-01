const express = require('express');
const router = express.Router();
const axios = require('axios');
const { verifyToken } = require('../middleware/auth');

router.post('/generate', verifyToken, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, message: 'Prompt is required' });
    }

    const apiKey = process.env.OPENROUTER_API_KEY ? process.env.OPENROUTER_API_KEY.trim() : '';
    if (!apiKey) {
      return res.status(500).json({ success: false, message: 'OpenRouter API Key is not configured on the server' });
    }

    // Call OpenRouter with max_tokens: 2048 to respect the user's credits limit
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'mAIns Publisher'
        }
      }
    );

    if (response.data && response.data.choices && response.data.choices[0]) {
      const generatedText = response.data.choices[0].message.content;
      res.json({
        success: true,
        text: generatedText
      });
    } else {
      throw new Error('Invalid response structure from OpenRouter');
    }
  } catch (error) {
    console.error('Error generating AI answer:', error.response ? error.response.data : error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to generate response on the server',
      error: error.response ? JSON.stringify(error.response.data) : error.message
    });
  }
});

module.exports = router;

const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testVyroJson() {
    const prompt = "A professional book cover for ENGLISH - NCERT BOOK";
    const apiKey = process.env.IMAGINEART_API_KEY;
    
    console.log('Testing Vyro API V2 with JSON payload...');
    
    try {
        const response = await axios.post('https://api.vyro.ai/v2/image/generations', {
            prompt: prompt,
            model_id: 1,
            style: 'realistic',
            aspect_ratio: '9:16',
            seed: 5,
            variation: 1
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer'
        });

        console.log('SUCCESS JSON! Status:', response.status);
    } catch (error) {
        console.error('Error Status:', error.response?.status);
        if (error.response?.data) {
            try {
                const errorData = JSON.parse(Buffer.from(error.response.data).toString());
                console.error('Error Details:', JSON.stringify(errorData, null, 2));
            } catch (e) {
                console.error('Error Data (Raw):', Buffer.from(error.response.data).toString());
            }
        } else {
            console.error('Error Message:', error.message);
        }
    }
}

testVyroJson();

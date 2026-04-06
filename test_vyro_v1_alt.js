const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testVyroV1Alt() {
    const prompt = "A professional book cover for ENGLISH - NCERT BOOK";
    const apiKey = process.env.IMAGINEART_API_KEY;
    
    console.log('Testing Vyro API V1 Alternative Endpoint...');
    
    try {
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('model_id', '1');
        formData.append('style_id', '1');

        const response = await axios.post('https://api.vyro.ai/imagine/api/v1/generate', formData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer'
        });

        console.log('SUCCESS V1 ALT! Status:', response.status);
    } catch (error) {
        console.error('Error Status:', error.response?.status);
        if (error.response?.data) {
            try {
                const errorData = JSON.parse(Buffer.from(error.response.data).toString());
                console.error('Error Details:', JSON.stringify(errorData, null, 2));
            } catch (e) {
                console.error('Error Data (Raw):', Buffer.from(error.response.data).toString());
            }
        }
    }
}

testVyroV1Alt();

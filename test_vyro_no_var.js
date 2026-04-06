const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function testVyroNoVar() {
    const prompt = "A professional book cover for ENGLISH - NCERT BOOK";
    const apiKey = process.env.IMAGINEART_API_KEY;
    
    console.log('Testing Vyro API V2 Without Variation...');
    
    try {
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('model_id', '1');
        formData.append('style', 'realistic');
        formData.append('aspect_ratio', '9:16');

        const response = await axios.post('https://api.vyro.ai/v2/image/generations', formData, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer'
        });

        console.log('SUCCESS NO VAR! Status:', response.status);
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

testVyroNoVar();

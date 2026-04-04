const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

async function testVyro() {
    const prompt = "A professional book cover for ENGLISH - NCERT BOOK";
    const style = 'realistic';
    const aspect_ratio = '9:16';
    const seed = '5';
    
    console.log('Testing Vyro API with:');
    console.log({ prompt, style, aspect_ratio, seed });
    console.log('API Key:', process.env.IMAGINEART_API_KEY ? 'Found' : 'NOT FOUND');

    try {
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('model_id', '29');
        formData.append('style_id', '29');
        formData.append('aspect_ratio', '9:16');
        formData.append('cfg', '7');
        formData.append('seed', '1');

        const response = await axios.post('https://api.vyro.ai/v2/image/generations', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.IMAGINEART_API_KEY}`,
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        console.log('Success! Response status:', response.status);
    } catch (error) {
        console.error('Error Status:', error.response ? error.response.status : 'No response');
        if (error.response && error.response.data) {
            try {
                const errorData = JSON.parse(Buffer.from(error.response.data).toString());
                console.error('Error Data:', errorData);
            } catch (e) {
                console.error('Error Data (Raw):', Buffer.from(error.response.data).toString());
            }
        }
    }
}

testVyro();

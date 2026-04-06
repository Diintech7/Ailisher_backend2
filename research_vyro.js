const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MODELS = ['1', '21', '27', '29', '30', '33', '35'];
const STYLES = ['realistic', 'Realistic', 'anime', 'Anime', 'fantasy', 'None', '1', '21', '29', '30', '35'];

async function bruteForceVyro() {
    const apiKey = process.env.IMAGINEART_API_KEY;
    console.log('Starting Brute Force Research for Vyro API...');

    for (const model of MODELS) {
        for (const style of STYLES) {
            console.log(`Trying Model: ${model}, Style: ${style}...`);
            const formData = new FormData();
            formData.append('prompt', "A simple red apple");
            formData.append('model_id', model);
            formData.append('style', style);
            formData.append('aspect_ratio', '1:1');
            formData.append('variation', '1');

            try {
                const response = await axios.post('https://api.vyro.ai/v2/image/generations', formData, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        ...formData.getHeaders()
                    },
                    timeout: 20000
                });

                if (response.status === 200) {
                    console.log(`\n!!! SUCCESS !!! Model: ${model}, Style: ${style}`);
                    process.exit(0);
                }
            } catch (error) {
                const status = error.response?.status || 'No Status';
                const msg = error.response?.data?.message || error.message;
                console.log(`Failed (${status}): ${msg}`);
            }
        }
    }
}

bruteForceVyro();

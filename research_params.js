const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const VARIANT_PARAMS = [
    { model_id: '1', style: 'realistic', variation: '1' },
    { model_id: 1, style: 'realistic', variation: 1 },
    { modelId: '1', styleId: 'realistic', variation: '1' },
    { model: '1', style: 'realistic', variation: '1' }
];

async function researchParams() {
    const apiKey = process.env.IMAGINEART_API_KEY;
    console.log('Researching Parameter Names for Vyro API...');

    for (const params of VARIANT_PARAMS) {
        console.log(`Trying Params: ${JSON.stringify(params)}...`);
        const formData = new FormData();
        Object.entries(params).forEach(([k, v]) => formData.append(k, v));
        formData.append('prompt', "a cat");
        formData.append('aspect_ratio', '1:1');

        try {
            const response = await axios.post('https://api.vyro.ai/v2/image/generations', formData, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    ...formData.getHeaders()
                },
                timeout: 10000
            });

            if (response.status === 200) {
                console.log(`\n!!! SUCCESS !!! Params: ${JSON.stringify(params)}`);
                process.exit(0);
            }
        } catch (error) {
            const msg = error.response?.data?.message || error.message;
            console.log(`Failed: ${msg}`);
        }
    }
}

researchParams();

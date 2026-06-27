require('dotenv').config();
const axios = require('axios');

async function test() {
  try {
    const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
    const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

    const url = `${apiURL}/api/classroom/exams`;
    console.log(`Querying external API: ${url}...`);
    
    const res = await axios.get(url, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      }
    });

    console.log('Response status:', res.status);
    if (res.data && res.data.success) {
      console.log('Total exams returned by external API:', res.data.exams?.length);
      if (res.data.exams && res.data.exams.length > 0) {
        console.log('First exam raw data:', JSON.stringify(res.data.exams[0], null, 2));
      }
    } else {
      console.log('Response data:', res.data);
    }
  } catch (err) {
    if (err.response) {
      console.error('Error status:', err.response.status);
      console.error('Error data:', err.response.data);
    } else {
      console.error('Error message:', err.message);
    }
  }
}

test();

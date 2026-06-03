const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const axios = require('axios');
const ClassroomExam = require('../models/ClassroomExam');
const User = require('../models/User');

const apiURL = process.env.VECTORIZE_API_URL || 'https://test.3rdai.co';
const appToken = process.env.VECTORIZE_APP_TOKEN || 'clt-2db63e7fbb785339128218bac891c01c35f09e23d28a018e';

const run = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not set in .env');
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB successfully.');

    // Get client IDs. Find all client users in the system.
    // Also, use 'CLI2356362RBP' as a default if none are found.
    const clientUsers = await User.find({ role: 'client' });
    const clientIds = new Set(clientUsers.map(u => u.userId || u._id.toString()));
    clientIds.add('CLI2356362RBP'); // default client

    console.log(`Syncing for clients: ${Array.from(clientIds).join(', ')}`);

    // Fetch exams list from partner API
    console.log('Fetching exams list from Vectorize API...');
    const response = await axios.get(`${apiURL}/api/classroom/exams`, {
      headers: {
        'X-App-Token': appToken,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    if (!response.data || !response.data.success) {
      throw new Error('Failed to fetch exams list from Partner API');
    }

    const exams = response.data.exams || [];
    console.log(`Found ${exams.length} exams on partner server.`);

    for (const exam of exams) {
      const examId = exam.exam_id;
      console.log(`\nFetching details for exam: ${exam.name} (${examId})...`);

      try {
        const detailResponse = await axios.get(`${apiURL}/api/classroom/exams/${examId}`, {
          headers: {
            'X-App-Token': appToken,
            'Content-Type': 'application/json'
          },
          timeout: 25000
        });

        if (detailResponse.data && detailResponse.data.success) {
          const { exam: examDetails, tree } = detailResponse.data;
          
          const formatImageUrl = (url) => {
            if (!url) return '';
            if (url.startsWith('http://') || url.startsWith('https://')) return url;
            return `${apiURL}${url.startsWith('/') ? '' : '/'}${url}`;
          };

          // Save/Upsert for all active clients
          for (const clientId of clientIds) {
            console.log(`Saving exam ${examId} tree in database B for client ${clientId}...`);
            await ClassroomExam.findOneAndUpdate(
              { exam_id: examId, clientId },
              {
                exam_id: examId,
                name: examDetails.name,
                category: examDetails.category,
                image_url: formatImageUrl(examDetails.image_url),
                description: examDetails.description,
                clientId,
                tree: tree || [],
                synced_at: new Date()
              },
              { upsert: true, new: true }
            );
          }
          console.log(`Sync complete for exam: ${exam.name}`);
        } else {
          console.warn(`Failed to fetch tree details for exam: ${examId}`);
        }
      } catch (err) {
        console.error(`Error syncing details for exam ${examId}:`, err.message);
      }
    }

    console.log('\n--- Sync Process Completed Successfully ---');
  } catch (error) {
    console.error('Fatal Sync Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
};

run();

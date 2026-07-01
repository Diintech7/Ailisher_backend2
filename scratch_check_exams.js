const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const ClassroomExam = require('./models/ClassroomExam');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const count = await ClassroomExam.countDocuments({});
  console.log('Total Classroom Exams in DB:', count);

  const docs = await ClassroomExam.find({});
  console.log('All Documents:');
  docs.forEach((doc, idx) => {
    console.log(`${idx + 1}: Name: "${doc.name}", exam_id: "${doc.exam_id}", clientId: "${doc.clientId}"`);
  });

  await mongoose.disconnect();
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const classroomExamController = require('./controllers/classroomExamController');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const req = {
    params: { clientId: 'CLI2356362RBP' },
    query: {},
    user: { id: '68d3e91b2aa71f8d69b52248', role: 'client', userId: 'CLI2356362RBP' }
  };

  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      console.log('STATUS:', this.statusCode || 200);
      console.log('JSON:', JSON.stringify(data, null, 2));
    }
  };

  await classroomExamController.getFlashcardFilters(req, res);

  await mongoose.disconnect();
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});

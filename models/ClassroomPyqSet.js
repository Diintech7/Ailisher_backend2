const mongoose = require('mongoose');

const ClassroomPyqSetSchema = new mongoose.Schema({
  pyq_set_id: {
    type: String,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  year: {
    type: Number,
    default: null
  },
  description: {
    type: String,
    default: ''
  },
  question_count: {
    type: Number,
    default: 0
  },
  clientId: {
    type: String,
    required: true,
    index: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
});

// Compound index to ensure uniqueness for a client
ClassroomPyqSetSchema.index({ pyq_set_id: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model('ClassroomPyqSet', ClassroomPyqSetSchema);

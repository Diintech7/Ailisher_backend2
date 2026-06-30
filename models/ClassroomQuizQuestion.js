const mongoose = require('mongoose');

const classroomQuizQuestionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    trim: true
  },
  options: [{
    type: String,
    required: true,
    trim: true
  }],
  correctAnswer: {
    type: Number,
    required: true,
    min: 0
  },
  explanation: {
    type: String,
    default: '',
    trim: true
  },
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: 'medium',
    index: true
  },
  examId: {
    type: String,
    required: true,
    index: true
  },
  examName: {
    type: String,
    required: true,
    trim: true
  },
  paperId: {
    type: String,
    required: true,
    index: true
  },
  subjectId: {
    type: String,
    required: true,
    index: true
  },
  subjectName: {
    type: String,
    required: true,
    trim: true
  },
  chapterId: {
    type: String,
    index: true,
    default: null
  },
  chapterName: {
    type: String,
    trim: true,
    default: null
  },
  topicId: {
    type: String,
    required: true,
    index: true
  },
  topicName: {
    type: String,
    required: true,
    trim: true
  },
  subtopicId: {
    type: String,
    index: true,
    default: null
  },
  subtopicName: {
    type: String,
    trim: true,
    default: null
  },
  clientId: {
    type: String,
    required: true,
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  cardDeckId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FlashcardDeck',
    default: null,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for fast retrieval by topic, subtopic, chapter, or random sampling by client
classroomQuizQuestionSchema.index({ topicId: 1, clientId: 1 });
classroomQuizQuestionSchema.index({ chapterId: 1, clientId: 1 });
classroomQuizQuestionSchema.index({ subtopicId: 1, clientId: 1 });

module.exports = mongoose.model('ClassroomQuizQuestion', classroomQuizQuestionSchema);

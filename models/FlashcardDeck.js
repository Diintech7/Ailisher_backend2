const mongoose = require('mongoose');

const flashcardDeckSchema = new mongoose.Schema({
  clientId: {
    type: String,
    required: true,
    index: true
  },
  cardName: {
    type: String,
    required: true,
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
    required: true
  },
  examName: {
    type: String,
    required: true,
    trim: true
  },
  subjectId: {
    type: String,
    required: true
  },
  subjectName: {
    type: String,
    required: true,
    trim: true
  },
  chapterId: {
    type: String,
    default: null
  },
  chapterName: {
    type: String,
    default: null,
    trim: true
  },
  topicId: {
    type: String,
    required: true
  },
  topicName: {
    type: String,
    required: true,
    trim: true
  },
  questions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ClassroomQuizQuestion'
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('FlashcardDeck', flashcardDeckSchema);

const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  metadata: {
    modelUsed: String,
    tokensUsed: Number,
    confidence: Number,
    sources: Number,
    method: String,
    filesUsed: [String],
    timing: {
      init: String,
      retrieval: String,
      processing: String,
      generation: String,
      totalResponse: String
    }
  }
});

const chatSchema = new mongoose.Schema({
  chatId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  clientId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  bookId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Book',
    required: true,
    index: true
  },
  messages: [messageSchema],
  title: {
    type: String,
    default: '',
    maxlength: 200
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastMessageAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  messageCount: {
    type: Number,
    default: 0
  },
  totalTokensUsed: {
    type: Number,
    default: 0
  },
  metadata: {
    userAgent: String,
    platform: String,
    ipAddress: String,
    sessionId: String
  }
}, {
  timestamps: true
});

// Compound indexes for efficient querying
chatSchema.index({ clientId: 1, userId: 1, bookId: 1 });
chatSchema.index({ clientId: 1, userId: 1, lastMessageAt: -1 });
chatSchema.index({ chatId: 1, clientId: 1 });

// Pre-save middleware to update messageCount and lastMessageAt
chatSchema.pre('save', function(next) {
  this.messageCount = this.messages.length;
  if (this.messages.length > 0) {
    this.lastMessageAt = this.messages[this.messages.length - 1].timestamp;
  }
  next();
});

// Static method to generate unique chat ID
chatSchema.statics.generateChatId = function() {
  return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Static method to find or create chat
chatSchema.statics.findOrCreateChat = async function(chatId, clientId, userId, bookId) {
  if (chatId) {
    // Try to find existing chat
    const existingChat = await this.findOne({ chatId, clientId, userId, bookId });
    if (existingChat) {
      return existingChat;
    }
  }
  
  // Create new chat
  const newChatId = chatId || this.generateChatId();
  const newChat = new this({
    chatId: newChatId,
    clientId,
    userId,
    bookId,
    messages: []
  });
  
  await newChat.save();
  return newChat;
};

module.exports = mongoose.model('Chat', chatSchema);

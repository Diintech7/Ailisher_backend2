// models/Evaluation.js
const mongoose = require('mongoose');

const evaluationSchema = new mongoose.Schema({
  submissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UserAnswer',
    required: true
  },
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AiswbQuestion',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MobileUser',
    required: true
  },
  evaluatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Evaluator',
    required: false
  },
  clientId: {
    type: String,
    required: true
  },
  evaluationMode: {
    type: String,
    enum: ['auto', 'manual'],
    default: 'auto'
  },
  evaluation: {
    relevancy: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    extractedText: {
      type: String,
      trim: true
    },
    score: {
      type: Number,
      min: 0
    },
    remark: {
      type: String,
      trim: true,
      maxlength: 250
    },
    feedbackStatus: {
      type: Boolean,
      default: true
    },
    userFeedback: {
      type: Object,
      default: () => ({
        message: '',
        submittedAt: null
      })
    },
    comments: [{
      type: String,
      trim: true,
      maxlength: 800
    }],
    analysis: {
      introduction: [{
        type: String,
        trim: true
      }],
      body: [{
        type: String,
        trim: true
      }],
      conclusion: [{
        type: String,
        trim: true
      }],
      strengths: [{
        type: String,
        trim: true
      }],
      weaknesses: [{
        type: String,
        trim: true
      }],
      suggestions: [{
        type: String,
        trim: true
      }],
      feedback: [{
        type: String,
        trim: true
      }]
    }
  },
  hindiEvaluation: {
    relevancy: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    score: {
      type: Number,
      min: 0
    },
    remark: {
      type: String,
      trim: true,
      maxlength: 250
    },
    comments: [{
      type: String,
      trim: true,
      maxlength: 800
    }],
    analysis: {
      introduction: [{
        type: String,
        trim: true
      }],
      body: [{
        type: String,
        trim: true
      }],
      conclusion: [{
        type: String,
        trim: true
      }],
      strengths: [{
        type: String,
        trim: true
      }],
      weaknesses: [{
        type: String,
        trim: true
      }],
      suggestions: [{
        type: String,
        trim: true
      }],
      feedback: [{
        type: String,
        trim: true
      }]
    }
  },
  annotations: [{
    s3Key: {
      type: String,
      required: true
    },
    downloadUrl: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
}, {
  timestamps: true
});

// Indexes for better query performance
evaluationSchema.index({ userId: 1 });
evaluationSchema.index({ questionId: 1 });
evaluationSchema.index({ submissionId: 1 }, { unique: true });
evaluationSchema.index({ status: 1 });
evaluationSchema.index({ evaluatedAt: -1 });
evaluationSchema.index({ userId: 1, questionId: 1 });
evaluationSchema.index({ clientId: 1 });
evaluationSchema.index({ evaluationMode: 1 });

// Update timestamp on save
evaluationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to get user evaluations with pagination
evaluationSchema.statics.getUserEvaluations = function(userId, options = {}) {
  const {
    questionId,
    status,
    page = 1,
    limit = 10
  } = options;

  const query = { userId };
  
  if (questionId) {
    query.questionId = questionId;
  }
  
  if (status) {
    query.status = status;
  }

  const skip = (page - 1) * limit;

  return Promise.all([
    this.find(query)
      .populate('questionId', 'question detailedAnswer metadata')
      .populate('submissionId', 'attemptNumber submittedAt')
      .sort({ evaluatedAt: -1 })
      .skip(skip)
      .limit(limit),
    this.countDocuments(query)
  ]).then(([evaluations, total]) => ({
    evaluations,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit)
    }
  }));
};

// Static method to get question evaluations with pagination
evaluationSchema.statics.getQuestionEvaluations = function(questionId, options = {}) {
  const {
    status,
    evaluationMode,
    page = 1,
    limit = 10,
    sortBy = 'evaluatedAt',
    sortOrder = 'desc'
  } = options;

  const query = { questionId };
  
  if (status) {
    query.status = status;
  }
  
  if (evaluationMode) {
    query.evaluationMode = evaluationMode;
  }

  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const skip = (page - 1) * limit;

  return Promise.all([
    this.find(query)
      .populate('userId', 'mobile')
      .populate('submissionId', 'attemptNumber submittedAt answerImages')
      .populate('questionId', 'question metadata')
      .sort(sort)
      .skip(skip)
      .limit(limit),
    this.countDocuments(query)
  ]).then(([evaluations, total]) => ({
    evaluations,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit)
    }
  }));
};

// Method to publish evaluation
evaluationSchema.methods.publish = function(publishedBy = 'system', reason = '') {
  this.status = 'published';
  
  this.publishHistory.push({
    status: 'published',
    timestamp: new Date(),
    changedBy: publishedBy,
    mode: this.evaluationMode,
    reason
  });
  
  return this.save();
};

// Method to unpublish evaluation
evaluationSchema.methods.unpublish = function(unpublishedBy = 'system', reason = '') {
  this.status = 'not_published';
  
  this.publishHistory.push({
    status: 'not_published',
    timestamp: new Date(),
    changedBy: unpublishedBy,
    mode: this.evaluationMode,
    reason
  });
  
  return this.save();
};

// Virtual for formatted evaluation result
evaluationSchema.virtual('evaluationResult').get(function() {
  return {
    evaluationId: this._id,
    evaluationMode: this.evaluationMode,
    marks: this.marks,
    accuracy: this.accuracy,
    status: this.status,
    evaluatedAt: this.evaluatedAt,
    evaluatedBy: this.evaluatedBy,
    feedback: this.feedback,
    geminiAnalysis: this.geminiAnalysis,
    extractedTexts: this.extractedTexts
  };
});

module.exports = mongoose.model('Evaluation', evaluationSchema);
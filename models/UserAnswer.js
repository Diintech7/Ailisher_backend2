const mongoose = require('mongoose');
const axios = require('axios');

const userAnswerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MobileUser',
    required: true
  },
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  testType: {
    type: String,
    enum: ['aiswb', 'subjective'],
    // required: true
  },
  testId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubjectiveTest',
    required: false
  },
  setId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AISWBSet',
    required: false
  },
  clientId: {
    type: String,
    required: true
  },
  attemptNumber: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  answerImages: [{
    imageUrl: {
      type: String,
      required: true
    },
    cloudinaryPublicId: {
      type: String,
      required: true
    },
    originalName: {
      type: String
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  textAnswer: {
    type: String,
    trim: true
  },
  submissionStatus: {
    type: String,
    enum: ['submitted', 'accepted', 'rejected', 'evaluated', 'invalid'],
    default: 'submitted'
  },
  submittedAt: {
    type: Date,
  },
  // Add review timestamps
  reviewRequestedAt: {
    type: Date,
  },
  reviewAssignedAt: {
    type: Date,
  },
  reviewCompletedAt: {
    type: Date,
  },
  acceptedAt: {
    type: Date,
  },
  evaluatedAt: {
    type: Date
  },
  reviewrequestedAt: {
    type: Date
  },
  reviewassignedAt: {
    type: Date
  },
  reviewcompletedAt: {
    type: Date
  },
  reviewedBy:{
    type:String
  },
  reviewedByEvaluator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Evaluator',
    required: false
  },
  feedback: {
    score: {
      type: Number,
      min: 0,
      max: 100
    },
    comments: {
      type: String,
      trim: true
    },
    suggestions: [{
      type: String,
      trim: true
    }],
    feedbackStatus: {
      type: Boolean,
      default: true
    },
    userFeedbackReview: {
      type: Object,
      default: () => ({
        message: '',
        submittedAt: null
      })
    },
    expertReview: {
      result: {
        type: String,
        required: false
      },
      score: {
        type: Number,
        min: 0,
      },
      remarks: {
        type: String,
        trim: true
      },
      annotatedImages: [{
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
      reviewedAt: {
        type: Date,
        default: Date.now
      }
    }
  },
  metadata: {
    timeSpent: {
      type: Number,
      default: 0
    },
    deviceInfo: {
      type: String
    },
    appVersion: {
      type: String
    },
    sourceType: {
      type: String,
      enum: ['qr_scan', 'direct_access', 'set_practice'],
      default: 'qr_scan'
    }
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
  publishStatus: {
    type: String,
    enum: ['published', 'not_published'],
    default: 'not_published'
  },
  requestID: {
    type: String,
    default: null
  },
  requestnote: {
    type: String,
    default: null 
  },
  reviewStatus: {
    type: String,
    enum: ['review_pending', 'review_accepted', 'review_completed'],
    default: null
  },
  popularityStatus: {
    type: String,
    enum: ['popular', 'not_popular'],
    default: 'not_popular'
  },
  extractedTexts: [{
    type: String,
    trim: true
  }],
  
  updatedAt: {
    type: Date
  }
}, {
  timestamps: true
});

userAnswerSchema.index({ userId: 1, questionId: 1, attemptNumber: 1 });
userAnswerSchema.index({ userId: 1, clientId: 1 });
userAnswerSchema.index({ questionId: 1, clientId: 1 });
userAnswerSchema.index({ submissionStatus: 1 });
userAnswerSchema.index({ userId: 1, questionId: 1 });
userAnswerSchema.index({ publishStatus: 1 });

userAnswerSchema.statics.cleanupOldIndexes = async function() {
  try {
    const collection = this.collection;
    const indexes = await collection.indexes();
    for (const index of indexes) {
      if (index.name !== '_id_') {
        await collection.dropIndex(index.name);
      }
    }
    await this.createIndexes();
  } catch (error) {
    console.error('Error cleaning up indexes:', error);
  }
};

userAnswerSchema.statics.canUserSubmit = async function(userId, questionId) {
  const count = await this.countDocuments({
    userId: userId,
    questionId: questionId
  });
  return {
    canSubmit: count < 5,
    currentAttempts: count,
    remainingAttempts: Math.max(0, 5 - count)
  };
};

userAnswerSchema.statics.getUserAttempts = function(userId, questionId) {
  return this.find({
    userId: userId,
    questionId: questionId
  }).sort({ attemptNumber: 1 });
};

userAnswerSchema.statics.getUserLatestAttempt = function(userId, questionId) {
  return this.findOne({
    userId: userId,
    questionId: questionId
  }).sort({ attemptNumber: -1 });
};

userAnswerSchema.statics.getPublishedAnswers = function(filter = {}) {
  return this.find({
    publishStatus: 'published',
    ...filter
  }).populate('userId', 'name email').populate('questionId');
};

userAnswerSchema.statics.getNotPublishedAnswers = function(filter = {}) {
  return this.find({
    publishStatus: 'not_published',
    ...filter
  }).populate('userId', 'name email').populate('questionId');
};

userAnswerSchema.methods.isFinalAttempt = function() {
  return this.attemptNumber === 5;
};

userAnswerSchema.methods.isPublished = function() {
  return this.publishStatus === 'published';
};

userAnswerSchema.methods.publish = function() {
  this.publishStatus = 'published';
  return this.save();
};

userAnswerSchema.methods.unpublish = function() {
  this.publishStatus = 'not_published';
  return this.save();
};

userAnswerSchema.methods.setRemark = function(remark) {
  if (!remark || typeof remark !== 'string') {
    throw new Error('Remark must be a non-empty string');
  }
  const trimmedRemark = remark.trim();
  if (trimmedRemark.length > 250) {
    this.evaluation.remark = trimmedRemark.substring(0, 247) + '...';
  } else {
    this.evaluation.remark = trimmedRemark;
  }
  return this.save();
};

userAnswerSchema.methods.getRemark = function() {
  return this.evaluation.remark || '';
};

userAnswerSchema.methods.addEvaluationComment = function(comment) {
  if (!comment || typeof comment !== 'string') {
    throw new Error('Comment must be a non-empty string');
  }
  
  const trimmedComment = comment.trim();
  if (trimmedComment.length > 800) {
    throw new Error('Comment is too long. Maximum 800 characters allowed.');
  }
  
  if (!this.evaluation.comments) {
    this.evaluation.comments = [];
  }
  
  if (this.evaluation.comments.length >= 4) {
    throw new Error('Maximum 4 comments allowed per evaluation');
  }
  
  this.evaluation.comments.push(trimmedComment);
  return this.save();
};

userAnswerSchema.methods.getEvaluationComments = function() {
  return this.evaluation.comments || [];
};

userAnswerSchema.statics.createNewAttempt = async function(answerData) {
  const { userId, questionId } = answerData;
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const existingCount = await this.countDocuments({ userId, questionId }).session(session);
      if (existingCount >= 5) {
        const error = new Error('Maximum submission limit (5) reached for this question');
        error.code = 'SUBMISSION_LIMIT_EXCEEDED';
        throw error;
      }
      const latestAttempt = await this.findOne(
        { userId, questionId },
        { attemptNumber: 1 }
      ).sort({ attemptNumber: -1 }).session(session);
      const nextAttemptNumber = latestAttempt ? latestAttempt.attemptNumber + 1 : 1;
      if (nextAttemptNumber > 5) {
        const error = new Error('Maximum submission limit (5) reached for this question');
        error.code = 'SUBMISSION_LIMIT_EXCEEDED';
        throw error;
      }
      const attemptData = {
        ...answerData,
        attemptNumber: nextAttemptNumber
      };
      const userAnswer = new this(attemptData);
      await userAnswer.save({ session });
      return userAnswer;
    });
  } finally {
    await session.endSession();
  }
};

userAnswerSchema.statics.createNewAttemptSafe = async function(answerData) {
  const { userId, questionId } = answerData;
  const maxRetries = 3;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const existingCount = await this.countDocuments({ userId, questionId });
      if (existingCount >= 5) {
        const error = new Error('Maximum submission limit (5) reached for this question');
        error.code = 'SUBMISSION_LIMIT_EXCEEDED';
        throw error;
      }
      const existingAttempts = await this.find(
        { userId, questionId },
        { attemptNumber: 1 }
      ).sort({ attemptNumber: 1 });
      let nextAttemptNumber = 1;
      const existingNumbers = existingAttempts.map(a => a.attemptNumber).sort((a, b) => a - b);
      for (let i = 1; i <= 5; i++) {
        if (!existingNumbers.includes(i)) {
          nextAttemptNumber = i;
          break;
        }
      }
      if (nextAttemptNumber > 5) {
        const error = new Error('Maximum submission limit (5) reached for this question');
        error.code = 'SUBMISSION_LIMIT_EXCEEDED';
        throw error;
      }
      const attemptData = {
        ...answerData,
        attemptNumber: nextAttemptNumber
      };
      const userAnswer = new this(attemptData);
      await userAnswer.save();
      return userAnswer;
    } catch (error) {
      attempt++;
      if (error.code === 'SUBMISSION_LIMIT_EXCEEDED') {
        throw error;
      }
      if ((error.code === 11000 || error.message.includes('E11000')) && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        continue;
      }
      throw error;
    }
  }
  const error = new Error('Failed to create answer after multiple attempts');
  error.code = 'CREATION_FAILED';
  throw error;
};

userAnswerSchema.statics.hasReviewRequest = async function(userId, clientId) {
  try {
    const response = await axios.get(`${process.env.API_BASE_URL}/api/clients/${clientId}/mobile/review/request`, {
      headers: {
        'Authorization': `Bearer ${process.env.API_TOKEN}`
      }
    });
    return response.data?.hasReviewRequest || false;
  } catch (error) {
    console.error('Error checking review request:', error);
    return false;
  }
};

// Add custom validation for testType and testId
userAnswerSchema.pre('save', function(next) {
  // Validate testId is required for subjective tests
  if (this.testType === 'subjective' && !this.testId) {
    return next(new Error('testId is required for subjective questions'));
  }
  
  // Validate testId should not be provided for AISWB tests
  if (this.testType === 'aiswb' && this.testId) {
    return next(new Error('testId should not be provided for AISWB questions'));
  }
  
  next();
});

const UserAnswer = mongoose.model('UserAnswer', userAnswerSchema);
UserAnswer.cleanupOldIndexes().catch(console.error);
module.exports = UserAnswer;
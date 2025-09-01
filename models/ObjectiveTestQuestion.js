const mongoose = require('mongoose');

const objectiveTestQuestionSchema = new mongoose.Schema({
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
  difficulty: {
    type: String,
    required: true,
    enum: ['L1', 'L2', 'L3'],
    default: 'L1'
  },
  estimatedTime: {
    type: Number,
    required: true,
    default: 1
  },
  positiveMarks: {
    type: Number,
    required: true,
    default: 1
  },
  negativeMarks: {  
    type: Number,
    required: true,
    default: 0.33
  },
  // Reference to the question set this question belongs to
  test: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ObjectiveTest',
    // required: true
  },
  // Reference to the question set this question belongs to
  questionBank: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuestionBank',
    // required: true
  },
  // Additional metadata
  tags: [{
    type: String,
    trim: true
  }],
  subject:{
    type:String,
    trim:true
  },
  topic:{
    type:String,
    trim:true
  },
  isActive: {
    type: Boolean,  
    default: true
  },
  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  solution: {
    type: {
      type: String,
      enum: ['text', 'video', 'image'],
      default: 'text'
    },
    text: {
      type: String,
      default: ""
    },
    video: {
      url: {
        type: String,
        default: ""
      },
      title: {
        type: String,
        default: ""
      },
      description: {
        type: String,
        default: ""
      },
      duration: {
        type: Number,
        default: 0
      }
    },
    image: {
      url: {
        type: String,
        default: ""
      },
      caption: {
        type: String,
        default: ""
      }
    }
  },
  // Statistics
  timesAnswered: {
    type: Number,
    default: 0
  },
  timesCorrect: {
    type: Number,
    default: 0
  }
});

// Index for efficient queries
objectiveTestQuestionSchema.index({ test: 1 });
objectiveTestQuestionSchema.index({ difficulty: 1 });
objectiveTestQuestionSchema.index({ createdBy: 1 });

// Pre-save middleware to update timestamps
objectiveTestQuestionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Virtual for getting the difficulty display name
objectiveTestQuestionSchema.virtual('difficultyDisplay').get(function() {
  switch(this.difficulty) {
    case 'L1':
      return 'Beginner';
    case 'L2':
      return 'Intermediate';
    case 'L3':
      return 'Advanced';
    default:
      return this.difficulty;
  }
});

// Virtual for getting accuracy percentage
objectiveTestQuestionSchema.virtual('accuracyPercentage').get(function() {
  if (this.timesAnswered === 0) return 0;
  return Math.round((this.timesCorrect / this.timesAnswered) * 100);
});


// Virtual for getting the parent item ID
objectiveTestQuestionSchema.virtual('parentId').get(function() {
  if (this.subtopic) return this.subtopic;
  if (this.topic) return this.topic;
  if (this.chapter) return this.chapter;
  if (this.book) return this.book;
  return null;
});

// Virtual for getting solution display info
objectiveTestQuestionSchema.virtual('solutionDisplay').get(function() {
  switch (this.solution.type) {
    case 'text':
      return {
        type: 'text',
        content: this.solution.text,
        hasContent: !!this.solution.text
      };
    case 'video':
      return {
        type: 'video',
        content: this.solution.video,
        hasContent: !!this.solution.video.url
      };
    case 'image':
      return {
        type: 'image',
        content: this.solution.image,
        hasContent: !!this.solution.image.url
      };
    default:
      return {
        type: 'none',
        content: null,
        hasContent: false
      };
  }
});

// Method to record an answer attempt
objectiveTestQuestionSchema.methods.recordAnswer = function(isCorrect) {
  this.timesAnswered += 1;
  if (isCorrect) {
    this.timesCorrect += 1;
  }
  return this.save();
};

// Method to set text solution
objectiveTestQuestionSchema.methods.setTextSolution = function(text) {
  this.solution.type = 'text';
  this.solution.text = text;
  this.solution.video = { url: "", title: "", description: "", duration: 0 };
  this.solution.image = { url: "", caption: "" };
  return this.save();
};

// Method to set video solution
objectiveTestQuestionSchema.methods.setVideoSolution = function(videoData) {
  this.solution.type = 'video';
  this.solution.video = {
    url: videoData.url || "",
    title: videoData.title || "",
    description: videoData.description || "",
    duration: videoData.duration || 0
  };
  this.solution.text = "";
  this.solution.image = { url: "", caption: "" };
  return this.save();
};

// Method to set image solution
objectiveTestQuestionSchema.methods.setImageSolution = function(imageData) {
  this.solution.type = 'image';
  this.solution.image = {
    url: imageData.url || "",
    caption: imageData.caption || ""
  };
  this.solution.text = "";
  this.solution.video = { url: "", title: "", description: "", duration: 0 };
  return this.save();
};

// Method to get solution content
objectiveTestQuestionSchema.methods.getSolutionContent = function() {
  switch (this.solution.type) {
    case 'text':
      return this.solution.text;
    case 'video':
      return this.solution.video;
    case 'image':
      return this.solution.image;
    default:
      return null;
  }
};


// Static method to find questions by difficulty
objectiveTestQuestionSchema.statics.findByDifficulty = function(difficulty, options = {}) {
  return this.find({ difficulty, isActive: true, ...options })
    .populate('test')
    .sort({ createdAt: -1 });
};

// Static method to find questions by question set
objectiveTestQuestionSchema.statics.findByTest = function(testId, options = {}) {
    return this.find({ test: testId, isActive: true, ...options })
    .sort({ createdAt: -1 });
};

module.exports = mongoose.model('ObjectiveTestQuestion', objectiveTestQuestionSchema);
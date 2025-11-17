const mongoose = require('mongoose');

const myQuestionSchema = new mongoose.Schema({
  // Initial User Input (Required at creation)
  question: {
    type: String,
    required: true,
    trim: true
  },
  wordLimit: {
    type: Number,
    required: true,
    min: 0
  },
  maximumMarks: {
    type: Number,
    required: true,
    min: 0
  },
    subject: {
      type: String,
      required: true,
      trim: true
    },
    exam: {
      type: String,
      required: true,
      trim: true
    },
    
    // Client Formatting (AISWB-like fields - Optional until formatted)
    detailedAnswer: {
      type: String,
      trim: true
    },
    modalAnswer: {
      type: String,
      trim: true
    },
    modalAnswerPdfKey: [{
      type: String
    }],
    answerVideoUrls: [{
        type: String,
        trim: true
      }],
      metadata: {
        keywords: [{
          type: String,
          trim: true
        }],
        difficultyLevel: {
          type: String,
          enum: ['level1', 'level2', 'level3']
        },
        wordLimit: {
          type: Number,
          min: 0
        },
        estimatedTime: {
          type: Number,
          min: 0
        },
        maximumMarks: {
          type: Number,
          min: 0
        },
        qualityParameters: {
          intro: {
            type: Boolean,
            default: false
          },
          body: {
            enabled: {
              type: Boolean,
              default: false
            },
            features: {
                type: Boolean,
                default: false
              },
              examples: {
                type: Boolean,
                default: false
              },
              facts: {
                type: Boolean,
                default: false
              },
              diagram: {
                type: Boolean,
                default: false
              }
            },
            conclusion: {
              type: Boolean,
              default: false
            },
            customParams: [{
              type: String,
              trim: true
            }]
          }
        },
        languageMode: {
          type: String,
          enum: ['english', 'hindi']
        },
        evaluationMode: {
          type: String,
          enum: ['auto', 'manual'],
          default: 'auto'
        },
        evaluationType: {
            type: String,
            enum: ['with annotation', 'without annotation'],
            default: 'without annotation'
          },
          evaluationGuideline: {
            type: String,
            trim: true
          },
          
          // Status Tracking
          status: {
            type: String,
            enum: ['pending', 'formatted', 'rejected'],
            default: 'pending',
            index: true
          },
          formattedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
          },
          formattedAt: {
            type: Date
          },
          activatedAt: {
            type: Date
          },
          
          // References
          clientId: {
            type: String,
            required: true,
            index: true
          },
          createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'MobileUser',
            required: true
          }
        }, {
          timestamps: true
        });
        
        // Ensure keywords are unique and case-insensitive
        myQuestionSchema.pre('save', function(next) {
          if (this.metadata && this.metadata.keywords) {
            const uniqueKeywords = [...new Set(
              this.metadata.keywords.map(k => k.toLowerCase())
            )];
            this.metadata.keywords = uniqueKeywords;
          }
          
          // Ensure custom params are unique
          if (this.metadata && this.metadata.qualityParameters && this.metadata.qualityParameters.customParams) {
            const uniqueParams = [...new Set(this.metadata.qualityParameters.customParams)];
            this.metadata.qualityParameters.customParams = uniqueParams;
          }
          
          // Ensure video URLs are unique
          if (this.answerVideoUrls && this.answerVideoUrls.length > 0) {
            const uniqueUrls = [...new Set(this.answerVideoUrls.filter(url => url && url.trim()))];
            this.answerVideoUrls = uniqueUrls;
          }
          
          // Set formattedAt when status changes to formatted
          if (this.isModified('status') && this.status === 'formatted' && !this.formattedAt) {
            this.formattedAt = new Date();
          }
  // Set activatedAt when status changes to active
  if (this.isModified('status') && this.status === 'active' && !this.activatedAt) {
    this.activatedAt = new Date();
  }
  
  next();
});

// Indexes for efficient queries
myQuestionSchema.index({ clientId: 1, status: 1 });
myQuestionSchema.index({ createdBy: 1, status: 1 });
myQuestionSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('MyQuestion', myQuestionSchema);

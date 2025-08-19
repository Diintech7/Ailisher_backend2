const mongoose = require('mongoose');

const testResultSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    testId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ObjectiveTest',
        required: true
    },
    clientId: {
        type: String,
        ref: 'Client',
        required: true
    },
    answers: {
        type: Map,
        of: Number
    },
    score: {
        type: Number,
        min: 0,
        max: 100
    },
    totalQuestions: {
        type: Number
    },
    answeredQuestions: {
        type: Number
    },
    correctAnswers: {
        type: Number
    },
    levelBreakdown: {
        L1: { total: Number, correct: Number, score: Number },
        L2: { total: Number, correct: Number, score: Number },
        L3: { total: Number, correct: Number, score: Number }
    },
    startTime: {
        type: Date,
        required: true
    },
    submittedAt: {
        type: Date,
        default: Date.now
    },
    completionTime: {
        type: String
    },
    status: {
        type: String,
        enum: ['completed', 'in_progress', 'abandoned'],
        default: 'completed'
    },
    // NEW FIELDS FOR MULTIPLE ATTEMPTS
    attemptNumber: {
        type: Number,
        required: true,
        default: 1
    },
    maxAttempts: {
        type: Number,
        default: 5
    },
    attemptHistory: [{
        attemptNumber: {
            type: Number,
            required: true
        },
        score: {
            type: Number,
            min: 0,
            max: 100
        },
        completionTime: {
            type: String
        },
        answers: {
            type: Map,
            of: Number
        },
        submittedAt: {
            type: Date,
            default: Date.now
        },
        correctAnswers: {
            type: Number
        },
        totalQuestions: {
            type: Number
        },
        wrongAnswers: {
            type: Number
        },
        skippedQuestions: {
            type: Number
        },
        totalMarksEarned: {
            type: Number
        },
        levelBreakdown: {
            L1: { total: Number, correct: Number, score: Number },
            L2: { total: Number, correct: Number, score: Number },
            L3: { total: Number, correct: Number, score: Number }
        }
    }]
}, {
    timestamps: true
});

// Index for efficient queries
testResultSchema.index({ userId: 1, testId: 1 });
testResultSchema.index({ clientId: 1, testId: 1 });
testResultSchema.index({ submittedAt: -1 });
testResultSchema.index({ attemptNumber: 1 }); // New index for attempt tracking

module.exports = mongoose.model('TestResult', testResultSchema);
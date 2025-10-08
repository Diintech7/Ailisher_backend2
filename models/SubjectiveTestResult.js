// models/SubjectiveTestResult.js
const mongoose = require('mongoose');

const subjectiveTestResultSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    testId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SubjectiveTest',
        required: true
    },
    clientId: {
        type: String,
        required: true
    },
    
    // Timing
    startTime: {
        type: Date,
        required: true
    },
    endTime: {
        type: Date,
        default: null
    },
    completionTime: {
        type: Number, // in seconds
        default: 0
    },
    
    // Test Results
    totalQuestions: {
        type: Number,
        required: true
    },
    attemptedQuestions: {
        type: Number,
        default: 0
    },
    totalScore: {
        type: Number,
        default: 0
    },
    averageScore: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['started', 'completed', 'unattempted'],
        default: 'started'
    }
}, {
    timestamps: true
});

// Index for quick queries
subjectiveTestResultSchema.index({ userId: 1, testId: 1 });

module.exports = mongoose.model('SubjectiveTestResult', subjectiveTestResultSchema);
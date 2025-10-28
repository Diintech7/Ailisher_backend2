const mongoose = require('mongoose');

const ClassSchema = new mongoose.Schema({
  // Basic info
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  
  // Scheduling
  scheduledAt: {
    type: Date,
    required: true
  },
  duration: {
    type: Number, // in minutes
    default: 60
  },
  
  // 100ms Integration
  roomId: {
    type: String,
    default: null
  },
  roomCode: {
    type: String,
    unique: true,
    sparse: true
  },
  templateId: {
    type: String,
    default: null
  },
  
  // Classroom reference
  classroom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Classroom',
    required: true
  },
  
  // Owner
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true
  },
  
  // Organization context
  organization: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    default: null
  },
  
  // Status
  status: {
    type: String,
    enum: ['scheduled', 'live', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  
  // Attendance tracking
  attendees: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: Date,
    leftAt: Date,
    duration: Number // in seconds
  }],
  
  // Stats
  totalAttendees: {
    type: Number,
    default: 0
  },
  peakAttendees: {
    type: Number,
    default: 0
  },
  
  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes
ClassSchema.index({ classroom: 1, scheduledAt: -1 });
ClassSchema.index({ roomId: 1 });
ClassSchema.index({ status: 1, scheduledAt: -1 });
ClassSchema.index({ organization: 1 });

module.exports = mongoose.model('Class', ClassSchema);


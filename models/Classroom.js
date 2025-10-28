const mongoose = require('mongoose');

const ClassroomSchema = new mongoose.Schema({
  // Basic info
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
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
  
  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active'
  },
  
  // Classes count
  classesCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes
ClassroomSchema.index({ createdBy: 1, status: 1 });
ClassroomSchema.index({ organization: 1, status: 1 });

module.exports = mongoose.model('Classroom', ClassroomSchema);


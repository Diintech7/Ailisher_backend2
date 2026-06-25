const mongoose = require('mongoose');

const ClassroomCurrentAffairSchema = new mongoose.Schema({
  ca_topic_id: {
    type: String,
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: ''
  },
  isCustom: {
    type: Boolean,
    default: false
  },
  clientId: {
    type: String,
    required: true,
    index: true
  },
  reels: [
    {
      reel_id: { type: String, required: true },
      title: { type: String, required: true },
      video_url: { type: String, required: true },
      video_key: { type: String },
      isEnabled: { type: Boolean, default: true },
      created_at: { type: Date, default: Date.now }
    }
  ],
  created_at: {
    type: Date,
    default: Date.now
  }
});

// Compound index to ensure uniqueness per client
ClassroomCurrentAffairSchema.index({ ca_topic_id: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model('ClassroomCurrentAffair', ClassroomCurrentAffairSchema);

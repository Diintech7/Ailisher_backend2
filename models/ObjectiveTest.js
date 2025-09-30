const mongoose = require('mongoose');

const objectiveTestSchema = new mongoose.Schema({
    name: { type: String, required: true, default: "" },
    clientId: { type: String, required: true },
    description: { type: String, default: "" },
    category: { type: String, default: "" },
    subcategory: { type: String, default: "" },
    Estimated_time: { type: String, default: "" },
    imageKey: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    videoUrl:{
      type: String,
      default: ''
    },
    isTrending: { type: Boolean, default: false },
    isHighlighted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isEnabled: { type: Boolean, default: true },
    instructions: { type: String, default: "" },
    questions: { type: Array, default: [] },
    isPaid:{
        type:Boolean,
        default:false
      },
    // Scheduling
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    
}, { timestamps: true });

// Helpful indexes for scheduling queries
objectiveTestSchema.index({ clientId: 1, isEnabled: 1, isActive: 1, startsAt: 1, endsAt: 1 });

// Query helpers
objectiveTestSchema.query.scheduled = function() {
  return this.where({ $or: [ { startsAt: { $ne: null } }, { endsAt: { $ne: null } } ] });
};

objectiveTestSchema.query.live = function(now = new Date()) {
  return this.where({ isEnabled: true, isActive: true }).where({
    $and: [
      { $or: [ { startsAt: null }, { startsAt: { $lte: now } } ] },
      { $or: [ { endsAt: null }, { endsAt: { $gt: now } } ] }
    ]
  });
};

// Instance helper
objectiveTestSchema.methods.isLive = function(now = new Date()) {
  const enabled = this.isEnabled !== false && this.isActive !== false;
  const started = !this.startsAt || this.startsAt <= now;
  const notEnded = !this.endsAt || this.endsAt > now;
  return enabled && started && notEnded;
};

// Static convenience
objectiveTestSchema.statics.findLive = function(filter = {}, now = new Date()) {
  return this.find(filter).live(now);
};

module.exports = mongoose.model('ObjectiveTest', objectiveTestSchema); 
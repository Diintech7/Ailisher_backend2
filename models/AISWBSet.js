const mongoose = require("mongoose");

const aiswbSetSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    itemType: {
      type: String,
      enum: ["book", "workbook", "chapter", "topic", "subtopic"],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    isWorkbook: {
      type: Boolean,
      default: false,
    },
    questions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AiswbQuestion",
      },
    ],
    isEnabled:{
      type:Boolean,
      default:true
    },
    isActive:{
      type:Boolean,
      default:true
    },
    // Scheduling
    startsAt: {
      type: Date,
      default: null,
    },
    endsAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Helpful indexes for scheduling queries
aiswbSetSchema.index({ isEnabled: 1, isActive: 1, startsAt: 1, endsAt: 1, itemType: 1, itemId: 1 });


// Query helpers
aiswbSetSchema.query.scheduled = function() {
    return this.where({ $or: [ { startsAt: { $ne: null } }, { endsAt: { $ne: null } } ] });
};

aiswbSetSchema.query.live = function(now = new Date()) {
    return this.where({ isEnabled: true, isActive: true }).where({
        $and: [
            { $or: [ { startsAt: null }, { startsAt: { $lte: now } } ] },
            { $or: [ { endsAt: null }, { endsAt: { $gt: now } } ] }
        ]
    });
};

// Instance helper
aiswbSetSchema.methods.isLive = function(now = new Date()){
    const started = !this.startsAt || this.startsAt <= now;
    const notEnded = !this.endsAt || this.endsAt > now;
    return started && notEnded;
};

// Static convenience
aiswbSetSchema.statics.findLive = function(filter = {}, now = new Date()){
    return this.find(filter).live(now);
};


module.exports = mongoose.model("AISWBSet", aiswbSetSchema);

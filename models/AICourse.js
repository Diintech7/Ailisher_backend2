const mongoose = require("mongoose");

const aiCourseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  overview: { type: String, required: true },
  details: { type: String, required: true },
  coverImageKey: { type: String, default: "" },
  coverImageUrl: { type: String, default: "" },
  // Categorization
  mainCategory: { type: String, default: "Other", index: true },
  subCategory: { type: String, default: "Other", index: true },
  customSubCategory: { type: String, default: "" },
  tags: { type: [String], default: [] },
    // Highlights functionality
    isHighlighted: {
      type: Boolean,
      default: false,
      index: true
    },
    highlightedAt: {
      type: Date,
      default: null
    },
    highlightedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'highlightedByType',
      default: null
    },
    highlightedByType: {
      type: String,
      enum: ['User', 'MobileUser'],
      default: null
    },
    highlightOrder: {
      type: Number,
      default: 0,
      index: true
    },
    highlightNote: {
      type: String,
      trim: true,
      maxlength: [200, 'Highlight note cannot be more than 200 characters'],
      default: ''
    },
      // Trending functionality
  isTrending: {
    type: Boolean,
    default: false,
    index: true
  },
  trendingScore: {
    type: Number,
    default: 0,
    index: true
  },
  trendingStartDate: {
    type: Date,
    default: null
  },
  trendingEndDate: {
    type: Date,
    default: null
  },
  trendingBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'trendingByType',
    default: null
  },
  trendingByType: {
    type: String,
    enum: ['User', 'MobileUser'],
    default: null
  },
  // Faculty details
  faculty: [
    {
      name: { type: String, required: true },
      about: { type: String, required: true },
      facultyImageKey: { type: String, default: "" },
      facultyImageUrl: { type: String, default: "" },
    },
  ],
  // Ownership and visibility
  clientId: { type: String, required: true, index: true },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isPublic: { type: Boolean, default: true },
  // Audit
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

aiCourseSchema.index({ clientId: 1, mainCategory: 1 });
aiCourseSchema.index({ clientId: 1, subCategory: 1 });

aiCourseSchema.methods.toggleHighlight = function(userId, userType, note = '', order = 0) {
  this.isHighlighted = !this.isHighlighted;
  
  if (this.isHighlighted) {
    this.highlightedAt = new Date();
    this.highlightedBy = userId;
    this.highlightedByType = userType;
    this.highlightNote = note;
    this.highlightOrder = order;
  } else {
    this.highlightedAt = null;
    this.highlightedBy = null;
    this.highlightedByType = null;
    this.highlightNote = '';
    this.highlightOrder = 0;
  }
  
  return this.save();
};

aiCourseSchema.methods.toggleTrending = function(userId, userType, score = 0, endDate = null) {
  this.isTrending = !this.isTrending;
  
  if (this.isTrending) {
    this.trendingStartDate = new Date();
    this.trendingEndDate = endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    this.trendingBy = userId;
    this.trendingByType = userType;
    this.trendingScore = score;
  } else {
    this.trendingStartDate = null;
    this.trendingEndDate = null;
    this.trendingBy = null;
    this.trendingByType = null;
    this.trendingScore = 0;
  }
  
  return this.save();
};

module.exports = mongoose.model("AICourse", aiCourseSchema);



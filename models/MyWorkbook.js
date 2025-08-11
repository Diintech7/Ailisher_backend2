// models/MyWorkbook.js
const mongoose = require('mongoose');

const MyWorkbookSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MobileUser',
    required: true,
    index: true
  },
  workbookId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Workbook',
    required: true,
    index: true
  },
  clientId: {
    type: String,
    required: true,
    index: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  lastAccessedAt: {
    type: Date,
    default: Date.now
  },
  personalNote: {
    type: String,
    maxlength: [500, 'Personal note cannot be more than 500 characters'],
    default: ''
  },
  priority: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for efficient queries
MyWorkbookSchema.index({ userId: 1, clientId: 1 });
MyWorkbookSchema.index({ userId: 1, workbookId: 1 }, { unique: true }); // Prevent duplicates
MyWorkbookSchema.index({ clientId: 1, addedAt: -1 });

// Virtual populate for workbook details
MyWorkbookSchema.virtual('workbook', {
  ref: 'Workbook',
  localField: 'workbookId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for user details
MyWorkbookSchema.virtual('user', {
  ref: 'MobileUser',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Static methods
MyWorkbookSchema.statics.isWorkbookSavedByUser = async function(userId, workbookId) {
  console.log("model",userId, workbookId);

  const savedWorkbook = await this.findOne({ userId, workbookId });
  return !!savedWorkbook;
};

MyWorkbookSchema.statics.getUserSavedWorkbooks = function(userId, clientId, options = {}) {
  const {
    limit = null,
    skip = 0,
    sortBy = 'addedAt',
    sortOrder = -1,
    populate = true
  } = options;

  let query = this.find({ userId, clientId });
  
  if (populate) {
    query = query.populate({
      path: 'workbookId',
      select: 'title author publisher description coverImage rating ratingCount mainCategory subCategory exam paper subject tags viewCount createdAt',
      populate: {
        path: 'user',
        select: 'name email userId'
      }
    });
  }
  
  // Sorting
  const sortObj = {};
  sortObj[sortBy] = sortOrder;
  query = query.sort(sortObj);
  
  // Pagination
  if (skip > 0) query = query.skip(skip);
  if (limit) query = query.limit(limit);
  
  return query;
};

MyWorkbookSchema.statics.getUserSavedWorkbooksCount = function(userId, clientId) {
  return this.countDocuments({ userId, clientId });
};

MyWorkbookSchema.statics.removeUserWorkbook = function(userId, workbookId) {
  return this.findOneAndDelete({ userId, workbookId });
};

// Instance methods
MyWorkbookSchema.methods.updateLastAccessed = function() {
  this.lastAccessedAt = new Date();
  return this.save();
};

MyWorkbookSchema.methods.updatePersonalNote = function(note) {
  this.personalNote = note || '';
  return this.save();
};

MyWorkbookSchema.methods.updatePriority = function(priority) {
  this.priority = priority || 0;
  return this.save();
};

// Pre-save middleware
MyWorkbookSchema.pre('save', async function(next) {
  if (this.isNew) {
    this.lastAccessedAt = this.addedAt;
  }
  next();
});

// Pre-find middleware to populate workbook details by default
MyWorkbookSchema.pre(/^find/, function(next) {
  // Only populate if not explicitly disabled
  if (!this.getOptions().skipPopulate) {
    this.populate({
      path: 'workbookId',
      select: 'title author publisher description coverImageKey coverImageUrl rating ratingCount mainCategory subCategory exam paper subject tags viewCount createdAt'
    });
  }
  next();
});

module.exports = mongoose.model('MyWorkbook', MyWorkbookSchema); 
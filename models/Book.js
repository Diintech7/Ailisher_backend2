// models/Book.js - Enhanced with exam, paper, subject fields and complete category system
const mongoose = require('mongoose');

const BookSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please add a title'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Please add a description'],
    maxlength: [1000, 'Description cannot be more than 1000 characters']
  },
  author: {
    type: String,
    required: [true, 'Please add an author'],
    trim: true,
    maxlength: [100, 'Author name cannot be more than 100 characters']
  },
  publisher: {
    type: String,
    required: [true, 'Please add a publisher'],
    trim: true,
    maxlength: [100, 'Publisher name cannot be more than 100 characters']
  },
  language: {
    type: String,
    required: [true, 'Please select a language'],
    enum: ['Hindi', 'English', 'Bengali', 'Telugu', 'Marathi', 'Tamil', 'Gujarati', 'Urdu', 'Kannada', 'Odia', 'Malayalam', 'Punjabi', 'Assamese', 'Other'],
    default: 'English'
  },
  rating: {
    type: Number,
    min: [0, 'Rating cannot be less than 0'],
    max: [5, 'Rating cannot be more than 5'],
    default: 0,
    set: function(val) {
      return Math.round(val * 10) / 10; // Round to 1 decimal place
    }
  },
  ratingCount: {
    type: Number,
    default: 0,
    min: [0, 'Rating count cannot be negative']
  },
  conversations: {
    type: [String],
    default: []
  },
  users: {
    type: [String],
    default: []
  },
  summary: {
    type: String,
    default: '',
    maxlength: [500, 'Summary cannot be more than 500 characters']
  },
  coverImage: {
    type: String,
    default: ''
  },
  coverImageKey: {
    type: String,
    default: ''
  },
  coverImageUrl: {
    type: String,
    default: ''
  },
  // Enhanced category system
  mainCategory: {
    type: String,
    required: [true, 'Please select a main category'],
    // enum: ['Civil Services', 'SSC', 'Defense', 'Teacher', 'Law', 'CA', 'CMA', 'CS', 'NCERT', 'Other'],
    default: 'Other'
  },
  subCategory: {
    type: String,
    required: [true, 'Please select a subcategory'],
    // enum: [
    //   // Civil Services
    //   'UPSC(IAS)', 'BPSC', 'UPPCS', 'JPSC', 'RPSC', 'MPPCS',
    //   // SSC
    //   'SSC-CGL', 'SSC-CHSL', 'SSC-GD',
    //   // Defense
    //   'NDA', 'CDS', 'AFCAT',
    //   // Teacher
    //   'DSSSB', 'CTET', 'UPTET', 'Bihar-TET',
    //   // Law
    //   'CLAT', 'DU-LLB', 'JUDICIARY',
    //   // CA
    //   'CA-Foundation', 'CA-Inter', 'CA-Final',
    //   // CMA
    //   'CMA-Foundation', 'CMA-Inter', 'CMA-Final',
    //   // CS
    //   'CS-Executive', 'CS-Professional',
    //   // NCERT
    //   '1st CLASS', '2nd CLASS', '3rd CLASS', '4th CLASS', '5th CLASS', '6th CLASS',
    //   '7th CLASS', '8th CLASS', '9th CLASS', '10th CLASS', '11th CLASS', '12th CLASS',
    //   // Other
    //   'Other'
    // ],
    default: 'Other'
  },
  customSubCategory: {
    type: String,
    trim: true,
    maxlength: [50, 'Custom subcategory cannot be more than 50 characters'],
  },
  
  // NEW FIELDS: Exam, Paper, Subject
  exam: {
    type: String,
    trim: true,
    maxlength: [100, 'Exam name cannot be more than 100 characters'],
    default: '',
    index: true
  },
  paper: {
    type: String,
    trim: true,
    maxlength: [100, 'Paper name cannot be more than 100 characters'],
    default: '',
    index: true
  },
  subject: {
    type: String,
    trim: true,
    maxlength: [100, 'Subject name cannot be more than 100 characters'],
    default: '',
    index: true
  },
  
  tags: [{
    type: String,
    trim: true,
    maxlength: [30, 'Tag cannot be more than 30 characters']
  }],
  isEnabled:{
    type:Boolean,
    default:true
  },
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
  
  // Category Order functionality
  categoryOrder: {
    type: Number,
    default: 0,
    index: true
  },
  categoryOrderBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'categoryOrderByType',
    default: null
  },
  categoryOrderByType: {
    type: String,
    enum: ['User', 'MobileUser'],
    default: null
  },
  categoryOrderedAt: {
    type: Date,
    default: null
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
  
  // Analytics for trending calculation
  viewCount: {
    type: Number,
    default: 0,
    index: true
  },
  downloadCount: {
    type: Number,
    default: 0,
    index: true
  },
  shareCount: {
    type: Number,
    default: 0,
    index: true
  },
  lastViewedAt: {
    type: Date,
    default: null
  },
  
  // Client and user info
  clientId: {
    type: String,
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'userType',
    required: true
  },
  userType: {
    type: String,
    required: true,
    enum: ['User', 'MobileUser']
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  isVideoAvailabel:{
    type:Boolean,
    default:false
  },
  // PDF Embedding Status
  embedded: {
    type: Boolean,
    default: false,
    index: true
  },
  embeddedAt: {
    type: Date,
    default: null
  },
  embeddedBy: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'embeddedByType',
    default: null
  },
  embeddedByType: {
    type: String,
    enum: ['User', 'MobileUser'],
    default: null
  },
  embeddingStats: {
    totalFiles: { type: Number, default: 0 },
    totalChunks: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: null },
    collectionName: { type: String, default: '' }
  },
  aiGuidelines: {
    message: {
      type: String,
      default: ''
    },
    prompt: {
      type: String,
      default: ''
    },
    FAQs: [
      {
        question: { type: String, default: '' }
      }
    ]
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Enhanced indexes including new fields
BookSchema.index({ clientId: 1, mainCategory: 1, categoryOrder: 1 });
BookSchema.index({ clientId: 1, subCategory: 1, categoryOrder: 1 });
BookSchema.index({ clientId: 1, isHighlighted: 1, highlightOrder: 1 });
BookSchema.index({ clientId: 1, isTrending: 1, trendingScore: -1 });
BookSchema.index({ clientId: 1, viewCount: -1 });
BookSchema.index({ clientId: 1, rating: -1 });
BookSchema.index({ clientId: 1, createdAt: -1 });
BookSchema.index({ trendingStartDate: 1, trendingEndDate: 1 });
// New indexes for exam, paper, subject
BookSchema.index({ clientId: 1, exam: 1 });
BookSchema.index({ clientId: 1, paper: 1 });
BookSchema.index({ clientId: 1, subject: 1 });
BookSchema.index({ clientId: 1, exam: 1, paper: 1 });
BookSchema.index({ clientId: 1, exam: 1, subject: 1 });
BookSchema.index({ clientId: 1, paper: 1, subject: 1 });
BookSchema.index({ clientId: 1, exam: 1, paper: 1, subject: 1 });
// New indexes for embedded status
BookSchema.index({ clientId: 1, embedded: 1 });
BookSchema.index({ embedded: 1, embeddedAt: -1 });
BookSchema.index({ clientId: 1, embedded: 1, embeddedAt: -1 });

// Enhanced category mappings
const CATEGORY_MAPPINGS = {
  'Civil Services': ['UPSC(IAS)', 'BPSC', 'UPPCS', 'JPSC', 'RPSC', 'MPPCS'],
  'SSC': ['SSC-CGL', 'SSC-CHSL', 'SSC-GD'],
  'Defense': ['NDA', 'CDS', 'AFCAT'],
  'Teacher': ['DSSSB', 'CTET', 'UPTET', 'Bihar-TET'],
  'Law': ['CLAT', 'DU-LLB', 'JUDICIARY'],
  'CA': ['CA-Foundation', 'CA-Inter', 'CA-Final'],
  'CMA': ['CMA-Foundation', 'CMA-Inter', 'CMA-Final'],
  'CS': ['CS-Executive', 'CS-Professional'],
  'NCERT': ['1st CLASS', '2nd CLASS', '3rd CLASS', '4th CLASS', '5th CLASS', '6th CLASS', 
           '7th CLASS', '8th CLASS', '9th CLASS', '10th CLASS', '11th CLASS', '12th CLASS'],
  'Other': ['Other']
};

// Common exam mappings for better organization
const EXAM_MAPPINGS = {
  'Civil Services': {
    'UPSC(IAS)': ['Prelims', 'Mains', 'Interview', 'Combined'],
    'BPSC': ['Prelims', 'Mains', 'Interview', 'Combined'],
    'UPPCS': ['Prelims', 'Mains', 'Interview', 'Combined'],
    'JPSC': ['Prelims', 'Mains', 'Interview', 'Combined'],
    'RPSC': ['Prelims', 'Mains', 'Interview', 'Combined'],
    'MPPCS': ['Prelims', 'Mains', 'Interview', 'Combined']
  },
  'SSC': {
    'SSC-CGL': ['Tier-1', 'Tier-2', 'Tier-3', 'Tier-4'],
    'SSC-CHSL': ['Tier-1', 'Tier-2', 'Tier-3'],
    'SSC-GD': ['Computer Based Test', 'Physical Test', 'Medical Test']
  },
  'Defense': {
    'NDA': ['Mathematics', 'General Ability Test', 'SSB Interview'],
    'CDS': ['English', 'General Knowledge', 'Mathematics'],
    'AFCAT': ['General Awareness', 'Verbal Ability', 'Numerical Ability', 'Reasoning']
  },
  'Teacher': {
    'DSSSB': ['Paper-1', 'Paper-2', 'Subject Specific'],
    'CTET': ['Paper-1', 'Paper-2'],
    'UPTET': ['Paper-1', 'Paper-2'],
    'Bihar-TET': ['Paper-1', 'Paper-2']
  },
  'Law': {
    'CLAT': ['English', 'Current Affairs', 'Legal Reasoning', 'Logical Reasoning', 'Quantitative Techniques'],
    'DU-LLB': ['English', 'General Knowledge', 'Legal Aptitude', 'Analytical Abilities'],
    'JUDICIARY': ['Preliminary', 'Mains', 'Interview']
  },
  'CA': {
    'CA-Foundation': ['Principles of Accounting', 'Business Laws', 'Business Mathematics', 'Business Economics'],
    'CA-Inter': ['Accounting', 'Corporate Laws', 'Cost Accounting', 'Taxation', 'Advanced Accounting', 'Auditing', 'EIS & SM', 'FM & Economics'],
    'CA-Final': ['Financial Reporting', 'Strategic FM', 'Advanced Auditing', 'Corporate Laws', 'Strategic Management', 'Information Systems', 'Direct Tax', 'Indirect Tax']
  },
  'CMA': {
    'CMA-Foundation': ['Fundamentals of Accounting', 'Fundamentals of Business Mathematics', 'Fundamentals of Business Economics', 'Fundamentals of Business Laws'],
    'CMA-Inter': ['Financial Accounting', 'Corporate Laws', 'Direct Taxation', 'Cost Accounting', 'Operations Management', 'Strategic Management'],
    'CMA-Final': ['Strategic Financial Management', 'Strategic Cost Management', 'Strategic Performance Management', 'Corporate Laws', 'Strategic Management']
  },
  'CS': {
    'CS-Executive': ['Company Law', 'Cost Accounting', 'Tax Laws', 'Corporate Restructuring', 'Economic Laws', 'Industrial Laws', 'Securities Laws', 'Capital Markets'],
    'CS-Professional': ['Corporate Governance', 'Advanced Tax Laws', 'Drafting & Conveyancing', 'Foreign Exchange Management', 'Human Resource Management', 'Information Technology', 'Intellectual Property Rights', 'International Business Laws']
  }
};

// Common subjects for better categorization
const SUBJECT_MAPPINGS = {
  'General': ['History', 'Geography', 'Polity', 'Economics', 'Science', 'Current Affairs', 'General Knowledge', 'English', 'Hindi', 'Mathematics', 'Reasoning', 'Computer'],
  'Civil Services': ['Ancient History', 'Medieval History', 'Modern History', 'Art & Culture', 'Geography', 'Indian Polity', 'Economics', 'Science & Technology', 'Environment', 'Current Affairs', 'Ethics', 'Essay', 'Optional Subject'],
  'Law': ['Constitutional Law', 'Criminal Law', 'Civil Law', 'Corporate Law', 'International Law', 'Legal Reasoning', 'Legal Aptitude', 'Current Legal Affairs'],
  'Accounting': ['Financial Accounting', 'Cost Accounting', 'Management Accounting', 'Auditing', 'Taxation', 'Corporate Accounting', 'Advanced Accounting'],
  'NCERT': ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi', 'Environmental Studies', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Political Science', 'Economics']
};

// Pre-save middleware
BookSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Clean and validate new fields
  if (this.exam) {
    this.exam = this.exam.trim();
  }
  if (this.paper) {
    this.paper = this.paper.trim();
  }
  if (this.subject) {
    this.subject = this.subject.trim();
  }
  
  // Handle highlighting logic
  if (this.isModified('isHighlighted')) {
    if (this.isHighlighted && !this.highlightedAt) {
      this.highlightedAt = new Date();
    } else if (!this.isHighlighted) {
      this.highlightedAt = null;
      this.highlightedBy = null;
      this.highlightedByType = null;
      this.highlightOrder = 0;
      this.highlightNote = '';
    }
  }
  
  // Handle category ordering
  if (this.isModified('categoryOrder') && this.categoryOrder > 0) {
    if (!this.categoryOrderedAt) {
      this.categoryOrderedAt = new Date();
    }
  } else if (this.categoryOrder === 0) {
    this.categoryOrderedAt = null;
    this.categoryOrderBy = null;
    this.categoryOrderByType = null;
  }
  
  // Handle trending logic
  if (this.isModified('isTrending')) {
    if (this.isTrending && !this.trendingStartDate) {
      this.trendingStartDate = new Date();
      if (!this.trendingEndDate) {
        // Default trending period of 30 days
        this.trendingEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
    } else if (!this.isTrending) {
      this.trendingStartDate = null;
      this.trendingEndDate = null;
      this.trendingBy = null;
      this.trendingByType = null;
      this.trendingScore = 0;
    }
  }
  
  // Validate category-subcategory relationship
  const validSubCategories = CATEGORY_MAPPINGS[this.mainCategory] || [];
  if (!validSubCategories.includes(this.subCategory) && this.subCategory !== 'Other') {
    console.log(`Warning: Subcategory '${this.subCategory}' is not valid for main category '${this.mainCategory}'`);
  }
  
  // Clear customSubCategory if subCategory is not 'Other'
  if (this.subCategory !== 'Other') {
    this.customSubCategory = undefined;
  }
  
  // Clean up tags
  if (this.tags && this.tags.length > 0) {
    this.tags = [...new Set(this.tags.filter(tag => tag && tag.trim().length > 0))];
  }
  
  next();
});

// Static methods
BookSchema.statics.getCategoryMappings = function() {
  return CATEGORY_MAPPINGS;
};

BookSchema.statics.getValidSubCategories = function(mainCategory) {
  return CATEGORY_MAPPINGS[mainCategory] || [];
};

// NEW: Get exam mappings
BookSchema.statics.getExamMappings = function() {
  return EXAM_MAPPINGS;
};

// NEW: Get papers for exam
BookSchema.statics.getPapersForExam = function(mainCategory, subCategory) {
  if (EXAM_MAPPINGS[mainCategory] && EXAM_MAPPINGS[mainCategory][subCategory]) {
    return EXAM_MAPPINGS[mainCategory][subCategory];
  }
  return [];
};

// NEW: Get subject mappings
BookSchema.statics.getSubjectMappings = function() {
  return SUBJECT_MAPPINGS;
};

// NEW: Get subjects for category
BookSchema.statics.getSubjectsForCategory = function(mainCategory) {
  return SUBJECT_MAPPINGS[mainCategory] || SUBJECT_MAPPINGS['General'] || [];
};

// Get highlighted books
BookSchema.statics.getHighlightedBooks = function(clientId, limit = null) {
  const query = this.find({ 
    clientId: clientId, 
    isHighlighted: true 
  })
  .populate('user', 'name email userId')
  .populate('highlightedBy', 'name email userId')
  .sort({ highlightOrder: 1, highlightedAt: -1 });
  
  if (limit) query.limit(limit);
  return query;
};

// Get trending books
BookSchema.statics.getTrendingBooks = function(clientId, limit = null) {
  const now = new Date();
  const query = this.find({ 
    clientId: clientId, 
    isTrending: true,
    trendingStartDate: { $lte: now },
    $or: [
      { trendingEndDate: { $gte: now } },
      { trendingEndDate: null }
    ]
  })
  .populate('user', 'name email userId')
  .populate('trendingBy', 'name email userId')
  .sort({ trendingScore: -1, viewCount: -1, createdAt: -1 });
  
  if (limit) query.limit(limit);
  return query;
};

// Get books by category with order
BookSchema.statics.getBooksByCategory = function(clientId, mainCategory, subCategory = null, limit = null) {
  const filter = { clientId: clientId, mainCategory: mainCategory };
  if (subCategory) filter.subCategory = subCategory;
  
  const query = this.find(filter)
    .populate('user', 'name email userId')
    .sort({ categoryOrder: 1, createdAt: -1 });
  
  if (limit) query.limit(limit);
  return query;
};

// NEW: Get books by exam
BookSchema.statics.getBooksByExam = function(clientId, exam, paper = null, subject = null, limit = null) {
  const filter = { clientId: clientId, exam: exam };
  if (paper) filter.paper = paper;
  if (subject) filter.subject = subject;
  
  const query = this.find(filter)
    .populate('user', 'name email userId')
    .sort({ createdAt: -1 });
  
  if (limit) query.limit(limit);
  return query;
};

// NEW: Get books by subject
BookSchema.statics.getBooksBySubject = function(clientId, subject, limit = null) {
  const query = this.find({ clientId: clientId, subject: subject })
    .populate('user', 'name email userId')
    .sort({ createdAt: -1 });
  
  if (limit) query.limit(limit);
  return query;
};

// NEW: Get books by embedding status
BookSchema.statics.getEmbeddedBooks = function(clientId, limit = null) {
  const query = this.find({ 
    clientId: clientId, 
    embedded: true 
  })
  .populate('user', 'name email userId')
  .populate('embeddedBy', 'name email userId')
  .sort({ embeddedAt: -1, createdAt: -1 });
  
  if (limit) query.limit(limit);
  return query;
};

BookSchema.statics.getNonEmbeddedBooks = function(clientId, limit = null) {
  const query = this.find({ 
    clientId: clientId, 
    embedded: false 
  })
  .populate('user', 'name email userId')
  .sort({ createdAt: -1 });
  
  if (limit) query.limit(limit);
  return query;
};

BookSchema.statics.getEmbeddingStats = function(clientId) {
  return this.aggregate([
    { $match: { clientId: clientId } },
    {
      $group: {
        _id: null,
        totalBooks: { $sum: 1 },
        embeddedBooks: { $sum: { $cond: ['$embedded', 1, 0] } },
        nonEmbeddedBooks: { $sum: { $cond: ['$embedded', 0, 1] } },
        totalChunks: { $sum: '$embeddingStats.totalChunks' },
        totalTokens: { $sum: '$embeddingStats.totalTokens' },
        totalFiles: { $sum: '$embeddingStats.totalFiles' }
      }
    }
  ]);
};

// Instance methods
BookSchema.methods.updateRating = function(newRating) {
  const totalRating = (this.rating * this.ratingCount) + newRating;
  this.ratingCount += 1;
  this.rating = totalRating / this.ratingCount;
  return this.save();
};

BookSchema.methods.toggleHighlight = function(userId, userType, note = '', order = 0) {
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

BookSchema.methods.setCategoryOrder = function(userId, userType, order) {
  this.categoryOrder = order;
  this.categoryOrderBy = userId;
  this.categoryOrderByType = userType;
  this.categoryOrderedAt = new Date();
  return this.save();
};

BookSchema.methods.toggleTrending = function(userId, userType, score = 0, endDate = null) {
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

BookSchema.methods.incrementView = function() {
  this.viewCount += 1;
  this.lastViewedAt = new Date();
  
  // Auto-calculate trending score based on recent activity
  const daysSinceCreated = (Date.now() - this.createdAt) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.max(0, 30 - daysSinceCreated) / 30; // Higher score for newer books
  const engagementScore = (this.viewCount * 1) + (this.downloadCount * 3) + (this.shareCount * 5);
  this.trendingScore = Math.round(engagementScore * recencyFactor);
  
  return this.save();
};

BookSchema.methods.incrementDownload = function() {
  this.downloadCount += 1;
  return this.incrementView(); // Also count as a view
};

BookSchema.methods.incrementShare = function() {
  this.shareCount += 1;
  return this.incrementView(); // Also count as a view
};

// NEW: PDF Embedding Management Methods
BookSchema.methods.markAsEmbedded = function(userId, userType, stats = {}) {
  this.embedded = true;
  this.embeddedAt = new Date();
  this.embeddedBy = userId;
  this.embeddedByType = userType;
  
  // Update embedding statistics
  if (stats.totalFiles) this.embeddingStats.totalFiles = stats.totalFiles;
  if (stats.totalChunks) this.embeddingStats.totalChunks = stats.totalChunks;
  if (stats.totalTokens) this.embeddingStats.totalTokens = stats.totalTokens;
  if (stats.collectionName) this.embeddingStats.collectionName = stats.collectionName;
  this.embeddingStats.lastUpdated = new Date();
  
  return this.save();
};

BookSchema.methods.markAsNotEmbedded = function() {
  this.embedded = false;
  this.embeddedAt = null;
  this.embeddedBy = null;
  this.embeddedByType = null;
  
  // Reset embedding statistics
  this.embeddingStats = {
    totalFiles: 0,
    totalChunks: 0,
    totalTokens: 0,
    lastUpdated: null,
    collectionName: ''
  };
  
  return this.save();
};

BookSchema.methods.updateEmbeddingStats = function(stats) {
  if (stats.totalFiles !== undefined) this.embeddingStats.totalFiles = stats.totalFiles;
  if (stats.totalChunks !== undefined) this.embeddingStats.totalChunks = stats.totalChunks;
  if (stats.totalTokens !== undefined) this.embeddingStats.totalTokens = stats.totalTokens;
  if (stats.collectionName !== undefined) this.embeddingStats.collectionName = stats.collectionName;
  this.embeddingStats.lastUpdated = new Date();
  
  return this.save();
};

// Virtual fields
BookSchema.virtual('effectiveSubCategory').get(function() {
  return this.subCategory === 'Other' ? this.customSubCategory : this.subCategory;
});

BookSchema.virtual('fullCategory').get(function() {
  const effectiveSub = this.subCategory === 'Other' ? this.customSubCategory : this.subCategory;
  return `${this.mainCategory} > ${effectiveSub}`;
});

// NEW: Virtual for full classification
BookSchema.virtual('fullClassification').get(function() {
  let classification = this.fullCategory;
  if (this.exam) classification += ` > ${this.exam}`;
  if (this.paper) classification += ` > ${this.paper}`;
  if (this.subject) classification += ` > ${this.subject}`;
  return classification;
});

BookSchema.virtual('isCurrentlyTrending').get(function() {
  if (!this.isTrending) return false;
  const now = new Date();
  return this.trendingStartDate <= now && (!this.trendingEndDate || this.trendingEndDate >= now);
});

// Ensure virtual fields are serialized
BookSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Book', BookSchema);
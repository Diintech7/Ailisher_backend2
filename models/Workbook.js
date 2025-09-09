const mongoose = require('mongoose');

const WorkbookSchema = new mongoose.Schema({
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
      return Math.round(val * 10) / 10;
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

  coverImageKey: {
    type: String,
    default: ''
  },
  coverImageUrl: {
    type: String,
    default: ''
  },
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
    //   'UPSC(IAS)', 'BPSC', 'UPPCS', 'JPSC', 'RPSC', 'MPPCS',
    //   'SSC-CGL', 'SSC-CHSL', 'SSC-GD',
    //   'NDA', 'CDS', 'AFCAT',
    //   'DSSSB', 'CTET', 'UPTET', 'Bihar-TET',
    //   'CLAT', 'DU-LLB', 'JUDICIARY',
    //   'CA-Foundation', 'CA-Inter', 'CA-Final',
    //   'CMA-Foundation', 'CMA-Inter', 'CMA-Final',
    //   'CS-Executive', 'CS-Professional',
    //   '1st CLASS', '2nd CLASS', '3rd CLASS', '4th CLASS', '5th CLASS', '6th CLASS',
    //   '7th CLASS', '8th CLASS', '9th CLASS', '10th CLASS', '11th CLASS', '12th CLASS',
    //   'Other'
    // ],
    default: 'Other'
  },
  customSubCategory: {
    type: String,
    trim: true,
    maxlength: [50, 'Custom subcategory cannot be more than 50 characters'],
  },
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
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
WorkbookSchema.index({ clientId: 1, mainCategory: 1, categoryOrder: 1 });
WorkbookSchema.index({ clientId: 1, subCategory: 1, categoryOrder: 1 });
WorkbookSchema.index({ clientId: 1, isHighlighted: 1, highlightOrder: 1 });
WorkbookSchema.index({ clientId: 1, isTrending: 1, trendingScore: -1 });
WorkbookSchema.index({ clientId: 1, viewCount: -1 });
WorkbookSchema.index({ clientId: 1, rating: -1 });
WorkbookSchema.index({ clientId: 1, createdAt: -1 });
WorkbookSchema.index({ trendingStartDate: 1, trendingEndDate: 1 });
WorkbookSchema.index({ clientId: 1, exam: 1 });
WorkbookSchema.index({ clientId: 1, paper: 1 });
WorkbookSchema.index({ clientId: 1, subject: 1 });
WorkbookSchema.index({ clientId: 1, exam: 1, paper: 1 });
WorkbookSchema.index({ clientId: 1, exam: 1, subject: 1 });
WorkbookSchema.index({ clientId: 1, paper: 1, subject: 1 });
WorkbookSchema.index({ clientId: 1, exam: 1, paper: 1, subject: 1 });

// Category, exam, and subject mappings (copied from Book)
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
const SUBJECT_MAPPINGS = {
  'General': ['History', 'Geography', 'Polity', 'Economics', 'Science', 'Current Affairs', 'General Knowledge', 'English', 'Hindi', 'Mathematics', 'Reasoning', 'Computer'],
  'Civil Services': ['Ancient History', 'Medieval History', 'Modern History', 'Art & Culture', 'Geography', 'Indian Polity', 'Economics', 'Science & Technology', 'Environment', 'Current Affairs', 'Ethics', 'Essay', 'Optional Subject'],
  'Law': ['Constitutional Law', 'Criminal Law', 'Civil Law', 'Corporate Law', 'International Law', 'Legal Reasoning', 'Legal Aptitude', 'Current Legal Affairs'],
  'Accounting': ['Financial Accounting', 'Cost Accounting', 'Management Accounting', 'Auditing', 'Taxation', 'Corporate Accounting', 'Advanced Accounting'],
  'NCERT': ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi', 'Environmental Studies', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Political Science', 'Economics']
};

// Pre-save middleware
WorkbookSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  if (this.exam) this.exam = this.exam.trim();
  if (this.paper) this.paper = this.paper.trim();
  if (this.subject) this.subject = this.subject.trim();
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
  if (this.isModified('categoryOrder') && this.categoryOrder > 0) {
    if (!this.categoryOrderedAt) {
      this.categoryOrderedAt = new Date();
    }
  } else if (this.categoryOrder === 0) {
    this.categoryOrderedAt = null;
    this.categoryOrderBy = null;
    this.categoryOrderByType = null;
  }
  if (this.isModified('isTrending')) {
    if (this.isTrending && !this.trendingStartDate) {
      this.trendingStartDate = new Date();
      if (!this.trendingEndDate) {
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
  const validSubCategories = CATEGORY_MAPPINGS[this.mainCategory] || [];
  if (!validSubCategories.includes(this.subCategory) && this.subCategory !== 'Other') {
    console.log(`Warning: Subcategory '${this.subCategory}' is not valid for main category '${this.mainCategory}'`);
  }
  if (this.subCategory !== 'Other') {
    this.customSubCategory = undefined;
  }
  if (this.tags && this.tags.length > 0) {
    this.tags = [...new Set(this.tags.filter(tag => tag && tag.trim().length > 0))];
  }
  next();
});

// Static methods
WorkbookSchema.statics.getCategoryMappings = function() {
  return CATEGORY_MAPPINGS;
};
WorkbookSchema.statics.getValidSubCategories = function(mainCategory) {
  return CATEGORY_MAPPINGS[mainCategory] || [];
};
WorkbookSchema.statics.getExamMappings = function() {
  return EXAM_MAPPINGS;
};
WorkbookSchema.statics.getPapersForExam = function(mainCategory, subCategory) {
  if (EXAM_MAPPINGS[mainCategory] && EXAM_MAPPINGS[mainCategory][subCategory]) {
    return EXAM_MAPPINGS[mainCategory][subCategory];
  }
  return [];
};
WorkbookSchema.statics.getSubjectMappings = function() {
  return SUBJECT_MAPPINGS;
};
WorkbookSchema.statics.getSubjectsForCategory = function(mainCategory) {
  return SUBJECT_MAPPINGS[mainCategory] || SUBJECT_MAPPINGS['General'] || [];
};
WorkbookSchema.statics.getHighlightedWorkbooks = function(clientId, limit = null) {
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
WorkbookSchema.statics.getTrendingWorkbooks = function(clientId, limit = null) {
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
WorkbookSchema.statics.getWorkbooksByCategory = function(clientId, mainCategory, subCategory = null, limit = null) {
  const filter = { clientId: clientId, mainCategory: mainCategory };
  if (subCategory) filter.subCategory = subCategory;
  const query = this.find(filter)
    .populate('user', 'name email userId')
    .sort({ categoryOrder: 1, createdAt: -1 });
  if (limit) query.limit(limit);
  return query;
};
WorkbookSchema.statics.getWorkbooksByExam = function(clientId, exam, paper = null, subject = null, limit = null) {
  const filter = { clientId: clientId, exam: exam };
  if (paper) filter.paper = paper;
  if (subject) filter.subject = subject;
  const query = this.find(filter)
    .populate('user', 'name email userId')
    .sort({ createdAt: -1 });
  if (limit) query.limit(limit);
  return query;
};
WorkbookSchema.statics.getWorkbooksBySubject = function(clientId, subject, limit = null) {
  const query = this.find({ clientId: clientId, subject: subject })
    .populate('user', 'name email userId')
    .sort({ createdAt: -1 });
  if (limit) query.limit(limit);
  return query;
};
// Instance methods
WorkbookSchema.methods.updateRating = function(newRating) {
  const totalRating = (this.rating * this.ratingCount) + newRating;
  this.ratingCount += 1;
  this.rating = totalRating / this.ratingCount;
  return this.save();
};
WorkbookSchema.methods.toggleHighlight = function(userId, userType, note = '', order = 0) {
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
WorkbookSchema.methods.setCategoryOrder = function(userId, userType, order) {
  this.categoryOrder = order;
  this.categoryOrderBy = userId;
  this.categoryOrderByType = userType;
  this.categoryOrderedAt = new Date();
  return this.save();
};
WorkbookSchema.methods.toggleTrending = function(userId, userType, score = 0, endDate = null) {
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
WorkbookSchema.methods.incrementView = function() {
  this.viewCount += 1;
  this.lastViewedAt = new Date();
  const daysSinceCreated = (Date.now() - this.createdAt) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.max(0, 30 - daysSinceCreated) / 30;
  const engagementScore = (this.viewCount * 1) + (this.downloadCount * 3) + (this.shareCount * 5);
  this.trendingScore = Math.round(engagementScore * recencyFactor);
  return this.save();
};
WorkbookSchema.methods.incrementDownload = function() {
  this.downloadCount += 1;
  return this.incrementView();
};
WorkbookSchema.methods.incrementShare = function() {
  this.shareCount += 1;
  return this.incrementView();
};
// Virtual fields
WorkbookSchema.virtual('effectiveSubCategory').get(function() {
  return this.subCategory === 'Other' ? this.customSubCategory : this.subCategory;
});
WorkbookSchema.virtual('fullCategory').get(function() {
  const effectiveSub = this.subCategory === 'Other' ? this.customSubCategory : this.subCategory;
  return `${this.mainCategory} > ${effectiveSub}`;
});
WorkbookSchema.virtual('fullClassification').get(function() {
  let classification = this.fullCategory;
  if (this.exam) classification += ` > ${this.exam}`;
  if (this.paper) classification += ` > ${this.paper}`;
  if (this.subject) classification += ` > ${this.subject}`;
  return classification;
});
WorkbookSchema.virtual('isCurrentlyTrending').get(function() {
  if (!this.isTrending) return false;
  const now = new Date();
  return this.trendingStartDate <= now && (!this.trendingEndDate || this.trendingEndDate >= now);
});
WorkbookSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Workbook', WorkbookSchema); 
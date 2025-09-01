// models/UserProfile.js
const mongoose = require('mongoose');

const UserProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MobileUser',
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: [100, 'Name cannot be more than 100 characters']
  },
  age: {
    type: String,
    enum: ['<15', '15-18', '19-25', '26-31', '32-40', '40+']
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other']
  },
  exams: [{
    type: String,
    enum: ['UPSC','JPSC','MPPCS','RAS', 'CA', 'CMA', 'CS', 'ACCA', 'CFA', 'FRM', 'NEET', 'JEE', 'GATE', 'CAT', 'GMAT', 'GRE', 'IELTS', 'TOEFL', 'NET/JRF', 'BPSC', 'UPPCS', 'NDA','SSC', 'Teacher', 'CLAT','Judiciary', 'Other']
  }],
  nativeLanguage: {
    type: String,
    enum: ['Hindi', 'English', 'Bengali', 'Telugu', 'Marathi', 'Tamil', 'Gujarati', 'Urdu', 'Kannada', 'Odia', 'Malayalam', 'Punjabi', 'Assamese', 'Other']
  },
  clientId: { // Changed from 'client' to 'clientId'
    type: String,
    required: true
    // No enum restriction - will validate against actual client IDs
  },
  isComplete: {
    type: Boolean,
    default: true
  },
  isEvaluator:{
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

// Update timestamp on save
UserProfileSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('UserProfile', UserProfileSchema);

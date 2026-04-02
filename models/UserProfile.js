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
    default: '',
    trim: true,
    maxlength: [100, 'Name cannot be more than 100 characters']
  },
  age: {
    type: String,
    default: ''
  },
  gender: {
    type: String,
    default: ''
  },
  exams: [{
    type: String
  }],
  nativeLanguage: {
    type: String,
    default: ''
  },
  city:{
    type:String,
    default:""
  },
  pincode:{
    type:String,
    default: ''
  },
  clientId: { // Changed from 'client' to 'clientId'
    type: String,
    default: ''
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

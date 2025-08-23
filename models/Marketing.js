// models/Marketing.js
const mongoose = require('mongoose');

const marketingSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  category: {
    type: String,
    required: true,
    enum: ['banner', 'carousel', 'popup', 'sidebar', 'hero', 'featured', 'promotion'],
    index: true
  },
  subcategory: {
    type: String,
    default: '',
    trim: true,
    maxlength: 50
  },
  imageKey: {
    type: String,
    required: true,
    trim: true
  },
  imageUrl: {
    type: String,
    trim: true
  },
  imageWidth: {
    type: Number,
    required: true,
    min: 1
  },
  imageHeight: {
    type: Number,
    required: true,
    min: 1
  },
  imageSize:{
    type: String,
    required: true,
    enum: ['1:1','9:16','16:9','4:3','3:4','3:2','2:3','4:5','5:4','5:12','12:5'],
    index: true
  },
  location: {
    type: String,
    default: '',
    enum:['top','middle','bottom'],
    index: true
  },
  route: {
    type: {
      type: String,
      enum: ['weblink','whatsapp','plans'],
      required: true
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  clientId: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Compound index for efficient querying
marketingSchema.index({ clientId: 1, category: 1, location: 1 });
marketingSchema.index({ clientId: 1, isActive: 1, category: 1 });

// Helper: map size label to aspect ratio
const SIZE_TO_RATIO = {
  '1:1': 1,
  '9:16': 9/16,
  '16:9': 16/9,
  '4:3': 4/3,
  '3:4': 3/4,
  '3:2': 3/2,
  '2:3': 2/3,
  '4:5': 4/5,
  '5:4': 5/4,
  '5:12': 5/12,
  '12:5': 12/5,
};

// Validation: ensure image dimensions roughly match selected size
marketingSchema.pre('validate', function(next) {
  try {
    if (this.imageWidth && this.imageHeight && this.imageSize) {
      const target = SIZE_TO_RATIO[this.imageSize];
      if (target) {
        const actual = this.imageWidth / this.imageHeight;
        const epsilon = 0.03; // 3% tolerance
        const within = Math.abs(actual - target) / target <= epsilon;
        if (!within) {
          return next(new Error(`Image dimensions ${this.imageWidth}x${this.imageHeight} do not match selected size ${this.imageSize}`));
        }
      }
    }

    // Route config validation
    if (this.route && this.route.type) {
      if (this.route.type === 'weblink') {
        const url = this.route.config && this.route.config.url;
        if (!url || !/^https?:\/\//i.test(url)) {
          return next(new Error('For route type "weblink", a valid http/https URL is required at route.config.url'));
        }
      }
      if (this.route.type === 'whatsapp') {
        const phone = this.route.config && this.route.config.phone;
        if (!phone || !/[0-9]{6,}/.test(String(phone))) {
          return next(new Error('For route type "whatsapp", a numeric phone is required at route.config.phone'));
        }
      }
    }

    return next();
  } catch (e) {
    return next(e);
  }
});

module.exports = mongoose.model('Marketing', marketingSchema);

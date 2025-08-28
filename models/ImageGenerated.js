const mongoose = require('mongoose');

const imageSchema = mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: String, required: true },
    prompt: { type: String, required: true },
    style: { type: String, default: 'realistic' },
    aspectRatio: { type: String, default: '9:16' },
    seed: { type: String, default: '5' },
    generatedImageUrl: { type: String },
    generatedImageKey: { type: String },
    status: { type: String, enum: ['pending', 'generating', 'completed', 'failed'], default: 'pending' },
    metadata: {
      model: String,
      apiProvider: String,
      generationTime: Number,
      imageSize: String,
      quality: String
    },
    tags: [String],
    isPublic: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Add indexes for better performance
imageSchema.index({ userId: 1, createdAt: -1 });
imageSchema.index({ clientId: 1, status: 1 });
imageSchema.index({ prompt: 'text' }); // For text search

module.exports = mongoose.model('ImageGenerated', imageSchema);
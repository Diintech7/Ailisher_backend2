const mongoose = require("mongoose");

const questionFileSchema = new mongoose.Schema(
  {
    // R2 object key (path in bucket)
    key: {
      type: String,
      required: true,
      trim: true,
      index: true,
      unique: true,
    },

    // Optional public or CDN URL if applicable (for private buckets, prefer signed URLs on demand)
    url: {
      type: String,
      trim: true,
    },

    contentType: {
      type: String,
      default: "text/plain; charset=utf-8",
      trim: true,
    },

    sizeBytes: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Source PDF references (if available)
    sourcePdfKey: {
      type: String,
      trim: true,
      index: true,
    },
    sourcePdfUrl: {
      type: String,
      trim: true,
    },
    sourcePdfName: {
      type: String,
      trim: true,
    },

    // Optional association to a QuestionBank
    questionBank: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "QuestionBank",
      index: true,
    },

    // Ownership / auditing
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Processing status
    status: {
      type: String,
      enum: ["ready", "failed"],
      default: "ready",
      index: true,
    },

    // Extraction params / metadata (engine, version, options)
    extractionParams: {
      type: mongoose.Schema.Types.Mixed,
    },

    // Lightweight labeling without storing content
    fileName: {
      type: String,
      trim: true,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
  },
  { timestamps: true }
);

questionFileSchema.index({ createdAt: -1 });

const QuestionFile = mongoose.model("QuestionFile", questionFileSchema);

module.exports = QuestionFile;

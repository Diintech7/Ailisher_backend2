const mongoose = require("mongoose")

const DataStoreItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Please add a name"],
    trim: true,
  },
  url: {
    type: String,
    required: [true, "Please add a file URL"],
    trim: true,
  },
  s3Key: {
    type: String,
    trim: true,
    default: null,
  },
  fileType: {
    type: String,
    default: "application/octet-stream",
  },
  // Additional metadata
  description: {
    type: String,
    default: "",
  },
  itemType: {
    type: String,
    enum: ["file", "url", "youtube", "website", "text", "image", "video", "pdf"],
    default: "file",
  },
  // Embedding status fields
  isEmbedded: {
    type: Boolean,
    default: false,
  },
  embeddingCount: {
    type: Number,
    default: 0,
  },
  embeddedAt: {
    type: Date,
    default: null,
  },
  // Reference to either a book, chapter, topic, or subtopic for AI Books
  book: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Book",
    default: null,
  },
  chapter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Chapter",
    default: null,
  },
  topic: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Topic",
    default: null,
  },
  subtopic: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SubTopic",
    default: null,
  },
  // References for AI Workbooks
  workbook: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Workbook",
    default: null,
  },
  workbookChapter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Chapter", // Using same Chapter model with parentType='workbook'
    default: null,
  },
  workbookTopic: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Topic", // Using same Topic model
    default: null,
  },
  workbookSubtopic: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SubTopic", // Using same SubTopic model
    default: null,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

module.exports = mongoose.model("DataStore", DataStoreItemSchema)

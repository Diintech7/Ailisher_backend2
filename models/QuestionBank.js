const mongoose = require("mongoose");

const questionBankSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    coverImageKey: {
      type: String,
    },
    coverImageUrl: {
      type: String,
    },
    category: {
      type: String,
    },
    subcategory: {
      type: String,
    },
    type: {
      type: String,
      enum:['Subjective', 'Objective'],
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

const QuestionBank = mongoose.model("QuestionBank", questionBankSchema);

module.exports = QuestionBank;

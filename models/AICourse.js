const mongoose = require("mongoose");

const aiCourseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  overview: { type: String, required: true },
  details: { type: String, required: true },
  coverImageKey: { type: String, default: "" },
  coverImageUrl: { type: String, default: "" },
  // Categorization
  mainCategory: { type: String, default: "Other", index: true },
  subCategory: { type: String, default: "Other", index: true },
  customSubCategory: { type: String, default: "" },
  tags: { type: [String], default: [] },
  // Faculty details
  faculty: [
    {
      name: { type: String, required: true },
      about: { type: String, required: true },
      facultyImageKey: { type: String, default: "" },
      facultyImageUrl: { type: String, default: "" },
    },
  ],
  // Ownership and visibility
  clientId: { type: String, required: true, index: true },
  isPublic: { type: Boolean, default: true },
  // Audit
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

aiCourseSchema.index({ clientId: 1, mainCategory: 1 });
aiCourseSchema.index({ clientId: 1, subCategory: 1 });

module.exports = mongoose.model("AICourse", aiCourseSchema);



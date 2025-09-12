const mongoose = require("mongoose")
const aiToolSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    enum: ["openai", "gemini"],
  },
  displayName: {
    type: String,
    required: true,
  },
  apiKey: {
    type: String,
    required: true,
  },
  apiUrl: {
    type: String,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  capabilities: [
    {
      type: String,
      enum: ["text_extraction", "text_evaluation", "text_generation"],
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
})

// Ensure only one tool can be active at a time
aiToolSchema.pre("save", async function (next) {
  if (this.isActive) {
    await this.constructor.updateMany({ _id: { $ne: this._id } }, { isActive: false })
  }
  this.updatedAt = new Date()
  next()
})

// Static method to get active AI tool
aiToolSchema.statics.getActiveTool = async function () {
  return await this.findOne({ isActive: true })
}

// Static method to get tool by name
aiToolSchema.statics.getToolByName = async function (name) {
  return await this.findOne({ name: name.toLowerCase() })
}

module.exports = mongoose.model("AiTool", aiToolSchema)

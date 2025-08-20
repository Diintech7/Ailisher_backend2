const mongoose = require('mongoose');

const objectiveTestSchema = new mongoose.Schema({
    name: { type: String, required: true, default: "" },
    clientId: { type: String, required: true },
    description: { type: String, default: "" },
    category: { type: String, default: "" },
    subcategory: { type: String, default: "" },
    Estimated_time: { type: String, default: "" },
    imageKey: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    isTrending: { type: Boolean, default: false },
    isHighlighted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isEnabled: { type: Boolean, default: true },
    instructions: { type: String, default: "" },
    questions: { type: Array, default: [] }
}, { timestamps: true });

module.exports = mongoose.model('ObjectiveTest', objectiveTestSchema); 
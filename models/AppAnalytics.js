const mongoose = require("mongoose");

const PageAnalyticsSchema = new mongoose.Schema({
  page_name: { type: String, required: true },
  time_spent: { type: String, required: true },
  visited_count: { type: Number, required: true, default: 1 }
});

const AppAnalyticsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  total_time: { type: String, required: true },
  pages: [PageAnalyticsSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("AppAnalytics", AppAnalyticsSchema);

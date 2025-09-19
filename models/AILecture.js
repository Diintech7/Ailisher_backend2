const mongoose = require("mongoose");

const lectureSchema = new mongoose.Schema({
    courseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AICourse",
        required: true,
    },
    lectureNumber: {
        type: Number,
    },
    lectureName: {
        type: String,
        required: true,
    },
    topics:[{
        topicName: {
            type: String,
            required: true,
        },
        topicDescription: {
            type: String,
            required: true,
        },
        VideoKey: {
            type: String,
        },
        VideoUrl: {
            type: String,
        },
        transcriptKey: {
            type: String,
            required: false
        },
        transcriptUrl: {
            type: String,
            required: false,
            default:""
        }
    }],
    lectureDescription: {
        type: String,
        required: true,
    },
});


module.exports = mongoose.models.AILecture || mongoose.model("AILecture", lectureSchema);
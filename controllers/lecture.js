const Book = require("../models/Book");
const Course = require("../models/Course");
const Lecture = require("../models/Lectures");
const {
  generatePresignedUrl,
  s3Client,
  uploadFileToS3,
  generateGetPresignedUrl,
} = require("../utils/r2");

const createlecture = async (req, res) => {
  try {
    const user = req.user;
    console.log(user.businessName)
    const { bookId, courseId } = req.params;
    const { lectureName, lectureDescription, topics = [] } = req.body;
    const book = await Book.findById(bookId);
    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }
    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });
    }

    // Find the max lectureNumber for this course
    const lastLecture = await Lecture.findOne({ courseId }).sort({
      lectureNumber: -1,
    });
    const nextLectureNumber = lastLecture ? lastLecture.lectureNumber + 1 : 1;

    // Process topics: upload transcript if present
    const processedTopics = await Promise.all(
      topics.map(async (topic) => {
        let transcriptKey = null;
        let transcriptUrl = "";
        if (topic.transcriptText) {
          const transcriptBuffer = Buffer.from(topic.transcriptText, "utf-8");
          transcriptKey = `${user.businessName}/transcripts/${Date.now()}-${lectureName}-${topic.topicName}.txt`;
          await uploadFileToS3(transcriptBuffer, transcriptKey, "text/plain");
          transcriptUrl = await generateGetPresignedUrl(transcriptKey);
          console.log(transcriptUrl);
        }
        // Remove transcriptText from topic before saving
        const { transcriptText, ...rest } = topic;
        return {
          ...rest,
          transcriptKey,
          transcriptUrl, // <-- add this line
        };
      })
    );

    const lecture = await Lecture.create({
      lectureName,
      lectureDescription,
      courseId: courseId,
      lectureNumber: nextLectureNumber,
      topics: processedTopics,
    });
    res.status(200).json({
      success: true,
      message: "Lecture created successfully",
      lecture,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message || "server error",
    });
  }
};

const getlecture = async (req, res) => {
  try {
    const { bookId, courseId } = req.params;
    const book = await Book.findById(bookId);
    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }
    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });
    }
    const lectures = await Lecture.find({ courseId: courseId });

    // Generate transcriptUrl for each topic if transcriptKey exists
    for (const lecture of lectures) {
      for (const topic of lecture.topics) {
        if (topic.transcriptKey) {
          topic.transcriptUrl = await generateGetPresignedUrl(topic.transcriptKey);
        } else {
          topic.transcriptUrl = "";
        }
      }
    }

    res.status(200).json({
      success: true,
      message: "Lecture fetched successfully",
      lectures,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const updatelecture = async (req, res) => {
  try {
    const { bookId, courseId, lectureId } = req.params;
    const { lectureNumber, lectureName, lectureDescription, topics } = req.body;
    const book = await Book.findById(bookId);
    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }
    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });
    }
    const lecture = await Lecture.findById(lectureId);
    if (!lecture) {
      return res
        .status(404)
        .json({ success: false, message: "Lecture not found" });
    }
    const updatedLecture = await Lecture.findByIdAndUpdate(
      lectureId,
      { lectureNumber, lectureName, lectureDescription, topics },
      { new: true }
    );

    res
      .status(200)
      .json({
        success: true,
        message: "Lecture updated successfully",
        lectureId: lecture._id,
        updatedLecture,
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const deletelecture = async (req, res) => {
  try {
    const { bookId, courseId, lectureId } = req.params;
    const book = await Book.findById(bookId);
    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }
    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });
    }
    const lecture = await Lecture.findById(lectureId);
    if (!lecture) {
      return res
        .status(404)
        .json({ success: false, message: "Lecture not found" });
    }
    await Lecture.findByIdAndDelete(lectureId);
    res
      .status(200)
      .json({
        success: true,
        message: "Lecture deleted successfully",
        lectureId: lecture._id,
      });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { createlecture, getlecture, updatelecture, deletelecture };

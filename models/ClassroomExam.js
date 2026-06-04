const mongoose = require('mongoose');

const ClassroomExamSchema = new mongoose.Schema({
  exam_id: {
    type: String,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  category: {
    type: String,
    default: ''
  },
  image_url: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  clientId: {
    type: String,
    required: true,
    index: true
  },
  tree: [
    {
      paper_id: String,
      exam_id: String,
      name: String,
      subjects: [
        {
          subject_id: String,
          exam_id: String,
          paper_id: String,
          name: String,
          color: String,
          chapter_count: Number,
          topic_count: Number,
          subtopic_count: Number,
          chapters: [
            {
              chapter_id: String,
              subject_id: String,
              name: String,
              topics: [
                {
                  topic_id: String,
                  chapter_id: String,
                  name: String,
                  subtopics: [
                    {
                      subtopic_id: String,
                      topic_id: String,
                      name: String,
                      description: String,
                      notes: String,
                      reels: [
                        {
                          video_url: String,
                          content_id: String,
                          script: String,
                          created_at: String
                        }
                      ],
                      created_at: String
                    }
                  ],
                  created_at: String
                }
              ],
              created_at: String
            }
          ],
          created_at: String
        }
      ],
      created_at: String
    }
  ],
  created_at: {
    type: Date,
    default: Date.now
  },
  synced_at: {
    type: Date,
    default: Date.now
  }
});

// Ensure compound unique index for exam_id and clientId
ClassroomExamSchema.index({ exam_id: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model('ClassroomExam', ClassroomExamSchema);

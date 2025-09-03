const path = require("path");
const QuestionBank = require("../models/QuestionBank");
const {
  generatePresignedUrl,
  generateGetPresignedUrl,
  deleteObject,
} = require("../utils/r2");

exports.uploadImage = async (req, res) => {
  try {
    const user = req.user;
    console.log(user.businessName);
    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({
        success: false,
        message: "File name and content type are required",
      });
    }

    // Create unique filename with timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(fileName);
    const key = `${user.businessName}/question-bank/cover-image/image-${uniqueSuffix}${ext}`;

    // Generate presigned URL
    const uploadUrl = await generatePresignedUrl(key, contentType);

    return res.status(200).json({
      success: true,
      uploadUrl,
      key,
    });
  } catch (error) {
    console.error("Get cover image upload URL error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.createQuestionBank = async (req, res) => {
  try {
    const userId = req.user._id;
    const clientId = req.user.clientId;
    let { title, description, coverImageKey, category, subcategory, type } =
      req.body;
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: "Title and description are required",
      });
    }
    let coverImageUrl = "";
    if (coverImageKey) {
      coverImageUrl = await generateGetPresignedUrl(coverImageKey);
    }
    const questionBank = await QuestionBank.create({
      title,
      description,
      coverImageKey,
      coverImageUrl,
      category,
      subcategory,
      type,
      createdBy: userId,
      status: "draft",
    });

    res.status(201).json({
      success: true,
      message: "successfully created question bank",
      data: questionBank,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getQuestionBanks = async (req, res) => {
  try {
    const createdBy = req.user._id;
    const banks = await QuestionBank.find({ createdBy });
    for (const bank of banks) {
      if (bank.coverImageKey) {
        bank.coverImageUrl = await generateGetPresignedUrl(bank.coverImageKey);
      }
    }
    res.json({ success: true, data: banks });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getQuestionBankById = async (req, res) => {
  try {
    const bank = await QuestionBank.findById(req.params.id);
    if (!bank)
      return res.status(404).json({ success: false, message: "Not found" });

    if (bank.coverImageKey) {
      bank.coverImageUrl = await generateGetPresignedUrl(bank.coverImageKey);
    }

    res.json({ success: true, data: bank });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getQuestionBankSummary = async (req, res) => {
  try {
    const questionBankId = req.params.id;
    console.log(questionBankId)
    if (!questionBankId) {
      return res.status(400).json({ success: false, message: "question bank id is required" });
    }

    const matchStage = {
      $match: {
        questionBank: new mongoose.Types.ObjectId(questionBankId),
        isActive: true,
      },
    };
    console.log(matchStage)

    const [subjects, difficulties, bySubjectDifficulty, totals] = await Promise.all([
      ObjectiveTestQuestion.aggregate([
        matchStage,
        { $group: { _id: "$subject", total: { $sum: 1 } } },
        { $project: { 
            _id: 0, 
            subject: {
              $cond: [
                { $or: [ { $eq: ["$_id", null] }, { $eq: ["$_id", ""] } ] },
                "Other",
                "$_id"
              ]
            }, 
            total: 1 
          } 
        },
        { $sort: { subject: 1 } },
      ]),
      ObjectiveTestQuestion.aggregate([
        matchStage,
        { $group: { _id: "$difficulty", total: { $sum: 1 } } },
        { $project: { _id: 0, difficulty: "$_id", total: 1 } },
        { $sort: { difficulty: 1 } },
      ]),
      ObjectiveTestQuestion.aggregate([
        matchStage,
        { $group: { _id: { subject: "$subject", difficulty: "$difficulty" }, total: { $sum: 1 } } },
        {
          $project: {
            _id: 0,
            subject: {
              $cond: [
                { $or: [ { $eq: ["$_id.subject", null] }, { $eq: ["$_id.subject", ""] } ] },
                "Other",
                "$_id.subject"
              ]
            },
            difficulty: "$_id.difficulty",
            total: 1,
          },
        },
        { $sort: { subject: 1, difficulty: 1 } },
      ]),
      ObjectiveTestQuestion.aggregate([
        matchStage,
        { $count: "total" },
      ]),
    ]);

    return res.json({
      success: true,
      data: {
        totalQuestions: totals?.[0]?.total || 0,
        subjects,
        difficulties,
        bySubjectDifficulty,
      },
    });
  } catch (error) {
    console.error("getQuestionBankSummary error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.updateQuestionBank = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, type, category, subcategory } = req.body;
    const bank = await QuestionBank.findById(id);
    if (!bank)
      return res.status(404).json({ success: false, message: "Not found" });

    if (typeof title === "string") bank.title = title;
    if (typeof description === "string") bank.description = description;
    if (typeof type === "string") bank.type = type;
    if (typeof category === "string") bank.category = category;
    if (typeof subcategory === "string") bank.subcategory = subcategory;

    await bank.save();

    if (bank.coverImageKey) {
      bank.coverImageUrl = await generateGetPresignedUrl(bank.coverImageKey);
    }

    res.json({ success: true, data: bank });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteQuestionBank = async (req, res) => {
  try {
    const { id } = req.params;
    const bank = await QuestionBank.findById(id);
    if (!bank)
      return res.status(404).json({ success: false, message: "Not found" });
    await QuestionBank.deleteOne({ _id: id });
    if (bank.coverImageKey) {
      const formattedKey = bank.coverImageKey.startsWith("/")
        ? bank.coverImageKey.slice(1)
        : bank.coverImageKey;
      try {
        await deleteObject(formattedKey);
      } catch (e) {
        console.error("Delete old cover failed:", e?.message || e);
      }
    }
    res.json({ success: true, message: "Deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCoverImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { key } = req.body;
    if (!key)
      return res
        .status(400)
        .json({ success: false, message: "key is required" });
    const bank = await QuestionBank.findById(id);
    if (!bank)
      return res.status(404).json({ success: false, message: "Not found" });

    if (bank.coverImageKey) {
      const oldKey = bank.coverImageKey.startsWith("/")
        ? bank.coverImageKey.slice(1)
        : bank.coverImageKey;
      try {
        await deleteObject(oldKey);
      } catch (e) {
        console.error("Delete old cover failed:", e?.message || e);
      }
    }

    const formattedKey = key.startsWith("/") ? key.slice(1) : key;
    bank.coverImageKey = formattedKey;
    bank.coverImageUrl = await generateGetPresignedUrl(formattedKey);
    await bank.save();
    res.json({ success: true, data: bank });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const ObjectiveTestQuestion = require("../models/ObjectiveTestQuestion");
const ObjectiveTest = require("../models/ObjectiveTest");
const User = require("../models/User");
const { default: mongoose } = require("mongoose");

exports.createQuestion = async (req, res) => {
  try {
    const {
      question,
      options,
      correctOption,
      difficulty,
      estimatedTime,
      positiveMarks,
      negativeMarks,
      solution,
      subject,
      topic,
    } = req.body;
    const questionBankId = req.params.id;
    console.log(req.body);
    console.log(req.params.id);
    // Validate required fields
    if (
      !question ||
      !options ||
      !Array.isArray(options) ||
      options.length < 2
    ) {
      return res.status(400).json({
        success: false,
        message: "Question and at least 2 options are required",
      });
    }

    if (
      correctOption === undefined ||
      correctOption < 0 ||
      correctOption >= options.length
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid correct option index is required",
      });
    }

    if (!questionBankId) {
      return res.status(400).json({
        success: false,
        message: "Test ID is required",
      });
    }

    // Validate client
    const clientId = req.user.userId;
    const client = await User.findOne({ userId: clientId });
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    // Validate test exists
    const questionBank = await QuestionBank.findById(questionBankId);
    if (!questionBank) {
      return res.status(404).json({
        success: false,
        message: "Test not found",
      });
    }

    // Create question data
    const questionData = {
      question: question.trim(),
      options: options
        .filter((opt) => opt && opt.trim())
        .map((opt) => opt.trim()),
      correctAnswer: correctOption,
      difficulty: difficulty || "L1",
      estimatedTime: estimatedTime || 1,
      positiveMarks: positiveMarks || 1,
      negativeMarks: negativeMarks || 0.33,
      subject: subject || "",
      topic: topic || "",
      questionBank: questionBankId,
      createdBy: req.user.id,
    };

    // Handle solution if provided
    if (solution) {
      questionData.solution = {
        type: solution.type || "text",
        text: solution.text || "",
        video: {
          url: solution.video?.url || "",
          title: solution.video?.title || "",
          description: solution.video?.description || "",
          duration: solution.video?.duration || 0,
        },
        image: {
          url: solution.image?.url || "",
          caption: solution.image?.caption || "",
        },
      };
    }

    // Create the question
    const newQuestion = new ObjectiveTestQuestion(questionData);
    const savedQuestion = await newQuestion.save();

    // If testId provided, add question to test
    // if (questionBankId) {
    //     await ObjectiveTest.findByIdAndUpdate(
    //       questionBankId,
    //       { $push: { questions: savedQuestion._id } }
    //     );
    //   }
    // Populate the test reference for response
    await savedQuestion.populate("questionBank", "name");

    res.status(201).json({
      success: true,
      message: "Question created successfully",
      question: savedQuestion,
    });
  } catch (error) {
    console.error("Error creating question:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get all questions
exports.getQuestions = async (req, res) => {
  try {
    const clientId = req.user.userId;
    console.log(clientId);
    const client = await User.findOne({ userId: clientId });
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "client not found",
      });
    }
    const questionBankId = req.params.id;
    console.log(questionBankId);
         const { difficulty, subject, topic, search, page = 1, limit = 150 } = req.query;

    // Validate test exists
    const questionBank = await QuestionBank.findById(questionBankId);
    if (!questionBank) {
      return res.status(404).json({
        success: false,
        message: "Question Bank not found",
      });
    }

         // Build query
     const query = { questionBank: questionBankId, isActive: true };
     if (difficulty) {
       query.difficulty = difficulty;
     }
     if (subject) {
       if (subject === 'Other') {
         query.$or = [
           { subject: { $exists: false } },
           { subject: null },
           { subject: '' }
         ];
       } else {
         query.subject = subject;
       }
     }
     if (topic) {
       query.topic = topic;
     }
     if (search) {
       query.question = { $regex: search, $options: 'i' };
     }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get questions with pagination
    const questions = await ObjectiveTestQuestion.find(query)
      .populate(
        "questionBank",
        "name description imageUrl category subcategory createdAt updatedAt"
      )
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const totalQuestions = await ObjectiveTestQuestion.countDocuments(query);

    res.json({
      success: true,
      questions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalQuestions / parseInt(limit)),
        totalQuestions,
        hasNextPage: skip + questions.length < totalQuestions,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching questions:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Update a question
exports.updateQuestion = async (req, res) => {
  try {
    const questionId = req.params.id;
    const {
      question,
      options,
      correctOption,
      difficulty,
      estimatedTime,
      positiveMarks,
      negativeMarks,
      solution,
      subject,
      topic,
    } = req.body;

    // Find the question
    const existingQuestion = await ObjectiveTestQuestion.findById(questionId);
    if (!existingQuestion) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

    // Validate options if provided
    if (options && (!Array.isArray(options) || options.length < 2)) {
      return res.status(400).json({
        success: false,
        message: "At least 2 options are required",
      });
    }

    if (
      correctOption !== undefined &&
      (correctOption < 0 ||
        correctOption >= (options || existingQuestion.options).length)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid correct option index is required",
      });
    }

    // Prepare update data
    const updateData = {};
    if (question) updateData.question = question.trim();
    if (options)
      updateData.options = options
        .filter((opt) => opt && opt.trim())
        .map((opt) => opt.trim());
    if (correctOption !== undefined) updateData.correctAnswer = correctOption;
    if (difficulty) updateData.difficulty = difficulty;
    if (estimatedTime !== undefined) updateData.estimatedTime = estimatedTime;
    if (positiveMarks !== undefined) updateData.positiveMarks = positiveMarks;
    if (negativeMarks !== undefined) updateData.negativeMarks = negativeMarks;
    if (subject !== undefined) updateData.subject = subject.trim();
    if (topic !== undefined) updateData.topic = topic.trim();

    // Handle solution update
    if (solution) {
      updateData.solution = {
        type: solution.type || existingQuestion.solution.type || "text",
        text: solution.text || existingQuestion.solution.text || "",
        video: {
          url:
            solution.video?.url || existingQuestion.solution.video?.url || "",
          title:
            solution.video?.title ||
            existingQuestion.solution.video?.title ||
            "",
          description:
            solution.video?.description ||
            existingQuestion.solution.video?.description ||
            "",
          duration:
            solution.video?.duration ||
            existingQuestion.solution.video?.duration ||
            0,
        },
        image: {
          url:
            solution.image?.url || existingQuestion.solution.image?.url || "",
          caption:
            solution.image?.caption ||
            existingQuestion.solution.image?.caption ||
            "",
        },
      };
    }

    // Update the question
    const updatedQuestion = await ObjectiveTestQuestion.findByIdAndUpdate(
      questionId,
      updateData,
      { new: true, runValidators: true }
    ).populate("questionBank", "name");

    res.json({
      success: true,
      message: "Question updated successfully",
      question: updatedQuestion,
    });
  } catch (error) {
    console.error("Error updating question:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Delete a question
exports.deleteQuestion = async (req, res) => {
  try {
    const questionId = req.params.id;

    const question = await ObjectiveTestQuestion.findById(questionId);
    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

    // Soft delete by setting isActive to false
    await ObjectiveTestQuestion.findByIdAndDelete(questionId);

    res.json({
      success: true,
      message: "Question deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting question:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Bulk delete questions
exports.bulkDeleteQuestions = async (req, res) => {
  try {
    const { questionIds } = req.body;
    const questionBankId = req.params.id;

    if (
      !questionIds ||
      !Array.isArray(questionIds) ||
      questionIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Question IDs array is required",
      });
    }

    // Validate that all questions exist and belong to the question bank
    const questions = await ObjectiveTestQuestion.find({
      _id: { $in: questionIds },
      questionBank: questionBankId,
      isActive: true,
    });

    if (questions.length !== questionIds.length) {
      return res.status(400).json({
        success: false,
        message:
          "Some questions not found or don't belong to this question bank",
        found: questions.length,
        requested: questionIds.length,
      });
    }

    // Soft delete all questions by setting isActive to false
    const result = await ObjectiveTestQuestion.deleteMany({
      _id: { $in: questionIds },
    });

    res.json({
      success: true,
      message: `${result.modifiedCount} questions deleted successfully`,
      deletedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error bulk deleting questions:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.saveFile = async (req,res) => {
  try {
    const { file } = req.file;
    const { fileName, contentType } = req.body;
  } catch (error) {
    console.error("Error saving file:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}
const Test = require("../models/SubjectiveTest");
const path = require("path");
const {
  generatePresignedUrl,
  generateGetPresignedUrl,
  deleteObject,
} = require("../utils/s3");
const User = require("../models/User");
const SubjectiveTestQuestion = require("../models/SubjectiveTestQuestion");
const UserAnswer = require("../models/UserAnswer");
const SubjectiveTestResult = require("../models/SubjectiveTestResult");

// Helper function to calculate test status
const calculateTestStatus = (questions, userAnswers) => {
  const totalQuestions = questions.length;
  const attemptedQuestions = userAnswers.length;

  if (attemptedQuestions === 0) {
    return {
      status: "not_attempted",
      attempted: false,
      progress: 0,
      totalQuestions: totalQuestions,
      attemptedQuestions: 0,
    };
  }

  const progress = (attemptedQuestions / totalQuestions) * 100;

  if (progress === 100) {
    return {
      status: "completed",
      attempted: true,
      progress: 100,
      totalQuestions: totalQuestions,
      attemptedQuestions: attemptedQuestions,
    };
  } else {
    return {
      status: "in_progress",
      attempted: true,
      progress: Math.round(progress),
      totalQuestions: totalQuestions,
      attemptedQuestions: attemptedQuestions,
    };
  }
};

// Helper function to calculate submission summary
const calculateSubmissionSummary = (questions, userAnswers) => {
  const totalQuestions = questions.length;
  const attemptedQuestions = userAnswers.length;
  const notAttemptedQuestions = totalQuestions - attemptedQuestions;
  // Calculate total completion time (using the metadata.timeSpent field)
  const totalCompletionTime = SubjectiveTestResult.completionTime;

  // Get answer images and details for attempted questions
  const attemptedQuestionsDetails = userAnswers.map((answer) => ({
    questionId: answer.questionId._id,
    question: answer.questionId.question,
    maximumMarks: answer.questionId.metadata?.maximumMarks || 0,
    difficultyLevel: answer.questionId.metadata?.difficultyLevel || 0,
    attemptNumber: answer.attemptNumber,
    submissionStatus: answer.submissionStatus,
    submittedAt: answer.submittedAt,
    timeSpent: answer.metadata?.timeSpent || 0,
    answerImages: answer.answerImages.length,
    evaluation: answer.evaluation
      ? {
          score: answer.evaluation.score,
        }
      : null,
  }));

  // Get not attempted question IDs
  const attemptedQuestionIds = userAnswers.map((answer) =>
    answer.questionId._id.toString()
  );
  const notAttemptedQuestionIds = questions
    .filter((q) => !attemptedQuestionIds.includes(q._id.toString()))
    .map((q) => q._id.toString());

  return {
    totalQuestions,
    attemptedQuestions,
    notAttemptedQuestions,
    completionTime: totalCompletionTime, // in seconds
    attemptedQuestionsDetails,
    attemptedQuestionIds,
    notAttemptedQuestionIds,
    averageTimePerQuestion:
      attemptedQuestions > 0
        ? Math.round(totalCompletionTime / attemptedQuestions)
        : 0,
  };
};

exports.uploadImage = async (req, res) => {
  try {
    const businessName = req.user.businessName;
    console.log(businessName);
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
    const key = `${businessName}/test/covers/cover-${uniqueSuffix}${ext}`;
    console.log(key);
    const uploadUrl = await generatePresignedUrl(key, contentType);
    console.log(uploadUrl);
    downloadUrl = await generateGetPresignedUrl(key, 604800);
    console.log(downloadUrl);
    res.status(200).json({
      success: true,
      message: "Image uploaded successfully",
      uploadUrl,
      key,
    });
  } catch (error) {
    console.error("Upload image error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate upload URL",
      error: error.message,
    });
  }
};

exports.createTest = async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      subcategory,
      Estimated_time,
      imageKey,
      isTrending,
      isHighlighted,
      isActive,
      instructions,
    } = req.body;
    console.log(req.user.userId);
    const clientId = req.user.userId;
    const client = await User.findOne({ userId: req.user.userId });
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Test name is required",
      });
    }

    // Generate presigned URL for the image if imageKey is provided
    let imageUrl = "";
    if (imageKey) {
      try {
        imageUrl = await generateGetPresignedUrl(imageKey, 604800); // 7 days expiry
      } catch (error) {
        console.error("Error generating presigned URL for image:", error);
        // Continue without image URL if generation fails
      }
    }

    const test = await Test.create({
      name,
      clientId,
      description,
      category,
      subcategory,
      Estimated_time,
      imageKey,
      imageUrl,
      isTrending,
      isHighlighted,
      isActive,
      instructions,
    });

    res.status(201).json({
      success: true,
      message: "Test created successfully",
      test,
    });
  } catch (error) {
    console.error("Create test error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create test",
      error: error.message,
    });
  }
};

exports.getTest = async (req, res) => {
  try {
    const clientId = req.user.userId || req.clientId;
    const { id } = req.params;
    const userId = req.user.id; // Get the current user ID

    console.log(clientId);
    const client = await User.findOne({ userId: clientId });
    if (!client) {
      return res.status(400).json({ message: "client not found" });
    }

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Test ID is required",
      });
    }

    const test = await Test.findById(id);

    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found",
      });
    }

    // Get all questions for this test
    const questions = await SubjectiveTestQuestion.find({ test: id });

    // Get user's answers for this test (using the exact structure you showed)
    const userAnswers = await UserAnswer.find({
      userId: userId,
      testId: id,
      testType: "subjective",
    }).populate({
      path: "questionId",
      select: "question metadata",
      model: "SubjectiveTestQuestion",
    });

    // Calculate test status and summary
    const testStatus = calculateTestStatus(questions, userAnswers);
    const submissionSummary = calculateSubmissionSummary(
      questions,
      userAnswers
    );

    const testMaximumMarks = questions.reduce((sum, question) => {
      return sum + (question.metadata?.maximumMarks || 0);
    }, 0);

    // Generate fresh presigned URL if imageKey exists
    if (test.imageKey) {
      try {
        const freshImageUrl = await generateGetPresignedUrl(
          test.imageKey,
          604800
        );
        test.imageUrl = freshImageUrl;
      } catch (error) {
        console.error("Error generating fresh presigned URL:", error);
      }
    }

    res.status(200).json({
      success: true,
      TestStatus: testStatus,
      TestSubmissionSummary: submissionSummary,
      testMaximumMarks: testMaximumMarks,
      test: {
        ...test.toObject(),
      },
    });
  } catch (error) {
    console.error("Get test error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get test",
      error: error.message,
    });
  }
};

exports.getAllTests = async (req, res) => {
  try {
    const clientId = req.user.userId;
    console.log(clientId);
    const client = await User.findOne({ userId: clientId });
    if (!client) {
      res.status(400).json({ message: "client not found" });
    }
    const tests = await Test.find({ isActive: true, clientId: clientId });

    // Generate fresh presigned URLs for all tests with images
    const testsWithUrls = await Promise.all(
      tests.map(async (test) => {
        if (test.imageKey) {
          try {
            const freshImageUrl = await generateGetPresignedUrl(
              test.imageKey,
              604800
            );
            test.imageUrl = freshImageUrl;
          } catch (error) {
            console.error(
              "Error generating presigned URL for test:",
              test._id,
              error
            );
          }
        }
        return test;
      })
    );

    res.status(200).json({
      success: true,
      tests: testsWithUrls,
    });
  } catch (error) {
    console.error("Get all tests error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get tests",
      error: error.message,
    });
  }
};

exports.getAllTestsForMobile = async (req, res) => {
  try {
    const clientId = req.clientId || req.params.clientId;
    const userId = req.user.id; // Get current user ID

    const { limit = 10, page = 1, category, subcategory } = req.query;

    console.log("Fetching tests for mobile for client:", clientId);

    // Validate client exists
    const client = await User.findOne({ userId: clientId });
    if (!client) {
      return res.status(400).json({
        success: false,
        message: "Client not found",
      });
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter for tests
    const filter = {
      isActive: true,
      clientId: clientId,
    };
    if (category) filter.category = category;
    if (subcategory) filter.subcategory = subcategory;

    // Get all tests for this client
    const allTests = await Test.find({
      isActive: true,
      clientId: clientId,
    });

    // Generate fresh presigned URLs and get user status for each test
    const testsWithUserStatus = await Promise.all(
      allTests.map(async (test) => {
        // Generate fresh presigned URL
        if (test.imageKey) {
          try {
            const freshImageUrl = await generateGetPresignedUrl(
              test.imageKey,
              604800
            );
            test.imageUrl = freshImageUrl;
          } catch (error) {
            console.error(
              "Error generating presigned URL for test:",
              test._id,
              error
            );
          }
        }

        // Get questions for this test
        const questions = await SubjectiveTestQuestion.find({ test: test._id });

        // Calculate total marks
        const testMaximumMarks = questions.reduce((sum, question) => {
          return sum + (question.metadata?.maximumMarks || 0);
        }, 0);
        // Get user's answers for this test
        const userAnswers = await UserAnswer.find({
          userId: userId,
          testId: test._id,
          testType: "subjective",
        });

        // Calculate user's total score (you already have this)
        const totalScore = userAnswers.reduce((sum, answer) => {
          return sum + (answer.evaluation?.score || 0);
        }, 0);

        // Calculate percentage
        const percentage = testMaximumMarks > 0 ? (totalScore / testMaximumMarks) * 100 : 0;

        console.log(questions.length);
        console.log(userId);
        console.log(userAnswers);
        console.log(userAnswers.length);
        // Calculate status
        const testStatus = calculateTestStatus(questions, userAnswers);

        return {
          ...test.toObject(),
          userTestStatus: testStatus,
          testMaximumMarks: testMaximumMarks,
          totalScore:totalScore,
          percentage: Math.round(percentage * 100) / 100, // Round to 2 decimal places
        };
      })
    );

    // Format response for mobile
    const formatTestForMobile = (test) => ({
      test_id: test._id.toString(),
      name: test.name,
      description: test.description,
      category: test.category || "",
      subcategory: test.subcategory || "",
      image: test.imageKey || "",
      image_url: test.imageUrl || "",
      estimated_time: test.Estimated_time,
      instructions: test.instructions,
      is_trending: test.isTrending,
      is_highlighted: test.isHighlighted,
      is_active: test.isActive,
      testMaximumMarks: test.testMaximumMarks,
      totalScore:test.totalScore,
      percentage:test.percentage,
      created_at: test.createdAt,
      updated_at: test.updatedAt,
      userTestStatus: test.userTestStatus, // Include user status
    });

    // Group tests by category and subcategory
    const groupedTests = {};

    testsWithUserStatus.forEach((test) => {
      const category = test.category || "Uncategorized";
      const subcategory = test.subcategory || "General";

      if (!groupedTests[category]) {
        groupedTests[category] = {
          category: category,
          subcategories: {},
        };
      }

      if (!groupedTests[category].subcategories[subcategory]) {
        groupedTests[category].subcategories[subcategory] = [];
      }

      groupedTests[category].subcategories[subcategory].push(
        formatTestForMobile(test)
      );
    });

    // Convert to array format and apply pagination
    const categoriesArray = Object.values(groupedTests).map((category) => {
      const subcategoriesArray = Object.entries(category.subcategories).map(
        ([subName, tests]) => ({
          name: subName,
          count: tests.length,
          tests: tests.slice(skip, skip + parseInt(limit)),
        })
      );

      return {
        category: category.category,
        subcategories: subcategoriesArray,
        total_tests: Object.values(category.subcategories).reduce(
          (sum, tests) => sum + tests.length,
          0
        ),
      };
    });

    // Calculate pagination metadata
    const totalTests = testsWithUserStatus.length;
    const totalPages = Math.ceil(totalTests / parseInt(limit));
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    const mobileTestsResponse = {
      success: true,
      data: {
        categories: categoriesArray,
        totalTests: totalTests,
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_items: totalTests,
          items_per_page: parseInt(limit),
          has_next_page: hasNextPage,
          has_prev_page: hasPrevPage,
        },
      },
      meta: {
        clientId,
        timestamp: new Date().toISOString(),
        filters_applied: { category, subcategory },
      },
    };

    res.status(200).json(mobileTestsResponse);
  } catch (error) {
    console.error("Get all tests for mobile error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get tests",
      error: {
        code: "TESTS_FETCH_ERROR",
        details: error.message,
      },
    });
  }
};

exports.updateTest = async (req, res) => {
  try {
    const clientId = req.user.userId;
    console.log(clientId);
    const client = await User.findOne({ userId: clientId });
    if (!client) {
      res.status(400).json({ message: "client not found" });
    }
    const { id } = req.params;
    const {
      name,
      description,
      Estimated_time,
      imageKey,
      isTrending,
      isHighlighted,
      isActive,
      instructions,
      category,
      subcategory,
    } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Test ID is required",
      });
    }

    const test = await Test.findById(id);
    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found",
      });
    }

    // Handle image update
    let imageUrl = test.imageUrl;
    if (imageKey && imageKey !== test.imageKey) {
      // Delete old image if it exists and is different
      if (test.imageKey) {
        try {
          await deleteObject(test.imageKey);
          console.log("Successfully deleted old image from S3:", test.imageKey);
        } catch (error) {
          console.error("Error deleting old image from S3:", error);
        }
      }

      // Generate new presigned URL
      try {
        imageUrl = await generateGetPresignedUrl(imageKey, 604800);
      } catch (error) {
        console.error("Error generating presigned URL for new image:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to generate image URL",
        });
      }
    }

    const updatedTest = await Test.findByIdAndUpdate(
      id,
      {
        name,
        description,
        Estimated_time,
        imageKey,
        imageUrl,
        isTrending,
        isHighlighted,
        isActive,
        instructions,
        category,
        subcategory,
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Test updated successfully",
      test: updatedTest,
    });
  } catch (error) {
    console.error("Update test error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update test",
      error: error.message,
    });
  }
};


exports.deleteTest = async (req, res) => {
  try {
    const clientId = req.user.userId;
    console.log(clientId);
    const client = await User.findOne({ userId: clientId });
    if (!client) {
      res.status(400).json({ message: "client not found" });
    }
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Test ID is required",
      });
    }

    const test = await Test.findById(id);
    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found",
      });
    }

    // Delete image from S3 if it exists
    if (test.imageKey) {
      try {
        await deleteObject(test.imageKey);
        console.log("Successfully deleted image from S3:", test.imageKey);
      } catch (error) {
        console.error("Error deleting image from S3:", error);
      }
    }

    await Test.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Test deleted successfully",
    });
  } catch (error) {
    console.error("Delete test error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete test",
      error: error.message,
    });
  }
};

// Toggle isEnabled flag for a subjective test
exports.toggleIsEnabled = async (req, res) => {
  try {
    const clientId = req.user.userId;
    const { id } = req.params;
    const { isEnabled } = req.body || {};

    if (!id) {
      return res.status(400).json({ success: false, message: 'Test ID is required' });
    }

    const test = await Test.findById(id);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }

    if (test.clientId !== clientId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // If body provides isEnabled, use it; otherwise toggle
    const newValue = typeof isEnabled === 'boolean' ? isEnabled : !test.isEnabled;
    test.isEnabled = newValue;

    await test.save();

    // Refresh image URL if present
    if (test.imageKey) {
      try {
        const freshImageUrl = await generateGetPresignedUrl(test.imageKey, 604800);
        test.imageUrl = freshImageUrl;
      } catch (e) {
        // ignore URL refresh errors
      }
    }

    return res.status(200).json({ success: true, message: 'Test isEnabled updated', test });
  } catch (error) {
    console.error('Toggle isEnabled error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update isEnabled', error: error.message });
  }
};

// Keep compatibility with existing route using PATCH for toggling active
exports.toggleTestStatus = async (req, res) => {
  try {
    const clientId = req.user.userId;
    const { id } = req.params;
    const { isActive } = req.body || {};

    if (!id) {
      return res.status(400).json({ success: false, message: 'Test ID is required' });
    }

    const test = await Test.findById(id);
    if (!test) {
      return res.status(404).json({ success: false, message: 'Test not found' });
    }

    if (test.clientId !== clientId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const newActive = typeof isActive === 'boolean' ? isActive : !test.isActive;
    test.isActive = newActive;
    await test.save();

    return res.status(200).json({ success: true, message: 'Test active status updated', test });
  } catch (error) {
    console.error('Toggle isActive error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update isActive', error: error.message });
  }
};

exports.startTest = async (req, res) => {
  try {
    const { testId } = req.params;
    const userId = req.user.id;
    const clientId = req.clientId;

    console.log(userId);
    console.log(testId);
    console.log(clientId);
    // Get total questions
    const totalQuestions = await SubjectiveTestQuestion.countDocuments({
      test: testId,
    });

    const existingTestResult = await SubjectiveTestResult.findOne({
      userId: userId,
      testId: testId,
      status: { $in: ["completed", "started"] },
    });
    console.log(existingTestResult);
    if (existingTestResult) {
      return res.status(400).json({
        success: false,
        message: "Test already started or completed",
      });
    }
    // Create test result
    const testResult = await SubjectiveTestResult.create({
      userId: userId,
      testId: testId,
      clientId: clientId,
      startTime: new Date(),
      totalQuestions: totalQuestions,
      attemptedQuestions: 0,
      status: "started",
    });

    res.status(200).json({
      success: true,
      message: "Test started",
      resultId: testResult._id,
      startTime: testResult.startTime,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to start test",
      error: error.message,
    });
  }
};

exports.submitTest = async (req, res) => {
  try {
    const { testId } = req.params;
    const userId = req.user.id;

    // Find test result
    const testResult = await SubjectiveTestResult.findOne({
      userId: userId,
      testId: testId,
      status: "started",
    });

    if (!testResult) {
      return res.status(404).json({
        success: false,
        message: "No active test found",
      });
    }

    // Get all answers for this test
    const answers = await UserAnswer.find({
      userId: userId,
      testId: testId,
      testType: "subjective",
    });

    // Calculate results
    const attemptedQuestions = answers.length;
    const totalScore = answers.reduce((sum, answer) => {
      return sum + (answer.evaluation?.score || 0);
    }, 0);
    const averageScore =
      attemptedQuestions > 0 ? totalScore / attemptedQuestions : 0;

    // Update test result
    testResult.endTime = new Date();
    testResult.completionTime = Math.floor(
      (testResult.endTime - testResult.startTime) / 1000
    );
    testResult.attemptedQuestions = attemptedQuestions;
    testResult.totalScore = totalScore;
    testResult.averageScore = averageScore;
    testResult.status = "completed";

    await testResult.save();

    res.status(200).json({
      success: true,
      message: "Test submitted successfully",
      data: {
        resultId: testResult._id,
        startTime: testResult.startTime,
        endTime: testResult.endTime,
        completionTime: testResult.completionTime,
        totalQuestions: testResult.totalQuestions,
        attemptedQuestions: testResult.attemptedQuestions,
        totalScore: testResult.totalScore,
        averageScore: testResult.averageScore,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to submit test",
      error: error.message,
    });
  }
};

// Copy a test
exports.copyTest = async (req, res) => {
  try {
    const testId = req.params.id;
    const { name, description } = req.body;

    // Find the original test
    const originalTest = await Test.findById(testId);
    if (!originalTest) {
      return res.status(404).json({
        success: false,
        message: "Test not found"
      });
    }

    // Create new test data
    const newTestData = {
      name: name || `${originalTest.name}_Copy`,
      description: description || originalTest.description,
      clientId: req.user.userId,
      category: originalTest.category,
      subcategory: originalTest.subcategory,
      Estimated_time: originalTest.Estimated_time,
      // Don't copy the image to avoid conflicts when deleting
      imageKey: null,
      imageUrl: null,
      isTrending: false,
      isHighlighted: false,
      isActive: true,
      isEnabled: true,
      instructions: originalTest.instructions,
    };

    // Create the new test
    const newTest = new Test(newTestData);
    const savedTest = await newTest.save();

    res.status(201).json({
      success: true,
      message: "Test copied successfully",
      test: savedTest
    });

  } catch (error) {
    console.error('Error copying test:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
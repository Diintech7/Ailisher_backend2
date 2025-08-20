const ObjectiveTest = require("../models/ObjectiveTest");
const ObjectiveTestQuestion = require("../models/ObjectiveTestQuestion");
const TestResult = require("../models/TestResult");
const User = require("../models/User");
const UserProfile = require("../models/UserProfile");
const path = require("path");
const {
  generatePresignedUrl,
  generateGetPresignedUrl,
  deleteObject,
} = require("../utils/s3");
const { Client } = require("twilio/lib/base/BaseTwilio");
const { default: mongoose } = require("mongoose");

// Utility function to format completion time
const formatCompletionTime = (milliseconds) => {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
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

    const test = await ObjectiveTest.create({
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

    const test = await ObjectiveTest.findById(id);

    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found",
      });
    }

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
        // Keep existing URL if generation fails
      }
    }

    res.status(200).json({
      success: true,
      test,
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
    const tests = await ObjectiveTest.find({
      isActive: true,
      clientId: clientId,
    });

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
    // Use req.clientId (set by middleware) or fallback to req.params.clientId
    const clientId = req.clientId || req.params.clientId;
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

    // Get all tests for this client (without pagination for categorization)
    const allTests = await ObjectiveTest.find({
      isActive: true,
      clientId: clientId,
    });

    // Generate fresh presigned URLs for all tests with images
    const testsWithUrls = await Promise.all(
      allTests.map(async (test) => {
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
        const questions = await ObjectiveTestQuestion.find({test:test._id})
        const totalQuestions = questions.length;

        const testMaximumMarks = questions.reduce((sum,question)=>{
          return sum+=(question.positiveMarks)
        },0)
        console.log("total",totalQuestions)
        console.log(testMaximumMarks)
        return {
          ...test.toObject(),
          totalQuestions:totalQuestions,
          testMaximumMarks: testMaximumMarks,
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
      totalQuestions:test.totalQuestions,
      testMaximumMarks:test.testMaximumMarks,
      created_at: test.createdAt,
      updated_at: test.updatedAt,
      
    });

    // Group tests by category and subcategory
    const groupedTests = {};

    testsWithUrls.forEach((test) => {
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
    const totalTests = testsWithUrls.length;
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

    const test = await ObjectiveTest.findById(id);
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

    const updatedTest = await ObjectiveTest.findByIdAndUpdate(
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

    const test = await ObjectiveTest.findById(id);
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

    await ObjectiveTest.findByIdAndDelete(id);

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

// Toggle isEnabled flag for a test
exports.toggleIsEnabled = async (req, res) => {
  try {
    const clientId = req.user.userId;
    const { id } = req.params;
    const { isEnabled } = req.body || {};

    if (!id) {
      return res.status(400).json({ success: false, message: 'Test ID is required' });
    }

    const test = await ObjectiveTest.findById(id);
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

// Submit test with all answers
exports.submitTest = async (req, res) => {
  try {
    const { testId } = req.params;
    const { answers, totalQuestions, answeredQuestions } = req.body;
    const userId = req.user.id;
    const clientId = req.clientId;
    console.log(testId, userId, clientId);

    // Validate test exists
    const test = await ObjectiveTest.findById(testId);
    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found",
      });
    }
    console.log(test);

    // Get all questions for this test
    const questions = await ObjectiveTestQuestion.find({ test: testId });
    console.log(questions);
    if (questions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No questions found for this test",
      });
    }

    // Find existing test result (should be in_progress)
    const existingResult = await TestResult.findOne({
      userId,
      testId,
      status: "in_progress",
    });

    if (!existingResult) {
      return res.status(400).json({
        success: false,
        message: "Test not started. Please start the test first.",
      });
    }

    // Calculate completion time
    const endTime = new Date();
    const completionTimeMs =
      endTime.getTime() - existingResult.startTime.getTime();
    const completionTimeSeconds = formatCompletionTime(completionTimeMs);

    // Calculate results
    let correctAnswers = 0;
    let levelResults = {
      L1: { total: 0, correct: 0, score: 0 },
      L2: { total: 0, correct: 0, score: 0 },
      L3: { total: 0, correct: 0, score: 0 },
    };

    // New metrics (do not alter existing fields/behavior)
    let totalMarksEarned = 0;
    let attemptedQuestionsCount = 0;
    let wrongAnswersCount = 0;

    // Process each question
    questions.forEach((question) => {
      const userAnswer = answers[question._id];
      const isCorrect = userAnswer === question.correctAnswer;
      const hasAnswered = userAnswer !== undefined && userAnswer !== null && userAnswer !== '';
      console.log(userAnswer, question.correctAnswer);
      if (isCorrect) {
        correctAnswers++;
      }

      // Update new metrics
      if (hasAnswered) {
        attemptedQuestionsCount++;
        if (isCorrect) {
          totalMarksEarned += (question.positiveMarks || 0);
        } else {
          totalMarksEarned -= (question.negativeMarks || 0);
          wrongAnswersCount++;
        }
      }

      // Update level breakdown
      const level = question.difficulty || "L1";
      levelResults[level].total++;
      if (isCorrect) {
        levelResults[level].correct++;
      }
    });

    // Calculate scores
    const overallScore = (correctAnswers / totalQuestions) * 100;

    // Calculate level-specific scores
    Object.keys(levelResults).forEach((level) => {
      if (levelResults[level].total > 0) {
        levelResults[level].score =
          (levelResults[level].correct / levelResults[level].total) * 100;
      }
    });

    // Add current attempt to history
    existingResult.attemptHistory.push({
      attemptNumber: existingResult.attemptNumber,
      score: Math.round(overallScore * 100) / 100,
      completionTime: completionTimeSeconds,
      answers: answers, // Save answers in attempt history
      submittedAt: new Date(),
      correctAnswers: correctAnswers,
      totalQuestions: totalQuestions,
      levelBreakdown: levelResults,
      wrongAnswers: wrongAnswersCount,
      skippedQuestions: Math.max(0, totalQuestions - attemptedQuestionsCount),
      totalMarksEarned: totalMarksEarned
    });

    // Update the existing test result with completion data
    existingResult.answers = answers;
    existingResult.score = Math.round(overallScore * 100) / 100; // Round to 2 decimal places
    existingResult.totalQuestions = totalQuestions;
    existingResult.answeredQuestions = answeredQuestions;
    existingResult.correctAnswers = correctAnswers;
    existingResult.levelBreakdown = levelResults;
    existingResult.completionTime = completionTimeSeconds; // Store in milliseconds
    existingResult.status = "completed";
    existingResult.submittedAt = new Date();

    await existingResult.save();


    res.json({
      success: true,
      message: `Test submitted successfully (Attempt ${existingResult.attemptNumber}/${existingResult.maxAttempts})`,
      data: {
        testResultId: existingResult._id,
        attemptNumber: existingResult.attemptNumber,
        maxAttempts: existingResult.maxAttempts,
        score: existingResult.score,
        correctAnswers,
        totalQuestions,
        answeredQuestions,
        levelBreakdown: levelResults,
        startTime: existingResult.startTime,
        completionTime: existingResult.completionTime, // Raw milliseconds
        submittedAt: existingResult.submittedAt,
        remainingAttempts: existingResult.maxAttempts - existingResult.attemptNumber,
        // New fields (non-breaking additions)
        marksEarned: totalMarksEarned,
        wrongAnswers: wrongAnswersCount,
        skippedQuestions: Math.max(0, totalQuestions - attemptedQuestionsCount)
      },
    });
  } catch (error) {
    console.error("Error submitting test:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit test",
      error: error.message,
    });
  }
};

// Start test - track when user begins the test
exports.startTest = async (req, res) => {
  try {
    const { testId } = req.params;
    const userId = req.user.id;
    const clientId = req.clientId;

    // Validate test exists
    const test = await ObjectiveTest.findById(testId);
    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found",
      });
    }

    // Check if user already has a result document for this test
    let existingResult = await TestResult.findOne({
      userId,
      testId
    });

    const maxAttempts = 5;
    let currentAttempt;

    if (!existingResult) {
      // First time taking this test
      currentAttempt = 1;
      
      // Create new test result
      existingResult = new TestResult({
        userId,
        testId,
        clientId,
        attemptNumber: currentAttempt,
        maxAttempts: maxAttempts,
        startTime: new Date(),
        status: "in_progress"
      });
    } else {
      // User has taken this test before
      currentAttempt = existingResult.attemptHistory.length + 1;
      
      // Check if reached max attempts
      if (currentAttempt > maxAttempts) {
        return res.status(400).json({
          success: false,
          message: `Maximum attempts (${maxAttempts}) reached for this test`
        });
      }

      // Check if there's an in_progress attempt
      if (existingResult.status === "in_progress") {
        return res.status(400).json({
          success: false,
          message: "You have an ongoing test. Please complete it first.",
          data: {
            testResultId: existingResult._id,
            attemptNumber: existingResult.attemptNumber
          }
        });
      }

      // Update existing result for new attempt
      existingResult.attemptNumber = currentAttempt;
      existingResult.startTime = new Date();
      existingResult.status = "in_progress";
      existingResult.answers = new Map(); // Clear previous answers
      existingResult.score = null;
      existingResult.submittedAt = null;
      existingResult.completionTime = null;
      existingResult.correctAnswers = null;
      existingResult.totalQuestions = null;
      existingResult.answeredQuestions = null;
      existingResult.levelBreakdown = null;
    }

    await existingResult.save();

    res.json({
      success: true,
      message: `Test started (Attempt ${currentAttempt}/${maxAttempts})`,
      data: {
        testResultId: existingResult._id,
        attemptNumber: currentAttempt,
        maxAttempts: maxAttempts,
        startTime: existingResult.startTime,
        remainingAttempts: maxAttempts - currentAttempt
      }
    });
  } catch (error) {
    console.error("Error starting test:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start test",
      error: error.message,
    });
  }
};

// Get user's test results
exports.getUserTestResults = async (req, res) => {
  try {
    const userId = req.user.id;
    const { testId } = req.params;

    console.log(userId, testId);

    // Find the single result document for this user and test
    const result = await TestResult.findOne({
      userId: userId,
      testId: testId,
    })
      .populate("testId", "name category subcategory description Estimated_time")
      .sort({ submittedAt: -1 });
    
    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Test results not found",
      });
    }

    const testQuestions = await ObjectiveTestQuestion.find({
      test: result.testId
    });

    const testMaximumMarks = testQuestions.reduce((sum, question) => {
      return sum + (question.positiveMarks || 0);
    }, 0);
    
      
    // Get attempt history with answers
    const attemptHistory = result.attemptHistory.map(attempt => ({
      attemptNumber: attempt.attemptNumber,
      totalMarksEarned: attempt.totalMarksEarned,
      wrongAnswers: attempt.wrongAnswers,
      skippedQuestions: attempt.skippedQuestions,
      completionTime: attempt.completionTime,
      answers: attempt.answers ? Object.fromEntries(attempt.answers) : {}, // Convert Map to object
      submittedAt: attempt.submittedAt,
      correctAnswers: attempt.correctAnswers,
      totalQuestions: attempt.totalQuestions,
      levelBreakdown: attempt.levelBreakdown
    }));

    // Get all unique question IDs from all attempts
    const allQuestionIds = new Set();
    attemptHistory.forEach(attempt => {
      if (attempt.answers) {
        Object.keys(attempt.answers).forEach(id => allQuestionIds.add(id));
      }
    });

    // Get questions based on test type (objective test)
    const questions = await ObjectiveTestQuestion.find({
      _id: { $in: Array.from(allQuestionIds) }
    }).select("question options correctAnswer difficulty");

    // Calculate overall statistics
    const totalAttempts = result.attemptHistory.length;
    const bestScore = Math.max(...attemptHistory.map(a => a.totalMarksEarned));
    const averageScore = attemptHistory.reduce((sum, a) => sum + a.totalMarksEarned, 0) / totalAttempts;
    const latestAttempt = attemptHistory[attemptHistory.length - 1];

    // Prepare question information for objective tests
    const questionInfo = questions.map(question => ({
      _id: question._id,
      question: question.question,
      options: question.options,
      correctAnswer: question.correctAnswer,
      difficulty: question.difficulty,
      type: 'objective'
    }));

    res.json({
      success: true,
      data: {
        // Test Information
        testInfo: {
          id: result.testId._id,
          name: result.testId.name,
          category: result.testId.category,
          subcategory: result.testId.subcategory,
          description: result.testId.description,
          estimatedTime: result.testId.Estimated_time,
          type: 'objective',
          testMaximumMarks: testMaximumMarks
        },
        // Attempt Statistics
        attemptStats: {
          totalAttempts: totalAttempts,
          maxAttempts: result.maxAttempts,
          bestScore: Math.round(bestScore * 100) / 100,
          averageScore: Math.round(averageScore * 100) / 100,
          latestScore: latestAttempt ? latestAttempt.totalMarksEarned : 0,
          canTakeMoreAttempts: totalAttempts < result.maxAttempts
        },
        // Complete Attempt History
        attemptHistory: attemptHistory,
        // Questions Information
        questions: questionInfo,
        // Current Status
        currentStatus: {
          status: result.status,
          lastAttemptNumber: result.attemptNumber,
          lastAttemptDate: result.submittedAt
        }
      },
    });
  } catch (error) {
    console.error("Error fetching test results:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch test results",
      error: error.message,
    });
  }
};

// Get user's test attempt history
exports.getUserTestHistory = async (req, res) => {
  try {
    const { testId } = req.params;
    const userId = req.user.id;

    // Find the single result document for this user and test
    const result = await TestResult.findOne({
      userId,
      testId
    });

    if (!result || !result.attemptHistory || result.attemptHistory.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No test attempts found"
      });
    }

    // Get attempt history from the single document
    const attemptHistory = result.attemptHistory.map(attempt => ({
      attemptNumber: attempt.attemptNumber,
      totalMarksEarned: attempt.totalMarksEarned,
      wrongAnswers: attempt.wrongAnswers,
      skippedQuestions: attempt.skippedQuestions,
      completionTime: attempt.completionTime,
      answers: attempt.answers, // Include answers from attempt history
      submittedAt: attempt.submittedAt,
      correctAnswers: attempt.correctAnswers,
      totalQuestions: attempt.totalQuestions,
      levelBreakdown: attempt.levelBreakdown
    }));

    // Get all unique question IDs from all attempts
    const allQuestionIds = new Set();
    attemptHistory.forEach(attempt => {
      if (attempt.answers) {
        // Convert Map to array of question IDs
        const questionIds = Array.from(attempt.answers.keys());
        questionIds.forEach(id => allQuestionIds.add(id));
      }
    });

    // Get questions for all attempts
    const questions = await ObjectiveTestQuestion.find({
      _id: { $in: Array.from(allQuestionIds) }
    }).select("question options correctAnswer");

    const bestScore = Math.max(...attemptHistory.map(a => a.totalMarksEarned));
    const averageScore = attemptHistory.reduce((sum, a) => sum + a.totalMarksEarned, 0) / attemptHistory.length;

    res.json({
      success: true,
      data: {
        testId,
        totalAttempts: result.attemptHistory.length,
        maxAttempts: result.maxAttempts || 5,
        attemptHistory: attemptHistory,
        questions: questions,
        bestScore: Math.round(bestScore * 100) / 100,
        averageScore: Math.round(averageScore * 100) / 100,
        canTakeMoreAttempts: result.attemptHistory.length < result.maxAttempts
      }
    });

  } catch (error) {
    console.error("Error fetching test history:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch test history",
      error: error.message
    });
  }
};

// Get current attempt status
exports.getCurrentAttemptStatus = async (req, res) => {
  try {
    const { testId } = req.params;
    const userId = req.user.id;

    // Find the single result document for this user and test
    const result = await TestResult.findOne({
      userId,
      testId
    });

    if (!result) {
      return res.json({
        success: true,
        data: {
          testId,
          completedAttempts: 0,
          maxAttempts: 5,
          canStartNewAttempt: true,
          inProgressAttempt: null,
          bestScore: 0
        }
      });
    }

    const completedAttempts = result.attemptHistory ? result.attemptHistory.length : 0;
    const inProgressAttempt = result.status === "in_progress" ? {
      attemptNumber: result.attemptNumber,
      startTime: result.startTime
    } : null;

    // Calculate best score from attempt history
    const bestScore = result.attemptHistory && result.attemptHistory.length > 0 
      ? Math.max(...result.attemptHistory.map(attempt => attempt.totalMarksEarned))
      : 0;

    res.json({
      success: true,
      data: {
        testId,
        completedAttempts: completedAttempts,
        maxAttempts: result.maxAttempts || 5,
        canStartNewAttempt: !inProgressAttempt && completedAttempts < (result.maxAttempts || 5),
        inProgressAttempt: inProgressAttempt,
        bestScore: bestScore
      }
    });

  } catch (error) {
    console.error("Error fetching attempt status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch attempt status",
      error: error.message
    });
  }
};

// Get test analytics (for admin/client)
exports.getTestAnalytics = async (req, res) => {
  try {
    const { testId } = req.params;
    const clientId = req.user.userId;
    console.log(clientId);

    const results = await TestResult.find({
      testId,
      clientId,
      status: "completed",
    });

    if (results.length === 0) {
      return res.json({
        success: true,
        data: {
          totalAttempts: 0,
          averageScore: 0,
          highestScore: 0,
          lowestScore: 0,
          levelBreakdown: {
            L1: { attempts: 0, averageScore: 0 },
            L2: { attempts: 0, averageScore: 0 },
            L3: { attempts: 0, averageScore: 0 },
          },
        },
      });
    }

    // Calculate analytics
    const totalAttempts = results.length;
    const scores = results.map((r) => r.totalMarksEarned);
    const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const highestScore = Math.max(...scores);
    const lowestScore = Math.min(...scores);

    // Level breakdown
    const levelBreakdown = {
      L1: { attempts: 0, averageScore: 0 },
      L2: { attempts: 0, averageScore: 0 },
      L3: { attempts: 0, averageScore: 0 },
    };

    results.forEach((result) => {
      Object.keys(result.levelBreakdown).forEach((level) => {
        if (result.levelBreakdown[level].total > 0) {
          levelBreakdown[level].attempts++;
          levelBreakdown[level].averageScore +=
            result.levelBreakdown[level].totalMarksEarned;
        }
      });
    });

    // Calculate averages
    Object.keys(levelBreakdown).forEach((level) => {
      if (levelBreakdown[level].attempts > 0) {
        levelBreakdown[level].averageScore =
          levelBreakdown[level].averageScore / levelBreakdown[level].attempts;
      }
    });

    res.json({
      success: true,
      data: {
        totalAttempts,
        averageScore: Math.round(averageScore * 100) / 100,
        highestScore: Math.round(highestScore * 100) / 100,
        lowestScore: Math.round(lowestScore * 100) / 100,
        levelBreakdown,
      },
    });
  } catch (error) {
    console.error("Error fetching test analytics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch test analytics",
      error: error.message,
    });
  }
};



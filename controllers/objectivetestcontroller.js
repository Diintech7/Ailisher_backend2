const ObjectiveTest = require("../models/ObjectiveTest");
const ObjectiveTestQuestion = require("../models/ObjectiveTestQuestion");
const TestResult = require("../models/TestResult");
const User = require("../models/User");
const MobileUser = require("../models/MobileUser");
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
        let totalQuestions = 0;
        let testMaximumMarks = 0;

        if (test.questions && test.questions.length > 0) {
          const questions = await ObjectiveTestQuestion.find({
            _id: { $in: test.questions },
          });
  
          totalQuestions = questions.length;
          testMaximumMarks = questions.reduce((sum,question)=>{
            return sum+=(question.positiveMarks)
          },0)

        }
        
        console.log("total",totalQuestions)
        console.log(testMaximumMarks)

        return {
          ...test.toObject(),
          totalQuestions:totalQuestions,
          testMaximumMarks: testMaximumMarks,
        };
      })
    );

    // Format response for mobile with plan details
    const formatTestForMobile = async (test) => {
      const baseFormat = {
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
        isEnabled: test.isEnabled,
        totalQuestions: test.totalQuestions,
        testMaximumMarks: test.testMaximumMarks,
        created_at: test.createdAt,
        updated_at: test.updatedAt,
      };

      // Check if test is in any plan and get plan details
      try {
        const PlanItem = require('../models/PlanItem');
        const CreditRechargePlan = require('../models/CreditRechargePlan');
        
        // Find plan items that reference this test
        const planItems = await PlanItem.find({
          itemType: { $in: ['objective-test', 'objective-tests'] },
          referenceId: test._id.toString(),
          clientId: test.clientId
        });

        if (planItems.length > 0) {
          // Get all plans that contain these plan items
          const plans = await CreditRechargePlan.find({
            items: { $in: planItems.map(item => item._id) },
            clientId: clientId,
            status: 'active'
          }).select('_id name description MRP offerPrice category duration status');

          return {
            ...baseFormat,
            isPaid: true,
            planDetails: plans.map(plan => ({
              id: plan._id,
              name: plan.name,
              description: plan.description,
              mrp: plan.MRP,
              offerPrice: plan.offerPrice,
              category: plan.category,
              duration: plan.duration,
              status: plan.status
            }))
          };
        } else {
          return {
            ...baseFormat,
            isPaid: test.isPaid || false,
            planDetails: []
          };
        }
      } catch (error) {
        console.error('Error fetching plan details for test:', error);
        return {
          ...baseFormat,
          isPaid: test.isPaid || false,
          planDetails: []
        };
      }
    };

    // Group tests by category and subcategory
    const groupedTests = {};

    // Process all tests with plan details
    const formattedTests = await Promise.all(
      testsWithUrls.map(test => formatTestForMobile(test))
    );

    formattedTests.forEach((test) => {
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

      groupedTests[category].subcategories[subcategory].push(test);
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
    const totalTests = formattedTests.length;
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
    const questions = await ObjectiveTestQuestion.find({ 
      _id: { $in: test.questions },
    });

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
    const testQuestions = await ObjectiveTestQuestion.find({ 
      _id: { $in: test.questions },
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
          totalUsersAppeared: 0,
          averageScore: 0,
          highestScore: 0,
          lowestScore: 0,
          topScore: 0,
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
    const uniqueUsers = new Set(results.map((r) => String(r.userId)));
    const totalUsersAppeared = uniqueUsers.size;

    // Prefer normalized percentage score if present
    const scores = results.map((r) => (typeof r.score === 'number' ? r.score : 0));
    const sumScores = scores.reduce((a, b) => a + b, 0);
    const averageScore = scores.length ? sumScores / scores.length : 0;
    const highestScore = scores.length ? Math.max(...scores) : 0;
    const lowestScore = scores.length ? Math.min(...scores) : 0;

    // Level breakdown (average of per-attempt level scores if available)
    const levelBreakdown = {
      L1: { attempts: 0, averageScore: 0 },
      L2: { attempts: 0, averageScore: 0 },
      L3: { attempts: 0, averageScore: 0 },
    };

    results.forEach((result) => {
      if (result.levelBreakdown) {
        ["L1", "L2", "L3"].forEach((level) => {
          const entry = result.levelBreakdown[level];
          if (entry && typeof entry.score === 'number') {
            levelBreakdown[level].attempts += 1;
            levelBreakdown[level].averageScore += entry.score;
          }
        });
      }
    });

    Object.keys(levelBreakdown).forEach((level) => {
      if (levelBreakdown[level].attempts > 0) {
        levelBreakdown[level].averageScore =
          levelBreakdown[level].averageScore / levelBreakdown[level].attempts;
      }
    });

    return res.json({
      success: true,
      data: {
        totalAttempts,
        totalUsersAppeared,
        averageScore: Math.round(averageScore * 100) / 100,
        highestScore: Math.round(highestScore * 100) / 100,
        lowestScore: Math.round(lowestScore * 100) / 100,
        topScore: Math.round(highestScore * 100) / 100,
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

// Get first-attempt-only scoreboard for a test (admin/client)
exports.getFirstAttemptScoreboard = async (req, res) => {
  try {
    const { testId } = req.params;
    const clientId = req.user.userId;

    // Fetch completed results for this test and client
    const results = await TestResult.find({
      testId,
      clientId,
      status: "completed",
    })
    .lean();

    // Helper to parse completion time like "5m 37s" or "12s" into seconds
    const parseDurationToSeconds = (str) => {
      if (!str || typeof str !== "string") return Number.POSITIVE_INFINITY;
      let total = 0;
      const minMatch = str.match(/(\d+)\s*m/);
      const secMatch = str.match(/(\d+)\s*s/);
      if (minMatch) total += parseInt(minMatch[1], 10) * 60;
      if (secMatch) total += parseInt(secMatch[1], 10);
      // If nothing matched but it's numeric, try to coerce
      if (total === 0 && /^\d+$/.test(str)) total = parseInt(str, 10);
      return total || Number.POSITIVE_INFINITY;
    };

    // Build scoreboard entries from first attempt only
    const rawEntries = results
      .map((r) => {
        const history = Array.isArray(r.attemptHistory) ? r.attemptHistory : [];
        // Prefer the explicit attemptNumber === 1
        let first = history.find((a) => a.attemptNumber === 1);
        // If not present, fall back to smallest attemptNumber in history
        if (!first && history.length) {
          first = history.reduce((min, a) =>
            typeof min === "undefined" || a.attemptNumber < min.attemptNumber ? a : min
          , undefined);
        }
        // If still not present, and the top-level document itself is attempt 1, use it
        if (!first && r.attemptNumber === 1) {
          first = {
            attemptNumber: 1,
            score: r.score,
            totalMarksEarned: r.totalMarksEarned,
            correctAnswers: r.correctAnswers,
            totalQuestions: r.totalQuestions,
            completionTime: r.completionTime,
            submittedAt: r.submittedAt,
            levelBreakdown: r.levelBreakdown,
          };
        }

        if (!first) return null; // ignore users with no first attempt recorded

        return {
          userId: r.userId,
          score: typeof first.score === "number" ? first.score : 0,
          totalMarksEarned: typeof first.totalMarksEarned === "number" ? first.totalMarksEarned : null,
          correctAnswers: typeof first.correctAnswers === "number" ? first.correctAnswers : null,
          totalQuestions: typeof first.totalQuestions === "number" ? first.totalQuestions : null,
          completionTime: first.completionTime || null,
          completionSeconds: parseDurationToSeconds(first.completionTime),
          submittedAt: first.submittedAt || null,
          levelBreakdown: first.levelBreakdown || {},
        };
      })
      .filter(Boolean);

    // Deduplicate by userId to ensure only one first attempt per user
    const byUser = new Map();
    for (const e of rawEntries) {
      const key = String(e.userId);
      const existing = byUser.get(key);
      if (!existing) {
        byUser.set(key, e);
      } else {
        const eTime = e.submittedAt ? new Date(e.submittedAt).getTime() : Number.POSITIVE_INFINITY;
        const xTime = existing.submittedAt ? new Date(existing.submittedAt).getTime() : Number.POSITIVE_INFINITY;
        if (eTime < xTime) {
          byUser.set(key, e);
        } else if (eTime === xTime && e.score > existing.score) {
          byUser.set(key, e);
        }
      }
    }
    const entries = Array.from(byUser.values());

    // Summary stats
    const totalUsersAppeared = entries.length;
    const totalMarksEarned = entries.map((e) => (typeof e.totalMarksEarned === 'number' ? e.totalMarksEarned : 0));
    const topScore = totalMarksEarned.length ? Math.max(...totalMarksEarned) : 0;
    const averageScore = totalMarksEarned.length ? totalMarksEarned.reduce((a, b) => a + b, 0) / totalMarksEarned.length : 0;

    // Optional: enrich with user display names (support both User and MobileUser + UserProfile)
    const userIds = [...new Set(entries.map((e) => String(e.userId)))];
    const [users, mobileUsers, profiles] = await Promise.all([
      User.find({ _id: { $in: userIds } }, { name: 1, fullName: 1, email: 1 }).lean(),
      MobileUser.find({ _id: { $in: userIds } }, { mobile: 1, clientId: 1 }).lean(),
      UserProfile.find({ userId: { $in: userIds } }, { name: 1, userId: 1 }).lean(),
    ]);

    const idToUser = new Map(users.map((u) => [String(u._id), u]));
    const idToMobile = new Map(mobileUsers.map((m) => [String(m._id), m]));
    const idToProfile = new Map(profiles.map((p) => [String(p.userId), p]));

    entries.forEach((e) => {
      const key = String(e.userId);
      const u = idToUser.get(key);
      if (u) {
        e.user = { id: u._id, name: u.name || u.fullName || null, email: u.email || null };
        return;
      }
      const m = idToMobile.get(key);
      const p = idToProfile.get(key);
      if (m || p) {
        e.user = {
          id: m?._id || e.userId,
          name: p?.name || null,
          email: null,
          mobile: m?.mobile || null,
        };
      } else {
        e.user = null;
      }
    });

    // Sort by score DESC, then faster completion time ASC, then earlier submission ASC
    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.completionSeconds !== b.completionSeconds) return a.completionSeconds - b.completionSeconds;
      const aTime = a.submittedAt ? new Date(a.submittedAt).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.submittedAt ? new Date(b.submittedAt).getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });

    // Assign ranks (simple 1-based since tie-breakers largely resolve ties)
    const ranked = entries.map((e, idx) => ({ rank: idx + 1, ...e }));

    return res.json({
      success: true,
      summary: {
        topScore: Math.round(topScore * 100) / 100,
        averageScore: Math.round(averageScore * 100) / 100,
        totalUsersAppeared,
      },
      data: ranked,
    });
  } catch (error) {
    console.error("Error fetching first-attempt scoreboard:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch first-attempt scoreboard", error: error.message });
  }
};

// Add questions from question bank to test
exports.addQuestionsToTest = async (req, res) => {
  try {
    const testId = req.params.id;
    let { questionIds } = req.body;
    console.log(testId),
    console.log(questionIds)

    if (!questionIds || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Question IDs array is required"
      });
    }

    // ✅ Convert to ObjectId
    questionIds = questionIds.map(id => new mongoose.Types.ObjectId(id));

    // Validate test exists
    const test = await ObjectiveTest.findById(testId);
    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found"
      });
    }

    // Validate questions exist and are active
    const questions = await ObjectiveTestQuestion.find({
      _id: { $in: questionIds },
      isActive: true
    });

    if (questions.length !== questionIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some questions not found or inactive",
        found: questions.length,
        requested: questionIds.length
      });
    }

    // Add questions to test (avoid duplicates)
    const existingQuestions = test.questions || [];
    const newQuestions = questionIds.filter(id => !existingQuestions.includes(id));
    
    if (newQuestions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "All questions are already in the test"
      });
    }

    await ObjectiveTest.findByIdAndUpdate(testId, {
      $addToSet: { questions: { $each: newQuestions } }
    });

    res.json({
      success: true,
      message: `${newQuestions.length} questions added to test`,
      addedCount: newQuestions.length,
      totalQuestions: existingQuestions.length + newQuestions.length
    });

  } catch (error) {
    console.error('Error adding questions to test:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Remove questions from test
exports.removeQuestionsFromTest = async (req, res) => {
  try {
    const { testId } = req.params;
    const { questionIds } = req.body;

    if (!questionIds || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Question IDs array is required"
      });
    }

    // Validate test exists
    const test = await ObjectiveTest.findById(testId);
    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found"
      });
    }

    // Remove questions from test
    const existingQuestions = test.questions || [];
    const questionsToRemove = questionIds.filter(id => existingQuestions.includes(id));
    
    if (questionsToRemove.length === 0) {
      return res.status(400).json({
        success: false,
        message: "None of the specified questions are in the test"
      });
    }

    await ObjectiveTest.findByIdAndUpdate(testId, {
      $pull: { questions: { $in: questionsToRemove } }
    });

    res.json({
      success: true,
      message: `${questionsToRemove.length} questions removed from test`,
      removedCount: questionsToRemove.length,
      totalQuestions: existingQuestions.length - questionsToRemove.length
    });

  } catch (error) {
    console.error('Error removing questions from test:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Copy a test
exports.copyTest = async (req, res) => {
  try {
    const testId = req.params.id;
    const { name, description } = req.body;

    // Find the original test
    const originalTest = await ObjectiveTest.findById(testId);
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
      isEnabled: true, // Start as disabled
      instructions: originalTest.instructions,
    };

    // Create the new test
    const newTest = new ObjectiveTest(newTestData);
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

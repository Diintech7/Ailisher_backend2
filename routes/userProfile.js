const express = require("express");
const router = express.Router({ mergeParams: true });

const MobileUser = require("../models/MobileUser");
const UserProfile = require("../models/UserProfile");
const UserAnswer = require("../models/UserAnswer");
const Payment = require("../models/Payment");
const MyBook = require("../models/MyBook");
const MyWorkbook = require("../models/MyWorkbook");
const TestResult = require("../models/TestResult");
const SubjectiveTestResult = require("../models/SubjectiveTestResult");
const { authenticateMobileUser } = require("../middleware/mobileAuth");

// GET /api/clients/:clientId/mobile/user-profile/me
router.get("/", authenticateMobileUser, async (req, res) => {
  try {
    const clientId = req.clientId;
    const userId = req.user && req.user.id;
    if (!clientId || !userId) {
      return res.status(400).json({ success: false, message: "Missing client/user context" });
    }

    // Base user and profile
    const [user, profile] = await Promise.all([
      MobileUser.findOne({ _id: userId, clientId }).select("mobile clientId lastLoginAt loginCount createdAt isVerified"),
      UserProfile.findOne({ userId }).select("-__v")
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Answers analytics
    const answersMatch = { userId, clientId };
    const [answersAgg] = await UserAnswer.aggregate([
      { $match: answersMatch },
      {
        $group: {
          _id: null,
          totalSubmissions: { $sum: 1 },
          evaluatedCount: {
            $sum: {
              $cond: [
                { $or: [
                  { $eq: ["$submissionStatus", "evaluated"] },
                  { $ne: ["$evaluatedAt", null] },
                  { $ne: ["$evaluation.score", null] }
                ] },
                1,
                0
              ]
            }
          },
          totalTimeSpent: { $sum: { $ifNull: ["$metadata.timeSpent", 0] } },
          averageScore: { $avg: "$evaluation.score" },
          bestScore: { $max: "$evaluation.score" },
          lastSubmissionAt: { $max: "$submittedAt" }
        }
      }
    ]);

    // Recent answers (last 5)
    const recentAnswers = await UserAnswer.find(answersMatch)
      .select("submittedAt submissionStatus evaluation.score testType testId setId attemptNumber metadata.timeSpent")
      .sort({ submittedAt: -1 })
      .limit(5)
      .lean();

    // Library counts
    const [myBooksCount, myWorkbooksCount] = await Promise.all([
      MyBook.countDocuments({ userId, clientId }),
      MyWorkbook.countDocuments({ userId, clientId })
    ]);

    // Purchases analytics
    const [paymentsAgg] = await Payment.aggregate([
      { $match: { userId, status: "SUCCESS" } },
      {
        $group: {
          _id: null,
          totalPurchases: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          lastPurchaseAt: { $max: "$createdAt" }
        }
      }
    ]);
    const lastPurchase = await Payment.findOne({ userId, status: "SUCCESS" })
      .select("orderId amount currency createdAt workbookIds planId gatewayName paymentMode")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: String(user._id),
          mobile: user.mobile,
          clientId: user.clientId,
          isVerified: !!user.isVerified,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          loginCount: user.loginCount
        },
        profile: profile || null,
        answers: {
          totalSubmissions: answersAgg?.totalSubmissions || 0,
          evaluatedCount: answersAgg?.evaluatedCount || 0,
          totalTimeSpent: answersAgg?.totalTimeSpent || 0,
          averageScore: answersAgg?.averageScore || 0,
          bestScore: answersAgg?.bestScore || 0,
          lastSubmissionAt: answersAgg?.lastSubmissionAt || null,
          recent: recentAnswers
        },
        library: {
          myBooksCount,
          myWorkbooksCount
        },
        purchases: {
          totalPurchases: paymentsAgg?.totalPurchases || 0,
          totalAmount: paymentsAgg?.totalAmount || 0,
          lastPurchaseAt: paymentsAgg?.lastPurchaseAt || null,
          lastPurchase: lastPurchase || null
        },
        progress: {
          practice: {
            overall: formatPracticeProgress(answersAgg),
            workbook: formatPracticeProgress(workbookProgress),
            myQuestion: formatPracticeProgress(myQuestionProgress),
            subjective: formatPracticeProgress(subjectivePracticeProgress)
          },
          tests: {
            objective: formatTestProgress(objectiveTestProgress),
            subjective: formatTestProgress(subjectiveTestProgress)
          }
        }
      }
    });
  } catch (err) {
    console.error("[UserProfile] /me error", err && err.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /api/clients/:clientId/mobile/user-profile/:userId
router.get("/:userId", async (req, res) => {
  try {
    const clientId = req.clientId;
    const { userId } = req.params;
    if (!clientId || !userId) {
      return res.status(400).json({ success: false, message: "Missing client/user context" });
    }

    // Verify target user belongs to same client
    const user = await MobileUser.findOne({ _id: userId, clientId }).select("mobile clientId lastLoginAt loginCount createdAt isVerified");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found for this client" });
    }

    const evaluatedCondition = {
      $or: [
        { $eq: ["$submissionStatus", "evaluated"] },
      ]
    }

    const aggregateAnswerProgress = (extraMatch = {}) =>
      UserAnswer.aggregate([
        { $match: { userId: user._id, clientId, ...extraMatch } },
        {
          $group: {
            _id: null,
            totalSubmissions: { $sum: 1 },
            evaluatedCount: {
              $sum: {
                $cond: [evaluatedCondition, 1, 0]
              }
            },
            totalTimeSpent: { $sum: { $ifNull: ["$metadata.timeSpent", 0] } },
            averageScore: { $avg: "$evaluation.score" },
            bestScore: { $max: "$evaluation.score" },
            lastSubmissionAt: { $max: "$submittedAt" }
          }
        }
      ]).then((r) => r[0])

    const aggregateObjectiveTests = () =>
      TestResult.aggregate([
        { $match: { userId: user._id, clientId } },
        {
          $group: {
            _id: null,
            attempts: { $sum: 1 },
            completedCount: {
              $sum: {
                $cond: [{ $eq: ["$status", "completed"] }, 1, 0]
              }
            },
            averageScore: { $avg: { $ifNull: ["$score", 0] } },
            bestScore: { $max: { $ifNull: ["$score", 0] } },
            lastAttemptAt: { $max: "$submittedAt" }
          }
        }
      ]).then((r) => r[0])

    const aggregateSubjectiveTests = () =>
      SubjectiveTestResult.aggregate([
        { $match: { userId: user._id, clientId } },
        {
          $group: {
            _id: null,
            attempts: { $sum: 1 },
            completedCount: {
              $sum: {
                $cond: [{ $eq: ["$status", "completed"] }, 1, 0]
              }
            },
            averageScore: { $avg: { $ifNull: ["$averageScore", 0] } },
            bestScore: { $max: { $ifNull: ["$averageScore", 0] } },
            lastAttemptAt: { $max: "$updatedAt" }
          }
        }
      ]).then((r) => r[0])

    const [
      profile,
      answersAgg,
      recentAnswers,
      myBooksCount,
      myWorkbooksCount,
      paymentsAgg,
      lastPurchase,
      workbookProgress,
      myQuestionProgress,
      subjectivePracticeProgress,
      objectiveTestProgress,
      subjectiveTestProgress
    ] = await Promise.all([
      UserProfile.findOne({ userId }).select("-__v"),
      aggregateAnswerProgress(),
      UserAnswer.find({ userId: user._id, clientId })
        .select("submittedAt submissionStatus evaluation.score testType testId setId attemptNumber metadata.timeSpent")
        .sort({ submittedAt: -1 })
        .limit(5)
        .lean(),
      MyBook.countDocuments({ userId: user._id, clientId }),
      MyWorkbook.countDocuments({ userId: user._id, clientId }),
      Payment.aggregate([
        { $match: { userId: user._id, status: "SUCCESS" } },
        { $group: { _id: null, totalPurchases: { $sum: 1 }, totalAmount: { $sum: "$amount" }, lastPurchaseAt: { $max: "$createdAt" } } }
      ]).then(r => r[0]),
      Payment.findOne({ userId: user._id, status: "SUCCESS" })
        .select("orderId amount currency createdAt workbookIds planId gatewayName paymentMode")
        .sort({ createdAt: -1 })
        .lean(),
      aggregateAnswerProgress({ testType: "aiswb" }),
      aggregateAnswerProgress({ testType: "myquestion" }),
      aggregateAnswerProgress({ testType: "subjective" }),
      aggregateObjectiveTests(),
      aggregateSubjectiveTests()
    ]);

    const formatPracticeProgress = (agg = {}) => ({
      totalSubmissions: agg?.totalSubmissions || 0,
      evaluatedCount: agg?.evaluatedCount || 0,
      averageScore: agg?.averageScore || 0,
      bestScore: agg?.bestScore || 0,
      totalTimeSpent: agg?.totalTimeSpent || 0,
      lastSubmissionAt: agg?.lastSubmissionAt || null
    })

    const formatTestProgress = (agg = {}) => ({
      attempts: agg?.attempts || 0,
      completedCount: agg?.completedCount || 0,
      averageScore: agg?.averageScore || 0,
      bestScore: agg?.bestScore || 0,
      lastAttemptAt: agg?.lastAttemptAt || null
    })

    console.log(profile)
    console.log(answersAgg)
    console.log(recentAnswers)
    console.log(myBooksCount)
    console.log(myWorkbooksCount)
    console.log(paymentsAgg)
    console.log(lastPurchase)

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: String(user._id),
          mobile: user.mobile,
          clientId: user.clientId,
          isVerified: !!user.isVerified,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          loginCount: user.loginCount
        },
        profile: profile || null,
        answers: {
          totalSubmissions: answersAgg?.totalSubmissions || 0,
          evaluatedCount: answersAgg?.evaluatedCount || 0,
          totalTimeSpent: answersAgg?.totalTimeSpent || 0,
          averageScore: answersAgg?.averageScore || 0,
          bestScore: answersAgg?.bestScore || 0,
          lastSubmissionAt: answersAgg?.lastSubmissionAt || null,
          recent: recentAnswers
        },
        progress: {
          practice: formatPracticeProgress(answersAgg),
          workbook: formatPracticeProgress(workbookProgress),
          myQuestion: formatPracticeProgress(myQuestionProgress),
          subjective: formatPracticeProgress(subjectivePracticeProgress)
        },
        tests: {
          objective: formatTestProgress(objectiveTestProgress),
          subjective: formatTestProgress(subjectiveTestProgress)
        },
        library: {
          myBooksCount,
          myWorkbooksCount
        },
        purchases: {
          totalPurchases: paymentsAgg?.totalPurchases || 0,
          totalAmount: paymentsAgg?.totalAmount || 0,
          lastPurchaseAt: paymentsAgg?.lastPurchaseAt || null,
          lastPurchase: lastPurchase || null
        }
      }
    });
  } catch (err) {
    console.error("[UserProfile] /:userId error", err && err.message);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;







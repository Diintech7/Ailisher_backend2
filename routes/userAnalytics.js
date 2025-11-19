const express = require("express")
const router = express.Router({ mergeParams: true })

const { authenticateMobileUser } = require("../middleware/mobileAuth")
const UserAnswer = require("../models/UserAnswer")
const TestResult = require("../models/TestResult")
const SubjectiveTestResult = require("../models/SubjectiveTestResult")
const AppAnalytics = require("../models/AppAnalytics")

const MS_IN_DAY = 24 * 60 * 60 * 1000

const safeNumber = (value) => {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return 0
}

const addToTimeWindows = (createdAt, seconds, buckets) => {
  if (!createdAt || !seconds) return
  const ts = new Date(createdAt).getTime()
  if (Number.isNaN(ts)) return

  buckets.overall += seconds
  if (ts >= buckets.oneDayAgo) buckets.last1Day += seconds
  if (ts >= buckets.sevenDaysAgo) buckets.last7Days += seconds
}

const calcSectionStats = (items, { getScore, getDate }, windowBounds) => {
  const base = {
    totalItems: 0,
    questionsAttempted: 0,
    averageScore: 0,
    averageScoreLast7Days: 0,
  }

  if (!items || !items.length) return base

  let totalScore = 0
  let scoredCount = 0
  let totalScore7d = 0
  let scoredCount7d = 0

  items.forEach((item) => {
    const score = getScore(item)
    const when = getDate(item)
    base.totalItems += 1
    base.questionsAttempted += 1
    if (typeof score === "number" && !Number.isNaN(score)) {
      totalScore += score
      scoredCount += 1
      if (when && when >= windowBounds.sevenDaysAgo) {
        totalScore7d += score
        scoredCount7d += 1
      }
    }
  })

  base.averageScore = scoredCount ? totalScore / scoredCount : 0
  base.averageScoreLast7Days = scoredCount7d ? totalScore7d / scoredCount7d : 0
  return base
}

// GET /api/clients/:clientId/mobile/user-analytics/me
router.get("/me", authenticateMobileUser, async (req, res) => {
  try {
    const clientId = req.clientId
    const userId = req.user && req.user.id

    if (!clientId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Missing client/user context",
      })
    }

    const now = Date.now()
    const oneDayAgo = now - MS_IN_DAY
    const sevenDaysAgo = now - 7 * MS_IN_DAY

    const timeBuckets = {
      overall: 0,
      last1Day: 0,
      last7Days: 0,
      oneDayAgo,
      sevenDaysAgo,
    }

    const [answers, testResults, subjectiveResults, appAnalytics] = await Promise.all([
      UserAnswer.find({ userId, clientId })
        .select("testType submittedAt evaluation.score metadata.timeSpent")
        .lean(),
      TestResult.find({ userId, clientId, status: "completed" })
        .select("score completionTime submittedAt")
        .lean(),
      SubjectiveTestResult.find({ userId, clientId })
        .select("averageScore completionTime updatedAt createdAt")
        .lean(),
      AppAnalytics.find({ userId }).select("total_time createdAt").lean(),
    ])

    // 1) Time spent from answers (per-question practice / submissions)
    answers.forEach((ans) => {
      const seconds = safeNumber(ans?.metadata?.timeSpent || 0)
      const createdAt = ans.submittedAt || ans.createdAt
      addToTimeWindows(createdAt, seconds, timeBuckets)
    })

    // 2) Time from subjective test results (already in seconds)
    subjectiveResults.forEach((r) => {
      const seconds = safeNumber(r.completionTime || 0)
      const createdAt = r.updatedAt || r.createdAt
      addToTimeWindows(createdAt, seconds, timeBuckets)
    })

    // 3) App-wide usage time from AppAnalytics (front-end should send seconds in total_time)
    appAnalytics.forEach((a) => {
      const seconds = safeNumber(a.total_time)
      addToTimeWindows(a.createdAt, seconds, timeBuckets)
    })

    // Section-wise grouping
    const workbookAnswers = answers.filter((a) => a.testType === "aiswb")
    const myQuestionAnswers = answers.filter((a) => a.testType === "myquestion")
    const subjectiveAnswers = answers.filter((a) => a.testType === "subjective")

    const sectionWindowBounds = {
      sevenDaysAgo: new Date(sevenDaysAgo),
    }

    const sections = {
      workbook: {
        ...calcSectionStats(
          workbookAnswers,
          {
            getScore: (a) => a?.evaluation?.score,
            getDate: (a) => a.submittedAt || a.createdAt,
          },
          sectionWindowBounds,
        ),
      },
      myQuestion: {
        ...calcSectionStats(
          myQuestionAnswers,
          {
            getScore: (a) => a?.evaluation?.score,
            getDate: (a) => a.submittedAt || a.createdAt,
          },
          sectionWindowBounds,
        ),
      },
      testsObjective: {
        ...calcSectionStats(
          testResults,
          {
            getScore: (t) => t.score,
            getDate: (t) => t.submittedAt || t.createdAt,
          },
          sectionWindowBounds,
        ),
      },
      testsSubjective: {
        ...calcSectionStats(
          subjectiveResults,
          {
            getScore: (t) => t.averageScore,
            getDate: (t) => t.updatedAt || t.createdAt,
          },
          sectionWindowBounds,
        ),
      },
    }

    const toMinutes = (seconds) => Math.round((seconds || 0) / 60)

    return res.status(200).json({
      success: true,
      data: {
        time: {
          overallSeconds: timeBuckets.overall,
          last1DaySeconds: timeBuckets.last1Day,
          last7DaysSeconds: timeBuckets.last7Days,
          overallMinutes: toMinutes(timeBuckets.overall),
          last1DayMinutes: toMinutes(timeBuckets.last1Day),
          last7DaysMinutes: toMinutes(timeBuckets.last7Days),
        },
        sections,
      },
    })
  } catch (err) {
    console.error("[UserAnalytics] /me error", err && err.message)
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    })
  }
})

module.exports = router




const express = require("express")
const router = express.Router({ mergeParams: true })

const { authenticateMobileUser } = require("../middleware/mobileAuth")
const UserAnswer = require("../models/UserAnswer")
const TestResult = require("../models/TestResult")
const SubjectiveTestResult = require("../models/SubjectiveTestResult")
const AppAnalytics = require("../models/AppAnalytics")

const MS_IN_DAY = 24 * 60 * 60 * 1000

// Safely convert total_time to seconds.
// Supports:
// - number or numeric string -> treated as seconds (or ms if very large)
// - "<number> min", "85 min", "20mins" etc.
// - "<number> s", "30 sec", etc.
// - "HH:MM:SS" or "MM:SS" formatted strings
const parseDurationToSeconds = (value) => {
  if (typeof value === "number") return value
  if (typeof value !== "string") return 0
  const trimmed = value.trim()
  if (!trimmed) return 0

  // Handle patterns like "85 min", "20 mins", "30 sec", "45 s"
  const unitMatch = trimmed.match(/^(\d+)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds|min|mins|minute|minutes)?$/i)
  if (unitMatch) {
    const amount = Number(unitMatch[1])
    if (Number.isNaN(amount)) return 0
    const unit = (unitMatch[2] || "s").toLowerCase()

    if (["ms", "millisecond", "milliseconds"].includes(unit)) {
      return Math.round(amount / 1000)
    }
    if (["min", "mins", "minute", "minutes"].includes(unit)) {
      return amount * 60
    }
    // default seconds for s/sec/second/seconds or missing unit
    return amount
  }

  // Try simple numeric without any unit (already seconds or milliseconds)
  const numeric = Number(trimmed)
  if (!Number.isNaN(numeric)) {
    // If looks like milliseconds (very large), convert to seconds
    return numeric > 10 * 60 * 60 ? Math.round(numeric / 1000) : numeric
  }

  // Try "HH:MM:SS" or "MM:SS"
  const parts = trimmed.split(":").map((p) => Number(p))
  if (parts.some((p) => Number.isNaN(p))) return 0

  if (parts.length === 3) {
    const [h, m, s] = parts
    return h * 3600 + m * 60 + s
  }
  if (parts.length === 2) {
    const [m, s] = parts
    return m * 60 + s
  }
  return 0
}

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

    // For graph: usage per day for last 7 days (including days with 0)
    const perDayMap = new Map()

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
      AppAnalytics.find({ userId }).sort({ createdAt: 1 }),
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
    appAnalytics.forEach((entry) => {
      if (!entry.createdAt) return
      const ts = new Date(entry.createdAt).getTime()
      if (Number.isNaN(ts)) return

      const secs = parseDurationToSeconds(entry.total_time)
      if (!secs) return

      // Add to global buckets
      addToTimeWindows(entry.createdAt, secs, timeBuckets)

      // Per-day accumulation (for last 7 days graph)
      if (ts >= timeBuckets.sevenDaysAgo) {
        const dayKey = new Date(ts).toISOString().slice(0, 10) // YYYY-MM-DD
        const prev = perDayMap.get(dayKey) || 0
        perDayMap.set(dayKey, prev + secs)
      }
    })

    // Build an array for the last 7 calendar days (including today), even if 0
    const perDay = []
    for (let i = 6; i >= 0; i--) {
      const dayTs = now - i * MS_IN_DAY
      const dayKey = new Date(dayTs).toISOString().slice(0, 10)
      const seconds = perDayMap.get(dayKey) || 0
      perDay.push({
        date: dayKey,
        seconds,
        minutes: Math.round(seconds / 60),
      })
    }

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
        summary: {
          overallSeconds: timeBuckets.overall,
          last1DaySeconds: timeBuckets.last1Day,
          last7DaysSeconds: timeBuckets.last7Days,
          overallMinutes: toMinutes(timeBuckets.overall),
          last1DayMinutes: toMinutes(timeBuckets.last1Day),
          last7DaysMinutes: toMinutes(timeBuckets.last7Days),
          perDay, // array for plotting graph
        },
        appAnalytics,
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




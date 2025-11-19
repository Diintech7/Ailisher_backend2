const router = require("express").Router()
const { authenticateMobileUser } = require("../middleware/mobileAuth")
const AppAnalytics = require("../models/AppAnalytics")
const { ensureUserBelongsToClient } = require("../middleware/mobileAuth")

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

router.post(
    "/",
    authenticateMobileUser,
    ensureUserBelongsToClient,
    async (req, res) => {
      try {
        const userId = req.user.id;
        const { total_time, pages } = req.body;
  
        if (!total_time || !pages || !Array.isArray(pages)) {
          return res.status(400).json({
            success: false,
            message: "Invalid input structure",
            responseCode: 1681,
          });
        }
  
        const analytics = new AppAnalytics({
          userId,
          total_time,
          pages,
        });
  
        await analytics.save();
  
        return res.status(200).json({
          success: true,
          message: "Analytics saved successfully",
          responseCode: 1680,
          data: analytics
        });
  
      } catch (err) {
        console.error("Error saving analytics:", err);
        return res.status(500).json({
          success: false,
          message: "Server error",
          responseCode: 1682
        });
      }
    }
  );

router.get("/", authenticateMobileUser, ensureUserBelongsToClient, async (req, res) => {
  try {
    const userId = req.user.id
    const analytics = await AppAnalytics.find({ userId }).sort({ createdAt: 1 }).lean()

    const now = Date.now()
    const oneDayAgo = now - MS_IN_DAY
    const sevenDaysAgo = now - 7 * MS_IN_DAY

    let last1DaySeconds = 0
    let last7DaysSeconds = 0

    // For graph: usage per day for last 7 days (including days with 0)
    const perDayMap = new Map()

    analytics.forEach((entry) => {
      if (!entry.createdAt) return
      const ts = new Date(entry.createdAt).getTime()
      if (Number.isNaN(ts)) return

      const secs = parseDurationToSeconds(entry.total_time)
      if (!secs) return

      // 7-day and 1-day windows
      if (ts >= sevenDaysAgo) {
        last7DaysSeconds += secs
      }
      if (ts >= oneDayAgo) {
        last1DaySeconds += secs
      }

      // Per-day accumulation (for last 7 days graph)
      if (ts >= sevenDaysAgo) {
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

    return res.status(200).json({
      success: true,
      message: "Analytics fetched successfully",
      responseCode: 1683,
      summary: {
        last1DaySeconds,
        last7DaysSeconds,
        last1DayMinutes: Math.round(last1DaySeconds / 60),
        last7DaysMinutes: Math.round(last7DaysSeconds / 60),
        perDay, // array for plotting graph
      },
      data: analytics,
      
    })
  } catch (err) {
    console.error("Error fetching analytics:", err)
    return res.status(500).json({
      success: false,
      message: "Server error",
      responseCode: 1684,
    })
  }
})

router.get("/:userId/analytics", async (req, res) =>{ 
  try {
    const userId = req.params.userId
    const analytics = await AppAnalytics.find({ userId }).sort({ createdAt: 1 }).lean()

    const now = Date.now()
    const oneDayAgo = now - MS_IN_DAY
    const sevenDaysAgo = now - 7 * MS_IN_DAY

    let last1DaySeconds = 0
    let last7DaysSeconds = 0

    // For graph: usage per day for last 7 days (including days with 0)
    const perDayMap = new Map()

    analytics.forEach((entry) => {
      if (!entry.createdAt) return
      const entryDate = new Date(entry.createdAt)
      const ts = entryDate.getTime()
      if (Number.isNaN(ts)) return

      const secs = parseDurationToSeconds(entry.total_time)
      if (!secs) return

      // 7-day and 1-day windows
      if (ts >= sevenDaysAgo) {
        last7DaysSeconds += secs
      }
      if (ts >= oneDayAgo) {
        last1DaySeconds += secs
      }

      // Per-day accumulation - include ALL entries to capture all dates
      // This ensures we don't miss any dates due to timezone or window issues
      const dayKey = entryDate.toISOString().slice(0, 10) // YYYY-MM-DD in UTC
      const prev = perDayMap.get(dayKey) || 0
      perDayMap.set(dayKey, prev + secs)
    })

    // Build an array for the last 7 calendar days (including today), even if 0
    // Use UTC dates consistently to match entry dates
    const perDay = []
    const todayUTC = new Date(now)
    todayUTC.setUTCHours(0, 0, 0, 0) // Start of today in UTC
    
    for (let i = 6; i >= 0; i--) {
      const dayDate = new Date(todayUTC)
      dayDate.setUTCDate(todayUTC.getUTCDate() - i) // i=6: 6 days ago, i=0: today
      const dayKey = dayDate.toISOString().slice(0, 10) // YYYY-MM-DD
      const seconds = perDayMap.get(dayKey) || 0
      perDay.push({
        date: dayKey,
        seconds,
        minutes: Math.round(seconds / 60),
      })
    }

    return res.status(200).json({
      success: true,
      message: "Analytics fetched successfully",
      responseCode: 1683,
      summary: {
        last1DaySeconds,
        last7DaysSeconds,
        last1DayMinutes: Math.round(last1DaySeconds / 60),
        last7DaysMinutes: Math.round(last7DaysSeconds / 60),
        perDay, // array for plotting graph
      },
      data: analytics,
      
    })
  } catch (err) {
    console.error("Error fetching analytics:", err)
    return res.status(500).json({
      success: false,
      message: "Server error",
      responseCode: 1684,
    })
  }
});

router.put("/", authenticateMobileUser, ensureUserBelongsToClient, async (req, res) => {
    try {
        const userId = req.user.id;
        const { total_time, pages } = req.body;
        const analytics = await AppAnalytics.findByIdAndUpdate(userId, { total_time, pages }, { new: true });
        return res.status(200).json({
            success: true,
            message: "Analytics updated successfully",
            responseCode: 1685,
            data: analytics
        });
    } catch (err) {
        console.error("Error updating analytics:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            responseCode: 1686
        });
    }
});

router.delete("/", authenticateMobileUser, ensureUserBelongsToClient, async (req, res) => {
    try {
        const userId = req.user.id;
        await AppAnalytics.findByIdAndDelete(userId);
        return res.status(200).json({
            success: true,
            message: "Analytics deleted successfully",
            responseCode: 1687
        });
    } catch (err) {
        console.error("Error deleting analytics:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            responseCode: 1688
        });
    }
});
module.exports = router;
  
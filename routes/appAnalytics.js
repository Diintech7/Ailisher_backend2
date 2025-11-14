const router = require("express").Router();
const { authenticateMobileUser } = require("../middleware/mobileAuth");
const AppAnalytics = require("../models/AppAnalytics");
const { ensureUserBelongsToClient } = require("../middleware/mobileAuth");

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
        const userId = req.user.id;
        const analytics = await AppAnalytics.find({ userId });
        return res.status(200).json({
            success: true,
            message: "Analytics fetched successfully",
            responseCode: 1683,
            data: analytics
        });
    } catch (err) {
        console.error("Error fetching analytics:", err);
        return res.status(500).json({
            success: false,
            message: "Server error",
            responseCode: 1684
        });
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
  
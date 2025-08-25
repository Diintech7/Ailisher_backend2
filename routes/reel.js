// routes/reelRoutes.js
const express = require("express");
const router = express.Router();
const Reels = require("../models/Reels");
const { verifyToken, isClient } = require("../middleware/auth");
const {
  authenticateMobileUser,
  ensureUserBelongsToClient,
} = require("../middleware/mobileAuth");
const path = require("path");
const {
  generatePresignedUrl,
  generateGetPresignedUrl,
  deleteObject,
} = require("../utils/r2");

router.post("/upload-url", verifyToken, isClient, async (req, res) => {
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

    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(fileName);
    const key = `${businessName}/reels/${uniqueSuffix}${ext}`;

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
});
// @route   POST /api/reels
// @desc    Add a new reel
// @access  Admin only
router.post("/", verifyToken, isClient, async (req, res) => {
  console.log("get");
  try {
    const { title, description, youtubeLink, videoKey } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Title is required",
      });
    }
    console.log("get1");

    if (youtubeLink) {
      // Validate YouTube link
      const youtubeRegex =
        /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\s]+)/;
      if (!youtubeRegex.test(youtubeLink)) {
        return res.status(400).json({
          success: false,
          message: "Invalid YouTube URL",
        });
      }
    }

    let videoUrl = "";
    if (videoKey) {
      videoUrl = await generateGetPresignedUrl(videoKey);
    }

    console.log("get2");
    const count = await Reels.countDocuments();

    const reel = new Reels({
      title,
      description,
      youtubeLink,
      videoKey,
      videoUrl,
      createdBy: req.user.id,
      order: count + 1,
    });
    console.log("get3");

    await reel.save();
    console.log("get4");

    res.status(201).json({
      success: true,
      data: reel,
    });
  } catch (error) {
    console.error("Error adding reel:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// @route   GET /api/reels
// @desc    Get all reels
// @access  Admin only
router.get("/", verifyToken, isClient, async (req, res) => {
  try {
    const reels = await Reels.find().sort({ order: 1 });
    for (const reel of reels) {
      if (reel.videoKey) {
        let videoUrl = "";
        videoUrl = await generateGetPresignedUrl(reel.videoKey);
      }
    }

    res.json({
      success: true,
      count: reels.length,
      data: reels,
    });
  } catch (error) {
    console.error("Error fetching reels:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

router.get(
  "/user",
  authenticateMobileUser,
  ensureUserBelongsToClient,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const reels = await Reels.find().sort({ order: 1 });

      for (const reel of reels) {
        if (reel.videoKey) {
          let videoUrl = "";
          videoUrl = await generateGetPresignedUrl(reel.videoKey);
        }
      }

      const data = reels.map((r) => {
        const obj = r.toObject();
        const likedBy = Array.isArray(obj.likedBy) ? obj.likedBy : [];
        obj.isLiked = likedBy.some((id) => id?.toString() === userId?.toString());
        const viewedBy = Array.isArray(obj.viewedBy) ? obj.viewedBy : [];
        obj.isViewed = viewedBy.some((id) => id?.toString() === userId?.toString());
        return obj;
      });

      res.json({
        success: true,
        count: data.length,
        data,
      });
    } catch (error) {
      console.error("Error fetching reels:", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

router.patch("/reorder", verifyToken, isClient, async (req, res) => {
  try {
    const { reels } = req.body;

    if (!reels || !Array.isArray(reels)) {
      return res.status(400).json({
        success: false,
        message: "Reels array is required",
      });
    }

    // Update each reel with its new order
    const updatePromises = reels.map((reel, index) => {
      return Reels.findByIdAndUpdate(
        reel._id,
        { order: index + 1 },
        { new: true }
      );
    });

    for (const reel of reels) {
      if (reel.videoKey) {
        let videoUrl = "";
        videoUrl = await generateGetPresignedUrl(reel.videoKey);
      }
    }

    await Promise.all(updatePromises);

    // Fetch updated reels in new order
    const updatedReels = await Reels.find().sort({ order: 1 });

    res.json({
      success: true,
      data: updatedReels,
    });
  } catch (error) {
    console.error("Error reordering reels:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// @route   GET /api/reels/:id
// @desc    Get reel by ID
// @access  Admin only
router.get("/:id", verifyToken, isClient, async (req, res) => {
  try {
    const reel = await Reels.findById(req.params.id);

    if (!reel) {
      return res.status(404).json({
        success: false,
        message: "Reels not found",
      });
    }

    for (const reel of reel) {
      if (reel.videoKey) {
        let videoUrl = "";
        videoUrl = await generateGetPresignedUrl(reel.videoKey);
      }
    }

    res.json({
      success: true,
      data: reel,
    });
  } catch (error) {
    console.error("Error fetching reel:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// @route   PUT /api/reels/:id
// @desc    Update reel
// @access  Admin only
router.put("/:id", verifyToken, isClient, async (req, res) => {
  try {
    const { title, description, youtubeLink, videoKey, metrics } = req.body;

    const reelFields = {};
    if (title) reelFields.title = title;
    if (description !== undefined) reelFields.description = description;
    if (youtubeLink) {
      // Validate YouTube link
      const youtubeRegex =
        /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&\s]+)/;
      if (!youtubeRegex.test(youtubeLink)) {
        return res.status(400).json({
          success: false,
          message: "Invalid YouTube URL",
        });
      }
      reelFields.youtubeLink = youtubeLink;
    }

    // Handle metrics update
    if (metrics) {
      reelFields.metrics = {};
      if (metrics.views !== undefined) reelFields.metrics.views = metrics.views;
      if (metrics.likes !== undefined) reelFields.metrics.likes = metrics.likes;
      if (metrics.comments !== undefined)
        reelFields.metrics.comments = metrics.comments;
      if (metrics.shares !== undefined)
        reelFields.metrics.shares = metrics.shares;
    }

    let reel = await Reels.findById(req.params.id);

    if (!reel) {
      return res.status(404).json({
        success: false,
        message: "Reels not found",
      });
    }

    if(reel.videoKey && reel.videoUrl)
    {
     // Handle image update
    let videoUrl = reel.videoUrl;
    if (videoKey && videoKey !== reel.videoKey) {
      // Delete old image if it exists and is different
      if (reel.videoKey) {
        try {
          await deleteObject(reel.videoKey);
          console.log("Successfully deleted old image from S3:", reel.videoKey);
        } catch (error) {
          console.error("Error deleting old image from S3:", error);
        }
      }

      // Generate new presigned URL
      try {
        videoUrl = await generateGetPresignedUrl(videoKey, 604800);
      } catch (error) {
        console.error("Error generating presigned URL for new image:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to generate image URL",
        });
      }
    }
    reelFields.videoKey = videoKey;
    reelFields.videoUrl = videoUrl;
    }
    
    reel = await Reels.findByIdAndUpdate(
      req.params.id,
      { $set: reelFields },
      { new: true }
    );

    res.json({
      success: true,
      data: reel,
    });
  } catch (error) {
    console.error("Error updating reel:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// @route   DELETE /api/reels/:id
// @desc    Delete reel
// @access  Admin only
router.delete("/:id", verifyToken, isClient, async (req, res) => {
  try {
    const reel = await Reels.findById(req.params.id);

    if (!reel) {
      return res.status(404).json({
        success: false,
        message: "Reels not found",
      });
    }

    await Reels.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Reels removed",
    });
  } catch (error) {
    console.error("Error deleting reel:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Toggle isEnabled flag for a test
router.patch("/:id", verifyToken, isClient, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(userId);
    const id = req.params.id;
    const { isEnabled } = req.body || {};

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Reel ID is required" });
    }

    const reel = await Reels.findById(id);
    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    if (reel.createdBy.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // If body provides isEnabled, use it; otherwise toggle
    const newValue =
      typeof isEnabled === "boolean" ? isEnabled : !reel.isEnabled;
    reel.isEnabled = newValue;

    await reel.save();
    return res
      .status(200)
      .json({ success: true, message: "Reel isEnabled updated", reel });
  } catch (error) {
    console.error("Toggle isEnabled error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update isEnabled",
      error: error.message,
    });
  }
});

// @route   PATCH /api/reels/:id/metrics
// @desc    Update reel metrics
// @access  Admin only
router.patch("/:id/metrics", authenticateMobileUser, ensureUserBelongsToClient, async (req, res) => {
  try {
    const { views, likes, comments, shares } = req.body;

    const reel = await Reels.findById(req.params.id);

    if (!reel) {
      return res.status(404).json({
        success: false,
        message: "Reels not found",
      });
    }

    const updateFields = {};

    if (views !== undefined) updateFields["metrics.views"] = views;
    if (likes !== undefined) updateFields["metrics.likes"] = likes;
    if (comments !== undefined) updateFields["metrics.comments"] = comments;
    if (shares !== undefined) updateFields["metrics.shares"] = shares;

    const updatedReels = await Reels.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );

    res.json({
      success: true,
      data: updatedReels,
    });
  } catch (error) {
    console.error("Error updating reel metrics:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Increment view count
router.post(
  "/:id/view",
  authenticateMobileUser,
  ensureUserBelongsToClient,
  async (req, res) => {
    try {
      const userId = (req?.user?.id).toString();
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const updated = await Reels.findOneAndUpdate(
        { _id: req.params.id, viewedBy: { $ne: userId } },
        { $inc: { "metrics.views": 1 }, $addToSet: { viewedBy: userId } },
        { new: true }
      );

      if (!updated) {
        // Either reel not found or already viewed by this user; fetch to return current state
        const reel = await Reels.findById(req.params.id);
        if (!reel) return res.status(404).json({ success: false, message: "Reel not found" });
        return res.status(200).json({ success: true, data: reel, note: "already_viewed" });
      }

      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      console.error("Increment view error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Increment like count (idempotency not enforced without user-like tracking)
router.post(
  "/:id/like",
  authenticateMobileUser,
  ensureUserBelongsToClient,
  async (req, res) => {
    try {
      const userId = (req?.user?.id).toString();
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { delta } = req.body || {};
      if (typeof delta === "number") {
        const incValue = delta;
        let query;
        let update;

        if (incValue >= 1) {
          query = { _id: req.params.id, likedBy: { $ne: userId } };
          update = { $inc: { "metrics.likes": 1 }, $addToSet: { likedBy: userId } };
        } else {
          query = { _id: req.params.id, likedBy: userId };
          update = { $inc: { "metrics.likes": -1 }, $pull: { likedBy: userId } };
        }

        const updated = await Reels.findOneAndUpdate(query, update, { new: true });

        if (!updated) {
          const reel = await Reels.findById(req.params.id);
          if (!reel) return res.status(404).json({ success: false, message: "Reel not found" });
          return res.status(200).json({ success: true, data: reel, note: "no_change" });
        }

        return res.status(200).json({ success: true, data: updated });
      }

      // Toggle behavior when delta is not provided
      const liked = await Reels.findOneAndUpdate(
        { _id: req.params.id, likedBy: { $ne: userId } },
        { $inc: { "metrics.likes": 1 }, $addToSet: { likedBy: userId } },
        { new: true }
      );

      if (liked) {
        const obj = liked.toObject();
        obj.isLiked = true;
        return res.status(200).json({ success: true, data: obj, note: "liked" });
      }

      const unliked = await Reels.findOneAndUpdate(
        { _id: req.params.id, likedBy: userId },
        { $inc: { "metrics.likes": -1 }, $pull: { likedBy: userId } },
        { new: true }
      );

      if (unliked) {
        const obj = unliked.toObject();
        obj.isLiked = false;
        return res.status(200).json({ success: true, data: obj, note: "unliked" });
      }

      const reel = await Reels.findById(req.params.id);
      if (!reel) return res.status(404).json({ success: false, message: "Reel not found" });
      const obj = reel.toObject();
      obj.isLiked = Array.isArray(obj.likedBy) && obj.likedBy.some((id) => id?.toString() === userId);
      return res.status(200).json({ success: true, data: obj, note: "no_change" });
    } catch (error) {
      console.error("Increment like error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Increment share count
router.post(
  "/:id/share",
  authenticateMobileUser,
  ensureUserBelongsToClient,
  async (req, res) => {
    try {
      const updated = await Reels.findByIdAndUpdate(
        req.params.id,
        { $inc: { "metrics.shares": 1 } },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({ success: false, message: "Reel not found" });
      }

      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      console.error("Increment share error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Increment comment count (use a real comments collection to store content)
router.post(
  "/:id/comment",
  authenticateMobileUser,
  ensureUserBelongsToClient,
  async (req, res) => {
    try {
      const { text } = req.body || {};
      if (!text || !text.trim()) {
        return res.status(400).json({ success: false, message: "Comment text is required" });
      }

      const update = {
        $inc: { "metrics.comments": 1 },
        $push: {
          commentsList: {
            text: text.trim(),
            authorId: req?.user?.id,
            createdAt: new Date()
          }
        }
      };

      const updated = await Reels.findByIdAndUpdate(req.params.id, update, { new: true });

      if (!updated) {
        return res.status(404).json({ success: false, message: "Reel not found" });
      }

      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      console.error("Increment comment error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

// Fetch comments for a reel
router.get(
  "/:id/comments",
  authenticateMobileUser,
  ensureUserBelongsToClient,
  async (req, res) => {
    try {
      const reel = await Reels.findById(req.params.id).select("commentsList metrics");
      if (!reel) {
        return res.status(404).json({ success: false, message: "Reel not found" });
      }
      return res.status(200).json({ success: true, data: reel.commentsList || [] });
    } catch (error) {
      console.error("Fetch comments error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

module.exports = router;

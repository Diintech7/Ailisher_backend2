// routes/workbooks.js with subtopics integration
const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const {
  getCoverImageUploadUrl,
  getCoverImageDownloadUrl,
  getWorkbooks,
  createWorkbook,
  getWorkbook,
  updateWorkbook,
  deleteWorkbook,
  getWorkbooksformobile,
  getWorkbookSets,
  getAllWorkbookQuestions,
  addWorkbookToHighlights,
  removeWorkbookFromHighlights,
  addWorkbookToTrending,
  removeWorkbookFromTrending,
  getQuestionsForSetInWorkbook,
  getHighlightedWorkbooks,
  getTrendingWorkbooks,
  toggleIsEnabled
} = require("../controllers/workbookController");
const {
  getChapters,
  getChapter,
  createChapter,
  updateChapter,
  deleteChapter,
} = require("../controllers/workbookChapterController");
const {
  getTopics,
  getTopic,
  createTopic,
  updateTopic,
  deleteTopic,
} = require("../controllers/workbookTopicController");
const {
  getSubTopics,
  getSubTopic,
  createSubTopic,
  updateSubTopic,
  deleteSubTopic,
} = require("../controllers/workbookSubtopicController");
const { ensureUserBelongsToClient, authenticateMobileUser } = require("../middleware/mobileAuth");

// Get presigned URL for cover image upload
router.post("/cover-upload-url", verifyToken, getCoverImageUploadUrl);

// Get presigned URL for cover image
router.post("/cover-get-url", verifyToken, getCoverImageDownloadUrl);

// Main book routes
router
  .route("/")
  .get(verifyToken, getWorkbooks)
  .post(verifyToken, createWorkbook);

router.get('/getworkbooks',authenticateMobileUser, ensureUserBelongsToClient, getWorkbooksformobile);
router.get('/highlighted',verifyToken, getHighlightedWorkbooks)
router.get('/trending',verifyToken, getTrendingWorkbooks)

router.get('/:id/sets',authenticateMobileUser, ensureUserBelongsToClient, getWorkbookSets);

// Get all questions for a specific set of a workbook
router.get('/:id/sets/:setId/questions',authenticateMobileUser, ensureUserBelongsToClient, getQuestionsForSetInWorkbook);

router.route("/:id").get(verifyToken, getWorkbook);

router.route("/:id").put(verifyToken, updateWorkbook);

router.route("/:id").delete(verifyToken, deleteWorkbook);


// Highlight and Trending routes
router.post('/:id/highlight', verifyToken, addWorkbookToHighlights);
router.delete('/:id/highlight', verifyToken, removeWorkbookFromHighlights);
router.post('/:id/trending', verifyToken, addWorkbookToTrending);
router.delete('/:id/trending', verifyToken, removeWorkbookFromTrending);

// Chapter routes within workbooks
router
  .route("/:workbookId/chapters")
  .get(verifyToken, getChapters)
  .post(verifyToken, createChapter);

router
  .route("/:workbookId/chapters/:chapterId")
  .get(verifyToken, getChapter)
  .put(verifyToken, updateChapter)
  .delete(verifyToken, deleteChapter);

// Topic routes within chapters
router
  .route("/:workbookId/chapters/:chapterId/topics")
  .get(verifyToken, getTopics)
  .post(verifyToken, createTopic);

router
  .route("/:workbookId/chapters/:chapterId/topics/:topicId")
  .get(verifyToken, getTopic)
  .put(verifyToken, updateTopic)
  .delete(verifyToken, deleteTopic);

// Subtopic routes within topics
router
  .route("/:workbookId/chapters/:chapterId/topics/:topicId/subtopics")
  .get(verifyToken, getSubTopics)
  .post(verifyToken, createSubTopic);

router
  .route(
    "/:workbookId/chapters/:chapterId/topics/:topicId/subtopics/:subtopicId"
  )
  .get(verifyToken, getSubTopic)
  .put(verifyToken, updateSubTopic)
  .delete(verifyToken, deleteSubTopic);

router.patch('/:id',verifyToken, toggleIsEnabled)

module.exports = router;

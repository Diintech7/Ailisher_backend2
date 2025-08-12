const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const clientRoutes = require('./routes/client');
const userRoutes = require('./routes/user');
const datastoreRoutes = require('./routes/datastores');
const datastoreRoute = require('./routes/datastore');
const bookRoutes = require('./routes/books');
const subtopicsRoutes = require('./routes/subtopics');
const assetsRoutes = require('./routes/assets');
const videoAssetsRoutes = require('./routes/videoAssets');
const pyqAssetsRoutes = require('./routes/pyqAssets');
const subjectiveAssetsRoutes = require('./routes/subjectiveAssets');
const objectiveAssetsRoutes = require('./routes/objectiveAssets');
const workbookRoutes = require('./routes/workbooks');
const qrCodeRoutes = require('./routes/qrcode');
const pdfSplitsRoutes = require('./routes/pdfSplits');
const mobileAuthRoutes = require('./routes/mobileAuth');
const mobileBooksRoutes = require('./routes/mobileBooks');
const aiswbRoutes = require('./routes/aiswb');
const userAnswersRoutes = require('./routes/userAnswers');
const evaluationRoutes = require('./routes/evaluations'); // Updated evaluation routes
const { checkClientAccess } = require('./middleware/mobileAuth');
const adminAnswers = require('./routes/adminAnswers');
const myBooksRoutes = require('./routes/myBooks');
const myWorkbooksRoutes = require('./routes/myworkbook')
const evaluatorsRoutes = require('./routes/evaluators');
const app = express();
const mainBookstoreRoutes = require('./routes/mainBookstore');
const mobileSubmittedAnswersRoutes = require('./routes/mobileSubmittedAnswers');
const expertReviewRoutes = require('./routes/expertReview');
const evaluatorReviewsRoutes = require('./routes/evaluatorReviews');
const reviewRequestsRoutes = require('./routes/reviewRequests');
const mobileReviewsRoutes = require('./routes/mobileReviews');
const mobileQRAuthRoutes = require('./routes/mobileQRAuth');
const courseRoutes = require('./routes/Course')
const ai = require("./routes/aiServiceConfig");
const userAnswer1 = require('./routes/userAnswer1')
const youTubeRoutes = require('./routes/youtube');
const aiguidelinesRoutes = require('./routes/aiguidelines');
const subjectiveTestRoutes = require('./routes/subjectivetest');
const objectiveTestRoutes = require('./routes/objectivetest');
const objectiveTestQuestionRoutes = require('./routes/objectivetestquestion');
const subjectiveTestQuestionRoutes = require('./routes/subjectivetestquestion');
const testResultsRoutes = require('./routes/testResults');
const creditManagementRoutes = require('./routes/creditManagement');
const paytmRoutes = require('./routes/paytm')

app.use(cors())
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err))

// Verify required environment variables
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️  OPENAI_API_KEY is not configured - Chat features will be disabled")
} else {
  console.log("✅ OpenAI API key configured")
}

if (!process.env.MISTRAL_API_KEY) {
  console.warn("MISTRAL_API_KEY is not configured - OCR features will be disabled")
}

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn("Cloudinary configuration missing - PDF upload will be disabled")
}

// API routes
app.use('/api/admin/answers', require('./routes/adminAnswers'));
app.use('/api/ai', ai);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/user', userRoutes);
app.use('/api/datastores', datastoreRoutes);
app.use('/api/datastore', datastoreRoute);
app.use('/api/books', bookRoutes);
app.use('/api/aiguidelines', aiguidelinesRoutes);
app.use('/api/subtopics', subtopicsRoutes);
app.use('/api/assets', assetsRoutes);
app.use('/api/video-assets', videoAssetsRoutes);
app.use('/api/pyq-assets', pyqAssetsRoutes);
app.use('/api/subjective-assets', subjectiveAssetsRoutes);
app.use('/api/objective-assets', objectiveAssetsRoutes);
app.use('/api/workbooks', workbookRoutes);
app.use('/api/qrcode', qrCodeRoutes);
app.use('/api/books', pdfSplitsRoutes);
app.use('/api/aiswb', aiswbRoutes);
app.use('/api/mybooks', myBooksRoutes);
app.use('/api/evaluators', evaluatorsRoutes);
app.use('/api/homepage', mainBookstoreRoutes);
app.use('/api/review', expertReviewRoutes);
app.use('/api/config', require('./routes/config'));
app.use('/api/book', courseRoutes);
app.use("/api/pdf-embedding", require("./routes/pdfEmbedding"))
app.use("/api/pdf-chat", require("./routes/pdfChat"))
app.use('/api/youtube', youTubeRoutes);
app.use('/api/subjectivetests', subjectiveTestRoutes);
app.use('/api/objectivetests', objectiveTestRoutes);
app.use('/api/objectivetest-questions', objectiveTestQuestionRoutes);
app.use('/api/subjectivetest-questions', subjectiveTestQuestionRoutes);
app.use('/api/test-results', testResultsRoutes);
app.use('/api/paytm',paytmRoutes)


// Enhanced PDF processing routes with clustering and optional auth
app.use("/api/enhanced-pdf-embedding", require("./routes/pdfEmbedding"))
app.use("/api/enhanced-pdf-chat", require("./routes/pdfChat"))

// Public mobile chat endpoints (no token) — bookId only
app.use("/api/mobile/public-chat", require("./routes/mobilePublicChat"))


// Global Evaluation routes (accessible without client-specific middleware)
app.use("/api/aiswb", evaluationRoutes)

// Mobile routes with client-specific access
app.use(
  "/api/clients/:clientId/mobile/auth",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  mobileAuthRoutes,
)

app.use(
  "/api/clients/:clientId/mobile/credit",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  creditManagementRoutes,
)

app.use(
  "/api/subjectivetest/clients/:clientId",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  subjectiveTestRoutes,
)

app.use(
  "/api/objectivetest/clients/:clientId",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  objectiveTestRoutes,
)

app.use(
  "/api/objectivetest-questions/clients/:clientId",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  objectiveTestQuestionRoutes,
)

app.use(
  "/api/subjectivetest-questions/clients/:clientId",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  subjectiveTestQuestionRoutes,
)

app.use(
  "/api/clients/:clientId/homepage",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  mainBookstoreRoutes,
)

app.use(
  "/api/clients/:clientId/workbooks",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  workbookRoutes,
)

app.use(
  "/api/clients/:clientId",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  mainBookstoreRoutes,
)

app.use(
  "/api/clients/:clientId/mobile/mybooks",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  myBooksRoutes,
)

app.use(
  "/api/clients/:clientId/mobile/myworkbooks",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  myWorkbooksRoutes,
)

app.use(
  "/api/clients/:clientId/mobile/books",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  mobileBooksRoutes,
)

app.use(
  "/api/clients/:clientId/mobile/userAnswers",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  userAnswersRoutes,
)

app.use(
  "/api/clients/:clientId/mobile/userAnswers",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  userAnswer1,
)

// Client-specific evaluation routes for mobile users
app.use(
  "/api/clients/:clientId/mobile/evaluations",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  evaluationRoutes,
)

app.use(
  "/api/clients/:clientId/mobile/submitted-answers",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  mobileSubmittedAnswersRoutes,
)

app.use(
  "/api/clients/:clientId/mobile/review",
  checkClientAccess(),
  (req, res, next) => {
    req.clientId = req.params.clientId
    next()
  },
  reviewRequestsRoutes,
)

// Mount subtopics routes
app.use("/api/books/:bookId/chapters/:chapterId/topics/:topicId/subtopics", subtopicsRoutes)
app.use("/api/workbooks/:workbookId/chapters/:chapterId/topics/:topicId/subtopics", subtopicsRoutes)
app.use("/api/mobile-qr-auth", mobileQRAuthRoutes)
app.use("/api/evaluator-reviews", evaluatorReviewsRoutes)
app.use("/api/review", expertReviewRoutes)

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).json({ success: false, message: "Internal server error" })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})

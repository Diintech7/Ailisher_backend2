const express = require("express")
const router = express.Router()
const EnhancedPDFProcessor = require("../services/PDFProcessor")
const DataStore = require("../models/DatastoreItems")
const Book = require("../models/Book")

const optionalAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "")

  if (token) {
    try {
      const jwt = require("jsonwebtoken")
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      req.user = decoded
    } catch (error) {
      // Continue without auth
    }
  }

  next()
}

const processor = new EnhancedPDFProcessor({
  chunkrApiKey: process.env.CHUNKR_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY, // Changed from openaiApiKey
  astraToken: process.env.ASTRA_TOKEN,
  astraApiEndpoint: process.env.ASTRA_API_ENDPOINT,
  keyspace: process.env.ASTRA_KEYSPACE,
  collectionName: process.env.ASTRA_COLLECTION,
  embeddingModel: process.env.EMBEDDING_MODEL, // Gemini embedding model
  chatModel: process.env.CHAT_MODEL, // Gemini chat model
  vectorDimensions: process.env.VECTOR_DIMENSIONS,
  chunkSize: process.env.CHUNK_SIZE,
  chunkOverlap: process.env.CHUNK_OVERLAP,
  maxContextChunks: process.env.MAX_CONTEXT_CHUNKS,
})

router.get("/chat-health/:itemId", optionalAuth, async (req, res) => {
  try {
    const { itemId } = req.params
    const userId = req.user?.id

    let item
    if (userId) {
      item = await DataStore.findOne({
        _id: itemId,
        user: userId,
        $or: [{ fileType: "application/pdf" }, { itemType: "pdf" }],
      }).populate("book")
    } else {
      item = await DataStore.findOne({
        _id: itemId,
        $or: [{ fileType: "application/pdf" }, { itemType: "pdf" }],
      }).populate("book")
    }

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "PDF item not found or access denied",
      })
    }

    let bookId = null
    if (item.book) {
      bookId = item.book._id.toString()
    } else if (item.workbook) {
      bookId = item.workbook.toString()
    } else {
      return res.status(400).json({
        success: false,
        message: "PDF item must be associated with a book",
      })
    }

    const embeddingStatus = await processor.checkExistingEmbeddings(item.name, userId, bookId)

    res.json({
      success: true,
      status: {
        chatAvailable: embeddingStatus.exists,
        embeddingCount: embeddingStatus.count,
        fileName: item.name,
        bookId: bookId,
        collectionName: embeddingStatus.collectionName,
      },
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to check chat health",
      status: {
        chatAvailable: false,
      },
    })
  }
})

router.post("/chat/:itemId", optionalAuth, async (req, res) => {
  const startTime = Date.now()

  try {
    const { itemId } = req.params
    const { question } = req.body
    const userId = req.user?.id

    if (!question || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Question is required",
      })
    }

    let item
    if (userId) {
      item = await DataStore.findOne({
        _id: itemId,
        user: userId,
        $or: [{ fileType: "application/pdf" }, { itemType: "pdf" }],
      }).populate("book")
    } else {
      item = await DataStore.findOne({
        _id: itemId,
        $or: [{ fileType: "application/pdf" }, { itemType: "pdf" }],
      }).populate("book")
    }

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "PDF item not found or access denied",
      })
    }

    let bookId = null
    if (item.book) {
      bookId = item.book._id.toString()
    } else if (item.workbook) {
      bookId = item.workbook.toString()
    } else {
      return res.status(400).json({
        success: false,
        message: "PDF item must be associated with a book",
      })
    }

    const embeddingStatus = await processor.checkExistingEmbeddings(item.name, userId, bookId)

    if (!embeddingStatus.exists) {
      return res.status(400).json({
        success: false,
        message: "No embeddings found for this PDF. Please create embeddings first.",
        needsEmbedding: true,
        bookId: bookId,
      })
    }

    const result = await processor.answerQuestion(question, item.name, userId, false, bookId)

    const totalTime = Date.now() - startTime

    res.json({
      success: true,
      answer: result.answer,
      confidence: result.confidence,
      sources: result.sources,
      method: result.method,
      bookId: result.bookId,
      fileName: item.name,

      // Enhanced response metrics
      modelUsed: result.modelUsed,
      tokensUsed: result.tokensUsed,

      timing: {
        retrieval: result.timing.retrieval + "ms",
        processing: result.timing.processing + "ms",
        generation: result.timing.generation + "ms",
        aiProcessing: result.timing.total + "ms",
        totalResponse: totalTime + "ms",
      },
    })
  } catch (error) {
    const totalTime = Date.now() - startTime
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process chat request",
      timing: {
        totalResponse: totalTime + "ms",
      },
    })
  }
})

router.post("/chat-book-knowledge-base/:bookId", optionalAuth, async (req, res) => {
  const startTime = Date.now()

  try {
    const { bookId } = req.params
    const { question } = req.body
    const userId = req.user?.id

    if (!question || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Question is required",
      })
    }

    let book
    if (userId) {
      book = await Book.findOne({ _id: bookId })
    } else {
      book = await Book.findOne({ _id: bookId, isPublic: true })
    }

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found or access denied",
      })
    }

    const embeddingStatus = await processor.checkExistingEmbeddings(null, userId, bookId)

    if (!embeddingStatus.exists) {
      return res.status(400).json({
        success: false,
        message: "No content found in this book's knowledge base.",
        bookId: bookId,
      })
    }

    const result = await processor.answerQuestion(question, null, userId, false, bookId)
    const totalTime = Date.now() - startTime

res.json({
  success: true,
  answer: result.answer,
  confidence: result.confidence,
  sources: result.sources,
  method: result.method,
  bookId: result.bookId,
  bookTitle: book.title,

  // Enhanced response metrics
  modelUsed: result.modelUsed,
  tokensUsed: result.tokensUsed,

  timing: {
    retrieval: result.timing.retrieval + "ms",
    processing: result.timing.processing + "ms",
    generation: result.timing.generation + "ms",
    aiProcessing: result.timing.total + "ms",
    totalResponse: totalTime + "ms",
  },
})
} catch (error) {
  const totalTime = Date.now() - startTime
  res.status(500).json({
  success: false,
  message: error.message || "Failed to process chat request",
  timing: {
  totalResponse: totalTime + "ms",
  },
  })
  }
  })
  
  module.exports = router

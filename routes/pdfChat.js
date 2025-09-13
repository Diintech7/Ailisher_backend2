const express = require("express")
const router = express.Router()
const EnhancedPDFProcessor = require("../services/PDFProcessor")
const DataStore = require("../models/DatastoreItems")
const Book = require("../models/Book")
const axios = require("axios")

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

// NOTE: Internal processor is no longer used for chat. Queries are delegated to external service.

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

    // Use stored flags (from DataStore) to approximate chat availability
    res.json({
      success: true,
      status: {
        chatAvailable: !!item.isEmbedded,
        embeddingCount: item.embeddingCount || 0,
        fileName: item.name,
        bookId: bookId,
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
    const { question, history = [], query_id = `query_${Date.now()}`, session_id = `session_${Date.now()}`, top_k = 5, llm = "openai", tts = false } = req.body
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

    // Build external query payload
    const payload = {
      query_id,
      session_id,
      history,
      query: question,
      book_name: bookId,
      chapter_name: itemId,
      client_id: (item.book?.clientId || "").toString() || "",
      llm,
      top_k,
      tts,
    }

    console.log("[Chat] Calling external query API with payload:", JSON.stringify(payload))
    const extRes = await axios.post(
      "https://vectrize.ailisher.com/api/v1/rag/query",
      payload,
      { timeout: 180000 }
    )
    const extData = extRes.data || {}
    console.log("[Chat] External API Status:", extRes.status)
    console.log("[Chat] External API Response:", JSON.stringify(extData))
    const totalTime = Date.now() - startTime

    if (!extData.success) {
      return res.status(502).json({ success: false, message: extData.message || "External query failed" })
    }

    return res.json({ success: true, data: extData.data, timing: { totalResponse: totalTime + "ms" } })
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
    const { question, history = [], query_id = `query_${Date.now()}`, session_id = `session_${Date.now()}`, top_k = 5, llm = "openai", tts = false } = req.body
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

    // Build external query payload (knowledge base: omit chapter_name)
    const payload = {
      query_id,
      session_id,
      history,
      query: question,
      book_name: bookId,
      client_id: (book.clientId || "").toString() || "",
      llm,
      top_k,
      tts,
    }
    console.log("[Chat-KB] Calling external query API with payload:", JSON.stringify(payload))
    const extRes = await axios.post(
      "https://vectrize.ailisher.com/api/v1/rag/query",
      payload,
      { timeout: 180000 }
    )
    const extData = extRes.data || {}
    console.log("[Chat-KB] External API Status:", extRes.status)
    console.log("[Chat-KB] External API Response:", JSON.stringify(extData))
    const totalTime = Date.now() - startTime

    if (!extData.success) {
      return res.status(502).json({ success: false, message: extData.message || "External query failed" })
    }

    return res.json({ success: true, data: extData.data, timing: { totalResponse: totalTime + "ms" } })
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
const express = require("express")
const router = express.Router()
const EnhancedPDFProcessor = require("../services/PDFProcessor")

// Single shared processor instance (kept warm for low latency)
const processor = new EnhancedPDFProcessor({
  chunkrApiKey: process.env.CHUNKR_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  astraToken: process.env.ASTRA_TOKEN,
  astraApiEndpoint: process.env.ASTRA_API_ENDPOINT,
  keyspace: process.env.ASTRA_KEYSPACE,
  collectionName: process.env.ASTRA_COLLECTION,
  embeddingModel: process.env.EMBEDDING_MODEL,
  chatModel: process.env.CHAT_MODEL,
  vectorDimensions: process.env.VECTOR_DIMENSIONS,
  chunkSize: process.env.CHUNK_SIZE,
  chunkOverlap: process.env.CHUNK_OVERLAP,
  maxContextChunks: process.env.MAX_CONTEXT_CHUNKS,
})

// Health/status of a book's knowledge base (no auth)
router.get("/health/:bookId", async (req, res) => {
  try {
    const { bookId } = req.params
    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }

    const status = await processor.getBookKnowledgeBaseStatus(bookId)
    return res.json({ success: true, status })
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Failed", error: true })
  }
})

// Ask a question using only bookId (no token, minimal checks)
router.post("/ask/:bookId", async (req, res) => {
  const startTime = Date.now()
  try {
    const { bookId } = req.params
    const { question, fileName = null, options = {} } = req.body || {}

    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: "question is required" })
    }

    // Directly ask to avoid extra DB roundtrip (lower latency). If no docs, service returns a clear message.
    const mergedOptions = { includePrivateWhenUnauthenticated: true, ...options }
    const result = await processor.answerQuestion(question, fileName, null, false, bookId, mergedOptions)
    const totalTime = Date.now() - startTime

    return res.json({
      success: true,
      answer: result.answer,
      confidence: result.confidence,
      sources: result.sources,
      modelUsed: result.modelUsed,
      tokensUsed: result.tokensUsed,
      bookId: result.bookId,
      noInformationFound: result.noInformationFound || false,
      timing: {
        init: (result.timing.init || 0) + "ms",
        retrieval: result.timing.retrieval + "ms",
        processing: result.timing.processing + "ms",
        generation: result.timing.generation + "ms",
        totalResponse: totalTime + "ms",
      },
    })
  } catch (error) {
    const totalTime = Date.now() - startTime
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process request",
      timing: { totalResponse: totalTime + "ms" },
    })
  }
})

module.exports = router


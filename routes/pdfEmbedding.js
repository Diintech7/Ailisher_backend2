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

const processor = new EnhancedPDFProcessor({
chunkrApiKey: process.env.CHUNKR_API_KEY,
geminiApiKey: process.env.GEMINI_API_KEY, // Changed from openaiApiKey
astraToken: process.env.ASTRA_TOKEN,
astraApiEndpoint: process.env.ASTRA_API_ENDPOINT,
keyspace: process.env.ASTRA_KEYSPACE,
collectionName: process.env.ASTRA_COLLECTION,
embeddingModel: process.env.EMBEDDING_MODEL || "text-embedding-004", // Gemini embedding model
chatModel: process.env.CHAT_MODEL || "gemini-1.5-flash", // Gemini chat model
vectorDimensions: process.env.VECTOR_DIMENSIONS || "768",
chunkSize: process.env.CHUNK_SIZE || "200",
chunkOverlap: process.env.CHUNK_OVERLAP || "30",
maxContextChunks: process.env.MAX_CONTEXT_CHUNKS || "5",
})

router.post("/create-embeddings/:itemId", optionalAuth, async (req, res) => {
const startTime = Date.now()

try {
const { itemId } = req.params
const { forceReEmbed = false } = req.body
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

// Build payload to call external embedding API
const payload = {
  url: item.url,
  book_name: (item.book?._id || bookId || "").toString(),
  chapter_name: (item._id || "").toString(),
  client_id: (item.book?.clientId || "").toString() || "",
}

// Validate required payload fields
const missing = []
if (!payload.url) missing.push("url")
if (!payload.book_name) missing.push("book_name (bookId)")
if (!payload.chapter_name) missing.push("chapter_name (datastore item id)")
if (!payload.client_id) missing.push("client_id")

if (missing.length > 0) {
  console.error("[Embedding] Missing required fields:", missing)
  return res.status(400).json({
    success: false,
    message: `Missing required fields: ${missing.join(", ")}`,
    payload,
  })
}

// Quick preflight: check URL reachability
try {
  await axios.head(payload.url, { timeout: 15000 })
} catch (headErr) {
  console.warn("[Embedding] Warning: PDF URL not reachable via HEAD:", headErr.message)
}

console.log("[Embedding] About to call external API with payload:", payload)
console.time("[Embedding] External API duration")
let waitStart = Date.now()
let heartbeatCount = 0
const heartbeat = setInterval(() => {
  heartbeatCount += 1
  const elapsed = Math.round((Date.now() - waitStart) / 1000)
  console.log(`[Embedding] Waiting for external API response... ${elapsed}s elapsed (beat ${heartbeatCount})`)
}, 15000)
const externalRes = await axios.post(
  "https://vectrize.ailisher.com/api/v1/rag/process-document",
  payload,
  { timeout: 900000, validateStatus: () => true }
)

const extData = externalRes.data || {}
console.log("[Embedding] Request Payload:", payload)
console.log("[Embedding] External API Status:", externalRes.status)
console.log("[Embedding] External API Response:", JSON.stringify(extData))
console.timeEnd("[Embedding] External API duration")
clearInterval(heartbeat)
if (!extData.success || !extData.data?.success) {
  throw new Error(extData.data?.message || extData.message || "External embedding failed")
}

const processedChunks = Number(extData.data.processed_chunks || 0)

// Update DataStore item flags
item.isEmbedded = true
item.embeddingCount = processedChunks
item.embeddedAt = new Date()
await item.save()

// Update Book flags
try {
  const book = await Book.findById(bookId)
  if (book) {
    book.embedded = true
    book.embeddedAt = new Date()
    await book.save()
  }
} catch (bookUpdateError) {
  console.error("Warning: Failed to update book embedding status:", bookUpdateError.message)
}

const totalTime = Date.now() - startTime
res.json({
  success: true,
  embeddingCount: processedChunks,
  result: {
    message: extData.data.message,
    total_batches: extData.data.total_batches,
    processed_chunks: processedChunks,
    total_latency: extData.data.total_latency,
    chunking_latency: extData.data.chunking_latency,
    embedding_latency: extData.data.embedding_latency,
    embeddingCount: processedChunks,
    timing: {
      processing: extData.data.total_latency,
      embedding: extData.data.embedding_latency,
      chunking: extData.data.chunking_latency,
      total: extData.data.total_latency,
    },
  },
  timing: { total: totalTime + "ms" },
})
} catch (error) {
  const totalTime = Date.now() - startTime
  try { clearInterval(heartbeat) } catch (_) {}
  if (error.response) {
    console.error("[Embedding] External API Error Status:", error.response.status)
    console.error("[Embedding] External API Error Data:", JSON.stringify(error.response.data))
  } else {
    console.error("[Embedding] Error message:", error.message)
    if (error.code) console.error("[Embedding] Error code:", error.code)
    if (error.stack) console.error("[Embedding] Stack:\n", error.stack)
  }
  res.status(500).json({
  success: false,
  message: error.message || "Failed to create embeddings",
  timing: {
  total: totalTime + "ms",
  },
  })
  }
  })
  
  router.delete("/delete-embeddings/:itemId", optionalAuth, async (req, res) => {
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

const result = await processor.deleteExistingEmbeddings(item.name, userId, bookId)

if (result.success) {
  // Check if this was the last PDF for the book
  try {
    const remainingEmbeddings = await processor.checkExistingEmbeddings(null, userId, bookId)
    const book = await Book.findById(bookId)
    
    if (book && !remainingEmbeddings.exists) {
      // No more embeddings exist for this book, mark as not embedded
      await book.markAsNotEmbedded()
      console.log(`📚 Book ${bookId} marked as not embedded - no more PDFs`)
    } else if (book && remainingEmbeddings.exists) {
      // Update embedding stats for remaining PDFs
      const updatedStats = {
        totalFiles: remainingEmbeddings.files.length,
        totalChunks: remainingEmbeddings.count,
        collectionName: remainingEmbeddings.collectionName
      }
      await book.updateEmbeddingStats(updatedStats)
      console.log(`📚 Book ${bookId} embedding stats updated - ${remainingEmbeddings.count} chunks remaining`)
    }
  } catch (bookUpdateError) {
    console.error("Warning: Failed to update book embedding status:", bookUpdateError.message)
    // Continue with the response even if book update fails
  }

  res.json({
    success: true,
    message: "Embeddings deleted successfully",
    deletedCount: result.deletedCount,
    fileName: item.name,
    bookId: bookId,
  })
} else {
  res.status(500).json({
    success: false,
    message: result.error || "Failed to delete embeddings",
  })
}
} catch (error) {
  res.status(500).json({
  success: false,
  message: error.message || "Failed to delete embeddings",
  })
  }
  })
  
  router.get("/check-embeddings/:itemId", optionalAuth, async (req, res) => {
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

// Use stored flags only
let bookEmbeddingStatus = null
try {
  const book = await Book.findById(bookId)
  if (book) {
    bookEmbeddingStatus = {
      embedded: book.embedded,
      embeddedAt: book.embeddedAt,
    }
  }
} catch (bookError) {
  // ignore
}

res.json({
  success: true,
  hasEmbeddings: !!item.isEmbedded,
  embeddingCount: item.embeddingCount || 0,
  fileName: item.name,
  bookId: bookId,
  bookEmbeddingStatus: bookEmbeddingStatus,
})
} catch (error) {
  res.status(500).json({
  success: false,
  message: "Failed to check embedding status",
  hasEmbeddings: false,
  embeddingCount: 0,
  })
  }
  })
  
  router.get("/book-knowledge-base-status/:bookId", optionalAuth, async (req, res) => {
  try {
  const { bookId } = req.params
  const userId = req.user?.id
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

const status = await processor.getBookKnowledgeBaseStatus(bookId, userId)

// Get book embedding status
let bookEmbeddingStatus = null
try {
  const book = await Book.findById(bookId)
  if (book) {
    bookEmbeddingStatus = {
      embedded: book.embedded,
      embeddedAt: book.embeddedAt,
      embeddedBy: book.embeddedBy,
      embeddedByType: book.embeddedByType,
      embeddingStats: book.embeddingStats
    }
  }
} catch (bookError) {
  console.error("Warning: Failed to get book embedding status:", bookError.message)
}

res.json({
  success: true,
  bookId: bookId,
  bookTitle: book.title,
  ...status,
  bookEmbeddingStatus: bookEmbeddingStatus
})
} catch (error) {
  res.status(500).json({
  success: false,
  message: "Failed to get book knowledge base status",
  })
  }
  })
  
  // NEW: Get books by embedding status
router.get("/books/embedded/:clientId", optionalAuth, async (req, res) => {
  try {
    const { clientId } = req.params
    const { limit = 50 } = req.query
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "clientId is required"
      })
    }
    
    const embeddedBooks = await Book.getEmbeddedBooks(clientId, parseInt(limit))
    
    res.json({
      success: true,
      clientId: clientId,
      embeddedBooks: embeddedBooks,
      totalCount: embeddedBooks.length,
      message: `Found ${embeddedBooks.length} embedded books`
    })
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get embedded books"
    })
  }
})

router.get("/books/non-embedded/:clientId", optionalAuth, async (req, res) => {
  try {
    const { clientId } = req.params
    const { limit = 50 } = req.query
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "clientId is required"
      })
    }
    
    const nonEmbeddedBooks = await Book.getNonEmbeddedBooks(clientId, parseInt(limit))
    
    res.json({
      success: true,
      clientId: clientId,
      nonEmbeddedBooks: nonEmbeddedBooks,
      totalCount: nonEmbeddedBooks.length,
      message: `Found ${nonEmbeddedBooks.length} non-embedded books`
    })
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get non-embedded books"
    })
  }
})

router.get("/embedding-stats/:clientId", optionalAuth, async (req, res) => {
  try {
    const { clientId } = req.params
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "clientId is required"
      })
    }
    
    const stats = await Book.getEmbeddingStats(clientId)
    const statsData = stats.length > 0 ? stats[0] : {
      totalBooks: 0,
      embeddedBooks: 0,
      nonEmbeddedBooks: 0,
      totalChunks: 0,
      totalTokens: 0,
      totalFiles: 0
    }
    
    res.json({
      success: true,
      clientId: clientId,
      stats: statsData,
      message: "Embedding statistics retrieved successfully"
    })
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get embedding statistics"
    })
  }
})

module.exports = router
  
  
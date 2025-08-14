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

// Check for existing embeddings
const existingEmbeddings = await processor.checkExistingEmbeddings(item.name, userId, bookId)

if (existingEmbeddings.exists && !forceReEmbed) {
  return res.json({
    success: true,
    alreadyExists: true,
    message: "Embeddings already exist for this PDF in this book",
    embeddingCount: existingEmbeddings.count,
    fileName: item.name,
    bookId: bookId,
    collectionName: existingEmbeddings.collectionName,
    timing: {
      total: Date.now() - startTime,
    },
  })
}

// If re-embedding, delete existing embeddings first
if (forceReEmbed && existingEmbeddings.exists) {
  await processor.deleteExistingEmbeddings(item.name, userId, bookId)
}

// Get file size for metrics
let fileSizeMB = "N/A"
const totalPages = 0

try {
  const pdfResponse = await axios.head(item.url)
  const fileSize = pdfResponse.headers["content-length"]
  fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2)
} catch (error) {
  // Continue without file size info
}

const result = await processor.processPDFFromURL(item.url, item.name, userId, {
  isPublic: !userId,
  accessLevel: userId ? "private" : "public",
  itemId: item._id,
  originalFileType: item.fileType,
  bookId: bookId,
  fileSizeMB: fileSizeMB,
})

// Update book embedding status
try {
  const book = await Book.findById(bookId)
  if (book) {
    const embeddingStats = {
      totalFiles: 1, // This PDF file
      totalChunks: result.summary.chunks_inserted,
      totalTokens: result.tokensUsed || 0,
      collectionName: result.collectionName
    }
    
    await book.markAsEmbedded(userId || null, userId ? 'User' : 'MobileUser', embeddingStats)
    console.log(`✅ Book ${bookId} marked as embedded with ${result.summary.chunks_inserted} chunks`)
  }
} catch (bookUpdateError) {
  console.error("Warning: Failed to update book embedding status:", bookUpdateError.message)
  // Continue with the response even if book update fails
}

const totalTime = Date.now() - startTime

res.json({
  success: true,
  message: forceReEmbed ? "Embeddings re-created successfully" : "Embeddings created successfully",
  result: {
    fileName: item.name,
    bookId: bookId,
    collectionName: result.collectionName,
    taskId: result.taskId,
    embeddingCount: result.summary.chunks_inserted,
    summary: result.summary,

    // Enhanced metrics
    modelUsed: result.modelUsed,
    tokensUsed: result.tokensUsed,
    embeddingTime: result.timing.embedding + "ms",
    totalTime: totalTime + "ms",
    vectorSize: result.vectorSize,
    fileSizeMB: result.fileSizeMB,
    totalPages: result.totalPages,

    // Detailed timing breakdown
    timing: {
      textExtraction: result.timing.textExtraction + "ms",
      chunking: result.timing.chunking + "ms",
      embedding: result.timing.embedding + "ms",
      dbInsert: result.timing.dbInsert + "ms",
      processing: result.timing.total + "ms",
      total: totalTime + "ms",
    },
  },
})
} catch (error) {
  const totalTime = Date.now() - startTime
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

const embeddingStatus = await processor.checkExistingEmbeddings(item.name, userId, bookId)

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
  hasEmbeddings: embeddingStatus.exists,
  embeddingCount: embeddingStatus.count,
  fileName: item.name,
  bookId: bookId,
  collectionName: embeddingStatus.collectionName,
  allFiles: embeddingStatus.files,
  bookEmbeddingStatus: bookEmbeddingStatus
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
  
  
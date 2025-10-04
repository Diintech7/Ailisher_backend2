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

// POST /api/v1/rag/create-embeddings/:itemId
router.post("/create-embeddings/:itemId", optionalAuth, async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.user?.id;

    // Fetch the PDF item
    let item = await DataStore.findOne({ _id: itemId, user: userId });
    if (!item) return res.status(404).json({ success: false, message: "PDF not found" });

    // Mark as "pending" embedding
    item.embeddingStatus = "pending";
    await item.save();

    // Start async embedding
    setImmediate(async () => {
      try {
        item.embeddingStatus = "processing";
        await item.save();

        const payload = {
          url: item.url,
          book_name: item.book?._id?.toString() || "",
          chapter_name: item._id.toString(),
          client_id: item.book?.clientId || "",
        };

        // Call external API (this may take long)
        const axios = require("axios");
        const extRes = await axios.post(
          "https://vectrize.ailisher.com/api/v1/rag/process-document",
          payload,
          { timeout: 0, validateStatus: () => true } // No timeout
        );

        if (extRes.data?.success) {
          item.embeddingStatus = "completed";
          item.embeddingCount = extRes.data.data?.processed_chunks || 0;
        } else {
          item.embeddingStatus = "failed";
        }
        await item.save();
      } catch (err) {
        console.error("Async embedding error:", err.message);
        item.embeddingStatus = "failed";
        await item.save();
      }
    });

    // Immediately respond
    return res.status(202).json({
      success: true,
      message: "Embedding started",
      itemId: item._id,
      embeddingStatus: item.embeddingStatus,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

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
  
  
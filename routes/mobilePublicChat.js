const express = require("express")
const router = express.Router()
const Book = require("../models/Book")
const DataStore = require("../models/DatastoreItems")
const axios = require("axios")

// Helper function to log external API data
function logExternalAPIData(question, payload, response, method) {
  console.log("\n" + "=".repeat(80))
  console.log(`📊 EXTERNAL API CALL (${method})`)
  console.log("=".repeat(80))
  console.log(`❓ Question: ${question}`)
  console.log(`📤 Request Payload:`, JSON.stringify(payload, null, 2))
  console.log(`📥 Response Status: ${response?.status || 'N/A'}`)
  console.log(`📥 Response Data:`, JSON.stringify(response?.data, null, 2))
  console.log("=".repeat(80) + "\n")
}

// Health/status of a book's knowledge base (no auth)
router.get("/health/:bookId", async (req, res) => {
  try {
    const { bookId } = req.params
    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }

    // Check book in MongoDB
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({ success: false, message: "Book not found" })
    }

    // Check if any PDFs in the book have embeddings
    const pdfItems = await DataStore.find({
      book: bookId,
      $or: [{ fileType: "application/pdf" }, { itemType: "pdf" }],
      isEmbedded: true,
      embeddingCount: { $gt: 0 },
    })

    const status = {
      hasEmbeddings: pdfItems.length > 0,
      chatAvailable: pdfItems.length > 0,
      totalFiles: pdfItems.length,
      totalEmbeddings: pdfItems.reduce((sum, item) => sum + (item.embeddingCount || 0), 0),
      availableFiles: pdfItems.map(item => item.name),
      collectionName: "external_api",
    }

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
    const { question, history = [], client_id } = req.body || {}

    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: "question is required" })
    }

    // Validate client_id
    if (!client_id || typeof client_id !== "string" || client_id.trim().length === 0) {
      return res.status(400).json({ success: false, message: "client_id is required in body" })
    }

    // Check if book has PDF embeddings in MongoDB first
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
        timing: { totalResponse: Date.now() - startTime + "ms" },
      })
    }
    
    // Check if any PDFs in the book have embeddings
    const pdfItems = await DataStore.find({
      book: bookId,
      $or: [{ fileType: "application/pdf" }, { itemType: "pdf" }],
      isEmbedded: true,
      embeddingCount: { $gt: 0 },
    })

    if (pdfItems.length === 0) {
      return res.json({
        success: true,
        answer: "This book does not have PDF embeddings available. Please upload and embed PDF files first.",
        confidence: 0,
        sources: 0,
        modelUsed: "none",
        tokensUsed: 0,
        bookId: bookId,
        method: "book-not-embedded",
        filesUsed: [],
        totalFilesAvailable: 0,
        noInformationFound: true,
        isQuestionRelated: false,
        bookEmbedded: false,
        timing: {
          init: Date.now() - startTime + "ms",
          retrieval: "0ms",
          processing: "0ms",
          generation: "0ms",
          totalResponse: Date.now() - startTime + "ms",
        },
      })
    }

    console.log(`🤖 Calling external knowledge base chat API...`)
    console.log(`[Public Chat] Using client_id from body: ${client_id}`)
    
    // Call external chat API for knowledge base (no chapter_name)
    const payload = {
      query_id: `public_${Date.now()}`,
      session_id: `public_session_${bookId}`,
      history: history,
      query: question.trim(),
      book_name: bookId,
      chapter_name: "", // Empty for knowledge base
      client_id: client_id,
      llm: "openai",
      top_k: 5,
      tts: false,
    }

    console.log(`[Public Chat] Calling external query API with payload:`, payload)
    const extRes = await axios.post(
      "https://vectrizebackend.onrender.com/api/v1/rag/query",
      payload,
      { timeout: 180000 }
    )
    const extData = extRes.data || {}
    console.log(`[Public Chat] External API Status:`, extRes.status)
    console.log(`[Public Chat] External API Response:`, JSON.stringify(extData))

    const processingTime = Date.now() - startTime

    if (!extData.success) {
      return res.status(502).json({
        success: false,
        message: extData.message || "External query failed",
        timing: { totalResponse: processingTime + "ms" },
      })
    }

    // Log external API data
    logExternalAPIData(question, payload, extRes, "public-knowledge-base")

    // Return only the new external API format
    return res.json({ success: true, data: extData.data })
  } catch (error) {
    const totalTime = Date.now() - startTime
    console.error("Error in /ask/:bookId endpoint:", error)
    if (error.response) {
      console.error("[Public Chat] External API Error Status:", error.response.status)
      console.error("[Public Chat] External API Error Data:", JSON.stringify(error.response.data))
    } else {
      console.error("[Public Chat] Error:", error.message)
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process request",
      timing: { totalResponse: totalTime + "ms" },
    })
  }
})

// Get raw data for knowledge base testing
router.get("/raw-data/:bookId", async (req, res) => {
  try {
    const { bookId } = req.params
    const { question = "test question", limit = 10 } = req.query

    console.log(`🔍 Getting raw data for bookId: ${bookId}`)

    // Check book in MongoDB
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
        bookId: bookId,
      })
    }

    // Get PDF items with embeddings
    const pdfItems = await DataStore.find({
      book: bookId,
      $or: [{ fileType: "application/pdf" }, { itemType: "pdf" }],
      isEmbedded: true,
      embeddingCount: { $gt: 0 },
    }).select("_id name fileType itemType url isEmbedded embeddingCount embeddedAt")

    if (pdfItems.length === 0) {
      return res.json({
        success: true,
        bookId: bookId,
        bookTitle: book.title,
        clientId: book.clientId,
        hasEmbeddings: false,
        message: "No embedded PDFs found in this book",
        pdfItems: [],
        totalEmbeddings: 0,
        testPayload: null,
      })
    }

    // Create test payload for external API
    const testPayload = {
      query_id: `test_${Date.now()}`,
      session_id: `test_session_${bookId}`,
      history: [],
      query: question,
      book_name: bookId,
      chapter_name: "", // Empty for knowledge base
      client_id: book.clientId || "test_user",
      llm: "openai",
      top_k: parseInt(limit),
      tts: false,
    }

    // Test external API call
    let externalResponse = null
    let externalError = null
    
    try {
      console.log(`[Raw Data] Testing external API with payload:`, testPayload)
      const extRes = await axios.post(
        "https://vectrizebackend.onrender.com/api/v1/rag/query",
        testPayload,
        { timeout: 30000 }
      )
      externalResponse = {
        status: extRes.status,
        data: extRes.data,
      }
      console.log(`[Raw Data] External API Response:`, externalResponse)
    } catch (error) {
      externalError = {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
      }
      console.error(`[Raw Data] External API Error:`, externalError)
    }

    return res.json({
      success: true,
      bookId: bookId,
      bookTitle: book.title,
      clientId: book.clientId,
      hasEmbeddings: true,
      totalEmbeddings: pdfItems.reduce((sum, item) => sum + (item.embeddingCount || 0), 0),
      pdfItems: pdfItems.map(item => ({
        id: item._id,
        name: item.name,
        fileType: item.fileType,
        itemType: item.itemType,
        url: item.url,
        isEmbedded: item.isEmbedded,
        embeddingCount: item.embeddingCount,
        embeddedAt: item.embeddedAt,
      })),
      testPayload: testPayload,
      externalAPI: {
        url: "https://vectrizebackend.onrender.com/api/v1/rag/query",
        response: externalResponse,
        error: externalError,
        success: !externalError,
      },
      message: `Found ${pdfItems.length} embedded PDFs with ${pdfItems.reduce((sum, item) => sum + (item.embeddingCount || 0), 0)} total embeddings`,
    })
  } catch (error) {
    console.error("Error getting raw data:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get raw data",
      bookId: req.params.bookId,
    })
  }
})

// Enhanced book-level question asking with comprehensive analysis
router.post("/ask-enhanced/:bookId", async (req, res) => {
  const startTime = Date.now()
  try {
    const { bookId } = req.params
    const { question, options = {} } = req.body || {}

    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: "question is required" })
    }

    // Use enhanced book-level processing
    const mergedOptions = { 
      includePrivateWhenUnauthenticated: true,
      enhancedMode: true,
      ...options 
    }
    
    // Check if book has PDF embeddings in MongoDB first
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
        timing: { totalResponse: Date.now() - startTime + "ms" },
      })
    }
    
    if (!book.embedded) {
      return res.json({
        success: true,
        answer: "This book does not have PDF embeddings available. Please upload and embed PDF files first.",
        confidence: 0,
        sources: 0,
        modelUsed: "none",
        tokensUsed: 0,
        bookId: bookId,
        method: "book-not-embedded",
        filesUsed: [],
        totalFilesAvailable: 0,
        noInformationFound: true,
        isQuestionRelated: false,
        bookEmbedded: false,
        timing: {
          init: Date.now() - startTime + "ms",
          retrieval: "0ms",
          processing: "0ms",
          generation: "0ms",
          totalResponse: Date.now() - startTime + "ms",
        },
      })
    }
    
    // Initialize the processor for this book first
    try {
      await processor.initializeBookDB(bookId)
    } catch (initError) {
      console.error("Failed to initialize book database:", initError.message)
      return res.status(500).json({
        success: false,
        message: `Failed to initialize book database: ${initError.message}`,
        timing: { totalResponse: Date.now() - startTime + "ms" },
      })
    }
    
    // Get the raw results after proper initialization
    let rawResults = []
    try {
      rawResults = await processor.dbVectorSearch(question, { book_id: bookId }, 800)
    } catch (searchError) {
      console.error("Vector search failed:", searchError.message)
      // Fallback to basic search if vector search fails
      try {
        const basicResults = await processor.collection.find({ book_id: bookId }).limit(100).toArray()
        rawResults = basicResults.map(doc => ({ ...doc, $similarity: 0.5 }))
      } catch (fallbackError) {
        console.error("Fallback search also failed:", fallbackError.message)
        rawResults = []
      }
    }
    
    // Log the Astra DB data being sent to AI
    logAstraDBData(question, rawResults, "enhanced-book-level")
    
    const result = await processor.answerBookLevelQuestion(question, bookId, null, mergedOptions)
    const totalTime = Date.now() - startTime

    return res.json({
      success: true,
      answer: result.answer,
      confidence: result.confidence,
      sources: result.sources,
      modelUsed: result.modelUsed,
      tokensUsed: result.tokensUsed,
      bookId: result.bookId,
      method: result.method,
      filesUsed: result.filesUsed || [],
      totalFilesAvailable: result.totalFilesAvailable || 0,
      chunkDetails: result.chunkDetails || [],
      enhancedAnalysis: true,
      isQuestionRelated: result.isQuestionRelated || false,
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
    console.error("Error in /ask-enhanced/:bookId endpoint:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process enhanced request",
      timing: { totalResponse: totalTime + "ms" },
    })
  }
})

// Fast book-level question asking for quick responses
router.post("/ask-fast/:bookId", async (req, res) => {
  const startTime = Date.now()
  try {
    const { bookId } = req.params
    const { question, options = {} } = req.body || {}

    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: "question is required" })
    }

    // Use fast book-level processing
    const mergedOptions = { 
      includePrivateWhenUnauthenticated: true,
      fastMode: true,
      ...options 
    }
    
    // Check if book has PDF embeddings in MongoDB first
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
        timing: { totalResponse: Date.now() - startTime + "ms" },
      })
    }
    
    if (!book.embedded) {
      return res.json({
        success: true,
        answer: "This book does not have PDF embeddings available. Please upload and embed PDF files first.",
        confidence: 0,
        sources: 0,
        modelUsed: "none",
        tokensUsed: 0,
        bookId: bookId,
        method: "book-not-embedded",
        filesUsed: [],
        totalFilesAvailable: 0,
        noInformationFound: true,
        isQuestionRelated: false,
        bookEmbedded: false,
        timing: {
          init: Date.now() - startTime + "ms",
          retrieval: "0ms",
          processing: "0ms",
          generation: "0ms",
          totalResponse: Date.now() - startTime + "ms",
        },
      })
    }
    
    // Initialize the processor for this book first
    try {
      await processor.initializeBookDB(bookId)
    } catch (initError) {
      console.error("Failed to initialize book database:", initError.message)
      return res.status(500).json({
        success: false,
        message: `Failed to initialize book database: ${initError.message}`,
        timing: { totalResponse: Date.now() - startTime + "ms" },
      })
    }
    
    // Get the raw results after proper initialization
    let rawResults = []
    try {
      rawResults = await processor.dbVectorSearch(question, { book_id: bookId }, 300)
    } catch (searchError) {
      console.error("Vector search failed:", searchError.message)
      // Fallback to basic search if vector search fails
      try {
        const basicResults = await processor.collection.find({ book_id: bookId }).limit(100).toArray()
        rawResults = basicResults.map(doc => ({ ...doc, $similarity: 0.5 }))
      } catch (fallbackError) {
        console.error("Fallback search also failed:", fallbackError.message)
        rawResults = []
      }
    }
    
    // Log the Astra DB data being sent to AI
    logAstraDBData(question, rawResults, "fast-book-level")
    
    const result = await processor.answerBookLevelQuestion(question, bookId, null, mergedOptions)
    const totalTime = Date.now() - startTime

    // Determine status code based on RAG usage and information found
    let statusCode = 1001 // RAG_SUCCESS
    let statusMessage = "Answer generated successfully using RAG (Retrieval-Augmented Generation)"
    
    if (result.noInformationFound || result.sources === 0) {
      statusCode = 1002 // NO_RAG_DATA
      statusMessage = "No relevant information found in knowledge base, answer generated without RAG"
    } else if (result.method === "book-not-embedded") {
      statusCode = 1003 // BOOK_NOT_EMBEDDED
      statusMessage = "Book has no PDF embeddings, RAG not available"
    } else if (result.filesUsed && result.filesUsed.length === 0) {
      statusCode = 1004 // RAG_NO_SOURCES
      statusMessage = "RAG processed but no source files were used in answer generation"
    } else if (result.isQuestionRelated === false) {
      statusCode = 1005 // RAG_LOW_RELEVANCE
      statusMessage = "RAG processed but question may not be highly relevant to available content"
    }

    return res.json({
      success: true,
      statusCode: statusCode,
      statusMessage: statusMessage,
      answer: result.answer,
      confidence: result.confidence,
      sources: result.sources,
      modelUsed: result.modelUsed,
      tokensUsed: result.tokensUsed,
      bookId: result.bookId,
      method: result.method,
      filesUsed: result.filesUsed || [],
      totalFilesAvailable: result.totalFilesAvailable || 0,
      fastMode: true,
      isQuestionRelated: result.isQuestionRelated || false,
      noInformationFound: result.noInformationFound || false,
             ragUsed: statusCode === 1001,
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
    console.error("Error in /ask-fast/:bookId endpoint:", error)
    return res.status(500).json({
      success: false,
      statusCode: 1006, // PROCESSING_ERROR
      statusMessage: "Failed to process fast request due to internal error",
      message: error.message || "Failed to process fast request",
      timing: { totalResponse: totalTime + "ms" },
    })
  }
})

// Status check endpoint for fast book-level questions (for app developers)
router.get("/ask-fast-status/:bookId", async (req, res) => {
  const startTime = Date.now()
  try {
    const { bookId } = req.params

    if (!bookId) {
      return res.status(400).json({ 
        success: false, 
        message: "bookId is required",
        statusCode: "MISSING_BOOK_ID",
        timing: { totalResponse: Date.now() - startTime + "ms" }
      })
    }

    console.log(`🚀 Checking fast mode status for bookId: ${bookId}`)

    // Check if book exists in MongoDB first
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
        statusCode: "BOOK_NOT_FOUND",
        bookId: bookId,
        timing: { totalResponse: Date.now() - startTime + "ms" },
      })
    }

    // Check if book has embeddings
    if (!book.embedded) {
      return res.json({
        success: true,
        statusCode: "BOOK_NOT_EMBEDDED",
        bookId: bookId,
        bookTitle: book.title,
        fastModeAvailable: false,
        message: "Book exists but has no PDF embeddings. Fast mode not available.",
        recommendation: "Upload and embed PDF files first to enable fast mode.",
        bookEmbedded: false,
        timing: { totalResponse: Date.now() - startTime + "ms" }
      })
    }

    // Book is embedded, check Astra DB connection
    let astraStatus = "UNKNOWN"
    let collectionName = null
    let totalEmbeddings = 0
    let uniqueFiles = []

    try {
      await processor.initializeBookDB(bookId)
      astraStatus = "CONNECTED"
      collectionName = processor.collection?.collectionName || null
      
      // Get basic stats from Astra DB
      try {
        const count = await processor.collection.countDocuments({ book_id: bookId })
        totalEmbeddings = count
        
        const files = await processor.collection.distinct("file_name", { book_id: bookId })
        uniqueFiles = files
      } catch (statsError) {
        console.warn("Could not get detailed stats from Astra DB:", statsError.message)
      }
    } catch (initError) {
      astraStatus = "FAILED"
      console.error("Failed to initialize book database:", initError.message)
    }

    const responseTime = Date.now() - startTime

    // Determine overall status
    let overallStatus = "READY"
    let statusMessage = "Fast mode is available and ready to use"
    
    if (astraStatus === "FAILED") {
      overallStatus = "ASTRA_DB_ERROR"
      statusMessage = "Book has embeddings but Astra DB connection failed"
    } else if (totalEmbeddings === 0) {
      overallStatus = "NO_EMBEDDINGS"
      statusMessage = "Book is marked as embedded but no embeddings found in database"
    }

    return res.json({
      success: true,
      statusCode: overallStatus,
      bookId: bookId,
      bookTitle: book.title,
      fastModeAvailable: overallStatus === "READY",
      message: statusMessage,
      bookEmbedded: true,
      astraDbStatus: astraStatus,
      collectionName: collectionName,
      totalEmbeddings: totalEmbeddings,
      uniqueFiles: uniqueFiles,
      fileCount: uniqueFiles.length,
      recommendation: overallStatus === "READY" 
        ? "Fast mode is ready to use. Send POST request to /ask-fast/:bookId with question in body."
        : "Fix the issue before using fast mode.",
      timing: { totalResponse: responseTime + "ms" },
      endpoint: {
        method: "POST",
        url: `/ask-fast/${bookId}`,
        bodyFormat: {
          question: "string (required)",
          options: "object (optional)"
        }
      }
    })

  } catch (error) {
    const totalTime = Date.now() - startTime
    console.error("Error in /ask-fast-status/:bookId endpoint:", error)
    return res.status(500).json({
      success: false,
      statusCode: "INTERNAL_ERROR",
      message: error.message || "Failed to check fast mode status",
      timing: { totalResponse: totalTime + "ms" },
    })
  }
})

// New endpoint to directly view Astra DB data without AI processing
router.post("/view-data/:bookId", async (req, res) => {
  try {
    const { bookId } = req.params
    const { question, limit = 50 } = req.body || {}

    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }

    // Check if book has PDF embeddings in MongoDB first
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({ 
        success: false, 
        message: "Book not found" 
      })
    }
    
    if (!book.embedded) {
      return res.json({
        success: true,
        bookId: bookId,
        question: question || 'No question provided',
        totalResults: 0,
        searchMethod: 'none',
        results: [],
        summary: {
          uniqueFiles: 0,
          totalWords: 0,
          totalChars: 0,
          avgSimilarity: 'N/A'
        },
        message: "This book does not have PDF embeddings available",
        bookEmbedded: false
      })
    }

    // Initialize the book database
    await processor.initializeBookDB(bookId)
    
    let searchFilter = { book_id: bookId }
    let results = []
    
    if (question && question.trim().length > 0) {
      // Vector search with the question
      results = await processor.dbVectorSearch(question, searchFilter, limit)
    } else {
      // Just get raw documents without vector search
      results = await processor.collection.find(searchFilter).limit(limit).toArray()
    }

    // Format the results for display
    const formattedResults = results.map((doc, index) => ({
      index: index + 1,
      fileName: doc.file_name || 'Unknown',
      chunkIndex: doc.chunk_index || 'Unknown',
      similarity: doc.$similarity ? Math.round(doc.$similarity * 100) + '%' : 'N/A',
      wordCount: doc.word_count || 'Unknown',
      charCount: doc.char_count || 'Unknown',
      textContent: doc.text_content ? doc.text_content.substring(0, 200) + '...' : 'No content',
      vectorDimensions: doc.$vector ? doc.$vector.length : 'No vector',
      processedAt: doc.processed_at || 'Unknown',
      metadata: {
        bookId: doc.book_id,
        userId: doc.user_id,
        isPublic: doc.is_public,
        accessLevel: doc.access_level
      }
    }))

    return res.json({
      success: true,
      bookId: bookId,
      question: question || 'No question provided (showing raw data)',
      totalResults: results.length,
      searchMethod: question ? 'vector-search' : 'raw-query',
      results: formattedResults,
      summary: {
        uniqueFiles: [...new Set(results.map(r => r.file_name))].length,
        totalWords: results.reduce((sum, r) => sum + (r.word_count || 0), 0),
        totalChars: results.reduce((sum, r) => sum + (r.char_count || 0), 0),
        avgSimilarity: question ? (results.reduce((sum, r) => sum + (r.$similarity || 0), 0) / results.length) : 'N/A'
      }
    })

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to retrieve data",
      error: true
    })
  }
})

// Check if book data exists in database
router.get("/check-book-data/:bookId", async (req, res) => {
  try {
    const { bookId } = req.params
    const startTime = Date.now()

    console.log(`🔍 Checking book data existence for bookId: ${bookId}`)

    // Check if book data already exists in MongoDB
    const book = await Book.findOne({ _id: bookId })
    if (book) {
      console.log(`Book data found in MongoDB for bookId: ${bookId}`)
      return res.json({
        success: true,
        bookId: bookId,
        dataExists: true,
        totalEmbeddings: book.totalEmbeddings || 0,
        uniqueFiles: book.uniqueFiles || [],
        fileCount: book.uniqueFiles ? book.uniqueFiles.length : 0,
        collectionName: book.collectionName,
        hasEmbeddings: true,
        chatAvailable: book.chatAvailable,
        timing: { totalResponse: Date.now() - startTime + "ms" },
        message: `Book data found with ${book.totalEmbeddings || 0} embeddings across ${book.uniqueFiles ? book.uniqueFiles.length : 0} files`
      })
    }

    // If not in MongoDB, check Astra DB
    try {
      await processor.initializeBookDB(bookId)
    } catch (initError) {
      console.error("Failed to initialize book database:", initError.message)
      return res.status(500).json({
        success: false,
        message: `Failed to initialize book database: ${initError.message}`,
        bookId: bookId,
        dataExists: false,
        timing: { totalResponse: Date.now() - startTime + "ms" },
      })
    }

    // Check for existing embeddings
    const status = await processor.checkExistingEmbeddings(null, null, bookId)
    
    const responseTime = Date.now() - startTime

    return res.json({
      success: true,
      bookId: bookId,
      dataExists: status.exists,
      totalEmbeddings: status.count,
      uniqueFiles: status.files,
      fileCount: status.files.length,
      collectionName: status.collectionName,
      hasEmbeddings: status.exists,
      chatAvailable: status.exists,
      timing: { totalResponse: responseTime + "ms" },
      message: status.exists 
        ? `Book data found with ${status.count} embeddings across ${status.files.length} files`
        : "No book data found in database"
    })

  } catch (error) {
    console.error("Error checking book data:", error.message)
    return res.status(500).json({
      success: false,
      message: `Error checking book data: ${error.message}`,
      bookId: req.params.bookId,
      dataExists: false,
      timing: { totalResponse: Date.now() - startTime + "ms" },
    })
  }
})

// Get comprehensive book knowledge base status
router.get("/book-status/:bookId", async (req, res) => {
  try {
    const { bookId } = req.params
    const startTime = Date.now()

    console.log(`📊 Getting comprehensive book status for bookId: ${bookId}`)

    // Check book in MongoDB first
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
        bookId: bookId,
        timing: { totalResponse: Date.now() - startTime + "ms" },
      })
    }

    // If book is not embedded, return basic status without Astra DB connection
    if (!book.embedded) {
      const responseTime = Date.now() - startTime
      return res.json({
        success: true,
        bookId: bookId,
        bookTitle: book.title,
        hasEmbeddings: false,
        chatAvailable: false,
        fileCount: 0,
        totalEmbeddings: 0,
        collectionName: null,
        vectorSize: null,
        modelUsed: null,
        bookEmbedded: false,
        timing: { totalResponse: responseTime + "ms" },
        summary: {
          hasData: false,
          canChat: false,
          totalFiles: 0,
          totalEmbeddings: 0,
          collectionName: null,
          vectorSize: null,
          modelUsed: null
        },
        message: "Book exists but has no PDF embeddings"
      })
    }

    // Book is embedded, get detailed status from Astra DB
    try {
      await processor.initializeBookDB(bookId)
    } catch (initError) {
      console.error("Failed to initialize book database:", initError.message)
      // Return book status from MongoDB even if Astra DB fails
      const responseTime = Date.now() - startTime
      return res.json({
        success: true,
        bookId: bookId,
        bookTitle: book.title,
        hasEmbeddings: true,
        chatAvailable: true,
        fileCount: book.embeddingStats?.totalFiles || 0,
        totalEmbeddings: book.embeddingStats?.totalChunks || 0,
        collectionName: book.embeddingStats?.collectionName || null,
        vectorSize: null,
        modelUsed: null,
        bookEmbedded: true,
        timing: { totalResponse: responseTime + "ms" },
        summary: {
          hasData: true,
          canChat: true,
          totalFiles: book.embeddingStats?.totalFiles || 0,
          totalEmbeddings: book.embeddingStats?.totalChunks || 0,
          collectionName: book.embeddingStats?.collectionName || null,
          vectorSize: null,
          modelUsed: null
        },
        message: "Book has embeddings but Astra DB connection failed"
      })
    }

    // Get comprehensive status from Astra DB
    const status = await processor.getBookKnowledgeBaseStatus(bookId)
    
    const responseTime = Date.now() - startTime

    return res.json({
      success: true,
      bookId: bookId,
      ...status,
      timing: { totalResponse: responseTime + "ms" },
      summary: {
        hasData: status.hasEmbeddings,
        canChat: status.chatAvailable,
        totalFiles: status.fileCount,
        totalEmbeddings: status.totalEmbeddings,
        collectionName: status.collectionName,
        vectorSize: status.vectorSize,
        modelUsed: status.modelUsed
      }
    })

  } catch (error) {
    console.error("Error getting book status:", error.message)
    return res.status(500).json({
      success: false,
      message: `Error getting book status: ${error.message}`,
      bookId: req.params.bookId,
      timing: { totalResponse: Date.now() - startTime + "ms" },
    })
  }
})

// NEW: Check book embedded status from MongoDB only (no Astra DB connection)
router.get("/book-embedded-status/:bookId", async (req, res) => {
  try {
    const { bookId } = req.params
    const startTime = Date.now()

    if (!bookId) {
      return res.status(400).json({ 
        success: false, 
        message: "bookId is required",
        statusCode: 2001 // MISSING_BOOK_ID
      })
    }

    console.log(`🔍 Checking book embedded status from MongoDB for bookId: ${bookId}`)

    // Check book in MongoDB only
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
        statusCode: 2002, // BOOK_NOT_FOUND
        bookId: bookId,
        timing: { totalResponse: Date.now() - startTime + "ms" },
      })
    }

    const responseTime = Date.now() - startTime

    // Determine status code based on book embedded status
    let statusCode = 2003 // BOOK_NOT_EMBEDDED
    let statusMessage = `Book "${book.title}" needs PDF embeddings`
    
    if (book.embedded) {
      statusCode = 2004 // BOOK_EMBEDDED
      statusMessage = `Book "${book.title}" has PDF embeddings available`
    }

    return res.json({
      success: true,
      statusCode: statusCode,
      statusMessage: statusMessage,
      bookId: bookId,
      bookTitle: book.title,
      embedded: book.embedded,
      embeddedAt: book.embeddedAt,
      embeddedBy: book.embeddedBy,
      embeddedByType: book.embeddedByType,
      embeddingStats: book.embeddingStats || {
        totalFiles: 0,
        totalChunks: 0,
        totalTokens: 0,
        lastUpdated: null,
        collectionName: null
      },
      chatAvailable: book.embedded,
      message: statusMessage,
      timing: { totalResponse: responseTime + "ms" }
    })

  } catch (error) {
    console.error("Error checking book embedded status:", error.message)
    return res.status(500).json({
      success: false,
      statusCode: 2005, // PROCESSING_ERROR
      statusMessage: "Failed to check book embedded status due to internal error",
      message: `Error checking book embedded status: ${error.message}`,
      bookId: req.params.bookId,
      timing: { totalResponse: Date.now() - startTime + "ms" },
    })
  }
})

// NEW: Get all books with embedded status for a client (MongoDB only)
router.get("/books-embedded-status/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params
    const { limit = 100, embedded = null } = req.query
    const startTime = Date.now()

    if (!clientId) {
      return res.status(400).json({ 
        success: false, 
        message: "clientId is required" 
      })
    }

    console.log(`📚 Getting books embedded status for clientId: ${clientId}`)

    // Build query filter
    let filter = { clientId: clientId }
    if (embedded !== null) {
      filter.embedded = embedded === 'true'
    }

    // Get books from MongoDB only
    const books = await Book.find(filter)
      .select('title embedded embeddedAt embeddingStats')
      .limit(parseInt(limit))
      .sort({ embedded: -1, embeddedAt: -1, createdAt: -1 })

    const responseTime = Date.now() - startTime

    // Calculate summary statistics
    const totalBooks = books.length
    const embeddedBooks = books.filter(b => b.embedded).length
    const nonEmbeddedBooks = totalBooks - embeddedBooks
    const totalFiles = books.reduce((sum, b) => sum + (b.embeddingStats?.totalFiles || 0), 0)
    const totalChunks = books.reduce((sum, b) => sum + (b.embeddingStats?.totalChunks || 0), 0)

    return res.json({
      success: true,
      clientId: clientId,
      totalBooks: totalBooks,
      embeddedBooks: embeddedBooks,
      nonEmbeddedBooks: nonEmbeddedBooks,
      totalFiles: totalFiles,
      totalChunks: totalChunks,
      embeddingProgress: totalBooks > 0 ? Math.round((embeddedBooks / totalBooks) * 100) : 0,
      books: books.map(book => ({
        bookId: book._id,
        title: book.title,
        embedded: book.embedded,
        embeddedAt: book.embeddedAt,
        embeddingStats: book.embeddingStats || {
          totalFiles: 0,
          totalChunks: 0,
          totalTokens: 0,
          lastUpdated: null,
          collectionName: null
        }
      })),
      message: `Found ${totalBooks} books (${embeddedBooks} embedded, ${nonEmbeddedBooks} not embedded)`,
      timing: { totalResponse: responseTime + "ms" }
    })

  } catch (error) {
    console.error("Error getting books embedded status:", error.message)
    return res.status(500).json({
      success: false,
      message: `Error getting books embedded status: ${error.message}`,
      clientId: req.params.clientId,
      error: true
    })
  }
})

// Test endpoint to verify processor initialization
router.get("/test-init/:bookId", async (req, res) => {
  try {
    const { bookId } = req.params
    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }

    console.log(`🧪 Testing initialization for bookId: ${bookId}`)
    
    // Check book in MongoDB first
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({ 
        success: false, 
        message: "Book not found" 
      })
    }
    
    // Test basic processor properties
    const processorStatus = {
      hasGenAI: !!processor.genAI,
      hasAstraClient: !!processor.astraClient,
      hasDb: !!processor.db,
      baseCollectionName: processor.baseCollectionName,
      embeddingModel: processor.embeddingModelName,
      chatModel: processor.chatModelName,
      vectorDimensions: processor.vectorDimensions,
      bookEmbedded: book.embedded,
      bookTitle: book.title
    }
    
    console.log("📊 Processor Status:", processorStatus)
    
    // If book is not embedded, skip Astra DB tests
    if (!book.embedded) {
      return res.json({
        success: true,
        bookId: bookId,
        processorStatus: processorStatus,
        message: "Book exists but has no PDF embeddings - skipping Astra DB tests",
        bookStatus: {
          embedded: false,
          title: book.title,
          message: "No PDF embeddings available for this book"
        }
      })
    }
    
    // Book is embedded, test Astra DB connection
    try {
      const collections = await processor.db.listCollections()
      processorStatus.astraConnection = "SUCCESS"
      processorStatus.collectionsFound = collections.length
      processorStatus.collectionNames = collections.map(col => col.name)
    } catch (dbError) {
      processorStatus.astraConnection = "FAILED"
      processorStatus.dbError = dbError.message
    }
    
    // Test book initialization
    try {
      const collectionName = await processor.initializeBookDB(bookId)
      processorStatus.bookInit = "SUCCESS"
      processorStatus.collectionName = collectionName
      processorStatus.hasCollection = !!processor.collection
    } catch (initError) {
      processorStatus.bookInit = "FAILED"
      processorStatus.initError = initError.message
    }
    
    return res.json({
      success: true,
      bookId: bookId,
      processorStatus: processorStatus,
      message: "Initialization test completed"
    })
    
  } catch (error) {
    console.error("Test initialization error:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Test failed",
      error: true
    })
  }
})

module.exports = router


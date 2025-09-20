const express = require("express")
const router = express.Router()
const Book = require("../models/Book")
const DataStore = require("../models/DatastoreItems")
const Chat = require("../models/Chat")
const CreditAccount = require("../models/CreditAccount")
const CreditTransaction = require("../models/CreditTransaction")
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

// Helper function to get today's chat count for a user
async function getTodayChatCount(userId, clientId) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayChats = await Chat.find({
      userId,
      clientId,
      lastMessageAt: { $gte: today, $lt: tomorrow }
    });
    
    return todayChats.length;
  } catch (error) {
    console.error('Error getting today chat count:', error);
    return 0;
  }
}

// Helper function to check if user can chat (has free chats or credits)
async function checkChatPermission(userId, clientId) {
  try {
    const todayChatCount = await getTodayChatCount(userId, clientId);
    
    // If user has free chats remaining, they can chat
    if (todayChatCount < 5) {
      return { 
        canChat: true, 
        reason: 'free_chat_available', 
        remainingFree: 5 - todayChatCount,
        todayChatCount
      };
    }
    
    // If no free chats, check if they have credits (need 0.20 credits per chat)
    const creditAccount = await CreditAccount.findOne({ userId, clientId });
    
    if (!creditAccount || creditAccount.balance < 0.20) {
      return { 
        canChat: false, 
        reason: 'insufficient_credits', 
        requiredCredits: 0.20,
        availableCredits: creditAccount?.balance || 0,
        todayChatCount
      };
    }
    
    return { 
      canChat: true, 
      reason: 'credits_available', 
      requiredCredits: 0.20,
      todayChatCount
    };
  } catch (error) {
    console.error('Error checking chat permission:', error);
    return { 
      canChat: false, 
      reason: 'error', 
      message: 'Failed to check chat permissions' 
    };
  }
}

// Helper function to record chat usage and deduct credits if needed
async function recordChatUsage(userId, clientId, chatId, bookId, question) {
  try {
    const todayChatCount = await getTodayChatCount(userId, clientId);
    
    if (todayChatCount < 5) {
      // Use free chat - no credit deduction needed
      return { 
        success: true, 
        chatType: 'free', 
        remainingFree: 5 - todayChatCount - 1,
        creditsDeducted: 0
      };
    } else {
      // Use paid chat (0.20 credits)
      const creditAccount = await CreditAccount.findOne({ 
        userId, 
        clientId 
      });
      
      if (!creditAccount || creditAccount.balance < 0.20) {
        return { 
          success: false, 
          reason: 'insufficient_credits',
          requiredCredits: 0.20,
          availableCredits: creditAccount?.balance || 0
        };
      }
      
      // Deduct credits
      const balanceBefore = creditAccount.balance;
      creditAccount.balance -= 0.20;
      await creditAccount.save();
      
      // Record transaction
      await CreditTransaction.create({
        userId,
        type: 'debit',
        amount: 0.20,
        balanceBefore,
        balanceAfter: creditAccount.balance,
        category: 'service_usage',
        description: 'Chat usage - 1 chat',
        referenceId: `chat_${Date.now()}`,
        metadata: {
          chatId,
          bookId,
          question: question.substring(0, 100), // Store first 100 chars
          chatType: 'paid'
        }
      });
      
      return { 
        success: true, 
        chatType: 'paid', 
        creditsDeducted: 0.20,
        remainingCredits: creditAccount.balance
      };
    }
  } catch (error) {
    console.error('Error recording chat usage:', error);
    return { 
      success: false, 
      reason: 'error', 
      message: 'Failed to record chat usage' 
    };
  }
}

// Helper function to generate chat title from first question
function generateChatTitle(question) {
  // Clean and truncate the question to create a meaningful title
  let title = question.trim()
  
  // Remove common question words and clean up
  title = title.replace(/^(what|how|when|where|why|can|could|would|should|is|are|do|does|did|will|tell|explain|give|show|help|please)\s+/i, '')
  
  // Capitalize first letter
  title = title.charAt(0).toUpperCase() + title.slice(1)
  
  // Truncate to reasonable length (max 50 characters)
  if (title.length > 50) {
    title = title.substring(0, 47) + '...'
  }
  
  // If title is too short or empty, use a default
  if (title.length < 3) {
    title = 'New Chat'
  }
  
  return title
}

// Helper function to save chat messages
async function saveChatMessage(chatId, clientId, userId, bookId, userMessage, aiResponse, metadata = {}) {
  try {
    // Find or create chat
    const chat = await Chat.findOrCreateChat(chatId, clientId, userId, bookId)
    
    // If this is a new chat (no messages yet), generate title from first question
    if (chat.messages.length === 0 && !chat.title) {
      chat.title = generateChatTitle(userMessage)
    }
    
    // Add user message
    chat.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    })
    
    // Extract the actual response content based on the response format
    let responseContent = 'No response generated'
    let responseMetadata = {}
    
    // Handle external API response format (data.llm_response)
    if (aiResponse.data && aiResponse.data.llm_response) {
      responseContent = aiResponse.data.llm_response
      responseMetadata = {
        modelUsed: 'openai', // Default for external API
        tokensUsed: 0, // Not available in external API response
        confidence: 1.0, // Assume high confidence for external API
        sources: aiResponse.data.results ? aiResponse.data.results.length : 0,
        method: 'external-api',
        filesUsed: [],
        timing: {
          totalResponse: aiResponse.data.latency || '0ms',
          ragLatency: aiResponse.data.rag_latency || '0ms',
          llmLatency: aiResponse.data.llm_latency || '0ms'
        },
        queryId: aiResponse.data.query_id,
        sessionId: aiResponse.data.session_id,
        clientId: aiResponse.data.client_id
      }
    }
    // Handle internal API response format (direct properties)
    else if (aiResponse.answer || aiResponse.message) {
      responseContent = aiResponse.answer || aiResponse.message
      responseMetadata = {
        modelUsed: aiResponse.modelUsed || 'unknown',
        tokensUsed: aiResponse.tokensUsed || 0,
        confidence: aiResponse.confidence || 0,
        sources: aiResponse.sources || 0,
        method: aiResponse.method || 'unknown',
        filesUsed: aiResponse.filesUsed || [],
        timing: aiResponse.timing || {}
      }
    }
    
    // Add AI response
    chat.messages.push({
      role: 'assistant',
      content: responseContent,
      timestamp: new Date(),
      metadata: responseMetadata
    })
    
    // Update total tokens used
    chat.totalTokensUsed += (responseMetadata.tokensUsed || 0)
    
    // Save chat
    await chat.save()
    
    console.log(`💬 Chat saved: ${chat.chatId} (${chat.messages.length} messages) - Title: "${chat.title}"`)
    return chat.chatId
  } catch (error) {
    console.error('Error saving chat message:', error.message)
    return null
  }
}

// Check daily chat status for a user
router.post("/chat-status", async (req, res) => {
  try {
    const { user_id, client_id } = req.body

    if (!user_id || typeof user_id !== "string" || user_id.trim().length === 0) {
      return res.status(400).json({ success: false, message: "user_id is required in body" })
    }
    if (!client_id || typeof client_id !== "string" || client_id.trim().length === 0) {
      return res.status(400).json({ success: false, message: "client_id is required in body" })
    }

    // Get today's chat count
    const todayChatCount = await getTodayChatCount(user_id, client_id)
    
    // Get credit account
    const creditAccount = await CreditAccount.findOne({ userId: user_id, clientId: client_id })
    
    // Get today's credit transactions for chat
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayCreditTransactions = await CreditTransaction.find({
      userId: user_id,
      createdAt: { $gte: today, $lt: tomorrow },
      category: 'service_usage',
      description: { $regex: /chat/i }
    });
    
    const creditsSpentToday = todayCreditTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    
    // Get last chat time
    const lastChat = await Chat.findOne({
      userId: user_id,
      clientId: client_id
    }).sort({ lastMessageAt: -1 });
    
    // Check if user can chat
    const chatPermission = await checkChatPermission(user_id, client_id)
    
    return res.json({
      success: true,
      dailyUsage: {
        freeChatsUsed: Math.min(todayChatCount, 5),
        freeChatsRemaining: Math.max(0, 5 - todayChatCount),
        paidChatsUsed: Math.max(0, todayChatCount - 5),
        totalChatsUsed: todayChatCount,
        creditsSpent: creditsSpentToday,
        lastChatAt: lastChat?.lastMessageAt || null
      },
      creditAccount: {
        balance: creditAccount?.balance || 0,
        currency: 'credits'
      },
      chatPermission: {
        canChat: chatPermission.canChat,
        reason: chatPermission.reason,
        requiredCredits: chatPermission.requiredCredits || 0.20,
        availableCredits: chatPermission.availableCredits || 0
      },
      limits: {
        freeChatsPerDay: 5,
        costPerPaidChat: 0.20
      }
    })
  } catch (error) {
    console.error("Error checking chat status:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to check chat status"
    })
  }
})

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
    const { question, history = [], client_id, user_id, chat_id } = req.body || {}

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

    // Validate user_id for chat saving
    if (!user_id || typeof user_id !== "string" || user_id.trim().length === 0) {
      return res.status(400).json({ success: false, message: "user_id is required in body for chat saving" })
    }

    // Check if user can chat (has free chats or credits)
    const chatPermission = await checkChatPermission(user_id, client_id)
    if (!chatPermission.canChat) {
      const errorResponse = {
        success: false,
        message: chatPermission.reason === 'insufficient_credits' 
          ? `You need ${chatPermission.requiredCredits} credits to chat. You have ${chatPermission.availableCredits} credits available.`
          : "You have reached your daily chat limit. Free chats reset at midnight.",
        errorCode: chatPermission.reason === 'insufficient_credits' ? 'INSUFFICIENT_CREDITS' : 'DAILY_LIMIT_REACHED',
        details: {
          reason: chatPermission.reason,
          requiredCredits: chatPermission.requiredCredits || 0.20,
          availableCredits: chatPermission.availableCredits || 0,
          remainingFree: chatPermission.remainingFree || 0
        },
        timing: { totalResponse: Date.now() - startTime + "ms" }
      }
      return res.status(402).json(errorResponse) // 402 Payment Required
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
      const noEmbeddingResponse = {
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
      }

      // Save chat message even for no embedding response
      const savedChatId = await saveChatMessage(chat_id, client_id, user_id, bookId, question, noEmbeddingResponse)
      noEmbeddingResponse.chat_id = savedChatId

      return res.json(noEmbeddingResponse)
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
      system_prompt: "You are a knowledgeable and professional book assistant. Your role is to help users understand and learn from the book content in a polite, educational, and engaging manner. Always provide accurate, well-structured answers based on the book's content. Be respectful, patient, and encouraging in your responses. If you cannot find specific information in the book, politely explain that the information may not be available in the current book and suggest alternative approaches or related topics that are covered. Maintain a helpful and professional tone throughout all interactions."
    }

    console.log(`[Public Chat] Calling external query API with payload:`, payload)
    const extRes = await axios.post(
      "https://vectrize.ailisher.com/api/v1/rag/query",
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

    // Prepare response with chat saving
    const responseData = { success: true, data: extData.data }
    
    // Save chat message - pass the full extData structure so saveChatMessage can extract llm_response
    const savedChatId = await saveChatMessage(chat_id, client_id, user_id, bookId, question, extData)
    responseData.chat_id = savedChatId

    // Record chat usage and deduct credits if needed
    const usageResult = await recordChatUsage(user_id, client_id, chat_id, bookId, question)
    if (usageResult.success) {
      responseData.chatUsage = {
        type: usageResult.chatType,
        creditsDeducted: usageResult.creditsDeducted || 0,
        remainingFree: usageResult.remainingFree || 0,
        remainingCredits: usageResult.remainingCredits || 0
      }
    } else {
      console.error('Failed to record chat usage:', usageResult)
      // Don't fail the request, just log the error
    }

    // Return response with chat_id and usage info
    return res.json(responseData)
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
      system_prompt: "You are a knowledgeable and professional book assistant. Your role is to help users understand and learn from the book content in a polite, educational, and engaging manner. Always provide accurate, well-structured answers based on the book's content. Be respectful, patient, and encouraging in your responses. If you cannot find specific information in the book, politely explain that the information may not be available in the current book and suggest alternative approaches or related topics that are covered. Maintain a helpful and professional tone throughout all interactions."
    }

    // Test external API call
    let externalResponse = null
    let externalError = null
    
    try {
      console.log(`[Raw Data] Testing external API with payload:`, testPayload)
      const extRes = await axios.post(
        "https://vectrize.ailisher.com/api/v1/rag/query",
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
        url: "https://vectrize.ailisher.com/api/v1/rag/query",
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
    const { question, options = {}, client_id, user_id, chat_id } = req.body || {}

    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: "question is required" })
    }

    // Validate client_id and user_id for chat saving
    if (!client_id || typeof client_id !== "string" || client_id.trim().length === 0) {
      return res.status(400).json({ success: false, message: "client_id is required in body for chat saving" })
    }
    if (!user_id || typeof user_id !== "string" || user_id.trim().length === 0) {
      return res.status(400).json({ success: false, message: "user_id is required in body for chat saving" })
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
      const noEmbeddingResponse = {
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
      }

      // Save chat message even for no embedding response
      const savedChatId = await saveChatMessage(chat_id, client_id, user_id, bookId, question, noEmbeddingResponse)
      noEmbeddingResponse.chat_id = savedChatId

      return res.json(noEmbeddingResponse)
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

    const responseData = {
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
    }

    // Save chat message
    const savedChatId = await saveChatMessage(chat_id, client_id, user_id, bookId, question, responseData)
    responseData.chat_id = savedChatId

    return res.json(responseData)
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
    const { question, options = {}, client_id, user_id, chat_id } = req.body || {}

    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" })
    }
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: "question is required" })
    }

    // Validate client_id and user_id for chat saving
    if (!client_id || typeof client_id !== "string" || client_id.trim().length === 0) {
      return res.status(400).json({ success: false, message: "client_id is required in body for chat saving" })
    }
    if (!user_id || typeof user_id !== "string" || user_id.trim().length === 0) {
      return res.status(400).json({ success: false, message: "user_id is required in body for chat saving" })
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
      const noEmbeddingResponse = {
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
      }

      // Save chat message even for no embedding response
      const savedChatId = await saveChatMessage(chat_id, client_id, user_id, bookId, question, noEmbeddingResponse)
      noEmbeddingResponse.chat_id = savedChatId

      return res.json(noEmbeddingResponse)
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

    const responseData = {
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
    }

    // Save chat message
    const savedChatId = await saveChatMessage(chat_id, client_id, user_id, bookId, question, responseData)
    responseData.chat_id = savedChatId

    return res.json(responseData)
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

// Get chat history for a specific chat
router.post("/chat", async (req, res) => {
  try {
    const { chatId, client_id, user_id } = req.body

    if (!chatId) {
      return res.status(400).json({ success: false, message: "chatId is required in body" })
    }
    if (!client_id) {
      return res.status(400).json({ success: false, message: "client_id is required in body" })
    }
    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required in body" })
    }

    const chat = await Chat.findOne({ 
      chatId, 
      clientId: client_id, 
      userId: user_id 
    }).populate('bookId', 'title author')

    if (!chat) {
      return res.status(404).json({ 
        success: false, 
        message: "Chat not found" 
      })
    }

    return res.json({
      success: true,
      chat: {
        chatId: chat.chatId,
        bookId: chat.bookId,
        bookTitle: chat.bookId?.title,
        bookAuthor: chat.bookId?.author,
        title: chat.title || 'Untitled Chat',
        messages: chat.messages,
        messageCount: chat.messageCount,
        totalTokensUsed: chat.totalTokensUsed,
        lastMessageAt: chat.lastMessageAt,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      }
    })
  } catch (error) {
    console.error("Error getting chat:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get chat"
    })
  }
})

// Get all chats for a user
router.post("/chats", async (req, res) => {
  try {
    const { user_id, client_id } = req.body

    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required in body" })
    }
    if (!client_id) {
      return res.status(400).json({ success: false, message: "client_id is required in body" })
    }
    const chats = await Chat.find({ 
      userId: user_id, 
      clientId: client_id 
    })
    .populate('bookId', 'title author')
    .sort({ lastMessageAt: -1 })

    return res.json({
      success: true,
      chats: chats.map(chat => ({
        chatId: chat.chatId,
        title: chat.title || 'Untitled Chat',
        messageCount: chat.messageCount,
      })),
      totalChats: chats.length
    })
  } catch (error) {
    console.error("Error getting chats:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get chats"
    })
  }
})

// Get chat history by book ID and user ID
router.post("/history", async (req, res) => {
  try {
    const { bookId, user_id, client_id } = req.body

    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required in body" })
    }
    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required in body" })
    }
    if (!client_id) {
      return res.status(400).json({ success: false, message: "client_id is required in body" })
    }

    // Verify book exists
    const book = await Book.findById(bookId)
    if (!book) {
      return res.status(404).json({ 
        success: false, 
        message: "Book not found" 
      })
    }

    const chats = await Chat.find({ 
      bookId, 
      userId: user_id, 
      clientId: client_id 
    })
    .populate('bookId', 'title author')
    .sort({ lastMessageAt: -1 })

    return res.json({
      success: true,
      bookId: bookId,
      bookTitle: book.title,
      bookAuthor: book.author,
      userId: user_id,
      chats: chats.map(chat => ({
        chatId: chat.chatId,
        title: chat.title || 'Untitled Chat',
        messageCount: chat.messageCount,
     })),
      totalChats: chats.length
    })
  } catch (error) {
    console.error("Error getting chat history:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get chat history"
    })
  }
})

// Get specific chat history by chat ID
router.post("/chat-history", async (req, res) => {
  try {
    const { chatId, client_id, user_id } = req.body

    if (!chatId) {
      return res.status(400).json({ success: false, message: "chatId is required in body" })
    }
    if (!client_id) {
      return res.status(400).json({ success: false, message: "client_id is required in body" })
    }
    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required in body" })
    }

    const chat = await Chat.findOne({ 
      chatId, 
      clientId: client_id, 
      userId: user_id 
    }).populate('bookId', 'title author')

    if (!chat) {
      return res.status(404).json({ 
        success: false, 
        message: "Chat not found" 
      })
    }

    return res.json({
      success: true,
      chat: {
        chatId: chat.chatId,
        title: chat.title || 'Untitled Chat',
        bookId: chat.bookId,
        bookTitle: chat.bookId?.title,
        bookAuthor: chat.bookId?.author,
        messages: chat.messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          metadata: msg.metadata
        })),
        messageCount: chat.messageCount,
        totalTokensUsed: chat.totalTokensUsed,
        lastMessageAt: chat.lastMessageAt,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt
      }
    })
  } catch (error) {
    console.error("Error getting specific chat history:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get chat history"
    })
  }
})

// Delete a chat
router.post("/chat/delete", async (req, res) => {
  try {
    const { chatId, client_id, user_id } = req.body

    if (!chatId) {
      return res.status(400).json({ success: false, message: "chatId is required in body" })
    }
    if (!client_id) {
      return res.status(400).json({ success: false, message: "client_id is required in body" })
    }
    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required in body" })
    }

    const chat = await Chat.findOneAndDelete({ 
      chatId, 
      clientId: client_id, 
      userId: user_id 
    })

    if (!chat) {
      return res.status(404).json({ 
        success: false, 
        message: "Chat not found" 
      })
    }

    return res.json({
      success: true,
      message: "Chat deleted successfully",
      chatId: chat.chatId
    })
  } catch (error) {
    console.error("Error deleting chat:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete chat"
    })
  }
})

// Update chat title
router.post("/chat/title", async (req, res) => {
  try {
    const { chatId, client_id, user_id, title } = req.body

    if (!chatId) {
      return res.status(400).json({ success: false, message: "chatId is required in body" })
    }
    if (!client_id) {
      return res.status(400).json({ success: false, message: "client_id is required in body" })
    }
    if (!user_id) {
      return res.status(400).json({ success: false, message: "user_id is required in body" })
    }
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return res.status(400).json({ success: false, message: "title is required in body" })
    }

    const chat = await Chat.findOneAndUpdate(
      { chatId, clientId: client_id, userId: user_id },
      { title: title.trim() },
      { new: true }
    )

    if (!chat) {
      return res.status(404).json({ 
        success: false, 
        message: "Chat not found" 
      })
    }

    return res.json({
      success: true,
      message: "Chat title updated successfully",
      chatId: chat.chatId,
      title: chat.title
    })
  } catch (error) {
    console.error("Error updating chat title:", error)
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update chat title"
    })
  }
})

module.exports = router

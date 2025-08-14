const axios = require("axios")
const { DataAPIClient } = require("@datastax/astra-db-ts")
const { v4: uuidv4 } = require("uuid")
const { GoogleGenerativeAI } = require("@google/generative-ai")
const pdf = require("pdf-parse")

class EnhancedPDFProcessor {
  constructor(config) {
    this.chunkrApiKey = config.chunkrApiKey
    this.embeddingModelName = config.embeddingModel || "text-embedding-004"
    this.chatModelName = config.chatModel || "gemini-1.5-flash"
    this.vectorDimensions = Number.parseInt(config.vectorDimensions) || 768
    this.chunkSize = Number.parseInt(config.chunkSize) || 200
    this.chunkOverlap = Number.parseInt(config.chunkOverlap) || 30
    this.maxContextChunks = Number.parseInt(config.maxContextChunks) || 5

    // Validate required configuration
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is required")
    }
    if (!config.astraToken) {
      throw new Error("ASTRA_TOKEN is required")
    }
    if (!config.astraApiEndpoint) {
      throw new Error("ASTRA_API_ENDPOINT is required")
    }
    if (!config.keyspace) {
      throw new Error("ASTRA_KEYSPACE is required")
    }

    // Initialize Gemini AI
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey)
    this.chatModel = this.genAI.getGenerativeModel({ model: this.chatModelName })

    try {
      this.astraClient = new DataAPIClient(config.astraToken)
      this.db = this.astraClient.db(config.astraApiEndpoint, {
        keyspace: config.keyspace,
      })
    } catch (error) {
      console.error("Failed to initialize Astra DB client:", error.message)
      throw new Error(`Astra DB initialization failed: ${error.message}. Please check your ASTRA_TOKEN, ASTRA_API_ENDPOINT, and ASTRA_KEYSPACE configuration.`)
    }

    this.baseCollectionName = config.collectionName || "book_knowledge_base"

    // Caches to reduce latency on repeated requests
    this.collectionCache = new Map() // bookId(string) -> { name, collection }
    this.knownCollections = new Map() // collectionName -> { dimension }
    this.collectionsLoaded = false
    this.collectionsLoadPromise = null
    this.embeddingCache = new Map() // question -> embedding (simple cache for repeated questions)
    // Cache of distinct file names per book to avoid repeated projection queries
    this.fileNamesCache = new Map() // bookId(string) -> { files: string[], cachedAt: number }
    this.fileNamesCacheTTL = Number.parseInt(process.env.FILENAMES_CACHE_TTL_MS || "300000") // 5 minutes
  }

  getBookCollectionName(bookId) {
    if (!bookId) {
      throw new Error("Book ID is required for collection name")
    }
    const cleanBookId = bookId.toString().replace(/[^a-zA-Z0-9_]/g, "_")
    return `${this.baseCollectionName}_book_${cleanBookId}`
  }

  async initializeBookDB(bookId) {
    try {
      if (!bookId) {
        throw new Error("Book ID is required for initialization")
      }

      console.log(`🔧 Initializing book database for bookId: ${bookId}`)

      // Validate Astra DB configuration
      if (!this.astraClient) {
        throw new Error("Astra DB client not initialized. Check ASTRA_TOKEN configuration.")
      }
      if (!this.db) {
        throw new Error("Astra DB database not initialized. Check ASTRA_API_ENDPOINT and ASTRA_KEYSPACE configuration.")
      }

      // Return cached handle if available
      const cached = this.collectionCache.get(bookId.toString())
      if (cached) {
        console.log(`📋 Using cached collection for bookId: ${bookId}`)
        this.collection = cached.collection
        this.currentBookId = bookId
        this.currentCollectionName = cached.name
        return cached.name
      }

      const desiredCollectionName = this.getBookCollectionName(bookId)
      console.log(`🎯 Desired collection name: ${desiredCollectionName}`)

      // Load known collections once per process to avoid repeated list calls
      if (!this.collectionsLoaded) {
        if (!this.collectionsLoadPromise) {
          this.collectionsLoadPromise = (async () => {
            try {
              console.log("📚 Loading known collections from Astra DB...")
              const collections = await this.db.listCollections()
              console.log(`📚 Found ${collections.length} collections`)
              collections.forEach((col) => {
                const dim = col.options?.vector?.dimension
                this.knownCollections.set(col.name, { dimension: dim })
                console.log(`  - ${col.name} (dimension: ${dim || 'unknown'})`)
              })
              this.collectionsLoaded = true
            } catch (error) {
              console.error("Failed to list Astra DB collections:", error.message)
              throw new Error(`Astra DB connection failed: ${error.message}. Please check your ASTRA_TOKEN, ASTRA_API_ENDPOINT, and ASTRA_KEYSPACE configuration.`)
            }
          })()
        }
        await this.collectionsLoadPromise
      }

      // Prefer exact match; otherwise, try to find best legacy/truncated match
      let resolvedName = desiredCollectionName
      let known = this.knownCollections.get(resolvedName)

      if (!known) {
        console.log(`🔍 Collection '${resolvedName}' not found, searching for best match...`)
        const prefix = `${this.baseCollectionName}_book_`
        const cleanBookId = bookId.toString().replace(/[^a-zA-Z0-9_]/g, "_")

        let bestMatchName = null
        let bestScore = -1

        for (const name of this.knownCollections.keys()) {
          if (!name.startsWith(prefix)) continue
          const suffix = name.slice(prefix.length)
          // Score by longest common prefix with the cleanBookId
          const maxLen = Math.min(suffix.length, cleanBookId.length)
          let lcp = 0
          while (lcp < maxLen && suffix[lcp] === cleanBookId[lcp]) lcp++
          if (lcp > bestScore) {
            bestScore = lcp
            bestMatchName = name
          }
        }

        if (bestMatchName) {
          console.log(`✅ Found best match: ${bestMatchName} (score: ${bestScore})`)
          resolvedName = bestMatchName
          known = this.knownCollections.get(resolvedName)
        } else {
          console.log(`❌ No matching collection found for bookId: ${bookId}`)
        }
      }

      if (known) {
        const existingDimension = known.dimension
        if (existingDimension && existingDimension !== this.vectorDimensions) {
          console.log(`🔄 Adjusting vector dimensions from ${this.vectorDimensions} to ${existingDimension}`)
          this.vectorDimensions = existingDimension
        }
      } else {
        const modelDimensions = this.getModelDimensions(this.embeddingModelName)
        if (modelDimensions !== this.vectorDimensions) {
          console.log(`🔄 Adjusting vector dimensions from ${this.vectorDimensions} to ${modelDimensions}`)
          this.vectorDimensions = modelDimensions
        }
        console.log(`🏗️ Creating new collection: ${resolvedName}`)
        await this.createBookCollection(resolvedName)
        // Mark as known now
        this.knownCollections.set(resolvedName, { dimension: this.vectorDimensions })
      }

      const collection = this.db.collection(resolvedName)
      this.collection = collection
      this.currentBookId = bookId
      this.currentCollectionName = resolvedName
      this.collectionCache.set(bookId.toString(), { name: resolvedName, collection })

      console.log(`✅ Successfully initialized collection: ${resolvedName} for bookId: ${bookId}`)
      return resolvedName
    } catch (error) {
      console.error(`❌ Failed to initialize book database for bookId: ${bookId}:`, error.message)
      throw error
    }
  }

  getModelDimensions(modelName) {
    const dimensionMap = {
      "text-embedding-004": 768,
      "embedding-001": 768,
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,
    }

    return dimensionMap[modelName] || 768
  }

  // Returns distinct file names for a book with caching
  async getDistinctFileNames(bookId, searchFilter, fallbackFileGroups = null) {
    try {
      const cacheKey = bookId.toString()
      const cached = this.fileNamesCache.get(cacheKey)
      const now = Date.now()
      if (cached && now - cached.cachedAt < this.fileNamesCacheTTL) {
        return cached.files
      }

      // Query only file_name field for performance
      const fileDocs = await this.collection
        .find(searchFilter, { projection: { file_name: 1, _id: 0 }, limit: 1000 })
        .toArray()
      const files = [...new Set(fileDocs.map((d) => d.file_name).filter(Boolean))]

      this.fileNamesCache.set(cacheKey, { files, cachedAt: now })
      return files
    } catch (error) {
      // Fallback to file groups keys if provided
      if (fallbackFileGroups) {
        const files = Object.keys(fallbackFileGroups)
        this.fileNamesCache.set(bookId.toString(), { files, cachedAt: Date.now() })
        return files
      }
      return []
    }
  }

  // Simple concurrency limiter to run async tasks with a fixed concurrency
  async runWithConcurrency(items, concurrency, taskFn) {
    const results = []
    let index = 0
    const workers = new Array(Math.max(1, concurrency)).fill(0).map(async () => {
      while (index < items.length) {
        const currentIndex = index++
        try {
          results[currentIndex] = await taskFn(items[currentIndex])
        } catch (err) {
          results[currentIndex] = null
        }
      }
    })
    await Promise.all(workers)
    return results
  }

  async createBookCollection(collectionName) {
    await this.db.createCollection(collectionName, {
      vector: { dimension: this.vectorDimensions, metric: "cosine" },
    })
  }

  async processPDFFromURL(pdfUrl, fileName, userId = null, metadata = {}) {
    if (!metadata.bookId) {
      throw new Error("Book ID is required for PDF processing")
    }

    try {
      const response = await axios.get(pdfUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      })

      const pdfBuffer = Buffer.from(response.data)
      const fileSizeBytes = pdfBuffer.length
      const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(2)

      return await this.processPDFBuffer(pdfBuffer, fileName, userId, {
        ...metadata,
        fileSizeBytes,
        fileSizeMB,
      })
    } catch (error) {
      throw new Error(`Failed to process PDF from URL: ${error.message}`)
    }
  }

  async processPDFBuffer(pdfBuffer, fileName, userId = null, metadata = {}) {
    const startTime = Date.now()
    const timingMetrics = {
      textExtraction: 0,
      chunking: 0,
      embedding: 0,
      dbInsert: 0,
      total: 0,
    }

    const textExtractionStart = Date.now()
    const pdfData = await pdf(pdfBuffer)
    const totalPages = pdfData.numpages
    const extractedText = pdfData.text
    timingMetrics.textExtraction = Date.now() - textExtractionStart

    if (!metadata.bookId) {
      throw new Error("Book ID is required for PDF processing")
    }

    await this.initializeBookDB(metadata.bookId)

    // Check for existing embeddings first
    const existingDocs = await this.collection
      .find({
        file_name: fileName,
        book_id: metadata.bookId,
        ...(userId && { user_id: userId }),
      })
      .toArray()

    if (existingDocs.length > 0) {
      return {
        taskId: uuidv4(),
        fileName: fileName,
        bookId: metadata.bookId,
        collectionName: this.currentCollectionName,
        totalPages: totalPages,
        fileSizeMB: metadata.fileSizeMB || "N/A",
        timing: {
          textExtraction: timingMetrics.textExtraction,
          chunking: 0,
          embedding: 0,
          dbInsert: 0,
          total: Date.now() - startTime,
        },
        summary: {
          chunks_inserted: existingDocs.length,
          total_words: existingDocs.reduce((sum, doc) => sum + (doc.word_count || 0), 0),
          book_id: metadata.bookId,
          already_exists: true,
        },
        modelUsed: this.embeddingModelName,
        vectorSize: this.vectorDimensions,
        tokensUsed: existingDocs.reduce((sum, doc) => sum + (doc.word_count || 0), 0) * 1.33,
      }
    }

    const chunkingStart = Date.now()
    const chunks = await this.extractTextFromPDFBuffer(pdfBuffer)
    timingMetrics.chunking = Date.now() - chunkingStart

    if (chunks.length === 0) {
      throw new Error("No content could be extracted from PDF")
    }

    const embeddingStart = Date.now()
    const embeddings = await this.generateEmbeddingsWithRetry(chunks)
    timingMetrics.embedding = Date.now() - embeddingStart

    if (embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: ${embeddings.length} vs ${chunks.length}`)
    }

    const totalWords = chunks.reduce((sum, text) => sum + text.split(/\s+/).length, 0)
    const tokensUsed = Math.round(totalWords * 1.33)

    const documents = chunks.map((text, idx) => ({
      _id: uuidv4(),
      file_name: fileName,
      book_id: metadata.bookId,
      user_id: userId || "anonymous",
      text_content: text,
      $vector: embeddings[idx],
      chunk_index: idx,
      processed_at: new Date().toISOString(),
      word_count: text.split(/\s+/).length,
      char_count: text.length,
      ...metadata,
      is_public: metadata.isPublic || false,
      access_level: metadata.accessLevel || "private",
    }))

    const dbInsertStart = Date.now()
    await this.collection.insertMany(documents)
    timingMetrics.dbInsert = Date.now() - dbInsertStart
    timingMetrics.total = Date.now() - startTime

    return {
      taskId: uuidv4(),
      fileName: fileName,
      bookId: metadata.bookId,
      collectionName: this.currentCollectionName,
      totalPages: totalPages,
      fileSizeMB: metadata.fileSizeMB || "N/A",
      timing: {
        textExtraction: timingMetrics.textExtraction,
        chunking: timingMetrics.chunking,
        embedding: timingMetrics.embedding,
        dbInsert: timingMetrics.dbInsert,
        total: timingMetrics.total,
      },
      summary: {
        chunks_inserted: documents.length,
        total_words: totalWords,
        book_id: metadata.bookId,
      },
      modelUsed: this.embeddingModelName,
      vectorSize: this.vectorDimensions,
      tokensUsed: tokensUsed,
    }
  }

  async extractTextFromPDFBuffer(pdfBuffer) {
    try {
      const pdfData = await pdf(pdfBuffer)
      const text = pdfData.text
      return this.chunkText(text)
    } catch (error) {
      throw new Error(`Failed to extract text from PDF: ${error.message}`)
    }
  }

  chunkText(text) {
    const words = text.split(/\s+/)
    const chunks = []
    let currentChunk = []
    let currentLength = 0

    for (const word of words) {
      currentChunk.push(word)
      currentLength += word.length + 1

      if (currentLength >= this.chunkSize) {
        chunks.push(currentChunk.join(" "))
        currentChunk = currentChunk.slice(-this.chunkOverlap)
        currentLength = currentChunk.join(" ").length
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(" "))
    }

    return chunks
  }

  async generateEmbeddingsWithRetry(chunks, maxRetries = 3) {
    let embeddings = []
    let retryCount = 0

    while (retryCount < maxRetries) {
      try {
        const embeddingModel = this.genAI.getGenerativeModel({ model: this.embeddingModelName })
        const batchSize = 100
        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize)
          const batchEmbeddings = await Promise.all(
            batch.map(async (text) => {
              const result = await embeddingModel.embedContent(text)
              return result.embedding.values
            })
          )
          embeddings.push(...batchEmbeddings)
        }
        return embeddings
      } catch (error) {
        retryCount++
        if (retryCount === maxRetries) {
          throw new Error(`Failed to generate embeddings after ${maxRetries} attempts: ${error.message}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * retryCount))
      }
    }

    return embeddings
  }

  async performFastRetrieval(question, documents) {
    try {
      let questionEmbedding = this.embeddingCache.get(question)
      
      if (!questionEmbedding) {
        const embeddingModel = this.genAI.getGenerativeModel({ model: this.embeddingModelName })
        const questionEmbeddingResult = await embeddingModel.embedContent(question)
        questionEmbedding = questionEmbeddingResult.embedding.values
        // Cache the embedding for future use (limit cache size)
        if (this.embeddingCache.size < 100) {
          this.embeddingCache.set(question, questionEmbedding)
        }
      }

      const similarities = documents.map((doc) => {
        const docEmbedding = doc.$vector
        const similarity = this.cosineSimilarity(questionEmbedding, docEmbedding)
        return { ...doc, $similarity: similarity }
      })

      similarities.sort((a, b) => (b.$similarity || 0) - (a.$similarity || 0))
      // Return more results to ensure file diversity
      return similarities.slice(0, Math.max(this.maxContextChunks * 2, 20))
    } catch (error) {
      console.error("Retrieval error:", error)
      return []
    }
  }

  async dbVectorSearch(question, searchFilter, limit) {
    // Check if collection is properly initialized
    if (!this.collection) {
      throw new Error("Collection not initialized. Please call initializeBookDB() first.")
    }
    
    // Use Astra server-side vector sort to reduce latency and payload
    let questionEmbedding = this.embeddingCache.get(question)
    
    if (!questionEmbedding) {
      const embeddingModel = this.genAI.getGenerativeModel({ model: this.embeddingModelName })
      const questionEmbeddingResult = await embeddingModel.embedContent(question)
      questionEmbedding = questionEmbeddingResult.embedding.values
      // Cache the embedding for future use (limit cache size)
      if (this.embeddingCache.size < 100) {
        this.embeddingCache.set(question, questionEmbedding)
      }
    }

    const options = {
      sort: { $vector: questionEmbedding },
      limit: Math.max(1, limit || 500), // Reduced default limit
      projection: {
        text_content: 1,
        $vector: 1,
        file_name: 1,
        chunk_index: 1,
        word_count: 1,
      },
    }

    // Add timeout wrapper to prevent hanging
    const searchWithTimeout = async () => {
      try {
        const results = await this.collection.find(searchFilter, options).toArray()
        
        // Only widen search if we have very few results and limit is small
        if ((!results || results.length < 5) && options.limit < 800) {
          const widerOptions = { ...options, limit: Math.min(options.limit * 1.5, 800) }
          const additionalResults = await this.collection.find(searchFilter, widerOptions).toArray()
          if (additionalResults.length > results.length) {
            return additionalResults
          }
        }
        return results
      } catch (err) {
        console.log("Vector search failed, using fallback:", err.message)
        // Fallback minimal
        return await this.collection.find(searchFilter).limit(300).toArray()
      }
    }

    // Execute with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Vector search timeout")), 15000) // 15 second timeout
    })

    let results
    try {
      results = await Promise.race([searchWithTimeout(), timeoutPromise])
    } catch (error) {
      if (error.message === "Vector search timeout") {
        console.log("Vector search timed out, using minimal fallback")
        results = await this.collection.find(searchFilter).limit(200).toArray()
      } else {
        throw error
      }
    }

    // Compute similarity locally if server didn't attach one
    const sims = results.map((doc) => {
      const sim = this.cosineSimilarity(questionEmbedding, doc.$vector)
      return { ...doc, $similarity: sim }
    })

    sims.sort((a, b) => (b.$similarity || 0) - (a.$similarity || 0))
    return sims
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0)
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0))
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0))
    return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0
  }

  async answerQuestion(
    question,
    fileName = null,
    userId = null,
    requireAuth = false,
    bookId = null,
    options = {},
  ) {
    const startTime = Date.now()
    const timingMetrics = {
      init: 0,
      retrieval: 0,
      processing: 0,
      generation: 0,
      total: 0,
    }

    if (!bookId) {
      throw new Error("Book ID is required for question answering")
    }

    try {
      const initStart = Date.now()
      await this.initializeBookDB(bookId)
      timingMetrics.init = Date.now() - initStart

      const searchFilter = { book_id: bookId }
      if (fileName) searchFilter.file_name = fileName
      if (userId && requireAuth) searchFilter.user_id = userId
      if (!requireAuth) {
        const includePrivateWhenUnauth = options.includePrivateWhenUnauthenticated === true
        if (!userId && !includePrivateWhenUnauth) {
          searchFilter.$or = [{ is_public: true }, { access_level: "public" }]
        }
      }

      const retrievalStart = Date.now()
      let relevantResults = []
      try {
        // Get more chunks for book-level questions to ensure comprehensive coverage
        const searchLimit = options.bookLevelQuestion ? 2000 : 1000
        relevantResults = await this.dbVectorSearch(question, searchFilter, searchLimit)
      } catch (_) {
        // Fallback to old approach when vector sort is not available
        const allDocs = await this.collection.find(searchFilter).limit(100).toArray()
        if (allDocs.length > 0) {
          relevantResults = await this.performFastRetrieval(question, allDocs)
        }
      }
      timingMetrics.retrieval = Date.now() - retrievalStart

      if (relevantResults.length === 0) {
        timingMetrics.total = Date.now() - startTime
        return {
          answer: `No relevant documents found in this book's knowledge base.`,
          confidence: 0,
          sources: 0,
          timing: timingMetrics,
          modelUsed: this.chatModelName,
          tokensUsed: 0,
                  chunkDetails: [],
      }
      }
      // With DB-side vector search, processing is minimal
      timingMetrics.processing = 0

      const generationStart = Date.now()
      const answerResult = await this.generateUltraFastAnswer(question, relevantResults, bookId)
      timingMetrics.generation = Date.now() - generationStart
      timingMetrics.total = Date.now() - startTime

      const avgSimilarity = relevantResults.reduce((sum, r) => sum + (r.$similarity || 0.5), 0) / relevantResults.length
      const confidence = Math.max(Math.round(avgSimilarity * 100), 75)

      return {
        answer: answerResult.answer,
        confidence: confidence,
        sources: relevantResults.length,
        timing: timingMetrics,
        bookId: bookId,
        method: "ultra_fast_retrieval",
        modelUsed: this.chatModelName,
        tokensUsed: answerResult.tokensUsed,
        chunkDetails: answerResult.chunkDetails,
        isQuestionRelated: answerResult.isQuestionRelated
      }
    } catch (error) {
      timingMetrics.total = Date.now() - startTime
      return {
        answer: `Error: ${error.message}`,
        confidence: 0,
        sources: 0,
        timing: timingMetrics,
        modelUsed: this.chatModelName,
        tokensUsed: 0,
        chunkDetails: [],
      }
    }
  }

  async generateUltraFastAnswer(question, relevantChunks, bookId) {
    try {
      // Increase context chunks for book-level questions
      const topChunks = relevantChunks.slice(0, Math.min(relevantChunks.length, 20))
      const chunkDetails = []

      const context = topChunks
        .map((chunk, index) => {
          const chunkStart = Date.now()
          const similarity = Math.round((chunk.$similarity || 0) * 100)
          // Increase text length for better context
          const text = chunk.text_content.substring(0, 500)
          const chunkTime = Date.now() - chunkStart
          chunkDetails.push({
            chunkIndex: index + 1,
            timing: chunkTime,
            similarity: similarity,
            fileName: chunk.file_name || 'Unknown',
          })
          return `[${index + 1}] ${text}... (${similarity}% match)`
        })
        .join("\n\n")

      // Check if the question is related to the document content
      const isQuestionRelated = this.isQuestionRelatedToContent(question, topChunks)

      // Improved prompt for book-level questions
      const prompt = `Based on the following context from a book, please provide a comprehensive answer to the question. Use information from multiple sources if available.

Context: ${context}

Question: ${question}

Please provide a detailed answer that covers the relevant information from the book:`

      // Log the exact data being sent to AI
      console.log("\n" + "⚡".repeat(20))
      console.log("📤 SENDING TO GEMINI AI MODEL (ULTRA FAST)")
      console.log("⚡".repeat(20))
      console.log(`📝 PROMPT SENT TO AI:`)
      console.log(prompt)
      console.log(`\n📊 CONTEXT SUMMARY:`)
      console.log(`- Total chunks: ${topChunks.length}`)
      console.log(`- Context length: ${context.length} characters`)
      console.log(`- Question: ${question}`)
      console.log(`- Question related to content: ${isQuestionRelated}`)
      console.log("⚡".repeat(20) + "\n")

      const generationStart = Date.now()
      const result = await this.chatModel.generateContent({
        contents: [
          {
            parts: [
              { text: "You are a helpful AI assistant that provides comprehensive answers based on the given book content. If the information is not available in the provided context, clearly state that." },
              { text: prompt }
            ]
          }
        ]
      })

      const response = await result.response
      const answer = response.text()
      const generationTime = Date.now() - generationStart

      // Log the AI response
      console.log("\n" + "🤖".repeat(20))
      console.log("📥 RESPONSE FROM GEMINI AI MODEL (ULTRA FAST)")
      console.log("🤖".repeat(20))
      console.log(`💬 AI ANSWER:`)
      console.log(answer)
      console.log(`⏱️ Generation time: ${generationTime}ms`)
      console.log("🤖".repeat(20) + "\n")

      // Final relevance check: if initial check failed but answer is relevant, override
      let finalRelevance = isQuestionRelated
      if (!isQuestionRelated) {
        const answerRelevance = this.isAnswerRelevant(answer)
        if (answerRelevance) {
          console.log(`🔄 Overriding relevance: answer indicates question was related`)
          finalRelevance = true
        }
      }

      // Update chunk details with a portion of generation time (approximated)
      chunkDetails.forEach((detail) => {
        detail.timing = Math.round(detail.timing + (generationTime / topChunks.length))
      })

      // Estimate tokens based on text length
      const tokensUsed = Math.round((prompt.length + answer.length) / 4)

      return {
        answer: answer,
        method: "enhanced-book-level-answer",
        contextUsed: topChunks.length,
        bookId: bookId,
        tokensUsed: tokensUsed,
        chunkDetails: chunkDetails,
        isQuestionRelated: finalRelevance
      }
    } catch (error) {
      console.error("Gemini API error:", error)
      return {
        answer: "Unable to generate response. Please try again.",
        method: "error-fallback",
        bookId: bookId,
        tokensUsed: 0,
        chunkDetails: [],
        isQuestionRelated: false
      }
    }
  }

  async answerBookLevelQuestion(question, bookId, userId = null, options = {}) {
    const startTime = Date.now()
    const timingMetrics = {
      init: 0,
      retrieval: 0,
      processing: 0,
      generation: 0,
      total: 0,
    }

    if (!bookId) {
      throw new Error("Book ID is required for book-level question answering")
    }

    try {
      const initStart = Date.now()
      await this.initializeBookDB(bookId)
      timingMetrics.init = Date.now() - initStart

      // For book-level questions, search across all documents
      const searchFilter = { book_id: bookId }
      if (userId && options.requireAuth) {
        searchFilter.user_id = userId
      } else if (!options.includePrivateWhenUnauthenticated) {
        // Only include public documents if not explicitly allowing private ones
        searchFilter.$or = [
          { is_public: true }, 
          { access_level: "public" },
          { access_level: { $exists: false } }
        ]
      }
      // If includePrivateWhenUnauthenticated is true, no additional filter is applied
      // This allows searching all documents in the book regardless of access level

      const retrievalStart = Date.now()
      let relevantResults = []
            try {
         // Fast mode: use smaller, more targeted search to avoid timeouts
         const searchLimit = options.fastMode ? 300 : (options.enhancedMode ? 800 : 500)
         relevantResults = await this.dbVectorSearch(question, searchFilter, searchLimit)
         
         // Only do additional search if absolutely necessary and results are very poor
         const uniqueFilesFound = new Set(relevantResults.map(r => r.file_name))
         if (relevantResults.length < 8 || uniqueFilesFound.size < 2) {
           try {
             const additionalResults = await this.dbVectorSearch(question, searchFilter, 500)
             relevantResults = [...relevantResults, ...additionalResults]
             // Remove duplicates and re-sort
             const seen = new Set()
             relevantResults = relevantResults.filter(result => {
               const key = `${result.file_name}-${result.chunk_index}`
               if (seen.has(key)) return false
               seen.add(key)
               return true
             }).sort((a, b) => (b.$similarity || 0) - (a.$similarity || 0))
           } catch (additionalError) {
             console.log("Additional search failed, proceeding with initial results:", additionalError.message)
           }
         }
             } catch (error) {
         console.error("Vector search failed, falling back to basic search:", error.message)
         // Fast fallback: use smaller limit to avoid timeouts
         try {
           const allDocs = await this.collection.find(searchFilter).limit(100).toArray()
           if (allDocs.length > 0) {
             relevantResults = await this.performFastRetrieval(question, allDocs)
           }
         } catch (fallbackError) {
           console.error("Fallback search also failed:", fallbackError.message)
           // Return empty results rather than failing completely
           relevantResults = []
         }
       }
      timingMetrics.retrieval = Date.now() - retrievalStart

      if (relevantResults.length === 0) {
        timingMetrics.total = Date.now() - startTime
        return {
          answer: `No relevant information found in this book's knowledge base for your question.`,
          confidence: 0,
          sources: 0,
          timing: timingMetrics,
          modelUsed: this.chatModelName,
          tokensUsed: 0,
          chunkDetails: [],
          method: "book-level-no-results"
        }
      }

      // Group results by file to ensure diversity
      const fileGroups = {}
      relevantResults.forEach(result => {
        const fileName = result.file_name || 'Unknown'
        if (!fileGroups[fileName]) {
          fileGroups[fileName] = []
        }
        fileGroups[fileName].push(result)
      })

      // Get all available files in the book using cache (fast)
      const allFilesInBook = await this.getDistinctFileNames(bookId, searchFilter, fileGroups)
      
      // Ensure we have at least one result from each file, even if similarity is low
      const diverseResults = []
      
      // First, add top results from files that have high similarity
      Object.keys(fileGroups).forEach(fileName => {
        const fileResults = fileGroups[fileName]
          .sort((a, b) => (b.$similarity || 0) - (a.$similarity || 0))
          .slice(0, options.fastMode ? 2 : 3)
        diverseResults.push(...fileResults)
      })
      
      // Then, for files that have no results, get at least one sample (parallel, limited)
      const filesWithResults = new Set(Object.keys(fileGroups))
      const filesWithoutResults = allFilesInBook.filter(fileName => !filesWithResults.has(fileName))
      
      // Limit the number of missing files we probe in fast mode to reduce DB calls
      const filesToProbe = options.fastMode ? filesWithoutResults.slice(0, 4) : filesWithoutResults
      const questionEmbedding = this.embeddingCache.get(question)
      const sampleResults = await this.runWithConcurrency(filesToProbe, options.fastMode ? 3 : 5, async (fileName) => {
        try {
          const sampleDocs = await this.collection
            .find({ ...searchFilter, file_name: fileName })
            .limit(options.fastMode ? 1 : 2)
            .toArray()
          if (!sampleDocs || sampleDocs.length === 0) return []
          if (questionEmbedding) {
            return sampleDocs.map(doc => ({
              ...doc,
              $similarity: this.cosineSimilarity(questionEmbedding, doc.$vector)
            }))
          }
          return sampleDocs.map(doc => ({ ...doc, $similarity: 0.1 }))
        } catch (err) {
          return []
        }
      })
      sampleResults.forEach(arr => { if (arr && arr.length) diverseResults.push(...arr) })

      // Sort by similarity and take top overall, but ensure diversity
      diverseResults.sort((a, b) => (b.$similarity || 0) - (a.$similarity || 0))
      const finalResults = diverseResults.slice(0, options.fastMode ? 12 : 18)

      timingMetrics.processing = 0

      const generationStart = Date.now()
      const answerResult = await this.generateBookLevelAnswer(question, finalResults, bookId, options)
      timingMetrics.generation = Date.now() - generationStart
      timingMetrics.total = Date.now() - startTime

      const avgSimilarity = finalResults.reduce((sum, r) => sum + (r.$similarity || 0.5), 0) / finalResults.length
      const confidence = Math.max(Math.round(avgSimilarity * 100), 75)

      return {
        answer: answerResult.answer,
        confidence: confidence,
        sources: finalResults.length,
        timing: timingMetrics,
        bookId: bookId,
        method: "enhanced-book-level",
        modelUsed: this.chatModelName,
        tokensUsed: answerResult.tokensUsed,
        chunkDetails: options.fastMode ? [] : (answerResult.chunkDetails || []),
        filesUsed: [...new Set(finalResults.map(r => r.file_name))],
        totalFilesAvailable: allFilesInBook.length,
        isQuestionRelated: answerResult.isQuestionRelated
      }
    } catch (error) {
      timingMetrics.total = Date.now() - startTime
      return {
        answer: `Error processing book-level question: ${error.message}`,
        confidence: 0,
        sources: 0,
        timing: timingMetrics,
        modelUsed: this.chatModelName,
        tokensUsed: 0,
        chunkDetails: [],
        method: "book-level-error"
      }
    }
  }

  async generateBookLevelAnswer(question, relevantChunks, bookId, options = {}) {
    try {
      const chunkDetails = []

      // Group chunks by file for better organization
      const fileGroups = {}
      relevantChunks.forEach(chunk => {
        const fileName = chunk.file_name || 'Unknown'
        if (!fileGroups[fileName]) {
          fileGroups[fileName] = []
        }
        fileGroups[fileName].push(chunk)
      })

      // Create optimized context with shorter text chunks
      let contextParts = []
      Object.keys(fileGroups).forEach((fileName, fileIndex) => {
        const fileChunks = fileGroups[fileName]
        const fileContext = fileChunks
          .map((chunk, index) => {
            const similarity = Math.round((chunk.$similarity || 0) * 100)
            // Reduced text length for faster processing
            const maxLength = options.fastMode ? 120 : 220
            const text = chunk.text_content.substring(0, maxLength)
            if (!options.fastMode) {
              chunkDetails.push({
                chunkIndex: contextParts.length + index + 1,
                fileName: fileName,
                similarity: similarity,
                fileIndex: fileIndex + 1
              })
            }
            return `[${contextParts.length + index + 1}] ${text}... (${similarity}%)`
          })
          .join("\n")
        
        contextParts.push(`From "${fileName}":\n${fileContext}`)
      })

      const context = contextParts.join("\n\n")

      // Check if the question is related to the document content
      const isQuestionRelated = this.isQuestionRelatedToContent(question, relevantChunks)

      // Optimized prompt for faster generation
      const prompt = `Answer based on this book context. Be concise but comprehensive:

Context:
${context}

Question: ${question}

If information is not available, say so clearly.`

      // Log the exact data being sent to AI
      console.log("\n" + "🚀".repeat(20))
      console.log("📤 SENDING TO GEMINI AI MODEL")
      console.log("🚀".repeat(20))
      console.log(`📝 PROMPT SENT TO AI:`)
      console.log(prompt)
      console.log(`\n📊 CONTEXT SUMMARY:`)
      console.log(`- Total chunks: ${relevantChunks.length}`)
      console.log(`- Files: ${Object.keys(fileGroups).length}`)
      console.log(`- Context length: ${context.length} characters`)
      console.log(`- Question: ${question}`)
      console.log(`- Question related to content: ${isQuestionRelated}`)
      console.log("🚀".repeat(20) + "\n")

      const generationStart = Date.now()
      const result = await this.chatModel.generateContent({
        contents: [
          {
            parts: [
              { text: options.fastMode ? "Answer directly from the provided context. Be brief and precise. If unknown, say you don't know." : "You are a knowledgeable AI assistant that provides comprehensive, well-structured answers based on book content. Always be thorough and accurate." },
              { text: prompt }
            ]
          }
        ]
      })

      const response = await result.response
      const answer = response.text()
      const generationTime = Date.now() - generationStart

      // Log the AI response
      console.log("\n" + "🤖".repeat(20))
      console.log("📥 RESPONSE FROM GEMINI AI MODEL")
      console.log("🤖".repeat(20))
      console.log(`💬 AI ANSWER:`)
      console.log(answer)
      console.log(`⏱️ Generation time: ${generationTime}ms`)
      console.log("🤖".repeat(20) + "\n")

      // Final relevance check: if initial check failed but answer is relevant, override
      let finalRelevance = isQuestionRelated
      if (!isQuestionRelated) {
        const answerRelevance = this.isAnswerRelevant(answer)
        if (answerRelevance) {
          console.log(`🔄 Overriding relevance: answer indicates question was related`)
          finalRelevance = true
        }
      }

      // Estimate tokens based on text length
      const tokensUsed = Math.round((prompt.length + answer.length) / 4)

      return {
        answer: answer,
        method: "comprehensive-book-analysis",
        contextUsed: relevantChunks.length,
        bookId: bookId,
        tokensUsed: tokensUsed,
        chunkDetails: chunkDetails,
        filesAnalyzed: Object.keys(fileGroups).length,
        isQuestionRelated: finalRelevance
      }
    } catch (error) {
      console.error("Book-level answer generation error:", error)
      return {
        answer: "Unable to generate comprehensive book-level response. Please try again.",
        method: "error-fallback",
        bookId: bookId,
        tokensUsed: 0,
        chunkDetails: [],
        isQuestionRelated: false
      }
    }
  }

  // Helper method to determine if a question is related to the document content
  isQuestionRelatedToContent(question, relevantChunks) {
    console.log(`🔍 Analyzing question relevance: "${question}"`)
    
    // If no chunks or very low similarity, question is likely not related
    if (!relevantChunks || relevantChunks.length === 0) {
      console.log(`❌ No relevant chunks found`)
      return false
    }

    // Check average similarity - if it's very low, question is likely not related
    const avgSimilarity = relevantChunks.reduce((sum, chunk) => sum + (chunk.$similarity || 0), 0) / relevantChunks.length
    console.log(`📊 Average similarity: ${(avgSimilarity * 100).toFixed(1)}%`)
    
    if (avgSimilarity < 0.3) { // 30% threshold
      console.log(`❌ Average similarity too low: ${(avgSimilarity * 100).toFixed(1)}% < 30%`)
    }

    // Check if any chunk has high similarity (>70%)
    const hasHighSimilarity = relevantChunks.some(chunk => (chunk.$similarity || 0) > 0.7)
    if (hasHighSimilarity) {
      console.log(`✅ High similarity found: >70%`)
      return true
    }

    // Check question keywords against document content
    const questionLower = question.toLowerCase()
    const questionWords = questionLower.split(/\s+/).filter(word => word.length > 3)
    console.log(`🔤 Question words: ${questionWords.join(', ')}`)
    
    // Common financial/SEBI terms that would indicate relevance
    const financialTerms = [
      'sebi', 'securities', 'stock', 'exchange', 'investment', 'financial', 'market',
      'depository', 'participant', 'custodian', 'merchant', 'banker', 'underwriter',
      'portfolio', 'manager', 'adviser', 'depository', 'dematerialization', 'rematerialization',
      'scra', 'act', 'regulation', 'compliance', 'penalty', 'appeal', 'tribunal',
      'company', 'corporate', 'listing', 'trading', 'settlement', 'delivery',
      'stock', 'exchange', 'securities', 'contracts', 'regulation', '1956', '1992', '1996',
      'contracts', 'regulation', 'securities', 'stock', 'exchange', 'recognition',
      'byelaws', 'rules', 'constitution', 'corporatisation', 'demutualisation',
      'central', 'government', 'notification', 'appointed', 'date', 'section',
      'provisions', 'penalties', 'fines', 'imprisonment', 'offences', 'violations'
    ]

    // Check if question contains financial/SEBI related terms
    const hasFinancialTerms = questionWords.some(word => 
      financialTerms.some(term => word.includes(term) || term.includes(word))
    )
    console.log(`💰 Has financial terms: ${hasFinancialTerms}`)
    
    if (hasFinancialTerms) {
      console.log(`✅ Financial terms detected in question`)
      return true
    }

    // Check if question contains terms that appear in document content
    const documentText = relevantChunks.map(chunk => chunk.text_content?.toLowerCase() || '').join(' ')
    const hasDocumentTerms = questionWords.some(word => 
      documentText.includes(word) && word.length > 3
    )
    console.log(`📄 Has document terms: ${hasDocumentTerms}`)
    
    if (hasDocumentTerms) {
      console.log(`✅ Document terms found in question`)
      return true
    }

    // Check if the question is asking about the documents themselves (meta-questions)
    const metaTerms = ['what', 'explain', 'describe', 'tell', 'about', 'information', 'details']
    const isMetaQuestion = metaTerms.some(term => questionLower.includes(term))
    console.log(`❓ Is meta question: ${isMetaQuestion}`)
    
    // If it's a meta question and we have relevant chunks, it's likely related
    if (isMetaQuestion && avgSimilarity > 0.2) {
      console.log(`✅ Meta question with reasonable similarity`)
      return true
    }

    // Final check: if average similarity is reasonable (>50%), consider it related
    if (avgSimilarity > 0.5) {
      console.log(`✅ Reasonable similarity: ${(avgSimilarity * 100).toFixed(1)}% > 50%`)
      return true
    }

    console.log(`❌ Question not related to content`)
    return false
  }

  // Helper method to check if AI answer indicates question was related
  isAnswerRelevant(answer) {
    if (!answer) return false
    
    const answerLower = answer.toLowerCase()
    
    // Check for negative responses that indicate no information found
    const negativeResponses = [
      'i don\'t know', 'don\'t know', 'no information', 'not available', 
      'not found', 'cannot find', 'unable to', 'no relevant', 'no data'
    ]
    
    const isNegative = negativeResponses.some(phrase => answerLower.includes(phrase))
    
    // Check for positive responses that indicate information was found
    const positiveResponses = [
      'sebi', 'scra', 'act', 'securities', 'stock', 'exchange', 'depository',
      'regulation', 'compliance', 'penalty', 'tribunal', 'company', 'corporate'
    ]
    
    const isPositive = positiveResponses.some(term => answerLower.includes(term))
    
    console.log(`🤖 Answer analysis: negative=${isNegative}, positive=${isPositive}`)
    
    // If answer contains financial/legal terms, it's likely relevant
    return isPositive && !isNegative
  }

  async checkExistingEmbeddings(fileName = null, userId = null, bookId = null) {
    try {
      if (!bookId) {
        throw new Error("Book ID is required to check embeddings")
      }

      await this.initializeBookDB(bookId)

      const searchFilter = { book_id: bookId }
      if (fileName) searchFilter.file_name = fileName
      if (userId) searchFilter.user_id = userId

      const existingDocs = await this.collection.find(searchFilter).toArray()

      return {
        exists: existingDocs.length > 0,
        count: existingDocs.length,
        files: [...new Set(existingDocs.map((doc) => doc.file_name))],
        bookId: bookId,
        collectionName: this.currentCollectionName,
      }
    } catch (error) {
      return {
        exists: false,
        count: 0,
        files: [],
        bookId: bookId,
        error: error.message,
      }
    }
  }

  async deleteExistingEmbeddings(fileName, userId = null, bookId = null) {
    try {
      if (!bookId) {
        throw new Error("Book ID is required to delete embeddings")
      }

      await this.initializeBookDB(bookId)

      const deleteFilter = {
        file_name: fileName,
        book_id: bookId,
      }
      if (userId) deleteFilter.user_id = userId

      const result = await this.collection.deleteMany(deleteFilter)

      return {
        success: true,
        deletedCount: result.deletedCount,
        fileName: fileName,
        bookId: bookId,
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        fileName: fileName,
        bookId: bookId,
      }
    }
  }

  async getBookKnowledgeBaseStatus(bookId, userId = null) {
    try {
      if (!bookId) {
        throw new Error("Book ID is required")
      }

      await this.initializeBookDB(bookId)

      const searchFilter = { book_id: bookId }
      if (userId) searchFilter.user_id = userId

      const existingDocs = await this.collection.find(searchFilter).toArray()
      const totalEmbeddings = existingDocs.length
      const uniqueFiles = [...new Set(existingDocs.map((doc) => doc.file_name))]
      const totalWords = existingDocs.reduce((sum, doc) => sum + (doc.word_count || 0), 0)
      const tokensUsed = Math.round(totalWords * 1.33)

      return {
        success: true,
        bookId: bookId,
        collectionName: this.currentCollectionName,
        totalEmbeddings: totalEmbeddings,
        uniqueFiles: uniqueFiles,
        fileCount: uniqueFiles.length,
        totalWords: totalWords,
        tokensUsed: tokensUsed,
        hasEmbeddings: totalEmbeddings > 0,
        chatAvailable: totalEmbeddings > 0,
        vectorSize: this.vectorDimensions,
        modelUsed: this.embeddingModelName,
      }
    } catch (error) {
      return {
        success: false,
        bookId: bookId,
        error: error.message,
        totalEmbeddings: 0,
        uniqueFiles: [],
        fileCount: 0,
        totalWords: 0,
        tokensUsed: 0,
        hasEmbeddings: false,
        chatAvailable: false,
      }
    }
  }
}

module.exports = EnhancedPDFProcessor

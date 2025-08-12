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

    // Initialize Gemini AI
    this.genAI = new GoogleGenerativeAI(config.geminiApiKey)
    this.chatModel = this.genAI.getGenerativeModel({ model: this.chatModelName })

    this.astraClient = new DataAPIClient(config.astraToken)
    this.db = this.astraClient.db(config.astraApiEndpoint, {
      keyspace: config.keyspace,
    })
    this.baseCollectionName = config.collectionName || "book_knowledge_base"

    // Caches to reduce latency on repeated requests
    this.collectionCache = new Map() // bookId(string) -> { name, collection }
    this.knownCollections = new Map() // collectionName -> { dimension }
    this.collectionsLoaded = false
    this.collectionsLoadPromise = null
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

      // Return cached handle if available
      const cached = this.collectionCache.get(bookId.toString())
      if (cached) {
        this.collection = cached.collection
        this.currentBookId = bookId
        this.currentCollectionName = cached.name
        return cached.name
      }

      const desiredCollectionName = this.getBookCollectionName(bookId)

      // Load known collections once per process to avoid repeated list calls
      if (!this.collectionsLoaded) {
        if (!this.collectionsLoadPromise) {
          this.collectionsLoadPromise = (async () => {
            const collections = await this.db.listCollections()
            collections.forEach((col) => {
              const dim = col.options?.vector?.dimension
              this.knownCollections.set(col.name, { dimension: dim })
            })
            this.collectionsLoaded = true
          })()
        }
        await this.collectionsLoadPromise
      }

      // Prefer exact match; otherwise, try to find best legacy/truncated match
      let resolvedName = desiredCollectionName
      let known = this.knownCollections.get(resolvedName)

      if (!known) {
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
          resolvedName = bestMatchName
          known = this.knownCollections.get(resolvedName)
        }
      }

      if (known) {
        const existingDimension = known.dimension
        if (existingDimension && existingDimension !== this.vectorDimensions) {
          this.vectorDimensions = existingDimension
        }
      } else {
        const modelDimensions = this.getModelDimensions(this.embeddingModelName)
        if (modelDimensions !== this.vectorDimensions) {
          this.vectorDimensions = modelDimensions
        }
        await this.createBookCollection(resolvedName)
        // Mark as known now
        this.knownCollections.set(resolvedName, { dimension: this.vectorDimensions })
      }

      const collection = this.db.collection(resolvedName)
      this.collection = collection
      this.currentBookId = bookId
      this.currentCollectionName = resolvedName
      this.collectionCache.set(bookId.toString(), { name: resolvedName, collection })

      return resolvedName
    } catch (error) {
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
      const embeddingModel = this.genAI.getGenerativeModel({ model: this.embeddingModelName })
      const questionEmbeddingResult = await embeddingModel.embedContent(question)
      const questionEmbedding = questionEmbeddingResult.embedding.values

      const similarities = documents.map((doc) => {
        const docEmbedding = doc.$vector
        const similarity = this.cosineSimilarity(questionEmbedding, docEmbedding)
        return { ...doc, $similarity: similarity }
      })

      similarities.sort((a, b) => (b.$similarity || 0) - (a.$similarity || 0))
      return similarities.slice(0, this.maxContextChunks)
    } catch (error) {
      console.error("Retrieval error:", error)
      return []
    }
  }

  async dbVectorSearch(question, searchFilter, limit) {
    // Use Astra server-side vector sort to reduce latency and payload
    const embeddingModel = this.genAI.getGenerativeModel({ model: this.embeddingModelName })
    const questionEmbeddingResult = await embeddingModel.embedContent(question)
    const questionEmbedding = questionEmbeddingResult.embedding.values

    const options = {
      sort: { $vector: questionEmbedding },
      limit: Math.max(1, limit || this.maxContextChunks),
      projection: {
        text_content: 1,
        $vector: 1,
        file_name: 1,
        chunk_index: 1,
        word_count: 1,
      },
    }

    // Some driver versions accept options as second param. If not, fallback without projection
    let results
    // Partitioned execution to reduce tail latency: first top-k fast; if empty, widen
    try {
      results = await this.collection.find(searchFilter, options).toArray()
      if (!results || results.length === 0) {
        // Widen slightly if nothing found
        results = await this.collection.find(searchFilter, { ...options, limit: Math.max(options.limit * 3, 10) }).toArray()
      }
    } catch (err) {
      // Fallback minimal
      results = await this.collection.find(searchFilter).limit(options.limit).toArray()
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
        // Keep server-side vector search top-k small to reduce latency
        relevantResults = await this.dbVectorSearch(question, searchFilter, this.maxContextChunks)
      } catch (_) {
        // Fallback to old approach when vector sort is not available
        const allDocs = await this.collection.find(searchFilter).limit(50).toArray()
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
          maxContextChunks: this.maxContextChunks,
        }
      }
      // With DB-side vector search, processing is minimal
      timingMetrics.processing = 0

      const generationStart = Date.now()
      const topK = relevantResults.slice(0, this.maxContextChunks)
      const answerResult = await this.generateUltraFastAnswer(question, topK, bookId)
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
        maxContextChunks: this.maxContextChunks,
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
        maxContextChunks: this.maxContextChunks,
      }
    }
  }

  async generateUltraFastAnswer(question, relevantChunks, bookId) {
    try {
      const topChunks = relevantChunks.slice(0, this.maxContextChunks)
      const chunkDetails = []

      const context = topChunks
        .map((chunk, index) => {
          const chunkStart = Date.now()
          const similarity = Math.round((chunk.$similarity || 0) * 100)
          const text = chunk.text_content.substring(0, 200)
          const chunkTime = Date.now() - chunkStart
          chunkDetails.push({
            chunkIndex: index + 1,
            timing: chunkTime,
            similarity: similarity,
          })
          return `[${index + 1}] ${text}... (${similarity}% match)`
        })
        .join("\n\n")

      const prompt = `Context: ${context}

      Question: ${question}

      Answer in 1-2 sentences:`

      const generationStart = Date.now()
      const result = await this.chatModel.generateContent({
        contents: [
          {
            parts: [
              { text: "You are a helpful AI assistant that provides concise answers in 1-2 sentences." },
              { text: prompt }
            ]
          }
        ]
      })

      const response = await result.response
      const answer = response.text()
      const generationTime = Date.now() - generationStart

      // Update chunk details with a portion of generation time (approximated)
      chunkDetails.forEach((detail) => {
        detail.timing = Math.round(detail.timing + (generationTime / topChunks.length))
      })

      // Estimate tokens based on text length
      const tokensUsed = Math.round((prompt.length + answer.length) / 4)

      return {
        answer: answer,
        method: "ultra-fast-gemini",
        contextUsed: topChunks.length,
        bookId: bookId,
        tokensUsed: tokensUsed,
        chunkDetails: chunkDetails,
      }
    } catch (error) {
      console.error("Gemini API error:", error)
      return {
        answer: "Unable to generate response. Please try again.",
        method: "error-fallback",
        bookId: bookId,
        tokensUsed: 0,
        chunkDetails: [],
      }
    }
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

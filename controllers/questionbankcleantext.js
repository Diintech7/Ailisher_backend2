require('dotenv').config();
const axios = require('axios');

// Clean and normalize extracted text to only questions and options via OpenRouter
const cleanExtractedText = async (req, res) => {
    try {
        const { extractedText, model } = req.body || {};
        if (!extractedText || typeof extractedText !== 'string' || extractedText.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'extractedText is required' });
        }

        if (!process.env.OPENROUTER_API_KEY) {
            return res.status(500).json({ success: false, message: 'OpenRouter API key not configured' });
        }

        // Heuristic pre-trim to remove obvious QR/barcode and HTML comments before sending to LLM
        let preprocessed = extractedText
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\b(qr\s*code|qrcode|barcode|data\s*matrix|datamatrix|pdf417|aztec\s*code)\b[\s\S]*?(?=\n\n|$)/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        // Split text into chunks if it's too large
        const chunks = splitTextIntoChunks(preprocessed);
        console.log(`Split text into ${chunks.length} chunks for processing`);

        // Process each chunk and collect results
        const allQuestions = [];
        const allCleanedTexts = [];
        let totalProcessed = 0;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} characters)`);
            
            try {
                const chunkResult = await processChunk(chunk, model, i + 1, chunks.length);
                if (chunkResult.questions && chunkResult.questions.length > 0) {
                    // Adjust question numbers for subsequent chunks
                    const adjustedQuestions = chunkResult.questions.map((q, idx) => ({
                        ...q,
                        questionNumber: totalProcessed + idx + 1
                    }));
                    allQuestions.push(...adjustedQuestions);
                    totalProcessed += chunkResult.questions.length;
                }
                if (chunkResult.cleanedText) {
                    allCleanedTexts.push(chunkResult.cleanedText);
                }
            } catch (error) {
                console.error(`Error processing chunk ${i + 1}:`, error);
                // Continue with other chunks even if one fails
            }
        }

        // Combine all cleaned texts
        const combinedCleanedText = allCleanedTexts.join('\n\n--- Next Section ---\n\n');

        console.log(`Successfully processed ${allQuestions.length} total questions from ${chunks.length} chunks`);

        return res.status(200).json({
            success: true,
            message: `Processed ${chunks.length} chunks and generated ${allQuestions.length} questions`,
            data: {
                cleanedText: combinedCleanedText,
                questions: allQuestions,
                questionCount: allQuestions.length,
                chunksProcessed: chunks.length,
                isTruncated: false
            }
        });
    } catch (error) {
        console.error('Error cleaning text via OpenRouter:', error.response?.data || error.message);
        if (error.response) {
            return res.status(error.response.status).json({
                success: false,
                message: 'OpenRouter request failed',
                details: error.response.data
            });
        }
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// New streaming endpoint for real-time chunk processing
const cleanExtractedTextStream = async (req, res) => {
    try {
        const { extractedText, model } = req.body || {};
        if (!extractedText || typeof extractedText !== 'string' || extractedText.trim().length === 0) {
            return res.status(400).json({ success: false, message: 'extractedText is required' });
        }

        if (!process.env.OPENROUTER_API_KEY) {
            return res.status(500).json({ success: false, message: 'OpenRouter API key not configured' });
        }

        // Set up SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        });

        // Heuristic pre-trim to remove obvious QR/barcode and HTML comments before sending to LLM
        let preprocessed = extractedText
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\b(qr\s*code|qrcode|barcode|data\s*matrix|datamatrix|pdf417|aztec\s*code)\b[\s\S]*?(?=\n\n|$)/gi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        // Split text into chunks if it's too large
        const chunks = splitTextIntoChunks(preprocessed);
        console.log(`Split text into ${chunks.length} chunks for streaming processing`);

        // Send initial status
        res.write(`data: ${JSON.stringify({
            type: 'status',
            message: `Starting processing of ${chunks.length} chunks...`,
            totalChunks: chunks.length
        })}\n\n`);

        // Process each chunk and stream results
        const allQuestions = [];
        const allCleanedTexts = [];
        let totalProcessed = 0;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} characters)`);
            
            // Send chunk start status
            res.write(`data: ${JSON.stringify({
                type: 'chunk_start',
                chunkNumber: i + 1,
                totalChunks: chunks.length,
                message: `Processing chunk ${i + 1}/${chunks.length}...`
            })}\n\n`);
            
            try {
                // Add delay between chunks to respect rate limits (except for first chunk)
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between chunks
                }
                const chunkResult = await processChunk(chunk, model, i + 1, chunks.length);
                
                if (chunkResult.questions && chunkResult.questions.length > 0) {
                    // Adjust question numbers for subsequent chunks
                    const adjustedQuestions = chunkResult.questions.map((q, idx) => ({
                        ...q,
                        questionNumber: totalProcessed + idx + 1
                    }));
                    allQuestions.push(...adjustedQuestions);
                    totalProcessed += chunkResult.questions.length;
                }
                if (chunkResult.cleanedText) {
                    allCleanedTexts.push(chunkResult.cleanedText);
                }

                // Send chunk completion with new questions
                res.write(`data: ${JSON.stringify({
                    type: 'chunk_complete',
                    chunkNumber: i + 1,
                    totalChunks: chunks.length,
                    questions: chunkResult.questions || [],
                    cleanedText: chunkResult.cleanedText || '',
                    totalQuestionsProcessed: totalProcessed,
                    message: `Chunk ${i + 1} completed with ${chunkResult.questions?.length || 0} questions`
                })}\n\n`);

            } catch (error) {
                console.error(`Error processing chunk ${i + 1}:`, error);
                
                // Check if it's a rate limit error
                const isRateLimit = error.message.includes('429') || error.message.includes('rate limit');
                
                // Send chunk error with specific message for rate limits
                res.write(`data: ${JSON.stringify({
                    type: 'chunk_error',
                    chunkNumber: i + 1,
                    totalChunks: chunks.length,
                    error: error.message,
                    message: isRateLimit 
                        ? `Rate limit reached for chunk ${i + 1}. Please wait and try again.` 
                        : `Error processing chunk ${i + 1}`,
                    isRateLimit: isRateLimit
                })}\n\n`);
                
                // If it's a rate limit error, we might want to stop processing
                if (isRateLimit) {
                    console.log('Rate limit reached, stopping chunk processing');
                    break;
                }
                
                // Continue with other chunks even if one fails (for non-rate-limit errors)
            }
        }

        // Combine all cleaned texts
        const combinedCleanedText = allCleanedTexts.join('\n\n--- Next Section ---\n\n');

        // Send final completion
        res.write(`data: ${JSON.stringify({
            type: 'complete',
            totalQuestions: allQuestions.length,
            totalChunks: chunks.length,
            cleanedText: combinedCleanedText,
            questions: allQuestions,
            message: `Successfully processed ${allQuestions.length} total questions from ${chunks.length} chunks`
        })}\n\n`);

        console.log(`Streaming completed: ${allQuestions.length} total questions from ${chunks.length} chunks`);
        res.end();

    } catch (error) {
        console.error('Error in streaming text cleaning:', error);
        
        // Send error event
        res.write(`data: ${JSON.stringify({
            type: 'error',
            error: error.message,
            message: 'Failed to process text'
        })}\n\n`);
        
        res.end();
    }
};

// Function to split text into manageable chunks
const splitTextIntoChunks = (text, maxChunkSize = 2000) => {
    const chunks = [];
    const lines = text.split('\n');
    let currentChunk = '';
    let currentChunkSize = 0;

    for (const line of lines) {
        const lineSize = line.length;
        
        // If adding this line would exceed the chunk size, start a new chunk
        if (currentChunkSize + lineSize > maxChunkSize && currentChunk.trim()) {
            chunks.push(currentChunk.trim());
            currentChunk = line + '\n';
            currentChunkSize = lineSize + 1;
        } else {
            currentChunk += line + '\n';
            currentChunkSize += lineSize + 1;
        }
    }

    // Add the last chunk if it has content
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    // If we have only one chunk and it's still too large, split by sentences
    if (chunks.length === 1 && chunks[0].length > maxChunkSize) {
        return splitTextBySentences(text, maxChunkSize);
    }

    return chunks;
};

// Fallback function to split by sentences if line-based splitting doesn't work
const splitTextBySentences = (text, maxChunkSize = 2000) => {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        if ((currentChunk + sentence).length > maxChunkSize && currentChunk.trim()) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += sentence;
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
};

// Function to process a single chunk with retry logic and rate limiting
const processChunk = async (chunkText, model, chunkNumber, totalChunks) => {
    const systemPrompt = `You are an expert MCQ extractor. Extract ALL questions from the input text and format them as:

1. <question text>
   - A) <option>
   - B) <option>
   - C) <option>
   - D) <option>
   Answer: <A|B|C|D>
   Explanation: <brief explanation>

Rules:
- Process ALL questions found in the input
- No preface or extra text
- Keep explanations concise but informative
- Ensure all questions have exactly 4 options
- Number questions sequentially starting from 1
- This is chunk ${chunkNumber} of ${totalChunks} - focus only on questions in this section

Example:
1. What is the capital of France?
   - A) London
   - B) Paris
   - C) Berlin
   - D) Madrid
   Answer: B
   Explanation: Paris is the capital and largest city of France.`;

    const userPrompt = `Extract questions from this text section:\n\n${chunkText}`;

    const chosenModel = model || process.env.OPENROUTER_MODEL || 'nousresearch/deephermes-3-llama-3-8b-preview:free';

    // Retry logic with exponential backoff
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Add delay between requests to respect rate limits
            if (attempt > 1) {
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
                console.log(`Chunk ${chunkNumber}: Retry attempt ${attempt}, waiting ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // Add small delay between chunks to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: chosenModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.2,
                    max_tokens: 4000
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': process.env.APP_PUBLIC_URL || 'http://localhost:4000',
                        'X-Title': process.env.APP_NAME || 'AI Test Gen'
                    },
                    timeout: 60000
                }
            );

            const firstChoice = response.data?.choices?.[0] || {};
            const possibleContents = [
                firstChoice?.message?.content,
                firstChoice?.content,
                firstChoice?.text,
                response.data?.output_text
            ].filter(Boolean);

            let cleaned = (possibleContents[0] || '').trim();

            // Debug logging for chunk
            console.log(`Chunk ${chunkNumber} response length: ${cleaned.length} characters`);

            // Server-side sanitization to enforce no preface
            if (cleaned) {
                const firstItemIndex = cleaned.search(/^\s*1\.\s/m);
                if (firstItemIndex > 0) {
                    cleaned = cleaned.slice(firstItemIndex);
                }
            }

            if (!cleaned) {
                console.log(`Chunk ${chunkNumber} returned no content`);
                return { questions: [], cleanedText: '' };
            }

            // Check if response was truncated
            const isTruncated = response.data?.choices?.[0]?.finish_reason === 'length';
            if (isTruncated) {
                console.log(`Warning: Chunk ${chunkNumber} response was truncated`);
            }

            // Parse the cleaned text into structured questions array
            const questions = parseQuestionsFromText(cleaned);
            
            console.log(`Chunk ${chunkNumber} parsed ${questions.length} questions`);

            return {
                questions: questions,
                cleanedText: cleaned,
                isTruncated: isTruncated
            };

        } catch (error) {
            lastError = error;
            console.error(`Chunk ${chunkNumber} attempt ${attempt} failed:`, error.response?.data || error.message);
            
            // If it's a rate limit error (429), wait longer
            if (error.response?.status === 429) {
                const rateLimitDelay = Math.min(5000 * Math.pow(2, attempt - 1), 30000); // Max 30 seconds for rate limits
                console.log(`Chunk ${chunkNumber}: Rate limit hit, waiting ${rateLimitDelay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, rateLimitDelay));
            }
            
            // If this is the last attempt, throw the error
            if (attempt === maxRetries) {
                throw new Error(`Chunk ${chunkNumber} failed after ${maxRetries} attempts: ${error.response?.data?.error?.message || error.message}`);
            }
        }
    }
};

// Function to parse cleaned text into structured questions array
const parseQuestionsFromText = (text) => {
    const questions = [];
    const lines = text.split('\n');
    let currentQuestion = null;
    let currentOptions = [];
    let currentCorrectAnswer = null;
    let currentExplanation = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (!line) continue;

        // Check if this is a new question (starts with number followed by dot)
        const questionMatch = line.match(/^(\d+)\.\s*(.+)$/);
        if (questionMatch) {
            // Save previous question if exists
            if (currentQuestion && currentOptions.length > 0) {
                questions.push({
                    questionText: currentQuestion,
                    options: currentOptions,
                    correctAnswer: currentCorrectAnswer,
                    explanation: currentExplanation
                });
            }
            
            // Start new question
            currentQuestion = questionMatch[2];
            currentOptions = [];
            currentCorrectAnswer = null;
            currentExplanation = '';
            continue;
        }

        // Check if this is an option (starts with - A), B), C), D))
        const optionMatch = line.match(/^-\s*([A-D])\)\s*(.+)$/);
        if (optionMatch && currentQuestion) {
            const optionLetter = optionMatch[1];
            const optionText = optionMatch[2];
            
            // Ensure we have exactly 4 options (A, B, C, D)
            const optionIndex = optionLetter.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
            
            // Fill any missing options with empty strings
            while (currentOptions.length <= optionIndex) {
                currentOptions.push('');
            }
            
            currentOptions[optionIndex] = optionText;
            continue;
        }

        // Check for Answer line
        const answerMatch = line.match(/^Answer:\s*([A-D])$/i);
        if (answerMatch && currentQuestion) {
            const answerLetter = answerMatch[1].toUpperCase();
            currentCorrectAnswer = answerLetter.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
            continue;
        }

        // Check for Explanation line
        const explanationMatch = line.match(/^Explanation:\s*(.+)$/i);
        if (explanationMatch && currentQuestion) {
            currentExplanation = explanationMatch[1].trim();
            continue;
        }
    }

    // Add the last question if exists
    if (currentQuestion && currentOptions.length > 0) {
        questions.push({
            questionText: currentQuestion,
            options: currentOptions,
            correctAnswer: currentCorrectAnswer,
            explanation: currentExplanation
        });
    }

    // Filter out questions with insufficient options and validate structure
    return questions.filter(q => 
        q.questionText && 
        q.questionText.trim() && 
        q.options && 
        Array.isArray(q.options) && 
        q.options.length >= 2 &&
        q.options.some(opt => opt && opt.trim())
    );
};

module.exports = { cleanExtractedText, cleanExtractedTextStream };
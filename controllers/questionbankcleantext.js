require('dotenv').config();
const axios = require('axios');

// Allowed subjects for classification
const allowedSubjects = [
    'history',
    'geography',
    'polity',
    'economy',
    'science and tech',
    'current affairs',
    'maths',
    'reasoning',
    'international relation',
    'art and culture',
    'environment',
    'agriculture'
];

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
        console.log(`Split text into ${chunks.length} pages for processing`);

        // Process each chunk and collect results
        const allQuestions = [];
        const allCleanedTexts = [];
        let totalProcessed = 0;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`Processing page ${i + 1}/${chunks.length} (${chunk.length} characters)`);

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
                console.error(`Error processing page ${i + 1}:`, error);
                // Continue with other chunks even if one fails
            }
        }

        // Combine all cleaned texts
        const combinedCleanedText = allCleanedTexts.join('\n\n--- Next Section ---\n\n');

        console.log(`Successfully processed ${allQuestions.length} total questions from ${chunks.length} pages`);

        return res.status(200).json({
            success: true,
            message: `Processed ${chunks.length} pages and generated ${allQuestions.length} questions`,
            data: {
                cleanedText: combinedCleanedText,
                questions: allQuestions,
                questionCount: allQuestions.length,
                pagesProcessed: chunks.length,
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
        console.log(`Split text into ${chunks.length} pages for streaming processing`);

        // Debug: Log chunk details
        chunks.forEach((chunk, idx) => {
            console.log(`\n--- Chunk ${idx + 1} Details ---`);
            console.log(`Length: ${chunk.length} characters`);
            console.log(`Starts with: "${chunk.substring(0, 100)}..."`);
            console.log(`Ends with: "...${chunk.substring(chunk.length - 100)}"`);
        });

        // Send initial status
        res.write(`data: ${JSON.stringify({
            type: 'status',
            message: `Starting processing of ${chunks.length} pages...`,
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
                message: `Processing page ${i + 1}/${chunks.length}...`
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
                    message: `Page ${i + 1} completed with ${chunkResult.questions?.length || 0} questions`
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
                        ? `Rate limit reached for page ${i + 1}. Please wait and try again.`
                        : `Error processing page ${i + 1}`,
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
            message: `Successfully processed ${allQuestions.length} total questions from ${chunks.length} pages`
        })}\n\n`);

        console.log(`Streaming completed: ${allQuestions.length} total questions from ${chunks.length} pages`);
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
    // First, try to split by page boundaries
    const pageChunks = splitTextByPages(text);

    // If we have page-based chunks, use them
    if (pageChunks.length > 1) {
        console.log(`Split text into ${pageChunks.length} page-based chunks`);
        return pageChunks;
    }

    // Fallback to the original chunking logic
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

// Function to split text by page boundaries (--- Page X ---)
const splitTextByPages = (text) => {
    // Look for page boundary patterns like "--- Page 1 ---", "--- Page 2 ---", etc.
    const pagePattern = /---\s*Page\s*(\d+)\s*---/gi;
    const matches = [...text.matchAll(pagePattern)];

    console.log(`Found ${matches.length} page boundaries in text`);

    if (matches.length <= 1) {
        // If no page boundaries found or only one page, return the whole text as one chunk
        console.log('No page boundaries detected, using single chunk');
        return [text.trim()];
    }

    const chunks = [];

    // Handle the first page (from start to first page boundary)
    const firstPageEnd = matches[0].index;
    const firstChunk = text.substring(0, firstPageEnd).trim();
    if (firstChunk && firstChunk.length > 10) { // Ensure meaningful content
        chunks.push(firstChunk);
        console.log(`Added first chunk with ${firstChunk.length} characters`);
    }

    // Handle middle pages (between page boundaries)
    for (let i = 0; i < matches.length - 1; i++) {
        const currentMatch = matches[i];
        const nextMatch = matches[i + 1];
        const chunk = text.substring(currentMatch.index, nextMatch.index).trim();
        if (chunk && chunk.length > 10) { // Ensure meaningful content
            chunks.push(chunk);
            console.log(`Added chunk ${chunks.length} with ${chunk.length} characters`);
        } else {
            console.log(`Skipping empty chunk between pages ${i + 1} and ${i + 2}`);
        }
    }

    // Handle the last page (from last page boundary to end)
    const lastMatch = matches[matches.length - 1];
    const lastChunk = text.substring(lastMatch.index).trim();
    if (lastChunk && lastChunk.length > 10) { // Ensure meaningful content
        chunks.push(lastChunk);
        console.log(`Added final chunk with ${lastChunk.length} characters`);
    } else {
        console.log(`Skipping empty final chunk`);
    }

    // If we still have only one chunk, it means the page boundaries weren't properly detected
    if (chunks.length <= 1) {
        console.log('Page boundaries not properly detected, using single chunk');
        return [text.trim()];
    }

    console.log(`Successfully split text into ${chunks.length} page-based chunks`);

    // Debug: Log the first few characters of each chunk
    chunks.forEach((chunk, idx) => {
        console.log(`Chunk ${idx + 1} preview: "${chunk.substring(0, 100)}..."`);
    });

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

// Try to parse JSON returned by the model and normalize to internal shape
const tryParseQuestionsJson = (rawText) => {
    try {
        // Some models may wrap JSON in code fences or add stray text; try to extract JSON substring
        let text = rawText.trim();
        const fenceMatch = text.match(/\{[\s\S]*\}/);
        if (fenceMatch) {
            text = fenceMatch[0];
        }

        const parsed = JSON.parse(text);
        const inputQuestions = Array.isArray(parsed) ? parsed : parsed?.questions;
        if (!Array.isArray(inputQuestions)) return null;

        const normalized = inputQuestions
            .map((q, idx) => {
                if (!q) return null;
                const questionText = (q.questionText || q.question || '').toString().trim();
                const optionsRaw = Array.isArray(q.options) ? q.options : [];
                const options = optionsRaw
                    .slice(0, 4)
                    .map(opt => (opt == null ? '' : String(opt))).concat(Array(4).fill(''))
                    .slice(0, 4);

                // answer may be a letter (A-D) or index
                let correctAnswer = null;
                if (typeof q.answer === 'string') {
                    const letter = q.answer.trim().toUpperCase();
                    if (/^[ABCD]$/.test(letter)) {
                        correctAnswer = letter.charCodeAt(0) - 65;
                    }
                } else if (typeof q.answer === 'number') {
                    const idxNum = Math.floor(q.answer);
                    if (idxNum >= 0 && idxNum <= 3) correctAnswer = idxNum;
                }

                const explanation = (q.explanation || '').toString().trim();

                // subject normalization
                let subject = (q.subject || '').toString().trim().toLowerCase();
                if (!allowedSubjects.includes(subject)) {
                    subject = '';
                }

                // topic name and tags
                const topicName = (q.topicName || q.topic || '').toString().trim();
                let topicTags = q.topicTags;
                if (typeof topicTags === 'string') {
                    topicTags = topicTags.split(',').map(s => s.trim()).filter(Boolean);
                }
                if (!Array.isArray(topicTags)) topicTags = [];
                topicTags = topicTags.map(t => String(t)).slice(0, 5);

                // difficulty normalization -> enforce L1/L2/L3; map prior easy/medium/hard
                let difficultyRaw = (q.difficulty || '').toString().trim();
                let difficultyLower = difficultyRaw.toLowerCase();
                let difficulty = '';
                if (['l1', 'l2', 'l3'].includes(difficultyLower)) {
                    difficulty = difficultyLower.toUpperCase();
                } else if (difficultyLower === 'easy') {
                    difficulty = 'L1';
                } else if (difficultyLower === 'medium') {
                    difficulty = 'L2';
                } else if (difficultyLower === 'hard') {
                    difficulty = 'L3';
                }

                if (!questionText) return null;

                return {
                    questionNumber: typeof q.questionNumber === 'number' ? q.questionNumber : idx + 1,
                    questionText,
                    options,
                    correctAnswer,
                    explanation,
                    subject,
                    topicName,
                    topicTags,
                    difficulty
                };
            })
            .filter(Boolean);

        return normalized;
    } catch (e) {
        return null;
    }
};

// Function to process a single chunk with retry logic and rate limiting
const processChunk = async (chunkText, model, chunkNumber, totalChunks) => {
    // Debug: Log chunk details
    console.log(`\n=== Processing Chunk ${chunkNumber}/${totalChunks} ===`);
    console.log(`Chunk length: ${chunkText.length} characters`);
    console.log(`Chunk preview: "${chunkText.substring(0, 200)}..."`);
    console.log(`Chunk ends with: "...${chunkText.substring(chunkText.length - 100)}"`);

    // Check if chunk has meaningful content
    if (!chunkText || chunkText.trim().length < 20) {
        console.log(`Chunk ${chunkNumber} has insufficient content, skipping`);
        return { questions: [], cleanedText: '' };
    }

    // Check if chunk contains only page boundaries or whitespace
    const meaningfulContent = chunkText.replace(/---\s*Page\s*\d+\s*---/gi, '').trim();
    if (meaningfulContent.length < 10) {
        console.log(`Chunk ${chunkNumber} contains only page boundaries, skipping`);
        return { questions: [], cleanedText: '' };
    }

    // use top-level allowedSubjects

    const systemPrompt = `You are an expert MCQ extractor and classifier.

Extract ALL objective questions (MCQs) from the input and RETURN ONLY JSON with this exact shape (no narration, no markdown fences):
{
  "questions": [
    {
      "questionNumber": <integer starting from 1>,
      "questionText": "<question text>",
      "options": ["<A>", "<B>", "<C>", "<D>"],
      "answer": "A|B|C|D",
      "explanation": "<brief explanation>",
      "subject": "one of: ${allowedSubjects.join(', ')}",
      "topicName": "<most relevant topic name>",
      "topicTags": ["<3 to 5 short tags>"],
      "difficulty": "L1|L2|L3"
    }
  ]
}

STRICT EXTRACTION RULES:
1) Question stem vs options:
   - Treat ONLY the first four top-level choices labelled with a single capital letter A, B, C, D as the options.
   - Valid option prefixes include any of: "A)", "(A)", "A.", "A -", "A :" (same for B, C, D). Normalize spacing.
   - Everything appearing BEFORE the first option label (A/B/C/D) is part of the questionText, even if it contains uppercase words or line-breaks.
   - When the stem includes roman-numbered statements (i., ii., iii., iv., …), keep them inside questionText as-is.
   - The question ALWAYS starts with a visible number indicator such as "1.", "1)" or "1 -" (or any integer followed by '.' or ')'). Consider the questionText to start at that number and continue up to (but not including) the first A/B/C/D option label. All content between the number-start and the first A-option belongs to questionText.

2) Ignore noise:
   - Ignore QR/barcodes/watermarks/page codes and stray capitalized words that are NOT explicit A–D options.
   - If more than 4 choices are listed, keep ONLY A–D in order.

3) Multiple-statement stems:
   - If the stem lists items (i., ii., iii., iv.) and the options refer to combinations (e.g., "ii, iii and iv"), keep the stem items in questionText and copy each option string exactly as written.

4) Output constraints:
   - Ensure exactly 4 options are returned. Trim whitespace but preserve core text.
   - Set answer to the correct letter A/B/C/D when explicitly indicated in the input. If not present, infer conservatively only when obvious, else leave explanation empty and still provide best-guess answer.
   - Subjects MUST be from the allowed list.
   - Provide 3–5 concise topicTags.
   - difficulty is one of L1 (basic), L2 (intermediate), L3 (advanced).

EXAMPLES (format guidance only, do not fabricate):
Example-Combo:
1. Dalton's atomic theory successfully explained\n i. Law of conservation of mass.\n ii. Law of constant composition.\n iii. Law of radioactivity.\n iv. Law of multiple proportion.\n (A) ii, iii and iv\n (B) i, ii and iii\n (C) i, ii and iv\n (D) i, iii and iv
→ questionText includes the full stem with i–iv lines; options are exactly A–D lines.

Example-Standard:
1. Which of the following human races inhabitates in China, Mangolia and Japan?\n (A) Australoid\n (B) Negro\n (C) Mongoloid\n (D) Nordic
→ Standard four options A–D.

Operational rules:
- Process ONLY this chunk (${chunkNumber}/${totalChunks}).
- Respond with valid JSON only (no extra text).`;

    const userPrompt = `Extract and classify questions from this text section. Return valid JSON only.\n\n${chunkText}`;

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
            console.log(`Chunk ${chunkNumber} AI response preview: "${cleaned.substring(0, 300)}..."`);
            console.log(`Chunk ${chunkNumber} AI response ends with: "...${cleaned.substring(cleaned.length - 100)}"`);

            if (!cleaned) {
                console.log(`Chunk ${chunkNumber} returned no content`);
                return { questions: [], cleanedText: '' };
            }

            // Check if response contains error messages or is just whitespace
            if (cleaned.toLowerCase().includes('error') || cleaned.toLowerCase().includes('sorry') || cleaned.trim().length < 10) {
                console.log(`Chunk ${chunkNumber} returned error or empty response: "${cleaned}"`);
                return { questions: [], cleanedText: '' };
            }

            // Check if response was truncated
            const isTruncated = response.data?.choices?.[0]?.finish_reason === 'length';
            if (isTruncated) {
                console.log(`Warning: Chunk ${chunkNumber} response was truncated`);
            }

            // Try to parse JSON first; fall back to text parser if needed
            let questions = [];
            const jsonParsed = tryParseQuestionsJson(cleaned);
            console.log(`Chunk ${chunkNumber} JSON parsing result:`, jsonParsed ? `${jsonParsed.length} questions` : 'null');

            if (jsonParsed && Array.isArray(jsonParsed) && jsonParsed.length > 0) {
                questions = jsonParsed;
            } else {
                // If model ignored JSON instruction, try text format
                // Keep backward compatibility with the previous parser
                questions = parseQuestionsFromText(cleaned);
                console.log(`Chunk ${chunkNumber} fallback text parsing result:`, questions.length, 'questions');
            }

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
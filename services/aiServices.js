const axios = require("axios");
const FormData = require("form-data");
const { AiswbQuestion } = require("../models/AiswbQuestion");
const AiServiceConfig = require("../models/AIServiceConfig");

// NOTE: Do not use a global feature flag here; prompt control is passed via function opts


const getServiceForTask = async (taskType) => {
  try {
    const service = await AiServiceConfig.getActiveServiceForTask(taskType);
    if (!service) {
      throw new Error(`No active AI service configured for task: ${taskType}`);
    }
    return service;
  } catch (error) {
    console.error(`Error getting service for task ${taskType}:`, error);
    throw error;
  }
};

const validateTextRelevanceToQuestion = async (question, extractedTexts) => {
  if (!extractedTexts || extractedTexts.length === 0) {
    return { isValid: false, reason: "No text extracted from images" };
  }

  const hasValidText = extractedTexts.some(
    (text) =>
      text &&
      text.trim().length > 0 &&
      !text.startsWith("Failed to extract text") &&
      !text.startsWith("No readable text found") &&
      !text.includes("Text extraction failed") &&
      text.trim() !== "No readable text found"
  );

  if (!hasValidText) {
    return { isValid: false, reason: "No readable text found in images" };
  }

  const combinedText = extractedTexts.join(" ").toLowerCase();
  const questionText = question.question.toLowerCase();

  const commonWords = [
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", 
    "for", "of", "with", "by", "is", "are", "was", "were", "be", 
    "been", "have", "has", "had", "do", "does", "did", "will", 
    "would", "could", "should", "may", "might", "can", "what", 
    "when", "where", "why", "how", "which", "who", "whom"
  ];

  const questionWords = questionText
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !commonWords.includes(word));

  try {
    const analysisService = await getServiceForTask("analysis");
    const relevancePrompt = `
      Analyze if the following student answer is relevant to the given question. 
      QUESTION: ${question.question}
      STUDENT ANSWER: ${combinedText}
      Please respond with only "RELEVANT" or "NOT_RELEVANT" followed by a brief reason.
      Consider the answer relevant if:
      1. It attempts to address the question topic
      2. It contains subject-related content
      3. It shows understanding of the question context
      Consider it NOT_RELEVANT if:
      1. It's completely unrelated to the question
      2. It's just random text or numbers
      3. It's clearly not an attempt to answer the question
    `;

    let relevanceResponse = null;
    if (analysisService.serviceName === "gemini") {
      try {
        const response = await axios.post(
          `${analysisService.apiUrl}?key=${analysisService.apiKey}`,
          {
            contents: [
              {
                parts: [
                  {
                    text: relevancePrompt,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 100,
            },
          },
          {
            headers: { "Content-Type": "application/json" },
            timeout: 15000,
          }
        );

        if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          relevanceResponse = response.data.candidates[0].content.parts[0].text.trim();
        }
      } catch (geminiError) {
        console.error("Gemini relevance check failed:", geminiError.message);
      }
    } else if (analysisService.serviceName === "openai") {
      try {
        const response = await axios.post(
          analysisService.apiUrl,
          {
            model: "gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: relevancePrompt,
              },
            ],
            max_tokens: 100,
            temperature: 0.1,
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${analysisService.apiKey}`,
            },
            timeout: 15000,
          }
        );

        if (response.data?.choices?.[0]?.message?.content) {
          relevanceResponse = response.data.choices[0].message.content.trim();
        }
      } catch (openaiError) {
        console.error("OpenAI relevance check failed:", openaiError.message);
      }
    }

    if (relevanceResponse) {
      const isRelevant =
        relevanceResponse.toUpperCase().includes("RELEVANT") &&
        !relevanceResponse.toUpperCase().includes("NOT_RELEVANT");
      if (!isRelevant) {
        return {
          isValid: false,
          reason: "Answer content is not relevant to the question",
          aiResponse: relevanceResponse,
        };
      }
    }
  } catch (error) {
    console.error("AI relevance check failed:", error.message);
  }

  const matchingWords = questionWords.filter(
    (word) => combinedText.includes(word) || combinedText.includes(word.substring(0, Math.max(4, word.length - 2)))
  );

  if (combinedText.length < 20 && matchingWords.length === 0) {
    return {
      isValid: false,
      reason: "Answer appears to be too short and unrelated to the question",
    };
  }

  const invalidPatterns = [
    /^[\d\s\-+*/=().]+$/,
    /^[a-z\s]{1,10}$/i,
    /^(.)\1{5,}$/,
  ];

  for (const pattern of invalidPatterns) {
    if (pattern.test(combinedText.trim())) {
      return {
        isValid: false,
        reason: "Answer contains invalid or meaningless content",
      };
    }
  }

  return { isValid: true, reason: "Answer appears relevant to the question" };
};

const extractTextFromImagesAgentic = async (imageUrls, serviceConfig) => {
  const extractedTexts = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    try {
      const formData = new FormData();
      if (imageUrl.startsWith("http")) {
        const imageResponse = await axios.get(imageUrl, {
          responseType: "stream",
          timeout: 30000,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; TextExtractor/1.0)",
          },
        });
        if (imageResponse.status !== 200) {
          throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
        }
        let fileExtension = "jpg";
        const contentType = imageResponse.headers["content-type"];
        if (contentType) {
          if (contentType.includes("png")) fileExtension = "png";
          else if (contentType.includes("pdf")) fileExtension = "pdf";
          else if (contentType.includes("webp")) fileExtension = "webp";
        }
        formData.append("image", imageResponse.data, {
          filename: `document_${i + 1}.${fileExtension}`,
          contentType: contentType || "image/jpeg",
        });
      } else {
        formData.append("image", imageUrl, {
          filename: `document_${i + 1}.jpg`,
          contentType: "image/jpeg",
        });
      }

      if (serviceConfig.serviceConfig?.includeMarginalia !== undefined) {
        formData.append("include_marginalia", serviceConfig.serviceConfig.includeMarginalia.toString());
      } else {
        formData.append("include_marginalia", "true");
      }

      if (serviceConfig.serviceConfig?.includeMetadataInMarkdown !== undefined) {
        formData.append(
          "include_metadata_in_markdown",
          serviceConfig.serviceConfig.includeMetadataInMarkdown.toString()
        );
      } else {
        formData.append("include_metadata_in_markdown", "true");
      }

      const queryParams = new URLSearchParams();
      if (serviceConfig.serviceConfig?.pages) {
        queryParams.append("pages", serviceConfig.serviceConfig.pages);
      }
      if (serviceConfig.serviceConfig?.timeout) {
        queryParams.append("timeout", serviceConfig.serviceConfig.timeout.toString());
      }

      const apiUrl = `https://api.va.landing.ai/v1/tools/agentic-document-analysis${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
      const agenticResponse = await axios.post(apiUrl, formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Basic ${serviceConfig.apiKey}`,
        },
        timeout: (serviceConfig.serviceConfig?.timeout || 480) * 1000,
      });

      const responseData = agenticResponse.data;
      if (typeof responseData === "string" && responseData.includes("<!DOCTYPE html>")) {
        throw new Error("Authentication failed - received HTML redirect page instead of API response");
      }

      if (agenticResponse.status === 200 && responseData && responseData.data) {
        let extractedText = "";
        const apiData = responseData.data;
        if (apiData.markdown && apiData.markdown.trim()) {
          extractedText = apiData.markdown.trim();
        } else if (apiData.chunks && Array.isArray(apiData.chunks)) {
          const chunkTexts = apiData.chunks
            .filter((chunk) => chunk.text && chunk.text.trim())
            .map((chunk) => chunk.text.trim());
          if (chunkTexts.length > 0) {
            extractedText = chunkTexts.join("\n\n");
          }
        }

        if (extractedText && extractedText.length > 0) {
          extractedTexts.push(extractedText);
        } else {
          extractedTexts.push("No readable text found");
        }

        if (responseData.errors && responseData.errors.length > 0) {
          console.warn(`Agentic API warnings for image ${i + 1}:`, responseData.errors);
        }
        if (responseData.extraction_error) {
          console.warn(`Agentic API extraction error for image ${i + 1}:`, responseData.extraction_error);
        }
      } else {
        throw new Error(`Unexpected response status or format: ${agenticResponse.status}`);
      }
    } catch (error) {
      let errorMessage = "Failed to extract text with Agentic API";
      if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
        errorMessage = "Agentic API extraction timed out - document may be too complex";
      } else if (error.response?.status === 401 || error.message.includes("401")) {
        errorMessage = "Agentic API authentication failed - check API key";
      } else if (error.response?.status === 429 || error.message.includes("429")) {
        errorMessage = "Agentic API rate limit exceeded - please try again later";
      } else if (error.response?.status === 400) {
        errorMessage = "Invalid request to Agentic API - check document format";
      } else if (error.response?.status >= 500) {
        errorMessage = "Agentic API server error - please try again later";
      } else if (error.message.includes("content type")) {
        errorMessage = "Invalid document format for Agentic API";
      }
      extractedTexts.push(`${errorMessage}: ${error.message}`);
    }
  }
  return extractedTexts;
};

const extractTextFromJsonStructure = (jsonData) => {
  let text = "";
  if (typeof jsonData === "string") {
    return jsonData;
  }
  if (Array.isArray(jsonData)) {
    return jsonData.map((item) => extractTextFromJsonStructure(item)).join(" ");
  }
  if (typeof jsonData === "object" && jsonData !== null) {
    for (const [key, value] of Object.entries(jsonData)) {
      if (typeof value === "string" && value.trim()) {
        text += value + " ";
      } else if (typeof value === "object") {
        text += extractTextFromJsonStructure(value) + " ";
      }
    }
  }
  return text.trim();
};

const extractTextFromImages = async (imageUrls) => {
  try {
    const textExtractionService = await getServiceForTask("text_extraction");
    if (textExtractionService.serviceName === "agentic") {
      return await extractTextFromImagesAgentic(imageUrls, textExtractionService);
    } else if (textExtractionService.serviceName === "openai") {
      return await extractTextFromImagesOpenAI(imageUrls, textExtractionService);
    } else if (textExtractionService.serviceName === "gemini") {
      return await extractTextFromImagesGemini(imageUrls, textExtractionService);
    } else {
      throw new Error(`Unsupported service for text extraction: ${textExtractionService.serviceName}`);
    }
  } catch (error) {
    console.error("Text extraction failed:", error);
    throw error;
  }
};

const extractTextFromImagesOpenAI = async (imageUrls, serviceConfig) => {
  const extractedTexts = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    try {
      let processedImageUrl = imageUrl;
      if (!imageUrl.includes("cloudinary.com")) {
        const imageResponse = await axios.get(imageUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; TextExtractor/1.0)",
          },
        });
        if (imageResponse.status !== 200) {
          throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
        }
        const contentType = imageResponse.headers["content-type"];
        if (!contentType || !contentType.startsWith("image/")) {
          throw new Error(`Invalid content type: ${contentType}`);
        }
        const imageBuffer = Buffer.from(imageResponse.data);
        const base64Image = imageBuffer.toString("base64");
        let imageFormat = "jpeg";
        if (contentType.includes("png")) imageFormat = "png";
        else if (contentType.includes("webp")) imageFormat = "webp";
        else if (contentType.includes("gif")) imageFormat = "gif";
        processedImageUrl = `data:image/${imageFormat};base64,${base64Image}`;
      }

      const visionResponse = await axios.post(
        serviceConfig.apiUrl,
        {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `You are a precise OCR (Optical Character Recognition) system. Your task is to extract ALL text content from this image.
Instructions:
1. Extract ALL visible text exactly as it appears
2. Maintain the original formatting, line breaks, and spacing
3. Include mathematical equations, formulas, and symbols
4. Include any handwritten text if clearly readable
5. Do not add explanations, interpretations, or additional commentary
6. If the text is in multiple languages, extract all of it
7. If there are tables, preserve the table structure
8. If no readable text is found, respond with exactly: "No readable text found"
Return only the extracted text content:`,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: processedImageUrl,
                    detail: "high",
                  },
                },
              ],
            },
          ],
          max_tokens: 2000,
          temperature: 0.1,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceConfig.apiKey}`,
          },
          timeout: 45000,
        }
      );

      if (!visionResponse.data || !visionResponse.data.choices || visionResponse.data.choices.length === 0) {
        throw new Error("Invalid response structure from OpenAI Vision API");
      }
      const choice = visionResponse.data.choices[0];
      if (!choice.message || !choice.message.content) {
        throw new Error("No content in OpenAI Vision API response");
      }
      const extractedText = choice.message.content.trim();
      if (extractedText === "No readable text found" || extractedText.length === 0) {
        extractedTexts.push("No readable text found");
      } else {
        extractedTexts.push(extractedText);
      }
    } catch (error) {
      let errorMessage = "Failed to extract text";
      if (error.message.includes("timeout")) {
        errorMessage = "Text extraction timed out - image may be too large";
      } else if (error.message.includes("API key")) {
        errorMessage = "API authentication failed";
      } else if (error.message.includes("rate limit")) {
        errorMessage = "Rate limit exceeded - please try again later";
      } else if (error.message.includes("content type")) {
        errorMessage = "Invalid image format";
      }
      extractedTexts.push(`${errorMessage}: ${error.message}`);
    }
  }
  return extractedTexts;
};

const extractTextFromImagesGemini = async (imageUrls, serviceConfig) => {
  const extractedTexts = [];
  for (const imageUrl of imageUrls) {
    try {
      const imageResponse = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      const imageBuffer = Buffer.from(imageResponse.data);
      const base64Image = imageBuffer.toString("base64");
      const contentType = imageResponse.headers["content-type"] || "image/jpeg";

      const response = await axios.post(
        `${serviceConfig.apiUrl}?key=${serviceConfig.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: "Extract all text content from this image. Return only the text as it appears, maintaining original formatting. If no text is found, respond with 'No readable text found'.",
                },
                {
                  inline_data: {
                    mime_type: contentType,
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        }
      );

      const extractedText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No readable text found";
      extractedTexts.push(extractedText.trim());
    } catch (error) {
      console.error("Gemini extraction error:", error.message);
      extractedTexts.push(`Failed to extract text: ${error.message}`);
    }
  }
  return extractedTexts;
};

const extractTextFromImagesWithFallback = async (imageUrls) => {
  if (!imageUrls || imageUrls.length === 0) {
    return [];
  }
  try {
    return await extractTextFromImages(imageUrls);
  } catch (error) {
    try {
      const activeServices = await AiServiceConfig.getActiveServices();
      const fallbackService = activeServices.find(
        (service) => service.supportedTasks.includes("text_extraction") && !service.taskPreferences.text_extraction
      );
      if (fallbackService) {
        if (fallbackService.serviceName === "agentic") {
          return await extractTextFromImagesAgentic(imageUrls, fallbackService);
        } else if (fallbackService.serviceName === "openai") {
          return await extractTextFromImagesOpenAI(imageUrls, fallbackService);
        } else if (fallbackService.serviceName === "gemini") {
          return await extractTextFromImagesGemini(imageUrls, fallbackService);
        }
      }
    } catch (fallbackError) {
      console.error("Fallback text extraction also failed:", fallbackError);
    }
    return imageUrls.map(
      (_, index) =>
        `Text extraction failed for image ${index + 1}. Please ensure the image is clear and contains readable text.`
    );
  }
};

const getEvaluationParameters = () => {
  return {
    analysis: {
      introduction: [
        "Relevant introduction, as defined, about the topic with appropriate context",
        "Relevant Introduction supported by data like statistical figures or research findings",
        "Your introduction is well presented with factual information and clear context",
        "Your introduction is valid but concise and mentions key keywords effectively",
        "Your introduction is general, you may start introduction with more specific focus",
        "Your introduction can be enriched by adding keywords related to the core topic",
        "Your introduction is relevant but too long - it needs to be concise, within 20-30 words",
        "Introduction lacks clarity and fails to establish proper context for the answer",
        "Introduction is too brief and doesn't provide adequate background information",
        "Introduction effectively sets the stage for detailed discussion of the topic"
      ],
      body: [
        "Frame the heading to reflect the core demand of the question accurately",
        "Well-formatted main heading in a box with proper structure and clarity",
        "Write main heading in a box to enhance visual presentation and readability",
        "You missed a part of demand of question - ensure comprehensive coverage",
        "Your presentation is rough; avoid paragraph format and use structured points",
        "Your points are not very effective; present them in a more structured and impactful manner",
        "Your points are relevant, but they need substantiation with examples to strengthen argument",
        "Valid point with proper substantiation using facts, data, or real-world examples",
        "Your points are valid as per the implicit demand but add supporting points for completeness",
        "Your points are valid as per the explicit demand but include additional relevant aspects",
        "Your points are valid and substantiated with credible evidence and examples",
        "Your points are valid and supported by relevant examples from current affairs",
        "Try to use heading and subheadings for better presentation and logical flow",
        "Try to understand core demand of question and address all aspects systematically",
        "Points are valid but use sub-headings for better presentation and organization",
        "Your points can be enriched by elaborating properly with detailed explanations",
        "Underline specific keywords for better presentation and emphasis of key concepts",
        "You should work on presentation - improve formatting and visual appeal",
        "Your points can be enriched by adding examples or substantiate them with evidence",
        "Enrich your points by adding examples or substantiate with current developments",
        "Your points are less effective and can be enriched in effective manner with depth",
        "Good use of diagram and relevant content - visual aids enhance understanding",
        "Good use of map but the map can be drawn better with clearer labels and details",
        "Lack of legibility - Please work on handwriting clarity and neatness",
        "Your points are valid but need supporting data, facts, reports and current statistics",
        "Content shows good understanding but lacks proper organization and structure",
        "Answer demonstrates knowledge but fails to connect ideas logically",
        "Points are scattered and need better sequencing for coherent presentation",
        "Good analytical approach but needs more depth in explanation of concepts",
        "Answer covers multiple dimensions but lacks focus on key aspects"
      ],
      conclusion: [
        "Your conclusion is based on balanced answer and provides logical closure",
        "Relevant conclusion, as it reflects a futuristic vision and forward-thinking approach",
        "Your conclusion is relevant as it outlines suggestions in a constructive manner",
        "Less effective conclusion - you may conclude in more impactful manner with recommendations",
        "Relevant conclusion but you may add policy suggestions or implementation strategies",
        "Relevant conclusion but you may conclude in more effective manner with broader implications",
        "Your conclusion is relevant as it outlines steps but may be concluded with long-term vision",
        "Your conclusion is relevant but too long - it needs to be concise, within 20-30 words",
        "Conclusion lacks synthesis of main arguments and fails to provide closure",
        "Conclusion is abrupt and doesn't summarize key points effectively",
        "Conclusion effectively ties together all major arguments and provides clear direction",
        "Conclusion shows forward-thinking approach with practical recommendations",
        "Conclusion needs to be more decisive and provide clear stance on the issue"
      ],
      strengths: [
        "Excellent comprehensive understanding of the topic with multi-dimensional analysis",
        "Good conceptual clarity and logical flow of ideas throughout the answer",
        "Effective use of examples and case studies to support arguments",
        "Clear structure with proper introduction, body, and conclusion format",
        "Demonstrates good analytical skills and critical thinking approach",
        "Shows awareness of current affairs and contemporary developments",
        "Proper use of headings and subheadings for better organization",
        "Good presentation with clear handwriting and neat formatting",
        "Balanced approach addressing multiple perspectives of the issue",
        "Relevant content that directly addresses the core demand of the question",
        "Effective use of data, statistics, and factual information",
        "Good time management evident from complete answer within given format",
        "Shows in-depth subject knowledge and understanding of concepts",
        "Creative approach with innovative solutions and suggestions",
        "Proper conclusion that ties together all major arguments effectively"
      ],
      weaknesses: [
        "Lacks comprehensive coverage of all aspects mentioned in the question",
        "Poor presentation and formatting affects overall readability",
        "Insufficient examples and case studies to support the arguments",
        "Missing proper structure - needs clear introduction, body, and conclusion",
        "Lacks depth in analysis and fails to explore various dimensions",
        "Poor handwriting and illegible content in several sections",
        "Doesn't address the core demand of the question effectively",
        "Lacks supporting data, facts, and current statistics",
        "Too lengthy without proper organization and focus",
        "Missing key concepts and terminologies relevant to the topic",
        "Weak conclusion that doesn't provide proper closure",
        "Lacks critical analysis and presents only one-sided view",
        "Poor time management evident from incomplete answer",
        "Lacks contemporary examples and current affairs references",
        "Fails to establish proper linkages between different concepts",
        "Presentation is monotonous without proper headings and subheadings",
        "Lacks originality and creative thinking in approach",
        "Doesn't demonstrate proper understanding of the topic's complexity"
      ],
      suggestions: [
        "Include more specific examples and case studies to strengthen arguments",
        "Improve presentation with proper headings, subheadings, and formatting",
        "Add supporting data, facts, reports, and current statistics",
        "Work on legibility and maintain clear, neat handwriting throughout",
        "Structure answer with clear introduction, body, and conclusion format",
        "Underline keywords and important concepts for better emphasis",
        "Use diagrams, flowcharts, and maps where appropriate for visual appeal",
        "Ensure conclusion is concise, effective, and provides proper closure",
        "Address all parts of the question demand systematically",
        "Substantiate points with relevant examples from current affairs",
        "Develop better analytical skills and critical thinking approach",
        "Practice time management to complete answers within given timeframe",
        "Read more current affairs and contemporary developments",
        "Work on connecting different concepts and establishing logical linkages",
        "Develop a more balanced approach by addressing multiple perspectives",
        "Focus on core demand of the question and avoid irrelevant content",
        "Practice writing skills to improve speed and legibility",
        "Develop subject knowledge through regular study and revision",
        "Learn to prioritize important points and present them effectively",
        "Work on presentation skills to make answers more visually appealing"
      ],
      feedback: [
        "Overall, the answer demonstrates a good understanding of the topic but could benefit from more detailed explanations and examples.",
        "The response shows potential but needs improvement in organization and depth of analysis.",
        "While the answer addresses the question, it would be strengthened with better structure and supporting evidence.",
        "The content is relevant but the presentation could be enhanced for better clarity and impact.",
        "This is a solid attempt that would benefit from more comprehensive coverage of key aspects.",
        "The answer shows understanding but needs refinement in connecting ideas and providing deeper analysis.",
        "Good effort demonstrated, though the response would be stronger with more specific examples and clearer organization.",
        "The foundation is good but the answer requires more development and substantiation of points.",
        "The response covers the basics but would benefit from more sophisticated analysis and clearer structure.",
        "While the main points are addressed, the answer could be more compelling with better examples and flow."
      ]
    },
    remark: {
      excellent: [
        "Excellent comprehensive answer with outstanding presentation and depth",
        "Exceptional understanding demonstrated with excellent analytical approach",
        "Outstanding answer with perfect structure and comprehensive coverage",
        "Excellent work with innovative approach and creative solutions",
        "Exemplary answer demonstrating mastery of the subject"
      ],
      good: [
        "Good understanding demonstrated with relevant examples and proper structure",
        "Good analytical approach with comprehensive coverage of key aspects",
        "Good answer with effective presentation and logical flow",
        "Good attempt with valid points and proper substantiation",
        "Good knowledge base with effective use of examples and case studies"
      ],
      satisfactory: [
        "Satisfactory attempt with valid points covered adequately",
        "Satisfactory understanding with room for improvement in presentation",
        "Satisfactory answer demonstrating basic grasp of the topic",
        "Satisfactory coverage with some gaps in comprehensive analysis",
        "Satisfactory effort with potential for enhanced depth and clarity"
      ],
      average: [
        "Average answer showing basic understanding but lacks depth",
        "Average attempt with some relevant points but needs improvement",
        "Average understanding with scope for better presentation",
        "Average coverage missing key aspects of the question",
        "Average effort requiring more comprehensive approach"
      ],
      below_average: [
        "Below average answer lacking comprehensive understanding and depth",
        "Below average presentation with significant gaps in content coverage",
        "Below average attempt missing key components of the answer",
        "Below average understanding with insufficient substantiation of points",
        "Below average effort requiring substantial improvement in all aspects"
      ],
      poor: [
        "Poor answer with minimal understanding and significant deficiencies",
        "Poor presentation affecting overall quality and readability",
        "Poor attempt with inadequate coverage of question requirements",
        "Poor understanding evident from lack of relevant content",
        "Poor effort requiring complete revision of approach and content"
      ]
    }
  };
};

const EVAL_SECTION_HEADERS = [
  'Introduction',
  'Body',
  'Conclusion',
  'Strengths',
  'Weaknesses',
  'Suggestions',
  'Feedback',
  'Comments',
  'Remark'
];

const EVAL_HEADER_REGEX = {
  introduction: /^(introduction|intro)[:\-\s]*/i,
  body: /^(body|body section|main body)[:\-\s]*/i,
  conclusion: /^(conclusion|conclusion section)[:\-\s]*/i,
  strengths: /^(strengths?)[:\-\s]*/i,
  weaknesses: /^(weaknesses?|areas for improvement)[:\-\s]*/i,
  suggestions: /^(suggestions?|recommendations?)[:\-\s]*/i,
  feedback: /^(feedback)[:\-\s]*/i,
  comments: /^(comments?)[:\-\s]*/i,
  remark: /^(remark|overall remark|summary)[:\-\s]*/i
};

function getEvaluationFrameworkText() {
  return `Introduction
Relevant introduction, as defined, about 
Relevant Introduction Supported by Data like
Your introduction is well presented with factual information 
Your introduction is valid but concise it and mention some keywords like
Your introduction is general, you may start introduction like
Your introduction can be enriched by adding keywords like
Your introduction is relevant but too long — it needs to be concise, within 20–30 words.

Body:
Frame the heading to reflect the core demand of the question, such as:
Well-Formatted Main Heading in a Box
Write Main Heading in a Box
You missed a part of demand of question ---

Rough-Paragraph-Not effective
Your presentation is rough; avoid paragraph format. However, some of your content lines are relevant.
Your points are not very effective; please present them in a more structured and impactful manner.
Relevant-Valid
Your points are relevant, but they need to be substantiated with examples to strengthen your argument.
Valid point with substantiation
Your points are valid as per the implicit demand of the question but add some points like
Your points are valid as per the explicit demand of the question but add some points like
Your points are valid and substantiated with evidence.
Your points are valid and supported by relevant examples.

Heading-Core Demand
Try to use heading and subheadings for better presentation
Try to understand core demand of question
Points are valid but use sub-headings for better presentation
Try to use sub-headings for better presentation 

Your points can be enriched by elaborate properly like 
Underline specific keywords for better presentation like
You should work on presentation
Your points can be enriched by adding examples or substantiate them like 
Enrich your points by adding examples or substantiate
Your points are less effective and can be enriched in effective manner like 

Good use of diagram and relevant content
Good use of map but the map can be drawn better.
Lack of legibility-Please work on it.
Your points are valid but need supporting data, facts, and reports.

Conclusion
Your conclusion is based on balanced answer
Relevant conclusion, as it reflects a futuristic vision
Your conclusion is relevant as it outlines in suggestive manner

Less effective conclusion- you may conclude in effective manner like
Relevant conclusion but you may add—
Relevant conclusion but you may conclude in effective manner like 
Your conclusion is relevant as it outlines steps---but it may be concluded as—
Your conclusion is relevant but too long — it needs to be concise, within 20–30 words.`;
}

const generateEvaluationPrompt = (question, extractedTexts ) => {
  const combinedText = extractedTexts.join("\n\n--- Next Image ---\n\n");
  
  // Use the stored evaluation guideline (will always have a value - either custom or default)
  const evaluationFramework = question.evaluationGuideline || getEvaluationFrameworkText();

  let prompt = `Please evaluate this student's answer to the given question using the following evaluation framework.\n\n${evaluationFramework}\n\nQUESTION:\n${question.question}\n\nMAXIMUM MARKS: ${question.metadata?.maximumMarks || 10}\n\nSTUDENT'S ANSWER (extracted from images):\n${combinedText}\n\nPlease use the exact section headers as shown below, and do not change their names or order.\n\nRELEVANCY: [Score out of 100 - How relevant is the answer to the question]\nSCORE: [Score out of ${question.metadata?.maximumMarks || 10}]\n\nIntroduction:\n[Your analysis of the introduction]\n\nBody:\n[Your analysis of the body]\n\nConclusion:\n[Your analysis of the conclusion]\n\nStrengths:\n[List 2-3 strengths]\n\nWeaknesses:\n[List 2-3 weaknesses]\n\nSuggestions:\n[List 2-3 suggestions]\n\nFeedback:\n[Overall feedback]\n\nComments:\n[5-8 detailed comments providing specific feedback on the student's work]\n`;
 

  prompt += `\nRemark:\n[1-2 line summary of the overall answer quality]\n`;
  return prompt;
};


const generateCustomEvaluationPrompt = (question, extractedTexts, userPrompt, options = {}) => {
  const { includeExtractedText = true, includeQuestionDetails = true, maxMarks } = options;
  
  // Use the stored evaluation guideline (will always have a value - either custom or default)
  const evaluationFramework = question.evaluationGuideline || getEvaluationFrameworkText();
  
  let prompt = `You are an expert evaluator. Please evaluate this student's answer based on the following custom evaluation criteria.\n\nEVALUATION CRITERIA:\n${userPrompt}\n\n${evaluationFramework}\n`;
  if (includeQuestionDetails && question) {
    prompt += `QUESTION DETAILS:\n`;
    prompt += `Question: ${question.question}\n`;
    if (question.metadata?.difficultyLevel) {
      prompt += `Difficulty Level: ${question.metadata.difficultyLevel}\n`;
    }
    if (maxMarks || question.metadata?.maximumMarks) {
      prompt += `Maximum Marks: ${maxMarks || question.metadata.maximumMarks}\n`;
    }
    if (question.metadata?.keywords && question.metadata.keywords.length > 0) {
      prompt += `Keywords: ${question.metadata.keywords.join(", ")}\n`;
    }
    prompt += "\n";
  }
  if (includeExtractedText && extractedTexts && extractedTexts.length > 0) {
    const combinedText = extractedTexts.join("\n\n--- Next Image ---\n\n");
    prompt += `STUDENT'S ANSWER (extracted from images):\n${combinedText}\n\n`;
  }
  prompt += `Please use the exact section headers as shown below, and do not change their names or order.\n\nRELEVANCY: [Score out of 100 - How relevant is the answer to the question]\nSCORE: [Score out of ${maxMarks || question?.metadata?.maximumMarks || 10}]\n\nIntroduction:\n[Your analysis of the introduction]\n\nBody:\n[Your analysis of the body]\n\nConclusion:\n[Your analysis of the conclusion]\n\nStrengths:\n[List 2-3 strengths]\n\nWeaknesses:\n[List 2-3 weaknesses]\n\nSuggestions:\n[List 2-3 suggestions]\n\nFeedback:\n[Overall feedback]\n\nComments:\n[3-4 detailed comments (5-12 words each)]\n\nRemark:\n[1-2 line summary of the overall answer quality]\n`;
  return prompt;
};

const parseEvaluationResponse = (evaluationText, question) => {
  try {
    const lines = evaluationText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const evaluation = {
      relevancy: 75,
      score: Math.floor((question.metadata?.maximumMarks || 10) * 0.75),
      remark: "",
      comments: [],
      analysis: {
        introduction: [],
        body: [],
        conclusion: [],
        strengths: [],
        weaknesses: [],
        suggestions: [],
        feedback: []
      }
    };
    let currentSection = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/relevancy[:\-\s]/i.test(line)) {
        const match = line.match(/(\d+)/);
        if (match) evaluation.relevancy = Math.min(100, Math.max(0, Number.parseInt(match[1])));
        currentSection = "";
      } else if (/score[:\-\s]/i.test(line)) {
        const match = line.match(/(\d+)/);
        if (match) evaluation.score = Math.min(question.metadata?.maximumMarks || 10, Math.max(0, Number.parseInt(match[1])));
        currentSection = "";
      } else {
        // Section header detection (robust)
        for (const [section, regex] of Object.entries(EVAL_HEADER_REGEX)) {
          if (regex.test(line)) {
            currentSection = section;
            // If the header line has content after the colon, treat as first item
            const afterColon = line.replace(regex, '').trim();
            if (afterColon) {
              if (section === 'remark') {
                evaluation.remark = afterColon;
              } else if (section === 'comments') {
                evaluation.comments.push(afterColon);
              } else if (section === 'feedback') {
                evaluation.analysis.feedback.push(afterColon);
              } else {
                evaluation.analysis[section].push(afterColon);
              }
            }
            break;
          }
        }
        // If inside a section, add lines
        if (currentSection) {
          if (currentSection === 'remark') {
            if (line && !EVAL_HEADER_REGEX.remark.test(line)) evaluation.remark += (evaluation.remark ? ' ' : '') + line;
          } else if (currentSection === 'comments') {
            if (line && !EVAL_HEADER_REGEX.comments.test(line)) evaluation.comments.push(line);
          } else if (currentSection === 'feedback') {
            if (line && !EVAL_HEADER_REGEX.feedback.test(line)) evaluation.analysis.feedback.push(line);
          } else if (evaluation.analysis[currentSection] && !EVAL_HEADER_REGEX[currentSection].test(line)) {
            evaluation.analysis[currentSection].push(line);
          }
        }
      }
    }
    // Clean up: remove header lines, deduplicate, and set defaults if empty
    Object.keys(evaluation.analysis).forEach(section => {
      evaluation.analysis[section] = evaluation.analysis[section]
        .filter(item => item && !EVAL_HEADER_REGEX[section].test(item))
        .map(item => item.trim())
        .filter((item, idx, arr) => item && arr.indexOf(item) === idx);
      if (evaluation.analysis[section].length === 0) {
        evaluation.analysis[section] = ['No content provided by AI.'];
      }
    });
    if (evaluation.comments.length === 0) {
      evaluation.comments = ['No comments provided by AI.'];
    }
    if (!evaluation.remark || evaluation.remark.length === 0) {
      evaluation.remark = 'No remark provided by AI.';
    }
    return evaluation;
  } catch (error) {
    console.error("Error parsing evaluation:", error);
    return generateMockEvaluation(question);
  }
};

// Optional parser for the optional "Image Annotations" section
function parseImageAnnotations(evaluationText, totalImages) {
  try {
    if (!evaluationText || typeof evaluationText !== 'string' || !Number.isFinite(totalImages)) {
      return Array.from({ length: Math.max(0, totalImages || 0) }, () => []);
    }
    const result = Array.from({ length: totalImages }, () => []);
    const startIdx = evaluationText.indexOf('Image Annotations:');
    if (startIdx === -1) return result;

    const lines = evaluationText.slice(startIdx).split('\n');
    const stopHeader = /^(Remark:|Strengths:|Weaknesses:|Suggestions:|Feedback:|Comments:|Introduction:|Body:|Conclusion:|RELEVANCY:|SCORE:)\s*/i;
    const imageLine = /^\s*-\s*Image\s+(\d+)\s*:\s*(.+)$/i;
    for (const line of lines) {
      if (stopHeader.test(line)) break;
      const m = line.match(imageLine);
      if (!m) continue;
      const idx = Math.max(1, Math.min(totalImages, parseInt(m[1], 10))) - 1;
      const payload = (m[2] || '').trim();
      if (!payload || /^none$/i.test(payload)) continue;
      const comments = payload
        .split(/;|\|/)
        .map(s => s.trim())
        .filter(Boolean)
        .slice(0, 5)
        .map(c => (c.length > 200 ? c.slice(0, 197) + '...' : c));
      if (comments.length > 0) result[idx] = comments;
    }
    return result;
  } catch (e) {
    console.warn('parseImageAnnotations failed:', e.message);
    return Array.from({ length: Math.max(0, totalImages || 0) }, () => []);
  }
}

// Simple fallback mapper using token overlap
function mapCommentsToImages(comments, extractedTexts, maxPerImage = 2) {
  const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokenize = s => new Set(normalize(s).split(' ').filter(w => w.length > 2));
  const textTokens = Array.isArray(extractedTexts) ? extractedTexts.map(tokenize) : [];
  const perImage = Array.from({ length: textTokens.length }, () => []);

  for (const c of Array.isArray(comments) ? comments : []) {
    const cTokens = tokenize(c);
    let bestIdx = -1; let bestScore = 0;
    for (let i = 0; i < textTokens.length; i++) {
      const overlap = [...cTokens].filter(t => textTokens[i].has(t)).length;
      if (overlap > bestScore) { bestScore = overlap; bestIdx = i; }
    }
    if (bestIdx >= 0 && bestScore > 0 && perImage[bestIdx].length < maxPerImage) {
      perImage[bestIdx].push(c.length > 200 ? c.slice(0, 197) + '...' : c);
    }
  }
  return perImage;
}

const generateEvaluationComments = (analysis, relevancyScore, score, maxMarks) => {
  const comments = [];
  const percentage = (score / maxMarks) * 100;
  
  if (percentage >= 80) {
    comments.push("The answer demonstrates a strong understanding of the topic with clear organization and relevant content. The student has effectively addressed the question requirements and provided well-structured arguments.");
  } else if (percentage >= 60) {
    comments.push("The answer shows a good grasp of the subject matter but could benefit from more detailed explanations and better organization. Some key points are addressed but not fully developed.");
  } else if (percentage >= 40) {
    comments.push("The answer attempts to address the question but lacks depth and clarity in several areas. More focus on the core requirements and better structuring would significantly improve the response.");
  } else {
    comments.push("The answer falls short of expectations, with minimal understanding demonstrated. Significant improvements are needed in content relevance, structure, and depth of analysis.");
  }

  if (analysis.strengths.length > 0) {
    const strengthComment = `Notable strengths include: ${analysis.strengths.slice(0, 3).join(', ')}. These aspects demonstrate good understanding and application of concepts.`;
    comments.push(strengthComment);
  }

  if (analysis.weaknesses.length > 0) {
    const improvementComment = `Areas needing improvement: ${analysis.weaknesses.slice(0, 3).join(', ')}. Focusing on these aspects would enhance the overall quality of the answer.`;
    comments.push(improvementComment);
  }

  if (analysis.suggestions.length > 0) {
    const suggestionComment = `Recommendations for improvement: ${analysis.suggestions.slice(0, 3).join(', ')}. Implementing these suggestions would help address the identified weaknesses.`;
    comments.push(suggestionComment);
  }

  return comments;
};

const generateMockEvaluation = (question) => {
  const baseRelevancy = Math.floor(Math.random() * 30) + 60;
  const maxMarks = question.metadata?.maximumMarks || 10;
  const score = Math.floor((baseRelevancy / 100) * maxMarks);
  const evaluationParams = getEvaluationParameters();
  
  const mockEvaluation = {
    relevancy: baseRelevancy,
    score: score,
    remark: generateDefaultRemark(baseRelevancy, score, maxMarks),
    comments: [
      "The answer demonstrates a reasonable understanding of the topic but could benefit from more detailed explanations and examples.",
      "Good structure overall, but some sections could be better organized with clearer transitions between ideas.",
      "The conclusion effectively summarizes the main points but could be strengthened with more specific recommendations.",
      "Consider adding more current examples and data to support your arguments for a more comprehensive response."
    ],
    analysis: {
      introduction: [
        evaluationParams.analysis.introduction[2],
        evaluationParams.analysis.introduction[3]
      ],
      body: [
        evaluationParams.analysis.body[6],
        evaluationParams.analysis.body[10]
      ],
      conclusion: [
        evaluationParams.analysis.conclusion[0],
        evaluationParams.analysis.conclusion[1]
      ],
      strengths: [
        evaluationParams.analysis.strengths[0],
        evaluationParams.analysis.strengths[1]
      ],
      weaknesses: [
        evaluationParams.analysis.weaknesses[0],
        evaluationParams.analysis.weaknesses[1]
      ],
      suggestions: [
        evaluationParams.analysis.suggestions[0],
        evaluationParams.analysis.suggestions[1]
      ],
      feedback: [
        evaluationParams.analysis.feedback[0]
      ]
    }
  };

  return mockEvaluation;
};

const generateDefaultRemark = (relevancy, score, maxMarks) => {
  const percentage = (score / maxMarks) * 100;
  const evaluationParams = getEvaluationParameters();
  
  if (percentage >= 90) {
    return evaluationParams.remark.excellent[0] || "Excellent answer with comprehensive understanding and clear presentation.";
  } else if (percentage >= 80) {
    return evaluationParams.remark.good[0] || "Good answer demonstrating solid understanding with minor areas for improvement.";
  } else if (percentage >= 70) {
    return evaluationParams.remark.satisfactory[0] || "Satisfactory answer showing basic understanding but needs more detailed explanations.";
  } else if (percentage >= 60) {
    return evaluationParams.remark.average[0] || "Average answer with some correct points but lacking depth and clarity.";
  } else if (percentage >= 50) {
    return evaluationParams.remark.below_average[0] || "Below average answer with limited understanding and significant gaps.";
  } else {
    return evaluationParams.remark.poor[0] || "Poor answer with minimal understanding and requires substantial improvement.";
  }
};

// Utility to clean extracted texts from OCR/Agentic
function cleanExtractedTexts(extractedTexts) {
  if (!Array.isArray(extractedTexts)) return [];
  return extractedTexts.map(text => {
    if (!text || typeof text !== 'string') return '';
    // Remove lines that are only symbols, numbers, or repeated characters
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        if (!line) return false;
        if (line.length < 3) return false;
        if (/^(No readable text found|Failed to extract text|Text extraction failed)/i.test(line)) return false;
        if (/^[\d\s\-+*/=().,:;]+$/.test(line)) return false;
        if (/^(.)\1{5,}$/.test(line)) return false;
        if (/^[^a-zA-Z0-9]+$/.test(line)) return false;
        if (line.length > 0 && line.replace(/[^a-zA-Z0-9]/g, '').length < 2) return false;
        return true;
      })
      .join('\n');
  }).filter(Boolean);
}

module.exports = {
  validateTextRelevanceToQuestion,
  extractTextFromImages,
  extractTextFromImagesWithFallback,
  generateEvaluationPrompt,
  parseEvaluationResponse,
  generateMockEvaluation,
  generateCustomEvaluationPrompt,
  getServiceForTask,
  getEvaluationParameters,
  getEvaluationFrameworkText,
  cleanExtractedTexts,
  // new helpers (safe to import optionally)
  parseImageAnnotations,
  mapCommentsToImages,
};
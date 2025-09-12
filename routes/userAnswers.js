const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("cloudinary").v2;
const UserAnswer = require("../models/UserAnswer");
const AiswbQuestion = require("../models/AiswbQuestion");
const AISWBSet = require("../models/AISWBSet");
const { validationResult, param, body, query } = require("express-validator");
const { authenticateMobileUser } = require("../middleware/mobileAuth");
const crud = require("./answerapis");
const { submitEvaluationFeedback } = require("../controllers/userAnswers");
const {
  refreshAnnotatedImageUrls,
  generateAnnotatedImageUrl,
  uploadFileToS3,
} = require("../utils/s3");
const { overlayTextOnImage } = require("../controllers/TextOverlayController");
const axios = require("axios");
const SubjectiveTest = require("../models/SubjectiveTest");
const SubjectiveTestQuestion = require("../models/SubjectiveTestQuestion");
const {
  validateTextRelevanceToQuestion,
  extractTextFromImagesWithFallback,
  generateEvaluationPrompt,
  parseEvaluationResponse,
  generateMockEvaluation,
  generateCustomEvaluationPrompt,
  getServiceForTask,
  cleanExtractedTexts,
  // new helpers for auto annotations (safe to import)
  parseImageAnnotations,
  mapCommentsToImages,
  detectLanguage,
  generateCustomHindiEvaluationPrompt,
  parseHindiEvaluationResponse,
  translateEvaluationToHindi,
  enforceEvaluationLimits,
  translateTextToHindi,
  enrichHindiEvaluationFromEnglish,
  directTranslateEvaluationToHindi,
} = require("../services/aiServices");

router.use("/crud", crud);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "user-answers",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "pdf"],
    transformation: [
      { width: 1200, height: 1600, crop: "limit", quality: "auto" },
      { flags: "progressive" },
    ],
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype === "application/pdf"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image files and PDFs are allowed"), false);
    }
  },
});

const validateQuestionId = [
  param("questionId")
    .isMongoId()
    .withMessage("Question ID must be a valid MongoDB ObjectId"),
];

const validateAnswerSubmission = [
  body("textAnswer")
    .optional()
    .isString()
    .trim()
    .isLength({ max: 5000 })
    .withMessage("Text answer must be less than 5000 characters"),
  body("timeSpent")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Time spent must be a positive integer"),
  body("sourceType")
    .optional()
    .isIn(["qr_scan", "direct_access", "set_practice"])
    .withMessage("Invalid source type"),
  body("setId")
    .optional()
    .isMongoId()
    .withMessage("Set ID must be a valid MongoDB ObjectId"),
];

const validateManualEvaluation = [
  body("evaluationPrompt")
    .isString()
    .trim()
    .isLength({ min: 10, max: 20000 })
    .withMessage("Evaluation prompt must be between 10 and 2000 characters"),
  body("includeExtractedText")
    .optional()
    .isBoolean()
    .withMessage("includeExtractedText must be a boolean"),
  body("includeQuestionDetails")
    .optional()
    .isBoolean()
    .withMessage("includeQuestionDetails must be a boolean"),
  body("maxMarks")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("Max marks must be between 1 and 100"),
];

router.post(
  "/answers/:answerId/evaluate-manual",
  [
    param("answerId")
      .isMongoId()
      .withMessage("Answer ID must be a valid MongoDB ObjectId"),
  ],
  validateManualEvaluation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid input data",
          responseCode: 1566,
          error: {
            code: "INVALID_INPUT",
            details: errors.array(),
          },
        });
      }

      const { answerId } = req.params;
      const {
        evaluationPrompt,
        includeExtractedText = true,
        includeQuestionDetails = true,
        maxMarks,
      } = req.body;

      const userAnswer = await UserAnswer.findById(answerId)
        .populate("questionId")
        .populate("userId", "name email");

      if (!userAnswer) {
        return res.status(404).json({
          success: false,
          message: "Answer not found",
          responseCode: 1567,
          error: {
            code: "ANSWER_NOT_FOUND",
            details: "The specified answer does not exist",
          },
        });
      }

      const question = userAnswer.questionId;
      let extractedTexts = userAnswer.extractedTexts || [];

      if (
        extractedTexts.length === 0 &&
        userAnswer.answerImages.length > 0 &&
        includeExtractedText
      ) {
        try {
          const imageUrls = userAnswer.answerImages.map((img) => img.imageUrl);
          extractedTexts = await extractTextFromImagesWithFallback(imageUrls);
          extractedTexts = cleanExtractedTexts(extractedTexts);
          userAnswer.extractedTexts = extractedTexts;
          await userAnswer.save();
        } catch (extractionError) {
          console.error("Text extraction failed:", extractionError);
          extractedTexts = [
            `Text extraction failed: ${extractionError.message}`,
          ];
        }
      }
      // Clean extractedTexts before evaluation
      extractedTexts = cleanExtractedTexts(extractedTexts);

      let evaluation = null;

      try {
        const customPrompt = generateCustomEvaluationPrompt(
          question,
          includeExtractedText ? extractedTexts : [],
          evaluationPrompt,
          { includeExtractedText, includeQuestionDetails, maxMarks }
        );

        const evaluationService = await getServiceForTask("evaluation");

        if (evaluationService.serviceName === "gemini") {
          try {
            const response = await axios.post(
              `${evaluationService.apiUrl}?key=${evaluationService.apiKey}`,
              {
                contents: [
                  {
                    parts: [
                      {
                        text: customPrompt,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0.7,
                  topK: 40,
                  topP: 0.95,
                  maxOutputTokens: 2048,
                },
              },
              {
                headers: { "Content-Type": "application/json" },
                timeout: 30000,
              }
            );

            if (
              response.status === 200 &&
              response.data?.candidates?.[0]?.content
            ) {
              const evaluationText =
                response.data.candidates[0].content.parts[0].text;
              evaluation = parseEvaluationResponse(evaluationText, question);
              evaluation.evaluationMethod = "gemini";
            } else {
              throw new Error("Invalid response from Gemini API");
            }
          } catch (geminiError) {
            console.error("Gemini evaluation failed:", geminiError.message);
            throw geminiError;
          }
        } else if (evaluationService.serviceName === "openai") {
          try {
            const response = await axios.post(
              evaluationService.apiUrl,
              {
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "user",
                    content: customPrompt,
                  },
                ],
                max_tokens: 1500,
                temperature: 0.7,
              },
              {
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${evaluationService.apiKey}`,
                },
                timeout: 30000,
              }
            );

            if (response.data?.choices?.[0]?.message?.content) {
              const evaluationText = response.data.choices[0].message.content;
              evaluation = parseEvaluationResponse(evaluationText, question);
              evaluation.evaluationMethod = "openai";
            } else {
              throw new Error("Invalid response from OpenAI API");
            }
          } catch (openaiError) {
            console.error("OpenAI evaluation failed:", openaiError.message);
            throw openaiError;
          }
        } else if (evaluationService.serviceName === "agentic") {
          evaluation = generateMockEvaluation(question);
          evaluation.evaluationMethod = "agentic_mock";
        }

        if (!evaluation) {
          throw new Error("No evaluation service available or configured");
        }

        // If the original answer content is Hindi, translate the English evaluation to Hindi as well
        try {
          const combinedText = (userAnswer.extractedTexts || []).join(" ");
          const lang = detectLanguage(combinedText);
          if (lang === "hindi" && evaluation && !evaluation.hindiEvaluation) {
            const hindiEval = await translateEvaluationToHindi(
              evaluation,
              question
            );
            if (hindiEval) {
              // Enrich the Hindi evaluation with missing comments from English
              evaluation.hindiEvaluation =
                await enrichHindiEvaluationFromEnglish(evaluation, hindiEval);
            }
          }
        } catch (e) {
          console.warn("[manual] Hindi translation attempt failed:", e.message);
        }

        // Enforce storage limits
        evaluation = enforceEvaluationLimits(evaluation, { maxRemark: 250 });

        userAnswer.evaluation = {
          ...evaluation,
          evaluatedAt: new Date(),
          evaluationType: "manual_custom",
          customPrompt: evaluationPrompt,
        };

        userAnswer.submissionStatus = "evaluated";
        userAnswer.reviewedAt = new Date();
        userAnswer.evaluatedAt = new Date();

        await userAnswer.save();

        const responseData = {
          answerId: userAnswer._id,
          questionId: question._id,
          userId: userAnswer.userId._id,
          evaluation: evaluation,
          evaluatedAt: userAnswer.evaluatedAt,
          evaluationType: "manual_custom",
          customPrompt: evaluationPrompt,
          submissionStatus: userAnswer.submissionStatus,
          reviewStatus: userAnswer.reviewStatus,
          question: {
            id: question._id,
            question: question.question,
            difficultyLevel: question.metadata?.difficultyLevel,
            maximumMarks: maxMarks || question.metadata?.maximumMarks,
          },
        };

        if (includeExtractedText && extractedTexts.length > 0) {
          responseData.extractedTexts = extractedTexts;
        }

        res.status(200).json({
          success: true,
          message:
            "Answer evaluated successfully with custom criteria and status updated to 'evaluated'",
          responseCode: 1568,
          data: responseData,
        });
      } catch (evaluationError) {
        console.error("Custom evaluation failed:", evaluationError);
        res.status(500).json({
          success: false,
          message: "Evaluation failed",
          responseCode: 1569,
          error: {
            code: "EVALUATION_ERROR",
            details: evaluationError.message,
          },
        });
      }
    } catch (error) {
      console.error("Manual evaluation error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        responseCode: 1570,
        error: {
          code: "SERVER_ERROR",
          details: error.message,
        },
      });
    }
  }
);

router.post(
  "/questions/:questionId/answers",
  authenticateMobileUser,
  validateQuestionId,
  upload.array("images", 10),
  validateAnswerSubmission,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            try {
              await cloudinary.uploader.destroy(file.filename);
            } catch (cleanupError) {
              console.error("Error cleaning up file:", cleanupError);
            }
          }
        }
        return res.status(400).json({
          success: false,
          message: "Invalid input data",
          responseCode: 1571,
          error: {
            code: "INVALID_INPUT",
            details: errors.array(),
          },
        });
      }

      const { questionId } = req.params;
      const userId = req.user.id;
      const {
        textAnswer,
        timeSpent,
        sourceType,
        setId,
        deviceInfo,
        appVersion,
      } = req.body;

      if (
        (!req.files || req.files.length === 0) &&
        (!textAnswer || textAnswer.trim() === "")
      ) {
        return res.status(400).json({
          success: false,
          message: "Either images or text answer must be provided",
          responseCode: 1572,
          error: {
            code: "NO_ANSWER_PROVIDED",
            details: "At least one form of answer (image or text) is required",
          },
        });
      }

      const submissionStatus = await UserAnswer.canUserSubmit(
        userId,
        questionId
      );
      if (!submissionStatus.canSubmit) {
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            try {
              await cloudinary.uploader.destroy(file.filename);
            } catch (cleanupError) {
              console.error("Error cleaning up file:", cleanupError);
            }
          }
        }
        return res.status(555).json({
          success: false,
          message: "Maximum submission limit reached",
          responseCode: 1573,
          error: {
            code: "SUBMISSION_LIMIT_EXCEEDED",
            details: "Maximum 15 attempts allowed per question",
          },
        });
      }

      const question = await AiswbQuestion.findById(questionId);
      if (!question) {
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            try {
              await cloudinary.uploader.destroy(file.filename);
            } catch (cleanupError) {
              console.error("Error cleaning up file:", cleanupError);
            }
          }
        }
        return res.status(404).json({
          success: false,
          message: "Question not found",
          responseCode: 1574,
          error: {
            code: "QUESTION_NOT_FOUND",
            details: "The specified question does not exist",
          },
        });
      }

      let setInfo = null;
      if (setId) {
        setInfo = await AISWBSet.findById(setId);
        if (!setInfo) {
          return res.status(404).json({
            success: false,
            message: "Set not found",
            responseCode: 1575,
            error: {
              code: "SET_NOT_FOUND",
              details: "The specified set does not exist",
            },
          });
        }
      }

      const answerImages = [];
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          answerImages.push({
            imageUrl: file.path,
            cloudinaryPublicId: file.filename,
            originalName: file.originalname,
            uploadedAt: new Date(),
          });
        }
      }

      const isManualEvaluation = question.evaluationMode === "manual";

      let evaluation = null;
      let extractedTexts = [];

      if (answerImages.length > 0) {
        try {
          const imageUrls = answerImages.map((img) => img.imageUrl);
          extractedTexts = await extractTextFromImagesWithFallback(imageUrls);
          extractedTexts = cleanExtractedTexts(extractedTexts);

          const relevanceValidation = await validateTextRelevanceToQuestion(
            question,
            extractedTexts
          );

          if (!relevanceValidation.isValid) {
            if (req.files && req.files.length > 0) {
              for (const file of req.files) {
                try {
                  await cloudinary.uploader.destroy(file.filename);
                } catch (cleanupError) {
                  console.error(
                    "Error cleaning up invalid image:",
                    cleanupError
                  );
                }
              }
            }

            return res.status(400).json({
              success: false,
              message: "Invalid image content",
              responseCode: 1576,
              error: {
                code: "INVALID_IMAGE_CONTENT",
                details: relevanceValidation.reason,
                aiResponse: relevanceValidation.aiResponse || null,
              },
            });
          }

          const hasValidText = extractedTexts.some(
            (text) =>
              text &&
              text.trim().length > 0 &&
              !text.startsWith("Failed to extract text") &&
              !text.startsWith("No readable text found") &&
              !text.includes("Text extraction failed")
          );

          // Detect language early so it's available for all evaluation scenarios
          const combinedText = extractedTexts.join(" ");
          const detectedLanguage = detectLanguage(combinedText);
          console.log(
            "[v0] Detected language:",
            detectedLanguage,
            "for text:",
            combinedText.substring(0, 100)
          );

          // Get evaluation service early so it's available for all evaluation scenarios
          const evaluationService = await getServiceForTask("evaluation");

          if (hasValidText) {
            try {
              // Only include per-image annotation instructions in auto mode
              const includeImageAnnotations =
                question.evaluationMode !== "manual";

              const prompt = generateEvaluationPrompt(question, extractedTexts);

              if (evaluationService.serviceName === "gemini") {
                const response = await axios.post(
                  `${evaluationService.apiUrl}?key=${evaluationService.apiKey}`,
                  {
                    contents: [
                      {
                        parts: [
                          {
                            text: prompt,
                          },
                        ],
                      },
                    ],
                    generationConfig: {
                      temperature: 0.7,
                      topK: 40,
                      topP: 0.95,
                      maxOutputTokens: 2048,
                    },
                  },
                  {
                    headers: { "Content-Type": "application/json" },
                    timeout: 30000,
                  }
                );

                if (
                  response.status === 200 &&
                  response.data?.candidates?.[0]?.content
                ) {
                  const evaluationText =
                    response.data.candidates[0].content.parts[0].text;
                  evaluation = parseEvaluationResponse(
                    evaluationText,
                    question
                  );

                  if (detectedLanguage === "hindi") {
                    console.log(
                      "[v0] Generating Hindi evaluation for detected Hindi text"
                    );
                    try {
                      // Prefer direct translation of the English evaluation to ensure fidelity
                      const hindiEvaluation = await translateEvaluationToHindi(
                        evaluation,
                        question
                      );
                      if (hindiEvaluation) {
                        evaluation.hindiEvaluation = hindiEvaluation;
                      } else {
                        const hindiPrompt = generateCustomHindiEvaluationPrompt(
                          question,
                          extractedTexts,
                          { includeImageAnnotations }
                        );
                        const hindiResponse = await axios.post(
                          `${evaluationService.apiUrl}?key=${evaluationService.apiKey}`,
                          {
                            contents: [{ parts: [{ text: hindiPrompt }] }],
                            generationConfig: {
                              temperature: 0.7,
                              topK: 40,
                              topP: 0.95,
                              maxOutputTokens: 2048,
                            },
                          },
                          {
                            headers: { "Content-Type": "application/json" },
                            timeout: 30000,
                          }
                        );
                        if (
                          hindiResponse.status === 200 &&
                          hindiResponse.data?.candidates?.[0]?.content
                        ) {
                          const hindiEvaluationText =
                            hindiResponse.data.candidates[0].content.parts[0]
                              .text;
                          let parsed = parseHindiEvaluationResponse(
                            hindiEvaluationText,
                            question
                          );
                          // If feedback is empty, translate English feedback list as fallback
                          const engFeedback = (
                            evaluation.analysis?.feedback || []
                          ).join("\n");
                          if (
                            (parsed.analysis?.feedback || []).every((x) =>
                              /AI द्वारा कोई सामग्री प्रदान नहीं की गई।/.test(
                                String(x)
                              )
                            )
                          ) {
                            const translated = await translateTextToHindi(
                              engFeedback
                            );
                            if (translated)
                              parsed.analysis.feedback = translated
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean);
                          }
                          evaluation.hindiEvaluation = parsed;
                        }
                      }
                      evaluation = enforceEvaluationLimits(evaluation, {
                        maxRemark: 250,
                      });
                    } catch (hindiError) {
                      console.error(
                        "[v0] Hindi evaluation failed:",
                        hindiError.message
                      );
                    }
                  }

                  // Attach per-image comments for auto mode (flag-guarded)
                  if (includeImageAnnotations) {
                    try {
                      let perImage = parseImageAnnotations(
                        evaluationText,
                        answerImages.length
                      );
                      const needsFallback =
                        !perImage || perImage.every((arr) => arr.length === 0);
                      if (needsFallback) {
                        const candidates = (evaluation.comments || []).slice(
                          0,
                          4
                        );
                        perImage = mapCommentsToImages(
                          candidates,
                          extractedTexts,
                          2
                        );
                        console.log("[Annot] Fallback mapping used (gemini)");
                      }
                      evaluation.perImageComments = perImage;
                      console.log(
                        "[Annot] perImageComments (gemini):",
                        perImage.map((x) => x.length)
                      );
                    } catch (mapErr) {
                      console.warn(
                        "[Annot] Per-image annotation mapping failed (gemini):",
                        mapErr.message
                      );
                    }
                  }
                  evaluation.evaluationMethod = "gemini";
                } else {
                  throw new Error("Invalid response from Gemini API");
                }
              } else if (evaluationService.serviceName === "openai") {
                const response = await axios.post(
                  evaluationService.apiUrl,
                  {
                    model: "gpt-4o-mini",
                    messages: [
                      {
                        role: "user",
                        content: prompt,
                      },
                    ],
                    max_tokens: 1500,
                    temperature: 0.7,
                  },
                  {
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${evaluationService.apiKey}`,
                    },
                    timeout: 30000,
                  }
                );

                if (response.data?.choices?.[0]?.message?.content) {
                  const evaluationText =
                    response.data.choices[0].message.content;
                  evaluation = parseEvaluationResponse(
                    evaluationText,
                    question
                  );

                  if (detectedLanguage === "hindi") {
                    console.log(
                      "[v0] Generating Hindi evaluation for detected Hindi text"
                    );
                    try {
                      const hindiEvaluation = await translateEvaluationToHindi(
                        evaluation,
                        question
                      );
                      if (hindiEvaluation) {
                        // Enrich the Hindi evaluation with missing comments from English
                        evaluation.hindiEvaluation =
                          await enrichHindiEvaluationFromEnglish(
                            evaluation,
                            hindiEvaluation
                          );
                      } else {
                        const hindiPrompt = generateCustomHindiEvaluationPrompt(
                          question,
                          extractedTexts,
                          { includeImageAnnotations }
                        );
                        const hindiResponse = await axios.post(
                          evaluationService.apiUrl,
                          {
                            model: "gpt-4o-mini",
                            messages: [{ role: "user", content: hindiPrompt }],
                            max_tokens: 1500,
                            temperature: 0.7,
                          },
                          {
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${evaluationService.apiKey}`,
                            },
                            timeout: 30000,
                          }
                        );
                        if (
                          hindiResponse.data?.choices?.[0]?.message?.content
                        ) {
                          const hindiEvaluationText =
                            hindiResponse.data.choices[0].message.content;
                          const parsedHindiEval = parseHindiEvaluationResponse(
                            hindiEvaluationText,
                            question
                          );
                          // Enrich the parsed Hindi evaluation with missing comments from English
                          evaluation.hindiEvaluation =
                            await enrichHindiEvaluationFromEnglish(
                              evaluation,
                              parsedHindiEval
                            );
                        }
                      }
                    } catch (hindiError) {
                      console.error(
                        "[v0] Hindi evaluation failed:",
                        hindiError.message
                      );
                    }
                  }

                  // Attach per-image comments for auto mode (flag-guarded)
                  if (includeImageAnnotations) {
                    try {
                      let perImage = parseImageAnnotations(
                        evaluationText,
                        answerImages.length
                      );
                      const needsFallback =
                        !perImage || perImage.every((arr) => arr.length === 0);
                      if (needsFallback) {
                        const candidates = (evaluation.comments || []).slice(
                          0,
                          4
                        );
                        perImage = mapCommentsToImages(
                          candidates,
                          extractedTexts,
                          2
                        );
                        console.log("[Annot] Fallback mapping used (openai)");
                      }
                      evaluation.perImageComments = perImage;
                      console.log(
                        "[Annot] perImageComments (openai):",
                        perImage.map((x) => x.length)
                      );
                    } catch (mapErr) {
                      console.warn(
                        "[Annot] Per-image annotation mapping failed (openai):",
                        mapErr.message
                      );
                    }
                  }
                  evaluation.evaluationMethod = "openai";
                } else {
                  throw new Error("Invalid response from OpenAI API");
                }
              } else if (evaluationService.serviceName === "agentic") {
                evaluation = generateMockEvaluation(question);
                evaluation.evaluationMethod = "agentic_mock";
              }

              if (!evaluation) {
                evaluation = generateMockEvaluation(question);
              }
              // Enforce storage limits (e.g., remark length)
              evaluation = enforceEvaluationLimits(evaluation, {
                maxRemark: 250,
              });

              // Generate Hindi evaluation for fallback evaluation if language is Hindi
              if (
                detectedLanguage === "hindi" &&
                evaluation &&
                !evaluation.hindiEvaluation
              ) {
                console.log(
                  "[v0] Generating Hindi evaluation for fallback evaluation"
                );
                try {
                  const hindiEvaluation = await translateEvaluationToHindi(
                    evaluation,
                    question
                  );
                  if (hindiEvaluation) {
                    evaluation.hindiEvaluation = hindiEvaluation;
                  } else {
                    const includeImageAnnotations =
                      question.evaluationMode !== "manual";
                    const hindiPrompt = generateCustomHindiEvaluationPrompt(
                      question,
                      extractedTexts,
                      { includeImageAnnotations }
                    );
                    const hindiResponse = await axios.post(
                      `${evaluationService.apiUrl}?key=${evaluationService.apiKey}`,
                      {
                        contents: [{ parts: [{ text: hindiPrompt }] }],
                        generationConfig: {
                          temperature: 0.7,
                          topK: 40,
                          topP: 0.95,
                          maxOutputTokens: 2048,
                        },
                      },
                      {
                        headers: { "Content-Type": "application/json" },
                        timeout: 30000,
                      }
                    );
                    if (
                      hindiResponse.status === 200 &&
                      hindiResponse.data?.candidates?.[0]?.content
                    ) {
                      const hindiEvaluationText =
                        hindiResponse.data.candidates[0].content.parts[0].text;
                      let parsed = parseHindiEvaluationResponse(
                        hindiEvaluationText,
                        question
                      );
                      const engFeedback = (
                        evaluation.analysis?.feedback || []
                      ).join("\n");
                      if (
                        (parsed.analysis?.feedback || []).every((x) =>
                          /AI द्वारा कोई सामग्री प्रदान नहीं की गई।/.test(
                            String(x)
                          )
                        )
                      ) {
                        const translated = await translateTextToHindi(
                          engFeedback
                        );
                        if (translated)
                          parsed.analysis.feedback = translated
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean);
                      }
                      evaluation.hindiEvaluation = parsed;
                    }
                  }
                  evaluation = enforceEvaluationLimits(evaluation, {
                    maxRemark: 250,
                  });
                } catch (hindiError) {
                  console.error(
                    "[v0] Hindi evaluation failed for fallback:",
                    hindiError.message
                  );
                  // Generate a mock Hindi evaluation as fallback
                  try {
                    const mockHindiEvaluation = {
                      relevancy: evaluation.relevancy || 75,
                      score: evaluation.score || 6,
                      remark:
                        "मूल्यांकन सफलतापूर्वक पूरा हुआ - AI सेवा अस्थायी रूप से अनुपलब्ध थी",
                      comments: [
                        "उत्तर में विषय की समझ दिखाई देती है लेकिन अधिक विस्तृत व्याख्या की आवश्यकता है",
                        "संरचना अच्छी है लेकिन कुछ भागों को बेहतर व्यवस्थित किया जा सकता है",
                        "निष्कर्ष प्रभावी है लेकिन अधिक विशिष्ट सुझावों से मजबूत हो सकता है",
                      ],
                      analysis: {
                        introduction: [
                          "परिचय अच्छी तरह से प्रस्तुत किया गया है",
                          "मुख्य शब्दों का उल्लेख प्रभावी है",
                        ],
                        body: [
                          "बिंदु प्रासंगिक हैं लेकिन उदाहरणों से पुष्टि की आवश्यकता है",
                          "तर्क मजबूत करने के लिए साक्ष्य की आवश्यकता है",
                        ],
                        conclusion: [
                          "निष्कर्ष संतुलित है और तार्किक समापन प्रदान करता है",
                          "भविष्योन्मुखी दृष्टिकोण दिखाता है",
                        ],
                        strengths: ["विषय की अच्छी समझ", "तार्किक प्रवाह"],
                        weaknesses: [
                          "कुछ पहलुओं में गहराई की कमी",
                          "प्रस्तुति में सुधार की आवश्यकता",
                        ],
                        suggestions: [
                          "अधिक विशिष्ट उदाहरण जोड़ें",
                          "शीर्षक और उप-शीर्षक का उपयोग करें",
                        ],
                        feedback: [
                          "समग्र रूप से अच्छा प्रयास है लेकिन अधिक विस्तार की आवश्यकता है",
                        ],
                      },
                    };
                    evaluation.hindiEvaluation = mockHindiEvaluation;
                    console.log(
                      "[v0] Mock Hindi evaluation generated for fallback"
                    );
                  } catch (mockError) {
                    console.error(
                      "[v0] Mock Hindi evaluation generation failed:",
                      mockError.message
                    );
                  }
                }
              }

              // Final safeguard: if auto mode and no per-image yet, map fallback
              if (
                includeImageAnnotations &&
                evaluation &&
                (!evaluation.perImageComments ||
                  evaluation.perImageComments.every(
                    (arr) => (arr || []).length === 0
                  ))
              ) {
                try {
                  const candidates = [
                    ...(evaluation.comments || []),
                    ...(evaluation.analysis?.strengths || []).map(
                      (s) => `✓ ${s}`
                    ),
                    ...(evaluation.analysis?.weaknesses || []).map(
                      (w) => `⚠ ${w}`
                    ),
                  ];
                  const perImage = mapCommentsToImages(
                    candidates,
                    extractedTexts,
                    2
                  );
                  evaluation.perImageComments = perImage;
                } catch (fallbackErr) {
                  console.warn(
                    "Per-image fallback mapping (final) failed:",
                    fallbackErr.message
                  );
                }
              }
            } catch (evaluationError) {
              console.error("AI evaluation failed:", evaluationError.message);
              evaluation = generateMockEvaluation(question);
              evaluation = enforceEvaluationLimits(evaluation, {
                maxRemark: 250,
              });

              // Generate Hindi evaluation for error fallback if language is Hindi
              if (
                detectedLanguage === "hindi" &&
                evaluation &&
                !evaluation.hindiEvaluation
              ) {
                console.log(
                  "[v0] Generating Hindi evaluation for error fallback"
                );
                try {
                  const hindiEvaluation = await translateEvaluationToHindi(
                    evaluation,
                    question
                  );
                  if (hindiEvaluation)
                    evaluation.hindiEvaluation = hindiEvaluation;
                  else {
                    const includeImageAnnotations =
                      question.evaluationMode !== "manual";
                    const hindiPrompt = generateCustomHindiEvaluationPrompt(
                      question,
                      extractedTexts,
                      { includeImageAnnotations }
                    );
                    const hindiResponse = await axios.post(
                      `${evaluationService.apiUrl}?key=${evaluationService.apiKey}`,
                      {
                        contents: [{ parts: [{ text: hindiPrompt }] }],
                        generationConfig: {
                          temperature: 0.7,
                          topK: 40,
                          topP: 0.95,
                          maxOutputTokens: 2048,
                        },
                      },
                      {
                        headers: { "Content-Type": "application/json" },
                        timeout: 30000,
                      }
                    );
                    if (
                      hindiResponse.status === 200 &&
                      hindiResponse.data?.candidates?.[0]?.content
                    ) {
                      const hindiEvaluationText =
                        hindiResponse.data.candidates[0].content.parts[0].text;
                      evaluation.hindiEvaluation = parseHindiEvaluationResponse(
                        hindiEvaluationText,
                        question
                      );
                    }
                  }
                } catch (hindiError) {
                  console.error(
                    "[v0] Hindi evaluation failed for error fallback:",
                    hindiError.message
                  );
                  // Generate a mock Hindi evaluation as fallback
                  try {
                    const mockHindiEvaluation = {
                      relevancy: evaluation.relevancy || 75,
                      score: evaluation.score || 6,
                      remark:
                        "मूल्यांकन सफलतापूर्वक पूरा हुआ - AI सेवा अस्थायी रूप से अनुपलब्ध थी",
                      comments: [
                        "उत्तर में विषय की समझ दिखाई देती है लेकिन अधिक विस्तृत व्याख्या की आवश्यकता है",
                        "संरचना अच्छी है लेकिन कुछ भागों को बेहतर व्यवस्थित किया जा सकता है",
                        "निष्कर्ष प्रभावी है लेकिन अधिक विशिष्ट सुझावों से मजबूत हो सकता है",
                      ],
                      analysis: {
                        introduction: [
                          "परिचय अच्छी तरह से प्रस्तुत किया गया है",
                          "मुख्य शब्दों का उल्लेख प्रभावी है",
                        ],
                        body: [
                          "बिंदु प्रासंगिक हैं लेकिन उदाहरणों से पुष्टि की आवश्यकता है",
                          "तर्क मजबूत करने के लिए साक्ष्य की आवश्यकता है",
                        ],
                        conclusion: [
                          "निष्कर्ष संतुलित है और तार्किक समापन प्रदान करता है",
                          "भविष्योन्मुखी दृष्टिकोण दिखाता है",
                        ],
                        strengths: ["विषय की अच्छी समझ", "तार्किक प्रवाह"],
                        weaknesses: [
                          "कुछ पहलुओं में गहराई की कमी",
                          "प्रस्तुति में सुधार की आवश्यकता",
                        ],
                        suggestions: [
                          "अधिक विशिष्ट उदाहरण जोड़ें",
                          "शीर्षक और उप-शीर्षक का उपयोग करें",
                        ],
                        feedback: [
                          "समग्र रूप से अच्छा प्रयास है लेकिन अधिक विस्तार की आवश्यकता है",
                        ],
                      },
                    };
                    evaluation.hindiEvaluation = mockHindiEvaluation;
                    console.log(
                      "[v0] Mock Hindi evaluation generated for error fallback"
                    );
                  } catch (mockError) {
                    console.error(
                      "[v0] Mock Hindi evaluation generation failed:",
                      mockError.message
                    );
                  }
                }
              }

              // Attach fallback per-image mapping even on AI failure (auto mode only)
              const includeImageAnnotationsOnError =
                question.evaluationMode !== "manual";
              if (includeImageAnnotationsOnError) {
                try {
                  const candidates = [
                    ...(evaluation.comments || []),
                    ...(evaluation.analysis?.strengths || []).map(
                      (s) => `✓ ${s}`
                    ),
                    ...(evaluation.analysis?.weaknesses || []).map(
                      (w) => `⚠ ${w}`
                    ),
                  ];
                  const perImage = mapCommentsToImages(
                    candidates,
                    extractedTexts,
                    2
                  );
                  evaluation.perImageComments = perImage;
                  console.log(
                    "[Annot] perImageComments (fallback-on-error):",
                    perImage.map((x) => x.length)
                  );
                } catch (fallbackErr) {
                  console.warn(
                    "Per-image fallback mapping (on error) failed:",
                    fallbackErr.message
                  );
                }
              }
            }
          } else {
            if (req.files && req.files.length > 0) {
              for (const file of req.files) {
                try {
                  await cloudinary.uploader.destroy(file.filename);
                } catch (cleanupError) {
                  console.error(
                    "Error cleaning up unreadable image:",
                    cleanupError
                  );
                }
              }
            }

            return res.status(400).json({
              success: false,
              message: "Invalid image content",
              responseCode: 1577,
              error: {
                code: "UNREADABLE_IMAGE_CONTENT",
                details:
                  "No readable text could be extracted from the uploaded images. Please ensure images are clear and contain relevant answer content.",
              },
            });
          }
        } catch (extractionError) {
          if (req.files && req.files.length > 0) {
            for (const file of req.files) {
              try {
                await cloudinary.uploader.destroy(file.filename);
              } catch (cleanupError) {
                console.error(
                  "Error cleaning up image after extraction error:",
                  cleanupError
                );
              }
            }
          }

          return res.status(500).json({
            success: false,
            message: "Text extraction failed",
            responseCode: 1578,
            error: {
              code: "TEXT_EXTRACTION_ERROR",
              details: `Text extraction service error: ${extractionError.message}. Please try again or contact support if the issue persists.`,
            },
          });
        }
      }

      const userAnswerData = {
        userId: userId,
        questionId: questionId,
        testType: "aiswb",
        clientId: req.user.clientId,
        answerImages: answerImages,
        textAnswer: textAnswer || "",
        submissionStatus: "submitted",
        reviewStatus: null,
        metadata: {
          timeSpent: Number.parseInt(timeSpent) || 0,
          deviceInfo: deviceInfo || "",
          appVersion: appVersion || "",
          sourceType: sourceType || "qr_scan",
        },
        submittedAt: new Date(),
      };

      if (evaluation) {
        userAnswerData.evaluation = evaluation;
        // If Hindi evaluation exists, save it separately in hindiEvaluation field
        if (evaluation.hindiEvaluation) {
          userAnswerData.hindiEvaluation = evaluation.hindiEvaluation;
          // Remove hindiEvaluation from the main evaluation object to avoid duplication
          delete evaluation.hindiEvaluation;
          userAnswerData.evaluation = evaluation;
        }
        if (!isManualEvaluation) {
          userAnswerData.submissionStatus = "evaluated";
          userAnswerData.publishStatus = "published";
          userAnswerData.reviewStatus = null;
          // Attempt to generate auto annotations via Cloudinary overlays (non-blocking)
          try {
            const includeImageAnnotations =
              question.evaluationMode !== "manual";
            if (
              includeImageAnnotations &&
              Array.isArray(answerImages) &&
              answerImages.length > 0
            ) {
              const annotations = [];
              for (let i = 0; i < answerImages.length; i++) {
                const img = answerImages[i];
                // Use at most 4 evaluation comments overall
                const evalComments = (evaluation.comments || []).slice(0, 4);
                let comments;
                if (answerImages.length === 1) {
                  // Single image: show all 4 comments regardless of perImageComments
                  comments = evalComments;
                } else {
                  // Multiple images: prefer per-image mapping, else 2 per image
                  comments =
                    Array.isArray(evaluation.perImageComments?.[i]) &&
                    evaluation.perImageComments[i].length > 0
                      ? evaluation.perImageComments[i]
                      : evalComments.slice(0, 2);
                }
                if (!img.cloudinaryPublicId) continue;
                // Professional text wrapping for better readability and proper line breaks
                const formatCommentsForDisplay = (comments) => {
                  if (!Array.isArray(comments) || comments.length === 0)
                    return "";
                  return comments
                    .map((c) => String(c).trim())
                    .filter(Boolean)
                    .join("\n\n"); // blank line separates comments for per-comment numbering/tick
                };

                const text = formatCommentsForDisplay(comments);
                if (!text) continue;

                // Generate S3 key for annotated image (following your pattern)
                try {
                  const fileExtension = ".png"; // Use PNG extension for annotated images
                  const s3Key = `${
                    req.clientInfo.businessName
                  }/auto-annotated-images/${
                    req.user.clientId
                  }/${questionId}/${Date.now()}_${i}${fileExtension}`;

                  // Create annotated image by overlaying text on the original image
                  const mockReq = {
                    body: {
                      imageUrl: img.imageUrl,
                      text: text,
                      fontsize: 18,
                      fontFamily: "Arial",
                      fontWeight: "bold",
                      color: "#FF0000", // bright red text
                      align: "left",
                      numbered: true,
                      withTicks: false,
                      ticks: [
                        { x: 0.22, y: 0.3, size: 100, color: "#FF0000" },
                        { x: 0.10, y: 0.6, size: 100, color: "#FF0000" },
                        { x: 0.40, y: 0.8, size: 100, color: "#FF0000" },
                      ],

                      xPadding: 24,
                      sidebar: true,
                      sidebarWidth: 480,
                      sidebarColor: "#FFFFFF",
                      padding: 10,
                      borderRadius: 6,
                      textShadow: "2px 2px 6px rgba(0,0,0,0.9)", // extra shadow to make red pop
                    },
                  };

                  let annotatedImageBase64 = null;

                  const mockRes = {
                    json: (data) => {
                      if (data.success && data.image) {
                        annotatedImageBase64 = data.image;
                      } else {
                        throw new Error("Failed to create annotated image");
                      }
                    },
                  };

                  // Call the overlayTextOnImage function
                  await overlayTextOnImage(mockReq, mockRes);

                  if (annotatedImageBase64) {
                    // Convert base64 image to buffer
                    const imageBuffer = Buffer.from(
                      annotatedImageBase64,
                      "base64"
                    );

                    // Upload the annotated image to S3
                    const uploadedKey = await uploadFileToS3(
                      imageBuffer,
                      s3Key,
                      "image/png"
                    );

                    // Generate download URL for the uploaded annotated image
                    const downloadUrl = await generateAnnotatedImageUrl(
                      uploadedKey
                    );

                    annotations.push({
                      s3Key: uploadedKey,
                      downloadUrl: downloadUrl,
                      uploadedAt: new Date(),
                    });
                  }
                } catch (s3Error) {
                  console.warn(
                    "Failed to create or upload annotated image:",
                    s3Error.message
                  );
                }
              }
              if (annotations.length > 0) {
                userAnswerData.annotations = annotations;
              } else {
                console.log(
                  "[Annot] no annotations prepared (no comments or missing publicId)."
                );
              }
            }
          } catch (annErr) {
            console.warn("Auto annotation (overlay) failed:", annErr.message);
          }
        } else {
          userAnswerData.submissionStatus = "submitted";
          userAnswerData.reviewStatus = null;
        }
      }

      if (extractedTexts.length > 0) {
        userAnswerData.extractedTexts = extractedTexts;
      }

      if (setId) {
        userAnswerData.setId = setId;
      }

      let userAnswer;
      try {
        userAnswer = await UserAnswer.createNewAttemptSafe(userAnswerData);
      } catch (saferError) {
        if (saferError.code === "SUBMISSION_LIMIT_EXCEEDED") {
          throw saferError;
        }
        try {
          userAnswer = await UserAnswer.createNewAttempt(userAnswerData);
        } catch (transactionError) {
          throw transactionError;
        }
      }

      const responseData = {
        answerId: userAnswer._id,
        attemptNumber: userAnswer.attemptNumber,
        questionId: question._id,
        userId: userId,
        imagesCount: answerImages.length,
        submissionStatus: userAnswer.submissionStatus,
        reviewStatus: userAnswer.reviewStatus,
        submittedAt: userAnswer.submittedAt,
        isFinalAttempt: userAnswer.isFinalAttempt(),
        remainingAttempts: Math.max(0, 15 - userAnswer.attemptNumber),
        evaluationMode: question.evaluationMode,
        question: {
          id: question._id,
          question: question.question,
          difficultyLevel: question.metadata?.difficultyLevel,
          maximumMarks: question.metadata?.maximumMarks,
          estimatedTime: question.metadata?.estimatedTime,
        },
      };

      if (setInfo) {
        responseData.set = {
          id: setInfo._id,
          name: setInfo.name,
          itemType: setInfo.itemType,
        };
      }

      if (evaluation) {
        responseData.evaluation = evaluation;
      }
      if (userAnswerData.hindiEvaluation) {
        responseData.hindiEvaluation = userAnswerData.hindiEvaluation;
      }
      if (userAnswerData.annotations && userAnswerData.annotations.length > 0) {
        responseData.annotations = userAnswerData.annotations;
        responseData.annotationsCount = userAnswerData.annotations.length;
      }
      if (extractedTexts.length > 0) {
        responseData.extractedTexts = extractedTexts;
      }

      let successMessage;
      if (isManualEvaluation) {
        if (evaluation) {
          successMessage =
            "Answer submitted successfully with AI pre-evaluation. Manual review pending.";
        } else {
          successMessage =
            "Answer submitted successfully and will be evaluated manually";
        }
      } else {
        successMessage = "Answer submitted and evaluated successfully";
      }

      res.status(200).json({
        success: true,
        message: successMessage,
        responseCode: 1579,
        data: responseData,
      });
    } catch (error) {
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
            await cloudinary.uploader.destroy(file.filename);
          } catch (cleanupError) {
            console.error("Error cleaning up file:", cleanupError);
          }
        }
      }

      if (error.name === "ValidationError") {
        const validationErrors = Object.values(error.errors).map((err) => ({
          field: err.path,
          message: err.message,
          value: err.value,
        }));
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          responseCode: 1580,
          error: {
            code: "VALIDATION_ERROR",
            details: validationErrors,
          },
        });
      }

      if (error.code === "SUBMISSION_LIMIT_EXCEEDED") {
        return res.status(400).json({
          success: false,
          message: error.message,
          responseCode: 1581,
          error: {
            code: error.code,
            details: "Maximum 15 attempts allowed per question",
          },
        });
      }

      if (error.code === "CREATION_FAILED") {
        return res.status(409).json({
          success: false,
          message: "Unable to create submission after multiple attempts",
          responseCode: 1582,
          error: {
            code: "SUBMISSION_PROCESSING_ERROR",
            details: "Please try again in a moment",
          },
        });
      }

      if (error.code === 11000 || error.message.includes("E11000")) {
        return res.status(409).json({
          success: false,
          message: "Submission processing failed due to duplicate entry",
          responseCode: 1583,
          error: {
            code: "DUPLICATE_SUBMISSION_ERROR",
            details:
              "This submission already exists. Please refresh and try again.",
          },
        });
      }

      console.error("Answer submission error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        responseCode: 1584,
        error: {
          code: "SERVER_ERROR",
          details: error.message,
        },
      });
    }
  }
);

router.post(
  "/subjective-tests/:testId/questions/:questionId/answers",
  authenticateMobileUser,
  validateQuestionId,
  upload.array("images", 10),
  validateAnswerSubmission,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            try {
              await cloudinary.uploader.destroy(file.filename);
            } catch (cleanupError) {
              console.error("Error cleaning up file:", cleanupError);
            }
          }
        }
        return res.status(400).json({
          success: false,
          message: "Invalid input data",
          responseCode: 1571,
          error: {
            code: "INVALID_INPUT",
            details: errors.array(),
          },
        });
      }

      const { questionId, testId } = req.params;
      console.log("questionId", questionId);
      const userId = req.user.id;
      const { textAnswer, timeSpent, sourceType, deviceInfo, appVersion } =
        req.body;

      if (
        (!req.files || req.files.length === 0) &&
        (!textAnswer || textAnswer.trim() === "")
      ) {
        return res.status(400).json({
          success: false,
          message: "Either images or text answer must be provided",
          responseCode: 1572,
          error: {
            code: "NO_ANSWER_PROVIDED",
            details: "At least one form of answer (image or text) is required",
          },
        });
      }

      const submissionStatus = await UserAnswer.canUserSubmit(
        userId,
        questionId
      );
      if (!submissionStatus.canSubmit) {
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            try {
              await cloudinary.uploader.destroy(file.filename);
            } catch (cleanupError) {
              console.error("Error cleaning up file:", cleanupError);
            }
          }
        }
        return res.status(555).json({
          success: false,
          message: "Maximum submission limit reached",
          responseCode: 1573,
          error: {
            code: "SUBMISSION_LIMIT_EXCEEDED",
            details: "Maximum 15 attempts allowed per question",
          },
        });
      }
      console.log("questionId", questionId);
      const question = await SubjectiveTestQuestion.findById(questionId);
      console.log("question", question);
      if (!question) {
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            try {
              await cloudinary.uploader.destroy(file.filename);
            } catch (cleanupError) {
              console.error("Error cleaning up file:", cleanupError);
            }
          }
        }
        return res.status(404).json({
          success: false,
          message: "Question not found",
          responseCode: 1574,
          error: {
            code: "QUESTION_NOT_FOUND",
            details: "The specified question does not exist",
          },
        });
      }
      let testInfo = null;
      if (testId) {
        testInfo = await SubjectiveTest.findById(testId);
        console.log("testInfo", testInfo);
        if (!testInfo) {
          return res.status(404).json({
            success: false,
            message: "Test not found",
            responseCode: 1575,
            error: {
              code: "TEST_NOT_FOUND",
              details: "The specified test does not exist",
            },
          });
        }
      }

      const answerImages = [];
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          answerImages.push({
            imageUrl: file.path,
            cloudinaryPublicId: file.filename,
            originalName: file.originalname,
            uploadedAt: new Date(),
          });
        }
      }

      const isManualEvaluation = question.evaluationMode === "manual";
      let evaluation = null;
      let extractedTexts = [];

      if (answerImages.length > 0) {
        try {
          const imageUrls = answerImages.map((img) => img.imageUrl);
          extractedTexts = await extractTextFromImagesWithFallback(imageUrls);
          extractedTexts = cleanExtractedTexts(extractedTexts);

          const relevanceValidation = await validateTextRelevanceToQuestion(
            question,
            extractedTexts
          );

          if (!relevanceValidation.isValid) {
            if (req.files && req.files.length > 0) {
              for (const file of req.files) {
                try {
                  await cloudinary.uploader.destroy(file.filename);
                } catch (cleanupError) {
                  console.error(
                    "Error cleaning up invalid image:",
                    cleanupError
                  );
                }
              }
            }

            return res.status(400).json({
              success: false,
              message: "Invalid image content",
              responseCode: 1576,
              error: {
                code: "INVALID_IMAGE_CONTENT",
                details: relevanceValidation.reason,
                aiResponse: relevanceValidation.aiResponse || null,
              },
            });
          }

          const hasValidText = extractedTexts.some(
            (text) =>
              text &&
              text.trim().length > 0 &&
              !text.startsWith("Failed to extract text") &&
              !text.startsWith("No readable text found") &&
              !text.includes("Text extraction failed")
          );

          // Detect language early so it's available for all evaluation scenarios
          const combinedText = extractedTexts.join(" ");
          const detectedLanguage = detectLanguage(combinedText);
          console.log(
            "[v0] Detected language:",
            detectedLanguage,
            "for text:",
            combinedText.substring(0, 100)
          );

          // Get evaluation service early so it's available for all evaluation scenarios
          const evaluationService = await getServiceForTask("evaluation");

          if (hasValidText) {
            try {
              const prompt = generateEvaluationPrompt(question, extractedTexts);

              if (evaluationService.serviceName === "gemini") {
                const response = await axios.post(
                  `${evaluationService.apiUrl}?key=${evaluationService.apiKey}`,
                  {
                    contents: [
                      {
                        parts: [
                          {
                            text: prompt,
                          },
                        ],
                      },
                    ],
                    generationConfig: {
                      temperature: 0.7,
                      topK: 40,
                      topP: 0.95,
                      maxOutputTokens: 2048,
                    },
                  },
                  {
                    headers: { "Content-Type": "application/json" },
                    timeout: 30000,
                  }
                );

                if (
                  response.status === 200 &&
                  response.data?.candidates?.[0]?.content
                ) {
                  const evaluationText =
                    response.data.candidates[0].content.parts[0].text;
                  evaluation = parseEvaluationResponse(
                    evaluationText,
                    question
                  );

                  if (detectedLanguage === "hindi") {
                    console.log(
                      "[v0] Generating Hindi evaluation for detected Hindi text"
                    );
                    try {
                      const hindiEvaluation = await translateEvaluationToHindi(
                        evaluation,
                        question
                      );
                      if (hindiEvaluation) {
                        evaluation.hindiEvaluation = hindiEvaluation;
                      } else {
                        const hindiPrompt = generateCustomHindiEvaluationPrompt(
                          question,
                          extractedTexts
                        );
                        const hindiResponse = await axios.post(
                          `${evaluationService.apiUrl}?key=${evaluationService.apiKey}`,
                          {
                            contents: [{ parts: [{ text: hindiPrompt }] }],
                            generationConfig: {
                              temperature: 0.7,
                              topK: 40,
                              topP: 0.95,
                              maxOutputTokens: 2048,
                            },
                          },
                          {
                            headers: { "Content-Type": "application/json" },
                            timeout: 30000,
                          }
                        );
                        if (
                          hindiResponse.status === 200 &&
                          hindiResponse.data?.candidates?.[0]?.content
                        ) {
                          const hindiEvaluationText =
                            hindiResponse.data.candidates[0].content.parts[0]
                              .text;
                          let parsed = parseHindiEvaluationResponse(
                            hindiEvaluationText,
                            question
                          );
                          const engFeedback = (
                            evaluation.analysis?.feedback || []
                          ).join("\n");
                          if (
                            (parsed.analysis?.feedback || []).every((x) =>
                              /AI द्वारा कोई सामग्री प्रदान नहीं की गई।/.test(
                                String(x)
                              )
                            )
                          ) {
                            const translated = await translateTextToHindi(
                              engFeedback
                            );
                            if (translated)
                              parsed.analysis.feedback = translated
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean);
                          }
                          evaluation.hindiEvaluation = parsed;
                        }
                      }
                      evaluation = enforceEvaluationLimits(evaluation, {
                        maxRemark: 250,
                      });
                    } catch (hindiError) {
                      console.error(
                        "[v0] Hindi evaluation failed:",
                        hindiError.message
                      );
                    }
                  }

                  evaluation.evaluationMethod = "gemini";
                } else {
                  throw new Error("Invalid response from Gemini API");
                }
              } else if (evaluationService.serviceName === "openai") {
                const response = await axios.post(
                  evaluationService.apiUrl,
                  {
                    model: "gpt-4o-mini",
                    messages: [
                      {
                        role: "user",
                        content: prompt,
                      },
                    ],
                    max_tokens: 1500,
                    temperature: 0.7,
                  },
                  {
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${evaluationService.apiKey}`,
                    },
                    timeout: 30000,
                  }
                );

                if (response.data?.choices?.[0]?.message?.content) {
                  const evaluationText =
                    response.data.choices[0].message.content;
                  evaluation = parseEvaluationResponse(
                    evaluationText,
                    question
                  );

                  if (detectedLanguage === "hindi") {
                    console.log(
                      "[v0] Generating Hindi evaluation for detected Hindi text"
                    );
                    try {
                      const hindiEvaluation = await translateEvaluationToHindi(
                        evaluation,
                        question
                      );
                      if (hindiEvaluation) {
                        // Enrich the Hindi evaluation with missing comments from English
                        evaluation.hindiEvaluation =
                          await enrichHindiEvaluationFromEnglish(
                            evaluation,
                            hindiEvaluation
                          );
                      } else {
                        const hindiPrompt = generateCustomHindiEvaluationPrompt(
                          question,
                          extractedTexts
                        );
                        const hindiResponse = await axios.post(
                          evaluationService.apiUrl,
                          {
                            model: "gpt-4o-mini",
                            messages: [{ role: "user", content: hindiPrompt }],
                            max_tokens: 1500,
                            temperature: 0.7,
                          },
                          {
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${evaluationService.apiKey}`,
                            },
                            timeout: 30000,
                          }
                        );
                        if (
                          hindiResponse.data?.choices?.[0]?.message?.content
                        ) {
                          const hindiEvaluationText =
                            hindiResponse.data.choices[0].message.content;
                          const parsedHindiEval = parseHindiEvaluationResponse(
                            hindiEvaluationText,
                            question
                          );
                          // Enrich the parsed Hindi evaluation with missing comments from English
                          evaluation.hindiEvaluation =
                            await enrichHindiEvaluationFromEnglish(
                              evaluation,
                              parsedHindiEval
                            );
                        }
                      }
                    } catch (hindiError) {
                      console.error(
                        "[v0] Hindi evaluation failed:",
                        hindiError.message
                      );
                    }
                  }

                  evaluation.evaluationMethod = "openai";
                } else {
                  throw new Error("Invalid response from OpenAI API");
                }
              } else if (evaluationService.serviceName === "agentic") {
                evaluation = generateMockEvaluation(question);
                evaluation.evaluationMethod = "agentic_mock";
              }

              if (!evaluation) {
                evaluation = generateMockEvaluation(question);
              }

              // Generate Hindi evaluation for fallback evaluation if language is Hindi
              if (
                detectedLanguage === "hindi" &&
                evaluation &&
                !evaluation.hindiEvaluation
              ) {
                console.log(
                  "[v0] Generating Hindi evaluation for fallback evaluation (subjective)"
                );
                try {
                  const hindiEvaluation = await translateEvaluationToHindi(
                    evaluation,
                    question
                  );
                  if (hindiEvaluation)
                    evaluation.hindiEvaluation = hindiEvaluation;
                  else {
                    const includeImageAnnotations =
                      question.evaluationMode !== "manual";
                    const hindiPrompt = generateCustomHindiEvaluationPrompt(
                      question,
                      extractedTexts,
                      { includeImageAnnotations }
                    );
                    const hindiResponse = await axios.post(
                      `${evaluationService.apiUrl}?key=${evaluationService.apiKey}`,
                      {
                        contents: [{ parts: [{ text: hindiPrompt }] }],
                        generationConfig: {
                          temperature: 0.7,
                          topK: 40,
                          topP: 0.95,
                          maxOutputTokens: 2048,
                        },
                      },
                      {
                        headers: { "Content-Type": "application/json" },
                        timeout: 30000,
                      }
                    );
                    if (
                      hindiResponse.status === 200 &&
                      hindiResponse.data?.candidates?.[0]?.content
                    ) {
                      const hindiEvaluationText =
                        hindiResponse.data.candidates[0].content.parts[0].text;
                      evaluation.hindiEvaluation = parseHindiEvaluationResponse(
                        hindiEvaluationText,
                        question
                      );
                    }
                  }
                } catch (hindiError) {
                  console.error(
                    "[v0] Hindi evaluation failed for fallback (subjective):",
                    hindiError.message
                  );
                  // Generate a mock Hindi evaluation as fallback
                  try {
                    const mockHindiEvaluation = {
                      relevancy: evaluation.relevancy || 75,
                      score: evaluation.score || 6,
                      remark:
                        "मूल्यांकन सफलतापूर्वक पूरा हुआ - AI सेवा अस्थायी रूप से अनुपलब्ध थी",
                      comments: [
                        "उत्तर में विषय की समझ दिखाई देती है लेकिन अधिक विस्तृत व्याख्या की आवश्यकता है",
                        "संरचना अच्छी है लेकिन कुछ भागों को बेहतर व्यवस्थित किया जा सकता है",
                        "निष्कर्ष प्रभावी है लेकिन अधिक विशिष्ट सुझावों से मजबूत हो सकता है",
                      ],
                      analysis: {
                        introduction: [
                          "परिचय अच्छी तरह से प्रस्तुत किया गया है",
                          "मुख्य शब्दों का उल्लेख प्रभावी है",
                        ],
                        body: [
                          "बिंदु प्रासंगिक हैं लेकिन उदाहरणों से पुष्टि की आवश्यकता है",
                          "तर्क मजबूत करने के लिए साक्ष्य की आवश्यकता है",
                        ],
                        conclusion: [
                          "निष्कर्ष संतुलित है और तार्किक समापन प्रदान करता है",
                          "भविष्योन्मुखी दृष्टिकोण दिखाता है",
                        ],
                        strengths: ["विषय की अच्छी समझ", "तार्किक प्रवाह"],
                        weaknesses: [
                          "कुछ पहलुओं में गहराई की कमी",
                          "प्रस्तुति में सुधार की आवश्यकता",
                        ],
                        suggestions: [
                          "अधिक विशिष्ट उदाहरण जोड़ें",
                          "शीर्षक और उप-शीर्षक का उपयोग करें",
                        ],
                        feedback: [
                          "समग्र रूप से अच्छा प्रयास है लेकिन अधिक विस्तार की आवश्यकता है",
                        ],
                      },
                    };
                    evaluation.hindiEvaluation = mockHindiEvaluation;
                    console.log(
                      "[v0] Mock Hindi evaluation generated for fallback (subjective)"
                    );
                  } catch (mockError) {
                    console.error(
                      "[v0] Mock Hindi evaluation generation failed:",
                      mockError.message
                    );
                  }
                }
              }
            } catch (evaluationError) {
              console.error("AI evaluation failed:", evaluationError.message);
              evaluation = generateMockEvaluation(question);

              // Generate Hindi evaluation for error fallback if language is Hindi
              if (
                detectedLanguage === "hindi" &&
                evaluation &&
                !evaluation.hindiEvaluation
              ) {
                console.log(
                  "[v0] Generating Hindi evaluation for error fallback (subjective)"
                );
                try {
                  const hindiEvaluation = await translateEvaluationToHindi(
                    evaluation,
                    question
                  );
                  if (hindiEvaluation)
                    evaluation.hindiEvaluation = hindiEvaluation;
                  else {
                    const includeImageAnnotations =
                      question.evaluationMode !== "manual";
                    const hindiPrompt = generateCustomHindiEvaluationPrompt(
                      question,
                      extractedTexts,
                      { includeImageAnnotations }
                    );
                    const hindiResponse = await axios.post(
                      `${evaluationService.apiUrl}?key=${evaluationService.apiKey}`,
                      {
                        contents: [{ parts: [{ text: hindiPrompt }] }],
                        generationConfig: {
                          temperature: 0.7,
                          topK: 40,
                          topP: 0.95,
                          maxOutputTokens: 2048,
                        },
                      },
                      {
                        headers: { "Content-Type": "application/json" },
                        timeout: 30000,
                      }
                    );
                    if (
                      hindiResponse.status === 200 &&
                      hindiResponse.data?.candidates?.[0]?.content
                    ) {
                      const hindiEvaluationText =
                        hindiResponse.data.candidates[0].content.parts[0].text;
                      evaluation.hindiEvaluation = parseHindiEvaluationResponse(
                        hindiEvaluationText,
                        question
                      );
                    }
                  }
                } catch (hindiError) {
                  console.error(
                    "[v0] Hindi evaluation failed for error fallback (subjective):",
                    hindiError.message
                  );
                  // Generate a mock Hindi evaluation as fallback
                  try {
                    const mockHindiEvaluation = {
                      relevancy: evaluation.relevancy || 75,
                      score: evaluation.score || 6,
                      remark:
                        "मूल्यांकन सफलतापूर्वक पूरा हुआ - AI सेवा अस्थायी रूप से अनुपलब्ध थी",
                      comments: [
                        "उत्तर में विषय की समझ दिखाई देती है लेकिन अधिक विस्तृत व्याख्या की आवश्यकता है",
                        "संरचना अच्छी है लेकिन कुछ भागों को बेहतर व्यवस्थित किया जा सकता है",
                        "निष्कर्ष प्रभावी है लेकिन अधिक विशिष्ट सुझावों से मजबूत हो सकता है",
                      ],
                      analysis: {
                        introduction: [
                          "परिचय अच्छी तरह से प्रस्तुत किया गया है",
                          "मुख्य शब्दों का उल्लेख प्रभावी है",
                        ],
                        body: [
                          "बिंदु प्रासंगिक हैं लेकिन उदाहरणों से पुष्टि की आवश्यकता है",
                          "तर्क मजबूत करने के लिए साक्ष्य की आवश्यकता है",
                        ],
                        conclusion: [
                          "निष्कर्ष संतुलित है और तार्किक समापन प्रदान करता है",
                          "भविष्योन्मुखी दृष्टिकोण दिखाता है",
                        ],
                        strengths: ["विषय की अच्छी समझ", "तार्किक प्रवाह"],
                        weaknesses: [
                          "कुछ पहलुओं में गहराई की कमी",
                          "प्रस्तुति में सुधार की आवश्यकता",
                        ],
                        suggestions: [
                          "अधिक विशिष्ट उदाहरण जोड़ें",
                          "शीर्षक और उप-शीर्षक का उपयोग करें",
                        ],
                        feedback: [
                          "समग्र रूप से अच्छा प्रयास है लेकिन अधिक विस्तार की आवश्यकता है",
                        ],
                      },
                    };
                    evaluation.hindiEvaluation = mockHindiEvaluation;
                    console.log(
                      "[v0] Mock Hindi evaluation generated for error fallback (subjective)"
                    );
                  } catch (mockError) {
                    console.error(
                      "[v0] Mock Hindi evaluation generation failed:",
                      mockError.message
                    );
                  }
                }
              }
            }
          } else {
            if (req.files && req.files.length > 0) {
              for (const file of req.files) {
                try {
                  await cloudinary.uploader.destroy(file.filename);
                } catch (cleanupError) {
                  console.error(
                    "Error cleaning up unreadable image:",
                    cleanupError
                  );
                }
              }
            }

            return res.status(400).json({
              success: false,
              message: "Invalid image content",
              responseCode: 1577,
              error: {
                code: "UNREADABLE_IMAGE_CONTENT",
                details:
                  "No readable text could be extracted from the uploaded images. Please ensure images are clear and contain relevant answer content.",
              },
            });
          }
        } catch (extractionError) {
          if (req.files && req.files.length > 0) {
            for (const file of req.files) {
              try {
                await cloudinary.uploader.destroy(file.filename);
              } catch (cleanupError) {
                console.error(
                  "Error cleaning up image after extraction error:",
                  cleanupError
                );
              }
            }
          }

          return res.status(500).json({
            success: false,
            message: "Text extraction failed",
            responseCode: 1578,
            error: {
              code: "TEXT_EXTRACTION_ERROR",
              details: `Text extraction service error: ${extractionError.message}. Please try again or contact support if the issue persists.`,
            },
          });
        }
      }

      const userAnswerData = {
        userId: userId,
        questionId: questionId,
        testType: "subjective",
        testId: testId,
        clientId: req.user.clientId,
        answerImages: answerImages,
        textAnswer: textAnswer || "",
        submissionStatus: "submitted",
        reviewStatus: null,
        metadata: {
          timeSpent: Number.parseInt(timeSpent) || 0,
          deviceInfo: deviceInfo || "",
          appVersion: appVersion || "",
          sourceType: sourceType || "qr_scan",
        },
        submittedAt: new Date(),
      };

      if (evaluation) {
        userAnswerData.evaluation = evaluation;
        // If Hindi evaluation exists, save it separately in hindiEvaluation field
        if (evaluation.hindiEvaluation) {
          userAnswerData.hindiEvaluation = evaluation.hindiEvaluation;
          // Remove hindiEvaluation from the main evaluation object to avoid duplication
          delete evaluation.hindiEvaluation;
          userAnswerData.evaluation = evaluation;
        }
        if (!isManualEvaluation) {
          userAnswerData.submissionStatus = "evaluated";
          userAnswerData.publishStatus = "published";
          userAnswerData.reviewStatus = null;
        } else {
          userAnswerData.submissionStatus = "submitted";
          userAnswerData.reviewStatus = null;
        }
      }

      if (extractedTexts.length > 0) {
        userAnswerData.extractedTexts = extractedTexts;
      }

      // testId is already set in userAnswerData above

      let userAnswer;
      try {
        userAnswer = await UserAnswer.createNewAttemptSafe(userAnswerData);
      } catch (saferError) {
        if (saferError.code === "SUBMISSION_LIMIT_EXCEEDED") {
          throw saferError;
        }
        try {
          userAnswer = await UserAnswer.createNewAttempt(userAnswerData);
        } catch (transactionError) {
          throw transactionError;
        }
      }

      const responseData = {
        answerId: userAnswer._id,
        attemptNumber: userAnswer.attemptNumber,
        questionId: question._id,
        userId: userId,
        imagesCount: answerImages.length,
        submissionStatus: userAnswer.submissionStatus,
        reviewStatus: userAnswer.reviewStatus,
        submittedAt: userAnswer.submittedAt,
        isFinalAttempt: userAnswer.isFinalAttempt(),
        remainingAttempts: Math.max(0, 15 - userAnswer.attemptNumber),
        evaluationMode: question.evaluationMode,
        question: {
          id: question._id,
          question: question.question,
          difficultyLevel: question.metadata?.difficultyLevel,
          maximumMarks: question.metadata?.maximumMarks,
          estimatedTime: question.metadata?.estimatedTime,
        },
      };

      if (testInfo) {
        responseData.test = {
          id: testInfo._id,
          name: testInfo.name,
          type: "subjective",
        };
      }

      if (evaluation) {
        responseData.evaluation = evaluation;
      }
      if (userAnswerData.hindiEvaluation) {
        responseData.hindiEvaluation = userAnswerData.hindiEvaluation;
      }
      if (extractedTexts.length > 0) {
        responseData.extractedTexts = extractedTexts;
      }

      let successMessage;
      if (isManualEvaluation) {
        if (evaluation) {
          successMessage =
            "Answer submitted successfully with AI pre-evaluation. Manual review pending.";
        } else {
          successMessage =
            "Answer submitted successfully and will be evaluated manually";
        }
      } else {
        successMessage = "Answer submitted and evaluated successfully";
      }

      res.status(200).json({
        success: true,
        message: successMessage,
        responseCode: 1579,
        data: responseData,
      });
    } catch (error) {
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
            await cloudinary.uploader.destroy(file.filename);
          } catch (cleanupError) {
            console.error("Error cleaning up file:", cleanupError);
          }
        }
      }

      if (error.name === "ValidationError") {
        const validationErrors = Object.values(error.errors).map((err) => ({
          field: err.path,
          message: err.message,
          value: err.value,
        }));
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          responseCode: 1580,
          error: {
            code: "VALIDATION_ERROR",
            details: validationErrors,
          },
        });
      }

      if (error.code === "SUBMISSION_LIMIT_EXCEEDED") {
        return res.status(400).json({
          success: false,
          message: error.message,
          responseCode: 1581,
          error: {
            code: error.code,
            details: "Maximum 15 attempts allowed per question",
          },
        });
      }

      if (error.code === "CREATION_FAILED") {
        return res.status(409).json({
          success: false,
          message: "Unable to create submission after multiple attempts",
          responseCode: 1582,
          error: {
            code: "SUBMISSION_PROCESSING_ERROR",
            details: "Please try again in a moment",
          },
        });
      }

      if (error.code === 11000 || error.message.includes("E11000")) {
        return res.status(409).json({
          success: false,
          message: "Submission processing failed due to duplicate entry",
          responseCode: 1583,
          error: {
            code: "DUPLICATE_SUBMISSION_ERROR",
            details:
              "This submission already exists. Please refresh and try again.",
          },
        });
      }

      console.error("Answer submission error:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        responseCode: 1584,
        error: {
          code: "SERVER_ERROR",
          details: error.message,
        },
      });
    }
  }
);

router.post(
  "/answers/:answerId/feedback",
  authenticateMobileUser,
  [
    param("answerId")
      .isMongoId()
      .withMessage("Answer ID must be a valid MongoDB ObjectId"),
    body("message")
      .isString()
      .trim()
      .notEmpty()
      .isLength({ max: 1000 })
      .withMessage(
        "Feedback message is required and must be less than 1000 characters"
      ),
  ],
  submitEvaluationFeedback
);

router.get("/:answerId", authenticateMobileUser, async (req, res) => {
  try {
    const answer = await UserAnswer.findById(req.params.answerId);
    if (!answer) {
      return res.status(404).json({
        success: false,
        message: "Answer not found",
        responseCode: 1585,
      });
    }
    const answerWithRefreshedUrls = await refreshAnnotatedImageUrls(answer);
    res.json({
      success: true,
      responseCode: 1586,
      data: answerWithRefreshedUrls,
    });
  } catch (error) {
    console.error("Error getting answer:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      responseCode: 1587,
      error: error.message,
    });
  }
});

module.exports = router;

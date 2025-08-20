const UserAnswer = require('../models/UserAnswer');
const AiswbQuestion = require('../models/AiswbQuestion');
const AISWBSet = require('../models/AISWBSet');
const { getEvaluationFrameworkText } = require('./aiServices');
// Use Node 18+ built-in fetch (Node 20 in this project)
const fetch = globalThis.fetch;
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

// API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Text extraction functions
const extractTextFromImages = async (imageUrls) => {
  // ... (same implementation as original)
};

const extractTextFromImagesGemini = async (imageUrls) => {
  // ... (same implementation as original)
};

const extractTextFromImagesWithFallback = async (imageUrls) => {
  // ... (same implementation as original)
};

// Evaluation functions
const generateEvaluationPrompt = (question, extractedTexts) => {
  const combinedText = extractedTexts.join("\n\n--- Next Image ---\n\n");
  
  // Use the stored evaluation guideline (will always have a value - either custom or default)
  const evaluationFramework = question.evaluationGuideline || getEvaluationFrameworkText();
  
  return `Please evaluate this student's answer to the given question using the following evaluation framework.\n\n${evaluationFramework}\n\nQUESTION:\n${question.question}\n\nMAXIMUM MARKS: ${question.metadata?.maximumMarks || 10}\n\nSTUDENT'S ANSWER (extracted from images):\n${combinedText}\n\nPlease use the exact section headers as shown below, and do not change their names or order.\n\nRELEVANCY: [Score out of 100 - How relevant is the answer to the question]\nSCORE: [Score out of ${question.metadata?.maximumMarks || 10}]\n\nIntroduction:\n[Your analysis of the introduction]\n\nBody:\n[Your analysis of the body]\n\nConclusion:\n[Your analysis of the conclusion]\n\nStrengths:\n[List 2-3 strengths]\n\nWeaknesses:\n[List 2-3 weaknesses]\n\nSuggestions:\n[List 2-3 suggestions]\n\nFeedback:\n[Overall feedback]\n\nComments:\n[3-4 detailed comments (5-12 words each)]\n\nRemark:\n[1-2 line summary of the overall answer quality]\n`;
};

const parseEvaluationResponse = (evaluationText, question) => {
  // ... (same implementation as original)
};

const generateMockEvaluation = (question) => {
  // ... (same implementation as original)
};

// Service functions
const submitAnswerService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const getEvaluationService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const getSubmissionStatusService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const getLatestAnswerService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const getUserAttemptsService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const getAttemptByNumberService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const getEvaluationsService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const getCompleteQuestionDataService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const reevaluateAnswerService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const bulkUpdateEvaluationService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

const adminUpdateEvaluationService = async (req) => {
  // ... (same implementation as original route handler)
  // Return the response data instead of sending the response
};

module.exports = {
  extractTextFromImages,
  extractTextFromImagesGemini,
  extractTextFromImagesWithFallback,
  generateEvaluationPrompt,
  parseEvaluationResponse,
  generateMockEvaluation,
  submitAnswerService,
  getEvaluationService,
  getSubmissionStatusService,
  getLatestAnswerService,
  getUserAttemptsService,
  getAttemptByNumberService,
  getEvaluationsService,
  getCompleteQuestionDataService,
  reevaluateAnswerService,
  bulkUpdateEvaluationService,
  adminUpdateEvaluationService
};
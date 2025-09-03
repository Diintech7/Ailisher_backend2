const express = require('express');
const {verifyToken,isClient} = require('../middleware/auth');
const { createQuestionBank, getQuestionBanks, getQuestionBankById, uploadImage, updateQuestionBank, deleteQuestionBank, updateCoverImage, createQuestion, getQuestionsByTest, updateQuestion, deleteQuestion, getQuestions, bulkDeleteQuestions, getQuestionBankSummary } = require('../controllers/questionBank');
const multer= require('multer');
const { extractTextFromFile } = require('../controllers/questionbanktextextract');
const { cleanExtractedText, cleanExtractedTextStream } = require('../controllers/questionbankcleantext');

const router = express.Router();

router.post('/upload-url',verifyToken,isClient,uploadImage);

router.post('/',verifyToken,isClient,createQuestionBank);

router.get('/',verifyToken,isClient,getQuestionBanks);

router.get('/:id/summary',verifyToken,isClient,getQuestionBankSummary);

router.get('/:id',verifyToken,isClient,getQuestionBankById);

router.put('/:id',verifyToken,isClient,updateQuestionBank);

router.delete('/:id',verifyToken,isClient,deleteQuestionBank);

router.put('/:id/cover',verifyToken,isClient, updateCoverImage);

// Create a new question
router.post('/:id/question',verifyToken, isClient,createQuestion );

// Get all questions for a specific test
router.get('/:id/questions',verifyToken,isClient,getQuestions );

// Update a question
router.put('/:id/question',verifyToken,isClient,updateQuestion );

// Delete a question
router.delete('/:id/question',verifyToken,isClient,deleteQuestion );

// Bulk delete questions
router.delete('/:id/questions/bulk',verifyToken,isClient,bulkDeleteQuestions );

// Configure multer for memory storage (no file saved to disk)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Check file type - now supports both images and PDFs
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only image files (JPEG, PNG, GIF, BMP) and PDF files are allowed'), false);
        }
    }
});

router.post('/extract-text',upload.single('image'),extractTextFromFile);

router.post('/clean-text',cleanExtractedText);

router.post('/clean-text-stream',cleanExtractedTextStream);

module.exports = router;
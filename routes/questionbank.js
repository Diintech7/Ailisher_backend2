const express = require('express');
const {verifyToken,isClient} = require('../middleware/auth');
const { createQuestionBank, getQuestionBanks, getQuestionBankById, uploadImage, updateQuestionBank, deleteQuestionBank, updateCoverImage, createQuestion, getQuestionsByTest, updateQuestion, deleteQuestion, getQuestions } = require('../controllers/questionBank');

const router = express.Router();

router.post('/upload-url',verifyToken,isClient,uploadImage);

router.post('/',verifyToken,isClient,createQuestionBank);

router.get('/',verifyToken,isClient,getQuestionBanks);

router.get('/:id',verifyToken,isClient,getQuestionBankById);

router.put('/:id',verifyToken,isClient,updateQuestionBank);

router.delete('/:id',verifyToken,isClient,deleteQuestionBank);

router.put('/:id/cover',verifyToken,isClient, updateCoverImage);

// Create a new question
router.post('/:id',verifyToken, isClient,createQuestion );

// Get all questions for a specific test
router.get('/:id',verifyToken,isClient,getQuestions );

// Update a question
router.put('/:questionId',verifyToken,isClient,updateQuestion );

// Delete a question
router.delete('/:questionId',verifyToken,isClient,deleteQuestion );



module.exports = router;
const SubjectiveTestQuestion = require('../models/SubjectiveTestQuestion');
const SubjectiveTest = require('../models/SubjectiveTest');
const { validationResult } = require('express-validator');
const { getEvaluationFrameworkText } = require('../services/aiServices');

// Question Controllers
const addQuestion = async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid input data",
          error: {
            code: "INVALID_INPUT",
            details: errors.array()
          }
        });
      }
  
      const questionData = req.body.question;
      const testId = req.params.testId;
  
      // Validate set exists if setId provided
      if (testId) {
        const test = await SubjectiveTest.findById(testId);
        if (!test) {
          return res.status(404).json({
            success: false,
            message: "Test not found",
            error: {
              code: "TEST_NOT_FOUND",
              details: "The specified test does not exist"
            }
          });
        }
      }
  
      // Set default evaluation guideline if not provided
      if (!questionData.evaluationGuideline || questionData.evaluationGuideline.trim() === '') {
        questionData.evaluationGuideline = getEvaluationFrameworkText();
      }
  
      const question = new SubjectiveTestQuestion({
        ...questionData,
        test: testId || null
      });
  
      await question.save();
  
      // If setId provided, add question to set
        if (testId) {
        await SubjectiveTest.findByIdAndUpdate(
          testId,
          { $push: { questions: question._id } }
        );
      }
  
      res.status(200).json({
        success: true,
        message: "Question added successfully",
        data: {
          id: question._id.toString(),
          question: question.question,
          detailedAnswer: question.detailedAnswer,
          modalAnswer: question.modalAnswer,
          answerVideoUrls: question.answerVideoUrls || [], // Updated to handle array
          metadata: question.metadata,
          languageMode: question.languageMode,
          evaluationMode: question.evaluationMode,
          evaluationType: question.evaluationType,
          evaluationGuideline: question.evaluationGuideline,
          createdAt: question.createdAt.toISOString(),
          updatedAt: question.updatedAt.toISOString()
        }
      });
  
    } catch (error) {
      console.error('Add question error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  };

const getAllQuestionsByTest = async (req, res) => { 
  try {
    const testId = req.params.testId;
    const test = await SubjectiveTest.findById(testId);
    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found",
        error: {
          code: "TEST_NOT_FOUND",
          details: "The specified test does not exist"
        }
      });
    }
    const total_time = test.Estimated_time;
    const questions = await SubjectiveTestQuestion.find({ test: testId });
    if (!questions) {
      return res.status(404).json({
        success: false,
        message: "Questions not found",
        error: {
          code: "QUESTIONS_NOT_FOUND",
          details: "The specified questions do not exist"
        }
      });
    }
    res.status(200).json({
      success: true,
      message: "Questions fetched successfully",
      total_time: total_time,
      questions
    });
  } catch (error) {
    console.error('Get all questions by test error:', error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: {
        code: "SERVER_ERROR",
        details: error.message
      }
    });
  }
};


  const updateQuestion = async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Invalid input data",
          error: {
            code: "INVALID_INPUT",
            details: errors.array()
          }
        });
      }
  
      const questionId = req.params.questionId;
      const questionData = req.body.question;
  
      const question = await SubjectiveTestQuestion.findById(questionId);
      if (!question) {
        return res.status(404).json({
          success: false,
          message: "Question not found",
          error: {
            code: "QUESTION_NOT_FOUND",
            details: "The specified question does not exist"
          }
        });
      }
  
      // Set default evaluation guideline if not provided
      if (!questionData.evaluationGuideline || questionData.evaluationGuideline.trim() === '') {
        questionData.evaluationGuideline = getEvaluationFrameworkText();
      }
  
      // Update question fields
      Object.assign(question, questionData);
      await question.save();
  
      res.status(200).json({
        success: true,
        message: "Question updated successfully",
        data: {
          id: question._id.toString(),
          question: question.question,
          detailedAnswer: question.detailedAnswer,
          modalAnswer: question.modalAnswer,
          answerVideoUrls: question.answerVideoUrls || [], // Updated to handle array
          metadata: question.metadata,
          languageMode: question.languageMode,
          evaluationMode: question.evaluationMode,
          evaluationType: question.evaluationType,
          evaluationGuideline: question.evaluationGuideline,
          updatedAt: question.updatedAt.toISOString()
        }
      });
  
    } catch (error) {
      console.error('Update question error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  };
  
  const deleteQuestion = async (req, res) => {
    try {
      const questionId = req.params.questionId;
  
      const question = await SubjectiveTestQuestion.findById(questionId);
      if (!question) {
        return res.status(404).json({
          success: false,
          message: "Question not found",
          error: {
            code: "QUESTION_NOT_FOUND",
            details: "The specified question does not exist"
          }
        });
      }
  
      // Remove question from any sets
      await SubjectiveTest.updateMany(
        { questions: questionId },
        { $pull: { questions: questionId } }
      );
  
      await SubjectiveTestQuestion.findByIdAndDelete(questionId);
  
      res.status(200).json({
        success: true,
        message: "Question deleted successfully"
      });
  
    } catch (error) {
      console.error('Delete question error:', error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: {
          code: "SERVER_ERROR",
          details: error.message
        }
      });
    }
  };

  module.exports = {
    addQuestion,
    getAllQuestionsByTest,
    updateQuestion,
    deleteQuestion
  }
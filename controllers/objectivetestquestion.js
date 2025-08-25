const ObjectiveTestQuestion = require('../models/ObjectiveTestQuestion');
const ObjectiveTest = require('../models/ObjectiveTest');
const User = require('../models/User');

exports.createQuestion = async (req, res) => {
    try {
        const {
            question,
            options,
            correctOption,
            difficulty,
            estimatedTime,
            positiveMarks,
            negativeMarks,
            solution,
        } = req.body;
        const testId = req.params.testId;

        // Validate required fields
        if (!question || !options || !Array.isArray(options) || options.length < 2) {
            return res.status(400).json({
                success: false,
                message: "Question and at least 2 options are required"
            });
        }

        if (correctOption === undefined || correctOption < 0 || correctOption >= options.length) {
            return res.status(400).json({
                success: false,
                message: "Valid correct option index is required"
            });
        }

        if (!testId) {
            return res.status(400).json({
                success: false,
                message: "Test ID is required"
            });
        }

        // Validate client
        const clientId = req.user.userId;
        const client = await User.findOne({ userId: clientId });
        if (!client) {
            return res.status(404).json({
                success: false,
                message: "Client not found"
            });
        }

        // Validate test exists
        const test = await ObjectiveTest.findById(testId);
        if (!test) {
            return res.status(404).json({
                success: false,
                message: "Test not found"
            });
        }

        // Create question data
        const questionData = {
            question: question.trim(),
            options: options.filter(opt => opt && opt.trim()).map(opt => opt.trim()),
            correctAnswer: correctOption,
            difficulty: difficulty || 'L1',
            estimatedTime: estimatedTime || 1,
            positiveMarks: positiveMarks || 1,
            negativeMarks: negativeMarks || 0,
            test: testId,
            createdBy: req.user.id
        };

        // Handle solution if provided
        if (solution) {
            questionData.solution = {
                type: solution.type || 'text',
                text: solution.text || "",
                video: {
                    url: solution.video?.url || "",
                    title: solution.video?.title || "",
                    description: solution.video?.description || "",
                    duration: solution.video?.duration || 0
                },
                image: {
                    url: solution.image?.url || "",
                    caption: solution.image?.caption || ""
                }
            };
        }

        // Create the question
        const newQuestion = new ObjectiveTestQuestion(questionData);
        const savedQuestion = await newQuestion.save();

        // If testId provided, add question to test
        if (testId) {
            await ObjectiveTest.findByIdAndUpdate(
              testId,
              { $push: { questions: savedQuestion._id } }
            );
          }
        // Populate the test reference for response
        await savedQuestion.populate('test', 'name');

        res.status(201).json({
            success: true,
            message: "Question created successfully",
            question: savedQuestion
        });

    } catch (error) {
        console.error('Error creating question:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all questions for a specific test
exports.getQuestionsByTest = async (req, res) => {
    try {
        const clientId = req.user.userId;
        const client = await User.findOne({userId:clientId});
        if(!client){
            return res.status(404).json({
                success:false,
                message:"client not found"
            })  
        }
        const { testId } = req.params;
        const { difficulty, page = 1, limit = 150 } = req.query;

        // Validate test exists
        const test = await ObjectiveTest.findById(testId);
        if (!test) {
            return res.status(404).json({
                success: false,
                message: "Test not found"
            });
        }

        // Build query
        const query = { test: testId, isActive: true };
        if (difficulty) {
            query.difficulty = difficulty;
        }

        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Get questions with pagination
        const questions = await ObjectiveTestQuestion.find(query)
            .populate('test', 'name description imageUrl category subcategory instructions Estimated_time isActive createdAt updatedAt')
            .skip(skip)
            .limit(parseInt(limit));

        // Get total count
        const totalQuestions = await ObjectiveTestQuestion.countDocuments(query);

        res.json({
            success: true,
            questions,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalQuestions / parseInt(limit)),
                totalQuestions,
                hasNextPage: skip + questions.length < totalQuestions,
                hasPrevPage: parseInt(page) > 1
            }
        });

    } catch (error) {
        console.error('Error fetching questions:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all questions for a specific test
exports.getQuestionsByTestForMobile = async (req, res) => {
    try {
        const clientId = req.clientId;
        console.log(clientId);
        const client = await User.findOne({userId:clientId});
        if(!client){
            return res.status(404).json({
                success:false,
                message:"client not found"
            })  
        }
        const { testId } = req.params;
        const { difficulty, page = 1, limit = 150 } = req.query;

        // Validate test exists
        const test = await ObjectiveTest.findById(testId);
        if (!test) {
            return res.status(404).json({
                success: false,
                message: "Test not found"
            });
        }

        const name = test.name;
        const totalTime = test.Estimated_time;

        // Build query
        const query = { test: testId, isActive: true };
        if (difficulty) {
            query.difficulty = difficulty;
        }

        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Get questions with pagination
        const questions = await ObjectiveTestQuestion.find(query)
            .populate('test', 'name')
            .skip(skip)
            .limit(parseInt(limit));

        // Get total count
        const totalQuestions = await ObjectiveTestQuestion.countDocuments(query);

        res.json({
            success: true,
            test:{
            name:name,
            totalTime:totalTime
            },
            questions,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalQuestions / parseInt(limit)),
                totalQuestions,
                hasNextPage: skip + questions.length < totalQuestions,
                hasPrevPage: parseInt(page) > 1
            }
        });

    } catch (error) {
        console.error('Error fetching questions:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get a specific question by ID
exports.getQuestionById = async (req, res) => {
    try {
        const { questionId } = req.params;

        const question = await ObjectiveTestQuestion.findById(questionId)
            .populate('test', 'name');

        if (!question) {
            return res.status(404).json({
                success: false,
                message: "Question not found"
            });
        }

        res.json({
            success: true,
            question
        });

    } catch (error) {
        console.error('Error fetching question:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update a question
exports.updateQuestion = async (req, res) => {
    try {
        const { questionId } = req.params;
        const {
            question,
            options,
            correctOption,
            difficulty,
            estimatedTime,
            positiveMarks,
            negativeMarks,
            solution
        } = req.body;

        // Find the question
        const existingQuestion = await ObjectiveTestQuestion.findById(questionId);
        if (!existingQuestion) {
            return res.status(404).json({
                success: false,
                message: "Question not found"
            });
        }

        // Validate options if provided
        if (options && (!Array.isArray(options) || options.length < 2)) {
            return res.status(400).json({
                success: false,
                message: "At least 2 options are required"
            });
        }

        if (correctOption !== undefined && (correctOption < 0 || correctOption >= (options || existingQuestion.options).length)) {
            return res.status(400).json({
                success: false,
                message: "Valid correct option index is required"
            });
        }

        // Prepare update data
        const updateData = {};
        if (question) updateData.question = question.trim();
        if (options) updateData.options = options.filter(opt => opt && opt.trim()).map(opt => opt.trim());
        if (correctOption !== undefined) updateData.correctAnswer = correctOption;
        if (difficulty) updateData.difficulty = difficulty;
        if (estimatedTime !== undefined) updateData.estimatedTime = estimatedTime;
        if (positiveMarks !== undefined) updateData.positiveMarks = positiveMarks;
        if (negativeMarks !== undefined) updateData.negativeMarks = negativeMarks;

        // Handle solution update
        if (solution) {
            updateData.solution = {
                type: solution.type || existingQuestion.solution.type || 'text',
                text: solution.text || existingQuestion.solution.text || "",
                video: {
                    url: solution.video?.url || existingQuestion.solution.video?.url || "",
                    title: solution.video?.title || existingQuestion.solution.video?.title || "",
                    description: solution.video?.description || existingQuestion.solution.video?.description || "",
                    duration: solution.video?.duration || existingQuestion.solution.video?.duration || 0
                },
                image: {
                    url: solution.image?.url || existingQuestion.solution.image?.url || "",
                    caption: solution.image?.caption || existingQuestion.solution.image?.caption || ""
                }
            };
        }

        // Update the question
        const updatedQuestion = await ObjectiveTestQuestion.findByIdAndUpdate(
            questionId,
            updateData,
            { new: true, runValidators: true }
        ).populate('test', 'name');

        res.json({
            success: true,
            message: "Question updated successfully",
            question: updatedQuestion
        });

    } catch (error) {
        console.error('Error updating question:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete a question
exports.deleteQuestion = async (req, res) => {
    try {
        const { questionId } = req.params;

        const question = await ObjectiveTestQuestion.findById(questionId);
        if (!question) {
            return res.status(404).json({
                success: false,
                message: "Question not found"
            });
        }

        // Soft delete by setting isActive to false
        await ObjectiveTestQuestion.findByIdAndUpdate(questionId, { isActive: false });

        // Remove question from any sets
      await ObjectiveTest.updateMany(
        { questions: questionId },
        { $pull: { questions: questionId } }
      );

        res.json({
            success: true,
            message: "Question deleted successfully"
        });

    } catch (error) {
        console.error('Error deleting question:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Record answer attempt
exports.recordAnswer = async (req, res) => {
    try {
        const { questionId } = req.params;
        const { selectedAnswer } = req.body;

        const question = await ObjectiveTestQuestion.findById(questionId);
        if (!question) {
            return res.status(404).json({
                success: false,
                message: "Question not found"
            });
        }

        const isCorrect = selectedAnswer === question.correctAnswer;
        await question.recordAnswer(isCorrect);

        res.json({
            success: true,
            isCorrect,
            correctAnswer: question.correctAnswer,
            stats: {
                timesAnswered: question.timesAnswered,
                timesCorrect: question.timesCorrect,
                accuracyPercentage: question.accuracyPercentage
            }
        });

    } catch (error) {
        console.error('Error recording answer:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
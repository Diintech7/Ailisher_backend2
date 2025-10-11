// middleware/withdrawalValidation.js
const Evaluator = require('../models/Evaluator');
const EvaluatorWithdrawalRequest = require('../models/EvaluatorWithdrawalRequest');

// Validate withdrawal request before submission
const validateWithdrawalRequest = async (req, res, next) => {
  try {
    const { amount } = req.body;
    const evaluatorId = req.evaluator._id;

    // Validate amount
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    // Check evaluator exists and is active
    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }

    // Check if evaluator can withdraw
    const eligibility = evaluator.getWithdrawalEligibility();
    if (!eligibility.canWithdraw) {
      return res.status(400).json({
        success: false,
        message: 'Withdrawal not eligible',
        reasons: eligibility.reasons
      });
    }

    // Validate withdrawal amount
    const amountValidation = evaluator.validateWithdrawalAmount(amount);
    if (!amountValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid withdrawal amount',
        errors: amountValidation.errors
      });
    }

    // Check for pending withdrawal requests
    const pendingRequest = await EvaluatorWithdrawalRequest.findOne({
      evaluatorId,
      status: { $in: ['pending', 'approved'] }
    });

    if (pendingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending withdrawal request',
        existingRequest: {
          id: pendingRequest._id,
          amount: pendingRequest.amount,
          status: pendingRequest.status,
          createdAt: pendingRequest.createdAt
        }
      });
    }

    req.evaluator = evaluator;
    next();
  } catch (error) {
    console.error('Withdrawal validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Validation error',
      error: error.message
    });
  }
};

// Validate admin withdrawal action
const validateAdminWithdrawalAction = async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const action = req.path.split('/').pop(); // approve, reject, process

    const request = await EvaluatorWithdrawalRequest.findById(requestId)
      .populate('evaluatorId');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Withdrawal request not found'
      });
    }

    // Validate action based on current status
    if (action === 'approve' && request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending requests can be approved'
      });
    }

    if (action === 'reject' && request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending requests can be rejected'
      });
    }

    if (action === 'process' && request.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Only approved requests can be processed'
      });
    }

    // For processing, check if evaluator has sufficient balance
    if (action === 'process') {
      const evaluator = request.evaluatorId;
      if (evaluator.creditBalance < request.amount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient evaluator balance',
          currentBalance: evaluator.creditBalance,
          requestedAmount: request.amount
        });
      }
    }

    req.withdrawalRequest = request;
    next();
  } catch (error) {
    console.error('Admin withdrawal validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Validation error',
      error: error.message
    });
  }
};

// Validate credit adjustment
const validateCreditAdjustment = async (req, res, next) => {
  try {
    const { amount, reason } = req.body;
    const { evaluatorId } = req.params;

    if (!amount || isNaN(amount)) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required'
      });
    }

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Reason must be at least 5 characters long'
      });
    }

    // Check if evaluator exists
    const evaluator = await Evaluator.findById(evaluatorId);
    if (!evaluator) {
      return res.status(404).json({
        success: false,
        message: 'Evaluator not found'
      });
    }

    // Check if adjustment would result in negative balance
    if (amount < 0 && Math.abs(amount) > evaluator.creditBalance) {
      return res.status(400).json({
        success: false,
        message: 'Adjustment would result in negative balance',
        currentBalance: evaluator.creditBalance,
        adjustmentAmount: amount
      });
    }

    req.evaluator = evaluator;
    next();
  } catch (error) {
    console.error('Credit adjustment validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Validation error',
      error: error.message
    });
  }
};

module.exports = {
  validateWithdrawalRequest,
  validateAdminWithdrawalAction,
  validateCreditAdjustment
};








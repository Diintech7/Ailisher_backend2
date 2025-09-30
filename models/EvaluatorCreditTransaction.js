const mongoose = require('mongoose');

const evaluatorCreditTransactionSchema = new mongoose.Schema(
  {
    evaluatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Evaluator",
      required: true,
    },
    type: {
      type: String,
      enum: ["earned", "withdrawn", "admin_adjustment", "bonus"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceBefore: {
      type: Number,
      required: true,
    },
    balanceAfter: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      enum: [
        "evaluation_completion",
        "withdrawal",
        "admin_bonus",
        "penalty",
        "other",
      ],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    evaluationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Evaluation",
      default: null,
    },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserAnswer",
      default: null,
    },
    withdrawalRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EvaluatorWithdrawalRequest",
      default: null,
    },
    status: {
      type: String,
      enum: ["completed", "pending", "failed", "cancelled"],
      default: "completed",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('EvaluatorCreditTransaction', evaluatorCreditTransactionSchema);

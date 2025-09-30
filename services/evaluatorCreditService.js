// services/evaluatorCreditService.js
const Evaluator = require("../models/Evaluator");
const EvaluatorCreditTransaction = require("../models/EvaluatorCreditTransaction");
const EvaluatorWithdrawalRequest = require("../models/EvaluatorWithdrawalRequest");

const EvaluatorCreditService = {
    // Award credit for evaluation completion
    awardCreditForEvaluation: async (evaluatorId, evaluationId, answerId, credits = 5) => {
      try {
        const evaluator = await Evaluator.findById(evaluatorId);
        if (!evaluator) {
          console.error(`❌ [CREDIT SERVICE] Evaluator not found with ID: ${evaluatorId}`);
          throw new Error('Evaluator not found');
        }

        const balanceBefore = evaluator.creditBalance;
        const balanceAfter = balanceBefore + credits;

        // Update evaluator credits
        evaluator.creditBalance = balanceAfter;
        evaluator.totalCreditsEarned += credits;
        evaluator.lastCreditActivity = new Date();
        
        await evaluator.save();

        // Create transaction record
        const transaction = new EvaluatorCreditTransaction({
          evaluatorId,
          type: 'earned',
          amount: credits,
          balanceBefore,
          balanceAfter,
          category: 'evaluation_completion',
          description: `Credit earned for completing evaluation (${credits} credits)`,
          evaluationId,
          submissionId: answerId
        });
        
        await transaction.save();

        return { evaluator, transaction };
      } catch (error) {
        console.error(`Error in awardCreditForEvaluation:`, error);
        throw error;
      }
    },
};

module.exports = EvaluatorCreditService;
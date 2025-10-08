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

        // Check if evaluator is active
        if (evaluator.creditStatus !== 'active') {
          console.warn(`⚠️ [CREDIT SERVICE] Evaluator ${evaluatorId} is not active, skipping credit award`);
          return { evaluator, transaction: null };
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
          submissionId: answerId,
          status: 'completed'
        });
        
        await transaction.save();

        console.log(`✅ [CREDIT SERVICE] Awarded ${credits} credits to evaluator ${evaluatorId}. New balance: ${balanceAfter}`);
        return { evaluator, transaction };
      } catch (error) {
        console.error(`❌ [CREDIT SERVICE] Error in awardCreditForEvaluation:`, error);
        throw error;
      }
    },

    // Get evaluator credit summary
    getEvaluatorCreditSummary: async (evaluatorId) => {
      try {
        const evaluator = await Evaluator.findById(evaluatorId);
        if (!evaluator) {
          throw new Error('Evaluator not found');
        }

        const transactions = await EvaluatorCreditTransaction.find({ evaluatorId })
          .sort({ createdAt: -1 })
          .limit(10);

        const withdrawalRequests = await EvaluatorWithdrawalRequest.find({ evaluatorId })
          .sort({ createdAt: -1 })
          .limit(5);

        return {
          evaluator: {
            creditBalance: evaluator.creditBalance,
            totalCreditsEarned: evaluator.totalCreditsEarned,
            totalCreditsWithdrawn: evaluator.totalCreditsWithdrawn,
            lastCreditActivity: evaluator.lastCreditActivity,
            creditStatus: evaluator.creditStatus,
            withdrawalEligibility: evaluator.getWithdrawalEligibility()
          },
          recentTransactions: transactions,
          recentWithdrawals: withdrawalRequests
        };
      } catch (error) {
        console.error(`❌ [CREDIT SERVICE] Error in getEvaluatorCreditSummary:`, error);
        throw error;
      }
    },

    // Admin credit adjustment
    adjustCredits: async (evaluatorId, amount, reason, adminId) => {
      try {
        const evaluator = await Evaluator.findById(evaluatorId);
        if (!evaluator) {
          throw new Error('Evaluator not found');
        }

        const balanceBefore = evaluator.creditBalance;
        const balanceAfter = balanceBefore + amount;

        // Update evaluator credits
        evaluator.creditBalance = balanceAfter;
        if (amount > 0) {
          evaluator.totalCreditsEarned += amount;
        } else {
          evaluator.totalCreditsWithdrawn += Math.abs(amount);
        }
        evaluator.lastCreditActivity = new Date();
        
        await evaluator.save();

        // Create transaction record
        const transaction = new EvaluatorCreditTransaction({
          evaluatorId,
          type: amount > 0 ? 'admin_adjustment' : 'admin_adjustment',
          amount: Math.abs(amount),
          balanceBefore,
          balanceAfter,
          category: 'admin_bonus',
          description: `Admin adjustment: ${reason}`,
          status: 'completed',
          metadata: { adminId, reason }
        });
        
        await transaction.save();

        console.log(`✅ [CREDIT SERVICE] Admin adjusted ${amount} credits for evaluator ${evaluatorId}. New balance: ${balanceAfter}`);
        return { evaluator, transaction };
      } catch (error) {
        console.error(`❌ [CREDIT SERVICE] Error in adjustCredits:`, error);
        throw error;
      }
    }
};

module.exports = EvaluatorCreditService;
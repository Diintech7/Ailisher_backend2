const CreditAccount = require("../models/CreditAccount");
const CreditPlan = require("../models/CreditPlan");
const CreditRechargePlan = require("../models/CreditRechargePlan");
const CreditTransaction = require("../models/CreditTransaction");

exports.getCreditAccount = async (req, res) => {
  try {
    const creditAccount = await CreditAccount.findOne({ userId: req.user.id })
    .populate({
      path: 'userId', 
      model: 'UserProfile',
      localField: 'userId',        
      foreignField: 'userId',      
      justOne: true,
      select: 'name -_id'             
    });
    res.json({
      success: true,
      data: creditAccount
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

exports.getCreditPlans = async (req, res) => {
  try {
    const plans = await CreditPlan.find({ isActive: true }).sort({ sortOrder: 1 });
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

// Add this new function
exports.buyCredits = async (req, res) => {
  try {
    const { planId } = req.body;
    
    // Get the plan details
    const plan = await CreditPlan.findById(planId);
    
    if (!plan || !plan.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    // Get or create user's credit account
    let creditAccount = await CreditAccount.findOne({ userId: req.user.id });
    
    if (!creditAccount) {
      creditAccount = new CreditAccount({
        userId: req.user.id,
        balance: 0,
        totalEarned: 0,
        totalSpent: 0
      });
    }

    // Simulate payment success (replace with real payment gateway)
    const paymentSuccess = true;

    if (paymentSuccess) {
      const balanceBefore = creditAccount.balance;
      const balanceAfter = balanceBefore + plan.credits;

      // Update credit account
      creditAccount.balance = balanceAfter;
      creditAccount.totalEarned += plan.credits;
      creditAccount.lastTransactionDate = new Date();
      await creditAccount.save();

      // Create transaction record
      const transaction = new CreditTransaction({
        userId: req.user.id,
        type: 'credit',
        amount: plan.credits,
        balanceBefore,
        balanceAfter,
        category: 'purchase',
        description: `Purchased ${plan.credits} credits via ${plan.name}`,
        planId: planId,
        paymentAmount: plan.price,
        paymentCurrency: plan.currency
      });

      await transaction.save();

      res.json({
        success: true,
        message: 'Credits purchased successfully',
        data: {
          creditsAdded: plan.credits,
          newBalance: creditAccount.balance,
          plan: plan
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment failed'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

exports.getCreditTransactions = async (req, res) => {
  try {
    const transactions = await CreditTransaction.find({ userId: req.user.id });
    res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

exports.getCredit = async (req, res) => {
    try {
        const creditAccount = await CreditAccount.findOne({userId: req.user.id });
        res.json({
            success: true,
            data: creditAccount
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

exports.getCreditBalance = async (req, res) => {
    try {
        const creditId = req.params.creditId;
        const creditAccount = await CreditAccount.findOne({ _id:creditId,userId: req.user.id });
        res.json({
            success: true,
            data: creditAccount.balance
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

// In your creditManagement.js controller
exports.useCreditsForService = async (req, res) => {
    try {
        const { amount, serviceName, planId } = req.body;
        
        // Get the plan to check features
        const plan = await CreditPlan.findById(planId);
        
        if (!plan) {
            return res.status(400).json({
                success: false,
                message: 'Invalid plan'
            });
        }

        // Check if service is available in plan features
        const isServiceAvailable = plan.features.includes(serviceName);
        
        if (!isServiceAvailable) {
            return res.status(400).json({
                success: false,
                message: `Service "${serviceName}" is not available in your current plan. Available services: ${plan.features.join(', ')}`
            });
        }

        // Get user's credit account
        let creditAccount = await CreditAccount.findOne({ userId: req.user.id });
        
        if (!creditAccount) {
            return res.status(400).json({
                success: false,
                message: 'Credit account not found'
            });
        }

        // Check if user has sufficient credits
        if (creditAccount.balance < amount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient credits'
            });
        }

        // Calculate new balance
        const balanceBefore = creditAccount.balance;
        const balanceAfter = balanceBefore - amount;

        // Update CreditAccount
        creditAccount.balance = balanceAfter;
        creditAccount.totalSpent += amount;
        creditAccount.lastTransactionDate = new Date();
        await creditAccount.save();

        // Create CreditTransaction record
        const transaction = await CreditTransaction.create({
            userId: req.user.id,
            type: 'debit',
            amount: amount,
            balanceBefore: balanceBefore,
            balanceAfter: balanceAfter,
            category: 'service_usage',
            description: `Used credits for ${serviceName}`,
            planId: planId,
            status: 'completed',
            createdAt: new Date()
        });

        res.json({
            success: true,
            message: 'Credits used successfully',
            data: {
                creditsUsed: amount,
                newBalance: balanceAfter,
                serviceName: serviceName,
                planName: plan.name,
                transactionId: transaction._id,
                transactionDate: transaction.createdAt
            }
        });

    } catch (error) {
        console.error('Error using credits:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

exports.getCreditRechargePlans = async (req,res) => {
  try {
    const clientId = req.user.clientId
    const plans = await CreditRechargePlan.find({clientId:clientId}).populate('items');

    res.json({
      success : true,
      data : plans
    })
  } 
  catch (error) {
    res.status(500).json({
      success : false,
      message : error.message
    })
  }
}
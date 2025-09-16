const { default: mongoose } = require("mongoose");
const Book = require("../models/Book");
const CreditAccount = require("../models/CreditAccount");
const CreditPlan = require("../models/CreditPlan");
const CreditRechargePlan = require("../models/CreditRechargePlan");
const CreditTransaction = require("../models/CreditTransaction");
const ObjectiveTest = require("../models/ObjectiveTest");
const Workbook = require("../models/Workbook");
const SubjectiveTest = require("../models/SubjectiveTest");
const { generateGetPresignedUrl } = require("../utils/s3");
const UserPlan = require("../models/UserPlan");

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


// Get plans that include items (bundled plans)
exports.getCreditRechargePlansWithItems = async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const plans = await CreditRechargePlan.find({
      clientId: clientId,
      items: { $exists: true, $ne: [] }
    }).populate('items');

    for(const plan of plans) {
      const isEnrolled = await UserPlan.findOne({
        userId: req.user.id,
        planId: plan._id,
        status: 'active'
      });
      plan.isEnrolled = isEnrolled ? true : false;
    }
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

// Get plans without items (credits-only plans)
exports.getCreditRechargePlansWithoutItems = async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const plans = await CreditRechargePlan.find({
      clientId: clientId,
      $or: [
        { items: { $exists: false } },
        { items: { $size: 0 } }
      ]
    })

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

exports.getCreditRechargePlanById = async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const plan = await CreditRechargePlan.findOne({ _id: req.params.id, clientId }).populate('items');
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }
    
    // Process plan items and fetch referenced item details
    if(plan.items && plan.items.length > 0) {
      for(const item of plan.items) {
        // Fetch referenced item details based on itemType and referenceId
        if(item.referenceId && item.itemType) {
          try {
            let referencedItem = null;
            
            // Convert referenceId to ObjectId
            item.referenceId = new mongoose.Types.ObjectId(item.referenceId);
            
            switch(item.itemType.toLowerCase()) {
              case 'book':
                referencedItem = await Book.findById(item.referenceId).select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                break;
              case 'workbook':
                referencedItem = await Workbook.findById(item.referenceId).select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                break;
              case 'objective-test':
                referencedItem = await ObjectiveTest.findById(item.referenceId).select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                break;
              case 'subjective-test':
                referencedItem = await SubjectiveTest.findById(item.referenceId).select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                break;
              default:
                console.log(`Unknown item type: ${item.itemType}`);
            }
            
            if(referencedItem) {
              // Generate image URL for referenced item
              if(referencedItem.coverImageKey) {
                  referencedItem.coverImageUrl = await generateGetPresignedUrl(referencedItem.coverImageKey);
                }else if(referencedItem.imageKey) {
                referencedItem.imageUrl = await generateGetPresignedUrl(referencedItem.imageKey);
              }else {
                console.log('No image key or URL found for item');
              }
              // Store the referenced item with image URLs
              item.referencedItem = {
                _id: referencedItem._id,
                title: referencedItem.title || referencedItem.name,
                description: referencedItem.description || referencedItem.summary,
                category: referencedItem.category || referencedItem.mainCategory,
                subCategory: referencedItem.subCategory || referencedItem.subcategory,
                coverImageUrl: referencedItem.coverImageUrl,
                imageUrl: referencedItem.imageUrl
              };
              // console.log('Referenced item:', item.referencedItem);
            }
          } catch(refError) {
            console.error(`Error fetching referenced item ${item.referenceId}:`, refError);
          }
        }
      }
    }
    
    // Add image URLs to the response for easy access
    const responseData = {
      ...plan.toObject(),
      items: plan.items.map(item => ({
        ...item.toObject(),
        referencedItem: item.referencedItem || null
      }))
    };

    res.json({ success: true, data: responseData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
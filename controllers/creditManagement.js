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
const Payment = require("../models/Payment");

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

exports.togglePlanEnabled = async (req, res) => {
  try {
    const { planId } = req.params;
    const { isEnabled } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, message: 'planId is required' });
    }

    if (typeof isEnabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'isEnabled must be a boolean' });
    }

    const updatedPlan = await CreditRechargePlan.findByIdAndUpdate(
      planId,
      { isEnabled: isEnabled, updatedAt: new Date() },
      { new: true }
    ).populate('items');

    if (!updatedPlan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    return res.json({ success: true, message: 'Plan isEnabled updated', data: updatedPlan });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
      console.log(plan.isEnrolled);
    
    // Process items for each plan and fetch referenced item details
    if (plan.items && plan.items.length > 0) {
      for (const item of plan.items) {
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
              // Store the referenced item with image URLs
              item.referencedItem = {
                category: referencedItem.category || referencedItem.mainCategory,
                subCategory: referencedItem.subCategory || referencedItem.subcategory,
              };
              console.log('Referenced item:', item.referencedItem);
            }
          } catch(refError) {
            console.error(`Error fetching referenced item ${item.referenceId}:`, refError);
          }
        }
      }
    }
  }
    res.json({
      success: true,
      data: plans.map(plan => ({
        ...plan.toObject(),
        isEnrolled: plan.isEnrolled,
        items: plan.items.map(item => ({
          ...item.toObject(),
          category: item.referencedItem ? item.referencedItem.category : null,
          subCategory: item.referencedItem ? item.referencedItem.subCategory : null
        }))
      }))
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
    console.log(plans);


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
    
    const isEnrolled = await UserPlan.findOne({
      userId: req.user.id,
      planId: plan._id,
      status: 'active'
    });
    plan.isEnrolled = isEnrolled ? true : false;
    console.log(plan.isEnrolled);
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
                coverImageUrl: referencedItem.coverImageUrl || referencedItem.imageUrl,
                // imageUrl: referencedItem.imageUrl
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
      isEnrolled: plan.isEnrolled,
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


exports.getOrdersForUser = async (req, res) => {
  try {
    const { status, planId, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    // Build query object
    const query = { userId: req.user.id };
    
    // Add status filter if provided
    if (status) {
      query.status = status;
    }
    
    // Add plan filter if provided
    if (planId) {
      query.planId = planId;
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    // Get orders with pagination
    const orders = await UserPlan.find(query)
      .populate({
        path: 'planId',
        select: 'name description price currency features items clientId'
      })
      .populate({
        path: 'userId',
        model: 'UserProfile',
        localField: 'userId',
        foreignField: 'userId',
        justOne: true,
        select: 'name age gender email'
      })
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const totalOrders = await UserPlan.countDocuments(query);
    
    // Get payment details for each order
    const ordersWithPayments = await Promise.all(
      orders.map(async (order) => {
        const payment = await Payment.findOne({ orderId: order.orderId });
        return {
          ...order.toObject(),
          payment: payment
        };
      })
    );
    
    // If plan has items, populate them with details
    if (orders.length > 0 && orders[0].planId && orders[0].planId.items && orders[0].planId.items.length > 0) {
      for (const order of ordersWithPayments) {
        if (order.planId && order.planId.items && order.planId.items.length > 0) {
          for (const item of order.planId.items) {
            if (item.referenceId && item.itemType) {
              try {
                let referencedItem = null;
                item.referenceId = new mongoose.Types.ObjectId(item.referenceId);
                
                switch (item.itemType.toLowerCase()) {
                  case 'book':
                    referencedItem = await Book.findById(item.referenceId)
                      .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                    break;
                  case 'workbook':
                    referencedItem = await Workbook.findById(item.referenceId)
                      .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                    break;
                  case 'objective-test':
                    referencedItem = await ObjectiveTest.findById(item.referenceId)
                      .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                    break;
                  case 'subjective-test':
                    referencedItem = await SubjectiveTest.findById(item.referenceId)
                      .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                    break;
                }
                
                if (referencedItem) {
                  if (referencedItem.coverImageKey) {
                    referencedItem.coverImageUrl = await generateGetPresignedUrl(referencedItem.coverImageKey);
                  } else if (referencedItem.imageKey) {
                    referencedItem.imageUrl = await generateGetPresignedUrl(referencedItem.imageKey);
                  }
                  
                  item.referencedItem = {
                    _id: referencedItem._id,
                    title: referencedItem.title || referencedItem.name,
                    description: referencedItem.description,
                    category: referencedItem.category || referencedItem.mainCategory,
                    subCategory: referencedItem.subCategory || referencedItem.subcategory,
                    coverImageUrl: referencedItem.coverImageUrl,
                    imageUrl: referencedItem.imageUrl
                  };
                }
              } catch (refError) {
                console.error(`Error fetching referenced item ${item.referenceId}:`, refError);
              }
            }
          }
        }
      }
    }
    
    // Get user's order statistics
    const orderStats = await UserPlan.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(req.user.id) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalCredits: { $sum: '$creditsGranted' }
        }
      }
    ]);
    
    res.json({ 
      success: true, 
      data: {
        orders: ordersWithPayments,
        orderStats: orderStats,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalOrders / parseInt(limit)),
          totalOrders: totalOrders,
          hasNextPage: skip + orders.length < totalOrders,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Enhanced function to get order details with all information
exports.getOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const order = await UserPlan.findOne({ 
      orderId: orderId,
      userId: req.user.id 
    })
    .populate({
      path: 'planId', // Populate plan details
      select: 'name description price currency features items'
    })
    .populate({
      path: 'userId',
      model: 'UserProfile',
      localField: 'userId',
      foreignField: 'userId',
      justOne: true,
      select: 'name age gender email'
    })
    .populate({
      path: 'userId',
      model: 'MobileUser',
      localField: 'userId',
      foreignField: '_id',
      justOne: true,
      select: 'mobile email name'
    });

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found' 
      });
    }

    // Get payment details for this order
    const payment = await Payment.findOne({ orderId: orderId });

    // If plan has items, populate them with details
    if (order.planId && order.planId.items && order.planId.items.length > 0) {
      for (const item of order.planId.items) {
        if (item.referenceId && item.itemType) {
          try {
            let referencedItem = null;
            item.referenceId = new mongoose.Types.ObjectId(item.referenceId);
            
            switch (item.itemType.toLowerCase()) {
              case 'book':
                referencedItem = await Book.findById(item.referenceId)
                  .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                break;
              case 'workbook':
                referencedItem = await Workbook.findById(item.referenceId)
                  .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                break;
              case 'objective-test':
                referencedItem = await ObjectiveTest.findById(item.referenceId)
                  .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                break;
              case 'subjective-test':
                referencedItem = await SubjectiveTest.findById(item.referenceId)
                  .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                break;
            }
            
            if (referencedItem) {
              // Generate image URLs
              if (referencedItem.coverImageKey) {
                referencedItem.coverImageUrl = await generateGetPresignedUrl(referencedItem.coverImageKey);
              } else if (referencedItem.imageKey) {
                referencedItem.imageUrl = await generateGetPresignedUrl(referencedItem.imageKey);
              }
              
              item.referencedItem = {
                _id: referencedItem._id,
                title: referencedItem.title || referencedItem.name,
                description: referencedItem.description,
                category: referencedItem.category || referencedItem.mainCategory,
                subCategory: referencedItem.subCategory || referencedItem.subcategory,
                coverImageUrl: referencedItem.coverImageUrl,
                imageUrl: referencedItem.imageUrl
              };
            }
          } catch (refError) {
            console.error(`Error fetching referenced item ${item.referenceId}:`, refError);
          }
        }
      }
    }

    res.json({ 
      success: true, 
      data: {
        order: order,
        payment: payment
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Function to get all orders for a specific plan
exports.getSucessOrdersByPlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;
    
    // Build query object
    const query = { planId: planId };
    
    // Add status filter if provided
    if (status) {
      query.status = status;
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get orders with pagination
    const orders = await UserPlan.find(query)
      .populate({
        path: 'planId',
        select: 'name description price currency features items'
      })
      .populate({
        path: 'userId',
        model: 'UserProfile',
        localField: 'userId',
        foreignField: 'userId',
        justOne: true,
        select: 'name age gender email'
      })
      // .populate({
      //   path: 'userId',
      //   model: 'MobileUser',
      //   localField: 'userId',
      //   foreignField: '_id',
      //   justOne: true,
      //   select: 'mobile email name'
      // })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const totalOrders = await UserPlan.countDocuments(query);
    
    // Get payment details for each order
    const ordersWithPayments = await Promise.all(
      orders.map(async (order) => {
        const payment = await Payment.findOne({ orderId: order.orderId });
        return {
          ...order.toObject(),
          payment: payment
        };
      })
    );
    
    // If plan has items, populate them with details
    if (orders.length > 0 && orders[0].planId && orders[0].planId.items && orders[0].planId.items.length > 0) {
      for (const order of ordersWithPayments) {
        if (order.planId && order.planId.items && order.planId.items.length > 0) {
          for (const item of order.planId.items) {
            if (item.referenceId && item.itemType) {
              try {
                let referencedItem = null;
                item.referenceId = new mongoose.Types.ObjectId(item.referenceId);
                
                switch (item.itemType.toLowerCase()) {
                  case 'book':
                    referencedItem = await Book.findById(item.referenceId)
                      .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                    break;
                  case 'workbook':
                    referencedItem = await Workbook.findById(item.referenceId)
                      .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                    break;
                  case 'objective-test':
                    referencedItem = await ObjectiveTest.findById(item.referenceId)
                      .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                    break;
                  case 'subjective-test':
                    referencedItem = await SubjectiveTest.findById(item.referenceId)
                      .select('title name description category mainCategory subCategory subcategory coverImageKey coverImageUrl imageKey imageUrl');
                    break;
                }
                
                if (referencedItem) {
                  if (referencedItem.coverImageKey) {
                    referencedItem.coverImageUrl = await generateGetPresignedUrl(referencedItem.coverImageKey);
                  } else if (referencedItem.imageKey) {
                    referencedItem.imageUrl = await generateGetPresignedUrl(referencedItem.imageKey);
                  }
                  
                  item.referencedItem = {
                    _id: referencedItem._id,
                    title: referencedItem.title || referencedItem.name,
                    description: referencedItem.description,
                    category: referencedItem.category || referencedItem.mainCategory,
                    subCategory: referencedItem.subCategory || referencedItem.subcategory,
                    coverImageUrl: referencedItem.coverImageUrl,
                    imageUrl: referencedItem.imageUrl
                  };
                }
              } catch (refError) {
                console.error(`Error fetching referenced item ${item.referenceId}:`, refError);
              }
            }
          }
        }
      }
    }
    
    res.json({ 
      success: true, 
      data: {
        orders: ordersWithPayments,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalOrders / parseInt(limit)),
          totalOrders: totalOrders,
          hasNextPage: skip + orders.length < totalOrders,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Function to get failed payments for a specific plan
exports.getFailedPaymentsByPlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const { page = 1, limit = 10, clientId } = req.query;
    
    // Build query for failed payments
    const query = { 
      planId: planId,
      status: 'FAILED'
    };
    
    // Add client filter if provided
    if (clientId) {
      query.clientId = clientId;
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get failed payments with pagination
    const payments = await Payment.find(query)
      .populate({
        path: 'planId',
        select: 'name description price currency features items clientId'
      })
      .populate({
        path: 'userId',
        model: 'UserProfile',
        localField: 'userId',
        foreignField: 'userId',
        justOne: true,
        select: 'name age gender email'
      })
      .populate({
        path: 'userId',
        model: 'MobileUser',
        localField: 'userId',
        foreignField: '_id',
        justOne: true,
        select: 'mobile email name'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const totalPayments = await Payment.countDocuments(query);
    
    // Get failed payment statistics
    const failedStats = await Payment.aggregate([
      { $match: { planId: new mongoose.Types.ObjectId(planId), status: 'FAILED' } },
      {
        $group: {
          _id: null,
          totalFailed: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: {
        payments: payments,
        statistics: failedStats[0] || { totalFailed: 0, totalAmount: 0, avgAmount: 0 },
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalPayments / parseInt(limit)),
          totalPayments: totalPayments,
          hasNextPage: skip + payments.length < totalPayments,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Function to get pending payments for a specific plan
exports.getPendingPaymentsByPlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const { page = 1, limit = 10, clientId } = req.query;
    
    // Build query for pending payments
    const query = { 
      planId: planId,
      status: 'PENDING'
    };
    
    // Add client filter if provided
    if (clientId) {
      query.clientId = clientId;
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get pending payments with pagination
    const payments = await Payment.find(query)
      .populate({
        path: 'planId',
        select: 'name description price currency features items clientId'
      })
      .populate({
        path: 'userId',
        model: 'UserProfile',
        localField: 'userId',
        foreignField: 'userId',
        justOne: true,
        select: 'name age gender email'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const totalPayments = await Payment.countDocuments(query);
    
    // Get pending payment statistics
    const pendingStats = await Payment.aggregate([
      { $match: { planId: new mongoose.Types.ObjectId(planId), status: 'PENDING' } },
      {
        $group: {
          _id: null,
          totalPending: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: {
        payments: payments,
        statistics: pendingStats[0] || { totalPending: 0, totalAmount: 0, avgAmount: 0 },
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalPayments / parseInt(limit)),
          totalPayments: totalPayments,
          hasNextPage: skip + payments.length < totalPayments,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Function to get payments by plan and status (combined function)
exports.getPaymentsByPlanAndStatus = async (req, res) => {
  try {
    const { planId, status } = req.params;
    const { page = 1, limit = 10, clientId } = req.query;
    
    // Validate status
    const validStatuses = ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'];
    if (!validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Valid statuses are: PENDING, SUCCESS, FAILED, CANCELLED'
      });
    }
    
    // Build query
    const query = { 
      planId: planId,
      status: status.toUpperCase()
    };
    
    // Add client filter if provided
    if (clientId) {
      query.clientId = clientId;
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get payments with pagination
    const payments = await Payment.find(query)
      .populate({
        path: 'planId',
        select: 'name description price currency features items clientId'
      })
      .populate({
        path: 'userId',
        model: 'UserProfile',
        localField: 'userId',
        foreignField: 'userId',
        justOne: true,
        select: 'name age gender email'
      })
      .populate({
        path: 'userId',
        model: 'MobileUser',
        localField: 'userId',
        foreignField: '_id',
        justOne: true,
        select: 'mobile email name'
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Get total count for pagination
    const totalPayments = await Payment.countDocuments(query);
    
    // Get payment statistics for this status
    const paymentStats = await Payment.aggregate([
      { $match: { planId: new mongoose.Types.ObjectId(planId), status: status.toUpperCase() } },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' },
          minAmount: { $min: '$amount' },
          maxAmount: { $max: '$amount' }
        }
      }
    ]);
    
    // Get status breakdown for the plan
    const statusBreakdown = await Payment.aggregate([
      { $match: { planId: new mongoose.Types.ObjectId(planId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: {
        payments: payments,
        statistics: paymentStats[0] || { 
          totalPayments: 0, 
          totalAmount: 0, 
          avgAmount: 0, 
          minAmount: 0, 
          maxAmount: 0 
        },
        statusBreakdown: statusBreakdown,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalPayments / parseInt(limit)),
          totalPayments: totalPayments,
          hasNextPage: skip + payments.length < totalPayments,
          hasPrevPage: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Function to get all payment statuses for a plan (comprehensive overview)
exports.getPlanPaymentOverview = async (req, res) => {
  try {
    const { planId } = req.params;
    
    // Build base query
    const baseQuery = { planId: planId };
    
    // Get recent payments (last 50 to get better statistics)
    const recentPayments = await Payment.find(baseQuery)
      .populate({
        path: 'planId',
        select: 'name description price currency'
      })
      .populate({
        path: 'userId',
        model: 'UserProfile',
        localField: 'userId',
        foreignField: 'userId',
        justOne: true,
        select: 'name email'
      })
      .sort({ createdAt: -1 })
    
    // Calculate statistics from recentPayments
    const paymentOverview = [];
    const statusCounts = {};
    const statusAmounts = {};
    
    recentPayments.forEach(payment => {
      const status = payment.status;
      if (!statusCounts[status]) {
        statusCounts[status] = 0;
        statusAmounts[status] = 0;
      }
      statusCounts[status]++;
      statusAmounts[status] += payment.amount;
    });
    
    // Convert to overview format
    Object.keys(statusCounts).forEach(status => {
      paymentOverview.push({
        _id: status,
        count: statusCounts[status],
        totalAmount: statusAmounts[status],
        avgAmount: statusAmounts[status] / statusCounts[status]
      });
    });
    
    // Sort by count descending
    paymentOverview.sort((a, b) => b.count - a.count);
    
    // Calculate total statistics
    const totalPayments = recentPayments.length;
    const totalAmount = recentPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const successCount = recentPayments.filter(payment => payment.status === 'SUCCESS').length;
    const successRate = totalPayments > 0 ? successCount / totalPayments : 0;
    
    const totalStats = {
      totalPayments,
      totalAmount,
      successRate
    };
    
    res.json({
      success: true,
      data: {
        overview: paymentOverview,
        recentPayments: recentPayments, // Return only first 10 for display
        totalStats
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.togglePlanStatus = async (req, res) => {
  try {
    const { planId } = req.params;
    const { status } = req.body;
    if (!planId) {
      return res.status(400).json({ success: false, message: 'planId is required' });
    }

    if (!status || !['active', 'inactive'].includes(String(status).toLowerCase())) {
      return res.status(400).json({ success: false, message: "Invalid status. Use 'active' or 'inactive'" });
    }

    const updatedPlan = await CreditRechargePlan.findByIdAndUpdate(
      planId,
      { status: String(status).toLowerCase(), updatedAt: new Date() },
      { new: true }
    ).populate('items');

    if (!updatedPlan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    return res.json({ success: true, message: 'Plan status updated', data: updatedPlan });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

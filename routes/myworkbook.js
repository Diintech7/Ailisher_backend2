const express = require('express');
const router = express.Router();
const MyWorkbook = require('../models/MyWorkbook');
const Workbook = require('../models/Workbook');
const { authenticateMobileUser, ensureUserBelongsToClient } = require('../middleware/mobileAuth');
const { generateGetPresignedUrl } = require('../utils/s3');
const UserPlan = require('../models/UserPlan');

// Apply authentication middleware to all routes
router.use(authenticateMobileUser);
router.use(ensureUserBelongsToClient);

// 1. Add Workbook to My Workbooks
// POST /api/clients/:clientId/mobile/myworkbook/add
router.post('/add', async (req, res) => {
  try {
    const { workbook_id } = req.body;
    const userId = req.user.id;
    const clientId = req.user.clientId;

    // Validate required fields
    if (!workbook_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters.',
        error: {
          code: 'MISSING_PARAMETERS',
          details: 'workbook_id is required'
        }
      });
    }

    // Validate workbook_id format (MongoDB ObjectId)
    if (!workbook_id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid workbook ID format.',
        error: {
          code: 'INVALID_WORKBOOK_ID',
          details: 'workbook_id must be a valid MongoDB ObjectId'
        }
      });
    }

    // Check if workbook exists and belongs to the same client
    const workbook = await Workbook.findOne({ 
      _id: workbook_id, 
      clientId: clientId 
    });

    if (!workbook) {
      return res.status(404).json({
        success: false,
        message: 'Workbook not found or does not belong to your client.',
        error: {
          code: 'WORKBOOK_NOT_FOUND',
          details: `Workbook with ID ${workbook_id} not found for client ${clientId}`
        }
      });
    }

    // Check if workbook is already in My Workbooks
    const existingMyWorkbook = await MyWorkbook.findOne({
      userId: userId,
      workbookId: workbook_id
    });

    if (existingMyWorkbook) {
      return res.status(200).json({
        success: true,
        message: 'Workbook is already in your My Workbooks collection.',
        error: {
          code: 'WORKBOOK_ALREADY_ADDED',
          details: `Workbook with ID ${workbook_id} is already in your My Workbooks collection`
        }
      });
    }

    // Add workbook to My Workbooks
    const myWorkbook = new MyWorkbook({
      userId: userId,
      workbookId: workbook_id,
      clientId: clientId
    });

    await myWorkbook.save();
    console.log(myWorkbook);

    // Populate workbook details for response
    await myWorkbook.populate({
      path: 'workbookId',
      select: 'title author publisher description coverImage coverImageUrl rating ratingCount mainCategory subCategory exam paper subject tags viewCount createdAt'
    });

    console.log(`Workbook ${workbook_id} added to My Workbooks for user ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Workbook successfully added to My Workbooks.',
      data: {
        myWorkbookId: myWorkbook._id,
        workbookId: myWorkbook.workbookId._id,
        title: myWorkbook.workbookId.title,
        author: myWorkbook.workbookId.author,
        coverImage: myWorkbook.workbookId.coverImage,
        coverImageUrl: myWorkbook.workbookId.coverImageUrl,
        addedAt: myWorkbook.addedAt
      }
    });

  } catch (error) {
    console.error('Add to My Workbooks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while adding workbook to My Workbooks.',
      error: {
        code: 'SERVER_ERROR',
        details: error.message
      }
    });
  }
});

// 2. View My Workbooks List
// GET /api/clients/:clientId/mobile/myworkbook/list
router.get('/list', async (req, res) => {
  try {
    const userId = req.user.id;
    const clientId = req.user.clientId;

    // Populate workbook details
    const myWorkbooks = await MyWorkbook.find({ userId: userId, clientId: clientId })
      .populate({
        path: 'workbookId',
        select: 'title author publisher description coverImage coverImageUrl rating ratingCount mainCategory subCategory exam paper subject tags viewCount createdAt isPaid',
        populate: {
          path: 'user',
          select: 'name email userId'
        }
      });

    // Format response with plan details
    const formattedWorkbooks = await Promise.all(myWorkbooks.map(async myWorkbook => {
      // Check if workbook exists
      if (!myWorkbook.workbookId) {
        console.warn(`Workbook not found for MyWorkbook entry ${myWorkbook._id}`);
        return null;
      }

      let coverImageUrl = myWorkbook.workbookId.coverImageUrl || null;
      
      // Generate new presigned URL if we have a cover image
      if (myWorkbook.workbookId.coverImage) {
        try {
          coverImageUrl = await generateGetPresignedUrl(myWorkbook.workbookId.coverImage, 31536000); // 1 year expiry
          
          // Update the workbook with the new URL if it's different
          if (myWorkbook.workbookId.coverImageUrl !== coverImageUrl) {
            await Workbook.findByIdAndUpdate(myWorkbook.workbookId._id, { coverImageUrl });
          }
        } catch (error) {
          console.error('Error generating presigned URL for cover image:', error);
          coverImageUrl = null;
        }
      }

      // Get plan details for the workbook
      let planInfo = {
        isPaid: myWorkbook.workbookId.isPaid || false,
        planDetails: []
      };

      try {
        const PlanItem = require('../models/PlanItem');
        const CreditRechargePlan = require('../models/CreditRechargePlan');
        
        // Find plan items that reference this workbook
        const planItems = await PlanItem.find({
          itemType: { $in: ['workbook', 'workbooks'] },
          referenceId: myWorkbook.workbookId._id.toString(),
          clientId: clientId
        });
    
        if (planItems.length > 0) {
          // Get all plans that contain these plan items
          const plans = await CreditRechargePlan.find({
            items: { $in: planItems.map(item => item._id) },
            clientId: clientId,
            status: 'active'
          }).select('_id name description MRP offerPrice category duration status');
    
          // Determine if current user is enrolled in any of these plans
      let isEnrolled = false;
      try {
        const now = new Date();
        const enrolled = await UserPlan.findOne({
          userId: req.user?.id,
          clientId: clientId,
          planId: { $in: plans.map(plan => plan._id) },
          status: 'active',
          startDate: { $lte: now },
          endDate: { $gte: now }
        }).select('_id');
        isEnrolled = Boolean(enrolled);
      } catch (enrollErr) {
        console.error('Error checking enrollment for book:', enrollErr);
      }
          planInfo = {
            isPaid: true,
            isEnrolled,
            planDetails: plans.map(plan => ({
              id: plan._id,
              name: plan.name,
              description: plan.description,
              mrp: plan.MRP,
              offerPrice: plan.offerPrice,
              category: plan.category,
              duration: plan.duration,
              status: plan.status
            }))
          };
        }
      } catch (error) {
        console.error('Error fetching plan details for workbook:', error);
      }

      return {
        myworkbook_id: myWorkbook._id,
        workbook_id: myWorkbook.workbookId._id,
        title: myWorkbook.workbookId.title || '',
        author: myWorkbook.workbookId.author || '',
        publisher: myWorkbook.workbookId.publisher || '',
        description: myWorkbook.workbookId.description || '',
        cover_image: myWorkbook.workbookId.coverImage || '',
        cover_image_url: coverImageUrl || '',
        rating: myWorkbook.workbookId.rating || 0,
        rating_count: myWorkbook.workbookId.ratingCount || 0,
        main_category: myWorkbook.workbookId.mainCategory || '',
        sub_category: myWorkbook.workbookId.subCategory || '',
        exam: myWorkbook.workbookId.exam || '',
        paper: myWorkbook.workbookId.paper || '',
        subject: myWorkbook.workbookId.subject || '',
        tags: myWorkbook.workbookId.tags || [],
        view_count: myWorkbook.workbookId.viewCount || 0,
        added_at: myWorkbook.addedAt,
        last_accessed_at: myWorkbook.lastAccessedAt,
        personal_note: myWorkbook.personalNote || '',
        priority: myWorkbook.priority || 0,
        // Plan information
        isPaid: planInfo.isPaid,
        isEnrolled: planInfo.isEnrolled,
        planDetails: planInfo.planDetails
      };
    }));

    // Filter out any null entries (workbooks that weren't found)
    const validWorkbooks = formattedWorkbooks.filter(workbook => workbook !== null);

    console.log("myWorkbooks", validWorkbooks);
    res.status(200).json({
      success: true,
      message: 'My workbooks fetched successfully.',
      data: validWorkbooks
    });

  } 
  catch (error) {
    console.error('Error fetching my workbooks:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching my workbooks.',
    });
  }
});

// 3. Remove Workbook from My Workbooks
// POST /api/clients/:clientId/mobile/myworkbook/remove
router.post('/remove', async (req, res) => {
  try {
    const { workbook_id } = req.body;
    const userId = req.user.id;
    const clientId = req.user.clientId;

    // Validate required fields
    if (!workbook_id) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters.',
        error: {
          code: 'MISSING_PARAMETERS',
          details: 'workbook_id is required'
        }
      });
    }

    // Validate workbook_id format
    if (!workbook_id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid workbook ID format.',
        error: {
          code: 'INVALID_WORKBOOK_ID',
          details: 'workbook_id must be a valid MongoDB ObjectId'
        }
      });
    }

    // Find and remove the workbook from My Workbooks
    const removedMyWorkbook = await MyWorkbook.findOneAndDelete({
      userId: userId,
      workbookId: workbook_id
    }).populate({
      path: 'workbookId',
      select: 'title author coverImage'
    });

    if (!removedMyWorkbook) {
      return res.status(404).json({
        success: false,
        message: 'Workbook not found in your My Workbooks list.',
        error: {
          code: 'WORKBOOK_NOT_IN_MYWORKBOOKS',
          details: `Workbook with ID ${workbook_id} is not in your My Workbooks collection`
        }
      });
    }

    console.log(`Workbook ${workbook_id} removed from My Workbooks for user ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Workbook removed successfully from My Workbooks.',
      data: {
        removedWorkbookId: workbook_id,
        title: removedMyWorkbook.workbookId?.title || 'Unknown',
        author: removedMyWorkbook.workbookId?.author || 'Unknown',
        removedAt: new Date(),
      }
    });

  } catch (error) {
    console.error('Remove from My Workbooks error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while removing workbook from My Workbooks.',
      error: {
        code: 'SERVER_ERROR',
        details: error.message
      }
    });
  }
});


module.exports = router;
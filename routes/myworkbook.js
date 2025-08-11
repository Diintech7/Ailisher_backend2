const express = require('express');
const router = express.Router();
const MyWorkbook = require('../models/MyWorkbook');
const Workbook = require('../models/Workbook');
const { authenticateMobileUser, ensureUserBelongsToClient } = require('../middleware/mobileAuth');
const { generateGetPresignedUrl } = require('../utils/s3');

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

    const myWorkbooks = await MyWorkbook.find({ userId: userId, clientId: clientId });

    if(myWorkbooks.coverImageKey){
      myWorkbooks.coverImageUrl = await generateGetPresignedUrl(myWorkbooks.coverImageKey, 31536000);
    }

    console.log("myWorkbooks", myWorkbooks);
    res.status(200).json({
      success: true,
      message: 'My workbooks fetched successfully.',
      data: myWorkbooks
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
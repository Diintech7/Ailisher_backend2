// controllers/clientController.js - Updated Client controller with enhanced user ID handling
const CreditRechargePlan = require('../models/CreditRechargePlan');
const PlanItem = require('../models/PlanItem');
const User = require('../models/User');
const UserProfile = require('../models/UserProfile');
const Book = require('../models/Book');
const Workbook = require('../models/Workbook');
const Asset = require('../models/Asset');
const DatastoreItem = require('../models/DatastoreItem');
const SubjectiveTest = require('../models/SubjectiveTest');
const ObjectiveTest = require('../models/ObjectiveTest');
const { generateGetPresignedUrl } = require('../utils/s3');
const { default: mongoose } = require('mongoose');

// Get client dashboard data
exports.getDashboard = async (req, res) => {
  try {
    // Get statistics and data needed for client dashboard
    // This is a placeholder - implement actual dashboard data retrieval based on your requirements
    
    // Example: Get count of users managed by this client
    const userCount = await User.countDocuments({ managedBy: req.user._id });
    
    res.json({
      success: true,
      data: {
        userCount,
        // Add other relevant dashboard data
        recentActivity: [],
        performanceStats: {
          booksCreated: 5,
          activeUsers: 25,
          completionRate: 78
        }
      }
    });
  } catch (error) {
    console.error('Client dashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Create new client
exports.createClient = async (req, res) => {
  try {
    const {
      businessName,
      businessOwnerName,
      email,
      businessNumber,
      businessGSTNumber,
      businessPANNumber,
      businessMobileNumber,
      businessCategory,
      businessAddress,
      city,
      pinCode,
      businessLogo,
      businessWebsite,
      businessYoutubeChannel,
      turnOverRange
    } = req.body;

    // Validate required fields
    const requiredFields = {
      businessName,
      businessOwnerName,
      email,
      businessNumber,
      businessGSTNumber,
      businessPANNumber,
      businessMobileNumber,
      businessCategory,
      businessAddress,
      city,
      pinCode
    };

    for (const [field, value] of Object.entries(requiredFields)) {
      if (!value || !value.toString().trim()) {
        return res.status(400).json({ 
          success: false, 
          message: `${field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} is required` 
        });
      }
    }

    // Check if client already exists
    const existingClient = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingClient) {
      return res.status(400).json({ 
        success: false, 
        message: 'Client with this email already exists' 
      });
    }

    // Generate a secure temporary password
    const tempPassword = generateTempPassword();

    // Create new client
    const client = await User.create({
      name: businessOwnerName.trim(),
      email: email.toLowerCase().trim(),
      password: tempPassword,
      role: 'client',
      status: 'pending',
      businessName: businessName.trim(),
      businessOwnerName: businessOwnerName.trim(),
      businessNumber: businessNumber.trim(),
      businessGSTNumber: businessGSTNumber.trim(),
      businessPANNumber: businessPANNumber.trim(),
      businessMobileNumber: businessMobileNumber.trim(),
      businessCategory: businessCategory.trim(),
      businessAddress: businessAddress.trim(),
      city: city.trim(),
      pinCode: pinCode.trim(),
      businessLogo: businessLogo || null,
      businessWebsite: businessWebsite ? businessWebsite.trim() : null,
      businessYoutubeChannel: businessYoutubeChannel ? businessYoutubeChannel.trim() : null,
      turnOverRange: turnOverRange || null
    });

    // Ensure user ID is generated (fallback if pre-save hook fails)
    if (!client.userId) {
      await client.generateUserId();
    }

    console.log('Client created successfully:', {
      id: client._id,
      userId: client.userId,
      email: client.email,
      businessName: client.businessName
    });

    // Return client data with generated user ID
    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      client: {
        id: client._id,
        userId: client.userId,
        name: client.name,
        email: client.email,
        businessName: client.businessName,
        businessOwnerName: client.businessOwnerName,
        businessCategory: client.businessCategory,
        city: client.city,
        status: client.status,
        createdAt: client.createdAt,
        tempPassword: tempPassword // Only show once for setup
      }
    });
  } catch (error) {
    console.error('Create client error:', error);
    
    // Handle specific MongoDB errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ 
        success: false, 
        message: `${field === 'email' ? 'Email' : 'User ID'} already exists` 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Failed to create client. Please try again.' 
    });
  }
};

// Helper function to generate secure temporary password
function generateTempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const symbols = '!@#$%&*';
  let password = '';
  
  // Ensure at least one uppercase, one lowercase, one number, and one symbol
  password += chars.charAt(Math.floor(Math.random() * 25)); // Uppercase
  password += chars.charAt(Math.floor(Math.random() * 25) + 25); // Lowercase
  password += chars.charAt(Math.floor(Math.random() * 8) + 50); // Number
  password += symbols.charAt(Math.floor(Math.random() * symbols.length)); // Symbol
  
  // Fill the rest randomly
  for (let i = 4; i < 12; i++) {
    const allChars = chars + symbols;
    password += allChars.charAt(Math.floor(Math.random() * allChars.length));
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

// // Helper: Set isPaid flag on referenced content when added to a plan
// async function setReferencedItemPaid({ itemType, referenceId, clientId, isPaid = true }) {
//   if (!referenceId || !itemType) return;
//   const type = String(itemType).toLowerCase();
//   let Model = null;

//   if (['book', 'books'].includes(type)) Model = Book;
//   else if (['workbook', 'workbooks'].includes(type)) Model = Workbook;
//   else if (['subjectivetest', 'subjective_test', 'subjective-test'].includes(type)) Model = SubjectiveTest;
//   else if (['objectivetest', 'objective_test', 'objective-test'].includes(type)) Model = ObjectiveTest;

//   if (!Model) return;

//   try {
//     await Model.findOneAndUpdate(
//       { _id: referenceId, clientId },
//       { $set: { isPaid: !!isPaid } },
//       { new: false }
//     );
//   } catch (err) {
//     // Non-blocking: log and continue
//     console.error('Failed to update isPaid for plan item', { itemType, referenceId, clientId, err: err && err.message });
//   }
// }

// Get all clients
exports.getAllClients = async (req, res) => {
  try {
    const clients = await User.find({
      role: 'client',
      $or: [
        { organization: null },
        { organization: { $exists: false } }
      ]
    })
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: clients.length,
      clients
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

//get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('-password');
    res.status(200).json({ success: true, users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getuserprofile = async (req, res) => {
  try {
    const clientId = req.user.userId;
    console.log(clientId)
    const userProfiles = await UserProfile.find({ isComplete: true, clientId })
      .populate('userId', 'mobile isVerified lastLoginAt')
      .select('-__v')
      .sort({ createdAt: -1 });
    console.log(userProfiles)
    if (!userProfiles || userProfiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No user profiles found'
      });
    }

    return res.status(200).json({
      success: true,
      count: userProfiles.length,
      data: userProfiles
    });
  } catch (error) {
    console.error('Error fetching user profiles:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching user profiles',
      error: error.message
    });
  }
}

// Get client by ID
exports.getClientById = async (req, res) => {
  try {
    const client = await User.findById(req.params.id).select('-password');
    
    if (!client || client.role !== 'client') {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    res.json({
      success: true,
      client
    });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update client
exports.updateClient = async (req, res) => {
  try {
    const clientId = req.params.id;
    const updateData = { ...req.body };
    
    // Remove sensitive fields from update
    delete updateData.password;
    delete updateData.userId;
    delete updateData.role;
    
    const client = await User.findByIdAndUpdate(
      clientId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    res.json({
      success: true,
      message: 'Client updated successfully',
      client
    });
  } catch (error) {
    console.error('Update client error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Update client status
exports.updateClientStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['active', 'inactive', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    
    const client = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select('-password');
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    res.json({
      success: true,
      message: 'Client status updated successfully',
      client
    });
  } catch (error) {
    console.error('Update client status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// Delete client
exports.deleteClient = async (req, res) => {
  try {
    const client = await User.findById(req.params.id);
    
    if (!client || client.role !== 'client') {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }
    
    await User.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Client deleted successfully'
    });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.createCreditRechargePlan = async (req, res) => {
  try {
    const clientId  = req.user.userId;
    const {
      name,
      description,
      duration,
      credits,
      MRP,
      offerPrice,
      category,
      imageKey,
      videoKey,
      status,
      items = [] // [{ name, description, itemType, itemKey, referenceId, quantity, expiresWithPlan }]
    } = req.body;

    const createdItems = items.length
      ? await PlanItem.insertMany(items.map(it => ({ ...it, clientId })))
      : [];

    // // Mark referenced content as paid for each created item
    // if (createdItems.length) {
    //   await Promise.all(
    //     createdItems.map((it) => setReferencedItemPaid({ itemType: it.itemType, referenceId: it.referenceId, clientId, isPaid: true }))
    //   );
    // }

    const plan = await CreditRechargePlan.create({
      name,
      description,
      clientId,
      duration,
      credits,
      MRP,
      offerPrice,
      category,
      imageKey,
      videoKey,
      status,
      items: createdItems.map(i => i._id)
    });

    const populated = await plan.populate('items');

    res.json({
      success: true,
      message: 'Credit recharge plan created successfully',
      data: populated
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}   

exports.getCreditRechargePlans = async (req,res) => {
  try {
    const clientId = req.user.userId
    const plans = await CreditRechargePlan.find({clientId:clientId}).populate('items');
    
    // Process each plan and its items
    for(const plan of plans) {
      if(plan.items && plan.items.length > 0) {
        for(const item of plan.items) {
          // Fetch referenced item details based on itemType and referenceId
          if(item.referenceId && item.itemType) {
            try {
              let referencedItem = null;
              item.referenceId = new mongoose.Types.ObjectId(item.referenceId)
              switch(item.itemType.toLowerCase()) {
                case 'book':
                  referencedItem = await Book.findById(item.referenceId);
                  break;
                case 'workbook':
                  referencedItem = await Workbook.findById(item.referenceId);
                  break;
                case 'objective test':
                case 'objective-test':
                  referencedItem = await ObjectiveTest.findById(item.referenceId);
                  break;
                case 'subjective test':
                case 'subjective-test':
                  referencedItem = await SubjectiveTest.findById(item.referenceId);
                  break;
                default:
                  console.log(`Unknown item type: ${item.itemType}`);
              }
              
                if(referencedItem) {
                  console.log('Referenced item found:', {
                    name: referencedItem.name || referencedItem.title,
                    hasImageKey: !!referencedItem.imageKey,
                    hasCoverImageKey: !!referencedItem.coverImageKey,
                    hasImageUrl: !!referencedItem.imageUrl
                  });
                  
                  // Generate image URL for referenced item
                  if(referencedItem.coverImageKey) {
                    try {
                      referencedItem.coverImageUrl = await generateGetPresignedUrl(referencedItem.coverImageKey);
                      console.log('Generated cover image URL:', referencedItem.coverImageUrl);
                    } catch (imgError) {
                      console.error(`Error generating cover image URL:`, imgError);
                    }
                  } else if(referencedItem.imageKey) {
                    try {
                      referencedItem.imageUrl = await generateGetPresignedUrl(referencedItem.imageKey);
                      console.log('Generated image URL:', referencedItem.imageUrl);
                    } catch (imgError) {
                      console.error(`Error generating image URL:`, imgError);
                    }
                  } else if(referencedItem.imageUrl) {
                    console.log('Using existing image URL:', referencedItem.imageUrl);
                  } else {
                    console.log('No image key or URL found for item');
                  }
                  
                  // Store the referenced item with image URLs
                  item.referencedItem = {
                    _id: referencedItem._id,
                    title: referencedItem.title || referencedItem.name,
                    description: referencedItem.description || referencedItem.summary,
                    coverImageUrl: referencedItem.coverImageUrl,
                    imageUrl: referencedItem.imageUrl
                  };
                }
            } catch(refError) {
              console.error(`Error fetching referenced item ${item.referenceId}:`, refError);
            }
          }
          
          // Also handle direct image keys on the plan item itself
          if(item.imageKey) {
          item.imageUrl = await generateGetPresignedUrl(item.imageKey);
          } else if(item.coverImageKey) {
          item.coverImageUrl = await generateGetPresignedUrl(item.coverImageKey);
          }
        }
      }
    }
    
    // Add image URLs to the response for easy access
    const responseData = plans.map(plan => ({
      ...plan.toObject(),
      items: plan.items.map(item => ({
        ...item.toObject(),
        imageUrl: item.imageUrl || item.coverImageUrl || null,
        referencedItemImageUrl: item.referencedItem?.coverImageUrl || item.referencedItem?.imageUrl || null
      }))
    }));

    res.json({
      success : true,
      data : responseData
    })
  } 
  catch (error) {
    res.status(500).json({
      success : false,
      message : error.message
    })
  }
}

exports.getCreditRechargePlanById = async (req, res) => {
  try {
    const clientId = req.user.userId;
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
                referencedItem = await Book.findById(item.referenceId);
                break;
              case 'workbook':
                referencedItem = await Workbook.findById(item.referenceId);
                break;
              case 'objective test':
              case 'objective-test':
                referencedItem = await ObjectiveTest.findById(item.referenceId);
                break;
              case 'subjective test':
              case 'subjective-test':
                referencedItem = await SubjectiveTest.findById(item.referenceId);
                break;
              case 'asset':
                referencedItem = await Asset.findById(item.referenceId);
                break;
              case 'datastore':
              case 'datastoreitem':
                referencedItem = await DatastoreItem.findById(item.referenceId);
                break;
              default:
                console.log(`Unknown item type: ${item.itemType}`);
            }
            
            if(referencedItem) {
              console.log('Referenced item found:', {
                name: referencedItem.name || referencedItem.title,
                hasImageKey: !!referencedItem.imageKey,
                hasCoverImageKey: !!referencedItem.coverImageKey,
                hasImageUrl: !!referencedItem.imageUrl
              });
              
              // Generate image URL for referenced item
              if(referencedItem.coverImageKey) {
                try {
                  referencedItem.coverImageUrl = await generateGetPresignedUrl(referencedItem.coverImageKey);
                  console.log('Generated cover image URL:', referencedItem.coverImageUrl);
                } catch (imgError) {
                  console.error(`Error generating cover image URL:`, imgError);
                }
              } else if(referencedItem.imageKey) {
                try {
                  referencedItem.imageUrl = await generateGetPresignedUrl(referencedItem.imageKey);
                  console.log('Generated image URL:', referencedItem.imageUrl);
                } catch (imgError) {
                  console.error(`Error generating image URL:`, imgError);
                }
              } else if(referencedItem.imageUrl) {
                console.log('Using existing image URL:', referencedItem.imageUrl);
              } else {
                console.log('No image key or URL found for item');
              }
              
              // Store the referenced item with image URLs
              item.referencedItem = {
                _id: referencedItem._id,
                title: referencedItem.title || referencedItem.name,
                description: referencedItem.description || referencedItem.summary,
                coverImageUrl: referencedItem.coverImageUrl,
                imageUrl: referencedItem.imageUrl
              };
            }
          } catch(refError) {
            console.error(`Error fetching referenced item ${item.referenceId}:`, refError);
            // Continue processing other items even if one fails
          }
        }
        
        // Also handle direct image keys on the plan item itself
        if(item.imageKey) {
          item.imageUrl = await generateGetPresignedUrl(item.imageKey);
        } else if(item.coverImageKey) {
          item.coverImageUrl = await generateGetPresignedUrl(item.coverImageKey);
        }
      }
    }
    
    // Add image URLs to the response for easy access
    const responseData = {
      ...plan.toObject(),
      items: plan.items.map(item => ({
        ...item.toObject(),
        imageUrl: item.imageUrl || item.coverImageUrl || null,
        referencedItemImageUrl: item.referencedItem?.coverImageUrl || item.referencedItem?.imageUrl || null
      }))
    };

    res.json({ success: true, data: responseData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCreditRechargePlan = async (req, res) => {
  try {
    const clientId = req.user.userId;
    const planId = req.params.id;

    const updateFields = {
      name: req.body.name,
      description: req.body.description,
      duration: req.body.duration,
      credits: req.body.credits,
      MRP: req.body.MRP ?? req.body.mrp,
      offerPrice: req.body.offerPrice ?? req.body.offerprice,
      category: req.body.category,
      imageKey: req.body.imageKey,
      videoKey: req.body.videoKey,
      status: req.body.status
    };

    // Remove undefined fields so they are not overwritten
    Object.keys(updateFields).forEach((k) => updateFields[k] === undefined && delete updateFields[k]);

    const itemsPayload = Array.isArray(req.body.items) ? req.body.items : null;

    const plan = await CreditRechargePlan.findOne({ _id: planId, clientId });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    // If items provided, replace the set: delete old, create new
    if (itemsPayload) {
      if (plan.items && plan.items.length) {
        await PlanItem.deleteMany({ _id: { $in: plan.items } });
      }
      const newItems = itemsPayload.length
        ? await PlanItem.insertMany(itemsPayload.map(it => ({ ...it, clientId })))
        : [];
      updateFields.items = newItems.map(i => i._id);

      // // Mark referenced content as paid for each new item
      // if (newItems.length) {
      //   await Promise.all(
      //     newItems.map((it) => setReferencedItemPaid({ itemType: it.itemType, referenceId: it.referenceId, clientId, isPaid: true }))
      //   );
      // }
    }

    const updated = await CreditRechargePlan.findOneAndUpdate(
      { _id: planId, clientId },
      { $set: { ...updateFields, updatedAt: new Date() } },
      { new: true, runValidators: true }
    ).populate('items');

    res.json({ success: true, message: 'Plan updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCreditRechargePlan = async (req, res) => {
  try {
    const clientId = req.user.userId;
    const plan = await CreditRechargePlan.findOne({ _id: req.params.id, clientId });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    // Clean up items
    if (plan.items && plan.items.length) {
      await PlanItem.deleteMany({ _id: { $in: plan.items } });
    }

    await CreditRechargePlan.deleteOne({ _id: plan._id });

    res.json({ success: true, message: 'Plan deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteCreditRechargePlanItem = async (req, res) => {
  try {
    const clientId = req.user.userId;
    const { planId, itemId } = req.params;

    const plan = await CreditRechargePlan.findOne({ _id: planId, clientId });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    const itemExistsInPlan = plan.items.some((id) => id.toString() === itemId);
    if (!itemExistsInPlan) {
      return res.status(404).json({ success: false, message: 'Item not part of this plan' });
    }

    await PlanItem.deleteOne({ _id: itemId });
    plan.items = plan.items.filter((id) => id.toString() !== itemId);
    plan.updatedAt = new Date();
    await plan.save();

    const populated = await plan.populate('items');
    res.json({ success: true, message: 'Item removed from plan', data: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addCreditRechargePlanItem = async (req, res) => {
  try {
    const clientId = req.user.userId;
    const { planId } = req.params;
    const { name, description, itemType, itemKey, referenceId, quantity = 1, expiresWithPlan = true } = req.body;
    
    const plan = await CreditRechargePlan.findOne({ _id: planId, clientId });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    // Validate required fields
    if (!name || !itemType) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name and itemType are required' 
      });
    }

    const item = await PlanItem.create({
      name,
      description,
      itemType,
      itemKey,
      referenceId,
      quantity,
      expiresWithPlan,
      clientId
    });
    
    plan.items.push(item._id);
    plan.updatedAt = new Date();
    await plan.save();
    
    const populated = await plan.populate('items');
    res.json({ success: true, message: 'Item added to plan', data: populated });
  } catch (error) {
    console.error('Error adding item to plan:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

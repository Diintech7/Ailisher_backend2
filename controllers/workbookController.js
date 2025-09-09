const Workbook = require('../models/Workbook');
const User = require('../models/User');
    // Find all chapters for this book
    const Chapter = require('../models/Chapter');
    const Topic = require('../models/Topic');
    const SubTopic = require('../models/SubTopic');
const { generatePresignedUrl, generateGetPresignedUrl, deleteObject } = require('../utils/s3');
const path = require('path');
const AISWBSet = require('../models/AISWBSet');
const AiswbQuestion = require('../models/AiswbQuestion');
const Question = require('../models/Question');
const ObjectiveQuestion = require('../models/ObjectiveQuestion');
const SubjectiveQuestion = require('../models/SubjectiveQuestion');
const MyWorkbook = require('../models/MyWorkbook'); // Make sure this is at the top if not present

// Helper function to format workbook with user info and S3 URLs
const formatWorkbookWithUserInfo = async (workbook) => {
  const formattedWorkbook = {
    ...workbook.toObject(),
    createdBy: workbook.user ? {
      id: workbook.user._id,
      name: workbook.user.name,
      email: workbook.user.email,
      userId: workbook.user.userId || workbook.user._id.toString()
    } : null,
    highlightedByUser: workbook.highlightedBy ? {
      id: workbook.highlightedBy._id,
      name: workbook.highlightedBy.name,
      email: workbook.highlightedBy.email,
      userId: workbook.highlightedBy.userId || workbook.highlightedBy._id.toString()
    } : null,
    trendingByUser: workbook.trendingBy ? {
      id: workbook.trendingBy._id,
      name: workbook.trendingBy.name,
      email: workbook.trendingBy.email,
      userId: workbook.trendingBy.userId || workbook.trendingBy._id.toString()
    } : null,
    categoryOrderByUser: workbook.categoryOrderBy ? {
      id: workbook.categoryOrderBy._id,
      name: workbook.categoryOrderBy.name,
      email: workbook.categoryOrderBy.email,
      userId: workbook.categoryOrderBy.userId || workbook.categoryOrderBy._id.toString()
    } : null
  };

  // Always try to generate a new presigned URL if we have a cover image
  if (workbook.coverImageKey) {
    try {
      const coverImageUrl = await generateGetPresignedUrl(workbook.coverImageKey, 31536000);
      formattedWorkbook.coverImageUrl = coverImageUrl;
      if (workbook.coverImageUrl !== coverImageUrl) {
        await Workbook.findByIdAndUpdate(workbook._id, { coverImageUrl });
      }
    } catch (error) {
      console.error('Error generating presigned URL for cover image:', error);
      formattedWorkbook.coverImageUrl = null;
    }
  }

  return formattedWorkbook;
};

// Helper function to get client ID
const getClientId = (user) => {
  return user.role === 'client' && user.userId ? user.userId : user._id.toString();
};

// Get presigned URL for cover image upload
exports.getCoverImageUploadUrl = async (req, res) => {
  try {
    const user = req.user
    const { fileName, contentType } = req.body;
    if (!fileName || !contentType) {
      return res.status(400).json({ success: false, message: 'File name and content type are required' });
    }
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(fileName);
    const key = `${user.businessName}/workbook-covers/cover-${uniqueSuffix}${ext}`;
    const uploadUrl = await generatePresignedUrl(key, contentType);
    return res.status(200).json({ success: true, uploadUrl, key });
  } catch (error) {
    console.error('Get cover image upload URL error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Get presigned URL for cover image download
exports.getCoverImageDownloadUrl = async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) {
      return res.status(400).json({ success: false, message: 'Image key is required' });
    }
    const url = await generateGetPresignedUrl(key, 31536000);
    return res.status(200).json({ success: true, url });
  } catch (error) {
    console.error('Get cover image URL error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Create workbook with S3 cover image
exports.createWorkbook = async (req, res) => {
  try {
    const {
      title, description, author, publisher, language, mainCategory, subCategory,
      customSubCategory, exam, paper, subject, tags, clientId, isPublic, categoryOrder,
      coverImageKey, rating, ratingCount, conversations, users, summary
    } = req.body;

    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Validate rating
    if (rating && (isNaN(rating) || rating < 0 || rating > 5)) {
      return res.status(400).json({ success: false, message: 'Rating must be a number between 0 and 5' });
    }
    if (ratingCount && (isNaN(ratingCount) || ratingCount < 0)) {
      return res.status(400).json({ success: false, message: 'Rating count must be a non-negative number' });
    }

    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      } catch (e) {
        parsedTags = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      }
    }
    let parsedConversations = [];
    if (conversations) {
      try {
        parsedConversations = typeof conversations === 'string' ? JSON.parse(conversations) : conversations;
      } catch (e) {
        parsedConversations = conversations.split(',').map(conv => conv.trim()).filter(conv => conv.length > 0);
      }
    }
    let parsedUsers = [];
    if (users) {
      try {
        parsedUsers = typeof users === 'string' ? JSON.parse(users) : users;
      } catch (e) {
        parsedUsers = users.split(',').map(user => user.trim()).filter(user => user.length > 0);
      }
    }
    const effectiveClientId = clientId?.trim() || getClientId(currentUser);
    const workbookData = {
      title: title.trim(),
      description: description.trim(),
      author: author.trim(),
      publisher: publisher.trim(),
      language: language || 'English',
      mainCategory: mainCategory || 'Other',
      subCategory: subCategory || 'Other',
      clientId: effectiveClientId,
      user: req.user.id,
      userType: 'User',
      isPublic: isPublic === 'true' || isPublic === true || false,
      tags: parsedTags,
      categoryOrder: categoryOrder ? parseInt(categoryOrder) : 0,
      categoryOrderBy: req.user.id,
      categoryOrderByType: 'User',
      categoryOrderedAt: new Date(),
      rating: rating ? parseFloat(rating) : 0,
      ratingCount: ratingCount ? parseInt(ratingCount) : 0,
      conversations: parsedConversations,
      users: parsedUsers,
      summary: summary ? summary.trim() : ''
    };
    if (exam && exam.trim()) workbookData.exam = exam.trim();
    if (paper && paper.trim()) workbookData.paper = paper.trim();
    if (subject && subject.trim()) workbookData.subject = subject.trim();
    if (customSubCategory && customSubCategory.trim()) workbookData.customSubCategory = customSubCategory.trim();
    if (coverImageKey) {
      workbookData.coverImageKey = coverImageKey;
      try {
        const coverImageUrl = await generateGetPresignedUrl(coverImageKey, 604800);
        if (!coverImageUrl) throw new Error('Failed to generate presigned URL');
        workbookData.coverImageUrl = coverImageUrl;
      } catch (error) {
        return res.status(500).json({ success: false, message: `Failed to generate image URL: ${error.message}` });
      }
    }
    const workbook = await Workbook.create(workbookData);
    await workbook.populate('user', 'name email userId');
    if (!workbook.coverImageUrl && workbook.coverImageKey) {
      try {
        const coverImageUrl = await generateGetPresignedUrl(workbook.coverImageKey, 604800);
        if (!coverImageUrl) throw new Error('Failed to generate presigned URL after creation');
        await Workbook.findByIdAndUpdate(workbook._id, { coverImageUrl });
        workbook.coverImageUrl = coverImageUrl;
      } catch (error) {
        return res.status(500).json({ success: false, message: `Failed to generate image URL after creation: ${error.message}` });
      }
    }
    const formattedWorkbook = await formatWorkbookWithUserInfo(workbook);
    return res.status(201).json({ success: true, message: 'Workbook created successfully', workbook: formattedWorkbook });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to create workbook' });
  }
};

// Get workbooks with S3 URLs
exports.getWorkbooks = async (req, res) => {
  try {
    console.log("getting workbooks")
    const currentUser = await User.findById(req.user.id);
    console.log(currentUser)
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const clientId = getClientId(currentUser);
    const { category, subcategory, trending, highlighted, search, limit, page = 1 } = req.query;
    let filter = { clientId };
    if (category) filter.mainCategory = category;
    if (subcategory) filter.subCategory = subcategory;
    if (trending === 'true') {
      filter.isTrending = true;
      // filter.trendingStartDate = { $lte: new Date() };
      // filter.$or = [
      //   { trendingEndDate: { $gte: new Date() } },
      //   { trendingEndDate: null }
      // ];
    }
    if (highlighted === 'true') filter.isHighlighted = true;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { author: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } }
      ];
    }
    let query = Workbook.find({ user: req.user.id })
      .populate('user', 'name email userId')
      .populate('highlightedBy', 'name email userId')
      .populate('trendingBy', 'name email userId')
      .populate('categoryOrderBy', 'name email userId');
    if (trending === 'true') {
      query = query.sort({ trendingScore: -1, viewCount: -1 });
    } else if (highlighted === 'true') {
      query = query.sort({ highlightOrder: 1, highlightedAt: -1 });
    } else {
      query = query.sort({ categoryOrder: 1, createdAt: -1 });
    }
    if (limit) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      query = query.skip(skip).limit(parseInt(limit));
    }
    const workbooks = await query;
    const total = await Workbook.countDocuments(filter);
    
    const workbooksWithUserInfo = await Promise.all(workbooks.map(formatWorkbookWithUserInfo));
    const categoryOrders = {};
    workbooks.forEach(workbook => {
      if (!categoryOrders[workbook.mainCategory] || workbook.categoryOrder > categoryOrders[workbook.mainCategory]) {
        categoryOrders[workbook.mainCategory] = workbook.categoryOrder || 0;
      }
    });
    return res.status(200).json({
      success: true,
      count: workbooks.length,
      total,
         
      workbooks: workbooksWithUserInfo,
      categoryOrders,
      currentUser: {
        id: currentUser._id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role,
        userId: currentUser.userId || currentUser._id.toString()
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Get single workbook with S3 URL
exports.getWorkbook = async (req, res) => {
  try {
    const workbook = await Workbook.findById(req.params.id)
      .populate('user', 'name email userId')
      .populate('highlightedBy', 'name email userId')
      .populate('trendingBy', 'name email userId')
      .populate('categoryOrderBy', 'name email userId');
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }
    console.log("user",req.user.id);
    console.log("workbook",workbook.user._id)
    console.log("workbook",workbook.user)


    const currentUser = await User.findById(req.user.id);

    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // const clientId = getClientId(currentUser);
    let hasAccess = workbook.user.toString() === req.user.id || workbook.user._id.toString() === req.user.id;
    console.log(hasAccess)
    if (!hasAccess && workbook.isPublic) {
      hasAccess = true;
    }
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this workbook' });
    }
    // await workbook.incrementView();
    const workbookWithUserInfo = await formatWorkbookWithUserInfo(workbook);

    return res.status(200).json({ success: true, workbook: workbookWithUserInfo });
  } catch (error) {
    console.log(error)
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Update workbook with S3 cover image handling
exports.updateWorkbook = async (req, res) => {
  try {
    const {
      title, description, author, publisher, language, mainCategory, subCategory,
      customSubCategory, exam, paper, subject, tags, isPublic, categoryOrder,
      coverImageKey, rating, ratingCount, conversations, users, summary
    } = req.body;
    const workbook = await Workbook.findById(req.params.id);
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const clientId = getClientId(currentUser);
    if (workbook.clientId !== clientId && workbook.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this workbook' });
    }
    let newCoverImageUrl = workbook.coverImageUrl;
    let newCoverImageKey = workbook.coverImageKey;
    if (coverImageKey && coverImageKey !== workbook.coverImageKey) {
      if (workbook.coverImageKey) {
        try {
          await deleteObject(workbook.coverImageKey);
        } catch (error) {
          // Continue with update even if old image deletion fails
        }
      }
      try {
        newCoverImageUrl = await generateGetPresignedUrl(coverImageKey, 604800);
        newCoverImageKey = coverImageKey;
      } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to generate image URL' });
      }
    }
    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      } catch (e) {
        parsedTags = tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      }
    }
    let parsedConversations = [];
    if (conversations) {
      try {
        parsedConversations = typeof conversations === 'string' ? JSON.parse(conversations) : conversations;
      } catch (e) {
        parsedConversations = conversations.split(',').map(conv => conv.trim()).filter(conv => conv.length > 0);
      }
    }
    let parsedUsers = [];
    if (users) {
      try {
        parsedUsers = typeof users === 'string' ? JSON.parse(users) : users;
      } catch (e) {
        parsedUsers = users.split(',').map(user => user.trim()).filter(user => user.length > 0);
      }
    }
    const updateData = {
      title: title ? title.trim() : workbook.title,
      description: description ? description.trim() : workbook.description,
      author: author ? author.trim() : workbook.author,
      publisher: publisher ? publisher.trim() : workbook.publisher,
      language: language || workbook.language,
      mainCategory: mainCategory || workbook.mainCategory,
      subCategory: subCategory || workbook.subCategory,
      clientId: clientId,
      user: req.user.id,
      userType: 'User',
      isPublic: isPublic === 'true' || isPublic === true || workbook.isPublic,
      tags: parsedTags.length > 0 ? parsedTags : workbook.tags,
      conversations: parsedConversations.length > 0 ? parsedConversations : workbook.conversations,
      users: parsedUsers.length > 0 ? parsedUsers : workbook.users,
      summary: summary ? summary.trim() : workbook.summary,
      ...(coverImageKey && coverImageKey !== workbook.coverImageKey ? {
        coverImageKey: newCoverImageKey,
        coverImageUrl: newCoverImageUrl
      } : {})
    };
    if (exam) updateData.exam = exam.trim();
    if (paper) updateData.paper = paper.trim();
    if (subject) updateData.subject = subject.trim();
    if (customSubCategory) updateData.customSubCategory = customSubCategory.trim();
    if (categoryOrder) updateData.categoryOrder = parseInt(categoryOrder);
    if (rating !== undefined) {
      const ratingNum = parseFloat(rating);
      if (isNaN(ratingNum) || ratingNum < 0 || ratingNum > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be a number between 0 and 5' });
      }
      updateData.rating = ratingNum;
    }
    if (ratingCount !== undefined) {
      const countNum = parseInt(ratingCount);
      if (isNaN(countNum) || countNum < 0) {
        return res.status(400).json({ success: false, message: 'Rating count must be a non-negative number' });
      }
      updateData.ratingCount = countNum;
    }
    const updatedWorkbook = await Workbook.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('user', 'name email userId');
    const formattedWorkbook = await formatWorkbookWithUserInfo(updatedWorkbook);
    return res.status(200).json({ success: true, message: 'Workbook updated successfully', workbook: formattedWorkbook });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Delete workbook and its S3 cover image
exports.deleteWorkbook = async (req, res) => {
  try {
    const workbook = await Workbook.findById(req.params.id);
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const clientId = getClientId(currentUser);
    if (workbook.clientId !== clientId && workbook.user.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this workbook' });
    }
    if (workbook.coverImageKey) {
      try {
        await deleteObject(workbook.coverImageKey);
      } catch (error) {
        // Continue with workbook deletion even if image deletion fails
      }
    }
    await workbook.deleteOne();
    return res.status(200).json({ success: true, message: 'Workbook deleted successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
}; 

// for app

// Get workbooks with S3 URLs
exports.getWorkbooksformobile = async (req, res) => {
  try {
    console.log("getting workbooks")
    const user = req.clientInfo.id.toString();
    console.log(user)
    const { category, subcategory, trending, highlighted, search, limit, page = 1 } = req.query;
    let filter = { user };
    if (category) filter.mainCategory = category;
    if (subcategory) filter.subCategory = subcategory;
    if (trending === 'true') {
      filter.isTrending = true;
      filter.trendingStartDate = { $lte: new Date() };
      filter.$or = [
        { trendingEndDate: { $gte: new Date() } },
        { trendingEndDate: null }
      ];
    }
    if (highlighted === 'true') filter.isHighlighted = true;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { author: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $regex: search, $options: 'i' } }
      ];
    }
    let query = Workbook.find(filter)
      .populate('user', 'name email userId')
      .populate('highlightedBy', 'name email userId')
      .populate('trendingBy', 'name email userId')
      .populate('categoryOrderBy', 'name email userId');
    if (trending === 'true') {
      query = query.sort({ trendingScore: -1, viewCount: -1 });
    } else if (highlighted === 'true') {
      query = query.sort({ highlightOrder: 1, highlightedAt: -1 });
    } else {
      query = query.sort({ categoryOrder: 1, createdAt: -1 });
    }
    if (limit) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      query = query.skip(skip).limit(parseInt(limit));
    }

    const highlightedBooks = await Workbook.find({
      ...filter,
      isHighlighted: true
    })
    .populate('user', 'name email userId')
    .populate('highlightedBy', 'name email userId')
    .sort({ highlightOrder: 1, highlightedAt: -1 })

    // Get trending books with pagination
    const now = new Date();
    const trendingBooks = await Workbook.find({
      ...filter,
      isTrending: true,
      trendingStartDate: { $lte: now },
      $or: [
        { trendingEndDate: { $gte: now } },
        { trendingEndDate: null }
      ]
    })
    .populate('user', 'name email userId')
    .populate('trendingBy', 'name email userId')
    .sort({ trendingScore: -1, viewCount: -1 })

    const workbooks = await query;
    const workbooksWithUserInfo = await Promise.all(workbooks.map(formatWorkbookWithUserInfo));
    const categoryOrders = {};
    workbooks.forEach(workbook => {
      if (!categoryOrders[workbook.mainCategory] || workbook.categoryOrder > categoryOrders[workbook.mainCategory]) {
        categoryOrders[workbook.mainCategory] = workbook.categoryOrder || 0;
      }
    });
    return res.status(200).json({
      success: true,
      count: workbooks.length,
      highlighted: highlightedBooks || [],
      trending: trendingBooks || [], 
      workbooks: workbooksWithUserInfo,
      categoryOrders,
     
    });
  } catch (error) {
    console.log(error)
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};


exports.getHighlightedWorkbooks = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const clientId = getClientId(currentUser);
    const { limit } = req.query;

    const highlightedworkbooks = await Workbook.getHighlightedWorkbooks(clientId, limit ? parseInt(limit) : null);
    const workbooksWithUserInfo = highlightedworkbooks.map(formatWorkbookWithUserInfo);
    console.log(workbooksWithUserInfo)
    return res.status(200).json({
      success: true,
      count: highlightedworkbooks.length,
      workbooks: highlightedworkbooks,
    });
  } catch (error) {
    console.error('Get highlighted workbooks error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
// Add workbook to highlights
exports.addWorkbookToHighlights = async (req, res) => {
  try {
    const { note, order } = req.body;
    const workbook = await Workbook.findById(req.params.id).populate('user', 'name email userId');
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Authorization check
    const clientId = req.user.userId;
    console.log('clientId:', clientId);
    console.log('workbook.clientId:', workbook.clientId);
    const canHighlight = workbook.clientId === clientId;
    console.log('canHighlight:', canHighlight);
    if (!canHighlight) {
      return res.status(403).json({ success: false, message: 'Not authorized to highlight this workbook' });
    }
    
    if (workbook.isHighlighted) {
      return res.status(400).json({ success: false, message: 'Workbook is already highlighted' });
    }
    
    // Ensure userType is set on the workbook
    if (!workbook.userType) {
      workbook.userType = 'User';
    }
    
    const userType = 'User';
    await workbook.toggleHighlight(currentUser._id, userType, note || '', order || 0);
    await workbook.save();
    await workbook.populate('highlightedBy', 'name email userId');
    const workbookWithUserInfo = await formatWorkbookWithUserInfo(workbook);
    return res.status(200).json({ success: true, message: 'Workbook added to highlights successfully', workbook: workbookWithUserInfo });
  } catch (error) {
    console.error('Add workbook to highlights error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Remove workbook from highlights
exports.removeWorkbookFromHighlights = async (req, res) => {
  try {
    const workbook = await Workbook.findById(req.params.id).populate('user', 'name email userId');
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Authorization check
    const clientId = req.user.userId;
    console.log('clientId:', clientId);
    console.log('workbook.clientId:', workbook.clientId);
    const canRemoveHighlight = workbook.clientId === clientId;
    console.log('canRemoveHighlight:', canRemoveHighlight);
    if (!canRemoveHighlight) {
      return res.status(403).json({ success: false, message: 'Not authorized to remove highlight from this workbook' });
    }
    
    if (!workbook.isHighlighted) {
      return res.status(400).json({ success: false, message: 'Workbook is not highlighted' });
    }
    
    // Ensure userType is set on the workbook
    if (!workbook.userType) {
      workbook.userType = 'User';
    }
    
    await workbook.toggleHighlight(currentUser._id, 'User');
    await workbook.save();
    await workbook.populate('highlightedBy', 'name email userId');
    const workbookWithUserInfo = await formatWorkbookWithUserInfo(workbook);
    return res.status(200).json({ success: true, message: 'Workbook removed from highlights successfully', workbook: workbookWithUserInfo });
  } catch (error) {
    console.error('Remove workbook from highlights error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Add workbook to trending
exports.addWorkbookToTrending = async (req, res) => {
  try {
    const { score, endDate } = req.body;
    const workbook = await Workbook.findById(req.params.id).populate('user', 'name email userId');
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Authorization check
    const clientId = req.user.userId;
    console.log('clientId:', clientId);
    console.log('workbook.clientId:', workbook.clientId);
    const canMakeTrending = workbook.clientId === clientId;
    console.log('canMakeTrending:', canMakeTrending);
    if (!canMakeTrending) {
      return res.status(403).json({ success: false, message: 'Not authorized to make this workbook trending' });
    }
    
    if (workbook.isTrending) {
      return res.status(400).json({ success: false, message: 'Workbook is already trending' });
    }
    
    // Ensure userType is set on the workbook
    if (!workbook.userType) {
      workbook.userType = 'User';
    }
    
    const userType = 'User';
    const parsedScore = score ? parseInt(score) : 0;
    const parsedEndDate = endDate ? new Date(endDate) : null;
    await workbook.toggleTrending(currentUser._id, userType, parsedScore, parsedEndDate);
    await workbook.save();
    await workbook.populate('trendingBy', 'name email userId');
    const workbookWithUserInfo = await formatWorkbookWithUserInfo(workbook);
    return res.status(200).json({ success: true, message: 'Workbook added to trending successfully', workbook: workbookWithUserInfo });
  } catch (error) {
    console.error('Add workbook to trending error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Remove workbook from trending
exports.removeWorkbookFromTrending = async (req, res) => {
  try {
    const workbook = await Workbook.findById(req.params.id).populate('user', 'name email userId');
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Authorization check
    const clientId = req.user.userId;
    console.log('clientId:', clientId);
    console.log('workbook.clientId:', workbook.clientId);
    const canRemoveTrending = workbook.clientId === clientId;
    console.log('canRemoveTrending:', canRemoveTrending);
    if (!canRemoveTrending) {
      return res.status(403).json({ success: false, message: 'Not authorized to remove trending from this workbook' });
    }
    
    if (!workbook.isTrending) {
      return res.status(400).json({ success: false, message: 'Workbook is not trending' });
    }
    
    // Ensure userType is set on the workbook
    if (!workbook.userType) {
      workbook.userType = 'User';
    }
    
    await workbook.toggleTrending(currentUser._id, 'User');
    await workbook.save();
    await workbook.populate('trendingBy', 'name email userId');
    const workbookWithUserInfo = await formatWorkbookWithUserInfo(workbook);
    return res.status(200).json({ success: true, message: 'Workbook removed from trending successfully', workbook: workbookWithUserInfo });
  } catch (error) {
    console.error('Remove workbook from trending error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

exports.getTrendingWorkbooks = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const clientId = getClientId(currentUser);
    const { limit } = req.query;

    const trendingworkbooks = await Workbook.getTrendingWorkbooks(clientId, limit ? parseInt(limit) : null);

    return res.status(200).json({
      success: true,
      count: trendingworkbooks.length,
      workbooks: trendingworkbooks
    });
  } catch (error) {
    console.error('Get trending books error:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};
// Get all sets for a specific workbook (with details)
exports.getWorkbookSets = async (req, res) => {
  try {
    const { id } = req.params; // workbook ID

    // Find the workbook
    const workbook = await Workbook.findById(id)
      .populate('user', 'name email userId');

    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }

    // Check if this workbook is in MyWorkbook for the current mobile user
    let isMyWorkbookAdded = false;
    console.log(req.user.id);
    console.log(workbook._id)
    if (req.user.id && workbook._id) {
      isMyWorkbookAdded = await MyWorkbook.isWorkbookSavedByUser(req.user.id, workbook._id);
    }
    console.log(isMyWorkbookAdded)

    const chapters = await Chapter.find({ workbook: id });
    const chapterIds = chapters.map(ch => ch._id);

    // Find all topics for these chapters
    const topics = await Topic.find({ chapter: { $in: chapterIds } });
    const topicIds = topics.map(tp => tp._id);

    // Find all subtopics for these topics
    const subtopics = await SubTopic.find({ topic: { $in: topicIds } });
    const subtopicIds = subtopics.map(st => st._id);

    // Find all sets for this workbook, its chapters, topics, and subtopics
    const sets = await AISWBSet.find({
      $or: [
        { itemType: 'book', itemId: id },
        { itemType: 'chapter', itemId: { $in: chapterIds } },
        { itemType: 'topic', itemId: { $in: topicIds } },
        { itemType: 'subtopic', itemId: { $in: subtopicIds } }
      ]
    })
      .sort({ createdAt: -1 });

    // Add question count to each set and calculate global total
    let totalQuestionsCount = 0;
    const setsWithCounts = sets.map(set => {
      const questionCount = set.questions ? set.questions.length : 0;
      totalQuestionsCount += questionCount;
      return {
        ...set.toObject(),
        questionCount
      };
    });

    // Format workbook and add isMyWorkbookAdded
    const formattedWorkbook = await formatWorkbookWithUserInfo(workbook);
    formattedWorkbook.isMyWorkbookAdded = isMyWorkbookAdded;

    return res.status(200).json({
      success: true,
      totalQuestionsCount,
      workbook: formattedWorkbook,
      sets: setsWithCounts,
    });
  } catch (error) {
    console.error('Error fetching workbook sets:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// Get questions for a specific set in a workbook
exports.getQuestionsForSetInWorkbook = async (req, res) => {
  try {
    const { id, setId } = req.params;
    // Validate workbook exists
    const workbook = await Workbook.findById(id);
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }
    // Validate set exists and belongs to this workbook (directly or via chapter/topic/subtopic)
    const set = await AISWBSet.findById(setId);
    if (!set) {
      return res.status(404).json({ success: false, message: 'Set not found' });
    }
    // Optionally, check set.itemId matches workbook or its chapters/topics/subtopics
    // Fetch questions in this set
    const questions = await AiswbQuestion.find({ setId });
    const formattedQuestions = questions.map(q => ({
      _id: q._id,
      question: q.question,
      setId: q.setId,
      metadata: {
        difficultyLevel: q.metadata.difficultyLevel,
        maximumMarks: q.metadata.maximumMarks,
        estimatedTime: q.metadata.estimatedTime,
        wordLimit: q.metadata.wordLimit,
      }
    }));
    return res.status(200).json({ success: true, questions: formattedQuestions });
  } catch (error) {
    console.error('Error fetching questions for set in workbook:', error);
    return res.status(500).json({ success: false, message: 'Server Error' });
  }
}; 

exports.toggleIsEnabled = async (req, res) => {
  try {
    const clientId = req.user.userId;
    console.log("clientId",clientId)
    const {id} = req.params;
    const {isEnabled} = req.body || {};

    if(!id)
    {
      return re.status(400).json({success:false,message:"Workbook Id is required"})
    }

    const workbook = await Workbook.findById(id);
    if(!workbook)
    {
      return res.status(404).json({success:false,message:"Workbook not found"})
    }

    const newValue = typeof isEnabled === 'boolean' ? isEnabled : !workbook.isEnabled;
    workbook.isEnabled = newValue;

    await workbook.save();

    if(workbook.coverImageKey)
    {
      try {
        const freshImageUrl = await generateGetPresignedUrl(workbook.coverImageKey);
        workbook.coverImageUrl = freshImageUrl
      } catch (e) {
        // ignore URL refresh errors
      }
    }
    return res.status(200).json({success:true,message:"Workbook isEnabled updated"})
  } 
  catch (error) {
    console.error('Tpggle isEnabled error:',error);
    return res.status(500).json({success:false,message:"Failed to update isEnabled", error:error.message});
    }
}
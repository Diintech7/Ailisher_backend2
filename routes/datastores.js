const express = require('express');
const router = express.Router();
const DataStoreItem = require('../models/DatastoreItems');
const Book = require('../models/Book');
const Topic = require('../models/Topic');
const Chapter = require('../models/Chapter');
const SubTopic = require('../models/SubTopic');
const { verifyToken } = require('../middleware/auth');
const { generatePresignedUrl, generateGetPresignedUrl, uploadFileToS3, deleteObject } = require('../utils/s3');

// S3 Upload endpoint for datastore files
router.post('/upload-s3', verifyToken, async (req, res) => {
  try {
    const { fileName, contentType, fileSize } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({
        success: false,
        message: 'File name and content type are required'
      });
    }

    // Generate unique key for S3
    const timestamp = Date.now();
    const randomSuffix = Math.round(Math.random() * 1e9);
    const fileExtension = fileName.split('.').pop();
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `datastore/${req.user.id}/${timestamp}-${randomSuffix}-${safeFileName}`;

    // Generate presigned URL for upload
    const uploadUrl = await generatePresignedUrl(key, contentType);
    
    // Generate presigned URL for download (for immediate use)
    const downloadUrl = await generateGetPresignedUrl(key, 604800); // 7 days

    res.json({
      success: true,
      uploadUrl,
      downloadUrl,
      key,
      message: 'Upload URLs generated successfully'
    });
  } catch (error) {
    console.error('Error generating S3 upload URL:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate upload URL',
      error: error.message
    });
  }
});

// Refresh S3 URLs for datastore items
router.post('/refresh-s3-urls', verifyToken, async (req, res) => {
  try {
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds)) {
      return res.status(400).json({
        success: false,
        message: 'Item IDs array is required'
      });
    }

    const updatedItems = [];

    for (const itemId of itemIds) {
      const item = await DataStoreItem.findById(itemId);
      
      if (!item || item.user.toString() !== req.user.id) {
        continue; // Skip items that don't exist or don't belong to user
      }

      if (item.s3Key) {
        try {
          // Generate new presigned URL
          const newUrl = await generateGetPresignedUrl(item.s3Key, 604800);
          
          // Update the item with new URL
          item.url = newUrl;
          await item.save();
          
          updatedItems.push({
            id: item._id,
            newUrl: newUrl
          });
        } catch (error) {
          console.error(`Error refreshing URL for item ${itemId}:`, error);
        }
      }
    }

    res.json({
      success: true,
      message: `Refreshed ${updatedItems.length} URLs`,
      updatedItems
    });
  } catch (error) {
    console.error('Error refreshing S3 URLs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to refresh URLs',
      error: error.message
    });
  }
});

router.patch("/update-embedding-status/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params
    const { isEmbedded, embeddingCount, embeddedAt } = req.body

    const updatedItem = await DataStoreItem.findByIdAndUpdate(
      itemId,
      {
        isEmbedded,
        embeddingCount,
        embeddedAt,
      },
      { new: true },
    )

    if (!updatedItem) {
      return res.status(404).json({
        success: false,
        message: "Item not found",
      })
    }

    res.json({
      success: true,
      message: "Embedding status updated successfully",
      item: updatedItem,
    })
  } catch (error) {
    console.error("Error updating embedding status:", error)
    res.status(500).json({
      success: false,
      message: error.message,
    })
  }
})

// Get all book items
router.get('/book/:bookId', verifyToken, async (req, res) => {
  try {
    console.log('GET /book/:bookId called with bookId:', req.params.bookId);
    console.log('User ID:', req.user?.id);
    
    const { bookId } = req.params;

    // Validate bookId format (if using MongoDB ObjectId)
    if (!bookId || !bookId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid book ID format' 
      });
    }

    // Check if book exists and belongs to user
    const book = await Book.findOne({ _id: bookId });
    console.log('Book found:', book ? 'Yes' : 'No');
    
    if (!book) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book not found or unauthorized' 
      });
    }

    // Get datastore items for this book
    const items = await DataStoreItem.find({ book: bookId })
      .sort({ createdAt: -1 });

    console.log('Items found:', items.length);

    return res.json({ 
      success: true, 
      items,
      message: `Found ${items.length} items for book` 
    });
    
  } catch (error) {
    console.error('Error getting book items:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all chapter items
router.get('/chapter/:chapterId', verifyToken, async (req, res) => {
  try {
    console.log('GET /chapter/:chapterId called with chapterId:', req.params.chapterId);
    
    const { chapterId } = req.params;

    // Validate chapterId format
    if (!chapterId || !chapterId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid chapter ID format' 
      });
    }

    // Check if chapter exists and belongs to user
    const chapter = await Chapter.findById(chapterId).populate('book');
    if (!chapter) {
      return res.status(404).json({ 
        success: false, 
        message: 'Chapter not found' 
      });
    }

    // Verify user owns the book that contains this chapter
    const book = await Book.findOne({ _id: chapter.book });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const items = await DataStoreItem.find({ chapter: chapterId })
      .sort({ createdAt: -1 });

    return res.json({ success: true, items });
  } catch (error) {
    console.error('Error getting chapter items:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Upload files to book data store
router.post('/book/:bookId', verifyToken, async (req, res) => {
  try {
    console.log('POST /book/:bookId called with bookId:', req.params.bookId);
    
    const { bookId } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ 
        success: false, 
        message: 'No items provided or items is not an array' 
      });
    }

    // Validate bookId format
    if (!bookId || !bookId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid book ID format' 
      });
    }

    // Check if book exists and belongs to user
    const book = await Book.findOne({ _id: bookId });
    if (!book) {
      return res.status(404).json({ 
        success: false, 
        message: 'Book not found or unauthorized' 
      });
    }

    const savedItems = [];
    for (const item of items) {
      // Validate required fields
      if (!item.name || !item.url) {
        continue; // Skip invalid items
      }

      const newItem = new DataStoreItem({
        name: item.name,
        url: item.url,
        s3Key: item.s3Key || null,
        description: item.description || '',
        fileType: item.fileType || 'application/octet-stream',
        itemType: item.itemType || 'file',
        book: bookId,
        user: req.user.id
      });

      await newItem.save();
      savedItems.push(newItem);
    }

    return res.json({ 
      success: true, 
      message: 'Files uploaded successfully', 
      items: savedItems 
    });
  } catch (error) {
    console.error('Error uploading to book data store:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Upload files to chapter data store
router.post('/chapter/:chapterId', verifyToken, async (req, res) => {
  try {
    const { chapterId } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ 
        success: false, 
        message: 'No items provided or items is not an array' 
      });
    }

    // Validate chapterId format
    if (!chapterId || !chapterId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid chapter ID format' 
      });
    }

    // Check if chapter exists
    const chapter = await Chapter.findById(chapterId).populate('book');
    if (!chapter) {
      return res.status(404).json({ 
        success: false, 
        message: 'Chapter not found' 
      });
    }

    // Verify user owns the book that contains this chapter
    const book = await Book.findOne({ _id: chapter.book });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const savedItems = [];
    for (const item of items) {
      if (!item.name || !item.url) {
        continue; // Skip invalid items
      }

      const newItem = new DataStoreItem({
        name: item.name,
        url: item.url,
        s3Key: item.s3Key || null,
        description: item.description || '',
        fileType: item.fileType || 'application/octet-stream',
        itemType: item.itemType || 'file',
        chapter: chapterId,
        user: req.user.id
      });

      await newItem.save();
      savedItems.push(newItem);
    }

    return res.json({ 
      success: true, 
      message: 'Files uploaded successfully', 
      items: savedItems 
    });
  } catch (error) {
    console.error('Error uploading to chapter data store:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete an item from book datastore
router.delete('/book/:bookId/:itemId', verifyToken, async (req, res) => {
  try {
    const { bookId, itemId } = req.params;

    // Validate IDs format
    if (!bookId.match(/^[0-9a-fA-F]{24}$/) || !itemId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid ID format' 
      });
    }

    const item = await DataStoreItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ 
        success: false, 
        message: 'Item not found' 
      });
    }

    // Verify that the item belongs to a book owned by this user
    if (item.book && item.book.toString() !== bookId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Item does not belong to specified book' 
      });
    }

    const book = await Book.findOne({ _id: bookId });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Book not found or unauthorized' 
      });
    }

    // Delete from S3 if it has an S3 key
    if (item.s3Key) {
      try {
        await deleteObject(item.s3Key);
      } catch (s3Error) {
        console.error('Error deleting file from S3:', s3Error);
        // Continue with database deletion even if S3 deletion fails
      }
    }

    // Delete from S3 if it has an S3 key
    if (item.s3Key) {
      try {
        await deleteObject(item.s3Key);
      } catch (s3Error) {
        console.error('Error deleting file from S3:', s3Error);
        // Continue with database deletion even if S3 deletion fails
      }
    }

    await DataStoreItem.deleteOne({ _id: itemId });
    return res.json({ 
      success: true, 
      message: 'Item deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting item:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete an item from chapter datastore
router.delete('/chapter/:chapterId/:itemId', verifyToken, async (req, res) => {
  try {
    const { chapterId, itemId } = req.params;

    // Validate IDs format
    if (!chapterId.match(/^[0-9a-fA-F]{24}$/) || !itemId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid ID format' 
      });
    }

    const item = await DataStoreItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ 
        success: false, 
        message: 'Item not found' 
      });
    }

    // Verify that the item belongs to a chapter owned by this user
    if (item.chapter && item.chapter.toString() !== chapterId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Item does not belong to specified chapter' 
      });
    }

    const chapter = await Chapter.findById(chapterId).populate('book');
    if (!chapter) {
      return res.status(404).json({ 
        success: false, 
        message: 'Chapter not found' 
      });
    }

    const book = await Book.findOne({ _id: chapter.book });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    // Delete from S3 if it has an S3 key
    if (item.s3Key) {
      try {
        await deleteObject(item.s3Key);
      } catch (s3Error) {
        console.error('Error deleting file from S3:', s3Error);
        // Continue with database deletion even if S3 deletion fails
      }
    }

    // Delete from S3 if it has an S3 key
    if (item.s3Key) {
      try {
        await deleteObject(item.s3Key);
      } catch (s3Error) {
        console.error('Error deleting file from S3:', s3Error);
        // Continue with database deletion even if S3 deletion fails
      }
    }

    await DataStoreItem.deleteOne({ _id: itemId });
    return res.json({ 
      success: true, 
      message: 'Item deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting item:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all topic items
router.get('/topic/:topicId', verifyToken, async (req, res) => {
  try {
    const { topicId } = req.params;

    // Validate topicId format
    if (!topicId || !topicId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid topic ID format' 
      });
    }

    // Check if topic exists and belongs to user
    const topic = await Topic.findById(topicId).populate('chapter');
    if (!topic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Topic not found' 
      });
    }

    // Verify user owns the book that contains this topic
    const chapter = await Chapter.findById(topic.chapter).populate('book');
    const book = await Book.findOne({ _id: chapter.book });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const items = await DataStoreItem.find({ topic: topicId })
      .sort({ createdAt: -1 });

    return res.json({ success: true, items });
  } catch (error) {
    console.error('Error getting topic items:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Upload files to topic data store
router.post('/topic/:topicId', verifyToken, async (req, res) => {
  try {
    const { topicId } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ 
        success: false, 
        message: 'No items provided or items is not an array' 
      });
    }

    // Validate topicId format
    if (!topicId || !topicId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid topic ID format' 
      });
    }

    // Check if topic exists
    const topic = await Topic.findById(topicId).populate('chapter');
    if (!topic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Topic not found' 
      });
    }

    // Verify user owns the book that contains this topic
    const chapter = await Chapter.findById(topic.chapter).populate('book');
    const book = await Book.findOne({ _id: chapter.book });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const savedItems = [];
    for (const item of items) {
      if (!item.name || !item.url) {
        continue; // Skip invalid items
      }

      const newItem = new DataStoreItem({
        name: item.name,
        url: item.url,
        s3Key: item.s3Key || null,
        description: item.description || '',
        fileType: item.fileType || 'application/octet-stream',
        itemType: item.itemType || 'file',
        topic: topicId,
        user: req.user.id
      });

      await newItem.save();
      savedItems.push(newItem);
    }

    return res.json({ 
      success: true, 
      message: 'Files uploaded successfully', 
      items: savedItems 
    });
  } catch (error) {
    console.error('Error uploading to topic data store:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete a topic item
router.delete('/topic/:topicId/:itemId', verifyToken, async (req, res) => {
  try {
    const { topicId, itemId } = req.params;

    // Validate IDs format
    if (!topicId.match(/^[0-9a-fA-F]{24}$/) || !itemId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid ID format' 
      });
    }

    const item = await DataStoreItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ 
        success: false, 
        message: 'Item not found' 
      });
    }

    // Verify that the item belongs to a topic owned by this user
    if (item.topic && item.topic.toString() !== topicId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Item does not belong to specified topic' 
      });
    }

    const topic = await Topic.findById(topicId).populate('chapter');
    if (!topic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Topic not found' 
      });
    }

    const chapter = await Chapter.findById(topic.chapter).populate('book');
    const book = await Book.findOne({ _id: chapter.book });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    // Delete from S3 if it has an S3 key
    if (item.s3Key) {
      try {
        await deleteObject(item.s3Key);
      } catch (s3Error) {
        console.error('Error deleting file from S3:', s3Error);
        // Continue with database deletion even if S3 deletion fails
      }
    }

    await DataStoreItem.deleteOne({ _id: itemId });
    return res.json({ 
      success: true, 
      message: 'Item deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting item:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get all subtopic items
router.get('/subtopic/:subtopicId', verifyToken, async (req, res) => {
  try {
    const { subtopicId } = req.params;

    // Validate subtopicId format
    if (!subtopicId || !subtopicId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid subtopic ID format' 
      });
    }

    // Check if subtopic exists
    const subtopic = await SubTopic.findById(subtopicId).populate('topic');
    if (!subtopic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Subtopic not found' 
      });
    }

    // Verify user owns the book that contains this subtopic
    const topic = await Topic.findById(subtopic.topic).populate('chapter');
    const chapter = await Chapter.findById(topic.chapter).populate('book');
    const book = await Book.findOne({ _id: chapter.book });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const items = await DataStoreItem.find({ subtopic: subtopicId })
      .sort({ createdAt: -1 });

    return res.json({ success: true, items });
  } catch (error) {
    console.error('Error getting subtopic items:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Upload files to subtopic data store
router.post('/subtopic/:subtopicId', verifyToken, async (req, res) => {
  try {
    const { subtopicId } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ 
        success: false, 
        message: 'No items provided or items is not an array' 
      });
    }

    // Validate subtopicId format
    if (!subtopicId || !subtopicId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid subtopic ID format' 
      });
    }

    // Check if subtopic exists
    const subtopic = await SubTopic.findById(subtopicId).populate('topic');
    if (!subtopic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Subtopic not found' 
      });
    }

    // Verify user owns the book that contains this subtopic
    const topic = await Topic.findById(subtopic.topic).populate('chapter');
    const chapter = await Chapter.findById(topic.chapter).populate('book');
    const book = await Book.findOne({ _id: chapter.book });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    const savedItems = [];
    for (const item of items) {
      if (!item.name || !item.url) {
        continue; // Skip invalid items
      }

      const newItem = new DataStoreItem({
        name: item.name,
        url: item.url,
        s3Key: item.s3Key || null,
        description: item.description || '',
        fileType: item.fileType || 'application/octet-stream',
        itemType: item.itemType || 'file',
        subtopic: subtopicId,
        user: req.user.id
      });

      await newItem.save();
      savedItems.push(newItem);
    }

    return res.json({ 
      success: true, 
      message: 'Files uploaded successfully', 
      items: savedItems 
    });
  } catch (error) {
    console.error('Error uploading to subtopic data store:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete a subtopic item
router.delete('/subtopic/:subtopicId/:itemId', verifyToken, async (req, res) => {
  try {
    const { subtopicId, itemId } = req.params;

    // Validate IDs format
    if (!subtopicId.match(/^[0-9a-fA-F]{24}$/) || !itemId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid ID format' 
      });
    }

    const item = await DataStoreItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ 
        success: false, 
        message: 'Item not found' 
      });
    }

    // Verify that the item belongs to a subtopic owned by this user
    if (item.subtopic && item.subtopic.toString() !== subtopicId) {
      return res.status(403).json({ 
        success: false, 
        message: 'Item does not belong to specified subtopic' 
      });
    }

    const subtopic = await SubTopic.findById(subtopicId).populate('topic');
    if (!subtopic) {
      return res.status(404).json({ 
        success: false, 
        message: 'Subtopic not found' 
      });
    }

    const topic = await Topic.findById(subtopic.topic).populate('chapter');
    const chapter = await Chapter.findById(topic.chapter).populate('book');
    const book = await Book.findOne({ _id: chapter.book });
    if (!book) {
      return res.status(403).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    // Delete from S3 if it has an S3 key
    if (item.s3Key) {
      try {
        await deleteObject(item.s3Key);
      } catch (s3Error) {
        console.error('Error deleting file from S3:', s3Error);
        // Continue with database deletion even if S3 deletion fails
      }
    }

    await DataStoreItem.deleteOne({ _id: itemId });
    return res.json({ 
      success: true, 
      message: 'Item deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting item:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// --- WORKBOOK DATASTORE ROUTES ---

// Get all workbook items
router.get('/workbook/:workbookId', verifyToken, async (req, res) => {
  try {
    const { workbookId } = req.params;

    // Check if workbook exists and belongs to user
    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ _id: workbookId, user: req.user.id });
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }

    const items = await DataStoreItem.find({ workbook: workbookId })
      .sort({ createdAt: -1 });

    return res.json({ success: true, items });
  } catch (error) {
    console.error('Error getting workbook items:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Post workbook items
router.post('/workbook/:workbookId', verifyToken, async (req, res) => {
  try {
    const { workbookId } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'No items provided' });
    }

    // Check if workbook exists and belongs to user
    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ _id: workbookId, user: req.user.id });
    if (!workbook) {
      return res.status(404).json({ success: false, message: 'Workbook not found' });
    }

    const savedItems = [];
    for (const item of items) {
      const newItem = new DataStoreItem({
        name: item.name,
        url: item.url,
        s3Key: item.s3Key || null,
        fileType: item.fileType || 'application/octet-stream',
        workbook: workbookId,
        user: req.user.id
      });

      await newItem.save();
      savedItems.push(newItem);
    }

    return res.json({ success: true, message: 'Files uploaded successfully', items: savedItems });
  } catch (error) {
    console.error('Error uploading to workbook data store:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete workbook item
router.delete('/workbook/:workbookId/:itemId', verifyToken, async (req, res) => {
  try {
    const { workbookId, itemId } = req.params;

    const item = await DataStoreItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    // Verify that the item belongs to a workbook owned by this user
    if (item.workbook && item.workbook.toString() !== workbookId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ _id: workbookId, user: req.user.id });
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    await DataStoreItem.deleteOne({ _id: itemId });
    return res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all workbook chapter items
router.get('/workbook-chapter/:chapterId', verifyToken, async (req, res) => {
  try {
    const { chapterId } = req.params;

    // Check if chapter exists and belongs to user
    const chapter = await Chapter.findById(chapterId);
    if (!chapter || chapter.parentType !== 'workbook') {
      return res.status(404).json({ success: false, message: 'Chapter not found' });
    }

    // Verify user owns the workbook that contains this chapter
    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ 
      _id: chapter.workbook, 
      user: req.user.id 
    });
    
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const items = await DataStoreItem.find({ workbookChapter: chapterId })
      .sort({ createdAt: -1 });

    return res.json({ success: true, items });
  } catch (error) {
    console.error('Error getting workbook chapter items:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Upload files to workbook chapter data store
router.post('/workbook-chapter/:chapterId', verifyToken, async (req, res) => {
  try {
    const { chapterId } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'No items provided' });
    }

    // Check if chapter exists and is a workbook chapter
    const chapter = await Chapter.findById(chapterId);
    if (!chapter || chapter.parentType !== 'workbook') {
      return res.status(404).json({ success: false, message: 'Chapter not found' });
    }

    // Verify user owns the workbook that contains this chapter
    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ 
      _id: chapter.workbook, 
      user: req.user.id 
    });
    
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const savedItems = [];
    for (const item of items) {
      const newItem = new DataStoreItem({
        name: item.name,
        url: item.url,
        s3Key: item.s3Key || null,
        fileType: item.fileType || 'application/octet-stream',
        workbookChapter: chapterId,
        workbook: chapter.workbook,
        user: req.user.id
      });

      await newItem.save();
      savedItems.push(newItem);
    }

    return res.json({ success: true, message: 'Files uploaded successfully', items: savedItems });
  } catch (error) {
    console.error('Error uploading to workbook chapter data store:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete workbook chapter item
router.delete('/workbook-chapter/:chapterId/:itemId', verifyToken, async (req, res) => {
  try {
    const { chapterId, itemId } = req.params;

    const item = await DataStoreItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    // Verify that the item belongs to the chapter
    if (item.workbookChapter && item.workbookChapter.toString() !== chapterId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Verify the chapter belongs to a workbook owned by this user
    const chapter = await Chapter.findById(chapterId);
    if (!chapter || chapter.parentType !== 'workbook') {
      return res.status(404).json({ success: false, message: 'Chapter not found' });
    }

    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ 
      _id: chapter.workbook, 
      user: req.user.id 
    });
    
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    await DataStoreItem.deleteOne({ _id: itemId });
    return res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all workbook topic items
router.get('/workbook-topic/:topicId', verifyToken, async (req, res) => {
  try {
    const { topicId } = req.params;

    // Check if topic exists
    const topic = await Topic.findById(topicId).populate('chapter');
    if (!topic) {
      return res.status(404).json({ success: false, message: 'Topic not found' });
    }

    // Verify the chapter is a workbook chapter
    const chapter = await Chapter.findById(topic.chapter);
    if (!chapter || chapter.parentType !== 'workbook') {
      return res.status(404).json({ success: false, message: 'Topic not found in workbook' });
    }

    // Verify user owns the workbook that contains this topic
    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ 
      _id: chapter.workbook, 
      user: req.user.id 
    });
    
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const items = await DataStoreItem.find({ workbookTopic: topicId })
      .sort({ createdAt: -1 });

    return res.json({ success: true, items });
  } catch (error) {
    console.error('Error getting workbook topic items:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Upload files to workbook topic data store
router.post('/workbook-topic/:topicId', verifyToken, async (req, res) => {
  try {
    const { topicId } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'No items provided' });
    }

    // Check if topic exists
    const topic = await Topic.findById(topicId).populate('chapter');
    if (!topic) {
      return res.status(404).json({ success: false, message: 'Topic not found' });
    }

    // Verify the chapter is a workbook chapter
    const chapter = await Chapter.findById(topic.chapter);
    if (!chapter || chapter.parentType !== 'workbook') {
      return res.status(404).json({ success: false, message: 'Topic not found in workbook' });
    }

    // Verify user owns the workbook that contains this topic
    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ 
      _id: chapter.workbook, 
      user: req.user.id 
    });
    
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const savedItems = [];
    for (const item of items) {
      const newItem = new DataStoreItem({
        name: item.name,
        url: item.url,
        s3Key: item.s3Key || null,
        fileType: item.fileType || 'application/octet-stream',
        workbookTopic: topicId,
        workbookChapter: topic.chapter,
        workbook: chapter.workbook,
        user: req.user.id
      });

      await newItem.save();
      savedItems.push(newItem);
    }

    return res.json({ success: true, message: 'Files uploaded successfully', items: savedItems });
  } catch (error) {
    console.error('Error uploading to workbook topic data store:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete workbook topic item
router.delete('/workbook-topic/:topicId/:itemId', verifyToken, async (req, res) => {
  try {
    const { topicId, itemId } = req.params;

    const item = await DataStoreItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    // Verify that the item belongs to the topic
    if (item.workbookTopic && item.workbookTopic.toString() !== topicId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Verify topic exists and belongs to a workbook owned by the user
    const topic = await Topic.findById(topicId).populate('chapter');
    if (!topic) {
      return res.status(404).json({ success: false, message: 'Topic not found' });
    }

    const chapter = await Chapter.findById(topic.chapter);
    if (!chapter || chapter.parentType !== 'workbook') {
      return res.status(404).json({ success: false, message: 'Topic not found in workbook' });
    }

    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ 
      _id: chapter.workbook, 
      user: req.user.id 
    });
    
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    await DataStoreItem.deleteOne({ _id: itemId });
    return res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get all workbook subtopic items
router.get('/workbook-subtopic/:subtopicId', verifyToken, async (req, res) => {
  try {
    const { subtopicId } = req.params;

    // Check if subtopic exists
    const subtopic = await SubTopic.findById(subtopicId).populate('topic');
    if (!subtopic) {
      return res.status(404).json({ success: false, message: 'Subtopic not found' });
    }

    // Verify the topic belongs to a workbook
    const topic = await Topic.findById(subtopic.topic).populate('chapter');
    if (!topic) {
      return res.status(404).json({ success: false, message: 'Topic not found' });
    }

    const chapter = await Chapter.findById(topic.chapter);
    if (!chapter || chapter.parentType !== 'workbook') {
      return res.status(404).json({ success: false, message: 'Subtopic not found in workbook' });
    }

    // Verify user owns the workbook that contains this subtopic
    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ 
      _id: chapter.workbook, 
      user: req.user.id 
    });
    
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const items = await DataStoreItem.find({ workbookSubtopic: subtopicId })
      .sort({ createdAt: -1 });

    return res.json({ success: true, items });
  } catch (error) {
    console.error('Error getting workbook subtopic items:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Upload files to workbook subtopic data store
router.post('/workbook-subtopic/:subtopicId', verifyToken, async (req, res) => {
  try {
    const { subtopicId } = req.params;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'No items provided' });
    }

    // Check if subtopic exists
    const subtopic = await SubTopic.findById(subtopicId).populate('topic');
    if (!subtopic) {
      return res.status(404).json({ success: false, message: 'Subtopic not found' });
    }

    // Verify the topic belongs to a workbook
    const topic = await Topic.findById(subtopic.topic).populate('chapter');
    if (!topic) {
      return res.status(404).json({ success: false, message: 'Topic not found' });
    }

    const chapter = await Chapter.findById(topic.chapter);
    if (!chapter || chapter.parentType !== 'workbook') {
      return res.status(404).json({ success: false, message: 'Subtopic not found in workbook' });
    }

    // Verify user owns the workbook that contains this subtopic
    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ 
      _id: chapter.workbook, 
      user: req.user.id 
    });
    
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const savedItems = [];
    for (const item of items) {
      const newItem = new DataStoreItem({
        name: item.name,
        url: item.url,
        s3Key: item.s3Key || null,
        fileType: item.fileType || 'application/octet-stream',
        workbookSubtopic: subtopicId,
        workbookTopic: subtopic.topic,
        workbookChapter: topic.chapter,
        workbook: chapter.workbook,
        user: req.user.id
      });

      await newItem.save();
      savedItems.push(newItem);
    }

    return res.json({ success: true, message: 'Files uploaded successfully', items: savedItems });
  } catch (error) {
    console.error('Error uploading to workbook subtopic data store:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete workbook subtopic item
router.delete('/workbook-subtopic/:subtopicId/:itemId', verifyToken, async (req, res) => {
  try {
    const { subtopicId, itemId } = req.params;

    const item = await DataStoreItem.findById(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    // Verify that the item belongs to the subtopic
    if (item.workbookSubtopic && item.workbookSubtopic.toString() !== subtopicId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Verify subtopic exists and belongs to a workbook owned by the user
    const subtopic = await SubTopic.findById(subtopicId).populate('topic');
    if (!subtopic) {
      return res.status(404).json({ success: false, message: 'Subtopic not found' });
    }

    const topic = await Topic.findById(subtopic.topic).populate('chapter');
    if (!topic) {
      return res.status(404).json({ success: false, message: 'Topic not found' });
    }

    const chapter = await Chapter.findById(topic.chapter);
    if (!chapter || chapter.parentType !== 'workbook') {
      return res.status(404).json({ success: false, message: 'Subtopic not found in workbook' });
    }

    const Workbook = require('../models/Workbook');
    const workbook = await Workbook.findOne({ 
      _id: chapter.workbook, 
      user: req.user.id 
    });
    
    if (!workbook) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    await DataStoreItem.deleteOne({ _id: itemId });
    return res.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
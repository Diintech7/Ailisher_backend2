const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Book = require('../models/Book');
const Chapter = require('../models/Chapter');
const Topic = require('../models/Topic');
const DataStore = require('../models/DatastoreItems');

// Save split PDFs to datastore
router.post('/:bookId/save-split-pdfs', auth.verifyToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    const { splits } = req.body;
    const userId = req.user._id;

    // Verify book exists and belongs to user
    const book = await Book.findOne({ _id: bookId, user: userId });
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    // Group splits by chapter
    const chapterGroups = splits.reduce((acc, split) => {
      if (split.isChapter) {
        acc[split.title] = {
          chapter: {
            title: split.title,
            description: `Chapter covering pages ${split.startPage}-${split.endPage}`,
            book: bookId,
            order: Object.keys(acc).length + 1,
            parentType: 'book' // Add parentType field
          },
          topics: [],
          url: split.url,
          s3Key: split.s3Key || null
        };
      } else {
        const chapterTitle = split.parentChapter;
        if (acc[chapterTitle]) {
          acc[chapterTitle].topics.push({
            title: split.title.replace(`${chapterTitle} - `, ''),
            description: `Topic covering pages ${split.startPage}-${split.endPage}`,
            url: split.url,
            s3Key: split.s3Key || null,
            pageRange: `${split.startPage}-${split.endPage}`
          });
        }
      }
      return acc;
    }, {});

    // Process each chapter
    for (const [_, chapterData] of Object.entries(chapterGroups)) {
      // Create chapter
      const newChapter = new Chapter(chapterData.chapter);
      await newChapter.save();

      // Save chapter PDF to datastore
      const chapterDatastoreItem = new DataStore({
        name: `${chapterData.chapter.title}.pdf`,
        url: chapterData.url,
        s3Key: chapterData.s3Key || null,
        fileType: 'application/pdf',
        book: bookId,
        chapter: newChapter._id,
        user: userId
      });
      await chapterDatastoreItem.save();

      // Process each topic in the chapter
      for (const topicData of chapterData.topics) {
        // Create topic
        const newTopic = new Topic({
          title: topicData.title,
          description: topicData.description,
          content: `PDF section for ${topicData.title}`,
          chapter: newChapter._id,
          order: chapterData.topics.indexOf(topicData) + 1,
          parentType: 'Chapter' // Add parentType field if Topic model also requires it
        });
        await newTopic.save();

        // Save topic PDF to datastore
        const topicDatastoreItem = new DataStore({
          name: `${topicData.title}.pdf`,
          url: topicData.url,
          s3Key: topicData.s3Key || null,
          fileType: 'application/pdf',
          book: bookId,
          chapter: newChapter._id,
          topic: newTopic._id,
          user: userId
        });
        await topicDatastoreItem.save();
      }
    }

    res.json({ success: true, message: 'PDF splits saved successfully' });
  } catch (error) {
    console.error('Error saving PDF splits:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
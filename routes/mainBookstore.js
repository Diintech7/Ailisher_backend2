// routes/mainBookstore.js - Main Bookstore APIs for Homepage and Book Details
const express = require("express");
const router = express.Router();
const Book = require("../models/Book");
const Chapter = require("../models/Chapter");
const Topic = require("../models/Topic");
const {
  checkClientAccess,
  authenticateMobileUser,
} = require("../middleware/mobileAuth");

// 1. HOME PAGE API
// Endpoint: /api/clients/:clientId/homepage
// Method: GET (to fetch homepage content) or POST (to update homepage content)

// GET Homepage Content
router.get("/", authenticateMobileUser, async (req, res) => {
  try {
    // Use req.clientId (set by middleware) or fallback to req.params.clientId
    const clientId = req.clientId || req.params.clientId;
    const { limit = 5, page = 1, category, sub_category } = req.query;

    console.log("Fetching homepage content for client:", clientId);

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter for homepage content
    const filter = { clientId };
    if (category) filter.mainCategory = category;
    if (sub_category) filter.subCategory = sub_category;

    // Get total count for pagination
    const totalBooks = await Book.countDocuments(filter);

    // Get highlighted books with pagination
    const highlightedBooks = await Book.find({
      ...filter,
      isHighlighted: true,
    })
      .populate("user", "name email userId")
      .populate("highlightedBy", "name email userId")
      .sort({ highlightOrder: 1, highlightedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get trending books with pagination
    const now = new Date();
    const trendingBooks = await Book.find({
      ...filter,
      isTrending: true,
      trendingStartDate: { $lte: now },
      $or: [{ trendingEndDate: { $gte: now } }, { trendingEndDate: null }],
    })
      .populate("user", "name email userId")
      .populate("trendingBy", "name email userId")
      .sort({ trendingScore: -1, viewCount: -1 })
      .skip(skip)
      .limit(parseInt(limit));
     console.log(trendingBooks)
    // Get recent books with pagination
    const recentBooks = await Book.find(filter)
      .populate("user", "name email userId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Format response for homepage
    const formatBookForHomepage = (book) => ({
      book_id: book._id.toString(),
      title: book.title,
      category: book.mainCategory,
      sub_category: book.effectiveSubCategory,
      image: book.coverImage || "",
      image_url: book.coverImageUrl || "",
      highlight: book.isHighlighted,
      trending: book.isCurrentlyTrending,
      author: book.author,
      publisher: book.publisher,
      description: book.description,
      rating: book.rating,
      rating_count: book.ratingCount,
      conversations: book.conversations,
      users: book.users,
      summary: book.summary,
      viewCount: book.viewCount,
      exam_name: book.exam || "",
      paper_name: book.paper || "",
      subject_name: book.subject || "",
    });

    // Get categories with paginated books
    const categories = await getAvailableCategories(clientId);
    const categoriesWithBooks = await Promise.all(
      categories.map(async (cat) => {
        // Get books for this category with pagination
        const categoryBooks = await Book.find({
          clientId,
          mainCategory: cat.category,
        })
          .populate("user", "name email userId")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit));

        // Get subcategories with their paginated books
        const subCategoriesWithBooks = await Promise.all(
          cat.sub_categories.map(async (sub) => {
            const subCategoryBooks = await Book.find({
              clientId,
              mainCategory: cat.category,
              subCategory: sub.name,
            })
              .populate("user", "name email userId")
              .sort({ createdAt: -1 })
              .skip(skip)
              .limit(parseInt(limit));

            return {
              name: sub.name,
              count: sub.count,
              books: subCategoryBooks.map(formatBookForHomepage),
              pagination: {
                current_page: parseInt(page),
                total_pages: Math.ceil(sub.count / parseInt(limit)),
                total_items: sub.count,
                items_per_page: parseInt(limit),
                has_next_page:
                  parseInt(page) < Math.ceil(sub.count / parseInt(limit)),
                has_prev_page: parseInt(page) > 1,
              },
            };
          })
        );

        return {
          category: cat.category,
          sub_categories: subCategoriesWithBooks,
          total_books: cat.total_books,
          pagination: {
            current_page: parseInt(page),
            total_pages: Math.ceil(cat.total_books / parseInt(limit)),
            total_items: cat.total_books,
            items_per_page: parseInt(limit),
            has_next_page:
              parseInt(page) < Math.ceil(cat.total_books / parseInt(limit)),
            has_prev_page: parseInt(page) > 1,
          },
        };
      })
    );

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalBooks / parseInt(limit));
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    const homepageContent = {
      success: true,
      data: {
        highlighted: highlightedBooks.map(formatBookForHomepage),
        trending: trendingBooks.map(formatBookForHomepage),
        recent: recentBooks.map(formatBookForHomepage),
        categories: categoriesWithBooks,
        totalBooks: totalBooks,
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_items: totalBooks,
          items_per_page: parseInt(limit),
          has_next_page: hasNextPage,
          has_prev_page: hasPrevPage,
        },
      },
      meta: {
        clientId,
        timestamp: new Date().toISOString(),
        filters_applied: { category, sub_category },
      },
    };

    res.status(200).json(homepageContent);
  } catch (error) {
    console.error("Homepage API error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching homepage content",
      error: {
        code: "HOMEPAGE_ERROR",
        details: error.message,
      },
    });
  }
});

// POST Homepage Content (Update highlight/trending status)
router.post("/", authenticateMobileUser, async (req, res) => {
  try {
    // Use req.clientId (set by middleware) or fallback to req.params.clientId
    const clientId = req.clientId || req.params.clientId;
    const {
      book_id,
      title,
      category,
      sub_category,
      image,
      highlight,
      trending,
      highlight_order,
      trending_score,
      trending_end_date,
    } = req.body;

    console.log("Updating homepage content for client:", clientId);

    // Validate required fields
    if (!book_id) {
      return res.status(400).json({
        success: false,
        message: "book_id is required",
        error: {
          code: "MISSING_BOOK_ID",
          details: "book_id parameter is required for homepage updates",
        },
      });
    }

    // Find the book
    const book = await Book.findOne({ _id: book_id, clientId });
    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
        error: {
          code: "BOOK_NOT_FOUND",
          details: `Book with ID ${book_id} not found for client ${clientId}`,
        },
      });
    }

    // Update book properties if provided
    if (title) book.title = title;
    if (category) book.mainCategory = category;
    if (sub_category) book.subCategory = sub_category;
    if (image) book.coverImage = image;

    // Handle highlight status - Updated to handle true/false
    if (highlight !== undefined) {
      const shouldHighlight = highlight === true || highlight === "true";
      if (shouldHighlight !== book.isHighlighted) {
        await book.toggleHighlight(
          req.user.id,
          "MobileUser",
          "",
          highlight_order || 0
        );
      } else if (shouldHighlight && highlight_order !== undefined) {
        book.highlightOrder = highlight_order;
      }
    }

    // Handle trending status - Updated to handle true/false
    if (trending !== undefined) {
      const shouldTrend = trending === true || trending === "true";
      if (shouldTrend !== book.isTrending) {
        const endDate = trending_end_date ? new Date(trending_end_date) : null;
        await book.toggleTrending(
          req.user.id,
          "MobileUser",
          trending_score || 0,
          endDate
        );
      } else if (shouldTrend && trending_score !== undefined) {
        book.trendingScore = trending_score;
      }
    }

    await book.save();

    res.status(200).json({
      success: true,
      message: "Homepage content updated successfully",
      data: {
        book_id: book._id.toString(),
        title: book.title,
        category: book.mainCategory,
        sub_category: book.effectiveSubCategory,
        image: book.coverImage,
        highlight: book.isHighlighted, // Changed from 'yes'/'no' to true/false
        trending: book.isCurrentlyTrending, // Changed from 'yes'/'no' to true/false
      },
    });
  } catch (error) {
    console.error("Homepage update error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while updating homepage content",
      error: {
        code: "HOMEPAGE_UPDATE_ERROR",
        details: error.message,
      },
    });
  }
});

// 2. BOOK DETAILS API
// Endpoint: /api/clients/:clientId/book/details
// Method: GET

router.get("/book/details", authenticateMobileUser, async (req, res) => {
  try {
    // FIXED: Use req.clientId (set by middleware) or fallback to req.params.clientId
    const clientId = req.clientId || req.params.clientId;
    const { book_id } = req.query;

    console.log("Fetching book details for:", { clientId, book_id });
    console.log("req.params:", req.params);
    console.log("req.clientId:", req.clientId);

    // Validate that we have a clientId
    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required",
        error: {
          code: "MISSING_CLIENT_ID",
          details: "Client ID not found in request parameters or middleware",
        },
      });
    }

    // Validate required parameter
    if (!book_id) {
      return res.status(400).json({
        success: false,
        message: "book_id parameter is required",
        error: {
          code: "MISSING_BOOK_ID",
          details: "book_id query parameter is required",
        },
      });
    }

    // Find the book with populated user info
    const book = await Book.findOne({ _id: book_id, clientId }).populate(
      "user",
      "name email userId"
    );

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "Book not found",
        error: {
          code: "BOOK_NOT_FOUND",
          details: `Book with ID ${book_id} not found for client ${clientId}`,
        },
      });
    }

    // Get book's chapters and topics to build index
    const chapters = await Chapter.find({
      book: book._id,
      parentType: "book",
    }).sort({ order: 1, createdAt: 1 });

    const bookIndex = [];
    for (const chapter of chapters) {
      const topics = await Topic.find({ chapter: chapter._id })
        .sort({ order: 1, createdAt: 1 })
        .select("title");

      bookIndex.push({
        chapter_name: chapter.title,
        chapter_id: chapter._id.toString(),
        topics: topics.map((topic) => {
          return {
            topic_name: topic.title,
            topic_id: topic._id.toString(),
          };
        }),
      });
    }

    // Increment view count
    await book.incrementView();

    // Build the response according to the specified format
    const bookDetails = {
      success: true,
      data: {
        book_id: book._id.toString(),
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        description: book.description,
        category: book.mainCategory,
        sub_category: book.effectiveSubCategory,
        tag: book.tags ? book.tags.join(", ") : "",
        highlight: book.isHighlighted, // Changed from 'yes'/'no' to true/false
        trending: book.isCurrentlyTrending, // Changed from 'yes'/'no' to true/false
        cover_image: book.coverImage || "",
        cover_image_url: book.coverImageUrl || "",
        index: bookIndex,
        exam_name: book.exam || "",
        paper_name: book.paper || "",
        subject_name: book.subject || "",
        // Additional useful information
        language: book.language,
        rating: book.rating,
        rating_count: book.ratingCount,
        total_conversations: book.conversations.length,
        total_users: book.users.length,
        summary: book.summary,
        view_count: book.viewCount,
        created_at: book.createdAt,
        updated_at: book.updatedAt,
        is_added_to_my_books: book.isAddedToMyBooks,
        isVideoAvailable: book.isVideoAvailabel,
        aiGuidelines: book.aiGuidelines,
        // PDF Embedding Status for frontend developers
        isEmbedded: book.embedded || false,
        embeddedAt: book.embeddedAt,
        embeddingStats: book.embeddingStats || {
          totalFiles: 0,
          totalChunks: 0,
          totalTokens: 0,
          lastUpdated: null,
          collectionName: null
        },
        chatAvailable: book.embedded || false,
        // Status codes for app developers
        embeddingStatus: {
          statusCode: book.embedded ? 3001 : 3002, // 3001: EMBEDDED, 3002: NOT_EMBEDDED
          statusMessage: book.embedded 
            ? "Book has PDF embeddings available for AI chat" 
            : "Book needs PDF embeddings to enable AI chat",
          canUseAI: book.embedded || false,
          requiresEmbedding: !book.embedded
        },
      },
      meta: {
        clientId,
        total_chapters: chapters.length,
        total_topics: bookIndex.reduce(
          (sum, chapter) => sum + chapter.topics.length,
          0
        ),
        timestamp: new Date().toISOString(),
      },
    };

    res.status(200).json(bookDetails);
  } catch (error) {
    console.error("Book details API error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching book details",
      error: {
        code: "BOOK_DETAILS_ERROR",
        details: error.message,
      },
    });
  }
});

// Helper function to get available categories for a client
async function getAvailableCategories(clientId) {
  try {
    const categories = await Book.aggregate([
      { $match: { clientId } },
      {
        $group: {
          _id: {
            mainCategory: "$mainCategory",
            subCategory: "$subCategory",
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.mainCategory",
          subCategories: {
            $push: {
              name: "$_id.subCategory",
              count: "$count",
            },
          },
          totalCount: { $sum: "$count" },
        },
      },
      { $sort: { totalCount: -1 } }, // Sort by total count in descending order
      { $limit: 5 }, // Limit to top 5 categories
    ]);

    return categories.map((cat) => ({
      category: cat._id,
      sub_categories: cat.subCategories,
      total_books: cat.totalCount,
    }));
  } catch (error) {
    console.error("Error fetching categories:", error);
    return [];
  }
}

// Export router
module.exports = router;

const express = require('express');
const router = express.Router();
const { addCategory, addSubcategory, getAllCategories, deleteCategory, deleteSubcategory } = require('../controllers/categoryController');
const { verifyToken } = require('../middleware/auth');

// Get all categories
router.get('/', verifyToken, getAllCategories);

// Create a new category
router.post('/', verifyToken, addCategory);

// Create a new subcategory under a category
router.post('/:categoryId/subcategories', verifyToken, addSubcategory);

// Delete a category
router.delete('/:categoryId', verifyToken, deleteCategory);

// Delete a subcategory under a category
router.delete('/:categoryId/subcategories/:subcategoryId', verifyToken, deleteSubcategory);

module.exports = router;



const Category = require('../models/Category');

// Add a new category
exports.addCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Category name is required' });
    const existing = await Category.findOne({ name });
    if (existing) return res.status(409).json({ error: 'Category already exists' });
    const category = new Category({ name, subcategories: [] });
    await category.save();
    res.status(201).json(category);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Add one or more subcategories to an existing category
exports.addSubcategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { name, names } = req.body;

    if (!name && (!Array.isArray(names) || names.length === 0)) {
      return res.status(400).json({ error: 'Subcategory name is required' });
    }

    const category = await Category.findById(categoryId);
    if (!category) return res.status(404).json({ error: 'Category not found' });

    // Single name (backward compatible behavior)
    if (name && !names) {
      if (category.subcategories.some(sc => sc.name === name)) {
        return res.status(409).json({ error: 'Subcategory already exists' });
      }
      category.subcategories.push({ name });
      await category.save();
      return res.status(201).json(category);
    }

    // Multiple names
    const toAdd = [];
    const skipped = [];
    const invalid = [];

    names.forEach((n) => {
      const trimmed = typeof n === 'string' ? n.trim() : '';
      if (!trimmed) {
        invalid.push(n);
        return;
      }
      if (category.subcategories.some(sc => sc.name === trimmed)) {
        skipped.push(trimmed);
        return;
      }
      toAdd.push({ name: trimmed });
    });

    if (toAdd.length > 0) {
      category.subcategories.push(...toAdd);
      await category.save();
    }

    return res.status(201).json({
      success: true,
      category,
      summary: {
        added: toAdd.map(s => s.name),
        skipped, // already existed
        invalid,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get all user-defined categories and subcategories
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}; 
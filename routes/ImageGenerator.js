const express = require('express');
const router = express.Router();
const { generateImage } = require('../controllers/ImageGenerator');

router.post('/generate-image', generateImage);

module.exports = router;
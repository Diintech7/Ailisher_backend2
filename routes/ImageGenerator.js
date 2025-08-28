const express = require('express');
const router = express.Router();
const { 
    generateImage, 
    uploadImage, 
    saveGeneratedImage, 
    getUserImages, 
    deleteImage 
} = require('../controllers/ImageGenerator');
const { verifyToken, isClient } = require('../middleware/auth');
const { overlayTextOnImage } = require('../controllers/TextOverlayController');

// Image generation
router.post('/generate-image', verifyToken, isClient, generateImage);

// Save generated image to R2 and database
router.post('/save-image', verifyToken, isClient, saveGeneratedImage);

// Get user's generated images
router.get('/my-images', verifyToken, isClient, getUserImages);

// Delete image
router.delete('/images/:id', verifyToken, isClient, deleteImage);

// Overlay text
router.post('/overlay-text', verifyToken, isClient, overlayTextOnImage);



module.exports = router;
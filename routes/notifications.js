const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyAdminToken } = require('../middleware/auth');
const { authenticateMobileUser } = require('../middleware/mobileAuth');
const controller = require('../controllers/notificationController');

// Admin/client (server-side user) creates drafts/templates
router.post('/:clientId/drafts', verifyAdminToken, controller.createDraft);
router.put('/:clientId/drafts/:id', verifyAdminToken, controller.updateDraft);
router.get('/:clientId', verifyAdminToken, controller.list);
router.post('/:clientId/send/:id', verifyAdminToken, controller.send);

// Mobile user fetches own notifications
router.get('/:clientId/user', authenticateMobileUser, controller.listForUser);
router.post('/:clientId/user/:id/read', authenticateMobileUser, controller.markRead);

module.exports = router;




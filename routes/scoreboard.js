const router = require('express').Router();
const { getUserScoreboard } = require('../controllers/scoreboardController');
const { authenticateMobileUser, ensureUserBelongsToClient } = require('../middleware/mobileAuth');

// GET /api/scoreboard/user/:userId?clientId=...
router.get('/',authenticateMobileUser,ensureUserBelongsToClient, getUserScoreboard);

module.exports = router;




const router = require('express').Router();
const { getUserScoreboard } = require('../controllers/scoreboardController');

// GET /api/scoreboard/user/:userId?clientId=...
router.get('/user/:userId', getUserScoreboard);

module.exports = router;




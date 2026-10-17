const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth.middleware');
const { requireHouseholdMember } = require('../middleware/household.middleware');
const { subscribe } = require('../services/realtime');

// Live stream of the household's changes (Server-Sent Events), see services/realtime.js.
router.get('/:householdId', authenticateUser, requireHouseholdMember, (req, res) => {
  subscribe(req.householdId, req, res);
});

module.exports = router;

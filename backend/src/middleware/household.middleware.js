const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { SERVER_ERROR } = require('../utils/handle');

/**
 * Only members of the household in the URL (/:householdId/...) get in, and only while it is
 * their active household. Runs after authenticateUser. Every household-scoped router mounts it,
 * so no route can forget the check. Sets on the request:
 *   householdId (ObjectId), household, memberIds (string[]), isAdmin, isOwner
 */
async function requireHouseholdMember(req, res, next) {
  try {
    const id = req.params.householdId;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Foyer invalide' });
    }

    const householdId = new ObjectId(id);
    const household = await getDB().collection('households').findOne({ _id: householdId });
    const member = household?.members?.find(m => m.userId === req.user.uid);
    if (!member || req.currentUser?.householdId?.toString() !== id) {
      return res.status(403).json({ error: "Tu n'as pas accès à ce foyer" });
    }

    req.householdId = householdId;
    req.household = household;
    req.memberIds = household.members.map(m => m.userId);
    req.isAdmin = member.role === 'admin';
    req.isOwner = household.createdBy === req.user.uid;
    next();
  } catch (error) {
    console.error('[household] Authorization error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
}

module.exports = { requireHouseholdMember };

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { joinHouseholdLimiter } = require('../middleware/rate-limit.middleware');
const { deleteHousehold, removeMember } = require('../services/households');
const { notify } = require('../services/notify');
const { publish } = require('../services/realtime');
const { asString } = require('../utils/input');
const { handle } = require('../utils/handle');

// All routes require authentication
router.use(authenticateUser);

// Invite codes: 8 characters from a cryptographic source (32^8 ≈ 10^12 combinations, with
// join attempts rate-limited). No 0/O or 1/I, which are easy to mix up when read aloud.
// A code is valid for one day, so one that leaks (database, a forwarded message) soon stops working.
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_MEMBERS = 20;

const generateInviteCode = async (db) => {
  for (;;) {
    const code = Array.from({ length: INVITE_CODE_LENGTH }, () => INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)]).join('');
    if (!(await db.collection('households').findOne({ inviteCode: code }, { projection: { _id: 1 } }))) return code;
  }
};

const newInviteCode = async (db) => ({
  inviteCode: await generateInviteCode(db),
  inviteCodeExpiresAt: new Date(Date.now() + INVITE_CODE_LIFETIME_MS)
});

/**
 * Daily rotation, without a scheduled job (which would not run while the server sleeps):
 * an expired code is replaced as soon as the household is read, so members always see a
 * valid one. Households from before the rotation have no expiry and get a code right away.
 */
const withFreshInviteCode = async (db, household) => {
  if (!household || household.inviteCodeExpiresAt > new Date()) return household;
  // Conditional on the old code: two simultaneous reads must not hand out two different codes
  const updated = await db.collection('households').findOneAndUpdate(
    { _id: household._id, inviteCode: household.inviteCode },
    { $set: await newInviteCode(db) },
    { returnDocument: 'after' }
  );
  return updated || db.collection('households').findOne({ _id: household._id });
};

/** Members see each other's names, not their email addresses. */
function toClient(household) {
  if (!household) return household;
  return { ...household, members: household.members.map(({ email, ...member }) => member) };
}

const sendHousehold = async (res, db, household, status = 200) =>
  res.status(status).json({ household: toClient(await withFreshInviteCode(db, household)) });

// Set the user's active household
const setUserHousehold = async (db, uid, householdId) => {
  await db.collection('users').updateOne(
    { _id: new ObjectId(uid) },
    { $set: { householdId: householdId ? new ObjectId(householdId) : null, updatedAt: new Date() } }
  );
};

/** The household of the URL, if the user is one of its members (404 otherwise). */
async function loadMembership(req, res) {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(404).json({ error: 'Foyer introuvable' });
    return null;
  }
  const household = await getDB().collection('households').findOne({ _id: new ObjectId(req.params.id) });
  const member = household?.members.find(m => m.userId === req.user.uid);
  if (!member) {
    res.status(404).json({ error: 'Foyer introuvable' });
    return null;
  }
  return { household, member };
}

async function loadAsAdmin(req, res, message) {
  const membership = await loadMembership(req, res);
  if (!membership) return null;
  if (membership.member.role !== 'admin') {
    res.status(403).json({ error: message });
    return null;
  }
  return membership;
}

// Create household
router.post('/', handle('households', async (req, res) => {
  const name = asString(req.body?.name, 60).trim();
  if (!name) {
    return res.status(400).json({ error: 'Donne un nom à ton foyer' });
  }
  const db = getDB();

  const household = {
    name,
    createdBy: req.user.uid,
    ...(await newInviteCode(db)),
    members: [{
      userId: req.user.uid,
      email: req.user.email,
      displayName: req.currentUser.displayName || 'Membre',
      role: 'admin',
      joinedAt: new Date()
    }],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await db.collection('households').insertOne(household);
  household._id = result.insertedId;

  // The creator's active household becomes the new one
  await setUserHousehold(db, req.user.uid, result.insertedId);

  res.status(201).json({ household: toClient(household) });
}));

// Get user's households
router.get('/', handle('households', async (req, res) => {
  const db = getDB();
  const households = await db.collection('households')
    .find({ 'members.userId': req.user.uid })
    .toArray();

  res.json({ households: (await Promise.all(households.map(h => withFreshInviteCode(db, h)))).map(toClient) });
}));

// Get household by ID
router.get('/:id', handle('households', async (req, res) => {
  const membership = await loadMembership(req, res);
  if (!membership) return;
  await sendHousehold(res, getDB(), membership.household);
}));

// Rename household (admin only)
router.put('/:id', handle('households', async (req, res) => {
  const membership = await loadAsAdmin(req, res, 'Seul un admin du foyer peut le renommer');
  if (!membership) return;
  const name = asString(req.body?.name, 60).trim();
  if (!name) return res.status(400).json({ error: 'Donne un nom à ton foyer' });

  const db = getDB();
  const result = await db.collection('households').findOneAndUpdate(
    { _id: membership.household._id },
    { $set: { name, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  publish(result._id, 'household', req.user.uid);
  await sendHousehold(res, db, result);
}));

// Join household with invite code
router.post('/join', joinHouseholdLimiter, handle('households', async (req, res) => {
  const inviteCode = asString(req.body?.inviteCode, 32).trim().toUpperCase();
  if (!inviteCode) {
    return res.status(400).json({ error: 'Entre un code ami' });
  }
  const db = getDB();

  const household = await db.collection('households').findOne({ inviteCode, inviteCodeExpiresAt: { $gt: new Date() } });

  if (!household) {
    return res.status(404).json({ error: "Ce code ami n'est pas valide. Les codes changent chaque jour : demande le code du jour à un membre du foyer" });
  }

  if (household.members.some(m => m.userId === req.user.uid)) {
    return res.status(400).json({ error: 'Tu fais déjà partie de ce foyer' });
  }
  if (household.members.length >= MAX_MEMBERS) {
    return res.status(400).json({ error: `Ce foyer est complet (${MAX_MEMBERS} membres maximum)` });
  }

  const displayName = req.currentUser.displayName || 'Membre';
  const result = await db.collection('households').findOneAndUpdate(
    { _id: household._id, 'members.userId': { $ne: req.user.uid } },
    {
      $push: {
        members: { userId: req.user.uid, email: req.user.email, displayName, role: 'member', joinedAt: new Date() }
      },
      $set: { updatedAt: new Date() }
    },
    { returnDocument: 'after' }
  );
  if (!result) {
    return res.status(400).json({ error: 'Tu fais déjà partie de ce foyer' });
  }

  // Switch the user's active household to the one they just joined
  await setUserHousehold(db, req.user.uid, household._id);

  publish(household._id, 'household', req.user.uid);
  void notify({
    userIds: household.members.map(m => m.userId),
    type: 'household',
    title: household.name,
    body: `${displayName} a rejoint le foyer 👋`,
    route: '/tabs/settings/household'
  });

  res.json({ household: toClient(result) });
}));

// Regenerate invite code (admin only)
router.post('/:id/regenerate-invite', handle('households', async (req, res) => {
  const membership = await loadAsAdmin(req, res, 'Seul un admin du foyer peut générer un nouveau code');
  if (!membership) return;

  const db = getDB();
  const result = await db.collection('households').findOneAndUpdate(
    { _id: membership.household._id },
    { $set: { ...(await newInviteCode(db)), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  res.json({ household: toClient(result) });
}));

// Update a member's role (admin only). The owner keeps their role, and a household keeps an admin.
router.put('/:id/members/:userId', handle('households', async (req, res) => {
  const { role } = req.body || {};
  if (role !== 'admin' && role !== 'member') {
    return res.status(400).json({ error: 'Rôle invalide' });
  }

  const membership = await loadAsAdmin(req, res, 'Seul un admin du foyer peut changer les rôles');
  if (!membership) return;
  const { household } = membership;
  const target = household.members.find(m => m.userId === req.params.userId);
  if (!target) {
    return res.status(404).json({ error: 'Membre introuvable' });
  }
  if (target.userId === household.createdBy && role !== 'admin') {
    return res.status(403).json({ error: 'Le créateur du foyer reste admin' });
  }

  const db = getDB();
  const result = await db.collection('households').findOneAndUpdate(
    { _id: household._id, 'members.userId': target.userId },
    { $set: { 'members.$.role': role, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );

  publish(household._id, 'household', req.user.uid);
  await sendHousehold(res, db, result);
}));

// Remove a member (admin only, never the owner)
router.delete('/:id/members/:userId', handle('households', async (req, res) => {
  const membership = await loadAsAdmin(req, res, 'Seul un admin du foyer peut retirer un membre');
  if (!membership) return;
  const { household } = membership;
  const targetUserId = req.params.userId;

  if (targetUserId === req.user.uid) {
    return res.status(400).json({ error: 'Pour partir, utilise « Quitter le foyer »' });
  }
  if (targetUserId === household.createdBy) {
    return res.status(403).json({ error: 'Le créateur du foyer ne peut pas être retiré' });
  }
  if (!household.members.some(m => m.userId === targetUserId)) {
    return res.status(404).json({ error: 'Membre introuvable' });
  }

  await removeMember(household, targetUserId);
  const db = getDB();
  await sendHousehold(res, db, await db.collection('households').findOne({ _id: household._id }));
}));

// Leave household. The owner leaving hands it over; the last member leaving deletes it.
router.delete('/:id/leave', handle('households', async (req, res) => {
  const membership = await loadMembership(req, res);
  if (!membership) return;

  const outcome = await removeMember(membership.household, req.user.uid);
  res.json({ message: outcome === 'deleted' ? 'Foyer supprimé' : 'Tu as quitté le foyer' });
}));

// Delete household with everything in it (owner only)
router.delete('/:id', handle('households', async (req, res) => {
  const membership = await loadMembership(req, res);
  if (!membership) return;
  if (membership.household.createdBy !== req.user.uid) {
    return res.status(403).json({ error: 'Seul le créateur du foyer peut le supprimer' });
  }

  await deleteHousehold(membership.household._id);
  res.json({ message: 'Foyer supprimé' });
}));

module.exports = router;

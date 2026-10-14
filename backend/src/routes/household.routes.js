const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { joinHouseholdLimiter } = require('../middleware/rate-limit.middleware');
const { deleteDocuments } = require('../services/documents');
const { asString } = require('../utils/input');

// All routes require authentication
router.use(authenticateUser);

// Invite codes: 8 characters from a cryptographic source (32^8 ≈ 10^12 combinations, with
// join attempts rate-limited). No 0/O or 1/I, which are easy to mix up when read aloud.
// A code is valid for one day, so one that leaks (database, a forwarded message) soon stops working.
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** Shown to the user: the technical details stay in the server log */
const SERVER_ERROR = 'Erreur du serveur, réessaie dans un instant';

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

// Fetch the authenticated user's document (for displayName, etc.)
const getCurrentUser = async (db, uid) => {
  return db.collection('users').findOne({ _id: new ObjectId(uid) });
};

// Set the user's active household
const setUserHousehold = async (db, uid, householdId) => {
  await db.collection('users').updateOne(
    { _id: new ObjectId(uid) },
    { $set: { householdId: householdId ? new ObjectId(householdId) : null, updatedAt: new Date() } }
  );
};

// Create household
router.post('/', async (req, res) => {
  try {
    const name = asString(req.body?.name, 60).trim();
    const db = getDB();
    const currentUser = await getCurrentUser(db, req.user.uid);

    const household = {
      name,
      createdBy: req.user.uid,
      ...(await newInviteCode(db)),
      members: [{
        userId: req.user.uid,
        email: req.user.email,
        displayName: currentUser?.displayName || req.user.email,
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

    res.status(201).json({ household });
  } catch (error) {
    console.error('Create household error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Get user's households
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const households = await db.collection('households')
      .find({ 'members.userId': req.user.uid })
      .toArray();

    res.json({ households: await Promise.all(households.map(h => withFreshInviteCode(db, h))) });
  } catch (error) {
    console.error('Get households error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Get household by ID
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const household = await db.collection('households').findOne({
      _id: new ObjectId(req.params.id),
      'members.userId': req.user.uid
    });

    if (!household) {
      return res.status(404).json({ error: 'Foyer introuvable' });
    }

    res.json({ household: await withFreshInviteCode(db, household) });
  } catch (error) {
    console.error('Get household error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Join household with invite code
router.post('/join', joinHouseholdLimiter, async (req, res) => {
  try {
    const inviteCode = asString(req.body?.inviteCode, 32).trim().toUpperCase();
    if (!inviteCode) {
      return res.status(400).json({ error: 'Entre un code ami' });
    }
    const db = getDB();

    const household = await db.collection('households').findOne({ inviteCode, inviteCodeExpiresAt: { $gt: new Date() } });

    if (!household) {
      return res.status(404).json({ error: "Ce code ami n'est pas valide. Les codes changent chaque jour : demande le code du jour à un membre du foyer" });
    }

    // Check if already a member
    const isMember = household.members.some(m => m.userId === req.user.uid);
    if (isMember) {
      return res.status(400).json({ error: 'Tu fais déjà partie de ce foyer' });
    }

    const currentUser = await getCurrentUser(db, req.user.uid);

    // Add member
    const newMember = {
      userId: req.user.uid,
      email: req.user.email,
      displayName: currentUser?.displayName || req.user.email,
      role: 'member',
      joinedAt: new Date()
    };

    const result = await db.collection('households').findOneAndUpdate(
      { _id: household._id },
      {
        $push: { members: newMember },
        $set: { updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    );

    // Switch the user's active household to the one they just joined
    await setUserHousehold(db, req.user.uid, household._id);

    res.json({ household: result });
  } catch (error) {
    console.error('Join household error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Regenerate invite code (admin only)
router.post('/:id/regenerate-invite', async (req, res) => {
  try {
    const db = getDB();
    const householdId = new ObjectId(req.params.id);

    const household = await db.collection('households').findOne({ _id: householdId });
    if (!household) {
      return res.status(404).json({ error: 'Foyer introuvable' });
    }

    const requester = household.members.find(m => m.userId === req.user.uid);
    if (!requester || requester.role !== 'admin') {
      return res.status(403).json({ error: 'Seul un admin du foyer peut générer un nouveau code' });
    }

    const result = await db.collection('households').findOneAndUpdate(
      { _id: householdId },
      { $set: { ...(await newInviteCode(db)), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    res.json({ household: result });
  } catch (error) {
    console.error('Regenerate invite error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Update a member's role (admin only)
router.put('/:id/members/:userId', async (req, res) => {
  try {
    const { role } = req.body;
    if (role !== 'admin' && role !== 'member') {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    const db = getDB();
    const householdId = new ObjectId(req.params.id);

    const household = await db.collection('households').findOne({ _id: householdId });
    if (!household) {
      return res.status(404).json({ error: 'Foyer introuvable' });
    }

    const requester = household.members.find(m => m.userId === req.user.uid);
    if (!requester || requester.role !== 'admin') {
      return res.status(403).json({ error: 'Seul un admin du foyer peut changer les rôles' });
    }

    const result = await db.collection('households').findOneAndUpdate(
      { _id: householdId, 'members.userId': req.params.userId },
      { $set: { 'members.$.role': role, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Membre introuvable' });
    }

    res.json({ household: await withFreshInviteCode(db, result) });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Remove a member (admin only)
router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const db = getDB();
    const householdId = new ObjectId(req.params.id);
    const targetUserId = req.params.userId;

    const household = await db.collection('households').findOne({ _id: householdId });
    if (!household) {
      return res.status(404).json({ error: 'Foyer introuvable' });
    }

    const requester = household.members.find(m => m.userId === req.user.uid);
    if (!requester || requester.role !== 'admin') {
      return res.status(403).json({ error: 'Seul un admin du foyer peut retirer un membre' });
    }

    if (targetUserId === req.user.uid) {
      return res.status(400).json({ error: 'Pour partir, utilise « Quitter le foyer »' });
    }

    const result = await db.collection('households').findOneAndUpdate(
      { _id: householdId },
      {
        $pull: { members: { userId: targetUserId } },
        $set: { updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    );

    // Clear the removed member's active household if it pointed here
    if (ObjectId.isValid(targetUserId)) {
      await db.collection('users').updateOne(
        { _id: new ObjectId(targetUserId), householdId: householdId },
        { $set: { householdId: null, updatedAt: new Date() } }
      );
    }

    // Their private documents: nobody can open them anymore
    await deleteDocuments({ householdId, createdBy: targetUserId, private: true });

    res.json({ household: await withFreshInviteCode(db, result) });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Leave household
router.delete('/:id/leave', async (req, res) => {
  try {
    const db = getDB();
    const householdId = new ObjectId(req.params.id);

    const household = await db.collection('households').findOne({ _id: householdId });

    // Only a member can leave (and thereby possibly delete) a household
    if (!household || !household.members.some(m => m.userId === req.user.uid)) {
      return res.status(404).json({ error: 'Foyer introuvable' });
    }

    // If last member or creator, delete household
    if (household.members.length === 1 || household.createdBy === req.user.uid) {
      await db.collection('households').deleteOne({ _id: householdId });
      // Its documents (ordonnances, papiers d'identité...) go with it
      await deleteDocuments({ householdId });
    } else {
      // Remove member
      await db.collection('households').updateOne(
        { _id: householdId },
        {
          $pull: { members: { userId: req.user.uid } },
          $set: { updatedAt: new Date() }
        }
      );
      // Their private documents: nobody can open them anymore
      await deleteDocuments({ householdId, createdBy: req.user.uid, private: true });
    }

    // Clear the user's active household if it pointed here
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.uid), householdId: householdId },
      { $set: { householdId: null, updatedAt: new Date() } }
    );

    res.json({ message: 'Left household successfully' });
  } catch (error) {
    console.error('Leave household error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

module.exports = router;

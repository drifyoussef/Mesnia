const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { requireHouseholdMember } = require('../middleware/household.middleware');
const { notify } = require('../services/notify');
const { publish } = require('../services/realtime');
const { todayIso } = require('../utils/dates');
const { handle } = require('../utils/handle');

// "What do we eat tonight?": every member swipes the same recipes, and it's a match as soon as
// everyone liked the same one. One session per household and day (French time):
// { householdId, date, round, recipeIds, votes: { [userId]: { [recipeId]: true | false } },
//   status: 'active' | 'matched', matchedRecipeId?, matchedAt?, createdAt }

const MAX_RECIPES = 30;

router.use(authenticateUser);
router.use('/:householdId', requireHouseholdMember);

/** Recipe order differs every day but is the same for every member. */
async function pickRecipes(householdId) {
  const recipes = await getDB().collection('recipes')
    .find({ householdId }, { projection: { _id: 1 } })
    .toArray();
  const ids = recipes.map(recipe => recipe._id.toString());
  for (let i = ids.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, MAX_RECIPES);
}

/** Today's session, created on first use (and refilled if the household had no recipe yet). */
async function todaySession(householdId) {
  const sessions = getDB().collection('swipe_sessions');
  const date = todayIso();
  let session = await sessions.findOne({ householdId, date });

  if (!session) {
    const doc = { householdId, date, round: 1, recipeIds: await pickRecipes(householdId), votes: {}, status: 'active', createdAt: new Date() };
    try {
      doc._id = (await sessions.insertOne(doc)).insertedId;
      return doc;
    } catch (error) {
      // Another member created it at the same moment (unique index on householdId + date)
      if (error.code !== 11000) throw error;
      return sessions.findOne({ householdId, date });
    }
  }

  if (session.recipeIds.length === 0) {
    const recipeIds = await pickRecipes(householdId);
    if (recipeIds.length > 0) {
      session = await sessions.findOneAndUpdate({ _id: session._id }, { $set: { recipeIds } }, { returnDocument: 'after' });
    }
  }
  return session;
}

/** What a member sees: their own votes and how far the others are, never the others' votes. */
function toClient(session, req) {
  const memberIds = req.memberIds;
  const finished = memberIds.filter(id => session.recipeIds.every(recipeId => recipeId in (session.votes?.[id] || {})));
  return {
    id: session._id.toString(),
    date: session.date,
    round: session.round || 1,
    status: session.status,
    recipeIds: session.recipeIds,
    myVotes: session.votes?.[req.user.uid] || {},
    matchedRecipeId: session.matchedRecipeId || null,
    memberCount: memberIds.length,
    finishedCount: finished.length
  };
}

router.get('/:householdId/session', handle('swipe', async (req, res) => {
  res.json({ session: toClient(await todaySession(req.householdId), req) });
}));

router.post('/:householdId/session/vote', handle('swipe', async (req, res) => {
  const { recipeId, liked } = req.body || {};
  if (typeof liked !== 'boolean') return res.status(400).json({ error: 'Vote invalide' });

  const session = await todaySession(req.householdId);
  if (typeof recipeId !== 'string' || !session.recipeIds.includes(recipeId)) {
    return res.status(404).json({ error: 'Recette introuvable dans la session du jour' });
  }
  if (session.status === 'matched') {
    return res.json({ session: toClient(session, req) });
  }

  // One vote per member and recipe: voting again replaces the previous vote
  let updated = await getDB().collection('swipe_sessions').findOneAndUpdate(
    { _id: session._id },
    { $set: { [`votes.${req.user.uid}.${recipeId}`]: liked } },
    { returnDocument: 'after' }
  );

  // Match: every current member liked this recipe. Conditional on "active", so two last
  // votes arriving together produce a single match.
  const everyoneLikes = req.memberIds.every(id => updated.votes?.[id]?.[recipeId] === true);
  if (liked && everyoneLikes) {
    const matched = await getDB().collection('swipe_sessions').findOneAndUpdate(
      { _id: session._id, status: 'active' },
      { $set: { status: 'matched', matchedRecipeId: recipeId, matchedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (matched) {
      updated = matched;
      const recipe = await getDB().collection('recipes').findOne({ _id: new ObjectId(recipeId) }, { projection: { title: 1 } });
      void notify({
        userIds: req.memberIds,
        excludeUserId: req.user.uid,
        type: 'swipe',
        title: "C'est un match ! 🎉",
        body: `Tout le monde est d'accord : ce sera « ${recipe?.title || 'la recette choisie'} »`,
        route: '/tabs/home'
      });
    }
  }

  publish(req.householdId, 'swipe', req.user.uid);
  res.json({ session: toClient(updated, req) });
}));

/** New round for today: after a match ("not that one after all") or when nothing matched. */
router.post('/:householdId/session/restart', handle('swipe', async (req, res) => {
  const session = await todaySession(req.householdId);
  const updated = await getDB().collection('swipe_sessions').findOneAndUpdate(
    { _id: session._id },
    {
      $set: { recipeIds: await pickRecipes(req.householdId), votes: {}, status: 'active', round: (session.round || 1) + 1 },
      $unset: { matchedRecipeId: '', matchedAt: '' }
    },
    { returnDocument: 'after' }
  );
  publish(req.householdId, 'swipe', req.user.uid);
  res.json({ session: toClient(updated, req) });
}));

/** Meals chosen together, most recent first. */
router.get('/:householdId/history', handle('swipe', async (req, res) => {
  const sessions = await getDB().collection('swipe_sessions')
    .find({ householdId: req.householdId, status: 'matched' })
    .sort({ date: -1 })
    .limit(30)
    .toArray();
  res.json({ history: sessions.map(session => ({ date: session.date, recipeId: session.matchedRecipeId })) });
}));

module.exports = router;

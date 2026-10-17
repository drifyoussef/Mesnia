const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { requireHouseholdMember } = require('../middleware/household.middleware');
const { addRecipe, getActiveList } = require('../services/shopping');
const { publish } = require('../services/realtime');
const { daysBetween } = require('../utils/dates');
const { handle } = require('../utils/handle');

// Meals planned for the week: one entry per day and meal.
// { householdId, date: "YYYY-MM-DD", slot: 'lunch' | 'dinner', recipeId? | label?, servings?, createdBy, updatedAt }
// An entry is either one of the household's recipes or free text ("Restaurant", "Restes").

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SLOTS = ['lunch', 'dinner'];
const MAX_RANGE_DAYS = 62;

router.use(authenticateUser);
router.use('/:householdId', requireHouseholdMember);

function toClient(entry) {
  const { _id, householdId, ...rest } = entry;
  return { ...rest, id: _id.toString(), householdId: householdId.toString() };
}

/** ?from=...&to=... (inclusive), checked and bounded. Sends the error response otherwise. */
function readRange(source, res) {
  const { from, to } = source || {};
  if (!DATE_PATTERN.test(from || '') || !DATE_PATTERN.test(to || '') || to < from) {
    res.status(400).json({ error: 'Période invalide' });
    return null;
  }
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    res.status(400).json({ error: 'Période trop longue' });
    return null;
  }
  return { from, to };
}

router.get('/:householdId', handle('meal-plan', async (req, res) => {
  const range = readRange(req.query, res);
  if (!range) return;
  const entries = await getDB().collection('meal_plans')
    .find({ householdId: req.householdId, date: { $gte: range.from, $lte: range.to } })
    .sort({ date: 1, slot: 1 })
    .toArray();
  res.json({ entries: entries.map(toClient) });
}));

/** Plans a meal (replaces what was planned for that day and meal). */
router.put('/:householdId', handle('meal-plan', async (req, res) => {
  const { date, slot, recipeId } = req.body || {};
  if (!DATE_PATTERN.test(date || '') || !SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Choisis un jour et un repas' });
  }

  const entry = {};
  if (recipeId) {
    if (typeof recipeId !== 'string' || !ObjectId.isValid(recipeId)) return res.status(404).json({ error: 'Recette introuvable' });
    const recipe = await getDB().collection('recipes').findOne(
      { _id: new ObjectId(recipeId), householdId: req.householdId },
      { projection: { _id: 1 } }
    );
    if (!recipe) return res.status(404).json({ error: 'Recette introuvable' });
    entry.recipeId = recipeId;
  } else {
    const label = typeof req.body.label === 'string' ? req.body.label.trim().slice(0, 80) : '';
    if (!label) return res.status(400).json({ error: 'Choisis une recette ou écris ce qui est prévu' });
    entry.label = label;
  }
  const servings = Number(req.body.servings);
  if (Number.isInteger(servings) && servings > 0 && servings <= 50) entry.servings = servings;

  const result = await getDB().collection('meal_plans').findOneAndUpdate(
    { householdId: req.householdId, date, slot },
    {
      $set: { ...entry, createdBy: req.user.uid, updatedAt: new Date() },
      $unset: { ...(entry.recipeId ? { label: '' } : { recipeId: '' }), ...(entry.servings ? {} : { servings: '' }) },
      $setOnInsert: { householdId: req.householdId, date, slot }
    },
    { upsert: true, returnDocument: 'after' }
  );

  publish(req.householdId, 'meal-plan', req.user.uid);
  res.json({ entry: toClient(result) });
}));

router.delete('/:householdId/:entryId', handle('meal-plan', async (req, res) => {
  if (!ObjectId.isValid(req.params.entryId)) return res.status(404).json({ error: 'Repas introuvable' });
  const result = await getDB().collection('meal_plans').deleteOne({ _id: new ObjectId(req.params.entryId), householdId: req.householdId });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Repas introuvable' });
  publish(req.householdId, 'meal-plan', req.user.uid);
  res.json({ message: 'Repas retiré' });
}));

/** Adds the ingredients of every planned recipe of the period to the shopping list. */
router.post('/:householdId/shopping', handle('meal-plan', async (req, res) => {
  const range = readRange(req.body, res);
  if (!range) return;

  const entries = await getDB().collection('meal_plans')
    .find({ householdId: req.householdId, date: { $gte: range.from, $lte: range.to }, recipeId: { $exists: true } })
    .toArray();
  const recipes = await getDB().collection('recipes')
    .find({ _id: { $in: [...new Set(entries.map(entry => entry.recipeId))].map(id => new ObjectId(id)) }, householdId: req.householdId })
    .toArray();
  const byId = new Map(recipes.map(recipe => [recipe._id.toString(), recipe]));

  let list = null;
  let added = 0;
  for (const entry of entries) {
    const recipe = byId.get(entry.recipeId);
    if (!recipe) continue;
    list = await addRecipe(req.householdId, recipe, entry.servings);
    added++;
  }

  if (added > 0) publish(req.householdId, 'shopping', req.user.uid);
  const { _id, householdId, version, ...rest } = list || await getActiveList(req.householdId);
  res.json({
    addedRecipes: added,
    shoppingList: { ...rest, _id: _id.toString(), id: _id.toString(), householdId: householdId.toString() }
  });
}));

module.exports = router;

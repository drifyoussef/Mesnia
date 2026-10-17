const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { requireHouseholdMember } = require('../middleware/household.middleware');
const { cleanItem, mergeItems, getActiveList, updateActiveList, addRecipe, MAX_ITEMS } = require('../services/shopping');
const { notify } = require('../services/notify');
const { publish } = require('../services/realtime');
const { handle } = require('../utils/handle');

router.use(authenticateUser);
router.use('/:householdId', requireHouseholdMember);

/** What the app expects: string ids. */
function toClient(list) {
  const { _id, householdId, version, ...rest } = list;
  return { ...rest, _id: _id.toString(), id: _id.toString(), householdId: householdId.toString() };
}

/** Answers with the list, tells the other open apps, and optionally notifies the members. */
function changed(req, res, list, { added } = {}) {
  publish(req.householdId, 'shopping', req.user.uid);
  if (added) {
    void notify({
      userIds: req.memberIds,
      excludeUserId: req.user.uid,
      type: 'shopping',
      title: 'Liste de courses',
      body: `${req.currentUser.displayName || 'Un membre'} a ajouté ${added}`,
      route: '/tabs/shopping',
      // One notification per author and household every 10 minutes, whatever the number of items
      throttleKey: `shopping:${req.householdId}:${req.user.uid}`
    });
  }
  res.json({ shoppingList: toClient(list) });
}

// Get or create active shopping list
router.get('/:householdId', handle('shopping', async (req, res) => {
  res.json({ shoppingList: toClient(await getActiveList(req.householdId)) });
}));

// Add recipe ingredients (a recipe of this household only), optionally for a number of servings
router.post('/:householdId/add-recipe', handle('shopping', async (req, res) => {
  const { recipeId } = req.body || {};
  if (typeof recipeId !== 'string' || !ObjectId.isValid(recipeId)) {
    return res.status(404).json({ error: 'Recette introuvable' });
  }

  const recipe = await getDB().collection('recipes').findOne({ _id: new ObjectId(recipeId), householdId: req.householdId });
  if (!recipe) {
    return res.status(404).json({ error: 'Recette introuvable' });
  }

  const servings = Number(req.body.servings);
  const list = await addRecipe(req.householdId, recipe, Number.isFinite(servings) && servings > 0 && servings <= 100 ? servings : undefined);
  changed(req, res, list, { added: `les ingrédients de « ${recipe.title} »` });
}));

// Replace the items (reorder, bulk edit...)
router.put('/:householdId', handle('shopping', async (req, res) => {
  if (!Array.isArray(req.body?.items)) {
    return res.status(400).json({ error: 'Liste invalide' });
  }
  const items = req.body.items.slice(0, MAX_ITEMS).map(item => cleanItem(item)).filter(Boolean);
  const list = await updateActiveList(req.householdId, () => ({ items }));
  changed(req, res, list);
}));

// Archive the list (the next read starts a fresh one)
router.post('/:householdId/complete', handle('shopping', async (req, res) => {
  const result = await getDB().collection('shopping_lists').findOneAndUpdate(
    { householdId: req.householdId, status: 'active' },
    { $set: { status: 'completed', completedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Aucune liste en cours' });
  changed(req, res, result);
}));

// Clear shopping list
router.delete('/:householdId/clear', handle('shopping', async (req, res) => {
  const list = await updateActiveList(req.householdId, () => ({ items: [], recipeIds: [] }));
  changed(req, res, list);
}));

// Add manual item to shopping list
router.post('/:householdId/add-item', handle('shopping', async (req, res) => {
  const item = cleanItem({ ...req.body, id: undefined, isChecked: false }, { addedManually: true });
  if (!item) {
    return res.status(400).json({ error: 'Donne un nom à cet article' });
  }

  const list = await updateActiveList(req.householdId, current => ({ items: mergeItems(current.items || [], [item]) }));
  changed(req, res, list, { added: `« ${item.name} »` });
}));

// Delete item from shopping list
router.delete('/:householdId/item/:itemId', handle('shopping', async (req, res) => {
  const list = await updateActiveList(req.householdId, current => ({
    items: (current.items || []).filter(item => item.id !== req.params.itemId)
  }));
  changed(req, res, list);
}));

// Toggle item checked status
router.patch('/:householdId/item/:itemId', handle('shopping', async (req, res) => {
  const isChecked = Boolean(req.body?.isChecked);
  const list = await updateActiveList(req.householdId, current => ({
    items: (current.items || []).map(item => {
      if (item.id !== req.params.itemId) return item;
      const { checked, ...rest } = item; // older items used "checked"
      return { ...rest, isChecked };
    })
  }));
  changed(req, res, list);
}));

module.exports = router;

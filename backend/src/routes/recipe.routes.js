const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { extractRecipeFromUrl } = require('../services/recipe-extractor');
const { ImportError } = require('../services/recipe-import/errors');
const { compressDataUri } = require('../services/recipe-import/image');
const { CATEGORIES, DIFFICULTIES, MEAL_TYPES } = require('../services/recipe-import/ai');
const { handle } = require('../utils/handle');

// All routes require authentication
router.use(authenticateUser);

// ---------- Validation of what the app sends ----------

const PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube', 'url', 'manual'];

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);
const positiveNumber = (value, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? Math.round(number * 100) / 100 : undefined;
};
const httpUrl = value => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value.slice(0, 2000) : undefined);

/**
 * Fields a client may set on a recipe, each checked and converted (everything else is decided
 * by the server). A field that is present but invalid is dropped; `null` clears it.
 */
const FIELDS = {
  title: value => text(value, 120),
  description: value => text(value, 1000),
  videoUrl: httpUrl,
  sourceUrl: httpUrl,
  sourcePlatform: value => (PLATFORMS.includes(value) ? value : undefined),
  ingredients: value => (Array.isArray(value) ? value.slice(0, 100).map(ingredient => ({
    name: text(ingredient?.name, 120) || '',
    quantity: positiveNumber(ingredient?.quantity, 100000),
    unit: text(ingredient?.unit, 30) || '',
    category: CATEGORIES.includes(ingredient?.category) ? ingredient.category : 'other'
  })).filter(ingredient => ingredient.name) : undefined),
  instructions: value => (Array.isArray(value) ? value.slice(0, 60).map(step => text(step, 2000)).filter(Boolean) : undefined),
  prepTime: value => positiveNumber(value, 24 * 60),
  cookTime: value => positiveNumber(value, 3 * 24 * 60),
  totalTime: value => positiveNumber(value, 4 * 24 * 60),
  difficulty: value => (DIFFICULTIES.includes(value) ? value : undefined),
  servings: value => positiveNumber(value, 100),
  toolsNeeded: value => (Array.isArray(value) ? value.slice(0, 30).map(tool => text(tool, 60)).filter(Boolean) : undefined),
  tags: value => (Array.isArray(value) ? value.slice(0, 15).map(tag => text(tag, 30)).filter(Boolean) : undefined),
  mealType: value => (MEAL_TYPES.includes(value) ? value : undefined),
  isFavorite: value => (typeof value === 'boolean' ? value : undefined)
};

function pickEditable(body) {
  const set = {};
  const unset = {};
  for (const [field, read] of Object.entries(FIELDS)) {
    if (body[field] === null) unset[field] = '';
    else if (body[field] !== undefined) {
      const value = read(body[field]);
      if (value !== undefined) set[field] = value;
    }
  }
  return { set, unset };
}

/**
 * Cover picture: a regular http(s) link is kept as is, an inline picture (data URI) is
 * compressed so recipe documents stay light; anything else is dropped.
 */
async function readImage(value) {
  if (typeof value !== 'string' || value === '') return undefined;
  if (/^https?:\/\//i.test(value)) return value.slice(0, 2000);
  const compressed = await compressDataUri(value);
  return typeof compressed === 'string' && compressed.startsWith('data:image/') ? compressed : undefined;
}

/** Mongo document -> what the app expects (string `id`, no `_id`). */
function toClient(recipe) {
  if (!recipe) return recipe;
  const { _id, ...rest } = recipe;
  return { ...rest, id: _id.toString(), householdId: recipe.householdId?.toString() };
}

async function getUserHouseholdId(uid) {
  const user = await getDB().collection('users').findOne({ _id: new ObjectId(uid) }, { projection: { householdId: 1 } });
  return user?.householdId ? user.householdId.toString() : null;
}

/**
 * Loads a recipe the authenticated user is allowed to touch (one of their household's).
 * Sends the error response itself and returns null otherwise.
 */
async function loadOwnRecipe(req, res) {
  if (!ObjectId.isValid(req.params.id)) {
    res.status(404).json({ error: 'Recette introuvable' });
    return null;
  }

  const [recipe, householdId] = await Promise.all([
    getDB().collection('recipes').findOne({ _id: new ObjectId(req.params.id) }),
    getUserHouseholdId(req.user.uid)
  ]);

  // Same answer whether it doesn't exist or belongs to another household: nothing to learn from it
  if (!recipe || !householdId || recipe.householdId?.toString() !== householdId) {
    res.status(404).json({ error: 'Recette introuvable' });
    return null;
  }
  return recipe;
}

// ---------- Import from a link (AI) ----------

// Free AI tiers have daily quotas: cap imports per user so one person can't drain them
const IMPORTS_PER_HOUR = 20;
// An import can hold a 60 MB video in memory: a few at a time, whoever asks
const MAX_CONCURRENT_IMPORTS = 3;
const importLog = new Map(); // uid -> timestamps of recent imports
let runningImports = 0;

function allowImport(uid) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  // Forget users with no recent import, so the map does not grow forever
  for (const [user, times] of importLog) {
    if (!times.some(time => time > hourAgo)) importLog.delete(user);
  }

  const recent = (importLog.get(uid) || []).filter(time => time > hourAgo);
  if (recent.length >= IMPORTS_PER_HOUR) {
    importLog.set(uid, recent);
    return false;
  }
  recent.push(Date.now());
  importLog.set(uid, recent);
  return true;
}

// Extract a recipe from any link: TikTok, Instagram, Facebook, YouTube, recipe websites...
router.post('/extract', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url.trim().slice(0, 2000) : '';
  if (!url) {
    return res.status(400).json({ error: 'Colle un lien pour importer une recette' });
  }
  if (runningImports >= MAX_CONCURRENT_IMPORTS) {
    return res.status(503).json({ error: 'Beaucoup d’imports en cours : réessaie dans une minute.' });
  }
  if (!allowImport(req.user.uid)) {
    return res.status(429).json({ error: "Tu as fait beaucoup d'imports cette heure-ci. Réessaie un peu plus tard." });
  }

  const startedAt = Date.now();
  runningImports++;
  try {
    const { recipe, meta } = await extractRecipeFromUrl(url);
    console.log(`[extract] ${meta.platform} -> "${recipe.title}" (${meta.model}, video: ${meta.usedVideo}, ${Date.now() - startedAt} ms)`);
    res.json({ recipe, meta });
  } catch (error) {
    if (error instanceof ImportError) {
      console.warn(`[extract] ${error.status} ${error.message}`, error.cause?.message || '');
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[extract] Unexpected error:', error);
    res.status(500).json({ error: "Erreur inattendue pendant l'import" });
  } finally {
    runningImports--;
  }
});

// ---------- CRUD, always scoped to the user's household ----------

// Create recipe (in the user's current household, whatever the body says)
router.post('/', handle('recipes', async (req, res) => {
  const householdId = await getUserHouseholdId(req.user.uid);
  if (!householdId) {
    return res.status(403).json({ error: 'Rejoins ou crée un foyer pour ajouter des recettes' });
  }

  const { set } = pickEditable(req.body || {});
  if (!set.title) {
    return res.status(400).json({ error: 'Donne un titre à ta recette' });
  }
  const imageUrl = await readImage(req.body?.imageUrl);

  const recipe = {
    ...set,
    ...(imageUrl ? { imageUrl } : {}),
    householdId: new ObjectId(householdId),
    createdBy: req.user.uid,
    isFavorite: Boolean(set.isFavorite),
    timesCooked: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const result = await getDB().collection('recipes').insertOne(recipe);
  recipe._id = result.insertedId;

  res.status(201).json({ recipe: toClient(recipe) });
}));

// Get recipes for household
router.get('/household/:householdId', handle('recipes', async (req, res) => {
  const householdId = await getUserHouseholdId(req.user.uid);
  if (!householdId || householdId !== req.params.householdId) {
    return res.status(403).json({ error: "Tu n'as pas accès à ce foyer" });
  }

  const query = { householdId: new ObjectId(householdId) };

  // Only plain values reach the query: {"$ne": null} and the like are ignored
  let filters = {};
  try {
    filters = typeof req.query.filters === 'string' ? JSON.parse(req.query.filters) : {};
  } catch {
    filters = {};
  }
  if (DIFFICULTIES.includes(filters?.difficulty)) query.difficulty = filters.difficulty;
  if (MEAL_TYPES.includes(filters?.mealType)) query.mealType = filters.mealType;
  const maxTime = positiveNumber(filters?.maxTime, 4 * 24 * 60);
  if (maxTime) query.totalTime = { $lte: maxTime };

  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  if (search) query.$text = { $search: search };

  const recipes = await getDB().collection('recipes')
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();

  res.json({ recipes: recipes.map(toClient) });
}));

// Get recipe by ID
router.get('/:id', handle('recipes', async (req, res) => {
  const recipe = await loadOwnRecipe(req, res);
  if (!recipe) return;
  res.json({ recipe: toClient(recipe) });
}));

// Update recipe
router.put('/:id', handle('recipes', async (req, res) => {
  const recipe = await loadOwnRecipe(req, res);
  if (!recipe) return;

  const { set, unset } = pickEditable(req.body || {});
  if ('title' in set && !set.title) delete set.title;
  if (req.body?.imageUrl === null || req.body?.imageUrl === '') unset.imageUrl = '';
  else if (req.body?.imageUrl !== undefined) {
    const imageUrl = await readImage(req.body.imageUrl);
    if (imageUrl) set.imageUrl = imageUrl;
  }

  const result = await getDB().collection('recipes').findOneAndUpdate(
    { _id: recipe._id },
    { $set: { ...set, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: 'after' }
  );

  res.json({ recipe: toClient(result) });
}));

// Delete recipe
router.delete('/:id', handle('recipes', async (req, res) => {
  const recipe = await loadOwnRecipe(req, res);
  if (!recipe) return;

  await getDB().collection('recipes').deleteOne({ _id: recipe._id });
  // It disappears from the meal plan too
  await getDB().collection('meal_plans').deleteMany({ householdId: recipe.householdId, recipeId: recipe._id.toString() });
  res.json({ message: 'Recette supprimée' });
}));

// Mark recipe as cooked
router.post('/:id/cooked', handle('recipes', async (req, res) => {
  const recipe = await loadOwnRecipe(req, res);
  if (!recipe) return;

  const result = await getDB().collection('recipes').findOneAndUpdate(
    { _id: recipe._id },
    {
      $inc: { timesCooked: 1 },
      $set: { lastCookedAt: new Date() }
    },
    { returnDocument: 'after' }
  );

  res.json({ recipe: toClient(result) });
}));

// Toggle favorite
router.post('/:id/favorite', handle('recipes', async (req, res) => {
  const recipe = await loadOwnRecipe(req, res);
  if (!recipe) return;

  const result = await getDB().collection('recipes').findOneAndUpdate(
    { _id: recipe._id },
    { $set: { isFavorite: !recipe.isFavorite, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );

  res.json({ recipe: toClient(result) });
}));

module.exports = router;

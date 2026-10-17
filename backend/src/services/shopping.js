const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { CATEGORIES } = require('./recipe-import/ai');

// The household's active shopping list: { householdId, status: 'active', items, recipeIds, version }
// item: { id, name, quantity?, unit, category, isChecked, recipeId?, recipeName?, addedManually?, createdAt }

const MAX_ITEMS = 500;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Accents, case and spaces do not make two different items ("Crème " = "creme"). */
const key = value => text(value, 120).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');

/** An item from the app, or built from a recipe ingredient, made safe to store. */
function cleanItem(raw, defaults = {}) {
  const name = text(raw?.name ?? raw?.item, 120);
  if (!name) return null;
  const quantity = Number(raw?.quantity);
  return {
    id: typeof raw?.id === 'string' && raw.id.length <= 64 ? raw.id : new ObjectId().toString(),
    name,
    ...(Number.isFinite(quantity) && quantity > 0 ? { quantity: Math.round(quantity * 100) / 100 } : {}),
    unit: text(raw?.unit, 30),
    category: CATEGORIES.includes(raw?.category) ? raw.category : 'other',
    isChecked: Boolean(raw?.isChecked ?? raw?.checked),
    ...(raw?.recipeId || defaults.recipeId ? { recipeId: String(raw?.recipeId || defaults.recipeId).slice(0, 64) } : {}),
    ...(raw?.recipeName || defaults.recipeName ? { recipeName: text(raw?.recipeName || defaults.recipeName, 120) } : {}),
    ...(raw?.addedManually || defaults.addedManually ? { addedManually: true } : {}),
    createdAt: raw?.createdAt ? new Date(raw.createdAt) : new Date()
  };
}

/**
 * Adds items to a list, merging each with an unchecked item of the same name and unit:
 * 200 g + 300 g of flour from two recipes give one line of 500 g.
 */
function mergeItems(existing, incoming) {
  const items = existing.map(item => ({ ...item }));
  for (const item of incoming) {
    const twin = items.find(other => !other.isChecked && key(other.name) === key(item.name) && key(other.unit) === key(item.unit));
    if (!twin) {
      items.push(item);
      continue;
    }
    if (typeof twin.quantity === 'number' && typeof item.quantity === 'number') {
      twin.quantity = Math.round((twin.quantity + item.quantity) * 100) / 100;
    }
    if (item.recipeName && !(twin.recipeName || '').split(', ').includes(item.recipeName)) {
      twin.recipeName = twin.recipeName ? `${twin.recipeName}, ${item.recipeName}` : item.recipeName;
    }
  }
  return items.slice(0, MAX_ITEMS);
}

async function getActiveList(householdId) {
  const lists = getDB().collection('shopping_lists');
  const existing = await lists.findOne({ householdId, status: 'active' });
  if (existing) return existing;

  const list = { householdId, items: [], recipeIds: [], status: 'active', version: 0, createdAt: new Date(), updatedAt: new Date() };
  try {
    list._id = (await lists.insertOne(list)).insertedId;
    return list;
  } catch {
    return lists.findOne({ householdId, status: 'active' });
  }
}

/**
 * Read-modify-write of the active list, safe when two members change it at the same time:
 * the write only succeeds if nobody else wrote in between (version), otherwise it starts over.
 * @param {(list) => { items?: object[], recipeIds?: string[] }} change
 */
async function updateActiveList(householdId, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const list = await getActiveList(householdId);
    const next = change(list);
    const result = await getDB().collection('shopping_lists').findOneAndUpdate(
      { _id: list._id, version: list.version ?? { $exists: false } },
      { $set: { ...next, version: (list.version || 0) + 1, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (result) return result;
  }
  throw new Error('Shopping list is changing too fast, gave up after 5 attempts');
}

/** Adds a recipe's ingredients (scaled to `servings` when given) to the active list. */
function addRecipe(householdId, recipe, servings) {
  const factor = servings && recipe.servings ? servings / recipe.servings : 1;
  const items = (recipe.ingredients || [])
    .map(ingredient => cleanItem(
      { ...ingredient, quantity: ingredient.quantity ? ingredient.quantity * factor : undefined, isChecked: false, id: undefined },
      { recipeId: recipe._id.toString(), recipeName: recipe.title }
    ))
    .filter(Boolean);

  return updateActiveList(householdId, list => ({
    items: mergeItems(list.items || [], items),
    recipeIds: [...new Set([...(list.recipeIds || []), recipe._id.toString()])]
  }));
}

module.exports = { cleanItem, mergeItems, getActiveList, updateActiveList, addRecipe, MAX_ITEMS };

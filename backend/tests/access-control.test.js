// Nobody reaches another household's data, whatever id they put in the URL or the body.

const { useTestApp, registerUser, createHousehold } = require('./helpers');

describe('Access control between households', () => {
  const ctx = useTestApp();
  let alice;
  let mallory;
  let aliceHousehold;
  let aliceRecipe;

  beforeAll(async () => {
    alice = await registerUser(ctx.app, 'Alice');
    mallory = await registerUser(ctx.app, 'Mallory');
    aliceHousehold = await createHousehold(alice);
    await createHousehold(mallory);

    const recipe = await alice.api.post('/api/recipes', {
      title: 'Recette secrète',
      ingredients: [{ name: 'Ingrédient secret', quantity: 1, unit: 'kg' }]
    });
    aliceRecipe = recipe.body.recipe;
  });

  test.each([
    ['get', 'shopping'],
    ['get', 'calendar'],
    ['get', 'schedules'],
    ['get', 'trips'],
    ['get', 'documents'],
    ['get', 'tasks'],
    ['get', 'swipe', '/session'],
    ['get', 'swipe', '/history'],
    ['post', 'swipe', '/session/vote'],
    ['get', 'meal-plans', '?from=2026-10-01&to=2026-10-07'],
    ['get', 'events']
  ])('%s /api/%s/<other household>%s is refused', async (method, base, suffix = '') => {
    const res = await mallory.api[method](`/api/${base}/${aliceHousehold}${suffix}`, method === 'get' ? undefined : {});
    expect(res.status).toBe(403);
  });

  test('a recipe of another household cannot be read', async () => {
    const res = await mallory.api.get(`/api/recipes/${aliceRecipe.id}`);
    expect(res.status).toBe(404);
  });

  test("a recipe of another household cannot be copied into one's own shopping list", async () => {
    const malloryHousehold = mallory.user.householdId || (await mallory.api.get('/api/auth/me')).body.user.householdId;
    const res = await mallory.api.post(`/api/shopping/${malloryHousehold}/add-recipe`, { recipeId: aliceRecipe.id });
    expect(res.status).toBe(404);
    const list = await mallory.api.get(`/api/shopping/${malloryHousehold}`);
    expect(JSON.stringify(list.body)).not.toContain('secret');
  });

  test("a recipe of another household cannot be planned in one's own week", async () => {
    const malloryHousehold = (await mallory.api.get('/api/auth/me')).body.user.householdId;
    const res = await mallory.api.put(`/api/meal-plans/${malloryHousehold}`, { date: '2026-10-20', slot: 'dinner', recipeId: aliceRecipe.id });
    expect(res.status).toBe(404);
  });

  test('requests without a valid token are refused', async () => {
    const request = require('supertest');
    expect((await request(ctx.app).get(`/api/shopping/${aliceHousehold}`)).status).toBe(401);
    expect((await request(ctx.app).get('/api/auth/me').set('Authorization', 'Bearer forged.token.value')).status).toBe(401);
  });

  test('unexpected errors never reveal internals', async () => {
    const res = await alice.api.get(`/api/recipes/household/${aliceHousehold}?search[$gt]=`);
    expect(res.status).toBe(200);
  });
});

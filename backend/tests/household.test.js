const { useTestApp, registerUser, createHousehold, getDB } = require('./helpers');

describe('Households', () => {
  const ctx = useTestApp();

  test('several households can be created (regression: legacy unique index on invite_code)', async () => {
    for (const name of ['Un', 'Deux', 'Trois']) {
      const user = await registerUser(ctx.app, name);
      const res = await user.api.post('/api/households', { name: `Foyer ${name}` });
      expect(res.status).toBe(201);
    }
  });

  test('a household needs a name', async () => {
    const user = await registerUser(ctx.app, 'Sans');
    expect((await user.api.post('/api/households', { name: '  ' })).status).toBe(400);
  });

  test('the owner leaving hands the household over instead of deleting it', async () => {
    const owner = await registerUser(ctx.app, 'Owner');
    const member = await registerUser(ctx.app, 'Member');
    const householdId = await createHousehold(owner, member);
    await member.api.post('/api/recipes', { title: 'Gratin' });

    expect((await owner.api.delete(`/api/households/${householdId}/leave`)).status).toBe(200);

    const household = await member.api.get(`/api/households/${householdId}`);
    expect(household.body.household.createdBy).toBe(member.user.id);
    expect(household.body.household.members.map(m => m.role)).toEqual(['admin']);
    expect((await member.api.get(`/api/recipes/household/${householdId}`)).body.recipes).toHaveLength(1);
  });

  test('the last member leaving deletes the household and all its data', async () => {
    const user = await registerUser(ctx.app, 'Solo');
    const householdId = await createHousehold(user);
    await user.api.post('/api/recipes', { title: 'Soupe' });
    await user.api.post(`/api/tasks/${householdId}`, { title: 'Aspirateur' });
    await user.api.post(`/api/calendar/${householdId}`, { title: 'Dentiste', date: '2026-11-02' });

    expect((await user.api.delete(`/api/households/${householdId}/leave`)).status).toBe(200);

    const { ObjectId } = require('mongodb');
    const id = new ObjectId(householdId);
    for (const name of ['households', 'recipes', 'tasks', 'calendar_events']) {
      const filter = name === 'households' ? { _id: id } : { householdId: id };
      expect(await getDB().collection(name).countDocuments(filter)).toBe(0);
    }
  });

  test('the owner can be neither removed nor demoted, and only they can delete the household', async () => {
    const owner = await registerUser(ctx.app, 'Boss');
    const admin = await registerUser(ctx.app, 'Admin');
    const householdId = await createHousehold(owner, admin);
    await owner.api.put(`/api/households/${householdId}/members/${admin.user.id}`, { role: 'admin' });

    expect((await admin.api.put(`/api/households/${householdId}/members/${owner.user.id}`, { role: 'member' })).status).toBe(403);
    expect((await admin.api.delete(`/api/households/${householdId}/members/${owner.user.id}`)).status).toBe(403);
    expect((await admin.api.delete(`/api/households/${householdId}`)).status).toBe(403);

    expect((await owner.api.delete(`/api/households/${householdId}`)).status).toBe(200);
    expect((await admin.api.get('/api/auth/me')).body.user.householdId).toBeNull();
  });

  test('a removed member loses access and their private documents', async () => {
    const owner = await registerUser(ctx.app, 'Chef');
    const member = await registerUser(ctx.app, 'Parti');
    const householdId = await createHousehold(owner, member);
    await member.api.post(`/api/documents/${householdId}`, { title: 'Ordonnance', category: 'sante', private: true });

    expect((await owner.api.delete(`/api/households/${householdId}/members/${member.user.id}`)).status).toBe(200);
    expect((await member.api.get(`/api/documents/${householdId}`)).status).toBe(403);
    expect(await getDB().collection('documents').countDocuments({ createdBy: member.user.id })).toBe(0);
  });
});

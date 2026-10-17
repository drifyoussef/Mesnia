const { ObjectId } = require('mongodb');
const { useTestApp, registerUser, createHousehold, registerDevice, waitForEmail, codeIn, settle, sentPushes, sentEmails, getDB } = require('./helpers');
const { runDailyJobs } = require('../src/services/jobs');
const { todayIso, addDays } = require('../src/utils/dates');

describe('Shared features', () => {
  const ctx = useTestApp();
  let alice;
  let bob;
  let householdId;

  beforeAll(async () => {
    alice = await registerUser(ctx.app, 'Alice');
    bob = await registerUser(ctx.app, 'Bob');
    householdId = await createHousehold(alice, bob);
    await registerDevice(alice, 'token-alice');
    await registerDevice(bob, 'token-bob');
  });

  describe('Tasks', () => {
    test('are shared, and the assignee is notified', async () => {
      const created = await alice.api.post(`/api/tasks/${householdId}`, { title: 'Sortir les poubelles', assignedTo: bob.user.id });
      expect(created.status).toBe(201);
      await settle();
      expect(sentPushes).toEqual([expect.objectContaining({ tokens: ['token-bob'], title: 'Nouvelle tâche pour toi' })]);

      const list = await bob.api.get(`/api/tasks/${householdId}`);
      expect(list.body.tasks.map(t => t.title)).toContain('Sortir les poubelles');

      const done = await bob.api.post(`/api/tasks/${householdId}/${created.body.task.id}/toggle`);
      expect(done.body.task.done).toBe(true);
      expect(done.body.task.doneBy).toBe(bob.user.id);
    });

    test('a recurring task moves to its next date and to the next member', async () => {
      const today = todayIso();
      const created = await alice.api.post(`/api/tasks/${householdId}`, {
        title: 'Aspirateur', assignedTo: alice.user.id, dueDate: today, recurrence: { every: 'week', rotate: true }
      });
      const next = await alice.api.post(`/api/tasks/${householdId}/${created.body.task.id}/toggle`);
      expect(next.body.task.done).toBe(false);
      expect(next.body.task.dueDate).toBe(addDays(today, 7));
      expect(next.body.task.assignedTo).toBe(bob.user.id);
    });

    test('the assignee must be a member', async () => {
      const res = await alice.api.post(`/api/tasks/${householdId}`, { title: 'Vaisselle', assignedTo: new ObjectId().toString() });
      expect(res.body.task.assignedTo).toBeNull();
    });
  });

  describe('Swipe together', () => {
    test("it's a match only when every member liked the same recipe", async () => {
      await alice.api.post('/api/recipes', { title: 'Lasagnes' });
      await alice.api.post('/api/recipes', { title: 'Curry' });

      const session = (await alice.api.get(`/api/swipe/${householdId}/session`)).body.session;
      expect(session.recipeIds).toHaveLength(2);
      const [first, second] = session.recipeIds;

      let res = await alice.api.post(`/api/swipe/${householdId}/session/vote`, { recipeId: first, liked: true });
      expect(res.body.session.status).toBe('active');
      res = await bob.api.post(`/api/swipe/${householdId}/session/vote`, { recipeId: first, liked: false });
      expect(res.body.session.status).toBe('active');
      // Bob cannot see Alice's votes
      expect(res.body.session.myVotes).toEqual({ [first]: false });

      await alice.api.post(`/api/swipe/${householdId}/session/vote`, { recipeId: second, liked: true });
      sentPushes.length = 0;
      res = await bob.api.post(`/api/swipe/${householdId}/session/vote`, { recipeId: second, liked: true });
      expect(res.body.session.status).toBe('matched');
      expect(res.body.session.matchedRecipeId).toBe(second);

      await settle();
      expect(sentPushes).toEqual([expect.objectContaining({ tokens: ['token-alice'], title: "C'est un match ! 🎉" })]);
    });

    test('voting for a recipe outside the session is refused', async () => {
      const res = await alice.api.post(`/api/swipe/${householdId}/session/restart`);
      expect(res.body.session.round).toBe(2);
      const vote = await alice.api.post(`/api/swipe/${householdId}/session/vote`, { recipeId: new ObjectId().toString(), liked: true });
      expect(vote.status).toBe(404);
    });
  });

  describe('Meal plan and shopping list', () => {
    test('planned recipes go to the list, scaled to the servings and merged with what is there', async () => {
      const pasta = (await alice.api.post('/api/recipes', {
        title: 'Pâtes', servings: 2,
        ingredients: [{ name: 'Pâtes', quantity: 200, unit: 'g' }, { name: 'Crème', quantity: 20, unit: 'cl' }]
      })).body.recipe;
      await alice.api.post(`/api/shopping/${householdId}/add-item`, { name: 'creme ', quantity: 10, unit: 'cl' });

      const planned = await alice.api.put(`/api/meal-plans/${householdId}`, { date: '2026-10-19', slot: 'dinner', recipeId: pasta.id, servings: 4 });
      expect(planned.status).toBe(200);
      await alice.api.put(`/api/meal-plans/${householdId}`, { date: '2026-10-20', slot: 'lunch', label: 'Restaurant' });

      const week = await bob.api.get(`/api/meal-plans/${householdId}?from=2026-10-19&to=2026-10-25`);
      expect(week.body.entries).toHaveLength(2);

      const res = await bob.api.post(`/api/meal-plans/${householdId}/shopping`, { from: '2026-10-19', to: '2026-10-25' });
      expect(res.body.addedRecipes).toBe(1);
      const items = res.body.shoppingList.items;
      expect(items.find(i => i.name === 'Pâtes').quantity).toBe(400);
      // 10 cl added by hand + 40 cl from the recipe (20 cl for 2, planned for 4)
      const cream = items.filter(i => i.name.toLowerCase().startsWith('cr'));
      expect(cream).toHaveLength(1);
      expect(cream[0].quantity).toBe(50);
    });

    test('items always use isChecked', async () => {
      const list = (await alice.api.get(`/api/shopping/${householdId}`)).body.shoppingList;
      const item = list.items[0];
      const res = await alice.api.patch(`/api/shopping/${householdId}/item/${item.id}`, { isChecked: true });
      const updated = res.body.shoppingList.items.find(i => i.id === item.id);
      expect(updated.isChecked).toBe(true);
      expect(updated.checked).toBeUndefined();
    });
  });

  describe('Documents', () => {
    test('files are stored encrypted and come back intact', async () => {
      const doc = (await alice.api.post(`/api/documents/${householdId}`, { title: 'Passeport', category: 'identite' })).body.document;
      const pdf = Buffer.from('%PDF-1.4\nsecret passport number 123456789\n%%EOF');

      const upload = await alice.api.put(`/api/documents/${householdId}/${doc.id}/file`)
        .set('Content-Type', 'application/pdf').set('X-File-Name', 'passeport.pdf').send(pdf);
      expect(upload.status).toBe(200);

      const chunks = await getDB().collection('document_files.chunks').find().toArray();
      const stored = Buffer.concat(chunks.map(chunk => chunk.data.buffer));
      expect(stored.includes(Buffer.from('secret passport'))).toBe(false);

      const download = await bob.api.get(`/api/documents/${householdId}/${doc.id}/file`).buffer(true).parse((res, cb) => {
        const parts = [];
        res.on('data', part => parts.push(part));
        res.on('end', () => cb(null, Buffer.concat(parts)));
      });
      expect(download.status).toBe(200);
      expect(download.headers['content-security-policy']).toBe('sandbox');
      expect(Buffer.compare(download.body, pdf)).toBe(0);
    });

    test('files that are not a PDF or a photo are refused', async () => {
      const doc = (await alice.api.post(`/api/documents/${householdId}`, { title: 'Page', category: 'autre' })).body.document;
      const res = await alice.api.put(`/api/documents/${householdId}/${doc.id}/file`)
        .set('Content-Type', 'application/pdf').send(Buffer.from('<html><script>alert(1)</script></html>'));
      expect(res.status).toBe(400);
    });

    test('expiry reminders: push to the member, email to a confirmed address, sent once', async () => {
      // Bob confirms his address
      await bob.api.post('/api/auth/verify-email/send');
      const email = await waitForEmail(m => m.to === bob.email && /Confirmez/.test(m.subject));
      await bob.api.post('/api/auth/verify-email', { code: codeIn(email) });

      await alice.api.post(`/api/documents/${householdId}`, {
        title: 'Carte d’identité de Bob', category: 'identite', memberId: bob.user.id, expiresAt: addDays(todayIso(), 6)
      });
      sentPushes.length = 0;
      sentEmails.length = 0;

      const first = await runDailyJobs({ force: true });
      expect(first.documents).toBe(1);
      await settle();
      expect(sentPushes).toEqual([expect.objectContaining({ tokens: ['token-bob'], title: 'Document à renouveler' })]);
      const reminder = await waitForEmail(m => m.to === bob.email);
      expect(reminder.subject).toContain('expire dans 6 jours');

      const second = await runDailyJobs({ force: true });
      expect(second.documents).toBe(0);
    });
  });

  describe('Notification settings', () => {
    test('a disabled type is not sent', async () => {
      const prefs = await bob.api.put('/api/notifications/prefs', { tasks: false, sms: true });
      expect(prefs.body.prefs.tasks).toBe(false);
      expect(prefs.body.prefs.sms).toBeUndefined();

      sentPushes.length = 0;
      await alice.api.post(`/api/tasks/${householdId}`, { title: 'Courses', assignedTo: bob.user.id });
      await settle();
      expect(sentPushes).toHaveLength(0);
      await bob.api.put('/api/notifications/prefs', { tasks: true });
    });
  });
});

const request = require('supertest');
const { useTestApp, registerUser, authed, createHousehold, waitForEmail, codeIn, sentEmails, settle, getDB } = require('./helpers');

describe('Authentication', () => {
  const ctx = useTestApp();

  test('register stores the email in lower case and rejects the same address in another case', async () => {
    const first = await request(ctx.app).post('/api/auth/register')
      .send({ email: '  Jean.Dupont@Example.COM ', password: 'correct-horse-battery', displayName: 'Jean' });
    expect(first.status).toBe(201);
    expect(first.body.user.email).toBe('jean.dupont@example.com');
    expect(first.body.user.password).toBeUndefined();
    expect(first.body.user.emailVerified).toBe(false);

    const second = await request(ctx.app).post('/api/auth/register')
      .send({ email: 'JEAN.DUPONT@example.com', password: 'correct-horse-battery', displayName: 'Jean' });
    expect(second.status).toBe(400);

    const login = await request(ctx.app).post('/api/auth/login')
      .send({ email: 'jean.DUPONT@example.com', password: 'correct-horse-battery' });
    expect(login.status).toBe(200);
  });

  test('register refuses short passwords and invalid emails', async () => {
    const short = await request(ctx.app).post('/api/auth/register')
      .send({ email: 'short@example.com', password: 'abc123', displayName: 'Bob' });
    expect(short.status).toBe(400);

    const invalid = await request(ctx.app).post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'correct-horse-battery', displayName: 'Bob' });
    expect(invalid.status).toBe(400);
  });

  test('operators in place of strings never match an account', async () => {
    const res = await request(ctx.app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(401);
  });

  test('the confirmation code sent at sign-up confirms the address', async () => {
    const user = await registerUser(ctx.app, 'Clara');
    const email = await waitForEmail(m => m.to === user.email && /Confirmez/.test(m.subject));

    const wrong = await user.api.post('/api/auth/verify-email', { code: '000000' });
    expect(wrong.status).toBe(400);

    const ok = await user.api.post('/api/auth/verify-email', { code: codeIn(email) });
    expect(ok.status).toBe(200);
    expect(ok.body.user.emailVerified).toBe(true);
  });

  test('forgot-password gives the same answer whether the account exists or not', async () => {
    const user = await registerUser(ctx.app, 'Dan');
    const known = await request(ctx.app).post('/api/auth/forgot-password').send({ email: user.email });
    const unknown = await request(ctx.app).post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  test('password reset: code by email, single use, revokes the old sessions, sends an alert', async () => {
    const user = await registerUser(ctx.app, 'Eve');
    await request(ctx.app).post('/api/auth/forgot-password').send({ email: user.email });
    const email = await waitForEmail(m => m.to === user.email && /réinitialisation/.test(m.subject));
    expect(email.html).toContain(codeIn(email));

    const reset = await request(ctx.app).post('/api/auth/reset-password')
      .send({ email: user.email, code: codeIn(email), newPassword: 'another-long-password' });
    expect(reset.status).toBe(200);

    // The token from before the reset no longer works
    expect((await user.api.get('/api/auth/me')).status).toBe(401);
    // The code was single use
    const again = await request(ctx.app).post('/api/auth/reset-password')
      .send({ email: user.email, code: codeIn(email), newPassword: 'yet-another-password' });
    expect(again.status).toBe(400);

    const login = await request(ctx.app).post('/api/auth/login').send({ email: user.email, password: 'another-long-password' });
    expect(login.status).toBe(200);
    await waitForEmail(m => m.to === user.email && /a été modifié/.test(m.subject));
  });

  test('a reset code allows 5 attempts, then it is cancelled', async () => {
    const user = await registerUser(ctx.app, 'Finn');
    await request(ctx.app).post('/api/auth/forgot-password').send({ email: user.email });
    const email = await waitForEmail(m => m.to === user.email && /réinitialisation/.test(m.subject));
    const wrongCode = codeIn(email) === '123456' ? '654321' : '123456';

    for (let i = 0; i < 5; i++) {
      const res = await request(ctx.app).post('/api/auth/reset-password')
        .send({ email: user.email, code: wrongCode, newPassword: 'another-long-password' });
      expect(res.status).toBe(400);
    }
    const right = await request(ctx.app).post('/api/auth/reset-password')
      .send({ email: user.email, code: codeIn(email), newPassword: 'another-long-password' });
    expect(right.status).toBe(400);
  });

  test('change-password logs out the other devices and keeps this one', async () => {
    const user = await registerUser(ctx.app, 'Gus');
    const otherDevice = await request(ctx.app).post('/api/auth/login').send({ email: user.email, password: user.password });

    const res = await user.api.post('/api/auth/change-password', {
      currentPassword: user.password,
      newPassword: 'a-brand-new-password'
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    expect((await authed(ctx.app, otherDevice.body.token).get('/api/auth/me')).status).toBe(401);
    expect((await authed(ctx.app, res.body.token).get('/api/auth/me')).status).toBe(200);
  });

  test('the name in emails is escaped', async () => {
    const res = await request(ctx.app).post('/api/auth/register')
      .send({ email: 'html@example.com', password: 'correct-horse-battery', displayName: '<img src=x onerror=alert(1)>' });
    expect(res.status).toBe(201);
    const email = await waitForEmail(m => m.to === 'html@example.com');
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x');
  });

  test('profile name change is copied into the household member list', async () => {
    const user = await registerUser(ctx.app, 'Hugo');
    const householdId = await createHousehold(user);
    await user.api.put('/api/auth/profile', { displayName: 'Hugo B.' });
    const household = await user.api.get(`/api/households/${householdId}`);
    expect(household.body.household.members[0].displayName).toBe('Hugo B.');
    expect(household.body.household.members[0].email).toBeUndefined();
  });

  test('account deletion: wrong password refused, then everything goes and the household is handed over', async () => {
    const owner = await registerUser(ctx.app, 'Ines');
    const member = await registerUser(ctx.app, 'Jules');
    const householdId = await createHousehold(owner, member);

    expect((await owner.api.post('/api/auth/account/delete', { password: 'wrong' })).status).toBe(401);
    const res = await owner.api.post('/api/auth/account/delete', { password: owner.password });
    expect(res.status).toBe(200);

    expect((await owner.api.get('/api/auth/me')).status).toBe(401);
    const household = await member.api.get(`/api/households/${householdId}`);
    expect(household.status).toBe(200);
    expect(household.body.household.createdBy).toBe(member.user.id);
    expect(household.body.household.members).toHaveLength(1);
    expect(household.body.household.members[0].role).toBe('admin');
    expect(await getDB().collection('users').countDocuments({ email: owner.email })).toBe(0);
  });

  test('no email is sent for nothing', async () => {
    await settle();
    expect(sentEmails.filter(m => m.to === 'nobody@example.com')).toHaveLength(0);
  });
});

// Shared setup: an in-memory MongoDB, the app, and captured emails / push notifications.

const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { connectDB, closeDB, getDB } = require('../src/config/database');
const { createApp } = require('../src/app');
const { setTransport } = require('../src/services/email');
const { setPushSender } = require('../src/services/push');

const sentEmails = [];
const sentPushes = [];

/** Call in a describe(): starts a fresh database for the file and returns the app. */
function useTestApp() {
  const context = { app: null, mongo: null };

  beforeAll(async () => {
    context.mongo = await MongoMemoryServer.create();
    await connectDB(context.mongo.getUri(), 'mesnia-test');
    context.app = createApp();

    setTransport({
      sendMail: async message => {
        sentEmails.push(message);
        return { accepted: [message.to], rejected: [], messageId: `test-${sentEmails.length}` };
      }
    });
    setPushSender(async (tokens, message) => {
      sentPushes.push({ tokens, ...message });
      return { sent: tokens.length, deadTokens: [] };
    });
  });

  beforeEach(() => {
    sentEmails.length = 0;
    sentPushes.length = 0;
  });

  afterAll(async () => {
    setTransport(null);
    setPushSender(null);
    await closeDB();
    await context.mongo?.stop();
  });

  return context;
}

/** Emails and the background sending: wait until the expected email arrived. */
async function waitForEmail(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const email = sentEmails.find(predicate);
    if (email) return email;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected email was not sent');
}

const codeIn = email => email.text.match(/\b(\d{6})\b/)[1];

/** Waits for fire-and-forget work (notifications) to settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 50));

let counter = 0;

/** Registers an account and returns { token, user, email, password, api } */
async function registerUser(app, displayName = 'Alice') {
  counter++;
  const email = `${displayName.toLowerCase()}${counter}@example.com`;
  const password = 'correct-horse-battery';
  const res = await request(app).post('/api/auth/register').send({ email, password, displayName });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...res.body, email, password, api: authed(app, res.body.token) };
}

/** supertest with the Bearer token already set: api.get('/api/...') */
function authed(app, token) {
  const wrap = method => (url, body) => {
    const req = request(app)[method](url).set('Authorization', `Bearer ${token}`);
    return body === undefined ? req : req.send(body);
  };
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
}

/** Owner creates a household, the others join it with the invite code. */
async function createHousehold(owner, ...others) {
  const created = await owner.api.post('/api/households', { name: 'Maison' });
  if (created.status !== 201) throw new Error(`create household failed: ${created.status}`);
  const household = created.body.household;
  for (const member of others) {
    const joined = await member.api.post('/api/households/join', { inviteCode: household.inviteCode });
    if (joined.status !== 200) throw new Error(`join failed: ${joined.status} ${JSON.stringify(joined.body)}`);
  }
  return household._id;
}

async function registerDevice(user, token) {
  await user.api.post('/api/notifications/devices', { token, platform: 'android' });
}

module.exports = {
  useTestApp, registerUser, authed, createHousehold, registerDevice,
  waitForEmail, codeIn, settle, sentEmails, sentPushes, getDB
};

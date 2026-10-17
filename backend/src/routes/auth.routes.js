const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_OPTIONS } = require('../config/jwt');
const { asString } = require('../utils/input');
const { handle } = require('../utils/handle');
const { checkPassword, MAX_PASSWORD_LENGTH } = require('../services/password-policy');
const { removeMember } = require('../services/households');
const { compressDataUri } = require('../services/recipe-import/image');
const {
  sendPasswordResetEmail, sendEmailVerificationEmail, sendPasswordChangedEmail, sendInBackground
} = require('../services/email');
const {
  loginLimiter, registerLimiter, passwordResetLimiter, emailVerificationLimiter
} = require('../middleware/rate-limit.middleware');

/** Wrong codes allowed for one code: then a new one must be asked for */
const MAX_CODE_ATTEMPTS = 5;
const RESET_CODE_MINUTES = 15;
const VERIFICATION_CODE_MINUTES = 30;
/** Reset emails one account can receive per hour, whatever the IP addresses asking */
const MAX_RESET_EMAILS_PER_HOUR = 5;
const BCRYPT_ROUNDS = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Same answer whether the account exists or not: the response must not reveal it */
const FORGOT_PASSWORD_ANSWER = 'Si un compte existe avec cet email, un code vient d’y être envoyé';

/** Compared against when the account does not exist, so a login takes as long either way */
const DUMMY_HASH = bcrypt.hashSync('mesnia-dummy-password', BCRYPT_ROUNDS);

// ---------- Helpers ----------

const normalizeEmail = value => asString(value, 254).trim().toLowerCase();

/** The token carries tokenVersion: incrementing it revokes every token issued before. */
const signToken = user => jwt.sign(
  { userId: user._id.toString(), email: user.email, v: user.tokenVersion || 0 },
  JWT_SECRET,
  JWT_OPTIONS
);

/** Account as sent to the app: no password hash, string ids. */
function toClientUser(user) {
  const { _id, password, tokenVersion, ...rest } = user;
  return {
    ...rest,
    id: _id.toString(),
    householdId: user.householdId ? user.householdId.toString() : null,
    emailVerified: Boolean(user.emailVerified)
  };
}

/**
 * One-time codes (password reset, email confirmation) are stored as an HMAC, never in clear:
 * reading the database is not enough to use them. A plain hash would not do: a 6-digit code
 * has only 900 000 values, all hashed in a split second. Keyed with the server secret, the
 * HMAC reveals nothing without it.
 */
const hashCode = (purpose, code) => crypto.createHmac('sha256', JWT_SECRET).update(`${purpose}:${code}`).digest('hex');

function codeMatches(purpose, code, storedHash) {
  if (typeof storedHash !== 'string') return false; // record from before hashing: no longer valid
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashCode(purpose, code), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** 6 digits from a cryptographic source. Never logged: whoever reads the logs could use it. */
const newCode = () => crypto.randomInt(100000, 1000000).toString();

/** "jean.dupont@gmail.com" -> "je***@gmail.com": enough to tell requests apart in the logs */
const maskEmail = email => email.replace(/^([^@]{1,2})[^@]*(@.*)?$/, (_, start, domain) => `${start}***${domain || ''}`);

const findUserById = uid => getDB().collection('users').findOne({ _id: new ObjectId(uid) });

/**
 * Consumes one attempt of a stored code, atomically: parallel requests cannot try more codes
 * than allowed. Sends the error response itself and returns false when the code is wrong.
 */
async function checkStoredCode(res, collection, filter, purpose, code) {
  const record = await getDB().collection(collection).findOneAndUpdate(
    { ...filter, expiresAt: { $gt: new Date() } },
    { $inc: { attempts: 1 } },
    { returnDocument: 'after' }
  );
  if (!record) {
    res.status(400).json({ error: 'Ce code a expiré ou n’existe pas : demande un nouveau code' });
    return false;
  }
  if (record.attempts > MAX_CODE_ATTEMPTS) {
    await getDB().collection(collection).deleteOne({ _id: record._id });
    res.status(400).json({ error: 'Trop de codes incorrects : ce code est annulé, demande un nouveau code' });
    return false;
  }
  if (!codeMatches(purpose, code, record.codeHash)) {
    const left = MAX_CODE_ATTEMPTS - record.attempts;
    if (left <= 0) {
      await getDB().collection(collection).deleteOne({ _id: record._id });
      res.status(400).json({ error: 'Trop de codes incorrects : ce code est annulé, demande un nouveau code' });
    } else {
      res.status(400).json({ error: `Code incorrect : encore ${left} essai${left > 1 ? 's' : ''}` });
    }
    return false;
  }
  // Single use
  await getDB().collection(collection).deleteOne({ _id: record._id });
  return true;
}

async function sendVerificationCode(user) {
  const code = newCode();
  await getDB().collection('email_verifications').updateOne(
    { userId: user._id.toString() },
    {
      $set: {
        userId: user._id.toString(),
        codeHash: hashCode('email-verification', code),
        attempts: 0,
        expiresAt: new Date(Date.now() + VERIFICATION_CODE_MINUTES * 60 * 1000)
      }
    },
    { upsert: true }
  );
  sendInBackground(`verification to ${maskEmail(user.email)}`, () => sendEmailVerificationEmail(user.email, {
    code,
    displayName: user.displayName,
    validMinutes: VERIFICATION_CODE_MINUTES
  }));
}

/** New password: stored, every other session revoked, the owner warned by email. */
async function setPassword(user, newPassword) {
  const result = await getDB().collection('users').findOneAndUpdate(
    { _id: user._id },
    {
      $set: { password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS), updatedAt: new Date() },
      $inc: { tokenVersion: 1 }
    },
    { returnDocument: 'after' }
  );
  sendInBackground(`password changed for ${maskEmail(user.email)}`, () => sendPasswordChangedEmail(user.email, {
    displayName: user.displayName
  }));
  return result;
}

// ---------- Account ----------

router.post('/register', registerLimiter, handle('auth', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = asString(req.body?.password, MAX_PASSWORD_LENGTH);
  const displayName = asString(req.body?.displayName, 60).trim();
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: 'Remplis ton prénom, ton email et ton mot de passe' });
  }
  if (!EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Cet email n’est pas valide' });
  }
  const passwordError = await checkPassword(password);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const db = getDB();
  if (await db.collection('users').findOne({ email }, { projection: { _id: 1 } })) {
    return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
  }

  // A new user starts without a household. They create or join one
  // explicitly afterwards (see household routes).
  const user = {
    email,
    password: await bcrypt.hash(password, BCRYPT_ROUNDS),
    displayName,
    householdId: null,
    emailVerified: false,
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  try {
    user._id = (await db.collection('users').insertOne(user)).insertedId;
  } catch (error) {
    // Two sign-ups at the same time with the same email: the unique index keeps one
    if (error.code === 11000) return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
    throw error;
  }

  await sendVerificationCode(user);
  res.status(201).json({ user: toClientUser(user), token: signToken(user) });
}));

router.post('/login', loginLimiter, handle('auth', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = asString(req.body?.password, MAX_PASSWORD_LENGTH);
  if (!email || !password) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  const user = await getDB().collection('users').findOne({ email });
  // bcrypt runs even without an account: the response time does not tell whether it exists
  const isValidPassword = await bcrypt.compare(password, user?.password || DUMMY_HASH);
  if (!user || !isValidPassword) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  }

  res.json({ user: toClientUser(user), token: signToken(user) });
}));

router.get('/me', authenticateUser, handle('auth', async (req, res) => {
  const user = await findUserById(req.user.uid);
  if (!user) {
    return res.status(404).json({ error: 'Compte introuvable' });
  }
  res.json({ user: toClientUser(user) });
}));

router.put('/profile', authenticateUser, handle('auth', async (req, res) => {
  const displayName = asString(req.body?.displayName, 60).trim();
  // Inline picture (data URL), hence the large cap
  const avatar = asString(req.body?.avatar, 1024 * 1024);
  const db = getDB();

  const set = { updatedAt: new Date() };
  if (displayName) set.displayName = displayName;
  if (avatar) {
    const compressed = /^data:image\/(png|jpe?g|webp|heic);base64,/.test(avatar) ? await compressDataUri(avatar) : undefined;
    if (!compressed) return res.status(400).json({ error: 'Cette photo n’est pas valide' });
    set.avatar = compressed;
  }

  const result = await db.collection('users').findOneAndUpdate(
    { _id: new ObjectId(req.user.uid) },
    { $set: set },
    { returnDocument: 'after' }
  );
  if (!result) {
    return res.status(404).json({ error: 'Compte introuvable' });
  }

  // Households keep a copy of each member's name
  if (displayName) {
    await db.collection('households').updateMany(
      { 'members.userId': req.user.uid },
      { $set: { 'members.$[member].displayName': displayName } },
      { arrayFilters: [{ 'member.userId': req.user.uid }] }
    );
  }

  res.json({ user: toClientUser(result) });
}));

/** Deletes the account and what only it owns. Recipes, events... shared with the household stay. */
// POST, not DELETE: the password travels in the body, which some HTTP clients drop on DELETE
router.post('/account/delete', authenticateUser, loginLimiter, handle('auth', async (req, res) => {
  const password = asString(req.body?.password, MAX_PASSWORD_LENGTH);
  const user = await findUserById(req.user.uid);
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  if (!password || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }

  const db = getDB();
  const households = await db.collection('households').find({ 'members.userId': req.user.uid }).toArray();
  for (const household of households) {
    await removeMember(household, req.user.uid);
  }
  await Promise.all([
    db.collection('devices').deleteMany({ userId: req.user.uid }),
    db.collection('email_verifications').deleteMany({ userId: req.user.uid }),
    db.collection('password_resets').deleteMany({ email: user.email }),
    db.collection('users').deleteOne({ _id: user._id })
  ]);

  console.info(`[account] Deleted the account of ${maskEmail(user.email)}`);
  res.json({ message: 'Compte supprimé' });
}));

// ---------- Email confirmation ----------

router.post('/verify-email/send', authenticateUser, emailVerificationLimiter, handle('auth', async (req, res) => {
  const user = await findUserById(req.user.uid);
  if (!user) return res.status(404).json({ error: 'Compte introuvable' });
  if (user.emailVerified) return res.json({ message: 'Ton email est déjà confirmé' });

  await sendVerificationCode(user);
  res.json({ message: 'Code envoyé' });
}));

router.post('/verify-email', authenticateUser, emailVerificationLimiter, handle('auth', async (req, res) => {
  const code = asString(req.body?.code, 12).trim();
  if (!code) return res.status(400).json({ error: 'Entre le code reçu par email' });

  const ok = await checkStoredCode(res, 'email_verifications', { userId: req.user.uid }, 'email-verification', code);
  if (!ok) return;

  const result = await getDB().collection('users').findOneAndUpdate(
    { _id: new ObjectId(req.user.uid) },
    { $set: { emailVerified: true, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  res.json({ user: toClientUser(result) });
}));

// ---------- Password ----------

router.post('/change-password', authenticateUser, loginLimiter, handle('auth', async (req, res) => {
  const currentPassword = asString(req.body?.currentPassword, MAX_PASSWORD_LENGTH);
  const newPassword = asString(req.body?.newPassword, MAX_PASSWORD_LENGTH);
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Entre ton mot de passe actuel et le nouveau' });
  }

  const user = await findUserById(req.user.uid);
  if (!user) {
    return res.status(404).json({ error: 'Compte introuvable' });
  }
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
  }
  const passwordError = await checkPassword(newPassword);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const updated = await setPassword(user, newPassword);
  // The other devices are logged out; this one gets a fresh token
  res.json({ message: 'Mot de passe changé', user: toClientUser(updated), token: signToken(updated) });
}));

/** "Log out of all devices": revokes every token, this device gets a fresh one. */
router.post('/logout-all', authenticateUser, handle('auth', async (req, res) => {
  const updated = await getDB().collection('users').findOneAndUpdate(
    { _id: new ObjectId(req.user.uid) },
    { $inc: { tokenVersion: 1 }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  // Notifications must stop on the devices that were logged out
  await getDB().collection('devices').deleteMany({ userId: req.user.uid, token: { $ne: asString(req.body?.keepDeviceToken, 4096) } });
  res.json({ token: signToken(updated) });
}));

router.post('/forgot-password', passwordResetLimiter, handle('auth', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ error: 'Entre ton email' });
  }

  const db = getDB();
  const user = await db.collection('users').findOne({ email });
  if (!user) {
    console.info(`[forgot-password] No account for ${maskEmail(email)}: no email sent`);
    return res.json({ message: FORGOT_PASSWORD_ANSWER });
  }

  // Per account, on top of the per-IP limit: requests spread over many IPs gain nothing
  const existing = await db.collection('password_resets').findOne({ email });
  const windowStart = existing?.windowStart > new Date(Date.now() - 60 * 60 * 1000) ? existing.windowStart : new Date();
  const sentInWindow = existing?.windowStart?.getTime() === windowStart.getTime() ? (existing.sentInWindow || 0) : 0;
  if (sentInWindow >= MAX_RESET_EMAILS_PER_HOUR) {
    console.info(`[forgot-password] Hourly limit reached for ${maskEmail(email)}: no email sent`);
    return res.json({ message: FORGOT_PASSWORD_ANSWER });
  }

  const resetCode = newCode();
  await db.collection('password_resets').updateOne(
    { email },
    {
      $set: {
        email,
        codeHash: hashCode('password-reset', resetCode),
        attempts: 0,
        expiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60 * 1000),
        windowStart,
        sentInWindow: sentInWindow + 1,
        createdAt: new Date()
      },
      // Code of an earlier request, stored in clear before hashing
      $unset: { code: '' }
    },
    { upsert: true }
  );

  // Sent after answering: the response time does not reveal whether the account exists
  sendInBackground(`reset code to ${maskEmail(email)}`, () => sendPasswordResetEmail(email, {
    code: resetCode,
    displayName: user.displayName,
    validMinutes: RESET_CODE_MINUTES
  }));
  res.json({ message: FORGOT_PASSWORD_ANSWER });
}));

router.post('/reset-password', passwordResetLimiter, handle('auth', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = asString(req.body?.code, 12).trim();
  const newPassword = asString(req.body?.newPassword, MAX_PASSWORD_LENGTH);

  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Entre le code reçu par email et ton nouveau mot de passe' });
  }
  const passwordError = await checkPassword(newPassword);
  if (passwordError) {
    return res.status(400).json({ error: passwordError });
  }

  const ok = await checkStoredCode(res, 'password_resets', { email }, 'password-reset', code);
  if (!ok) return;

  const user = await getDB().collection('users').findOne({ email });
  if (!user) {
    return res.status(404).json({ error: 'Compte introuvable' });
  }

  // Receiving the code proves the address belongs to them
  await getDB().collection('users').updateOne({ _id: user._id }, { $set: { emailVerified: true } });
  const updated = await setPassword(user, newPassword);
  res.json({ message: 'Mot de passe réinitialisé', user: toClientUser(updated) });
}));

module.exports = router;

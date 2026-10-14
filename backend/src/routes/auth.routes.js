const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { JWT_SECRET, JWT_OPTIONS } = require('../config/jwt');
const { asString } = require('../utils/input');
const { loginLimiter, registerLimiter, passwordResetLimiter } = require('../middleware/rate-limit.middleware');

const MIN_PASSWORD_LENGTH = 6;
/** Shown to the user: the technical details stay in the server log */
const SERVER_ERROR = 'Erreur du serveur, réessaie dans un instant';
/** Wrong codes allowed for one reset request: then a new code must be asked for */
const MAX_RESET_ATTEMPTS = 5;

const signToken = user => jwt.sign({ userId: user._id.toString(), email: user.email }, JWT_SECRET, JWT_OPTIONS);

/**
 * Reset codes are stored as an HMAC, never in clear: reading the database is not enough to
 * reset an account. A plain hash would not do: a 6-digit code has only 900 000 values, all
 * hashed in a split second. Keyed with the server secret, the HMAC reveals nothing without it.
 */
const hashResetCode = code => crypto.createHmac('sha256', JWT_SECRET).update(`password-reset:${code}`).digest('hex');

function resetCodeMatches(code, storedHash) {
  if (typeof storedHash !== 'string') return false; // record from before hashing: no longer valid
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashResetCode(code), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/** "jean.dupont@gmail.com" -> "je***@gmail.com": enough to tell requests apart in the logs */
const maskEmail = email => email.replace(/^([^@]{1,2})[^@]*(@.*)?$/, (_, start, domain) => `${start}***${domain || ''}`);

async function sendResetEmail(to, code) {
  return transporter.sendMail({
    from: `"Mesnia" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Réinitialisation de votre mot de passe Mesnia',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2>Réinitialisation du mot de passe</h2>
        <p>Voici votre code de réinitialisation (valable 15 minutes) :</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:#f4f4f4;border-radius:8px;margin:20px 0">
          ${code}
        </div>
        <p style="color:#888;font-size:13px">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      </div>
    `,
  });
}

// Register new user
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const email = asString(req.body?.email, 254).trim();
    const password = asString(req.body?.password, 200);
    const displayName = asString(req.body?.displayName, 60).trim();
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'Remplis ton prénom, ton email et ton mot de passe' });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }
    const db = getDB();

    // Check if user already exists
    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // A new user starts without a household. They create or join one
    // explicitly afterwards (see household routes).
    const user = {
      email,
      password: hashedPassword,
      displayName,
      householdId: null,
      role: 'admin',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('users').insertOne(user);
    user._id = result.insertedId;

    const token = signToken(user);

    // Remove password from response and map _id to id
    delete user.password;
    const userResponse = {
      ...user,
      id: user._id.toString(),
      householdId: user.householdId ? user.householdId.toString() : null
    };
    delete userResponse._id;

    res.status(201).json({ user: userResponse, token });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Login user
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = asString(req.body?.email, 254).trim();
    const password = asString(req.body?.password, 200);
    if (!email || !password) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    const db = getDB();

    // Find user
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const token = signToken(user);
    
    // Remove password from response and map _id to id
    delete user.password;
    const userResponse = {
      ...user,
      id: user._id.toString(),
      householdId: user.householdId ? user.householdId.toString() : null
    };
    delete userResponse._id;
    
    res.json({ user: userResponse, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Get user profile
router.get('/me', authenticateUser, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.user.uid) },
      { projection: { password: 0 } }
    );
    
    if (!user) {
      return res.status(404).json({ error: 'Compte introuvable' });
    }
    
    // Map _id to id
    const userResponse = {
      ...user,
      id: user._id.toString(),
      householdId: user.householdId ? user.householdId.toString() : null
    };
    delete userResponse._id;
    
    res.json({ user: userResponse });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Update user profile
router.put('/profile', authenticateUser, async (req, res) => {
  try {
    const displayName = asString(req.body?.displayName, 60).trim();
    // Inline picture (data URL), hence the large cap
    const avatar = asString(req.body?.avatar, 1024 * 1024);
    const db = getDB();
    
    const updateData = {
      updatedAt: new Date()
    };
    
    if (displayName) updateData.displayName = displayName;
    if (avatar) updateData.avatar = avatar;
    
    const result = await db.collection('users').findOneAndUpdate(
      { _id: new ObjectId(req.user.uid) },
      { $set: updateData },
      { returnDocument: 'after', projection: { password: 0 } }
    );
    
    // Map _id to id
    const userResponse = {
      ...result,
      id: result._id.toString(),
      householdId: result.householdId ? result.householdId.toString() : null
    };
    delete userResponse._id;

    res.json({ user: userResponse });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Change password
router.post('/change-password', authenticateUser, async (req, res) => {
  try {
    const currentPassword = asString(req.body?.currentPassword, 200);
    const newPassword = asString(req.body?.newPassword, 200);
    const db = getDB();

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Entre ton mot de passe actuel et le nouveau' });
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }
    
    // Find user
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.uid) });
    if (!user) {
      return res.status(404).json({ error: 'Compte introuvable' });
    }
    
    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    const result = await db.collection('users').findOneAndUpdate(
      { _id: new ObjectId(req.user.uid) },
      { $set: { password: hashedPassword, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { password: 0 } }
    );
    
    // Map _id to id
    const userResponse = {
      ...result,
      id: result._id.toString(),
      householdId: result.householdId ? result.householdId.toString() : null
    };
    delete userResponse._id;

    res.json({ message: 'Password changed successfully', user: userResponse });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Request password reset
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const email = asString(req.body?.email, 254).trim();
    if (!email) {
      return res.status(400).json({ error: 'Entre ton email' });
    }

    const db = getDB();
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      // For security, don't reveal if email exists (to the client: the server log says it)
      console.info(`[forgot-password] No account for ${maskEmail(email)}: no email sent`);
      return res.status(200).json({ message: 'If the email exists, a reset code has been sent' });
    }

    // 6 digits from a cryptographic source. Never logged: whoever reads the logs could reset the account.
    const resetCode = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db.collection('password_resets').updateOne(
      { email },
      {
        $set: {
          email,
          codeHash: hashResetCode(resetCode),
          attempts: 0,
          expiresAt,
          createdAt: new Date()
        },
        // Code of an earlier request, stored in clear before hashing
        $unset: { code: '' }
      },
      { upsert: true }
    );

    const info = await sendResetEmail(email, resetCode);
    console.info(`[forgot-password] Reset code emailed to ${maskEmail(email)} (accepted: ${info.accepted.length}, rejected: ${info.rejected.length}, id: ${info.messageId})`);

    res.json({ message: 'Reset code sent to your email' });
  } catch (error) {
    console.error('[forgot-password] Error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

// Verify reset code and reset password
router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  try {
    const email = asString(req.body?.email, 254).trim();
    const code = asString(req.body?.code, 12).trim();
    const newPassword = asString(req.body?.newPassword, 200);

    // Validate input
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Entre le code reçu par email et ton nouveau mot de passe' });
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }

    const db = getDB();
    const resetRecord = await db.collection('password_resets').findOne({ email });
    if (!resetRecord) {
      return res.status(400).json({ error: 'Aucune demande en cours pour cet email : demande un nouveau code' });
    }

    if (new Date() > resetRecord.expiresAt) {
      await db.collection('password_resets').deleteOne({ _id: resetRecord._id });
      return res.status(400).json({ error: 'Ce code a expiré (il est valable 15 minutes) : demande un nouveau code' });
    }

    if (!resetCodeMatches(code, resetRecord.codeHash)) {
      // A code can only be guessed a few times: after that, a new one must be requested
      const attempts = (resetRecord.attempts || 0) + 1;
      if (attempts >= MAX_RESET_ATTEMPTS) {
        await db.collection('password_resets').deleteOne({ _id: resetRecord._id });
        return res.status(400).json({ error: 'Trop de codes incorrects : ce code est annulé, demande un nouveau code' });
      }
      await db.collection('password_resets').updateOne({ _id: resetRecord._id }, { $set: { attempts } });
      const left = MAX_RESET_ATTEMPTS - attempts;
      return res.status(400).json({ error: `Code incorrect : encore ${left} essai${left > 1 ? 's' : ''}` });
    }

    // Single use: consumed before the password changes
    await db.collection('password_resets').deleteOne({ _id: resetRecord._id });

    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'Compte introuvable' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // By id: the account whose reset code was checked, and no other
    const result = await db.collection('users').findOneAndUpdate(
      { _id: user._id },
      { $set: { password: hashedPassword, updatedAt: new Date() } },
      { returnDocument: 'after', projection: { password: 0 } }
    );

    if (!result) {
      return res.status(404).json({ error: 'Impossible de changer le mot de passe, réessaie' });
    }

    // Map _id to id
    const userResponse = {
      ...result,
      id: result._id.toString(),
      householdId: result.householdId ? result.householdId.toString() : null
    };
    delete userResponse._id;

    res.json({ message: 'Password reset successfully', user: userResponse });
  } catch (error) {
    console.error('[reset-password] Error:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
});

module.exports = router;

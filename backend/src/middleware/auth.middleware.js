const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { JWT_SECRET, JWT_VERIFY_OPTIONS } = require('../config/jwt');
const { SERVER_ERROR } = require('../utils/handle');

const INVALID_SESSION = 'Session invalide : reconnecte-toi';

/**
 * Checks the Bearer token and loads the account. A token carries the account's tokenVersion
 * (`v`): changing or resetting the password, or "log out everywhere", increments it, which
 * revokes every token issued before. Tokens from before this field count as version 0.
 */
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Connecte-toi pour continuer' });
  }

  let decoded;
  try {
    decoded = jwt.verify(authHeader.slice('Bearer '.length), JWT_SECRET, JWT_VERIFY_OPTIONS);
  } catch (error) {
    const message = error.name === 'TokenExpiredError' ? 'Session expirée : reconnecte-toi' : INVALID_SESSION;
    return res.status(401).json({ error: message });
  }

  try {
    if (!ObjectId.isValid(decoded.userId)) return res.status(401).json({ error: INVALID_SESSION });
    const user = await getDB().collection('users').findOne(
      { _id: new ObjectId(decoded.userId) },
      { projection: { password: 0, avatar: 0 } }
    );
    if (!user || (user.tokenVersion || 0) !== (decoded.v || 0)) {
      return res.status(401).json({ error: INVALID_SESSION });
    }

    req.user = { uid: decoded.userId, email: user.email };
    req.currentUser = user;
    next();
  } catch (error) {
    console.error('[auth] Could not load the account:', error);
    res.status(500).json({ error: SERVER_ERROR });
  }
};

module.exports = { authenticateUser };

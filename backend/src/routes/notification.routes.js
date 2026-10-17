const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { authenticateUser } = require('../middleware/auth.middleware');
const { prefsOf, readPrefs } = require('../services/notify');
const { handle } = require('../utils/handle');

// Notification settings of the account, and the phones that receive its push notifications.
// devices: { token (FCM registration token, unique), userId, platform, updatedAt }

const PLATFORMS = ['android', 'ios', 'web'];

router.use(authenticateUser);

router.get('/prefs', handle('notifications', async (req, res) => {
  res.json({ prefs: prefsOf(req.currentUser) });
}));

router.put('/prefs', handle('notifications', async (req, res) => {
  const changes = readPrefs(req.body);
  const set = Object.fromEntries(Object.entries(changes).map(([key, value]) => [`notificationPrefs.${key}`, value]));
  if (Object.keys(set).length === 0) return res.status(400).json({ error: 'Aucun réglage reçu' });

  const user = await getDB().collection('users').findOneAndUpdate(
    { _id: new ObjectId(req.user.uid) },
    { $set: { ...set, updatedAt: new Date() } },
    { returnDocument: 'after', projection: { notificationPrefs: 1 } }
  );
  res.json({ prefs: prefsOf(user) });
}));

/** The app registers its push token after each login (a token moves to the account now using it). */
router.post('/devices', handle('notifications', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 4096) return res.status(400).json({ error: 'Jeton invalide' });
  const platform = PLATFORMS.includes(req.body.platform) ? req.body.platform : 'android';

  await getDB().collection('devices').updateOne(
    { token },
    { $set: { token, userId: req.user.uid, platform, updatedAt: new Date() } },
    { upsert: true }
  );
  res.json({ message: 'Appareil enregistré' });
}));

/** At logout: this phone stops receiving the account's notifications. */
router.post('/devices/remove', handle('notifications', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  await getDB().collection('devices').deleteOne({ token, userId: req.user.uid });
  res.json({ message: 'Appareil retiré' });
}));

module.exports = router;

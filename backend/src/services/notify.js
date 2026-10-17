// Who gets notified of what. Every notification has a type the user can switch off in the
// app settings (users.notificationPrefs), on top of the push / email channels themselves.

const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { sendPush } = require('./push');

const NOTIFICATION_TYPES = ['tasks', 'shopping', 'calendar', 'documents', 'swipe', 'household'];

const DEFAULT_PREFS = {
  push: true,
  email: true,
  tasks: true,
  shopping: true,
  calendar: true,
  documents: true,
  swipe: true,
  household: true
};

const prefsOf = user => ({ ...DEFAULT_PREFS, ...(user?.notificationPrefs || {}) });

/** Keeps only known boolean preferences from a client body. */
function readPrefs(body) {
  const prefs = {};
  for (const key of Object.keys(DEFAULT_PREFS)) {
    if (typeof body?.[key] === 'boolean') prefs[key] = body[key];
  }
  return prefs;
}

// Bursts (ten items added to the shopping list in a row) give a single notification
const lastSent = new Map();

function throttled(key, ms) {
  if (!key) return false;
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < ms) return true;
  lastSent.set(key, now);
  // Forget old keys so the map does not grow forever
  if (lastSent.size > 5000) {
    for (const [k, time] of lastSent) if (now - time > ms) lastSent.delete(k);
  }
  return false;
}

/**
 * Sends a push notification to the given users, according to their preferences.
 * Never throws: a notification that fails must not fail the action that triggered it.
 * @param {object} options
 * @param {string[]} options.userIds
 * @param {string} options.type       one of NOTIFICATION_TYPES
 * @param {string} options.title
 * @param {string} options.body
 * @param {string} [options.route]    page the app opens when the notification is tapped
 * @param {string} [options.excludeUserId] usually the author of the action
 * @param {string} [options.throttleKey] with throttleMs: at most one notification per key and period
 * @param {number} [options.throttleMs]
 */
async function notify({ userIds, type, title, body, route, excludeUserId, throttleKey, throttleMs = 10 * 60 * 1000 }) {
  try {
    const ids = [...new Set(userIds)].filter(id => id && id !== excludeUserId && ObjectId.isValid(id));
    if (ids.length === 0 || throttled(throttleKey, throttleMs)) return;

    const db = getDB();
    const users = await db.collection('users')
      .find({ _id: { $in: ids.map(id => new ObjectId(id)) } }, { projection: { notificationPrefs: 1 } })
      .toArray();
    const recipients = users.filter(user => prefsOf(user).push && prefsOf(user)[type]).map(user => user._id.toString());
    if (recipients.length === 0) return;

    const devices = await db.collection('devices').find({ userId: { $in: recipients } }).toArray();
    const { deadTokens } = await sendPush(devices.map(device => device.token), {
      title,
      body,
      data: { type, ...(route ? { route } : {}) }
    });
    if (deadTokens.length > 0) {
      await db.collection('devices').deleteMany({ token: { $in: deadTokens } });
    }
  } catch (error) {
    console.error(`[notify] ${type} notification failed:`, error);
  }
}

module.exports = { notify, prefsOf, readPrefs, DEFAULT_PREFS, NOTIFICATION_TYPES };

// Push notifications through Firebase Cloud Messaging (Android, and iOS via the APNs key
// uploaded to the Firebase project). Firebase is only the delivery channel: no Firebase
// Auth or database. Without FIREBASE_SERVICE_ACCOUNT, sending is a no-op (see PUSH-SETUP.md).

const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

/** Error codes meaning the token will never work again: the device is forgotten */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token'
]);

let messaging; // undefined: not initialized yet, null: push disabled
let customSender = null;

/** The service account JSON, as is or base64-encoded (easier to paste in a hosting dashboard). */
function readServiceAccount() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) return null;
  return JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
}

function getClient() {
  if (messaging !== undefined) return messaging;
  try {
    const serviceAccount = readServiceAccount();
    if (!serviceAccount) {
      console.info('[push] FIREBASE_SERVICE_ACCOUNT is not set: push notifications are disabled');
      messaging = null;
    } else {
      messaging = getMessaging(initializeApp({ credential: cert(serviceAccount) }, 'mesnia-push'));
    }
  } catch (error) {
    console.error('[push] Invalid FIREBASE_SERVICE_ACCOUNT, push notifications are disabled:', error.message);
    messaging = null;
  }
  return messaging;
}

/**
 * @param {string[]} tokens
 * @param {{ title: string, body: string, data?: Record<string, string> }} message
 * @returns {Promise<{ sent: number, deadTokens: string[] }>}
 */
async function sendPush(tokens, message) {
  if (tokens.length === 0) return { sent: 0, deadTokens: [] };
  if (customSender) return customSender(tokens, message);

  const client = getClient();
  if (!client) return { sent: 0, deadTokens: [] };

  const response = await client.sendEachForMulticast({
    tokens,
    notification: { title: message.title, body: message.body },
    data: message.data || {},
    android: { priority: 'high', notification: { color: '#74B39D', channelId: 'default' } },
    apns: { payload: { aps: { sound: 'default' } } }
  });

  const deadTokens = response.responses
    .map((result, index) => (!result.success && DEAD_TOKEN_CODES.has(result.error?.code) ? tokens[index] : null))
    .filter(Boolean);
  return { sent: response.successCount, deadTokens };
}

/** Tests replace the real sender (null restores it). */
function setPushSender(sender) {
  customSender = sender;
}

module.exports = { sendPush, setPushSender };

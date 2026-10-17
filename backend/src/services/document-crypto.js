// Household documents (identity papers, prescriptions, tax notices) are encrypted before they
// reach the database: someone who gets the database (a leaked Atlas password, a backup) only
// sees noise. AES-256-GCM, a fresh 12-byte IV per file, the key comes from
// DOCUMENTS_ENCRYPTION_KEY (any long random string, hashed into a 256-bit key).
// Losing that key means losing the files: keep a copy somewhere safe.
// Stored layout: IV (12 bytes) | ciphertext | auth tag (16 bytes)

const crypto = require('crypto');

const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_KEY_LENGTH = 32;

function key() {
  const secret = process.env.DOCUMENTS_ENCRYPTION_KEY;
  if (!secret || secret.length < MIN_KEY_LENGTH) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

const isEnabled = () => key() !== null;

/** In production the key is required; elsewhere files are stored in clear with a warning. */
function assertKeyConfigured() {
  if (isEnabled()) return;
  const message =
    `DOCUMENTS_ENCRYPTION_KEY is missing or too short (${MIN_KEY_LENGTH} characters minimum). Generate one with:\n` +
    '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"';
  if (process.env.NODE_ENV === 'production') throw new Error(message);
  console.warn(`⚠️ ${message}\n   Documents are stored WITHOUT encryption.`);
}

function encrypt(buffer) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  return Buffer.concat([iv, cipher.update(buffer), cipher.final(), cipher.getAuthTag()]);
}

function decrypt(payload) {
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(IV_BYTES, payload.length - TAG_BYTES)), decipher.final()]);
}

module.exports = { encrypt, decrypt, isEnabled, assertKeyConfigured };

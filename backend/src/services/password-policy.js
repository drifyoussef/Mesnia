// Password rules: a minimum length, and no password already published in a data breach
// (checked against Have I Been Pwned with k-anonymity: only the first 5 characters of the
// SHA-1 hash leave the server, never the password). If the service is unreachable, the
// password is accepted: an outage must not block sign-ups.

const crypto = require('crypto');

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const BREACH_CHECK_TIMEOUT_MS = 3000;

async function isBreached(password) {
  if (process.env.PASSWORD_BREACH_CHECK === 'off' || process.env.NODE_ENV === 'test') return false;
  const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(BREACH_CHECK_TIMEOUT_MS)
    });
    if (!response.ok) return false;
    const suffix = hash.slice(5);
    return (await response.text()).split('\n').some(line => {
      const [candidate, count] = line.trim().split(':');
      return candidate === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

/** @returns {Promise<string|null>} the message to show, or null when the password is fine */
async function checkPassword(password) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`;
  }
  if (await isBreached(password)) {
    return 'Ce mot de passe apparaît dans des fuites de données connues : choisis-en un autre';
  }
  return null;
}

module.exports = { checkPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH };

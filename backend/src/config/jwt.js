// Key that signs the session tokens. There is deliberately no default value: a key written
// in the code can be read by anyone with access to the repository, who could then forge a
// valid token for any account.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET is missing or too short (32 characters minimum). Generate one with:\n' +
    '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n' +
    'and add it to backend/.env (and to the production environment variables).'
  );
}

const JWT_OPTIONS = { algorithm: 'HS256', expiresIn: '30d' };
const JWT_VERIFY_OPTIONS = { algorithms: ['HS256'] };

module.exports = { JWT_SECRET, JWT_OPTIONS, JWT_VERIFY_OPTIONS };

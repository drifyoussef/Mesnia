const rateLimit = require('express-rate-limit');

// Per IP address. Behind a reverse proxy (Render, Railway, Nginx...), set TRUST_PROXY so the
// real client address is used instead of the proxy's (see server.js).
function limiter({ minutes, limit, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message }
  });
}

const TOO_MANY = 'Trop de tentatives. Réessaie dans quelques minutes.';

/** Guessing a password: only failed logins count */
const loginLimiter = limiter({ minutes: 15, limit: 10, message: TOO_MANY, skipSuccessfulRequests: true });

const registerLimiter = limiter({ minutes: 60, limit: 10, message: TOO_MANY });

/** Sending reset emails (spam) and guessing reset codes */
const passwordResetLimiter = limiter({ minutes: 15, limit: 10, message: TOO_MANY });

/** Guessing an invite code: only failed attempts count */
const joinHouseholdLimiter = limiter({ minutes: 15, limit: 10, message: TOO_MANY, skipSuccessfulRequests: true });

module.exports = { loginLimiter, registerLimiter, passwordResetLimiter, joinHouseholdLimiter };

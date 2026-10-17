const rateLimit = require('express-rate-limit');

// Per IP address, kept in memory (one server instance). Behind a reverse proxy (Render,
// Railway, Nginx...), set TRUST_PROXY so the real client address is used instead of the
// proxy's (see app.js): otherwise every user shares one counter.
function limiter({ minutes, limit, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message },
    // Tests send many requests from the same address
    skip: () => process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_IN_TESTS !== 'on'
  });
}

const TOO_MANY = 'Trop de tentatives. Réessaie dans quelques minutes.';

/** Guessing a password: only failed logins count */
const loginLimiter = limiter({ minutes: 15, limit: 10, message: TOO_MANY, skipSuccessfulRequests: true });

const registerLimiter = limiter({ minutes: 60, limit: 10, message: TOO_MANY });

/** Sending reset emails (spam) and guessing reset codes */
const passwordResetLimiter = limiter({ minutes: 15, limit: 10, message: TOO_MANY });

/** Sending confirmation emails and guessing their codes */
const emailVerificationLimiter = limiter({ minutes: 15, limit: 10, message: TOO_MANY });

/** Guessing an invite code: only failed attempts count */
const joinHouseholdLimiter = limiter({ minutes: 15, limit: 10, message: TOO_MANY, skipSuccessfulRequests: true });

module.exports = { loginLimiter, registerLimiter, passwordResetLimiter, emailVerificationLimiter, joinHouseholdLimiter };

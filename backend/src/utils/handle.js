/** Shown to the user on unexpected errors: the technical details stay in the server log */
const SERVER_ERROR = 'Erreur du serveur, réessaie dans un instant';

/**
 * Wraps an async route: an unexpected error is logged and answered with a generic message,
 * never with error.message (which can reveal internals: queries, paths, driver errors...).
 */
function handle(label, fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (error) {
      console.error(`[${label}] ${req.method} ${req.originalUrl}:`, error);
      if (!res.headersSent) res.status(500).json({ error: SERVER_ERROR });
    }
  };
}

module.exports = { handle, SERVER_ERROR };

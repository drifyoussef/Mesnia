const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { SERVER_ERROR } = require('./utils/handle');

/**
 * Origins allowed to call the API from a browser. The native apps (Capacitor) load from
 * capacitor://localhost (iOS) and https://localhost (Android); a web version adds its domain
 * through CORS_ORIGINS (comma-separated). In development, any localhost port is accepted.
 */
function corsOptions() {
  const allowed = new Set([
    'capacitor://localhost',
    'ionic://localhost',
    'https://localhost',
    'http://localhost',
    ...(process.env.CORS_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean)
  ]);
  const isDev = process.env.NODE_ENV !== 'production';

  return {
    origin(origin, callback) {
      // No Origin header: native HTTP clients, curl, server-to-server (no browser to protect)
      if (!origin || allowed.has(origin) || (isDev && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) {
        return callback(null, true);
      }
      callback(null, false);
    }
  };
}

function createApp() {
  const app = express();

  // Behind a reverse proxy (Render, Railway, Nginx...), the client address is in X-Forwarded-For:
  // TRUST_PROXY=1 (number of proxies in front of the app) lets the rate limits use it.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  }

  app.disable('x-powered-by');
  app.use(helmet({
    // The only HTML served is the legal pages: inline styles, nothing else
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        styleSrc: ["'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"]
      }
    },
    // The app (another origin) downloads document files through CORS
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));
  app.use(cors(corsOptions()));
  // Recipes imported from social networks carry their cover picture inline (up to ~300 KB)
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/auth', require('./routes/auth.routes'));
  app.use('/api/households', require('./routes/household.routes'));
  app.use('/api/recipes', require('./routes/recipe.routes'));
  app.use('/api/swipe', require('./routes/swipe.routes'));
  app.use('/api/shopping', require('./routes/shopping.routes'));
  app.use('/api/schedules', require('./routes/schedule.routes'));
  app.use('/api/calendar', require('./routes/calendar.routes'));
  app.use('/api/trips', require('./routes/trip.routes'));
  app.use('/api/documents', require('./routes/document.routes'));
  app.use('/api/tasks', require('./routes/task.routes'));
  app.use('/api/meal-plans', require('./routes/meal-plan.routes'));
  app.use('/api/notifications', require('./routes/notification.routes'));
  app.use('/api/events', require('./routes/events.routes'));
  app.use('/api/jobs', require('./routes/jobs.routes'));
  app.use('/legal', require('./routes/legal.routes'));

  app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Introuvable' });
  });

  // Errors thrown before a route answers (malformed JSON, body too large...)
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Requête invalide' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Envoi trop volumineux' });
    }
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
    res.status(err.status && err.status < 500 ? err.status : 500).json({ error: SERVER_ERROR });
  });

  return app;
}

module.exports = { createApp };

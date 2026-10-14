require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { connectDB } = require('./config/database');
// Fails right away, with instructions, when JWT_SECRET is missing
require('./config/jwt');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy (Render, Railway, Nginx...), the client address is in X-Forwarded-For:
// TRUST_PROXY=1 (number of proxies in front of the app) lets the rate limits use it.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

// Middleware
app.use(cors());
// Recipes imported from social networks carry their cover picture inline (up to ~300 KB)
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/households', require('./routes/household.routes'));
app.use('/api/recipes', require('./routes/recipe.routes'));
app.use('/api/swipe', require('./routes/swipe.routes'));
app.use('/api/shopping', require('./routes/shopping.routes'));
app.use('/api/schedules', require('./routes/schedule.routes'));
app.use('/api/calendar', require('./routes/calendar.routes'));
app.use('/api/trips', require('./routes/trip.routes'));
app.use('/api/documents', require('./routes/document.routes'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start server
const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

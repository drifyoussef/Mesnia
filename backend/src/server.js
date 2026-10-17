require('dotenv').config();
// Fail right away, with instructions, when a required secret is missing
require('./config/jwt');
require('./services/document-crypto').assertKeyConfigured();

const { connectDB } = require('./config/database');
const { createApp } = require('./app');
const { encryptLegacyDocuments } = require('./services/documents');
const { startScheduler } = require('./services/jobs');

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();
    await encryptLegacyDocuments();

    createApp().listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV}`);
    });

    startScheduler();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

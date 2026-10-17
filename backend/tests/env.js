// Environment of the test runs (loaded by Jest before every test file)
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-the-check-0123456789';
process.env.DOCUMENTS_ENCRYPTION_KEY = 'test-documents-key-that-is-long-enough-0123456789';
process.env.GMAIL_USER = 'mesnia@example.com';
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.CRON_SECRET;

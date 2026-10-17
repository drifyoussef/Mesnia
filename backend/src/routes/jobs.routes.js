const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { runDailyJobs } = require('../services/jobs');
const { handle } = require('../utils/handle');

// For an external cron (cron-job.org, GitHub Actions...) when the host puts the server to sleep:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<api>/api/jobs/daily
// Without CRON_SECRET, the route does not exist.

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(req.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

router.post('/daily', handle('jobs', async (req, res) => {
  if (!authorized(req)) return res.status(404).json({ error: 'Introuvable' });
  res.json({ result: await runDailyJobs() });
}));

module.exports = router;

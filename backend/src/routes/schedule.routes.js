const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDB } = require('../config/database');
const { authenticateUser } = require('../middleware/auth.middleware');
const { requireHouseholdMember } = require('../middleware/household.middleware');
const { handle } = require('../utils/handle');

// Weekly recurring schedules of the household members.
// One document per (household, user): { householdId, userId, slots: [{ id, day, start, end, label, breakStart?, breakEnd? }] }
// day: 0 = lundi ... 6 = dimanche, start / end / breakStart / breakEnd: "HH:mm"
// The break (lunch...) is optional and must sit strictly inside the slot.

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_LABEL_LENGTH = 40;
const MAX_SLOTS_PER_USER = 100;

router.use(authenticateUser);
router.use('/:householdId', requireHouseholdMember);

const toResponse = (doc, userId) => ({
  userId,
  slots: (doc?.slots || []).slice().sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
});

// Schedules of every current member of the household
router.get('/:householdId', handle('schedules', async (req, res) => {
  const docs = await getDB().collection('schedules').find({ householdId: req.householdId }).toArray();
  const byUser = new Map(docs.map(doc => [doc.userId, doc]));

  // Driven by the member list, so someone who left the household disappears from the schedules
  res.json({ schedules: req.memberIds.map(userId => toResponse(byUser.get(userId), userId)) });
}));

// Add one slot per selected day to the authenticated user's schedule
router.post('/:householdId/slots', handle('schedules', async (req, res) => {
  const { days, start, end } = req.body || {};
  const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';

  if (!Array.isArray(days) || days.length === 0 || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
    return res.status(400).json({ error: 'Choisis au moins un jour' });
  }
  if (!TIME_PATTERN.test(start || '') || !TIME_PATTERN.test(end || '')) {
    return res.status(400).json({ error: 'Heures invalides (format HH:mm)' });
  }
  if (start >= end) {
    return res.status(400).json({ error: "L'heure de fin doit être après l'heure de début" });
  }
  if (!label || label.length > MAX_LABEL_LENGTH) {
    return res.status(400).json({ error: `Donne un nom à ce créneau (${MAX_LABEL_LENGTH} caractères max)` });
  }

  const { breakStart, breakEnd } = req.body;
  const hasBreak = Boolean(breakStart || breakEnd);
  if (hasBreak) {
    if (!TIME_PATTERN.test(breakStart || '') || !TIME_PATTERN.test(breakEnd || '')) {
      return res.status(400).json({ error: 'Heures de pause invalides (format HH:mm)' });
    }
    if (breakStart >= breakEnd) {
      return res.status(400).json({ error: 'La fin de la pause doit être après son début' });
    }
    if (breakStart <= start || breakEnd >= end) {
      return res.status(400).json({ error: 'La pause doit être comprise dans le créneau' });
    }
  }

  const db = getDB();
  const householdId = req.householdId;
  const userId = req.user.uid;

  const existing = await db.collection('schedules').findOne({ householdId, userId });
  const uniqueDays = [...new Set(days)];
  if ((existing?.slots?.length || 0) + uniqueDays.length > MAX_SLOTS_PER_USER) {
    return res.status(400).json({ error: 'Trop de créneaux' });
  }

  const slots = uniqueDays.map(day => ({
    id: crypto.randomUUID(),
    day,
    start,
    end,
    label,
    ...(hasBreak ? { breakStart, breakEnd } : {})
  }));

  const result = await db.collection('schedules').findOneAndUpdate(
    { householdId, userId },
    {
      $push: { slots: { $each: slots } },
      $set: { updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true, returnDocument: 'after' }
  );

  res.status(201).json({ schedule: toResponse(result, userId) });
}));

// Remove one of the authenticated user's own slots
router.delete('/:householdId/slots/:slotId', handle('schedules', async (req, res) => {
  // Scoped to the user's own document: nobody can delete someone else's slot
  const result = await getDB().collection('schedules').findOneAndUpdate(
    { householdId: req.householdId, userId: req.user.uid },
    {
      $pull: { slots: { id: req.params.slotId } },
      $set: { updatedAt: new Date() }
    },
    { returnDocument: 'after' }
  );

  res.json({ schedule: toResponse(result, req.user.uid) });
}));

module.exports = router;

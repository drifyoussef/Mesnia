const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { requireHouseholdMember } = require('../middleware/household.middleware');
const { notify } = require('../services/notify');
const { publish } = require('../services/realtime');
const { handle } = require('../utils/handle');

// Household calendar, shared by every member. Each event remembers who added it; its author
// and the household admins can edit or delete it.
// { householdId, title, date: "YYYY-MM-DD", time?: "HH:mm", location?, type, color, createdBy, createdByName,
//   reminderSent?: Date }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const TYPES = ['rendezvous', 'reunion', 'anniversaire', 'loisir', 'autre'];
const MAX_IMPORT = 500;
const NOT_ALLOWED = 'Seuls la personne qui a ajouté cet événement et les admins du foyer peuvent le modifier';

router.use(authenticateUser);
router.use('/:householdId', requireHouseholdMember);

/** Validates the client fields of an event; returns the clean fields or an error message. */
function readEvent(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120) return { error: 'Donne un titre à cet événement (120 caractères max)' };
  if (!DATE_PATTERN.test(body.date || '')) return { error: 'Date invalide' };
  if (body.time && !TIME_PATTERN.test(body.time)) return { error: 'Heure invalide' };

  const location = typeof body.location === 'string' ? body.location.trim().slice(0, 200) : '';
  return {
    event: {
      title,
      date: body.date,
      ...(body.time ? { time: body.time } : {}),
      ...(location ? { location } : {}),
      type: TYPES.includes(body.type) ? body.type : 'autre',
      color: COLOR_PATTERN.test(body.color || '') ? body.color : '#8B5CF6'
    }
  };
}

function toClient(doc) {
  const { _id, householdId, reminderSent, ...rest } = doc;
  return { ...rest, id: _id.toString(), householdId: householdId.toString() };
}

function authorFields(req) {
  return {
    createdBy: req.user.uid,
    createdByName: req.currentUser.displayName || 'Membre'
  };
}

const formatDay = iso => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  .format(new Date(`${iso}T00:00:00Z`));

/** The event of the URL, if its author or an admin is asking. Sends the error response otherwise. */
async function loadManageable(req, res) {
  if (!ObjectId.isValid(req.params.eventId)) {
    res.status(404).json({ error: 'Événement introuvable' });
    return null;
  }
  const existing = await getDB().collection('calendar_events').findOne({
    _id: new ObjectId(req.params.eventId),
    householdId: req.householdId
  });
  if (!existing) {
    res.status(404).json({ error: 'Événement introuvable' });
    return null;
  }
  if (existing.createdBy !== req.user.uid && !req.isAdmin) {
    res.status(403).json({ error: NOT_ALLOWED });
    return null;
  }
  return existing;
}

// Every event of the household
router.get('/:householdId', handle('calendar', async (req, res) => {
  const events = await getDB().collection('calendar_events')
    .find({ householdId: req.householdId })
    .sort({ date: 1, time: 1 })
    .toArray();
  res.json({ events: events.map(toClient) });
}));

// Add an event (the author is the authenticated user)
router.post('/:householdId', handle('calendar', async (req, res) => {
  const { event, error } = readEvent(req.body);
  if (error) return res.status(400).json({ error });

  const doc = {
    ...event,
    householdId: req.householdId,
    ...authorFields(req),
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const result = await getDB().collection('calendar_events').insertOne(doc);
  doc._id = result.insertedId;

  publish(req.householdId, 'calendar', req.user.uid);
  void notify({
    userIds: req.memberIds,
    excludeUserId: req.user.uid,
    type: 'calendar',
    title: 'Nouvel événement',
    body: `${doc.createdByName} a ajouté « ${doc.title} » le ${formatDay(doc.date)}${doc.time ? ` à ${doc.time}` : ''}`,
    route: '/tabs/calendar'
  });

  res.status(201).json({ event: toClient(doc) });
}));

// One-time upload of the events that used to live only on the phone (before the calendar was shared)
router.post('/:householdId/import', handle('calendar', async (req, res) => {
  const items = Array.isArray(req.body?.events) ? req.body.events.slice(0, MAX_IMPORT) : [];
  const docs = items
    .map(item => readEvent(item).event)
    .filter(Boolean)
    .map(event => ({
      ...event,
      householdId: req.householdId,
      ...authorFields(req),
      createdAt: new Date(),
      updatedAt: new Date()
    }));

  if (docs.length > 0) {
    const result = await getDB().collection('calendar_events').insertMany(docs);
    docs.forEach((doc, index) => { doc._id = result.insertedIds[index]; });
    publish(req.householdId, 'calendar', req.user.uid);
  }

  res.status(201).json({ events: docs.map(toClient) });
}));

// Edit an event: its author or an admin
router.put('/:householdId/:eventId', handle('calendar', async (req, res) => {
  const { event, error } = readEvent(req.body);
  if (error) return res.status(400).json({ error });

  const existing = await loadManageable(req, res);
  if (!existing) return;

  // time / location removed in the form must disappear, not keep their old value
  const unset = {};
  if (!event.time) unset.time = '';
  if (!event.location) unset.location = '';
  // New date: the reminder must be sent again
  if (event.date !== existing.date) unset.reminderSent = '';

  const result = await getDB().collection('calendar_events').findOneAndUpdate(
    { _id: existing._id },
    { $set: { ...event, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { returnDocument: 'after' }
  );

  publish(req.householdId, 'calendar', req.user.uid);
  res.json({ event: toClient(result) });
}));

// Delete an event: its author or an admin
router.delete('/:householdId/:eventId', handle('calendar', async (req, res) => {
  const existing = await loadManageable(req, res);
  if (!existing) return;

  await getDB().collection('calendar_events').deleteOne({ _id: existing._id });
  publish(req.householdId, 'calendar', req.user.uid);
  res.json({ message: 'Événement supprimé' });
}));

module.exports = router;

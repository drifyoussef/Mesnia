const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { requireHouseholdMember } = require('../middleware/household.middleware');
const { handle: handleRoute } = require('../utils/handle');

// Household trips, shared by every member. One document per trip, with its packing list,
// its day-by-day program and its expenses embedded:
// { householdId, name, destination, startDate, endDate, cover, participants: [userId], notes,
//   budget? (cents),
//   packing: [{ id, label, checked, assignedTo? }],
//   activities: [{ id, date, time?, title, location? }],
//   expenses: [{ id, label, amount (cents), paidBy, splitBetween: [userId], date, createdBy }],
//   createdBy, createdAt, updatedAt }

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const COVERS = ['airplane', 'sunny', 'snow', 'business', 'bonfire', 'car', 'boat', 'train'];
const MAX_ITEMS = 300;
const MAX_AMOUNT_CENTS = 100000000; // 1 000 000 €

router.use(authenticateUser);

router.use('/:householdId', requireHouseholdMember);

// ---------- Helpers ----------

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const newId = () => crypto.randomUUID();

function toClient(trip) {
  const { _id, householdId, ...rest } = trip;
  return { ...rest, id: _id.toString(), householdId: householdId.toString() };
}

/** Participants must be members of the household; defaults to everyone. */
function readParticipants(value, memberIds) {
  if (!Array.isArray(value)) return memberIds;
  const participants = [...new Set(value.filter(id => memberIds.includes(id)))];
  return participants.length > 0 ? participants : memberIds;
}

function readTrip(body, memberIds) {
  const name = text(body?.name, 80);
  if (!name) return { error: 'Donne un nom à ce voyage' };
  if (!DATE_PATTERN.test(body.startDate || '') || !DATE_PATTERN.test(body.endDate || '')) {
    return { error: 'Choisis les dates du voyage' };
  }
  if (body.endDate < body.startDate) return { error: 'Le retour doit être après le départ' };

  return {
    trip: {
      name,
      destination: text(body.destination, 120),
      startDate: body.startDate,
      endDate: body.endDate,
      cover: COVERS.includes(body.cover) ? body.cover : 'airplane',
      participants: readParticipants(body.participants, memberIds),
      notes: text(body.notes, 3000)
    }
  };
}

async function loadTrip(req, res) {
  if (!ObjectId.isValid(req.params.tripId)) {
    res.status(404).json({ error: 'Trip not found' });
    return null;
  }
  const trip = await getDB().collection('trips').findOne({ _id: new ObjectId(req.params.tripId), householdId: req.householdId });
  if (!trip) {
    res.status(404).json({ error: 'Trip not found' });
    return null;
  }
  return trip;
}

/** Applies a Mongo update to the trip of the URL and answers with the updated trip. */
async function updateTrip(req, res, update) {
  const result = await getDB().collection('trips').findOneAndUpdate(
    { _id: new ObjectId(req.params.tripId), householdId: req.householdId },
    { ...update, $set: { ...(update.$set || {}), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Trip not found' });
  res.json({ trip: toClient(result) });
}

const handle = fn => handleRoute('trips', fn);

// ---------- Trips ----------

router.get('/:householdId', handle(async (req, res) => {
  const trips = await getDB().collection('trips')
    .find({ householdId: req.householdId })
    .sort({ startDate: 1 })
    .toArray();
  res.json({ trips: trips.map(toClient) });
}));

router.post('/:householdId', handle(async (req, res) => {
  const { trip, error } = readTrip(req.body, req.memberIds);
  if (error) return res.status(400).json({ error });

  const doc = {
    ...trip,
    householdId: req.householdId,
    packing: [],
    activities: [],
    expenses: [],
    createdBy: req.user.uid,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const result = await getDB().collection('trips').insertOne(doc);
  doc._id = result.insertedId;
  res.status(201).json({ trip: toClient(doc) });
}));

router.get('/:householdId/:tripId', handle(async (req, res) => {
  const trip = await loadTrip(req, res);
  if (trip) res.json({ trip: toClient(trip) });
}));

router.put('/:householdId/:tripId', handle(async (req, res) => {
  const { trip, error } = readTrip(req.body, req.memberIds);
  if (error) return res.status(400).json({ error });
  await updateTrip(req, res, { $set: trip });
}));

router.delete('/:householdId/:tripId', handle(async (req, res) => {
  if (!ObjectId.isValid(req.params.tripId)) return res.status(404).json({ error: 'Trip not found' });
  const result = await getDB().collection('trips').deleteOne({ _id: new ObjectId(req.params.tripId), householdId: req.householdId });
  if (result.deletedCount === 0) return res.status(404).json({ error: 'Trip not found' });
  res.json({ message: 'Trip deleted' });
}));

// ---------- Budget ----------

// Set apart from the trip form (PUT above) so editing the trip never touches it.
// { budget: cents } sets it, { budget: null } (or 0) removes it.
router.put('/:householdId/:tripId/budget', handle(async (req, res) => {
  const value = req.body?.budget;
  if (value === null || value === undefined || Number(value) === 0) {
    return updateTrip(req, res, { $unset: { budget: '' } });
  }

  const budget = Math.round(Number(value));
  if (!Number.isInteger(budget) || budget < 0 || budget > MAX_AMOUNT_CENTS) {
    return res.status(400).json({ error: 'Budget invalide' });
  }
  await updateTrip(req, res, { $set: { budget } });
}));

// ---------- Packing list ----------

router.post('/:householdId/:tripId/packing', handle(async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  const label = text(req.body?.label, 100);
  if (!label) return res.status(400).json({ error: 'Que faut-il emporter ?' });
  if ((trip.packing || []).length >= MAX_ITEMS) return res.status(400).json({ error: 'Liste trop longue' });

  const assignedTo = req.memberIds.includes(req.body.assignedTo) ? req.body.assignedTo : undefined;
  await updateTrip(req, res, {
    $push: { packing: { id: newId(), label, checked: false, ...(assignedTo ? { assignedTo } : {}) } }
  });
}));

router.patch('/:householdId/:tripId/packing/:itemId', handle(async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  const item = (trip.packing || []).find(i => i.id === req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const set = {};
  if (typeof req.body?.checked === 'boolean') set['packing.$[item].checked'] = req.body.checked;
  if (req.body?.label !== undefined) {
    const label = text(req.body.label, 100);
    if (!label) return res.status(400).json({ error: 'Que faut-il emporter ?' });
    set['packing.$[item].label'] = label;
  }
  const unset = {};
  if (req.body?.assignedTo !== undefined) {
    if (req.memberIds.includes(req.body.assignedTo)) set['packing.$[item].assignedTo'] = req.body.assignedTo;
    else unset['packing.$[item].assignedTo'] = '';
  }

  const result = await getDB().collection('trips').findOneAndUpdate(
    { _id: trip._id },
    { $set: { ...set, updatedAt: new Date() }, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { arrayFilters: [{ 'item.id': req.params.itemId }], returnDocument: 'after' }
  );
  res.json({ trip: toClient(result) });
}));

router.delete('/:householdId/:tripId/packing/:itemId', handle(async (req, res) => {
  await updateTrip(req, res, { $pull: { packing: { id: req.params.itemId } } });
}));

// ---------- Program ----------

function readActivity(body, trip) {
  const title = text(body?.title, 120);
  if (!title) return { error: 'Donne un nom à cette activité' };
  if (!DATE_PATTERN.test(body.date || '')) return { error: 'Choisis un jour' };
  if (body.date < trip.startDate || body.date > trip.endDate) return { error: 'Ce jour est en dehors du voyage' };
  if (body.time && !TIME_PATTERN.test(body.time)) return { error: 'Heure invalide' };

  const location = text(body.location, 200);
  return {
    activity: {
      date: body.date,
      title,
      ...(body.time ? { time: body.time } : {}),
      ...(location ? { location } : {})
    }
  };
}

router.post('/:householdId/:tripId/activities', handle(async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  const { activity, error } = readActivity(req.body, trip);
  if (error) return res.status(400).json({ error });
  if ((trip.activities || []).length >= MAX_ITEMS) return res.status(400).json({ error: 'Programme trop long' });

  await updateTrip(req, res, { $push: { activities: { id: newId(), ...activity } } });
}));

router.put('/:householdId/:tripId/activities/:activityId', handle(async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;
  if (!(trip.activities || []).some(a => a.id === req.params.activityId)) {
    return res.status(404).json({ error: 'Activity not found' });
  }
  const { activity, error } = readActivity(req.body, trip);
  if (error) return res.status(400).json({ error });

  const result = await getDB().collection('trips').findOneAndUpdate(
    { _id: trip._id },
    { $set: { 'activities.$[a]': { id: req.params.activityId, ...activity }, updatedAt: new Date() } },
    { arrayFilters: [{ 'a.id': req.params.activityId }], returnDocument: 'after' }
  );
  res.json({ trip: toClient(result) });
}));

router.delete('/:householdId/:tripId/activities/:activityId', handle(async (req, res) => {
  await updateTrip(req, res, { $pull: { activities: { id: req.params.activityId } } });
}));

// ---------- Expenses ----------

router.post('/:householdId/:tripId/expenses', handle(async (req, res) => {
  const trip = await loadTrip(req, res);
  if (!trip) return;

  const label = text(req.body?.label, 100);
  const amount = Math.round(Number(req.body?.amount));
  if (!label) return res.status(400).json({ error: 'À quoi correspond cette dépense ?' });
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT_CENTS) {
    return res.status(400).json({ error: 'Montant invalide' });
  }

  const participants = trip.participants?.length ? trip.participants : req.memberIds;
  if (!participants.includes(req.body.paidBy)) return res.status(400).json({ error: 'Qui a payé ?' });
  const splitBetween = Array.isArray(req.body.splitBetween)
    ? [...new Set(req.body.splitBetween.filter(id => participants.includes(id)))]
    : participants;
  if (splitBetween.length === 0) return res.status(400).json({ error: 'Partage la dépense avec au moins une personne' });
  if ((trip.expenses || []).length >= MAX_ITEMS) return res.status(400).json({ error: 'Trop de dépenses' });

  const date = DATE_PATTERN.test(req.body.date || '') ? req.body.date : new Date().toISOString().slice(0, 10);

  await updateTrip(req, res, {
    $push: {
      expenses: { id: newId(), label, amount, paidBy: req.body.paidBy, splitBetween, date, createdBy: req.user.uid }
    }
  });
}));

router.delete('/:householdId/:tripId/expenses/:expenseId', handle(async (req, res) => {
  await updateTrip(req, res, { $pull: { expenses: { id: req.params.expenseId } } });
}));

module.exports = router;

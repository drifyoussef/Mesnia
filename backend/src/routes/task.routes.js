const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { ObjectId } = require('mongodb');
const { authenticateUser } = require('../middleware/auth.middleware');
const { requireHouseholdMember } = require('../middleware/household.middleware');
const { notify } = require('../services/notify');
const { publish } = require('../services/realtime');
const { addPeriod, todayIso } = require('../utils/dates');
const { handle } = require('../utils/handle');

// Household chores, shared by every member.
// { householdId, title, assignedTo: userId | null, dueDate?: "YYYY-MM-DD",
//   recurrence?: { every: 'day' | 'week' | 'month', rotate: boolean },
//   done, doneAt?, doneBy?, lastDoneAt?, lastDoneBy?, reminderSentFor?, createdBy, createdAt, updatedAt }
// A recurring task is never "done": completing it moves it to its next date (and to the next
// member when it rotates).

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PERIODS = ['day', 'week', 'month'];
const MAX_IMPORT = 200;
/** Done tasks stay visible this long, then only the open ones are listed */
const DONE_VISIBLE_DAYS = 7;

router.use(authenticateUser);
router.use('/:householdId', requireHouseholdMember);

function readTask(body, memberIds) {
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 120) : '';
  if (!title) return { error: 'Donne un nom à cette tâche' };
  if (body.dueDate && !DATE_PATTERN.test(body.dueDate)) return { error: 'Date invalide' };

  const recurrence = PERIODS.includes(body.recurrence?.every)
    ? { every: body.recurrence.every, rotate: body.recurrence.rotate === true }
    : null;
  if (recurrence && !body.dueDate) return { error: 'Choisis la date de la première fois' };

  return {
    task: {
      title,
      assignedTo: memberIds.includes(body.assignedTo) ? body.assignedTo : null,
      dueDate: body.dueDate || null,
      recurrence
    }
  };
}

function toClient(task) {
  const { _id, householdId, reminderSentFor, ...rest } = task;
  return { ...rest, id: _id.toString(), householdId: householdId.toString() };
}

const memberName = (req, userId) => req.household.members.find(m => m.userId === userId)?.displayName || 'Membre';

function notifyAssignee(req, task) {
  if (!task.assignedTo || task.assignedTo === req.user.uid) return;
  void notify({
    userIds: [task.assignedTo],
    type: 'tasks',
    title: 'Nouvelle tâche pour toi',
    body: `${req.currentUser.displayName || 'Un membre'} t'a confié « ${task.title} »`,
    route: '/tabs/tasks'
  });
}

async function loadTask(req, res) {
  if (!ObjectId.isValid(req.params.taskId)) {
    res.status(404).json({ error: 'Tâche introuvable' });
    return null;
  }
  const task = await getDB().collection('tasks').findOne({ _id: new ObjectId(req.params.taskId), householdId: req.householdId });
  if (!task) res.status(404).json({ error: 'Tâche introuvable' });
  return task;
}

function changed(req, res, payload, status = 200) {
  publish(req.householdId, 'tasks', req.user.uid);
  res.status(status).json(payload);
}

router.get('/:householdId', handle('tasks', async (req, res) => {
  const since = new Date(Date.now() - DONE_VISIBLE_DAYS * 24 * 60 * 60 * 1000);
  const tasks = await getDB().collection('tasks')
    .find({ householdId: req.householdId, $or: [{ done: false }, { doneAt: { $gte: since } }] })
    .sort({ done: 1, dueDate: 1, createdAt: 1 })
    .toArray();
  res.json({ tasks: tasks.map(toClient) });
}));

router.post('/:householdId', handle('tasks', async (req, res) => {
  const { task, error } = readTask(req.body, req.memberIds);
  if (error) return res.status(400).json({ error });

  const doc = {
    ...task,
    householdId: req.householdId,
    done: false,
    createdBy: req.user.uid,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  doc._id = (await getDB().collection('tasks').insertOne(doc)).insertedId;
  notifyAssignee(req, doc);
  changed(req, res, { task: toClient(doc) }, 201);
}));

/** Tasks created on the phone before tasks were shared: uploaded once, then forgotten locally. */
router.post('/:householdId/import', handle('tasks', async (req, res) => {
  const items = Array.isArray(req.body?.tasks) ? req.body.tasks.slice(0, MAX_IMPORT) : [];
  const docs = items
    .map(item => ({ item, ...readTask(item, req.memberIds) }))
    .filter(({ task }) => task)
    .map(({ item, task }) => ({
      ...task,
      householdId: req.householdId,
      done: item.done === true,
      ...(item.done === true ? { doneAt: new Date(), doneBy: req.user.uid } : {}),
      createdBy: req.user.uid,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

  if (docs.length > 0) {
    const result = await getDB().collection('tasks').insertMany(docs);
    docs.forEach((doc, index) => { doc._id = result.insertedIds[index]; });
  }
  changed(req, res, { tasks: docs.map(toClient) }, 201);
}));

router.put('/:householdId/:taskId', handle('tasks', async (req, res) => {
  const existing = await loadTask(req, res);
  if (!existing) return;
  const { task, error } = readTask(req.body, req.memberIds);
  if (error) return res.status(400).json({ error });

  const result = await getDB().collection('tasks').findOneAndUpdate(
    { _id: existing._id },
    { $set: { ...task, updatedAt: new Date() }, ...(task.dueDate !== existing.dueDate ? { $unset: { reminderSentFor: '' } } : {}) },
    { returnDocument: 'after' }
  );
  if (task.assignedTo !== existing.assignedTo) notifyAssignee(req, result);
  changed(req, res, { task: toClient(result) });
}));

/**
 * Ticks a task (or unticks it). A recurring task moves on to its next occurrence instead,
 * handed to the next member when it rotates.
 */
router.post('/:householdId/:taskId/toggle', handle('tasks', async (req, res) => {
  const existing = await loadTask(req, res);
  if (!existing) return;

  let update;
  if (existing.recurrence) {
    // From the planned date, or from today when it was late: no backlog of missed occurrences
    let next = addPeriod(existing.dueDate || todayIso(), existing.recurrence.every);
    while (next <= todayIso()) next = addPeriod(next, existing.recurrence.every);

    let assignedTo = existing.assignedTo;
    if (existing.recurrence.rotate && req.memberIds.length > 0) {
      const index = req.memberIds.indexOf(existing.assignedTo);
      assignedTo = req.memberIds[(index + 1) % req.memberIds.length];
    }
    update = {
      $set: { dueDate: next, assignedTo, lastDoneAt: new Date(), lastDoneBy: req.user.uid, updatedAt: new Date() },
      $unset: { reminderSentFor: '' }
    };
  } else if (existing.done) {
    update = { $set: { done: false, updatedAt: new Date() }, $unset: { doneAt: '', doneBy: '' } };
  } else {
    update = { $set: { done: true, doneAt: new Date(), doneBy: req.user.uid, updatedAt: new Date() } };
  }

  const result = await getDB().collection('tasks').findOneAndUpdate({ _id: existing._id }, update, { returnDocument: 'after' });

  if (existing.recurrence?.rotate && result.assignedTo && result.assignedTo !== req.user.uid) {
    void notify({
      userIds: [result.assignedTo],
      type: 'tasks',
      title: 'C’est ton tour',
      body: `${memberName(req, req.user.uid)} a fait « ${result.title} » : la prochaine fois, c'est toi`,
      route: '/tabs/tasks'
    });
  }
  changed(req, res, { task: toClient(result) });
}));

router.delete('/:householdId/:taskId', handle('tasks', async (req, res) => {
  const existing = await loadTask(req, res);
  if (!existing) return;
  await getDB().collection('tasks').deleteOne({ _id: existing._id });
  changed(req, res, { message: 'Tâche supprimée' });
}));

module.exports = router;

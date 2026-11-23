// Daily reminders: documents to renew, chores due today, tomorrow's events.
// Every reminder is flagged once sent, so the jobs can run as often as wanted: the server runs
// them every hour while awake, and an external cron can call POST /api/jobs/daily (CRON_SECRET)
// for hosts that put the server to sleep (Render free plan). Nothing is sent at night.

const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { notify, prefsOf } = require('./notify');
const { sendDocumentReminderEmail, sendInBackground } = require('./email');
const { dueLabel } = require('./email/document-reminder');
const { todayIso, addDays, daysBetween, TIME_ZONE } = require('../utils/dates');

const SEND_FROM_HOUR = 8;
const SEND_UNTIL_HOUR = 21;
const HOUR_MS = 60 * 60 * 1000;

/** Reminder thresholds: each covers the expiry dates down to the next one. */
const DOCUMENT_THRESHOLDS = [
  { key: '30', from: 8, to: 30 },
  { key: '7', from: 1, to: 7 },
  // Expired today or in the last week (an older one was reminded already, or never mattered)
  { key: '0', from: -7, to: 0 }
];

function parisHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hour12: false }).format(date));
}

async function loadUsers(ids) {
  const valid = [...new Set(ids)].filter(id => ObjectId.isValid(id));
  const users = await getDB().collection('users')
    .find({ _id: { $in: valid.map(id => new ObjectId(id)) } }, { projection: { email: 1, displayName: 1, emailVerified: 1, notificationPrefs: 1 } })
    .toArray();
  return new Map(users.map(user => [user._id.toString(), user]));
}

/** Who must hear about a document: its author when private, else the member it concerns, else everyone. */
function documentRecipients(doc, household) {
  const memberIds = household.members.map(m => m.userId);
  if (doc.private) return memberIds.includes(doc.createdBy) ? [doc.createdBy] : [];
  if (doc.memberId && memberIds.includes(doc.memberId)) return [doc.memberId];
  return memberIds;
}

async function sendDocumentReminders(today = todayIso()) {
  const db = getDB();
  const perUser = new Map(); // userId -> [{ title, expiresAt, daysLeft }]
  let flagged = 0;

  for (const threshold of DOCUMENT_THRESHOLDS) {
    const documents = await db.collection('documents').find({
      expiresAt: { $gte: addDays(today, threshold.from), $lte: addDays(today, threshold.to) },
      [`reminders.${threshold.key}`]: { $exists: false }
    }).toArray();

    for (const doc of documents) {
      const household = await db.collection('households').findOne({ _id: doc.householdId }, { projection: { members: 1 } });
      if (household) {
        for (const userId of documentRecipients(doc, household)) {
          if (!perUser.has(userId)) perUser.set(userId, []);
          perUser.get(userId).push({ title: doc.title, expiresAt: doc.expiresAt, daysLeft: daysBetween(today, doc.expiresAt) });
        }
      }
      await db.collection('documents').updateOne({ _id: doc._id }, { $set: { [`reminders.${threshold.key}`]: new Date() } });
      flagged++;
    }
  }

  const users = await loadUsers([...perUser.keys()]);
  for (const [userId, documents] of perUser) {
    documents.sort((a, b) => a.daysLeft - b.daysLeft);
    const single = documents.length === 1;
    await notify({
      userIds: [userId],
      type: 'documents',
      title: single ? 'Document à renouveler' : 'Documents à renouveler',
      body: single
        ? `« ${documents[0].title} » ${dueLabel(documents[0].daysLeft)}`
        : `${documents.length} documents arrivent à expiration`,
      route: '/tabs/documents'
    });

    const user = users.get(userId);
    const prefs = prefsOf(user);
    // Only to a confirmed address: never remind a stranger whose email was typed by mistake
    if (user?.emailVerified && prefs.email && prefs.documents) {
      sendInBackground(`document reminder to user ${userId}`, () => sendDocumentReminderEmail(user.email, {
        displayName: user.displayName,
        documents
      }));
    }
  }
  return flagged;
}

async function sendTaskReminders(today = todayIso()) {
  const db = getDB();
  const tasks = await db.collection('tasks').find({
    done: false,
    dueDate: today,
    assignedTo: { $ne: null },
    reminderSentFor: { $ne: today }
  }).toArray();

  const perUser = new Map();
  for (const task of tasks) {
    if (!perUser.has(task.assignedTo)) perUser.set(task.assignedTo, []);
    perUser.get(task.assignedTo).push(task.title);
  }
  for (const [userId, titles] of perUser) {
    await notify({
      userIds: [userId],
      type: 'tasks',
      title: 'À faire aujourd’hui',
      body: titles.length === 1 ? `« ${titles[0]} »` : `${titles.length} tâches : ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? '…' : ''}`,
      route: '/tabs/tasks'
    });
  }
  if (tasks.length > 0) {
    await db.collection('tasks').updateMany({ _id: { $in: tasks.map(task => task._id) } }, { $set: { reminderSentFor: today } });
  }
  return tasks.length;
}

async function sendEventReminders(today = todayIso()) {
  const db = getDB();
  const tomorrow = addDays(today, 1);
  const events = await db.collection('calendar_events').find({ date: tomorrow, reminderSent: { $exists: false } }).toArray();

  for (const event of events) {
    const household = await db.collection('households').findOne({ _id: event.householdId }, { projection: { members: 1 } });
    if (household) {
      await notify({
        userIds: household.members.map(m => m.userId),
        type: 'calendar',
        title: 'Demain',
        body: `${event.title}${event.time ? ` à ${event.time}` : ''}${event.location ? ` · ${event.location}` : ''}`,
        route: '/tabs/calendar'
      });
    }
    await db.collection('calendar_events').updateOne({ _id: event._id }, { $set: { reminderSent: new Date() } });
  }
  return events.length;
}

/** @param {{ force?: boolean }} options force: ignore the daytime window (tests, manual runs) */
async function runDailyJobs({ force = false } = {}) {
  const hour = parisHour();
  if (!force && (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR)) {
    return { skipped: `outside ${SEND_FROM_HOUR}:00-${SEND_UNTIL_HOUR}:00 (Paris)` };
  }
  const today = todayIso();
  return {
    documents: await sendDocumentReminders(today),
    tasks: await sendTaskReminders(today),
    events: await sendEventReminders(today)
  };
}

function startScheduler() {
  const run = () => runDailyJobs()
    .then(result => {
      if (!result.skipped && (result.documents || result.tasks || result.events)) {
        console.log('[jobs] Reminders sent:', result);
      }
    })
    .catch(error => console.error('[jobs] Daily jobs failed:', error));

  setTimeout(run, 60 * 1000).unref();
  setInterval(run, HOUR_MS).unref();
}

module.exports = { runDailyJobs, startScheduler, sendDocumentReminders, sendTaskReminders, sendEventReminders };

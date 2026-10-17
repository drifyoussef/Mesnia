const { MongoClient, ObjectId } = require('mongodb');

let db = null;
let client = null;

/** @param {string} [uri] defaults to MONGODB_URI (tests pass an in-memory server) */
const connectDB = async (uri = process.env.MONGODB_URI, dbName = process.env.DB_NAME || 'Mesnia') => {
  if (db) return db;

  client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  db = client.db(dbName);
  console.log(`✅ Connected to MongoDB database: ${dbName}`);

  await migrate(db);
  await createIndexes(db);
  return db;
};

// ---------- Migrations (idempotent, run at every start) ----------

/** Indexes from an older schema (snake_case fields that no longer exist). */
const LEGACY_INDEXES = {
  // Unique on a field no household has anymore: MongoDB indexes the missing field as null and
  // a unique index accepts a single null, so it blocked the creation of a second household.
  households: ['invite_code_1'],
  recipes: ['household_id_1', 'created_at_-1'],
  swipe_sessions: ['household_id_1_date_-1'],
  shopping_lists: ['household_id_1_status_1']
};

async function migrate(database) {
  for (const [collection, names] of Object.entries(LEGACY_INDEXES)) {
    const existing = await database.collection(collection).indexes().catch(() => []);
    for (const name of names) {
      if (existing.some(index => index.name === name)) {
        await database.collection(collection).dropIndex(name);
        console.log(`🧹 Dropped legacy index ${collection}.${name}`);
      }
    }
  }

  // Emails are compared in lower case: "Jean@x.fr" and "jean@x.fr" are the same account
  await database.collection('users').updateMany(
    { email: /[A-Z]/ },
    [{ $set: { email: { $toLower: '$email' } } }]
  );

  // Shopping lists used to store householdId as a string, everything else as an ObjectId
  const lists = await database.collection('shopping_lists').find({ householdId: { $type: 'string' } }).toArray();
  for (const list of lists) {
    if (ObjectId.isValid(list.householdId)) {
      await database.collection('shopping_lists').updateOne(
        { _id: list._id },
        { $set: { householdId: new ObjectId(list.householdId) } }
      );
    }
  }
}

// ---------- Indexes ----------

const INDEXES = [
  ['users', { email: 1 }, { unique: true }],
  ['recipes', { householdId: 1, createdAt: -1 }],
  ['recipes', { title: 'text', description: 'text' }],
  ['households', { inviteCode: 1 }, { unique: true, sparse: true }],
  ['households', { 'members.userId': 1 }],
  ['swipe_sessions', { householdId: 1, date: 1 }, { unique: true }],
  ['shopping_lists', { householdId: 1, status: 1 }],
  ['schedules', { householdId: 1, userId: 1 }, { unique: true }],
  ['calendar_events', { householdId: 1, date: 1 }],
  ['trips', { householdId: 1, startDate: 1 }],
  ['tasks', { householdId: 1, done: 1, dueDate: 1 }],
  ['meal_plans', { householdId: 1, date: 1 }],
  ['documents', { householdId: 1, createdAt: -1 }],
  ['documents', { expiresAt: 1 }],
  ['devices', { token: 1 }, { unique: true }],
  ['devices', { userId: 1 }],
  // MongoDB deletes each request once its expiresAt has passed
  ['password_resets', { expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ['email_verifications', { expiresAt: 1 }, { expireAfterSeconds: 0 }]
];

/** One try per index: a failing one (duplicates...) must not prevent the others. */
async function createIndexes(database) {
  for (const [collection, keys, options = {}] of INDEXES) {
    try {
      await database.collection(collection).createIndex(keys, options);
    } catch (error) {
      console.warn(`⚠️ Index ${collection} ${JSON.stringify(keys)} not created:`, error.message);
    }
  }
}

const getDB = () => {
  if (!db) {
    throw new Error('Database not connected. Call connectDB first.');
  }
  return db;
};

const closeDB = async () => {
  if (client) {
    await client.close();
    db = null;
    client = null;
  }
};

module.exports = { connectDB, getDB, closeDB };

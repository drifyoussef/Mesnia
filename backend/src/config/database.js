const { MongoClient } = require('mongodb');

let db = null;
let client = null;

const connectDB = async () => {
  try {
    if (db) {
      console.log('✅ Already connected to MongoDB');
      return db;
    }

    const uri = process.env.MONGODB_URI;
    const dbName = process.env.DB_NAME || 'Mesnia';

    console.log('🔌 Connecting to MongoDB Atlas...');
    
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 2,
    });

    await client.connect();
    db = client.db(dbName);

    console.log(`✅ Connected to MongoDB database: ${dbName}`);
    
    // Create indexes
    await createIndexes(db);
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
};

const createIndexes = async (database) => {
  try {
    // Recipes indexes
    await database.collection('recipes').createIndex({ household_id: 1 });
    await database.collection('recipes').createIndex({ householdId: 1, createdAt: -1 });
    await database.collection('recipes').createIndex({ created_at: -1 });
    await database.collection('recipes').createIndex({ title: 'text', description: 'text' });
    
    // Households indexes
    await database.collection('households').createIndex({ invite_code: 1 }, { unique: true });
    await database.collection('households').createIndex({ 'members.userId': 1 });
    
    // Swipe sessions indexes
    await database.collection('swipe_sessions').createIndex({ household_id: 1, date: -1 });
    
    // Shopping lists indexes
    await database.collection('shopping_lists').createIndex({ household_id: 1, status: 1 });

    // Schedules: one document per member of a household
    await database.collection('schedules').createIndex({ householdId: 1, userId: 1 }, { unique: true });

    // Shared household calendar
    await database.collection('calendar_events').createIndex({ householdId: 1, date: 1 });

    // Trips
    await database.collection('trips').createIndex({ householdId: 1, startDate: 1 });

    // Password reset requests: MongoDB deletes each one once its expiresAt has passed
    await database.collection('password_resets').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    // Documents (files themselves are in the GridFS bucket "document_files")
    await database.collection('documents').createIndex({ householdId: 1, createdAt: -1 });
    
    console.log('✅ Database indexes created');
  } catch (error) {
    console.warn('⚠️ Index creation warning:', error.message);
  }
};

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
    console.log('✅ MongoDB connection closed');
  }
};

module.exports = { connectDB, getDB, closeDB };

const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');
const { deleteDocuments } = require('./documents');
const { publish } = require('./realtime');

/** Collections holding household data (documents and their files are handled apart). */
const HOUSEHOLD_COLLECTIONS = [
  'recipes', 'shopping_lists', 'schedules', 'calendar_events', 'trips', 'swipe_sessions', 'tasks', 'meal_plans'
];

/** Deletes a household and everything in it, and detaches its members. */
async function deleteHousehold(householdId) {
  const db = getDB();
  await db.collection('households').deleteOne({ _id: householdId });
  await Promise.all(HOUSEHOLD_COLLECTIONS.map(name => db.collection(name).deleteMany({ householdId })));
  await deleteDocuments({ householdId });
  await db.collection('users').updateMany(
    { householdId },
    { $set: { householdId: null, updatedAt: new Date() } }
  );
  publish(householdId, 'household');
}

/** Who takes over when the owner leaves: the oldest admin, otherwise the oldest member. */
function nextOwner(members) {
  const byAge = [...members].sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));
  return byAge.find(member => member.role === 'admin') || byAge[0];
}

/**
 * Takes a member out of a household (they leave, are removed, or delete their account).
 * The last member leaving deletes the household. The owner leaving hands it over to another
 * member instead of deleting it for everyone. What only they could see goes with them.
 * @returns {Promise<'deleted' | 'left'>}
 */
async function removeMember(household, userId) {
  const db = getDB();
  const remaining = household.members.filter(member => member.userId !== userId);

  if (remaining.length === 0) {
    await deleteHousehold(household._id);
    return 'deleted';
  }

  const set = { updatedAt: new Date() };
  if (household.createdBy === userId) {
    const owner = nextOwner(remaining);
    set.createdBy = owner.userId;
    // The new owner must be able to manage the household
    set.members = remaining.map(member => (member.userId === owner.userId ? { ...member, role: 'admin' } : member));
  } else {
    set.members = remaining;
  }
  await db.collection('households').updateOne({ _id: household._id }, { $set: set });

  await Promise.all([
    // Their private documents: nobody else can open them anymore
    deleteDocuments({ householdId: household._id, createdBy: userId, private: true }),
    db.collection('schedules').deleteMany({ householdId: household._id, userId }),
    // Their tasks stay, for someone else to pick up
    db.collection('tasks').updateMany({ householdId: household._id, assignedTo: userId }, { $set: { assignedTo: null } }),
    ObjectId.isValid(userId)
      ? db.collection('users').updateOne(
        { _id: new ObjectId(userId), householdId: household._id },
        { $set: { householdId: null, updatedAt: new Date() } }
      )
      : null
  ]);
  publish(household._id, 'household');
  return 'left';
}

module.exports = { deleteHousehold, removeMember };

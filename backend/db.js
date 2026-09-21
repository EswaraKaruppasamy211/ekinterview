const { MongoClient } = require('mongodb');

const defaultDatabaseName = process.env.MONGODB_DATABASE || 'ekinterview';

let client = null;
let database = null;
let connectionPromise = null;

function requireMongoUrl() {
  const mongoUrl = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!mongoUrl) {
    throw new Error('MONGODB_URI or MONGODB_URL is required for the application database.');
  }
  return mongoUrl;
}

function isMissingValue(value) {
  return value === null || value === undefined || value === '';
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeIdentifier(field, value) {
  if (isMissingValue(value)) return null;

  const fieldName = String(field || '').trim().toLowerCase();
  const isNumericIdField = ['id', 'user_id', 'userid', 'userId'].includes(fieldName);
  if (isNumericIdField) {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return { $in: [asNumber, String(asNumber)] };
    }
    return String(value).trim();
  }

  return normalize(value);
}

function userCollection() {
  return database.collection('users');
}

function studentProfileCollection() {
  return database.collection('student_profiles');
}

function companyProfileCollection() {
  return database.collection('company_profiles');
}

function profileUserFilter(userId) {
  const values = [];
  if (!isMissingValue(userId)) {
    const asNumber = Number(userId);
    values.push(userId);
    if (!Number.isNaN(asNumber)) {
      values.push(asNumber, String(asNumber));
    }
    values.push(String(userId));
  }

  const uniqueValues = [...new Set(values.filter(value => !isMissingValue(value)))];
  if (uniqueValues.length === 0) {
    return { $or: [{ user_id: null }, { userId: null }] };
  }

  const filterValue = uniqueValues.length > 1 ? { $in: uniqueValues } : uniqueValues[0];

  return {
    $or: [
      { user_id: filterValue },
      { userId: filterValue }
    ]
  };
}

async function init() {
  if (database) return database;
  if (connectionPromise) return connectionPromise;

  const mongoUrl = requireMongoUrl();

  connectionPromise = (async () => {
    try {
      client = new MongoClient(mongoUrl, {
        serverSelectionTimeoutMS: 10000
      });
      await client.connect();
      const uriDatabaseName = new URL(mongoUrl).pathname.replace(/^\/+/, '');
      database = client.db(uriDatabaseName || defaultDatabaseName);

      for (const [collection, index, options] of [
        [userCollection(), { email: 1 }, { unique: true }],
        [userCollection(), { username: 1 }, { unique: true }],
        [userCollection(), { id: 1 }, { unique: true }],
        [studentProfileCollection(), { user_id: 1 }, { unique: true }],
        [companyProfileCollection(), { user_id: 1 }, { unique: true }]
      ]) {
        try {
          await collection.createIndex(index, options);
        } catch (error) {
          console.warn('MongoDB index setup skipped:', error.message || error);
        }
      }

      await database.command({ ping: 1 });
      console.log(`MongoDB connected to database "${database.databaseName}".`);
      return database;
    } catch (error) {
      database = null;
      if (client) {
        await client.close().catch(() => {});
      }
      client = null;
      console.error('MongoDB connection failed:', error && error.stack ? error.stack : error);
      throw new Error(`MongoDB connection failed: ${error.message || error}`);
    }
  })();

  try {
    return await connectionPromise;
  } catch (error) {
    connectionPromise = null;
    throw error;
  }
}

async function nextUserId() {
  await init();
  const highestUser = await userCollection().findOne(
    { id: { $type: 'number' } },
    { sort: { id: -1 }, projection: { id: 1 } }
  );
  const highestId = Number(highestUser && highestUser.id) || 0;
  const sequence = await database.collection('counters').findOneAndUpdate(
    { _id: 'users' },
    [
      {
        $set: {
          seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, highestId] }, 1] }
        }
      }
    ],
    { upsert: true, returnDocument: 'after' }
  );
  return Number(sequence && sequence.seq);
}

async function findUserByField(field, value) {
  await init();
  const queryValue = normalizeIdentifier(field, value);
  if (queryValue === null) return null;
  return userCollection().findOne(
    { [field]: queryValue },
    { projection: { _id: 0 } }
  );
}

async function createUser({
  email,
  username,
  passwordHash,
  salt,
  role,
  dob
}) {
  await init();

  if (isMissingValue(email) || isMissingValue(username) || isMissingValue(passwordHash) || isMissingValue(salt)) {
    console.error('createUser: required user fields are missing.');
    return null;
  }

  const normalizedEmail = normalize(email);
  const normalizedUsername = normalize(username);
  const existing = await userCollection().findOne({
    $or: [{ email: normalizedEmail }, { username: normalizedUsername }]
  });
  if (existing) {
    console.error('createUser: email or username already exists.');
    return null;
  }

  const id = await nextUserId();
  const user = {
    id,
    email: normalizedEmail,
    username: normalizedUsername,
    password_hash: passwordHash,
    salt,
    role: role || 'student',
    dob: dob || null,
    verified: 1,
    is_active: 1,
    created_at: Date.now()
  };

  try {
    await userCollection().insertOne(user);
    const { _id, password_hash, salt: storedSalt, ...safeUser } = user;
    return safeUser;
  } catch (error) {
    console.error('MongoDB createUser operation failed:', error && error.stack ? error.stack : error);
    throw error;
  }
}

async function getUserByEmail(email) {
  return findUserByField('email', email);
}

async function getUserByUsername(username) {
  return findUserByField('username', username);
}

async function getUserByIdentity(identity) {
  await init();
  if (isMissingValue(identity)) return null;
  const normalizedIdentity = normalize(identity);
  return userCollection().findOne(
    { $or: [{ email: normalizedIdentity }, { username: normalizedIdentity }] },
    { projection: { _id: 0 } }
  );
}

async function getUserById(id) {
  await init();
  if (isMissingValue(id)) return null;
  const numericId = Number(id);
  return userCollection().findOne(
    {
      $or: [
        { id: Number.isNaN(numericId) ? id : numericId },
        { id: Number.isNaN(numericId) ? String(id) : String(numericId) }
      ]
    },
    { projection: { _id: 0 } }
  );
}

async function getAllUsers() {
  await init();
  return userCollection()
    .find({}, { projection: { _id: 0 } })
    .sort({ id: 1 })
    .toArray();
}

function profileDocument(userId, profile) {
  const document = { ...profile, user_id: userId };
  delete document._id;
  return document;
}

async function createOrUpdateStudentProfile(userId, profile) {
  await init();
  if (isMissingValue(userId) || !profile) return null;
  const document = profileDocument(userId, profile);
  await studentProfileCollection().updateOne(
    profileUserFilter(userId),
    { $set: document },
    { upsert: true }
  );
  return getStudentProfileByUserId(userId);
}

async function getStudentProfileByUserId(userId) {
  await init();
  if (isMissingValue(userId)) return null;
  return studentProfileCollection().findOne(
    profileUserFilter(userId),
    { projection: { _id: 0 } }
  );
}

async function getCompanyProfileByUserId(userId) {
  await init();
  if (isMissingValue(userId)) return null;
  return companyProfileCollection().findOne(
    profileUserFilter(userId),
    { projection: { _id: 0 } }
  );
}

async function createOrUpdateCompanyProfile(userId, profile) {
  await init();
  if (isMissingValue(userId) || !profile) return null;
  const document = profileDocument(userId, profile);
  await companyProfileCollection().updateOne(
    profileUserFilter(userId),
    { $set: document },
    { upsert: true }
  );
  return getCompanyProfileByUserId(userId);
}

module.exports = {
  init,
  createUser,
  getUserByEmail,
  getUserByUsername,
  getUserByIdentity,
  getUserById,
  getAllUsers,
  createOrUpdateStudentProfile,
  getStudentProfileByUserId,
  createOrUpdateCompanyProfile,
  getCompanyProfileByUserId
};

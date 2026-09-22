const { MongoClient } = require('mongodb');

const defaultDatabaseName = process.env.MONGODB_DATABASE || 'ekinterview';

let client = null;
let database = null;
let connectionPromise = null;

const memoryState = {
  collections: Object.create(null)
};

function getMemoryCollection(name) {
  const key = String(name || '');
  if (!memoryState.collections[key]) {
    memoryState.collections[key] = [];
  }
  return memoryState.collections[key];
}

function applyMemoryUpdate(doc, update) {
  if (!doc || !update || typeof update !== 'object') return doc;

  if (update.$set && typeof update.$set === 'object') {
    Object.assign(doc, update.$set);
  }
  if (update.$push && typeof update.$push === 'object') {
    Object.entries(update.$push).forEach(([field, value]) => {
      const existing = Array.isArray(doc[field]) ? doc[field] : [];
      existing.push(value);
      doc[field] = existing;
    });
  }
  return doc;
}

function matchesMemoryFilter(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;
  if (Array.isArray(filter)) return false;

  if (filter.$or && Array.isArray(filter.$or)) {
    return filter.$or.some(subFilter => matchesMemoryFilter(doc, subFilter));
  }

  return Object.entries(filter).every(([key, expectedValue]) => {
    if (key === '$or') return true;
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue) && expectedValue.$in) {
      return expectedValue.$in.includes(doc[key]);
    }
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue) && expectedValue.$type) {
      if (expectedValue.$type === 'number') return typeof doc[key] === 'number';
      return typeof doc[key] === expectedValue.$type;
    }
    return doc[key] === expectedValue;
  });
}

function createMemoryCollection(name) {
  const collectionName = String(name || '');
  return {
    async createIndex() { return null; },
    async insertOne(document) {
      const record = { ...document, _id: document && document._id ? document._id : `${collectionName}:${Date.now()}:${Math.random()}` };
      getMemoryCollection(collectionName).push(record);
      return { insertedId: record._id };
    },
    async updateOne(filter, update, options = {}) {
      let result = getMemoryCollection(collectionName).find(doc => matchesMemoryFilter(doc, filter));
      if (!result && options.upsert) {
        const inserted = {};
        Object.entries(filter || {}).forEach(([key, value]) => {
          if (key !== '$or') inserted[key] = value;
        });
        const appended = { ...inserted, ...((update && update.$set) || {}) };
        appended._id = `${collectionName}:${Date.now()}:${Math.random()}`;
        getMemoryCollection(collectionName).push(appended);
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 1 };
      }
      if (!result) return { matchedCount: 0, modifiedCount: 0 };
      applyMemoryUpdate(result, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async findOne(filter, options = {}) {
      const record = getMemoryCollection(collectionName).find(doc => matchesMemoryFilter(doc, filter));
      if (!record) return null;
      const projected = { ...record };
      if (options && options.projection && projected._id !== undefined && !options.projection._id) {
        delete projected._id;
      }
      return projected;
    },
    find(filter = {}) {
      const records = getMemoryCollection(collectionName).filter(doc => matchesMemoryFilter(doc, filter));
      return {
        sort(sortObject = {}) {
          const entries = Object.entries(sortObject || {});
          if (!entries.length) return this;
          records.sort((a, b) => {
            for (const [field, direction] of entries) {
              const dir = direction === -1 ? -1 : 1;
              if ((a[field] ?? '') > (b[field] ?? '')) return dir;
              if ((a[field] ?? '') < (b[field] ?? '')) return -dir;
            }
            return 0;
          });
          return this;
        },
        toArray() {
          return Promise.resolve(records.map(record => ({ ...record })));
        }
      };
    },
    async findOneAndUpdate(filter, update, options = {}) {
      const existing = getMemoryCollection(collectionName).find(doc => matchesMemoryFilter(doc, filter));
      if (!existing) {
        if (options && options.upsert) {
          const inserted = { ...((filter && filter.$or) ? {} : filter), _id: `${collectionName}:${Date.now()}:${Math.random()}` };
          if (update && typeof update === 'object' && !Array.isArray(update) && update.$set) {
            Object.assign(inserted, update.$set);
          }
          getMemoryCollection(collectionName).push(inserted);
          return { ...inserted };
        }
        return null;
      }
      applyMemoryUpdate(existing, update);
      return { ...existing };
    },
    async deleteOne(filter) {
      const index = getMemoryCollection(collectionName).findIndex(doc => matchesMemoryFilter(doc, filter));
      if (index === -1) return { deletedCount: 0 };
      getMemoryCollection(collectionName).splice(index, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(filter) {
      const remaining = getMemoryCollection(collectionName).filter(doc => !matchesMemoryFilter(doc, filter));
      const deletedCount = getMemoryCollection(collectionName).length - remaining.length;
      memoryState.collections[collectionName] = remaining;
      return { deletedCount };
    },
    async command() {
      return { ok: 1 };
    }
  };
}

function requireMongoUrl() {
  const mongoUrl = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!mongoUrl) {
    return null;
  }
  return mongoUrl;
}

function isMissingValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function identifierVariants(value) {
  if (isMissingValue(value)) return [];

  const variants = new Set();
  variants.add(value);
  variants.add(String(value));

  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) {
    variants.add(asNumber);
    variants.add(String(asNumber));
  }

  return [...variants].filter(item => !isMissingValue(item));
}

function normalizeIdentifier(field, value) {
  if (isMissingValue(value)) return null;

  const fieldName = String(field || '').trim().toLowerCase();
  const isNumericIdField = ['id', 'user_id', 'userid', 'userId'].includes(fieldName);
  if (isNumericIdField) {
    const variants = identifierVariants(value);
    if (variants.length > 1) {
      return { $in: variants };
    }
    return variants[0];
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

function workflowCollection(name) {
  return database.collection(String(name));
}

function withoutMongoId(document) {
  if (!document) return document;
  const { _id, ...safeDocument } = document;
  return safeDocument;
}

function profileUserFilter(userId) {
  const uniqueValues = [...new Set(identifierVariants(userId))];
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
  if (!mongoUrl) {
    console.warn('MongoDB not configured; using in-memory fallback storage for demo mode.');
    database = {
      collection: (name) => createMemoryCollection(name),
      command: async () => ({ ok: 1, databaseName: defaultDatabaseName })
    };
    return database;
  }

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
        [companyProfileCollection(), { user_id: 1 }, { unique: true }],
        [workflowCollection('jobs'), { id: 1 }, { unique: true }],
        [workflowCollection('applications'), { id: 1 }, { unique: true }],
        [workflowCollection('notifications'), { id: 1 }, { unique: true }],
        [workflowCollection('offers'), { id: 1 }, { unique: true }],
        [workflowCollection('student_skills'), { user_id: 1, skill_name: 1 }, { unique: true }],
        [workflowCollection('assessments'), { user_id: 1 }, { unique: true }],
        [workflowCollection('projects'), { id: 1 }, { unique: true }],
        [workflowCollection('certifications'), { id: 1 }, { unique: true }],
        [workflowCollection('messages'), { id: 1 }, { unique: true }]
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
  const mongoUrl = requireMongoUrl();
  if (!mongoUrl) {
    const existing = getMemoryCollection('users').map(user => Number(user.id) || 0);
    return existing.length ? Math.max(...existing) + 1 : 1;
  }

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
  dob,
  mobile
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
    mobile: mobile || '',
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

  const idVariants = identifierVariants(id);
  const filter = idVariants.length > 1
    ? { $or: idVariants.map(value => ({ id: value })) }
    : { id: idVariants[0] };

  return userCollection().findOne(filter, { projection: { _id: 0 } });
}

async function getAllUsers() {
  await init();
  return userCollection()
    .find({}, { projection: { _id: 0 } })
    .sort({ id: 1 })
    .toArray();
}

async function nextSequence(sequenceName, collectionName, field = 'id') {
  await init();
  const mongoUrl = requireMongoUrl();
  if (!mongoUrl) {
    const existing = getMemoryCollection(collectionName).map(record => Number(record[field]) || 0);
    return existing.length ? Math.max(...existing) + 1 : 1;
  }

  const highest = await workflowCollection(collectionName).findOne(
    { [field]: { $type: 'number' } },
    { sort: { [field]: -1 }, projection: { [field]: 1 } }
  );
  const highestValue = Number(highest && highest[field]) || 0;
  const result = await workflowCollection('counters').findOneAndUpdate(
    { _id: String(sequenceName) },
    [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, highestValue] }, 1] } } }],
    { upsert: true, returnDocument: 'after' }
  );
  return Number(result && result.seq);
}

async function listRecords(collectionName, filter = {}, sort = {}) {
  await init();
  const records = await workflowCollection(collectionName).find(filter).sort(sort).toArray();
  return records.map(withoutMongoId);
}

async function getRecord(collectionName, filter) {
  await init();
  return withoutMongoId(await workflowCollection(collectionName).findOne(filter));
}

async function insertRecord(collectionName, document) {
  await init();
  const cleanDocument = withoutMongoId(document);
  await workflowCollection(collectionName).insertOne(cleanDocument);
  return cleanDocument;
}

async function updateRecord(collectionName, filter, update, options = {}) {
  await init();
  const result = await workflowCollection(collectionName).findOneAndUpdate(
    filter,
    update,
    { ...options, returnDocument: 'after' }
  );
  return withoutMongoId(result);
}

async function deleteRecord(collectionName, filter) {
  await init();
  const result = await workflowCollection(collectionName).deleteOne(filter);
  return result.deletedCount > 0;
}

async function deleteRecords(collectionName, filter) {
  await init();
  const result = await workflowCollection(collectionName).deleteMany(filter);
  return result.deletedCount;
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
  nextSequence,
  listRecords,
  getRecord,
  insertRecord,
  updateRecord,
  deleteRecord,
  deleteRecords,
  createOrUpdateStudentProfile,
  getStudentProfileByUserId,
  createOrUpdateCompanyProfile,
  getCompanyProfileByUserId
};

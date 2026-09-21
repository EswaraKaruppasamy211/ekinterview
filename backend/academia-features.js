/*
 * MongoDB-backed faculty and academia feature store.
 *
 * The module deliberately keeps the data model generic: each feature is a
 * collection with the same lifecycle operations, while the resource name is
 * retained on every document for reporting and future migrations.
 */
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const RESOURCE_NAMES = [
  'faculty-internships',
  'fdp',
  'learning-programs',
  'mentorship',
  'workshops',
  'guest-lectures',
  'live-projects',
  'research-collaborations',
  'consultancy',
  'internship-progress',
  'portfolio-extensions'
];

const aliases = new Map([
  ['faculty-internship', 'faculty-internships'],
  ['learning-program', 'learning-programs'],
  ['guest-lecture', 'guest-lectures'],
  ['live-project', 'live-projects'],
  ['research-collaboration', 'research-collaborations'],
  ['internship-feedback', 'internship-progress'],
  ['portfolio-extension', 'portfolio-extensions']
]);

let client;
let database;
let connectionPromise;

function normalizeResource(resource) {
  const value = String(resource || '').trim().toLowerCase().replace(/_/g, '-');
  return aliases.get(value) || value;
}

function assertResource(resource) {
  const normalized = normalizeResource(resource);
  if (!RESOURCE_NAMES.includes(normalized)) throw new Error(`Unsupported academia resource: ${resource}`);
  return normalized;
}

function mongoUrl() {
  const value = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!value) throw new Error('MONGODB_URI or MONGODB_URL is required for academia features.');
  return value;
}

async function init() {
  if (database) return database;
  if (connectionPromise) return connectionPromise;
  connectionPromise = (async () => {
    const connection = new MongoClient(mongoUrl(), { serverSelectionTimeoutMS: 10000 });
    try {
      await connection.connect();
      const parsed = new URL(mongoUrl());
      database = connection.db(parsed.pathname.replace(/^\/+/, '') || process.env.MONGODB_DATABASE || 'ekinterview');
      for (const resource of RESOURCE_NAMES) {
        const collection = database.collection(`academia_${resource.replace(/-/g, '_')}`);
        await collection.createIndex({ id: 1 }, { unique: true });
        await collection.createIndex({ created_by: 1, created_at: -1 });
        await collection.createIndex({ status: 1, created_at: -1 });
      }
      await database.command({ ping: 1 });
      client = connection;
      return database;
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
  })();
  try {
    return await connectionPromise;
  } catch (error) {
    connectionPromise = null;
    throw error;
  }
}

function collection(resource) {
  const normalized = assertResource(resource);
  return database.collection(`academia_${normalized.replace(/-/g, '_')}`);
}

function withoutMongoId(document) {
  if (!document) return null;
  const { _id, ...result } = document;
  return result;
}

function scopedFilter(user, filter = {}) {
  // Owners can always see their own records; administrators and college
  // users can list the complete institutional catalogue.
  if (user && ['admin', 'college', 'university_admin'].includes(user.role)) return filter;
  return { ...filter, created_by: user && String(user.id) };
}

async function create(resource, payload, user) {
  await init();
  const now = new Date().toISOString();
  const document = {
    ...payload,
    id: String(payload.id || crypto.randomUUID()),
    resource: assertResource(resource),
    created_by: String(user.id),
    created_at: payload.created_at || now,
    updated_at: now,
    status: payload.status || 'open',
    applications: Array.isArray(payload.applications) ? payload.applications : [],
    registrations: Array.isArray(payload.registrations) ? payload.registrations : [],
    feedback: Array.isArray(payload.feedback) ? payload.feedback : []
  };
  delete document._id;
  await collection(resource).insertOne(document);
  return withoutMongoId(document);
}

async function list(resource, filter = {}, user) {
  await init();
  return (await collection(resource).find(filter, { projection: { _id: 0 } })
    .sort({ created_at: -1 }).toArray()).map(withoutMongoId);
}

async function get(resource, id, user) {
  await init();
  return withoutMongoId(await collection(resource).findOne(
    { id: String(id) },
    { projection: { _id: 0 } }
  ));
}

async function update(resource, id, payload, user) {
  await init();
  const update = { ...payload, updated_at: new Date().toISOString() };
  delete update._id;
  delete update.id;
  delete update.resource;
  delete update.created_by;
  const result = await collection(resource).findOneAndUpdate(
    scopedFilter(user, { id: String(id) }),
    { $set: update },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return withoutMongoId(result);
}

async function remove(resource, id, user) {
  await init();
  const result = await collection(resource).deleteOne(scopedFilter(user, { id: String(id) }));
  return result.deletedCount > 0;
}

async function apply(resource, id, applicant, data = {}) {
  return appendLifecycle(resource, id, 'applications', { user_id: String(applicant.id), ...data }, applicant, false);
}

async function register(resource, id, participant, data = {}) {
  return appendLifecycle(resource, id, 'registrations', { user_id: String(participant.id), ...data }, participant, false);
}

async function status(resource, id, user) {
  const item = await get(resource, id, user);
  if (!item) return null;
  return { id: item.id, resource: item.resource, status: item.status, updated_at: item.updated_at };
}

async function setStatus(resource, id, value, user) {
  return update(resource, id, { status: value }, user);
}

async function feedback(resource, id, author, data = {}) {
  return appendLifecycle(resource, id, 'feedback', {
    user_id: String(author.id),
    rating: data.rating,
    comment: data.comment || data.feedback || '',
    created_at: new Date().toISOString()
  }, author, false);
}

async function appendLifecycle(resource, id, field, entry, user, requireOwner = true) {
  await init();
  const filter = { id: String(id) };
  if (requireOwner && !['admin', 'college', 'university_admin'].includes(user.role)) {
    filter.created_by = String(user.id);
  }
  const result = await collection(resource).findOneAndUpdate(
    scopedFilter(user, filter),
    { $push: { [field]: entry }, $set: { updated_at: new Date().toISOString() } },
    { returnDocument: 'after', projection: { _id: 0 } }
  );
  return withoutMongoId(result);
}

module.exports = {
  RESOURCE_NAMES,
  init,
  create,
  list,
  get,
  update,
  remove,
  delete: remove,
  apply,
  register,
  status,
  setStatus,
  feedback,
  normalizeResource
};

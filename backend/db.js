const crypto = require('crypto');
const { pool, init } = require('./database/connection');

const missing = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());
const norm = value => String(value ?? '').trim().toLowerCase();
const clean = value => value && typeof value === 'object' ? { ...value } : value;

async function rows(sql, params = []) { await init(); return (await pool.query(sql, params)).rows; }
function whereFilter(filter, start = 1) {
  const parts = [], params = [];
  for (const [key, value] of Object.entries(filter || {})) {
    if (key === '$or') {
      const alternatives = [];
      for (const item of Array.isArray(value) ? value : []) {
        const alternative = whereFilter(item, start + params.length);
        alternatives.push(alternative.sql);
        params.push(...alternative.params);
      }
      if (alternatives.length) parts.push(`(${alternatives.join(' OR ')})`);
    } else if (value && typeof value === 'object' && Array.isArray(value.$in)) {
      if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
      parts.push(`data->>'${key}' = ANY($${start + params.length}::text[])`);
      params.push(value.$in.map(String));
    } else {
      if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
      parts.push(`data->>'${key}' = $${start + params.length}`);
      params.push(String(value));
    }
  }
  return { sql: parts.length ? parts.join(' AND ') : 'TRUE', params };
}
function sortSql(sort = {}) {
  const entries = Object.entries(sort);
  const safeEntries = entries.filter(([key]) => /^[A-Za-z0-9_]+$/.test(key));
  return safeEntries.length ? ` ORDER BY ${safeEntries.map(([key, direction]) => `data->>'${key}' ${direction === -1 ? 'DESC' : 'ASC'}`).join(', ')}` : '';
}

async function createUser(input) {
  if (missing(input.email) || missing(input.username) || missing(input.passwordHash) || missing(input.salt)) return null;
  const email = norm(input.email), username = norm(input.username);
  try {
    const result = await rows(`INSERT INTO users (email,username,password_hash,salt,role,dob,mobile)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id,email,username,role,dob,mobile,verified,is_active,created_at`,
      [email, username, input.passwordHash, input.salt, input.role || 'student', input.dob || null, input.mobile || '']);
    return result[0];
  } catch (error) {
    if (error.code === '23505') return null;
    throw error;
  }
}
async function getUserByEmail(email) { return findUser('email', email); }
async function getUserByUsername(username) { return findUser('username', username); }
async function getUserByIdentity(identity) {
  if (missing(identity)) return null;
  const result = await rows('SELECT id,email,username,password_hash,salt,role,dob,mobile,verified,is_active,created_at FROM users WHERE email=$1 OR username=$1 LIMIT 1', [norm(identity)]);
  return result[0] || null;
}
async function findUser(field, value) {
  if (missing(value) || !['email', 'username'].includes(field)) return null;
  const result = await rows(`SELECT id,email,username,password_hash,salt,role,dob,mobile,verified,is_active,created_at FROM users WHERE ${field}=$1 LIMIT 1`, [norm(value)]);
  return result[0] || null;
}
async function getUserById(id) {
  if (missing(id)) return null;
  const result = await rows('SELECT id,email,username,password_hash,salt,role,dob,mobile,verified,is_active,created_at FROM users WHERE id=$1 LIMIT 1', [Number(id)]);
  return result[0] || null;
}
async function getAllUsers() { return rows('SELECT id,email,username,role,dob,mobile,verified,is_active,created_at FROM users ORDER BY id'); }
async function nextSequence(sequenceName, collectionName) {
  const result = await rows(`SELECT COALESCE(MAX((data->>'id')::bigint),0)+1 AS next
    FROM workflow_records
    WHERE collection_name=$1 AND data->>'id' ~ '^[0-9]+$'`, [collectionName]);
  return Number(result[0].next);
}
async function listRecords(collectionName, filter = {}, sort = {}) {
  const where = whereFilter(filter);
  return rows(`SELECT data AS record FROM workflow_records WHERE collection_name=$${where.params.length + 1} AND ${where.sql}${sortSql(sort)}`,
    [...where.params, collectionName]).then(items => items.map(item => item.record));
}
async function getRecord(collectionName, filter) {
  const where = whereFilter(filter);
  const result = await rows(`SELECT data AS record FROM workflow_records WHERE collection_name=$${where.params.length + 1} AND ${where.sql} LIMIT 1`, [...where.params, collectionName]);
  return result[0] ? result[0].record : null;
}
async function insertRecord(collectionName, document) {
  const data = clean(document); const id = String(data.id ?? crypto.randomUUID());
  data.id = data.id ?? id;
  await rows('INSERT INTO workflow_records(collection_name,record_id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT (collection_name,record_id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()', [collectionName, id, JSON.stringify(data)]);
  return data;
}
async function getOrCreateRecord(collectionName, document) {
  const data = clean(document); const id = String(data.id ?? crypto.randomUUID());
  data.id = data.id ?? id;
  const inserted = await rows('INSERT INTO workflow_records(collection_name,record_id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT (collection_name,record_id) DO NOTHING RETURNING data AS record', [collectionName, id, JSON.stringify(data)]);
  if (inserted[0]) return inserted[0].record;
  const existing = await getRecord(collectionName, { id });
  if (!existing) throw new Error(`Unable to load existing ${collectionName} record.`);
  return existing;
}
async function updateRecord(collectionName, filter, update, options = {}) {
  const current = await getRecord(collectionName, filter);
  if (!current && !options.upsert) return null;
  const replacement = update && update.$set
    ? update.$set
    : Object.fromEntries(Object.entries(update || {}).filter(([key]) => !key.startsWith('$')));
  const base = current || Object.fromEntries(Object.entries(filter || {})
    .filter(([key, value]) => key !== '$or' && !(value && typeof value === 'object'))
    .map(([key, value]) => [key, value]));
  const data = { ...base, ...replacement };
  if (update && update.$push) for (const [key, value] of Object.entries(update.$push)) data[key] = [...(Array.isArray(data[key]) ? data[key] : []), value];
  return insertRecord(collectionName, data);
}
async function deleteRecord(collectionName, filter) { const item = await getRecord(collectionName, filter); if (!item) return false; await rows('DELETE FROM workflow_records WHERE collection_name=$1 AND record_id=$2', [collectionName, String(item.id)]); return true; }
async function deleteRecords(collectionName, filter) { const records = await listRecords(collectionName, filter); for (const record of records) await deleteRecord(collectionName, { id: record.id }); return records.length; }
async function profile(table, userId, value) {
  if (missing(userId)) return null;
  const numericUserId = Number(userId);
  if (!Number.isSafeInteger(numericUserId)) return null;
  if (value) await rows(`INSERT INTO ${table}(user_id,profile,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(user_id) DO UPDATE SET profile=EXCLUDED.profile,updated_at=now()`, [numericUserId, JSON.stringify({ ...value, user_id: userId })]);
  const result = await rows(`SELECT profile FROM ${table} WHERE user_id=$1`, [numericUserId]);
  return result[0] ? result[0].profile : null;
}
const createOrUpdateStudentProfile = (id, value) => profile('student_profiles', id, value);
const getStudentProfileByUserId = id => profile('student_profiles', id);
async function listStudentProfiles() {
  return rows(`SELECT u.id AS user_id, u.email, u.username, p.profile
    FROM users u JOIN student_profiles p ON p.user_id = u.id
    WHERE u.role = 'student' AND u.is_active = 1
    ORDER BY u.id`).then(items => items.map(item => ({
    ...item.profile,
    user_id: item.user_id,
    email: item.profile && item.profile.email ? item.profile.email : item.email,
    username: item.username
  })));
}
const createOrUpdateCompanyProfile = (id, value) => profile('company_profiles', id, value);
const getCompanyProfileByUserId = id => profile('company_profiles', id);

async function upsertFacultyStudentAuthorization(input = {}) {
  if (missing(input.faculty_user_id) || missing(input.student_user_id)) return null;
  const facultyUserId = Number(input.faculty_user_id);
  const studentUserId = Number(input.student_user_id);
  if (!Number.isSafeInteger(facultyUserId) || !Number.isSafeInteger(studentUserId)) return null;
  const universityId = normalizeUniversityValue(input.university_id);
  const universityName = normalizeUniversityValue(input.university_name);
  const createdBy = Number(input.created_by ?? facultyUserId);
  const isActive = Number(input.is_active ?? 1) === 1 ? 1 : 0;
  const notes = String(input.notes || '');
  const result = await rows(`INSERT INTO faculty_student_authorizations
      (faculty_user_id, student_user_id, university_id, university_name, created_by, is_active, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (faculty_user_id, student_user_id)
      DO UPDATE SET
        university_id = EXCLUDED.university_id,
        university_name = EXCLUDED.university_name,
        created_by = EXCLUDED.created_by,
        is_active = EXCLUDED.is_active,
        notes = EXCLUDED.notes,
        updated_at = now()
      RETURNING *`, [facultyUserId, studentUserId, universityId, universityName, createdBy, isActive, notes]);
  return result[0] || null;
}

async function getFacultyStudentAuthorization(facultyUserId, studentUserId) {
  if (missing(facultyUserId) || missing(studentUserId)) return null;
  const result = await rows('SELECT * FROM faculty_student_authorizations WHERE faculty_user_id=$1 AND student_user_id=$2 LIMIT 1', [Number(facultyUserId), Number(studentUserId)]);
  return result[0] || null;
}

async function listFacultyStudentAuthorizationsForFaculty(facultyUserId) {
  if (missing(facultyUserId)) return [];
  return rows('SELECT * FROM faculty_student_authorizations WHERE faculty_user_id=$1 AND is_active=1 ORDER BY updated_at DESC', [Number(facultyUserId)]);
}

async function listFacultyStudentAuthorizationsForStudent(studentUserId) {
  if (missing(studentUserId)) return [];
  return rows('SELECT * FROM faculty_student_authorizations WHERE student_user_id=$1 AND is_active=1 ORDER BY updated_at DESC', [Number(studentUserId)]);
}

async function deleteFacultyStudentAuthorization(facultyUserId, studentUserId) {
  if (missing(facultyUserId) || missing(studentUserId)) return false;
  const result = await rows('DELETE FROM faculty_student_authorizations WHERE faculty_user_id=$1 AND student_user_id=$2 RETURNING *', [Number(facultyUserId), Number(studentUserId)]);
  return result.length > 0;
}

function normalizeUniversityValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

module.exports = { init, createUser, getUserByEmail, getUserByUsername, getUserByIdentity, getUserById, getAllUsers, nextSequence, listRecords, getRecord, insertRecord, getOrCreateRecord, updateRecord, deleteRecord, deleteRecords, createOrUpdateStudentProfile, getStudentProfileByUserId, listStudentProfiles, createOrUpdateCompanyProfile, getCompanyProfileByUserId, upsertFacultyStudentAuthorization, getFacultyStudentAuthorization, listFacultyStudentAuthorizationsForFaculty, listFacultyStudentAuthorizationsForStudent, deleteFacultyStudentAuthorization };

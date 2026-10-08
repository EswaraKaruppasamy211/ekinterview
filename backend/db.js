const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool, init } = require('./database/connection');

const missing = value => value === undefined || value === null || (typeof value === 'string' && !value.trim());
const norm = value => String(value ?? '').trim().toLowerCase();
const clean = value => value && typeof value === 'object' ? { ...value } : value;

const fallbackStatePath = path.join(__dirname, '..', 'data', 'skillbridge-state.json');
const fallbackState = { users: [], workflow_records: [], initialized: false };

function loadFallbackState() {
  if (fallbackState.initialized) return fallbackState;
  fallbackState.initialized = true;
  try {
    const fileContent = fs.readFileSync(fallbackStatePath, 'utf8');
    const parsed = JSON.parse(fileContent);
    const sourceState = parsed && parsed.state ? parsed.state : parsed;
    fallbackState.users = Array.isArray(sourceState && sourceState.users) ? sourceState.users.slice() : [];
    fallbackState.workflow_records = [];
    for (const [collectionName, value] of Object.entries(sourceState || {})) {
      if (collectionName === 'users') continue;
      const entries = [];
      if (Array.isArray(value)) entries.push(...value);
      else if (value && typeof value === 'object') {
        for (const item of Object.values(value)) {
          if (Array.isArray(item)) entries.push(...item);
          else if (item && typeof item === 'object') entries.push(item);
        }
      }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        const recordId = String(entry.id ?? entry.user_id ?? entry.student_id ?? entry.companyId ?? entry.driveId ?? entry.record_id ?? crypto.randomUUID());
        fallbackState.workflow_records.push({ collection_name: collectionName, record_id: recordId, data: { ...entry } });
      }
    }
  } catch (error) {
    console.warn('[db] Falling back to empty in-memory data store:', error.message);
    fallbackState.users = [];
    fallbackState.workflow_records = [];
  }
  return fallbackState;
}

function fallbackWithMatches(record, filter = {}) {
  if (!filter || typeof filter !== 'object') return true;
  if (filter.$or && Array.isArray(filter.$or)) {
    return filter.$or.some(item => fallbackWithMatches(record, item));
  }
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$or') continue;
    if (value && typeof value === 'object' && Array.isArray(value.$in)) {
      if (!value.$in.map(String).includes(String(record[key] ?? ''))) return false;
      continue;
    }
    if (record[key] === undefined || String(record[key]) !== String(value)) return false;
  }
  return true;
}

async function rows(sql, params = []) { 
  if (!process.env.DATABASE_URL) return [];
  await init();
  return (await pool.query(sql, params)).rows;
}
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
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    if (state.users.some(user => norm(user.email) === email || norm(user.username) === username)) return null;
    const created = {
      id: Number(input.id ?? Date.now() + Math.floor(Math.random() * 1000)),
      email,
      username,
      password_hash: input.passwordHash,
      salt: input.salt,
      role: input.role || 'student',
      dob: input.dob || null,
      mobile: input.mobile || '',
      verified: 1,
      is_active: 1,
      created_at: Date.now()
    };
    state.users.push(created);
    return created;
  }
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
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    const normalized = norm(identity);
    return state.users.find(user => norm(user.email) === normalized || norm(user.username) === normalized) || null;
  }
  const result = await rows('SELECT id,email,username,password_hash,salt,role,dob,mobile,verified,is_active,created_at FROM users WHERE email=$1 OR username=$1 LIMIT 1', [norm(identity)]);
  return result[0] || null;
}
async function findUser(field, value) {
  if (missing(value) || !['email', 'username'].includes(field)) return null;
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    return state.users.find(user => norm(user[field]) === norm(value)) || null;
  }
  const result = await rows(`SELECT id,email,username,password_hash,salt,role,dob,mobile,verified,is_active,created_at FROM users WHERE ${field}=$1 LIMIT 1`, [norm(value)]);
  return result[0] || null;
}
async function getUserById(id) {
  if (missing(id)) return null;
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    return state.users.find(user => String(user.id) === String(id)) || null;
  }
  const result = await rows('SELECT id,email,username,password_hash,salt,role,dob,mobile,verified,is_active,created_at FROM users WHERE id=$1 LIMIT 1', [Number(id)]);
  return result[0] || null;
}
async function getAllUsers() {
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    return state.users.slice().sort((a, b) => Number(a.id) - Number(b.id));
  }
  return rows('SELECT id,email,username,role,dob,mobile,verified,is_active,created_at FROM users ORDER BY id');
}
async function nextSequence(sequenceName, collectionName) {
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    const ids = state.workflow_records
      .filter(record => record.collection_name === collectionName)
      .map(record => Number(record.data && record.data.id))
      .filter(Number.isFinite);
    return ids.length ? Math.max(...ids) + 1 : 1;
  }
  const result = await rows(`SELECT COALESCE(MAX((data->>'id')::bigint),0)+1 AS next
    FROM workflow_records
    WHERE collection_name=$1 AND data->>'id' ~ '^[0-9]+$'`, [collectionName]);
  return Number(result[0].next);
}
async function listRecords(collectionName, filter = {}, sort = {}) {
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    const records = state.workflow_records
      .filter(record => record.collection_name === collectionName && fallbackWithMatches(record.data, filter))
      .map(record => record.data);
    const entries = Object.entries(sort || {});
    if (entries.length) records.sort((a, b) => {
      for (const [key, direction] of entries) {
        const av = a[key], bv = b[key];
        const result = String(av ?? '').localeCompare(String(bv ?? '')) * (direction === -1 ? -1 : 1);
        if (result !== 0) return result;
      }
      return 0;
    });
    return records;
  }
  const where = whereFilter(filter);
  return rows(`SELECT data AS record FROM workflow_records WHERE collection_name=$${where.params.length + 1} AND ${where.sql}${sortSql(sort)}`,
    [...where.params, collectionName]).then(items => items.map(item => item.record));
}
async function getRecord(collectionName, filter) {
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    const match = state.workflow_records.find(record => record.collection_name === collectionName && fallbackWithMatches(record.data, filter));
    return match ? match.data : null;
  }
  const where = whereFilter(filter);
  const result = await rows(`SELECT data AS record FROM workflow_records WHERE collection_name=$${where.params.length + 1} AND ${where.sql} LIMIT 1`, [...where.params, collectionName]);
  return result[0] ? result[0].record : null;
}
async function insertRecord(collectionName, document) {
  const data = clean(document); const id = String(data.id ?? crypto.randomUUID());
  data.id = data.id ?? id;
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    const existingIndex = state.workflow_records.findIndex(item => item.collection_name === collectionName && String(item.record_id) === String(data.id));
    if (existingIndex >= 0) state.workflow_records[existingIndex] = { collection_name: collectionName, record_id: String(data.id), data: { ...data } };
    else state.workflow_records.push({ collection_name: collectionName, record_id: String(data.id), data: { ...data } });
    return { ...data };
  }
  await rows('INSERT INTO workflow_records(collection_name,record_id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT (collection_name,record_id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()', [collectionName, id, JSON.stringify(data)]);
  return data;
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
async function deleteRecord(collectionName, filter) {
  const item = await getRecord(collectionName, filter);
  if (!item) return false;
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    state.workflow_records = state.workflow_records.filter(record => !(record.collection_name === collectionName && String(record.record_id) === String(item.id)));
    return true;
  }
  await rows('DELETE FROM workflow_records WHERE collection_name=$1 AND record_id=$2', [collectionName, String(item.id)]);
  return true;
}
async function deleteRecords(collectionName, filter) { const records = await listRecords(collectionName, filter); for (const record of records) await deleteRecord(collectionName, { id: record.id }); return records.length; }
async function profile(table, userId, value) {
  if (missing(userId)) return null;
  const numericUserId = Number(userId);
  if (!Number.isSafeInteger(numericUserId)) return null;
  if (value) {
    const profileValue = { ...value, user_id: userId };
    if (!process.env.DATABASE_URL) {
      const state = loadFallbackState();
      const current = state.workflow_records.find(record => record.collection_name === table && String(record.data.user_id) === String(userId));
      if (current) current.data = profileValue;
      else state.workflow_records.push({ collection_name: table, record_id: String(userId), data: profileValue });
      return profileValue;
    }
    await rows(`INSERT INTO ${table}(user_id,profile,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(user_id) DO UPDATE SET profile=EXCLUDED.profile,updated_at=now()`, [numericUserId, JSON.stringify(profileValue)]);
  }
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    const result = state.workflow_records.find(record => record.collection_name === table && String(record.data.user_id) === String(userId));
    return result ? result.data : null;
  }
  const result = await rows(`SELECT profile FROM ${table} WHERE user_id=$1`, [numericUserId]);
  return result[0] ? result[0].profile : null;
}
const createOrUpdateStudentProfile = (id, value) => profile('student_profiles', id, value);
const getStudentProfileByUserId = id => profile('student_profiles', id);
async function listStudentProfiles() {
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    const profiles = state.workflow_records.filter(record => record.collection_name === 'student_profiles').map(record => record.data);
    return profiles.map(profileRecord => ({
      ...profileRecord,
      user_id: profileRecord.user_id,
      email: profileRecord.email || state.users.find(user => String(user.id) === String(profileRecord.user_id))?.email || '',
      username: state.users.find(user => String(user.id) === String(profileRecord.user_id))?.username || ''
    }));
  }
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
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    const facultyUserId = Number(input.faculty_user_id);
    const studentUserId = Number(input.student_user_id);
    const record = { faculty_user_id: facultyUserId, student_user_id: studentUserId, university_id: normalizeUniversityValue(input.university_id), university_name: normalizeUniversityValue(input.university_name), created_by: Number(input.created_by ?? facultyUserId), is_active: Number(input.is_active ?? 1) === 1 ? 1 : 0, notes: String(input.notes || ''), updated_at: new Date().toISOString() };
    const existing = state.workflow_records.find(item => item.collection_name === 'faculty_student_authorizations' && Number(item.data.faculty_user_id) === facultyUserId && Number(item.data.student_user_id) === studentUserId);
    if (existing) { existing.data = { ...existing.data, ...record }; return { ...existing.data }; }
    state.workflow_records.push({ collection_name: 'faculty_student_authorizations', record_id: `${facultyUserId}:${studentUserId}`, data: record });
    return { ...record };
  }
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
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    return state.workflow_records.find(item => item.collection_name === 'faculty_student_authorizations' && Number(item.data.faculty_user_id) === Number(facultyUserId) && Number(item.data.student_user_id) === Number(studentUserId))?.data || null;
  }
  const result = await rows('SELECT * FROM faculty_student_authorizations WHERE faculty_user_id=$1 AND student_user_id=$2 LIMIT 1', [Number(facultyUserId), Number(studentUserId)]);
  return result[0] || null;
}

async function listFacultyStudentAuthorizationsForFaculty(facultyUserId) {
  if (missing(facultyUserId)) return [];
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    return state.workflow_records.filter(item => item.collection_name === 'faculty_student_authorizations' && Number(item.data.faculty_user_id) === Number(facultyUserId) && Number(item.data.is_active ?? 1) === 1).map(item => item.data);
  }
  return rows('SELECT * FROM faculty_student_authorizations WHERE faculty_user_id=$1 AND is_active=1 ORDER BY updated_at DESC', [Number(facultyUserId)]);
}

async function listFacultyStudentAuthorizationsForStudent(studentUserId) {
  if (missing(studentUserId)) return [];
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    return state.workflow_records.filter(item => item.collection_name === 'faculty_student_authorizations' && Number(item.data.student_user_id) === Number(studentUserId) && Number(item.data.is_active ?? 1) === 1).map(item => item.data);
  }
  return rows('SELECT * FROM faculty_student_authorizations WHERE student_user_id=$1 AND is_active=1 ORDER BY updated_at DESC', [Number(studentUserId)]);
}

async function deleteFacultyStudentAuthorization(facultyUserId, studentUserId) {
  if (missing(facultyUserId) || missing(studentUserId)) return false;
  if (!process.env.DATABASE_URL) {
    const state = loadFallbackState();
    const before = state.workflow_records.length;
    state.workflow_records = state.workflow_records.filter(item => !(item.collection_name === 'faculty_student_authorizations' && Number(item.data.faculty_user_id) === Number(facultyUserId) && Number(item.data.student_user_id) === Number(studentUserId)));
    return before !== state.workflow_records.length;
  }
  const result = await rows('DELETE FROM faculty_student_authorizations WHERE faculty_user_id=$1 AND student_user_id=$2 RETURNING *', [Number(facultyUserId), Number(studentUserId)]);
  return result.length > 0;
}

function normalizeUniversityValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

module.exports = { init, createUser, getUserByEmail, getUserByUsername, getUserByIdentity, getUserById, getAllUsers, nextSequence, listRecords, getRecord, insertRecord, updateRecord, deleteRecord, deleteRecords, createOrUpdateStudentProfile, getStudentProfileByUserId, listStudentProfiles, createOrUpdateCompanyProfile, getCompanyProfileByUserId, upsertFacultyStudentAuthorization, getFacultyStudentAuthorization, listFacultyStudentAuthorizationsForFaculty, listFacultyStudentAuthorizationsForStudent, deleteFacultyStudentAuthorization };

const crypto = require('crypto');
const { pool, init } = require('./database/connection');
const RESOURCE_NAMES = ['faculty-profiles','faculty-internships','industrial-training','fdp','learning-programs','mentorship','workshops','guest-lectures','live-projects','research-collaborations','research-projects','consultancy','innovation-challenges','internship-progress','portfolio-extensions'];
const aliases = new Map([['faculty-internship','faculty-internships'],['learning-program','learning-programs'],['guest-lecture','guest-lectures'],['live-project','live-projects'],['research-collaboration','research-collaborations'],['internship-feedback','internship-progress'],['portfolio-extension','portfolio-extensions']]);
const COLLABORATION_RESOURCES = ['mentorship', 'guest-lectures', 'workshops', 'innovation-challenges', 'live-projects', 'research-collaborations', 'consultancy'];
function normalizeResource(value) { const name = String(value || '').trim().toLowerCase().replace(/_/g, '-'); return aliases.get(name) || name; }
function assertResource(value) { const name = normalizeResource(value); if (!RESOURCE_NAMES.includes(name)) throw new Error(`Unsupported academia resource: ${value}`); return name; }
function isAdmin(user) { return user && ['admin','college','university_admin'].includes(user.role); }
async function query(sql, params) { await init(); return (await pool.query(sql, params)).rows; }
function ownerScope(user, extra = [], params = []) {
  if (!isAdmin(user)) { extra.push(`data->>'created_by'=$${params.length + 1}`); params.push(String(user && user.id)); }
  return { extra, params };
}
async function create(resource, payload, user) {
  const name = assertResource(resource), now = new Date().toISOString();
  const data = { ...payload, id: String(payload.id || crypto.randomUUID()), resource: name, created_by: String(user.id), created_at: payload.created_at || now, updated_at: now, status: payload.status || 'open', applications: Array.isArray(payload.applications) ? payload.applications : [], registrations: Array.isArray(payload.registrations) ? payload.registrations : [], feedback: Array.isArray(payload.feedback) ? payload.feedback : [] };
  await query('INSERT INTO academia_records(resource,id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(resource,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()', [name, data.id, JSON.stringify(data)]);
  return data;
}
async function list(resource, filter = {}, user) {
  const name = assertResource(resource), clauses = ['resource=$1'], params = [name];
  for (const [key, value] of Object.entries(filter)) {
    if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
    clauses.push(`data->>$${params.length + 1}=$${params.length + 2}`);
    params.push(key, String(value));
  }
  const items = await query(`SELECT data FROM academia_records WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`, params);
  if (!user || isAdmin(user)) return items.map(item => item.data);
  const id = String(user.id);
  return items.map(item => item.data).filter(item => String(item.created_by) === id
    || item.status === 'published' || item.status === 'Open' || item.status === 'open'
    || (Array.isArray(item.applications) && item.applications.some(entry => String(entry.user_id) === id))
    || (Array.isArray(item.registrations) && item.registrations.some(entry => String(entry.user_id) === id)));
}
async function get(resource, id, user) { const items = await list(resource, { id: String(id) }, user); return items[0] || null; }
async function getOwned(resource, id, user) {
  const name = assertResource(resource);
  const params = [name, String(id)];
  const scope = ownerScope(user, ['resource=$1', 'id=$2'], params);
  const items = await query(`SELECT data FROM academia_records WHERE ${scope.extra.join(' AND ')}`, scope.params);
  return items[0] ? items[0].data : null;
}
async function update(resource, id, payload, user) { const item = await getOwned(resource, id, user); if (!item) return null; delete payload.id; delete payload.resource; delete payload.created_by; const data = { ...item, ...payload, updated_at: new Date().toISOString() }; await query('UPDATE academia_records SET data=$3::jsonb,updated_at=now() WHERE resource=$1 AND id=$2', [assertResource(resource), String(id), JSON.stringify(data)]); return data; }
async function remove(resource, id, user) { const item = await getOwned(resource, id, user); if (!item) return false; await query('DELETE FROM academia_records WHERE resource=$1 AND id=$2', [assertResource(resource), String(id)]); return true; }
async function append(resource, id, field, entry, user) {
  const item = await get(resource, id, user);
  if (!item) return null;
  const values = Array.isArray(item[field]) ? item[field] : [];
  const data = { ...item, [field]: [...values, entry], updated_at: new Date().toISOString() };
  await query('UPDATE academia_records SET data=$3::jsonb,updated_at=now() WHERE resource=$1 AND id=$2', [assertResource(resource), String(id), JSON.stringify(data)]);
  return data;
}
function collaborationResource(resource) { return COLLABORATION_RESOURCES.includes(normalizeResource(resource)); }
function participationEntries(item) {
  return [...(Array.isArray(item.applications) ? item.applications : []), ...(Array.isArray(item.registrations) ? item.registrations : [])];
}
async function updateParticipant(resource, id, user, patch = {}) {
  const item = await get(resource, id, user);
  if (!item) return null;
  const userId = String(user.id);
  let found = false;
  const update = entries => (Array.isArray(entries) ? entries : []).map(entry => {
    if (String(entry.user_id) !== userId) return entry;
    found = true;
    return { ...entry, ...patch, updated_at: new Date().toISOString() };
  });
  if (!found && !participationEntries(item).some(entry => String(entry.user_id) === userId)) return { error: 'not_participant', item };
  const data = { ...item, applications: update(item.applications), registrations: update(item.registrations), updated_at: new Date().toISOString() };
  await query('UPDATE academia_records SET data=$3::jsonb,updated_at=now() WHERE resource=$1 AND id=$2', [assertResource(resource), String(id), JSON.stringify(data)]);
  return data;
}
async function request(resource, id, user, data = {}) {
  const item = await get(resource, id, user);
  if (!item) return null;
  if (participationEntries(item).some(entry => String(entry.user_id) === String(user.id))) return { ...item, duplicate: true };
  return append(resource, id, 'applications', { user_id: String(user.id), status: 'requested', requested_at: new Date().toISOString(), ...data }, user);
}
async function complete(resource, id, user, data = {}) {
  const item = await getOwned(resource, id, user);
  if (!item) return null;
  return update(resource, id, { status: 'Completed', completed_at: new Date().toISOString(), completion_notes: data.notes || data.completion_notes || '' }, user);
}
async function enroll(resource, id, user, data = {}) {
  const item = await get(resource, id, user);
  if (!item) return { error: 'not_found' };
  const registrations = Array.isArray(item.registrations) ? item.registrations : [];
  if (registrations.some(entry => String(entry.user_id) === String(user.id))) return { error: 'duplicate', item };
  const entry = { user_id: String(user.id), enrolled_at: new Date().toISOString(), status: 'enrolled', progress: 0, ...data };
  return { item: await append(resource, id, 'registrations', entry, user), entry };
}
const apply = async (r, id, user, data = {}) => {
  const item = await get(r, id, user);
  if (!item) return null;
  if ((item.applications || []).some(entry => String(entry.user_id) === String(user.id))) return { ...item, duplicate: true };
  return append(r, id, 'applications', { user_id: String(user.id), status: 'submitted', applied_at: new Date().toISOString(), ...data }, user);
};
const register = async (r, id, user, data = {}) => {
  const item = await get(r, id, user);
  if (!item) return null;
  if ((item.registrations || []).some(entry => String(entry.user_id) === String(user.id))) return { ...item, duplicate: true };
  return append(r, id, 'registrations', { user_id: String(user.id), status: 'registered', registered_at: new Date().toISOString(), ...data }, user);
};
async function status(resource, id, user) { const item = await get(resource, id, user); return item && { id: item.id, resource: item.resource, status: item.status, updated_at: item.updated_at }; }
const setStatus = (r, id, value, user) => update(r, id, { status: value }, user);
const feedback = async (r, id, user, data = {}) => {
  const item = await get(r, id, user);
  if (!item) return null;
  const owner = String(item.created_by) === String(user.id) || isAdmin(user);
  const participant = participationEntries(item).some(entry => String(entry.user_id) === String(user.id) && ['approved', 'accepted', 'completed', 'registered', 'enrolled', 'started', 'in progress'].includes(String(entry.status || '').toLowerCase()));
  if (collaborationResource(r) && !owner && !participant) return { error: 'not_authorized' };
  return append(r, id, 'feedback', { user_id: String(user.id), rating: data.rating, comment: data.comment || data.feedback || '', created_at: new Date().toISOString() }, user);
};
module.exports = { RESOURCE_NAMES, COLLABORATION_RESOURCES, collaborationResource, init, create, list, get, update, updateParticipant, remove, delete: remove, apply, request, register, enroll, complete, status, setStatus, feedback, normalizeResource };

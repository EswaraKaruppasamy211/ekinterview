/* ==========================================================================
   SkillBridge â€” Unique Academiaâ€“Industry Engine & 3-Portal Backend API
   Author: @Eswara Karuppasamy K
   Port: 3000
   Features: Multi-Tenant Company Isolation, AI Employability Engine,
             8-Stage ATS Pipeline, Automatic Interview Notifier, Role-Based Access
   ========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const nodemailer = require('nodemailer');

// Environment Setup
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  try {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, v] = trimmed.split('=');
        process.env[k.trim()] = v.trim();
      }
    });
  } catch (e) {}
}

const userDb = require('./db');
const { migrate } = require('./database/migrate');
const academiaDb = require('./academia-features');

const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 10000;
const host = process.env.HOST || '0.0.0.0';
const repoRoot = path.join(__dirname, '..');
const uploadsDir = process.env.VERCEL ? path.join('/tmp', 'skillbridge-uploads') : path.join(repoRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const JWT_SECRET = process.env.JWT_SECRET || 'skillbridge-unique-backend-secret-key-2026';
const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'eswarakaruppasamy123@gmail.com';

let registrationMailer = null;

function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRegistrationMailer() {
  if (registrationMailer) return registrationMailer;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  registrationMailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: String(SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return registrationMailer;
}

async function notifyNewUserRegistration(details) {
  const mailer = getRegistrationMailer();
  if (!mailer) {
    console.error('Registration notification was not sent: SMTP_HOST, SMTP_USER, and SMTP_PASS are not configured.');
    return { sent: false, configured: false };
  }

  const fields = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;font-weight:700;">${escapeEmailHtml(label)}</td><td style="padding:6px 0;">${escapeEmailHtml(value)}</td></tr>`)
    .join('');
  const text = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');

  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: ADMIN_NOTIFICATION_EMAIL,
      subject: `New SkillBridge ${details.Role || 'user'} registration`,
      text: `A new user registered on SkillBridge.\n\n${text}`,
      html: `<h2>New SkillBridge registration</h2><p>A new user registered on the platform.</p><table>${fields}</table>`
    });
    return { sent: true, configured: true };
  } catch (error) {
    console.error('Registration notification email failed:', error.message);
    return { sent: false, configured: true };
  }
}

function normalizeIdentity(value) {
  return String(value ?? '').trim().toLowerCase();
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, salt, ...safeUser } = user;
  return safeUser;
}

const ADMIN_ROLES = new Set(['admin', 'college', 'university_admin']);

function normalizeUniversityValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeAcademicRecord(record, userId) {
  if (!record || typeof record !== 'object') return record;
  const safe = { ...record };
  safe.user_id = String(userId ?? safe.user_id ?? '');
  if (!safe.id) safe.id = String(safe.record_id || `${safe.user_id}-${safe.semester_number ?? safe.semester ?? 'record'}`);
  if (safe.semester_number === undefined && safe.semester !== undefined) {
    const parsed = Number(String(safe.semester).replace(/[^\d.]/g, ''));
    safe.semester_number = Number.isFinite(parsed) ? parsed : safe.semester;
  }
  if (safe.gpa !== undefined && safe.gpa !== null && safe.gpa !== '') safe.gpa = Number(safe.gpa);
  if (safe.cgpa !== undefined && safe.cgpa !== null && safe.cgpa !== '') safe.cgpa = Number(safe.cgpa);
  if (safe.total_marks !== undefined && safe.total_marks !== null && safe.total_marks !== '') safe.total_marks = Number(safe.total_marks);
  if (safe.percentage !== undefined && safe.percentage !== null && safe.percentage !== '') safe.percentage = Number(safe.percentage);
  safe.subjects_count = safe.subjects_count ?? safe.number_of_subjects ?? safe.subjects ?? null;
  safe.passed_subjects = safe.passed_subjects ?? safe.passed ?? null;
  safe.failed_subjects = safe.failed_subjects ?? safe.failed ?? null;
  safe.backlogs = safe.backlogs ?? safe.backlog ?? null;
  safe.academic_status = safe.academic_status ?? safe.status ?? 'Pending';
  if (safe.remarks === undefined) safe.remarks = safe.remark || '';
  return safe;
}

function resolveUniversityScope(profile, user = null) {
  const profileUniversityId = profile && (profile.university_id ?? profile.universityId ?? profile.college_id ?? profile.institution_id);
  const userUniversityId = user && (user.university_id ?? user.universityId ?? user.college_id ?? user.collegeId);
  const profileUniversityName = profile && (profile.university ?? profile.college ?? profile.institution);
  const userUniversityName = user && (user.university ?? user.college ?? user.collegeName ?? user.college_name);
  const candidates = [
    profile && profile.university_id,
    profile && profile.universityId,
    profile && profile.college_id,
    profile && profile.institution_id,
    profile && profile.university,
    profile && profile.college,
    profile && profile.institution,
    user && user.university_id,
    user && user.universityId,
    user && user.college_id,
    user && user.collegeId,
    user && user.collegeName,
    user && user.college_name,
    user && user.university,
    user && user.college,
  ];
  const normalized = candidates
    .map(value => normalizeUniversityValue(value).toLowerCase())
    .filter(Boolean)
    .filter(value => value !== 'null' && value !== 'undefined');
  return {
    university_id: normalizeUniversityValue(profileUniversityId ?? userUniversityId),
    university_name: normalizeUniversityValue(profileUniversityName ?? userUniversityName),
    values: normalized
  };
}

async function canAccessStudentAcademicData(studentUserId, authUser) {
  if (!authUser || !studentUserId) return false;
  if (String(authUser.id) === String(studentUserId)) return true;

  const targetUser = state.users.find(user => String(user.id) === String(studentUserId)) || null;
  const targetProfile = await userDb.getStudentProfileByUserId(studentUserId).catch(() => null) || {};
  const targetScope = resolveUniversityScope(targetProfile, targetUser);

  if (ADMIN_ROLES.has(String(authUser.role))) {
    const adminProfile = await userDb.getStudentProfileByUserId(authUser.id).catch(() => null) || await userDb.getRecord('college_profiles', { user_id: String(authUser.id) }) || {};
    const adminScope = resolveUniversityScope(adminProfile, authUser);
    if (targetScope.university_id && adminScope.university_id) {
      return targetScope.university_id === adminScope.university_id;
    }
    if (targetScope.university_name && adminScope.university_name) {
      return targetScope.university_name === adminScope.university_name;
    }
    return false;
  }

  if (String(authUser.role) === 'faculty') {
    const facultyProfile = await academiaDb.get('faculty-profiles', String(authUser.id), authUser).catch(() => null) || {};
    const facultyScope = resolveUniversityScope(facultyProfile, authUser);
    if (facultyScope.university_id && targetScope.university_id && facultyScope.university_id !== targetScope.university_id) return false;
    if (facultyScope.university_name && targetScope.university_name && facultyScope.university_name !== targetScope.university_name) return false;

    const authorization = await userDb.getFacultyStudentAuthorization(authUser.id, studentUserId);
    if (!authorization || Number(authorization.is_active ?? 1) !== 1) return false;

    const authorizationUniversityId = normalizeUniversityValue(authorization.university_id);
    const authorizationUniversityName = normalizeUniversityValue(authorization.university_name);
    if (authorizationUniversityId && facultyScope.university_id && authorizationUniversityId !== facultyScope.university_id) return false;
    if (authorizationUniversityId && targetScope.university_id && authorizationUniversityId !== targetScope.university_id) return false;
    if (authorizationUniversityName && facultyScope.university_name && authorizationUniversityName !== facultyScope.university_name) return false;
    if (authorizationUniversityName && targetScope.university_name && authorizationUniversityName !== targetScope.university_name) return false;

    return true;
  }

  return false;
}

async function refreshStudentAcademicCgpa(userId) {
  const records = await userDb.listRecords('student_academics', { user_id: userId }, { semester_number: 1, semester: 1 });
  const values = records
    .map(record => Number(record.gpa ?? record.cgpa))
    .filter(Number.isFinite);
  const cgpa = values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
    : null;
  const profile = await userDb.getStudentProfileByUserId(userId) || {};
  await userDb.createOrUpdateStudentProfile(userId, { ...profile, cgpa });
  return cgpa;
}

// Unique Security Cryptographic Functions
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifyPassword(password, salt, hash) {
  try {
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) { return false; }
}

function generateToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (signature !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

// Unique ID Generators
let counters = { company: 10002, job: 101, app: 901, cert: 401 };
function nextCompanyId() { return `CMP-${++counters.company}`; }
function nextJobId() { return ++counters.job; }
function nextAppId() { return ++counters.app; }

// Unique State Store
let state = {
  users: [],
  studentProfiles: {},
  resumes: {},
  academicRecords: {},
  schoolEducation: {},
  backlogs: {},
  userSkills: {},
  codingSkills: {},
  assessments: {},
  projects: {},
  internships: {},
  certifications: {},
  seminars: {},
  workshops: {},
  hackathons: {},
  achievements: {},
  companies: [],
  jobs: [],
  applications: [],
  notifications: {},
  companyOffers: {},
  campusRegistrations: {},
  studentPlacements: {},
  userSettings: {},
  preferences: {},
  collegeAnalytics: {
    total_students: 450,
    placed_students: 382,
    placement_rate: 84.8,
    top_recruiters: ['TechCorp Solutions', 'DataSoft Systems', 'InnovateTech'],
    department_stats: [
      { name: 'Computer Science & Engg', total: 120, placed: 112, percentage: 93.3 },
      { name: 'Information Technology', total: 100, placed: 88, percentage: 88.0 },
      { name: 'Electronics & Comm Engg', total: 110, placed: 92, percentage: 83.6 },
      { name: 'Electrical & Electronics', total: 70, placed: 56, percentage: 80.0 },
      { name: 'Mechanical Engineering', total: 50, placed: 34, percentage: 68.0 }
    ]
  }
};

// Seed Unique Initial Data
function seedData() {
  // Mock data has been removed to ensure only original details from the student portal are used
}

seedData();

// Authentication and student profiles are backed by PostgreSQL. The in-memory
// state remains the source for demo/catalog data, but never for credentials.
async function initializePersistentUsers() {
  await migrate();
  await userDb.init();
  let users = await userDb.getAllUsers();
  if (!users.length) {
    const seeds = state.users.slice();
    for (const seed of seeds) {
      const created = await userDb.createUser({
        email: seed.email, username: seed.username, passwordHash: seed.password_hash,
        salt: seed.salt, role: seed.role
      });
      if (created) {
        const profile = state.studentProfiles[seed.id];
        if (profile && seed.role === 'student') {
          await userDb.createOrUpdateStudentProfile(created.id, profile);
        }
      }
    }
    users = await userDb.getAllUsers();
  }
  const oldUsers = state.users;
  state.users = users.map(user => {
    const old = oldUsers.find(item => normalizeIdentity(item.email) === normalizeIdentity(user.email)) || {};
    return { ...old, ...user };
  });
  for (const user of state.users.filter(item => item.role === 'student')) {
    const profile = await userDb.getStudentProfileByUserId(user.id);
    if (profile) state.studentProfiles[user.id] = { ...profile, email: user.email };
  }
  state.companies = [];
  for (const user of state.users.filter(item => item.role === 'company')) {
    const profile = await userDb.getCompanyProfileByUserId(user.id);
    if (profile && profile.company_id) {
      state.companies.push({
        id: user.id,
        companyId: profile.company_id,
        name: profile.company_name || user.username,
        logo: profile.logo || 'ðŸ¢',
        industry: profile.industry || 'Corporate Partner',
        manager_name: profile.manager_name || 'Recruitment Manager',
        min_cgpa: Number(profile.min_cgpa || 7),
        min_ai_score: Number(profile.min_ai_score || 70),
        required_skills: profile.required_skills
          ? String(profile.required_skills).split(',').map(skill => skill.trim()).filter(Boolean)
          : ['Java', 'SQL']
      });
      user.companyId = profile.company_id;
      user.companyName = profile.company_name || user.username;
    }
  }
}

let usersInitializationPromise = null;

function ensurePersistentUsersLoaded() {
  if (!usersInitializationPromise) {
    usersInitializationPromise = initializePersistentUsers().catch(error => {
      usersInitializationPromise = null;
      throw error;
    });
  }
  return usersInitializationPromise;
}

async function initializePersistentWorkflow() {
  const collections = [
    'jobs', 'applications', 'notifications', 'offers', 'student_skills', 'assessments',
    'projects', 'certifications', 'student_resumes', 'student_academics',
    'student_academic_summary', 'student_preferences', 'student_placements',
    'campus_registrations', 'user_settings', 'internships', 'seminars', 'workshops',
    'hackathons', 'achievements', 'coding_skills', 'backlogs'
  ];
  const records = await Promise.all(collections.map(collection => userDb.listRecords(collection)));
  const loaded = Object.fromEntries(collections.map((collection, index) => [collection, records[index]]));
  const [jobs, applications, notifications, offers, skills, assessments, projects, certifications] = [
    loaded.jobs, loaded.applications, loaded.notifications, loaded.offers,
    loaded.student_skills, loaded.assessments, loaded.projects, loaded.certifications
  ];
  state.jobs = jobs;
  state.applications = applications;
  state.notifications = {};
  notifications.forEach(item => {
    state.notifications[item.user_id] = state.notifications[item.user_id] || [];
    state.notifications[item.user_id].push(item);
  });
  state.companyOffers = {};
  offers.forEach(item => {
    state.companyOffers[item.companyId] = state.companyOffers[item.companyId] || [];
    state.companyOffers[item.companyId].push(item);
  });
  state.userSkills = {};
  skills.forEach(item => {
    state.userSkills[item.user_id] = state.userSkills[item.user_id] || [];
    state.userSkills[item.user_id].push(item);
  });
  state.assessments = {};
  assessments.forEach(item => { state.assessments[item.user_id] = item; });
  state.projects = {};
  projects.forEach(item => {
    state.projects[item.user_id] = state.projects[item.user_id] || [];
    state.projects[item.user_id].push(item);
  });
  state.certifications = {};
  certifications.forEach(item => {
    state.certifications[item.user_id] = state.certifications[item.user_id] || [];
    state.certifications[item.user_id].push(item);
  });
  const groupedLists = {
    internships: 'internships', seminars: 'seminars', workshops: 'workshops',
    hackathons: 'hackathons', achievements: 'achievements', academicRecords: 'student_academics'
  };
  for (const [stateKey, collection] of Object.entries(groupedLists)) {
    state[stateKey] = {};
    loaded[collection].forEach(item => {
      state[stateKey][item.user_id] = state[stateKey][item.user_id] || [];
      state[stateKey][item.user_id].push(item);
    });
  }
  const groupedObjects = {
    resumes: 'student_resumes', schoolEducation: 'student_academic_summary',
    preferences: 'student_preferences', studentPlacements: 'student_placements',
    userSettings: 'user_settings', codingSkills: 'coding_skills', backlogs: 'backlogs'
  };
  for (const [stateKey, collection] of Object.entries(groupedObjects)) {
    state[stateKey] = {};
    loaded[collection].forEach(item => { state[stateKey][item.user_id] = item; });
  }
  state.campusRegistrations = {};
  loaded.campus_registrations.forEach(item => {
    state.campusRegistrations[item.user_id] = state.campusRegistrations[item.user_id] || [];
    if (item.drive_id !== undefined) state.campusRegistrations[item.user_id].push(item.drive_id);
  });
}

// Unique AI Employability Skill Score Engine
function calculateSkillScore(studentId) {
  const profile = state.studentProfiles[studentId] || {};
  const skills = state.userSkills[studentId] || [];
  const certs = state.certifications[studentId] || [];
  const backlog = state.backlogs[studentId] || {};

  let score = 0;
  // 1. CGPA Weightage (Max 40 points)
  const cgpa = Number(profile.cgpa || 0);
  score += Math.min(40, (cgpa / 10) * 40);

  // 2. Skills Count & Proficiency Weightage (Max 30 points)
  let skillPoints = skills.reduce((acc, s) => {
    if (s.proficiency === 'Expert') return acc + 6;
    if (s.proficiency === 'Advanced') return acc + 5;
    return acc + 3;
  }, 0);
  score += Math.min(30, skillPoints);

  // 3. Certifications Weightage (Max 15 points)
  score += Math.min(15, certs.length * 7.5);

  // 4. Projects & Problem Solving (Max 15 points)
  score += 15;

  // Penalty for current backlogs
  if (backlog.current_backlogs > 0) score -= (backlog.current_backlogs * 10);

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Unique Company-Student Eligibility & Match Engine
function calculateCompanyMatch(studentId, company) {
  const profile = state.studentProfiles[studentId] || {};
  const skills = state.userSkills[studentId] || [];
  const studentSkillNames = skills.map(s => s.skill_name.toLowerCase());
  const reqSkills = company.required_skills || [];

  let matchedSkills = 0;
  let skillGaps = [];

  reqSkills.forEach(req => {
    const found = studentSkillNames.some(s => s.includes(req.toLowerCase()) || req.toLowerCase().includes(s));
    if (found) {
      matchedSkills++;
      skillGaps.push({ skill: req, reqLevel: 'Advanced', studentLevel: 'Advanced', gap: 'No Gap â€” Qualified' });
    } else {
      skillGaps.push({ skill: req, reqLevel: 'Advanced', studentLevel: 'Not Found', gap: 'Missing Skill â€” Action Required' });
    }
  });

  const skillMatchPct = reqSkills.length > 0 ? (matchedSkills / reqSkills.length) * 100 : 100;
  const cgpaMatch = (profile.cgpa != null && Number(profile.cgpa) >= Number(company.min_cgpa || 7.5)) ? 100 : 50;
  const overallMatchPct = Math.round((skillMatchPct * 0.7) + (cgpaMatch * 0.3));

  return {
    companyId: company.companyId,
    companyName: company.name,
    matchPercentage: overallMatchPct,
    skillGaps,
    isEligible: overallMatchPct >= 75,
    recommendations: skillGaps.filter(g => g.gap.includes('Missing')).map(g => `Complete course on ${g.skill} to boost match rate by 15%`)
  };
}

function parseJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  });
}

const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_CATEGORIES = new Set([
  'resume', 'certificates', 'academic_records', 'internship_reports',
  'project_documents', 'other_career_documents'
]);
const DOCUMENT_TYPES = new Map([
  ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword', 'application/octet-stream']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream']],
  ['.jpg', ['image/jpeg']], ['.jpeg', ['image/jpeg']], ['.png', ['image/png']],
  ['.txt', ['text/plain']]
]);

function parseMultipart(req, maxBytes = DOCUMENT_MAX_BYTES + 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers['content-type'] || '');
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) return reject(new Error('A multipart form upload is required.'));
    const boundary = Buffer.from(`--${match[1] || match[2]}`);
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error('Uploaded request is too large.'), { code: 'LIMIT_FILE_SIZE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const fields = {};
        let file = null;
        let cursor = 0;
        while (cursor < buffer.length) {
          const start = buffer.indexOf(boundary, cursor);
          if (start < 0) break;
          const headerStart = start + boundary.length;
          if (buffer.slice(headerStart, headerStart + 2).toString() === '--') break;
          const contentStart = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
          if (contentStart < 0) break;
          const headerText = buffer.slice(headerStart + 2, contentStart).toString('utf8');
          const nextBoundary = buffer.indexOf(boundary, contentStart + 4);
          if (nextBoundary < 0) break;
          const valueEnd = nextBoundary - 2;
          const value = buffer.slice(contentStart + 4, valueEnd);
          const disposition = headerText.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
          if (disposition) {
            const name = disposition[1];
            if (disposition[2] !== undefined) {
              const typeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
              file = { fieldName: name, originalName: path.basename(disposition[2]), contentType: typeMatch ? typeMatch[1].trim().toLowerCase() : 'application/octet-stream', buffer: value };
            } else fields[name] = value.toString('utf8');
          }
          cursor = nextBoundary;
        }
        resolve({ fields, file });
      } catch (error) { reject(error); }
    });
  });
}

function validateDocument(file, category) {
  if (!DOCUMENT_CATEGORIES.has(category)) return 'Select a supported document category.';
  if (!file || !file.buffer.length) return 'A document file is required.';
  if (file.buffer.length > DOCUMENT_MAX_BYTES) return 'Documents must be 10 MB or smaller.';
  const ext = path.extname(file.originalName).toLowerCase();
  const allowedTypes = DOCUMENT_TYPES.get(ext);
  if (!allowedTypes || !allowedTypes.includes(file.contentType)) return 'Unsupported file type. Use PDF, DOC, DOCX, JPG, PNG, or TXT.';
  return null;
}

function documentPublicMetadata(record) {
  if (!record) return null;
  const { storage_path, ...safe } = record;
  return { ...safe, view_url: `/api/student/documents/${encodeURIComponent(record.id)}/view`, download_url: `/api/student/documents/${encodeURIComponent(record.id)}/download` };
}

const otpStore = {};

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function getStudentModuleNews() {
  const profile = state.studentProfiles[1];
  const skills = (state.userSkills[1] || []).slice(0, 3).map(skill => skill.skill_name);
  const project = (state.projects[1] || [])[0];
  const internship = (state.internships[1] || [])[0];
  const certification = (state.certifications[1] || [])[0];

  return {
    source: 'Student Module',
    items: [
      {
        title: `${profile.name} added ${skills.join(', ')} to the student skills profile`,
        detail: `${profile.department} student profile â€¢ CGPA ${profile.cgpa}`,
        type: 'Skills update'
      },
      {
        title: `${profile.name} completed ${certification.name}`,
        detail: `Verified certification from ${certification.organization}`,
        type: 'Certification'
      },
      {
        title: `${profile.name} showcased ${project.title}`,
        detail: project.description,
        type: 'Project highlight'
      },
      {
        title: `${profile.name} completed an internship at ${internship.company}`,
        detail: `${internship.role} â€¢ ${internship.summary}`,
        type: 'Experience'
      }
    ]
  };
}

// HTTP SERVER ENGINE
const server = http.createServer(async (req, res) => {
  const requestProtocol = req.headers['x-forwarded-proto'] || 'https';
  const requestHost = req.headers.host || 'interview-wc6b.onrender.com';
  const parsedUrl = new URL(req.url, `${requestProtocol}://${requestHost}`);
  const pathname = parsedUrl.pathname.startsWith('/api')
    ? parsedUrl.pathname
    : `/api${parsedUrl.pathname === '/' ? '' : parsedUrl.pathname}`;

  const sendJSON = (statusCode, data) => {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    res.end(JSON.stringify(data));
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  const getAuthUser = () => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    if (!payload) return null;
    return state.users.find(u => String(u.id) === String(payload.id)) || null;
  };

  try {
    await ensurePersistentUsersLoaded();

    // ----------------------------------------------------
    // PHASE 7: LEARNING + CERTIFICATION
    // ----------------------------------------------------
    const learningMatch = pathname.match(/^\/api\/learning\/programs(?:\/([^/]+))?(?:\/([^/]+))?$/);
    const learningMine = pathname === '/api/student/learning';
    if (learningMatch || learningMine) {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await parseJSON(req) : {};
      const [, programId, operation] = learningMatch || [];
      const managerRoles = ['company', 'faculty', 'college', 'admin', 'university_admin'];
      const programResource = 'learning-programs';

      if (learningMine) {
        if (authUser.role !== 'student' || req.method !== 'GET') return sendJSON(403, { error: 'Student access required.' });
        const enrollments = await userDb.listRecords('learning_enrollments', { user_id: String(authUser.id) });
        const programs = await academiaDb.list(programResource);
        return sendJSON(200, { items: enrollments.map(enrollment => ({ ...enrollment, program: programs.find(item => String(item.id) === String(enrollment.program_id)) || null })) });
      }
      if (!programId && req.method === 'GET') {
        const items = await academiaDb.list(programResource);
        const visible = managerRoles.includes(authUser.role) && parsedUrl.searchParams.get('mine') === 'true'
          ? items.filter(item => String(item.created_by) === String(authUser.id))
          : items.filter(item => item.status === 'published' || String(item.created_by) === String(authUser.id));
        return sendJSON(200, { items: visible });
      }
      if (!programId && req.method === 'POST') {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Program manager access required.' });
        const title = String(body.title || '').trim();
        if (!title) return sendJSON(400, { error: 'Program title is required.' });
        const item = await academiaDb.create(programResource, {
          ...body, title, program_type: body.program_type || body.type || 'course',
          status: body.status === 'published' ? 'published' : 'draft',
          registrations: []
        }, authUser);
        return sendJSON(201, { success: true, item });
      }
      if (!programId) return sendJSON(405, { error: 'Method not allowed.' });
      const item = await academiaDb.get(programResource, programId, authUser);
      if (!item) return sendJSON(404, { error: 'Learning program not found.' });
      if (operation === 'enroll' && req.method === 'POST') {
        if (authUser.role !== 'student') return sendJSON(403, { error: 'Student access required.' });
        if (item.status !== 'published') return sendJSON(409, { error: 'This program is not published.' });
        const result = await academiaDb.enroll(programResource, programId, authUser);
        if (result.error === 'duplicate') return sendJSON(409, { error: 'You are already enrolled in this program.', item: result.item });
        const enrollment = { id: crypto.randomUUID(), user_id: String(authUser.id), program_id: String(programId), progress: 0, status: 'enrolled', enrolled_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        await userDb.insertRecord('learning_enrollments', enrollment);
        return sendJSON(201, { success: true, enrollment, item: result.item });
      }
      if (operation === 'progress' && req.method === 'PUT') {
        if (authUser.role !== 'student') return sendJSON(403, { error: 'Student access required.' });
        const enrollment = await userDb.getRecord('learning_enrollments', { user_id: String(authUser.id), program_id: String(programId) });
        if (!enrollment) return sendJSON(404, { error: 'Enrollment not found.' });
        const progress = Math.max(0, Math.min(100, Number(body.progress)));
        if (!Number.isFinite(progress)) return sendJSON(400, { error: 'Progress must be a number from 0 to 100.' });
        const completed = progress >= 100;
        const updated = await userDb.updateRecord('learning_enrollments', { id: enrollment.id }, { $set: { ...enrollment, progress, status: completed ? 'completed' : 'in_progress', updated_at: new Date().toISOString(), completed_at: completed ? (enrollment.completed_at || new Date().toISOString()) : null } });
        let certification = null;
        if (completed) {
          certification = await userDb.getRecord('certifications', { user_id: String(authUser.id), program_id: String(programId) });
          if (!certification) certification = await userDb.insertRecord('certifications', { id: crypto.randomUUID(), user_id: String(authUser.id), program_id: String(programId), certificateName: `${item.title} Certificate`, name: `${item.title} Certificate`, issuer: item.provider || item.company_name || 'SkillBridge', issueDate: new Date().toISOString().slice(0, 10), credentialId: `SB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, issued_at: new Date().toISOString(), source: 'learning-program' });
        }
        return sendJSON(200, { success: true, enrollment: updated, certification });
      }
      if (!operation && req.method === 'GET') return sendJSON(200, item);
      if (!operation && ['PUT', 'PATCH'].includes(req.method)) {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Program manager access required.' });
        const updated = await academiaDb.update(programResource, programId, body, authUser);
        return updated ? sendJSON(200, { success: true, item: updated }) : sendJSON(404, { error: 'Program not found or not owned by you.' });
      }
      return sendJSON(405, { error: 'Method not allowed.' });
    }

    // ----------------------------------------------------
    // ACADEMIA / FACULTY FEATURE APIs
    // ----------------------------------------------------
    if (pathname === '/api/faculty/profile' && ['GET', 'PUT', 'PATCH'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'faculty') return sendJSON(403, { error: 'Faculty access required.' });
      if (req.method === 'GET') {
        const profile = await academiaDb.get('faculty-profiles', String(authUser.id), authUser);
        return sendJSON(200, { profile: profile || { id: String(authUser.id), name: authUser.fullName || authUser.username, email: authUser.email, college: authUser.collegeName || '', department: authUser.department || '' } });
      }
      const body = await parseJSON(req);
      const current = await academiaDb.get('faculty-profiles', String(authUser.id), authUser);
      const profile = current ? await academiaDb.update('faculty-profiles', String(authUser.id), body, authUser) : await academiaDb.create('faculty-profiles', { ...body, id: String(authUser.id), name: body.name || authUser.fullName || authUser.username, email: authUser.email }, authUser);
      return sendJSON(200, { success: true, profile });
    }
    if (pathname === '/api/faculty/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'faculty') return sendJSON(403, { error: 'Faculty access required.' });
      const items = [];
      for (const resource of academiaDb.RESOURCE_NAMES) items.push(...await academiaDb.list(resource, {}, authUser));
      const involved = items.filter(item => String(item.created_by) === String(authUser.id) || (item.applications || []).some(a => String(a.user_id) === String(authUser.id)) || (item.registrations || []).some(a => String(a.user_id) === String(authUser.id)));
      return sendJSON(200, { profile: await academiaDb.get('faculty-profiles', String(authUser.id), authUser), total: involved.length, active: involved.filter(item => !['completed', 'Completed', 'closed', 'Closed'].includes(item.status)).length, completed: involved.filter(item => ['completed', 'Completed'].includes(item.status)).length, certificates: involved.filter(item => item.certificate || item.certificate_url || item.achievement).length, items: involved });
    }
    if (pathname === '/api/faculty/students' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'faculty') return sendJSON(403, { error: 'Faculty access required.' });
      const rows = await userDb.listFacultyStudentAuthorizationsForFaculty(authUser.id);
      const students = await Promise.all(rows.map(async (row) => {
        const user = await userDb.getUserById(row.student_user_id).catch(() => null) || state.users.find(item => String(item.id) === String(row.student_user_id)) || null;
        const profile = await userDb.getStudentProfileByUserId(row.student_user_id).catch(() => null) || {};
        return {
          faculty_user_id: row.faculty_user_id,
          student_user_id: row.student_user_id,
          user_id: row.student_user_id,
          student_id: row.student_user_id,
          student: user ? { id: user.id, username: user.username, email: user.email, fullname: user.fullName || user.fullname || user.username, role: user.role } : null,
          profile,
          university_id: row.university_id,
          university_name: row.university_name,
          created_at: row.created_at,
          updated_at: row.updated_at,
          is_active: Number(row.is_active ?? 1) === 1,
          notes: row.notes || ''
        };
      }));
      return sendJSON(200, { items: students, total: students.length });
    }
    if (pathname === '/api/faculty/students/assign' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'faculty') return sendJSON(403, { error: 'Faculty access required.' });
      const body = await parseJSON(req);
      const studentUserId = Number(body.student_user_id ?? body.studentId ?? body.student_id ?? body.user_id);
      if (!Number.isSafeInteger(studentUserId)) return sendJSON(400, { error: 'A valid student user id is required.' });
      const studentUser = await userDb.getUserById(studentUserId).catch(() => null) || state.users.find(item => String(item.id) === String(studentUserId)) || null;
      if (!studentUser || String(studentUser.role).toLowerCase() !== 'student') return sendJSON(404, { error: 'Student not found.' });

      const targetProfile = await userDb.getStudentProfileByUserId(studentUserId).catch(() => null) || {};
      const targetScope = resolveUniversityScope(targetProfile, studentUser);
      const facultyProfile = await academiaDb.get('faculty-profiles', String(authUser.id), authUser).catch(() => null) || {};
      const facultyScope = resolveUniversityScope(facultyProfile, authUser);
      const targetUniversityId = normalizeUniversityValue(targetScope.university_id || (studentUser && (studentUser.university_id || studentUser.universityId)) || '');
      const targetUniversityName = normalizeUniversityValue(targetScope.university_name || (studentUser && (studentUser.university || studentUser.college || studentUser.collegeName)) || '');
      const facultyUniversityId = normalizeUniversityValue(facultyScope.university_id || (authUser && (authUser.university_id || authUser.universityId)) || '');
      const facultyUniversityName = normalizeUniversityValue(facultyScope.university_name || (authUser && (authUser.university || authUser.college || authUser.collegeName)) || '');

      if ((facultyUniversityId && targetUniversityId && facultyUniversityId !== targetUniversityId) ||
          (facultyUniversityName && targetUniversityName && facultyUniversityName !== targetUniversityName)) {
        return sendJSON(403, { error: 'Faculty cannot authorize students from a different university.' });
      }

      const authorization = await userDb.upsertFacultyStudentAuthorization({
        faculty_user_id: authUser.id,
        student_user_id: studentUserId,
        university_id: targetUniversityId || facultyUniversityId,
        university_name: targetUniversityName || facultyUniversityName,
        created_by: authUser.id,
        is_active: 1,
        notes: body.notes || ''
      });
      return sendJSON(201, { success: true, authorization });
    }
    if (pathname.match(/^\/api\/faculty\/students\/([^/]+)$/) && req.method === 'DELETE') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'faculty') return sendJSON(403, { error: 'Faculty access required.' });
      const targetUserId = Number(decodeURIComponent(pathname.split('/')[4] || ''));
      if (!Number.isSafeInteger(targetUserId)) return sendJSON(400, { error: 'A valid student id is required.' });
      const deleted = await userDb.deleteFacultyStudentAuthorization(authUser.id, targetUserId);
      if (!deleted) return sendJSON(404, { error: 'Faculty authorization not found.' });
      return sendJSON(200, { success: true, deleted: true, student_user_id: targetUserId });
    }
    const academiaMatch = pathname.match(/^\/api\/(academia|faculty)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (academiaMatch) {
      const [, , resourceName, itemId, operation] = academiaMatch;
      const resource = academiaDb.normalizeResource(resourceName);
      if (!academiaDb.RESOURCE_NAMES.includes(resource)) return sendJSON(404, { error: 'Academia resource not found.' });
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });

      const managerRoles = ['company', 'faculty', 'college', 'admin', 'university_admin'];
      const participantRoles = ['student', 'company', 'faculty', 'college', 'admin', 'university_admin'];
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await parseJSON(req) : {};

      if (!itemId && req.method === 'GET') {
        return sendJSON(200, await academiaDb.list(resource, Object.fromEntries(parsedUrl.searchParams), authUser));
      }
      if (!itemId && req.method === 'POST') {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Faculty or institutional access required.' });
        return sendJSON(201, { success: true, item: await academiaDb.create(resource, body, authUser) });
      }
      if (!itemId) return sendJSON(405, { error: 'Method not allowed.' });

      if (operation === 'apply' && req.method === 'POST') {
        if (!participantRoles.includes(authUser.role)) return sendJSON(403, { error: 'Participant access required.' });
        const item = await academiaDb.apply(resource, itemId, authUser, body);
        if (item && item.duplicate) return sendJSON(409, { error: 'You have already applied to this opportunity.', item });
        return item ? sendJSON(200, { success: true, item }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'request' && req.method === 'POST') {
        if (!participantRoles.includes(authUser.role)) return sendJSON(403, { error: 'Participant access required.' });
        const item = await academiaDb.request(resource, itemId, authUser, body);
        if (item && item.duplicate) return sendJSON(409, { error: 'You have already requested this opportunity.', item });
        return item ? sendJSON(201, { success: true, item }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'register' && req.method === 'POST') {
        if (!participantRoles.includes(authUser.role)) return sendJSON(403, { error: 'Participant access required.' });
        const item = await academiaDb.register(resource, itemId, authUser, body);
        if (item && item.duplicate) return sendJSON(409, { error: 'You are already registered for this opportunity.', item });
        return item ? sendJSON(200, { success: true, item }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'status' && req.method === 'GET') {
        const item = await academiaDb.status(resource, itemId, authUser);
        return item ? sendJSON(200, item) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'status' && req.method === 'POST') {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Faculty or institutional access required.' });
        const item = await academiaDb.setStatus(resource, itemId, body.status, authUser);
        if (item && ['completed', 'Completed'].includes(body.status)) {
          const records = await academiaDb.list('portfolio-extensions', { source_id: String(itemId) }, authUser);
          if (!records.some(record => String(record.owner_id || record.created_by) === String(item.created_by))) {
            await academiaDb.create('portfolio-extensions', { title: `${item.title || resource} completion`, type: body.certificate ? 'Certificate' : 'Achievement', source_id: String(itemId), owner_id: String(item.created_by), certificate: body.certificate || '', achievement: body.achievement || `Completed ${item.title || resource}`, status: 'Verified' }, authUser);
          }
        }
        return item ? sendJSON(200, { success: true, item }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'progress' && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const item = await academiaDb.get(resource, itemId, authUser);
        if (!item) return sendJSON(404, { error: 'Academia item not found.' });
        const progress = Math.max(0, Math.min(100, Number(body.progress)));
        if (!Number.isFinite(progress)) return sendJSON(400, { error: 'Progress must be a number from 0 to 100.' });
        const ownsItem = String(item.created_by) === String(authUser.id) || ['admin', 'college', 'university_admin'].includes(authUser.role);
        const progressPatch = { progress, progress_updated_at: new Date().toISOString(), status: progress >= 100 ? 'Completed' : 'In progress' };
        if (progress >= 100) progressPatch.completed_at = new Date().toISOString();
        const updated = ownsItem
          ? await academiaDb.update(resource, itemId, progressPatch, authUser)
          : await academiaDb.updateParticipant(resource, itemId, authUser, progressPatch);
        if (updated && updated.error === 'not_participant') return sendJSON(403, { error: 'You must be an approved participant to update progress.' });
        return sendJSON(200, { success: true, item: updated });
      }
      if (operation === 'complete' && req.method === 'POST') {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Manager access required.' });
        const updated = await academiaDb.complete(resource, itemId, authUser, body);
        return updated ? sendJSON(200, { success: true, item: updated }) : sendJSON(404, { error: 'Academia item not found or not owned by you.' });
      }
      if (operation === 'mentor' && req.method === 'POST') {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Manager access required.' });
        const updated = await academiaDb.update(resource, itemId, { mentor_id: body.mentor_id || body.user_id, mentor: body.mentor || body.mentor_name || '' }, authUser);
        return updated ? sendJSON(200, { success: true, item: updated }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'approve' && req.method === 'POST') {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Manager access required.' });
        const item = await academiaDb.get(resource, itemId, authUser);
        if (!item) return sendJSON(404, { error: 'Academia item not found.' });
        const userId = String(body.user_id || body.userId || '');
        if (!userId) return sendJSON(400, { error: 'Applicant or registrant user_id is required.' });
        const status = String(body.status || 'approved');
        const updateEntries = entries => (Array.isArray(entries) ? entries : []).map(entry => String(entry.user_id) === userId ? { ...entry, status, reviewed_at: new Date().toISOString(), reviewed_by: String(authUser.id) } : entry);
        const updated = await academiaDb.update(resource, itemId, { applications: updateEntries(item.applications), registrations: updateEntries(item.registrations) }, authUser);
        return sendJSON(200, { success: true, item: updated });
      }
      if (operation === 'reject' && req.method === 'POST') {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Manager access required.' });
        const item = await academiaDb.get(resource, itemId, authUser);
        if (!item) return sendJSON(404, { error: 'Academia item not found.' });
        const userId = String(body.user_id || body.userId || '');
        if (!userId) return sendJSON(400, { error: 'Applicant or registrant user_id is required.' });
        const updateEntries = entries => (Array.isArray(entries) ? entries : []).map(entry => String(entry.user_id) === userId ? { ...entry, status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: String(authUser.id) } : entry);
        const updated = await academiaDb.update(resource, itemId, { applications: updateEntries(item.applications), registrations: updateEntries(item.registrations) }, authUser);
        return sendJSON(200, { success: true, item: updated });
      }
      if (operation === 'feedback' && req.method === 'POST') {
        const item = await academiaDb.feedback(resource, itemId, authUser, body);
        if (item && item.error === 'not_authorized') return sendJSON(403, { error: 'Only the owner or an approved participant can provide feedback.' });
        return item ? sendJSON(200, { success: true, item }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (!operation && req.method === 'GET') {
        const item = await academiaDb.get(resource, itemId, authUser);
        return item ? sendJSON(200, item) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (!operation && ['PUT', 'PATCH'].includes(req.method)) {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Faculty or institutional access required.' });
        const item = await academiaDb.update(resource, itemId, body, authUser);
        return item ? sendJSON(200, { success: true, item }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (!operation && req.method === 'DELETE') {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Faculty or institutional access required.' });
        const removed = await academiaDb.remove(resource, itemId, authUser);
        return removed ? sendJSON(200, { success: true }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      return sendJSON(405, { error: 'Method not allowed.' });
    }

    // ----------------------------------------------------
    // INTERNSHIP LIFECYCLE APIs
    // ----------------------------------------------------
    const internshipPath = pathname.match(/^\/api\/(company|student)\/internships(?:\/([^/]+))?(?:\/([^/]+))?$/);
    const studentInternshipApplicationsPath = pathname === '/api/student/internship-applications';
    const internshipApplicationPath = pathname.match(/^\/api\/company\/internship-applications\/([^/]+)\/([^/]+)$/);
    const progressPath = pathname.match(/^\/api\/student\/internship-progress\/([^/]+)\/([^/]+)$/);
    const companyProgressPath = pathname.match(/^\/api\/company\/internship-progress\/([^/]+)\/feedback$/);
    if (internshipPath || internshipApplicationPath || progressPath || companyProgressPath || studentInternshipApplicationsPath) {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await parseJSON(req) : {};
      const now = new Date().toISOString();

      if (studentInternshipApplicationsPath) {
        if (authUser.role !== 'student') return sendJSON(403, { error: 'Student access required.' });
        if (req.method !== 'GET') return sendJSON(405, { error: 'Method not allowed.' });
        const applications = await userDb.listRecords('internship_applications', { student_id: String(authUser.id) }, { applied_at: -1 });
        const internships = await userDb.listRecords('internships', {});
        return sendJSON(200, { applications: applications.map(app => ({ ...app, internship: internships.find(item => String(item.id) === String(app.internship_id)) || null })) });
      }

      if (internshipPath) {
        const [, portal, internshipId, operation] = internshipPath;
        if (portal === 'company' && authUser.role !== 'company') return sendJSON(403, { error: 'Company access required.' });
        if (portal === 'student' && authUser.role !== 'student') return sendJSON(403, { error: 'Student access required.' });
        if (portal === 'company' && !internshipId && req.method === 'POST') {
          if (!String(body.title || '').trim()) return sendJSON(400, { error: 'Internship title is required.' });
          const company = state.companies.find(item => item.companyId === authUser.companyId);
          const internship = {
            id: crypto.randomUUID(), companyId: authUser.companyId, company_name: company?.name || authUser.companyName || authUser.username,
            title: String(body.title).trim(), description: String(body.description || '').trim(),
            requirements: Array.isArray(body.requirements) ? body.requirements : String(body.requirements || '').split(',').map(v => v.trim()).filter(Boolean),
            required_skills: Array.isArray(body.required_skills) ? body.required_skills : String(body.required_skills || '').split(',').map(v => v.trim()).filter(Boolean),
            location: body.location || 'Remote', work_mode: body.work_mode || 'Remote', duration: body.duration || '',
            stipend: body.stipend || '', positions: Number(body.positions || 1), deadline: body.deadline || '',
            status: ['Draft', 'Open', 'Closed'].includes(body.status) ? body.status : 'Draft',
            created_by: String(authUser.id), created_at: now, updated_at: now
          };
          await userDb.insertRecord('internships', internship);
          return sendJSON(201, { success: true, internship });
        }
        if (!internshipId && req.method === 'GET') {
          const filter = portal === 'company' ? { companyId: authUser.companyId } : { status: 'Open' };
          const internships = await userDb.listRecords('internships', filter, { created_at: -1 });
          return sendJSON(200, { internships });
        }
        if (!internshipId) return sendJSON(405, { error: 'Method not allowed.' });
        const ownedFilter = portal === 'company' ? { id: internshipId, companyId: authUser.companyId } : { id: internshipId };
        const internship = await userDb.getRecord('internships', ownedFilter);
        if (!internship) return sendJSON(404, { error: 'Internship not found.' });
        if (!operation && req.method === 'GET') return sendJSON(200, { internship });
        if (portal === 'company' && operation === 'applicants' && req.method === 'GET') {
          const applicants = await userDb.listRecords('internship_applications', { internship_id: internship.id, companyId: authUser.companyId }, { applied_at: -1 });
          return sendJSON(200, { internship, applicants });
        }
        if (portal === 'company' && !operation && ['PUT', 'PATCH'].includes(req.method)) {
          const allowed = ['title', 'description', 'requirements', 'required_skills', 'location', 'work_mode', 'duration', 'stipend', 'positions', 'deadline', 'status'];
          const changes = Object.fromEntries(allowed.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
          if (changes.status && !['Draft', 'Open', 'Closed'].includes(changes.status)) return sendJSON(400, { error: 'Invalid internship status.' });
          const saved = await userDb.updateRecord('internships', ownedFilter, { $set: { ...changes, updated_at: now } });
          return sendJSON(200, { success: true, internship: saved });
        }
        if (portal === 'student' && operation === 'apply' && req.method === 'POST') {
          if (internship.status !== 'Open') return sendJSON(400, { error: 'This internship is not accepting applications.' });
          const existing = await userDb.getRecord('internship_applications', { internship_id: internship.id, student_id: authUser.id });
          if (existing) return sendJSON(409, { error: 'You have already applied.' });
          const profile = await userDb.getStudentProfileByUserId(authUser.id);
          const application = { id: crypto.randomUUID(), internship_id: internship.id, companyId: internship.companyId, student_id: String(authUser.id), student_name: profile?.name || authUser.username, status: 'Applied', requirements_acknowledged: body.requirements_acknowledged !== false, cover_note: body.cover_note || '', applied_at: now, updated_at: now };
          await userDb.insertRecord('internship_applications', application);
          return sendJSON(201, { success: true, application });
        }
        if (portal === 'student' && operation === 'applications' && req.method === 'GET') {
          const applications = await userDb.listRecords('internship_applications', { internship_id: internship.id, student_id: String(authUser.id) });
          return sendJSON(200, { applications });
        }
        return sendJSON(405, { error: 'Method not allowed.' });
      }

      if (internshipApplicationPath) {
        if (authUser.role !== 'company') return sendJSON(403, { error: 'Company access required.' });
        const [, applicationId, operation] = internshipApplicationPath;
        const application = await userDb.getRecord('internship_applications', { id: applicationId, companyId: authUser.companyId });
        if (!application) return sendJSON(404, { error: 'Internship application not found.' });
        const statusByOperation = { review: 'Under review', shortlist: 'Shortlisted', interview: 'Interview selected', 'interview-selection': 'Interview selected', offer: 'Offer sent' };
        if (!statusByOperation[operation] || req.method !== 'POST') return sendJSON(405, { error: 'Method not allowed.' });
        const changes = { status: statusByOperation[operation], updated_at: now };
        if (operation === 'review') changes.review = body.review || body.notes || '';
        if (operation === 'interview' || operation === 'interview-selection') changes.interview = { date: body.date || '', time: body.time || '', mode: body.mode || 'Online', notes: body.notes || '' };
        if (operation === 'offer') changes.offer = { title: body.title || '', stipend: body.stipend || '', start_date: body.start_date || '', expiry: body.expiry || '' };
        const saved = await userDb.updateRecord('internship_applications', { id: application.id, companyId: authUser.companyId }, { $set: changes });
        return sendJSON(200, { success: true, application: saved });
      }

      if (progressPath) {
        if (authUser.role !== 'student') return sendJSON(403, { error: 'Student access required.' });
        const [, applicationId, operation] = progressPath;
        const application = await userDb.getRecord('internship_applications', { id: applicationId, student_id: String(authUser.id) });
        if (!application || !['Offer sent', 'Started', 'In progress', 'Completed'].includes(application.status)) return sendJSON(404, { error: 'Active internship not found.' });
        let progress = await userDb.getRecord('internship_progress', { application_id: applicationId, student_id: String(authUser.id) });
        if (operation === 'start' && req.method === 'POST') {
          progress = progress || { id: crypto.randomUUID(), application_id: applicationId, student_id: String(authUser.id), companyId: application.companyId, updates: [], started_at: now };
          progress.status = 'Started'; progress.updated_at = now;
        } else if (operation === 'update' && req.method === 'POST') {
          if (!progress) return sendJSON(404, { error: 'Start the internship before adding progress.' });
          progress.updates = [...(progress.updates || []), { note: String(body.note || '').trim(), milestone: body.milestone || '', created_at: now }];
          progress.status = 'In progress'; progress.updated_at = now;
        } else if (operation === 'feedback' && req.method === 'POST') {
          if (!progress) return sendJSON(404, { error: 'Start the internship before requesting feedback.' });
          progress.feedback = [...(progress.feedback || []), { comment: body.comment || '', rating: body.rating || null, created_at: now }];
          progress.updated_at = now;
        } else if (operation === 'complete' && req.method === 'POST') {
          if (!progress) return sendJSON(404, { error: 'Start the internship before completing it.' });
          progress.status = 'Completed'; progress.completed_at = now; progress.certificate = { id: crypto.randomUUID(), issued_at: now, title: body.title || 'Internship completion certificate' }; progress.updated_at = now;
          await userDb.updateRecord('internship_applications', { id: applicationId, student_id: String(authUser.id) }, { $set: { status: 'Completed', updated_at: now } });
        } else return sendJSON(405, { error: 'Method not allowed.' });
        await userDb.insertRecord('internship_progress', progress);
        return sendJSON(200, { success: true, progress });
      }

      if (companyProgressPath) {
        if (authUser.role !== 'company' || req.method !== 'POST') return sendJSON(403, { error: 'Company access required.' });
        const applicationId = companyProgressPath[1];
        const application = await userDb.getRecord('internship_applications', { id: applicationId, companyId: authUser.companyId });
        if (!application) return sendJSON(404, { error: 'Internship application not found.' });
        const progress = await userDb.getRecord('internship_progress', { application_id: applicationId, companyId: authUser.companyId });
        if (!progress) return sendJSON(404, { error: 'Internship progress not found.' });
        progress.feedback = [...(progress.feedback || []), { comment: body.comment || '', rating: body.rating || null, reviewer_id: String(authUser.id), created_at: now }];
        progress.updated_at = now;
        await userDb.insertRecord('internship_progress', progress);
        return sendJSON(200, { success: true, progress });
      }
    }

    // ----------------------------------------------------
    // SYSTEM & HEALTH API ENDPOINTS
    // ----------------------------------------------------
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJSON(200, { status: 'UP & RUNNING', uptime_seconds: process.uptime(), memory: process.memoryUsage(), timestamp: new Date().toISOString() });
    }

    if (pathname === '/api/docs' && req.method === 'GET') {
      return sendJSON(200, {
        platform: 'SkillBridge Academiaâ€“Industry Collaboration Platform API',
        version: '2.0-Unique-Engine',
        port,
        portals: ['Student Portal', 'Company Recruiter Module', 'University Admin Module'],
        endpoints_count: 24
      });
    }

    // ----------------------------------------------------
    // AUTHENTICATION APIs
    // ----------------------------------------------------
    if (pathname === '/api/auth/send-otp' && req.method === 'POST') {
      const { email } = await parseJSON(req);
      const normalizedEmail = normalizeIdentity(email);
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return sendJSON(400, { error: 'A valid email address is required.' });
      }

      const code = generateOtpCode();
      otpStore[normalizedEmail] = {
        code,
        expiresAt: Date.now() + 3 * 60 * 1000,
        verified: false,
        requestedAt: Date.now()
      };

      return sendJSON(200, {
        success: true,
        message: 'OTP sent successfully.',
        devCode: code
      });
    }

    if (pathname === '/api/auth/verify-otp' && req.method === 'POST') {
      const { email, otp } = await parseJSON(req);
      const normalizedEmail = normalizeIdentity(email);
      const entry = otpStore[normalizedEmail];

      if (!entry) return sendJSON(400, { error: 'OTP has not been requested for this email.' });
      if (Date.now() > entry.expiresAt) {
        delete otpStore[normalizedEmail];
        return sendJSON(400, { error: 'OTP expired. Please request a new one.' });
      }
      if (String(otp) !== String(entry.code)) {
        return sendJSON(400, { error: 'Invalid OTP.' });
      }

      otpStore[normalizedEmail] = { ...entry, verified: true, verifiedAt: Date.now() };
      return sendJSON(200, { success: true, message: 'Email verified successfully.' });
    }

    if (pathname === '/api/auth/check-email' && req.method === 'POST') {
      const { email, role } = await parseJSON(req);
      const normalizedEmail = normalizeIdentity(email);
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return sendJSON(400, { error: 'A valid email address is required.' });
      }
      const user = await userDb.getUserByEmail(normalizedEmail);
      return sendJSON(200, {
        registered: Boolean(user),
        registeredForRole: Boolean(user && (!role || user.role === role)),
        role: user ? user.role : null
      });
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const { fullName, username, email, mobile, companyName, managerName, collegeName, adminName, department, role, password } = await parseJSON(req);
      const userRole = role || 'student';
      const newId = Date.now();
      const { salt, hash } = hashPassword(password || 'Password@123');
      const normalizedEmail = normalizeIdentity(email);
      const normalizedUsername = normalizeIdentity(username) || normalizedEmail.split('@')[0];
      if (!normalizedEmail || !normalizedEmail.includes('@') || !password) {
        return sendJSON(400, { error: 'A valid email and password are required.' });
      }
      if (await userDb.getUserByEmail(normalizedEmail) || await userDb.getUserByUsername(normalizedUsername)) {
        return sendJSON(409, { error: 'An account with this email or username already exists.' });
      }

      if (userRole === 'company') {
        if (!companyName || !email || !password) return sendJSON(400, { error: 'Company Name, Email, and Password required.' });
        const assignedCompId = nextCompanyId();
        const newComp = { id: newId, companyId: assignedCompId, name: companyName, logo: 'ðŸ¢', industry: 'Corporate Partner', manager_name: managerName || 'Recruitment Manager', min_cgpa: 7.0, min_ai_score: 70, required_skills: ['Java', 'SQL'] };
        state.companies.push(newComp);

        const stored = await userDb.createUser({ email: normalizedEmail, username: normalizedUsername, passwordHash: hash, salt, role: 'company' });
        if (!stored) return sendJSON(500, { error: 'Unable to create account. Please try again.' });
        const newUser = { ...stored, companyName, companyId: assignedCompId, password_hash: hash, salt };
        await userDb.createOrUpdateCompanyProfile(stored.id, {
          company_id: assignedCompId,
          company_name: companyName,
          industry: newComp.industry,
          manager_name: newComp.manager_name,
          min_cgpa: newComp.min_cgpa,
          min_ai_score: newComp.min_ai_score,
          required_skills: newComp.required_skills.join(',')
        });
        state.users.push(newUser);
        await notifyNewUserRegistration({
          Role: 'Company',
          Name: companyName,
          'Manager name': managerName || 'Recruitment Manager',
          Email: normalizedEmail,
          'Company ID': assignedCompId
        });
        const token = generateToken({ id: newUser.id, email: normalizedEmail, companyId: assignedCompId, role: 'company' });
        return sendJSON(201, { token, user: sanitizeUser(newUser), company: newComp });

      } else if (userRole === 'college') {
        if (!collegeName || !email || !password) return sendJSON(400, { error: 'University Name, Email, and Password required.' });
        const stored = await userDb.createUser({ email: normalizedEmail, username: normalizedUsername, passwordHash: hash, salt, role: 'college' });
        if (!stored) return sendJSON(500, { error: 'Unable to create account. Please try again.' });
        const newUser = { ...stored, collegeName, adminName: adminName || 'University Admin', password_hash: hash, salt };
        await userDb.insertRecord('college_profiles', {
          user_id: String(stored.id), institution_id: String(stored.id),
          institution: collegeName, college: collegeName, admin_name: adminName || 'University Admin'
        });
        state.users.push(newUser);
        await notifyNewUserRegistration({
          Role: 'College / University',
          Name: collegeName,
          'Admin name': adminName || 'University Admin',
          Email: normalizedEmail
        });
        const token = generateToken({ id: newUser.id, email: normalizedEmail, role: 'college', collegeName });
        return sendJSON(201, { token, user: sanitizeUser(newUser) });

      } else if (userRole === 'faculty') {
        if (!fullName) return sendJSON(400, { error: 'Faculty name, email, and password required.' });
        const stored = await userDb.createUser({
          email: normalizedEmail,
          username: normalizedUsername,
          passwordHash: hash,
          salt,
          role: 'faculty',
          mobile: String(mobile || '').trim()
        });
        if (!stored) return sendJSON(500, { error: 'Unable to create account. Please try again.' });
        const newUser = {
          ...stored,
          fullName,
          mobile: String(mobile || '').trim(),
          collegeName: collegeName || '',
          department: department || '',
          password_hash: hash,
          salt
        };
        state.users.push(newUser);
        await notifyNewUserRegistration({
          Role: 'Faculty',
          Name: fullName,
          Email: normalizedEmail,
          Mobile: mobile || '',
          Department: department || '',
          College: collegeName || ''
        });
        const token = generateToken({ id: newUser.id, email: normalizedEmail, role: 'faculty' });
        return sendJSON(201, { token, user: sanitizeUser(newUser) });

      } else {
        const otpEntry = otpStore[normalizedEmail];
        if (!otpEntry || !otpEntry.verified || Date.now() > otpEntry.expiresAt) {
          return sendJSON(400, { error: 'Email verification is required before creating a student account.' });
        }

        const stored = await userDb.createUser({ email: normalizedEmail, username: normalizedUsername, passwordHash: hash, salt, role: 'student' });
        if (!stored) return sendJSON(500, { error: 'Unable to create account. Please try again.' });
        // Derive the human-readable student ID from PostgreSQL's persistent user
        // primary key so it cannot reset when the process restarts.
        const assignedStuId = `STU-2026-${String(stored.id).padStart(3, '0')}`;
        const newUser = { ...stored, student_id: assignedStuId, password_hash: hash, salt };
        state.users.push(newUser);
        const profile = { user_id: stored.id, name: fullName || '', email: normalizedEmail, phone: mobile || '', student_id: assignedStuId, college: '', department: '', cgpa: null };
        await userDb.createOrUpdateStudentProfile(stored.id, profile);
        state.studentProfiles[stored.id] = profile;
        delete otpStore[normalizedEmail];
        await notifyNewUserRegistration({
          Role: 'Student',
          Name: fullName || '',
          Email: normalizedEmail,
          Mobile: mobile || '',
          'Student ID': assignedStuId,
          College: profile.college || '',
          Department: department || ''
        });
        const token = generateToken({ id: newUser.id, email: normalizedEmail, role: 'student' });
        return sendJSON(201, {
          token,
          user: sanitizeUser(newUser),
          studentId: assignedStuId,
          profile: state.studentProfiles[stored.id]
        });
      }
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const loginPayload = await parseJSON(req);
      const { identity, password, role, email, username } = loginPayload;
      // Company display names are profile data; authentication uses identity and password only.
      const userRole = role || 'student';
      const loginIdentity = identity || email || username;
      if (!normalizeIdentity(loginIdentity) || !password) {
        return sendJSON(400, { error: 'Username or email and password are required.' });
      }

      // Credentials must come from PostgreSQL so accounts remain usable after a
      // server restart. In-memory catalog state is never an auth source.
      let user = await userDb.getUserByIdentity(loginIdentity);
      if (user && user.role !== userRole) {
        user = null;
      }

      if (user) {
        const stateUserIndex = state.users.findIndex(existing => existing.id === user.id);
        if (stateUserIndex === -1) {
          state.users.push(user);
        } else {
          state.users[stateUserIndex] = { ...state.users[stateUserIndex], ...user };
        }
      }

      if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
        return sendJSON(401, { error: `Invalid ${userRole.toUpperCase()} credentials.` });
      }

      const collegeProfile = user.role === 'college' ? await userDb.getRecord('college_profiles', { user_id: String(user.id) }) : null;
      const token = generateToken({
        id: user.id, email: user.email, companyId: user.companyId, role: user.role,
        collegeName: collegeProfile && (collegeProfile.institution || collegeProfile.college || collegeProfile.university)
      });
      const profile = user.role === 'student' ? (await userDb.getStudentProfileByUserId(user.id)) : null;
      return sendJSON(200, { token, user: sanitizeUser(user), ...(profile ? { profile: { ...profile, email: user.email } } : {}) });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Not authenticated' });
      const profile = authUser.role === 'student' ? await userDb.getStudentProfileByUserId(authUser.id) : null;
      return sendJSON(200, { user: sanitizeUser(authUser), ...(profile ? { profile: { ...profile, email: authUser.email } } : {}) });
    }

    // ----------------------------------------------------
    // STUDENT MODULE APIs
    // ----------------------------------------------------
    if (pathname === '/api/student/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const profile = await userDb.getStudentProfileByUserId(userId);
      if (!profile) return sendJSON(404, { error: 'Student profile not found.' });
      const [technicalSkills, projects, certificates, applications, jobs, academicRecords] = await Promise.all([
        userDb.listRecords('student_skills', { user_id: userId }),
        userDb.listRecords('projects', { user_id: userId }),
        userDb.listRecords('certifications', { user_id: userId }),
        userDb.listRecords('applications', { student_id: userId }),
        userDb.listRecords('jobs', {}, { created_at: -1, id: -1 }),
        userDb.listRecords('student_academics', { user_id: userId }, { semester_number: 1, semester: 1 })
      ]);
      const academicValues = academicRecords
        .map(record => Number(record.gpa ?? record.cgpa))
        .filter(Number.isFinite);
      const calculatedCgpa = academicValues.length
        ? Number((academicValues.reduce((sum, value) => sum + value, 0) / academicValues.length).toFixed(2))
        : null;
      const recommendedJobs = jobs.map(job => {
        const company = state.companies.find(item => item.companyId === job.companyId);
        if (!company) return null;
        const match = calculateCompanyMatch(userId, company);
        return { ...job, match_percentage: match.matchPercentage };
      }).filter(Boolean);

      return sendJSON(200, {
        profile: { ...profile, cgpa: calculatedCgpa ?? profile.cgpa ?? null },
        profileCompletion: { percentage: 80, missingItems: [] },
        technicalSkills: technicalSkills.length,
        projects: projects.length,
        certificates: certificates.length,
        applications: applications.length,
        skillScore: calculateSkillScore(userId),
        recommendedJobs
      });
    }
    // PHASE 10: private career-document storage. Metadata lives in workflow_records;
    // the storage path is never returned or exposed by the static asset server.
    const documentMatch = pathname.match(/^\/api\/student\/documents(?:\/([^/]+)(?:\/(view|download))?)?$/);
    if (documentMatch) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(403, { error: 'Student authentication required.' });
      const userId = String(authUser.id);
      const documentId = documentMatch[1] ? decodeURIComponent(documentMatch[1]) : null;
      const action = documentMatch[2];
      if (req.method === 'GET' && !documentId) {
        const documents = await userDb.listRecords('career_documents', { user_id: userId }, { created_at: -1 });
        return sendJSON(200, { documents: documents.map(documentPublicMetadata) });
      }
      if (req.method === 'POST' && !documentId) {
        let upload;
        try { upload = await parseMultipart(req); } catch (error) {
          return sendJSON(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, { error: error.message });
        }
        const category = String(upload.fields.category || '').trim().toLowerCase();
        const validationError = validateDocument(upload.file, category);
        if (validationError) return sendJSON(400, { error: validationError });
        const id = crypto.randomUUID();
        const extension = path.extname(upload.file.originalName).toLowerCase();
        const userDirectory = path.join(uploadsDir, 'private', userId);
        fs.mkdirSync(userDirectory, { recursive: true });
        const storagePath = path.join(userDirectory, `${id}${extension}`);
        fs.writeFileSync(storagePath, upload.file.buffer, { flag: 'wx', mode: 0o600 });
        const record = {
          id, user_id: userId, category,
          title: String(upload.fields.title || upload.file.originalName).trim().slice(0, 180),
          original_name: upload.file.originalName.slice(0, 255),
          content_type: upload.file.contentType, size_bytes: upload.file.buffer.length,
          storage_path: storagePath, created_at: new Date().toISOString()
        };
        try {
          await userDb.insertRecord('career_documents', record);
        } catch (error) {
          try { fs.unlinkSync(storagePath); } catch (ignored) {}
          throw error;
        }
        return sendJSON(201, { success: true, document: documentPublicMetadata(record) });
      }
      if (!documentId) return sendJSON(405, { error: 'Method not allowed.' });
      const record = await userDb.getRecord('career_documents', { id: documentId, user_id: userId });
      if (!record) return sendJSON(404, { error: 'Document not found.' });
      if (req.method === 'DELETE' && !action) {
        await userDb.deleteRecord('career_documents', { id: documentId, user_id: userId });
        if (record.storage_path) {
          try { fs.unlinkSync(record.storage_path); } catch (ignored) {}
        }
        return sendJSON(200, { success: true });
      }
      if (req.method === 'GET' && (action === 'view' || action === 'download')) {
        const resolved = path.resolve(record.storage_path || '');
        const privateRoot = path.resolve(uploadsDir, 'private', userId);
        if (!resolved.startsWith(`${privateRoot}${path.sep}`) || !fs.existsSync(resolved)) return sendJSON(404, { error: 'Document file is unavailable.' });
        res.writeHead(200, {
          'Content-Type': record.content_type || 'application/octet-stream',
          'Content-Length': fs.statSync(resolved).size,
          'Content-Disposition': `${action === 'download' ? 'attachment' : 'inline'}; filename="${String(record.original_name || 'document').replace(/["\r\n]/g, '')}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        return fs.createReadStream(resolved).pipe(res);
      }
      return sendJSON(405, { error: 'Method not allowed.' });
    }
    if (pathname === '/api/student/profile' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const profile = await userDb.getStudentProfileByUserId(userId);
      if (!profile) return sendJSON(404, { error: 'Student profile not found.' });
      const resume = await userDb.getRecord('student_resumes', { user_id: userId });
      return sendJSON(200, { profile: { ...profile, email: authUser.email }, completion: { percentage: 80, missingItems: [] }, resume: resume || null });
    }
    if (pathname === '/api/student/resume' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      if (String(req.headers['content-type'] || '').toLowerCase().startsWith('multipart/form-data')) {
        let upload;
        try { upload = await parseMultipart(req); } catch (error) {
          return sendJSON(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, { error: error.message });
        }
        const validationError = validateDocument(upload.file, 'resume');
        if (validationError) return sendJSON(400, { error: validationError });
        const id = crypto.randomUUID();
        const extension = path.extname(upload.file.originalName).toLowerCase();
        const userDirectory = path.join(uploadsDir, 'private', String(userId));
        fs.mkdirSync(userDirectory, { recursive: true });
        const storagePath = path.join(userDirectory, `${id}${extension}`);
        fs.writeFileSync(storagePath, upload.file.buffer, { flag: 'wx', mode: 0o600 });
        const document = { id, user_id: String(userId), category: 'resume', title: upload.fields.title || 'Resume', original_name: upload.file.originalName.slice(0, 255), content_type: upload.file.contentType, size_bytes: upload.file.buffer.length, storage_path: storagePath, created_at: new Date().toISOString() };
        let atsAnalysis = null;
        if (upload.fields.atsAnalysis) {
          try { atsAnalysis = JSON.parse(upload.fields.atsAnalysis); } catch (error) {
            try { fs.unlinkSync(storagePath); } catch (ignored) {}
            return sendJSON(400, { error: 'Resume analysis metadata is invalid.' });
          }
        }
        const resume = { file_name: document.original_name, upload_date: new Date().toISOString().split('T')[0], status: 'Verified & Active', document_id: id, ats_analysis: atsAnalysis };
        try {
          await userDb.insertRecord('career_documents', document);
          await userDb.updateRecord('student_resumes', { user_id: userId }, { $set: resume }, { upsert: true });
        } catch (error) {
          try { fs.unlinkSync(storagePath); } catch (ignored) {}
          throw error;
        }
        state.resumes[userId] = resume;
        return sendJSON(201, { success: true, resume: { ...resume, document: documentPublicMetadata(document) } });
      }
      // Preserve the legacy JSON resume workflow for existing records, without
      // turning it into a public file endpoint.
      const body = await parseJSON(req);
      if (!body.fileUrl && !body.resumeUrl) return sendJSON(400, { error: 'Resume file or URL is required.' });
      state.resumes[userId] = { file_name: body.fileName || 'Resume.pdf', file_url: body.fileUrl || body.resumeUrl, upload_date: new Date().toISOString().split('T')[0], status: 'Verified & Active', ats_analysis: body.atsAnalysis || null };
      await userDb.updateRecord('student_resumes', { user_id: userId }, { $set: state.resumes[userId] }, { upsert: true });
      return sendJSON(201, { success: true, resume: state.resumes[userId] });
    }
    if (pathname === '/api/student/onboarding' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const userId = authUser.id;
      const profile = await userDb.createOrUpdateStudentProfile(userId, {
        ...(body.profile || {}), user_id: userId, onboarding_complete: true
      });
      if (!profile) return sendJSON(500, { error: 'Unable to save onboarding profile.' });
      const academics = (body.semesterGpa || []).map((gpa, index) => ({
        user_id: userId, semester: `Semester ${index + 1}`, gpa: gpa === null ? null : Number(gpa)
      })).filter(record => record.gpa !== null && Number.isFinite(record.gpa));
      await userDb.deleteRecords('student_academics', { user_id: userId });
      if (academics.length) await Promise.all(academics.map(record => userDb.insertRecord('student_academics', record)));
      await userDb.updateRecord('student_academic_summary', { user_id: userId }, { $set: {
        user_id: userId, school: body.school || null, backlog: body.backlog || null,
        updated_at: new Date().toISOString()
      } }, { upsert: true });
      await userDb.updateRecord('student_preferences', { user_id: userId }, { $set: {
        user_id: userId, ...(body.preferences || {}), updated_at: new Date().toISOString()
      } }, { upsert: true });
      for (const skill of Array.isArray(body.skills) ? body.skills : []) {
        if (!String(skill.skillName || skill.skill_name || '').trim()) continue;
        const name = String(skill.skillName || skill.skill_name).trim();
        await userDb.updateRecord('student_skills', { user_id: userId, skill_name: name }, { $set: {
          user_id: userId, skill_name: name, category: skill.category || 'Other',
          proficiency_percentage: Number(skill.proficiencyPercentage || skill.proficiency_percentage || 0),
          updated_at: new Date().toISOString()
        } }, { upsert: true });
      }
      state.studentProfiles[userId] = { ...profile, email: authUser.email };
      return sendJSON(200, { success: true, profile: state.studentProfiles[userId] });
    }
    if (pathname === '/api/student/profile' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const body = await parseJSON(req);
      const updated = await userDb.createOrUpdateStudentProfile(userId, body);
      if (!updated) return sendJSON(500, { error: 'Unable to save profile.' });
      state.studentProfiles[userId] = { ...updated, email: authUser.email };
      return sendJSON(200, { success: true, profile: state.studentProfiles[userId] });
    }
    if (pathname === '/api/student/academics' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const profile = await userDb.getStudentProfileByUserId(userId);
      const [records, summary] = await Promise.all([
        userDb.listRecords('student_academics', { user_id: userId }, { semester_number: 1, semester: 1 }),
        userDb.getRecord('student_academic_summary', { user_id: userId })
      ]);
      const normalized = records.map(record => normalizeAcademicRecord(record, userId));
      const values = normalized.map(record => Number(record.gpa)).filter(Number.isFinite);
      return sendJSON(200, { cgpa: profile && profile.cgpa != null ? profile.cgpa : (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null), records: normalized, school: summary && summary.school, backlog: summary && summary.backlog });
    }
    if (pathname === '/api/student/semester-records' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const records = await userDb.listRecords('student_academics', { user_id: authUser.id }, { semester_number: 1, semester: 1 });
      const values = records.map(record => Number(record.gpa ?? record.cgpa)).filter(Number.isFinite);
      const cgpa = values.length
        ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
        : null;
      return sendJSON(200, { cgpa, records: records.map(record => normalizeAcademicRecord(record, authUser.id)) });
    }
    if (pathname === '/api/student/semester-records' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const record = normalizeAcademicRecord({
        id: body.id || `${authUser.id}-${Date.now()}`,
        user_id: authUser.id,
        semester_number: Number(body.semester_number ?? body.semester ?? 1),
        semester: body.semester || `Semester ${body.semester_number ?? body.semester ?? 1}`,
        academic_year: body.academic_year || body.year || '',
        gpa: body.gpa,
        cgpa: body.cgpa,
        total_marks: body.total_marks ?? body.semester_marks,
        semester_marks: body.semester_marks ?? body.total_marks,
        percentage: body.percentage,
        subjects_count: body.subjects_count ?? body.number_of_subjects,
        passed_subjects: body.passed_subjects ?? body.passed,
        failed_subjects: body.failed_subjects ?? body.failed,
        backlogs: body.backlogs ?? body.backlog,
        academic_status: body.academic_status || body.status || 'Pending',
        remarks: body.remarks || body.comment || ''
      }, authUser.id);
      await userDb.insertRecord('student_academics', record);
      const saved = await userDb.getRecord('student_academics', { id: record.id, user_id: authUser.id });
      const cgpa = await refreshStudentAcademicCgpa(authUser.id);
      return sendJSON(201, { success: true, cgpa, record: normalizeAcademicRecord(saved || record, authUser.id) });
    }
    if (pathname.match(/^\/api\/student\/semester-records\/([^/]+)$/) && ['GET', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const recordId = decodeURIComponent(pathname.split('/').pop());
      const existing = await userDb.getRecord('student_academics', { id: recordId, user_id: authUser.id });
      if (!existing) return sendJSON(404, { error: 'Academic record not found.' });
      if (req.method === 'GET') return sendJSON(200, { record: normalizeAcademicRecord(existing, authUser.id) });
      if (req.method === 'DELETE') {
        await userDb.deleteRecord('student_academics', { id: recordId, user_id: authUser.id });
        const cgpa = await refreshStudentAcademicCgpa(authUser.id);
        return sendJSON(200, { success: true, cgpa });
      }
      const body = await parseJSON(req);
      const merged = normalizeAcademicRecord({
        ...existing,
        ...body,
        total_marks: body.total_marks ?? body.semester_marks ?? existing.total_marks ?? existing.semester_marks,
        semester_marks: body.semester_marks ?? body.total_marks ?? existing.semester_marks ?? existing.total_marks,
        id: recordId,
        user_id: authUser.id
      }, authUser.id);
      await userDb.insertRecord('student_academics', merged);
      const cgpa = await refreshStudentAcademicCgpa(authUser.id);
      return sendJSON(200, { success: true, cgpa, record: normalizeAcademicRecord(merged, authUser.id) });
    }
    if (pathname === '/api/student/academics' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const userId = authUser.id;
      const records = (body.records || body.semesterGpa || []).map((entry, index) => {
        if (typeof entry === 'number' || typeof entry === 'string') {
          return { user_id: userId, semester: `Semester ${index + 1}`, gpa: entry === null ? null : Number(entry) };
        }
        return {
          user_id: userId,
          semester_number: Number(entry.semester_number ?? entry.semester ?? index + 1),
          semester: entry.semester || `Semester ${Number(entry.semester_number ?? entry.semester ?? index + 1)}`,
          academic_year: entry.academic_year || entry.year || '',
          gpa: entry.gpa == null ? null : Number(entry.gpa),
          cgpa: entry.cgpa == null ? null : Number(entry.cgpa),
          total_marks: entry.total_marks == null ? null : Number(entry.total_marks),
          percentage: entry.percentage == null ? null : Number(entry.percentage),
          subjects_count: entry.subjects_count ?? entry.number_of_subjects ?? null,
          passed_subjects: entry.passed_subjects ?? entry.passed ?? null,
          failed_subjects: entry.failed_subjects ?? entry.failed ?? null,
          backlogs: entry.backlogs ?? entry.backlog ?? null,
          academic_status: entry.academic_status || entry.status || 'Pending',
          remarks: entry.remarks || entry.comment || '',
          id: entry.id || `${userId}-${Number(entry.semester_number ?? entry.semester ?? index + 1)}-${Date.now()}`
        };
      }).filter(record => record.gpa !== null && Number.isFinite(Number(record.gpa)) || (record.cgpa !== null && Number.isFinite(Number(record.cgpa))));
      await userDb.deleteRecords('student_academics', { user_id: userId });
      if (records.length) await Promise.all(records.map(record => userDb.insertRecord('student_academics', normalizeAcademicRecord(record, userId))));
      const values = records.map(record => Number(record.gpa ?? record.cgpa)).filter(Number.isFinite);
      const cgpa = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      await userDb.updateRecord('student_academic_summary', { user_id: userId }, { $set: { user_id: userId, school: body.school || null, backlog: body.backlog || null, updated_at: new Date().toISOString() } }, { upsert: true });
      await userDb.createOrUpdateStudentProfile(userId, { cgpa, university_id: body.university_id || (await userDb.getStudentProfileByUserId(userId))?.university_id || null });
      return sendJSON(200, { success: true, cgpa, records: records.map(record => normalizeAcademicRecord(record, userId)) });
    }
    if (pathname === '/api/student/preferences' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { preferences: (await userDb.getRecord('student_preferences', { user_id: authUser.id })) || {} });
    }
    if (pathname === '/api/student/preferences' && ['POST', 'PUT'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const preferences = { user_id: authUser.id, ...body, updated_at: new Date().toISOString() };
      await userDb.updateRecord('student_preferences', { user_id: authUser.id }, { $set: preferences }, { upsert: true });
      return sendJSON(200, { success: true, preferences });
    }
    if (pathname === '/api/student/skills' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const [technical, coding] = await Promise.all([
        userDb.listRecords('student_skills', { user_id: userId }, { skill_name: 1 }),
        userDb.getRecord('coding_skills', { user_id: userId })
      ]);
      return sendJSON(200, { technical, coding: coding || null });
    }
    if (pathname === '/api/student/skills' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const skillName = String(body.skillName || body.skill_name || '').trim();
      if (!skillName) return sendJSON(400, { error: 'Skill name is required.' });
      const skill = {
        user_id: authUser.id,
        skill_name: skillName,
        category: String(body.category || 'Technical').trim(),
        proficiency: body.proficiency || (Number(body.proficiencyPercentage) >= 80 ? 'Advanced' : 'Intermediate'),
        proficiency_percentage: Number(body.proficiencyPercentage || body.proficiency_percentage || 0),
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      };
      await userDb.updateRecord('student_skills', { user_id: authUser.id, skill_name: skillName }, { $set: skill }, { upsert: true });
      const savedSkill = await userDb.getRecord('student_skills', { user_id: authUser.id, skill_name: skillName });
      state.userSkills[authUser.id] = await userDb.listRecords('student_skills', { user_id: authUser.id }, { skill_name: 1 });
      return sendJSON(201, { success: true, skill: savedSkill });
    }
    if (pathname.match(/^\/api\/student\/skills\/[^/]+$/) && req.method === 'DELETE') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const skillId = decodeURIComponent(pathname.split('/').pop());
      const removed = await userDb.deleteRecord('student_skills', { user_id: authUser.id, $or: [{ id: Number(skillId) }, { skill_name: skillId }] });
      if (!removed) return sendJSON(404, { error: 'Skill not found.' });
      state.userSkills[authUser.id] = await userDb.listRecords('student_skills', { user_id: authUser.id }, { skill_name: 1 });
      return sendJSON(200, { success: true });
    }
    if (pathname === '/api/student/assessments' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const computedScore = calculateSkillScore(userId);
      const assessment = await userDb.getRecord('assessments', { user_id: userId });
      return sendJSON(200, { ...(assessment || { tests: [], breakdown: {} }), overall_score: assessment?.overall_score ?? computedScore });
    }
    if (pathname === '/api/student/assessments' && ['POST', 'PUT'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const assessment = { ...body, user_id: authUser.id, updated_at: new Date().toISOString() };
      delete assessment._id;
      await userDb.updateRecord('assessments', { user_id: authUser.id }, { $set: assessment }, { upsert: true });
      state.assessments[authUser.id] = await userDb.getRecord('assessments', { user_id: authUser.id });
      return sendJSON(200, { success: true, assessment: state.assessments[authUser.id] });
    }
    if (pathname === '/api/student/skill-analysis' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const [profile, skills, assessments, jobs] = await Promise.all([
        userDb.getStudentProfileByUserId(userId),
        userDb.listRecords('student_skills', { user_id: userId }),
        userDb.getRecord('assessments', { user_id: userId }),
        userDb.listRecords('jobs', {}, { created_at: -1 })
      ]);
      const skillNames = new Set(skills.map(item => String(item.skill_name || '').trim().toLowerCase()).filter(Boolean));
      const demand = new Map();
      jobs.forEach(job => {
        const required = Array.isArray(job.required_skills)
          ? job.required_skills
          : String(job.required_skills || '').split(',');
        required.map(skill => String(skill).trim()).filter(Boolean).forEach(skill => {
          const key = skill.toLowerCase();
          demand.set(key, (demand.get(key) || 0) + 1);
        });
      });
      const skillGaps = [...demand.entries()]
        .filter(([skill]) => !skillNames.has(skill))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([skill, demandCount]) => ({ skill, demand: demandCount, priority: demandCount >= 3 ? 'high' : 'medium' }));
      const score = assessments?.overall_score ?? calculateSkillScore(userId);
      return sendJSON(200, {
        studentId: userId,
        score: Number(score) || 0,
        skillScore: Number(score) || 0,
        skillGaps,
        recommendations: skillGaps.map(item => ({
          skill: item.skill,
          reason: `${item.demand} active opportunit${item.demand === 1 ? 'y requires' : 'ies require'} this skill`,
          action: `Complete a learning or training program focused on ${item.skill}`
        })),
        profile: { department: profile?.department || '', degree: profile?.degree || '', cgpa: profile?.cgpa ?? null }
      });
    }
    if (pathname === '/api/student/portfolio' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const [projects, internships, certifications, seminars, workshops, hackathons, achievements] = await Promise.all([
        userDb.listRecords('projects', { user_id: userId }, { created_at: -1 }),
        userDb.listRecords('internships', { user_id: userId }, { created_at: -1 }),
        userDb.listRecords('certifications', { user_id: userId }, { created_at: -1 }),
        userDb.listRecords('seminars', { user_id: userId }, { created_at: -1 }),
        userDb.listRecords('workshops', { user_id: userId }, { created_at: -1 }),
        userDb.listRecords('hackathons', { user_id: userId }, { created_at: -1 }),
        userDb.listRecords('achievements', { user_id: userId }, { created_at: -1 })
      ]);
      return sendJSON(200, { projects, internships, certifications, seminars, workshops, hackathons, achievements });
    }
    if (pathname === '/api/student/certificates' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { certificates: await userDb.listRecords('certifications', { user_id: authUser.id }, { created_at: -1 }) });
    }
    if (pathname === '/api/student/certificates' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      if (!String(body.certificateName || body.name || '').trim()) return sendJSON(400, { error: 'Certificate name is required.' });
      if (body.document_id) {
        const document = await userDb.getRecord('career_documents', { id: String(body.document_id), user_id: authUser.id, category: 'certificates' });
        if (!document) return sendJSON(400, { error: 'The certificate document is not available.' });
      }
      const certificate = { ...body, id: await userDb.nextSequence('certifications', 'certifications'), user_id: authUser.id, created_at: new Date().toISOString() };
      await userDb.insertRecord('certifications', certificate);
      return sendJSON(201, { success: true, certificate });
    }
    if (pathname.match(/^\/api\/student\/certificates\/\d+$/) && req.method === 'DELETE') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const removed = await userDb.deleteRecord('certifications', { id: Number(pathname.split('/').pop()), user_id: authUser.id });
      if (!removed) return sendJSON(404, { error: 'Certificate not found.' });
      return sendJSON(200, { success: true });
    }
    if (pathname === '/api/student/projects' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      if (!String(body.title || '').trim() || !String(body.description || '').trim()) return sendJSON(400, { error: 'Project title and description are required.' });
      const project = { ...body, id: await userDb.nextSequence('projects', 'projects'), user_id: authUser.id, created_at: new Date().toISOString() };
      await userDb.insertRecord('projects', project);
      state.projects[authUser.id] = await userDb.listRecords('projects', { user_id: authUser.id }, { created_at: -1 });
      return sendJSON(201, { success: true, project });
    }
    if (pathname.match(/^\/api\/student\/projects\/\d+$/) && req.method === 'DELETE') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const removed = await userDb.deleteRecord('projects', { id: Number(pathname.split('/').pop()), user_id: authUser.id });
      if (!removed) return sendJSON(404, { error: 'Project not found.' });
      state.projects[authUser.id] = await userDb.listRecords('projects', { user_id: authUser.id }, { created_at: -1 });
      return sendJSON(200, { success: true });
    }
    if (pathname === '/api/opportunities' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const jobs = await userDb.listRecords('jobs', {}, { created_at: -1, id: -1 });
      return sendJSON(200, jobs.map(j => {
        const comp = state.companies.find(c => c.companyId === j.companyId);
        if (!comp) return null;
        const match = calculateCompanyMatch(userId, comp);
        return { ...j, match_percentage: match.matchPercentage, is_eligible: match.isEligible };
      }).filter(Boolean));
    }
    if (pathname === '/api/student/apply' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const { jobId } = await parseJSON(req);
      const targetJob = await userDb.getRecord('jobs', { id: Number(jobId) });
      if (!targetJob) return sendJSON(404, { error: 'Job opportunity not found.' });
      if (await userDb.getRecord('applications', { student_id: userId, job_id: targetJob.id })) {
        return sendJSON(409, { error: 'You have already applied for this job.' });
      }
      const profile = await userDb.getStudentProfileByUserId(userId) || {};
      const newApp = { id: await userDb.nextSequence('applications', 'applications'), student_id: userId, job_id: targetJob.id, companyId: targetJob.companyId, company_name: targetJob.company_name, job_title: targetJob.title, candidate_name: profile.name || authUser.username || authUser.email, cgpa: Number(profile.cgpa || 0), applied_at: new Date().toISOString().split('T')[0], status: 'Applied', last_updated: new Date().toISOString().split('T')[0], next_step: 'Application under recruiter review.' };
      await userDb.insertRecord('applications', newApp);
      state.applications.unshift(newApp);
      const notification = { id: await userDb.nextSequence('notifications', 'notifications'), user_id: userId, title: 'Application submitted', message: `Your application for ${targetJob.title} at ${targetJob.company_name} was submitted successfully.`, type: 'application', is_read: false, created_at: new Date().toISOString().split('T')[0] };
      await userDb.insertRecord('notifications', notification);
      state.notifications[userId] = state.notifications[userId] || [];
      state.notifications[userId].unshift(notification);
      return sendJSON(201, { success: true, application: newApp });
    }
    if (pathname === '/api/student/applications' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, await userDb.listRecords('applications', { student_id: authUser.id }, { applied_at: -1, id: -1 }));
    }
    if (pathname === '/api/student/campus-drives' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const drives = state.campusDrives || [
        { id: 1, company: 'TechCorp Solutions', role: 'Software Engineer', location: 'Chennai / Hybrid', date: '2026-09-18', deadline: '2026-09-15', minimumCGPA: 7.5, salary: 'INR 8-12 LPA', eligible: true, registered: false, reason: 'Matches your academic and skill profile.' },
        { id: 2, company: 'DataSoft Systems', role: 'Data Analyst', location: 'Bengaluru', date: '2026-09-24', deadline: '2026-09-20', minimumCGPA: 8.0, salary: 'INR 6-9 LPA', eligible: true, registered: false, reason: 'Eligible based on your CGPA and technical skills.' },
        { id: 3, company: 'InnovateTech', role: 'Frontend Developer', location: 'Remote', date: '2026-10-02', deadline: '2026-09-27', minimumCGPA: 8.5, salary: 'INR 7-10 LPA', eligible: false, registered: false, reason: 'Minimum CGPA requirement is 8.5.' }
      ];
      const savedRegistrations = await userDb.listRecords('campus_registrations', { user_id: userId });
      const registeredIds = new Set(savedRegistrations.map(item => Number(item.drive_id)));
      return sendJSON(200, drives.map(drive => ({ ...drive, registered: registeredIds.has(Number(drive.id)) || Boolean((state.campusRegistrations || {})[userId]?.includes(drive.id)) })));
    }
    if (pathname.match(/^\/api\/student\/campus-drives\/\d+\/register$/) && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const driveId = Number(pathname.split('/')[4]);
      const registrations = state.campusRegistrations || (state.campusRegistrations = {});
      registrations[userId] = registrations[userId] || [];
      if (!registrations[userId].includes(driveId)) registrations[userId].push(driveId);
      await userDb.updateRecord('campus_registrations', { user_id: userId, drive_id: driveId }, { $set: { user_id: userId, drive_id: driveId, registered_at: new Date().toISOString() } }, { upsert: true });
      return sendJSON(200, { success: true, driveId, registered: true });
    }
    if (pathname === '/api/student/placement' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      return sendJSON(200, { placement: await userDb.getRecord('student_placements', { user_id: userId }) });
    }
    if (pathname === '/api/student/placement' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const placement = { user_id: authUser.id, ...body, updated_at: new Date().toISOString() };
      await userDb.updateRecord('student_placements', { user_id: authUser.id }, { $set: placement }, { upsert: true });
      state.placements = state.placements || {};
      state.placements[authUser.id] = placement;
      return sendJSON(200, { success: true, placement });
    }
    if (pathname === '/api/student/settings' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });
      return sendJSON(200, { user: sanitizeUser(authUser), settings: (await userDb.getRecord('user_settings', { user_id: authUser.id })) || { theme: 'system' } });
    }
    if (pathname === '/api/student/settings' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });
      const body = await parseJSON(req);
      const settings = { user_id: authUser.id, ...body, updated_at: new Date().toISOString() };
      await userDb.updateRecord('user_settings', { user_id: authUser.id }, { $set: settings }, { upsert: true });
      return sendJSON(200, { success: true, settings });
    }
    if (pathname === '/api/student/account' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });
      const body = await parseJSON(req);
      const username = normalizeIdentity(body.username);
      const email = normalizeIdentity(body.email);
      if (!username || !email) return sendJSON(400, { error: 'Username and email are required.' });
      const existing = await userDb.getUserByIdentity(username);
      if (existing && String(existing.id) !== String(authUser.id)) return sendJSON(409, { error: 'Username is already in use.' });
      const emailUser = await userDb.getUserByEmail(email);
      if (emailUser && String(emailUser.id) !== String(authUser.id)) return sendJSON(409, { error: 'Email is already in use.' });
      const updated = await userDb.updateRecord('users', { id: authUser.id }, { $set: { username, email, mobile: String(body.mobile || '').trim() } });
      Object.assign(authUser, updated || { username, email, mobile: body.mobile || '' });
      return sendJSON(200, { success: true, user: sanitizeUser(authUser) });
    }
    if (pathname === '/api/student/change-password' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });
      const body = await parseJSON(req);
      if (!verifyPassword(body.currentPassword, authUser.salt, authUser.password_hash)) return sendJSON(400, { error: 'Current password is incorrect.' });
      if (!body.newPassword || body.newPassword.length < 8) return sendJSON(400, { error: 'New password must be at least 8 characters.' });
      if (body.newPassword !== body.confirmPassword) return sendJSON(400, { error: 'New passwords do not match.' });
      const hashed = hashPassword(body.newPassword);
      await userDb.updateRecord('users', { id: authUser.id }, { $set: { password_hash: hashed.hash, salt: hashed.salt } });
      authUser.password_hash = hashed.hash;
      authUser.salt = hashed.salt;
      return sendJSON(200, { success: true, message: 'Password changed successfully.' });
    }
    if (pathname === '/api/student/account' && req.method === 'DELETE') {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });
      const documents = await userDb.listRecords('career_documents', { user_id: String(authUser.id) });
      for (const document of documents) {
        if (document.storage_path) { try { fs.unlinkSync(document.storage_path); } catch (ignored) {} }
      }
      const collections = ['student_profiles', 'student_academics', 'student_academic_summary', 'student_preferences', 'student_skills', 'student_resumes', 'career_documents', 'certifications', 'student_placements', 'campus_registrations', 'user_settings'];
      for (const collection of collections) await userDb.deleteRecords(collection, { user_id: authUser.id });
      await userDb.deleteRecord('users', { id: authUser.id });
      state.users = state.users.filter(user => String(user.id) !== String(authUser.id));
      return sendJSON(200, { success: true });
    }
    if (pathname === '/api/student/notifications' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, await userDb.listRecords('notifications', { user_id: authUser.id }, { created_at: -1, id: -1 }));
    }
    if (pathname === '/api/messages' && (req.method === 'GET' || req.method === 'POST')) {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });
      if (req.method === 'GET') {
        return sendJSON(200, await userDb.listRecords('messages', {
          $or: [{ sender_id: authUser.id }, { recipient_id: authUser.id }]
        }, { created_at: -1, id: -1 }));
      }
      const body = await parseJSON(req);
      const recipientId = Number(body.recipientId || body.recipient_id);
      if (!Number.isInteger(recipientId)) return sendJSON(400, { error: 'A valid recipient ID is required.' });
      const recipient = await userDb.getUserById(recipientId);
      if (!recipient) return sendJSON(404, { error: 'Recipient account not found.' });
      const content = String(body.message || body.content || '').trim();
      if (!content) return sendJSON(400, { error: 'Message content is required.' });
      const message = {
        id: await userDb.nextSequence('messages', 'messages'),
        sender_id: authUser.id,
        recipient_id: recipient.id,
        subject: String(body.subject || '').trim(),
        content,
        created_at: new Date().toISOString(),
        is_read: false
      };
      await userDb.insertRecord('messages', message);
      const notification = {
        id: await userDb.nextSequence('notifications', 'notifications'),
        user_id: recipient.id,
        title: message.subject || 'New message',
        message: content,
        type: 'message',
        messageId: message.id,
        is_read: false,
        created_at: new Date().toISOString().split('T')[0]
      };
      await userDb.insertRecord('notifications', notification);
      return sendJSON(201, { success: true, message });
    }
    if (pathname === '/api/student/offers' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const offers = await userDb.listRecords('offers', { studentId: authUser.id }, { createdAt: -1 });
      return sendJSON(200, offers);
    }
    if (pathname.match(/^\/api\/student\/notifications\/\d+\/read$/) && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const notificationId = Number(pathname.split('/')[4]);
      const notification = await userDb.getRecord('notifications', { id: notificationId, user_id: authUser.id });
      if (!notification) return sendJSON(404, { error: 'Notification not found.' });
      notification.is_read = true;
      await userDb.updateRecord('notifications', { id: notificationId, user_id: authUser.id }, { $set: { is_read: true } });
      state.notifications[authUser.id] = (state.notifications[authUser.id] || []).map(item => item.id === notificationId ? notification : item);
      return sendJSON(200, { success: true, notification });
    }

    // UNIQUE AI ENGINES
    if (pathname === '/api/ai/calculate-skill-score' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const score = calculateSkillScore(userId);
      return sendJSON(200, { studentId: userId, employability_score: score, status: score >= 80 ? 'Highly Qualified' : 'Qualified' });
    }
    if (pathname.startsWith('/api/ai/company/') && req.method === 'GET') {
      const compId = Number(pathname.split('/').pop());
      const comp = state.companies.find(c => c.id === compId);
      if (!comp) return sendJSON(404, { error: 'Company not found.' });
      const match = calculateCompanyMatch(1, comp);
      return sendJSON(200, match);
    }

    // ----------------------------------------------------
    // COMPANY RECRUITER MODULE APIs
    // ----------------------------------------------------
    if (pathname === '/api/company/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const compId = authUser.companyId;
      const company = state.companies.find(c => c.companyId === compId);
      if (!company) return sendJSON(404, { error: 'Company profile not found.' });
      const compJobs = await userDb.listRecords('jobs', { companyId: compId }, { created_at: -1, id: -1 });
      const compApps = await userDb.listRecords('applications', { companyId: compId }, { applied_at: -1, id: -1 });

      const shortlisted = compApps.filter(a => ['Shortlisted', 'Technical Interview'].includes(a.status)).length;
      const averageMatch = compApps.length ? compApps.reduce((sum, app) => sum + Number(app.match_percentage || app.matchScore || 0), 0) / compApps.length : 0;
      return sendJSON(200, {
        company, jobs: compJobs, applications: compApps, total_jobs: compJobs.length,
        total_applicants: compApps.length, shortlisted, pipeline: compApps,
        companyName: company.name, totalJobs: compJobs.length, totalApplications: compApps.length,
        shortlistedCount: shortlisted, avgMatchScore: averageMatch
      });
    }
    if (pathname === '/api/company/profile' && (req.method === 'GET' || req.method === 'PUT')) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const existing = await userDb.getCompanyProfileByUserId(authUser.id);
      const company = state.companies.find(item => item.companyId === authUser.companyId);
      if (req.method === 'GET') {
        return sendJSON(200, {
          ...(existing || {}),
          user_id: authUser.id,
          company_id: authUser.companyId || null,
          company_name: existing?.company_name || company?.name || authUser.companyName || authUser.username,
          industry: existing?.industry || company?.industry || '',
          website: existing?.website || company?.website || '',
          location: existing?.location || company?.location || '',
          description: existing?.description || company?.description || '',
          company_size: existing?.company_size || '',
          founded_year: existing?.founded_year || '',
          technologies: existing?.technologies || '',
          required_skills: existing?.required_skills || '',
          benefits: existing?.benefits || '',
          contact: existing?.contact || ''
        });
      }
      const body = await parseJSON(req);
      const profile = await userDb.createOrUpdateCompanyProfile(authUser.id, {
        company_name: String(body.company_name || '').trim(),
        industry: String(body.industry || '').trim(),
        description: String(body.description || '').trim(),
        website: String(body.website || '').trim(),
        location: String(body.location || '').trim(),
        company_size: String(body.company_size || '').trim(),
        founded_year: Number(body.founded_year) || null,
        technologies: String(body.technologies || '').trim(),
        required_skills: String(body.required_skills || '').trim(),
        benefits: String(body.benefits || '').trim(),
        contact: String(body.contact || '').trim()
      });
      if (company) {
        company.name = profile.company_name;
        company.industry = profile.industry;
        company.website = profile.website;
        company.location = profile.location;
        company.description = profile.description;
      }
      authUser.companyName = profile.company_name;
      return sendJSON(200, { success: true, profile });
    }
    if (pathname === '/api/company/offers' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      return sendJSON(200, await userDb.listRecords('offers', { companyId: authUser.companyId }, { createdAt: -1 }));
    }
    if (pathname === '/api/company/offers' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const body = await parseJSON(req);
      const candidateIdentity = String(body.candidateId || '').trim().toLowerCase();
      const companyApplications = await userDb.listRecords('applications', { companyId: authUser.companyId }, { applied_at: -1, id: -1 });
      const application = companyApplications.find(item => {
        if (item.companyId !== authUser.companyId || !item.student_id) return false;
        if (body.applicationId && item.id === Number(body.applicationId)) return true;
        const candidate = state.users.find(user => user.id === item.student_id);
        return Boolean(candidate && [candidate.student_id, candidate.username, candidate.email]
          .some(value => String(value || '').toLowerCase() === candidateIdentity));
      });
      if (!application) return sendJSON(404, { error: 'A valid company application is required to send an offer.' });
      const student = state.users.find(item => item.id === application.student_id && item.role === 'student');
      if (!student) return sendJSON(404, { error: 'Candidate account not found.' });
      const company = state.companies.find(item => item.companyId === authUser.companyId);
      const offer = {
        id: await userDb.nextSequence('offers', 'offers'),
        companyId: authUser.companyId,
        companyName: company ? company.name : authUser.companyName,
        studentId: student.id,
        candidateName: application.candidate_name,
        candidateEmail: student.email,
        applicationId: application.id,
        jobId: application.job_id,
        jobTitle: application.job_title,
        salary: body.salary || '',
        benefits: Array.isArray(body.benefits) ? body.benefits : [],
        joiningDate: body.joiningDate || '',
        location: body.location || '',
        offerExpiryDate: body.offerExpiryDate || '',
        status: 'Sent',
        createdAt: new Date().toISOString()
      };
      await userDb.insertRecord('offers', offer);
      state.companyOffers[authUser.companyId] = state.companyOffers[authUser.companyId] || [];
      state.companyOffers[authUser.companyId].push(offer);
      const offerNotification = {
        id: await userDb.nextSequence('notifications', 'notifications'),
        user_id: student.id,
        title: 'Job offer received',
        message: `${offer.companyName} sent you an offer for ${offer.jobTitle}.`,
        type: 'offer',
        offerId: offer.id,
        is_read: false,
        created_at: new Date().toISOString().split('T')[0]
      };
      await userDb.insertRecord('notifications', offerNotification);
      state.notifications[student.id] = state.notifications[student.id] || [];
      state.notifications[student.id].unshift(offerNotification);
      return sendJSON(201, { success: true, offer });
    }

    if (pathname === '/api/company/candidates' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const persistedUsers = await userDb.getAllUsers();
      const candidates = [];
      for (const user of persistedUsers.filter(item => item.role === 'student')) {
        const profile = {
          ...(state.studentProfiles[user.id] || {}),
          ...(await userDb.getStudentProfileByUserId(user.id) || {})
        };
        if (!profile) continue;
        const skills = state.userSkills[user.id] || [];
        const projects = state.projects[user.id] || [];
        const certifications = state.certifications[user.id] || [];
        candidates.push({
          studentId: profile.student_id || user.username,
          name: profile.name || user.username,
          department: profile.department || 'Department not provided',
          college: profile.college || 'College not provided',
          cgpa: profile.cgpa,
          skills: skills.map(skill => skill.skill_name),
          projects: projects.length,
          certifications: certifications.length,
          goal: profile.goal || profile.degree || 'Career goal not provided'
        });
      }
      return sendJSON(200, candidates);
    }

    if (pathname === '/api/company/news' && req.method === 'GET') {
      return sendJSON(200, getStudentModuleNews());
    }

    if (pathname === '/api/company/jobs' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const compId = authUser.companyId;
      const comp = state.companies.find(c => c.companyId === compId);
      if (!comp) return sendJSON(404, { error: 'Company profile not found.' });
      const body = await parseJSON(req);

      if (!String(body.title || '').trim()) return sendJSON(400, { error: 'Job title is required.' });
      const rawSkills = body.required_skills ?? body.requiredSkills ?? ['Java', 'SQL'];
      const requiredSkills = Array.isArray(rawSkills) ? rawSkills : String(rawSkills).split(',');
      const newJob = { id: await userDb.nextSequence('jobs', 'jobs'), company_id: comp.id, companyId: comp.companyId, company_name: comp.name, title: String(body.title).trim(), location: body.location || 'Remote', salary_stipend: body.salary_stipend || body.salary || 'â‚¹ 12,00,000 P.A.', required_skills: requiredSkills.map(skill => String(skill).trim()).filter(Boolean), min_cgpa: Number(body.min_cgpa ?? body.minCGPA ?? 7.5), deadline: body.deadline || '2026-11-30', status: body.status || 'Published' };
      await userDb.insertRecord('jobs', { ...newJob, created_at: new Date().toISOString() });
      state.jobs.unshift(newJob);
      const students = state.users.filter(user => user.role === 'student');
      await Promise.all(students.map(async student => {
        state.notifications[student.id] = state.notifications[student.id] || [];
        const notification = { id: await userDb.nextSequence('notifications', 'notifications'), user_id: student.id, title: 'New job opportunity', message: `${newJob.company_name} published ${newJob.title}. Review the opportunity and apply from the Student Portal.`, type: 'job', jobId: newJob.id, is_read: false, created_at: new Date().toISOString().split('T')[0] };
        await userDb.insertRecord('notifications', notification);
        state.notifications[student.id].unshift(notification);
      }));
      return sendJSON(201, { success: true, job: newJob });
    }

    // Company recruiter resources use workflow_records so they work with the
    // existing PostgreSQL schema and remain isolated by companyId.
    if (pathname === '/api/company/jobs' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const jobs = await userDb.listRecords('jobs', { companyId: authUser.companyId }, { created_at: -1, id: -1 });
      const applications = await userDb.listRecords('applications', { companyId: authUser.companyId });
      return sendJSON(200, jobs.map(job => ({ ...job, jobId: job.jobId || job.id, status: job.status || 'Published', applicationCount: applications.filter(app => String(app.job_id) === String(job.id)).length })));
    }

    // Company-owned apprenticeship/internship postings. These records use the
    // existing workflow-record persistence and never expose another company’s
    // postings or applicants.
    if (pathname === '/api/company/internships' && ['GET', 'POST'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      if (req.method === 'GET') return sendJSON(200, { internships: await userDb.listRecords('company_internships', { companyId: authUser.companyId }, { created_at: -1 }) });
      const body = await parseJSON(req);
      if (!String(body.title || '').trim()) return sendJSON(400, { error: 'Internship title is required.' });
      const internship = { ...body, id: await userDb.nextSequence('company_internships', 'company_internships'), companyId: authUser.companyId, status: body.status || 'Draft', created_at: new Date().toISOString() };
      await userDb.insertRecord('company_internships', internship);
      return sendJSON(201, { success: true, internship });
    }
    const internshipMatch = pathname.match(/^\/api\/company\/internships\/([^/]+)(?:\/applicants)?$/);
    if (internshipMatch && ['GET', 'PUT'].includes(req.method) && pathname.includes('/applicants') === false) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const filter = { id: Number(internshipMatch[1]), companyId: authUser.companyId };
      if (req.method === 'GET') {
        const internship = await userDb.getRecord('company_internships', filter);
        return internship ? sendJSON(200, { internship }) : sendJSON(404, { error: 'Internship not found.' });
      }
      const body = await parseJSON(req);
      const saved = await userDb.updateRecord('company_internships', filter, { $set: { ...body, companyId: authUser.companyId, updated_at: new Date().toISOString() } });
      return saved ? sendJSON(200, { success: true, internship: saved }) : sendJSON(404, { error: 'Internship not found.' });
    }
    const internshipApplicantsMatch = pathname.match(/^\/api\/company\/internships\/([^/]+)\/applicants$/);
    if (internshipApplicantsMatch && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const internship = await userDb.getRecord('company_internships', { id: Number(internshipApplicantsMatch[1]), companyId: authUser.companyId });
      if (!internship) return sendJSON(404, { error: 'Internship not found.' });
      return sendJSON(200, { applicants: await userDb.listRecords('company_internship_applications', { internshipId: internship.id, companyId: authUser.companyId }, { created_at: -1 }) });
    }
    const internshipApplicationMatch = pathname.match(/^\/api\/company\/internship-applications\/([^/]+)\/(review|shortlist|interview-selection|offer)$/);
    if (internshipApplicationMatch && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const application = await userDb.getRecord('company_internship_applications', { id: Number(internshipApplicationMatch[1]), companyId: authUser.companyId });
      if (!application) return sendJSON(404, { error: 'Internship application not found.' });
      const statusMap = { review: 'Under review', shortlist: 'Shortlisted', 'interview-selection': 'Interview selected', offer: 'Offer' };
      const saved = await userDb.updateRecord('company_internship_applications', { id: application.id, companyId: authUser.companyId }, { $set: { status: statusMap[internshipApplicationMatch[2]], updated_at: new Date().toISOString() } });
      return sendJSON(200, { success: true, application: saved });
    }
    const jobMatch = pathname.match(/^\/api\/company\/jobs\/([^/]+)$/);
    if (jobMatch && ['PUT', 'DELETE'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const job = await userDb.getRecord('jobs', { id: Number(jobMatch[1]), companyId: authUser.companyId });
      if (!job) return sendJSON(404, { error: 'Job not found.' });
      if (req.method === 'DELETE') {
        await userDb.deleteRecord('jobs', { id: job.id, companyId: authUser.companyId });
        return sendJSON(200, { success: true });
      }
      const body = await parseJSON(req);
      const allowed = ['title', 'description', 'location', 'department', 'vacancies', 'salary', 'salary_stipend', 'type', 'deadline', 'requiredSkills', 'required_skills', 'minCGPA', 'min_cgpa', 'eligibleDepartments', 'status'];
      const changes = Object.fromEntries(allowed.filter(key => body[key] !== undefined).map(key => [key, body[key]]));
      if (changes.requiredSkills !== undefined && changes.required_skills === undefined) changes.required_skills = changes.requiredSkills;
      if (changes.required_skills !== undefined) changes.required_skills = (Array.isArray(changes.required_skills) ? changes.required_skills : String(changes.required_skills).split(',')).map(skill => String(skill).trim()).filter(Boolean);
      if (changes.minCGPA !== undefined && changes.min_cgpa === undefined) changes.min_cgpa = Number(changes.minCGPA);
      if (changes.status) changes.status = ['Closed', 'Open', 'Published', 'Draft'].includes(String(changes.status)) ? String(changes.status) : null;
      if (changes.status === null) return sendJSON(400, { error: 'Invalid job status.' });
      const saved = await userDb.updateRecord('jobs', { id: job.id, companyId: authUser.companyId }, { $set: { ...changes, updated_at: new Date().toISOString() } });
      return sendJSON(200, { success: true, job: { ...saved, jobId: saved.id } });
    }

    if ((pathname === '/api/company/talent-finder' || pathname === '/api/company/candidates/search') && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const query = Object.fromEntries(parsedUrl.searchParams);
      const candidates = [];
      for (const user of (await userDb.getAllUsers()).filter(item => item.role === 'student')) {
        const profile = { ...(state.studentProfiles[user.id] || {}), ...(await userDb.getStudentProfileByUserId(user.id) || {}) };
        const skills = (await userDb.listRecords('student_skills', { user_id: user.id })).map(item => item.skill_name).filter(Boolean);
        const cgpa = Number(profile.cgpa || 0);
        const department = String(profile.department || '');
        if (query.department && department.toLowerCase() !== query.department.toLowerCase()) continue;
        if (query.minCGPA && cgpa < Number(query.minCGPA)) continue;
        if (query.skill && !skills.some(skill => skill.toLowerCase().includes(query.skill.toLowerCase()))) continue;
        candidates.push({ studentId: profile.student_id || user.username, userId: user.id, name: profile.name || user.username, email: user.email, department: department || 'Department not provided', college: profile.college || '', cgpa, skills, aiScore: calculateSkillScore(user.id), matchPercentage: calculateSkillScore(user.id), experience: profile.experience || '', education: profile.education || '', goal: profile.goal || '' });
      }
      return sendJSON(200, candidates);
    }
    const candidateMatch = pathname.match(/^\/api\/company\/candidates\/([^/]+)$/);
    if (candidateMatch && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const identity = decodeURIComponent(candidateMatch[1]).toLowerCase();
      let user = null;
      for (const item of (await userDb.getAllUsers()).filter(candidate => candidate.role === 'student')) {
        const itemProfile = { ...(state.studentProfiles[item.id] || {}), ...(await userDb.getStudentProfileByUserId(item.id) || {}) };
        if ([String(item.id), item.username, item.email, itemProfile.student_id].map(value => String(value || '').toLowerCase()).includes(identity)) {
          user = item;
          break;
        }
      }
      if (!user) return sendJSON(404, { error: 'Candidate not found.' });
      const profile = { ...(state.studentProfiles[user.id] || {}), ...(await userDb.getStudentProfileByUserId(user.id) || {}) };
      const skills = (await userDb.listRecords('student_skills', { user_id: user.id })).map(item => item.skill_name).filter(Boolean);
      return sendJSON(200, { studentId: profile.student_id || user.username, userId: user.id, name: profile.name || user.username, email: user.email, department: profile.department || '', college: profile.college || '', cgpa: Number(profile.cgpa || 0), skills, aiScore: calculateSkillScore(user.id), experience: profile.experience || '', education: profile.education || '' });
    }

    if (pathname === '/api/company/applications' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const applications = await userDb.listRecords('applications', { companyId: authUser.companyId }, { applied_at: -1, id: -1 });
      return sendJSON(200, applications.map(app => ({ ...app, applicationId: app.applicationId || app.id, studentId: app.studentId || app.student_id, studentName: app.studentName || app.candidate_name, jobTitle: app.jobTitle || app.job_title, stage: app.stage || app.status, matchScore: Number(app.matchScore || app.match_percentage || 0) })));
    }
    const stageMatch = pathname.match(/^\/api\/company\/applications\/([^/]+)\/stage$/);
    if (stageMatch && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const body = await parseJSON(req);
      const stage = String(body.stage || body.newStage || '').trim();
      const validStages = ['Applied', 'Screening', 'Shortlisted', 'Assessment', 'Technical Interview', 'HR Interview', 'Final Review', 'Selected', 'Rejected'];
      if (!validStages.includes(stage)) return sendJSON(400, { error: 'Invalid application stage.' });
      const app = await userDb.getRecord('applications', { id: Number(stageMatch[1]), companyId: authUser.companyId });
      if (!app) return sendJSON(404, { error: 'Application not found for this company.' });
      const saved = await userDb.updateRecord('applications', { id: app.id, companyId: authUser.companyId }, { $set: { status: stage, stage, last_updated: new Date().toISOString() } });
      return sendJSON(200, { success: true, application: saved });
    }

    if (pathname === '/api/company/assessments' && ['GET', 'POST'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      if (req.method === 'GET') return sendJSON(200, await userDb.listRecords('company_assessments', { companyId: authUser.companyId }, { created_at: -1 }));
      const body = await parseJSON(req);
      if (!String(body.title || '').trim()) return sendJSON(400, { error: 'Assessment title is required.' });
      const assessment = { ...body, id: await userDb.nextSequence('company_assessments', 'company_assessments'), assessmentId: crypto.randomUUID(), companyId: authUser.companyId, created_at: new Date().toISOString() };
      await userDb.insertRecord('company_assessments', assessment);
      return sendJSON(201, { success: true, assessment });
    }
    const assessmentMatch = pathname.match(/^\/api\/company\/assessments\/([^/]+)$/);
    if (assessmentMatch && ['PUT', 'DELETE'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      if (req.method === 'PUT') {
        const body = await parseJSON(req);
        const saved = await userDb.updateRecord('company_assessments', { assessmentId: assessmentMatch[1], companyId: authUser.companyId }, { $set: { ...body, updated_at: new Date().toISOString() } });
        return saved ? sendJSON(200, { success: true, assessment: saved }) : sendJSON(404, { error: 'Assessment not found.' });
      }
      const removed = await userDb.deleteRecord('company_assessments', { assessmentId: assessmentMatch[1], companyId: authUser.companyId });
      return removed ? sendJSON(200, { success: true }) : sendJSON(404, { error: 'Assessment not found.' });
    }
    const assessmentApplicantStatusMatch = pathname.match(/^\/api\/company\/assessments\/([^/]+)\/applicants\/([^/]+)\/status$/);
    if (assessmentApplicantStatusMatch && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const body = await parseJSON(req);
      const assessment = await userDb.getRecord('company_assessments', { assessmentId: assessmentApplicantStatusMatch[1], companyId: authUser.companyId });
      if (!assessment) return sendJSON(404, { error: 'Assessment not found.' });
      const status = String(body.status || '').trim();
      const allowedStatuses = ['Assessment scheduled', 'Assessment completed'];
      if (!allowedStatuses.includes(status)) return sendJSON(400, { error: 'Status must be Assessment scheduled or Assessment completed.' });
      const filter = { assessmentId: assessmentApplicantStatusMatch[1], applicantId: assessmentApplicantStatusMatch[2], companyId: authUser.companyId };
      const applicant = await userDb.getRecord('company_assessment_applicants', filter);
      if (!applicant) return sendJSON(404, { error: 'Assessment applicant not found for this company.' });
      const saved = await userDb.updateRecord('company_assessment_applicants', filter, { $set: { status, updated_at: new Date().toISOString() } });
      return sendJSON(200, { success: true, applicant: saved });
    }

    if (pathname === '/api/company/interviews' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      return sendJSON(200, await userDb.listRecords('company_interviews', { companyId: authUser.companyId }, { scheduledAt: 1, scheduled_at: 1 }));
    }
    if (pathname === '/api/company/interviews/schedule' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const body = await parseJSON(req);
      if (!body.applicationId && !body.candidateId) return sendJSON(400, { error: 'Candidate or application is required.' });
      const interview = { ...body, id: await userDb.nextSequence('company_interviews', 'company_interviews'), interviewId: crypto.randomUUID(), companyId: authUser.companyId, status: body.status || 'Scheduled', createdAt: new Date().toISOString() };
      await userDb.insertRecord('company_interviews', interview);
      return sendJSON(201, { success: true, interview });
    }
    const interviewMatch = pathname.match(/^\/api\/company\/interviews\/([^/]+)$/);
    if (interviewMatch && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const body = await parseJSON(req);
      const saved = await userDb.updateRecord('company_interviews', { interviewId: interviewMatch[1], companyId: authUser.companyId }, { $set: { ...body, updatedAt: new Date().toISOString() } });
      return saved ? sendJSON(200, { success: true, interview: saved }) : sendJSON(404, { error: 'Interview not found.' });
    }

    if (pathname === '/api/company/analytics/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const applications = await userDb.listRecords('applications', { companyId: authUser.companyId });
      const jobs = await userDb.listRecords('jobs', { companyId: authUser.companyId });
      const count = stage => applications.filter(app => String(app.status || app.stage) === stage).length;
      const jobPerformance = jobs.map(job => { const apps = applications.filter(app => String(app.job_id) === String(job.id)); return { jobTitle: job.title, applicationCount: apps.length, avgMatchScore: apps.length ? apps.reduce((s, a) => s + Number(a.match_percentage || a.matchScore || 0), 0) / apps.length : 0 }; });
      return sendJSON(200, { totalApplications: applications.length, shortlistedCount: count('Shortlisted'), selectedCount: count('Selected'), avgTimeToHire: 'N/A', jobPerformance, funnel: { applied: count('Applied'), screening: count('Screening'), shortlisted: count('Shortlisted'), assessment: count('Assessment'), interview: applications.filter(a => /Interview/.test(String(a.status || a.stage))).length, selected: count('Selected') } });
    }
    if (pathname === '/api/company/team' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const members = (await userDb.getAllUsers()).filter(user => user.role === 'company' && (user.companyId === authUser.companyId || user.id === authUser.id));
      return sendJSON(200, members.map(member => ({ teamMemberId: member.id, name: member.username, email: member.email, role: member.id === authUser.id ? 'Owner' : 'Recruiter', department: 'Recruitment' })));
    }
    if (pathname === '/api/company/campus-drives' && ['GET', 'POST'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      if (req.method === 'GET') return sendJSON(200, await userDb.listRecords('campus_drives', { companyId: authUser.companyId }, { createdAt: -1 }));
      const body = await parseJSON(req);
      if (!String(body.university || body.college || '').trim() || !String(body.position || '').trim()) return sendJSON(400, { error: 'University and position are required.' });
      const drive = { ...body, id: await userDb.nextSequence('campus_drives', 'campus_drives'), driveId: crypto.randomUUID(), companyId: authUser.companyId, status: body.status || 'Open', createdAt: new Date().toISOString() };
      await userDb.insertRecord('campus_drives', drive);
      return sendJSON(201, { success: true, drive });
    }
    const driveMatch = pathname.match(/^\/api\/company\/campus-drives\/([^/]+)$/);
    if (driveMatch && ['PUT', 'DELETE'].includes(req.method)) {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      if (req.method === 'DELETE') {
        const removed = await userDb.deleteRecord('campus_drives', { driveId: driveMatch[1], companyId: authUser.companyId });
        return removed ? sendJSON(200, { success: true }) : sendJSON(404, { error: 'Campus drive not found.' });
      }
      const body = await parseJSON(req);
      const saved = await userDb.updateRecord('campus_drives', { driveId: driveMatch[1], companyId: authUser.companyId }, { $set: body });
      return saved ? sendJSON(200, { success: true, drive: saved }) : sendJSON(404, { error: 'Campus drive not found.' });
    }

    if (pathname === '/api/company/pipeline/stage' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const { applicationId, newStage } = await parseJSON(req);
      const app = await userDb.getRecord('applications', { id: Number(applicationId), companyId: authUser.companyId });
      if (!app || app.companyId !== authUser.companyId) return sendJSON(404, { error: 'Application not found for this company.' });
      if (app) {
        app.status = newStage;
        app.last_updated = new Date().toISOString().split('T')[0];
        app.next_step = `Moved to ${newStage} stage.`;
        await userDb.updateRecord('applications', { id: app.id, companyId: authUser.companyId }, { $set: { status: app.status, last_updated: app.last_updated, next_step: app.next_step } });
        state.applications = state.applications.map(item => item.id === app.id ? app : item);
      }
      return sendJSON(200, { success: true, application: app });
    }

    // ----------------------------------------------------
    // UNIVERSITY ADMIN MODULE APIs
    // ----------------------------------------------------
    async function collegeScope(authUser) {
      const profile = await userDb.getRecord('college_profiles', { user_id: String(authUser.id) }) || await userDb.getStudentProfileByUserId(authUser.id) || {};
      const values = [
        profile && profile.institution_id, profile && profile.college_id, profile && profile.university_id,
        profile && profile.universityId, profile && profile.institution, profile && profile.college, profile && profile.university,
        authUser.university_id, authUser.universityId, authUser.college_id, authUser.collegeId,
        authUser.collegeName, authUser.college_name, authUser.university, authUser.college
      ].map(normalizeIdentity).filter(Boolean);
      return { profile: profile || {}, values };
    }
    function belongsToCollege(record, scope, studentIds) {
      const universityId = normalizeIdentity(record && (record.university_id || record.universityId));
      if (universityId && scope.values.some(value => value === universityId)) return true;
      const value = ['institution_id', 'college_id', 'university_id', 'institution', 'college', 'university', 'institution_name', 'college_name', 'university_name', 'collegeName', 'universityId']
        .map(key => normalizeIdentity(record && record[key])).find(Boolean);
      if (value) return scope.values.includes(value);
      const owner = record && (record.user_id || record.student_id || record.studentId);
      return owner !== undefined && studentIds.has(String(owner));
    }
    function privateStudentView(profile) {
      const copy = { ...profile };
      delete copy.email; delete copy.phone; delete copy.mobile; delete copy.address;
      delete copy.date_of_birth; delete copy.dob;
      return copy;
    }
    if (pathname === '/api/college/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'college') return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      return sendJSON(200, await buildCollegeAnalytics(authUser));
    }
    if (pathname === '/api/college/students' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || !ADMIN_ROLES.has(String(authUser.role))) return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      const analytics = await buildCollegeAnalytics(authUser);
      return sendJSON(200, analytics.student_directory);
    }
    if (pathname.match(/^\/api\/college\/students\/([^/]+)\/academics$/) && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || !ADMIN_ROLES.has(String(authUser.role))) return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      const targetUserId = decodeURIComponent(pathname.split('/')[4]);
      if (!(await canAccessStudentAcademicData(targetUserId, authUser))) return sendJSON(403, { error: 'This student is outside your university scope.' });
      const records = await userDb.listRecords('student_academics', { user_id: targetUserId }, { semester_number: 1, semester: 1 });
      return sendJSON(200, { user_id: targetUserId, records: records.map(record => normalizeAcademicRecord(record, targetUserId)) });
    }
    if (pathname.match(/^\/api\/students\/([^/]+)\/academics$/) && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });
      const targetUserId = decodeURIComponent(pathname.split('/')[3]);
      if (!(await canAccessStudentAcademicData(targetUserId, authUser))) return sendJSON(403, { error: 'Access denied for this student academic record.' });
      const records = await userDb.listRecords('student_academics', { user_id: targetUserId }, { semester_number: 1, semester: 1 });
      return sendJSON(200, { user_id: targetUserId, records: records.map(record => normalizeAcademicRecord(record, targetUserId)) });
    }
    if (pathname === '/api/college/companies' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'college') return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      const persistedUsers = await userDb.getAllUsers();
      const registeredCompanies = persistedUsers
        .filter(user => user.role === 'company')
        .map(user => {
          const stateUser = state.users.find(item => item.id === user.id);
          const company = state.companies.find(item => item.companyId === (user.companyId || (stateUser && stateUser.companyId)));
          return {
            companyId: user.companyId || (stateUser && stateUser.companyId) || (company && company.companyId) || null,
            name: user.companyName || (stateUser && stateUser.companyName) || (company && company.name) || user.username,
            industry: (company && company.industry) || 'Industry partner',
            location: (company && company.location) || 'Location not provided',
            website: (company && company.website) || ''
          };
        });
      return sendJSON(200, registeredCompanies);
    }
    async function buildCollegeAnalytics(authUser) {
      const scope = await collegeScope(authUser);
      const profiles = await userDb.listStudentProfiles();
      const scopedProfiles = profiles.filter(profile => belongsToCollege(profile, scope, new Set()));
      const studentIds = new Set(scopedProfiles.map(profile => String(profile.user_id)));
      const collections = ['student_skills', 'applications', 'internships', 'student_placements',
        'campus_registrations', 'jobs'];
      const loaded = await Promise.all(collections.map(collection => userDb.listRecords(collection)));
      const scoped = loaded.map(items => items.filter(item => belongsToCollege(item, scope, studentIds)
        || studentIds.has(String(item.user_id || item.student_id || ''))));
      const [skills, applications, internships, placements, registrations, jobs] = scoped;
      const placedStatuses = new Set(['selected', 'offer', 'placed', 'hired', 'accepted']);
      const placedIds = new Set(applications.filter(item => placedStatuses.has(normalizeIdentity(item.status)))
        .map(item => String(item.student_id || item.user_id || '')));
      placements.forEach(item => { if (item.user_id || item.student_id) placedIds.add(String(item.user_id || item.student_id)); });
      const departments = {};
      scopedProfiles.forEach(profile => {
        const name = profile.department || 'Department not provided';
        departments[name] = departments[name] || { name, total: 0, placed: 0 };
        departments[name].total += 1;
        if (placedIds.has(String(profile.user_id))) departments[name].placed += 1;
      });
      const skillCounts = {};
      skills.forEach(item => {
        const name = String(item.skill_name || item.name || '').trim();
        if (name) skillCounts[name] = (skillCounts[name] || 0) + 1;
      });
      const demand = {};
      jobs.forEach(job => (Array.isArray(job.required_skills) ? job.required_skills : String(job.required_skills || '').split(','))
        .map(skill => String(skill).trim()).filter(Boolean).forEach(skill => { demand[skill] = (demand[skill] || 0) + 1; }));
      const topSkills = Object.entries(skillCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([skill, count]) => ({ skill, count }));
      const industryDemand = Object.entries(demand).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([skill, count]) => ({ skill, count }));
      const directory = scopedProfiles.map(profile => ({
        user_id: profile.user_id, name: profile.name || profile.username || 'Student',
        student_id: profile.student_id || '', department: profile.department || 'Not provided',
        college: profile.college || profile.institution || '',
        skills: skills.filter(item => String(item.user_id) === String(profile.user_id))
          .map(item => item.skill_name || item.name).filter(Boolean),
        internship_participation: internships.filter(item => String(item.user_id || item.student_id) === String(profile.user_id)).length,
        applications: applications.filter(item => String(item.user_id || item.student_id) === String(profile.user_id)).length,
        placed: placedIds.has(String(profile.user_id))
      }));
      return {
        total_students: scopedProfiles.length, students: scopedProfiles.length,
        placed_students: placedIds.size, placements: placements.length,
        applications: applications.length, internships: internships.length,
        skills: skills.length, campus_drives: registrations.length,
        placement_rate: scopedProfiles.length ? Number(((placedIds.size / scopedProfiles.length) * 100).toFixed(1)) : 0,
        department_stats: Object.values(departments).map(item => ({ ...item,
          percentage: item.total ? Number(((item.placed / item.total) * 100).toFixed(1)) : 0 })),
        topSkills, industry_demand: industryDemand,
        skill_gaps: industryDemand.filter(item => !skillCounts[item.skill]),
        readiness: { students_with_skills: new Set(skills.map(item => String(item.user_id))).size },
        partners: [...new Set(jobs.map(item => item.company_name || item.company || item.companyId).filter(Boolean))],
        campus_drives: registrations.length, student_directory: directory
      };
    }
    if (pathname === '/api/college/analytics' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'college') return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      return sendJSON(200, await buildCollegeAnalytics(authUser));
    }

    // Static Asset Server Fallback (Supports root & frontend directory)
    let filePath = path.join(repoRoot, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(repoRoot, 'frontend', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(repoRoot, 'frontend', 'index.html');

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };

    fs.readFile(filePath, (err, content) => {
      if (err) { res.writeHead(500); res.end('Server Error'); }
      else { res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' }); res.end(content); }
    });

  } catch (err) {
    sendJSON(500, { error: 'Internal Server Error', details: err.message });
  }
});

async function startServer() {
  try {
    console.log('Starting SkillBridge backend...');
    console.log(`Environment: ${process.env.NODE_ENV || 'production'}`);
    console.log(`PORT: ${port}`);
    console.log(`PostgreSQL URL configured: ${Boolean(process.env.DATABASE_URL)}`);

    await ensurePersistentUsersLoaded();
    await initializePersistentWorkflow();
    await academiaDb.init();

    const listener = server.listen(port, host, () => {
      console.log(`SkillBridge backend running on ${host}:${port}`);
      console.log('Server is listening...');
    });
    listener.on('error', error => {
      console.error('HTTP SERVER ERROR:', error && error.stack ? error.stack : error);
    });
  } catch (error) {
    console.error('=================================');
    console.error('SERVER STARTUP ERROR');
    console.error(error && error.stack ? error.stack : error);
    console.error('=================================');
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

const vercelHandler = (req, res) => server.emit('request', req, res);

module.exports = vercelHandler;
module.exports.startServer = startServer;
module.exports.server = server;

/* ==========================================================================
   SkillBridge — Unique Academia–Industry Engine & 3-Portal Backend API
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
const academiaDb = require('./academia-features');

const port = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 10000;
const host = process.env.HOST || '0.0.0.0';
const repoRoot = path.join(__dirname, '..');
const uploadsDir = process.env.VERCEL ? path.join('/tmp', 'skillbridge-uploads') : path.join(repoRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const JWT_SECRET = process.env.JWT_SECRET || 'skillbridge-unique-backend-secret-key-2026';

function normalizeIdentity(value) {
  return String(value ?? '').trim().toLowerCase();
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, salt, ...safeUser } = user;
  return safeUser;
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

// Authentication and student profiles are backed by MongoDB. The in-memory
// state remains the source for demo/catalog data, but never for credentials.
async function initializePersistentUsers() {
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
        logo: profile.logo || '🏢',
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
  const [jobs, applications, notifications, offers, skills, assessments, projects, certifications] = await Promise.all([
    userDb.listRecords('jobs', {}, { created_at: -1, id: -1 }),
    userDb.listRecords('applications', {}, { applied_at: -1, id: -1 }),
    userDb.listRecords('notifications', {}, { created_at: -1, id: -1 }),
    userDb.listRecords('offers', {}, { createdAt: -1, id: -1 }),
    userDb.listRecords('student_skills', {}, { created_at: -1, skill_name: 1 }),
    userDb.listRecords('assessments', {}, { updated_at: -1 }),
    userDb.listRecords('projects', {}, { created_at: -1, id: -1 }),
    userDb.listRecords('certifications', {}, { created_at: -1, id: -1 })
  ]);
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
      skillGaps.push({ skill: req, reqLevel: 'Advanced', studentLevel: 'Advanced', gap: 'No Gap — Qualified' });
    } else {
      skillGaps.push({ skill: req, reqLevel: 'Advanced', studentLevel: 'Not Found', gap: 'Missing Skill — Action Required' });
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
        detail: `${profile.department} student profile • CGPA ${profile.cgpa}`,
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
        detail: `${internship.role} • ${internship.summary}`,
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
  const pathname = parsedUrl.pathname;

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
    // ACADEMIA / FACULTY FEATURE APIs
    // ----------------------------------------------------
    const academiaMatch = pathname.match(/^\/api\/(academia|faculty)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (academiaMatch) {
      const [, , resourceName, itemId, operation] = academiaMatch;
      const resource = academiaDb.normalizeResource(resourceName);
      if (!academiaDb.RESOURCE_NAMES.includes(resource)) return sendJSON(404, { error: 'Academia resource not found.' });
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Authentication required.' });

      const managerRoles = ['company', 'faculty', 'college', 'admin', 'university_admin'];
      const participantRoles = ['student', 'faculty', 'college', 'admin', 'university_admin'];
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
        return item ? sendJSON(200, { success: true, item }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'register' && req.method === 'POST') {
        if (!participantRoles.includes(authUser.role)) return sendJSON(403, { error: 'Participant access required.' });
        const item = await academiaDb.register(resource, itemId, authUser, body);
        return item ? sendJSON(200, { success: true, item }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'status' && req.method === 'GET') {
        const item = await academiaDb.status(resource, itemId, authUser);
        return item ? sendJSON(200, item) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'status' && req.method === 'POST') {
        if (!managerRoles.includes(authUser.role)) return sendJSON(403, { error: 'Faculty or institutional access required.' });
        const item = await academiaDb.setStatus(resource, itemId, body.status, authUser);
        return item ? sendJSON(200, { success: true, item }) : sendJSON(404, { error: 'Academia item not found.' });
      }
      if (operation === 'feedback' && req.method === 'POST') {
        const item = await academiaDb.feedback(resource, itemId, authUser, body);
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
    // SYSTEM & HEALTH API ENDPOINTS
    // ----------------------------------------------------
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJSON(200, { status: 'UP & RUNNING', uptime_seconds: process.uptime(), memory: process.memoryUsage(), timestamp: new Date().toISOString() });
    }

    if (pathname === '/api/docs' && req.method === 'GET') {
      return sendJSON(200, {
        platform: 'SkillBridge Academia–Industry Collaboration Platform API',
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
        const newComp = { id: newId, companyId: assignedCompId, name: companyName, logo: '🏢', industry: 'Corporate Partner', manager_name: managerName || 'Recruitment Manager', min_cgpa: 7.0, min_ai_score: 70, required_skills: ['Java', 'SQL'] };
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
        const token = generateToken({ id: newUser.id, email: normalizedEmail, companyId: assignedCompId, role: 'company' });
        return sendJSON(201, { token, user: sanitizeUser(newUser), company: newComp });

      } else if (userRole === 'college') {
        if (!collegeName || !email || !password) return sendJSON(400, { error: 'University Name, Email, and Password required.' });
        const stored = await userDb.createUser({ email: normalizedEmail, username: normalizedUsername, passwordHash: hash, salt, role: 'college' });
        if (!stored) return sendJSON(500, { error: 'Unable to create account. Please try again.' });
        const newUser = { ...stored, collegeName, adminName: adminName || 'University Admin', password_hash: hash, salt };
        state.users.push(newUser);
        const token = generateToken({ id: newUser.id, email: normalizedEmail, role: 'college' });
        return sendJSON(201, { token, user: sanitizeUser(newUser) });

      } else if (userRole === 'faculty') {
        if (!fullName) return sendJSON(400, { error: 'Faculty name, email, and password required.' });
        const stored = await userDb.createUser({
          email: normalizedEmail,
          username: normalizedUsername,
          passwordHash: hash,
          salt,
          role: 'faculty'
        });
        if (!stored) return sendJSON(500, { error: 'Unable to create account. Please try again.' });
        const newUser = {
          ...stored,
          fullName,
          collegeName: collegeName || '',
          department: department || '',
          password_hash: hash,
          salt
        };
        state.users.push(newUser);
        const token = generateToken({ id: newUser.id, email: normalizedEmail, role: 'faculty' });
        return sendJSON(201, { token, user: sanitizeUser(newUser) });

      } else {
        const otpEntry = otpStore[normalizedEmail];
        if (!otpEntry || !otpEntry.verified || Date.now() > otpEntry.expiresAt) {
          return sendJSON(400, { error: 'Email verification is required before creating a student account.' });
        }

        const stored = await userDb.createUser({ email: normalizedEmail, username: normalizedUsername, passwordHash: hash, salt, role: 'student' });
        if (!stored) return sendJSON(500, { error: 'Unable to create account. Please try again.' });
        // Derive the human-readable student ID from MongoDB's persistent user
        // primary key so it cannot reset when the process restarts.
        const assignedStuId = `STU-2026-${String(stored.id).padStart(3, '0')}`;
        const newUser = { ...stored, student_id: assignedStuId, password_hash: hash, salt };
        state.users.push(newUser);
        const profile = { user_id: stored.id, name: fullName || '', email: normalizedEmail, phone: mobile || '', student_id: assignedStuId, college: '', department: '', cgpa: null };
        await userDb.createOrUpdateStudentProfile(stored.id, profile);
        state.studentProfiles[stored.id] = profile;
        delete otpStore[normalizedEmail];
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

      // Credentials must come from MongoDB so accounts remain usable after a
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

      const token = generateToken({ id: user.id, email: user.email, companyId: user.companyId, role: user.role });
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
      const [technicalSkills, projects, certificates, applications, jobs] = await Promise.all([
        userDb.listRecords('student_skills', { user_id: userId }),
        userDb.listRecords('projects', { user_id: userId }),
        userDb.listRecords('certifications', { user_id: userId }),
        userDb.listRecords('applications', { student_id: userId }),
        userDb.listRecords('jobs', {}, { created_at: -1, id: -1 })
      ]);
      const recommendedJobs = jobs.map(job => {
        const company = state.companies.find(item => item.companyId === job.companyId);
        if (!company) return null;
        const match = calculateCompanyMatch(userId, company);
        return { ...job, match_percentage: match.matchPercentage };
      }).filter(Boolean);

      return sendJSON(200, {
        profile,
        profileCompletion: { percentage: 80, missingItems: [] },
        technicalSkills: technicalSkills.length,
        projects: projects.length,
        certificates: certificates.length,
        applications: applications.length,
        skillScore: calculateSkillScore(userId),
        recommendedJobs
      });
    }
    if (pathname === '/api/student/profile' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const profile = await userDb.getStudentProfileByUserId(userId);
      if (!profile) return sendJSON(404, { error: 'Student profile not found.' });
      const resume = await userDb.getRecord('student_resumes', { user_id: userId });
      state.resumes[userId] = resume || state.resumes[userId] || null;
      return sendJSON(200, { profile: { ...profile, email: authUser.email }, completion: { percentage: 80, missingItems: [] }, resume: state.resumes[userId] || null });
    }
    if (pathname === '/api/student/resume' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const body = await parseJSON(req);
      if (!body.fileUrl && !body.resumeUrl) return sendJSON(400, { error: 'Resume file or URL is required.' });
      state.resumes[userId] = {
        file_name: body.fileName || 'Resume.pdf',
        file_url: body.fileUrl || body.resumeUrl,
        upload_date: new Date().toISOString().split('T')[0],
        status: 'Verified & Active',
        ats_analysis: body.atsAnalysis || null
      };
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
        userDb.listRecords('student_academics', { user_id: userId }, { semester: 1 }),
        userDb.getRecord('student_academic_summary', { user_id: userId })
      ]);
      const values = records.map(record => Number(record.gpa)).filter(Number.isFinite);
      return sendJSON(200, { cgpa: profile && profile.cgpa != null ? profile.cgpa : (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null), records, school: summary && summary.school, backlog: summary && summary.backlog });
    }
    if (pathname === '/api/student/academics' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const userId = authUser.id;
      const records = (body.semesterGpa || []).map((gpa, index) => ({ user_id: userId, semester: `Semester ${index + 1}`, gpa: gpa === null ? null : Number(gpa) })).filter(record => record.gpa !== null && Number.isFinite(record.gpa));
      await userDb.deleteRecords('student_academics', { user_id: userId });
      if (records.length) await Promise.all(records.map(record => userDb.insertRecord('student_academics', record)));
      const values = records.map(record => record.gpa);
      const cgpa = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      await userDb.updateRecord('student_academic_summary', { user_id: userId }, { $set: { user_id: userId, school: body.school || null, backlog: body.backlog || null, updated_at: new Date().toISOString() } }, { upsert: true });
      await userDb.createOrUpdateStudentProfile(userId, { cgpa });
      return sendJSON(200, { success: true, cgpa, records });
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
      const technical = await userDb.listRecords('student_skills', { user_id: userId }, { skill_name: 1 });
      return sendJSON(200, { technical, coding: state.codingSkills[userId] || null });
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
    if (pathname === '/api/student/portfolio' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      return sendJSON(200, { projects: await userDb.listRecords('projects', { user_id: userId }, { created_at: -1 }), internships: state.internships[userId] || [], certifications: await userDb.listRecords('certifications', { user_id: userId }, { created_at: -1 }), seminars: state.seminars[userId] || [], workshops: state.workshops[userId] || [], hackathons: state.hackathons[userId] || [], achievements: state.achievements[userId] || [] });
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
      const collections = ['student_profiles', 'student_academics', 'student_academic_summary', 'student_preferences', 'student_skills', 'student_resumes', 'certifications', 'student_placements', 'campus_registrations', 'user_settings'];
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

      return sendJSON(200, { company, total_jobs: compJobs.length, total_applicants: compApps.length, shortlisted: compApps.filter(a => a.status === 'Shortlisted' || a.status === 'Technical Interview').length, pipeline: compApps });
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

      const newJob = { id: await userDb.nextSequence('jobs', 'jobs'), company_id: comp.id, companyId: comp.companyId, company_name: comp.name, title: body.title, location: body.location || 'Remote', salary_stipend: body.salary_stipend || '₹ 12,00,000 P.A.', required_skills: (body.required_skills || 'Java,SQL').split(',').map(skill => skill.trim()).filter(Boolean), min_cgpa: Number(body.min_cgpa || 7.5), deadline: body.deadline || '2026-11-30' };
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
    if (pathname === '/api/college/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'college') return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      const profiles = Object.values(state.studentProfiles);
      const placedStatuses = new Set(['Selected', 'Offer', 'Placed']);
      const placedStudentIds = new Set(
        state.applications
          .filter(application => placedStatuses.has(application.status))
          .map(application => application.student_id)
      );
      const departments = {};
      profiles.forEach(profile => {
        const name = profile.department || 'Department not provided';
        departments[name] = departments[name] || { name, total: 0, placed: 0 };
        departments[name].total += 1;
        if (placedStudentIds.has(profile.user_id)) departments[name].placed += 1;
      });
      const departmentStats = Object.values(departments).map(department => ({
        ...department,
        percentage: department.total ? Number(((department.placed / department.total) * 100).toFixed(1)) : 0
      }));
      const totalStudents = profiles.length;
      const placedStudents = placedStudentIds.size;
      const recruiterNames = [...new Set(state.jobs.map(job => job.company_name).filter(Boolean))];
      return sendJSON(200, {
        total_students: totalStudents,
        placed_students: placedStudents,
        placement_rate: totalStudents ? Number(((placedStudents / totalStudents) * 100).toFixed(1)) : 0,
        top_recruiters: recruiterNames,
        department_stats: departmentStats,
        skill_signals: []
      });
    }
    if (pathname === '/api/college/students' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'college') return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      return sendJSON(200, Object.values(state.studentProfiles));
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
    console.log(`MongoDB URI configured: ${Boolean(process.env.MONGODB_URI || process.env.MONGODB_URL)}`);

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

module.exports = server;
module.exports.startServer = startServer;

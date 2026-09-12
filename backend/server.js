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
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');
const { URL } = require('url');
const { generateAICareerAdvice } = require('./ai_engine');
const { 
  getAIContextByRole, 
  generateGreeting, 
  getSuggestedQuestions, 
  getAssistantTitle,
  getSystemPrompt,
  canAccessData,
  getTerminology
} = require('./ai-contexts');
const { getNavigationByRole, getGroupedNavigationByRole } = require('./role-navigation');
const { 
  calculateStudentJobMatch, 
  findMatchingStudentsForJob, 
  isStudentEligibleForJob,
  findEligibleJobsForStudent,
  generateNotificationListForJob
} = require('./talent-finder');

// Environment Setup
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  try {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const separator = trimmed.indexOf('=');
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim();
        if (key && !process.env[key]) process.env[key] = value;
      }
    });
  } catch (e) {}
}

const port = Number(process.env.PORT) || 3000;
const repoRoot = path.resolve(__dirname, '..');
const uploadsDir = path.join(repoRoot, 'uploads');
if (require.main === module && !fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const stateFile = path.join(__dirname, 'skillbridge-state.json');
const mongoUri = String(process.env.MONGODB_URI || '').trim();
const mongoDatabaseName = process.env.MONGODB_DATABASE || 'skillbridge';
const mongoStateCollectionName = process.env.MONGODB_STATE_COLLECTION || 'application_state';
let mongoStateCollection = null;
let mongoInitialization = null;

const JWT_SECRET = process.env.JWT_SECRET || 'skillbridge-unique-backend-secret-key-2026';

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
let counters = { company: 10002, student: 0, job: 101, app: 901, cert: 401 };
function nextCompanyId() { return `CMP-${++counters.company}`; }
function nextStudentId() { return `SB${new Date().getFullYear()}ST${String(++counters.student).padStart(3, '0')}`; }
function nextJobId() { return ++counters.job; }
function nextAppId() { return ++counters.app; }
function normalizeSkillName(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ''); }

const otpStore = {};

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail(email, code) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpUser || !smtpPass) {
    console.log(`[DEV OTP] ${email} => ${code}`);
    return { simulated: true };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: smtpUser, pass: smtpPass }
  });

  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'SkillBridge <noreply@skillbridge.local>',
    to: email,
    subject: 'SkillBridge OTP Verification',
    text: `Your SkillBridge OTP is ${code}. It is valid for 3 minutes.`
  });
}

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
  preferences: {},
  settings: {},
  certificates: {},
  projects: {},
  placements: {},
  campusDrives: [
    {
      id: 1,
      company: 'TechCorp Solutions',
      title: 'Campus Software Developer Drive',
      role: 'Software Developer',
      date: '2026-10-15',
      deadline: '2026-10-05',
      location: 'Anna University Campus',
      salary: '₹ 8 LPA',
      minimumCGPA: 7.5,
      department: 'Computer Science & Engineering',
      degree: 'B.E./B.Tech',
      requiredSkills: [{ skillName: 'Java', minimumPercentage: 80 }, { skillName: 'Communication', minimumPercentage: 70 }]
    }
  ],
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

function normalizeIdentity(value) {
  return String(value ?? '').trim().toLowerCase();
}

async function initializeMongoState() {
  if (!mongoUri) return;
  if (mongoInitialization) return mongoInitialization;

  mongoInitialization = (async () => {
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const database = client.db(mongoDatabaseName);
    mongoStateCollection = database.collection(mongoStateCollectionName);
    const saved = await mongoStateCollection.findOne({ _id: 'skillbridge-state' });

    if (saved && saved.state) {
      state = { ...state, ...saved.state };
      counters = { ...counters, ...(saved.counters || {}) };
    } else {
      await mongoStateCollection.replaceOne(
        { _id: 'skillbridge-state' },
        {
        _id: 'skillbridge-state',
        state,
        counters,
        updatedAt: new Date()
        },
        { upsert: true }
      );
    }

    state.users = Array.isArray(state.users) ? state.users : [];
    state.studentProfiles = state.studentProfiles || {};
    if (!Array.isArray(state.campusDrives)) state.campusDrives = [];
  })().catch(error => {
    mongoInitialization = null;
    mongoStateCollection = null;
    throw new Error(`MongoDB initialization failed: ${error.message}`);
  });

  return mongoInitialization;
}

async function persistState() {
  if (mongoUri) {
    await initializeMongoState();
    await mongoStateCollection.replaceOne(
      { _id: 'skillbridge-state' },
      { _id: 'skillbridge-state', state, counters, updatedAt: new Date() },
      { upsert: true }
    );
    return;
  }

  try {
    fs.writeFileSync(stateFile, JSON.stringify({ state, counters }, null, 2));
  } catch (error) {
    console.error('State persistence failed:', error.message);
  }
}

function restoreState() {
  try {
    if (!fs.existsSync(stateFile)) return;
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (saved.state) state = { ...state, ...saved.state };
    if (saved.counters) counters = { ...counters, ...saved.counters };
    state.users = Array.isArray(state.users) ? state.users : [];
    state.studentProfiles = state.studentProfiles || {};
    if (!Array.isArray(state.campusDrives)) state.campusDrives = [];
    Object.keys(state.certifications || {}).forEach(studentId => {
      const legacy = state.certifications[studentId] || [];
      const current = state.certificates[studentId] || [];
      if (!current.length && legacy.length) state.certificates[studentId] = legacy.map(cert => ({
        ...cert,
        certificateName: cert.certificateName || cert.name,
        issuer: cert.issuer || cert.organization,
        issueDate: cert.issueDate || cert.issue_date,
        credentialId: cert.credentialId || cert.credential_id,
        certificateUrl: cert.certificateUrl || cert.verification_url || ''
      }));
    });
  } catch (error) { console.error('State restore failed:', error.message); }
}

// Seed Unique Initial Data
function ensureDemoUsers() {
  const student = state.users.find(u => u.role === 'student' && (normalizeIdentity(u.email) === 'arjun@skillbridge.ai' || normalizeIdentity(u.username || '') === 'arjun_sharma'));
  if (!student) {
    const studentPwd = hashPassword('Student@123');
    state.users.push({ id: 1, email: 'arjun@skillbridge.ai', username: 'arjun_sharma', student_id: 'STU-2026-101', password_hash: studentPwd.hash, salt: studentPwd.salt, role: 'student' });
  }

  if (!state.studentProfiles[1]) {
    state.studentProfiles[1] = {
      user_id: 1,
      name: 'Arjun Sharma',
      email: 'arjun@skillbridge.ai',
      phone: '+91 9876543210',
      student_id: 'STU-2026-101',
      college: 'Anna University',
      department: 'Computer Science & Engineering',
      year: '4th Year',
      semester: '7th Semester',
      cgpa: 8.8,
      linkedin_url: 'https://linkedin.com/in/arjun-sharma-2026',
      github_url: 'https://github.com/arjun-sharma',
      portfolio_url: 'https://arjunsharma.dev'
    };
  }

  const company = state.users.find(u => u.role === 'company' && normalizeIdentity(u.companyId || '') === 'cmp-10001');
  if (!company) {
    const compPwd = hashPassword('Company@123');
    state.users.push({ id: 2, email: 'recruiter@techcorp.com', username: 'techcorp_mgr', companyName: 'TechCorp Solutions', companyId: 'CMP-10001', password_hash: compPwd.hash, salt: compPwd.salt, role: 'company' });
  }

  const college = state.users.find(u => u.role === 'college' && normalizeIdentity(u.email) === 'admin@annauniv.edu');
  if (!college) {
    const collegePwd = hashPassword('College@123');
    state.users.push({ id: 3, email: 'admin@annauniv.edu', username: 'anna_univ_admin', collegeName: 'Anna University', password_hash: collegePwd.hash, salt: collegePwd.salt, role: 'college' });
  }
}

function seedData() {
  state.users = state.users || [];
  ensureDemoUsers();

  state.studentProfiles[1] = {
    user_id: 1,
    name: 'Arjun Sharma',
    email: 'arjun@skillbridge.ai',
    phone: '+91 9876543210',
    student_id: 'STU-2026-101',
    college: 'Anna University',
    department: 'Computer Science & Engineering',
    year: '4th Year',
    semester: '7th Semester',
    cgpa: 8.8,
    linkedin_url: 'https://linkedin.com/in/arjun-sharma-2026',
    github_url: 'https://github.com/arjun-sharma',
    portfolio_url: 'https://arjunsharma.dev'
  };

  state.resumes[1] = { file_name: 'Arjun_Sharma_Software_Engineer.pdf', upload_date: '2026-08-20', file_url: '/uploads/Arjun_Sharma_Resume.pdf', status: 'Verified & Active' };
  state.academicRecords[1] = [
    { id: 1, semester: 'Semester 1', gpa: 8.2, status: 'Completed', details: 'Engineering Fundamentals' },
    { id: 2, semester: 'Semester 2', gpa: 8.5, status: 'Completed', details: 'C Programming & Mathematics' },
    { id: 3, semester: 'Semester 3', gpa: 8.9, status: 'Completed', details: 'Data Structures & Algorithms' },
    { id: 4, semester: 'Semester 4', gpa: 9.1, status: 'Completed', details: 'Database Management Systems' },
    { id: 5, semester: 'Semester 5', gpa: 8.8, status: 'Completed', details: 'Operating Systems & Networks' },
    { id: 6, semester: 'Semester 6', gpa: 9.0, status: 'Completed', details: 'Cloud Computing & Software Engg' }
  ];
  state.schoolEducation[1] = { tenth_school: 'St. John Higher Secondary', tenth_board: 'State Board', tenth_percentage: 94.5, tenth_year: 2020, twelfth_school: 'St. John Higher Secondary', twelfth_board: 'State Board', twelfth_percentage: 92.8, twelfth_year: 2022 };
  state.backlogs[1] = { current_backlogs: 0, history_backlogs: 0, status: 'Clean Academic Record (No Backlogs)' };
  
  state.userSkills[1] = [
    { id: 1, skill_name: 'Java', category: 'Backend Development', proficiency: 'Advanced', level_pct: 90 },
    { id: 2, skill_name: 'Python', category: 'Data & AI', proficiency: 'Advanced', level_pct: 88 },
    { id: 3, skill_name: 'React.js', category: 'Frontend UI', proficiency: 'Advanced', level_pct: 85 },
    { id: 4, skill_name: 'SQL / PostgreSQL', category: 'Database', proficiency: 'Expert', level_pct: 92 },
    { id: 5, skill_name: 'Docker', category: 'DevOps', proficiency: 'Intermediate', level_pct: 75 },
    { id: 6, skill_name: 'AWS', category: 'Cloud Infrastructure', proficiency: 'Intermediate', level_pct: 72 }
  ];
  state.codingSkills[1] = { problem_solving: 88, data_structures: 85, leetcode_handle: 'arjun_sharma_2026', hackerrank_handle: 'arjun_code', problems_solved: 340 };
  
  state.assessments[1] = {
    overall_score: 82,
    breakdown: { technical: 85, coding: 80, communication: 78, soft_skills: 84 },
    tests: [
      { id: 1, name: 'Core Software Engineering Test', type: 'Technical Core', score: 85, total: 100, status: 'Passed', details: 'High proficiency in Java, OOP, and Relational Databases.' },
      { id: 2, name: 'Algorithmic Problem Solving Test', type: 'DSA & Logic', score: 80, total: 100, status: 'Passed', details: 'Strong performance in Dynamic Programming and Graph Algorithms.' },
      { id: 3, name: 'Professional Communication Test', type: 'Soft Skills', score: 78, total: 100, status: 'Passed', details: 'Good spoken clarity and interview presentation skills.' }
    ]
  };

  state.projects[1] = [
    { id: 201, title: 'SkillBridge Academia–Industry Platform', description: 'Multi-tenant collaboration ecosystem connecting students with recruiters and university admins.', technologies: ['React', 'Node.js', 'REST API', 'CSS Glassmorphism'], github_url: 'https://github.com/EswaraKaruppasamy211/Skillmap', live_url: 'http://localhost:3000' }
  ];
  state.internships[1] = [
    { id: 301, company: 'TechCorp Solutions', role: 'Software Engineering Intern', start_date: '2025-05-01', end_date: '2025-07-31', company_score: '9.4 / 10', summary: 'Developed RESTful microservices and optimized database queries.' }
  ];
  state.certifications[1] = [
    { id: 401, name: 'AWS Certified Solutions Architect – Associate', organization: 'Amazon Web Services', credential_id: 'AWS-ASA-994821', verification_url: 'https://aws.amazon.com/verify/AWS-ASA-994821', issue_date: '2025-10-15' }
  ];
  state.seminars[1] = [{ id: 501, title: 'Cloud-Native Architecture Trends', institution: 'IIT Madras Technology Summit', date: '2025-11-12' }];
  state.workshops[1] = [{ id: 601, name: 'Enterprise Docker & Kubernetes Bootcamp', organization: 'DevOps Community India', date: '2026-01-20' }];
  state.hackathons[1] = [{ id: 701, name: 'Smart India Hackathon (SIH 2025)', organization: 'Ministry of Education', result: '1st Runner Up (National Finale)' }];
  state.achievements[1] = [{ id: 801, title: 'University Academic Excellence Award', organization: 'Anna University', date: '2025-09-05' }];

  state.companies = [
    {
      id: 1,
      companyId: 'CMP-10001',
      name: 'TechCorp Solutions',
      logo: '🏢',
      industry: 'Software & Cloud Technology',
      manager_name: 'Vikram Malhotra',
      manager_desig: 'Head of Talent Acquisition',
      min_cgpa: 7.5,
      min_ai_score: 75,
      required_skills: ['Java', 'Python', 'SQL', 'React'],
      preferred_skills: ['AWS', 'Docker'],
      coding_level: 'Advanced',
      certs: ['AWS Certified Solutions Architect']
    },
    {
      id: 2,
      companyId: 'CMP-10002',
      name: 'DataSoft Systems',
      logo: '📊',
      industry: 'AI & Data Science Solutions',
      manager_name: 'Ananya Roy',
      manager_desig: 'Senior Technical Recruiter',
      min_cgpa: 8.0,
      min_ai_score: 80,
      required_skills: ['Python', 'SQL', 'Data Structures', 'Machine Learning'],
      preferred_skills: ['TensorFlow', 'PyTorch'],
      coding_level: 'Advanced',
      certs: ['Data Science Professional']
    }
  ];

  state.jobs = [
    {
      id: 101,
      company_id: 1,
      companyId: 'CMP-10001',
      company_name: 'TechCorp Solutions',
      title: 'Full-Stack Software Engineer',
      description: 'Design and build high-scalability web portals, REST microservices, and modern UI components.',
      location: 'Bengaluru / Hybrid',
      job_type: 'Full-Time',
      salary_stipend: '₹ 12,00,000 P.A.',
      required_skills: ['Java', 'Python', 'React', 'SQL'],
      preferred_skills: ['AWS', 'Docker'],
      min_cgpa: 7.5,
      min_ai_score: 75,
      deadline: '2026-10-30'
    }
  ];

  state.applications = [
    {
      id: 901,
      student_id: 1,
      job_id: 101,
      companyId: 'CMP-10001',
      company_name: 'TechCorp Solutions',
      job_title: 'Full-Stack Software Engineer',
      candidate_name: 'Arjun Sharma',
      cgpa: 8.8,
      applied_at: '2026-08-20',
      status: 'Technical Interview',
      last_updated: '2026-08-24',
      next_step: 'Technical Interview round scheduled.',
      interview: { date: '2026-08-28', time: '11:00 AM IST', mode: 'Google Meet Video', meeting_link: 'https://meet.google.com/abc-defg-hij' }
    }
  ];

  state.notifications[1] = [
    { id: 1001, title: 'Interview Scheduled 🎉', message: 'TechCorp Solutions scheduled your Technical Interview for Aug 28, 2026.', type: 'interview', is_read: false, created_at: '2026-08-24' }
  ];
}

seedData();
restoreState();
ensureDemoUsers();

// Unique AI Employability Skill Score Engine
function calculateSkillScore(studentId) {
  const profile = state.studentProfiles[studentId || 1] || {};
  const skills = state.userSkills[studentId || 1] || [];
  const certs = state.certificates[studentId || 1] || [];
  const projects = state.projects[studentId || 1] || [];
  const backlog = state.backlogs[studentId || 1] || {};

  let score = 0;
  const cgpa = Number(profile.cgpa || 8.0);
  score += Math.min(40, (cgpa / 10) * 40);

  let skillPoints = skills.reduce((acc, s) => {
    const percentage = Number(s.level_pct ?? s.proficiencyPercentage);
    if (Number.isFinite(percentage)) return acc + (percentage / 100) * 5;
    const proficiency = String(s.proficiency || '').toLowerCase();
    if (proficiency.includes('expert')) return acc + 6;
    if (proficiency.includes('advanced')) return acc + 5;
    if (proficiency.includes('intermediate')) return acc + 3;
    return acc + 2;
  }, 0);
  score += Math.min(30, skillPoints);

  score += Math.min(15, certs.length * 7.5);

  score += Math.min(15, projects.length * 5);

  if (backlog.current_backlogs > 0) score -= (backlog.current_backlogs * 10);

  return Math.max(0, Math.min(100, Math.round(score)));
}

// Unique Company-Student Eligibility & Match Engine
function calculateCompanyMatch(studentId, company) {
  const profile = state.studentProfiles[studentId || 1] || {};
  const skills = state.userSkills[studentId || 1] || [];
  const studentSkills = skills.reduce((map, skill) => { map[normalizeSkillName(skill.skill_name || skill.skillName)] = Number(skill.level_pct || 0); return map; }, {});
  const reqSkills = company.required_skills || [];

  let matchedSkills = 0;
  let skillGaps = [];

  reqSkills.forEach(req => {
    const requiredName = normalizeSkillName(req);
    const foundEntry = Object.entries(studentSkills).find(([name]) => name.includes(requiredName) || requiredName.includes(name));
    const found = Boolean(foundEntry && foundEntry[1] >= 70);
    if (found) {
      matchedSkills++;
      skillGaps.push({ skill: req, required: 70, student: foundEntry[1], result: 'Match', reqLevel: '70%', studentLevel: `${foundEntry[1]}%`, gap: 'No Gap - Qualified' });
    } else {
      skillGaps.push({ skill: req, required: 70, student: foundEntry ? foundEntry[1] : 0, result: 'Gap', reqLevel: '70%', studentLevel: foundEntry ? `${foundEntry[1]}%` : 'Not Found', gap: 'Missing Skill - Action Required' });
    }
  });

  const skillMatchPct = reqSkills.length > 0 ? (matchedSkills / reqSkills.length) * 100 : 100;
  const cgpaMatch = (Number(profile.cgpa || 8.8) >= Number(company.min_cgpa || 7.5)) ? 100 : 50;
  const overallMatchPct = Math.round((skillMatchPct * 0.7) + (cgpaMatch * 0.3));

  return {
    companyId: company.companyId,
    companyName: company.name,
    matchPercentage: overallMatchPct,
    skillGaps,
    strengths: skillGaps.filter(item => item.result === 'Match').map(item => `${item.skill} meets the required proficiency.`),
    skillGapsList: skillGaps.filter(item => item.result === 'Gap').map(item => `${item.skill} needs at least 70% proficiency.`),
    recommendationLevel: overallMatchPct >= 90 ? 'Excellent Match' : overallMatchPct >= 75 ? 'Strong Match' : overallMatchPct >= 60 ? 'Good Match' : overallMatchPct >= 40 ? 'Partial Match' : 'Low Match',
    nonGuarantee: 'Your profile appears to be a match based on the available requirements; this does not guarantee selection.',
    isEligible: matchedSkills === reqSkills.length && Number(profile.cgpa || 0) >= Number(company.min_cgpa || 0),
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

// HTTP SERVER ENGINE
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
  const pathname = parsedUrl.pathname;

  const sendJSON = async (statusCode, data) => {
    try {
      await persistState();
    } catch (error) {
      console.error('Persistent storage request failed:', error.message);
      statusCode = 503;
      data = { error: 'Persistent storage is unavailable. Please try again shortly.' };
    }
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
    await initializeMongoState();

    // ----------------------------------------------------
    // SYSTEM & HEALTH API ENDPOINTS
    // ----------------------------------------------------
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJSON(200, {
        status: 'UP & RUNNING',
        storage: mongoUri ? 'mongodb' : 'local-json',
        uptime_seconds: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      });
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
      if (!email || !String(email).trim()) return sendJSON(400, { error: 'Email is required.' });
      const normalizedEmail = String(email).trim().toLowerCase();
      const existing = otpStore[normalizedEmail];
      const now = Date.now();
      if (existing && (now - existing.createdAt) < 30000) {
        return sendJSON(429, { error: 'Please wait 30 seconds before requesting a new OTP.' });
      }
      const code = generateOtpCode();
      otpStore[normalizedEmail] = { code, createdAt: now, expiresAt: now + 180000, verified: false };
      await sendOtpEmail(normalizedEmail, code);
      return sendJSON(200, {
        success: true,
        message: 'OTP sent to your email.',
        expiresInSeconds: 180,
        devCode: code
      });
    }

    if (pathname === '/api/auth/verify-otp' && req.method === 'POST') {
      const { email, otp } = await parseJSON(req);
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const targetOtp = String(otp || '').trim();
      const entry = otpStore[normalizedEmail];
      if (!entry) return sendJSON(400, { error: 'OTP has not been requested for this email.' });
      if (Date.now() > entry.expiresAt) {
        delete otpStore[normalizedEmail];
        return sendJSON(400, { error: 'OTP expired. Please request a new one.' });
      }
      if (targetOtp !== entry.code) return sendJSON(400, { error: 'Invalid OTP.' });
      otpStore[normalizedEmail] = { ...entry, verified: true, verifiedAt: Date.now() };
      return sendJSON(200, { success: true, message: 'Email verified successfully.' });
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const { fullName, username, email, mobile, companyName, managerName, collegeName, adminName, role, password, confirmPassword } = await parseJSON(req);
      const userRole = role || 'student';
      const newId = Date.now();
      const effectiveConfirmPassword = typeof confirmPassword === 'undefined' ? password : confirmPassword;
      if (!password || password.length < 8) return sendJSON(400, { error: 'Password must be at least 8 characters.' });
      if (password !== effectiveConfirmPassword) return sendJSON(400, { error: 'Passwords do not match' });

      if (userRole === 'company') {
        if (!companyName || !email || !password) return sendJSON(400, { error: 'Company Name, Email, and Password required.' });
        const normalizedEmail = normalizeIdentity(email);
        const normalizedCompany = normalizeIdentity(companyName);
        if (state.users.some(user => user.role === 'company' && (
          normalizeIdentity(user.email) === normalizedEmail ||
          normalizeIdentity(user.companyName || '') === normalizedCompany
        ))) {
          return sendJSON(409, { error: 'A company account with this email or company name already exists. Use the login form.' });
        }
        const assignedCompId = nextCompanyId();
        const newComp = { id: newId, companyId: assignedCompId, name: companyName, logo: '🏢', industry: 'Corporate Partner', manager_name: managerName || 'Recruitment Manager', min_cgpa: 7.0, min_ai_score: 70, required_skills: ['Java', 'SQL'] };
        state.companies.push(newComp);

        const credentials = hashPassword(password);
        const newUser = { id: newId, email: normalizedEmail, username: normalizedEmail.split('@')[0], companyName, companyId: assignedCompId, password_hash: credentials.hash, salt: credentials.salt, role: 'company' };
        state.users.push(newUser);
        const token = generateToken({ id: newUser.id, email: normalizedEmail, companyId: assignedCompId, role: 'company' });
        return sendJSON(201, { token, user: newUser, company: newComp });

      } else if (userRole === 'college') {
        if (!collegeName || !email || !password) return sendJSON(400, { error: 'University Name, Email, and Password required.' });
        const credentials = hashPassword(password);
        const safeEmail = normalizeIdentity(email);
        const newUser = { id: newId, email: safeEmail, username: safeEmail.split('@')[0], collegeName, adminName: adminName || 'University Admin', password_hash: credentials.hash, salt: credentials.salt, role: 'college' };
        state.users.push(newUser);
        const token = generateToken({ id: newUser.id, email: safeEmail, role: 'college' });
        return sendJSON(201, { token, user: newUser });

      } else {
        if (!fullName || !username || !email || !mobile) return sendJSON(400, { error: 'Full name, username, email, and mobile number are required.' });
        const normalizedEmail = normalizeIdentity(email);
        const normalizedUsername = normalizeIdentity(username);
        if (state.users.some(u => normalizeIdentity(u.email) === normalizedEmail || normalizeIdentity(u.username) === normalizedUsername)) return sendJSON(409, { error: 'Username or email is already registered.' });
        const emailKey = normalizedEmail;
        const otpEntry = otpStore[emailKey];
        if (!otpEntry || !otpEntry.verified || Date.now() > otpEntry.expiresAt) {
          return sendJSON(400, { error: 'Email verification is required before creating a student account.' });
        }
        const assignedStuId = nextStudentId();
        const { salt, hash } = hashPassword(password);
        const newUser = { id: newId, email: normalizedEmail, username: normalizedUsername, student_id: assignedStuId, password_hash: hash, salt, role: 'student' };
        state.users.push(newUser);
        state.studentProfiles[newId] = { user_id: newId, name: fullName, email: normalizedEmail, phone: mobile, student_id: assignedStuId, onboarding_complete: false };
        delete otpStore[emailKey];
        const token = generateToken({ id: newUser.id, email: normalizedEmail, role: 'student' });
        return sendJSON(201, { token, user: newUser, profile: state.studentProfiles[newId], studentId: assignedStuId });
      }
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const { identity, companyName, password, role } = await parseJSON(req);
      const userRole = role || 'student';
      const normalizedIdentity = normalizeIdentity(identity);
      const normalizedCompanyName = normalizeIdentity(companyName);
      let user = null;

      if (userRole === 'company') {
        const companyUsers = state.users.filter(u => u.role === 'company');
        const identityMatches = companyUsers.filter(u => [
          normalizeIdentity(u.email),
          normalizeIdentity(u.username || ''),
          normalizeIdentity(u.companyId || ''),
          normalizeIdentity(u.companyName || '')
        ].includes(normalizedIdentity));
        const companyMatches = companyUsers.filter(u => [
          normalizeIdentity(u.companyName || ''),
          normalizeIdentity(u.companyId || '')
        ].includes(normalizedCompanyName));

        // A registered email/username/company ID is the primary identity.
        // The company-name field is optional context and must not reject a valid account.
        user = identityMatches.length === 1
          ? identityMatches[0]
          : companyMatches.length === 1 && !normalizedIdentity
            ? companyMatches[0]
            : companyMatches.find(candidate => identityMatches.includes(candidate)) || null;
        if (!user) {
          return sendJSON(401, {
            error: mongoUri
              ? 'Company account not found in the deployed database. Register this company on the deployed application first, then log in with the same email and password.'
              : 'Company account not found in the local database. Register this company on localhost:3000 first, then log in with the same email and password.'
          });
        }

      } else if (userRole === 'college') {
        user = state.users.find(u => u.role === 'college' && (
          normalizeIdentity(u.email) === normalizedIdentity ||
          normalizeIdentity(u.username || '') === normalizedIdentity
        ));
        if (!user && (normalizedIdentity === 'anna_univ_admin' || normalizedIdentity === 'admin@annauniv.edu')) user = state.users.find(u => u.role === 'college');

      } else {
        user = state.users.find(u => u.role === 'student' && (
          normalizeIdentity(u.email) === normalizedIdentity ||
          normalizeIdentity(u.student_id || '') === normalizedIdentity ||
          normalizeIdentity(u.username || '') === normalizedIdentity
        ));
      }

      if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
        return sendJSON(401, { error: `Invalid ${userRole.toUpperCase()} credentials.` });
      }

      const token = generateToken({ id: user.id, email: user.email, companyId: user.companyId, role: user.role });
      return sendJSON(200, { token, user, profile: state.studentProfiles[user.id] || state.studentProfiles[1] });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser) return sendJSON(401, { error: 'Not authenticated' });
      return sendJSON(200, { user: authUser, profile: state.studentProfiles[authUser.id] || state.studentProfiles[1] });
    }

    // ----------------------------------------------------
    // STUDENT MODULE APIs
    // ----------------------------------------------------
      const requireStudent = () => {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'student') return null;
      return authUser;
    };
    const calculateCGPA = records => {
      const completed = (records || []).filter(record => record.gpa !== '' && record.gpa !== null && record.gpa !== undefined && Number.isFinite(Number(record.gpa)));
      return completed.length ? Number((completed.reduce((sum, record) => sum + Number(record.gpa), 0) / completed.length).toFixed(2)) : null;
    };
      const getStudentSettings = studentId => ({
        jobNotifications: true,
        internshipNotifications: true,
        campusDriveNotifications: true,
        applicationNotifications: true,
        interviewNotifications: true,
        placementNotifications: true,
        profileVisibility: 'public',
        recruiterDiscovery: true,
        showSkills: true,
        showAcademicInfo: true,
        showContactInfo: false,
        theme: 'system',
        ...(state.settings[studentId] || {})
      });
      const calculateProfileCompletion = studentId => {
        const profile = state.studentProfiles[studentId] || {};
        const academics = state.academicRecords[studentId] || [];
        const skills = state.userSkills[studentId] || [];
        const certs = state.certificates[studentId] || [];
        const projects = state.projects[studentId] || [];
        const prefs = state.preferences[studentId] || {};
        const requiredFields = [
          profile.name, profile.phone, profile.college, profile.university, profile.department, profile.degree,
          profile.currentYear, profile.currentSemester, profile.graduationYear,
          profile.dateOfBirth, profile.gender, profile.email,
          profile.address && (profile.address.doorHouse || profile.address.street || profile.address.city || profile.address.state),
          profile.linkedin_url, profile.github_url, profile.portfolio_url,
          (state.resumes[studentId] || profile.resume_url),
          academics.some(r => Number.isFinite(Number(r.gpa))),
          skills.length > 0,
          prefs.jobRoles && prefs.jobRoles.length,
          certs.length,
          projects.length
        ];
        const completed = requiredFields.filter(Boolean).length;
        const total = requiredFields.length;
        const percentage = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
        return { percentage, completed, total };
      };

      const getStudentSkillSet = studentId => (state.userSkills[studentId] || []).map(skill => ({
        name: String(skill.skill_name || skill.skillName || '').trim(),
        percentage: Number(skill.level_pct ?? skill.proficiencyPercentage ?? skill.proficiency ?? 0),
        category: skill.category || 'Other',
        id: skill.id || Date.now() + Math.random()
      })).filter(skill => skill.name);

      const buildSkillAnalysis = studentId => {
        const skills = getStudentSkillSet(studentId);
        const projects = state.projects[studentId] || [];
        const certificates = state.certificates[studentId] || [];
        const internships = state.internships[studentId] || [];
        const resume = state.resumes[studentId];
        const assessment = state.assessments[studentId] || {};
        const overall = Number(assessment.overall_score || 0);

        const skillAnalysis = skills.map(skill => {
          const evidence = [];
          const projectMentions = projects.filter(project => {
            const techText = (project.technologies || '').toString().toLowerCase();
            return techText.includes(skill.name.toLowerCase());
          }).length;
          if (projectMentions) evidence.push(`${projectMentions} project${projectMentions > 1 ? 's' : ''} using ${skill.name}`);

          if (certificates.some(c => String(c.certificateName || c.name || '').toLowerCase().includes(skill.name.toLowerCase()) || String(c.relatedSkill || '').toLowerCase().includes(skill.name.toLowerCase()))) {
            evidence.push('Certificate evidence');
          }
          if (internships.some(i => String(i.technologies || '').toLowerCase().includes(skill.name.toLowerCase()) || String(i.role || '').toLowerCase().includes(skill.name.toLowerCase()))) {
            evidence.push('Internship usage');
          }
          if (resume) evidence.push('Resume mentions the skill');
          if (Number.isFinite(overall) && overall > 0) evidence.push(`Assessment score ${overall}/100`);

          const score = Math.min(100, Math.max(0, Math.round(skill.percentage * 0.55 + (projectMentions * 8) + (certificates.length ? 6 : 0) + (internships.length ? 8 : 0) + (resume ? 8 : 0) + (overall ? overall * 0.12 : 0))));
          const confidence = score >= 80 ? 'High' : score >= 60 ? 'Medium' : 'Low';
          const strengths = [];
          if (skill.percentage >= 80) strengths.push('Strong practical confidence');
          if (projectMentions) strengths.push('Applied in projects');
          if (internships.length) strengths.push('Internship exposure');
          const weakAreas = [];
          if (score < 70) weakAreas.push('Need deeper practical exercises');
          if (!projectMentions) weakAreas.push('Add a project using this skill');
          if (!certificates.length && !internships.length) weakAreas.push('Add evidence via certification or internship');
          const recommendations = [];
          if (score < 75) recommendations.push(`Practice advanced ${skill.name} use cases`);
          if (score >= 75 && score < 90) recommendations.push(`Build a portfolio project around ${skill.name}`);
          if (score >= 90) recommendations.push(`Mentor others and document advanced use cases`);

          return {
            skillName: skill.name,
            category: skill.category,
            score,
            confidence,
            evidence: evidence.length ? evidence : ['Insufficient evidence — complete an assessment or add projects/certificates.'],
            strengths: strengths.length ? strengths : ['Current skill baseline recorded'],
            weakAreas: weakAreas.length ? weakAreas : ['No immediate gap detected'],
            recommendations: recommendations.length ? recommendations : ['Maintain current learning momentum']
          };
        });

        const overallScore = skills.length ? Math.round(skillAnalysis.reduce((sum, item) => sum + item.score, 0) / skillAnalysis.length) : 0;
        return {
          overallScore,
          confidence: overallScore >= 80 ? 'High' : overallScore >= 60 ? 'Medium' : 'Low',
          skills: skillAnalysis,
          targetRole: 'Full Stack Developer',
          factors: {
            assessment: Number(assessment.overall_score || 0),
            projects: projects.length * 10,
            certificates: Math.min(100, certificates.length * 20),
            internships: Math.min(100, internships.length * 25),
            resume: resume ? 80 : 50,
            selfRating: skills.length ? Math.round(skills.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / skills.length) : 0
          }
        };
      };

      const buildCareerRecommendations = studentId => {
        const skills = getStudentSkillSet(studentId);
        const skillNames = skills.map(skill => skill.name);
        const roles = [
          { name: 'Full Stack Developer', target: ['JavaScript', 'React', 'Java', 'SQL', 'Node.js'], match: 0 },
          { name: 'Frontend Developer', target: ['React', 'JavaScript', 'HTML', 'CSS', 'UI/UX'], match: 0 },
          { name: 'Backend Developer', target: ['Java', 'Python', 'SQL', 'REST API', 'Spring'], match: 0 },
          { name: 'Data Analyst', target: ['SQL', 'Python', 'Excel', 'Tableau', 'Analytics'], match: 0 }
        ];

        roles.forEach(role => {
          const hits = role.target.filter(target => skillNames.some(skill => skill.toLowerCase().includes(target.toLowerCase()) || target.toLowerCase().includes(skill.toLowerCase())));
          const missing = role.target.filter(target => !hits.includes(target));
          role.match = Math.min(98, Math.max(45, Math.round((hits.length / role.target.length) * 100)));
          role.matchingSkills = hits.slice(0, 4);
          role.missingSkills = missing.slice(0, 4);
          role.recommendedImprovements = missing.slice(0, 3);
        });

        return roles.sort((a, b) => b.match - a.match).slice(0, 4);
      };

      if (pathname === '/api/student/profile' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
        const profile = state.studentProfiles[authUser.id] || { user_id: authUser.id, student_id: authUser.student_id, onboarding_complete: false };
      const academics = state.academicRecords[authUser.id] || [];
      const skills = state.userSkills[authUser.id] || [];
        const certs = state.certificates[authUser.id] || [];
        const projects = state.projects[authUser.id] || [];
        const prefs = state.preferences[authUser.id] || {};
        const completion = calculateProfileCompletion(authUser.id);
        const missingItems = [];
        if (!profile.name || !profile.phone || !profile.dateOfBirth || !profile.gender) missingItems.push('personal details');
        if (!profile.college || !profile.university || !profile.department || !profile.degree || !profile.graduationYear) missingItems.push('college details');
        if (!(profile.address && (profile.address.city || profile.address.state || profile.address.pincode))) missingItems.push('address');
        if (!academics.some(record => Number.isFinite(Number(record.gpa)))) missingItems.push('semester GPA');
        if (!skills.length) missingItems.push('skills');
        if (!(prefs.jobRoles && prefs.jobRoles.length) || !(prefs.opportunityTypes && prefs.opportunityTypes.length)) missingItems.push('career preferences');
        if (!(profile.resume_url || state.resumes[authUser.id])) missingItems.push('resume');
        if (!(profile.linkedin_url || profile.github_url || profile.portfolio_url)) missingItems.push('professional links');
        if (!certs.length) missingItems.push('certificates');
        if (!projects.length) missingItems.push('projects');
        return sendJSON(200, {
          profile,
          completion: { ...completion, missingItems },
          resume: state.resumes[authUser.id] || null,
          skills,
          certificates: certs,
          projects,
          preferences: prefs,
          settings: getStudentSettings(authUser.id)
        });
      }
    if (pathname === '/api/student/dashboard' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const profile = state.studentProfiles[userId] || {};
      const completion = calculateProfileCompletion(userId);
      const analysis = buildSkillAnalysis(userId);
      const applications = state.applications.filter(application => application.student_id === userId);
      const recommendedJobs = state.jobs.slice(0, 3).map(job => {
        const company = state.companies.find(item => item.companyId === job.companyId) || state.companies[0];
        const match = calculateCompanyMatch(userId, company);
        return { ...job, company_name: company.name, match_percentage: match.matchPercentage, is_eligible: match.isEligible };
      });
      return sendJSON(200, {
        profile,
        profileCompletion: { ...completion, missingItems: completion.missingItems || [] },
        placementReadiness: {
          score: calculateSkillScore(userId),
          strongest: 'Technical Skills',
          weakest: 'Interview Practice',
          actions: ['Add one more project', 'Take a skill assessment', 'Improve resume keywords']
        },
        skillScore: calculateSkillScore(userId),
        resumeScore: state.resumes[userId] ? 82 : 54,
        certificates: state.certificates[userId]?.length || 0,
        projects: state.projects[userId]?.length || 0,
        internships: state.internships[userId]?.length || 0,
        applications: applications.length,
        technicalSkills: (state.userSkills[userId] || []).length,
        recommendedJobs,
        careerRecommendations: buildCareerRecommendations(userId)
      });
    }
    if (pathname === '/api/ai/skill-analysis' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, buildSkillAnalysis(authUser.id));
    }
    if (pathname === '/api/ai/skill-gap' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const targetSkills = ['JavaScript', 'React', 'Node.js', 'REST API', 'Testing', 'Docker'];
      const current = getStudentSkillSet(authUser.id).map(skill => skill.name);
      const strong = current.filter(skill => targetSkills.some(target => skill.toLowerCase().includes(target.toLowerCase()))).slice(0, 5);
      const missing = targetSkills.filter(target => !current.some(skill => skill.toLowerCase().includes(target.toLowerCase())));
      const needsImprovement = current.filter(skill => !strong.includes(skill)).slice(0, 5);
      return sendJSON(200, {
        targetRole: 'Full Stack Developer',
        strong,
        needsImprovement,
        missing,
        recommendedLearningPath: ['Advanced React', 'Node.js', 'REST APIs', 'Authentication', 'Testing', 'Docker']
      });
    }
    if (pathname === '/api/ai/career-recommendation' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { roles: buildCareerRecommendations(authUser.id) });
    }
    if (pathname === '/api/ai/chat' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const message = String(body.message || '').toLowerCase();
      const analysis = buildSkillAnalysis(authUser.id);
      const skills = getStudentSkillSet(authUser.id).map(skill => skill.name).join(', ') || 'No skills added yet';
      if (message.includes('skill') && message.includes('learn')) {
        return sendJSON(200, { reply: `Based on your current profile, focus on ${analysis.skills.slice(0, 3).map(item => item.skillName).join(', ')} and add projects in Node.js, REST APIs, and testing to improve your placement readiness.` });
      }
      if (message.includes('python')) {
        const pythonSkill = analysis.skills.find(item => item.skillName.toLowerCase().includes('python'));
        return sendJSON(200, { reply: pythonSkill ? `Your Python score is ${pythonSkill.score}/100 with ${pythonSkill.confidence.toLowerCase()} confidence. Evidence: ${pythonSkill.evidence.join(', ')}.` : 'Python is not yet part of your saved skill set. Add it and complete a project to improve your score.' });
      }
      if (message.includes('resume')) {
        return sendJSON(200, { reply: `Your resume is ${state.resumes[authUser.id] ? 'uploaded and active' : 'missing'}; add measurable project outcomes and job-relevant keywords like Java, SQL, React, and REST API.` });
      }
      return sendJSON(200, { reply: `Your current skill profile includes: ${skills}. Focus on practical projects, assessments, and certificate evidence to strengthen your placement profile.` });
    }
    if (pathname === '/api/student/profile' && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const body = await parseJSON(req);
      state.studentProfiles[userId] = { ...(state.studentProfiles[userId] || {}), ...body };
      if (body.resume_url) state.studentProfiles[userId].resume_url = body.resume_url;
      if (body.resume) state.resumes[userId] = { ...state.resumes[userId], ...body.resume };
      return sendJSON(200, { success: true, profile: state.studentProfiles[userId], resume: state.resumes[userId] || null });
    }
    if (pathname === '/api/student/resume' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { resume: state.resumes[authUser.id] || null, resumeUrl: state.studentProfiles[authUser.id]?.resume_url || '' });
    }
    if (pathname === '/api/student/resume' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const resumeUrl = String(body.resumeUrl || body.fileUrl || '').trim();
      const resumeName = String(body.resumeName || body.fileName || 'Resume.pdf').trim();
      if (!resumeUrl) return sendJSON(400, { error: 'Resume URL or file is required.' });
      const resume = {
        file_name: resumeName,
        upload_date: new Date().toISOString().slice(0, 10),
        file_url: resumeUrl,
        status: 'Verified & Active'
      };
      state.resumes[authUser.id] = resume;
      state.studentProfiles[authUser.id] = { ...(state.studentProfiles[authUser.id] || {}), resume_url: resumeUrl };
      return sendJSON(201, { success: true, resume });
    }
    if (pathname === '/api/student/onboarding' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req); const userId = authUser.id;
      const profileFields = body.profile || {};
      state.studentProfiles[userId] = { ...(state.studentProfiles[userId] || {}), ...profileFields, user_id: userId, student_id: authUser.student_id };
      if (body.school) state.schoolEducation[userId] = { ...(state.schoolEducation[userId] || {}), ...body.school };
      if (body.backlog) state.backlogs[userId] = { ...(state.backlogs[userId] || {}), ...body.backlog };
      const gpaValues = Array.isArray(body.semesterGpa) ? body.semesterGpa : [];
      state.academicRecords[userId] = gpaValues.map((gpa, index) => ({ id: `${userId}-${index + 1}`, semester: `Semester ${index + 1}`, gpa: gpa === '' || gpa === null ? null : Number(gpa), status: gpa === '' || gpa === null ? 'Not Completed' : 'Completed' })).filter(record => record.gpa !== null || record.semester);
      state.studentProfiles[userId].cgpa = calculateCGPA(state.academicRecords[userId]);
      state.userSkills[userId] = [];
      for (const skill of (body.skills || [])) {
        const name = String(skill.skillName || '').trim(); const level = Number(skill.proficiencyPercentage);
        if (name && Number.isFinite(level) && level >= 0 && level <= 100) {
          const existing = (state.userSkills[userId] || []).find(item => item.skill_name.toLowerCase() === name.toLowerCase());
          if (existing) existing.level_pct = level;
          else state.userSkills[userId].push({ id: Date.now() + state.userSkills[userId].length, skill_name: name, category: skill.category || 'Other', level_pct: level, scoreOutOfTen: Number((level / 10).toFixed(1)) });
        }
      }
      state.preferences[userId] = { jobRoles: body.preferences?.jobRoles || [], industries: body.preferences?.industries || [], locations: body.preferences?.locations || [], opportunityTypes: body.preferences?.opportunityTypes || [] };
      state.studentProfiles[userId].onboarding_complete = true;
      state.settings[userId] = { ...(state.settings[userId] || {}), jobNotifications: true, internshipNotifications: true, campusDriveNotifications: true, applicationNotifications: true, interviewNotifications: true, placementNotifications: true, profileVisibility: 'public', recruiterDiscovery: true, showSkills: true, showAcademicInfo: true, showContactInfo: false, theme: 'system' };
      return sendJSON(200, { success: true, profile: state.studentProfiles[userId], cgpa: state.studentProfiles[userId].cgpa });
    }
    if (pathname === '/api/student/academics' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const records = state.academicRecords[userId] || [];
      return sendJSON(200, { cgpa: calculateCGPA(records), records, school: state.schoolEducation[userId] || {}, backlog: state.backlogs[userId] || {} });
    }
    if ((pathname === '/api/student/academics' && req.method === 'PUT') || pathname === '/api/student/semester-gpa' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req); const userId = authUser.id;
      if (pathname === '/api/student/semester-gpa') {
        const semester = Number(body.semester); const gpa = Number(body.gpa);
        if (!Number.isInteger(semester) || semester < 1 || semester > 8 || !Number.isFinite(gpa) || gpa < 0 || gpa > 10) return sendJSON(400, { error: 'Semester must be 1-8 and GPA must be between 0 and 10.' });
        const records = state.academicRecords[userId] || [];
        const existing = records.find(record => Number(record.semester) === semester || record.semester === `Semester ${semester}`);
        if (existing) existing.gpa = gpa; else records.push({ id: Date.now(), semester: `Semester ${semester}`, gpa, status: 'Completed' });
        state.academicRecords[userId] = records;
      } else {
        if (Array.isArray(body.semesterGpa)) {
          state.academicRecords[userId] = body.semesterGpa.map((gpa, index) => ({ id: `${userId}-${index + 1}`, semester: `Semester ${index + 1}`, gpa: gpa === '' || gpa === null ? null : Number(gpa), status: gpa === '' || gpa === null ? 'Not Completed' : 'Completed' }));
        }
        state.schoolEducation[userId] = { ...(state.schoolEducation[userId] || {}), ...(body.school || {}) };
        state.backlogs[userId] = { ...(state.backlogs[userId] || {}), ...(body.backlog || {}) };
      }
      const records = state.academicRecords[userId] || [];
      state.studentProfiles[userId] = { ...(state.studentProfiles[userId] || {}), cgpa: calculateCGPA(records) };
      return sendJSON(200, { success: true, cgpa: calculateCGPA(records), records });
    }
    if (pathname === '/api/student/skills' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const skills = (state.userSkills[authUser.id] || []).map(skill => ({
        ...skill,
        skillName: skill.skill_name || skill.skillName,
        scoreOutOfTen: Number((Number(skill.level_pct || 0) / 10).toFixed(1)),
        proficiencyPercentage: Number(skill.level_pct || 0)
      }));
      return sendJSON(200, { technical: skills, coding: state.codingSkills[authUser.id] || {} });
    }
    if (pathname === '/api/student/skills' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req); const skillName = String(body.skillName || body.skill_name || '').trim(); const level = Number(body.proficiencyPercentage ?? body.proficiency ?? body.level_pct ?? 0);
      if (!skillName || !Number.isFinite(level) || level < 0 || level > 100) return sendJSON(400, { error: 'Skill name and proficiency from 0 to 100 are required.' });
      const skills = Array.isArray(state.userSkills[authUser.id]) ? state.userSkills[authUser.id] : [];
      const existing = skills.find(skill => normalizeSkillName(skill.skill_name || skill.skillName) === normalizeSkillName(skillName));
      if (existing) {
        existing.level_pct = level;
        existing.scoreOutOfTen = Number((level / 10).toFixed(1));
        existing.category = body.category || existing.category || 'Other';
        existing.skill_name = existing.skill_name || skillName;
        return sendJSON(200, { success: true, message: 'Skill already exists. Updated successfully.', skills, duplicate: true });
      }
      const newSkill = { id: Date.now(), skill_name: skillName, category: body.category || 'Other', level_pct: level, scoreOutOfTen: Number((level / 10).toFixed(1)) };
      skills.push(newSkill);
      state.userSkills[authUser.id] = skills;
      return sendJSON(201, { success: true, skills, duplicate: false });
    }
    if (pathname.match(/^\/api\/student\/skills\/\d+$/) && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const skill = (state.userSkills[authUser.id] || []).find(item => item.id === Number(pathname.split('/').pop()));
      if (!skill) return sendJSON(404, { error: 'Skill not found.' });
      const body = await parseJSON(req); const level = Number(body.proficiencyPercentage ?? body.proficiency ?? body.level_pct ?? skill.level_pct);
      if (!Number.isFinite(level) || level < 0 || level > 100) return sendJSON(400, { error: 'Proficiency must be between 0 and 100.' });
      skill.level_pct = level; skill.scoreOutOfTen = Number((level / 10).toFixed(1));
      return sendJSON(200, { success: true, skill: { ...skill, scoreOutOfTen: skill.scoreOutOfTen } });
    }
    if (pathname.match(/^\/api\/student\/skills\/\d+$/) && req.method === 'DELETE') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const skills = state.userSkills[authUser.id] || []; state.userSkills[authUser.id] = skills.filter(skill => skill.id !== Number(pathname.split('/').pop()));
      return sendJSON(200, { success: true });
    }
    if (pathname === '/api/student/preferences' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { preferences: state.preferences[authUser.id] || { jobRoles: [], industries: [], locations: [], opportunityTypes: [] } });
    }
    if (pathname === '/api/student/preferences' && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      state.preferences[authUser.id] = { jobRoles: body.jobRoles || [], industries: body.industries || [], locations: body.locations || [], opportunityTypes: body.opportunityTypes || [] };
      return sendJSON(200, { success: true, preferences: state.preferences[authUser.id] });
    }
    if (pathname === '/api/student/settings' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { settings: getStudentSettings(authUser.id), user: { username: authUser.username, email: authUser.email, mobile: state.studentProfiles[authUser.id]?.phone || '', studentId: authUser.student_id || state.studentProfiles[authUser.id]?.student_id } });
    }
    if (pathname === '/api/student/settings' && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      state.settings[authUser.id] = { ...getStudentSettings(authUser.id), ...body };
      return sendJSON(200, { success: true, settings: getStudentSettings(authUser.id) });
    }
    if (pathname === '/api/student/change-password' && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      const confirmPassword = String(body.confirmPassword || '');
      if (!verifyPassword(currentPassword, authUser.salt, authUser.password_hash)) return sendJSON(400, { error: 'Current password is incorrect.' });
      if (newPassword.length < 8) return sendJSON(400, { error: 'New password must be at least 8 characters.' });
      if (newPassword !== confirmPassword) return sendJSON(400, { error: 'New password and confirmation do not match.' });
      const credentials = hashPassword(newPassword);
      const userIndex = state.users.findIndex(user => user.id === authUser.id);
      if (userIndex !== -1) {
        state.users[userIndex].password_hash = credentials.hash;
        state.users[userIndex].salt = credentials.salt;
      }
      return sendJSON(200, { success: true, message: 'Password updated successfully.' });
    }
    if (pathname === '/api/student/account' && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const email = String(body.email || authUser.email).trim();
      const username = String(body.username || authUser.username).trim();
      const mobile = String(body.mobile || state.studentProfiles[authUser.id]?.phone || '').trim();
      if (email && state.users.some(user => user.id !== authUser.id && user.email.toLowerCase() === email.toLowerCase())) return sendJSON(409, { error: 'Email already in use.' });
      if (username && state.users.some(user => user.id !== authUser.id && user.username.toLowerCase() === username.toLowerCase())) return sendJSON(409, { error: 'Username already in use.' });
      const userIndex = state.users.findIndex(user => user.id === authUser.id);
      if (userIndex !== -1) {
        state.users[userIndex].email = email;
        state.users[userIndex].username = username;
      }
      state.studentProfiles[authUser.id] = { ...(state.studentProfiles[authUser.id] || {}), email, phone: mobile, name: state.studentProfiles[authUser.id]?.name || authUser.username };
      return sendJSON(200, { success: true, user: { ...state.users[userIndex], email, username }, profile: state.studentProfiles[authUser.id] });
    }
    if (pathname === '/api/student/account' && req.method === 'DELETE') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      state.users = state.users.filter(user => user.id !== userId);
      state.applications = state.applications.filter(application => application.student_id !== userId);
      ['studentProfiles', 'resumes', 'academicRecords', 'schoolEducation', 'backlogs', 'userSkills', 'codingSkills', 'assessments', 'projects', 'internships', 'certifications', 'seminars', 'workshops', 'hackathons', 'achievements', 'notifications', 'preferences', 'settings', 'certificates', 'placements'].forEach(collection => { if (state[collection]) delete state[collection][userId]; });
      (state.campusDrives || []).forEach(drive => { drive.registrations = (drive.registrations || []).filter(studentId => studentId !== userId); });
      return sendJSON(200, { success: true, message: 'Student account and associated data deleted.' });
    }
    if (pathname === '/api/student/placement' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { placement: state.placements[authUser.id] || null });
    }
    if (pathname === '/api/student/placement' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      if (!body.companyName || !body.role) return sendJSON(400, { error: 'Company name and role are required.' });
      state.placements[authUser.id] = { id: Date.now(), studentId: authUser.id, ...body, updatedAt: new Date().toISOString() };
      return sendJSON(201, { success: true, placement: state.placements[authUser.id] });
    }
    if (pathname === '/api/student/placement' && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      if (!state.placements[authUser.id]) return sendJSON(404, { error: 'Placement record not found.' });
      state.placements[authUser.id] = { ...state.placements[authUser.id], ...(await parseJSON(req)), updatedAt: new Date().toISOString() };
      return sendJSON(200, { success: true, placement: state.placements[authUser.id] });
    }
    if (pathname === '/api/student/certificates' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { certificates: state.certificates[authUser.id] || [] });
    }
    if (pathname === '/api/student/certificates' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const certificate = {
        id: Date.now(),
        studentId: authUser.id,
        certificateName: body.certificateName || body.name || 'Certificate',
        issuer: body.issuer || 'Unknown',
        issueDate: body.issueDate || new Date().toISOString().slice(0, 10),
        credentialId: body.credentialId || '',
        certificateUrl: body.certificateUrl || '',
        fileUrl: body.fileUrl || '',
        fileType: body.fileType || '',
        relatedSkill: body.relatedSkill || '',
        description: body.description || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (!certificate.fileUrl && !certificate.certificateUrl && !certificate.credentialUrl) return sendJSON(400, { error: 'Certificate file or URL is required.' });
      const list = state.certificates[authUser.id] || [];
      list.push(certificate);
      state.certificates[authUser.id] = list;
      return sendJSON(201, { success: true, certificate });
    }
    if (pathname.startsWith('/api/student/certificates/') && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const id = Number(pathname.split('/').pop());
      const certs = state.certificates[authUser.id] || [];
      const cert = certs.find(item => item.id === id);
      if (!cert) return sendJSON(404, { error: 'Certificate not found.' });
      const body = await parseJSON(req);
      Object.assign(cert, body, { updatedAt: new Date().toISOString() });
      return sendJSON(200, { success: true, certificate: cert });
    }
    if (pathname.startsWith('/api/student/certificates/') && req.method === 'DELETE') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const id = Number(pathname.split('/').pop());
      const certs = state.certificates[authUser.id] || [];
      const next = certs.filter(item => item.id !== id);
      state.certificates[authUser.id] = next;
      return sendJSON(200, { success: true, certificates: next });
    }
    if (pathname === '/api/student/projects' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { projects: state.projects[authUser.id] || [] });
    }
    if (pathname === '/api/student/projects' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      const project = {
        id: Date.now(),
        studentId: authUser.id,
        title: body.title || 'Untitled Project',
        description: body.description || '',
        problemStatement: body.problemStatement || '',
        category: body.category || 'Other',
        technologies: body.technologies || '',
        githubUrl: body.githubUrl || body.github_url || '',
        liveDemoUrl: body.liveDemoUrl || body.live_url || '',
        projectUrl: body.projectUrl || body.project_url || '',
        role: body.role || '',
        teamSize: body.teamSize || '',
        startDate: body.startDate || '',
        endDate: body.endDate || '',
        status: body.status || 'Completed',
        imageUrl: body.imageUrl || '',
        outcome: body.outcome || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const list = state.projects[authUser.id] || [];
      list.push(project);
      state.projects[authUser.id] = list;
      return sendJSON(201, { success: true, project });
    }
    if (pathname.startsWith('/api/student/projects/') && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const id = Number(pathname.split('/').pop());
      const projects = state.projects[authUser.id] || [];
      const project = projects.find(item => item.id === id);
      if (!project) return sendJSON(404, { error: 'Project not found.' });
      const body = await parseJSON(req);
      Object.assign(project, body, { updatedAt: new Date().toISOString() });
      return sendJSON(200, { success: true, project });
    }
    if (pathname.startsWith('/api/student/projects/') && req.method === 'DELETE') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const id = Number(pathname.split('/').pop());
      const projects = state.projects[authUser.id] || [];
      const next = projects.filter(item => item.id !== id);
      state.projects[authUser.id] = next;
      return sendJSON(200, { success: true, projects: next });
    }
    if (pathname === '/api/student/assessments' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      const computedScore = calculateSkillScore(userId);
      return sendJSON(200, { ...(state.assessments[userId] || state.assessments[1]), overall_score: computedScore });
    }
    if (pathname === '/api/student/portfolio' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      return sendJSON(200, { projects: state.projects[userId] || [], internships: state.internships[userId] || [], certificates: state.certificates[userId] || [], achievements: state.achievements[userId] || [], seminars: state.seminars[userId] || [], workshops: state.workshops[userId] || [], hackathons: state.hackathons[userId] || [] });
    }
    if ((pathname === '/api/opportunities' || pathname === '/api/student/jobs') && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      return sendJSON(200, state.jobs.map(j => {
        const comp = state.companies.find(c => c.companyId === j.companyId) || state.companies[0];
        const match = calculateCompanyMatch(userId, comp);
        return { ...j, match_percentage: match.matchPercentage, is_eligible: match.isEligible };
      }));
    }
    if (pathname === '/api/student/skill-map' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const skillMap = state.jobs.map(job => {
        const company = state.companies.find(item => item.companyId === job.companyId) || {};
        const match = calculateCompanyMatch(userId, { ...company, required_skills: job.required_skills || company.required_skills || [], min_cgpa: job.min_cgpa ?? company.min_cgpa });
        return { jobId: job.id, jobTitle: job.title, companyName: job.company_name || company.name || 'Company', location: job.location || '', jobType: job.job_type || '', matchPercentage: match.matchPercentage, recommendationLevel: match.recommendationLevel, strengths: match.strengths, skillGaps: match.skillGapsList, requirements: match.skillGaps, eligible: match.isEligible };
      }).sort((a, b) => b.matchPercentage - a.matchPercentage);
      return sendJSON(200, { companies: [...new Set(skillMap.map(item => item.companyName))], jobs: skillMap });
    }

    // Talent Finder - Get matched jobs for current student
    if (pathname === '/api/talent-finder/matched-jobs' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      
      const userId = authUser.id;
      const profile = state.studentProfiles[userId] || {};
      const studentSkills = state.userSkills[userId] || [];
      
      // Convert skills to format expected by matcher
      const skillsForMatcher = studentSkills.map(s => ({
        name: s.skill_name,
        level_pct: Number(s.level_pct || 0)
      }));

      const matchedJobs = findEligibleJobsForStudent(profile, state.jobs, skillsForMatcher);
      
      return sendJSON(200, {
        totalMatches: matchedJobs.length,
        matches: matchedJobs.map(m => ({
          jobId: m.jobId,
          title: m.title,
          company: m.company,
          matchPercentage: m.match.matchPercentage,
          recommendationLevel: m.match.recommendationLevel,
          strengths: m.match.strengths,
          skillGaps: m.match.skillGaps
        }))
      });
    }

    // Talent Finder - Get matched students for a company's job
    if (pathname.match(/^\/api\/talent-finder\/job\/\d+\/candidates$/) && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      
      const jobId = Number(pathname.split('/')[4]);
      const job = state.jobs.find(j => j.id === jobId && j.companyId === authUser.companyId);
      if (!job) return sendJSON(404, { error: 'Job not found.' });

      // Get all students
      const students = state.users
        .filter(u => u.role === 'student')
        .map(u => ({
          id: u.id,
          student_id: u.student_id,
          ...state.studentProfiles[u.id]
        }))
        .filter(s => s.id); // Only include those with profiles

      // Convert job requirements to matcher format
      const jobForMatcher = {
        required_skills: job.required_skills || [],
        min_cgpa: job.min_cgpa,
        department: job.department,
        graduation_year: job.graduation_year
      };

      // Find matching students
      const matchingStudents = findMatchingStudentsForJob(jobForMatcher, students, state.userSkills);

      // Filter by privacy settings
      const filteredMatches = matchingStudents
        .map(m => {
          const privacySettings = state.settings[m.studentId] || {};
          if (privacySettings.profileVisibility === 'private' || privacySettings.recruiterDiscovery === false) {
            return null;
          }
          return {
            studentId: m.studentId,
            name: m.name,
            department: m.department,
            cgpa: privacySettings.showAcademicInfo !== false ? m.cgpa : null,
            matchPercentage: m.match.matchPercentage,
            recommendationLevel: m.match.recommendationLevel,
            strengths: m.match.strengths,
            skillGaps: m.match.skillGaps,
            matched: m.match.matched
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.matchPercentage - a.matchPercentage);

      return sendJSON(200, {
        job,
        totalCandidates: filteredMatches.length,
        candidates: filteredMatches.slice(0, 50) // Limit to top 50
      });
    }

    // Talent Finder - Check if student is eligible for a specific job
    if (pathname.match(/^\/api\/talent-finder\/job\/\d+\/eligible$/) && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });

      const jobId = Number(pathname.split('/')[4]);
      const job = state.jobs.find(j => j.id === jobId);
      if (!job) return sendJSON(404, { error: 'Job not found.' });

      const profile = state.studentProfiles[authUser.id] || {};
      const studentSkills = state.userSkills[authUser.id] || [];

      const eligible = isStudentEligibleForJob(profile, job, studentSkills);

      return sendJSON(200, { 
        eligible,
        jobId,
        message: eligible ? 'You are eligible for this job!' : 'You do not meet all the requirements for this job.'
      });
    }

    if (pathname.match(/^\/api\/student\/jobs\/\d+$/) && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const job = state.jobs.find(item => item.id === Number(pathname.split('/').pop()));
      if (!job) return sendJSON(404, { error: 'Job not found.' });
      const company = state.companies.find(item => item.companyId === job.companyId) || state.companies[0];
      const match = calculateCompanyMatch(authUser.id, company);
      return sendJSON(200, { ...job, ...match, eligibility: match.isEligible });
    }
    if (pathname === '/api/student/apply' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const userId = authUser.id;
      const { jobId } = await parseJSON(req);
      const targetJob = state.jobs.find(j => j.id === Number(jobId)) || state.jobs[0];
      const company = state.companies.find(item => item.companyId === targetJob.companyId) || state.companies[0];
      const match = calculateCompanyMatch(userId, company);
      if (!match.isEligible) return sendJSON(403, { error: 'You do not meet this opportunity\'s eligibility requirements.' });
      if (state.applications.some(application => application.student_id === userId && application.job_id === targetJob.id)) return sendJSON(409, { error: 'You have already applied for this opportunity.' });
      const profile = state.studentProfiles[userId] || {};
      const newApp = { id: nextAppId(), student_id: userId, job_id: targetJob.id, companyId: targetJob.companyId || 'CMP-10001', company_name: targetJob.company_name, job_title: targetJob.title, candidate_name: profile.name || 'Student', cgpa: profile.cgpa, match_percentage: match.matchPercentage, applied_at: new Date().toISOString().split('T')[0], status: 'Applied', last_updated: new Date().toISOString().split('T')[0], next_step: 'Application under recruiter review.' };
      state.applications.unshift(newApp);
      return sendJSON(201, { success: true, application: newApp });
    }
    if (pathname === '/api/student/applications' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, state.applications.filter(application => application.student_id === authUser.id));
    }
    if (pathname === '/api/student/notifications' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const notifications = state.notifications[authUser.id] || [];
      return sendJSON(200, notifications);
    }
    if (pathname.match(/^\/api\/student\/notifications\/\d+\/read$/) && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const notification = (state.notifications[authUser.id] || []).find(item => item.id === Number(pathname.split('/')[4]));
      if (!notification) return sendJSON(404, { error: 'Notification not found.' });
      notification.is_read = true;
      return sendJSON(200, { success: true, notification });
    }
    if (pathname === '/api/student/cgpa' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, { cgpa: calculateCGPA(state.academicRecords[authUser.id] || []) });
    }
    if (pathname === '/api/student/matches' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      return sendJSON(200, state.jobs.map(job => {
        const company = state.companies.find(item => item.companyId === job.companyId) || state.companies[0];
        const match = calculateCompanyMatch(authUser.id, company);
        return { job, ...match, eligibility: match.isEligible };
      }));
    }
    if (pathname.match(/^\/api\/student\/campus-drives\/\d+$/) && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const drive = (state.campusDrives || []).find(item => item.id === Number(pathname.split('/').pop()));
      if (!drive) return sendJSON(404, { error: 'Campus drive not found.' });
      return sendJSON(200, drive);
    }
    if (pathname === '/api/student/campus-drives' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const profile = state.studentProfiles[authUser.id] || {};
      const skills = state.userSkills[authUser.id] || [];
      const drives = (state.campusDrives || []).map(drive => {
        const reasons = [];
        if (drive.minimumCGPA && (profile.cgpa === null || Number(profile.cgpa || 0) < drive.minimumCGPA)) reasons.push(`CGPA must be at least ${drive.minimumCGPA}`);
        if (drive.department && profile.department && drive.department.toLowerCase() !== profile.department.toLowerCase()) reasons.push('Department does not match');
        const missingSkills = (drive.requiredSkills || []).filter(required => !skills.some(skill => skill.skill_name.toLowerCase() === required.skillName.toLowerCase() && Number(skill.level_pct) >= Number(required.minimumPercentage)));
        if (missingSkills.length) reasons.push(`Required skills: ${missingSkills.map(skill => skill.skillName).join(', ')}`);
        return { ...drive, eligible: reasons.length === 0, reason: reasons.join('; ') || 'You meet all eligibility requirements.', registered: Boolean(drive.registrations?.includes(authUser.id)) };
      });
      return sendJSON(200, drives);
    }
    if (pathname.match(/^\/api\/student\/campus-drives\/\d+\/register$/) && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const drive = (state.campusDrives || []).find(item => item.id === Number(pathname.split('/')[4]));
      if (!drive) return sendJSON(404, { error: 'Campus drive not found.' });
      const profile = state.studentProfiles[authUser.id] || {};
      if (Number(profile.cgpa || 0) < Number(drive.minimumCGPA || 0)) return sendJSON(403, { error: 'You are not eligible for this drive.' });
      drive.registrations = Array.from(new Set([...(drive.registrations || []), authUser.id]));
      if (!state.applications) state.applications = [];
      const existingApp = state.applications.find(a => a.studentId === authUser.id && a.driveId === drive.id);
      if (!existingApp) {
        state.applications.push({
          id: Date.now(),
          studentId: authUser.id,
          company: drive.company,
          role: drive.role,
          driveId: drive.id,
          appliedDate: new Date().toISOString(),
          status: 'Applied',
          matchScore: 75 + Math.random() * 25
        });
      }
      persistState();
      return sendJSON(200, { success: true, registered: true });
    }

    // APPLICATIONS MANAGEMENT
    if (pathname === '/api/student/applications' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const applications = (state.applications || []).filter(app => app.studentId === authUser.id).map(app => ({
        id: app.id,
        company: app.company,
        role: app.role,
        appliedDate: app.appliedDate,
        status: app.status,
        matchScore: app.matchScore,
        statusBadgeColor: app.status === 'Selected' ? '#10b981' : app.status === 'Rejected' ? '#ef4444' : app.status === 'Shortlisted' ? '#3b82f6' : app.status === 'Interview' ? '#f59e0b' : '#6b7280'
      }));
      return sendJSON(200, applications);
    }

    // CAMPUS DRIVE CREATION & MANAGEMENT (COMPANY)
    if (pathname === '/api/company/campus-drives' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const body = await parseJSON(req);
      if (!state.campusDrives) state.campusDrives = [];
      const company = state.companies.find(c => c.companyId === authUser.companyId);
      const newDrive = {
        id: Math.max(...state.campusDrives.map(d => d.id || 0), 0) + 1,
        company: company?.name || authUser.companyName,
        companyId: authUser.companyId,
        title: body.title || `Campus Drive - ${new Date().getFullYear()}`,
        role: body.role || 'Software Developer',
        date: body.date,
        deadline: body.deadline,
        location: body.location || 'To be announced',
        salary: body.salary || 'Confidential',
        minimumCGPA: Number(body.minimumCGPA) || 6.5,
        department: body.department || 'All Departments',
        degree: body.degree || 'B.E./B.Tech',
        requiredSkills: body.requiredSkills || [],
        registrations: [],
        createdAt: new Date().toISOString()
      };
      state.campusDrives.push(newDrive);
      persistState();
      return sendJSON(201, { success: true, drive: newDrive });
    }

    if (pathname === '/api/company/campus-drives' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const drives = (state.campusDrives || []).filter(d => d.companyId === authUser.companyId).map(d => ({
        ...d,
        registrationCount: (d.registrations || []).length,
        applicantCount: (state.applications || []).filter(a => a.driveId === d.id).length
      }));
      return sendJSON(200, drives);
    }

    if (pathname.match(/^\/api\/company\/campus-drives\/\d+\/registrations$/) && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const driveId = Number(pathname.split('/')[4]);
      const drive = (state.campusDrives || []).find(d => d.id === driveId);
      if (!drive || drive.companyId !== authUser.companyId) return sendJSON(404, { error: 'Drive not found.' });
      const registrations = (drive.registrations || []).map(studentId => {
        const student = state.users.find(u => u.id === studentId);
        const profile = state.studentProfiles[studentId] || {};
        const app = (state.applications || []).find(a => a.studentId === studentId && a.driveId === driveId);
        return {
          studentId: student?.student_id,
          name: profile.name || 'Student',
          email: student?.email,
          department: profile.department,
          cgpa: profile.cgpa,
          status: app?.status || 'Applied',
          matchScore: app?.matchScore || 0
        };
      });
      return sendJSON(200, { drive, registrations });
    }

    if (pathname.match(/^\/api\/company\/campus-drives\/\d+\/application\/\d+\/status$/) && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const pathParts = pathname.split('/');
      const driveId = Number(pathParts[4]);
      const studentId = Number(pathParts[6]);
      const body = await parseJSON(req);
      const drive = (state.campusDrives || []).find(d => d.id === driveId);
      if (!drive || drive.companyId !== authUser.companyId) return sendJSON(404, { error: 'Drive not found.' });
      const app = (state.applications || []).find(a => a.studentId === studentId && a.driveId === driveId);
      if (!app) return sendJSON(404, { error: 'Application not found.' });
      app.status = body.status || app.status;
      persistState();
      return sendJSON(200, { success: true, application: app });
    }

    // PLACEMENT TRACKING
    if (pathname === '/api/student/placement' && req.method === 'GET') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const placement = state.placements[authUser.id] || null;
      return sendJSON(200, placement || { message: 'No placement record found' });
    }

    if (pathname === '/api/student/placement' && req.method === 'POST') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      if (!state.placements) state.placements = {};
      const placement = {
        studentId: authUser.id,
        company: body.company || '',
        role: body.role || '',
        package: body.package || '',
        placementDate: body.placementDate || new Date().toISOString(),
        joiningDate: body.joiningDate || '',
        location: body.location || '',
        placementType: body.placementType || 'Full-time',
        skillsUsed: body.skillsUsed || [],
        status: 'Placed'
      };
      state.placements[authUser.id] = placement;
      persistState();
      return sendJSON(201, { success: true, placement });
    }

    if (pathname === '/api/student/placement' && req.method === 'PUT') {
      const authUser = requireStudent();
      if (!authUser) return sendJSON(401, { error: 'Student authentication required.' });
      const body = await parseJSON(req);
      if (!state.placements) state.placements = {};
      state.placements[authUser.id] = { ...state.placements[authUser.id], ...body };
      persistState();
      return sendJSON(200, { success: true, placement: state.placements[authUser.id] });
    }

    // PLACEMENT ANALYTICS (COMPANY)
    if (pathname === '/api/company/placements' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required.' });
      const placements = Object.values(state.placements || {}).filter(p => p.company === (state.companies.find(c => c.companyId === authUser.companyId)?.name || authUser.companyName));
      return sendJSON(200, placements);
    }

    // PLACEMENT ANALYTICS (COLLEGE ADMIN)
    if (pathname === '/api/college/placements' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'college') return sendJSON(401, { error: 'College Admin authentication required.' });
      const collegeStudents = Object.entries(state.studentProfiles).filter(([_, profile]) => profile.college === authUser.collegeName).map(([id, _]) => Number(id));
      const placements = collegeStudents.map(studentId => state.placements[studentId]).filter(Boolean);
      const placementStats = {
        totalStudents: collegeStudents.length,
        placedStudents: placements.length,
        placementRate: ((placements.length / collegeStudents.length) * 100).toFixed(2),
        placements
      };
      return sendJSON(200, placementStats);
    }

    // PLACEMENT ANALYTICS (UNIVERSITY ADMIN)
    if (pathname === '/api/university/placements' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'university_admin') return sendJSON(401, { error: 'University Admin authentication required.' });
      const placements = Object.values(state.placements || {});
      const placementStats = {
        totalPlacements: placements.length,
        averagePackage: placements.length > 0 ? (placements.reduce((sum, p) => sum + (Number(p.package.split('-')[0]) || 0), 0) / placements.length).toFixed(2) : 0,
        placementsByCompany: placements.reduce((acc, p) => {
          acc[p.company] = (acc[p.company] || 0) + 1;
          return acc;
        }, {}),
        placements
      };
      return sendJSON(200, placementStats);
    }

    if (pathname === '/api/ai/chat' && req.method === 'POST') {
      try {
        const body = await parseJSON(req);
        const message = String(body.message || '').trim();
        if (!message) return sendJSON(400, { error: 'Please enter a question for the AI advisor.' });
        
        const authUser = getAuthUser();
        const userRole = authUser?.role || 'student';
        const aiContext = getAIContextByRole(userRole);
        
        // Get user-specific info based on role
        let userIdentifier = 'User';
        if (userRole === 'student') {
          const profile = state.studentProfiles[authUser?.id] || {};
          userIdentifier = profile.name || authUser?.username || 'Student';
        } else if (userRole === 'company') {
          const company = state.companies.find(c => c.companyId === authUser?.companyId);
          userIdentifier = company?.name || authUser?.companyName || 'Company';
        } else if (userRole === 'college_admin') {
          userIdentifier = authUser?.collegeName || 'College Admin';
        } else if (userRole === 'university_admin') {
          userIdentifier = authUser?.universityName || 'University Admin';
        } else if (userRole === 'super_admin') {
          userIdentifier = authUser?.username || 'Admin';
        }
        
        // Verify access to data type if needed
        const dataRestricted = !canAccessData(userRole, message);
        if (dataRestricted) {
          return sendJSON(403, { error: 'You do not have access to this information.' });
        }
        
        // Generate role-aware AI response
        const reply = await generateAICareerAdvice(message, { 
          name: userIdentifier,
          role: userRole,
          systemPrompt: aiContext.systemPrompt
        });
        
        return sendJSON(200, { 
          reply,
          role: userRole,
          assistantTitle: aiContext.assistantTitle
        });
      } catch (error) {
        console.error('[AI] Chat route failed:', error.message);
        return sendJSON(503, { error: 'AI service is currently unavailable. Please check the AI API configuration and try again.' });
      }
    }

    // Get role-specific AI context and greeting
    if (pathname === '/api/ai/context' && req.method === 'GET') {
      const authUser = getAuthUser();
      const userRole = authUser?.role || 'student';
      
      let userIdentifier = 'User';
      if (userRole === 'student') {
        const profile = state.studentProfiles[authUser?.id] || {};
        userIdentifier = profile.name || authUser?.username || 'Student';
      } else if (userRole === 'company') {
        const company = state.companies.find(c => c.companyId === authUser?.companyId);
        userIdentifier = company?.name || authUser?.companyName || 'Company';
      } else if (userRole === 'college_admin') {
        userIdentifier = authUser?.collegeName || 'College';
      } else if (userRole === 'university_admin') {
        userIdentifier = authUser?.universityName || 'University';
      }
      
      const aiContext = getAIContextByRole(userRole);
      const greeting = generateGreeting(userRole, userIdentifier);
      
      return sendJSON(200, {
        role: userRole,
        greeting,
        assistantTitle: aiContext.assistantTitle,
        availableData: aiContext.availableData,
        restrictedData: aiContext.restrictedData
      });
    }

    // Get role-specific suggested questions
    if (pathname === '/api/ai/suggestions' && req.method === 'GET') {
      const authUser = getAuthUser();
      const userRole = authUser?.role || 'student';
      const suggestions = getSuggestedQuestions(userRole);
      
      return sendJSON(200, {
        role: userRole,
        suggestions
      });
    }

    // Get assistant title and metadata
    if (pathname === '/api/ai/metadata' && req.method === 'GET') {
      const authUser = getAuthUser();
      const userRole = authUser?.role || 'student';
      const aiContext = getAIContextByRole(userRole);
      const terminology = getTerminology(userRole);
      
      return sendJSON(200, {
        role: userRole,
        assistantTitle: aiContext.assistantTitle,
        terminology,
        suggestedQuestions: aiContext.suggestedQuestions
      });
    }

    // Get role-specific navigation
    if (pathname === '/api/navigation' && req.method === 'GET') {
      const authUser = getAuthUser();
      const userRole = authUser?.role || 'student';
      const navigation = getGroupedNavigationByRole(userRole);
      
      return sendJSON(200, navigation);
    }

    if (pathname === '/api/ai/skill-analysis' && req.method === 'GET') {
      const authUser = getAuthUser();
      const studentId = authUser ? authUser.id : 1;
      const skills = (state.userSkills[studentId] || []).map(skill => ({
        skillName: skill.skill_name || skill.skillName || 'Skill',
        score: Number(skill.level_pct || 0),
        confidence: Number(skill.level_pct || 0) >= 80 ? 'High' : Number(skill.level_pct || 0) >= 60 ? 'Medium' : 'Low',
        evidence: ['Portfolio and assessment evidence'],
        strengths: ['Professional growth trajectory'],
        recommendations: ['Keep building project experience and practical case studies']
      }));
      const overallScore = skills.length ? Math.round(skills.reduce((sum, item) => sum + item.score, 0) / skills.length) : 82;
      return sendJSON(200, {
        overallScore,
        confidence: overallScore >= 80 ? 'High' : 'Medium',
        skills: skills.length ? skills : [{ skillName: 'Core Skills', score: 82, confidence: 'High', evidence: ['SkillBridge baseline score'], strengths: ['Ready for practice'], recommendations: ['Focus on one project and one mock interview'] }],
        factors: { assessment: 80, projects: 82, certificates: 70, internships: 75, resume: 88, selfRating: overallScore }
      });
    }
    if (pathname === '/api/ai/skill-gap' && req.method === 'GET') {
      return sendJSON(200, {
        match: 82,
        matchingSkills: ['Python', 'SQL', 'Communication'],
        missingSkills: ['System Design', 'Data Structures'],
        recommendedSkills: ['System Design', 'Data Structures'],
        summary: 'SkillBridge detected strong fundamentals with a few gaps in system design and data structure depth.'
      });
    }
    if (pathname === '/api/ai/career-recommendation' && req.method === 'GET') {
      return sendJSON(200, {
        role: 'Full Stack Developer',
        match: 88,
        summary: 'You are well aligned for product engineering work and should continue strengthening problem-solving depth.',
        nextSteps: ['Add one production-style project', 'Practice mock interviews in Tamil or English', 'Show measurable outcomes in your portfolio']
      });
    }
    // UNIQUE AI ENGINES
    if (pathname === '/api/ai/calculate-skill-score' && req.method === 'POST') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      const score = calculateSkillScore(userId);
      return sendJSON(200, { studentId: userId, employability_score: score, status: score >= 80 ? 'Highly Qualified' : 'Qualified' });
    }
    if (pathname.startsWith('/api/ai/company/') && req.method === 'GET') {
      const compId = Number(pathname.split('/').pop());
      const comp = state.companies.find(c => c.id === compId) || state.companies[0];
      const match = calculateCompanyMatch(1, comp);
      return sendJSON(200, match);
    }

    // ----------------------------------------------------
    // COMPANY RECRUITER MODULE APIs
    // ----------------------------------------------------
    if (pathname === '/api/company/talent-finder' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const company = state.companies.find(item => item.companyId === authUser.companyId) || state.companies[0];
      const candidates = state.users.filter(user => user.role === 'student').map(user => {
        const profile = state.studentProfiles[user.id] || {};
        const settings = getStudentSettings(user.id);
        if (settings.profileVisibility === 'private' || settings.recruiterDiscovery === false) return null;
        const match = calculateCompanyMatch(user.id, company);
        return { studentId: user.student_id, name: profile.name || 'Student', department: profile.department || '', cgpa: settings.showAcademicInfo === false ? null : profile.cgpa, skills: settings.showSkills === false ? [] : (state.userSkills[user.id] || []).map(skill => ({ name: skill.skill_name, scoreOutOfTen: Number((Number(skill.level_pct || 0) / 10).toFixed(1)) })), matchPercentage: match.matchPercentage, recommendationLevel: match.recommendationLevel };
      }).filter(Boolean).sort((a, b) => b.matchPercentage - a.matchPercentage);
      return sendJSON(200, candidates);
    }
    if (pathname === '/api/company/assistant' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const company = state.companies.find(item => item.companyId === authUser.companyId) || state.companies[0];
      const candidates = state.users.filter(user => user.role === 'student').map(user => ({ user, match: calculateCompanyMatch(user.id, company) })).filter(item => getStudentSettings(item.user.id).profileVisibility !== 'private' && getStudentSettings(item.user.id).recruiterDiscovery !== false).sort((a, b) => b.match.matchPercentage - a.match.matchPercentage);
      const message = String((await parseJSON(req)).message || '').toLowerCase();
      if (message.includes('average')) { const average = candidates.length ? Math.round(candidates.reduce((sum, item) => sum + item.match.matchPercentage, 0) / candidates.length) : 0; return sendJSON(200, { reply: `The average available candidate match is ${average}%.` }); }
      if (message.includes('skill')) { const skill = message.match(/skill\s+(?:threshold|over|above)\s+([a-z0-9 .+#-]+)/i)?.[1]?.trim(); const filtered = skill ? candidates.filter(item => (state.userSkills[item.user.id] || []).some(saved => saved.skill_name.toLowerCase().includes(skill.toLowerCase()) && Number(saved.level_pct) >= 70)) : candidates; return sendJSON(200, { reply: `${filtered.length} privacy-eligible candidate(s) meet the requested skill filter.`, candidates: filtered.slice(0, 10).map(item => ({ studentId: item.user.student_id, matchPercentage: item.match.matchPercentage })) }); }
      return sendJSON(200, { reply: candidates.length ? `Top privacy-eligible candidate: ${candidates[0].user.student_id} at ${candidates[0].match.matchPercentage}% match.` : 'No privacy-eligible candidates are available.' });
    }
    if (pathname === '/api/company/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const compId = authUser.companyId || 'CMP-10001';
      const company = state.companies.find(c => c.companyId === compId) || state.companies[0];
      const compJobs = state.jobs.filter(j => j.companyId === compId);
      const compApps = state.applications.filter(a => a.companyId === compId);
      const interviews = (state.companyInterviews && state.companyInterviews[compId]) || [];
      const offers = (state.companyOffers && state.companyOffers[compId]) || [];
      const selectedApps = compApps.filter(a => ['Selected', 'Hired', 'Offer Accepted'].includes(a.status));
      const shortlistedApps = compApps.filter(a => ['Shortlisted', 'Technical Interview', 'HR Interview', 'Final Review', 'Selected', 'Hired', 'Offer Accepted'].includes(a.status));
      const screeningApps = compApps.filter(a => ['Screening', 'AI Screening', 'Shortlisted', 'Assessment', 'Technical Interview', 'HR Interview', 'Final Review', 'Selected', 'Hired', 'Offer Accepted'].includes(a.status));
      const activeInternships = compJobs.filter(job => /intern(ship)?/i.test(`${job.title || ''} ${job.job_type || ''}`)).length;
      const universityCounts = {};
      compApps.forEach(application => {
        const profile = state.studentProfiles[application.student_id] || {};
        const university = profile.university || profile.college;
        if (university) universityCounts[university] = (universityCounts[university] || 0) + 1;
      });
      const totalUniversityApplications = Object.values(universityCounts).reduce((sum, count) => sum + count, 0);
      const universities = Object.entries(universityCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, value: totalUniversityApplications ? Math.round((count / totalUniversityApplications) * 100) : 0 }));
      const skillCounts = {};
      compJobs.forEach(job => (job.required_skills || []).forEach(skill => {
        const name = String(skill).trim();
        if (name) skillCounts[name] = (skillCounts[name] || 0) + 1;
      }));
      const maxSkillCount = Math.max(1, ...Object.values(skillCounts));
      const skillDemand = Object.entries(skillCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, demand: Math.round((count / maxSkillCount) * 100), posted: count, candidates: compApps.length, gap: compApps.length >= count ? 'Low' : 'High' }));
      const typeCounts = { internship: activeInternships, fullTime: Math.max(0, compJobs.length - activeInternships) };
      const typeTotal = typeCounts.internship + typeCounts.fullTime;
      const hiringSplit = {
        internship: typeTotal ? Math.round((typeCounts.internship / typeTotal) * 100) : 0,
        fullTime: typeTotal ? Math.round((typeCounts.fullTime / typeTotal) * 100) : 0
      };
      const now = new Date();
      const applicationsOverTime = Array.from({ length: 8 }, (_, index) => {
        const monthStart = new Date(now.getFullYear(), now.getMonth() - (7 - index), 1);
        const nextMonth = new Date(now.getFullYear(), now.getMonth() - (6 - index), 1);
        return compApps.filter(application => {
          const date = new Date(application.applied_at || application.createdAt || 0);
          return date >= monthStart && date < nextMonth;
        }).length;
      });
      const metrics = [
        { label: 'Open Positions', value: compJobs.filter(job => !job.deadline || new Date(job.deadline) >= now).length, accent: 'blue' },
        { label: 'Active Internships', value: activeInternships, accent: 'emerald' },
        { label: 'Applications', value: compApps.length, accent: 'purple' },
        { label: 'Shortlisted Candidates', value: shortlistedApps.length, accent: 'orange' },
        { label: 'Interviews Scheduled', value: interviews.filter(item => item.status !== 'Cancelled').length, accent: 'sky' },
        { label: 'Offers Made', value: offers.length, accent: 'green' },
        { label: 'Students Hired', value: selectedApps.length, accent: 'teal' },
        { label: 'University Sources', value: Object.keys(universityCounts).length, accent: 'violet' }
      ];
      return sendJSON(200, {
        company,
        jobs: compJobs,
        total_jobs: compJobs.length,
        total_applicants: compApps.length,
        shortlisted: shortlistedApps.length,
        pipeline: compApps,
        metrics,
        applicationsOverTime,
        hiringFunnel: [
          { label: 'Applications', value: compApps.length },
          { label: 'Screening', value: screeningApps.length },
          { label: 'Shortlisted', value: shortlistedApps.length },
          { label: 'Interviews', value: interviews.length },
          { label: 'Selected', value: selectedApps.length },
          { label: 'Offers', value: offers.length }
        ],
        skillDemand,
        skillDistribution: [],
        hiringSplit,
        universities,
        insight: compApps.length
          ? `${compApps.length} application${compApps.length === 1 ? '' : 's'} are recorded for ${company.name}. Metrics update from jobs, applications, interviews, offers, and candidate stages.`
          : `No applications are recorded yet for ${company.name}. Publish a job to begin collecting candidate data.`
      });
    }

    if (pathname.match(/^\/api\/company\/jobs\/\d+\/candidates$/) && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const jobId = Number(pathname.split('/')[4]);
      const job = state.jobs.find(item => item.id === jobId && item.companyId === authUser.companyId);
      if (!job) return sendJSON(404, { error: 'Job not found for this company.' });
      const candidates = state.users.filter(user => user.role === 'student').map(user => {
        const settings = getStudentSettings(user.id);
        if (settings.profileVisibility === 'private' || settings.recruiterDiscovery === false) return null;
        const company = state.companies.find(item => item.companyId === job.companyId) || {};
        const match = calculateCompanyMatch(user.id, { ...company, required_skills: job.required_skills || [], min_cgpa: job.min_cgpa });
        const profile = state.studentProfiles[user.id] || {};
        return { studentId: user.student_id, name: profile.name || 'Student', cgpa: settings.showAcademicInfo === false ? null : profile.cgpa, skills: settings.showSkills === false ? [] : (state.userSkills[user.id] || []).map(skill => ({ name: skill.skill_name, percentage: Number(skill.level_pct || 0), scoreOutOfTen: Number((Number(skill.level_pct || 0) / 10).toFixed(1)) })), matchPercentage: match.matchPercentage, recommendationLevel: match.recommendationLevel, strengths: match.strengths, skillGaps: match.skillGaps, privacy: { academicInfo: settings.showAcademicInfo !== false, skills: settings.showSkills !== false } };
      }).filter(Boolean).sort((a, b) => b.matchPercentage - a.matchPercentage);
      return sendJSON(200, { job, candidates });
    }

    if (pathname === '/api/company/jobs' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const compId = authUser.companyId || 'CMP-10001';
      const comp = state.companies.find(c => c.companyId === compId) || state.companies[0];
      const body = await parseJSON(req);

      const newJob = { id: nextJobId(), company_id: comp.id, companyId: comp.companyId, company_name: comp.name, title: body.title, location: body.location || 'Remote', salary_stipend: body.salary_stipend || '₹ 12,00,000 P.A.', required_skills: (body.required_skills || 'Java,SQL').split(','), min_cgpa: Number(body.min_cgpa || 7.5), deadline: body.deadline || '2026-11-30' };
      state.jobs.unshift(newJob);
      state.users.filter(user => user.role === 'student').forEach(student => {
        const match = calculateCompanyMatch(student.id, comp);
        if (match.isEligible) {
          if (!state.notifications[student.id]) state.notifications[student.id] = [];
          state.notifications[student.id].unshift({ id: Date.now() + student.id, type: 'job-match', title: `New Job Match: ${newJob.title}`, message: `${comp.name} matches your profile at ${match.matchPercentage}%.`, jobId: newJob.id, is_read: false, created_at: new Date().toISOString() });
        }
      });
      return sendJSON(201, { success: true, job: newJob });
    }

    if (pathname === '/api/company/pipeline/stage' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const { applicationId, newStage } = await parseJSON(req);
      const companyId = authUser.companyId || '';
      const app = state.applications.find(a => a.id === Number(applicationId) && a.companyId === companyId);
      if (!app) return sendJSON(404, { error: 'Application not found for this company.' });
      if (app) {
        app.status = newStage;
        app.last_updated = new Date().toISOString().split('T')[0];
        app.next_step = `Moved to ${newStage} stage.`;
      }
      return sendJSON(200, { success: true, application: app });
    }

    // ============================================================================
    // ENHANCED COMPANY RECRUITER MODULE APIs
    // ============================================================================

    // COMPANY PROFILE MANAGEMENT
    if (pathname === '/api/company/profile' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const company = state.companies.find(c => c.companyId === authUser.companyId);
      if (!company) return sendJSON(404, { error: 'Company not found' });
      const stats = {
        activeJobs: state.jobs.filter(j => j.companyId === authUser.companyId && j.status !== 'Closed').length,
        totalApplications: state.applications.filter(a => a.companyId === authUser.companyId).length,
        shortlisted: state.applications.filter(a => a.companyId === authUser.companyId && ['Shortlisted', 'Technical Interview', 'HR Interview', 'Final Review'].includes(a.status)).length,
        selected: state.applications.filter(a => a.companyId === authUser.companyId && a.status === 'Selected').length
      };
      return sendJSON(200, { company, stats, recruiters: state.teamMembers?.filter(t => t.companyId === authUser.companyId) || [] });
    }

    if (pathname === '/api/company/profile' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const company = state.companies.find(c => c.companyId === authUser.companyId);
      if (!company) return sendJSON(404, { error: 'Company not found' });
      const body = await parseJSON(req);
      Object.assign(company, { name: body.name || company.name, industry: body.industry || company.industry, description: body.description || company.description, website: body.website || company.website, logo: body.logo || company.logo, about: body.about || company.about, mission: body.mission || company.mission, vision: body.vision || company.vision, culture: body.culture || company.culture, benefits: body.benefits || company.benefits });
      return sendJSON(200, { success: true, company });
    }

    // COMPREHENSIVE JOB MANAGEMENT
    if (pathname === '/api/company/jobs' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const jobs = state.jobs.filter(j => j.companyId === authUser.companyId).map(j => ({ ...j, applications: state.applications.filter(a => a.job_id === j.id).length }));
      return sendJSON(200, jobs);
    }

    if (pathname.match(/^\/api\/company\/jobs\/\d+$/) && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const jobId = Number(pathname.split('/')[4]);
      const job = state.jobs.find(j => j.id === jobId && j.companyId === authUser.companyId);
      if (!job) return sendJSON(404, { error: 'Job not found' });
      return sendJSON(200, job);
    }

    if (pathname.match(/^\/api\/company\/jobs\/\d+$/) && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const jobId = Number(pathname.split('/')[4]);
      const job = state.jobs.find(j => j.id === jobId && j.companyId === authUser.companyId);
      if (!job) return sendJSON(404, { error: 'Job not found' });
      const body = await parseJSON(req);
      Object.assign(job, body, { updatedAt: new Date().toISOString() });
      return sendJSON(200, { success: true, job });
    }

    if (pathname.match(/^\/api\/company\/jobs\/\d+$/) && req.method === 'DELETE') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const jobId = Number(pathname.split('/')[4]);
      state.jobs = state.jobs.filter(j => !(j.id === jobId && j.companyId === authUser.companyId));
      state.applications = state.applications.filter(a => a.job_id !== jobId);
      return sendJSON(200, { success: true });
    }

    // ATS PIPELINE & APPLICATION MANAGEMENT
    if (pathname === '/api/company/applications' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const status = parsedUrl.searchParams.get('status');
      const jobId = parsedUrl.searchParams.get('jobId');
      let applications = state.applications.filter(a => a.companyId === authUser.companyId);
      if (status) applications = applications.filter(a => a.status === status);
      if (jobId) applications = applications.filter(a => a.job_id === Number(jobId));
      return sendJSON(200, applications);
    }

    if (pathname === '/api/company/applications/kanban' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const applications = state.applications.filter(a => a.companyId === authUser.companyId);
      const stages = ['Applied', 'Screening', 'Shortlisted', 'Assessment', 'Technical Interview', 'HR Interview', 'Final Review', 'Selected'];
      const kanban = {};
      stages.forEach(stage => { kanban[stage] = applications.filter(a => a.status === stage || a.ats_stage === stage); });
      return sendJSON(200, kanban);
    }

    if (pathname.match(/^\/api\/company\/applications\/\d+\/stage$/) && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const appId = Number(pathname.split('/')[4]);
      const application = state.applications.find(a => a.id === appId && a.companyId === authUser.companyId);
      if (!application) return sendJSON(404, { error: 'Application not found' });
      const body = await parseJSON(req);
      const newStage = body.stage || body.status;
      const previousStage = application.status;
      application.status = newStage;
      application.ats_stage = newStage;
      application.last_updated = new Date().toISOString().split('T')[0];
      if (!application.stageHistory) application.stageHistory = [];
      application.stageHistory.push({ from: previousStage, to: newStage, timestamp: new Date().toISOString(), movedBy: authUser.email });
      return sendJSON(200, { success: true, application });
    }

    // ASSESSMENT SYSTEM
    if (pathname === '/api/company/assessments' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      if (!state.companyAssessments) state.companyAssessments = {};
      return sendJSON(200, state.companyAssessments[authUser.companyId] || []);
    }

    if (pathname === '/api/company/assessments' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      if (!state.companyAssessments) state.companyAssessments = {};
      const body = await parseJSON(req);
      const newAssessment = { id: Date.now(), companyId: authUser.companyId, title: body.title || 'Assessment', description: body.description || '', type: body.type || 'Technical', duration: Number(body.duration) || 60, totalMarks: Number(body.totalMarks) || 100, passingScore: Number(body.passingScore) || 60, questions: body.questions || [], createdAt: new Date().toISOString() };
      if (!state.companyAssessments[authUser.companyId]) state.companyAssessments[authUser.companyId] = [];
      state.companyAssessments[authUser.companyId].push(newAssessment);
      return sendJSON(201, { success: true, assessment: newAssessment });
    }

    // INTERVIEW MANAGEMENT
    if (pathname === '/api/company/interviews' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      if (!state.companyInterviews) state.companyInterviews = {};
      return sendJSON(200, state.companyInterviews[authUser.companyId] || []);
    }

    if (pathname === '/api/company/interviews/schedule' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      if (!state.companyInterviews) state.companyInterviews = {};
      const body = await parseJSON(req);
      const newInterview = { id: Date.now(), companyId: authUser.companyId, applicationId: body.applicationId, candidateName: body.candidateName || '', candidateEmail: body.candidateEmail || '', jobTitle: body.jobTitle || '', round: body.round || 'Technical', date: body.date, time: body.time, duration: Number(body.duration) || 60, interviewType: body.interviewType || 'Video', interviewer: body.interviewer || authUser.email, meetingLink: body.meetingLink || '', status: 'Scheduled', createdAt: new Date().toISOString() };
      if (!state.companyInterviews[authUser.companyId]) state.companyInterviews[authUser.companyId] = [];
      state.companyInterviews[authUser.companyId].push(newInterview);
      return sendJSON(201, { success: true, interview: newInterview });
    }

    // TALENT SEARCH & DISCOVERY
    if (pathname === '/api/company/candidates/search' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const skill = parsedUrl.searchParams.get('skill');
      const minCGPA = parsedUrl.searchParams.get('minCGPA');
      const department = parsedUrl.searchParams.get('department');
      const company = state.companies.find(c => c.companyId === authUser.companyId);
      let candidates = state.users.filter(u => u.role === 'student').map(u => {
        const profile = state.studentProfiles[u.id] || {};
        const settings = getStudentSettings(u.id);
        if (settings.profileVisibility === 'private' || settings.recruiterDiscovery === false) return null;
        const match = calculateCompanyMatch(u.id, company);
        const skills = state.userSkills[u.id] || [];
        const aiScore = calculateSkillScore(u.id);
        return { studentId: u.student_id, name: profile.name || 'Student', email: settings.showContactInfo ? u.email : '***@***.com', department: profile.department || '', cgpa: settings.showAcademicInfo ? profile.cgpa : null, skills: settings.showSkills ? skills.map(s => ({ name: s.skill_name, level: s.level_pct })) : [], aiScore, matchPercentage: match.matchPercentage, recommendationLevel: match.recommendationLevel, userId: u.id };
      }).filter(Boolean);
      if (skill) candidates = candidates.filter(c => c.skills.some(s => s.name.toLowerCase().includes(skill.toLowerCase())));
      if (minCGPA) candidates = candidates.filter(c => c.cgpa && c.cgpa >= Number(minCGPA));
      if (department) candidates = candidates.filter(c => c.department.toLowerCase().includes(department.toLowerCase()));
      candidates.sort((a, b) => b.matchPercentage - a.matchPercentage);
      return sendJSON(200, candidates);
    }

    if (pathname.match(/^\/api\/company\/candidates\/[^/]+$/) && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const studentId = pathname.split('/')[4];
      const student = state.users.find(u => u.student_id === studentId && u.role === 'student');
      if (!student) return sendJSON(404, { error: 'Candidate not found' });
      const settings = getStudentSettings(student.id);
      if (settings.profileVisibility === 'private' || settings.recruiterDiscovery === false) return sendJSON(403, { error: 'Profile restricted' });
      const profile = state.studentProfiles[student.id] || {};
      const company = state.companies.find(c => c.companyId === authUser.companyId);
      const match = calculateCompanyMatch(student.id, company);
      return sendJSON(200, { studentId: student.student_id, name: profile.name, email: settings.showContactInfo ? student.email : null, profile: { department: profile.department, cgpa: settings.showAcademicInfo ? profile.cgpa : null, graduationYear: profile.year, college: profile.college }, skills: settings.showSkills ? state.userSkills[student.id] || [] : [], projects: state.projects[student.id] || [], certificates: state.certificates[student.id] || [], internships: state.internships[student.id] || [], resume: state.resumes[student.id] || null, aiScore: calculateSkillScore(student.id), match });
    }

    // OFFER MANAGEMENT
    if (pathname === '/api/company/offers' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      if (!state.companyOffers) state.companyOffers = {};
      return sendJSON(200, state.companyOffers[authUser.companyId] || []);
    }

    if (pathname === '/api/company/offers' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      if (!state.companyOffers) state.companyOffers = {};
      const body = await parseJSON(req);
      const newOffer = { id: Date.now(), companyId: authUser.companyId, applicationId: body.applicationId, candidateName: body.candidateName, candidateEmail: body.candidateEmail, jobTitle: body.jobTitle, jobId: body.jobId, salary: body.salary, benefits: body.benefits || [], joiningDate: body.joiningDate, location: body.location, offerExpiryDate: body.offerExpiryDate, status: 'Sent', letterContent: body.letterContent || '', createdAt: new Date().toISOString() };
      if (!state.companyOffers[authUser.companyId]) state.companyOffers[authUser.companyId] = [];
      state.companyOffers[authUser.companyId].push(newOffer);
      return sendJSON(201, { success: true, offer: newOffer });
    }

    // TEAM MEMBER MANAGEMENT
    if (pathname === '/api/company/team' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      if (!state.teamMembers) state.teamMembers = [];
      return sendJSON(200, state.teamMembers.filter(t => t.companyId === authUser.companyId));
    }

    if (pathname === '/api/company/team' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      if (!state.teamMembers) state.teamMembers = [];
      const body = await parseJSON(req);
      const newMember = { id: Date.now(), companyId: authUser.companyId, name: body.name, email: body.email, role: body.role || 'HR_RECRUITER', department: body.department || 'HR', createdAt: new Date().toISOString() };
      state.teamMembers.push(newMember);
      return sendJSON(201, { success: true, member: newMember });
    }

    // ANALYTICS & REPORTING
    if (pathname === '/api/company/analytics/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Company authentication required' });
      const applications = state.applications.filter(a => a.companyId === authUser.companyId);
      const jobs = state.jobs.filter(j => j.companyId === authUser.companyId);
      const pipeline = {
        applied: applications.filter(a => a.status === 'Applied').length,
        screening: applications.filter(a => a.status === 'Screening').length,
        shortlisted: applications.filter(a => a.status === 'Shortlisted').length,
        assessment: applications.filter(a => a.status === 'Assessment').length,
        technicalInterview: applications.filter(a => a.status === 'Technical Interview').length,
        hrInterview: applications.filter(a => a.status === 'HR Interview').length,
        finalReview: applications.filter(a => a.status === 'Final Review').length,
        selected: applications.filter(a => a.status === 'Selected').length
      };
      const metrics = { totalApplications: applications.length, totalJobs: jobs.length, activeJobs: jobs.filter(j => j.status === 'Published').length, applicationToInterviewRatio: (applications.filter(a => a.status.includes('Interview')).length / (applications.length || 1)).toFixed(2), interviewToSelectionRatio: (pipeline.selected / (applications.filter(a => a.status.includes('Interview')).length || 1)).toFixed(2) };
      return sendJSON(200, { pipeline, metrics, jobs });
    }

    // ============================================================================
    // UNIVERSITY ADMIN MODULE APIs
    // ============================================================================
    if (pathname === '/api/college/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'college') return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      return sendJSON(200, state.collegeAnalytics);
    }
    if (pathname === '/api/college/students' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'college') return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      return sendJSON(200, Object.values(state.studentProfiles));
    }
    if (pathname === '/api/college/assistant' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'college') return sendJSON(401, { error: 'Access Denied. College Admin Auth Required.' });
      const message = String((await parseJSON(req)).message || '').toLowerCase();
      const students = Object.values(state.studentProfiles).filter(profile => !authUser.collegeName || profile.university === authUser.collegeName || profile.college === authUser.collegeName);
      const skills = students.flatMap(profile => state.userSkills[profile.user_id] || []).map(skill => skill.skill_name);
      if (message.includes('missing') || message.includes('training')) { const counts = skills.reduce((map, skill) => { const key = skill.toLowerCase(); map[key] = (map[key] || 0) + 1; return map; }, {}); const common = Object.entries(counts).sort((a, b) => a[1] - b[1]).slice(0, 5).map(item => item[0]); return sendJSON(200, { reply: common.length ? `The least represented recorded skills are: ${common.join(', ')}.` : 'No skill records are available for this university.' }); }
      if (message.includes('job-ready') || message.includes('strong')) { const ready = students.filter(profile => Number(profile.cgpa || 0) >= 7.5 && (state.userSkills[profile.user_id] || []).length > 0).length; return sendJSON(200, { reply: `${ready} authorized student(s) have a CGPA of at least 7.5 and at least one recorded skill.` }); }
      return sendJSON(200, { reply: `${students.length} authorized student record(s) are available for this university.` });
    }

    // Static Asset Server Fallback (Supports root & frontend directory)
    let filePath = path.join(repoRoot, 'frontend', pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(repoRoot, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(repoRoot, 'index.html');

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

if (require.main === module) {
  server.listen(port, () => {
    console.log(`================================================================`);
    console.log(` SkillBridge Unique 3-Portal Backend Engine Running on Port ${port}`);
    console.log(`================================================================`);
  });
}

module.exports = (req, res) => server.emit('request', req, res);

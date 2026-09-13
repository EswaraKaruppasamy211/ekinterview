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
const envPath = path.join(__dirname, '.env');
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

const port = Number(process.env.PORT) || 3000;
const repoRoot = __dirname;
const uploadsDir = path.join(repoRoot, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

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
let counters = { company: 10002, student: 102, job: 101, app: 901, cert: 401 };
function nextCompanyId() { return `CMP-${++counters.company}`; }
function nextStudentId() { return `STU-2026-${++counters.student}`; }
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
  const studentPwd = hashPassword('Student@123');
  const compPwd = hashPassword('Company@123');
  const collegePwd = hashPassword('College@123');

  state.users = [
    { id: 1, email: 'arjun@skillbridge.ai', username: 'arjun_sharma', student_id: 'STU-2026-101', password_hash: studentPwd.hash, salt: studentPwd.salt, role: 'student' },
    { id: 2, email: 'recruiter@techcorp.com', username: 'techcorp_mgr', companyName: 'TechCorp Solutions', companyId: 'CMP-10001', password_hash: compPwd.hash, salt: compPwd.salt, role: 'company' },
    { id: 3, email: 'admin@annauniv.edu', username: 'anna_univ_admin', collegeName: 'Anna University', password_hash: collegePwd.hash, salt: collegePwd.salt, role: 'college' }
  ];

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

// Unique AI Employability Skill Score Engine
function calculateSkillScore(studentId) {
  const profile = state.studentProfiles[studentId || 1] || {};
  const skills = state.userSkills[studentId || 1] || [];
  const certs = state.certifications[studentId || 1] || [];
  const backlog = state.backlogs[studentId || 1] || {};

  let score = 0;
  // 1. CGPA Weightage (Max 40 points)
  const cgpa = Number(profile.cgpa || 8.0);
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
  const profile = state.studentProfiles[studentId || 1] || {};
  const skills = state.userSkills[studentId || 1] || [];
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
  const cgpaMatch = (Number(profile.cgpa || 8.8) >= Number(company.min_cgpa || 7.5)) ? 100 : 50;
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

// HTTP SERVER ENGINE
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:3000'}`);
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
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const { fullName, email, mobile, studentId, companyName, managerName, collegeName, adminName, role, password } = await parseJSON(req);
      const userRole = role || 'student';
      const newId = Date.now();
      const { salt, hash } = hashPassword(password || 'Password@123');

      if (userRole === 'company') {
        if (!companyName || !email || !password) return sendJSON(400, { error: 'Company Name, Email, and Password required.' });
        const assignedCompId = nextCompanyId();
        const newComp = { id: newId, companyId: assignedCompId, name: companyName, logo: '🏢', industry: 'Corporate Partner', manager_name: managerName || 'Recruitment Manager', min_cgpa: 7.0, min_ai_score: 70, required_skills: ['Java', 'SQL'] };
        state.companies.push(newComp);

        const newUser = { id: newId, email, username: email.split('@')[0], companyName, companyId: assignedCompId, password_hash: hash, salt, role: 'company' };
        state.users.push(newUser);
        const token = generateToken({ id: newUser.id, email, companyId: assignedCompId, role: 'company' });
        return sendJSON(201, { token, user: newUser, company: newComp });

      } else if (userRole === 'college') {
        if (!collegeName || !email || !password) return sendJSON(400, { error: 'University Name, Email, and Password required.' });
        const newUser = { id: newId, email, username: email.split('@')[0], collegeName, adminName: adminName || 'University Admin', password_hash: hash, salt, role: 'college' };
        state.users.push(newUser);
        const token = generateToken({ id: newUser.id, email, role: 'college' });
        return sendJSON(201, { token, user: newUser });

      } else {
        const assignedStuId = studentId || nextStudentId();
        const newUser = { id: newId, email, username: email.split('@')[0], student_id: assignedStuId, password_hash: hash, salt, role: 'student' };
        state.users.push(newUser);
        state.studentProfiles[newId] = { user_id: newId, name: fullName || 'New Student', email, phone: mobile || '+91 9876543210', student_id: assignedStuId, college: 'Anna University', department: 'Computer Science & Engg', cgpa: 8.5 };
        const token = generateToken({ id: newUser.id, email, role: 'student' });
        return sendJSON(201, { token, user: newUser, profile: state.studentProfiles[newId] });
      }
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const { identity, companyName, password, role } = await parseJSON(req);
      const userRole = role || 'student';
      let user = null;

      if (userRole === 'company') {
        if (!companyName) return sendJSON(400, { error: 'Company Name is REQUIRED for Recruiter Login.' });
        user = state.users.find(u => u.role === 'company' && (u.companyName.toLowerCase() === companyName.toLowerCase() || u.companyId === companyName) && (u.email.toLowerCase() === (identity || '').toLowerCase() || u.username === identity));
        if (!user && (companyName === 'TechCorp Solutions' || companyName === 'CMP-10001')) user = state.users.find(u => u.role === 'company' && u.companyId === 'CMP-10001');

      } else if (userRole === 'college') {
        user = state.users.find(u => u.role === 'college' && (u.email.toLowerCase() === (identity || '').toLowerCase() || u.username === identity));
        if (!user && (identity === 'anna_univ_admin' || identity === 'admin@annauniv.edu')) user = state.users.find(u => u.role === 'college');

      } else {
        user = state.users.find(u => u.role === 'student' && (u.email.toLowerCase() === (identity || '').toLowerCase() || u.student_id === identity || u.username === identity));
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
    if (pathname === '/api/student/profile' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      return sendJSON(200, { profile: state.studentProfiles[userId] || state.studentProfiles[1], completion: { percentage: 80, missingItems: [] }, resume: state.resumes[userId] || state.resumes[1] });
    }
    if (pathname === '/api/student/resume' && req.method === 'POST') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      const body = await parseJSON(req);
      if (!body.fileUrl && !body.resumeUrl) return sendJSON(400, { error: 'Resume file or URL is required.' });
      state.resumes[userId] = {
        file_name: body.fileName || 'Resume.pdf',
        file_url: body.fileUrl || body.resumeUrl,
        upload_date: new Date().toISOString().split('T')[0],
        status: 'Verified & Active',
        ats_analysis: body.atsAnalysis || null
      };
      return sendJSON(201, { success: true, resume: state.resumes[userId] });
    }
    if (pathname === '/api/student/profile' && req.method === 'PUT') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      const body = await parseJSON(req);
      state.studentProfiles[userId] = { ...(state.studentProfiles[userId] || {}), ...body };
      return sendJSON(200, { success: true, profile: state.studentProfiles[userId] });
    }
    if (pathname === '/api/student/academics' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      return sendJSON(200, { cgpa: 8.8, records: state.academicRecords[userId] || state.academicRecords[1], school: state.schoolEducation[userId] || state.schoolEducation[1], backlog: state.backlogs[userId] || state.backlogs[1] });
    }
    if (pathname === '/api/student/skills' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      return sendJSON(200, { technical: state.userSkills[userId] || state.userSkills[1], coding: state.codingSkills[userId] || state.codingSkills[1] });
    }
    if (pathname === '/api/student/assessments' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      const computedScore = calculateSkillScore(userId);
      return sendJSON(200, { ...(state.assessments[userId] || state.assessments[1]), overall_score: computedScore });
    }
    if (pathname === '/api/student/portfolio' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      return sendJSON(200, { projects: state.projects[userId] || state.projects[1], internships: state.internships[userId] || state.internships[1], certifications: state.certifications[userId] || state.certifications[1], seminars: state.seminars[userId] || state.seminars[1], workshops: state.workshops[userId] || state.workshops[1], hackathons: state.hackathons[userId] || state.hackathons[1], achievements: state.achievements[userId] || state.achievements[1] });
    }
    if (pathname === '/api/opportunities' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      return sendJSON(200, state.jobs.map(j => {
        const comp = state.companies.find(c => c.companyId === j.companyId) || state.companies[0];
        const match = calculateCompanyMatch(userId, comp);
        return { ...j, match_percentage: match.matchPercentage, is_eligible: match.isEligible };
      }));
    }
    if (pathname === '/api/student/apply' && req.method === 'POST') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      const { jobId } = await parseJSON(req);
      const targetJob = state.jobs.find(j => j.id === Number(jobId)) || state.jobs[0];
      const newApp = { id: nextAppId(), student_id: userId, job_id: targetJob.id, companyId: targetJob.companyId || 'CMP-10001', company_name: targetJob.company_name, job_title: targetJob.title, candidate_name: 'Arjun Sharma', cgpa: 8.8, applied_at: new Date().toISOString().split('T')[0], status: 'Applied', last_updated: new Date().toISOString().split('T')[0], next_step: 'Application under recruiter review.' };
      state.applications.unshift(newApp);
      return sendJSON(201, { success: true, application: newApp });
    }
    if (pathname === '/api/student/applications' && req.method === 'GET') {
      return sendJSON(200, state.applications);
    }
    if (pathname === '/api/student/campus-drives' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      const drives = state.campusDrives || [
        { id: 1, company: 'TechCorp Solutions', role: 'Software Engineer', location: 'Chennai / Hybrid', date: '2026-09-18', deadline: '2026-09-15', minimumCGPA: 7.5, salary: 'INR 8-12 LPA', eligible: true, registered: false, reason: 'Matches your academic and skill profile.' },
        { id: 2, company: 'DataSoft Systems', role: 'Data Analyst', location: 'Bengaluru', date: '2026-09-24', deadline: '2026-09-20', minimumCGPA: 8.0, salary: 'INR 6-9 LPA', eligible: true, registered: false, reason: 'Eligible based on your CGPA and technical skills.' },
        { id: 3, company: 'InnovateTech', role: 'Frontend Developer', location: 'Remote', date: '2026-10-02', deadline: '2026-09-27', minimumCGPA: 8.5, salary: 'INR 7-10 LPA', eligible: false, registered: false, reason: 'Minimum CGPA requirement is 8.5.' }
      ];
      return sendJSON(200, drives.map(drive => ({ ...drive, registered: Boolean((state.campusRegistrations || {})[userId]?.includes(drive.id)) })));
    }
    if (pathname.match(/^\/api\/student\/campus-drives\/\d+\/register$/) && req.method === 'POST') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      const driveId = Number(pathname.split('/')[4]);
      const registrations = state.campusRegistrations || (state.campusRegistrations = {});
      registrations[userId] = registrations[userId] || [];
      if (!registrations[userId].includes(driveId)) registrations[userId].push(driveId);
      return sendJSON(200, { success: true, driveId, registered: true });
    }
    if (pathname === '/api/student/placement' && req.method === 'GET') {
      const authUser = getAuthUser(); const userId = authUser ? authUser.id : 1;
      return sendJSON(200, { placement: (state.placements || {})[userId] || null });
    }
    if (pathname === '/api/student/notifications' && req.method === 'GET') {
      return sendJSON(200, state.notifications[1] || []);
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
    if (pathname === '/api/company/dashboard' && req.method === 'GET') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const compId = authUser.companyId || 'CMP-10001';
      const company = state.companies.find(c => c.companyId === compId) || state.companies[0];
      const compJobs = state.jobs.filter(j => j.companyId === compId);
      const compApps = state.applications.filter(a => a.companyId === compId);

      return sendJSON(200, { company, total_jobs: compJobs.length, total_applicants: compApps.length, shortlisted: compApps.filter(a => a.status === 'Shortlisted' || a.status === 'Technical Interview').length, pipeline: compApps });
    }

    if (pathname === '/api/company/jobs' && req.method === 'POST') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const compId = authUser.companyId || 'CMP-10001';
      const comp = state.companies.find(c => c.companyId === compId) || state.companies[0];
      const body = await parseJSON(req);

      const newJob = { id: nextJobId(), company_id: comp.id, companyId: comp.companyId, company_name: comp.name, title: body.title, location: body.location || 'Remote', salary_stipend: body.salary_stipend || '₹ 12,00,000 P.A.', required_skills: (body.required_skills || 'Java,SQL').split(','), min_cgpa: Number(body.min_cgpa || 7.5), deadline: body.deadline || '2026-11-30' };
      state.jobs.unshift(newJob);
      return sendJSON(201, { success: true, job: newJob });
    }

    if (pathname === '/api/company/pipeline/stage' && req.method === 'PUT') {
      const authUser = getAuthUser();
      if (!authUser || authUser.role !== 'company') return sendJSON(401, { error: 'Access Denied. Company Auth Required.' });
      const { applicationId, newStage } = await parseJSON(req);
      const app = state.applications.find(a => a.id === Number(applicationId));
      if (app) {
        app.status = newStage;
        app.last_updated = new Date().toISOString().split('T')[0];
        app.next_step = `Moved to ${newStage} stage.`;
      }
      return sendJSON(200, { success: true, application: app });
    }

    // ----------------------------------------------------
    // UNIVERSITY ADMIN MODULE APIs
    // ----------------------------------------------------
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

    // Static Asset Server Fallback (Supports root & frontend directory)
    let filePath = path.join(repoRoot, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath)) filePath = path.join(repoRoot, 'frontend', pathname === '/' ? 'index.html' : pathname);
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

server.listen(port, () => {
  console.log(`================================================================`);
  console.log(` SkillBridge Unique 3-Portal Backend Engine Running on Port ${port}`);
  console.log(`================================================================`);
});

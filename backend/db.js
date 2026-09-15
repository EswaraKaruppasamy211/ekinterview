const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');
const root = __dirname;
const dbFile = process.env.DB_FILE_PATH ||
  (process.env.VERCEL ? path.join('/tmp', 'skillmap.db') : path.join(root, 'skillmap.db'));

let _db = null;

async function init() {
  if (_db) return _db;
  try {
    try { fs.openSync(dbFile, 'a').close(); } catch (e) { /* ignore */ }
    _db = await open({ filename: dbFile, driver: sqlite3.Database });

    await _db.exec(`PRAGMA foreign_keys = ON;`);

    // Core users table
    await _db.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL, -- 'student', 'company', 'college', 'admin'
      dob TEXT,
      verified INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    )`);

    // Student Profiles
    await _db.exec(`CREATE TABLE IF NOT EXISTS student_profiles (
      user_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      college TEXT,
      university TEXT,
      degree TEXT,
      department TEXT,
      year_of_study TEXT,
      graduation_year INTEGER,
      cgpa REAL,
      phone TEXT,
      location TEXT,
      photo_url TEXT,
      resume_url TEXT,
      bio TEXT,
      goal TEXT,
      portfolio_visibility TEXT DEFAULT 'public',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Company Profiles
    await _db.exec(`CREATE TABLE IF NOT EXISTS company_profiles (
      user_id INTEGER PRIMARY KEY,
      company_name TEXT NOT NULL,
      logo_url TEXT,
      industry TEXT,
      description TEXT,
      website TEXT,
      location TEXT,
      verified INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // College Profiles
    await _db.exec(`CREATE TABLE IF NOT EXISTS college_profiles (
      user_id INTEGER PRIMARY KEY,
      college_name TEXT NOT NULL,
      code TEXT,
      location TEXT,
      website TEXT,
      verified INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Mentors Profile Table
    await _db.exec(`CREATE TABLE IF NOT EXISTS mentors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      company_name TEXT NOT NULL,
      title TEXT NOT NULL,
      experience_years INTEGER DEFAULT 5,
      domain TEXT NOT NULL,
      skills TEXT NOT NULL,
      expertise TEXT,
      rating REAL DEFAULT 4.9,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Skill Exchange Posts (Student-Student, Student-Faculty, College-Industry)
    await _db.exec(`CREATE TABLE IF NOT EXISTS skill_exchange_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      user_role TEXT NOT NULL, -- 'student', 'faculty', 'industry', 'college'
      exchange_type TEXT NOT NULL, -- 'Peer Learning', 'Workshop', 'Faculty Collaboration'
      skill_offered TEXT NOT NULL,
      skill_requested TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'Open',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Ask an Industry Expert Q&A
    await _db.exec(`CREATE TABLE IF NOT EXISTS expert_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      title TEXT NOT NULL,
      question TEXT NOT NULL,
      category TEXT DEFAULT 'Career Guidance',
      upvotes INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await _db.exec(`CREATE TABLE IF NOT EXISTS expert_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL,
      mentor_id INTEGER NOT NULL,
      mentor_name TEXT NOT NULL,
      mentor_title TEXT NOT NULL,
      answer TEXT NOT NULL,
      is_verified INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(question_id) REFERENCES expert_questions(id) ON DELETE CASCADE,
      FOREIGN KEY(mentor_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Industry Real-World Micro Projects & Feedback
    await _db.exec(`CREATE TABLE IF NOT EXISTS industry_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mentor_id INTEGER NOT NULL,
      mentor_name TEXT NOT NULL,
      company_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      required_skills TEXT NOT NULL,
      difficulty TEXT DEFAULT 'Intermediate',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(mentor_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await _db.exec(`CREATE TABLE IF NOT EXISTS project_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      submission_url TEXT,
      code_link TEXT,
      notes TEXT,
      feedback_score INTEGER DEFAULT 88,
      mentor_feedback TEXT,
      status TEXT DEFAULT 'Submitted', -- 'Submitted', 'Reviewed'
      submitted_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES industry_projects(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Skills
    await _db.exec(`CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      category TEXT DEFAULT 'Technical'
    )`);

    await _db.exec(`CREATE TABLE IF NOT EXISTS user_skills (
      user_id INTEGER NOT NULL,
      skill_id INTEGER NOT NULL,
      level INTEGER DEFAULT 50,
      confidence REAL DEFAULT 0.8,
      category TEXT DEFAULT 'Technical',
      created_at INTEGER,
      PRIMARY KEY (user_id, skill_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(skill_id) REFERENCES skills(id) ON DELETE CASCADE
    )`);

    // Projects
    await _db.exec(`CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      technologies TEXT,
      github_url TEXT,
      demo_url TEXT,
      category TEXT,
      team_size INTEGER DEFAULT 1,
      role TEXT,
      start_date TEXT,
      end_date TEXT,
      doc_url TEXT,
      ai_complexity INTEGER DEFAULT 80,
      created_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Certifications
    await _db.exec(`CREATE TABLE IF NOT EXISTS certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      organization TEXT NOT NULL,
      issued_at TEXT,
      expiry_at TEXT,
      credential_id TEXT,
      credential_url TEXT,
      certificate_url TEXT,
      status TEXT DEFAULT 'Pending Verification',
      created_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Career Preferences
    await _db.exec(`CREATE TABLE IF NOT EXISTS career_preferences (
      user_id INTEGER PRIMARY KEY,
      target_role TEXT,
      preferred_roles TEXT,
      preferred_industries TEXT,
      preferred_locations TEXT,
      preferred_companies TEXT,
      updated_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Jobs and Internships
    await _db.exec(`CREATE TABLE IF NOT EXISTS jobs_internships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      company_name TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      required_skills TEXT,
      preferred_skills TEXT,
      qualification TEXT,
      experience TEXT,
      location TEXT,
      work_mode TEXT DEFAULT 'Hybrid',
      salary_stipend TEXT,
      openings INTEGER DEFAULT 1,
      deadline TEXT,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(company_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Applications
    await _db.exec(`CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      opportunity_id INTEGER NOT NULL,
      status TEXT DEFAULT 'Applied',
      match_score INTEGER DEFAULT 85,
      notes TEXT,
      updated_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(opportunity_id) REFERENCES jobs_internships(id) ON DELETE CASCADE
    )`);

    // Interviews
    await _db.exec(`CREATE TABLE IF NOT EXISTS interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT DEFAULT 'Technical Round',
      meeting_link TEXT,
      instructions TEXT,
      status TEXT DEFAULT 'Scheduled',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(application_id) REFERENCES applications(id) ON DELETE CASCADE,
      FOREIGN KEY(company_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Messages
    await _db.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // Notifications
    await _db.exec(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      is_read INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    // AI Scoring Rules
    await _db.exec(`CREATE TABLE IF NOT EXISTS scoring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT UNIQUE NOT NULL,
      weight INTEGER NOT NULL
    )`);

    const ruleCount = await _db.get('SELECT COUNT(*) as count FROM scoring_rules');
    if (ruleCount && ruleCount.count === 0) {
      const defaultRules = [
        { category: 'Technical Skills', weight: 25 },
        { category: 'Projects', weight: 20 },
        { category: 'Certifications', weight: 10 },
        { category: 'Education', weight: 10 },
        { category: 'Internship Experience', weight: 10 },
        { category: 'Resume Quality', weight: 10 },
        { category: 'Soft Skills', weight: 5 },
        { category: 'Career Alignment', weight: 10 }
      ];
      for (const r of defaultRules) {
        await _db.run('INSERT INTO scoring_rules (category, weight) VALUES (?, ?)', r.category, r.weight);
      }
    }

  } catch (e) {
    console.error('DB init error', e && e.message);
    _db = null;
  }
  return _db;
}

// User Helpers
async function createUser({ email, username, passwordHash, salt, role, dob }) {
  const db = await init();
  const now = Date.now();
  try {
    const res = await db.run(
      'INSERT INTO users (email, username, password_hash, salt, role, dob, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      email.toLowerCase(), username.toLowerCase(), passwordHash, salt, role || 'student', dob || null, now
    );
    return { id: res.lastID, email: email.toLowerCase(), username: username.toLowerCase(), role: role || 'student' };
  } catch (e) { console.error('createUser error', e && e.message); return null; }
}

async function getUserByEmail(email) {
  const db = await init();
  if (!email) return null;
  try {
    return await db.get('SELECT * FROM users WHERE lower(email) = lower(?)', email);
  } catch (e) { console.error('getUserByEmail error', e && e.message); return null; }
}

async function getUserByUsername(username) {
  const db = await init();
  if (!username) return null;
  try {
    return await db.get('SELECT * FROM users WHERE lower(username) = lower(?)', username);
  } catch (e) { console.error('getUserByUsername error', e && e.message); return null; }
}

async function getUserById(id) {
  const db = await init();
  if (!id) return null;
  try {
    return await db.get('SELECT * FROM users WHERE id = ?', id);
  } catch (e) { console.error('getUserById error', e && e.message); return null; }
}

async function getAllUsers() {
  const db = await init();
  try { return await db.all('SELECT * FROM users ORDER BY id'); }
  catch (e) { console.error('getAllUsers error', e && e.message); return []; }
}

// Profile Helpers
async function createOrUpdateStudentProfile(userId, profile) {
  const db = await init();
  try {
    const exists = await db.get('SELECT 1 FROM student_profiles WHERE user_id = ?', userId);
    if (exists) {
      await db.run(
        `UPDATE student_profiles SET 
          name = COALESCE(?, name),
          college = COALESCE(?, college),
          university = COALESCE(?, university),
          degree = COALESCE(?, degree),
          department = COALESCE(?, department),
          year_of_study = COALESCE(?, year_of_study),
          graduation_year = COALESCE(?, graduation_year),
          cgpa = COALESCE(?, cgpa),
          phone = COALESCE(?, phone),
          location = COALESCE(?, location),
          photo_url = COALESCE(?, photo_url),
          resume_url = COALESCE(?, resume_url),
          bio = COALESCE(?, bio),
          goal = COALESCE(?, goal),
          portfolio_visibility = COALESCE(?, portfolio_visibility)
        WHERE user_id = ?`,
        profile.name, profile.college, profile.university, profile.degree, profile.department,
        profile.year_of_study, profile.graduation_year, profile.cgpa, profile.phone,
        profile.location, profile.photo_url, profile.resume_url, profile.bio, profile.goal,
        profile.portfolio_visibility, userId
      );
    } else {
      await db.run(
        `INSERT INTO student_profiles 
        (user_id, name, college, university, degree, department, year_of_study, graduation_year, cgpa, phone, location, photo_url, resume_url, bio, goal, portfolio_visibility)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId, profile.name || '', profile.college || '', profile.university || '', profile.degree || '',
        profile.department || '', profile.year_of_study || '', profile.graduation_year || null, profile.cgpa ?? null,
        profile.phone || '', profile.location || '', profile.photo_url || '', profile.resume_url || '',
        profile.bio || '', profile.goal || '', profile.portfolio_visibility || 'public'
      );
    }
    return await getStudentProfileByUserId(userId);
  } catch (e) { console.error('createOrUpdateStudentProfile error', e && e.message); return null; }
}

async function getStudentProfileByUserId(userId) {
  const db = await init();
  try {
    return await db.get('SELECT * FROM student_profiles WHERE user_id = ?', userId);
  } catch (e) { console.error('getStudentProfileByUserId error', e && e.message); return null; }
}

module.exports = {
  init,
  createUser,
  getUserByEmail,
  getUserByUsername,
  getUserById,
  getAllUsers,
  createOrUpdateStudentProfile,
  getStudentProfileByUserId
};

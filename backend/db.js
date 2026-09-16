const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs');

const root = __dirname;

const dbFile =
  process.env.DB_FILE_PATH ||
  (process.env.VERCEL
    ? path.join('/tmp', 'skillmap.db')
    : path.join(root, 'skillmap.db'));

let _db = null;

async function init() {
  if (_db) return _db;

  try {
    const dbDir = path.dirname(dbFile);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    _db = await open({
      filename: dbFile,
      driver: sqlite3.Database
    });

    await _db.exec(`PRAGMA foreign_keys = ON;`);

    // ----------------------------------------------------
    // USERS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL,
        dob TEXT,
        verified INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      )
    `);

    // ----------------------------------------------------
    // STUDENT PROFILES
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS student_profiles (
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
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // COMPANY PROFILES
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS company_profiles (
        user_id INTEGER PRIMARY KEY,
        company_name TEXT NOT NULL,
        logo_url TEXT,
        industry TEXT,
        description TEXT,
        website TEXT,
        location TEXT,
        verified INTEGER DEFAULT 0,
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // COLLEGE PROFILES
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS college_profiles (
        user_id INTEGER PRIMARY KEY,
        college_name TEXT NOT NULL,
        code TEXT,
        location TEXT,
        website TEXT,
        verified INTEGER DEFAULT 0,
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // MENTORS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS mentors (
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
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // SKILL EXCHANGE POSTS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS skill_exchange_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        author_name TEXT NOT NULL,
        user_role TEXT NOT NULL,
        exchange_type TEXT NOT NULL,
        skill_offered TEXT NOT NULL,
        skill_requested TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'Open',
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // EXPERT QUESTIONS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS expert_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        student_name TEXT NOT NULL,
        title TEXT NOT NULL,
        question TEXT NOT NULL,
        category TEXT DEFAULT 'Career Guidance',
        upvotes INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(student_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // EXPERT ANSWERS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS expert_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER NOT NULL,
        mentor_id INTEGER NOT NULL,
        mentor_name TEXT NOT NULL,
        mentor_title TEXT NOT NULL,
        answer TEXT NOT NULL,
        is_verified INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(question_id)
          REFERENCES expert_questions(id)
          ON DELETE CASCADE,
        FOREIGN KEY(mentor_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // INDUSTRY PROJECTS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS industry_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mentor_id INTEGER NOT NULL,
        mentor_name TEXT NOT NULL,
        company_name TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        required_skills TEXT NOT NULL,
        difficulty TEXT DEFAULT 'Intermediate',
        created_at INTEGER NOT NULL,
        FOREIGN KEY(mentor_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // PROJECT SUBMISSIONS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS project_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        student_name TEXT NOT NULL,
        submission_url TEXT,
        code_link TEXT,
        notes TEXT,
        feedback_score INTEGER DEFAULT 88,
        mentor_feedback TEXT,
        status TEXT DEFAULT 'Submitted',
        submitted_at INTEGER NOT NULL,
        FOREIGN KEY(project_id)
          REFERENCES industry_projects(id)
          ON DELETE CASCADE,
        FOREIGN KEY(student_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // SKILLS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        category TEXT DEFAULT 'Technical'
      )
    `);

    // ----------------------------------------------------
    // USER SKILLS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS user_skills (
        user_id INTEGER NOT NULL,
        skill_id INTEGER NOT NULL,
        level INTEGER DEFAULT 50,
        confidence REAL DEFAULT 0.8,
        category TEXT DEFAULT 'Technical',
        created_at INTEGER,
        PRIMARY KEY (user_id, skill_id),
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE,
        FOREIGN KEY(skill_id)
          REFERENCES skills(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // PROJECTS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
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
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // CERTIFICATIONS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS certifications (
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
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);
    // ----------------------------------------------------
    // CAREER PREFERENCES
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS career_preferences (
        user_id INTEGER PRIMARY KEY,
        target_role TEXT,
        preferred_roles TEXT,
        preferred_industries TEXT,
        preferred_locations TEXT,
        preferred_companies TEXT,
        updated_at INTEGER,
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // JOBS & INTERNSHIPS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS jobs_internships (
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
        FOREIGN KEY(company_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // APPLICATIONS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        opportunity_id INTEGER NOT NULL,
        status TEXT DEFAULT 'Applied',
        match_score INTEGER DEFAULT 0,
        notes TEXT,
        updated_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(student_id)
          REFERENCES users(id)
          ON DELETE CASCADE,
        FOREIGN KEY(opportunity_id)
          REFERENCES jobs_internships(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // INTERVIEWS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS interviews (
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
        FOREIGN KEY(application_id)
          REFERENCES applications(id)
          ON DELETE CASCADE,
        FOREIGN KEY(company_id)
          REFERENCES users(id)
          ON DELETE CASCADE,
        FOREIGN KEY(student_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // MESSAGES
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(sender_id)
          REFERENCES users(id)
          ON DELETE CASCADE,
        FOREIGN KEY(receiver_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // NOTIFICATIONS
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        link TEXT,
        is_read INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(user_id)
          REFERENCES users(id)
          ON DELETE CASCADE
      )
    `);

    // ----------------------------------------------------
    // AI SCORING RULES
    // ----------------------------------------------------
    await _db.exec(`
      CREATE TABLE IF NOT EXISTS scoring_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT UNIQUE NOT NULL,
        weight INTEGER NOT NULL
      )
    `);

    // Add default scoring rules only when the table is empty.
    const ruleCount = await _db.get(
      'SELECT COUNT(*) AS count FROM scoring_rules'
    );

    if (ruleCount && ruleCount.count === 0) {
      const defaultRules = [
        {
          category: 'Technical Skills',
          weight: 25
        },
        {
          category: 'Projects',
          weight: 20
        },
        {
          category: 'Certifications',
          weight: 10
        },
        {
          category: 'Education',
          weight: 10
        },
        {
          category: 'Internship Experience',
          weight: 10
        },
        {
          category: 'Resume Quality',
          weight: 10
        },
        {
          category: 'Soft Skills',
          weight: 5
        },
        {
          category: 'Career Alignment',
          weight: 10
        }
      ];

      for (const rule of defaultRules) {
        await _db.run(
          `INSERT INTO scoring_rules
           (category, weight)
           VALUES (?, ?)`,
          rule.category,
          rule.weight
        );
      }
    }

    return _db;

  } catch (error) {
    console.error(
      'DB init error:',
      error && error.message
    );

    _db = null;
    return null;
  }
}


// ========================================================
// USER HELPERS
// ========================================================

async function createUser({
  email,
  username,
  passwordHash,
  salt,
  role,
  dob
}) {
  const db = await init();

  if (!db) {
    console.error('Database is not available.');
    return null;
  }

  if (!email || !username || !passwordHash || !salt) {
    console.error('createUser: required user fields are missing.');
    return null;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedUsername = String(username).trim().toLowerCase();

  const now = Date.now();

  try {
    const existingEmail = await db.get(
      'SELECT id FROM users WHERE lower(email) = lower(?)',
      normalizedEmail
    );

    if (existingEmail) {
      console.error(
        'createUser: email already exists.'
      );
      return null;
    }

    const existingUsername = await db.get(
      'SELECT id FROM users WHERE lower(username) = lower(?)',
      normalizedUsername
    );

    if (existingUsername) {
      console.error(
        'createUser: username already exists.'
      );
      return null;
    }

    const result = await db.run(
      `INSERT INTO users
       (
         email,
         username,
         password_hash,
         salt,
         role,
         dob,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      normalizedEmail,
      normalizedUsername,
      passwordHash,
      salt,
      role || 'student',
      dob || null,
      now
    );

    return {
      id: result.lastID,
      email: normalizedEmail,
      username: normalizedUsername,
      role: role || 'student'
    };

  } catch (error) {
    console.error(
      'createUser error:',
      error && error.message
    );

    return null;
  }
}


// ========================================================
// GET USER BY EMAIL
// ========================================================

async function getUserByEmail(email) {
  const db = await init();

  if (!db || !email) {
    return null;
  }

  try {
    return await db.get(
      `SELECT *
       FROM users
       WHERE lower(email) = lower(?)`,
      String(email).trim()
    );

  } catch (error) {
    console.error(
      'getUserByEmail error:',
      error && error.message
    );

    return null;
  }
}


// ========================================================
// GET USER BY USERNAME
// ========================================================

async function getUserByUsername(username) {
  const db = await init();

  if (!db || !username) {
    return null;
  }

  try {
    return await db.get(
      `SELECT *
       FROM users
       WHERE lower(username) = lower(?)`,
      String(username).trim()
    );

  } catch (error) {
    console.error(
      'getUserByUsername error:',
      error && error.message
    );

    return null;
  }
}


// ========================================================
// GET USER BY ID
// ========================================================

async function getUserById(id) {
  const db = await init();

  if (!db || !id) {
    return null;
  }

  try {
    return await db.get(
      `SELECT *
       FROM users
       WHERE id = ?`,
      id
    );

  } catch (error) {
    console.error(
      'getUserById error:',
      error && error.message
    );

    return null;
  }
}


// ========================================================
// GET ALL USERS
// ========================================================

async function getAllUsers() {
  const db = await init();

  if (!db) {
    return [];
  }

  try {
    return await db.all(
      `SELECT *
       FROM users
       ORDER BY id`
    );

  } catch (error) {
    console.error(
      'getAllUsers error:',
      error && error.message
    );

    return [];
  }
}


// ========================================================
// STUDENT PROFILE
// ========================================================

async function createOrUpdateStudentProfile(
  userId,
  profile
) {
  const db = await init();

  if (!db || !userId || !profile) {
    return null;
  }

  try {
    const exists = await db.get(
      `SELECT 1
       FROM student_profiles
       WHERE user_id = ?`,
      userId
    );

    if (exists) {
      await db.run(
        `UPDATE student_profiles
         SET
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
           portfolio_visibility =
             COALESCE(?, portfolio_visibility)
         WHERE user_id = ?`,
        profile.name,
        profile.college,
        profile.university,
        profile.degree,
        profile.department,
        profile.year_of_study,
        profile.graduation_year,
        profile.cgpa,
        profile.phone,
        profile.location,
        profile.photo_url,
        profile.resume_url,
        profile.bio,
        profile.goal,
        profile.portfolio_visibility,
        userId
      );

    } else {
      await db.run(
        `INSERT INTO student_profiles
         (
           user_id,
           name,
           college,
           university,
           degree,
           department,
           year_of_study,
           graduation_year,
           cgpa,
           phone,
           location,
           photo_url,
           resume_url,
           bio,
           goal,
           portfolio_visibility
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        userId,
        profile.name || '',
        profile.college || '',
        profile.university || '',
        profile.degree || '',
        profile.department || '',
        profile.year_of_study || '',
        profile.graduation_year || null,
        profile.cgpa ?? null,
        profile.phone || '',
        profile.location || '',
        profile.photo_url || '',
        profile.resume_url || '',
        profile.bio || '',
        profile.goal || '',
        profile.portfolio_visibility || 'public'
      );
    }

    return await getStudentProfileByUserId(userId);

  } catch (error) {
    console.error(
      'createOrUpdateStudentProfile error:',
      error && error.message
    );

    return null;
  }
}


// ========================================================
// GET STUDENT PROFILE
// ========================================================

async function getStudentProfileByUserId(userId) {
  const db = await init();

  if (!db || !userId) {
    return null;
  }

  try {
    return await db.get(
      `SELECT *
       FROM student_profiles
       WHERE user_id = ?`,
      userId
    );

  } catch (error) {
    console.error(
      'getStudentProfileByUserId error:',
      error && error.message
    );

    return null;
  }
}
// ========================================================
// MODULE EXPORTS
// ========================================================

module.exports = {
  init,

  // User functions
  createUser,
  getUserByEmail,
  getUserByUsername,
  getUserById,
  getAllUsers,

  // Student profile functions
  createOrUpdateStudentProfile,
  getStudentProfileByUserId
};
const fs = require('fs');
const path = require('path');
const { pool, init } = require('./connection');

const root = path.resolve(__dirname, '..', '..');
const legacyJsonPath = path.join(root, 'data', 'skillbridge-state.json');

async function strengthenProfileSchema(client) {
  for (const table of ['student_profiles', 'company_profiles']) {
    const column = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'user_id'
    `, [table]);
    if (column.rows[0] && column.rows[0].data_type === 'text') {
      const invalid = await client.query(`SELECT 1 FROM ${table} WHERE user_id !~ '^[0-9]+$' LIMIT 1`);
      if (invalid.rowCount) throw new Error(`${table}.user_id contains non-numeric legacy IDs; refusing unsafe FK conversion`);
      await client.query(`ALTER TABLE ${table} ALTER COLUMN user_id TYPE bigint USING user_id::bigint`);
    }
    const constraint = await client.query(`
      SELECT 1 FROM pg_constraint
      WHERE conrelid = $1::regclass AND conname = $2
    `, [table, `${table}_user_id_fkey`]);
    if (!constraint.rowCount) {
      await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`);
    }
  }
}

async function importLegacyJson(client) {
  if (!fs.existsSync(legacyJsonPath)) return 0;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(legacyJsonPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse ${legacyJsonPath}: ${error.message}`);
  }

  const marker = 'legacy-json-skillbridge-state-v2';
  const alreadyApplied = await client.query('SELECT 1 FROM migration_history WHERE name = $1', [marker]);
  if (alreadyApplied.rowCount) return 0;

  let imported = 0;
  for (const user of Array.isArray(state.users) ? state.users : []) {
    if (!user.email || !user.username || !user.password_hash || !user.salt) continue;
    const numericId = Number.isSafeInteger(Number(user.id)) && Number(user.id) > 0 ? Number(user.id) : null;
    await client.query(numericId ? `
      INSERT INTO users (id, email, username, password_hash, salt, role, dob, mobile, verified, is_active, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT DO NOTHING
    ` : `
      INSERT INTO users (email, username, password_hash, salt, role, dob, mobile, verified, is_active, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT DO NOTHING
    `, [
      ...(numericId ? [numericId] : []),
      String(user.email).trim().toLowerCase(), String(user.username).trim().toLowerCase(),
      user.password_hash, user.salt, user.role || 'student', user.dob || null,
      user.mobile || '', Number(user.verified ?? 1), Number(user.is_active ?? 1),
      Number(user.created_at) || Date.now()
    ]);
    imported++;
  }
  await client.query(`SELECT setval(pg_get_serial_sequence('users', 'id'),
    COALESCE((SELECT MAX(id) FROM users), 1), true)`);

  const collectionSources = {
    jobs: 'jobs', applications: 'applications', notifications: 'notifications', offers: 'companyOffers',
    student_skills: 'userSkills', assessments: 'assessments', projects: 'projects',
    certifications: 'certifications', student_resumes: 'resumes',
    student_academics: 'academicRecords', student_academic_summary: 'schoolEducation',
    student_preferences: 'preferences', student_placements: 'studentPlacements',
    campus_registrations: 'campusRegistrations', user_settings: 'userSettings',
    internships: 'internships', seminars: 'seminars', workshops: 'workshops',
    hackathons: 'hackathons', achievements: 'achievements', coding_skills: 'codingSkills',
    backlogs: 'backlogs'
  };
  for (const [collection, sourceKey] of Object.entries(collectionSources)) {
    const value = state[sourceKey];
    const records = [];
    if (Array.isArray(value)) records.push(...value);
    else if (value && typeof value === 'object') {
      for (const [userId, item] of Object.entries(value)) {
        for (const record of (Array.isArray(item) ? item : [item])) {
          if (record && typeof record === 'object') records.push({ ...record, user_id: record.user_id ?? userId });
        }
      }
    }
    for (const [recordIndex, record] of records.entries()) {
      if (!record || record.id === undefined || record.id === null) {
        if (!record || record.user_id === undefined) continue;
        record.id = `${record.user_id}-${record.drive_id || recordIndex}-${collection}`;
      }
      await client.query(`
        INSERT INTO workflow_records (collection_name, record_id, data)
        VALUES ($1,$2,$3::jsonb)
        ON CONFLICT (collection_name, record_id) DO NOTHING
      `, [collection, String(record.id), JSON.stringify(record)]);
      imported++;
    }
  }

  for (const [table, key] of [['student_profiles', 'studentProfiles'], ['company_profiles', 'companyProfiles']]) {
    const profiles = state[key] && typeof state[key] === 'object' ? state[key] : {};
    for (const [userId, profile] of Object.entries(profiles)) {
      if (!/^\d+$/.test(String(userId)) || !profile || typeof profile !== 'object') continue;
      await client.query(`
        INSERT INTO ${table} (user_id, profile)
        SELECT $1::bigint, $2::jsonb
        WHERE EXISTS (SELECT 1 FROM users WHERE id = $1::bigint)
        ON CONFLICT (user_id) DO NOTHING
      `, [String(userId), JSON.stringify({ ...profile, user_id: userId })]);
      imported++;
    }
  }

  await client.query('INSERT INTO migration_history(name) VALUES ($1)', [marker]);
  return imported;
}

async function migrate() {
  await init();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await strengthenProfileSchema(client);
    const imported = await importLegacyJson(client);
    await client.query('COMMIT');
    console.log(`PostgreSQL schema is up to date${imported ? `; imported ${imported} legacy records` : ''}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate().catch(error => {
    console.error('PostgreSQL migration failed:', error.message);
    process.exitCode = 1;
  }).finally(() => pool.end());
}

module.exports = { migrate };

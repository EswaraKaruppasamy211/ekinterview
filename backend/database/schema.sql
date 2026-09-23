CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (length(trim(role)) > 0),
  dob TEXT,
  mobile TEXT DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at BIGINT NOT NULL DEFAULT (extract(epoch from now()) * 1000)::bigint
);
CREATE TABLE IF NOT EXISTS student_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workflow_records (
  collection_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_name, record_id)
);
CREATE INDEX IF NOT EXISTS workflow_records_data_idx ON workflow_records USING GIN (data);
CREATE INDEX IF NOT EXISTS workflow_records_collection_created_idx ON workflow_records (collection_name, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_records_id_idx ON workflow_records (collection_name, ((data->>'id')));
CREATE INDEX IF NOT EXISTS workflow_records_user_idx ON workflow_records (collection_name, ((data->>'user_id')));
CREATE TABLE IF NOT EXISTS academia_records (
  resource TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (resource, id)
);
CREATE INDEX IF NOT EXISTS academia_records_data_idx ON academia_records USING GIN (data);
CREATE INDEX IF NOT EXISTS academia_records_resource_created_idx ON academia_records (resource, created_at DESC);
CREATE INDEX IF NOT EXISTS academia_records_created_by_idx ON academia_records (resource, ((data->>'created_by')));
CREATE TABLE IF NOT EXISTS faculty_student_authorizations (
  faculty_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  university_id TEXT NOT NULL DEFAULT '',
  university_name TEXT NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (faculty_user_id, student_user_id)
);
CREATE INDEX IF NOT EXISTS faculty_student_authorizations_student_idx ON faculty_student_authorizations (student_user_id, is_active);
CREATE INDEX IF NOT EXISTS faculty_student_authorizations_university_idx ON faculty_student_authorizations (university_id, is_active);
CREATE TABLE IF NOT EXISTS migration_history (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Canon Lock Cloud schema (Postgres).
-- Identical to SCHEMA_SQL in lib/store/postgres.ts. Every statement is
-- idempotent: apply with `npm run db:migrate`, or let the server apply
-- it on boot via PostgresStore.ensureSchema().
--
-- ids are UUID strings generated in code (TEXT columns). locks and
-- check rows are JSONB. Scene text is never stored in any table: a
-- check row holds the verdict and the quoted evidence lines only.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  locks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS checks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL,
  banner TEXT NOT NULL,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_checks_project ON checks(project_id);

import { Pool } from "pg";
import type { Lock } from "../matcher/matcher.ts";
import type {
  CheckRecord,
  NewCheck,
  Project,
  Session,
  Store,
  User,
} from "./types.ts";

/**
 * POSTGRES STORE: the durable Store implementation, selected when
 * DATABASE_URL is set (see lib/store/index.ts). Works against any
 * Postgres reachable by connection string: Neon, Supabase, RDS, local.
 *
 * The schema lives in SCHEMA_SQL below and, identically, in
 * db/schema.sql for review. Every statement is idempotent
 * (IF NOT EXISTS), so ensureSchema() is safe on every boot and
 * `npm run db:migrate` is safe to re-run.
 *
 * Data model notes:
 * - ids are UUID strings generated in code (TEXT columns), matching
 *   the in-memory adapter exactly.
 * - locks and check rows are JSONB; scene text appears in neither,
 *   here or anywhere else.
 * - emails are stored normalized (trimmed, lowercased).
 */

export const SCHEMA_SQL = `
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
`;

/** The slice of a pg Pool this adapter uses. Tests inject a fake. */
export interface PgQueryable {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toUser(row: Row): User {
  return {
    id: row.id as string,
    email: row.email as string,
    passwordHash: row.password_hash as string,
    createdAt: iso(row.created_at),
  };
}

function toSession(row: Row): Session {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    tokenHash: row.token_hash as string,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
}

function toProject(row: Row): Project {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    name: row.name as string,
    isDemo: row.is_demo as boolean,
    locks: (row.locks ?? []) as Lock[],
    createdAt: iso(row.created_at),
  };
}

function toRecord(row: Row): CheckRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    createdAt: iso(row.created_at),
    verdict: row.verdict as CheckRecord["verdict"],
    banner: row.banner as string,
    rows: (row.rows ?? []) as CheckRecord["rows"],
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const USER_COLS = "id, email, password_hash, created_at";
const SESSION_COLS = "id, user_id, token_hash, created_at, expires_at";
const PROJECT_COLS = "id, owner_id, name, is_demo, locks, created_at";
const CHECK_COLS = "id, project_id, verdict, banner, rows, created_at";

export class PostgresStore implements Store {
  private pool: PgQueryable;

  constructor(connectionString: string, pool?: PgQueryable) {
    this.pool =
      pool ??
      (new Pool({ connectionString }) as unknown as PgQueryable);
  }

  /** Idempotent: safe to call on every boot. */
  async ensureSchema(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async createUser(
    email: string,
    passwordHash: string
  ): Promise<User | undefined> {
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, email, password_hash, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${USER_COLS}`,
      [crypto.randomUUID(), normalizeEmail(email), passwordHash, new Date().toISOString()]
    );
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const { rows } = await this.pool.query(
      `SELECT ${USER_COLS} FROM users WHERE email = $1`,
      [normalizeEmail(email)]
    );
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const { rows } = await this.pool.query(
      `SELECT ${USER_COLS} FROM users WHERE id = $1`,
      [id]
    );
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async createSession(session: Session): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        session.id,
        session.userId,
        session.tokenHash,
        session.createdAt,
        session.expiresAt,
      ]
    );
  }

  async getSession(tokenHash: string): Promise<Session | undefined> {
    const { rows } = await this.pool.query(
      `SELECT ${SESSION_COLS} FROM sessions WHERE token_hash = $1`,
      [tokenHash]
    );
    return rows[0] ? toSession(rows[0]) : undefined;
  }

  async deleteSession(tokenHash: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM sessions WHERE token_hash = $1`,
      [tokenHash]
    );
    return (rowCount ?? 0) > 0;
  }

  async listProjects(ownerId: string): Promise<Project[]> {
    const { rows } = await this.pool.query(
      `SELECT ${PROJECT_COLS} FROM projects WHERE owner_id = $1 ORDER BY created_at ASC`,
      [ownerId]
    );
    return rows.map(toProject);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const { rows } = await this.pool.query(
      `SELECT ${PROJECT_COLS} FROM projects WHERE id = $1`,
      [id]
    );
    return rows[0] ? toProject(rows[0]) : undefined;
  }

  async getDemoProject(): Promise<Project | undefined> {
    const { rows } = await this.pool.query(
      `SELECT ${PROJECT_COLS} FROM projects WHERE is_demo = true ORDER BY created_at ASC LIMIT 1`
    );
    return rows[0] ? toProject(rows[0]) : undefined;
  }

  async createProject(
    name: string,
    ownerId: string,
    opts?: { isDemo?: boolean }
  ): Promise<Project> {
    const { rows } = await this.pool.query(
      `INSERT INTO projects (id, owner_id, name, is_demo, locks, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING ${PROJECT_COLS}`,
      [
        crypto.randomUUID(),
        ownerId,
        name,
        opts?.isDemo ?? false,
        JSON.stringify([]),
        new Date().toISOString(),
      ]
    );
    return toProject(rows[0]);
  }

  async deleteProject(id: string): Promise<boolean> {
    // Check rows go with it: checks.project_id has ON DELETE CASCADE.
    const { rowCount } = await this.pool.query(
      `DELETE FROM projects WHERE id = $1`,
      [id]
    );
    return (rowCount ?? 0) > 0;
  }

  async setLocks(id: string, locks: Lock[]): Promise<Project | undefined> {
    const { rows } = await this.pool.query(
      `UPDATE projects SET locks = $2::jsonb WHERE id = $1 RETURNING ${PROJECT_COLS}`,
      [id, JSON.stringify(locks)]
    );
    return rows[0] ? toProject(rows[0]) : undefined;
  }

  async listChecks(projectId: string): Promise<CheckRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT ${CHECK_COLS} FROM checks WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    return rows.map(toRecord);
  }

  async addCheck(
    projectId: string,
    check: NewCheck
  ): Promise<CheckRecord | undefined> {
    if (!(await this.getProject(projectId))) return undefined;
    const { rows } = await this.pool.query(
      `INSERT INTO checks (id, project_id, verdict, banner, rows, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       RETURNING ${CHECK_COLS}`,
      [
        crypto.randomUUID(),
        projectId,
        check.verdict,
        check.banner,
        JSON.stringify(check.rows),
        new Date().toISOString(),
      ]
    );
    return rows[0] ? toRecord(rows[0]) : undefined;
  }
}

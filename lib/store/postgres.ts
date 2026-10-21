import { Pool } from "pg";
import type { Lock } from "../matcher/matcher.ts";
import type {
  ApiKey,
  AuditEntry,
  BillingSession,
  BillingStatus,
  CheckRecord,
  NewAuditEntry,
  NewCheck,
  Project,
  Session,
  Store,
  Tier,
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
 * - api_keys stores only the SHA-256 hash of each key, never the key.
 * - audit_log deliberately has no foreign keys: an audit trail should
 *   survive deletion of the project, key, or account it references.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'Free',
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'Free';
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
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  key_id TEXT,
  user_id TEXT,
  project_id TEXT,
  verdict TEXT,
  status_code INTEGER NOT NULL,
  event TEXT
);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS event TEXT;
CREATE TABLE IF NOT EXISTS billing_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_checks_project ON checks(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_sessions_user ON billing_sessions(user_id);
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
    tier: (row.tier as Tier | undefined) ?? "Free",
    createdAt: iso(row.created_at),
  };
}

function toApiKey(row: Row): ApiKey {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    keyHash: row.key_hash as string,
    prefix: row.prefix as string,
    createdAt: iso(row.created_at),
    lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null,
    revoked: row.revoked as boolean,
  };
}

function toAuditEntry(row: Row): AuditEntry {
  return {
    id: row.id as string,
    createdAt: iso(row.created_at),
    keyId: (row.key_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    verdict: (row.verdict as AuditEntry["verdict"]) ?? null,
    statusCode: row.status_code as number,
    event: (row.event as string | null) ?? null,
  };
}

function toBillingSession(row: Row): BillingSession {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    tier: row.tier as Tier,
    priceCents: row.price_cents as number,
    status: row.status as BillingStatus,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
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

const USER_COLS = "id, email, password_hash, tier, created_at";
const SESSION_COLS = "id, user_id, token_hash, created_at, expires_at";
const PROJECT_COLS = "id, owner_id, name, is_demo, locks, created_at";
const CHECK_COLS = "id, project_id, verdict, banner, rows, created_at";
const API_KEY_COLS =
  "id, user_id, name, key_hash, prefix, created_at, last_used_at, revoked";
const AUDIT_COLS =
  "id, created_at, key_id, user_id, project_id, verdict, status_code, event";
const BILLING_COLS =
  "id, user_id, tier, price_cents, status, created_at, updated_at, completed_at";

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
    passwordHash: string,
    opts?: { tier?: Tier }
  ): Promise<User | undefined> {
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, email, password_hash, tier, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING
       RETURNING ${USER_COLS}`,
      [
        crypto.randomUUID(),
        normalizeEmail(email),
        passwordHash,
        opts?.tier ?? "Free",
        new Date().toISOString(),
      ]
    );
    return rows[0] ? toUser(rows[0]) : undefined;
  }

  async setUserTier(id: string, tier: Tier): Promise<User | undefined> {
    const { rows } = await this.pool.query(
      `UPDATE users SET tier = $2 WHERE id = $1 RETURNING ${USER_COLS}`,
      [id, tier]
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

  async createApiKey(key: ApiKey): Promise<ApiKey> {
    const { rows } = await this.pool.query(
      `INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at, last_used_at, revoked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${API_KEY_COLS}`,
      [
        key.id,
        key.userId,
        key.name,
        key.keyHash,
        key.prefix,
        key.createdAt,
        key.lastUsedAt,
        key.revoked,
      ]
    );
    return toApiKey(rows[0]);
  }

  async listApiKeys(userId: string): Promise<ApiKey[]> {
    const { rows } = await this.pool.query(
      `SELECT ${API_KEY_COLS} FROM api_keys WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );
    return rows.map(toApiKey);
  }

  async getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined> {
    const { rows } = await this.pool.query(
      `SELECT ${API_KEY_COLS} FROM api_keys WHERE key_hash = $1`,
      [keyHash]
    );
    return rows[0] ? toApiKey(rows[0]) : undefined;
  }

  async revokeApiKey(id: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE api_keys SET revoked = true WHERE id = $1 AND user_id = $2 AND revoked = false`,
      [id, userId]
    );
    return (rowCount ?? 0) > 0;
  }

  async touchApiKey(id: string, at: string): Promise<void> {
    await this.pool.query(
      `UPDATE api_keys SET last_used_at = $2 WHERE id = $1`,
      [id, at]
    );
  }

  async addAuditEntry(entry: NewAuditEntry): Promise<AuditEntry> {
    const { rows } = await this.pool.query(
      `INSERT INTO audit_log (id, created_at, key_id, user_id, project_id, verdict, status_code, event)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${AUDIT_COLS}`,
      [
        crypto.randomUUID(),
        new Date().toISOString(),
        entry.keyId,
        entry.userId,
        entry.projectId,
        entry.verdict,
        entry.statusCode,
        entry.event ?? null,
      ]
    );
    return toAuditEntry(rows[0]);
  }

  async listAuditEntries(
    userId: string,
    limit = 50
  ): Promise<AuditEntry[]> {
    const { rows } = await this.pool.query(
      `SELECT ${AUDIT_COLS} FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return rows.map(toAuditEntry);
  }

  async createBillingSession(
    session: BillingSession
  ): Promise<BillingSession> {
    const { rows } = await this.pool.query(
      `INSERT INTO billing_sessions (id, user_id, tier, price_cents, status, created_at, updated_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${BILLING_COLS}`,
      [
        session.id,
        session.userId,
        session.tier,
        session.priceCents,
        session.status,
        session.createdAt,
        session.updatedAt,
        session.completedAt,
      ]
    );
    return toBillingSession(rows[0]);
  }

  async getBillingSession(
    id: string
  ): Promise<BillingSession | undefined> {
    const { rows } = await this.pool.query(
      `SELECT ${BILLING_COLS} FROM billing_sessions WHERE id = $1`,
      [id]
    );
    return rows[0] ? toBillingSession(rows[0]) : undefined;
  }

  async setBillingSessionStatus(
    id: string,
    status: BillingStatus
  ): Promise<BillingSession | undefined> {
    const now = new Date().toISOString();
    const { rows } = await this.pool.query(
      `UPDATE billing_sessions
       SET status = $2, updated_at = $3,
           completed_at = CASE WHEN $2 = 'complete'
                               THEN COALESCE(completed_at, $3)
                               ELSE completed_at END
       WHERE id = $1
       RETURNING ${BILLING_COLS}`,
      [id, status, now]
    );
    return rows[0] ? toBillingSession(rows[0]) : undefined;
  }
}

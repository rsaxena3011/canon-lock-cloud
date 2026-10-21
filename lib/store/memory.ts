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
 * IN-MEMORY STORE: the default Store implementation, used when no
 * DATABASE_URL is configured.
 *
 * Users, sessions, projects, locks, and check records live in Maps on
 * the server process and are lost on restart. That is deliberate for
 * local development and the first hosted demo: no database credentials
 * are needed, and none are faked. Set DATABASE_URL and the Postgres
 * adapter (postgres.ts) takes over behind the same interface.
 *
 * Demo content is NOT seeded here; lib/store/seed.ts seeds the demo
 * account and its project into whichever store is active, so both
 * adapters behave identically.
 */

function cloneLocks(locks: Lock[]): Lock[] {
  return locks.map((l) => ({
    ...l,
    found_by: [...l.found_by],
    breaks_if: [...l.breaks_if],
  }));
}

function cloneProject(p: Project): Project {
  return { ...p, locks: cloneLocks(p.locks) };
}

function cloneRecord(r: CheckRecord): CheckRecord {
  return { ...r, rows: r.rows.map((row) => ({ ...row, evidence: [...row.evidence] })) };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class InMemoryStore implements Store {
  private users = new Map<string, User>();
  private userIdsByEmail = new Map<string, string>();
  private sessions = new Map<string, Session>(); // by tokenHash
  private projects = new Map<string, Project>();
  private checks = new Map<string, CheckRecord[]>();

  async createUser(
    email: string,
    passwordHash: string
  ): Promise<User | undefined> {
    const normalized = normalizeEmail(email);
    if (this.userIdsByEmail.has(normalized)) return undefined;
    const user: User = {
      id: crypto.randomUUID(),
      email: normalized,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.userIdsByEmail.set(normalized, user.id);
    return { ...user };
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const id = this.userIdsByEmail.get(normalizeEmail(email));
    const user = id ? this.users.get(id) : undefined;
    return user ? { ...user } : undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const user = this.users.get(id);
    return user ? { ...user } : undefined;
  }

  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.tokenHash, { ...session });
  }

  async getSession(tokenHash: string): Promise<Session | undefined> {
    const session = this.sessions.get(tokenHash);
    return session ? { ...session } : undefined;
  }

  async deleteSession(tokenHash: string): Promise<boolean> {
    return this.sessions.delete(tokenHash);
  }

  async listProjects(ownerId: string): Promise<Project[]> {
    return [...this.projects.values()]
      .filter((p) => p.ownerId === ownerId)
      .map(cloneProject);
  }

  async getProject(id: string): Promise<Project | undefined> {
    const p = this.projects.get(id);
    return p ? cloneProject(p) : undefined;
  }

  async getDemoProject(): Promise<Project | undefined> {
    for (const p of this.projects.values()) {
      if (p.isDemo) return cloneProject(p);
    }
    return undefined;
  }

  async createProject(
    name: string,
    ownerId: string,
    opts?: { isDemo?: boolean }
  ): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(),
      ownerId,
      name,
      isDemo: opts?.isDemo ?? false,
      locks: [],
      createdAt: new Date().toISOString(),
    };
    this.projects.set(project.id, project);
    this.checks.set(project.id, []);
    return cloneProject(project);
  }

  async deleteProject(id: string): Promise<boolean> {
    this.checks.delete(id);
    return this.projects.delete(id);
  }

  async setLocks(id: string, locks: Lock[]): Promise<Project | undefined> {
    const p = this.projects.get(id);
    if (!p) return undefined;
    p.locks = cloneLocks(locks);
    return cloneProject(p);
  }

  async listChecks(projectId: string): Promise<CheckRecord[]> {
    return [...(this.checks.get(projectId) ?? [])].reverse().map(cloneRecord);
  }

  async addCheck(
    projectId: string,
    check: NewCheck
  ): Promise<CheckRecord | undefined> {
    if (!this.projects.has(projectId)) return undefined;
    const record: CheckRecord = {
      id: crypto.randomUUID(),
      projectId,
      createdAt: new Date().toISOString(),
      verdict: check.verdict,
      banner: check.banner,
      rows: check.rows.map((r) => ({ ...r, evidence: [...r.evidence] })),
    };
    this.checks.get(projectId)!.push(record);
    return cloneRecord(record);
  }
}

import type { CheckRow, Lock, Verdict } from "../matcher/matcher.ts";

export interface User {
  id: string;
  email: string; // stored normalized: trimmed and lowercased
  passwordHash: string; // scrypt hash string, never the plain password
  createdAt: string; // ISO 8601
}

/** The shape of a user that is safe to send to the client. */
export interface PublicUser {
  id: string;
  email: string;
}

export interface Session {
  id: string;
  userId: string;
  // SHA-256 hash of the bearer token. The raw token only ever exists in
  // the user's httpOnly cookie; a leaked session table leaks no usable
  // credentials.
  tokenHash: string;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
}

export interface Project {
  id: string;
  ownerId: string; // the User who created the project
  name: string;
  isDemo: boolean; // the seeded public demo project (readable by anyone)
  locks: Lock[];
  createdAt: string; // ISO 8601
}

export interface CheckRecord {
  id: string;
  projectId: string;
  createdAt: string; // ISO 8601
  verdict: Verdict;
  banner: string;
  rows: CheckRow[];
  // Governance note: the scene text itself is never stored. A record
  // keeps only the verdict and the quoted evidence lines the matcher
  // produced, which is what the history and export features need.
}

export interface NewCheck {
  verdict: Verdict;
  banner: string;
  rows: CheckRow[];
}

/**
 * Data access for Canon Lock Cloud. All persistence goes through this
 * interface so the storage engine can change (in-memory by default,
 * Postgres when DATABASE_URL is set) without touching the API routes
 * or the UI.
 *
 * Every method is asynchronous: the Postgres adapter cannot answer
 * synchronously, so the interface never pretends it can.
 */
export interface Store {
  // Accounts. createUser returns undefined when the email is taken.
  createUser(email: string, passwordHash: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;

  // Server-side sessions, keyed by the hash of the bearer token.
  createSession(session: Session): Promise<void>;
  getSession(tokenHash: string): Promise<Session | undefined>;
  deleteSession(tokenHash: string): Promise<boolean>;

  // Projects. Listing is always scoped to one owner; cross-user access
  // rules live in the auth layer, not here.
  listProjects(ownerId: string): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  getDemoProject(): Promise<Project | undefined>;
  createProject(
    name: string,
    ownerId: string,
    opts?: { isDemo?: boolean }
  ): Promise<Project>;
  deleteProject(id: string): Promise<boolean>;
  setLocks(id: string, locks: Lock[]): Promise<Project | undefined>;

  // Check history. Records never contain scene text (see CheckRecord).
  listChecks(projectId: string): Promise<CheckRecord[]>;
  addCheck(
    projectId: string,
    check: NewCheck
  ): Promise<CheckRecord | undefined>;
}

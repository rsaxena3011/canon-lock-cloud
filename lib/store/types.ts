import type { CheckRow, Lock, Verdict } from "../matcher/matcher.ts";

/** Subscription tier. A real field on the user record so plan gates
 * (billing, API access) have a seam to check; checkout lives elsewhere. */
export type Tier = "Free" | "Writer" | "Studio";

export const TIERS: Tier[] = ["Free", "Writer", "Studio"];

export interface User {
  id: string;
  email: string; // stored normalized: trimmed and lowercased
  passwordHash: string; // scrypt hash string, never the plain password
  tier: Tier; // defaults to "Free" at sign-up
  createdAt: string; // ISO 8601
}

/** The shape of a user that is safe to send to the client. */
export interface PublicUser {
  id: string;
  email: string;
  tier: Tier;
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
 * An API key for the public POST /v1/check endpoint. Only the SHA-256
 * hash of the key is ever stored; the raw key is shown to its owner
 * exactly once, at creation. `prefix` is the short display fragment
 * (for example "clc_live_ab12cd34") that is safe to list in the UI.
 */
export interface ApiKey {
  id: string;
  userId: string; // the account that owns the key
  name: string;
  keyHash: string; // SHA-256 hex of the full raw key
  prefix: string;
  createdAt: string; // ISO 8601
  lastUsedAt: string | null; // ISO 8601, null until first use
  revoked: boolean;
}

/** The shape of an API key that is safe to send to the client. */
export interface PublicApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export function toPublicApiKey(key: ApiKey): PublicApiKey {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revoked: key.revoked,
  };
}

/**
 * One audit-log row for a public API call. Governance: an entry holds
 * routing metadata only (which key, which account, which project, the
 * verdict, the HTTP status). It never holds scene text and never holds
 * the raw API key. Ids are nullable because a call with a missing or
 * unknown key is still audited, with nothing to attribute it to.
 */
export interface AuditEntry {
  id: string;
  createdAt: string; // ISO 8601
  keyId: string | null;
  userId: string | null;
  projectId: string | null;
  verdict: Verdict | null; // null when no check ran (auth/validation failure)
  statusCode: number;
  // What kind of event this row records: "api_check" for public API
  // calls, "billing_checkout_complete" / "billing_plan_cancelled" for
  // billing events, null for rows written before the column existed.
  event: string | null;
}

export interface NewAuditEntry {
  keyId: string | null;
  userId: string | null;
  projectId: string | null;
  verdict: Verdict | null;
  statusCode: number;
  event?: string | null;
}

/** Project-creation limit per tier. Enforced by the projects route. */
export const TIER_PROJECT_LIMITS: Record<Tier, number> = {
  Free: 1,
  Writer: 10,
  Studio: Number.POSITIVE_INFINITY,
};

export type BillingStatus = "open" | "complete" | "cancelled";

/**
 * One test-mode checkout session for a tier upgrade. Created by the
 * billing provider (lib/billing), paid on the in-app checkout page,
 * and completed server-side only: a session can upgrade its owner's
 * tier only while it is still "open" and only for its owner. The id
 * is a random UUID, unguessable, and acts as the capability token for
 * the checkout page. No card data is ever stored here or anywhere
 * else: test mode takes no real payment.
 */
export interface BillingSession {
  id: string;
  userId: string; // the account upgrading
  tier: Tier; // the tier being purchased
  priceCents: number; // price captured at creation, USD cents
  status: BillingStatus;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  completedAt: string | null; // ISO 8601 once status is "complete"
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
  // New accounts default to the Free tier unless opts.tier says otherwise.
  createUser(
    email: string,
    passwordHash: string,
    opts?: { tier?: Tier }
  ): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  setUserTier(id: string, tier: Tier): Promise<User | undefined>;

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

  // API keys. Only hashes are stored (see ApiKey). Revoking is scoped
  // to the owner so one account cannot revoke another account's key.
  createApiKey(key: ApiKey): Promise<ApiKey>;
  listApiKeys(userId: string): Promise<ApiKey[]>;
  getApiKeyByHash(keyHash: string): Promise<ApiKey | undefined>;
  revokeApiKey(id: string, userId: string): Promise<boolean>;
  touchApiKey(id: string, at: string): Promise<void>;

  // Audit log for public API calls. Entries never contain scene text
  // or raw keys (see AuditEntry).
  addAuditEntry(entry: NewAuditEntry): Promise<AuditEntry>;
  listAuditEntries(userId: string, limit?: number): Promise<AuditEntry[]>;

  // Test-mode billing sessions (see BillingSession). Status changes
  // stamp updatedAt, and completing stamps completedAt.
  createBillingSession(session: BillingSession): Promise<BillingSession>;
  getBillingSession(id: string): Promise<BillingSession | undefined>;
  setBillingSessionStatus(
    id: string,
    status: BillingStatus
  ): Promise<BillingSession | undefined>;
}

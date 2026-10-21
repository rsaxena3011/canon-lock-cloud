import { createHash, randomBytes } from "node:crypto";
import type { Project, PublicUser, Session, Store } from "../store/types.ts";
import { hashPassword, verifyPassword } from "./password.ts";

/**
 * Accounts and sessions, written against the Store interface only (no
 * web framework), so the whole flow is unit-testable and identical for
 * the in-memory and Postgres adapters.
 *
 * Sessions are server-side rows. The browser holds a random bearer
 * token in an httpOnly cookie; the store keeps only its SHA-256 hash.
 * Signing out deletes the row, which invalidates the token everywhere
 * immediately.
 */

export const SESSION_COOKIE = "cl_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

const MIN_PASSWORD_LENGTH = 8;

export type AuthResult =
  | { ok: true; user: PublicUser; token: string }
  | { ok: false; error: string };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function startSession(store: Store, userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const session: Session = {
    id: crypto.randomUUID(),
    userId,
    tokenHash: hashToken(token),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  await store.createSession(session);
  return token;
}

function toPublic(user: { id: string; email: string }): PublicUser {
  return { id: user.id, email: user.email };
}

export async function signUp(
  store: Store,
  rawEmail: string,
  password: string
): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  if (!isPlausibleEmail(email)) {
    return { ok: false, error: "Enter a valid email address" };
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  if (await store.getUserByEmail(email)) {
    return { ok: false, error: "An account with this email already exists" };
  }
  const user = await store.createUser(email, hashPassword(password));
  if (!user) {
    // Lost a race with a concurrent sign-up for the same email.
    return { ok: false, error: "An account with this email already exists" };
  }
  const token = await startSession(store, user.id);
  return { ok: true, user: toPublic(user), token };
}

export async function signIn(
  store: Store,
  rawEmail: string,
  password: string
): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  const user = await store.getUserByEmail(email);
  // One generic message: never reveal whether the email exists.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "Email or password is incorrect" };
  }
  const token = await startSession(store, user.id);
  return { ok: true, user: toPublic(user), token };
}

export async function signOut(
  store: Store,
  token: string | undefined
): Promise<void> {
  if (!token) return;
  await store.deleteSession(hashToken(token));
}

export async function resolveSession(
  store: Store,
  token: string | undefined
): Promise<PublicUser | undefined> {
  if (!token) return undefined;
  const tokenHash = hashToken(token);
  const session = await store.getSession(tokenHash);
  if (!session) return undefined;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await store.deleteSession(tokenHash);
    return undefined;
  }
  const user = await store.getUserById(session.userId);
  return user ? toPublic(user) : undefined;
}

/**
 * Access policy for projects. The seeded demo project is public and
 * read-only for everyone except its owner (the demo account). Every
 * other project is visible only to its owner.
 */
export function canReadProject(
  user: PublicUser | undefined,
  project: Project
): boolean {
  if (project.isDemo) return true;
  return user !== undefined && user.id === project.ownerId;
}

export function canMutateProject(
  user: PublicUser | undefined,
  project: Project
): boolean {
  return user !== undefined && user.id === project.ownerId;
}

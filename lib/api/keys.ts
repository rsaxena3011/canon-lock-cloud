import { createHash, randomBytes } from "node:crypto";
import type { ApiKey, Store, User } from "../store/types.ts";

/**
 * API key lifecycle for the public POST /v1/check endpoint, written
 * against the Store interface only (no web framework), mirroring how
 * lib/auth handles sessions.
 *
 * A key looks like "clc_live_<43 base64url chars>". The raw key is
 * returned to its owner exactly once, at creation. The store keeps
 * only its SHA-256 hash, the same treatment session tokens get: a
 * leaked api_keys table yields no usable credentials.
 */

export const API_KEY_PREFIX = "clc_live_";

// How much of the key is kept as the display prefix: the literal
// prefix plus the first 8 token characters. Enough to tell keys
// apart in the UI, useless for authenticating.
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKeySecret(): string {
  return API_KEY_PREFIX + randomBytes(32).toString("base64url");
}

export async function createApiKey(
  store: Store,
  userId: string,
  name: string
): Promise<{ key: ApiKey; secret: string }> {
  const secret = generateApiKeySecret();
  const key: ApiKey = {
    id: crypto.randomUUID(),
    userId,
    name,
    keyHash: hashApiKey(secret),
    prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revoked: false,
  };
  await store.createApiKey(key);
  return { key, secret };
}

export interface AuthenticatedKey {
  key: ApiKey;
  user: User;
}

/**
 * Resolves a presented raw key to its stored record and owner.
 * Returns undefined for unknown, malformed, or revoked keys, and for
 * keys whose owner no longer exists: callers answer one generic 401
 * for all of them, so a response never reveals which case it was.
 * A successful authentication stamps lastUsedAt.
 */
export async function authenticateApiKey(
  store: Store,
  rawKey: string | undefined
): Promise<AuthenticatedKey | undefined> {
  if (!rawKey || !rawKey.startsWith(API_KEY_PREFIX)) return undefined;
  const key = await store.getApiKeyByHash(hashApiKey(rawKey));
  if (!key || key.revoked) return undefined;
  const user = await store.getUserById(key.userId);
  if (!user) return undefined;
  await store.touchApiKey(key.id, new Date().toISOString());
  return { key, user };
}

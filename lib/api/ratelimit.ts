/**
 * Fixed-window rate limiting for public API keys.
 *
 * Each key gets `limit` calls per `windowMs` window; the window opens
 * at the key's first call in the window. Windows are tracked per key
 * id in process memory: deliberately simple, and consistent with the
 * default in-memory deployment. (A multi-process deployment that
 * needs a shared counter can swap this class behind the same shape.)
 */

export const DEFAULT_RATE_LIMIT = 60;
export const DEFAULT_RATE_WINDOW_MS = 60 * 60 * 1000; // one hour

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number; // calls left in the current window after this one
  retryAfterSeconds: number; // 0 when allowed
}

interface Window {
  startedAt: number;
  count: number;
}

export class FixedWindowRateLimiter {
  private windows = new Map<string, Window>();
  readonly limit: number;
  readonly windowMs: number;

  constructor(
    limit: number = DEFAULT_RATE_LIMIT,
    windowMs: number = DEFAULT_RATE_WINDOW_MS
  ) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  hit(keyId: string, now: number = Date.now()): RateLimitResult {
    const existing = this.windows.get(keyId);
    if (!existing || now - existing.startedAt >= this.windowMs) {
      this.windows.set(keyId, { startedAt: now, count: 1 });
      return {
        allowed: true,
        limit: this.limit,
        remaining: this.limit - 1,
        retryAfterSeconds: 0,
      };
    }
    if (existing.count >= this.limit) {
      return {
        allowed: false,
        limit: this.limit,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.startedAt + this.windowMs - now) / 1000)
        ),
      };
    }
    existing.count += 1;
    return {
      allowed: true,
      limit: this.limit,
      remaining: this.limit - existing.count,
      retryAfterSeconds: 0,
    };
  }
}

/**
 * Limiter configuration from the environment:
 * - CANONLOCK_API_RATE_LIMIT: calls per window per key (default 60).
 * - CANONLOCK_API_RATE_WINDOW_MS: window length (default one hour).
 * Non-numeric or non-positive values fall back to the defaults.
 */
export function rateLimiterFromEnv(
  env: Record<string, string | undefined> = process.env
): FixedWindowRateLimiter {
  const limit = Number(env.CANONLOCK_API_RATE_LIMIT);
  const windowMs = Number(env.CANONLOCK_API_RATE_WINDOW_MS);
  return new FixedWindowRateLimiter(
    Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_RATE_LIMIT,
    Number.isFinite(windowMs) && windowMs > 0
      ? Math.floor(windowMs)
      : DEFAULT_RATE_WINDOW_MS
  );
}

// One limiter per server process, kept on globalThis for the same
// reason as the store singleton: Next.js module reloading in
// development must not silently reset everyone's windows.
const globalScope = globalThis as unknown as {
  __canonLockRateLimiter?: FixedWindowRateLimiter;
};

export function getRateLimiter(): FixedWindowRateLimiter {
  return (globalScope.__canonLockRateLimiter ??= rateLimiterFromEnv());
}

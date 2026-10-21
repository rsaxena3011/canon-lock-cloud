import { checkScene } from "../matcher/matcher.ts";
import type { Lock, Verdict } from "../matcher/matcher.ts";
import type { Store } from "../store/types.ts";
import { authenticateApiKey, hashApiKey } from "./keys.ts";
import type { FixedWindowRateLimiter } from "./ratelimit.ts";
import { validateLockSet } from "./validate.ts";

/**
 * POST /v1/check, framework-free: the route handler in
 * app/v1/check/route.ts only extracts the key and JSON body and calls
 * this, so the whole endpoint (auth, rate limit, validation, matcher,
 * history, audit) is unit-testable against any Store adapter.
 *
 * Governance, same as the web flow: the scene is processed in memory
 * only. It is never logged and never stored. Project checks save the
 * usual history record (verdict and quoted evidence, no scene field);
 * ad-hoc checks are recorded in the audit log only. Every call writes
 * an audit entry with routing metadata and the outcome status.
 */

export interface V1CheckOutcome {
  status: number;
  body: Record<string, unknown>;
}

interface AuditContext {
  keyId: string | null;
  userId: string | null;
  projectId: string | null;
}

export async function handleV1Check(
  store: Store,
  limiter: FixedWindowRateLimiter,
  rawKey: string | undefined,
  body: unknown
): Promise<V1CheckOutcome> {
  const audit = async (
    ctx: AuditContext,
    statusCode: number,
    verdict: Verdict | null
  ): Promise<void> => {
    await store.addAuditEntry({ ...ctx, verdict, statusCode, event: "api_check" });
  };
  const fail = async (
    ctx: AuditContext,
    status: number,
    error: string,
    extra?: Record<string, unknown>
  ): Promise<V1CheckOutcome> => {
    await audit(ctx, status, null);
    return { status, body: { error, ...extra } };
  };

  // 1. Authenticate. Missing, unknown, and revoked keys all answer the
  // same generic 401.
  const auth = await authenticateApiKey(store, rawKey);
  if (!auth) {
    // Attribute the attempt when the key exists but is revoked, so the
    // owner can see the rejected calls in their audit log.
    let ctx: AuditContext = { keyId: null, userId: null, projectId: null };
    if (rawKey) {
      const known = await store.getApiKeyByHash(hashApiKey(rawKey));
      if (known) {
        ctx = { keyId: known.id, userId: known.userId, projectId: null };
      }
    }
    return fail(ctx, 401, "Invalid API key");
  }
  const { key, user } = auth;
  const ctx: AuditContext = { keyId: key.id, userId: user.id, projectId: null };

  // 1b. Plan gate: API access is a Studio entitlement, enforced here
  // (and at key creation in app/api/keys/route.ts), not just described
  // in the pricing copy. A key created before a downgrade, or carried
  // over from a trial, stops working the moment the account leaves
  // Studio. Defect #14 (Sol review, 2026-10-22).
  if (user.tier !== "Studio") {
    return fail(ctx, 403, "API access requires the Studio plan", {
      tier: user.tier,
    });
  }

  // 2. Rate limit, per key, before any real work happens.
  const rate = limiter.hit(key.id);
  if (!rate.allowed) {
    return fail(ctx, 429, "Rate limit exceeded", {
      limit: rate.limit,
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  // 3. Body shape: { scene, projectId } or { scene, locks }.
  if (typeof body !== "object" || body === null) {
    return fail(ctx, 400, "Request body must be a JSON object");
  }
  const { scene, projectId, locks } = body as {
    scene?: unknown;
    projectId?: unknown;
    locks?: unknown;
  };
  if (typeof scene !== "string" || scene.trim().length === 0) {
    return fail(ctx, 400, "A non-empty scene is required");
  }

  let effectiveLocks: Lock[];
  let project = undefined as
    | Awaited<ReturnType<Store["getProject"]>>
    | undefined;
  if (typeof projectId === "string") {
    project = await store.getProject(projectId);
    // A project the key's owner does not own answers 404, exactly like
    // the web flow, so project ids cannot be probed.
    if (!project || project.ownerId !== user.id) {
      return fail(ctx, 404, "Project not found");
    }
    ctx.projectId = project.id;
    if (project.locks.length === 0) {
      return fail(
        ctx,
        400,
        "Define at least one lock before running a check"
      );
    }
    effectiveLocks = project.locks;
  } else if (locks !== undefined) {
    const problem = validateLockSet(locks);
    if (problem) return fail(ctx, 400, problem);
    effectiveLocks = locks as Lock[];
  } else {
    return fail(ctx, 400, "Provide either projectId or locks");
  }

  // 4. Run the matcher. The scene goes no further than this call.
  const result = checkScene(scene, effectiveLocks);

  // 5. History: project checks join the project's check history, the
  // same record the web flow writes. Ad-hoc checks have no project to
  // attach to; the audit entry below is their record.
  let checkId: string | null = null;
  if (project) {
    const record = await store.addCheck(project.id, {
      verdict: result.verdict,
      banner: result.banner,
      rows: result.rows,
    });
    checkId = record?.id ?? null;
  }

  await audit(ctx, 200, result.verdict);
  return {
    status: 200,
    body: {
      verdict: result.verdict,
      banner: result.banner,
      rows: result.rows,
      projectId: project?.id ?? null,
      checkId,
      key: { id: key.id, name: key.name, tier: user.tier },
    },
  };
}

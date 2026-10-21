import {
  TIER_PROJECT_LIMITS,
  type BillingSession,
  type PublicUser,
  type Store,
  type Tier,
} from "../store/types.ts";
import { TIERS } from "../store/types.ts";
import { TIER_RANK } from "./plans.ts";
import { billingProvider, type BillingProvider } from "./provider.ts";

/**
 * Test-mode billing lifecycle, written against the Store interface
 * only (no web framework), mirroring lib/auth and lib/api: the route
 * handlers under app/api/billing are thin glue over these functions.
 *
 * The rules that make this a checkout and not a pricing page:
 * - A session can upgrade an account only while it is "open" and
 *   only for the account that created it. The checkout page is a
 *   client of these functions, never an authority.
 * - Completing is idempotent: a second completion (double click,
 *   replayed success URL) is a no-op and writes no second audit entry.
 * - Every money-shaped event lands in the audit log with an event
 *   name: "billing_checkout_complete" and "billing_plan_cancelled".
 *   Test mode takes no real payment, and no card data exists anywhere
 *   in the system to log.
 */

export type BillingResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

function fail<T>(status: number, error: string): BillingResult<T> {
  return { ok: false, status, error };
}

export async function createCheckoutSession(
  store: Store,
  user: PublicUser,
  tier: unknown,
  provider: BillingProvider = billingProvider
): Promise<BillingResult<{ session: BillingSession; redirectUrl: string }>> {
  if (typeof tier !== "string" || !(TIERS as string[]).includes(tier)) {
    return fail(400, "Choose a plan to upgrade to");
  }
  const target = tier as Tier;
  if (target === "Free") {
    return fail(400, "The Free plan needs no checkout");
  }
  if (TIER_RANK[target] <= TIER_RANK[user.tier]) {
    return fail(
      400,
      target === user.tier
        ? `You are already on the ${user.tier} plan`
        : `Checkout only moves a plan upward; use Cancel plan to return to Free`
    );
  }
  const { session, redirectUrl } = await provider.createSession(store, {
    userId: user.id,
    tier: target,
  });
  return { ok: true, value: { session, redirectUrl } };
}

/** Owner-scoped session lookup: another account's session is a 404. */
export async function getOwnedBillingSession(
  store: Store,
  userId: string,
  id: string
): Promise<BillingSession | undefined> {
  const session = await store.getBillingSession(id);
  if (!session || session.userId !== userId) return undefined;
  return session;
}

export async function completeBillingSession(
  store: Store,
  user: PublicUser,
  id: string
): Promise<
  BillingResult<{ session: BillingSession; alreadyCompleted: boolean }>
> {
  const session = await getOwnedBillingSession(store, user.id, id);
  if (!session) return fail(404, "Checkout session not found");
  if (session.status === "complete") {
    // Idempotent replay: the upgrade already happened; do not apply
    // it again and do not write a second audit entry.
    return { ok: true, value: { session, alreadyCompleted: true } };
  }
  if (session.status === "cancelled") {
    return fail(409, "This checkout was cancelled");
  }
  const updated =
    (await store.setBillingSessionStatus(id, "complete")) ?? session;
  await store.setUserTier(user.id, session.tier);
  await store.addAuditEntry({
    keyId: null,
    userId: user.id,
    projectId: null,
    verdict: null,
    statusCode: 200,
    event: "billing_checkout_complete",
  });
  return { ok: true, value: { session: updated, alreadyCompleted: false } };
}

export async function cancelBillingSession(
  store: Store,
  user: PublicUser,
  id: string
): Promise<
  BillingResult<{ session: BillingSession; alreadyCancelled: boolean }>
> {
  const session = await getOwnedBillingSession(store, user.id, id);
  if (!session) return fail(404, "Checkout session not found");
  if (session.status === "complete") {
    return fail(409, "This checkout is already complete");
  }
  if (session.status === "cancelled") {
    return { ok: true, value: { session, alreadyCancelled: true } };
  }
  const updated =
    (await store.setBillingSessionStatus(id, "cancelled")) ?? session;
  return { ok: true, value: { session: updated, alreadyCancelled: false } };
}

/**
 * Cancel plan: back to Free, effective immediately, audited. A no-op
 * (changed: false, no audit entry) when the account is already Free.
 */
export async function cancelPlan(
  store: Store,
  user: PublicUser
): Promise<{ tier: Tier; changed: boolean }> {
  if (user.tier === "Free") return { tier: "Free", changed: false };
  await store.setUserTier(user.id, "Free");
  await store.addAuditEntry({
    keyId: null,
    userId: user.id,
    projectId: null,
    verdict: null,
    statusCode: 200,
    event: "billing_plan_cancelled",
  });
  return { tier: "Free", changed: true };
}

/**
 * The project-creation gate, enforced by POST /api/projects. The 403
 * names the current plan and its limit so the UI can say exactly why
 * creation stopped and what an upgrade would change.
 */
export async function checkProjectCapacity(
  store: Store,
  user: PublicUser
): Promise<BillingResult<{ limit: number }>> {
  const limit = TIER_PROJECT_LIMITS[user.tier];
  const count = (await store.listProjects(user.id)).length;
  if (count >= limit) {
    return fail(
      403,
      `Your ${user.tier} plan includes up to ${limit} project${
        limit === 1 ? "" : "s"
      }. Upgrade your plan to create more.`
    );
  }
  return { ok: true, value: { limit } };
}

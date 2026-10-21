import type { BillingSession, Store, Tier } from "../store/types.ts";
import { TIER_PRICE_CENTS } from "./plans.ts";

/**
 * The billing provider seam. Checkout routes and the checkout page
 * talk to this interface only, so a real payment provider (Stripe,
 * Polar, Lemon Squeezy, Dodo) can replace the test provider later
 * without changing routes, pages, or the session lifecycle in
 * lib/billing/billing.ts. A real provider would create its session
 * here and confirm payment through its webhook; the test provider
 * confirms on the in-app checkout page instead.
 *
 * Sessions are persisted through the Store (see BillingSession in
 * lib/store/types.ts): the session id is a random UUID, and the
 * lifecycle rules (owner-only, open-only, idempotent completion) are
 * enforced server-side in billing.ts, never trusted to the browser.
 */

export interface CheckoutSessionResult {
  session: BillingSession;
  redirectUrl: string;
}

export interface BillingProvider {
  readonly name: string;
  createSession(
    store: Store,
    input: { userId: string; tier: Tier }
  ): Promise<CheckoutSessionResult>;
}

/**
 * TEST PROVIDER: no real money, no external accounts, no card data
 * ever collected or stored. It creates a real session row and sends
 * the user to the in-app checkout page, which behaves like a hosted
 * checkout (order summary, test card, pay/cancel) against that row.
 */
export class TestBillingProvider implements BillingProvider {
  readonly name = "test";

  async createSession(
    store: Store,
    input: { userId: string; tier: Tier }
  ): Promise<CheckoutSessionResult> {
    const now = new Date().toISOString();
    const session = await store.createBillingSession({
      id: crypto.randomUUID(),
      userId: input.userId,
      tier: input.tier,
      priceCents: TIER_PRICE_CENTS[input.tier],
      status: "open",
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    return { session, redirectUrl: `/billing/checkout/${session.id}` };
  }
}

export const billingProvider: BillingProvider = new TestBillingProvider();

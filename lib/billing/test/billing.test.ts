import { signUp } from "../../auth/auth.ts";
import { InMemoryStore } from "../../store/memory.ts";
import type { PublicUser, Store } from "../../store/types.ts";
import {
  cancelBillingSession,
  cancelPlan,
  checkProjectCapacity,
  completeBillingSession,
  createCheckoutSession,
  getOwnedBillingSession,
} from "../billing.ts";
import { TestBillingProvider } from "../provider.ts";

/**
 * Billing lifecycle against the in-memory Store: session creation,
 * server-side completion, idempotent replay, cancel paths, plan
 * downgrade, audit entries, and the per-tier project limits. The
 * Postgres adapter runs the same session semantics through the
 * fake-pool parity suite in lib/store/test/postgres.test.ts.
 */

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string) {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}`);
  }
}

async function freshUser(
  store: Store,
  email: string
): Promise<PublicUser> {
  const res = await signUp(store, email, "password-123");
  if (!res.ok) throw new Error(`signUp failed for ${email}: ${res.error}`);
  return res.user;
}

async function publicUser(store: Store, id: string): Promise<PublicUser> {
  const user = await store.getUserById(id);
  if (!user) throw new Error(`user ${id} missing`);
  return { id: user.id, email: user.email, tier: user.tier };
}

async function auditEvents(store: Store, userId: string) {
  const entries = await store.listAuditEntries(userId, 200);
  return entries.map((e) => e.event);
}

// 1. Session creation: shape, pricing, redirect, validation.
{
  const store = new InMemoryStore();
  const user = await freshUser(store, "buyer@example.com");
  check(user.tier === "Free", "new-user-starts-free");

  const res = await createCheckoutSession(store, user, "Writer");
  check(res.ok === true, "checkout-session-created");
  if (res.ok) {
    const { session, redirectUrl } = res.value;
    check(session.status === "open", "session-starts-open");
    check(session.tier === "Writer", "session-target-tier");
    check(session.priceCents === 1200, "session-writer-price-1200");
    check(session.completedAt === null, "session-not-completed");
    check(
      redirectUrl === `/billing/checkout/${session.id}`,
      "session-redirect-url"
    );
    check(!("card" in session), "session-holds-no-card-data");
    const stored = await store.getBillingSession(session.id);
    check(stored?.userId === user.id, "session-persisted-for-owner");
  }

  const studio = await createCheckoutSession(store, user, "Studio");
  check(
    studio.ok && studio.value.session.priceCents === 4900,
    "session-studio-price-4900"
  );

  const provider = new TestBillingProvider();
  check(provider.name === "test", "provider-is-the-test-provider");

  const freeTarget = await createCheckoutSession(store, user, "Free");
  check(!freeTarget.ok && freeTarget.status === 400, "checkout-free-target-400");
  const bogus = await createCheckoutSession(store, user, "Platinum");
  check(!bogus.ok && bogus.status === 400, "checkout-unknown-tier-400");
}

// 2. Completion upgrades the tier, stamps the session, writes audit.
{
  const store = new InMemoryStore();
  const user = await freshUser(store, "upgrader@example.com");
  const created = await createCheckoutSession(store, user, "Studio");
  if (!created.ok) throw new Error("setup: session creation failed");
  const id = created.value.session.id;

  const done = await completeBillingSession(store, user, id);
  check(done.ok === true, "complete-succeeds");
  if (done.ok) {
    check(done.value.alreadyCompleted === false, "complete-first-time");
    check(done.value.session.status === "complete", "session-marked-complete");
    check(done.value.session.completedAt !== null, "session-completed-at-set");
  }
  check(
    (await store.getUserById(user.id))?.tier === "Studio",
    "tier-upgraded-to-studio"
  );
  check(
    (await auditEvents(store, user.id)).filter(
      (e) => e === "billing_checkout_complete"
    ).length === 1,
    "audit-checkout-complete-written-once"
  );

  // Replay: same call again is a no-op, no second audit entry.
  const fresh = await publicUser(store, user.id);
  const replay = await completeBillingSession(store, fresh, id);
  check(replay.ok && replay.value.alreadyCompleted, "complete-replay-idempotent");
  check(
    (await auditEvents(store, user.id)).filter(
      (e) => e === "billing_checkout_complete"
    ).length === 1,
    "audit-not-duplicated-on-replay"
  );
  check(
    (await store.getUserById(user.id))?.tier === "Studio",
    "tier-unchanged-on-replay"
  );
}

// 3. Completion is owner-only and honours session state.
{
  const store = new InMemoryStore();
  const owner = await freshUser(store, "owner@example.com");
  const stranger = await freshUser(store, "stranger@example.com");
  const created = await createCheckoutSession(store, owner, "Writer");
  if (!created.ok) throw new Error("setup: session creation failed");
  const id = created.value.session.id;

  check(
    (await getOwnedBillingSession(store, stranger.id, id)) === undefined,
    "session-hidden-from-other-accounts"
  );
  const stolen = await completeBillingSession(store, stranger, id);
  check(!stolen.ok && stolen.status === 404, "complete-wrong-owner-404");
  check(
    (await store.getUserById(stranger.id))?.tier === "Free",
    "wrong-owner-tier-untouched"
  );
  check(
    (await store.getBillingSession(id))?.status === "open",
    "session-still-open-after-probe"
  );
  const missing = await completeBillingSession(store, owner, "no-such-id");
  check(!missing.ok && missing.status === 404, "complete-missing-session-404");
}

// 4. Cancel keeps the tier; a cancelled session cannot complete.
{
  const store = new InMemoryStore();
  const user = await freshUser(store, "canceller@example.com");
  const created = await createCheckoutSession(store, user, "Writer");
  if (!created.ok) throw new Error("setup: session creation failed");
  const id = created.value.session.id;

  const cancelled = await cancelBillingSession(store, user, id);
  check(cancelled.ok === true, "cancel-succeeds");
  if (cancelled.ok) {
    check(cancelled.value.session.status === "cancelled", "session-marked-cancelled");
    check(cancelled.value.session.completedAt === null, "cancel-stamps-no-completion");
  }
  check(
    (await store.getUserById(user.id))?.tier === "Free",
    "tier-untouched-by-cancel"
  );
  const again = await cancelBillingSession(store, user, id);
  check(again.ok && again.value.alreadyCancelled, "cancel-replay-idempotent");
  const latePay = await completeBillingSession(store, user, id);
  check(!latePay.ok && latePay.status === 409, "complete-after-cancel-409");
  check(
    (await store.getUserById(user.id))?.tier === "Free",
    "tier-still-free-after-late-pay"
  );
  check(
    (await auditEvents(store, user.id)).filter(
      (e) => e === "billing_checkout_complete"
    ).length === 0,
    "no-audit-for-cancelled-checkout"
  );

  // A completed session cannot be cancelled afterwards.
  const second = await createCheckoutSession(store, user, "Writer");
  if (!second.ok) throw new Error("setup: second session failed");
  await completeBillingSession(store, user, second.value.session.id);
  const cancelDone = await cancelBillingSession(
    store,
    await publicUser(store, user.id),
    second.value.session.id
  );
  check(!cancelDone.ok && cancelDone.status === 409, "cancel-after-complete-409");
}

// 5. Cancel plan downgrades to Free and is audited; Free is a no-op.
{
  const store = new InMemoryStore();
  const user = await freshUser(store, "downgrader@example.com");
  const created = await createCheckoutSession(store, user, "Studio");
  if (!created.ok) throw new Error("setup: session creation failed");
  await completeBillingSession(store, user, created.value.session.id);
  const studio = await publicUser(store, user.id);
  check(studio.tier === "Studio", "setup-user-on-studio");

  const result = await cancelPlan(store, studio);
  check(result.changed === true && result.tier === "Free", "cancel-plan-downgrades");
  check(
    (await store.getUserById(user.id))?.tier === "Free",
    "cancel-plan-persists-free"
  );
  check(
    (await auditEvents(store, user.id)).filter(
      (e) => e === "billing_plan_cancelled"
    ).length === 1,
    "audit-plan-cancelled-written"
  );
  const noop = await cancelPlan(store, await publicUser(store, user.id));
  check(noop.changed === false, "cancel-plan-on-free-is-noop");
  check(
    (await auditEvents(store, user.id)).filter(
      (e) => e === "billing_plan_cancelled"
    ).length === 1,
    "audit-not-duplicated-on-noop-cancel"
  );
}

// 6. Tier limits: enforced per tier, named in the error, lifted by upgrade.
{
  const store = new InMemoryStore();
  const user = await freshUser(store, "limited@example.com");

  await store.createProject("Book one", user.id);
  const blockedFree = await checkProjectCapacity(store, user);
  check(!blockedFree.ok && blockedFree.status === 403, "free-limit-blocks-second-project");
  if (!blockedFree.ok) {
    check(blockedFree.error.includes("Free"), "free-limit-error-names-plan");
    check(blockedFree.error.includes("1"), "free-limit-error-names-limit");
  }

  const created = await createCheckoutSession(store, user, "Writer");
  if (!created.ok) throw new Error("setup: session creation failed");
  await completeBillingSession(store, user, created.value.session.id);
  const writer = await publicUser(store, user.id);
  const afterUpgrade = await checkProjectCapacity(store, writer);
  check(afterUpgrade.ok === true, "limit-lifted-after-upgrade");

  for (let i = 2; i <= 10; i++) {
    await store.createProject(`Book ${i}`, user.id);
  }
  const blockedWriter = await checkProjectCapacity(store, writer);
  check(!blockedWriter.ok && blockedWriter.status === 403, "writer-limit-blocks-eleventh");
  if (!blockedWriter.ok) {
    check(blockedWriter.error.includes("Writer"), "writer-limit-error-names-plan");
    check(blockedWriter.error.includes("10"), "writer-limit-error-names-limit");
  }

  const studioUser = await freshUser(store, "unlimited@example.com");
  await store.setUserTier(studioUser.id, "Studio");
  const studio = await publicUser(store, studioUser.id);
  for (let i = 1; i <= 11; i++) {
    await store.createProject(`Studio book ${i}`, studioUser.id);
  }
  const studioCapacity = await checkProjectCapacity(store, studio);
  check(studioCapacity.ok === true, "studio-has-no-project-limit");
}

// 7. Checkout refuses same-tier and downward moves.
{
  const store = new InMemoryStore();
  const user = await freshUser(store, "ranked@example.com");
  await store.setUserTier(user.id, "Writer");
  const writer = await publicUser(store, user.id);
  const same = await createCheckoutSession(store, writer, "Writer");
  check(!same.ok && same.status === 400, "checkout-same-tier-400");
  const up = await createCheckoutSession(store, writer, "Studio");
  check(up.ok === true, "checkout-writer-to-studio-ok");
  await store.setUserTier(user.id, "Studio");
  const studio = await publicUser(store, user.id);
  const down = await createCheckoutSession(store, studio, "Writer");
  check(!down.ok && down.status === 400, "checkout-downward-400");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

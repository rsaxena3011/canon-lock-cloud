import { hashPassword } from "../auth/password.ts";
import type { Lock } from "../matcher/matcher.ts";
import type { Store } from "./types.ts";

/**
 * Seeded demo content, applied idempotently to whichever Store is
 * active (in-memory or Postgres) at server start.
 *
 * The demo account exists so judges can sign in and run the full
 * workflow without registering. Its credentials are documented in the
 * README on purpose; the account owns nothing but the demo project.
 */

export const DEMO_EMAIL = "demo@canonlock.cloud";
export const DEMO_PASSWORD = "canonlock-demo";
export const DEMO_PROJECT_NAME = "The Monsoon Draft";

// The rev. 3 spec example locks. Same set the day-1 build shipped with.
const DEMO_LOCKS: Lock[] = [
  {
    name: "Meera's glass",
    type: "state",
    must_stay: "empty",
    found_by: ["glass"],
    breaks_if: [
      "full",
      "filled",
      "fill",
      "fills",
      "refilled",
      "brim",
      "brimming",
      "pours",
      "poured",
    ],
  },
  {
    name: "Arjun's coat",
    type: "attribute",
    must_stay: "blue",
    found_by: ["coat"],
    breaks_if: ["red", "black", "grey", "gray", "green", "brown"],
  },
];

export async function seedDemo(store: Store): Promise<void> {
  let user = await store.getUserByEmail(DEMO_EMAIL);
  if (!user) {
    // The demo account is Studio tier so judges can exercise the API
    // key flow and the audit log, not just the web checker.
    user = await store.createUser(DEMO_EMAIL, hashPassword(DEMO_PASSWORD), {
      tier: "Studio",
    });
  } else if (user.tier !== "Studio") {
    // An older database may hold the demo account on the default tier.
    user = (await store.setUserTier(user.id, "Studio")) ?? user;
  }
  if (!user) return; // another process seeded it first; nothing to do

  if (await store.getDemoProject()) return;

  const project = await store.createProject(DEMO_PROJECT_NAME, user.id, {
    isDemo: true,
  });
  await store.setLocks(project.id, DEMO_LOCKS);
}

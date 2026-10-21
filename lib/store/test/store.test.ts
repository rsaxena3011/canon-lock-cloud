import { InMemoryStore } from "../memory.ts";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PROJECT_NAME,
  seedDemo,
} from "../seed.ts";
import { verifyPassword } from "../../auth/password.ts";
import type { Lock } from "../../matcher/matcher.ts";

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

const LOCK: Lock = {
  name: "Meera's glass",
  type: "state",
  must_stay: "empty",
  found_by: ["glass"],
  breaks_if: ["full"],
};

// 1. Users: create, duplicate rejected, lookups.
{
  const store = new InMemoryStore();
  const user = await store.createUser("Writer@Example.com", "hash-1");
  check(user !== undefined, "user-created");
  check(user?.email === "writer@example.com", "user-email-normalized");
  const dup = await store.createUser("writer@example.com", "hash-2");
  check(dup === undefined, "user-duplicate-email-rejected");
  const byEmail = await store.getUserByEmail("WRITER@example.com");
  check(byEmail?.id === user?.id, "user-get-by-email-case-insensitive");
  const byId = await store.getUserById(user!.id);
  check(byId?.passwordHash === "hash-1", "user-get-by-id");
  check((await store.getUserByEmail("nobody@example.com")) === undefined, "user-missing-undefined");
}

// 2. Sessions: store, read back, delete.
{
  const store = new InMemoryStore();
  const user = (await store.createUser("a@example.com", "h"))!;
  const now = Date.now();
  await store.createSession({
    id: "s1",
    userId: user.id,
    tokenHash: "hash-of-token",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  });
  const got = await store.getSession("hash-of-token");
  check(got?.userId === user.id, "session-round-trip");
  check((await store.deleteSession("hash-of-token")) === true, "session-delete-true");
  check((await store.getSession("hash-of-token")) === undefined, "session-gone-after-delete");
  check((await store.deleteSession("hash-of-token")) === false, "session-delete-again-false");
}

// 3. Projects: ownership-scoped listing, locks, checks, deletion.
{
  const store = new InMemoryStore();
  const a = (await store.createUser("a@example.com", "h"))!;
  const b = (await store.createUser("b@example.com", "h"))!;

  const pa = await store.createProject("A's novel", a.id);
  await store.createProject("B's novel", b.id);
  check(pa.ownerId === a.id && pa.isDemo === false, "project-owner-recorded");

  const listA = await store.listProjects(a.id);
  const listB = await store.listProjects(b.id);
  check(listA.length === 1 && listA[0].name === "A's novel", "list-scoped-to-owner-a");
  check(listB.length === 1 && listB[0].name === "B's novel", "list-scoped-to-owner-b");
  check((await store.getDemoProject()) === undefined, "no-demo-project-yet");

  const withLocks = await store.setLocks(pa.id, [LOCK]);
  check(withLocks?.locks.length === 1 && withLocks.locks[0].name === LOCK.name, "locks-set");
  check((await store.setLocks("missing-id", [LOCK])) === undefined, "locks-missing-project");

  const c1 = await store.addCheck(pa.id, {
    verdict: "ALLOW",
    banner: "All locks hold",
    rows: [],
  });
  const c2 = await store.addCheck(pa.id, {
    verdict: "BLOCK",
    banner: "A lock broke",
    rows: [],
  });
  check(c1 !== undefined && c2 !== undefined, "checks-added");
  check(c1 !== undefined && !("scene" in c1), "check-record-has-no-scene-field");
  const history = await store.listChecks(pa.id);
  check(history.length === 2 && history[0].id === c2?.id, "checks-newest-first");
  check(
    (await store.addCheck("missing-id", { verdict: "ALLOW", banner: "x", rows: [] })) === undefined,
    "check-missing-project-undefined"
  );

  check((await store.deleteProject(pa.id)) === true, "project-deleted");
  check((await store.getProject(pa.id)) === undefined, "project-gone");
  check((await store.listChecks(pa.id)).length === 0, "checks-gone-with-project");
}

// 4. Seeding: demo account and demo project, idempotent.
{
  const store = new InMemoryStore();
  await seedDemo(store);
  const demoUser = await store.getUserByEmail(DEMO_EMAIL);
  check(demoUser !== undefined, "seed-demo-user-exists");
  check(
    demoUser !== undefined && verifyPassword(DEMO_PASSWORD, demoUser.passwordHash),
    "seed-demo-password-verifies"
  );
  const demo = await store.getDemoProject();
  check(demo?.name === DEMO_PROJECT_NAME, "seed-demo-project-name");
  check(demo?.isDemo === true, "seed-demo-project-flagged");
  check(demo?.ownerId === demoUser?.id, "seed-demo-project-owned-by-demo-user");
  check(demo?.locks.length === 2, "seed-demo-project-has-spec-locks");

  await seedDemo(store);
  const demoUser2 = await store.getUserByEmail(DEMO_EMAIL);
  check(demoUser2?.id === demoUser?.id, "seed-idempotent-same-user");
  check(
    (await store.listProjects(demoUser!.id)).length === 1,
    "seed-idempotent-single-demo-project"
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

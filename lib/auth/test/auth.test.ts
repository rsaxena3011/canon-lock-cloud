import { createHash } from "node:crypto";
import {
  canMutateProject,
  canReadProject,
  resolveSession,
  signIn,
  signOut,
  signUp,
} from "../auth.ts";
import { hashPassword, verifyPassword } from "../password.ts";
import { InMemoryStore } from "../../store/memory.ts";
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemo } from "../../store/seed.ts";
import type { Project } from "../../store/types.ts";

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

function project(ownerId: string, isDemo: boolean): Project {
  return {
    id: "p",
    ownerId,
    name: "P",
    isDemo,
    locks: [],
    createdAt: new Date().toISOString(),
  };
}

// 1. Password hashing: round trip, wrong password, malformed hash.
{
  const hash = hashPassword("correct horse battery");
  check(hash.startsWith("scrypt:"), "password-hash-format");
  check(verifyPassword("correct horse battery", hash), "password-verify-ok");
  check(!verifyPassword("wrong horse", hash), "password-verify-wrong-fails");
  check(!verifyPassword("anything", "not-a-real-hash"), "password-verify-malformed-fails");
  check(hashPassword("correct horse battery") !== hash, "password-salts-differ");
}

// 2. Sign up: session works immediately, email normalized, dup rejected.
{
  const store = new InMemoryStore();
  const res = await signUp(store, "  New@Example.com ", "long-enough-password");
  check(res.ok === true, "signup-ok");
  if (res.ok) {
    check(res.user.email === "new@example.com", "signup-email-normalized");
    const who = await resolveSession(store, res.token);
    check(who?.id === res.user.id, "signup-session-resolves");
  }
  const dup = await signUp(store, "new@example.com", "another-password");
  check(dup.ok === false, "signup-duplicate-rejected");
  const short = await signUp(store, "two@example.com", "short");
  check(short.ok === false, "signup-short-password-rejected");
  const badEmail = await signUp(store, "not-an-email", "long-enough-password");
  check(badEmail.ok === false, "signup-bad-email-rejected");
}

// 3. Sign in and out: wrong password fails, sign out kills the session.
{
  const store = new InMemoryStore();
  await signUp(store, "flow@example.com", "the-right-password");
  const wrong = await signIn(store, "flow@example.com", "the-wrong-password");
  check(wrong.ok === false, "signin-wrong-password-fails");
  const ghost = await signIn(store, "ghost@example.com", "the-right-password");
  check(ghost.ok === false, "signin-unknown-email-fails");
  const res = await signIn(store, "flow@example.com", "the-right-password");
  check(res.ok === true, "signin-ok");
  if (res.ok) {
    check(
      (await resolveSession(store, res.token))?.email === "flow@example.com",
      "signin-session-resolves"
    );
    await signOut(store, res.token);
    check(
      (await resolveSession(store, res.token)) === undefined,
      "signout-invalidates-session"
    );
  }
  check((await resolveSession(store, "made-up-token")) === undefined, "unknown-token-no-session");
  check((await resolveSession(store, undefined)) === undefined, "no-token-no-session");
}

// 4. Expired sessions are refused and cleaned up.
{
  const store = new InMemoryStore();
  const user = (await store.createUser("old@example.com", hashPassword("x-password")))!;
  const token = "expired-token-value";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const now = Date.now();
  await store.createSession({
    id: "s-old",
    userId: user.id,
    tokenHash,
    createdAt: new Date(now - 10_000).toISOString(),
    expiresAt: new Date(now - 5_000).toISOString(),
  });
  check((await resolveSession(store, token)) === undefined, "expired-session-refused");
  check((await store.getSession(tokenHash)) === undefined, "expired-session-deleted");
}

// 5. Access policy: owners, strangers, anonymous, and the demo project.
{
  const owner = { id: "u-owner", email: "owner@example.com" };
  const other = { id: "u-other", email: "other@example.com" };
  const mine = project(owner.id, false);
  const demo = project("u-demo", true);

  check(canReadProject(owner, mine) && canMutateProject(owner, mine), "owner-reads-and-mutates");
  check(!canReadProject(other, mine), "stranger-cannot-read-private-project");
  check(!canMutateProject(other, mine), "stranger-cannot-mutate-private-project");
  check(!canReadProject(undefined, mine), "anonymous-cannot-read-private-project");
  check(canReadProject(undefined, demo), "anonymous-reads-demo-project");
  check(canReadProject(other, demo), "stranger-reads-demo-project");
  check(!canMutateProject(undefined, demo), "anonymous-cannot-mutate-demo");
  check(!canMutateProject(other, demo), "stranger-cannot-mutate-demo");
}

// 6. The seeded demo account can sign in with its documented password.
{
  const store = new InMemoryStore();
  await seedDemo(store);
  const res = await signIn(store, DEMO_EMAIL, DEMO_PASSWORD);
  check(res.ok === true, "demo-account-signs-in");
  const bad = await signIn(store, DEMO_EMAIL, "canonlock-demo-wrong");
  check(bad.ok === false, "demo-account-wrong-password-fails");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

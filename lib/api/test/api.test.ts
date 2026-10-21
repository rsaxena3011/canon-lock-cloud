import { handleV1Check } from "../check.ts";
import {
  authenticateApiKey,
  createApiKey,
  hashApiKey,
} from "../keys.ts";
import { FixedWindowRateLimiter } from "../ratelimit.ts";
import { InMemoryStore } from "../../store/memory.ts";
import type { Lock } from "../../matcher/matcher.ts";

/**
 * Public API suite: key lifecycle, POST /v1/check behavior end to end
 * through the framework-free handler, rate limits, and the audit log.
 * The privacy assertions matter most: no scene text and no raw key
 * may appear in anything the store keeps.
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

const LOCK: Lock = {
  name: "Meera's glass",
  type: "state",
  must_stay: "empty",
  found_by: ["glass"],
  breaks_if: ["full", "filled", "brim"],
};

// A marker that appears in scenes but in no lock word and no quoted
// evidence line, so it must never show up in stored records.
const MARKER = "ZQXW-UNIQUE-SCENE-MARKER";
const SCENE_BLOCK = [
  `INT. KITCHEN - NIGHT ${MARKER}`,
  "Meera fills the glass to the brim.",
].join("\n");
const SCENE_ALLOW = [
  `INT. KITCHEN - NIGHT ${MARKER}`,
  "Meera sets the empty glass down.",
].join("\n");

const limiter = () => new FixedWindowRateLimiter(60, 60_000);

async function accountWithKey(tier?: "Free" | "Writer" | "Studio") {
  const store = new InMemoryStore();
  const user = (await store.createUser("api@example.com", "h", { tier }))!;
  const { key, secret } = await createApiKey(store, user.id, "Test key");
  return { store, user, key, secret };
}

// 1. Key lifecycle: shown once, hash-only storage, revoke blocks use.
{
  const { store, user, key, secret } = await accountWithKey();
  check(secret.startsWith("clc_live_"), "key-secret-has-live-prefix");
  check(key.keyHash === hashApiKey(secret), "key-stored-as-sha256-hash");
  check(key.keyHash !== secret, "key-hash-is-not-the-secret");
  const stored = (await store.listApiKeys(user.id))[0];
  check(
    !JSON.stringify(stored).includes(secret),
    "key-secret-nowhere-in-stored-record"
  );
  check(stored.lastUsedAt === null, "key-last-used-null-before-use");

  const auth = await authenticateApiKey(store, secret);
  check(auth?.key.id === key.id && auth?.user.id === user.id, "key-authenticates");
  check(
    (await store.listApiKeys(user.id))[0].lastUsedAt !== null,
    "key-last-used-stamped-on-use"
  );
  check(
    (await authenticateApiKey(store, "clc_live_wrong")) === undefined,
    "key-wrong-secret-rejected"
  );
  check(
    (await authenticateApiKey(store, undefined)) === undefined,
    "key-missing-rejected"
  );

  check((await store.revokeApiKey(key.id, user.id)) === true, "key-revoked");
  check(
    (await authenticateApiKey(store, secret)) === undefined,
    "key-revoked-no-longer-authenticates"
  );
}

// 2. /v1/check against a project: verdict payload, key metadata,
//    history record written with no scene text.
{
  const { store, user, secret } = await accountWithKey("Studio");
  const project = await store.createProject("Novel", user.id);
  await store.setLocks(project.id, [LOCK]);

  const out = await handleV1Check(store, limiter(), secret, {
    projectId: project.id,
    scene: SCENE_BLOCK,
  });
  check(out.status === 200, "v1-project-check-200");
  check(out.body.verdict === "BLOCK", "v1-project-check-verdict-block");
  const rows = out.body.rows as { name: string; evidence: string[] }[];
  check(
    rows.length === 1 && rows[0].evidence.join(" ").includes("brim"),
    "v1-project-check-rows-quote-evidence"
  );
  const meta = out.body.key as { name: string; tier: string };
  check(
    meta.name === "Test key" && meta.tier === "Studio",
    "v1-project-check-key-metadata"
  );
  check(out.body.projectId === project.id, "v1-project-check-project-id");

  const history = await store.listChecks(project.id);
  check(history.length === 1, "v1-project-check-history-written");
  check(!("scene" in history[0]), "v1-history-record-has-no-scene-field");
  check(
    !JSON.stringify(history[0]).includes(MARKER),
    "v1-history-record-has-no-scene-text"
  );

  // Someone else's project answers 404 to this key.
  const stranger = (await store.createUser("stranger@example.com", "h"))!;
  const foreign = await store.createProject("Not yours", stranger.id);
  await store.setLocks(foreign.id, [LOCK]);
  const probed = await handleV1Check(store, limiter(), secret, {
    projectId: foreign.id,
    scene: SCENE_ALLOW,
  });
  check(probed.status === 404, "v1-foreign-project-404");
}

// 3. /v1/check with ad-hoc locks: happy path plus validation rules.
{
  const { store, secret } = await accountWithKey();
  const ok = await handleV1Check(store, limiter(), secret, {
    locks: [LOCK],
    scene: SCENE_ALLOW,
  });
  check(ok.status === 200 && ok.body.verdict === "ALLOW", "v1-adhoc-allow");
  check(ok.body.projectId === null && ok.body.checkId === null, "v1-adhoc-no-project");

  const empty = await handleV1Check(store, limiter(), secret, {
    locks: [],
    scene: SCENE_ALLOW,
  });
  check(empty.status === 400, "v1-adhoc-empty-locks-400");

  const tooMany = await handleV1Check(store, limiter(), secret, {
    locks: Array.from({ length: 51 }, () => LOCK),
    scene: SCENE_ALLOW,
  });
  check(tooMany.status === 400, "v1-adhoc-over-50-locks-400");

  const malformed = await handleV1Check(store, limiter(), secret, {
    locks: [{ name: "broken" }],
    scene: SCENE_ALLOW,
  });
  check(malformed.status === 400, "v1-adhoc-malformed-lock-400");

  const noTarget = await handleV1Check(store, limiter(), secret, {
    scene: SCENE_ALLOW,
  });
  check(noTarget.status === 400, "v1-no-project-or-locks-400");

  const noScene = await handleV1Check(store, limiter(), secret, {
    locks: [LOCK],
    scene: "   ",
  });
  check(noScene.status === 400, "v1-empty-scene-400");
}

// 4. Auth failures at the handler: bad key and revoked key both 401.
{
  const { store, user, key, secret } = await accountWithKey();
  const bad = await handleV1Check(store, limiter(), "clc_live_nope", {
    locks: [LOCK],
    scene: SCENE_ALLOW,
  });
  check(bad.status === 401, "v1-bad-key-401");
  const missing = await handleV1Check(store, limiter(), undefined, {
    locks: [LOCK],
    scene: SCENE_ALLOW,
  });
  check(missing.status === 401, "v1-missing-key-401");

  await store.revokeApiKey(key.id, user.id);
  const revoked = await handleV1Check(store, limiter(), secret, {
    locks: [LOCK],
    scene: SCENE_ALLOW,
  });
  check(revoked.status === 401, "v1-revoked-key-401");
  // The revoked attempt is attributed in the owner's audit log.
  const entries = await store.listAuditEntries(user.id);
  check(
    entries.some((e) => e.statusCode === 401 && e.keyId === key.id),
    "v1-revoked-attempt-audited-with-key-id"
  );
}

// 5. Rate limit: the call past the cap answers 429 with a JSON error.
{
  const { store, user, secret } = await accountWithKey();
  const tiny = new FixedWindowRateLimiter(2, 60_000);
  const first = await handleV1Check(store, tiny, secret, {
    locks: [LOCK],
    scene: SCENE_ALLOW,
  });
  const second = await handleV1Check(store, tiny, secret, {
    locks: [LOCK],
    scene: SCENE_ALLOW,
  });
  const third = await handleV1Check(store, tiny, secret, {
    locks: [LOCK],
    scene: SCENE_ALLOW,
  });
  check(first.status === 200 && second.status === 200, "v1-rate-limit-allows-up-to-cap");
  check(third.status === 429, "v1-rate-limit-429-past-cap");
  check(
    typeof third.body.error === "string" &&
      (third.body.retryAfterSeconds as number) > 0,
    "v1-rate-limit-json-error-with-retry-after"
  );
  const entries = await store.listAuditEntries(user.id);
  check(
    entries.some((e) => e.statusCode === 429),
    "v1-rate-limited-call-audited"
  );
}

// 6. Audit log: entries carry metadata and verdicts, never scene text.
{
  const { store, user, secret } = await accountWithKey();
  const project = await store.createProject("Audited", user.id);
  await store.setLocks(project.id, [LOCK]);
  await handleV1Check(store, limiter(), secret, {
    projectId: project.id,
    scene: SCENE_BLOCK,
  });
  await handleV1Check(store, limiter(), secret, {
    locks: [LOCK],
    scene: SCENE_ALLOW,
  });
  const entries = await store.listAuditEntries(user.id);
  check(entries.length === 2, "audit-one-entry-per-call");
  const withVerdict = entries.find((e) => e.verdict === "BLOCK");
  check(
    withVerdict?.projectId === project.id && withVerdict?.statusCode === 200,
    "audit-entry-carries-project-and-verdict"
  );
  check(
    !JSON.stringify(entries).includes(MARKER),
    "audit-entries-contain-no-scene-text"
  );
  check(
    !JSON.stringify(entries).includes(secret),
    "audit-entries-contain-no-raw-key"
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

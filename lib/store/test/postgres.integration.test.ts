import { PostgresStore } from "../postgres.ts";
import { signIn, signUp } from "../../auth/auth.ts";

/**
 * Live-database integration test. Runs only when DATABASE_URL points
 * at a real Postgres; otherwise it skips cleanly (exit 0), so
 * `npm test` stays green on machines without a database. The
 * fake-pool parity suite (postgres.test.ts) covers the adapter's
 * semantics everywhere else.
 *
 *   DATABASE_URL=postgres://user:pass@host:5432/db npm test
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.log("SKIP  postgres integration: DATABASE_URL is not set");
  process.exit(0);
}

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

const store = new PostgresStore(connectionString);
await store.ensureSchema();
check(true, "live-schema-applied");
await store.ensureSchema();
check(true, "live-schema-idempotent");

const email = `integration-${Date.now()}@example.com`;
const up = await signUp(store, email, "integration-password");
check(up.ok === true, "live-signup");
if (up.ok) {
  const project = await store.createProject("Integration project", up.user.id);
  check(project.ownerId === up.user.id, "live-project-created");
  const listed = await store.listProjects(up.user.id);
  check(listed.some((p) => p.id === project.id), "live-project-listed");
  await store.deleteProject(project.id);
}
const inRes = await signIn(store, email, "integration-password");
check(inRes.ok === true, "live-signin-after-restart-of-flow");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

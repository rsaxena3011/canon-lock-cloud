import { PostgresStore } from "../postgres.ts";
import type { PgQueryable } from "../postgres.ts";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_PROJECT_NAME, seedDemo } from "../seed.ts";
import { signIn } from "../../auth/auth.ts";
import type { Lock } from "../../matcher/matcher.ts";

/**
 * Store-interface parity for the Postgres adapter, run against a fake
 * pool (no live database needed). The fake implements exactly the SQL
 * surface PostgresStore issues, storing rows in Maps the way Postgres
 * would return them (JSONB already parsed, ids as strings). A real
 * end-to-end run against a live database lives in
 * postgres.integration.test.ts and runs when DATABASE_URL is set.
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

type Row = Record<string, unknown>;

class FakePool implements PgQueryable {
  private users = new Map<string, Row>();
  private sessions = new Map<string, Row>();
  private projects = new Map<string, Row>();
  private checks: Row[] = [];
  private seq = 0;

  async query(
    text: string,
    params: unknown[] = []
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    const sql = text.replace(/\s+/g, " ").trim();
    const p = params as (string | boolean)[];
    const empty = { rows: [] as Row[], rowCount: 0 };

    if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
      return empty;
    }
    if (sql.startsWith("INSERT INTO users")) {
      const dupe = [...this.users.values()].some((u) => u.email === p[1]);
      if (dupe) return empty;
      const row: Row = {
        id: p[0],
        email: p[1],
        password_hash: p[2],
        created_at: p[3],
      };
      this.users.set(p[0] as string, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("FROM users WHERE email")) {
      const row = [...this.users.values()].find((u) => u.email === p[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("FROM users WHERE id")) {
      const row = this.users.get(p[0] as string);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO sessions")) {
      const row: Row = {
        id: p[0],
        user_id: p[1],
        token_hash: p[2],
        created_at: p[3],
        expires_at: p[4],
      };
      this.sessions.set(p[2] as string, row);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("DELETE FROM sessions")) {
      const had = this.sessions.delete(p[0] as string);
      return { rows: [], rowCount: had ? 1 : 0 };
    }
    if (sql.includes("FROM sessions WHERE token_hash")) {
      const row = this.sessions.get(p[0] as string);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO projects")) {
      const row: Row = {
        id: p[0],
        owner_id: p[1],
        name: p[2],
        is_demo: p[3],
        locks: JSON.parse(p[4] as string),
        created_at: p[5],
      };
      this.projects.set(p[0] as string, row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("FROM projects WHERE owner_id")) {
      const rows = [...this.projects.values()]
        .filter((r) => r.owner_id === p[0])
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("FROM projects WHERE is_demo")) {
      const row = [...this.projects.values()].find((r) => r.is_demo === true);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("DELETE FROM projects")) {
      const had = this.projects.delete(p[0] as string);
      if (had) this.checks = this.checks.filter((c) => c.project_id !== p[0]);
      return { rows: [], rowCount: had ? 1 : 0 };
    }
    if (sql.includes("FROM projects WHERE id")) {
      const row = this.projects.get(p[0] as string);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE projects SET locks")) {
      const row = this.projects.get(p[0] as string);
      if (!row) return empty;
      row.locks = JSON.parse(p[1] as string);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith("INSERT INTO checks")) {
      const row: Row = {
        id: p[0],
        project_id: p[1],
        verdict: p[2],
        banner: p[3],
        rows: JSON.parse(p[4] as string),
        created_at: p[5],
        _seq: ++this.seq,
      };
      this.checks.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (sql.includes("FROM checks WHERE project_id")) {
      const rows = this.checks
        .filter((c) => c.project_id === p[0])
        .sort(
          (a, b) =>
            String(b.created_at).localeCompare(String(a.created_at)) ||
            Number(b._seq) - Number(a._seq)
        );
      return { rows, rowCount: rows.length };
    }
    throw new Error(`FakePool: unhandled SQL: ${sql.slice(0, 100)}`);
  }
}

const LOCK: Lock = {
  name: "Meera's glass",
  type: "state",
  must_stay: "empty",
  found_by: ["glass"],
  breaks_if: ["full"],
};

const store = new PostgresStore("postgres://fake", new FakePool());
await store.ensureSchema();
check(true, "schema-applies-against-pool");

// Users and sessions: same semantics as the in-memory adapter.
{
  const user = await store.createUser("Pg@Example.com", "hash-1");
  check(user !== undefined && user.email === "pg@example.com", "pg-user-created-normalized");
  check((await store.createUser("pg@example.com", "hash-2")) === undefined, "pg-user-duplicate-rejected");
  check((await store.getUserByEmail("PG@example.com"))?.id === user?.id, "pg-user-by-email");
  check((await store.getUserById(user!.id))?.passwordHash === "hash-1", "pg-user-by-id");

  const now = Date.now();
  await store.createSession({
    id: "s1",
    userId: user!.id,
    tokenHash: "tok-hash",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  });
  check((await store.getSession("tok-hash"))?.userId === user!.id, "pg-session-round-trip");
  check((await store.deleteSession("tok-hash")) === true, "pg-session-delete-true");
  check((await store.deleteSession("tok-hash")) === false, "pg-session-delete-again-false");
}

// Projects, locks, checks: ownership scoping and history behavior.
{
  const a = (await store.createUser("a@pg.dev", "h"))!;
  const b = (await store.createUser("b@pg.dev", "h"))!;
  const pa = await store.createProject("A on Postgres", a.id);
  await store.createProject("B on Postgres", b.id);
  check((await store.listProjects(a.id)).length === 1, "pg-list-scoped-a");
  check((await store.listProjects(b.id))[0]?.name === "B on Postgres", "pg-list-scoped-b");

  const withLocks = await store.setLocks(pa.id, [LOCK]);
  check(withLocks?.locks[0]?.name === LOCK.name, "pg-locks-jsonb-round-trip");
  check((await store.setLocks("missing", [LOCK])) === undefined, "pg-locks-missing-project");

  const c1 = await store.addCheck(pa.id, { verdict: "ALLOW", banner: "holds", rows: [] });
  const c2 = await store.addCheck(pa.id, { verdict: "BLOCK", banner: "broke", rows: [] });
  check(c1 !== undefined && c2 !== undefined, "pg-checks-added");
  check(c1 !== undefined && !("scene" in c1), "pg-check-record-has-no-scene-field");
  const history = await store.listChecks(pa.id);
  check(history.length === 2 && history[0].id === c2?.id, "pg-checks-newest-first");
  check(
    (await store.addCheck("missing", { verdict: "ALLOW", banner: "x", rows: [] })) === undefined,
    "pg-check-missing-project-undefined"
  );

  check((await store.deleteProject(pa.id)) === true, "pg-project-deleted");
  check((await store.listChecks(pa.id)).length === 0, "pg-checks-cascade-deleted");
}

// Seeding and the full auth flow run unchanged on the Postgres adapter.
{
  check((await store.getDemoProject()) === undefined, "pg-no-demo-before-seed");
  await seedDemo(store);
  await seedDemo(store);
  const demo = await store.getDemoProject();
  check(demo?.name === DEMO_PROJECT_NAME, "pg-demo-project-seeded");
  check(demo?.locks.length === 2, "pg-demo-project-locks");
  const demoUser = await store.getUserByEmail(DEMO_EMAIL);
  check(demo?.ownerId === demoUser?.id, "pg-demo-owned-by-demo-user");
  check(
    (await store.listProjects(demoUser!.id)).length === 1,
    "pg-seed-idempotent"
  );
  const res = await signIn(store, DEMO_EMAIL, DEMO_PASSWORD);
  check(res.ok === true, "pg-demo-account-signs-in");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

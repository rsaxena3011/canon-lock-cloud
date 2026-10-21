# Canon Lock Cloud

A writer's continuity gate for AI-regenerated scenes. Paste a scene: the locks
you wrote do not move. ALLOW / BLOCK / REVIEW, with the exact line quoted.

Built for [Galuxium Nexus V2](https://galuxium-nexus-v2-29411.devpost.com/).

## How it works

1. Define **locks**: facts that must not change (e.g. "Meera's glass stays empty").
2. Paste a scene.
3. Get a verdict: **ALLOW** (nothing broken), **BLOCK** (a lock broke, with the
   exact offending line quoted), or **REVIEW** (the scene mentions a locked
   thing without settling it; you decide).

The matcher is **deterministic**: same locks + same scene = same verdict, every
time. No AI in the verdict path. No guessing. Evidence is quoted
character-for-character with line numbers.

## Status

Working today:

- Next.js app with a landing page and the full checker workflow at `/check`.
- The deterministic matcher in `lib/matcher`, with its smoke suite in `npm test`.
- Accounts: email and password sign up, sign in, and sign out, with
  server-side sessions. Projects are owned by their creator and are
  readable and writable only by that account.
- Projects, locks, checks, history, and report export (JSON and Markdown)
  working end to end through API routes, with a seeded demo project.
- Two storage adapters behind one async `Store` interface:
  - **In-memory** (default): zero setup, data lasts for the life of the
    server process, and the code says so in its own header.
  - **Postgres**: durable storage via the `pg` driver, selected by
    setting `DATABASE_URL`. The schema is applied idempotently on boot
    (or ahead of time with `npm run db:migrate`).

Next, in order:

1. Test-mode billing for the Writer and Studio tiers, with plan gates.
2. Hashed API keys and the public `POST /v1/check` endpoint for Studio.
3. Rate limits and the audit log.

## Demo account

Judges and reviewers can sign in at `/check` with the seeded demo account:

- Email: `demo@canonlock.cloud`
- Password: `canonlock-demo`

The demo account owns the seeded demo project, **The Monsoon Draft**, with
the spec's example locks, so the full workflow (run a check, edit locks,
read history, export a report) works immediately. Without signing in, the
demo project is still visible in read-only form. The demo account is
seeded idempotently into whichever store is active at server start.

## Repository layout

- `app/`: Next.js App Router pages and API routes (landing, `/check`,
  `/api/auth/*`, `/api/projects` and friends).
- `lib/matcher/`: the deterministic matching engine, a TypeScript port of
  the PRD rev. 3 reference implementation. Zero dependencies; runs in the
  browser and on the server. Its smoke suite lives in `lib/matcher/test`.
- `lib/store/`: the async `Store` interface, the in-memory adapter
  (`memory.ts`), the Postgres adapter (`postgres.ts`), demo seeding
  (`seed.ts`), and their test suites in `lib/store/test`.
- `lib/auth/`: password hashing (Node crypto scrypt), the framework-free
  sign up / sign in / sign out flow, the session and project access
  policy, and the route-handler glue (`server.ts`).
- `lib/report.ts`: report export as JSON or Markdown.
- `db/`: `schema.sql` (the Postgres schema, identical to the copy the
  adapter applies on boot) and `migrate.ts` (an idempotent runner for
  it).

## Run it locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev     # http://localhost:3000, checker at /check
npm test        # matcher smoke + store + auth + Postgres parity suites
npm run build   # production build
```

### Without a database (default)

Nothing to configure. The in-memory store is used, the demo account and
demo project are seeded at start, and all data resets when the process
restarts.

### With Postgres

Point `DATABASE_URL` at any Postgres (Neon, Supabase, local, and so on)
and the Postgres adapter takes over:

```bash
export DATABASE_URL=postgres://user:pass@host:5432/canonlock
npm run db:migrate   # optional: apply the schema ahead of time
npm run dev          # the server also applies the schema on boot
```

Accounts, sessions, projects, and history then persist across restarts.
The demo account and project are seeded into the database on first boot.

## Data model

Four tables (see `db/schema.sql`):

- `users`: id, normalized email (unique), scrypt password hash, created_at.
- `sessions`: id, user id, SHA-256 hash of the session token, created_at,
  expires_at. The raw token exists only in the user's httpOnly cookie.
- `projects`: id, owner id, name, demo flag, locks (JSONB), created_at.
- `checks`: id, project id, verdict, banner, evidence rows (JSONB),
  created_at. Deleting a project cascades to its checks.

## Tiers

- **Free**: 1 project, 20 checks/day, scene never stored.
- **Writer** ($12/mo): 10 projects, saved lock sets, export, check history.
- **Studio** ($49/mo): API key, 5 seats, audit log. `POST /v1/check` at
  $0.02/check after 1,000 included.

## Privacy and data model

- **Scene text is never stored, in either storage mode.** A scene is
  processed in memory to produce a verdict, and then it is gone. Check
  records keep only the verdict, the banner, and the short quoted
  evidence lines the matcher produced: there is no scene field anywhere
  in the schema, and the test suites assert that.
- **No third-party AI in the verdict path.** No embeddings, no external
  model sees your scene.
- **Passwords** are hashed with scrypt from Node's crypto module, with a
  per-user salt and the parameters recorded in the hash string.
- **Sessions** are server-side rows keyed by a hash of the token, so
  signing out invalidates the token immediately and a leaked session
  table yields no usable credentials.
- **Isolation**: projects are listed and served per owner. Another
  account's project answers 404, not a permission error, so ids cannot
  be probed. The one exception is the seeded demo project, which is
  public and read-only for everyone but its owner.
- Export or delete your data at any time: report export is built in, and
  deleting a project deletes its history with it.

## Known limits (honest)

- Paraphrase is an ALLOW (the matcher checks the lock's words, not meaning).
- Cross-line breaks are not caught (evidence unit is the line).
- Wrong-owner mentions need explicit found-by phrases.

## License

MIT

# Canon Lock Cloud

A writer's continuity gate for AI-regenerated scenes. Paste a scene: the locks
you wrote do not move. ALLOW / BLOCK / REVIEW, with the exact line quoted.

Built for [Galuxium Nexus V2](https://galuxium-nexus-v2-29411.devpost.com/).

Executive briefing: [EXECUTIVE_BRIEFING.md](EXECUTIVE_BRIEFING.md)
(v2): problem, differentiation, architecture, governance, monetization,
honest validation, and roadmap.

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
- A public API: `POST /v1/check`, authenticated with per-account API
  keys (shown once at creation, stored only as SHA-256 hashes), with
  per-key rate limits and an audit log of every call. Keys are managed
  from the account panel on `/check`. See "Public API" below.
- Accounts carry a tier (Free / Writer / Studio) as a real field, so
  plan gates have a seam to check. The seeded demo account is Studio.
- Test-mode billing: plan upgrades run through a real checkout
  lifecycle (server-side sessions, an in-app checkout page, audited
  tier changes) against a test provider, and project limits per plan
  are enforced. See "Billing (test mode)" below. No real money moves.
- Two storage adapters behind one async `Store` interface:
  - **In-memory** (default): zero setup, data lasts for the life of the
    server process, and the code says so in its own header.
  - **Postgres**: durable storage via the `pg` driver, selected by
    setting `DATABASE_URL`. The schema is applied idempotently on boot
    (or ahead of time with `npm run db:migrate`).

Next, in order:

1. A production payment provider behind the billing provider seam
   (lib/billing), replacing the test provider without touching the
   checkout routes or pages.

## Demo account

Judges and reviewers can sign in at `/check` with the seeded demo account:

- Email: `demo@canonlock.cloud`
- Password: `canonlock-demo`
- Tier: **Studio**, so the API key panel and the audit log work too.

The demo account owns the seeded demo project, **The Monsoon Draft**, with
the spec's example locks, so the full workflow (run a check, edit locks,
read history, export a report) works immediately. Without signing in, the
demo project is still visible in read-only form. The demo account is
seeded idempotently into whichever store is active at server start.

## Repository layout

- `app/`: Next.js App Router pages and API routes (landing, `/check`,
  `/api/auth/*`, `/api/projects` and friends, `/api/keys`,
  `/api/audit`, the billing routes under `/api/billing/*` plus the
  checkout page at `/billing/checkout/[id]`, and the public
  `/v1/check`).
- `lib/matcher/`: the deterministic matching engine, a TypeScript port of
  the PRD rev. 3 reference implementation. Zero dependencies; runs in the
  browser and on the server. Its smoke suite lives in `lib/matcher/test`.
- `lib/store/`: the async `Store` interface, the in-memory adapter
  (`memory.ts`), the Postgres adapter (`postgres.ts`), demo seeding
  (`seed.ts`), and their test suites in `lib/store/test`.
- `lib/auth/`: password hashing (Node crypto scrypt), the framework-free
  sign up / sign in / sign out flow, the session and project access
  policy, and the route-handler glue (`server.ts`).
- `lib/api/`: the public API layer, framework-free like `lib/auth`:
  API key generation, hashing, and authentication (`keys.ts`), the
  fixed-window rate limiter (`ratelimit.ts`), ad-hoc lock validation
  (`validate.ts`), and the whole `POST /v1/check` handler (`check.ts`),
  with its suite in `lib/api/test`.
- `lib/billing/`: the monetization layer, also framework-free: the
  plan catalogue and prices (`plans.ts`), the provider seam with the
  test provider (`provider.ts`), and the checkout lifecycle, plan
  cancellation, and project-capacity gate (`billing.ts`), with its
  suite in `lib/billing/test`.
- `lib/report.ts`: report export as JSON or Markdown.
- `db/`: `schema.sql` (the Postgres schema, identical to the copy the
  adapter applies on boot) and `migrate.ts` (an idempotent runner for
  it).

## Run it locally

Requires Node.js 20 or newer.

```bash
npm install
npm run dev     # http://localhost:3000, checker at /check
npm test        # matcher, store, auth, Postgres parity, API, billing
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

## Public API

`POST /v1/check` runs the same deterministic matcher as the web
checker, for scripts and CI pipelines.

**Authentication.** Create a key in the API keys panel on `/check`
while signed in. The key (format `clc_live_...`) is shown exactly
once; only its SHA-256 hash is stored, so it cannot be recovered, only
revoked and replaced. Send it as a bearer token or in the `x-api-key`
header:

```bash
curl https://your-host/v1/check \
  -H "Authorization: Bearer clc_live_EXAMPLE0000000000000000000000000000" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "your-project-id",
    "scene": "Meera fills the glass to the brim."
  }'
```

**Request body.** `scene` (required, non-empty) plus exactly one of:

- `projectId`: check against that project's saved locks. The project
  must belong to the key's account; anyone else's project answers 404.
  The check is added to the project's history, like a web check.
- `locks`: an inline lock set, validated with the same rules as the
  web flow (each lock is `{ name, type, must_stay, found_by,
  breaks_if }`; at least 1 and at most 50). Ad-hoc checks are recorded
  in the audit log only.

**Response** (HTTP 200):

```json
{
  "verdict": "BLOCK",
  "banner": "BLOCK - 1 lock broken: Meera's glass",
  "rows": [
    {
      "name": "Meera's glass",
      "result": "BROKEN",
      "evidence": ["Line 1: Meera fills the glass to the brim."],
      "rowLabel": "Broken"
    }
  ],
  "projectId": "your-project-id",
  "checkId": "the-history-record-id",
  "key": { "id": "key-id", "name": "CI pipeline", "tier": "Studio" }
}
```

For ad-hoc checks, `projectId` and `checkId` are `null`.

**Errors** are JSON (`{ "error": "..." }`): 400 for a malformed body,
empty scene, or invalid lock set; 401 for a missing, unknown, or
revoked key (one generic message for all three); 404 for a project
the key's account does not own; 429 when the rate limit is hit, with
`retryAfterSeconds` in the body.

**Rate limits.** Per key, fixed window: 60 checks per hour by
default. Configure with `CANONLOCK_API_RATE_LIMIT` (calls per window)
and `CANONLOCK_API_RATE_WINDOW_MS` (window length in milliseconds).

**Audit log.** Every API call writes an audit entry: timestamp, key
id, account id, project id if any, verdict, and HTTP status. No scene
text, no raw key. Read your own account's entries, newest first, at
`GET /api/audit` (session cookie; `?limit=` up to 200).

## Billing (test mode)

The mandatory deliverable is a monetization engine with a working
test-mode checkout, so billing is a real subsystem, not a pricing
page with dead buttons. It runs against a **test provider**: no real
charges are taken, no external payment account is involved, and no
card data is stored anywhere (there is no card column in the schema;
the checkout form's values are never persisted).

How a plan change happens, end to end:

1. Sign in, open the account panel on `/check`, and choose an Upgrade
   button (Writer $12/mo or Studio $49/mo).
2. `POST /api/billing/checkout` creates a server-side checkout
   session in the `billing_sessions` table, owned by your account,
   and hands back the in-app checkout page
   (`/billing/checkout/[id]`).
3. On that page, under a TEST MODE banner, use the test card
   (4242 4242 4242 4242, any future expiry, any CVC) and Pay. The
   server completes the session, upgrades your tier immediately, and
   writes a `billing_checkout_complete` entry to the audit log.
4. "Cancel plan" in the account panel returns the account to Free at
   any time, also audited (`billing_plan_cancelled`). Cancelling a
   checkout before paying marks the session cancelled and never
   touches the tier.

Rules enforced on the server, not in the UI: a session can be
completed only by its owner and only while it is open; completing
twice is a no-op (replay cannot double-charge or double-upgrade);
checkout only moves upward (same-tier and downward purchases are
refused); and project creation enforces the plan limits, Free 1,
Writer 10, Studio unlimited, with a 403 whose message names the plan
and the limit.

**Judge note:** the seeded demo account is already Studio. To walk
the upgrade path, either create a fresh account (it starts on Free,
with the 1-project limit) and upgrade it, or use "Cancel plan" on
the demo account to drop it to Free and then upgrade it again. Both
paths take under a minute.

The provider lives behind a seam (`lib/billing/provider.ts`), so a
production provider (the Polar / Lemon Squeezy / Dodo class) can
replace the test provider without touching the routes, the checkout
page, or the tier logic: its webhook would resolve to the same
server-side session completion.

## Data model

Seven tables (see `db/schema.sql`):

- `users`: id, normalized email (unique), scrypt password hash, tier
  (Free / Writer / Studio, default Free), created_at.
- `sessions`: id, user id, SHA-256 hash of the session token, created_at,
  expires_at. The raw token exists only in the user's httpOnly cookie.
- `projects`: id, owner id, name, demo flag, locks (JSONB), created_at.
- `checks`: id, project id, verdict, banner, evidence rows (JSONB),
  created_at. Deleting a project cascades to its checks.
- `api_keys`: id, owner id, name, SHA-256 hash of the key (unique),
  display prefix, created_at, last_used_at, revoked flag. The raw key
  is never stored.
- `audit_log`: id, created_at, key id, account id, project id, verdict,
  HTTP status, and an event column that is null for API checks and
  names billing events (`billing_checkout_complete`,
  `billing_plan_cancelled`). Routing metadata only: no scene text, no
  raw keys. It deliberately has no foreign keys, so the trail survives
  deletion of the project or key it references.
- `billing_sessions`: id, account id, target tier, price in cents,
  status (open / complete / cancelled), created_at, updated_at,
  completed_at. No card data exists in the schema: test mode never
  collects any worth storing.

## Tiers

Every account carries a tier as a real field on the user record
(default Free; the seeded demo account is Studio). Checkout is built
in test mode (see "Billing (test mode)" above), and the project
limits below are enforced at project creation.

- **Free**: 1 project, scene never stored.
- **Writer** ($12/mo): 10 projects, saved lock sets, export, check history.
- **Studio** ($49/mo): unlimited projects, API keys, audit log. `POST /v1/check` at
  $0.02/check after 1,000 included.

## Privacy and data model

- **Scene text is never stored, in either storage mode.** A scene is
  processed in memory to produce a verdict, and then it is gone. Check
  records keep only the verdict, the banner, and the short quoted
  evidence lines the matcher produced: there is no scene field anywhere
  in the schema, and the test suites assert that.
- **No third-party AI in the verdict path.** No embeddings, no external
  model sees your scene.
- **API keys** get the same treatment as session tokens: only the
  SHA-256 hash is stored, the raw key is shown once at creation, and
  the audit log records key ids and verdicts, never keys or scenes.
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
